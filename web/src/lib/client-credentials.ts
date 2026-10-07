/**
 * Credenciais de acesso do cliente (`Client.credentialsEnc`): um JSON
 * `[{ network, login, password, note? }]` cifrado com AES-256-GCM (lib/crypto).
 * É o formato da API `api/clients/[id]/credentials` (tela Credenciais) e do
 * importador do documento mensal (lib/doc-import-commit): os dois usam estas
 * funções. Nunca logar nem devolver a senha fora do GET de credenciais.
 */
import { decryptToken, encryptToken } from "@/lib/crypto";
import { networkKey } from "@/lib/doc-import";

export type ClientCredential = { network: string; login: string; password: string; note?: string };

const isCredential = (v: unknown): v is ClientCredential => {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return typeof c.network === "string" && typeof c.login === "string" && typeof c.password === "string";
};

/** Descarta entradas sem rede ou sem login e senha (regra do PUT de credenciais). */
export function cleanCredentials(list: readonly ClientCredential[]): ClientCredential[] {
  return list.filter((c) => c.network.trim() && (c.login.trim() || c.password.trim()));
}

/** JSON cifrado da lista limpa; null se não sobrar nenhuma (a coluna fica vazia). Lança sem TOKEN_ENC_KEY. */
export function encryptCredentials(list: readonly ClientCredential[]): string | null {
  const clean = cleanCredentials(list);
  return clean.length ? encryptToken(JSON.stringify(clean)) : null;
}

/** Lista decifrada. Lança se não decifrar (chave ausente/trocada ou dado corrompido). */
export function decryptCredentials(enc: string | null | undefined): ClientCredential[] {
  if (!enc) return [];
  const parsed: unknown = JSON.parse(decryptToken(enc));
  if (!Array.isArray(parsed)) throw new Error("Credenciais em formato inesperado");
  return parsed.filter(isCredential).map((c) => ({
    network: c.network,
    login: c.login,
    password: c.password,
    ...(typeof c.note === "string" ? { note: c.note } : {}),
  }));
}

/** A chave de cifra (TOKEN_ENC_KEY) está configurada? */
export function credentialsKeyConfigured(): boolean {
  try {
    encryptToken("ok");
    return true;
  } catch {
    return false;
  }
}

/**
 * Substitui, por rede, só as redes de `incoming` (casadas por `networkKey`:
 * "insta" = "Instagram"); as demais ficam como estão. Login ou senha vazios
 * no `incoming` mantêm o valor atual daquela rede; a observação (`note`) fica.
 */
export function mergeCredentials(
  current: readonly ClientCredential[],
  incoming: readonly { network: string; login: string; password: string }[]
): ClientCredential[] {
  const out = current.map((c) => ({ ...c }));
  for (const n of incoming) {
    const key = networkKey(n.network);
    const i = out.findIndex((c) => networkKey(c.network) === key);
    if (i === -1) out.push({ network: n.network, login: n.login, password: n.password });
    else out[i] = { ...out[i], login: n.login || out[i].login, password: n.password || out[i].password };
  }
  return out;
}
