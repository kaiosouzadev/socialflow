const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "..", "..", "web", ".env") });
const { Pool } = require("pg");
const E = process.env;
const GRAPH = "https://graph.facebook.com/v21.0";
const pool = new Pool({ connectionString: E.DATABASE_URL });
function decrypt(enc) {
  const key = Buffer.from(E.TOKEN_ENC_KEY, "hex");
  const buf = Buffer.from(enc, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}
const proof = (t) => crypto.createHmac("sha256", E.META_APP_SECRET).update(t).digest("hex");
async function graph(method, p, params, token) {
  const u = new URL(`${GRAPH}${p}`);
  u.searchParams.set("access_token", token); u.searchParams.set("appsecret_proof", proof(token));
  if (method === "GET") for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const opt = { method };
  if (method === "POST") { opt.headers = { "Content-Type": "application/x-www-form-urlencoded" }; opt.body = new URLSearchParams(params); }
  const r = await fetch(u, opt); const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`);
  return j;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(id, token) {
  for (let i = 0; i < 24; i++) {
    const s = await graph("GET", `/${id}`, { fields: "status_code" }, token);
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR") throw new Error("ERROR no processamento");
    await sleep(3000);
  }
  throw new Error("timeout");
}
(async () => {
  const acc = await pool.query("SELECT external_id, access_token_enc FROM social_accounts WHERE platform='instagram' AND status='active' LIMIT 1");
  const ig = acc.rows[0]; const tok = decrypt(ig.access_token_enc);
  const posts = await pool.query("SELECT format, media_url, captions FROM posts WHERE scheduled_at >= '2026-06-01' AND scheduled_at < '2026-07-01'");
  const feed = posts.rows.find((p) => p.format === "feed");
  const story = posts.rows.find((p) => p.format === "story");
  const res = [];
  try {
    const c = await graph("POST", `/${ig.external_id}/media`, { image_url: feed.media_url, caption: (feed.captions && feed.captions.instagram) || "Teste" }, tok);
    await poll(c.id, tok);
    const r = await graph("POST", `/${ig.external_id}/media_publish`, { creation_id: c.id }, tok);
    res.push(`IG feed: OK ${r.id}`);
  } catch (e) { res.push(`IG feed: ERRO ${e.message}`); }
  try {
    const c = await graph("POST", `/${ig.external_id}/media`, { media_type: "STORIES", image_url: story.media_url }, tok);
    await poll(c.id, tok);
    const r = await graph("POST", `/${ig.external_id}/media_publish`, { creation_id: c.id }, tok);
    res.push(`IG story-img: OK ${r.id}`);
  } catch (e) { res.push(`IG story-img: ERRO ${e.message}`); }
  res.forEach((x) => console.log(x));
  await pool.end();
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
