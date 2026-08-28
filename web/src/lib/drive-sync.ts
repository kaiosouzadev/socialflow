import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  findFolder,
  findFolderForIndex,
  findCarouselFilesForIndex,
  findMediaForIndex,
  listFolderMedia,
  downloadFile,
  driveConfigured,
} from "@/lib/google-drive";
import { mediaUrlFor } from "@/lib/media-token";
import { r2Configured, uploadToR2 } from "@/lib/r2";

const TZ = "America/Sao_Paulo";

type DriveFile = { id: string; name: string; mimeType: string };
type MediaItem = { url: string; driveId: string; type: "image" | "video" };

function mediaType(mime: string): "image" | "video" {
  return mime.startsWith("video/") ? "video" : "image";
}

/** Sobe uma mídia do Drive para o R2 e devolve a URL pública + metadados. */
async function hostOnR2(file: DriveFile, clientId: string, postId: string, ord: number): Promise<MediaItem> {
  const { buffer, contentType } = await downloadFile(file.id);
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "jpg";
  const key = `${clientId}/${postId}-${ord}.${ext}`;
  const url = await uploadToR2(key, buffer, contentType || file.mimeType || `image/${ext}`);
  return { url, driveId: file.id, type: mediaType(file.mimeType) };
}

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
  /** posts verificados que continuam sem arte, com o nome de arquivo esperado */
  missing: { client: string; post: string; expected: string }[];
};

/**
 * Numeração dos posts do mês para casar com os nomes dos arquivos no Drive:
 * - só posts PRINCIPAIS (não-story) contam: 1, 2, 3… em ordem cronológica;
 * - um story herda o índice do post principal anterior mais próximo (o story
 *   sai junto do post, 15 min depois) → arquivo "Nstory.*".
 * Assim "1.jpg", "1story.jpg", "2.jpg" casam com feed 1 + story 1 + feed 2.
 */
function buildMonthIndex(
  monthPosts: { id: string; format: string; scheduledAt: Date }[]
): Map<string, number> {
  const byId = new Map<string, number>();
  let mainIdx = 0;
  let lastMainIdx = 0;
  for (const p of monthPosts) {
    if (p.format === "story") {
      // sem principal anterior no mês (story avulso no dia 1): usa o próximo índice
      byId.set(p.id, lastMainIdx > 0 ? lastMainIdx : 1);
    } else {
      mainIdx += 1;
      lastMainIdx = mainIdx;
      byId.set(p.id, mainIdx);
    }
  }
  return byId;
}

