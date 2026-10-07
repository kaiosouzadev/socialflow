import type { AiProvider } from "@/lib/ai-model-options";

/**
 * Log de uma geração de texto (para comparar modelos): função, provedor, modelo, tempo e resultado.
 * Sem prompt, sem resposta, sem chave e sem dado de cliente.
 * `[ia-texto] <função> provedor=<google|openai> modelo=<id> <ms>ms ok|erro`
 */
export function logTextGeneration(
  label: string,
  model: string,
  startedAt: number,
  ok: boolean,
  provider: AiProvider = "google"
): void {
  console.info(
    `[ia-texto] ${label} provedor=${provider} modelo=${model} ${Date.now() - startedAt}ms ${ok ? "ok" : "erro"}`
  );
}
