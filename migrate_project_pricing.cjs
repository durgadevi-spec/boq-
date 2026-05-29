const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function runMigration() {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  let dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const match1 = envContent.match(/DATABASE_URL="([^"]+)"/);
      if (match1 && match1[1]) dbUrl = match1[1];
      else {
        const match2 = envContent.match(/DATABASE_URL=(.+)$/m);
        if (match2 && match2[1]) dbUrl = match2[1].trim();
      }
    }
  }

  if (!dbUrl) {
    console.error("Could not find DATABASE_URL");
    return;
  }

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log("Starting DB migration for Project Pricing Materials...");
    
    await pool.query("ALTER TABLE materials ADD COLUMN IF NOT EXISTS is_project_pricing BOOLEAN DEFAULT false;");
    console.log("Added is_project_pricing to materials table.");
    
    await pool.query("ALTER TABLE material_submissions ADD COLUMN IF NOT EXISTS is_project_pricing BOOLEAN DEFAULT false;");
    console.log("Added is_project_pricing to material_submissions table.");
    
    console.log("Migration completed successfully.");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await pool.end();
  }
}

runMigration();
