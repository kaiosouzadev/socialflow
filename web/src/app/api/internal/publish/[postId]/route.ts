import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkInternalKey, internalJson } from "@/lib/internal-auth";
import { decryptToken } from "@/lib/crypto";
import { redactSecrets } from "@/lib/meta";
import { getInstagramPublishingQuota, publishToPlatform, type MediaItem } from "@/lib/meta-publish";
import { thumbFromUrl } from "@/lib/media-thumb";
import { PUBLISH_BLOCKED } from "@/lib/publish-policy";
import {
  claimPost,
  countRecentPublications,
  finishAttempt,
  limitReason,
  nextSlotAfterDailyLimit,
  nextSlotAfterGraphQuota,
  recordNetworkSuccess,
  saveThumbIfMissing,
  type ClaimResult,
  type NetworkOutcome,
  type PostOutcome,
} from "@/lib/publish-queue";

export const dynamic = "force-dynamic";
// publish de vídeo/carrossel faz polling — pode levar minutos
export const maxDuration = 300;

/** Prazo da publicação inteira: abaixo do maxDuration (300 s) e do timeout do n8n (290 s). */
const PUBLISH_BUDGET_MS = 240_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type NetworkResult = {
  platform: string;
  ok: boolean;
  externalId?: string;
  /** já publicado numa tentativa anterior — não publicou de novo */
  skipped?: boolean;
  /** limite da conta: fica para depois, não é falha */
  deferred?: boolean;
  error?: string;
};

/** Mensagem de erro segura para banco, log e resposta (sem token). */
function safeError(e: unknown, token: string | null): string {
  const raw = e instanceof Error ? e.message || e.name : "erro";
  return redactSecrets(raw, token).slice(0, 500);
}

