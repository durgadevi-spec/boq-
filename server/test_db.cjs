require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function run() {
  const res = await pool.query('SELECT * FROM product_submissions ORDER BY updated_at DESC LIMIT 1');
  console.log(JSON.stringify(res.rows[0].table_data, null, 2));
  pool.end();
}
run();
