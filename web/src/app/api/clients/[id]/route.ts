import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { APPROVAL_EMAIL_TAKEN, normalizeEmail, normalizeExtraEmails } from "@/lib/client-emails";
import { CLIENT_STATUSES, SEGMENTS } from "@/lib/status-meta";
import { uuidString } from "@/lib/validators";
import { z } from "zod";

export const dynamic = "force-dynamic";

const briefingSchema = z
  .object({
    products: z.string().optional(),
    themes: z.string().optional(),
    hashtags: z.string().optional(),
    partnerships: z.string().optional(),
    observations: z.string().optional(),
    restrictions: z.string().optional(),
    mandatoryArtText: z.string().optional(),
    designNotes: z.string().optional(),
    plan: z.string().optional(),
    responsibleTech: z.string().optional(),
    // questionário completo (onboarding da redação)
    audience: z.string().optional(),
    competitors: z.string().optional(),
    differential: z.string().optional(),
    references: z.string().optional(),
    anniversary: z.string().optional(),
    linkedinUrl: z.string().optional(),
    linkedinRepost: z.string().optional(),
    positioning: z.string().optional(),
  })
  .optional();

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  plan: z.enum(["sem_aprovacao", "aprovacao_cliente"]).optional(),
  toneOfVoice: z.string().optional(),
  // ID da pasta do cliente no Drive (vazio = busca pelo nome)
  driveFolderId: z.string().optional(),
  // onboarding
  tradeName: z.string().optional(),
  website: z.string().optional(),
  city: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  facebookUrl: z.string().optional(),
  instagramUrl: z.string().optional(),
  briefing: briefingSchema,
  // marca (geração de arte) — "" limpa o campo
  logoUrl: z.string().url().or(z.literal("")).optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "cor em hex, ex: #7c5cff").or(z.literal("")).optional(),
  tier: z.enum(["basica", "completa"]).optional(),
  // exibir dados de contato na arte gerada?
  showContacts: z.boolean().optional(),
  // a agência agenda e publica? true → false devolve os posts da fila para draft
  agencyPublishes: z.boolean({ error: "Informe se a agência agenda e publica (sim ou não)." }).optional(),
  // e-mails adicionais — substitui a lista inteira; normalizados por normalizeExtraEmails (máx. 10)
  extraEmails: z
    .array(z.string({ error: "Cada e-mail adicional deve ser um texto." }), {
      error: "Envie os e-mails adicionais como uma lista.",
    })
    .max(100, "Lista de e-mails adicionais longa demais.")
    .optional(),
  status: z.enum(CLIENT_STATUSES, { error: "Status inválido: use ativo, pausado ou encerrado." }).optional(),
  segment: z.enum(SEGMENTS, { error: "Segmento inválido: use CORR, CARE ou COLETIVO." }).nullable().optional(),
  // redatora responsável (users.id); null limpa
  responsibleUserId: uuidString.nullable().optional(),
  // designer responsável (users.id); null limpa
  designerUserId: uuidString.nullable().optional(),
});

// posts que "Sim → Não" devolve para draft (publishing é barrado no publicador)
const REVERT_ON_NO_PUBLISH = ["scheduled", "failed"];

