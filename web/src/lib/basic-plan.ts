import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { generateArt } from "@/lib/art-gen";
import { generateText, CAPTION_MODEL } from "@/lib/gemini";
import { r2Configured, uploadToR2 } from "@/lib/r2";
import {
  driveConfigured,
  findFolder,
  ensureFolder,
  uploadToDrive,
} from "@/lib/google-drive";

/**
 * Plano básico: banco mensal de artes-base (ArtTemplate com month+day) que o
 * sistema adapta por cliente (logo, cor, contatos) via IA, cria os posts no
 * cronograma do mês (aprovação por e-mail reaproveitada) e arquiva a arte na
 * pasta do cliente no Drive.
 *
 * Idempotente: cada post gerado guarda o artTemplateId de origem; chamadas
 * repetidas só criam o que falta (processa em lotes p/ caber no timeout).
 */

const TZ = "America/Sao_Paulo";
const SP_OFFSET = "-03:00";
const pad = (n: number) => String(n).padStart(2, "0");

const GUIDE: Record<string, string> = {
  instagram: "Instagram: envolvente, 3-6 hashtags, emojis moderados.",
  facebook: "Facebook: explicativo, call-to-action, poucos hashtags.",
  linkedin: "LinkedIn: profissional, foco em valor, sem excesso de emojis.",
};

/** "julho" a partir de "2026-07" (mesma convenção do drive-sync). */
function monthFolderName(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, month: "long" })
    .format(new Date(Date.UTC(y, m - 1, 15)))
    .toLowerCase();
}

/** Linhas de contato para a arte, respeitando showContacts. */
export function contactLines(client: {
  showContacts: boolean;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  instagramUrl: string | null;
  city: string | null;
}): string[] {
  if (!client.showContacts) return [];
  const lines: string[] = [];
  if (client.whatsapp) lines.push(`WhatsApp: ${client.whatsapp}`);
  if (client.phone) lines.push(`Telefone: ${client.phone}`);
  if (client.website) lines.push(`Site: ${client.website.replace(/^https?:\/\//, "")}`);
  if (client.instagramUrl) {
    const handle = client.instagramUrl.replace(/\/+$/, "").split("/").pop();
    if (handle) lines.push(`Instagram: @${handle.replace(/^@/, "")}`);
  }
  if (client.city) lines.push(client.city);
  return lines;
}

