/**
 * Verificação ponta-a-ponta do CRUD contra o banco real.
 * Exercita as mesmas operações que as rotas de API executam via Prisma:
 * create / update / delete em clients, social_accounts, posts, publications,
 * cascatas de exclusão e round-trip de criptografia AES-256-GCM (lib/crypto).
 *
 * Uso:  node system/test-crud.js
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", "web", ".env") });
const { Pool } = require("pg");
const crypto = require("crypto");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// --- replica exata de web/src/lib/crypto.ts ---
const ALGO = "aes-256-gcm";
function key() {
  const hex = process.env.TOKEN_ENC_KEY;
  if (!hex || hex.length !== 64) throw new Error("TOKEN_ENC_KEY inválida");
  return Buffer.from(hex, "hex");
}
function encryptToken(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
function decryptToken(enc) {
  const buf = Buffer.from(enc, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = crypto.createDecipheriv(ALGO, key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}

async function main() {
  const q = (text, params) => pool.query(text, params);

  console.log("\n== CRYPTO ==");
  const sample = "EAAB_token_secreto_123!@#";
  const enc = encryptToken(sample);
  check("encrypt produz base64 != plaintext", enc !== sample && /^[A-Za-z0-9+/=]+$/.test(enc));
  check("decrypt recupera o token original", decryptToken(enc) === sample);

  console.log("\n== CLIENT: create / update / read ==");
  const c = await q(
    `INSERT INTO clients (name, email, plan, tone_of_voice)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    ["__TEST__ Cliente", "__test__@crud.local", "sem_aprovacao", "tom inicial"]
  );
  const clientId = c.rows[0].id;
  check("cliente criado (id retornado)", !!clientId);

  await q(`UPDATE clients SET name=$1, tone_of_voice=$2 WHERE id=$3`, [
    "__TEST__ Cliente Editado",
    "tom atualizado",
    clientId,
  ]);
  const c2 = await q(`SELECT name, tone_of_voice FROM clients WHERE id=$1`, [clientId]);
  check(
    "cliente atualizado (nome + tom)",
    c2.rows[0].name === "__TEST__ Cliente Editado" && c2.rows[0].tone_of_voice === "tom atualizado"
  );

  console.log("\n== SOCIAL ACCOUNT: create / update (externalId + token) / decrypt ==");
  const a = await q(
    `INSERT INTO social_accounts (client_id, platform, external_id, access_token_enc, daily_post_limit)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [clientId, "instagram", "1784100000", encryptToken("token_v1"), 25]
  );
  const accId = a.rows[0].id;
  check("conta criada", !!accId);

  const a1 = await q(`SELECT access_token_enc FROM social_accounts WHERE id=$1`, [accId]);
  check("token v1 decripta corretamente", decryptToken(a1.rows[0].access_token_enc) === "token_v1");

  // simula a edição da conta na UI: novo externalId + novo token + novo limite + status
  await q(
    `UPDATE social_accounts SET external_id=$1, access_token_enc=$2, daily_post_limit=$3, status=$4 WHERE id=$5`,
    ["1784199999", encryptToken("token_v2"), 50, "inactive", accId]
  );
  const a2 = await q(
    `SELECT external_id, access_token_enc, daily_post_limit, status FROM social_accounts WHERE id=$1`,
    [accId]
  );
  check("externalId atualizado", a2.rows[0].external_id === "1784199999");
  check("token v2 decripta (rotação de token)", decryptToken(a2.rows[0].access_token_enc) === "token_v2");
  check("limite diário atualizado", a2.rows[0].daily_post_limit === 50);
  check("status atualizado", a2.rows[0].status === "inactive");

  console.log("\n== SCHEDULE + POST: create / update ==");
  const s = await q(
    `INSERT INTO schedules (client_id, month_ref, status) VALUES ($1, date_trunc('month', now())::date, $2) RETURNING id`,
    [clientId, "rascunho"]
  );
  const scheduleId = s.rows[0].id;
  check("schedule criado", !!scheduleId);

  const p = await q(
    `INSERT INTO posts (schedule_id, client_id, theme, caption, scheduled_at, targets, status)
     VALUES ($1,$2,$3,$4, now(), $5, $6) RETURNING id`,
    [scheduleId, clientId, "tema teste", "legenda v1", ["instagram", "facebook"], "scheduled"]
  );
  const postId = p.rows[0].id;
  check("post criado com targets", !!postId);

  await q(`UPDATE posts SET caption=$1, status=$2 WHERE id=$3`, ["legenda v2", "failed", postId]);
  const p2 = await q(`SELECT caption, status, targets FROM posts WHERE id=$1`, [postId]);
  check(
    "post atualizado (legenda + status)",
    p2.rows[0].caption === "legenda v2" && p2.rows[0].status === "failed"
  );
  check("targets persistidos como array", Array.isArray(p2.rows[0].targets) && p2.rows[0].targets.length === 2);

  console.log("\n== PUBLICATION (FK) + cascata ao excluir post ==");
  await q(
    `INSERT INTO publications (post_id, platform, external_post_id, status, published_at)
     VALUES ($1,$2,$3,$4, now())`,
    [postId, "instagram", "ig_999", "success"]
  );
  const pubCount = await q(`SELECT count(*)::int n FROM publications WHERE post_id=$1`, [postId]);
  check("publication criada (FK ok)", pubCount.rows[0].n === 1);

  await q(`DELETE FROM posts WHERE id=$1`, [postId]);
  const pubAfter = await q(`SELECT count(*)::int n FROM publications WHERE post_id=$1`, [postId]);
  check("excluir post → publications em cascata", pubAfter.rows[0].n === 0);

  console.log("\n== DELETE conta / cascata ao excluir cliente ==");
  await q(`DELETE FROM social_accounts WHERE id=$1`, [accId]);
  const accAfter = await q(`SELECT count(*)::int n FROM social_accounts WHERE id=$1`, [accId]);
  check("conta excluída", accAfter.rows[0].n === 0);

  // recria dependências para testar cascata do cliente
  await q(
    `INSERT INTO social_accounts (client_id, platform, external_id, access_token_enc) VALUES ($1,'facebook','p1',$2)`,
    [clientId, encryptToken("t")]
  );
  await q(
    `INSERT INTO posts (client_id, scheduled_at, targets) VALUES ($1, now(), $2)`,
    [clientId, ["facebook"]]
  );

  await q(`DELETE FROM clients WHERE id=$1`, [clientId]);
  const left = await q(
    `SELECT
       (SELECT count(*)::int FROM social_accounts WHERE client_id=$1) acc,
       (SELECT count(*)::int FROM posts WHERE client_id=$1) posts,
       (SELECT count(*)::int FROM schedules WHERE client_id=$1) sched`,
    [clientId]
  );
  check("excluir cliente → contas em cascata", left.rows[0].acc === 0);
  check("excluir cliente → posts em cascata", left.rows[0].posts === 0);
  check("excluir cliente → schedules em cascata", left.rows[0].sched === 0);

  console.log("\n== LIMPEZA: nenhum registro __TEST__ remanescente ==");
  const orphan = await q(`SELECT count(*)::int n FROM clients WHERE email LIKE '__test__@%'`);
  check("sem clientes de teste remanescentes", orphan.rows[0].n === 0);

  console.log(`\n=== RESULTADO: ${pass} passou, ${fail} falhou ===\n`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\nERRO FATAL:", e.message);
  await pool.end();
  process.exit(1);
});
