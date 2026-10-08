import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  findFolder,
  findFolderForIndex,
  findCarouselFilesForIndex,
  findMediaForIndex,
  findStoryInFolder,
  listFolders,
  listFolderMedia,
  downloadFile,
  driveConfigured,
  driveMediaType,
  ensureFolder,
  ensureYearMonthFolders,
  FOLDER_OUTSIDE_ROOT,
  isInsideRoot,
  looksLikeMarkup,
} from "@/lib/google-drive";
import {
  buildMonthFileNames,
  buildMonthIndex,
  drivePathLabel,
  parseMonthKey,
  resolveMonthFolder,
  type DriveLayout,
  type MonthFileName,
  type MonthFolderResolution,
} from "@/lib/drive-layout";
import { mediaUrlFor } from "@/lib/media-token";
import { r2Configured, uploadToR2 } from "@/lib/r2";
import { toUserMessage } from "@/lib/user-facing-error";

const TZ = "America/Sao_Paulo";

const SAVED_FOLDER_OUTSIDE =
  "a pasta do Drive escolhida no cadastro do cliente fica fora da pasta de clientes; escolha a pasta de novo";

type DriveFile = { id: string; name: string; mimeType: string };
type MediaItem = { url: string; driveId: string; type: "image" | "video" };

/**
 * Sobe uma mídia do Drive para o R2 e devolve a URL pública + metadados.
 * OWASP (AUD2 / CF-03): só os formatos de `driveMediaType` (JPEG/PNG/WebP,
 * MP4/MOV/WebM); o content-type e a extensão no R2 vêm dessa lista (nunca do
 * nome do arquivo nem de um SVG/HTML), e conteúdo que é marcação é recusado.
 */
async function hostOnR2(file: DriveFile, clientId: string, postId: string, ord: number): Promise<MediaItem> {
  const { buffer, contentType } = await downloadFile(file.id);
  const type = driveMediaType(file.mimeType);
  const served = driveMediaType(contentType);
  if (!type || !served || served.kind !== type.kind || looksLikeMarkup(buffer)) {
    throw new Error(`O arquivo "${file.name}" do Google Drive não é uma imagem (JPG, PNG, WebP) nem um vídeo (MP4, MOV) válido.`);
  }
  const key = `${clientId}/${postId}-${ord}.${type.ext}`;
  const url = await uploadToR2(key, buffer, type.contentType);
  return { url, driveId: file.id, type: type.kind };
}

/** "YYYY-MM" no fuso de São Paulo (o mês da pasta onde fica a arte do post). */
export function spMonthKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
  })
    .format(date)
    .slice(0, 7);
}

/** Pasta de mês usada pelo sync (uma por cliente + mês). */
export type SyncMonthFolder = {
  client: string;
  /** "AAAA-MM" */
  month: string;
  /** "ano/mes" = Cliente/AAAA/<mês>; "legado" = Cliente/<mês>; null = não encontrada */
  layout: DriveLayout | null;
  /** caminho da pasta usada (o legado termina em "(estrutura antiga)"); se não encontrada, o esperado */
  path: string;
};

/** Mais de uma pasta ou arquivo casou com o esperado; o sync usou `chosen`. */
export type SyncAmbiguity = {
  client: string;
  /** post afetado; ausente quando a dúvida é na pasta do ano/mês */
  post?: string;
  /** pasta onde estão as candidatas */
  path: string;
  chosen: string;
  /** todas as candidatas, inclusive a escolhida */
  candidates: string[];
};

export type SyncResult = {
  attached: number;
  checked: number;
  skipped: { client: string; reason: string }[];
  /** posts verificados que continuam sem arte, com o caminho completo esperado */
  missing: { client: string; post: string; expected: string }[];
  layout: SyncMonthFolder[];
  ambiguous: SyncAmbiguity[];
};

/**
 * TODOS os posts do cliente no mês (fuso SP), de qualquer status, na ordem da
 * numeração das artes. Empate de horário: o criado antes vem primeiro (depois
 * o id), para a ordem não mudar entre uma consulta e outra.
 */
