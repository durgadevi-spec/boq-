const pg = require("pg");
const fs = require("fs");
const path = require("path");

async function cleanupDuplicates() {
  // Read .env from the root directory
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    console.error("Could not find .env file at:", envPath);
    return;
  }

  const envContent = fs.readFileSync(envPath, "utf-8");
  const dbUrlMatch = envContent.match(/DATABASE_URL="?([^"\n]+)"?/);
  const dbUrl = dbUrlMatch ? dbUrlMatch[1] : null;

  if (!dbUrl) {
    console.error("DATABASE_URL not found in .env");
    return;
  }

  console.log("Connecting to database...");
  const pool = new pg.Pool({ 
    connectionString: dbUrl, 
    ssl: { rejectUnauthorized: false } 
  });
  
  try {
    console.log("Starting database cleanup for Sketch Plan items...");
    
    // Identify duplicates: same content in the same plan, keeping only the earliest created
    const findQuery = `
      SELECT id, row_number() OVER (
        PARTITION BY plan_id, item_name, description, length, width, height, qty, unit, category
        ORDER BY created_at ASC
      ) as rn FROM sketch_plan_items
    `;
    
    const res = await pool.query(findQuery);
    const toDelete = res.rows
      .filter(r => parseInt(r.rn) > 1)
      .map(r => r.id);
    
    if (toDelete.length > 0) {
      console.log(`Found ${toDelete.length} duplicates. Purging...`);
      await pool.query("BEGIN");
      
      // Delete associated images first to avoid foreign key issues
      await pool.query("DELETE FROM sketch_plan_images WHERE item_id = ANY($1)", [toDelete]);
      
      // Delete the duplicate items
      await pool.query("DELETE FROM sketch_plan_items WHERE id = ANY($1)", [toDelete]);
      
      await pool.query("COMMIT");
      console.log("✅ Cleanup complete. Database is now clean.");
    } else {
      console.log("✨ No duplicates found. Database is already clean.");
    }
  } catch (err) {
    console.error("❌ Cleanup failed:", err);
    if (pool) await pool.query("ROLLBACK");
  } finally {
    await pool.end();
  }
}

cleanupDuplicates();
