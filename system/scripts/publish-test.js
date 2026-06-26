// Testa publish REAL na Graph API (cobaia) por formato, usando tokens do DB + mídia R2.
const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "..", "..", "web", ".env") });
const { Pool } = require("pg");

const E = process.env;
const GRAPH = "https://graph.facebook.com/v21.0";
const pool = new Pool({ connectionString: E.DATABASE_URL });

// --- decrypt (replica lib/crypto.ts) ---
function decrypt(enc) {
  const key = Buffer.from(E.TOKEN_ENC_KEY, "hex");
  const buf = Buffer.from(enc, "base64");
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
const proof = (t) => crypto.createHmac("sha256", E.META_APP_SECRET).update(t).digest("hex");

async function graph(method, p, params, token) {
  const u = new URL(`${GRAPH}${p}`);
  u.searchParams.set("access_token", token);
  u.searchParams.set("appsecret_proof", proof(token));
  if (method === "GET") for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const opt = { method };
  if (method === "POST") { opt.headers = { "Content-Type": "application/x-www-form-urlencoded" }; opt.body = new URLSearchParams(params); }
  const r = await fetch(u, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`);
  return j;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(creationId, token, label) {
  for (let i = 0; i < 24; i++) {
    const s = await graph("GET", `/${creationId}`, { fields: "status_code,status" }, token);
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR") throw new Error(`${label} processamento ERROR: ${s.status}`);
    await sleep(5000);
  }
  throw new Error(`${label} timeout processando`);
}

async function igPublish(igId, token, creationId) {
  const r = await graph("POST", `/${igId}/media_publish`, { creation_id: creationId }, token);
  return r.id;
}

(async () => {
  const acc = await pool.query("SELECT platform, external_id, access_token_enc FROM social_accounts WHERE status='active'");
  const ig = acc.rows.find((a) => a.platform === "instagram");
  const fb = acc.rows.find((a) => a.platform === "facebook");
  const igTok = decrypt(ig.access_token_enc);
  const fbTok = decrypt(fb.access_token_enc);
  console.log("IG", ig.external_id, "| FB", fb.external_id);

  const posts = await pool.query(
    "SELECT id, format, media_url, media_items, captions FROM posts WHERE scheduled_at >= '2026-06-01' AND scheduled_at < '2026-07-01' ORDER BY scheduled_at"
  );
  const byFmt = {};
  for (const p of posts.rows) if (!byFmt[p.format]) byFmt[p.format] = p;
  const cap = (p, net) => (p.captions && p.captions[net]) || "Teste SocialFlow";
  const results = [];

  // ---- IG FEED (imagem) ----
  try {
    const p = byFmt.feed;
    const c = await graph("POST", `/${ig.external_id}/media`, { image_url: p.media_url, caption: cap(p, "instagram") }, igTok);
    const id = await igPublish(ig.external_id, igTok, c.id);
    results.push(`IG feed: OK ${id}`);
  } catch (e) { results.push(`IG feed: ERRO ${e.message}`); }

  // ---- IG STORY imagem ----
  try {
    const p = byFmt.story; // idx1 = story imagem
    const c = await graph("POST", `/${ig.external_id}/media`, { media_type: "STORIES", image_url: p.media_url }, igTok);
    const id = await igPublish(ig.external_id, igTok, c.id);
    results.push(`IG story-img: OK ${id}`);
  } catch (e) { results.push(`IG story-img: ERRO ${e.message}`); }

  // ---- IG REELS (vídeo) ----
  try {
    const p = byFmt.reels;
    const c = await graph("POST", `/${ig.external_id}/media`, { media_type: "REELS", video_url: p.media_url, caption: cap(p, "instagram") }, igTok);
    await poll(c.id, igTok, "IG reels");
    const id = await igPublish(ig.external_id, igTok, c.id);
    results.push(`IG reels: OK ${id}`);
  } catch (e) { results.push(`IG reels: ERRO ${e.message}`); }

  // ---- IG CARROSSEL ----
  try {
    const p = byFmt.carrossel;
    const items = p.media_items || [];
    const childIds = [];
    for (const it of items) {
      const isVid = it.type === "video";
      const params = isVid
        ? { media_type: "VIDEO", video_url: it.url, is_carousel_item: "true" }
        : { image_url: it.url, is_carousel_item: "true" };
      const c = await graph("POST", `/${ig.external_id}/media`, params, igTok);
      if (isVid) await poll(c.id, igTok, "IG carrossel item");
      childIds.push(c.id);
    }
    const parent = await graph("POST", `/${ig.external_id}/media`, { media_type: "CAROUSEL", children: childIds.join(","), caption: cap(p, "instagram") }, igTok);
    await poll(parent.id, igTok, "IG carrossel");
    const id = await igPublish(ig.external_id, igTok, parent.id);
    results.push(`IG carrossel: OK ${id} (${items.length} itens)`);
  } catch (e) { results.push(`IG carrossel: ERRO ${e.message}`); }

  // ---- FB FEED foto ----
  try {
    const p = byFmt.feed;
    const r = await graph("POST", `/${fb.external_id}/photos`, { url: p.media_url, caption: cap(p, "facebook") }, fbTok);
    results.push(`FB foto: OK ${r.id || r.post_id}`);
  } catch (e) { results.push(`FB foto: ERRO ${e.message}`); }

  // ---- FB vídeo ----
  try {
    const p = byFmt.reels;
    const r = await graph("POST", `/${fb.external_id}/videos`, { file_url: p.media_url, description: cap(p, "facebook") }, fbTok);
    results.push(`FB video: OK ${r.id}`);
  } catch (e) { results.push(`FB video: ERRO ${e.message}`); }

  console.log("\n=== RESULTADOS ===");
  results.forEach((r) => console.log(r));
  await pool.end();
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