async function monthPostsFor(clientId: string, monthKey: string): Promise<{ id: string; format: string }[]> {
  const { year: y, month: m } = parseMonthKey(monthKey);
  const pad = (n: number) => String(n).padStart(2, "0");
  const monthStart = new Date(`${y}-${pad(m)}-01T00:00:00-03:00`);
  const nextMonth = new Date(`${m === 12 ? y + 1 : y}-${pad(m === 12 ? 1 : m + 1)}-01T00:00:00-03:00`);
  return prisma.post.findMany({
    where: { clientId, scheduledAt: { gte: monthStart, lt: nextMonth } },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, format: true },
  });
}

/**
 * Numeração do mês (o N de cada post; regra em `buildMonthIndex`). Usada pelo
 * plano básico, que arquiva a arte como "N.ext".
 */
export async function monthIndexFor(clientId: string, monthKey: string): Promise<Map<string, number>> {
  const monthPosts = await monthPostsFor(clientId, monthKey);
  return buildMonthIndex(monthPosts);
}

/**
 * Nome da arte de cada post do mês no Drive ("4", "4story", "4story2"…;
 * regra em `buildMonthFileNames`), com a mesma numeração de `monthIndexFor`.
 */
export async function monthFileNamesFor(clientId: string, monthKey: string): Promise<Map<string, MonthFileName>> {
  const monthPosts = await monthPostsFor(clientId, monthKey);
  return buildMonthFileNames(monthPosts);
}

