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
  serviceAccountEmail,
} from "@/lib/google-drive";

/**
 * Plano básico — mesmo fluxo do calendário dos clientes completos:
 * 1) banco mensal de artes-base (título + dia/hora + legendas PADRONIZADAS);
 * 2) ao cadastrar cliente básico, o calendário do mês é agendado na hora
 *    (posts draft SEM arte — fica pendente só a geração das imagens);
 * 3) "Gerar artes" personaliza a arte-base por cliente (logo, cor, imagem
 *    adaptada ao tema, contatos) e preenche os posts pendentes.
 *
 * Idempotente: cada post guarda o artTemplateId de origem.
 */

const TZ = "America/Sao_Paulo";
const SP_OFFSET = "-03:00";
const pad = (n: number) => String(n).padStart(2, "0");

/** Legendas padronizadas do template: { shared, linkedin }. */
type TemplateCaptions = { shared?: string; linkedin?: string };

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

/**
 * Legenda padronizada (genérica, sem citar cliente) para um título do plano
 * básico — uma para FB+IG (compartilhada) e uma para LinkedIn.
 */
export async function genTemplateCaptions(title: string): Promise<TemplateCaptions> {
  const system =
    "Você é redator de social media (pt-BR) de uma agência. Escreve legendas GENÉRICAS " +
    "(sem citar nome de empresa) prontas para publicar, reutilizáveis por vários clientes. " +
    "Responda SOMENTE JSON.";
  const prompt = [
    `Tema da postagem: ${title}.`,
    "Escreva DUAS legendas:",
    '- "shared": para Facebook e Instagram (envolvente, 3-6 hashtags, emojis moderados);',
    '- "linkedin": tom profissional, foco em valor, sem excesso de emojis.',
    'JSON: {"shared":"<legenda>","linkedin":"<legenda>"}',
  ].join("\n");

  try {
    const raw = await generateText({ model: CAPTION_MODEL, system, prompt, temperature: 0.9, json: true });
    const data = JSON.parse(raw) as Record<string, unknown>;
    const out: TemplateCaptions = {};
    if (typeof data.shared === "string" && data.shared.trim()) out.shared = data.shared.trim();
    if (typeof data.linkedin === "string" && data.linkedin.trim()) out.linkedin = data.linkedin.trim();
    return out;
  } catch {
    return {};
  }
}

/** captions do post ({instagram, facebook, linkedin}) a partir das padronizadas. */
function postCaptions(tpl: TemplateCaptions): Record<string, string> {
  const captions: Record<string, string> = {};
  if (tpl.shared) {
    captions.instagram = tpl.shared;
    captions.facebook = tpl.shared;
    captions.linkedin = tpl.linkedin ?? tpl.shared;
  } else if (tpl.linkedin) {
    captions.linkedin = tpl.linkedin;
  }
  return captions;
}

/** Instrução acionável quando o Drive nega escrita — sem despejar o JSON do Google. */
function driveHint(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("storage quota") || msg.includes("storageQuota")) {
    return (
      "service account não pode ser dona de arquivos no Meu Drive (política do Google). " +
      "Use um Drive COMPARTILHADO (mova a pasta de clientes pra lá e atualize DRIVE_ROOT_FOLDER_ID) " +
      "ou configure GOOGLE_IMPERSONATE_EMAIL com delegação de domínio no Workspace"
    );
  }
  if (msg.includes("403")) {
    const sa = serviceAccountEmail();
    return `sem permissão de escrita no Drive — compartilhe a pasta raiz com ${sa ?? "a service account"} como EDITOR`;
  }
  return msg.slice(0, 160);
}

export type BasicMonth = {
  month: string; // "YYYY-MM"
  label: string; // "julho"
  templates: number;
  scheduled: number; // posts criados (agendados) p/ o cliente
  withArt: number; // posts já com arte
};

/** Meses do banco de artes básicas + progresso do cliente. */
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

  const posts = await prisma.post.findMany({
    where: { clientId, artTemplateId: { in: templates.map((t) => t.id) } },
    select: { artTemplateId: true, mediaUrl: true },
  });
  const scheduledSet = new Set(posts.map((p) => p.artTemplateId));
  const artSet = new Set(posts.filter((p) => !!p.mediaUrl).map((p) => p.artTemplateId));

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, ids]) => ({
      month,
      label: monthFolderName(month),
      templates: ids.length,
      scheduled: ids.filter((id) => scheduledSet.has(id)).length,
      withArt: ids.filter((id) => artSet.has(id)).length,
    }));
}

export type ScheduleResult = {
  scheduled: number;
  skipped: { title: string; reason: string }[];
};

/**
 * Agenda o calendário básico do mês para o cliente: cria o cronograma e os
 * posts draft SEM arte (rápido, sem IA de imagem). Legendas padronizadas vêm
 * do template; se faltarem, gera uma vez e persiste no template.
 */
