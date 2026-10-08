/**
 * Fila de publicação idempotente (OWASP CF-06/CF-11). Primitivas de banco do
 * publicador (`/api/internal/publish/[postId]`, chamado pelo WF-01):
 *
 * 1. **Tomada atômica** (`claimPost`): numa transação, trava a linha do post
 *    (`SELECT … FOR UPDATE`) e só segue se ele estiver na fila (`scheduled`)
 *    e sem tentativa em andamento. Duas chamadas simultâneas para o mesmo post
 *    → a segunda espera a trava, vê a tentativa da primeira e recebe 409.
 *    Compatível com o WF-01 antigo, que marcava `publishing` antes de chamar:
 *    `publishing` SEM tentativa viva também pode ser tomado.
 * 2. **Carimbo da tentativa** (sem coluna nova): ao tomar o post, cada rede
 *    pendente ganha uma linha em `publications` com `status='publishing'` e
 *    `published_at` = início da tentativa. É esse carimbo — e não
 *    `scheduled_at` — que o WF-03 usa para destravar post preso.
 * 3. **A tentativa fica viva até o fim** (gate G1): as linhas `publishing` só
 *    saem em `finishAttempt`, que fecha as redes que falharam/ficaram para
 *    depois E o status do post numa MESMA transação, sob a mesma trava da
 *    tomada. Não existe instante em que o post está `publishing` sem tentativa
 *    viva enquanto a chamada ainda trabalha — então outra chamada nunca o toma
 *    no meio. O sucesso de cada rede é gravado na hora (`recordNetworkSuccess`,
 *    linha própria `success`), para não se perder se a função morrer.
 * 4. **Uma vez por rede**: rede que já tem `publications.success` para o post
 *    não é publicada de novo — uma nova tentativa depois de falha parcial só
 *    repete as redes que falharam.
 * 5. **Limite por conta** (`countRecentPublications`): publicações (feitas ou
 *    em andamento) das últimas 24 h da conta social, para comparar com
 *    `daily_post_limit`. Excedido → a rede fica para depois e o post volta
 *    para a fila mais tarde, sem contar como falha.
 */
import { prisma } from "@/lib/prisma";
import { canEnterQueue, PUBLISH_BLOCKED_LAST_ERROR } from "@/lib/publish-policy";

/**
 * Tentativa com carimbo mais novo que isto está viva. Maior que o maxDuration
 * da rota de publicação (300 s): passado esse tempo a função já foi encerrada.
 */
export const ATTEMPT_TTL_MINUTES = 10;

/** Igual ao WF-03: `publishing` sem tentativa viva há 20+ min está travado. */
export const PUBLISH_STUCK_MINUTES = 20;

/** Erro gravado na tentativa que morreu no meio (função encerrada, deploy, queda). */
export const INTERRUPTED_ERROR = "Publicação interrompida antes de terminar; o sistema tenta de novo.";

/** `last_error` de post sem nenhuma rede de destino. */
export const NO_TARGETS_ERROR = "O post não tem redes de destino.";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export type ClaimedPost = {
  id: string;
  clientId: string;
  format: string;
  caption: string | null;
  captions: unknown;
  mediaUrl: string | null;
  mediaItems: unknown;
  targets: string[];
};

