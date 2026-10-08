import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { checkInternalKey, internalJson, readInternalJson } from "@/lib/internal-auth";
import { decryptToken, encryptToken } from "@/lib/crypto";
import { exchangeForLongLivedToken, redactSecrets, type ExchangedToken } from "@/lib/meta";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z
  .object({
    /** renova os tokens que vencem nos próximos N dias */
    days: z.number().int().min(1).max(30).default(7),
    /** contas por execução */
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

/**
 * Renova os tokens da Meta que vencem em breve — DENTRO do sistema (OWASP
 * CR-06/CF-10). Chamado pelo WF-02 (n8n) a cada 12 h, que só dispara: nenhum
 * token decifrado sai daqui e o `client_secret` vai no corpo do POST à Meta
 * (lib/meta `exchangeForLongLivedToken`), nunca em URL.
 *
 * Usa META_APP_ID / META_APP_SECRET do ambiente do sistema. Responde SÓ
 * contagens: `{ checked, refreshed, failed, skipped }`.
 */
export async function POST(req: NextRequest) {
  const denied = checkInternalKey(req);
  if (denied) return denied;

  const body = await readInternalJson(req, 1024);
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.value ?? {});
  if (!parsed.success) {
    return internalJson({ error: "Parâmetros inválidos: use { days: 1–30, limit: 1–100 }." }, 400);
  }
  const { days, limit } = parsed.data;

  const now = Date.now();
  const accounts = await prisma.socialAccount.findMany({
    where: {
      status: "active",
      platform: { in: ["instagram", "facebook"] },
      tokenExpiresAt: { not: null, lt: new Date(now + days * 86_400_000) },
    },
    orderBy: { tokenExpiresAt: "asc" },
    take: limit,
    select: { id: true, clientId: true, accessTokenEnc: true },
  });

  const counts = { checked: accounts.length, refreshed: 0, failed: 0, skipped: 0 };
  if (accounts.length === 0) return internalJson(counts);

  const appId = process.env.META_APP_ID?.trim() ?? "";
  const appSecret = process.env.META_APP_SECRET?.trim() ?? "";
  if (!appId || !appSecret) {
    console.error("[tokens/refresh] META_APP_ID/META_APP_SECRET ausentes; nada renovado");
    return internalJson(
      {
        error: "A renovação de tokens da Meta não está configurada no servidor. Avise o administrador do sistema.",
        ...counts,
        skipped: counts.checked,
      },
      503
    );
  }

  // a mesma Página costuma ter o MESMO token no IG e no FB: troca uma vez só
  const exchanges = new Map<string, Promise<ExchangedToken>>();

  for (const acc of accounts) {
    let current: string;
    try {
      current = decryptToken(acc.accessTokenEnc);
    } catch {
      counts.failed++;
      console.error("[tokens/refresh] token ilegível na conta", acc.id);
      continue;
    }
    try {
      let job = exchanges.get(current);
      if (!job) {
        job = exchangeForLongLivedToken(current, appId, appSecret);
        exchanges.set(current, job);
      }
      const fresh = await job;
      // só grava se ninguém trocou o token da conta no meio (reconexão manual)
      const { count } = await prisma.socialAccount.updateMany({
        where: { id: acc.id, accessTokenEnc: acc.accessTokenEnc },
        data: {
          accessTokenEnc: encryptToken(fresh.accessToken),
          tokenExpiresAt: fresh.expiresIn ? new Date(Date.now() + fresh.expiresIn * 1000) : null,
        },
      });
      if (count === 1) counts.refreshed++;
      else counts.skipped++;
    } catch (e) {
      counts.failed++;
      const msg = e instanceof Error ? e.message : "erro";
      console.error("[tokens/refresh] falha ao renovar a conta", acc.id, redactSecrets(msg, current, appSecret));
    }
  }

  await audit(
    { action: "tokens.refresh", targetType: "social_account", meta: { ...counts, days, source: "n8n" } },
    { actor: { id: null, email: null } }
  );

  return internalJson(counts);
}
