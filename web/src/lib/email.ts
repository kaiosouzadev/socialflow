/**
 * Envio de e-mail via Resend (API REST, sem SDK). Usado para o link de
 * aprovação do cronograma. Se RESEND_API_KEY não estiver setado, retorna
 * sent=false (o caller cai no fallback de "copiar link").
 */

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.RESEND_FROM;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ sent: boolean; error?: string }> {
  if (!emailConfigured()) return { sent: false, error: "Resend não configurado" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { sent: false, error: `Resend ${res.status}: ${detail.slice(0, 200)}` };
  }
  return { sent: true };
}

/** HTML simples do e-mail de aprovação. */
export function approvalEmailHtml(clientName: string, monthLabel: string, link: string): string {
  return `
  <div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
    <h2 style="margin:0 0 8px">Cronograma de ${monthLabel}</h2>
    <p>Olá, ${clientName}! Seu cronograma de postagens está pronto para revisão.</p>
    <p>Veja os posts, ajuste o que quiser e aprove no link abaixo:</p>
    <p style="margin:24px 0">
      <a href="${link}" style="background:#7c5cff;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">
        Revisar e aprovar
      </a>
    </p>
    <p style="font-size:12px;color:#666">Se o botão não funcionar, copie e cole: <br>${link}</p>
  </div>`;
}
