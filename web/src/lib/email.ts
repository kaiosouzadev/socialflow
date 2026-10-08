/**
 * Envio de e-mail via Resend (API REST, sem SDK). Usado para o link de
 * aprovação do cronograma e para as notificações. Se RESEND_API_KEY não
 * estiver setado, retorna sent=false (o caller cai no fallback de "copiar link").
 */

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.RESEND_FROM;
}

export type SendEmailResult = { sent: boolean; error?: string };

/** Escapa texto (nome do cliente, mês…) antes de entrar no HTML do e-mail (OWASP AUD2-02). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SUBJECT_MAX = 200;

/**
 * Assunto numa linha só: quebras de linha e caracteres de controle viram
 * espaço (sem injeção de cabeçalho), espaços repetidos colapsam e o tamanho é
 * limitado.
 */
export function safeSubject(subject: string): string {
  const oneLine = subject.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  return oneLine.length > SUBJECT_MAX ? `${oneLine.slice(0, SUBJECT_MAX - 1)}…` : oneLine;
}

/** Destinatário: um endereço simples, sem quebra de linha nem lista ("a@b.c, x@y.z"). */
const SIMPLE_EMAIL = /^[^\s@<>,;:"()[\]\\]+@[^\s@<>,;:"()[\]\\]+\.[^\s@<>,;:"()[\]\\]+$/;

/** Link do botão: só http(s) absoluto; qualquer outra coisa vira null (o e-mail sai sem o link). */
function safeHref(link: string): string | null {
  try {
    const u = new URL(link);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendEmailResult> {
  if (!emailConfigured()) return { sent: false, error: "Resend não configurado" };
  if (opts.to.length > 254 || !SIMPLE_EMAIL.test(opts.to)) return { sent: false, error: "Destinatário inválido" };

  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM,
        to: [opts.to],
        subject: safeSubject(opts.subject),
        html: opts.html,
      }),
    });
  } catch (e) {
    // falha de rede vira resultado: os outros destinatários ainda são tentados
    return { sent: false, error: e instanceof Error ? e.message : "fetch failed" };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { sent: false, error: `Resend ${res.status}: ${detail.slice(0, 200)}` };
  }
  return { sent: true };
}

/**
 * Envia o mesmo e-mail a cada destinatário, um e-mail por endereço (ninguém
 * vê o endereço do outro). Em sequência, para não estourar o limite de
 * requisições por segundo do Resend com clientes de vários e-mails.
 */
export async function sendEmailEach(
  recipients: readonly string[],
  message: { subject: string; html: string }
): Promise<(SendEmailResult & { to: string })[]> {
  const results: (SendEmailResult & { to: string })[] = [];
  for (const to of recipients) {
    results.push({ to, ...(await sendEmail({ to, ...message })) });
  }
  return results;
}

/**
 * HTML simples do e-mail de aprovação (cores da marca; hex fixo porque é e-mail).
 * Todo dado entra escapado (OWASP AUD2-02): o nome do cliente é digitado pela
 * equipe e não pode virar HTML (link de phishing, imagem de rastreio) no e-mail
 * que sai do domínio da agência. O link só entra se for http(s).
 */
export function approvalEmailHtml(clientName: string, monthLabel: string, link: string): string {
  const name = escapeHtml(clientName);
  const month = escapeHtml(monthLabel);
  const href = safeHref(link);
  const button = href
    ? `
    <p>Veja os posts, ajuste o que quiser e aprove no link abaixo:</p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(href)}" style="background:#171510;color:#fffdf7;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">
        Revisar e aprovar
      </a>
    </p>
    <p style="font-size:12px;color:#666">Se o botão não funcionar, copie e cole: <br><a href="${escapeHtml(href)}" style="color:#2f49d6;word-break:break-all">${escapeHtml(href)}</a></p>`
    : "";
  return `
  <div style="font-family:'DM Sans',Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;border-top:4px solid #ee7228;padding-top:16px">
    <h2 style="margin:0 0 8px">Cronograma de ${month}</h2>
    <p>Olá, ${name}! Seu cronograma de postagens está pronto para revisão.</p>${button}
  </div>`;
}