/**
 * Publica um post nas redes-alvo (chamado pelo WF-01). A mídia cheia
 * PERMANECE no R2 por 30 dias (limpeza em /api/internal/cleanup-media, WF-06).
 *
 * Fila idempotente (OWASP CF-06), detalhes em lib/publish-queue:
 * - o post é TOMADO de forma atômica (status `scheduled` → `publishing` sob
 *   trava de linha); se outra chamada já está com ele, ou ele não está na
 *   fila, a resposta é 409 sem publicar nada;
 * - cliente só produção → o post volta para draft e a resposta é 409
 *   `CLIENT_NO_PUBLISH`;
 * - rede que já tem publicação com sucesso para este post não é publicada de
 *   novo (nova tentativa só repete as redes que falharam);
 * - a tentativa fica viva até o fim: redes que falharam/ficaram para depois e
 *   o status final do post são gravados juntos (`finishAttempt`), sob a trava
 *   da tomada — outra chamada nunca toma o post no meio.
 *
 * Limite por conta (CF-11), antes de cada rede: `daily_post_limit` (publicações
 * da conta nas últimas 24 h) e, no Instagram, a cota da Meta
 * (`content_publishing_limit`). Excedido → a rede fica para depois: o post
 * volta para `scheduled` mais tarde, sem contar como falha, com o motivo em
 * `last_error`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ postId: string }> }) {
  const denied = checkInternalKey(req);
  if (denied) return denied;

  const { postId } = await params;
  if (!UUID.test(postId)) return internalJson({ error: "Post inválido." }, 400);

  const startedAt = Date.now();
  let claim: ClaimResult;
  try {
    claim = await claimPost(postId, new Date(startedAt));
  } catch (e) {
    console.error("[publish] falha ao tomar o post", postId, e instanceof Error ? e.message : e);
    return internalJson({ error: "Não foi possível publicar agora. Tente de novo em instantes." }, 500);
  }

  if (claim.kind === "not_found") return internalJson({ error: "Post não encontrado" }, 404);
  if (claim.kind === "blocked") {
    return internalJson({ error: PUBLISH_BLOCKED.message, code: PUBLISH_BLOCKED.code }, 409);
  }
  if (claim.kind === "busy") {
    return internalJson({ error: "O post já está sendo publicado.", code: "POST_BUSY" }, 409);
  }
  if (claim.kind === "not_queued") {
    return internalJson({ error: "O post não está na fila de publicação.", code: "POST_NOT_QUEUED" }, 409);
  }
  if (claim.kind === "finished") {
    // nada a publicar (redes já publicadas numa tentativa anterior, ou post sem redes)
    if (claim.status === "published" && claim.post.mediaUrl) {
      await saveThumbIfMissing(claim.post.id, await thumbFromUrl(claim.post.mediaUrl));
    }
    return internalJson({
      ok: claim.status === "published",
      results: claim.done.map((platform) => ({ platform, ok: true, skipped: true })),
    });
  }

  const { post, pending, done } = claim;
  const deadline = startedAt + PUBLISH_BUDGET_MS;

  const accounts =
    pending.length > 0
      ? await prisma.socialAccount.findMany({
          where: { clientId: post.clientId, status: "active", platform: { in: pending } },
          select: { platform: true, externalId: true, accessTokenEnc: true, dailyPostLimit: true },
        })
      : [];

  const captions = (post.captions as Record<string, string> | null) ?? {};
  const items = (post.mediaItems as MediaItem[] | null) ?? null;

  const results: NetworkResult[] = done.map((platform) => ({ platform, ok: true, skipped: true }));
  // como cada rede pendente terminou — fechado junto com o post em finishAttempt
  const networks: NetworkOutcome[] = [];
  // a rede adiada mais tarde define quando o post volta à fila
  const deferral: { until: Date | null; reason: string } = { until: null, reason: "" };

  const defer = (platform: string, until: Date, reason: string) => {
    networks.push({ platform, result: "deferred" });
    results.push({ platform, ok: false, deferred: true, error: reason });
    console.warn("[publish] adiado por limite", post.id, platform, reason);
    if (!deferral.until || until > deferral.until) {
      deferral.until = until;
      deferral.reason = reason;
    }
  };

  for (const platform of pending) {
    const acc = accounts.find((a) => a.platform === platform);
    if (!acc) {
      networks.push({ platform, result: "failed", error: "conta não conectada" });
      results.push({ platform, ok: false, error: "conta não conectada" });
      continue;
    }
    let token: string | null = null;
    try {
      // 1) limite diário da conta (daily_post_limit), contado no banco
      const now = new Date();
      const recent = await countRecentPublications({ platform, externalId: acc.externalId, excludePostId: post.id, now });
      if (recent.count >= acc.dailyPostLimit) {
        const until = nextSlotAfterDailyLimit(recent.oldest, now);
        defer(platform, until, limitReason(platform, "daily", until));
        continue;
      }

      token = decryptToken(acc.accessTokenEnc);

      // 2) Instagram: cota de publicação da própria Meta (content_publishing_limit)
      if (platform === "instagram") {
        const quota = await getInstagramPublishingQuota(acc.externalId, token, { deadline });
        if (quota && quota.usage >= quota.total) {
          const until = nextSlotAfterGraphQuota(now);
          defer(platform, until, limitReason(platform, "graph", until));
          continue;
        }
      }

      const caption = captions[platform] ?? post.caption ?? "";
      const externalId = await publishToPlatform(
        platform,
        acc.externalId,
        token,
        { format: post.format, mediaUrl: post.mediaUrl, mediaItems: items, caption },
        { deadline }
      );
      // sucesso gravado na hora: se a função morrer depois, o retry não republica esta rede
      await recordNetworkSuccess(post.id, platform, externalId);
      networks.push({ platform, result: "success" });
      results.push({ platform, ok: true, externalId });
    } catch (e) {
      const msg = safeError(e, token);
      console.error("[publish] falha", post.id, platform, msg);
      networks.push({ platform, result: "failed", error: msg });
      results.push({ platform, ok: false, error: msg });
    }
  }

  const failed = results.filter((r) => !r.ok && !r.deferred);
  const deferred = results.some((r) => r.deferred);
  const allOk = results.length > 0 && results.every((r) => r.ok);

  let outcome: PostOutcome;
  if (allOk) {
    // mídia fica no R2 por 30 dias (WF-06 limpa); grava a miniatura-lembrança
    const thumb = post.mediaUrl ? await thumbFromUrl(post.mediaUrl) : null;
    outcome = { kind: "published", mediaThumb: thumb };
  } else if (failed.length > 0) {
    outcome = { kind: "failed", error: failed[0].error ?? "falha" };
  } else {
    outcome = { kind: "deferred", until: deferral.until ?? new Date(Date.now() + 3_600_000), reason: deferral.reason };
  }
  await finishAttempt(post.id, networks, outcome);

  return internalJson({
    ok: allOk,
    ...(deferred && outcome.kind === "deferred" ? { deferredUntil: outcome.until.toISOString() } : {}),
    results,
  });
}
