import "dotenv/config";
import { pool } from "../server/db/client";

async function findDuplicates() {
  console.log("Searching for potential duplicate sketch plan items...");
  
  const query = `
    SELECT plan_id, item_name, description, qty, unit, category, dimensions::text as dims_text, COUNT(*) as count, ARRAY_AGG(id) as ids
    FROM sketch_plan_items
    GROUP BY plan_id, item_name, description, qty, unit, category, dimensions::text
    HAVING COUNT(*) > 1
    ORDER BY count DESC
  `;

  try {
    const res = await pool.query(query);
    console.log(`Found ${res.rows.length} groups of potential duplicates.`);
    
    for (const row of res.rows) {
      if (row.count >= 4) {
        console.log(`[CERTAIN] Plan ${row.plan_id}: "${row.item_name}" repeated ${row.count} times.`);
      } else {
        console.log(`[SUSPICIOUS] Plan ${row.plan_id}: "${row.item_name}" repeated ${row.count} times.`);
      }
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    process.exit();
  }
}

findDuplicates();
