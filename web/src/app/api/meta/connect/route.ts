import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ADMIN_ONLY, requireAdminFor, sessionActor } from "@/lib/permissions";
import { uuidString } from "@/lib/validators";
import { decryptToken, encryptToken } from "@/lib/crypto";
import { getAsset } from "@/lib/meta";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  clientId: uuidString,
  connectionId: uuidString,
  pageId: z.string().min(1),
  connectFacebook: z.boolean().default(true),
  connectInstagram: z.boolean().default(true),
});

/**
 * Conecta uma Página (FB e/ou IG) do Meta a um cliente, criando social_accounts.
 * Só admin, com registro `client.meta_link` (AC-07): ligar a Página errada faz os posts de um
 * cliente saírem no perfil de outro.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdminFor(ADMIN_ONLY.metaLink);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { clientId, connectionId, pageId, connectFacebook, connectInstagram } = parsed.data;

  const [client, conn] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true } }),
    prisma.metaConnection.findUnique({ where: { id: connectionId }, select: { accessTokenEnc: true } }),
  ]);
  if (!client) return Response.json({ error: "Cliente não encontrado" }, { status: 404 });
  if (!conn) return Response.json({ error: "Conexão não encontrada" }, { status: 404 });

  let asset;
  try {
    asset = await getAsset(decryptToken(conn.accessTokenEnc), pageId);
  } catch (e) {
    // texto da Graph só no log (N-14); a tela recebe uma frase pt-BR
    console.error("[meta/connect] falha ao consultar a Página na Meta", e instanceof Error ? e.message : e);
    return Response.json(
      { error: "Não foi possível consultar a Página na Meta agora. Tente de novo em instantes." },
      { status: 502 }
    );
  }
  if (!asset) return Response.json({ error: "Página não encontrada na conexão" }, { status: 404 });

  const tokenEnc = encryptToken(asset.pageAccessToken);
  const connected: string[] = [];

  async function upsert(platform: string, externalId: string) {
    const existing = await prisma.socialAccount.findFirst({
      where: { clientId, platform, externalId },
      select: { id: true },
    });
    if (existing) {
      await prisma.socialAccount.update({
        where: { id: existing.id },
        data: { accessTokenEnc: tokenEnc, status: "active", metaConnectionId: connectionId },
      });
    } else {
      await prisma.socialAccount.create({
        data: {
          clientId,
          platform,
          externalId,
          accessTokenEnc: tokenEnc,
          metaConnectionId: connectionId,
          dailyPostLimit: platform === "instagram" ? 25 : 50,
        },
      });
    }
    connected.push(platform);
  }

  if (connectFacebook) await upsert("facebook", asset.pageId);
  if (connectInstagram && asset.instagramId) await upsert("instagram", asset.instagramId);

  if (connected.length === 0) {
    return Response.json(
      { error: "Nada conectado (IG não vinculado a esta Página?)" },
      { status: 400 }
    );
  }

  const actor = await sessionActor();
  await audit(
    {
      action: "client.meta_link",
      targetType: "client",
      targetId: clientId,
      clientId,
      // ids e nomes públicos da Página; nunca o token
      meta: {
        clientName: client.name,
        connectionId,
        pageId: asset.pageId,
        pageName: asset.pageName,
        instagramId: connectInstagram ? asset.instagramId : null,
        connected,
      },
    },
    { req, ...(actor ? { actor: { id: actor.id, email: actor.email } } : {}) }
  );
  return Response.json({ ok: true, connected, page: asset.pageName });
}
