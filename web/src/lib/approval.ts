import { randomBytes } from "crypto";

export const MAX_AI_EDITS = 5;

export function newApprovalToken(): string {
  return randomBytes(24).toString("base64url");
}

export function approvalLink(token: string): string {
  const base = (process.env.SYSTEM_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}/aprovar/${token}`;
}

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "junho de 2026" a partir do monthRef (Date). */
export function monthLabel(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}
