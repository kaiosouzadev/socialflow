import { prisma } from "@/lib/prisma";
import { findFolder, findImageByBaseName, driveConfigured } from "@/lib/google-drive";
import { mediaUrlFor } from "@/lib/media-token";

const TZ = "America/Sao_Paulo";

function spMonthKey(date: Date): string {
  // "YYYY-MM" no fuso de São Paulo
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
  })
    .format(date)
    .slice(0, 7);
}

function monthFolderName(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, month: "long" })
    .format(new Date(Date.UTC(y, m - 1, 15)))
    .toLowerCase();
}

export type SyncResult = {
  attached: number;
  checked: number;
  skipped: { client: string; reason: string }[];
};

/**
 * Para posts AGENDADOS sem mídia (na janela), procura a imagem correspondente
 * na pasta do cliente no Drive (cliente → mês → imagem Nº) e, se achar, grava
 * o ID do arquivo e a URL assinada de mídia. Não muda o status do post.
 */
export async function syncMedia(opts?: {
  clientId?: string;
  withinDays?: number;
}): Promise<SyncResult> {
  if (!driveConfigured()) throw new Error("Drive não configurado (.env)");
  const rootId = process.env.DRIVE_ROOT_FOLDER_ID!;

  const withinDays = opts?.withinDays ?? 30;
  const now = Date.now();
  const lo = new Date(now - 2 * 86400000);
  const hi = new Date(now + withinDays * 86400000);

  const eligible = await prisma.post.findMany({
    where: {
      // rascunhos (gerados pelo calendário IA) e agendados ainda sem arte
      status: { in: ["draft", "scheduled"] },
      OR: [{ mediaUrl: null }, { mediaUrl: "" }],
      scheduledAt: { gte: lo, lt: hi },
      ...(opts?.clientId ? { clientId: opts.clientId } : {}),
    },
    include: { client: { select: { id: true, name: true, driveFolderId: true } } },
    orderBy: { scheduledAt: "asc" },
  });

  const result: SyncResult = { attached: 0, checked: eligible.length, skipped: [] };
  if (eligible.length === 0) return result;

  // agrupa por cliente + mês
  const groups = new Map<
    string,
    { client: { id: string; name: string; driveFolderId: string | null }; monthKey: string; posts: typeof eligible }
  >();
  for (const p of eligible) {
    const monthKey = spMonthKey(p.scheduledAt);
    const key = `${p.clientId}:${monthKey}`;
    const g = groups.get(key);
    if (g) g.posts.push(p);
    else groups.set(key, { client: p.client, monthKey, posts: [p] });
  }

  const folderCache = new Map<string, string | null>();

  for (const { client, monthKey, posts } of groups.values()) {
    // pasta do cliente (override por ID, ou busca pelo nome exato)
    let clientFolderId = client.driveFolderId ?? folderCache.get(`c:${client.id}`) ?? null;
    if (!clientFolderId) {
      clientFolderId = await findFolder(client.name, rootId);
      folderCache.set(`c:${client.id}`, clientFolderId);
    }
    if (!clientFolderId) {
      result.skipped.push({ client: client.name, reason: "pasta do cliente não encontrada no Drive" });
      continue;
    }

    const mName = monthFolderName(monthKey);
    const monthCacheKey = `m:${clientFolderId}:${mName}`;
    let monthFolderId = folderCache.get(monthCacheKey) ?? null;
    if (monthFolderId === null && !folderCache.has(monthCacheKey)) {
      monthFolderId = await findFolder(mName, clientFolderId);
      folderCache.set(monthCacheKey, monthFolderId);
    }
    if (!monthFolderId) {
      result.skipped.push({ client: client.name, reason: `pasta do mês "${mName}" não encontrada` });
      continue;
    }

    // índice de cada post dentro do mês (1-based, ordem cronológica) entre TODOS os posts do mês
    const [y, m] = monthKey.split("-").map(Number);
    const monthStart = new Date(`${y}-${String(m).padStart(2, "0")}-01T00:00:00-03:00`);
    const nextMonth = new Date(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01T00:00:00-03:00`);
    const monthPosts = await prisma.post.findMany({
      where: { clientId: client.id, scheduledAt: { gte: monthStart, lt: nextMonth } },
      orderBy: { scheduledAt: "asc" },
      select: { id: true },
    });
    const indexById = new Map(monthPosts.map((p, i) => [p.id, i + 1]));

    for (const post of posts) {
      const idx = indexById.get(post.id);
      if (!idx) continue;
      const img = await findImageByBaseName(monthFolderId, String(idx));
      if (!img) continue;
      await prisma.post.update({
        where: { id: post.id },
        data: { mediaDriveId: img.id, mediaUrl: mediaUrlFor(post.id) },
      });
      result.attached++;
    }
  }

  return result;
}
