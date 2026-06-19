// Valida o fluxo de sync Drive→post espelhando EXATAMENTE a lógica de
// drive-sync.ts (janela de elegibilidade + índice no mês + resolução no Drive).
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "..", "..", "web", ".env") });
const { Pool } = require("pg");

const SA_FILE = path.resolve(path.join(__dirname, "..", "..", "web"), process.env.GOOGLE_SERVICE_ACCOUNT_FILE);
const ROOT = process.env.DRIVE_ROOT_FOLDER_ID;
const BASE = (process.env.SYSTEM_BASE_URL || "").replace(/\/$/, "");
const SECRET = process.env.MEDIA_SIGNING_SECRET;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function token() {
  const sa = JSON.parse(fs.readFileSync(SA_FILE, "utf8"));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const sig = crypto.createSign("RSA-SHA256").update(input).sign(sa.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${input}.${sig}` }) });
  return (await res.json()).access_token;
}
async function list(tk, q) {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q); url.searchParams.set("fields", "files(id,name,mimeType)");
  url.searchParams.set("supportsAllDrives", "true"); url.searchParams.set("includeItemsFromAllDrives", "true");
  return (await (await fetch(url, { headers: { Authorization: `Bearer ${tk}` } })).json()).files || [];
}
const folderQ = (p) => `'${p}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
const findFolder = (files, name) => files.find((f) => f.name.trim().toLowerCase() === name.trim().toLowerCase());

(async () => {
  const c = await pool.query(`SELECT id, name FROM clients WHERE name ILIKE 'Coletivo Estudio' LIMIT 1`);
  const client = c.rows[0];
  console.log("Cliente:", client.name);

  // slate limpo: remove posts de teste de junho/2026 deste cliente
  await pool.query(`DELETE FROM posts WHERE client_id=$1 AND scheduled_at >= '2026-06-01' AND scheduled_at < '2026-07-01'`, [client.id]);

  // cria 1 post agendado DENTRO da janela (futuro próximo), sem mídia
  const future = new Date(Date.now() + 3 * 86400000).toISOString();
  const ins = await pool.query(
    `INSERT INTO posts (client_id, theme, scheduled_at, targets, status) VALUES ($1,'Teste sync Drive',$2,$3,'scheduled') RETURNING id, scheduled_at`,
    [client.id, future, ["instagram", "facebook"]]
  );
  const postId = ins.rows[0].id;
  console.log("Post criado (sem mídia):", postId, "em", ins.rows[0].scheduled_at);

  // === espelho de syncMedia ===
  const now = Date.now();
  const lo = new Date(now - 2 * 86400000), hi = new Date(now + 30 * 86400000);
  const eligible = await pool.query(
    `SELECT id, scheduled_at FROM posts WHERE client_id=$1 AND status='scheduled' AND (media_url IS NULL OR media_url='') AND scheduled_at >= $2 AND scheduled_at < $3 ORDER BY scheduled_at`,
    [client.id, lo, hi]
  );
  console.log("Posts elegíveis na janela:", eligible.rows.length);
  if (!eligible.rows.length) { console.log("✗ nada elegível (janela)"); return pool.end(); }

  // índice no mês (todos os posts de junho)
  const monthStart = "2026-06-01T00:00:00-03:00", nextMonth = "2026-07-01T00:00:00-03:00";
  const monthPosts = await pool.query(`SELECT id FROM posts WHERE client_id=$1 AND scheduled_at >= $2 AND scheduled_at < $3 ORDER BY scheduled_at`, [client.id, monthStart, nextMonth]);
  const indexById = new Map(monthPosts.rows.map((r, i) => [r.id, i + 1]));

  const tk = await token();
  const clientFolder = findFolder(await list(tk, folderQ(ROOT)), client.name);
  const monthFolder = clientFolder && findFolder(await list(tk, folderQ(clientFolder.id)), "junho");
  if (!monthFolder) { console.log("✗ pasta cliente/mês não encontrada"); return pool.end(); }
  const imgs = await list(tk, `'${monthFolder.id}' in parents and trashed=false and mimeType contains 'image/'`);

  let attached = 0;
  for (const row of eligible.rows) {
    const idx = indexById.get(row.id);
    const img = imgs.find((f) => { const d = f.name.lastIndexOf("."); return (d > 0 ? f.name.slice(0, d) : f.name) === String(idx); });
    if (!img) { console.log(`  post ${row.id} (idx ${idx}): sem imagem`); continue; }
    const mediaUrl = `${BASE}/api/media/${row.id}?sig=${crypto.createHmac("sha256", SECRET).update(row.id).digest("hex")}`;
    await pool.query(`UPDATE posts SET media_url=$1, media_drive_id=$2 WHERE id=$3`, [mediaUrl, img.id, row.id]);
    console.log(`  ✓ post ${row.id} (idx ${idx}) → ${img.name}`);
    attached++;
  }
  console.log(`\nRESULTADO: ${attached} anexada(s) de ${eligible.rows.length} verificada(s)`);
  await pool.end();
})().catch(async (e) => { console.error("ERRO:", e.message); await pool.end(); process.exit(1); });
