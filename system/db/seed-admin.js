require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'web', '.env') });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Credenciais vêm do ambiente — nunca hardcoded. Não sobrescreve um admin
// existente (evita reset silencioso de senha / lockout).
(async () => {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('Defina SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD no ambiente.');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('SEED_ADMIN_PASSWORD precisa de ao menos 12 caracteres.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  const res = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    ['Admin', email, hash]
  );

  if (res.rowCount === 0) {
    console.log(`Usuário ${email} já existe — senha NÃO alterada.`);
  } else {
    console.log(`Admin criado: ${email}`);
  }
  await pool.end();
})();
