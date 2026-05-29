process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  // 1. Backfill step3 config items
  const r1 = await pool.query(`
    UPDATE product_step3_config_items ci
    SET is_project_pricing = true
    FROM materials m
    WHERE ci.material_id::text = m.id::text
      AND m.is_project_pricing = true
      AND (ci.is_project_pricing IS NULL OR ci.is_project_pricing = false)
  `);
  console.log('Updated product_step3_config_items:', r1.rowCount);

  // 2. Backfill step11 product items
  const r2 = await pool.query(`
    UPDATE step11_product_items si
    SET is_project_pricing = true
    FROM materials m
    WHERE si.material_id::text = m.id::text
      AND m.is_project_pricing = true
      AND (si.is_project_pricing IS NULL OR si.is_project_pricing = false)
  `);
  console.log('Updated step11_product_items:', r2.rowCount);

  // 3. Backfill product approval items
  const r3 = await pool.query(`
    UPDATE product_approval_items ai
    SET is_project_pricing = true
    FROM materials m
    WHERE ai.material_id::text = m.id::text
      AND m.is_project_pricing = true
      AND (ai.is_project_pricing IS NULL OR ai.is_project_pricing = false)
  `);
  console.log('Updated product_approval_items:', r3.rowCount);

  // 4. Verify
  const v1 = await pool.query('SELECT COUNT(*) FROM product_step3_config_items WHERE is_project_pricing = true');
  const v2 = await pool.query('SELECT COUNT(*) FROM step11_product_items WHERE is_project_pricing = true');
  const v3 = await pool.query('SELECT COUNT(*) FROM product_approval_items WHERE is_project_pricing = true');
  console.log('\nVerification:');
  console.log('  product_step3_config_items with PP:', v1.rows[0].count);
  console.log('  step11_product_items with PP:', v2.rows[0].count);
  console.log('  product_approval_items with PP:', v3.rows[0].count);

  pool.end();
}
run().catch(e => { console.error(e); pool.end(); });
