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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const a = await p.query("SELECT external_id, access_token_enc FROM social_accounts WHERE platform='facebook' AND status='active' LIMIT 1");
  const page = a.rows[0].external_id; const tok = dec(a.rows[0].access_token_enc);
  const c = await p.query("SELECT media_items FROM posts WHERE format='carrossel' AND scheduled_at >= '2026-06-01' AND scheduled_at < '2026-07-01' LIMIT 1");
  const items = c.rows[0].media_items || [];
  console.log("itens:", items.map((i) => i.type).join(","));

  const fbids = [];
  for (const it of items) {
    if (it.type === "video") {
      const v = await g("POST", `/${page}/videos`, { file_url: it.url, published: "false" }, tok);
      // espera o vídeo processar o suficiente para anexar
      for (let i = 0; i < 30; i++) {
        const s = await g("GET", `/${v.id}`, { fields: "status" }, tok).catch(() => null);
        const st = s && s.status && (s.status.video_status || s.status.processing_phase?.status);
        if (st === "ready" || st === "complete") break;
        await sleep(4000);
      }
      fbids.push(v.id);
    } else {
      const ph = await g("POST", `/${page}/photos`, { url: it.url, published: "false" }, tok);
      fbids.push(ph.id);
    }
  }
  try {
    const r = await g("POST", `/${page}/feed`, { message: "Teste carrossel FB com vídeo", attached_media: JSON.stringify(fbids.map((id) => ({ media_fbid: id }))) }, tok);
    console.log("FB carrossel+vídeo: OK", r.id, "| ids:", fbids.join(","));
  } catch (e) { console.log("FB carrossel+vídeo: ERRO", e.message, "| ids:", fbids.join(",")); }
  await p.end();
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
