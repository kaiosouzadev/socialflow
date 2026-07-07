import { createSign } from "crypto";

/**
 * Cliente mínimo da Google Drive API v3 usando uma service account.
 * Assina o JWT com node:crypto (RS256) e troca por um access token — sem
 * depender do SDK googleapis. Leitura + escrita (a SA precisa de permissão
 * de Editor na pasta raiz compartilhada para criar pastas/arquivos).
 *
 * A service account pode ser fornecida de duas formas (a primeira encontrada vence):
 *   1. GOOGLE_SERVICE_ACCOUNT_JSON — JSON completo inline (recomendado para Vercel/produção)
 *   2. GOOGLE_SERVICE_ACCOUNT_FILE — caminho relativo ao cwd para um arquivo .json (dev local)
 */

type ServiceAccount = { client_email: string; private_key: string };
type DriveFile = { id: string; name: string; mimeType: string };

let cachedSA: ServiceAccount | null = null;
let cachedToken: { value: string; expiresAt: number } | null = null;

function loadServiceAccount(): ServiceAccount {
  if (cachedSA) return cachedSA;

  let raw: string | undefined;

  // 1) Inline JSON (produção / Vercel) — aceita JSON puro OU base64 do JSON
  const inlineJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (inlineJson) {
    raw = inlineJson.startsWith("{")
      ? inlineJson
      : Buffer.from(inlineJson, "base64").toString("utf8");
  }

  // 2) Arquivo local (dev) — totalmente oculto do Turbopack via eval
  if (!raw) {
    const rel = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
    if (!rel) {
      throw new Error(
        "Nenhuma service account configurada. " +
        "Defina GOOGLE_SERVICE_ACCOUNT_JSON (produção) ou GOOGLE_SERVICE_ACCOUNT_FILE (dev)."
      );
    }
    // eslint-disable-next-line no-eval
    const _require = eval("require") as NodeRequire;
    const nodePath: typeof import("path") = _require("path");
    const nodeFs: typeof import("fs") = _require("fs");
    const file = nodePath.resolve(process.cwd(), rel);
    raw = nodeFs.readFileSync(file, "utf8");
  }

  const json = JSON.parse(raw);
  if (!json.client_email || !json.private_key) {
    throw new Error("JSON da service account inválido");
  }
  // normaliza quebras de linha escapadas (\n literais) na chave privada —
  // pitfall comum ao colar a chave em variável de ambiente na Vercel
  cachedSA = {
    client_email: json.client_email,
    private_key: String(json.private_key).replace(/\\n/g, "\n"),
  };
  return cachedSA;
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value;

  const sa = loadServiceAccount();
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT" });
  const claim = b64({
    iss: sa.client_email,
    // escopo com escrita: o plano básico salva as artes geradas no Drive
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });
  const signingInput = `${header}.${claim}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(sa.private_key, "base64url");
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Falha ao autenticar no Google: ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  cachedToken = { value: data.access_token, expiresAt: now + (data.expires_in ?? 3600) };
  return cachedToken.value;
}

function escapeQ(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function driveList(q: string): Promise<DriveFile[]> {
  const token = await getAccessToken();
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q);
  url.searchParams.set("fields", "files(id,name,mimeType)");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Drive list falhou: ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.files ?? [];
}

/**
 * Lista as subpastas (não-lixeira) de um pai, ordenadas por nome (pt-BR).
 * Usado pelo seletor visual de pasta do cliente.
 */
export async function listFolders(parentId: string): Promise<{ id: string; name: string }[]> {
  const q =
    `'${escapeQ(parentId)}' in parents ` +
    `and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const files = await driveList(q);
  return files
    .map((f) => ({ id: f.id, name: f.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/**
 * Acha uma subpasta pelo nome dentro de um pai, de forma case-insensitive
 * (ex.: "Junho" casa com "junho"). Lista as subpastas e compara no cliente.
 */
export async function findFolder(name: string, parentId: string): Promise<string | null> {
  const q =
    `'${escapeQ(parentId)}' in parents ` +
    `and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const files = await driveList(q);
  const target = name.trim().toLowerCase();
  const match = files.find((f) => f.name.trim().toLowerCase() === target);
  return match?.id ?? null;
}

function isMedia(f: DriveFile): boolean {
  return f.mimeType.startsWith("image/") || f.mimeType.startsWith("video/");
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).trim();
}

/**
 * Acha uma mídia (imagem OU vídeo) cujo nome sem extensão é exatamente
 * `baseName` (ex.: "1", "1story"). Corrige o bug que ignorava vídeos.
 */
export async function findMediaByBaseName(
  folderId: string,
  baseName: string
): Promise<DriveFile | null> {
  const q = `'${escapeQ(folderId)}' in parents and trashed = false`;
  const files = await driveList(q);
  return files.find((f) => isMedia(f) && stemOf(f.name) === baseName) ?? null;
}

/** Lista todas as mídias de uma pasta, ordenadas por nome (natural: 1,2,10). */
export async function listFolderMedia(folderId: string): Promise<DriveFile[]> {
  const q = `'${escapeQ(folderId)}' in parents and trashed = false`;
  const files = (await driveList(q)).filter(isMedia);
  return files.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true }));
}

/** Baixa os bytes de um arquivo do Drive. */
export async function downloadFile(
  fileId: string
): Promise<{ buffer: Buffer; contentType: string }> {
  const token = await getAccessToken();
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
  url.searchParams.set("alt", "media");
  url.searchParams.set("supportsAllDrives", "true");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Download falhou: ${res.status} ${detail.slice(0, 200)}`);
  }
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

export function driveConfigured(): boolean {
  const hasSA = !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !!process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  return hasSA && !!process.env.DRIVE_ROOT_FOLDER_ID;
}

/** Acha a subpasta pelo nome; se não existir, cria. Retorna o ID. */
export async function ensureFolder(name: string, parentId: string): Promise<string> {
  const existing = await findFolder(name, parentId);
  if (existing) return existing;

  const token = await getAccessToken();
  const res = await fetch(
    "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      }),
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Drive criar pasta falhou: ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.id as string;
}

/**
 * Sobe um arquivo para uma pasta do Drive (upload multipart). Se já existir
 * arquivo com o mesmo nome na pasta, substitui o conteúdo (evita duplicatas
 * ao regerar a arte).
 */
export async function uploadToDrive(
  name: string,
  parentId: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const token = await getAccessToken();

  // já existe? → update de conteúdo (media upload) no mesmo arquivo
  const q = `'${escapeQ(parentId)}' in parents and name = '${escapeQ(name)}' and trashed = false`;
  const found = await driveList(q);
  const existing = found[0];

  const boundary = "sfmedia" + Date.now().toString(36);
  const metadata = existing ? { name } : { name, parents: [parentId] };
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([head, buffer, tail]);

  const url = existing
    ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart&supportsAllDrives=true&fields=id`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id";

  const res = await fetch(url, {
    method: existing ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: new Uint8Array(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Drive upload falhou: ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.id as string;
}
