import { createHash, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

/**
 * Guarda das rotas internas (`/api/internal/*`, chamadas pelo n8n).
 *
 * - Falha FECHADA: sem `INTERNAL_API_KEY` no servidor nada passa (503).
 * - Comparação em tempo constante: os dois lados viram SHA-256 antes do
 *   `timingSafeEqual`, então a comparação é sempre entre buffers de 32 bytes —
 *   não vaza o tamanho da chave nem sai cedo num tamanho diferente.
 * - Respostas com `Cache-Control: no-store` (nada interno fica em cache de
 *   proxy/CDN) e corpo com limite de tamanho (`readInternalJson`).
 */

/** Resposta JSON de rota interna: sempre `Cache-Control: no-store`. */
export function internalJson(body: unknown, init: number | ResponseInit = 200): Response {
  const base: ResponseInit = typeof init === "number" ? { status: init } : init;
  const headers = new Headers(base.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...base, headers });
}

/** Marca uma resposta já pronta como `no-store` (rotas que montam a resposta em vários pontos). */
export function noStore(res: Response): Response {
  try {
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch {
    // cabeçalhos imutáveis (resposta de fetch repassada): copia
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
}

/**
 * Valida o header x-internal-key contra INTERNAL_API_KEY.
 * Devolve a resposta de recusa (503 sem chave configurada, 401 chave errada)
 * ou null se autorizado.
 */
export function checkInternalKey(req: NextRequest): Response | null {
  const provided = req.headers.get("x-internal-key") ?? "";
  const expected = process.env.INTERNAL_API_KEY ?? "";

  if (!expected) {
    // falha fechada; texto pt-BR sem nome de variável (o n8n só olha o status)
    return internalJson(
      { error: "A integração interna não está configurada no servidor. Avise o administrador do sistema." },
      503
    );
  }

  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();

  if (!timingSafeEqual(a, b)) {
    // texto pt-BR; o n8n só olha o status
    return internalJson({ error: "Chave interna ausente ou inválida." }, 401);
  }

  return null;
}

/** Corpo máximo aceito nas rotas internas (os gatilhos do n8n mandam poucos bytes). */
export const INTERNAL_BODY_MAX_BYTES = 16 * 1024;

/**
 * Lê o corpo JSON de uma rota interna com limite de tamanho (lendo o fluxo,
 * sem confiar só no Content-Length). Corpo vazio → `{}`.
 * Erro → resposta pronta: 413 (grande demais) ou 400 (não é JSON).
 */
export async function readInternalJson(
  req: Request,
  maxBytes: number = INTERNAL_BODY_MAX_BYTES
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const tooLarge = () => ({
    ok: false as const,
    response: internalJson({ error: "O corpo da requisição é grande demais." }, 413),
  });
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();

  let text = "";
  if (req.body) {
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return tooLarge();
      }
      chunks.push(value);
    }
    text = Buffer.concat(chunks).toString("utf8");
  }
  if (!text.trim()) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: internalJson({ error: "O corpo da requisição não é um JSON válido." }, 400) };
  }
}
