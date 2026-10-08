import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listFolders, driveConfigured, isDriveId, isInsideRoot, FOLDER_OUTSIDE_ROOT } from "@/lib/google-drive";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { toUserMessage } from "@/lib/user-facing-error";

export const dynamic = "force-dynamic";

const FALLBACK = "Não foi possível listar as pastas do Google Drive agora. Tente de novo em instantes.";

/**
 * Lista as pastas do Drive para o seletor visual ao vincular um cliente.
 * Sem `?parent`, lista as pastas-cliente sob a raiz (DRIVE_ROOT_FOLDER_ID).
 * Com `?parent`, só pastas DENTRO da raiz (OWASP AUD2-08): a conta do sistema
 * enxerga o Drive inteiro, então um ID de fora → 403, sem listar nada.
 */
export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  if (!driveConfigured()) {
    return Response.json({ configured: false, folders: [] });
  }

  const limited = enforceRateLimit(`drive-folders:${clientIp(req)}`, 30, 60_000);
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const root = process.env.DRIVE_ROOT_FOLDER_ID!;
  const requested = searchParams.get("parent");
  const parent = requested || root;

  try {
    if (parent !== root) {
      if (!isDriveId(parent)) return Response.json({ error: "Pasta inválida." }, { status: 400 });
      if (!(await isInsideRoot(parent))) return Response.json({ error: FOLDER_OUTSIDE_ROOT }, { status: 403 });
    }
    const folders = await listFolders(parent);
    return Response.json({ configured: true, folders });
  } catch (e) {
    console.error("[drive/folders]", e);
    return Response.json({ error: toUserMessage(e, FALLBACK) }, { status: 502 });
  }
}
