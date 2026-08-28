import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { decryptToken } from "@/lib/crypto";
import { listAssets } from "@/lib/meta";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type SafeAsset = {
  pageId: string;
  pageName: string;
  instagramId: string | null;
  instagramUsername: string | null;
};

// cache curto por conexão: reabrir o modal fica instantâneo sem re-varrer o BM.
// ?refresh=1 ignora o cache (botão "Atualizar" na UI).
const CACHE_TTL = 60_000;
const assetsCache = new Map<string, { at: number; assets: SafeAsset[] }>();

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
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";

  const cached = assetsCache.get(id);
  if (!refresh && cached && Date.now() - cached.at < CACHE_TTL) {
    return Response.json({ assets: cached.assets, cached: true });
  }

  const conn = await prisma.metaConnection.findUnique({
    where: { id },
    select: { accessTokenEnc: true, status: true },
  });
  if (!conn) return Response.json({ error: "Conexão não encontrada" }, { status: 404 });
  if (conn.status !== "active") {
    return Response.json({ error: "Conexão inativa — atualize o token em /meta" }, { status: 409 });
  }

  let token: string;
  try {
    token = decryptToken(conn.accessTokenEnc);
  } catch {
    return Response.json({ error: "Falha ao ler o token da conexão" }, { status: 500 });
  }

  try {
    const assets = await listAssets(token);
    // remove o token de cada ativo antes de enviar ao browser
    const safe: SafeAsset[] = assets.map((a) => ({
      pageId: a.pageId,
      pageName: a.pageName,
      instagramId: a.instagramId,
      instagramUsername: a.instagramUsername,
    }));
    assetsCache.set(id, { at: Date.now(), assets: safe });
    return Response.json({ assets: safe });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao listar ativos";
    return Response.json({ error: `Meta: ${msg}` }, { status: 502 });
  }
}
