import { query } from './db';

async function check() {
  try {
    const versions = await query('SELECT id, version_number, status FROM boq_versions');
    console.log("Versions:", versions.rows);

    const items = await query('SELECT version_id, COUNT(*) as count FROM boq_items GROUP BY version_id');
    console.log("Items per version:", items.rows);
  } catch (err) {
    console.error(err);
  }
}

check();
