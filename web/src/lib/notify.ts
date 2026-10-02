import { prisma } from "@/lib/prisma";
import { sendEmailEach } from "@/lib/email";

/**
 * Notificações do fluxo de aprovação: cada evento vira um Alert (trilha no
 * dashboard) e, quando houver destinatário, um e-mail. dedupeKey garante que o
 * mesmo aviso não é disparado duas vezes (ex: lembrete diário re-rodado).
 *
 * Destino "equipe" = todos os usuários internos (redatora incluída); override
 * opcional com TEAM_NOTIFY_EMAIL (lista separada por vírgula).
 * Destino "cliente" = todos os e-mails do cliente (`clientRecipients`).
 */

export type AlertKind =
  | "prazo_cronograma"
  | "ajuste_solicitado"
  | "ajuste_resolvido"
  | "cronograma_auto_aprovado"
  | "cronograma_aprovado"
  | "sem_resposta"
  | "sem_arte"
  | "semanal_enviado";

export async function teamEmails(): Promise<string[]> {
  const env = process.env.TEAM_NOTIFY_EMAIL?.trim();
  if (env) {
    return env.split(",").map((e) => e.trim()).filter(Boolean);
  }
  const users = await prisma.user.findMany({ select: { email: true } });
  return users.map((u) => u.email).filter(Boolean);
}

/** Escapa texto vindo de usuários antes de entrar no HTML dos e-mails. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** HTML das notificações (cores da marca; hex fixo porque é e-mail). */
export function notifyEmailHtml(title: string, lines: string[], link?: string, cta = "Abrir"): string {
  return `
  <div style="font-family:'DM Sans',Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;border-top:4px solid #ee7228;padding-top:16px">
    <h2 style="margin:0 0 8px">${title}</h2>
    ${lines.map((l) => `<p style="margin:6px 0">${l}</p>`).join("")}
    ${
      link
        ? `<p style="margin:24px 0">
      <a href="${link}" style="background:#171510;color:#fffdf7;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">${cta}</a>
    </p>
    <p style="font-size:12px;color:#666">Se o botão não funcionar, copie e cole: <br><a href="${link}" style="color:#2f49d6;word-break:break-all">${link}</a></p>`
        : ""
    }
  </div>`;
}

export async function raiseAlert(opts: {
  kind: AlertKind;
  audience: "equipe" | "cliente";
  message: string;
  dedupeKey: string;
  clientId?: string | null;
  scheduleId?: string | null;
  postId?: string | null;
  email?: { to: string[]; subject: string; html: string };
}): Promise<{ created: boolean; emailed: boolean }> {
  // dedupe: já alertado? não repete (nem reenvia e-mail)
  const existing = await prisma.alert.findUnique({
    where: { dedupeKey: opts.dedupeKey },
    select: { id: true },
  });
  if (existing) return { created: false, emailed: false };

  let emailed = false;
  if (opts.email && opts.email.to.length > 0) {
    // best-effort: falha de e-mail não derruba o fluxo; o Alert fica no painel.
    // 1 e-mail por destinatário (ninguém vê o endereço do outro).
    const results = await sendEmailEach(opts.email.to, {
      subject: opts.email.subject,
      html: opts.email.html,
    });
    emailed = results.some((r) => r.sent);
  }

  await prisma.alert.create({
    data: {
      kind: opts.kind,
      audience: opts.audience,
      message: opts.message,
      dedupeKey: opts.dedupeKey,
      clientId: opts.clientId ?? null,
      scheduleId: opts.scheduleId ?? null,
      postId: opts.postId ?? null,
      emailed,
    },
  });
  return { created: true, emailed };
}