/**
 * Para posts AGENDADOS sem mídia (na janela), procura a imagem correspondente
 * na pasta do cliente no Drive (cliente → mês → arquivo Nº) e, se achar, grava
 * o ID do arquivo e a URL pública. Não muda o status do post.
 *
 * Convenções aceitas na pasta do mês:
 * - single (feed/reels): "N.ext" (também "03.ext", "3 - Título.ext");
 * - story: "Nstory.ext" ("3 story", "3-story", "03_STORY"…);
 * - carrossel: subpasta "N" com as mídias, OU arquivos "N-1.ext", "N-2.ext"…
 *   soltos na pasta do mês (2+ arquivos).
 * Vídeo (mp4/mov/webm) vale em qualquer um dos casos.
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

  const result: SyncResult = { attached: 0, checked: eligible.length, skipped: [], missing: [] };
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

    // numeração do mês entre TODOS os posts do cliente (stories não contam —
    // herdam o índice do post principal que os acompanha)
    const [y, m] = monthKey.split("-").map(Number);
    const monthStart = new Date(`${y}-${String(m).padStart(2, "0")}-01T00:00:00-03:00`);
    const nextMonth = new Date(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01T00:00:00-03:00`);
    const monthPosts = await prisma.post.findMany({
      where: { clientId: client.id, scheduledAt: { gte: monthStart, lt: nextMonth } },
      orderBy: { scheduledAt: "asc" },
      select: { id: true, format: true, scheduledAt: true },
    });
    const indexById = buildMonthIndex(monthPosts);

    for (const post of posts) {
      const idx = indexById.get(post.id);
      if (!idx) continue;
      const label = `post ${idx}${post.theme ? ` (${post.theme.slice(0, 40)})` : ""}`;

      // STORY: sempre arquivo único "Nstory" (nunca vira carrossel)
      if (post.format === "story") {
        const { file } = await findMediaForIndex(monthFolderId, idx, true);
        if (!file) {
          result.missing.push({ client: client.name, post: label, expected: `${idx}story.*` });
          continue;
        }
        const mediaUrl = r2Configured()
          ? (await hostOnR2(file, client.id, post.id, 1)).url
          : mediaUrlFor(post.id);
        await prisma.post.update({
          where: { id: post.id },
          data: { mediaDriveId: file.id, mediaUrl, mediaItems: Prisma.JsonNull },
        });
        result.attached++;
        continue;
      }

      // CARROSSEL: subpasta "N" (ou arquivos "N-1", "N-2"… soltos). Detecta
      // mesmo se o post estiver marcado como feed/reels — o Drive é a fonte da
      // verdade do formato; se achar 2+ mídias, corrige format para "carrossel".
      if (r2Configured()) {
        let files: DriveFile[] = [];
        const subId = await findFolderForIndex(monthFolderId, idx);
        if (subId) files = await listFolderMedia(subId);
        if (files.length === 0) {
          const loose = await findCarouselFilesForIndex(monthFolderId, idx);
          if (loose.length >= 2) files = loose;
        }
        if (files.length > 0) {
          const items: MediaItem[] = [];
          for (let i = 0; i < files.length; i++) {
            items.push(await hostOnR2(files[i], client.id, post.id, i + 1));
          }
          await prisma.post.update({
            where: { id: post.id },
            data: {
              mediaItems: items as unknown as Prisma.InputJsonValue,
              mediaUrl: items[0].url,
              mediaDriveId: items[0].driveId,
              ...(post.format === "carrossel" || items.length < 2 ? {} : { format: "carrossel" }),
            },
          });
          result.attached++;
          continue;
        }
        if (post.format === "carrossel") {
          // sem subpasta e sem N-K: tenta arquivo único antes de reportar
          const { file } = await findMediaForIndex(monthFolderId, idx, false);
          if (file) {
            const item = await hostOnR2(file, client.id, post.id, 1);
            await prisma.post.update({
              where: { id: post.id },
              data: { mediaDriveId: item.driveId, mediaUrl: item.url, mediaItems: Prisma.JsonNull },
            });
            result.attached++;
          } else {
            result.missing.push({
              client: client.name,
              post: label,
              expected: `subpasta "${idx}" ou arquivos "${idx}-1.*", "${idx}-2.*"…`,
            });
          }
          continue;
        }
      } else if (post.format === "carrossel") {
        result.skipped.push({ client: client.name, reason: `carrossel (post ${idx}) requer R2 configurado` });
        continue;
      }

      // SINGLE (feed / reels): arquivo "N"
      const { file } = await findMediaForIndex(monthFolderId, idx, false);
      if (!file) {
        result.missing.push({
          client: client.name,
          post: label,
          expected: post.format === "reels" ? `${idx}.mp4 (vídeo)` : `${idx}.*`,
        });
        continue;
      }

      // hospeda numa URL pública: R2 (edge) ou fallback assinado /api/media
      let mediaUrl: string;
      if (r2Configured()) {
        mediaUrl = (await hostOnR2(file, client.id, post.id, 1)).url;
      } else {
        mediaUrl = mediaUrlFor(post.id);
      }

      await prisma.post.update({
        where: { id: post.id },
        data: { mediaDriveId: file.id, mediaUrl, mediaItems: Prisma.JsonNull },
      });
      result.attached++;
    }
  }

  return result;
}
