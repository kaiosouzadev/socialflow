import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { audit } from "@/lib/audit";
import { cleanCredentials, decryptCredentials, encryptCredentials } from "@/lib/client-credentials";
import { credentialChanges, REVEAL_LIMIT_PER_HOUR, revealLimitMessage } from "@/lib/credential-audit";
import { NO_STORE, sessionActor } from "@/lib/permissions";
import { clientIp } from "@/lib/rate-limit";
import { uuidString } from "@/lib/validators";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  credentials: z.array(
    z.object({
      network: z.string().min(1),
      login: z.string().default(""),
      password: z.string().default(""),
      note: z.string().optional(),
    })
  ),
});

type Credential = z.infer<typeof schema>["credentials"][number];

const HOUR = 60 * 60 * 1000;
const UNAVAILABLE = "Não foi possível revelar as credenciais agora. Tente de novo em instantes.";
/** Espera da trava/conexão: pedidos simultâneos da mesma pessoa entram em fila, não dão 503. */
const TX_OPTIONS = { maxWait: 15_000, timeout: 15_000 } as const;

/** Cofre ilegível (chave trocada/dado corrompido): 500, como antes, e nada é registrado. */
class UnreadableCredentials extends Error {}

type RevealOutcome =
  | { kind: "revealed"; credentials: Credential[] }
  | { kind: "blocked"; retryAfter: number };

/**
 * Revela as credenciais decifradas. Decisão "Staff, com registro" (AC-03/CR-04): a equipe continua
 * vendo, mas cada revelação vai para a trilha de auditoria (quem, quando, qual cliente e quais
 * redes — nunca a senha) e há um limite por pessoa (REVEAL_LIMIT_PER_HOUR por hora; acima → 429).
 *
 * O contador é a própria trilha (vale entre instâncias do servidor). Contar e gravar acontecem numa
 * transação com trava por pessoa (`pg_advisory_xact_lock`): pedidos simultâneos da mesma pessoa são
 * atendidos um de cada vez, então o limite é exato (gate G1: 45 simultâneos davam 34×200) e o aviso
 * `credential.reveal_blocked` sai uma única vez por janela. A senha só é devolvida depois que o
 * registro foi gravado (commit); sem trilha → 503 e nada sai (falha fechada).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  if (!uuidString.safeParse(id).success) {
    return Response.json({ error: "ID inválido" }, { status: 400, headers: NO_STORE });
  }
  const actor = await sessionActor();
  if (!actor || (!actor.id && !actor.email)) {
    return Response.json({ error: "Sua sessão expirou. Entre de novo." }, { status: 401, headers: NO_STORE });
  }
  const who = actor.id ? { actorId: actor.id } : { actorEmail: actor.email };
  const lockKey = `credential-reveal:${(actor.id ?? `email:${actor.email}`).toLowerCase()}`;
  const ip = clientIp(req);

  const client = await prisma.client.findUnique({
    where: { id },
    select: { name: true, credentialsEnc: true },
  });
  if (!client) return Response.json({ error: "Cliente não encontrado" }, { status: 404, headers: NO_STORE });

  let outcome: RevealOutcome;
  try {
    outcome = await prisma.$transaction(async (tx) => {
      // uma revelação por vez para esta pessoa (a trava cai no fim da transação)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}::text))`;

      const since = new Date(Date.now() - HOUR);
      const used = await tx.auditLog.count({ where: { action: "credential.reveal", at: { gte: since }, ...who } });
      if (used >= REVEAL_LIMIT_PER_HOUR) {
        const oldest = await tx.auditLog.findFirst({
          where: { action: "credential.reveal", at: { gte: since }, ...who },
          orderBy: { at: "asc" },
          select: { at: true },
        });
        const retryAfter = Math.max(60, Math.ceil(((oldest?.at.getTime() ?? Date.now()) + HOUR - Date.now()) / 1000));
        // um aviso por janela na trilha (sem encher a tabela se a pessoa insistir)
        const flagged = await tx.auditLog.count({ where: { action: "credential.reveal_blocked", at: { gte: since }, ...who } });
        if (flagged === 0) {
          await tx.auditLog.create({
            data: {
              actorId: actor.id,
              actorEmail: actor.email,
              action: "credential.reveal_blocked",
              targetType: "client",
              targetId: id,
              clientId: id,
              meta: { limit: REVEAL_LIMIT_PER_HOUR },
              ip,
            },
          });
        }
        return { kind: "blocked", retryAfter };
      }

      let credentials: Credential[];
      try {
        credentials = decryptCredentials(client.credentialsEnc);
      } catch {
        throw new UnreadableCredentials();
      }
      // quem viu, qual cliente e quais redes — nunca login nem senha
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          actorEmail: actor.email,
          action: "credential.reveal",
          targetType: "client",
          targetId: id,
          clientId: id,
          meta: { clientName: client.name, networks: credentials.map((c) => c.network), count: credentials.length },
          ip,
        },
      });
      return { kind: "revealed", credentials };
    }, TX_OPTIONS);
  } catch (e) {
    if (e instanceof UnreadableCredentials) {
      return Response.json({ error: "Falha ao decifrar credenciais" }, { status: 500, headers: NO_STORE });
    }
    // sem registro gravado (tabela ausente, usuária excluída, banco fora) → a senha não sai
    console.error("[credentials] falha ao registrar a revelação", (e as { code?: unknown } | null)?.code ?? "erro");
    return Response.json({ error: UNAVAILABLE }, { status: 503, headers: NO_STORE });
  }

  if (outcome.kind === "blocked") {
    return Response.json(
      { error: revealLimitMessage(outcome.retryAfter) },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(outcome.retryAfter) } },
    );
  }
  return Response.json({ credentials: outcome.credentials }, { headers: NO_STORE });
}

/** Grava (cifrado) o conjunto de credenciais do cliente e registra quais redes mudaram (sem valores). */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  if (!uuidString.safeParse(id).success) {
    return Response.json({ error: "ID inválido" }, { status: 400, headers: NO_STORE });
  }
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400, headers: NO_STORE });
  }

  // descarta entradas totalmente vazias (mesmo formato do importador: lib/client-credentials)
  const clean = cleanCredentials(parsed.data.credentials);
  const credentialsEnc = encryptCredentials(clean);

  const current = await prisma.client.findUnique({ where: { id }, select: { name: true, credentialsEnc: true } });
  if (!current) return Response.json({ error: "Cliente não encontrado" }, { status: 404, headers: NO_STORE });

  try {
    await prisma.client.update({ where: { id }, data: { credentialsEnc } });
  } catch {
    return Response.json({ error: "Cliente não encontrado" }, { status: 404, headers: NO_STORE });
  }

  // antes × depois só para saber QUAIS redes mudaram (o conteúdo nunca vai para o registro)
  let before: Credential[] | null = null;
  try {
    before = decryptCredentials(current.credentialsEnc);
  } catch {
    before = null; // cofre antigo ilegível: registra só as redes gravadas agora
  }
  const actor = await sessionActor();
  await audit(
    {
      action: "credential.update",
      targetType: "client",
      targetId: id,
      clientId: id,
      meta: { clientName: current.name, ...credentialChanges(before, clean) },
    },
    { req, ...(actor ? { actor: { id: actor.id, email: actor.email } } : {}) },
  );
  return Response.json({ ok: true, count: clean.length }, { headers: NO_STORE });
}
