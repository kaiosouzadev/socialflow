import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";
import { encryptToken } from "@/lib/crypto";
import { validateToken } from "@/lib/meta";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { toUserMessage } from "@/lib/user-facing-error";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1).optional(),
  token: z.string().min(20),
});

// Recusa da Meta → texto pt-BR (o prefixo "Token recusado pela Meta" é o que a tela /meta
// usa para mostrar o erro no campo do token). O texto em inglês da Graph fica só no log.
const TOKEN_INVALID =
  "Token recusado pela Meta: o token está incompleto, expirou ou foi revogado. Gere um novo token do usuário do sistema no Gerenciador de Negócios da Meta e tente de novo.";
const TOKEN_NO_PERMISSION =
  "Token recusado pela Meta: o token não tem permissão para acessar o Business Manager. No Gerenciador de Negócios da Meta, dê ao usuário do sistema acesso às Páginas e às contas do Instagram, gere um novo token e tente de novo.";
const TOKEN_REJECTED =
  "Token recusado pela Meta: não foi possível validar o token. Confira se você copiou o token inteiro do usuário do sistema e tente de novo.";

// mensagens da Graph API (lib/meta repassa só o `message` do erro) — mesmos sinais da rota de ativos
const TOKEN_ERROR =
  /Error validating access token|Invalid OAuth access token|Malformed access token|Cannot parse access token|session has expired|\(#190\)|\bHTTP 401\b/i;
const PERMISSION_ERROR = /\(#(10|2\d\d)\)|permiss|\bHTTP 403\b/i;

/** Falha ao validar o token na Graph → status + texto pt-BR. */
function validateTokenError(e: unknown): { status: number; error: string } {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (TOKEN_ERROR.test(raw)) return { status: 400, error: TOKEN_INVALID };
  if (PERMISSION_ERROR.test(raw)) return { status: 400, error: TOKEN_NO_PERMISSION };
  // demora e falha de rede não são recusa do token: texto próprio do toUserMessage
  const known = toUserMessage(e, "");
  if (known && known !== raw.trim()) return { status: 502, error: known };
  return { status: 400, error: TOKEN_REJECTED };
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const connections = await prisma.metaConnection.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      businessId: true,
      status: true,
      createdAt: true,
      _count: { select: { socialAccounts: true } },
    },
  });
  return Response.json(connections);
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const limited = enforceRateLimit(`meta-conn:${clientIp(req)}`, 10, 60_000);
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // valida o token na Graph API antes de salvar
  let me: { id: string; name: string };
  try {
    me = await validateToken(parsed.data.token);
  } catch (e) {
    console.error("[meta/connections] falha ao validar o token na Meta", e);
    const { status, error } = validateTokenError(e);
    return Response.json({ error }, { status });
  }

  try {
    const conn = await prisma.metaConnection.create({
      data: {
        name: parsed.data.name?.trim() || me.name,
        businessId: me.id,
        accessTokenEnc: encryptToken(parsed.data.token),
        status: "active",
      },
      select: { id: true, name: true, businessId: true, status: true },
    });
    return Response.json(conn, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      throw e;
    }
    throw e;
  }
}
