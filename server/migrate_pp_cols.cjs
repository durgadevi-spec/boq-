require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function run() {
  await pool.query('ALTER TABLE product_step3_config_items ADD COLUMN IF NOT EXISTS is_project_pricing BOOLEAN DEFAULT FALSE');
  await pool.query('ALTER TABLE product_approval_items ADD COLUMN IF NOT EXISTS is_project_pricing BOOLEAN DEFAULT FALSE');
  await pool.query('ALTER TABLE step11_product_items ADD COLUMN IF NOT EXISTS is_project_pricing BOOLEAN DEFAULT FALSE');
  console.log("Migration successful");
  pool.end();
}
run();
