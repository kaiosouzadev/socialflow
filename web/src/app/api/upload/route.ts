import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { r2Configured, uploadToR2 } from "@/lib/r2";

export const dynamic = "force-dynamic";

// SVG proibido: pode embutir <script> (XSS armazenado ao abrir a URL pública)
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const MAX_BYTES = 8 * 1024 * 1024; // 8MB
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Upload autenticado de imagem para o R2. Usado para logo do cliente e
 * arte-base (ArtTemplate). Retorna { url }.
 * Campos (multipart/form-data): file, kind ("logo"|"template"), clientId?
 */
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  if (!r2Configured()) {
    return Response.json({ error: "R2 não configurado" }, { status: 500 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const kind = String(form?.get("kind") ?? "");
  const clientId = form?.get("clientId") ? String(form.get("clientId")) : null;

  if (!(file instanceof Blob)) {
    return Response.json({ error: "Arquivo ausente" }, { status: 400 });
  }
  if (!["logo", "template"].includes(kind)) {
    return Response.json({ error: "kind inválido (logo|template)" }, { status: 400 });
  }
  // clientId entra na key do R2 — precisa ser UUID para não injetar prefixo arbitrário
  if (clientId && !UUID_RE.test(clientId)) {
    return Response.json({ error: "clientId inválido" }, { status: 400 });
  }
  const ext = EXT[file.type];
  if (!ext) {
    return Response.json({ error: "Tipo inválido (png, jpg, webp)" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "Arquivo maior que 8MB" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const stamp = Date.now();
  const key =
    kind === "logo" && clientId
      ? `logos/${clientId}/${stamp}.${ext}`
      : kind === "template"
        ? `templates/${stamp}.${ext}`
        : `uploads/${stamp}.${ext}`;

  try {
    const url = await uploadToR2(key, buffer, file.type);
    return Response.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha no upload";
    return Response.json({ error: msg }, { status: 502 });
  }
}
