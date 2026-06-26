const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "..", "..", "web", ".env") });
const { Pool } = require("pg");
const E = process.env;
const G = "https://graph.facebook.com/v21.0";
const p = new Pool({ connectionString: E.DATABASE_URL });
function dec(e) { const k = Buffer.from(E.TOKEN_ENC_KEY, "hex"); const b = Buffer.from(e, "base64"); const d = crypto.createDecipheriv("aes-256-gcm", k, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"); }
const pf = (t) => crypto.createHmac("sha256", E.META_APP_SECRET).update(t).digest("hex");
async function g(m, pa, pr, t) { const u = new URL(G + pa); u.searchParams.set("access_token", t); u.searchParams.set("appsecret_proof", pf(t)); if (m === "GET") for (const [k, v] of Object.entries(pr)) u.searchParams.set(k, v); const o = { method: m }; if (m === "POST") { o.headers = { "Content-Type": "application/x-www-form-urlencoded" }; o.body = new URLSearchParams(pr); } const r = await fetch(u, o); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.error?.message || r.status); return j; }

(async () => {
  const a = await p.query("SELECT external_id, access_token_enc FROM social_accounts WHERE platform='facebook' AND status='active' LIMIT 1");
  const page = a.rows[0].external_id; const tok = dec(a.rows[0].access_token_enc);
  const posts = await p.query("SELECT format, media_url, media_items FROM posts WHERE scheduled_at >= '2026-06-01' AND scheduled_at < '2026-07-01'");
  const carrossel = posts.rows.find((x) => x.format === "carrossel");
  const storyImg = posts.rows.find((x) => x.format === "story" && /\.(jpg|jpeg|png|webp)$/i.test(x.media_url || ""));
  const storyVid = posts.rows.find((x) => x.format === "story" && /\.(mp4|mov)$/i.test(x.media_url || ""));
  const res = [];

  // FB carrossel (multi-foto attached_media)
  try {
    const imgs = (carrossel.media_items || []).filter((m) => m.type === "image");
    const fbids = [];
    for (const it of imgs) { const r = await g("POST", `/${page}/photos`, { url: it.url, published: "false" }, tok); fbids.push(r.id); }
    const r = await g("POST", `/${page}/feed`, { message: "Teste carrossel FB", attached_media: JSON.stringify(fbids.map((id) => ({ media_fbid: id }))) }, tok);
    res.push(`FB carrossel: OK ${r.id} (${fbids.length} fotos)`);
  } catch (e) { res.push(`FB carrossel: ERRO ${e.message}`); }

  // FB story imagem (photo_stories)
  try {
    const ph = await g("POST", `/${page}/photos`, { url: storyImg.media_url, published: "false" }, tok);
    const r = await g("POST", `/${page}/photo_stories`, { photo_id: ph.id }, tok);
    res.push(`FB story-img: OK ${JSON.stringify(r)}`);
  } catch (e) { res.push(`FB story-img: ERRO ${e.message}`); }

  // FB story vídeo (video_stories: start -> rupload file_url -> finish)
  try {
    const start = await g("POST", `/${page}/video_stories`, { upload_phase: "start" }, tok);
    const up = await fetch(start.upload_url, { method: "POST", headers: { Authorization: `OAuth ${tok}`, file_url: storyVid.media_url } });
    const upj = await up.json().catch(() => ({}));
    if (!up.ok || upj.success === false) throw new Error("rupload: " + JSON.stringify(upj).slice(0, 150));
    const fin = await g("POST", `/${page}/video_stories`, { upload_phase: "finish", video_id: start.video_id }, tok);
    res.push(`FB story-vid: OK ${JSON.stringify(fin)}`);
  } catch (e) { res.push(`FB story-vid: ERRO ${e.message}`); }

  res.forEach((x) => console.log(x));
  await p.end();
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
