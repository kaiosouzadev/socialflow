const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", "web", ".env") });
const { Pool } = require("pg");
const p = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const c = await p.query("SELECT id FROM clients WHERE name ILIKE 'Coletivo Estudio' LIMIT 1");
  const clientId = c.rows[0].id;

  await p.query(
    "DELETE FROM posts WHERE client_id=$1 AND scheduled_at >= '2026-06-01' AND scheduled_at < '2026-07-01'",
    [clientId]
  );

  // índice 1..9, ascendente. formato por slot casa com o Drive:
  // 1 story(1story.jpg) 2 story(2story.mp4) 3-7 feed(N.jpg) 8 reels(8.mp4) 9 carrossel(pasta 9/)
  const slots = [
    ["2026-06-26T09:00:00-03:00", "story"],
    ["2026-06-26T15:00:00-03:00", "story"],
    ["2026-06-27T09:00:00-03:00", "feed"],
    ["2026-06-27T15:00:00-03:00", "feed"],
    ["2026-06-28T09:00:00-03:00", "feed"],
    ["2026-06-28T15:00:00-03:00", "feed"],
    ["2026-06-29T09:00:00-03:00", "feed"],
    ["2026-06-29T15:00:00-03:00", "reels"],
    ["2026-06-30T09:00:00-03:00", "carrossel"],
  ];
  const ids = [];
  for (let i = 0; i < slots.length; i++) {
    const [when, fmt] = slots[i];
    const r = await p.query(
      `INSERT INTO posts (client_id, theme, format, scheduled_at, targets, status, captions)
       VALUES ($1,$2,$3,$4,$5,'scheduled',$6) RETURNING id`,
      [
        clientId,
        `Teste ${i + 1} (${fmt})`,
        fmt,
        when,
        ["instagram", "facebook"],
        JSON.stringify({ instagram: `Legenda teste ${i + 1} #teste`, facebook: `Legenda teste ${i + 1}` }),
      ]
    );
    ids.push(`${i + 1}:${fmt}=${r.rows[0].id.slice(0, 8)}`);
  }
  console.log("Criados:", ids.join("  "));
  await p.end();
})();