export async function scheduleBasicMonth(
  clientId: string,
  monthKey: string
): Promise<ScheduleResult> {
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
  const result: ScheduleResult = { scheduled: 0, skipped: [] };
  if (templates.length === 0) return result;

  const existing = await prisma.post.findMany({
    where: { clientId, artTemplateId: { in: templates.map((t) => t.id) } },
    select: { artTemplateId: true },
  });
  const done = new Set(existing.map((p) => p.artTemplateId));

  const platforms = [...new Set(client.socialAccounts.map((a) => a.platform))].filter((p) =>
    ["instagram", "facebook", "linkedin"].includes(p)
  );
  const targets = platforms.length > 0 ? platforms : ["instagram", "facebook"];

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

  for (const tpl of templates) {
    if (done.has(tpl.id)) continue;
    const day = tpl.day!;
    const time = /^\d{2}:\d{2}$/.test(tpl.time ?? "") ? tpl.time! : "18:00";
    const scheduledAt = new Date(`${y}-${pad(m)}-${pad(day)}T${time}:00${SP_OFFSET}`);
    if (Number.isNaN(scheduledAt.getTime())) {
      result.skipped.push({ title: tpl.name, reason: `data inválida (dia ${day})` });
      continue;
    }
    // nunca agenda para dia que já passou
    if (scheduledAt.getTime() < Date.now()) {
      result.skipped.push({ title: tpl.name, reason: `dia ${day} já passou` });
      continue;
    }

    // legendas padronizadas: usa as do template; se faltarem, gera e persiste
    let tplCaptions = (tpl.captions as TemplateCaptions | null) ?? {};
    if (!tplCaptions.shared) {
      tplCaptions = await genTemplateCaptions(tpl.name);
      if (tplCaptions.shared) {
        await prisma.artTemplate.update({
          where: { id: tpl.id },
          data: { captions: tplCaptions as Prisma.InputJsonValue },
        });
      }
    }
    const captions = postCaptions(tplCaptions);

    await prisma.post.create({
      data: {
        clientId: client.id,
        scheduleId: schedule.id,
        theme: tpl.name.slice(0, 200),
        captions: Object.keys(captions).length
          ? (captions as Prisma.InputJsonValue)
          : undefined,
        format: "feed",
        scheduledAt,
        targets,
        status: "draft",
        artTemplateId: tpl.id,
      },
    });
    result.scheduled++;
  }

  return result;
}

/** Agenda TODOS os meses disponíveis do banco básico (usado no cadastro). */
export async function scheduleAllBasicMonths(clientId: string): Promise<ScheduleResult> {
  const months = await prisma.artTemplate.findMany({
    where: { active: true, month: { not: null }, day: { not: null } },
    select: { month: true },
    distinct: ["month"],
  });
  const total: ScheduleResult = { scheduled: 0, skipped: [] };
  for (const { month } of months.sort((a, b) => a.month!.localeCompare(b.month!))) {
    const r = await scheduleBasicMonth(clientId, month!);
    total.scheduled += r.scheduled;
    total.skipped.push(...r.skipped);
  }
  return total;
}

export type GenerateResult = {
  created: number;
  remaining: number; // ainda faltam (chamar de novo)
  skipped: { title: string; reason: string }[];
  warnings: string[];
};

/**
 * Gera as artes pendentes do mês (posts do plano básico sem mediaUrl), em
 * lotes de `limit` por chamada. Personaliza a arte-base com logo/cor/contatos,
 * grava no R2, atualiza o post e arquiva no Drive (best-effort).
 */
export async function generateBasicArtsMonth(
  clientId: string,
  monthKey: string,
  limit = 4
): Promise<GenerateResult> {
  if (!r2Configured()) throw new Error("R2 não configurado");

  // garante que o mês está agendado (posts criados) antes de gerar artes
  await scheduleBasicMonth(clientId, monthKey);

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) throw new Error("Cliente não encontrado");

  const templates = await prisma.artTemplate.findMany({
    where: { active: true, month: monthKey, day: { not: null } },
  });
  const tplById = new Map(templates.map((t) => [t.id, t]));

  const result: GenerateResult = { created: 0, remaining: 0, skipped: [], warnings: [] };
  if (templates.length === 0) return result;

  // posts do plano básico ainda sem arte (só futuros — passado não publica)
  const pendingPosts = await prisma.post.findMany({
    where: {
      clientId,
      artTemplateId: { in: templates.map((t) => t.id) },
      OR: [{ mediaUrl: null }, { mediaUrl: "" }],
      scheduledAt: { gte: new Date() },
    },
    orderBy: { scheduledAt: "asc" },
  });
  if (pendingPosts.length === 0) return result;

  const contacts = contactLines(client);

  // pasta do cliente no Drive (cria se faltar) — best-effort
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
      result.warnings.push(`Drive indisponível: ${driveHint(e)}`);
    }
  }

  const batch = pendingPosts.slice(0, Math.max(1, limit));
  result.remaining = Math.max(0, pendingPosts.length - batch.length);

  for (const post of batch) {
    const tpl = tplById.get(post.artTemplateId!);
    if (!tpl) continue;
    const day = tpl.day!;

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

      await prisma.post.update({
        where: { id: post.id },
        data: { mediaUrl, mediaDriveId: null },
      });
      result.created++;

      // arquiva no Drive com nome padronizado ("07 - Titulo.png")
      if (monthFolderId) {
        try {
          await uploadToDrive(`${pad(day)} - ${tpl.name}.${ext}`, monthFolderId, art.buffer, art.mimeType);
        } catch (e) {
          result.warnings.push(`Drive: falha ao salvar "${tpl.name}" (${driveHint(e)})`);
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
