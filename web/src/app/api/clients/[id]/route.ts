import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
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
});

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
  // nunca expor o blob cifrado de credenciais ao browser
  const { credentialsEnc: _c, ...safe } = client;
  void _c;
  return Response.json(safe);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // "" nos campos texto opcionais = limpar (null)
  const data: Record<string, unknown> = { ...parsed.data };
  for (const k of NULLABLE_TEXT) {
    if (typeof data[k] === "string") {
      data[k] = (data[k] as string).trim() || null;
    }
  }

  try {
    const client = await prisma.client.update({ where: { id }, data });
    // não devolve credenciais cifradas
    const { credentialsEnc: _omit, ...safe } = client;
    void _omit;
    return Response.json(safe);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2025") return Response.json({ error: "Cliente não encontrado" }, { status: 404 });
      if (e.code === "P2002") return Response.json({ error: "Já existe um cliente com este email" }, { status: 409 });
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
