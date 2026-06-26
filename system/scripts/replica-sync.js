// Réplica fiel de drive-sync.ts (NOVO: feed/reels/story/carrossel + R2).
// Roda contra Drive + R2 + DB reais. Valida a lógica sem depender do deploy.
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "..", "..", "web", ".env") });
const { Pool } = require("pg");

const E = process.env;
const SA_FILE = path.resolve(path.join(__dirname, "..", "..", "web"), E.GOOGLE_SERVICE_ACCOUNT_FILE);
const ROOT = E.DRIVE_ROOT_FOLDER_ID;
const pool = new Pool({ connectionString: E.DATABASE_URL });

// ---- Drive ----
async function gtoken() {
  const sa = JSON.parse(fs.readFileSync(SA_FILE, "utf8"));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const inp = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const sig = crypto.createSign("RSA-SHA256").update(inp).sign(sa.private_key, "base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${inp}.${sig}` }) });
  return (await r.json()).access_token;
}
async function dlist(tk, q) {
  const u = new URL("https://www.googleapis.com/drive/v3/files");
  u.searchParams.set("q", q); u.searchParams.set("fields", "files(id,name,mimeType)");
  u.searchParams.set("supportsAllDrives", "true"); u.searchParams.set("includeItemsFromAllDrives", "true");
  return (await (await fetch(u, { headers: { Authorization: `Bearer ${tk}` } })).json()).files || [];
}
const isMedia = (f) => f.mimeType.startsWith("image/") || f.mimeType.startsWith("video/");
const stem = (n) => { const d = n.lastIndexOf("."); return (d > 0 ? n.slice(0, d) : n).trim(); };
async function findFolder(tk, name, parent) {
  const fs2 = await dlist(tk, `'${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  return fs2.find((f) => f.name.trim().toLowerCase() === name.trim().toLowerCase()) || null;
}
async function findMedia(tk, folder, base) {
  const fs2 = await dlist(tk, `'${folder}' in parents and trashed=false`);
  return fs2.find((f) => isMedia(f) && stem(f.name) === base) || null;
}
async function listMedia(tk, folder) {
  const fs2 = (await dlist(tk, `'${folder}' in parents and trashed=false`)).filter(isMedia);
  return fs2.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true }));
}
async function download(tk, id) {
  const u = `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${tk}` } });
  return { buffer: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get("content-type") || "application/octet-stream" };
}
// ---- R2 (SigV4 PUT) ----
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
async function r2put(key, body, ct) {
  const acc = E.R2_ACCOUNT_ID, ak = E.R2_ACCESS_KEY_ID, sk = E.R2_SECRET_ACCESS_KEY, bucket = E.R2_BUCKET, pub = E.R2_PUBLIC_BASE_URL.replace(/\/$/, "");
  const host = `${acc}.r2.cloudflarestorage.com`;
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""); const date = now.slice(0, 8);
  const ph = sha(body); const uri = `/${bucket}/${key}`;
  const ch = `host:${host}\nx-amz-content-sha256:${ph}\nx-amz-date:${now}\n`;
  const sh = "host;x-amz-content-sha256;x-amz-date";
  const cr = ["PUT", uri, "", ch, sh, ph].join("\n");
  const scope = `${date}/auto/s3/aws4_request`;
  const sts = ["AWS4-HMAC-SHA256", now, scope, sha(Buffer.from(cr))].join("\n");
  const ks = hmac(hmac(hmac(hmac(`AWS4${sk}`, date), "auto"), "s3"), "aws4_request");
  const sigv = crypto.createHmac("sha256", ks).update(sts).digest("hex");
  const auth = `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${sh}, Signature=${sigv}`;
  const r = await fetch(`https://${host}${uri}`, { method: "PUT", headers: { Authorization: auth, "x-amz-content-sha256": ph, "x-amz-date": now, "Content-Type": ct }, body: new Uint8Array(body) });
  if (!r.ok) throw new Error(`R2 ${r.status}: ${(await r.text()).slice(0, 150)}`);
  return `${pub}/${key}`;
}
const mtype = (m) => (m.startsWith("video/") ? "video" : "image");
async function host(tk, file, clientId, postId, ord) {
  const { buffer, contentType } = await download(tk, file.id);
  const d = file.name.lastIndexOf("."); const ext = d > 0 ? file.name.slice(d + 1).toLowerCase() : "jpg";
  const url = await r2put(`${clientId}/${postId}-${ord}.${ext}`, buffer, contentType || `image/${ext}`);
  return { url, driveId: file.id, type: mtype(file.mimeType) };
}

(async () => {
  const tk = await gtoken();
  const c = await pool.query("SELECT id,name,drive_folder_id FROM clients WHERE name ILIKE 'Coletivo Estudio' LIMIT 1");
  const client = c.rows[0];
  const clientFolder = client.drive_folder_id ? { id: client.drive_folder_id } : await findFolder(tk, client.name, ROOT);
  const monthFolder = await findFolder(tk, "junho", clientFolder.id);
  console.log("Cliente:", client.name, "| Junho:", monthFolder?.id);

  const eligible = await pool.query(
    "SELECT id,format FROM posts WHERE client_id=$1 AND status IN ('draft','scheduled') AND (media_url IS NULL OR media_url='') AND scheduled_at >= '2026-06-23' AND scheduled_at < '2026-07-25' ORDER BY scheduled_at",
    [client.id]
  );
  const monthPosts = await pool.query(
    "SELECT id FROM posts WHERE client_id=$1 AND scheduled_at >= '2026-06-01T00:00:00-03:00' AND scheduled_at < '2026-07-01T00:00:00-03:00' ORDER BY scheduled_at",
    [client.id]
  );
  const idxById = new Map(monthPosts.rows.map((r, i) => [r.id, i + 1]));

  let attached = 0;
  for (const post of eligible.rows) {
    const idx = idxById.get(post.id);
    if (!idx) continue;
    try {
      if (post.format === "carrossel") {
        const sub = await findFolder(tk, String(idx), monthFolder.id);
        if (!sub) { console.log(`  ${idx} carrossel: subpasta ${idx}/ não achada`); continue; }
        const files = await listMedia(tk, sub.id);
        if (!files.length) { console.log(`  ${idx} carrossel: vazia`); continue; }
        const items = [];
        for (let i = 0; i < files.length; i++) items.push(await host(tk, files[i], client.id, post.id, i + 1));
        await pool.query("UPDATE posts SET media_items=$1, media_url=$2, media_drive_id=$3 WHERE id=$4", [JSON.stringify(items), items[0].url, items[0].driveId, post.id]);
        console.log(`  ✓ ${idx} carrossel: ${items.length} itens (${items.map((x) => x.type).join(",")})`);
        attached++; continue;
      }
      const base = post.format === "story" ? `${idx}story` : String(idx);
      const file = await findMedia(tk, monthFolder.id, base);
      if (!file) { console.log(`  ${idx} ${post.format}: "${base}" não achado`); continue; }
      const it = await host(tk, file, client.id, post.id, 1);
      await pool.query("UPDATE posts SET media_url=$1, media_drive_id=$2, media_items=NULL WHERE id=$3", [it.url, it.driveId, post.id]);
      console.log(`  ✓ ${idx} ${post.format}: ${file.name} (${it.type}) → ${it.url}`);
      attached++;
    } catch (e) { console.log(`  ✗ ${idx} ${post.format}: ${e.message}`); }
  }
  console.log(`\nattached ${attached}/${eligible.rows.length}`);
  await pool.end();
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
