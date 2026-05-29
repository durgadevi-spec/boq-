process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  // Get all PP material IDs
  const ppRes = await pool.query('SELECT id::text FROM materials WHERE is_project_pricing = true');
  const ppIds = new Set(ppRes.rows.map(r => r.id));
  console.log(`Found ${ppIds.size} project-pricing materials in materials table`);
  if (ppIds.size === 0) { console.log('No PP materials found. Nothing to fix.'); pool.end(); return; }

  // Get all boq_items
  const itemsRes = await pool.query('SELECT id, table_data FROM boq_items');
  console.log(`Found ${itemsRes.rows.length} boq_items to check`);

  let updated = 0;
  for (const row of itemsRes.rows) {
    let td = typeof row.table_data === 'string' ? JSON.parse(row.table_data) : row.table_data;
    if (!td || !Array.isArray(td.materialLines) || td.materialLines.length === 0) continue;

    let changed = false;
    for (const ml of td.materialLines) {
      const matId = (ml.id || ml.material_id || '').toString();
      if (ppIds.has(matId) && !ml.is_project_pricing) {
        ml.is_project_pricing = true;
        changed = true;
      }
    }
    if (changed) {
      await pool.query('UPDATE boq_items SET table_data = $1 WHERE id = $2', [JSON.stringify(td), row.id]);
      updated++;
    }
  }
  console.log(`Updated ${updated} boq_items with is_project_pricing flag in materialLines`);
  pool.end();
}
run().catch(e => { console.error(e); pool.end(); });
