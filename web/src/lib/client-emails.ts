/**
 * E-mails do cliente (puro). `Client.email` é o principal (@unique) e
 * `Client.extraEmails` guarda até 10 adicionais — normalizados (trim +
 * minúsculas), sem duplicatas e sem repetir o principal. Os adicionais NÃO
 * são únicos entre clientes (franquias podem compartilhar contato).
 * Todos recebem link mensal, link semanal e notificações ao cliente,
 * 1 e-mail por destinatário.
 */
import { regexes } from "zod/v4/core";

export const MAX_EXTRA_EMAILS = 10;

/** trim + minúsculas. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Mesma validação de `z.string().email()` (regex do zod). */
export function isValidEmail(email: string): boolean {
  return regexes.email.test(email);
}

export type NormalizeExtraEmailsResult =
  | { ok: true; emails: string[] }
  | { ok: false; error: string; invalid: string[] };

/**
 * Normaliza a lista de e-mails adicionais para gravar em `extraEmails`:
 * trim + minúsculas, ignora vazios, valida, remove duplicatas e o principal,
 * e limita a 10. Inválidos ou mais de 10 → erro em pt-BR (o chamador responde 400).
 */
export function normalizeExtraEmails(
  principal: string | null | undefined,
  list: readonly string[]
): NormalizeExtraEmailsResult {
  const main = principal ? normalizeEmail(principal) : "";
  const invalid: string[] = [];
  const emails: string[] = [];
  for (const raw of list) {
    const email = normalizeEmail(raw);
    if (!email) continue;
    if (!isValidEmail(email)) {
      invalid.push(raw.trim());
      continue;
    }
    if (email === main || emails.includes(email)) continue;
    emails.push(email);
  }
  if (invalid.length > 0) {
    return {
      ok: false,
      error:
        invalid.length === 1
          ? `E-mail inválido: ${invalid[0]}`
          : `E-mails inválidos: ${invalid.join(", ")}`,
      invalid,
    };
  }
  if (emails.length > MAX_EXTRA_EMAILS) {
    return {
      ok: false,
      error: `No máximo ${MAX_EXTRA_EMAILS} e-mails adicionais (recebidos ${emails.length}).`,
      invalid: [],
    };
  }
  return { ok: true, emails };
}

/**
 * Destinatários de um e-mail ao cliente: o principal primeiro, depois os
 * adicionais. Defensivo com o que vier do banco: normaliza, ignora vazios e
 * inválidos, remove duplicatas e limita os adicionais a 10 (máx. 11 envios).
 */
export function clientRecipients(client: {
  email: string | null | undefined;
  extraEmails?: readonly string[] | null;
}): string[] {
  const out: string[] = [];
  const main = client.email ? normalizeEmail(client.email) : "";
  if (main && isValidEmail(main)) out.push(main);
  let extras = 0;
  for (const raw of client.extraEmails ?? []) {
    if (extras >= MAX_EXTRA_EMAILS) break;
    const email = normalizeEmail(raw);
    if (!email || !isValidEmail(email) || out.includes(email)) continue;
    out.push(email);
    extras += 1;
  }
  return out;
}
