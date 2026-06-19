const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", "web", ".env") });
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  console.log("== Efeito do WF-03 (retry) no post failed ==");
  const retried = await pool.query(
    `SELECT id, status, retry_count, scheduled_at, last_error
     FROM posts WHERE id = '10419435-6b9a-4e41-8b59-3ed9b9626a42'`
  );
  console.log(retried.rows[0] ?? "(post não encontrado)");

  console.log("\n== Posts presos em 'publishing' (lock do WF-01 sem conclusão) ==");
  const stuck = await pool.query(`SELECT id, theme, media_url FROM posts WHERE status='publishing'`);
  console.table(stuck.rows);

  // reseta presos -> scheduled
  const reset = await pool.query(
    `UPDATE posts SET status='scheduled' WHERE status='publishing' RETURNING id`
  );
  console.log(`Resetados para 'scheduled': ${reset.rowCount}`);

  // remove posts de placeholder antigos (media inválida do seed original)
  const del = await pool.query(
    `DELETE FROM posts WHERE media_url LIKE '%<URL_PUBLICA%' RETURNING id`
  );
  console.log(`Posts placeholder removidos: ${del.rowCount}`);

  console.log("\n== Contas sociais do cliente de teste ==");
  const accs = await pool.query(
    `SELECT platform, external_id, status, daily_post_limit
     FROM social_accounts WHERE client_id='11111111-1111-1111-1111-111111111111'`
  );
  console.table(accs.rows.length ? accs.rows : [{ info: "nenhuma conta cadastrada" }]);

  console.log("\n== Posts 'scheduled' restantes ==");
  const sched = await pool.query(
    `SELECT id, theme, status, scheduled_at FROM posts WHERE status='scheduled' ORDER BY scheduled_at`
  );
  console.table(sched.rows);

  await pool.end();
})().catch(async (e) => {
  console.error("ERRO:", e.message);
  await pool.end();
  process.exit(1);
});
