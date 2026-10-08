/**
 * Leitura do corpo JSON com teto de tamanho (auditoria OWASP CF-16), para as rotas autenticadas.
 *
 * - `Content-Length` acima do teto → recusa sem ler nada;
 * - sem `Content-Length` (chunked), para de ler e cancela o fluxo assim que passa do teto;
 * - JSON inválido ou corpo vazio → `value: null` (o zod da rota recusa com 400).
 *
 * O `proxy.ts` já recusa corpo declarado acima de 2 MB em qualquer rota de `/api` (lib/request-guard);
 * aqui cada rota usa o teto que faz sentido para o que ela recebe.
 */

export const JSON_BODY_DEFAULT_MAX = 64 * 1024;

export const BODY_TOO_LARGE_MESSAGE = "O conteúdo enviado é grande demais.";

export type ReadJsonResult = { ok: true; value: unknown } | { ok: false; response: Response };

function tooLarge(): ReadJsonResult {
  return {
    ok: false,
    response: Response.json({ error: BODY_TOO_LARGE_MESSAGE }, { status: 413, headers: { "Cache-Control": "no-store" } }),
  };
}

export async function readJsonLimited(req: Request, maxBytes: number = JSON_BODY_DEFAULT_MAX): Promise<ReadJsonResult> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();
  if (!req.body) return { ok: true, value: null };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return tooLarge();
    }
    chunks.push(value);
  }
  if (size === 0) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: true, value: null };
  }
}
