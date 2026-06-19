import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listFolders, driveConfigured } from "@/lib/google-drive";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

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
    const msg = e instanceof Error ? e.message : "Erro ao listar pastas do Drive";
    return Response.json({ error: msg }, { status: 502 });
  }
}