export type ClaimResult =
  /** post é deste chamador; `pending` = redes a publicar (≥ 1), `done` = já publicadas antes */
  | { kind: "claimed"; post: ClaimedPost; pending: string[]; done: string[]; startedAt: Date }
  /**
   * nada a publicar: fechado na própria tomada (todas as redes já publicadas →
   * `published`; post sem redes → `failed`)
   */
  | { kind: "finished"; post: ClaimedPost; done: string[]; status: "published" | "failed" }
  | { kind: "not_found" }
  /** cliente só produção: o post voltou para rascunho */
  | { kind: "blocked" }
  /** outra chamada está publicando este post agora */
  | { kind: "busy" }
  /** fora da fila (rascunho, publicado, falhou…) */
  | { kind: "not_queued"; status: string };

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Trava a linha do post até o fim da transação; devolve o status atual (ou null). */
async function lockPost(tx: Tx, postId: string): Promise<string | null> {
  const locked = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM posts WHERE id = ${postId}::uuid FOR UPDATE`;
  return locked.length > 0 ? locked[0].status : null;
}

/**
 * Toma o post para publicar — atômico (trava de linha + checagem de status e
 * de tentativa viva na mesma transação). Não chama rede nenhuma.
 */
export async function claimPost(postId: string, now: Date = new Date()): Promise<ClaimResult> {
  return prisma.$transaction(async (tx): Promise<ClaimResult> => {
    const status = await lockPost(tx, postId);
    if (status === null) return { kind: "not_found" };
    if (status !== "scheduled" && status !== "publishing") return { kind: "not_queued", status };

    const alive = await tx.publication.count({
      where: { postId, status: "publishing", publishedAt: { gt: new Date(now.getTime() - ATTEMPT_TTL_MINUTES * MINUTE) } },
    });
    if (alive > 0) return { kind: "busy" };

    const post = await tx.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        clientId: true,
        format: true,
        caption: true,
        captions: true,
        mediaUrl: true,
        mediaItems: true,
        targets: true,
        client: { select: { agencyPublishes: true } },
      },
    });
    if (!post) return { kind: "not_found" };

    // cliente só produção: volta para rascunho (nunca failed — o WF-03 não reagenda esse cliente)
    if (!canEnterQueue(post.client)) {
      await tx.post.update({ where: { id: postId }, data: { status: "draft", lastError: PUBLISH_BLOCKED_LAST_ERROR } });
      return { kind: "blocked" };
    }

    const succeeded = await tx.publication.findMany({
      where: { postId, status: "success" },
      select: { platform: true },
    });
    const published = new Set(succeeded.map((p) => p.platform));

    // tentativa anterior que morreu no meio: rede que chegou a publicar só perde a
    // linha da tentativa (o sucesso já está gravado); as outras viram falha
    if (published.size > 0) {
      await tx.publication.deleteMany({ where: { postId, status: "publishing", platform: { in: [...published] } } });
    }
    await tx.publication.updateMany({
      where: { postId, status: "publishing" },
      data: { status: "failed", error: INTERRUPTED_ERROR, publishedAt: null },
    });

    const targets = [...new Set(post.targets)];
    const pending = targets.filter((t) => !published.has(t));
    const done = targets.filter((t) => published.has(t));
    const claimed: ClaimedPost = {
      id: post.id,
      clientId: post.clientId,
      format: post.format,
      caption: post.caption,
      captions: post.captions,
      mediaUrl: post.mediaUrl,
      mediaItems: post.mediaItems,
      targets: post.targets,
    };

    // nada a publicar: fecha aqui mesmo, sob a trava (sem janela para outra chamada)
    if (pending.length === 0) {
      if (targets.length === 0) {
        await tx.post.update({
          where: { id: postId },
          data: { status: "failed", retryCount: { increment: 1 }, lastError: NO_TARGETS_ERROR },
        });
        return { kind: "finished", post: claimed, done, status: "failed" };
      }
      await tx.post.update({ where: { id: postId }, data: { status: "published", lastError: null } });
      return { kind: "finished", post: claimed, done, status: "published" };
    }

    await tx.post.update({ where: { id: postId }, data: { status: "publishing" } });
    await tx.publication.createMany({
      data: pending.map((platform) => ({ postId, platform, status: "publishing", publishedAt: now })),
    });
    return { kind: "claimed", post: claimed, pending, done, startedAt: now };
  });
}

/**
 * A rede publicou: grava o sucesso NA HORA, numa linha própria (a linha
 * `publishing` da tentativa continua viva até `finishAttempt`).
 */
export async function recordNetworkSuccess(postId: string, platform: string, externalPostId: string, at: Date = new Date()) {
  await prisma.publication.create({
    data: { postId, platform, status: "success", externalPostId: externalPostId || null, publishedAt: at, error: null },
  });
}

/** Resultado de cada rede pendente da tentativa. */
export type NetworkOutcome =
  | { platform: string; result: "success" }
  | { platform: string; result: "failed"; error: string }
  | { platform: string; result: "deferred" };

export type PostOutcome =
  | { kind: "published"; mediaThumb?: string | null }
  | { kind: "failed"; error: string }
  | { kind: "deferred"; until: Date; reason: string };

/**
 * Fecha a tentativa: numa ÚNICA transação, sob a trava da linha do post, tira
 * as linhas `publishing` (sucesso/adiada: some; falha: vira `failed` com o
 * erro já sem segredos) e grava o status final do post. Só mexe no post se ele
 * ainda estiver em `publishing` (uma ação manual no meio não é sobrescrita).
 * Adiado por limite volta para `scheduled` sem somar tentativa (não é falha).
 */
export async function finishAttempt(postId: string, networks: NetworkOutcome[], outcome: PostOutcome): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await lockPost(tx, postId);

    for (const n of networks) {
      const attempt = { postId, platform: n.platform, status: "publishing" };
      if (n.result === "failed") {
        const data = { status: "failed", error: n.error.slice(0, 500), publishedAt: null };
        const { count } = await tx.publication.updateMany({ where: attempt, data });
        if (count === 0) await tx.publication.create({ data: { postId, platform: n.platform, ...data } });
      } else {
        await tx.publication.deleteMany({ where: attempt });
      }
    }

    const data =
      outcome.kind === "published"
        ? { status: "published", lastError: null, ...(outcome.mediaThumb ? { mediaThumb: outcome.mediaThumb } : {}) }
        : outcome.kind === "failed"
          ? { status: "failed", retryCount: { increment: 1 }, lastError: outcome.error.slice(0, 500) }
          : { status: "scheduled", scheduledAt: outcome.until, lastError: outcome.reason.slice(0, 500) };
    const { count } = await tx.post.updateMany({ where: { id: postId, status: "publishing" }, data });
    return count === 1;
  });
}

/** Miniatura-lembrança de post fechado na própria tomada (só se ainda não tiver). */
export async function saveThumbIfMissing(postId: string, mediaThumb: string | null) {
  if (!mediaThumb) return;
  await prisma.post.updateMany({ where: { id: postId, mediaThumb: null }, data: { mediaThumb } });
}

/**
 * Publicações da conta social (rede + id externo, em qualquer cliente que use
 * a mesma conta) nas 24 h antes de `now`: as feitas e as em andamento de
 * OUTROS posts. `oldest` = a mais antiga da janela (quando sai dela, abre vaga).
 */
export async function countRecentPublications(args: {
  platform: string;
  externalId: string;
  excludePostId: string;
  now?: Date;
}): Promise<{ count: number; oldest: Date | null }> {
  const now = args.now ?? new Date();
  const r = await prisma.publication.aggregate({
    where: {
      platform: args.platform,
      status: { in: ["success", "publishing"] },
      publishedAt: { gte: new Date(now.getTime() - DAY) },
      postId: { not: args.excludePostId },
      post: { client: { socialAccounts: { some: { platform: args.platform, externalId: args.externalId } } } },
    },
    _count: { _all: true },
    _min: { publishedAt: true },
  });
  return { count: r._count._all, oldest: r._min.publishedAt ?? null };
}

/**
 * Quando tentar de novo depois do limite diário da conta: quando a publicação
 * mais antiga da janela de 24 h sair dela (+1 min), nunca antes de 15 min.
 */
export function nextSlotAfterDailyLimit(oldest: Date | null, now: Date = new Date()): Date {
  const earliest = now.getTime() + 15 * MINUTE;
  const free = oldest ? oldest.getTime() + DAY + MINUTE : now.getTime() + 60 * MINUTE;
  return new Date(Math.max(earliest, free));
}

/** Depois da cota da Meta (content_publishing_limit) esgotada: tenta em 1 h. */
export function nextSlotAfterGraphQuota(now: Date = new Date()): Date {
  return new Date(now.getTime() + 60 * MINUTE);
}

/** Texto do adiamento por limite (vai para `last_error` e para o log). */
export function limitReason(platform: string, kind: "daily" | "graph", until: Date): string {
  const net = platform === "instagram" ? "Instagram" : platform === "facebook" ? "Facebook" : platform;
  const when = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(until);
  const what =
    kind === "daily"
      ? `Limite diário de publicações da conta do ${net} atingido`
      : `A Meta informou que a conta do ${net} atingiu o limite de publicações de 24 h`;
  return `${what}; nova tentativa automática em ${when}.`;
}
