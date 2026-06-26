import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { encryptToken, decryptToken } from "@/lib/crypto";
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

/** Revela as credenciais decifradas (apenas staff autenticado). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id },
    select: { credentialsEnc: true },
  });
  if (!client) return Response.json({ error: "Cliente não encontrado" }, { status: 404 });

  let credentials: Credential[] = [];
  if (client.credentialsEnc) {
    try {
      credentials = JSON.parse(decryptToken(client.credentialsEnc));
    } catch {
      return Response.json({ error: "Falha ao decifrar credenciais" }, { status: 500 });
    }
  }
  return Response.json({ credentials });
}

/** Grava (cifrado) o conjunto de credenciais do cliente. */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // descarta entradas totalmente vazias
  const clean = parsed.data.credentials.filter(
    (c) => c.network.trim() && (c.login.trim() || c.password.trim())
  );
  const credentialsEnc = clean.length ? encryptToken(JSON.stringify(clean)) : null;

  try {
    await prisma.client.update({ where: { id }, data: { credentialsEnc } });
    return Response.json({ ok: true, count: clean.length });
  } catch {
    return Response.json({ error: "Cliente não encontrado" }, { status: 404 });
  }
}