// campos texto onde "" deve virar null (limpar)
const NULLABLE_TEXT = [
  "toneOfVoice",
  "driveFolderId",
  "tradeName",
  "website",
  "city",
  "phone",
  "whatsapp",
  "facebookUrl",
  "instagramUrl",
  "logoUrl",
  "brandColor",
] as const;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  if (!uuidString.safeParse(id).success) {
    return Response.json({ error: "ID inválido" }, { status: 400 });
  }
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      // never expose the encrypted token to the browser
      socialAccounts: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          platform: true,
          externalId: true,
          status: true,
          dailyPostLimit: true,
          tokenExpiresAt: true,
        },
      },
      _count: { select: { posts: true } },
    },
  });

  if (!client) return Response.json({ error: "Not found" }, { status: 404 });

  // para a confirmação de "publica? → Não": quantos voltariam a draft e quantos estão publicando agora
  const [queuedPostsCount, publishingNow] = await Promise.all([
    prisma.post.count({ where: { clientId: id, status: { in: REVERT_ON_NO_PUBLISH } } }),
    prisma.post.count({ where: { clientId: id, status: "publishing" } }),
  ]);

  // nunca expor o blob cifrado de credenciais ao browser
  const { credentialsEnc: _c, ...safe } = client;
  void _c;
  return Response.json({ ...safe, queuedPostsCount, publishingNow });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  if (!uuidString.safeParse(id).success) {
    return Response.json({ error: "ID inválido" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const current = await prisma.client.findUnique({
    where: { id },
    select: { email: true, extraEmails: true, status: true },
  });
  if (!current) return Response.json({ error: "Cliente não encontrado" }, { status: 404 });

  // "" nos campos texto opcionais = limpar (null)
  const data: Record<string, unknown> = { ...parsed.data };
  for (const k of NULLABLE_TEXT) {
    if (typeof data[k] === "string") {
      data[k] = (data[k] as string).trim() || null;
    }
  }

  const { extraEmails, email, status, responsibleUserId, designerUserId, agencyPublishes } = parsed.data;
  if (extraEmails !== undefined) {
    const normalized = normalizeExtraEmails(email ?? current.email, extraEmails);
    if (!normalized.ok) {
      return Response.json({ error: normalized.error, field: "extraEmails" }, { status: 400 });
    }
    data.extraEmails = normalized.emails;
  } else if (email !== undefined) {
    // o novo principal não pode continuar repetido entre os adicionais
    const main = normalizeEmail(email);
    if (current.extraEmails.some((e) => normalizeEmail(e) === main)) {
      data.extraEmails = current.extraEmails.filter((e) => normalizeEmail(e) !== main);
    }
  }

  if (status !== undefined && status !== current.status) data.statusChangedAt = new Date();

  if (responsibleUserId && !(await prisma.user.findUnique({ where: { id: responsibleUserId }, select: { id: true } }))) {
    return Response.json({ error: "Usuário responsável não encontrado.", field: "responsibleUserId" }, { status: 400 });
  }
  if (designerUserId && !(await prisma.user.findUnique({ where: { id: designerUserId }, select: { id: true } }))) {
    return Response.json({ error: "Designer não encontrado.", field: "designerUserId" }, { status: 400 });
  }

  try {
    // "publica? → Não": cliente e posts da fila (scheduled/failed → draft) na
    // mesma transação. Idempotente: para quem já era "Não" não sobra nada a reverter.
    const { client, revertedToDraft } = await prisma.$transaction(async (tx) => {
      const client = await tx.client.update({ where: { id }, data });
      if (agencyPublishes !== false) return { client, revertedToDraft: 0 };
      const reverted = await tx.post.updateMany({
        where: { clientId: id, status: { in: REVERT_ON_NO_PUBLISH } },
        data: { status: "draft" },
      });
      return { client, revertedToDraft: reverted.count };
    });
    // não devolve credenciais cifradas
    const { credentialsEnc: _omit, ...safe } = client;
    void _omit;
    return Response.json({ ...safe, revertedToDraft });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2025") return Response.json({ error: "Cliente não encontrado" }, { status: 404 });
      // uq_clients_email_aprovacao: e-mail de outro cliente COM aprovação (inclui trocar o plano
      // sem → com aprovação). A transação é desfeita: nada é gravado.
      if (e.code === "P2002") {
        return Response.json({ error: APPROVAL_EMAIL_TAKEN, field: "email" }, { status: 409 });
      }
    }
    throw e;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  try {
    await prisma.client.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return Response.json({ error: "Cliente não encontrado" }, { status: 404 });
    }
    throw e;
  }
}
