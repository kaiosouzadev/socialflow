const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", "web", ".env") });
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const UNSPLASH =
  "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1080&q=80&fm=jpg";

(async () => {
  // usa o cliente de teste da agência (cria se não existir)
  let client = await pool.query(
    `SELECT id FROM clients WHERE email = 'web@coletivoestudio.com.br' LIMIT 1`
  );
  let clientId;
  if (client.rows.length === 0) {
    const r = await pool.query(
      `INSERT INTO clients (name, email, plan, tone_of_voice)
       VALUES ('Cliente Teste Agencia','web@coletivoestudio.com.br','sem_aprovacao','Tom profissional')
       RETURNING id`
    );
    clientId = r.rows[0].id;
    console.log("Cliente de teste criado:", clientId);
  } else {
    clientId = client.rows[0].id;
    console.log("Cliente de teste:", clientId);
  }

  // post pronto para sair agora (WF-01)
  const p1 = await pool.query(
    `INSERT INTO posts (client_id, theme, caption, media_url, scheduled_at, targets, status)
     VALUES ($1, 'Teste Unsplash', 'Primeiro post automatico do SocialFlow #teste', $2, now(), $3, 'scheduled')
     RETURNING id`,
    [clientId, UNSPLASH, ["instagram", "facebook"]]
  );
  console.log("Post (scheduled) criado:", p1.rows[0].id, "media:", UNSPLASH);

  // post falho para testar o WF-03 (retry com backoff)
  const p2 = await pool.query(
    `INSERT INTO posts (client_id, theme, caption, media_url, scheduled_at, targets, status, retry_count, last_error)
     VALUES ($1, 'Teste Retry', 'Post para validar backoff', $2, now() - interval '1 hour', $3, 'failed', 0, 'simulado')
     RETURNING id`,
    [clientId, UNSPLASH, ["instagram"]]
  );
  console.log("Post (failed) criado:", p2.rows[0].id);

  await pool.end();
})().catch(async (e) => {
  console.error("ERRO:", e.message);
  await pool.end();
  process.exit(1);
});