/**
 * Para posts AGENDADOS sem mídia (na janela), procura a imagem correspondente
 * na pasta do cliente no Drive (cliente → ano → mês → arquivo Nº; sem a pasta
 * do ano, ou com o ano sem o mês, vale a estrutura antiga cliente → mês) e, se
 * achar, grava o ID do arquivo e a URL pública. Não muda o status do post.
 *
 * Convenções aceitas na pasta do mês (ver docs/08-DRIVE-ESTRUTURA.md):
 * - single (feed/reels): "N.ext" (também "03.ext", "3 - Título.ext");
 * - story: "Nstory.ext" ("3 story", "3-story", "03_STORY"…), na pasta do mês
 *   ou dentro da subpasta "N/"; o 2º story com o mesmo N usa "Nstory2.ext",
 *   o 3º "Nstory3.ext"…;
 * - carrossel: subpasta "N" com as mídias (arquivos de story ficam de fora),
 *   OU arquivos "N-1.ext", "N-2.ext"… soltos na pasta do mês (2+ arquivos).
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

  const result: SyncResult = {
    attached: 0,
    checked: eligible.length,
    skipped: [],
    missing: [],
    layout: [],
    ambiguous: [],
  };
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

  const clientFolderCache = new Map<string, string | null>();
  /** cliente → a pasta salva no cadastro fica dentro da raiz? */
  const savedFolderOk = new Map<string, boolean>();
  // chave com o ano: a mesma pasta de cliente tem um "outubro" por ano
  const monthFolderCache = new Map<string, MonthFolderResolution>();

  for (const { client, monthKey, posts } of groups.values()) {
    // pasta do cliente (override por ID, ou busca pelo nome sem caixa nem acento).
    // OWASP AUD2-08: o ID salvo só vale se a pasta ficar dentro da raiz dos clientes
    if (client.driveFolderId) {
      let ok = savedFolderOk.get(client.id);
      if (ok === undefined) {
        ok = await isInsideRoot(client.driveFolderId);
        savedFolderOk.set(client.id, ok);
        if (!ok) result.skipped.push({ client: client.name, reason: SAVED_FOLDER_OUTSIDE });
      }
      if (!ok) continue;
    }
    let clientFolderId = client.driveFolderId ?? clientFolderCache.get(client.id) ?? null;
    if (!clientFolderId) {
      clientFolderId = await findFolder(client.name, rootId);
      clientFolderCache.set(client.id, clientFolderId);
    }
    if (!clientFolderId) {
      result.skipped.push({
        client: client.name,
        reason: `pasta do cliente "${client.name}" não encontrada no Drive`,
      });
      continue;
    }

    // pasta do mês: Cliente/AAAA/<mês> → estrutura antiga Cliente/<mês>
    const { year: y, month: m } = parseMonthKey(monthKey);
    const monthCacheKey = `${clientFolderId}:${monthKey}`;
    let folder = monthFolderCache.get(monthCacheKey);
    if (!folder) {
      folder = await resolveMonthFolder(listFolders, clientFolderId, y, m, client.name);
      monthFolderCache.set(monthCacheKey, folder);
    }
    const resolved = folder;
    const monthFolderId = resolved.folderId;
    const pathTo = (file: string) => drivePathLabel(client.name, y, m, file, resolved.layout, resolved);
    result.layout.push({
      client: client.name,
      month: monthKey,
      layout: resolved.layout,
      path: monthFolderId ? pathTo("") : resolved.path,
    });
    if (!monthFolderId) {
      result.skipped.push({
        client: client.name,
        reason: `pasta do mês não encontrada no Drive (esperado "${resolved.path}")`,
      });
      continue;
    }
    if (resolved.ambiguous.length > 0) {
      result.ambiguous.push({
        client: client.name,
        path: client.name,
        chosen: [resolved.yearFolderName, resolved.monthFolderName].filter(Boolean).join("/"),
        candidates: resolved.ambiguous,
      });
    }

    const noteAmbiguous = (post: string, path: string, pick: { file: DriveFile | null; ambiguous: string[] }) => {
      if (pick.file && pick.ambiguous.length > 1) {
        result.ambiguous.push({ client: client.name, post, path, chosen: pick.file.name, candidates: pick.ambiguous });
      }
    };

    // numeração do mês entre TODOS os posts do cliente (stories não contam —
    // herdam o índice do post principal que os acompanha; o 2º story com o
    // mesmo N usa "Nstory2", o 3º "Nstory3"…)
    const fileNameById = await monthFileNamesFor(client.id, monthKey);

    for (const post of posts) {
      const fileName = fileNameById.get(post.id);
      if (!fileName) continue;
      const idx = fileName.index;
      const label = `post ${idx}${post.theme ? ` (${post.theme.slice(0, 40)})` : ""}`;

      // STORY: sempre arquivo único "Nstory"/"Nstory2"… (nunca vira
      // carrossel); procura na pasta do mês e, se não achar, dentro da
      // subpasta "N/"
      if (post.format === "story") {
        const ordinal = fileName.storyOrdinal ?? 1;
        let pick = await findMediaForIndex(monthFolderId, idx, true, ordinal);
        noteAmbiguous(label, pathTo(""), pick);
        if (!pick.file) {
          const subId = await findFolderForIndex(monthFolderId, idx);
          if (subId) {
            pick = await findStoryInFolder(subId, idx, ordinal);
            noteAmbiguous(label, pathTo(String(idx)), pick);
          }
        }
        const file = pick.file;
        if (!file) {
          result.missing.push({ client: client.name, post: label, expected: pathTo(`${fileName.fileStem}.jpg`) });
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
          const pick = await findMediaForIndex(monthFolderId, idx, false);
          noteAmbiguous(label, pathTo(""), pick);
          if (pick.file) {
            const item = await hostOnR2(pick.file, client.id, post.id, 1);
            await prisma.post.update({
              where: { id: post.id },
              data: { mediaDriveId: item.driveId, mediaUrl: item.url, mediaItems: Prisma.JsonNull },
            });
            result.attached++;
          } else {
            result.missing.push({
              client: client.name,
              post: label,
              expected: `${pathTo(`${idx}/`)} — subpasta com os slides (ou ${idx}-1.jpg, ${idx}-2.jpg… soltos)`,
            });
          }
          continue;
        }
      } else if (post.format === "carrossel") {
        result.skipped.push({
          client: client.name,
          reason: `carrossel (post ${idx}, ${pathTo(`${idx}/`)}) precisa do armazenamento de mídia configurado no servidor`,
        });
        continue;
      }

      // SINGLE (feed / reels): arquivo "N"
      const pick = await findMediaForIndex(monthFolderId, idx, false);
      noteAmbiguous(label, pathTo(""), pick);
      const file = pick.file;
      if (!file) {
        result.missing.push({
          client: client.name,
          post: label,
          expected: pathTo(post.format === "reels" ? `${idx}.mp4` : `${idx}.jpg`),
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

/**
 * Pasta do cliente no Drive: ID salvo no cadastro > pasta com o mesmo nome na
 * raiz (sem caixa nem acento) > cria. O ID resolvido fica salvo no cliente,
 * para não consultar o Drive de novo.
 */
export async function ensureClientDriveFolder(client: {
  id: string;
  name: string;
  driveFolderId: string | null;
}): Promise<string> {
  if (client.driveFolderId) {
    // OWASP AUD2-08: nunca grava (pastas do mês, artes) numa pasta fora da raiz dos clientes
    if (!(await isInsideRoot(client.driveFolderId))) throw new Error(FOLDER_OUTSIDE_ROOT);
    return client.driveFolderId;
  }
  const clientFolderId = await ensureFolder(client.name, process.env.DRIVE_ROOT_FOLDER_ID!);
  await prisma.client.update({ where: { id: client.id }, data: { driveFolderId: clientFolderId } });
  return clientFolderId;
}

/** Pasta de mês preparada ao gravar um cronograma. */
export type PreparedMonthFolder = {
  /** "AAAA-MM" */
  month: string;
  layout: DriveLayout;
  /** "Cliente/2026/10 - Outubro" ou "Cliente/outubro (estrutura antiga)" */
  path: string;
  /** pastas criadas agora ("2026", "10 - Outubro"); vazio se já existiam */
  created: string[];
};

export type DriveFoldersStatus =
  | { status: "indisponivel" }
  | { status: "ok" | "falhou"; folders: PreparedMonthFolder[] };

const DRIVE_PREPARE_TIMEOUT_MS = 15_000;

/**
 * Best-effort, depois de gravar um cronograma: garante a pasta do cliente e as
 * pastas ano/mês de cada mês tocado, para a equipe já saber onde pôr as artes.
 * NUNCA lança: sem Drive → "indisponivel"; falha ou demora → "falhou" com um
 * `driveWarning` amigável (o detalhe técnico vai só para o log).
 */
export async function prepareClientDriveFolders(
  client: { id: string; name: string; driveFolderId: string | null },
  monthKeys: readonly string[]
): Promise<{ drive: DriveFoldersStatus; driveWarning?: string }> {
  if (!driveConfigured()) return { drive: { status: "indisponivel" } };

  const folders: PreparedMonthFolder[] = [];
  const work = (async () => {
    const clientFolderId = await ensureClientDriveFolder(client);
    for (const month of [...new Set(monthKeys)].sort()) {
      const r = await ensureYearMonthFolders(clientFolderId, month, client.name);
      folders.push({ month, layout: r.layout, path: r.path, created: r.created });
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error("O Google Drive demorou a responder."));
    }, DRIVE_PREPARE_TIMEOUT_MS);
  });

  try {
    await Promise.race([work, timeout]);
    return { drive: { status: "ok", folders: [...folders] } };
  } catch (e) {
    console.error(`[drive] falha ao preparar as pastas do cliente ${client.id}:`, e);
    if (timedOut) {
      // o trabalho segue em segundo plano; uma falha posterior também vai para o log
      work.catch((late) => console.error(`[drive] pastas do cliente ${client.id} (após o tempo-limite):`, late));
    }
    return {
      drive: { status: "falhou", folders: [...folders] },
      driveWarning: `Cronograma salvo, mas as pastas do mês não foram preparadas no Google Drive. ${toUserMessage(e)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
