import { prisma } from "@/lib/prisma";
import { decryptToken, encryptToken } from "@/lib/crypto";

/**
 * Chave da API da OpenAI (ChatGPT) — Administração → "Modelos de IA".
 *
 * Guardada CRIPTOGRAFADA (AES-256-GCM, lib/crypto com TOKEN_ENC_KEY) em
 * app_settings['ai.openaiKey'] = { enc, last4, updatedAt }. Nunca volta ao navegador
 * (a tela só recebe configured/last4/source), nunca vai para URL, log ou mensagem de erro.
 *
 * Ordem: chave salva → variável de ambiente OPENAI_API_KEY → nenhuma.
 * Leitura do banco com cache curto (30 s, por processo), invalidado ao salvar/remover.
 */

export const OPENAI_KEY_SETTING = "ai.openaiKey";
export const OPENAI_KEY_CACHE_MS = 30_000;

type StoredKey = { enc: string; last4: string; updatedAt: string | null };

/** Valor do banco → { enc, last4 } ou null (ausente/ilegível). */
export function parseStoredKey(value: unknown): StoredKey | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as { enc?: unknown; last4?: unknown; updatedAt?: unknown };
  if (typeof v.enc !== "string" || !v.enc) return null;
  const last4 = typeof v.last4 === "string" ? v.last4.slice(-4) : "";
  return { enc: v.enc, last4, updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : null };
}

/** A chave de cifra do servidor (TOKEN_ENC_KEY) está configurada? Sem ela não dá para salvar. */
export function encryptionReady(): boolean {
  try {
    encryptToken("ok");
    return true;
  } catch {
    return false;
  }
}

function envKey(): string | null {
  const v = process.env.OPENAI_API_KEY?.trim();
  return v ? v : null;
}

function decrypt(stored: StoredKey): string | null {
  try {
    const key = decryptToken(stored.enc).trim();
    return key || null;
  } catch {
    return null;
  }
}

function errorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string") return code;
  return e instanceof Error ? e.name : "erro";
}

// ------------------------------------------------------------ cache (por processo)

type CacheState = {
  entry: { stored: StoredKey | null; expires: number } | null;
  pending: Promise<StoredKey | null> | null;
  warned: Set<string>;
};

const holder = globalThis as unknown as { __sfOpenAiKey?: CacheState };
function cacheState(): CacheState {
  if (!holder.__sfOpenAiKey) holder.__sfOpenAiKey = { entry: null, pending: null, warned: new Set() };
  return holder.__sfOpenAiKey;
}

/** Esquece a chave lida (chamar depois de salvar/remover). */
export function invalidateOpenAiKeyCache(): void {
  const s = cacheState();
  s.entry = null;
  s.pending = null;
}

function warnOnce(id: string, text: string): void {
  const s = cacheState();
  if (s.warned.has(id)) return;
  s.warned.add(id);
  console.warn(`[openai-key] ${text}`);
}

async function readStored(): Promise<StoredKey | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: OPENAI_KEY_SETTING }, select: { value: true } });
    return row ? parseStoredKey(row.value) : null;
  } catch (e) {
    warnOnce("db", `chave da OpenAI indisponível no banco (${errorCode(e)}); usando OPENAI_API_KEY se houver`);
    return null;
  }
}

async function loadStored(): Promise<StoredKey | null> {
  const s = cacheState();
  if (s.entry && s.entry.expires > Date.now()) return s.entry.stored;
  if (!s.pending) {
    const pending = readStored().then((stored) => {
      const st = cacheState();
      if (st.pending === pending) {
        st.entry = { stored, expires: Date.now() + OPENAI_KEY_CACHE_MS };
        st.pending = null;
      }
      return stored;
    });
    s.pending = pending;
  }
  return s.pending;
}

/**
 * Chave para chamar a OpenAI AGORA: salva (decifrada) → OPENAI_API_KEY → null.
 * Nunca lança e nunca registra a chave.
 */
export async function getOpenAiKey(): Promise<string | null> {
  const stored = await loadStored();
  if (stored) {
    const key = decrypt(stored);
    if (key) return key;
    warnOnce("decrypt", "a chave da OpenAI salva não pôde ser decifrada (TOKEN_ENC_KEY mudou?); salve a chave de novo");
  }
  return envKey();
}

// ------------------------------------------------------------ tela de Administração

export type OpenAiKeySource = "saved" | "env";

/** O que a tela recebe sobre a chave: NUNCA a chave (nem cifrada). */
export type OpenAiKeyStatus = {
  /** false = tabela app_settings ausente/banco indisponível (não dá para salvar) */
  available: boolean;
  /** há chave utilizável (salva e legível, ou no ambiente) */
  configured: boolean;
  source: OpenAiKeySource | null;
  /** 4 últimos caracteres da chave SALVA (null para a do ambiente) */
  last4: string | null;
  /** há chave salva, mas ela não pode ser decifrada (TOKEN_ENC_KEY mudou) */
  savedUnreadable: boolean;
  /** a chave de cifra do servidor está configurada (dá para salvar) */
  canSave: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
};

/** Situação da chave para a tela (sem cache). */
export async function readOpenAiKeyStatus(): Promise<OpenAiKeyStatus> {
  const env = envKey() !== null;
  const canSave = encryptionReady();
  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: OPENAI_KEY_SETTING },
      select: { value: true, updatedAt: true, updater: { select: { name: true } } },
    });
    const stored = row ? parseStoredKey(row.value) : null;
    const readable = stored ? decrypt(stored) !== null : false;
    const source: OpenAiKeySource | null = readable ? "saved" : env ? "env" : null;
    return {
      available: true,
      configured: source !== null,
      source,
      last4: readable && stored ? stored.last4 || null : null,
      savedUnreadable: !!stored && !readable,
      canSave,
      updatedAt: stored && row ? row.updatedAt.toISOString() : null,
      updatedByName: stored ? row?.updater?.name ?? null : null,
    };
  } catch (e) {
    console.warn(`[openai-key] leitura da situação da chave falhou (${errorCode(e)})`);
    return {
      available: false,
      configured: env,
      source: env ? "env" : null,
      last4: null,
      savedUnreadable: false,
      canSave,
      updatedAt: null,
      updatedByName: null,
    };
  }
}

/** Grava a chave cifrada (lança sem TOKEN_ENC_KEY — confira `encryptionReady()` antes). */
export async function saveOpenAiKey(key: string, userId: string | null): Promise<void> {
  const value = { enc: encryptToken(key), last4: key.slice(-4), updatedAt: new Date().toISOString() };
  const write = (updatedBy: string | null) =>
    prisma.appSetting.upsert({
      where: { key: OPENAI_KEY_SETTING },
      create: { key: OPENAI_KEY_SETTING, value, updatedBy },
      update: { value, updatedBy },
    });
  try {
    await write(userId);
  } catch (e) {
    // P2003: a usuária da sessão não existe mais (JWT antigo) → grava sem autor
    if (errorCode(e) !== "P2003" || userId === null) throw e;
    await write(null);
  } finally {
    invalidateOpenAiKeyCache();
  }
}

/** Apaga a chave salva (idempotente). true se havia uma. */
export async function removeOpenAiKey(): Promise<boolean> {
  try {
    const out = await prisma.appSetting.deleteMany({ where: { key: OPENAI_KEY_SETTING } });
    return out.count > 0;
  } finally {
    invalidateOpenAiKeyCache();
  }
}

/** Há chave da OpenAI no ambiente (OPENAI_API_KEY)? */
export function hasEnvOpenAiKey(): boolean {
  return envKey() !== null;
}
