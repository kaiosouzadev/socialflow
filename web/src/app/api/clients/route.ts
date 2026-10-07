import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { scheduleAllBasicMonths } from "@/lib/basic-plan";
import { APPROVAL_EMAIL_TAKEN, normalizeExtraEmails } from "@/lib/client-emails";
import { CLIENT_STATUSES, SEGMENTS } from "@/lib/status-meta";
import { uuidString } from "@/lib/validators";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  plan: z.enum(["sem_aprovacao", "aprovacao_cliente"]).default("sem_aprovacao"),
  tier: z.enum(["basica", "completa"]).default("completa"),
  toneOfVoice: z.string().optional(),
  driveFolderId: z.string().optional(),
  // campos da gestão básica (marca + contatos usados na arte gerada por IA)
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  showContacts: z.boolean().optional(),
  whatsapp: z.string().max(40).optional(),
  phone: z.string().max(40).optional(),
  website: z.string().max(200).optional(),
  instagramUrl: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  // a agência agenda e publica? false = só produção (os posts ficam em draft)
  agencyPublishes: z.boolean({ error: "Informe se a agência agenda e publica (sim ou não)." }).default(true),
  // e-mails adicionais — normalizados por normalizeExtraEmails (máx. 10)
  extraEmails: z
    .array(z.string({ error: "Cada e-mail adicional deve ser um texto." }), {
      error: "Envie os e-mails adicionais como uma lista.",
    })
    .max(100, "Lista de e-mails adicionais longa demais.")
    .optional(),
  status: z.enum(CLIENT_STATUSES, { error: "Status inválido: use ativo, pausado ou encerrado." }).default("ativo"),
  segment: z.enum(SEGMENTS, { error: "Segmento inválido: use CORR, CARE ou COLETIVO." }).nullable().optional(),
  // redatora responsável (users.id)
  responsibleUserId: uuidString.nullable().optional(),
  // designer responsável (users.id) — fila de artes em /design
  designerUserId: uuidString.nullable().optional(),
});

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  const clients = await prisma.client.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { socialAccounts: true, posts: true } },
    },
  });

  return Response.json(clients);
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { extraEmails, responsibleUserId, designerUserId, ...rest } = parsed.data;

  let extras: string[] = [];
  if (extraEmails) {
    const normalized = normalizeExtraEmails(rest.email, extraEmails);
    if (!normalized.ok) {
      return Response.json({ error: normalized.error, field: "extraEmails" }, { status: 400 });
    }
    extras = normalized.emails;
  }

  if (responsibleUserId && !(await prisma.user.findUnique({ where: { id: responsibleUserId }, select: { id: true } }))) {
    return Response.json({ error: "Usuário responsável não encontrado.", field: "responsibleUserId" }, { status: 400 });
  }
  if (designerUserId && !(await prisma.user.findUnique({ where: { id: designerUserId }, select: { id: true } }))) {
    return Response.json({ error: "Designer não encontrado.", field: "designerUserId" }, { status: 400 });
  }

  try {
    const client = await prisma.client.create({
      data: {
        ...rest,
        extraEmails: extras,
        ...(responsibleUserId !== undefined ? { responsibleUserId } : {}),
        ...(designerUserId !== undefined ? { designerUserId } : {}),
        // nasce com status diferente do padrão: a mudança é registrada agora
        ...(rest.status !== "ativo" ? { statusChangedAt: new Date() } : {}),
      },
    });

    // cliente básico: agenda na hora o calendário de artes básicas de todos os
    // meses disponíveis (posts draft sem arte — as imagens ficam pendentes)
    let basicPlan: { scheduled: number } | null = null;
    if (client.tier === "basica") {
      try {
        const r = await scheduleAllBasicMonths(client.id);
        basicPlan = { scheduled: r.scheduled };
      } catch {
        basicPlan = null; // não bloqueia o cadastro; dá pra agendar depois na página do cliente
      }
    }

    return Response.json({ ...client, basicPlan }, { status: 201 });
  } catch (e) {
    // único índice único de clients além do id: uq_clients_email_aprovacao (e-mail repetido entre
    // clientes COM aprovação; sem aprovação pode repetir — migração 2026-10-07)
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return Response.json({ error: APPROVAL_EMAIL_TAKEN, field: "email" }, { status: 409 });
    }
    throw e;
  }
}
