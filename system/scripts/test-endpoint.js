const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", "web", ".env") });
const { Pool } = require("pg");
const p = new Pool({ connectionString: E_db() });
function E_db() { return process.env.DATABASE_URL; }
const KEY = process.env.INTERNAL_API_KEY;

(async () => {
  const q = await p.query(
    "SELECT id FROM posts WHERE format='feed' AND media_url IS NOT NULL AND scheduled_at >= '2026-06-01' AND scheduled_at < '2026-07-01' LIMIT 1"
  );
  if (!q.rows.length) { console.log("nenhum post feed com mídia"); return p.end(); }
  const id = q.rows[0].id;
  console.log("post:", id);

  const r = await fetch(`http://localhost:3000/api/internal/publish/${id}`, {
    method: "POST",
    headers: { "x-internal-key": KEY },
  });
  console.log("HTTP", r.status, JSON.stringify(await r.json().catch(() => ({}))));

  const after = await p.query("SELECT status, media_url, media_items FROM posts WHERE id=$1", [id]);
  console.log("post depois:", JSON.stringify(after.rows[0]));
  const pubs = await p.query("SELECT platform, status, external_post_id, error FROM publications WHERE post_id=$1", [id]);
  console.log("publications:", JSON.stringify(pubs.rows));
  await p.end();
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
