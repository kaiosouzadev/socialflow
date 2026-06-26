const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", "web", ".env") });
const { Pool } = require("pg");
const p = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  const cli = await p.query("SELECT id,name FROM clients");
  console.log("CLIENTES:", JSON.stringify(cli.rows));
  const acc = await p.query("SELECT platform,external_id,status FROM social_accounts");
  console.log("CONTAS:", JSON.stringify(acc.rows));
  const mc = await p.query("SELECT name,status FROM meta_connections");
  console.log("META_CONN:", JSON.stringify(mc.rows));
  const ps = await p.query("SELECT count(*)::int n,status,format FROM posts GROUP BY status,format ORDER BY status");
  console.log("POSTS:", JSON.stringify(ps.rows));
  await p.end();
})();
