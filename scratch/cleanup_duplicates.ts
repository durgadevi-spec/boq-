import "dotenv/config";
import { pool } from "../server/db/client";

async function cleanupDuplicates() {
  console.log("Cleaning up clear duplicates (repeated 4+ times)...");
  
  // Use a CTE to identify duplicates that are repeated at least 4 times
  const query = `
    WITH DuplicateGroups AS (
      SELECT 
        plan_id, item_name, description, qty, unit, category, dimensions::text as dims_text,
        ARRAY_AGG(id ORDER BY id) as ids,
        COUNT(*) as count
      FROM sketch_plan_items
      GROUP BY plan_id, item_name, description, qty, unit, category, dimensions::text
      HAVING COUNT(*) >= 4
    )
    DELETE FROM sketch_plan_items
    WHERE id IN (
      SELECT unnest(ids[2:]) -- Keep the first one, delete all others (ids[2:])
      FROM DuplicateGroups
    )
  `;

  try {
    const res = await pool.query(query);
    console.log(`Cleanup complete. Removed ${res.rowCount} duplicate items that were repeated 4+ times.`);
  } catch (err) {
    console.error("Error during cleanup:", err);
  } finally {
    process.exit();
  }
}

cleanupDuplicates();
