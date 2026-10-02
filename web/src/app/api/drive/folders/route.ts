import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listFolders, driveConfigured } from "@/lib/google-drive";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { toUserMessage } from "@/lib/user-facing-error";

export const dynamic = "force-dynamic";

const FALLBACK = "Não foi possível listar as pastas do Google Drive agora. Tente de novo em instantes.";

/**
 * Lista as pastas do Drive para o seletor visual ao vincular um cliente.
 * Sem `?parent`, lista as pastas-cliente sob a raiz (DRIVE_ROOT_FOLDER_ID).
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
  const parent = searchParams.get("parent") || process.env.DRIVE_ROOT_FOLDER_ID!;

  try {
    const folders = await listFolders(parent);
    return Response.json({ configured: true, folders });
  } catch (e) {
    console.error("[drive/folders]", e);
    return Response.json({ error: toUserMessage(e, FALLBACK) }, { status: 502 });
  }
}
