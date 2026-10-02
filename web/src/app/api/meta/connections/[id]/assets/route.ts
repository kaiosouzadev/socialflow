import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { decryptToken } from "@/lib/crypto";
import { listAssets } from "@/lib/meta";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { toUserMessage } from "@/lib/user-facing-error";

export const dynamic = "force-dynamic";

const TOKEN_UNREADABLE =
  "Não foi possível ler o token salvo desta conexão. Cole o token de novo para atualizar a conexão.";
const TOKEN_EXPIRED =
  "O token desta conexão com a Meta expirou ou foi revogado. Gere um novo token do usuário do sistema no Gerenciador de Negócios da Meta e atualize a conexão.";
const NO_PERMISSION =
  "O token desta conexão não tem permissão para listar as Páginas e as contas do Instagram. No Gerenciador de Negócios da Meta, dê ao usuário do sistema acesso a elas, gere um novo token e atualize a conexão.";
const LIST_FAILED =
  "Não foi possível listar as Páginas e as contas do Instagram desta conexão. Tente de novo em instantes; se continuar, gere um novo token e atualize a conexão.";

// mensagens da Graph API (lib/meta repassa só o `message` do erro)
const TOKEN_ERROR =
  /Error validating access token|Invalid OAuth access token|Malformed access token|access token could not be decrypted|session has expired|\(#190\)|\bHTTP 401\b/i;
const PERMISSION_ERROR = /\(#(10|2\d\d)\)|permiss|\bHTTP 403\b/i;

/** Texto de uma regra conhecida de `toUserMessage`; null quando a mensagem passaria crua. */
function knownMessage(e: unknown): string | null {
  const raw = (e instanceof Error ? e.message : typeof e === "string" ? e : "").trim();
  const msg = toUserMessage(e, "");
  return msg && msg !== raw ? msg : null;
}

/** Erro de listagem → causa provável + ação sugerida, em pt-BR. */
function listAssetsError(e: unknown): string {
  const raw = e instanceof Error ? e.message : "";
  if (TOKEN_ERROR.test(raw)) return TOKEN_EXPIRED;
  if (PERMISSION_ERROR.test(raw)) return NO_PERMISSION;
  // timeout da Graph e falha de rede têm texto próprio em toUserMessage
  return knownMessage(e) ?? LIST_FAILED;
}

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
  } catch (e) {
    console.error("[meta/assets] falha ao decifrar o token da conexão", id, e);
    // falha de configuração (503): chave de criptografia ausente tem texto próprio; o resto é token ilegível
    return Response.json({ error: knownMessage(e) ?? TOKEN_UNREADABLE }, { status: 503 });
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
    console.error("[meta/assets] falha ao listar ativos da conexão", id, e);
    return Response.json({ error: listAssetsError(e) }, { status: 502 });
  }
}
