/**
 * Regras da trilha de auditoria das credenciais dos clientes (AC-03/CR-04, decisão "Staff, com
 * registro"): limite de revelações por pessoa e o resumo do que mudou numa gravação — só NOMES de
 * redes, nunca login, senha ou observação.
 */

type Cred = { network: string; login: string; password: string; note?: string };

/** Revelações de credenciais por pessoa, por hora (acima → 429). */
export const REVEAL_LIMIT_PER_HOUR = 30;

/** Texto do 429 (pt-BR, N-14). `retryAfterSeconds` → minutos arredondados para cima. */
export function revealLimitMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Você chegou ao limite de ${REVEAL_LIMIT_PER_HOUR} revelações de senhas por hora. Tente de novo em ${minutes} ${
    minutes === 1 ? "minuto" : "minutos"
  }. Se precisar antes, fale com uma administradora.`;
}

const key = (network: string) => network.trim().toLowerCase();

/**
 * Redes incluídas, removidas e alteradas entre o cofre anterior e o novo (por nome da rede, sem
 * diferenciar maiúsculas). `before` null = cofre anterior ilegível: todas as redes novas contam
 * como gravadas (`networks`), sem diferença calculada.
 */
export function credentialChanges(
  before: readonly Cred[] | null,
  after: readonly Cred[],
): { networks: string[]; added: string[]; removed: string[]; changed: string[]; previousUnreadable?: true } {
  const networks = after.map((c) => c.network.trim());
  if (before === null) return { networks, added: [], removed: [], changed: [], previousUnreadable: true };

  const old = new Map(before.map((c) => [key(c.network), c]));
  const now = new Map(after.map((c) => [key(c.network), c]));
  const added: string[] = [];
  const changed: string[] = [];
  for (const [k, c] of now) {
    const prev = old.get(k);
    if (!prev) added.push(c.network.trim());
    else if (prev.login !== c.login || prev.password !== c.password || (prev.note ?? "") !== (c.note ?? "")) {
      changed.push(c.network.trim());
    }
  }
  const removed = [...old].filter(([k]) => !now.has(k)).map(([, c]) => c.network.trim());
  return { networks, added, removed, changed };
}
