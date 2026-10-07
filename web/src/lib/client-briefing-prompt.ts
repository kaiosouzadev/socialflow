/**
 * Briefing do cliente (Client.briefing) como texto pt-BR para os prompts de legenda
 * (decisão do usuário em 07/10: "usar o briefing todo"). As hashtags ficam de fora:
 * são anexadas pelo código (`withClientHashtags`), não pela IA.
 *
 * Módulo puro (sem Prisma/rede). Rótulos iguais aos do editor de briefing
 * (ClientBriefingEditor.tsx) e do importador (doc-import-commit.ts).
 */

/** Regras do cliente: vêm primeiro (o corte por tamanho nunca as perde) e com aviso. */
const RULE_FIELDS: [key: string, label: string][] = [
  ["restrictions", "Restrições (datas, religião, etc.)"],
  ["mandatoryArtText", "Texto obrigatório nas artes"],
];

/** Demais campos, na ordem do editor. `hashtags` fica de fora de propósito. */
const CONTEXT_FIELDS: [key: string, label: string][] = [
  ["products", "Produtos / serviços"],
  ["audience", "Público-alvo"],
  ["positioning", "Posicionamento da marca"],
  ["differential", "Principal diferencial"],
  ["competitors", "Principais concorrentes"],
  ["partnerships", "Parcerias / convênios"],
  ["anniversary", "Aniversário da empresa"],
  ["themes", "Principais temas a abordar"],
  ["references", "Páginas de referência"],
  ["designNotes", "Notas de design"],
  ["linkedinUrl", "Company Page do LinkedIn"],
  ["linkedinRepost", "Repostar no LinkedIn"],
  ["responsibleTech", "Responsável técnico / registro"],
  ["plan", "Plano (nível / frequência)"],
  ["observations", "Observações"],
];

/** Tamanho máximo do bloco (caracteres), cortado com "…". */
export const BRIEFING_PROMPT_MAX = 4000;

const clean = (v: unknown): string =>
  typeof v === "string"
    ? v
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((l) => l.trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : "";

/** "- Rótulo: valor" com as linhas seguintes do valor recuadas (linha em branco fica vazia). */
const item = (label: string, value: string) =>
  `- ${label}: ${value
    .split("\n")
    .map((l, i) => (i === 0 || !l ? l : `  ${l}`))
    .join("\n")}`;

/**
 * Bloco de texto com todos os campos preenchidos do briefing (menos `hashtags`), ou
 * null se nada estiver preenchido. Campos vazios e valores que não são texto são ignorados.
 */
export function briefingForPrompt(briefing: unknown): string | null {
  if (!briefing || typeof briefing !== "object" || Array.isArray(briefing)) return null;
  const b = briefing as Record<string, unknown>;

  const rules = RULE_FIELDS.map(([k, label]) => [label, clean(b[k])] as const).filter(([, v]) => v);
  const context = CONTEXT_FIELDS.map(([k, label]) => [label, clean(b[k])] as const).filter(([, v]) => v);
  if (rules.length === 0 && context.length === 0) return null;

  const parts: string[] = [];
  if (rules.length) {
    parts.push(
      "Regras do cliente (OBRIGATÓRIO respeitar — nunca contrarie as restrições nem o texto obrigatório):",
      ...rules.map(([label, v]) => item(label, v))
    );
  }
  if (context.length) {
    parts.push(
      "Briefing do cliente (use como contexto para escrever no jeito e no assunto do cliente; não invente dados que não estão aqui):",
      ...context.map(([label, v]) => item(label, v))
    );
  }

  const text = parts.join("\n");
  return text.length > BRIEFING_PROMPT_MAX ? `${text.slice(0, BRIEFING_PROMPT_MAX - 1).trimEnd()}…` : text;
}
