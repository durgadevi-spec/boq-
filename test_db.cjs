const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/payroll' });
async function run() {
  try {
    const res = await pool.query(`SELECT p.id as project_id, p.name as project_name, v.id as version_id, v.status, v.type, v.updated_at as completed_date, v.project_value as final_total,
                  ROW_NUMBER() OVER(PARTITION BY p.id ORDER BY v.updated_at DESC) as rn
           FROM boq_projects p
           JOIN boq_versions v ON p.id = v.project_id
           WHERE v.status = 'approved'`);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (e) { console.error(e); } finally { pool.end(); }
}
run();