/** Legendas por rede para o tema (uma chamada, JSON por rede). */
async function genCaptions(
  clientName: string,
  tone: string | null,
  theme: string,
  targets: string[]
): Promise<Record<string, string>> {
  const guide = targets.map((t) => `- ${GUIDE[t] ?? t}`).join("\n");
  const system =
    "Você é redator de social media (pt-BR). Escreva legendas prontas para publicar. Responda SOMENTE JSON.";
  const prompt = [
    `Cliente: ${clientName}.`,
    tone ? `Tom de voz: ${tone}.` : "",
    `Tema da postagem: ${theme}.`,
    "Escreva UMA legenda por rede:",
    guide,
    `JSON: {${targets.map((t) => `"${t}":"<legenda>"`).join(",")}}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const raw = await generateText({ model: CAPTION_MODEL, system, prompt, temperature: 0.9, json: true });
    const data = JSON.parse(raw) as Record<string, unknown>;
    const captions: Record<string, string> = {};
    for (const t of targets) {
      const c = data?.[t];
      if (typeof c === "string" && c.trim()) captions[t] = c.trim();
    }
    return captions;
  } catch {
    return {}; // legenda pode ser editada depois na aprovação
  }
}

export type BasicMonth = {
  month: string; // "YYYY-MM"
  label: string; // "julho"
  templates: number;
  created: number; // posts já gerados para o cliente
};

/** Meses disponíveis no banco de artes básicas + progresso do cliente. */
export async function listBasicMonths(clientId: string): Promise<BasicMonth[]> {
  const templates = await prisma.artTemplate.findMany({
    where: { active: true, month: { not: null }, day: { not: null } },
    select: { id: true, month: true },
  });
  if (templates.length === 0) return [];

  const byMonth = new Map<string, string[]>();
  for (const t of templates) {
    const arr = byMonth.get(t.month!) ?? [];
    arr.push(t.id);
    byMonth.set(t.month!, arr);
  }

  const allIds = templates.map((t) => t.id);
  const posts = await prisma.post.findMany({
    where: { clientId, artTemplateId: { in: allIds } },
    select: { artTemplateId: true },
  });
  const done = new Set(posts.map((p) => p.artTemplateId));

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, ids]) => ({
      month,
      label: monthFolderName(month),
      templates: ids.length,
      created: ids.filter((id) => done.has(id)).length,
    }));
}

export type GenerateResult = {
  created: number;
  remaining: number; // ainda faltam (chamar de novo)
  skipped: { title: string; reason: string }[];
  warnings: string[];
};

/**
 * Gera as artes do mês para um cliente básico (em lote de `limit` por chamada
 * para caber no timeout serverless). Cria/reusa o cronograma do mês e arquiva
 * cada arte no Drive (best-effort).
 */
export async function generateBasicPlanMonth(
  clientId: string,
  monthKey: string,
  limit = 4
): Promise<GenerateResult> {
  if (!r2Configured()) throw new Error("R2 não configurado");

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      socialAccounts: { where: { status: "active" }, select: { platform: true } },
    },
  });
  if (!client) throw new Error("Cliente não encontrado");
  if (client.tier !== "basica") throw new Error("Cliente não é do plano básico");

  const templates = await prisma.artTemplate.findMany({
    where: { active: true, month: monthKey, day: { not: null } },
    orderBy: [{ day: "asc" }, { createdAt: "asc" }],
  });
  const result: GenerateResult = { created: 0, remaining: 0, skipped: [], warnings: [] };
  if (templates.length === 0) return result;

  // idempotência: pula artes já geradas para este cliente
  const existing = await prisma.post.findMany({
    where: { clientId, artTemplateId: { in: templates.map((t) => t.id) } },
    select: { artTemplateId: true },
  });
  const done = new Set(existing.map((p) => p.artTemplateId));

  // redes de destino = contas ativas do cliente (fallback IG+FB)
  const platforms = [...new Set(client.socialAccounts.map((a) => a.platform))].filter((p) =>
    ["instagram", "facebook", "linkedin"].includes(p)
  );
  const targets = platforms.length > 0 ? platforms : ["instagram", "facebook"];

  // cronograma do mês (reusa se existir)
  const [y, m] = monthKey.split("-").map(Number);
  const monthRef = new Date(`${y}-${pad(m)}-01T00:00:00${SP_OFFSET}`);
  let schedule = await prisma.schedule.findFirst({
    where: { clientId, monthRef },
    select: { id: true },
  });
  if (!schedule) {
    schedule = await prisma.schedule.create({
      data: { clientId, monthRef, status: "rascunho" },
      select: { id: true },
    });
  }

  const contacts = contactLines(client);

  // pasta do cliente no Drive (cria se faltar) — best-effort, não trava o fluxo
  let monthFolderId: string | null = null;
  if (driveConfigured()) {
    try {
      const rootId = process.env.DRIVE_ROOT_FOLDER_ID!;
      const clientFolderId =
        client.driveFolderId ??
        (await findFolder(client.name, rootId)) ??
        (await ensureFolder(client.name, rootId));
      monthFolderId = await ensureFolder(monthFolderName(monthKey), clientFolderId);
    } catch (e) {
      result.warnings.push(
        `Drive indisponível (${e instanceof Error ? e.message : "erro"}); artes só no R2`
      );
    }
  }

  const pending = templates.filter((t) => !done.has(t.id));
  const batch = pending.slice(0, Math.max(1, limit));
  result.remaining = Math.max(0, pending.length - batch.length);

  for (const tpl of batch) {
    const day = tpl.day!;
    const time = /^\d{2}:\d{2}$/.test(tpl.time ?? "") ? tpl.time! : "18:00";
    const scheduledAt = new Date(`${y}-${pad(m)}-${pad(day)}T${time}:00${SP_OFFSET}`);
    if (Number.isNaN(scheduledAt.getTime())) {
      result.skipped.push({ title: tpl.name, reason: `data inválida (dia ${day})` });
      continue;
    }
    if (scheduledAt.getTime() < Date.now()) {
      result.skipped.push({ title: tpl.name, reason: `dia ${day} já passou` });
      continue;
    }

    try {
      const art = await generateArt({
        templateUrl: tpl.baseImageUrl,
        logoUrl: client.logoUrl,
        brandColor: client.brandColor,
        theme: tpl.name,
        contacts,
      });

      const ext = art.mimeType.includes("jpeg") ? "jpg" : "png";
      const key = `arts/${client.id}/${monthKey}-${pad(day)}-${tpl.id.slice(0, 8)}.${ext}`;
      const mediaUrl = await uploadToR2(key, art.buffer, art.mimeType);

      const captions = await genCaptions(client.name, client.toneOfVoice, tpl.name, targets);

      await prisma.post.create({
        data: {
          clientId: client.id,
          scheduleId: schedule.id,
          theme: tpl.name.slice(0, 200),
          captions: Object.keys(captions).length
            ? (captions as Prisma.InputJsonValue)
            : undefined,
          mediaUrl,
          format: "feed",
          scheduledAt,
          targets,
          status: "draft",
          artTemplateId: tpl.id,
        },
      });
      result.created++;

      // arquiva no Drive com nome padronizado ("07 - Titulo.png")
      if (monthFolderId) {
        try {
          await uploadToDrive(`${pad(day)} - ${tpl.name}.${ext}`, monthFolderId, art.buffer, art.mimeType);
        } catch (e) {
          result.warnings.push(
            `Drive: falha ao salvar "${tpl.name}" (${e instanceof Error ? e.message : "erro"})`
          );
        }
      }
    } catch (e) {
      result.skipped.push({
        title: tpl.name,
        reason: e instanceof Error ? e.message : "falha na geração",
      });
    }
  }

  return result;
}
