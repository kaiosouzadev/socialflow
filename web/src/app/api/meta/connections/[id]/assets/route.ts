import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { decryptToken } from "@/lib/crypto";
import { listAssets } from "@/lib/meta";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Lista (ao vivo) as Páginas + contas IG que a conexão administra.
 * NÃO retorna tokens — só os IDs/nomes para o usuário escolher.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const limited = enforceRateLimit(`meta-assets:${clientIp(req)}`, 20, 60_000);
  if (limited) return limited;

  const { id } = await params;
  const conn = await prisma.metaConnection.findUnique({
    where: { id },
    select: { accessTokenEnc: true, status: true },
  });
  if (!conn) return Response.json({ error: "Conexão não encontrada" }, { status: 404 });

  let token: string;
  try {
    token = decryptToken(conn.accessTokenEnc);
  } catch {
    return Response.json({ error: "Falha ao ler o token da conexão" }, { status: 500 });
  }

  try {
    const assets = await listAssets(token);
    // remove o token de cada ativo antes de enviar ao browser
    const safe = assets.map((a) => ({
      pageId: a.pageId,
      pageName: a.pageName,
      instagramId: a.instagramId,
      instagramUsername: a.instagramUsername,
    }));
    return Response.json({ assets: safe });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao listar ativos";
    return Response.json({ error: `Meta: ${msg}` }, { status: 502 });
  }
}
