import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { r2Configured, uploadToR2 } from "@/lib/r2";
import { sniffImageType, type SafeImageType } from "@/lib/safe-fetch";
import { toUserMessage } from "@/lib/user-facing-error";

export const dynamic = "force-dynamic";

const FALLBACK = "Não foi possível enviar o arquivo. Tente de novo em instantes.";

/**
 * Tipo pelo CONTEÚDO do arquivo (bytes iniciais), nunca pelo MIME que o
 * navegador declara nem pelo nome (OWASP AUD2): um SVG/HTML renomeado para
 * .png ou enviado como image/png é recusado. SVG proibido: pode embutir
 * <script> (XSS armazenado ao abrir a URL pública).
 */
const EXT: Record<SafeImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const MAX_BYTES = 8 * 1024 * 1024; // 8MB
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ["logo", "template", "post"] as const;
type Kind = (typeof KINDS)[number];

/**
 * Upload autenticado de imagem para o R2. Usado para logo do cliente,
 * arte-base (ArtTemplate) e a mídia de um post. Retorna { url }.
 * Campos (multipart/form-data): file, kind ("logo"|"template"|"post"), clientId?
 * O nome do objeto é gerado aqui (prefixo do tipo + UUID aleatório): nada do
 * nome do arquivo nem do caminho enviado entra na chave.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  // corpo com folga para o multipart; o arquivo em si é conferido abaixo
  const declared = Number(req.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_BYTES + 64 * 1024) {
    return Response.json({ error: "Arquivo maior que 8MB" }, { status: 413 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const kind = String(form?.get("kind") ?? "");
  const clientId = form?.get("clientId") ? String(form.get("clientId")) : null;

  if (!(file instanceof Blob)) {
    return Response.json({ error: "Arquivo ausente" }, { status: 400 });
  }
  if (!KINDS.includes(kind as Kind)) {
    return Response.json({ error: "Tipo de envio inválido." }, { status: 400 });
  }
  // clientId entra na key do R2 — precisa ser UUID para não injetar prefixo arbitrário
  if (clientId && !UUID_RE.test(clientId)) {
    return Response.json({ error: "clientId inválido" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "Arquivo maior que 8MB" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_BYTES) {
    return Response.json({ error: "Arquivo maior que 8MB" }, { status: 400 });
  }
  const type = sniffImageType(buffer);
  if (!type) {
    return Response.json({ error: "Tipo inválido (png, jpg, webp)" }, { status: 400 });
  }
  const ext = EXT[type];
  const name = `${Date.now()}-${randomUUID()}.${ext}`;
  const id = clientId?.toLowerCase();
  const key =
    kind === "logo"
      ? id
        ? `logos/${id}/${name}`
        : `uploads/${name}`
      : kind === "template"
        ? `templates/${name}`
        : `posts/${id ?? "sem-cliente"}/${name}`;

  if (!r2Configured()) {
    const cause = "R2 não configurado (variáveis R2_* ausentes)";
    console.error("[upload]", cause);
    return Response.json({ error: toUserMessage(cause, FALLBACK) }, { status: 500 });
  }

  try {
    const url = await uploadToR2(key, buffer, type);
    return Response.json({ url });
  } catch (e) {
    console.error("[upload]", e);
    return Response.json({ error: toUserMessage(e, FALLBACK) }, { status: 502 });
  }
}
