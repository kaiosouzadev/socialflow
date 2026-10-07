import { logTextGeneration } from "@/lib/ai-log";

/**
 * Adaptador de TEXTO da OpenAI (ChatGPT) pela Responses API, com `fetch` (sem SDK).
 * Mesma interface do `generateText` do Gemini (system, prompt, temperature, json,
 * maxOutputTokens, timeoutMs, signal, label) + `apiKey` (quem chama resolve a chave:
 * lib/openai-key.getOpenAiKey) e, para o assistente, `messages` no lugar de `prompt`.
 *
 * Segurança: a chave vai só no header Authorization; nunca em URL, log ou mensagem de erro
 * (o texto de erro da OpenAI ecoa parte da chave em 401 — ele é saneado antes de virar Error).
 * `store: false`: a OpenAI não guarda as respostas (são dados de clientes).
 */

export const OPENAI_BASE = "https://api.openai.com/v1";
export const OPENAI_RESPONSES_URL = `${OPENAI_BASE}/responses`;

/** Pausa antes de repetir uma tentativa transitória (429 de limite, 5xx, rede, tempo). */
export const OPENAI_RETRY_DELAY_MS = 1500;

export type OpenAiTurn = { role: "user" | "assistant"; content: string };

export type OpenAiGenerateOptions = {
  apiKey: string;
  model: string;
  /** pedido único (o `input` da Responses API) */
  prompt?: string;
  /** conversa (assistente): usada no lugar de `prompt` quando presente */
  messages?: OpenAiTurn[];
  system?: string;
  /** padrão 0.8 (igual ao Gemini). Modelo que não aceita → repete UMA vez sem temperature */
  temperature?: number;
  /** pede JSON estrito (text.format json_object) */
  json?: boolean;
  maxOutputTokens?: number;
  /** timeout POR TENTATIVA em ms (padrão 25s; são até 2 tentativas) */
  timeoutMs?: number;
  /** cancela de fora: aborta a tentativa em curso e não tenta de novo */
  signal?: AbortSignal;
  /** nome da geração no log do servidor; nunca dado de cliente */
  label?: string;
  /** tentativas em erro transitório (padrão 2) */
  attempts?: number;
  /** pausa entre tentativas (padrão OPENAI_RETRY_DELAY_MS; os testes usam 0) */
  retryDelayMs?: number;
};

/** Erro HTTP da OpenAI, já saneado: "OpenAI <status> <code>: <mensagem sem chave>". */
export type OpenAiHttpError = Error & { status: number; code: string | null; param: string | null };

// modelos que recusaram `temperature` neste processo: as próximas chamadas já vão sem ela
const noTemperatureModels = new Set<string>();

/** Tira da mensagem qualquer coisa com cara de chave (sk-…, Bearer …) e a própria chave. */
export function sanitizeOpenAiMessage(text: string, apiKey?: string): string {
  let out = text;
  if (apiKey && apiKey.length >= 8) out = out.split(apiKey).join("[chave]");
  return out
    .replace(/\bsk-[A-Za-z0-9_*.\-]{2,}/g, "[chave]")
    .replace(/Bearer\s+\S+/gi, "Bearer [chave]")
    .replace(/\s+/g, " ")
    .trim();
}

function httpError(status: number, raw: string, apiKey: string): OpenAiHttpError {
  let code: string | null = null;
  let type: string | null = null;
  let param: string | null = null;
  let message = "";
  try {
    const data = JSON.parse(raw) as { error?: { message?: unknown; type?: unknown; code?: unknown; param?: unknown } };
    const e = data?.error;
    if (e && typeof e === "object") {
      if (typeof e.code === "string") code = e.code;
      if (typeof e.type === "string") type = e.type;
      if (typeof e.param === "string") param = e.param;
      if (typeof e.message === "string") message = e.message;
    }
  } catch {
    message = raw;
  }
  const tag = code ?? type ?? "erro";
  const detail = sanitizeOpenAiMessage(message, apiKey).slice(0, 200);
  return Object.assign(new Error(`OpenAI ${status} ${tag}${detail ? `: ${detail}` : ""}`), {
    name: "OpenAiError",
    status,
    code,
    param,
  });
}

/** O modelo recusou `temperature` (ex.: GPT-5/o-series: "Unsupported parameter: 'temperature'…")? */
export function isTemperatureUnsupported(e: { status: number; code: string | null; param: string | null; message: string }): boolean {
  if (e.status !== 400) return false;
  const aboutTemperature = e.param === "temperature" || /\btemperature\b/i.test(e.message);
  return aboutTemperature && /unsupported|not supported|does not support|only the default/i.test(`${e.code ?? ""} ${e.message}`);
}

/** 429 de limite (não de crédito), 408 e 5xx: vale tentar de novo. */
function isTransient(e: OpenAiHttpError): boolean {
  if (e.status === 429) return e.code !== "insufficient_quota";
  return e.status === 408 || e.status >= 500;
}

/** Texto da resposta: `output_text` ou os `output[].content[]` do tipo texto (ignora o raciocínio). */
export function extractOpenAiText(data: unknown): string {
  const d = data as {
    output_text?: unknown;
    output?: unknown;
    choices?: { message?: { content?: unknown } }[];
  } | null;
  if (!d || typeof d !== "object") return "";
  if (typeof d.output_text === "string" && d.output_text.trim()) return d.output_text;
  const parts: string[] = [];
  if (Array.isArray(d.output)) {
    for (const item of d.output as { type?: unknown; content?: unknown }[]) {
      if (!item || typeof item !== "object") continue;
      if (item.type !== undefined && item.type !== "message") continue;
      if (!Array.isArray(item.content)) continue;
      for (const c of item.content as { type?: unknown; text?: unknown }[]) {
        if (c && (c.type === "output_text" || c.type === "text") && typeof c.text === "string") parts.push(c.text);
      }
    }
  }
  if (parts.length) return parts.join("");
  // formato antigo (Chat Completions), por robustez
  const legacy = Array.isArray(d.choices) ? d.choices[0]?.message?.content : undefined;
  return typeof legacy === "string" ? legacy : "";
}

