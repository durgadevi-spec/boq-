const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/boq_db' });

async function run() {
  await client.connect();
  const res = await client.query(`
    SELECT id, project_id, version_number, type, status, is_disabled 
    FROM boq_versions 
    WHERE project_id IN (
      SELECT id FROM boq_projects WHERE name ILIKE '%Removal and refixing%'
    )
  `);
  console.table(res.rows);
  await client.end();
}

run().catch(console.error);
console.log("\n=== ALL VERSIONS AFTER FIX ===");
console.table(verRes.rows);

await client.end();
}

run().catch(console.error);
