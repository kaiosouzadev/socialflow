require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'web', '.env') });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const hash = await bcrypt.hash('socialflow2024', 12);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    ['Admin', 'web@coletivoestudio.com.br', hash, 'admin']
  );
  console.log('Admin criado: web@coletivoestudio.com.br / socialflow2024');
  await pool.end();
})();