function emptyReason(data: unknown): string {
  const d = data as {
    status?: unknown;
    incomplete_details?: { reason?: unknown } | null;
    output?: { content?: { type?: unknown }[] }[];
  } | null;
  const refused = Array.isArray(d?.output) && d!.output.some((o) => Array.isArray(o?.content) && o.content.some((c) => c?.type === "refusal"));
  if (refused) return "recusa";
  const reason = d?.incomplete_details?.reason;
  if (typeof reason === "string") return reason;
  return typeof d?.status === "string" ? d.status : "sem conteúdo";
}

/** A Responses API exige a palavra "json" no pedido quando o formato é json_object. */
function mentionsJson(o: OpenAiGenerateOptions): boolean {
  const all = [o.system ?? "", o.prompt ?? "", ...(o.messages ?? []).map((m) => m.content)].join("\n");
  return /json/i.test(all);
}

/** Corpo do POST /v1/responses. */
export function buildOpenAiBody(o: OpenAiGenerateOptions, withTemperature: boolean): Record<string, unknown> {
  const input = o.messages && o.messages.length ? o.messages.map((m) => ({ role: m.role, content: m.content })) : o.prompt ?? "";
  let instructions = o.system?.trim() ? o.system : undefined;
  if (o.json && !mentionsJson(o)) {
    instructions = [instructions, "Responda somente com JSON válido."].filter(Boolean).join("\n\n");
  }
  const temperature = o.temperature ?? 0.8;
  return {
    model: o.model,
    input,
    ...(instructions ? { instructions } : {}),
    ...(withTemperature ? { temperature } : {}),
    ...(o.maxOutputTokens ? { max_output_tokens: o.maxOutputTokens } : {}),
    ...(o.json ? { text: { format: { type: "json_object" } } } : {}),
    store: false,
  };
}

function abortError(): Error {
  return Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
}

/**
 * Chamada à OpenAI (sem log). Timeout por tentativa; repete 1× em erro transitório
 * (429 de limite, 408, 5xx, rede, tempo) com pausa curta; cancelamento de fora não repete;
 * `temperature` recusada → repete UMA vez sem ela. Lança Error saneado.
 */
export async function requestOpenAiText(o: OpenAiGenerateOptions): Promise<string> {
  const attempts = Math.max(1, o.attempts ?? 2);
  const timeoutMs = o.timeoutMs ?? 25_000;
  const delay = o.retryDelayMs ?? OPENAI_RETRY_DELAY_MS;
  const external = o.signal ?? null;
  let withTemperature = !noTemperatureModels.has(o.model);
  let temperatureRetried = false;
  let lastErr: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0 && delay > 0) await new Promise((r) => setTimeout(r, delay));
    if (external?.aborted) break;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const onAbort = () => ctrl.abort();
    external?.addEventListener("abort", onAbort, { once: true });
    let status = 0;
    let raw = "";
    try {
      const res = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${o.apiKey}` },
        body: JSON.stringify(buildOpenAiBody(o, withTemperature)),
        signal: ctrl.signal,
      });
      status = res.status;
      raw = await res.text();
    } catch (e) {
      lastErr = e;
      // cancelado por quem chamou: não tenta de novo
      if (external?.aborted) break;
      // tempo esgotado ou falha de rede: tenta mais uma vez (se ainda houver tentativa)
      continue;
    } finally {
      clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    }

    if (status >= 200 && status < 300) {
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error("OpenAI não retornou texto (resposta ilegível)");
      }
      const text = extractOpenAiText(data);
      if (!text.trim()) throw new Error(`OpenAI não retornou texto (${emptyReason(data)})`);
      return text.trim();
    }

    const err = httpError(status, raw, o.apiKey);
    if (withTemperature && !temperatureRetried && isTemperatureUnsupported(err)) {
      // GPT-5 / o-series: só a temperatura padrão. Repete esta mesma tentativa, sem temperature.
      withTemperature = false;
      temperatureRetried = true;
      noTemperatureModels.add(o.model);
      attempt--;
      continue;
    }
    if (isTransient(err) && attempt < attempts - 1) {
      lastErr = err;
      continue;
    }
    throw err;
  }

  if (external?.aborted && !(lastErr instanceof Error && lastErr.name === "AbortError")) throw abortError();
  if (lastErr instanceof Error) throw lastErr;
  throw new Error("Falha de conexão com a OpenAI");
}

/** Geração de texto na OpenAI com o log `[ia-texto] <função> provedor=openai modelo=<id> <ms>ms ok|erro`. */
export async function openaiGenerateText(o: OpenAiGenerateOptions): Promise<string> {
  const startedAt = Date.now();
  let ok = false;
  try {
    const text = await requestOpenAiText(o);
    ok = true;
    return text;
  } finally {
    logTextGeneration(o.label ?? "texto", o.model, startedAt, ok, "openai");
  }
}

/** Para os testes: esquece quais modelos recusaram temperature. */
export function resetOpenAiModelMemory(): void {
  noTemperatureModels.clear();
}
