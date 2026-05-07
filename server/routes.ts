import type { Express, Request, Response } from "express";
import fs from "fs";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { comparePasswords, generateToken } from "./auth";
import { authMiddleware, requireRole, requireRoleOrPermission } from "./middleware";
import { randomUUID } from "crypto";
import { query } from "./db/client";
import { sendSketchPlanEmail, sendSiteReportEmail, sendProposalStatusEmail, sendMaterialRateChangeEmail, sendCommentMentionEmail } from "./email";
import { logActivity } from "./audit";
import { registerSketchRoutes } from "./sketch_routes";

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  const { archiveService } = await import("./archive_service");

  // Sketch Plan Routes
  await registerSketchRoutes(app);

  // Ensure Column Exists with DEFAULT false, and sync current state to prevent sorting bugs (NULLS vs FALSE)
  await query("ALTER TABLE boq_versions ADD COLUMN IF NOT EXISTS is_last_final BOOLEAN DEFAULT FALSE");
  await query("UPDATE boq_versions SET is_last_final = FALSE WHERE is_last_final IS NULL");

  // Performance indexes for BOM/BOQ
  await query("CREATE INDEX IF NOT EXISTS idx_boq_items_version_id ON boq_items (version_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_boq_versions_project_id ON boq_versions (project_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_boq_projects_status ON boq_projects (project_status)");

  // ==================== AUDIT / SPY ROUTES ====================

  // GET /api/audit/logs - Fetch activity logs for the Spy Dashboard
  app.get("/api/audit/logs", authMiddleware, requireRole("admin", "software_team"), async (req: Request, res: Response) => {
    try {
      const { username, module, action, limit = "200" } = req.query;
      let sql = `SELECT id::text, user_id, username, user_role as role, action, module, description as details, metadata, ip_address, 
                        user_agent, page, requested_at as created_at
                 FROM audit_logs WHERE 1=1`;
      const params: any[] = [];

      if (username) {
        params.push(`%${username}%`);
        sql += ` AND username ILIKE $${params.length}`;
      }
      if (module && module !== "all") {
        params.push(module);
        sql += ` AND module = $${params.length}`;
      }
      if (action && action !== "all") {
        params.push(action);
        sql += ` AND action = $${params.length}`;
      }

      params.push(Math.min(Number(limit) || 200, 1000));
      sql += ` ORDER BY requested_at DESC LIMIT $${params.length}`;

      const result = await query(sql, params);
      res.json({ logs: result.rows });
    } catch (err) {
      console.error("/api/audit/logs GET error", err);
      res.status(500).json({ message: "Failed to fetch audit logs" });
    }
  });

  // POST /api/audit/navigate - Record page navigation from the frontend NavigationLogger
  app.post("/api/audit/navigate", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { page, module, details } = req.body;
      await logActivity({
        userId: user?.id,
        username: user?.username,
        role: user?.role,
        action: "NAVIGATE",
        module: module || (page || "").split("/")[1]?.toUpperCase() || "HOME",
        page,
        details: details || `Navigated to ${page}`,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      res.json({ success: true });
    } catch (err) {
      console.error("/api/audit/navigate POST error", err);
      res.status(500).json({ message: "Failed to log navigation" });
    }
  });

  // ==================== END AUDIT ROUTES ====================


  // --- ARCHIVE & TRASH API ENDPOINTS ---
  app.get('/api/archive', authMiddleware, (req, res) => {
    res.json({ items: archiveService.getArchived() });
  });

  app.get('/api/trash', authMiddleware, (req, res) => {
    res.json({ items: archiveService.getTrashed() });
  });

  app.post('/api/archive/:id/trash', authMiddleware, (req, res) => {
    const item = archiveService.trashArchiveItem(req.params.id);
    if (item) res.json({ success: true, item });
    else res.status(404).json({ error: "Item not found in archive" });
  });

  app.post('/api/archive/:id/restore', authMiddleware, (req, res) => {
    const success = archiveService.restoreArchiveItem(req.params.id);
    if (success) res.json({ success: true });
    else res.status(404).json({ error: "Item not found in archive or trash" });
  });

  app.delete('/api/archive/:id/permanent', authMiddleware, async (req, res) => {
    try {
      const item = archiveService.permanentlyDelete(req.params.id);
      if (!item) return res.status(404).json({ error: "Item not found" });

      // Actually delete from DB now based on module
      if (item.module === 'materials') {
        await query("DELETE FROM materials WHERE id = $1", [item.originId]);
      } else if (item.module === 'products') {
        await query("DELETE FROM products WHERE id = $1", [item.originId]);
      } else if (item.module === 'boq_items') {
        await query("DELETE FROM boq_items WHERE id = $1", [item.originId]);
      } else if (item.module === 'boq_projects') {
        await query("DELETE FROM boq_projects WHERE id = $1", [item.originId]);
        // Also cleanup dependent items/versions if needed, but usually cascading or manual delete handles it
        await query("DELETE FROM boq_versions WHERE project_id = $1", [item.originId]);
        await query("DELETE FROM boq_items WHERE project_id = $1", [item.originId]);
      } else if (item.module === 'templates') {
        await query("DELETE FROM material_templates WHERE id = $1", [item.originId]);
      } else if (item.module === 'categories') {
        await query("DELETE FROM vendor_categories WHERE id = $1", [item.originId]);
      } else if (item.module === 'subcategories') {
        await query("DELETE FROM vendor_subcategories WHERE id = $1", [item.originId]);
      } else if (item.module === 'sketch_plans') {
        await query("DELETE FROM sketch_plans WHERE id = $1", [item.originId]);
      } // add others as needed

      res.json({ success: true, message: "Permanently deleted" });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to permanently delete" });
    }
  });
  // --- END ARCHIVE ENDPOINTS ---
  // Helper to parse numeric values safely from strings (e.g. "₹ 1,500.00")
  const parseSafeNumeric = (val: any): number | null => {
    if (val === undefined || val === null || val === "") return null;
    if (typeof val === "number") return isNaN(val) ? null : val;

    try {
      // Remove currency symbols, commas, and other non-numeric chars except decimals
      const cleaned = String(val).replace(/[^0-9.-]/g, "");
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? null : parsed;
    } catch {
      return null;
    }
  };

  // Seed default material templates on startup (best-effort)
  try {
    // dynamic import to avoid circular deps during startup
    const { seedMaterialTemplates } = await import("./seed-templates");
    await seedMaterialTemplates();
  } catch (err: unknown) {
    console.warn(
      "[seed] Could not run material template seed:",
      (err as any)?.message || err,
    );
  }

  // Seed category and subcategory tables on startup
  try {
    const { seedMaterialCategories } = await import("./seed-categories");
    await seedMaterialCategories();
  } catch (err: unknown) {
    console.warn(
      "[seed] Could not run category seed:",
      (err as any)?.message || err,
    );
  }

  // One-time repair: link orphaned materials (template_id IS NULL) to matching templates
  try {
    const repairResult = await query(
      `UPDATE materials m
       SET template_id = t.id
       FROM material_templates t
       WHERE m.template_id IS NULL
         AND (LOWER(m.name) = LOWER(t.name) OR m.code = t.code)`
    );
    if (repairResult.rowCount && repairResult.rowCount > 0) {
      console.log(`[repair] Linked ${repairResult.rowCount} orphaned materials to their templates`);
    }
  } catch (err: unknown) {
    console.warn("[repair] Could not link orphaned materials:", (err as any)?.message || err);
  }

  // Ensure email_groups table has is_client_group column (migration for older schemas)
  try {
    await query(`ALTER TABLE email_groups ADD COLUMN IF NOT EXISTS is_client_group BOOLEAN DEFAULT FALSE`);
    console.log("[migration] email_groups.is_client_group column ensured");
  } catch (err: unknown) {
    console.warn("[migration] Could not add is_client_group column to email_groups:", (err as any)?.message || err);
  }

  // Ensure messages table exists (create if missing) to avoid runtime errors in dev
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sender_name TEXT NOT NULL,
        sender_email TEXT,
        sender_role TEXT,
        message TEXT NOT NULL,
        info TEXT,
        admin_reply TEXT,
        is_read BOOLEAN DEFAULT FALSE,
        sent_at TIMESTAMPTZ DEFAULT now(),
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await query(
      `CREATE INDEX IF NOT EXISTS idx_messages_sender_role ON messages (sender_role)`,
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at)`,
    );

    // Create bom_comments table
    await query(`
      CREATE TABLE IF NOT EXISTS bom_comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        version_id VARCHAR(100) NOT NULL,
        product_id TEXT,
        item_id TEXT,
        user_id TEXT NOT NULL,
        user_full_name TEXT NOT NULL,
        comment_text TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        visible_to TEXT[],
        read_by TEXT[] DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    // Migration for existing tables that might have been created with UUID or missing columns
    await query(`ALTER TABLE bom_comments ALTER COLUMN version_id TYPE VARCHAR(100)`);
    await query(`ALTER TABLE bom_comments ADD COLUMN IF NOT EXISTS visible_to TEXT[]`);
    await query(`ALTER TABLE bom_comments ADD COLUMN IF NOT EXISTS read_by TEXT[] DEFAULT '{}'`);
    await query(`ALTER TABLE bom_comments ADD COLUMN IF NOT EXISTS parent_id UUID`);
    await query(`ALTER TABLE bom_comments ADD COLUMN IF NOT EXISTS reply_to_text TEXT`);
    await query(`ALTER TABLE bom_comments ADD COLUMN IF NOT EXISTS reply_to_user TEXT`);
    await query(`CREATE INDEX IF NOT EXISTS idx_bom_comments_version_id ON bom_comments (version_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_bom_comments_itemId ON bom_comments (item_id)`);

    // Added missing /api/users route for tagging feature
    app.get("/api/users", authMiddleware, async (req: Request, res: Response) => {
      try {
        const result = await query(`SELECT id, username, role, full_name as "fullName", department FROM users ORDER BY full_name ASC`);
        res.json({ users: result.rows });
      } catch (err) {
        console.error("GET /api/users error", err);
        res.status(500).json({ message: "Failed to fetch users" });
      }
    });

  } catch (err: unknown) {
    console.warn(
      "[migrations] ensure messages/comments tables failed (continuing):",
      (err as any)?.message || err,
    );
  }

  // Ensure alerts table exists (stores system alerts e.g. material rate edits)
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type TEXT NOT NULL,
        material_id VARCHAR(100),
        name TEXT,
        old_rate NUMERIC,
        new_rate NUMERIC,
        edited_by TEXT,
        shop_id VARCHAR(100),
        shop_name TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts (created_at)`);

    // Ensure sketch_plan_locks table exists
    await query(`
      CREATE TABLE IF NOT EXISTS sketch_plan_locks (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES sketch_plans(id) ON DELETE CASCADE,
        is_locked BOOLEAN DEFAULT FALSE,
        request_status TEXT DEFAULT 'none', -- 'none', 'pending', 'approved', 'rejected'
        request_reason TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(plan_id)
      )
    `);
    try {
      await query(`ALTER TABLE sketch_plan_locks ADD CONSTRAINT sketch_plan_locks_plan_id_key UNIQUE (plan_id)`);
    } catch (err) {
      // Ignore if constraint already exists
    }
    console.log("[migrations] sketch_plan_locks table ensured");

    // Ensure boq_versions columns exist for BOM vs BOQ distinction and finalization
    await query("ALTER TABLE boq_versions ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'bom'");
    await query("ALTER TABLE boq_versions ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE");
    await query("ALTER TABLE boq_versions ADD COLUMN IF NOT EXISTS last_template_snapshot JSONB");
    await query("ALTER TABLE boq_versions ADD COLUMN IF NOT EXISTS is_last_final BOOLEAN DEFAULT FALSE");

    // Fix unique constraint to include type
    try {
      await query(`ALTER TABLE boq_versions DROP CONSTRAINT IF EXISTS boq_versions_project_id_version_number_key CASCADE`);
      await query(`ALTER TABLE boq_versions ADD CONSTRAINT boq_versions_project_id_type_version_number_key UNIQUE(project_id, type, version_number)`);
    } catch (e: any) {
      // 42P07 = duplicate_object: constraint already exists, safe to ignore
      if (e?.code !== '42P07') {
        console.warn("[migrations] Could not update unique constraint for boq_versions:", e?.message || e);
      }
    }
    console.log("[migrations] boq_versions 'type', 'is_locked', 'last_template_snapshot', and 'is_last_final' ensured");

    // Ensure image column exists on products
    await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS image TEXT`);
    console.log("[migrations] products 'image' column ensured");
  } catch (err: unknown) {
    console.warn('[migrations] ensure alerts table failed (continuing):', (err as any)?.message || err);
  }
  // Ensure alerts table has shop columns (for upgrades)
  try {
    await query(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS shop_id VARCHAR(100)`);
    await query(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS shop_name TEXT`);
  } catch (err: unknown) {
    console.warn('[migrations] ensure alerts shop columns failed (continuing):', (err as any)?.message || err);
  }

  // Alerts API endpoints (persisted in DB)
  // GET /api/alerts
  app.get('/api/alerts', async (_req, res) => {
    try {
      const result = await query(`SELECT id::text, type, material_id, name, old_rate, new_rate, edited_by, shop_id, shop_name, created_at FROM alerts ORDER BY created_at DESC LIMIT 200`);
      res.json({ alerts: result.rows });
    } catch (err) {
      console.error('/api/alerts GET error', err);
      res.status(500).json({ message: 'failed to load alerts' });
    }
  });

  // POST /api/alerts - create alert
  app.post('/api/alerts', authMiddleware, requireRole('admin', 'software_team', 'purchase_team'), async (req: Request, res: Response) => {
    try {
      const { type, materialId, name, oldRate, newRate, editedBy, shopId, shopName } = req.body || {};
      const id = randomUUID();
      const result = await query(`INSERT INTO alerts (id, type, material_id, name, old_rate, new_rate, edited_by, shop_id, shop_name, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING id::text, type, material_id, name, old_rate, new_rate, edited_by, shop_id, shop_name, created_at`, [id, type, materialId || null, name || null, oldRate || null, newRate || null, editedBy || null, shopId || null, shopName || null]);
      res.status(201).json({ alert: result.rows[0] });
    } catch (err) {
      console.error('/api/alerts POST error', err);
      res.status(500).json({ message: 'failed to create alert' });
    }
  });

  // DELETE /api/alerts - clear all
  app.delete('/api/alerts', authMiddleware, requireRole('admin', 'software_team'), async (_req, res) => {
    try {
      await query(`DELETE FROM alerts`);
      res.json({ message: 'alerts cleared' });
    } catch (err) {
      console.error('/api/alerts DELETE error', err);
      res.status(500).json({ message: 'failed to clear alerts' });
    }
  });

  // DELETE /api/alerts/:id - dismiss single alert
  app.delete('/api/alerts/:id', authMiddleware, requireRole('admin', 'software_team'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await query(`DELETE FROM alerts WHERE id = $1`, [id]);
      res.json({ message: 'alert dismissed' });
    } catch (err) {
      console.error('/api/alerts/:id DELETE error', err);
      res.status(500).json({ message: 'failed to delete alert' });
    }
  });

  // ==================== SUPPORT MESSAGES ROUTES ====================

  // GET /api/support-messages - Fetch messages (filtered by user if not admin)
  app.get("/api/support-messages", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      let sql = `SELECT id::text, sender_name, sender_email, sender_role, message, info, admin_reply, is_read, sent_at as submitted_at, created_at 
                 FROM messages`;
      const params: any[] = [];

      // If not admin/software/purchase, only show their own messages
      if (user.role !== 'admin' && user.role !== 'software_team' && user.role !== 'purchase_team') {
        params.push(user.username);
        sql += ` WHERE sender_email = $${params.length}`;
      }

      sql += ` ORDER BY created_at DESC`;

      const result = await query(sql, params);
      res.json({ messages: result.rows });
    } catch (err) {
      console.error("/api/support-messages GET error", err);
      res.status(500).json({ message: "Failed to fetch support messages" });
    }
  });

  // POST /api/support-messages - Create new message
  app.post("/api/support-messages", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { senderName, message, info, admin_reply } = req.body;

      if (!message) {
        return res.status(400).json({ message: "Message content is required" });
      }

      const id = randomUUID();
      const result = await query(
        `INSERT INTO messages (id, sender_name, sender_email, sender_role, message, info, admin_reply) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING id::text, sender_name, sender_email, sender_role, message, info, admin_reply, is_read, sent_at as submitted_at, created_at`,
        [id, senderName || user.fullName || user.username, user.username, user.role, message, info || null, admin_reply || null]
      );

      res.status(201).json({ message: result.rows[0] });
    } catch (err) {
      console.error("/api/support-messages POST error", err);
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  // PUT /api/support-messages/:id - Update message (replies or status)
  app.put("/api/support-messages/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { admin_reply, is_read, info } = req.body;

      const result = await query(
        `UPDATE messages 
         SET admin_reply = COALESCE($1, admin_reply),
             is_read = COALESCE($2, is_read),
             info = COALESCE($3, info)
         WHERE id = $4
         RETURNING id::text, sender_name, sender_email, sender_role, message, info, admin_reply, is_read, sent_at as submitted_at, created_at`,
        [admin_reply || null, is_read !== undefined ? is_read : null, info || null, id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ message: "Message not found" });
      }

      res.json({ message: result.rows[0] });
    } catch (err) {
      console.error("/api/support-messages PUT error", err);
      res.status(500).json({ message: "Failed to update message" });
    }
  });

  // DELETE /api/support-messages/:id - Delete message
  app.delete("/api/support-messages/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const user = (req as any).user;

      // Only allow user to delete their own, or admin to delete any
      const checkResult = await query("SELECT sender_email FROM messages WHERE id = $1", [id]);
      if (checkResult.rowCount === 0) {
        return res.status(404).json({ message: "Message not found" });
      }

      if (user.role !== 'admin' && user.username !== checkResult.rows[0].sender_email) {
        return res.status(403).json({ message: "Unauthorized to delete this message" });
      }

      await query("DELETE FROM messages WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (err) {
      console.error("/api/support-messages DELETE error", err);
      res.status(500).json({ message: "Failed to delete message" });
    }
  });

  // Ensure accumulated_products table exists
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS accumulated_products (
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL,
        estimator_type VARCHAR(50) NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await query(
      `CREATE INDEX IF NOT EXISTS idx_accumulated_products_user_estimator ON accumulated_products(user_id, estimator_type)`,
    );
  } catch (err: unknown) {
    console.warn(
      "[db] Could not create accumulated_products table:",
      (err as any)?.message || err,
    );
  }

  // Ensure estimator tables exist
  try {
    // Create estimator_step9_cart table (Add to BOQ) - only if it doesn't exist
    await query(`
      CREATE TABLE IF NOT EXISTS estimator_step9_cart (
        id SERIAL PRIMARY KEY,
        estimator VARCHAR(50) NOT NULL,
        bill_no VARCHAR(100) NOT NULL,
        s_no INTEGER,
        item VARCHAR(255),
        description TEXT,
        unit VARCHAR(50),
        qty DECIMAL,
        rate DECIMAL,
        amount DECIMAL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create estimator_step11_finalize_boq table (Finalize BOQ) - only if it doesn't exist
    await query(`
      CREATE TABLE IF NOT EXISTS estimator_step11_finalize_boq (
        id SERIAL PRIMARY KEY,
        estimator VARCHAR(50) NOT NULL,
        bill_no VARCHAR(100) NOT NULL,
        s_no INTEGER,
        item VARCHAR(255),
        location VARCHAR(255),
        description TEXT,
        unit VARCHAR(50),
        qty DECIMAL,
        supply_rate DECIMAL,
        install_rate DECIMAL,
        supply_amount DECIMAL,
        install_amount DECIMAL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create estimator_step12_qa_boq table (QA BOQ) - only if it doesn't exist
    await query(`
      CREATE TABLE IF NOT EXISTS estimator_step12_qa_boq (
        id SERIAL PRIMARY KEY,
        estimator VARCHAR(50) NOT NULL,
        bill_no VARCHAR(100) NOT NULL,
        s_no INTEGER,
        item VARCHAR(255),
        location VARCHAR(255),
        description TEXT,
        unit VARCHAR(50),
        qty DECIMAL,
        supply_rate DECIMAL,
        install_rate DECIMAL,
        supply_amount DECIMAL,
        install_amount DECIMAL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes
    await query(
      `CREATE INDEX IF NOT EXISTS idx_estimator_step9_cart_bill_no ON estimator_step9_cart(bill_no)`,
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_estimator_step9_cart_estimator ON estimator_step9_cart(estimator)`,
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_estimator_step11_finalize_boq_bill_no ON estimator_step11_finalize_boq(bill_no)`,
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_estimator_step11_finalize_boq_estimator ON estimator_step11_finalize_boq(estimator)`,
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_estimator_step12_qa_boq_bill_no ON estimator_step12_qa_boq(bill_no)`,
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_estimator_step12_qa_boq_estimator ON estimator_step12_qa_boq(estimator)`,
    );

    console.log(
      "[db] Estimator tables verified/created with correct structure",
    );
  } catch (err: unknown) {
    console.warn(
      "[db] Could not create estimator tables:",
      (err as any)?.message || err,
    );
  }

  // Ensure material_submissions table has required columns
  try {
    await query(
      `ALTER TABLE material_submissions ADD COLUMN IF NOT EXISTS submitted_by VARCHAR(36)`,
    );
    await query(
      `ALTER TABLE material_submissions ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP DEFAULT NOW()`,
    );
    await query(
      `ALTER TABLE material_submissions ADD COLUMN IF NOT EXISTS dimensions VARCHAR(255)`,
    );
    await query(
      `ALTER TABLE material_submissions ADD COLUMN IF NOT EXISTS finishtype VARCHAR(255)`,
    );
    await query(
      `ALTER TABLE material_submissions ADD COLUMN IF NOT EXISTS metaltype VARCHAR(255)`,
    );
    await query(
      `ALTER TABLE material_submissions ADD COLUMN IF NOT EXISTS product VARCHAR(255)`,
    );
    await query(
      `ALTER TABLE material_submissions ADD COLUMN IF NOT EXISTS category VARCHAR(255)`,
    );
  } catch (err: unknown) {
    console.warn(
      "[migrations] ensure material_submissions columns failed (continuing):",
      (err as any)?.message || err,
    );
  }


  // Ensure shops table has vendor_category column
  try {
    await query(
      `ALTER TABLE shops ADD COLUMN IF NOT EXISTS vendor_category VARCHAR(255)`,
    );
    await query(
      `ALTER TABLE shops ADD COLUMN IF NOT EXISTS new_location TEXT`,
    );
    await query(
      `ALTER TABLE shops ADD COLUMN IF NOT EXISTS terms_and_conditions TEXT`,
    );
  } catch (err: unknown) {
    console.warn(
      "[migrations] ensure shops columns failed (continuing):",
      (err as any)?.message || err,
    );
  }

  // Ensure boq_projects table exists (stores BOQ projects)
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS boq_projects (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        client VARCHAR(255),
        budget VARCHAR(100),
        location TEXT,
        status VARCHAR(50) DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await query(
      `CREATE INDEX IF NOT EXISTS idx_boq_projects_created_at ON boq_projects(created_at)`,
    );
    console.log("[db] boq_projects table verified/created");
  } catch (err: unknown) {
    console.warn(
      "[db] Could not create boq_projects table:",
      (err as any)?.message || err,
    );
  }
  try {
    await query(`ALTER TABLE boq_projects ADD COLUMN IF NOT EXISTS location TEXT`);
    await query(`ALTER TABLE boq_projects ADD COLUMN IF NOT EXISTS client_address TEXT`);
    await query(`ALTER TABLE boq_projects ADD COLUMN IF NOT EXISTS gst_no VARCHAR(100)`);
    await query(`ALTER TABLE boq_projects ADD COLUMN IF NOT EXISTS project_value VARCHAR(100)`);
    await query(`ALTER TABLE boq_projects ADD COLUMN IF NOT EXISTS project_status VARCHAR(50) DEFAULT 'started'`);

    // Also on boq_versions for snapshots
    await query(`ALTER TABLE boq_versions ADD COLUMN IF NOT EXISTS project_client_address TEXT`);
    await query(`ALTER TABLE boq_versions ADD COLUMN IF NOT EXISTS project_gst_no VARCHAR(100)`);
    await query(`ALTER TABLE boq_versions ADD COLUMN IF NOT EXISTS project_value VARCHAR(100)`);
  } catch (err: unknown) {
    console.warn('[db] Could not update boq_projects/versions columns (continuing):', (err as any)?.message || err);
  }

  // Ensure Sketch a Plan tables exist
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS sketch_plans (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        project_id VARCHAR(100),
        location TEXT,
        plan_date DATE,
        created_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (project_id) REFERENCES boq_projects(id) ON DELETE SET NULL
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS sketch_plan_items (
        id VARCHAR(100) PRIMARY KEY,
        plan_id VARCHAR(100) NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        description TEXT,
        length DECIMAL(10, 2),
        width DECIMAL(10, 2),
        height DECIMAL(10, 2),
        qty DECIMAL(10, 2),
        unit VARCHAR(50),
        remarks TEXT,
        category TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (plan_id) REFERENCES sketch_plans(id) ON DELETE CASCADE
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS sketch_plan_images (
        id VARCHAR(100) PRIMARY KEY,
        plan_id VARCHAR(100) NOT NULL,
        item_id VARCHAR(100),
        image_url TEXT NOT NULL,
        image_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (plan_id) REFERENCES sketch_plans(id) ON DELETE CASCADE
      )
    `);
    await query(`ALTER TABLE sketch_plan_images ADD COLUMN IF NOT EXISTS image_name VARCHAR(255)`);
    await query(`
      CREATE TABLE IF NOT EXISTS sketch_plan_attachments (
        id VARCHAR(100) PRIMARY KEY,
        plan_id VARCHAR(100) NOT NULL,
        file_url TEXT NOT NULL,
        file_name VARCHAR(255),
        file_type VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (plan_id) REFERENCES sketch_plans(id) ON DELETE CASCADE
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS sketch_templates (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        template_data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("[db] Sketch a Plan tables verified/created");
  } catch (err) {
    console.warn("[db] Could not create Sketch a Plan tables:", (err as any)?.message || err);
  }

  // Add new columns for enhanced Sketch a Plan items
  try {
    await query(`ALTER TABLE sketch_plan_items ADD COLUMN IF NOT EXISTS material_id UUID`);
    await query(`ALTER TABLE sketch_plan_items ADD COLUMN IF NOT EXISTS dimension_unit VARCHAR(10) DEFAULT 'feet'`);
    await query(`ALTER TABLE sketch_plan_items ADD COLUMN IF NOT EXISTS assigned_vendor_id VARCHAR(100)`);
    await query(`ALTER TABLE sketch_plan_items ADD COLUMN IF NOT EXISTS vendor_name VARCHAR(255)`);
    await query(`ALTER TABLE sketch_plan_items ADD COLUMN IF NOT EXISTS dimensions JSONB`);
    await query(`ALTER TABLE sketch_plan_items ADD COLUMN IF NOT EXISTS assigned_user_id VARCHAR(100)`);
    await query(`ALTER TABLE sketch_plan_items ADD COLUMN IF NOT EXISTS assigned_user_name VARCHAR(255)`);
    await query(`ALTER TABLE sketch_plan_items ADD COLUMN IF NOT EXISTS user_task_status VARCHAR(50) DEFAULT 'unassigned'`);
    await query(`ALTER TABLE sketch_plan_items ADD COLUMN IF NOT EXISTS category TEXT`);
    await query(`ALTER TABLE sketch_plan_items ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`);
    await query(`ALTER TABLE sketch_plans ADD COLUMN IF NOT EXISTS version_number INTEGER DEFAULT 1`);
    await query(`ALTER TABLE sketch_plans ADD COLUMN IF NOT EXISTS parent_plan_id VARCHAR(100)`);
    await query(`ALTER TABLE sketch_plans ADD COLUMN IF NOT EXISTS version_status VARCHAR(50) DEFAULT 'draft'`);
    await query(`ALTER TABLE sketch_plans ADD COLUMN IF NOT EXISTS category_order JSONB`);
  } catch (err) {
    console.warn("[db] Could not add enhanced columns to sketch_plan_items:", (err as any)?.message || err);
  }

  // Ensure boq_items table exists (stores BOQ line items captured from estimators)
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS boq_items (
        id VARCHAR(100) PRIMARY KEY,
        project_id VARCHAR(100) NOT NULL,
        estimator VARCHAR(50) NOT NULL,
        table_data JSONB,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (project_id) REFERENCES boq_projects(id) ON DELETE CASCADE
      )
    `);
    await query(
      `CREATE INDEX IF NOT EXISTS idx_boq_items_project_id ON boq_items(project_id)`,
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_boq_items_estimator ON boq_items(estimator)`,
    );
    console.log("[db] boq_items table verified/created");
  } catch (err: unknown) {
    console.warn(
      "[db] Could not create boq_items table:",
      (err as any)?.message || err,
    );
  }

  // Ensure boq_versions table exists (stores BOQ versions)
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS boq_versions (
        id VARCHAR(100) PRIMARY KEY,
        project_id VARCHAR(100) NOT NULL,
        project_name VARCHAR(255),
        project_client VARCHAR(255),
        project_location TEXT,
        version_number INTEGER NOT NULL,
        status VARCHAR(50) DEFAULT 'draft',
        rejection_reason TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (project_id) REFERENCES boq_projects(id) ON DELETE CASCADE,
        type VARCHAR(20) DEFAULT 'bom',
        is_locked BOOLEAN DEFAULT FALSE,
        last_template_snapshot JSONB,
        is_last_final BOOLEAN DEFAULT FALSE,
        category_order JSONB,
        UNIQUE(project_id, type, version_number)
      )
    `);
    await query(
      `CREATE INDEX IF NOT EXISTS idx_boq_versions_project_id ON boq_versions(project_id)`,
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_boq_versions_status ON boq_versions(status)`,
    );
    console.log("[db] boq_versions table verified/created");
  } catch (err: unknown) {
    console.warn(
      "[db] Could not create boq_versions table:",
      (err as any)?.message || err,
    );
  }

  // Ensure new columns exist on existing installations and populate them
  try {
    await query(`ALTER TABLE boq_versions ADD COLUMN IF NOT EXISTS project_name VARCHAR(255)`);
    await query(`ALTER TABLE boq_versions ADD COLUMN IF NOT EXISTS project_client VARCHAR(255)`);
    await query(`ALTER TABLE boq_versions ADD COLUMN IF NOT EXISTS project_location TEXT`);
    await query(`ALTER TABLE boq_versions ADD COLUMN IF NOT EXISTS rejection_reason TEXT`);
    await query(`ALTER TABLE boq_versions ADD COLUMN IF NOT EXISTS category_order JSONB`);

    // Populate project_name, project_client and project_location from boq_projects where missing
    await query(`
      UPDATE boq_versions v
      SET project_name = p.name, project_client = p.client, project_location = p.location
      FROM boq_projects p
      WHERE v.project_id = p.id
        AND (v.project_name IS NULL OR v.project_client IS NULL OR v.project_location IS NULL)
    `);

    console.log("[db] boq_versions project_name and project_client populated");
  } catch (err: unknown) {
    console.warn("[db] Could not ensure/populate boq_versions project columns:", (err as any)?.message || err);
  }

  // Migrate boq_items to support version_id and sort_order
  try {
    await query(
      `ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS version_id VARCHAR(100)`,
    );
    await query(
      `ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`,
    );
    console.log("[db] boq_items version_id and sort_order columns ensured");
  } catch (err: unknown) {
    console.warn(
      "[db] Could not migrate boq_items columns:",
      (err as any)?.message || err,
    );
  }

  // Ensure purchase_orders table exists
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS proposals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id VARCHAR(100) NOT NULL REFERENCES boq_projects(id) ON DELETE CASCADE,
        project_name VARCHAR(255),
        vendor_id VARCHAR(100) NOT NULL,
        vendor_name VARCHAR(255),
        version_number INTEGER DEFAULT 1,
        status VARCHAR(50) DEFAULT 'draft',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(project_id, vendor_id, version_number)
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS proposal_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
        material_id VARCHAR(255),
        item_name VARCHAR(255) NOT NULL,
        description TEXT,
        qty DECIMAL(10,2) NOT NULL,
        unit VARCHAR(50),
        rate DECIMAL(15,2) DEFAULT 0,
        amount DECIMAL(15,2) DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log("[db] Dedicated proposals tables verified/created");
  } catch (err: unknown) {
    console.warn("[db] Could not create proposals tables:", (err as any)?.message || err);
  }

  // Ensure purchase_orders table exists
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        po_number VARCHAR(100) NOT NULL UNIQUE,
        project_id VARCHAR(100) NOT NULL,
        project_name VARCHAR(255),
        vendor_id VARCHAR(100) NOT NULL,
        vendor_name VARCHAR(255),
        subtotal DECIMAL(15,2) DEFAULT 0,
        tax DECIMAL(15,2) DEFAULT 0,
        total DECIMAL(15,2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'draft',
        requested_by VARCHAR(255),
        approval_comments TEXT,
        po_date TIMESTAMPTZ DEFAULT NOW(),
        delivery_date TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_purchase_orders_po_number ON purchase_orders(po_number)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_purchase_orders_project_id ON purchase_orders(project_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor_id ON purchase_orders(vendor_id)`);

    await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS version_id VARCHAR(100)`);
    await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS version_number TEXT`);
    await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS shipping_address TEXT`);
    await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_terms TEXT`);
    await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS dc_number TEXT`);
    await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS dc_date DATE`);

    console.log("[db] purchase_orders table verified/created");
  } catch (err: unknown) {
    console.warn("[db] Could not create purchase_orders table:", (err as any)?.message || err);
  }

  // Ensure purchase_order_items table exists
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        material_id VARCHAR(100),
        item VARCHAR(255) NOT NULL,
        description TEXT,
        unit VARCHAR(50),
        qty DECIMAL(10,2) NOT NULL,
        rate DECIMAL(15,2) NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        hsn_code VARCHAR(50),
        sac_code VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po_id ON purchase_order_items(po_id)`);
    // Ensure hsn_code and sac_code columns exist (for upgrades from older schema)
    await query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(50)`);
    await query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS sac_code VARCHAR(50)`);
    await query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS material_id VARCHAR(255)`);
    await query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS original_qty NUMERIC(10, 3)`);
    await query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS qty_modified BOOLEAN DEFAULT FALSE`);
    await query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS is_synced BOOLEAN DEFAULT FALSE`);
    console.log("[db] purchase_order_items table verified/created");
  } catch (err: unknown) {
    console.warn("[db] Could not create purchase_order_items table:", (err as any)?.message || err);
  }

  // Ensure po_requests table exists
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS po_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id VARCHAR(100) NOT NULL,
        project_name VARCHAR(255) NOT NULL,
        requester_id VARCHAR(100) NOT NULL,
        requester_name VARCHAR(255) NOT NULL,
        employee_id VARCHAR(100),
        department VARCHAR(100),
        status VARCHAR(50) DEFAULT 'pending_approval',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_po_requests_requester ON po_requests(requester_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_po_requests_project ON po_requests(project_id)`);
    await query(`ALTER TABLE po_requests ADD COLUMN IF NOT EXISTS deliver_to TEXT`);
    await query(`ALTER TABLE po_requests ADD COLUMN IF NOT EXISTS payment_terms TEXT`);
    await query(`ALTER TABLE po_requests ADD COLUMN IF NOT EXISTS terms_conditions TEXT`);
    console.log("[db] po_requests table verified/created");
  } catch (err: unknown) {
    console.warn("[db] Could not create po_requests table:", (err as any)?.message || err);
  }

  // Ensure po_request_items table exists
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS po_request_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        po_request_id UUID NOT NULL REFERENCES po_requests(id) ON DELETE CASCADE,
        item VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        subcategory VARCHAR(100),
        unit VARCHAR(50),
        qty DECIMAL(10,2) NOT NULL,
        remarks TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_po_request_items_req_id ON po_request_items(po_request_id)`);
    await query(`ALTER TABLE po_request_items ADD COLUMN IF NOT EXISTS material_id VARCHAR(255)`);
    await query(`ALTER TABLE po_request_items ADD COLUMN IF NOT EXISTS original_qty DECIMAL(10,2)`);
    await query(`ALTER TABLE po_request_items ADD COLUMN IF NOT EXISTS rate DECIMAL(10,2)`);
    // Populate original_qty from qty for existing rows
    await query(`UPDATE po_request_items SET original_qty = qty WHERE original_qty IS NULL`);
    console.log("[db] po_request_items table verified/created");
  } catch (err: unknown) {
    console.warn("[db] Could not create po_request_items table:", (err as any)?.message || err);
  }

  // Ensure boq_history table exists
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS boq_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        version_id VARCHAR(100) NOT NULL REFERENCES boq_versions(id) ON DELETE CASCADE,
        user_id VARCHAR(36) NOT NULL,
        user_full_name TEXT,
        action TEXT NOT NULL, 
        reason TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    console.log("[db] boq_history table verified/created");
  } catch (err: unknown) {
    console.warn(
      "[db] Could not create boq_history table:",
      (err as any)?.message || err,
    );
  }

  // Add foreign key constraint (ignore error if it already exists)
  try {
    await query(
      `ALTER TABLE boq_items ADD CONSTRAINT fk_boq_items_version FOREIGN KEY (version_id) REFERENCES boq_versions(id) ON DELETE CASCADE`,
    );
    console.log("[db] boq_items foreign key constraint added");
  } catch (err: unknown) {
    // Constraint might already exist, which is fine
    const errorMsg = (err as any)?.message || "";
    if (!errorMsg.includes("already exists")) {
      console.warn("[db] Warning adding foreign key constraint:", errorMsg);
    }
  }

  // Ensure step11_products table has config_name column
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS step11_products (
        id SERIAL PRIMARY KEY,
        product_id VARCHAR(100) NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        config_name VARCHAR(255) DEFAULT 'Default Configuration',
        category_id VARCHAR(255),
        subcategory_id VARCHAR(255),
        total_cost DECIMAL(15,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS step11_product_items (
        id SERIAL PRIMARY KEY,
        step11_product_id INTEGER REFERENCES step11_products(id) ON DELETE CASCADE,
        material_id VARCHAR(100),
        material_name VARCHAR(255),
        unit VARCHAR(50),
        qty DECIMAL(15,2),
        rate DECIMAL(15,2),
        supply_rate DECIMAL(15,2),
        install_rate DECIMAL(15,2),
        location VARCHAR(255),
        amount DECIMAL(15,4),
        freeze_and_edit BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await query(`ALTER TABLE step11_products ADD COLUMN IF NOT EXISTS config_name VARCHAR(255) DEFAULT 'Default Configuration'`);
    console.log("[db] step11_products and items tables ensured");
  } catch (err: unknown) {
    console.warn("[db] Could not ensure step11_products tables:", (err as any)?.message || err);
  }

  // Ensure Step 3 (configuration step) separate tables
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS product_step3_config (
        id SERIAL PRIMARY KEY,
        product_id VARCHAR(100) NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        config_name VARCHAR(255) DEFAULT 'Default',
        category_id VARCHAR(255),
        subcategory_id VARCHAR(255),
        total_cost DECIMAL(15,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS product_step3_config_items (
        id SERIAL PRIMARY KEY,
        step3_config_id INTEGER REFERENCES product_step3_config(id) ON DELETE CASCADE,
        material_id VARCHAR(100),
        material_name VARCHAR(255),
        unit VARCHAR(50),
        qty DECIMAL(15,2),
        rate DECIMAL(15,2),
        supply_rate DECIMAL(15,2),
        install_rate DECIMAL(15,2),
        location VARCHAR(255),
        amount DECIMAL(15,4),
        freeze_and_edit BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("[db] product_step3_config tables ensured");

    // Add new BOQ architecture columns (safe, idempotent)
    await query(`ALTER TABLE product_step3_config ADD COLUMN IF NOT EXISTS required_unit_type VARCHAR(20) DEFAULT 'Sqft'`);
    await query(`ALTER TABLE product_step3_config ADD COLUMN IF NOT EXISTS base_required_qty DECIMAL(15,2) DEFAULT 1`);
    await query(`ALTER TABLE product_step3_config ADD COLUMN IF NOT EXISTS wastage_pct_default DECIMAL(15,4) DEFAULT 0`);
    await query(`ALTER TABLE product_step3_config_items ADD COLUMN IF NOT EXISTS base_qty DECIMAL(15,2)`);
    await query(`ALTER TABLE product_step3_config_items ADD COLUMN IF NOT EXISTS wastage_pct DECIMAL(15,4)`);
    await query(`ALTER TABLE product_step3_config_items ADD COLUMN IF NOT EXISTS shop_name VARCHAR(255)`);
    await query(`ALTER TABLE product_step3_config_items ADD COLUMN IF NOT EXISTS freeze_and_edit BOOLEAN DEFAULT FALSE`);

    // Explicitly upgrade types if they already exist with old restrictive types
    await query(`ALTER TABLE product_step3_config ALTER COLUMN wastage_pct_default TYPE DECIMAL(15,4)`);
    await query(`ALTER TABLE product_step3_config_items ALTER COLUMN wastage_pct TYPE DECIMAL(15,4)`);

    console.log("[db] product_step3_config BOQ columns ensured and types upgraded");
  } catch (err: unknown) {
    console.warn("[db] Could not ensure product_step3_config tables:", (err as any)?.message || err);
  }

  // Ensure boq_items has a user_added flag (only items explicitly saved via Add Product)
  try {
    await query(
      `ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS user_added BOOLEAN DEFAULT true`,
    );
    console.log("[db] boq_items user_added column ensured");
  } catch (err: unknown) {
    console.warn(
      "[db] Could not ensure user_added column on boq_items:",
      (err as any)?.message || err,
    );
  }

  // Ensure material_templates table has vendor_category, tax_code_type, and tax_code_value columns
  try {
    await query(
      `ALTER TABLE material_templates ADD COLUMN IF NOT EXISTS vendor_category VARCHAR(255)`,
    );
    // Ensure column exists; then ensure the CHECK constraint allows NULL or the allowed values
    await query(`ALTER TABLE material_templates ADD COLUMN IF NOT EXISTS tax_code_type VARCHAR(10)`);
    // Drop old constraint if it exists (safely), then add a correct one that allows NULL
    try {
      await query(`ALTER TABLE material_templates DROP CONSTRAINT IF EXISTS material_templates_tax_code_type_check`);
    } catch (dropErr) {
      // ignore
    }
    await query(`ALTER TABLE material_templates ADD CONSTRAINT material_templates_tax_code_type_check CHECK (tax_code_type IS NULL OR tax_code_type IN ('hsn', 'sac'))`);
    await query(
      `ALTER TABLE material_templates ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(50)`
    );
    await query(
      `ALTER TABLE material_templates ADD COLUMN IF NOT EXISTS sac_code VARCHAR(50)`
    );
    await query(
      `ALTER TABLE material_templates ADD COLUMN IF NOT EXISTS image TEXT`
    );
    await query(
      `ALTER TABLE material_templates ADD COLUMN IF NOT EXISTS metaltype VARCHAR(255)`
    );
    await query(
      `ALTER TABLE material_templates ADD COLUMN IF NOT EXISTS brandname VARCHAR(255)`
    );
    await query(
      `ALTER TABLE material_templates ADD COLUMN IF NOT EXISTS dimensions VARCHAR(255)`
    );
    await query(
      `ALTER TABLE material_templates ADD COLUMN IF NOT EXISTS finishtype VARCHAR(255)`
    );
    await query(`ALTER TABLE material_submissions ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(50)`);
    await query(`ALTER TABLE material_submissions ADD COLUMN IF NOT EXISTS sac_code VARCHAR(50)`);
    console.log("[db] material_templates/submissions hsn/sac/image/metaltype/brandname/dimensions/finishtype columns ensured");
  } catch (err: unknown) {
    console.warn(
      "[db] Could not ensure material_templates columns:",
      (err as any)?.message || err,
    );
  }

  // Ensure materials table has vendor_category, template_id, and optional tax columns
  try {
    await query(`ALTER TABLE materials ADD COLUMN IF NOT EXISTS vendor_category VARCHAR(255)`);
    await query(`ALTER TABLE materials ADD COLUMN IF NOT EXISTS template_id UUID`);
    await query(`ALTER TABLE materials ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(50)`);
    await query(`ALTER TABLE materials ADD COLUMN IF NOT EXISTS sac_code VARCHAR(50)`);
    await query(`ALTER TABLE materials ADD COLUMN IF NOT EXISTS tax_code_type VARCHAR(10)`);
    await query(`ALTER TABLE materials ADD COLUMN IF NOT EXISTS tax_code_value VARCHAR(50)`);
    await query(`ALTER TABLE materials ADD COLUMN IF NOT EXISTS technicalspecification TEXT`);
    await query(`ALTER TABLE materials ADD COLUMN IF NOT EXISTS subcategory VARCHAR(255)`);
    await query(`ALTER TABLE materials ADD COLUMN IF NOT EXISTS product VARCHAR(255)`);
    await query(`ALTER TABLE materials ADD COLUMN IF NOT EXISTS dimensions VARCHAR(255)`);
    await query(`ALTER TABLE materials ADD COLUMN IF NOT EXISTS finishtype VARCHAR(255)`);
    await query(`ALTER TABLE materials ADD COLUMN IF NOT EXISTS metaltype VARCHAR(255)`);
    await query(`ALTER TABLE materials ADD COLUMN IF NOT EXISTS brandname VARCHAR(255)`);
    await query(`ALTER TABLE materials ADD COLUMN IF NOT EXISTS modelnumber VARCHAR(255)`);
    console.log("[db] materials vendor/template/tax/techspec/extra columns ensured");
  } catch (err: unknown) {
    console.warn(
      "[db] Could not ensure materials vendor/template/tax columns:",
      (err as any)?.message || err,
    );
  }

  // Create vendor_categories table for centralized vendor category management
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS vendor_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("[db] vendor_categories table ensured");
  } catch (err: unknown) {
    console.warn(
      "[db] Could not create vendor_categories table:",
      (err as any)?.message || err,
    );
  }

  // Create boq_templates table for reusable BOQ finalize layouts
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS boq_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL UNIQUE,
        config JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("[db] boq_templates table verified/created");

    // NEW: Create bom_templates table for reusable BOM item cards (Generate BOM)
    await query(`
      CREATE TABLE IF NOT EXISTS bom_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL UNIQUE,
        config JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("[db] bom_templates table verified/created");
  } catch (err: unknown) {
    console.warn(
      "[db] Could not create boq_templates table:",
      (err as any)?.message || err,
    );
  }

  // Ensure alerts table exists
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        info JSONB,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    // boq_versions type/is_locked/last_template_snapshot/is_last_final columns
    // are now handled in the consolidated migration block above (lines ~263-280)
  } catch (err: unknown) {
    console.warn("[migrations] failed:", (err as any)?.message || err);
  }

  // Ensure global_settings table exists
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS global_settings (
        id VARCHAR(50) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // Seed default terms and conditions if not exists
    const existing = await query(`SELECT * FROM global_settings WHERE id = 'terms_and_conditions'`);
    if (existing.rows.length === 0) {
      await query(`INSERT INTO global_settings (id, value) VALUES ('terms_and_conditions', '"Standard Terms: 1. Final payment as per BOQ measurements. 2. Any additional items extra."')`);
    }
    console.log("[db] global_settings table verified/created");
  } catch (err: unknown) {
    console.warn(
      "[db] Could not create global_settings table:",
      (err as any)?.message || err,
    );
  }

  // Ensure budget_exceed_logs table exists
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS budget_exceed_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id VARCHAR(100) NOT NULL REFERENCES boq_projects(id) ON DELETE CASCADE,
        project_budget DECIMAL(15,2),
        project_value_at_exceed DECIMAL(15,2),
        exceeded_amount DECIMAL(15,2),
        reason TEXT NOT NULL,
        created_by VARCHAR(36),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(
      `CREATE INDEX IF NOT EXISTS idx_budget_exceed_logs_project_id ON budget_exceed_logs(project_id)`,
    );
    console.log("[db] budget_exceed_logs table verified/created");

    // --- SITE REPORT MODULE TABLES ---
    await query(`
      CREATE TABLE IF NOT EXISTS site_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id TEXT NOT NULL,
        project_name TEXT NOT NULL,
        user_id TEXT NOT NULL,
        report_date TIMESTAMPTZ DEFAULT NOW(),
        summary TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS site_report_tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        site_report_id UUID NOT NULL REFERENCES site_reports(id) ON DELETE CASCADE,
        item_type TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_name TEXT NOT NULL,
        task_description TEXT,
        completion_percentage INTEGER NOT NULL DEFAULT 0,
        status TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS site_report_labours (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id UUID NOT NULL REFERENCES site_report_tasks(id) ON DELETE CASCADE,
        labour_name TEXT,
        count INTEGER NOT NULL DEFAULT 1,
        in_time TEXT,
        out_time TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS site_report_media (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id UUID NOT NULL REFERENCES site_report_tasks(id) ON DELETE CASCADE,
        file_url TEXT NOT NULL,
        file_type TEXT NOT NULL,
        file_name TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS site_report_issues (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id UUID NOT NULL REFERENCES site_report_tasks(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS site_report_materials (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id UUID NOT NULL REFERENCES site_report_tasks(id) ON DELETE CASCADE,
        material_name TEXT NOT NULL,
        quantity DECIMAL NOT NULL DEFAULT 1,
        unit TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS email_groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS email_group_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id UUID NOT NULL REFERENCES email_groups(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log("[db] site_report tables ensured");

  } catch (err: unknown) {
    console.warn(
      "[db] Could not create budget_exceed_logs table:",
      (err as any)?.message || err,
    );
  }

  // GET /api/budget-exceed-logs/:projectId
  app.get("/api/budget-exceed-logs/:projectId", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const result = await query(
        `SELECT b.*, u.username as created_by_username 
         FROM budget_exceed_logs b
         LEFT JOIN users u ON b.created_by = u.id
         WHERE project_id = $1 
         ORDER BY created_at DESC`,
        [projectId]
      );
      res.json({ logs: result.rows });
    } catch (err) {
      console.error("/api/budget-exceed-logs GET error", err);
      res.status(500).json({ message: "failed to fetch budget exceed logs" });
    }
  });

  // POST /api/budget-exceed-logs
  app.post("/api/budget-exceed-logs", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { projectId, projectBudget, projectValueAtExceed, exceededAmount, reason } = req.body;
      const userId = (req as any).user?.id || null;

      const result = await query(
        `INSERT INTO budget_exceed_logs 
         (project_id, project_budget, project_value_at_exceed, exceeded_amount, reason, created_by) 
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [projectId, projectBudget, projectValueAtExceed, exceededAmount, reason, userId]
      );
      res.status(201).json({ log: result.rows[0] });
    } catch (err) {
      console.error("/api/budget-exceed-logs POST error", err);
      res.status(500).json({ message: "failed to create budget exceed log" });
    }
  });

  // In-memory fallback storage for messages when DB is unreachable (development only)
  let inMemoryMessages: any[] = [];
  let inMemoryMessagesEnabled = false;

  // ====== PUBLIC AUTH ROUTES ======

  // POST /api/auth/signup - Register a new user
  app.post("/api/auth/signup", async (req: Request, res: Response) => {
    try {
      const {
        username,
        password,
        role,
        fullName,
        mobileNumber,
        department,
        employeeCode,
        companyName,
        gstNumber,
        businessAddress,
      } = req.body;

      console.log("[signup] Received signup request:", {
        username,
        role,
        hasPassword: !!password,
        hasFullName: !!fullName,
        hasMobileNumber: !!mobileNumber,
      });

      if (!username || !password) {
        res.status(400).json({ message: "Username and password are required" });
        return;
      }

      if (!role) {
        res.status(400).json({ message: "Role is required" });
        return;
      }

      // Check if user already exists
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        console.log("[signup] User already exists:", username);
        res.status(409).json({ message: "User already exists" });
        return;
      }

      // Create new user - pre_sales and contractor don't need extra fields
      console.log("[signup] Creating user with role:", role);
      const user = await storage.createUser({
        username,
        password,
        role: role || "user",
        fullName,
        mobileNumber,
        department: role === "pre_sales" || role === "contractor" ? null : department,
        employeeCode: role === "pre_sales" || role === "contractor" ? null : employeeCode,
        companyName: role === "supplier" ? companyName : null,
        gstNumber: role === "supplier" ? gstNumber : null,
        businessAddress: role === "supplier" ? businessAddress : null,
      });

      console.log("[signup] User created successfully:", user.id);

      // ✅ NEW: ensure approval columns exist + mark supplier as pending (DB controls approval)
      try {
        await query(
          `ALTER TABLE users ADD COLUMN IF NOT EXISTS approved text DEFAULT 'approved'`,
        );
        await query(
          `ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_reason text`,
        );

        const approvedValue = role === "supplier" ? "pending" : "approved";
        await query(`UPDATE users SET approved = $2 WHERE id = $1`, [
          user.id,
          approvedValue,
        ]);
        console.log(`[signup] User ${user.id} approved status set to: ${approvedValue}`);
      } catch (err: unknown) {
        console.warn(
          "[signup] could not set approval status (continuing):",
          (err as any)?.message || err,
        );
      }

      // TODO: Store additional profile information in a separate table
      // For now, just log the additional data
      console.log(`New user registered:`, {
        id: user.id,
        username: user.username,
        role: user.role,
        fullName,
        mobileNumber,
        department,
        employeeCode,
        companyName,
        gstNumber,
        businessAddress,
      });

      // Return user without password (NO AUTO-LOGIN, NO TOKEN)
      const { password: _, ...userWithoutPassword } = user;
      res.status(201).json({
        message: "User created successfully",
        user: userWithoutPassword,
      });
    } catch (error: any) {
      console.error("[signup] Error:", {
        message: error?.message,
        code: error?.code,
        detail: error?.detail,
        fullError: error,
      });

      // Provide more specific error messages
      if (error.code === "23505") {
        // Unique constraint violation
        res.status(409).json({ message: "Username already exists" });
      } else if (error.message?.includes("not null")) {
        res.status(400).json({ message: "Missing required field: " + error.message });
      } else {
        res.status(500).json({ message: "Signup failed: " + (error?.message || "Unknown error") });
      }
    }
  });

  // POST /api/auth/login - Login user
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        res.status(400).json({ message: "Username and password are required" });
        return;
      }

      // Find user by username
      const user = await storage.getUserByUsername(username);
      // Debug logging
      // eslint-disable-next-line no-console
      console.log(
        `[auth] login attempt for username=${username} found=${!!user}`,
      );

      if (!user) {
        res.status(401).json({ message: "Invalid credentials" });
        return;
      }

      // Check approval status for suppliers
      if (user.role === "supplier" && user.approved !== "approved") {
        if (user.approved === "pending") {
          res.status(403).json({
            message: "Account is under review. Please wait for approval.",
          });
          return;
        } else if (user.approved === "rejected") {
          res.status(403).json({
            message: `Account rejected: ${user.approvalReason || "No reason provided"
              }`,
          });
          return;
        }
      }

      // Compare password
      const isPasswordValid = await comparePasswords(password, user.password);
      // eslint-disable-next-line no-console
      console.log(
        `[auth] password valid=${isPasswordValid} for username=${username}`,
      );
      if (!isPasswordValid) {
        res.status(401).json({ message: "Invalid credentials" });
        return;
      }

      // Generate token
      const token = generateToken(user);

      // Return user WITHOUT password
      let { password: _, ...userWithoutPassword } = user as any;

      if (user.role === 'supplier') {
        try {
          const shopRes = await query('SELECT id::text FROM shops WHERE owner_id::text = $1', [user.id]);
          if (shopRes.rows.length > 0) {
            userWithoutPassword.shopId = shopRes.rows[0].id;
          }
        } catch (e) {
          console.error("[auth] failed to fetch shop for supplier", e);
        }
      }

      res.json({
        message: "Login successful",
        user: userWithoutPassword,
        token,
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // POST /api/auth/forgot-password - Request password reset
  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;

      if (!email) {
        res.status(400).json({ message: "Email is required" });
        return;
      }

      // Check if user exists
      const user = await storage.getUserByUsername(email);
      if (!user) {
        // Don't reveal if email exists or not for security
        res.status(200).json({
          message: "If the email exists, a reset link has been sent",
        });
        return;
      }

      // TODO: Implement actual password reset logic
      // - Generate reset token
      // - Store token with expiry
      // - Send email with reset link

      // For now, just return success
      console.log(`Password reset requested for: ${email}`);
      res
        .status(200)
        .json({ message: "Password reset link sent to your email" });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ====== PROTECTED ROUTES ======

  // DEV-ONLY: list all in-memory users (no passwords) for debugging
  if (process.env.NODE_ENV !== "production") {
    app.get("/api/debug/users", async (_req, res) => {
      try {
        // storage.getAllUsers returns users with hashed passwords; omit password
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const all = (await (storage as any).getAllUsers()) as any[];
        const sanitized = all.map((u) => {
          const { password: _pw, ...rest } = u;
          return rest;
        });
        res.json({ users: sanitized });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("/api/debug/users failed", err);
        res.status(500).json({ message: "debug endpoint error" });
      }
    });
  }

  // GET /api/auth/me - Get current user profile
  app.get(
    "/api/auth/me",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        if (!req.user) {
          res.status(401).json({ message: "Unauthorized" });
          return;
        }

        const user = await storage.getUser(req.user.id);
        if (!user) {
          res.status(404).json({ message: "User not found" });
          return;
        }

        let { password: _, ...userWithoutPassword } = user as any;

        if (user.role === 'supplier') {
          try {
            const shopRes = await query('SELECT id::text FROM shops WHERE owner_id::text = $1', [user.id]);
            if (shopRes.rows.length > 0) {
              userWithoutPassword.shopId = shopRes.rows[0].id;
            }
          } catch (e) {
            console.error("[auth/me] failed to fetch shop for supplier", e);
          }
        }

        res.json(userWithoutPassword);
      } catch (error) {
        console.error("Get profile error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  // ======================================================================
  // ✅ SUPPLIER APPROVAL ROUTES (ADMIN ONLY)
  // ======================================================================

  // GET /api/suppliers-pending-approval - list suppliers pending/rejected (not approved)
  app.get(
    "/api/suppliers-pending-approval",
    authMiddleware,
    requireRole("admin"),
    async (_req: Request, res: Response) => {
      try {
        await query(
          `ALTER TABLE users ADD COLUMN IF NOT EXISTS approved text DEFAULT 'approved'`,
        );
        await query(
          `ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_reason text`,
        );

        const result = await query(
          `SELECT id, username, role, approved, approval_reason
           FROM users
           WHERE role = 'supplier' AND approved IS DISTINCT FROM 'approved'
           ORDER BY username ASC`,
        );

        res.json({ suppliers: result.rows });
      } catch (err: any) {
        console.error("/api/suppliers-pending-approval error", err);
        res.status(500).json({ message: "failed to list pending suppliers" });
      }
    },
  );

  // POST /api/suppliers/:id/approve - approve supplier
  app.post(
    "/api/suppliers/:id/approve",
    authMiddleware,
    requireRole("admin"),
    async (req: Request, res: Response) => {
      try {
        const id = req.params.id;

        await query(
          `ALTER TABLE users ADD COLUMN IF NOT EXISTS approved text DEFAULT 'approved'`,
        );
        await query(
          `ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_reason text`,
        );

        const result = await query(
          `UPDATE users
           SET approved = 'approved', approval_reason = NULL
           WHERE id = $1 AND role = 'supplier'
           RETURNING id, username, role, approved, approval_reason`,
          [id],
        );

        if (result.rowCount === 0) {
          res.status(404).json({ message: "Supplier not found" });
          return;
        }

        res.json({ supplier: result.rows[0] });
      } catch (err: any) {
        console.error("/api/suppliers/:id/approve error", err);
        res.status(500).json({ message: "failed to approve supplier" });
      }
    },
  );

  // POST /api/suppliers/:id/reject - reject supplier with reason
  app.post(
    "/api/suppliers/:id/reject",
    authMiddleware,
    requireRole("admin"),
    async (req: Request, res: Response) => {
      try {
        const id = req.params.id;
        const reason = req.body?.reason || null;

        await query(
          `ALTER TABLE users ADD COLUMN IF NOT EXISTS approved text DEFAULT 'approved'`,
        );
        await query(
          `ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_reason text`,
        );

        const result = await query(
          `UPDATE users
           SET approved = 'rejected', approval_reason = $2
           WHERE id = $1 AND role = 'supplier'
           RETURNING id, username, role, approved, approval_reason`,
          [id, reason],
        );

        if (result.rowCount === 0) {
          res.status(404).json({ message: "Supplier not found" });
          return;
        }

        res.json({ supplier: result.rows[0] });
      } catch (err: any) {
        console.error("/api/suppliers/:id/reject error", err);
        res.status(500).json({ message: "failed to reject supplier" });
      }
    },
  );

  // ======================================================================
  // ✅ ADDED: UI COMPAT ROUTES (YOUR FRONTEND CALLS /api/admin/...)
  // ======================================================================

  // GET /api/admin/pending-suppliers (frontend expects this)
  app.get(
    "/api/admin/pending-suppliers",
    authMiddleware,
    requireRole("admin"),
    async (_req: Request, res: Response) => {
      try {
        await query(
          `ALTER TABLE users ADD COLUMN IF NOT EXISTS approved text DEFAULT 'approved'`,
        );
        await query(
          `ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_reason text`,
        );

        // Only PENDING suppliers (so the page won't show approved ones)
        const result = await query(
          `SELECT id, username, role, approved, approval_reason, created_at
           FROM users
           WHERE role = 'supplier' AND approved = 'pending'
           ORDER BY created_at DESC`,
        );

        res.json({ suppliers: result.rows });
      } catch (err: any) {
        console.error("/api/admin/pending-suppliers error", err);
        res.status(500).json({ message: "failed to list pending suppliers" });
      }
    },
  );

  // POST /api/admin/suppliers/:id/approve (frontend expects this)
  app.post(
    "/api/admin/suppliers/:id/approve",
    authMiddleware,
    requireRole("admin"),
    async (req: Request, res: Response) => {
      try {
        const id = req.params.id;

        await query(
          `ALTER TABLE users ADD COLUMN IF NOT EXISTS approved text DEFAULT 'approved'`,
        );
        await query(
          `ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_reason text`,
        );

        const result = await query(
          `UPDATE users
           SET approved = 'approved', approval_reason = NULL
           WHERE id = $1 AND role = 'supplier'
           RETURNING id, username, role, approved, approval_reason`,
          [id],
        );

        if (result.rowCount === 0) {
          res.status(404).json({ message: "Supplier not found" });
          return;
        }

        res.json({ supplier: result.rows[0] });
      } catch (err: any) {
        console.error("/api/admin/suppliers/:id/approve error", err);
        res.status(500).json({ message: "failed to approve supplier" });
      }
    },
  );

  // POST /api/admin/suppliers/:id/reject (frontend expects this)
  app.post(
    "/api/admin/suppliers/:id/reject",
    authMiddleware,
    requireRole("admin"),
    async (req: Request, res: Response) => {
      try {
        const id = req.params.id;
        const reason = req.body?.reason || null;

        await query(
          `ALTER TABLE users ADD COLUMN IF NOT EXISTS approved text DEFAULT 'approved'`,
        );
        await query(
          `ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_reason text`,
        );

        const result = await query(
          `UPDATE users
           SET approved = 'rejected', approval_reason = $2
           WHERE id = $1 AND role = 'supplier'
           RETURNING id, username, role, approved, approval_reason`,
          [id, reason],
        );

        if (result.rowCount === 0) {
          res.status(404).json({ message: "Supplier not found" });
          return;
        }

        res.json({ supplier: result.rows[0] });
      } catch (err: any) {
        console.error("/api/admin/suppliers/:id/reject error", err);
        res.status(500).json({ message: "failed to reject supplier" });
      }
    },
  );

  // ====== SHOPS & MATERIALS API ======

  // GET /api/shops - list shops
  app.get("/api/shops", async (_req, res) => {
    try {
      // Return shops that are not explicitly rejected
      const result = await query(
        "SELECT * FROM shops WHERE approved IS NOT FALSE ORDER BY name ASC",
      );

      const archivedIds = archiveService.getArchivedItemIds('shops');
      const trashedIds = archiveService.getTrashedItemIds('shops');
      const filtered = result.rows.filter(r => !archivedIds.includes(r.id) && !trashedIds.includes(r.id));

      res.json({ shops: filtered });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("/api/shops error", err);
      res.status(500).json({ message: "failed to list shops" });
    }
  });

  // POST /api/shops - create shop (authenticated)
  app.post(
    "/api/shops",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        if (!req.user) {
          res
            .status(401)
            .json({ message: "Unauthorized: user not authenticated" });
          return;
        }

        const body = req.body || {};
        const id = randomUUID();
        const categories = Array.isArray(body.categories)
          ? body.categories
          : [];

        // eslint-disable-next-line no-console
        console.log(
          `[POST /api/shops] inserting shop: name=${body.name}, owner_id=${req.user.id}`,
        );

        const result = await query(
          `INSERT INTO shops (id, name, location, phoneCountryCode, contactNumber, city, state, country, pincode, image, rating, categories, gstNo, vendor_category, owner_id, approved, new_location, terms_and_conditions, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, now())
           RETURNING *`,
          [
            id,
            body.name,
            body.location || null, // This is "Address" in UI
            body.phoneCountryCode || "+91",
            body.contactNumber,
            body.city || null,
            body.state || null,
            body.country || null,
            body.pincode || null,
            body.image || null,
            body.rating || 0,
            JSON.stringify(categories),
            body.gstNo || null,
            body.vendor_category || null,
            req.user.id,
            false,
            body.new_location || null,
            body.terms_and_conditions || null,
          ],
        );

        if (!result.rows || result.rows.length === 0) {
          res
            .status(500)
            .json({ message: "failed to create shop - no rows returned" });
          return;
        }

        res.status(201).json({ shop: result.rows[0] });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("create shop error", err);
        const errMessage = err instanceof Error ? err.message : String(err);
        res
          .status(500)
          .json({ message: "failed to create shop", error: errMessage });
      }
    },
  );


  // ====== SKETCH A PLAN ROUTES (Moved for route precedence) ======

  // GET /api/materials/search - Search materials, templates, and products
  app.get("/api/materials/search", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { q } = req.query;
      const hasQuery = q && typeof q === "string" && q.trim().length > 0;
      const searchPattern = hasQuery ? `%${q}%` : null;

      let materialsRows: any[] = [];
      let templatesRows: any[] = [];
      let productsRows: any[] = [];

      // Query materials table (independent try/catch)
      try {
        const r = hasQuery
          ? await query(`SELECT m.id::text, m.name, COALESCE(m.code,'') as code, m.rate, m.unit, m.category, COALESCE(m.image, t.image) as image, 'Material' as type FROM materials m LEFT JOIN material_templates t ON m.template_id = t.id WHERE m.name ILIKE $1 OR COALESCE(m.code,'') ILIKE $1 OR COALESCE(m.category,'') ILIKE $1 OR COALESCE(m.subcategory,'') ILIKE $1 ORDER BY m.name ASC LIMIT 500`, [searchPattern])
          : await query(`SELECT m.id::text, m.name, COALESCE(m.code,'') as code, m.rate, m.unit, m.category, COALESCE(m.image, t.image) as image, 'Material' as type FROM materials m LEFT JOIN material_templates t ON m.template_id = t.id ORDER BY m.name ASC LIMIT 500`);
        materialsRows = r.rows || [];
        console.log(`[api/search] materials: ${materialsRows.length}`);
      } catch (e) {
        console.error("[api/search] materials query error:", e);
      }

      // Query material_templates table (independent try/catch)
      try {
        const r = hasQuery
          ? await query(`SELECT id::text, name, COALESCE(code,'') as code, null as rate, null as unit, COALESCE(category,'') as category, image, 'Template' as type FROM material_templates WHERE name ILIKE $1 OR COALESCE(code,'') ILIKE $1 OR COALESCE(category,'') ILIKE $1 ORDER BY name ASC LIMIT 500`, [searchPattern])
          : await query(`SELECT id::text, name, COALESCE(code,'') as code, null as rate, null as unit, COALESCE(category,'') as category, image, 'Template' as type FROM material_templates ORDER BY name ASC LIMIT 500`);
        templatesRows = r.rows || [];
        console.log(`[api/search] templates: ${templatesRows.length}`);
      } catch (e) {
        console.error("[api/search] material_templates query error:", e);
      }

      // Query products table (independent try/catch)
      // Join material_subcategories -> material_categories to get the parent category name
      try {
        const r = hasQuery
          ? await query(`SELECT p.id::text, p.name, null as code, null as rate, null as unit, COALESCE(mc.name, ms.category, p.subcategory, '') as category, p.image, 'Product' as type FROM products p LEFT JOIN material_subcategories ms ON LOWER(TRIM(p.subcategory)) = LOWER(TRIM(ms.name)) LEFT JOIN material_categories mc ON LOWER(TRIM(ms.category)) = LOWER(TRIM(mc.name)) WHERE p.name ILIKE $1 OR COALESCE(mc.name, ms.category, p.subcategory, '') ILIKE $1 ORDER BY p.name ASC LIMIT 500`, [searchPattern])
          : await query(`SELECT p.id::text, p.name, null as code, null as rate, null as unit, COALESCE(mc.name, ms.category, p.subcategory, '') as category, p.image, 'Product' as type FROM products p LEFT JOIN material_subcategories ms ON LOWER(TRIM(p.subcategory)) = LOWER(TRIM(ms.name)) LEFT JOIN material_categories mc ON LOWER(TRIM(ms.category)) = LOWER(TRIM(mc.name)) ORDER BY p.name ASC LIMIT 500`);
        productsRows = r.rows || [];
        console.log(`[api/search] products: ${productsRows.length}`);
      } catch (e) {
        console.error("[api/search] products query error:", e);
      }

      const combined = [...materialsRows, ...templatesRows, ...productsRows];
      console.log(`[api/search] total: ${combined.length} results for "${q || '(all)'}"`);
      res.json({ materials: combined });
    } catch (err) {
      console.error("GET /api/materials/search error", err);
      res.status(500).json({ message: "Failed to search materials" });
    }
  });

  // GET /api/materials - list materials
  app.get("/api/materials", async (_req, res) => {
    try {
      // Only return materials that are approved for public listing
      const result = await query(
        `SELECT m.*, s.name as shop_name, 
                mt.tax_code_type, mt.tax_code_value,
                mt.hsn_code as template_hsn_code, mt.sac_code as template_sac_code,
                m.brandname as "brandName", m.modelnumber as "modelNumber"
         FROM materials m 
         LEFT JOIN shops s ON m.shop_id = s.id 
         LEFT JOIN material_templates mt ON m.template_id = mt.id 
         WHERE m.approved IS TRUE 
         ORDER BY m.created_at DESC`,
      );

      const archivedIds = archiveService.getArchivedItemIds('materials');
      const trashedIds = archiveService.getTrashedItemIds('materials');
      const filtered = result.rows.filter(r => !archivedIds.includes(r.id) && !trashedIds.includes(r.id));

      res.json({ materials: filtered });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("/api/materials error", err);
      res.status(500).json({ message: "failed to list materials" });
    }
  });

  // GET /api/material-rate - fetch rate for a specific material template in a shop
  app.get("/api/material-rate", async (req, res) => {
    try {
      const { template_id, shop_id } = req.query;

      if (!template_id || !shop_id) {
        res.status(400).json({
          message: "template_id and shop_id are required",
        });
        return;
      }

      // First try to fetch from approved materials
      const materialResult = await query(
        `SELECT rate, unit, brandname, modelnumber, category, subcategory, product, technicalspecification, dimensions, finishtype, metaltype, image, created_at 
         FROM materials 
         WHERE template_id = $1 AND shop_id = $2 AND approved IS TRUE 
         LIMIT 1`,
        [template_id, shop_id],
      );

      if (materialResult.rows.length > 0) {
        res.json({
          found: true,
          source: "approved",
          material: materialResult.rows[0],
        });
        return;
      }

      // If no approved material found, try to fetch from material submissions
      const submissionResult = await query(
        `SELECT rate, unit, brandname, modelnumber, category, subcategory, product, technicalspecification, dimensions, finishtype, metaltype, image, submitted_at as created_at 
         FROM material_submissions 
         WHERE template_id = $1 AND shop_id = $2 
         ORDER BY submitted_at DESC 
         LIMIT 1`,
        [template_id, shop_id],
      );

      if (submissionResult.rows.length > 0) {
        res.json({
          found: true,
          source: "submitted",
          material: submissionResult.rows[0],
        });
        return;
      }

      // No rate found
      res.json({
        found: false,
        source: null,
        material: null,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("/api/material-rate error", err);
      res.status(500).json({ message: "failed to fetch material rate" });
    }
  });

  // POST /api/materials - create material (authenticated)
  app.post(
    "/api/materials",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        if (!req.user) {
          res
            .status(401)
            .json({ message: "Unauthorized: user not authenticated" });
          return;
        }

        const body = req.body || {};
        const id = randomUUID();
        // eslint-disable-next-line no-console
        console.log('[POST /api/materials] Incoming Body:', JSON.stringify(req.body, null, 2));

        const { attributes } = body;

        // Allow multiple casings
        const technicalspecification = body.technicalspecification || body.technicalSpecification || body.TechnicalSpecification || body["Technical Specification"] || null;
        const shop_id = (body.shopId === "" ? null : body.shopId) || (body.shop_id === "" ? null : body.shop_id) || null;

        // eslint-disable-next-line no-console
        console.log(
          `[POST /api/materials] extracted: name=${body.name}, shop_id=${shop_id}, technicalspecification=${technicalspecification}`,
        );

        const template_id = body.template_id || body.templateId || null;
        let hsnCode = body.hsn_code || body.hsnCode || null;
        let sacCode = body.sac_code || body.sacCode || null;

        if (template_id && (!hsnCode || !sacCode)) {
          try {
            const templateRes = await query("SELECT hsn_code, sac_code FROM material_templates WHERE id = $1", [template_id]);
            if (templateRes.rows.length > 0) {
              const t = templateRes.rows[0];
              if (!hsnCode) hsnCode = t.hsn_code;
              if (!sacCode) sacCode = t.sac_code;
            }
          } catch (e) { console.warn("[POST /api/materials] Could not fetch template for fallback codes", e); }
        }

        // Check for duplicate material within last 10 seconds with exact field matching
        const duplicateCheck = await query(
          `SELECT id FROM materials 
           WHERE name = $1 AND shop_id = $2 AND rate = $3 
           AND COALESCE(brandname, '') = COALESCE($4, '')
           AND COALESCE(modelnumber, '') = COALESCE($5, '')
           AND COALESCE(dimensions, '') = COALESCE($6, '')
           AND created_at > NOW() - INTERVAL '10 seconds'
           LIMIT 1`,
          [
            body.name || null,
            shop_id,
            parseSafeNumeric(body.rate) || 0,
            body.brandname || '',
            body.modelnumber || '',
            body.dimensions || ''
          ]
        );

        if (duplicateCheck.rows.length > 0) {
          console.log("[POST /api/materials] Blocking exact duplicate material detected within 10s window");
          res.status(409).json({ message: "Duplicate material detected. Please wait a moment." });
          return;
        }

        const result = await query(
          `INSERT INTO materials (id, template_id, name, code, rate, shop_id, unit, category, brandname, modelnumber, subcategory, product, technicalspecification, dimensions, finishtype, metaltype, image, attributes, master_material_id, hsn_code, sac_code, approved, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22, now()) RETURNING *`,
          [
            id,
            template_id,
            body.name || null,
            body.code || null,
            parseSafeNumeric(body.rate) || 0,
            shop_id,
            body.unit || null,
            body.category || body.Category || null,
            body.brandName || body.brandname || null,
            body.modelNumber || body.modelnumber || null,
            body.subCategory || body.subcategory || null,
            body.product || null,
            technicalspecification,
            body.dimensions || body.Dimensions || null,
            body.finishtype || body.finishType || body.FinishType || null,
            body.metaltype || body.metalType || body.MetalType || body.materialtype || body.materialType || null,
            body.image || null,
            JSON.stringify(attributes || {}),
            body.masterMaterialId || null,
            hsnCode,
            sacCode,
            true, // Default to true for admin-created materials
          ],
        );

        if (!result.rows || result.rows.length === 0) {
          res
            .status(500)
            .json({ message: "failed to create material - no rows returned" });
          return;
        }

        res.status(201).json({ material: result.rows[0] });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("create material error", err);
        const errMessage = err instanceof Error ? err.message : String(err);
        res
          .status(500)
          .json({ message: "failed to create material", error: errMessage });
      }
    },
  );

  // GET /api/shops/:id
  app.get("/api/shops/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const result = await query("SELECT * FROM shops WHERE id = $1", [id]);
      if (result.rowCount === 0)
        return res.status(404).json({ message: "not found" });
      res.json({ shop: result.rows[0] });
    } catch (err: unknown) {
      console.error(err as any);
      res.status(500).json({ message: "error" });
    }
  });

  // PUT /api/shops/:id
  app.put("/api/shops/:id", authMiddleware, async (req, res) => {
    try {
      const id = req.params.id;
      const body = req.body || {};
      console.log("PUT /api/shops/:id - Received body:", JSON.stringify(body, null, 2));
      console.log("PUT /api/shops/:id - Shop ID:", id);

      const fields: string[] = [];
      const vals: any[] = [];
      let idx = 1;

      // Map of request field names to database column names
      const fieldMapping: Record<string, string> = {
        "name": "name",
        "location": "location",
        "phoneCountryCode": "phoneCountryCode",
        "contactNumber": "contactNumber",
        "city": "city",
        "state": "state",
        "country": "country",
        "pincode": "pincode",
        "image": "image",
        "rating": "rating",
        "gstNo": "gstno",
        "vendorCategory": "vendor_category",
        "new_location": "new_location",
        "terms_and_conditions": "terms_and_conditions",
      };

      for (const k of Object.keys(fieldMapping)) {
        if (body[k] !== undefined) {
          let value = body[k];
          // Special handling for rating - ensure it's a number or null
          if (k === 'rating') {
            value = (typeof value === 'number' && !isNaN(value)) ? value : null;
          }
          fields.push(`${fieldMapping[k]} = $${idx++}`);
          vals.push(value);
        }
      }
      if (body.categories !== undefined) {
        let categoriesValue;
        try {
          categoriesValue = Array.isArray(body.categories) ? JSON.stringify(body.categories) : JSON.stringify([]);
        } catch (e) {
          console.log("PUT /api/shops/:id - Error stringifying categories:", e);
          categoriesValue = JSON.stringify([]);
        }
        fields.push(`categories = $${idx++}`);
        vals.push(categoriesValue);
      }

      console.log("PUT /api/shops/:id - Fields to update:", fields);
      console.log("PUT /api/shops/:id - Values:", vals);

      if (fields.length === 0)
        return res.status(400).json({ message: "no fields" });
      vals.push(id);
      const q = `UPDATE shops SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`;
      console.log("PUT /api/shops/:id - SQL Query:", q);
      console.log("PUT /api/shops/:id - Final values array:", vals);

      const result = await query(q, vals);
      if (result.rowCount === 0) {
        console.log("PUT /api/shops/:id - No rows updated, shop not found");
        return res.status(404).json({ message: "Shop not found" });
      }
      console.log("PUT /api/shops/:id - Update successful, rows affected:", result.rowCount);
      res.json({ shop: result.rows[0] });
    } catch (err: unknown) {
      console.error("PUT /api/shops/:id - Database error:", err);
      if (err instanceof Error) {
        console.error("PUT /api/shops/:id - Error message:", err.message);
        console.error("PUT /api/shops/:id - Error stack:", err.stack);
      }
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      res.status(500).json({ message: "Failed to update shop", error: errorMessage });
    }
  });

  // DELETE /api/shops/:id
  app.delete(
    "/api/shops/:id",
    authMiddleware,
    requireRole("admin", "software_team"),
    async (req, res) => {
      try {
        const id = req.params.id;
        // Fetch shop data before archiving
        const shopRes = await query("SELECT * FROM shops WHERE id = $1", [id]);
        if (shopRes.rows.length === 0) {
          return res.status(404).json({ message: "Shop not found" });
        }

        const archived = archiveService.archiveItem('shops', id, shopRes.rows[0]);
        if (req.query.action === 'trash' && archived) {
          archiveService.trashArchiveItem(archived.id);
        }

        res.json({ message: "deleted" });
      } catch (err: unknown) {
        console.error(err as any);
        res.status(500).json({ message: "error" });
      }
    },
  );

  // Approve / reject shop
  app.post(
    "/api/shops/:id/approve",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team"),
    async (req, res) => {
      try {
        const id = req.params.id;
        // ensure approved column exists
        await query(
          "ALTER TABLE shops ADD COLUMN IF NOT EXISTS approved boolean DEFAULT true",
        );
        await query(
          "ALTER TABLE shops ADD COLUMN IF NOT EXISTS approval_reason text",
        );
        const result = await query(
          "UPDATE shops SET approved = true, approval_reason = NULL WHERE id = $1 RETURNING *",
          [id],
        );
        res.json({ shop: result.rows[0] });
      } catch (err: unknown) {
        console.error(err as any);
        res.status(500).json({ message: "error" });
      }
    },
  );

  app.post(
    "/api/shops/:id/reject",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team"),
    async (req, res) => {
      try {
        const id = req.params.id;
        // Delete associated materials first, then the shop itself
        await query("DELETE FROM materials WHERE shop_id = $1", [id]);
        await query("DELETE FROM shops WHERE id = $1", [id]);
        res.json({ message: "Shop rejected and removed", id });
      } catch (err: unknown) {
        console.error(err as any);
        res.status(500).json({ message: "error" });
      }
    },
  );

  // MATERIAL endpoints: GET by id, PUT, DELETE, approve/reject
  app.get("/api/materials/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const result = await query(
        `SELECT m.*, s.name as shop_name, 
                mt.tax_code_type, mt.tax_code_value,
                mt.hsn_code as template_hsn_code, mt.sac_code as template_sac_code 
         FROM materials m 
         LEFT JOIN shops s ON m.shop_id = s.id 
         LEFT JOIN material_templates mt ON m.template_id = mt.id 
         WHERE m.id = $1`,
        [id],
      );
      if (result.rowCount === 0)
        return res.status(404).json({ message: "not found" });
      res.json({ material: result.rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "error" });
    }
  });

  app.put("/api/materials/:id", authMiddleware, async (req, res) => {
    try {
      const id = req.params.id;
      const body = req.body || {};
      const fields: string[] = [];
      const vals: any[] = [];
      let idx = 1;
      for (const k of [
        "name",
        "code",
        "rate",
        "shop_id",
        "unit",
        "category",
        "brandname",
        "modelnumber",
        "subcategory",
        "subCategory",
        "product",
        "hsn_code",
        "hsnCode",
        "sac_code",
        "sacCode",
        "technicalspecification",
        "dimensions",
        "finishtype",
        "metaltype",
        "metalType",
        "materialtype",
        "materialType",
        "image",
        "template_id",
        "templateId"
      ]) {
        if (body[k] !== undefined) {
          let val = body[k];
          let dbFieldName = k;
          if (k === "templateId") dbFieldName = "template_id";
          if (k === "subCategory") dbFieldName = "subcategory";
          if (k === "metalType" || k === "materialtype" || k === "materialType") dbFieldName = "metaltype";
          if (k === "hsnCode") dbFieldName = "hsn_code";
          if (k === "sacCode") dbFieldName = "sac_code";
          if (k === "brandName") dbFieldName = "brandname";
          if (k === "modelNumber") dbFieldName = "modelnumber";
          if (k === "finishType") dbFieldName = "finishtype";

          if (dbFieldName === "shop_id" && val === "") val = null;
          if (dbFieldName === "rate") val = parseSafeNumeric(val);
          fields.push(`${dbFieldName} = $${idx++}`);
          vals.push(val);
        }
      }
      if (body.attributes !== undefined) {
        fields.push(`attributes = $${idx++}`);
        vals.push(JSON.stringify(body.attributes));
      }
      if (fields.length === 0)
        return res.status(400).json({ message: "no fields" });

      // --- Fetch old material record before updating (for rate change detection) ---
      let oldMaterial: any = null;
      try {
        const oldRes = await query(
          `SELECT m.*, s.name as shop_name FROM materials m LEFT JOIN shops s ON m.shop_id = s.id WHERE m.id = $1`,
          [id]
        );
        oldMaterial = oldRes.rows[0] || null;
      } catch (e) {
        console.warn("[PUT /api/materials/:id] Could not fetch old material for rate comparison:", e);
      }

      vals.push(id);
      const q = `UPDATE materials SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`;
      console.log('[PUT /api/materials/:id] body:', body);
      console.log('[PUT /api/materials/:id] query:', q);
      console.log('[PUT /api/materials/:id] vals:', vals);
      const result = await query(q, vals);
      const updatedMaterial = result.rows[0];
      res.json({ material: updatedMaterial });

      // --- Send email notification if rate changed (fire-and-forget) ---
      const newRate = body.rate !== undefined ? parseSafeNumeric(body.rate) : null;
      const oldRate = oldMaterial ? parseFloat(String(oldMaterial.rate)) : null;
      const rateActuallyChanged = newRate !== null && oldRate !== null && Math.abs(newRate - oldRate) > 0.001;

      if (rateActuallyChanged && updatedMaterial) {
        (async () => {
          try {
            // Get all admin user emails (username is used as email in this system)
            const adminRes = await query(
              `SELECT username FROM users WHERE role IN ('admin', 'software_team') AND approved = 'approved'`
            );
            const adminEmails: string[] = adminRes.rows
              .map((r: any) => r.username)
              .filter((email: string) => email && email.includes("@"));

            // Also include ADMIN_EMAIL env var if set
            const envAdminEmail = process.env.ADMIN_EMAIL;
            if (envAdminEmail && !adminEmails.includes(envAdminEmail)) {
              adminEmails.push(envAdminEmail);
            }

            if (adminEmails.length > 0) {
              const user = (req as any).user;
              await sendMaterialRateChangeEmail(adminEmails, {
                materialName: updatedMaterial.name || oldMaterial?.name || "Unknown Material",
                materialCode: updatedMaterial.code || oldMaterial?.code,
                category: updatedMaterial.category || oldMaterial?.category,
                oldRate: oldRate!,
                newRate: newRate!,
                changedBy: user?.username || "Unknown User",
                changedByRole: user?.role,
                shopName: updatedMaterial.shop_name || oldMaterial?.shop_name,
                materialId: id,
              });
            } else {
              console.warn("[EMAIL] No valid admin emails found for rate change notification. Set ADMIN_EMAIL in .env or ensure admin usernames are email addresses.");
            }
          } catch (emailErr) {
            console.error("[EMAIL] Failed to send material rate change notification:", emailErr);
          }
        })();
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "error" });
    }
  });

  app.delete(
    "/api/materials/:id",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team"),
    async (req, res) => {
      try {
        const id = req.params.id;

        // Look up the material first to find template_id and shop_id
        const matResult = await query("SELECT * FROM materials WHERE id = $1", [id]);
        const mat = matResult.rows[0];

        if (!mat) {
          return res.status(404).json({ message: "Material not found" });
        }

        // Archive the material instead of deleting
        const archived = archiveService.archiveItem('materials', id, mat);
        if (req.query.action === 'trash' && archived) {
          archiveService.trashArchiveItem(archived.id);
        }

        res.json({ message: "deleted" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "error" });
      }
    },
  );

  app.post(
    "/api/materials/:id/approve",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team"),
    async (req, res) => {
      try {
        const id = req.params.id;
        await query(
          "ALTER TABLE materials ADD COLUMN IF NOT EXISTS approved boolean DEFAULT true",
        );
        await query(
          "ALTER TABLE materials ADD COLUMN IF NOT EXISTS approval_reason text",
        );
        const result = await query(
          "UPDATE materials SET approved = true, approval_reason = NULL WHERE id = $1 RETURNING *",
          [id],
        );
        res.json({ material: result.rows[0] });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "error" });
      }
    },
  );

  app.post(
    "/api/materials/:id/reject",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team"),
    async (req: Request, res: Response) => {
      try {
        const id = req.params.id;
        const reason = req.body?.reason || null;
        await query(
          "ALTER TABLE materials ADD COLUMN IF NOT EXISTS approved boolean DEFAULT true",
        );
        await query(
          "ALTER TABLE materials ADD COLUMN IF NOT EXISTS approval_reason text",
        );
        const result = await query(
          "UPDATE materials SET approved = false, approval_reason = $2 WHERE id = $1 RETURNING *",
          [id, reason],
        );
        res.json({ material: result.rows[0] });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "error" });
      }
    },
  );


  app.get("/api/shops-pending-approval", async (_req, res) => {
    try {
      const result = await query(
        "SELECT * FROM shops WHERE approved IS NOT TRUE ORDER BY created_at DESC",
      );
      const requests = result.rows.map((r: any) => ({
        id: r.id,
        status: "pending",
        shop: r,
      }));
      res.json({ shops: requests });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("/api/shops-pending-approval error", err);
      res.status(500).json({ message: "failed to list pending shops" });
    }
  });

  // ====== VENDOR CATEGORIES ROUTES ======

  // GET /api/vendor-categories - List all vendor categories
  app.get("/api/vendor-categories", async (_req, res) => {
    try {
      const result = await query(
        "SELECT * FROM vendor_categories ORDER BY name ASC",
      );
      res.json({ categories: result.rows });
    } catch (err) {
      console.error("/api/vendor-categories GET error", err);
      res.status(500).json({ message: "failed to list vendor categories" });
    }
  });

  // POST /api/vendor-categories - Create a new vendor category
  app.post(
    "/api/vendor-categories",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team"),
    async (req: Request, res: Response) => {
      try {
        const { name, description } = req.body;

        if (!name || !name.trim()) {
          res.status(400).json({ message: "Name is required" });
          return;
        }

        // Case-insensitive check before insert
        const existing = await query(
          "SELECT id FROM vendor_categories WHERE LOWER(name) = LOWER($1)",
          [name.trim()],
        );

        if (existing.rows.length > 0) {
          res.status(409).json({ message: "VENDOR CATEGORY ALREADY EXISTS" });
          return;
        }

        const result = await query(
          `INSERT INTO vendor_categories (name, description, created_at, updated_at) 
           VALUES ($1, $2, NOW(), NOW()) 
           RETURNING *`,
          [name.trim(), description || null],
        );

        res.status(201).json({ category: result.rows[0] });
      } catch (err: any) {
        console.error("/api/vendor-categories POST error", err);
        if (err.code === "23505") {
          // Unique constraint violation
          res.status(409).json({ message: "VENDOR CATEGORY ALREADY EXISTS" });
        } else {
          res.status(500).json({ message: "failed to create vendor category" });
        }
      }
    },
  );

  // PUT /api/vendor-categories/:id - Update a vendor category
  app.put(
    "/api/vendor-categories/:id",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team"),
    async (req: Request, res: Response) => {
      try {
        const id = req.params.id;
        const { name, description } = req.body;

        const fields: string[] = [];
        const vals: any[] = [];
        let idx = 1;

        if (name !== undefined && name.trim()) {
          fields.push(`name = $${idx++}`);
          vals.push(name.trim());
        }

        if (description !== undefined) {
          fields.push(`description = $${idx++}`);
          vals.push(description);
        }

        if (fields.length === 0) {
          res.status(400).json({ message: "No fields to update" });
          return;
        }

        fields.push(`updated_at = $${idx++}`);
        vals.push(new Date());
        vals.push(id);

        const q = `UPDATE vendor_categories SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`;
        const result = await query(q, vals);

        if (result.rows.length === 0) {
          res.status(404).json({ message: "Vendor category not found" });
          return;
        }

        res.json({ category: result.rows[0] });
      } catch (err: any) {
        console.error("/api/vendor-categories PUT error", err);
        if (err.code === "23505") {
          res.status(409).json({ message: "Vendor category name already exists" });
        } else {
          res.status(500).json({ message: "failed to update vendor category" });
        }
      }
    },
  );

  // DELETE /api/vendor-categories/:id - Delete a vendor category
  app.delete(
    "/api/vendor-categories/:id",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team"),
    async (req: Request, res: Response) => {
      try {
        const id = req.params.id;

        const result = await query(
          "DELETE FROM vendor_categories WHERE id = $1 RETURNING id",
          [id],
        );

        if (result.rowCount === 0) {
          res.status(404).json({ message: "Vendor category not found" });
          return;
        }

        res.json({ message: "Vendor category deleted successfully" });
      } catch (err: any) {
        console.error("/api/vendor-categories DELETE error", err);
        res.status(500).json({ message: "failed to delete vendor category" });
      }
    },
  );

  // ====== MATERIAL TEMPLATES ROUTES (Admin/Software Team only) ======

  // GET /api/material-templates - List all material templates
  app.get("/api/material-templates", async (_req, res) => {
    try {
      const result = await query(
        "SELECT * FROM material_templates ORDER BY created_at DESC",
      );
      res.json({ templates: result.rows });
    } catch (err) {
      console.error("/api/material-templates error", err);
      res.status(500).json({ message: "failed to list material templates" });
    }
  });

  // POST /api/material-templates - Create a new material template
  app.post(
    "/api/material-templates",
    authMiddleware,
    requireRoleOrPermission(["admin", "software_team", "purchase_team"], "create_item"),
    async (req: Request, res: Response) => {
      try {
        const { name, code, category, subcategory, vendorCategory, taxCodeType, taxCodeValue, hsnCode, sacCode, hsn_code, sac_code, technicalspecification, technicalSpecification, image, metaltype, metalType, brandname, brandName, dimensions, Dimensions, finishtype, finishType } = req.body;

        if (!name || !name.trim()) {
          res.status(400).json({ message: "Template name is required" });
          return;
        }

        if (!code || !code.trim()) {
          res.status(400).json({ message: "Template code is required" });
          return;
        }

        const id = randomUUID();
        const result = await query(
          `INSERT INTO material_templates (id, name, code, category, subcategory, vendor_category, tax_code_type, tax_code_value, hsn_code, sac_code, technicalspecification, image, metaltype, brandname, dimensions, finishtype, created_at, updated_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW()) 
         RETURNING *`,
          [id, name.trim(), code.trim(), category || null, subcategory || null, vendorCategory || null, taxCodeType || null, taxCodeValue || null, hsnCode || hsn_code || null, sacCode || sac_code || null, technicalSpecification || technicalspecification || null, image || null, metalType || metaltype || null, brandName || brandname || null, Dimensions || dimensions || null, finishType || finishtype || null],
        );

        res.status(201).json({ template: result.rows[0] });
      } catch (err) {
        console.error("/api/material-templates POST error", err);
        res.status(500).json({ message: "failed to create material template" });
      }
    },
  );

  // PUT /api/material-templates/:id - Update a material template
  app.put(
    "/api/material-templates/:id",
    authMiddleware,
    requireRoleOrPermission(["admin", "software_team", "purchase_team"], "create_item"),
    async (req: Request, res: Response) => {
      try {
        const id = req.params.id;
        console.log('[PUT /api/material-templates/:id] user:', (req as any).user);
        console.log('[PUT /api/material-templates/:id] params.id:', req.params.id);
        console.log('[PUT /api/material-templates/:id] body:', { ...req.body, image: req.body.image ? "present" : "absent" });
        const { name, code, category, subcategory, vendorCategory, taxCodeType, taxCodeValue, hsnCode, sacCode, hsn_code, sac_code, technicalspecification, technicalSpecification, vendor_category, tax_code_type, tax_code_value, image, metaltype, metalType, brandname, brandName, dimensions, Dimensions, finishtype, finishType } = req.body;

        // Only update fields that are provided
        const fields: string[] = [];
        const vals: any[] = [];
        let idx = 1;

        if (name !== undefined) {
          fields.push(`name = $${idx++}`);
          vals.push(name?.trim() || null);
        }
        if (code !== undefined) {
          fields.push(`code = $${idx++}`);
          vals.push(code?.trim() || null);
        }
        if (category !== undefined) {
          fields.push(`category = $${idx++}`);
          vals.push(category || null);
        }
        if (subcategory !== undefined) {
          fields.push(`subcategory = $${idx++}`);
          vals.push(subcategory || null);
        }
        if (vendorCategory !== undefined || vendor_category !== undefined) {
          fields.push(`vendor_category = $${idx++}`);
          vals.push((vendorCategory !== undefined ? vendorCategory : vendor_category) || null);
        }
        if (taxCodeType !== undefined || tax_code_type !== undefined) {
          fields.push(`tax_code_type = $${idx++}`);
          vals.push((taxCodeType !== undefined ? taxCodeType : tax_code_type) || null);
        }
        if (taxCodeValue !== undefined || tax_code_value !== undefined) {
          fields.push(`tax_code_value = $${idx++}`);
          vals.push((taxCodeValue !== undefined ? taxCodeValue : tax_code_value) || null);
        }
        if (technicalspecification !== undefined || technicalSpecification !== undefined) {
          fields.push(`technicalspecification = $${idx++}`);
          vals.push((technicalSpecification !== undefined ? technicalSpecification : technicalspecification) || null);
        }
        if (hsnCode !== undefined || hsn_code !== undefined) {
          fields.push(`hsn_code = $${idx++}`);
          vals.push(hsnCode || hsn_code || null);
        }
        if (sacCode !== undefined || sac_code !== undefined) {
          fields.push(`sac_code = $${idx++}`);
          vals.push(sacCode || sac_code || null);
        }
        if (image !== undefined) {
          fields.push(`image = $${idx++}`);
          vals.push(image || null);
        }
        if (metaltype !== undefined || metalType !== undefined) {
          fields.push(`metaltype = $${idx++}`);
          vals.push((metalType !== undefined ? metalType : metaltype) || null);
        }
        if (brandname !== undefined || brandName !== undefined) {
          fields.push(`brandname = $${idx++}`);
          vals.push((brandName !== undefined ? brandName : brandname) || null);
        }
        if (dimensions !== undefined || Dimensions !== undefined) {
          fields.push(`dimensions = $${idx++}`);
          vals.push((Dimensions !== undefined ? Dimensions : dimensions) || null);
        }
        if (finishtype !== undefined || finishType !== undefined) {
          fields.push(`finishtype = $${idx++}`);
          vals.push((finishType !== undefined ? finishType : finishtype) || null);
        }

        if (fields.length === 0) {
          res.status(400).json({ message: "No fields to update" });
          return;
        }

        fields.push(`updated_at = $${idx++}`);
        vals.push(new Date());
        vals.push(id);

        const q = `UPDATE material_templates SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`;
        console.log('[material-templates PUT] query:', q, 'vals:', vals);
        const result = await query(q, vals);

        if (result.rows.length === 0) {
          res.status(404).json({ message: "Template not found" });
          return;
        }

        // Cascade name/code/category/subcategory changes to linked materials
        const updated = result.rows[0];
        try {
          const cascadeFields: string[] = [];
          const cascadeVals: any[] = [];
          let ci = 1;

          if (updated.name) { cascadeFields.push(`name = $${ci++}`); cascadeVals.push(updated.name); }
          if (updated.code) { cascadeFields.push(`code = $${ci++}`); cascadeVals.push(updated.code); }
          if (updated.category !== undefined) { cascadeFields.push(`category = $${ci++}`); cascadeVals.push(updated.category); }
          if (updated.subcategory !== undefined) { cascadeFields.push(`subcategory = $${ci++}`); cascadeVals.push(updated.subcategory); }
          if (updated.technicalspecification !== undefined) { cascadeFields.push(`technicalspecification = $${ci++}`); cascadeVals.push(updated.technicalspecification); }


          if (cascadeFields.length > 0) {
            cascadeVals.push(id);
            const cascadeQ = `UPDATE materials SET ${cascadeFields.join(", ")} WHERE template_id = $${ci}`;
            const cascadeRes = await query(cascadeQ, cascadeVals);
            console.log(`[material-templates PUT] Cascaded updates to ${cascadeRes.rowCount} linked materials`);
          }
        } catch (cascadeErr) {
          console.warn("[material-templates PUT] Cascade to materials failed (non-fatal):", cascadeErr);
        }

        res.json({ template: result.rows[0] });
      } catch (err) {
        console.error("/api/material-templates PUT error", err);
        res.status(500).json({ message: "failed to update material template" });
      }
    },
  );

  // GET /api/material-templates/usage - Get IDs of templates currently in use
  app.get("/api/material-templates/usage", async (_req, res) => {
    try {
      // Check materials table
      const mats = await query("SELECT DISTINCT template_id FROM materials WHERE template_id IS NOT NULL");
      // Check submissions table
      const subs = await query("SELECT DISTINCT template_id FROM material_submissions WHERE template_id IS NOT NULL");
      // Check boq_items table (parsing material_ from estimator field)
      const boqs = await query("SELECT DISTINCT SUBSTRING(estimator FROM 10) as template_id FROM boq_items WHERE estimator LIKE 'material_%'");

      const usedIds = new Set([
        ...mats.rows.map(r => r.template_id),
        ...subs.rows.map(r => r.template_id),
        ...boqs.rows.map(r => r.template_id)
      ]);

      res.json({ usedIds: Array.from(usedIds) });
    } catch (err) {
      console.error("/api/material-templates/usage error", err);
      res.status(500).json({ message: "failed to fetch usage summary" });
    }
  });

  // GET /api/material-templates/:id/impact - Get impact info before deleting a template
  app.get(
    "/api/material-templates/:id/impact",
    async (req: Request, res: Response) => {
      try {
        const id = req.params.id;

        // Get template details
        const tplRes = await query("SELECT name, code FROM material_templates WHERE id = $1", [id]);
        if (tplRes.rows.length === 0) {
          res.status(404).json({ message: "Template not found" });
          return;
        }
        const tpl = tplRes.rows[0];

        // Get linked materials (by template_id)
        const linkedMats = await query(
          `SELECT m.id, m.name, m.code, m.rate, m.unit, m.shop_id, s.name as shop_name
           FROM materials m
           LEFT JOIN shops s ON m.shop_id = s.id
           WHERE m.template_id = $1
           ORDER BY s.name, m.name`,
          [id],
        );

        // Get orphaned materials (template_id IS NULL but matching name/code)
        const orphanMats = await query(
          `SELECT m.id, m.name, m.code, m.rate, m.unit, m.shop_id, s.name as shop_name
           FROM materials m
           LEFT JOIN shops s ON m.shop_id = s.id
           WHERE m.template_id IS NULL AND (m.name = $1 OR m.code = $2)
           ORDER BY s.name, m.name`,
          [tpl.name, tpl.code],
        );

        // Get material submissions
        const subs = await query(
          `SELECT ms.id, ms.rate, ms.unit, ms.shop_id, s.name as shop_name
           FROM material_submissions ms
           LEFT JOIN shops s ON ms.shop_id = s.id
           WHERE ms.template_id = $1
           ORDER BY s.name`,
          [id],
        );

        res.json({
          template: tpl,
          linkedMaterials: linkedMats.rows,
          orphanedMaterials: orphanMats.rows,
          submissions: subs.rows,
          totalAffected: linkedMats.rows.length + orphanMats.rows.length + subs.rows.length,
        });
      } catch (err) {
        console.error("/api/material-templates/:id/impact error", err);
        res.status(500).json({ message: "Failed to fetch impact" });
      }
    },
  );

  // DELETE /api/material-templates/:id - Delete a material template
  app.delete(
    "/api/material-templates/:id",
    authMiddleware,
    requireRoleOrPermission(["admin", "software_team", "purchase_team"], "create_item"),
    async (req: Request, res: Response) => {
      try {
        const id = req.params.id;
        console.log(
          "[DELETE /material-templates/:id] Attempting to delete template:",
          id,
        );

        // First, check if template exists
        const checkResult = await query(
          "SELECT id FROM material_templates WHERE id = $1",
          [id],
        );
        console.log("[DELETE] Template exists?", checkResult.rows.length > 0);

        if (checkResult.rows.length === 0) {
          console.log("[DELETE] Template not found");
          res.status(404).json({ message: "Template not found" });
          return;
        }

        // Perform dependent deletes inside a transaction to avoid FK violations
        console.log(
          "[DELETE] Beginning transaction to remove dependent rows for template_id =",
          id,
        );
        await query("BEGIN");
        try {
          // Remove any material_submissions that reference this template
          console.log(
            "[DELETE] Deleting material_submissions with template_id =",
            id,
          );
          const subsRes = await query(
            "DELETE FROM material_submissions WHERE template_id = $1",
            [id],
          );
          console.log(
            "[DELETE] Deleted material_submissions:",
            subsRes.rowCount,
          );

          // Before deleting the template, identify any orphaned materials 
          // (template_id is null) that match this template's name/code
          const templateResult = await query("SELECT name, code FROM material_templates WHERE id = $1", [id]);
          const tpl = templateResult.rows[0];

          if (tpl) {
            console.log("[DELETE] Cleaning up orphaned materials for:", tpl.name, tpl.code);
            const orphanRes = await query(
              "DELETE FROM materials WHERE template_id IS NULL AND (name = $1 OR code = $2)",
              [tpl.name, tpl.code]
            );
            console.log("[DELETE] Deleted orphaned materials:", orphanRes.rowCount);
          }

          // Also delete any materials that reference this template
          console.log("[DELETE] Deleting materials with template_id =", id);
          const matsResult = await query(
            "DELETE FROM materials WHERE template_id = $1",
            [id],
          );
          console.log("[DELETE] Deleted materials:", matsResult.rowCount);

          // Delete the template itself
          console.log("[DELETE] Deleting material_template with id =", id);
          const result = await query(
            "DELETE FROM material_templates WHERE id = $1 RETURNING id",
            [id],
          );
          console.log(
            "[DELETE] Delete result rows:",
            result.rows.length,
            "rowCount:",
            result.rowCount,
          );

          await query("COMMIT");

          if (result.rows.length === 0) {
            console.log("[DELETE] No rows deleted");
            res.status(404).json({ message: "Template not found" });
            return;
          }

          console.log(
            "[DELETE] Successfully deleted template and dependents:",
            id,
          );
          res.json({ message: "Template deleted successfully" });
          return;
        } catch (innerErr) {
          console.error("[DELETE] Transaction failed, rolling back", innerErr);
          try {
            await query("ROLLBACK");
          } catch (rbErr) {
            console.error("ROLLBACK failed", rbErr);
          }
          throw innerErr;
        }

        if (checkResult.rows.length === 0) {
          console.log("[DELETE] No rows deleted");
          res.status(404).json({ message: "Template not found" });
          return;
        }

        console.log("[DELETE] Successfully deleted template:", id);
        res.json({ message: "Template deleted successfully" });
      } catch (err) {
        console.error("/api/material-templates DELETE error", err);
        res.status(500).json({
          message: "failed to delete material template",
          error: String(err),
        });
      }
    },
  );

  // GET /api/material-categories - List categories created by admin/software_team/purchase_team
  app.get("/api/material-categories", async (_req, res) => {
    try {
      // Return all categories (including seeded ones)
      const result = await query(`
        SELECT DISTINCT name FROM material_categories
        ORDER BY name ASC
      `);
      const categories = result.rows.map((row) => row.name).filter(Boolean);
      res.json({ categories });
    } catch (err) {
      console.error("/api/material-categories error", err);
      res.status(500).json({ message: "failed to list categories" });
    }
  });

  // POST /api/bulk-materials - Bulk upload material rows (admin / software_team / purchase_team)
  app.post(
    "/api/bulk-materials",
    authMiddleware,
    requireRoleOrPermission(["admin", "software_team", "purchase_team"], "create_item"),
    async (req: Request, res: Response) => {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

      if (rows.length === 0) {
        res.status(400).json({ message: "No rows provided" });
        return;
      }

      const createdTemplates: any[] = [];
      const createdSubmissions: any[] = [];
      const skipped: any[] = [];
      const errors: any[] = [];

      try {
        await query("BEGIN");
        // eslint-disable-next-line no-console
        console.log(`[POST /api/bulk-materials] Processing ${rows.length} rows`);

        for (let i = 0; i < rows.length; i++) {
          const raw = rows[i] || {};
          const name = (raw.name || raw.Name || "").toString().trim();
          const code = (raw.code || raw.Code || raw.item_code || "").toString().trim();
          const category = (raw.category || raw.Category || "").toString().trim() || null;
          const subcategory = (raw.subcategory || raw.Subcategory || "").toString().trim() || null;
          const unit = (raw.unit || raw.Unit || "").toString().trim() || null;
          const rate = parseSafeNumeric(raw.rate);
          const vendor_category = (raw.vendor_category || raw.vendorCategory || null) || null;
          let tax_code_type = (raw.tax_code_type || raw.taxCodeType || null) || null;

          if (tax_code_type) {
            const t = String(tax_code_type).toLowerCase().trim();
            if (t.includes("hsn")) tax_code_type = "hsn";
            else if (t.includes("sac")) tax_code_type = "sac";
            else if (t.includes("gst")) tax_code_type = "hsn";
            else tax_code_type = null;
          }
          const tax_code_value = (raw.tax_code_value || raw.taxCodeValue || null) || null;
          const technicalspecification = (raw.technicalspecification || raw.technicalSpecification || raw.TechnicalSpecification || raw["Technical Specification"] || null) || null;
          const shop_name = (raw.shop_name || raw.ShopName || raw.shopName || raw["Shop Name"] || "").toString().trim();

          if (!name) {
            skipped.push({ row: i, reason: "missing name" });
            continue;
          }

          let shop_id = null;
          if (shop_name) {
            const shopRes = await query(`SELECT id FROM shops WHERE LOWER(name) = LOWER($1) LIMIT 1`, [shop_name]);
            if (shopRes.rows.length > 0) {
              shop_id = shopRes.rows[0].id;
            } else {
              errors.push({ row: i, error: `Shop "${shop_name}" not found in database.` });
              continue;
            }
          } else {
            errors.push({ row: i, error: "Shop name is required for bulk upload." });
            continue;
          }

          // Ensure category and subcategory exist in their own lookup tables
          if (category) {
            try {
              const catExists = await query('SELECT id FROM material_categories WHERE LOWER(name) = LOWER($1) LIMIT 1', [category]);
              if (catExists.rows.length === 0) {
                await query('INSERT INTO material_categories (id, name, created_at) VALUES ($1, $2, NOW())', [randomUUID(), category]);
              }
            } catch (catErr) {
              console.warn(`[Bulk Upload] Failed to ensure category "${category}":`, catErr);
            }
          }

          if (category && subcategory) {
            try {
              const subExists = await query('SELECT id FROM material_subcategories WHERE LOWER(name) = LOWER($1) AND LOWER(category) = LOWER($2) LIMIT 1', [subcategory, category]);
              if (subExists.rows.length === 0) {
                await query('INSERT INTO material_subcategories (id, name, category, created_at) VALUES ($1, $2, $3, NOW())', [randomUUID(), subcategory, category]);
              }
            } catch (subErr) {
              console.warn(`[Bulk Upload] Failed to ensure subcategory "${subcategory}" for category "${category}":`, subErr);
            }
          }

          // Ensure or create material_template
          let templateId: string | null = null;
          try {
            if (code) {
              const existing = await query(`SELECT id FROM material_templates WHERE code = $1 LIMIT 1`, [code]);
              if (existing.rows.length > 0) templateId = existing.rows[0].id;
            }
            if (!templateId) {
              const byName = await query(`SELECT id FROM material_templates WHERE name = $1 LIMIT 1`, [name]);
              if (byName.rows.length > 0) templateId = byName.rows[0].id;
            }

            if (!templateId) {
              const tId = randomUUID();
              const tCode = code || `ITM-${tId.slice(0, 8)}`;
              const tpl = await query(
                `INSERT INTO material_templates (id, name, code, category, subcategory, vendor_category, tax_code_type, tax_code_value, hsn_code, sac_code, technicalspecification, brandname, created_at, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW()) RETURNING *`,
                [tId, name, tCode, category, subcategory, vendor_category, tax_code_type, tax_code_value, raw.hsn_code || raw.hsnCode || null, raw.sac_code || raw.sacCode || null, technicalspecification, raw.brandname || raw.brandName || null],
              );
              templateId = tpl.rows[0].id;
              createdTemplates.push(tpl.rows[0]);
            }
          } catch (tplErr) {
            errors.push({ row: i, error: `Template error: ${String(tplErr)}` });
            continue;
          }

          // Create Material Submission instead of direct material
          try {
            const msId = randomUUID();
            const submission = await query(
              `INSERT INTO material_submissions (id, template_id, shop_id, rate, unit, brandname, modelnumber, subcategory, category, product, technicalspecification, dimensions, finishtype, metaltype, hsn_code, sac_code, submitted_by, submitted_at, approved)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NULL)
               RETURNING *`,
              [
                msId,
                templateId,
                shop_id,
                rate,
                unit,
                raw.brandname || raw.brandName || null,
                raw.modelnumber || raw.modelNumber || null,
                subcategory,
                category,
                raw.product || null,
                technicalspecification,
                raw.dimensions || null,
                raw.finishtype || raw.finish || null,
                raw.metaltype || raw.metalType || null,
                raw.hsn_code || raw.hsnCode || null,
                raw.sac_code || raw.sacCode || null,
                (req as any).user?.id
              ],
            );
            createdSubmissions.push(submission.rows[0]);
          } catch (msErr) {
            errors.push({ row: i, error: `Submission error: ${String(msErr)}` });
            continue;
          }
        }

        await query("COMMIT");

        res.json({
          message: "Bulk upload submitted for approval",
          createdTemplatesCount: createdTemplates.length,
          createdSubmissionsCount: createdSubmissions.length,
          skipped,
          errors,
        });
      } catch (err) {
        try { await query("ROLLBACK"); } catch (rbErr) { console.error("rollback failed", rbErr); }
        console.error("/api/bulk-materials error", err);
        res.status(500).json({ message: "bulk upload failed", error: String(err) });
      }
    },
  );

  // POST /api/bulk-shops - Bulk upload shop rows (admin / software_team / purchase_team)
  app.post(
    "/api/bulk-shops",
    authMiddleware,
    requireRoleOrPermission(["admin", "software_team", "purchase_team"], "create_item"),
    async (req: Request, res: Response) => {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

      if (rows.length === 0) {
        res.status(400).json({ message: "No rows provided" });
        return;
      }

      const createdShops: any[] = [];
      const skipped: any[] = [];
      const errors: any[] = [];

      try {
        await query("BEGIN");
        // eslint-disable-next-line no-console
        console.log(`[POST /api/bulk-shops] Processing ${rows.length} rows`);

        for (let i = 0; i < rows.length; i++) {
          const raw = rows[i] || {};
          const name = (raw.name || raw.Name || "").toString().trim();
          const location = (raw.location || raw.Location || "").toString().trim() || null;
          const city = (raw.city || raw.City || "").toString().trim() || null;
          const phoneCountryCode = (raw.phoneCountryCode || raw.phone_country_code || "").toString().trim() || "+91";
          const contactNumber = (raw.contactNumber || raw.contact_number || raw.Phone || "").toString().trim() || null;
          const state = (raw.state || raw.State || "").toString().trim() || null;
          const country = (raw.country || raw.Country || "").toString().trim() || "India";
          const pincode = (raw.pincode || raw.Pincode || raw.Zipcode || "").toString().trim() || null;
          const gstNo = (raw.gstNo || raw.gst_no || raw.gstno || raw.GST || "").toString().trim() || null;
          const vendorCategory = (raw.vendorCategory || raw.vendor_category || "").toString().trim() || null;

          if (!name) {
            skipped.push({ row: i, reason: "missing name" });
            continue;
          }

          if (!city) {
            skipped.push({ row: i, reason: "missing city" });
            continue;
          }

          try {
            const id = randomUUID();
            const result = await query(
              `INSERT INTO shops (id, name, location, phonecountrycode, contactnumber, city, state, country, pincode, gstno, vendor_category, owner_id, approved, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now()) RETURNING *`,
              [
                id,
                name,
                location,
                phoneCountryCode,
                contactNumber,
                city,
                state,
                country,
                pincode,
                gstNo,
                vendorCategory,
                (req as any).user.id,
                false, // Bulk uploaded shops go through approval flow
              ],
            );
            createdShops.push(result.rows[0]);
          } catch (insertErr) {
            errors.push({ row: i, error: `Insert error: ${String(insertErr)}` });
            continue;
          }
        }

        await query("COMMIT");

        res.json({
          message: "Bulk shops uploaded successfully",
          createdShopsCount: createdShops.length,
          skipped,
          errors,
        });
      } catch (err) {
        try { await query("ROLLBACK"); } catch (rbErr) { console.error("rollback failed", rbErr); }
        console.error("/api/bulk-shops error", err);
        res.status(500).json({ message: "bulk shop upload failed", error: String(err) });
      }
    },
  );

  // GET /api/material-subcategories/:category - List subcategories created by admin/software_team/purchase_team
  app.get(
    "/api/material-subcategories/:category",
    async (req: Request, res: Response) => {
      try {
        const { category } = req.params;
        // Return all subcategories for a category (including seeded ones)
        const result = await query(
          `
        SELECT id, name FROM material_subcategories 
        WHERE category = $1
        ORDER BY name ASC
      `,
          [category],
        );

        const archivedIds = archiveService.getArchivedItemIds('subcategories');
        const trashedIds = archiveService.getTrashedItemIds('subcategories');
        const subcategories = result.rows
          .filter(r => !archivedIds.includes(r.id) && !trashedIds.includes(r.id))
          .map((row) => row.name)
          .filter(Boolean);
        res.json({ subcategories });
      } catch (err) {
        console.error("/api/material-subcategories error", err);
        res.status(500).json({ message: "failed to list subcategories" });
      }
    },
  );

  // POST /api/categories - Create a new category (Admin/Software Team/Purchase Team/Pre Sales)
  app.post(
    "/api/categories",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "pre_sales", "product_manager"),
    async (req: Request, res: Response) => {
      try {
        const { name } = req.body;

        if (!name || !name.trim()) {
          res.status(400).json({ message: "Category name is required" });
          return;
        }

        const id = randomUUID();
        const userId = (req as any).user?.id;
        const result = await query(
          `INSERT INTO material_categories (id, name, created_by) 
         VALUES ($1, $2, $3) 
         RETURNING *`,
          [id, name.trim(), userId || null],
        );

        res.status(201).json({ category: result.rows[0] });
      } catch (err: any) {
        console.error("/api/categories error", err as any);
        if (err.code === "23505") {
          res.status(409).json({ message: "Category already exists" });
        } else {
          res.status(500).json({
            message: "failed to create category",
            error: err.message,
          });
        }
      }
    },
  );

  // POST /api/subcategories - Create a new subcategory (Admin/Software Team/Purchase Team)
  app.post(
    "/api/subcategories",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "pre_sales", "product_manager"),
    async (req: Request, res: Response) => {
      try {
        const { name, category } = req.body;

        if (!name || !name.trim() || !category || !category.trim()) {
          res.status(400).json({
            message: "Subcategory name and parent category are required",
          });
          return;
        }

        const id = randomUUID();
        const userId = (req as any).user?.id;
        const result = await query(
          `INSERT INTO material_subcategories (id, name, category, created_by) 
         VALUES ($1, $2, $3, $4) 
         RETURNING id::text, name, category, created_at, created_by`,
          [id, name.trim(), category.trim(), userId || null],
        );

        res.status(201).json({ subcategory: result.rows[0] });
      } catch (err: any) {
        console.error("/api/subcategories error", err as any);
        if (err.code === "23505") {
          res.status(409).json({
            message: "Subcategory already exists for this category",
          });
        } else {
          res.status(500).json({
            message: "failed to create subcategory",
            error: err.message,
          });
        }
      }
    },
  );

  // PUT /api/categories/:name - Update a category name
  app.put(
    "/api/categories/:name",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "pre_sales", "product_manager"),
    async (req: Request, res: Response) => {
      try {
        const { name: oldName } = req.params;
        const { name: newName } = req.body;

        if (!newName || !newName.trim()) {
          res.status(400).json({ message: "Category name is required" });
          return;
        }

        // Update the category
        const result = await query(
          `UPDATE material_categories SET name = $1 WHERE name = $2 RETURNING *`,
          [newName.trim(), decodeURIComponent(oldName)],
        );

        if (result.rows.length === 0) {
          res.status(404).json({ message: "Category not found" });
          return;
        }

        // Update all subcategories that reference this category
        await query(
          `UPDATE material_subcategories SET category = $1 WHERE category = $2`,
          [newName.trim(), decodeURIComponent(oldName)],
        );

        res.json({ category: result.rows[0] });
      } catch (err: any) {
        console.error("/api/categories PUT error", err);
        if (err.code === "23505") {
          res.status(409).json({ message: "Category already exists" });
        } else {
          res.status(500).json({ message: "failed to update category", error: err.message });
        }
      }
    },
  );

  // PUT /api/subcategories/:id - Update a subcategory name
  app.put(
    "/api/subcategories/:id",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "pre_sales", "product_manager"),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { name: newName, category } = req.body;

        if (!newName || !newName.trim()) {
          res.status(400).json({ message: "Subcategory name is required" });
          return;
        }

        // Update the subcategory
        const result = await query(
          `UPDATE material_subcategories SET name = $1, category = $2 WHERE id = $3 RETURNING id::text, name, category, created_at, created_by`,
          [newName.trim(), category, id],
        );

        if (result.rows.length === 0) {
          res.status(404).json({ message: "Subcategory not found" });
          return;
        }

        res.json({ subcategory: result.rows[0] });
      } catch (err: any) {
        console.error("/api/subcategories PUT error", err);
        if (err.code === "23505") {
          res.status(409).json({ message: "Subcategory already exists" });
        } else {
          res.status(500).json({ message: "failed to update subcategory", error: err.message });
        }
      }
    },
  );

  // GET /api/categories/:name/impact - Get impact of deleting a category
  app.get(
    "/api/categories/:name/impact",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "pre_sales", "product_manager"),
    async (req: Request, res: Response) => {
      try {
        const name = decodeURIComponent(req.params.name);

        const subcategories = await query("SELECT name FROM material_subcategories WHERE category = $1", [name]);
        const templates = await query("SELECT name FROM material_templates WHERE category = $1", [name]);
        const materials = await query("SELECT name FROM materials WHERE template_id IN (SELECT id FROM material_templates WHERE category = $1)", [name]);

        // Also find products associated with any of these subcategories
        const products = await query("SELECT name FROM products WHERE subcategory IN (SELECT name FROM material_subcategories WHERE category = $1)", [name]);

        res.json({
          subcategories: subcategories.rows.map(r => r.name),
          templates: templates.rows.map(r => r.name),
          materials: materials.rows.map(r => r.name),
          products: products.rows.map(r => r.name)
        });
      } catch (err) {
        console.error("/api/categories/:name/impact error", err);
        res.status(500).json({ message: "failed to get category impact" });
      }
    }
  );

  // GET /api/subcategories/:id/impact - Get impact of deleting a subcategory
  app.get(
    "/api/subcategories/:id/impact",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "pre_sales", "product_manager"),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;

        // Find subcategory name first to query products/materials
        const subResult = await query("SELECT name FROM material_subcategories WHERE id = $1", [id]);
        if (subResult.rows.length === 0) {
          return res.status(404).json({ message: "Subcategory not found" });
        }
        const subName = subResult.rows[0].name;

        const products = await query("SELECT name FROM products WHERE LOWER(TRIM(subcategory)) = LOWER(TRIM($1))", [subName]);
        const materials = await query("SELECT name FROM materials WHERE LOWER(TRIM(subcategory)) = LOWER(TRIM($1))", [subName]);

        res.json({
          products: products.rows.map(r => r.name),
          materials: materials.rows.map(r => r.name)
        });
      } catch (err) {
        console.error("/api/subcategories/:id/impact error", err);
        res.status(500).json({ message: "failed to get subcategory impact" });
      }
    }
  );

  // POST /api/subcategories/:id/reassign - Bulk move products/materials to a different subcategory before deletion
  app.post(
    "/api/subcategories/:id/reassign",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "pre_sales", "product_manager"),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { targetSubcategory } = req.body; // Name of the subcategory to move to

        // Find source subcategory name
        const subResult = await query("SELECT name FROM material_subcategories WHERE id = $1", [id]);
        if (subResult.rows.length === 0) {
          return res.status(404).json({ message: "Subcategory not found" });
        }
        const subName = subResult.rows[0].name;

        if (!targetSubcategory) {
          return res.status(400).json({ message: "targetSubcategory is required" });
        }

        // Reassign products
        const prodResult = await query(
          "UPDATE products SET subcategory = $1 WHERE LOWER(TRIM(subcategory)) = LOWER(TRIM($2))",
          [targetSubcategory, subName]
        );

        // Reassign materials
        const matResult = await query(
          "UPDATE materials SET subcategory = $1 WHERE LOWER(TRIM(subcategory)) = LOWER(TRIM($2))",
          [targetSubcategory, subName]
        );

        // Reassign material templates
        await query(
          "UPDATE material_templates SET subcategory = $1 WHERE LOWER(TRIM(subcategory)) = LOWER(TRIM($2))",
          [targetSubcategory, subName]
        );

        res.json({
          message: `Reassigned from "${subName}" to "${targetSubcategory}"`,
          productsUpdated: prodResult.rowCount,
          materialsUpdated: matResult.rowCount,
        });
      } catch (err) {
        console.error("/api/subcategories/:id/reassign error", err);
        res.status(500).json({ message: "failed to reassign subcategory" });
      }
    }
  );

  // DELETE /api/subcategories/:id - Archive a subcategory
  app.delete(
    "/api/subcategories/:id",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "pre_sales", "product_manager"),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const subResult = await query("SELECT * FROM material_subcategories WHERE id = $1", [id]);
        if (subResult.rows.length === 0) {
          return res.status(404).json({ message: "Subcategory not found" });
        }

        const archived = archiveService.archiveItem('subcategories', id, subResult.rows[0]);
        if (req.query.action === 'trash' && archived) {
          archiveService.trashArchiveItem(archived.id);
        }

        res.json({ message: "Subcategory archived", subcategory: subResult.rows[0] });
      } catch (err: any) {
        console.error("/api/subcategories DELETE error:", {
          message: err.message,
          code: err.code,
          detail: err.detail
        });
        res.status(500).json({
          message: "failed to delete subcategory",
          error: err.message
        });
      }
    },
  );

  // GET /api/categories - List all categories created by admin (including seeded ones)
  app.get("/api/categories", async (_req, res) => {
    try {
      const result = await query(`
        SELECT * FROM material_categories 
        ORDER BY created_at DESC
      `);

      const archivedNames = archiveService.getArchivedItemIds('categories');
      const trashedNames = archiveService.getTrashedItemIds('categories');
      const filtered = result.rows.map((r) => r.name).filter(name => !archivedNames.includes(name) && !trashedNames.includes(name));

      res.json({ categories: filtered });
    } catch (err: unknown) {
      console.error("/api/categories error", err as any);
      res.status(500).json({ message: "failed to list categories" });
    }
  });

  // DELETE /api/categories/:name - Delete a category and its subcategories (Admin/Software Team/Purchase Team/Pre Sales)
  app.delete(
    "/api/categories/:name",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "pre_sales", "product_manager"),
    async (req: Request, res: Response) => {
      try {
        const name = req.params.name;
        console.log("DELETE category request for:", name);
        if (!name)
          return res.status(400).json({ message: "category name required" });

        const getCat = await query("SELECT * FROM material_categories WHERE name = $1", [name]);
        if (getCat.rows.length === 0) {
          return res.status(404).json({ message: "Category not found" });
        }

        const archived = archiveService.archiveItem('categories', name, getCat.rows[0]);
        if (req.query.action === 'trash' && archived) {
          archiveService.trashArchiveItem(archived.id);
        }

        res.json({ message: "Category archived", category: getCat.rows[0] });
      } catch (err) {
        console.error("/api/categories/:name DELETE error", err);
        res.status(500).json({ message: "failed to delete category" });
      }
    },
  );

  // GET /api/subcategories-admin - List all subcategories for admin (from DB)
  app.get("/api/subcategories-admin", async (_req, res) => {
    try {
      const result = await query(`
        SELECT id::text, name, category, created_at, created_by 
        FROM material_subcategories 
        ORDER BY category ASC, name ASC
      `);

      const archivedIds = archiveService.getArchivedItemIds('subcategories');
      const trashedIds = archiveService.getTrashedItemIds('subcategories');
      const filtered = result.rows.filter((r) => !archivedIds.includes(r.id) && !trashedIds.includes(r.id));

      res.json({ subcategories: filtered });
    } catch (err) {
      console.error("/api/subcategories-admin error", err);
      res.status(500).json({ message: "failed to list subcategories" });
    }
  });

  // GET /api/sidebar-subcategories - List all subcategories for sidebar (predefined + database)
  app.get("/api/sidebar-subcategories", async (_req, res) => {
    try {
      // Predefined subcategories with their routes and icons
      const predefinedSubcategories = [
        { id: "1", name: "Civil", href: "/estimators/civil-wall", icon: "BrickWall", category: "Estimators" },
        { id: "2", name: "Doors", href: "/estimators/doors", icon: "DoorOpen", category: "Estimators" },
        { id: "3", name: "False Ceiling", href: "/estimators/false-ceiling", icon: "Cloud", category: "Estimators" },
        { id: "4", name: "Flooring", href: "/estimators/flooring", icon: "Layers", category: "Estimators" },
        { id: "5", name: "Painting", href: "/estimators/painting", icon: "PaintBucket", category: "Estimators" },
        { id: "6", name: "Blinds", href: "/estimators/blinds", icon: "Blinds", category: "Estimators" },
        { id: "7", name: "Electrical", href: "/estimators/electrical", icon: "Zap", category: "Estimators" },
        { id: "8", name: "Plumbing", href: "/estimators/plumbing", icon: "Droplets", category: "Estimators" },
      ];

      // Get database subcategories (with trimming)
      const dbResult = await query(`
        SELECT DISTINCT TRIM(name) as name FROM material_subcategories 
        WHERE TRIM(name) != ''
        ORDER BY name ASC
      `);

      const dbSubcategoryNames = dbResult.rows.map((row) => row.name);

      // Create a set of predefined names (normalized for comparison)
      const predefinedNamesSet = new Set(
        predefinedSubcategories.map((p) => p.name.toLowerCase().trim())
      );

      // Filter out database entries that match predefined ones (case-insensitive and space-trim)
      const uniqueDbNames = dbSubcategoryNames.filter((dbName) => {
        const normalizedDbName = dbName.toLowerCase().trim();
        return !predefinedNamesSet.has(normalizedDbName);
      });

      // Combine: predefined first, then unique database entries
      const allSubcategories = [
        ...predefinedSubcategories,
        ...uniqueDbNames.map((name, idx) => ({
          id: `db_${idx}`,
          name: name,
          href: null,
          icon: "Layers",
          category: "Database",
        })),
      ];

      res.json({ subcategories: allSubcategories });
    } catch (err) {
      console.error("/api/sidebar-subcategories error", err);
      res.status(500).json({ message: "failed to list sidebar subcategories" });
    }
  });

  // ====== PRODUCTS CRUD ======

  // POST /api/products - Create a new product (Admin/Software Team/Purchase Team/Pre Sales/Product Manager/Contractor)
  app.post(
    "/api/products",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "pre_sales", "product_manager", "contractor"),
    async (req: Request, res: Response) => {
      try {
        const { name, subcategory, taxCodeType, taxCodeValue, hsn_code, sac_code, image } = req.body;
        console.log('/api/products POST body ->', { name, subcategory, taxCodeType, taxCodeValue, hsn_code, sac_code, image: image ? "present" : "absent" });

        if (!name) {
          res.status(400).json({ message: "Product name is required" });
          return;
        }

        if (!subcategory) {
          res.status(400).json({ message: "Subcategory is required" });
          return;
        }

        const result = await query(
          `
        INSERT INTO products (name, subcategory, tax_code_type, tax_code_value, hsn_code, sac_code, created_by, image)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
          [name, subcategory || null, taxCodeType || null, taxCodeValue || null, hsn_code || null, sac_code || null, req.user?.username || "unknown", image || null],
        );
        console.log('/api/products POST inserted ->', result.rows[0]);

        res.status(201).json({ product: result.rows[0] });
      } catch (err: any) {
        console.error("/api/products POST error", err);
        if (err.code === "23505") {
          // unique violation
          res.status(409).json({ message: "Product name already exists" });
        } else {
          res.status(500).json({ message: "Failed to create product" });
        }
      }
    },
  );

  // GET /api/products - List all products
  app.get("/api/products", async (req, res) => {
    try {
      const { approvedOnly } = req.query;
      let queryStr = `
        SELECT DISTINCT ON (p.id)
          p.*,
          s.name as subcategory_name,
          c.name as category_name,
          EXISTS (
            SELECT 1 FROM step11_products WHERE product_id = p.id
            UNION ALL
            SELECT 1 FROM product_approvals WHERE product_id = p.id AND status = 'approved'
          ) AS is_approved,
          EXISTS (
            SELECT 1 FROM (
              SELECT si.material_id::text, COALESCE(si.supply_rate, si.rate) AS config_rate, NULL::text as status
              FROM step11_products sp
              JOIN step11_product_items si ON si.step11_product_id = sp.id
              WHERE sp.product_id = p.id
              UNION ALL
              SELECT ci.material_id::text, COALESCE(ci.supply_rate, ci.rate) AS config_rate, NULL::text as status
              FROM product_step3_config pc
              JOIN product_step3_config_items ci ON ci.step3_config_id = pc.id
              WHERE pc.product_id = p.id::varchar
              UNION ALL
              SELECT * FROM (
                SELECT DISTINCT ON (pa.config_name) ai.material_id::text, COALESCE(ai.supply_rate, ai.rate) AS config_rate, pa.status::text
                FROM product_approvals pa
                JOIN product_approval_items ai ON ai.approval_id = pa.id
                WHERE pa.product_id::text = p.id::text
                ORDER BY pa.config_name, pa.created_at DESC
              ) sub_pa
            ) cfg
            JOIN materials m ON m.id::text = cfg.material_id::text
            WHERE (cfg.status IS NULL OR cfg.status = 'pending') AND ABS(cfg.config_rate - m.rate) > 0.01 AND m.approved IS TRUE
          ) AS has_price_updates
        FROM products p
        LEFT JOIN material_subcategories s ON LOWER(TRIM(p.subcategory)) = LOWER(TRIM(s.name))
        LEFT JOIN material_categories c ON LOWER(TRIM(s.category)) = LOWER(TRIM(c.name))
      `;

      if (approvedOnly === 'true') {
        queryStr += ` WHERE p.id IN (SELECT DISTINCT product_id FROM product_approvals WHERE status = 'approved')`;
      }

      queryStr += ` ORDER BY p.id, p.created_at DESC`;
      const result = await query(queryStr);
      const archivedIds = archiveService.getArchivedItemIds('products');
      const trashedIds = archiveService.getTrashedItemIds('products');
      const filtered = result.rows.filter((r: any) => !archivedIds.includes(r.id) && !trashedIds.includes(r.id));

      res.json({ products: filtered });
    } catch (err) {
      console.error("/api/products GET error", err);
      res.status(500).json({ message: "Failed to list products" });
    }
  });

  // PUT /api/products/:id - Update a product
  app.put(
    "/api/products/:id",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "pre_sales", "product_manager", "contractor"),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { name, subcategory, taxCodeType, taxCodeValue, hsn_code, sac_code, hsnCode, sacCode, image } = req.body;

        // Support both hsn_code (db style) and hsnCode (frontend style)
        // Prioritize camelCase (hsnCode/sacCode) if both are present to reflect latest frontend intent
        const finalHsnCode = hsnCode !== undefined ? hsnCode : hsn_code;
        const finalSacCode = sacCode !== undefined ? sacCode : sac_code;

        console.log(`/api/products/${id} PUT body ->`, { name, subcategory, hsn_code: finalHsnCode, sac_code: finalSacCode, image: image ? "present" : "absent" });

        if (!name) {
          res.status(400).json({ message: "Product name is required" });
          return;
        }

        if (!subcategory) {
          res.status(400).json({ message: "Subcategory is required" });
          return;
        }

        const result = await query(
          `
        UPDATE products 
        SET name = $1, subcategory = $2, tax_code_type = $3, tax_code_value = $4, hsn_code = $5, sac_code = $6, image = $8
        WHERE id = $7
        RETURNING *
      `,
          [name, subcategory, taxCodeType || null, taxCodeValue || null, finalHsnCode || null, finalSacCode || null, id, image || null],
        );
        console.log(`/api/products/${id} PUT updated ->`, result.rows[0]);

        if (result.rowCount === 0) {
          res.status(404).json({ message: "Product not found" });
          return;
        }

        res.json({ product: result.rows[0] });
      } catch (err: any) {
        console.error("/api/products PUT error", err);
        if (err.code === "23505") {
          res.status(409).json({ message: "Product name already exists" });
        } else {
          res.status(500).json({ message: "Failed to update product" });
        }
      }
    },
  );

  // DELETE /api/products/:id - Delete a product
  app.delete(
    "/api/products/:id",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "pre_sales", "product_manager", "contractor"),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;

        const result = await query(
          "SELECT * FROM products WHERE id = $1",
          [id],
        );

        if (result.rowCount === 0) {
          res.status(404).json({ message: "Product not found" });
          return;
        }

        const archived = archiveService.archiveItem('products', id, result.rows[0]);
        if (req.query.action === 'trash' && archived) {
          archiveService.trashArchiveItem(archived.id);
        }

        res.json({ message: "Product archived", product: result.rows[0] });
      } catch (err) {
        console.error("/api/products DELETE error", err);
        res.status(500).json({ message: "Failed to delete product" });
      }
    },
  );

  // GET /api/products/:id - Get a single product by ID
  app.get("/api/products/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = await query(
        `
        SELECT
          p.*,
          s.name as subcategory_name,
          c.name as category_name
        FROM products p
        LEFT JOIN material_subcategories s ON p.subcategory = s.name
        LEFT JOIN material_categories c ON s.category = c.name
        WHERE p.id = $1
      `,
        [id],
      );

      if (result.rows.length === 0) {
        res.status(404).json({ message: "Product not found" });
        return;
      }

      res.json({ product: result.rows[0] });
    } catch (err) {
      console.error("/api/products/:id GET error", err);
      res.status(500).json({ message: "Failed to get product" });
    }
  });

  // ====== MATERIAL SUBMISSIONS ======

  // POST /api/material-submissions - Submit a material for approval
  app.post(
    "/api/material-submissions",
    authMiddleware,
    requireRole("supplier", "purchase_team", "admin"),
    async (req: Request, res: Response) => {
      try {
        let {
          template_id,
          shop_id,
          rate,
          unit,
          brandname,
          modelnumber,
          subcategory,
          category,
          product,
          technicalspecification,
          dimensions,
          finishtype,
          metaltype,
        } = req.body;

        // Ensure template_id provided
        if (!template_id) {
          res.status(400).json({ message: "template_id is required" });
          return;
        }

        // If shop_id not provided and the requester is a supplier, auto-select their primary shop
        if (!shop_id && (req as any).user?.role === "supplier") {
          try {
            const ownerId = (req as any).user?.id;
            const shopsResult = await query(
              "SELECT id FROM shops WHERE owner_id = $1 ORDER BY created_at DESC",
              [ownerId],
            );
            if (shopsResult.rows.length === 0) {
              res.status(400).json({ message: "No shop found for supplier. Please create a shop first." });
              return;
            }
            shop_id = shopsResult.rows[0].id;
          } catch (err) {
            console.error("/api/material-submissions - failed to lookup supplier shop", err);
            res.status(500).json({ message: "failed to determine supplier shop" });
            return;
          }
        }

        if (!shop_id) {
          res.status(400).json({ message: "shop_id is required" });
          return;
        }

        // Inherit HSN/SAC from template if not provided
        let hsn_code = (req.body as any).hsn_code || (req.body as any).hsnCode || null;
        let sac_code = (req.body as any).sac_code || (req.body as any).sacCode || null;

        if (template_id && (!hsn_code || !sac_code)) {
          try {
            const templateRes = await query("SELECT hsn_code, sac_code FROM material_templates WHERE id = $1", [template_id]);
            if (templateRes.rows.length > 0) {
              const t = templateRes.rows[0];
              if (!hsn_code) hsn_code = t.hsn_code;
              if (!sac_code) sac_code = t.sac_code;
            }
          } catch (e) { console.warn("[POST /api/material-submissions] Could not fetch template for fallback codes", e); }
        }

        // Ensure metaltype/materialtype handled consistently
        let final_metaltype = metaltype || (req.body as any).materialtype || (req.body as any).materialType || (req.body as any).metalType || null;

        // Check for duplicate submission within last 10 seconds with exact field matching
        const duplicateCheck = await query(
          `SELECT id FROM material_submissions 
           WHERE template_id = $1 AND shop_id = $2 AND rate = $3 
           AND COALESCE(brandname, '') = COALESCE($4, '')
           AND COALESCE(modelnumber, '') = COALESCE($5, '')
           AND COALESCE(dimensions, '') = COALESCE($6, '')
           AND COALESCE(unit, '') = COALESCE($7, '')
           AND submitted_at > NOW() - INTERVAL '10 seconds'
           LIMIT 1`,
          [template_id, shop_id, rate, brandname || '', modelnumber || '', dimensions || '', unit || '']
        );

        if (duplicateCheck.rows.length > 0) {
          console.log("[POST /api/material-submissions] Blocking exact duplicate submission detected within 10s window");
          res.status(409).json({ message: "Duplicate submission detected. Please wait a moment." });
          return;
        }

        const id = randomUUID();
        const result = await query(
          `INSERT INTO material_submissions (id, template_id, shop_id, rate, unit, brandname, modelnumber, subcategory, category, product, technicalspecification, dimensions, finishtype, metaltype, image, hsn_code, sac_code, submitted_by, submitted_at, approved)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NULL)
           RETURNING *`,
          [
            id,
            template_id,
            shop_id,
            rate,
            unit,
            brandname || null,
            modelnumber || null,
            subcategory || (req.body as any).subCategory || null,
            category || null,
            product || null,
            technicalspecification || (req.body as any).technicalSpecification || null,
            dimensions || (req.body as any).Dimensions || null,
            finishtype || (req.body as any).finishType || null,
            final_metaltype,
            (req.body as any)?.image || null,
            hsn_code,
            sac_code,
            (req as any).user?.id,
          ],
        );

        res.status(201).json({ submission: result.rows[0] });
      } catch (err: any) {
        console.error("/api/material-submissions POST error", err);
        res.status(500).json({ message: "failed to submit material" });
      }
    },
  );

  // GET /api/supplier/my-shops - Get shops owned by the current supplier
  app.get(
    "/api/supplier/my-shops",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user?.id;
        if (!userId) {
          return res
            .status(401)
            .json({ message: "Unauthorized: user not authenticated" });
        }

        // Get shops owned by this user
        const result = await query(
          "SELECT * FROM shops WHERE owner_id = $1 ORDER BY created_at DESC",
          [userId],
        );

        res.json({ shops: result.rows });
      } catch (err: any) {
        console.error("/api/supplier/my-shops error", err);
        res.status(500).json({ message: "failed to get shops" });
      }
    },
  );

  // GET /api/supplier/my-submissions - Get submissions for the current supplier/purchase_team/admin user
  app.get(
    "/api/supplier/my-submissions",
    authMiddleware,
    requireRole("supplier", "purchase_team", "admin"),
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user?.id;
        console.log(
          "[supplier/my-submissions] fetching shops for user:",
          userId,
        );

        // Get shops owned by this user
        const shopsResult = await query(
          "SELECT id as shop_id FROM shops WHERE owner_id = $1",
          [userId],
        );
        const shopIds = shopsResult.rows.map((row: any) => row.shop_id);

        if (shopIds.length === 0) {
          return res.json({ submissions: [] });
        }

        // Get submissions for these shops
        const result = await query(
          `SELECT ms.*, mt.name as template_name, mt.code as template_code, mt.category, s.name as shop_name
           FROM material_submissions ms
           JOIN material_templates mt ON ms.template_id = mt.id
           JOIN shops s ON ms.shop_id = s.id
           WHERE ms.shop_id = ANY($1)
           ORDER BY ms.submitted_at DESC`,
          [shopIds],
        );

        const submissions = result.rows.map((row: any) => ({
          id: row.id,
          status:
            row.approved === true
              ? "approved"
              : row.approved === false
                ? "rejected"
                : "pending",
          submission: row,
        }));

        res.json({ submissions });
      } catch (err: any) {
        console.error("/api/supplier/my-submissions error", err);
        res.status(500).json({ message: "failed to get submissions" });
      }
    },
  );

  // GET /api/material-submissions-pending-approval - List pending material submissions (Admin/Software/Purchase)
  app.get(
    "/api/material-submissions-pending-approval",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team"),
    async (_req, res) => {
      try {
        const result = await query(`
          SELECT ms.*, mt.name as template_name, mt.code as template_code, mt.category as template_category, s.name as shop_name, u.username as submitted_by_username
          FROM material_submissions ms
          JOIN material_templates mt ON ms.template_id = mt.id
          JOIN shops s ON ms.shop_id = s.id
          LEFT JOIN users u ON ms.submitted_by = u.id
          WHERE ms.approved IS NULL
          ORDER BY ms.submitted_at DESC
        `);

        const submissions = result.rows.map((row: any) => ({
          id: row.id,
          status: "pending",
          submission: row,
        }));

        res.json({ submissions });
      } catch (err) {
        console.error("/api/material-submissions-pending-approval error", err);
        res
          .status(500)
          .json({ message: "failed to list pending material submissions" });
      }
    },
  );

  // POST /api/material-submissions/:id/approve - Approve a material submission
  app.post(
    "/api/material-submissions/:id/approve",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team"),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const submissionResult = await query(
          "SELECT * FROM material_submissions WHERE id = $1",
          [id],
        );

        if (submissionResult.rows.length === 0) {
          res.status(404).json({ message: "Submission not found" });
          return;
        }

        const submission = submissionResult.rows[0];

        if (submission.approved === true) {
          console.log(`[POST /api/material-submissions/:id/approve] Submission ${id} already approved, skipping creation.`);
          res.status(400).json({ message: "This submission has already been approved." });
          return;
        }
        const templateResult = await query(
          "SELECT * FROM material_templates WHERE id = $1",
          [submission.template_id],
        );
        const template = templateResult.rows[0];

        const materialId = randomUUID();
        await query(
          `INSERT INTO materials (id, name, code, rate, shop_id, unit, category, brandname, modelnumber, subcategory, product, technicalspecification, template_id, image, hsn_code, sac_code, approved)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, true)`,
          [
            materialId,
            template.name,
            template.code,
            submission.rate,
            submission.shop_id,
            submission.unit,
            submission.category || template.category,
            submission.brandname,
            submission.modelnumber,
            submission.subcategory || template.subcategory,
            submission.product,
            submission.technicalspecification,
            submission.template_id,
            submission.image || template.image || null,
            submission.hsn_code || submission.hsnCode || template.hsn_code || null,
            submission.sac_code || submission.sacCode || template.sac_code || null,
          ],
        );

        const updateResult = await query(
          "UPDATE material_submissions SET approved = true WHERE id = $1 RETURNING *",
          [id],
        );

        res.json({
          submission: updateResult.rows[0],
          material: { id: materialId },
        });
      } catch (err: any) {
        console.error("/api/material-submissions/:id/approve error", err);
        res
          .status(500)
          .json({ message: "failed to approve material submission" });
      }
    },
  );

  // GET /api/admin/duplicates/materials - Find duplicate materials
  app.get(
    "/api/admin/duplicates/materials",
    authMiddleware,
    requireRole("admin", "software_team"),
    async (_req, res) => {
      try {
        const result = await query(
          `SELECT 
            name, shop_id, rate, unit, category, subcategory, product, 
            brandname, modelnumber, dimensions, finishtype, technicalspecification,
            COUNT(*) as duplicate_count,
            ARRAY_AGG(id ORDER BY created_at ASC) as ids,
            ARRAY_AGG(created_at ORDER BY created_at ASC) as creation_dates
          FROM materials
          GROUP BY 
            name, shop_id, rate, unit, category, subcategory, product, 
            brandname, modelnumber, dimensions, finishtype, technicalspecification
          HAVING COUNT(*) > 1
          ORDER BY duplicate_count DESC`
        );
        res.json({ duplicates: result.rows });
      } catch (err) {
        console.error("GET /api/admin/duplicates/materials error", err);
        res.status(500).json({ message: "failed to fetch duplicates" });
      }
    }
  );

  // POST /api/admin/duplicates/materials/cleanup - Delete duplicates (keep oldest)
  app.post(
    "/api/admin/duplicates/materials/cleanup",
    authMiddleware,
    requireRole("admin", "software_team"),
    async (req, res) => {
      try {
        const { groups } = req.body; // Array of { ids: string[] }
        if (!groups || !Array.isArray(groups)) {
          return res.status(400).json({ message: "groups array is required" });
        }

        let totalDeleted = 0;
        for (const group of groups) {
          if (group.ids && group.ids.length > 1) {
            // Keep the first ID (oldest), delete the rest
            const toDelete = group.ids.slice(1);
            const deleteResult = await query(
              "DELETE FROM materials WHERE id = ANY($1)",
              [toDelete]
            );
            totalDeleted += deleteResult.rowCount || 0;
          }
        }

        res.json({ message: `Successfully cleaned up ${totalDeleted} duplicate items.` });
      } catch (err) {
        console.error("POST /api/admin/duplicates/materials/cleanup error", err);
        res.status(500).json({ message: "failed to cleanup duplicates" });
      }
    }
  );

  // POST /api/material-submissions/:id/reject - Reject a material submission
  app.post(
    "/api/material-submissions/:id/reject",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team"),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const reason = req.body?.reason || null;

        const result = await query(
          "UPDATE material_submissions SET approved = false, approval_reason = $2 WHERE id = $1 RETURNING *",
          [id, reason],
        );

        res.json({ submission: result.rows[0] });
      } catch (err: any) {
        console.error("/api/material-submissions/:id/reject error", err);
        res
          .status(500)
          .json({ message: "failed to reject material submission" });
      }
    },
  );

  // GET /api/accumulated-products/:estimator_type - Get accumulated products for user and estimator
  app.get(
    "/api/accumulated-products/:estimator_type",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { estimator_type } = req.params;
        const userId = (req as any).user?.id;
        if (!userId) return res.status(401).json({ message: "Unauthorized" });

        const result = await query(
          "SELECT data FROM accumulated_products WHERE user_id = $1 AND estimator_type = $2 ORDER BY created_at DESC LIMIT 1",
          [userId, estimator_type],
        );

        if (result.rows.length === 0) {
          res.json({ data: [] });
          return;
        }

        res.json({ data: result.rows[0].data });
      } catch (err) {
        console.error("GET /api/accumulated-products error", err);
        res.status(500).json({ message: "Failed to get accumulated products" });
      }
    },
  );

  // POST /api/accumulated-products/:estimator_type - Save accumulated products
  app.post(
    "/api/accumulated-products/:estimator_type",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { estimator_type } = req.params;
        const userId = (req as any).user?.id;
        if (!userId) return res.status(401).json({ message: "Unauthorized" });
        const data = req.body.data;

        // Upsert: delete existing and insert new
        await query(
          "DELETE FROM accumulated_products WHERE user_id = $1 AND estimator_type = $2",
          [userId, estimator_type],
        );
        await query(
          "INSERT INTO accumulated_products (user_id, estimator_type, data) VALUES ($1, $2, $3)",
          [userId, estimator_type, JSON.stringify(data)],
        );

        res.json({ message: "Accumulated products saved" });
      } catch (err) {
        console.error("POST /api/accumulated-products error", err);
        res
          .status(500)
          .json({ message: "Failed to save accumulated products" });
      }
    },
  );

  // ====== SYSTEM SETTINGS ROUTES ======
  app.get("/api/system-settings/:key", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { key } = req.params;
      const result = await query("SELECT value FROM system_settings WHERE key = $1", [key]);
      if (result.rows.length === 0) {
        // Default values if not found
        if (key === "bom_buttons_enabled") {
          return res.json({ value: "true" });
        }
        return res.status(404).json({ message: "Setting not found" });
      }
      res.json(result.rows[0]);
    } catch (err) {
      console.error("Failed to fetch system setting:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/system-settings", authMiddleware, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const { key, value } = req.body;
      if (!key || value === undefined) {
        return res.status(400).json({ message: "Key and value are required" });
      }

      const result = await query(
        "INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now() RETURNING *",
        [key, String(value)]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error("Failed to update system setting:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ====== BOQ PROJECTS ROUTES ======

  // POST /api/boq-projects - Create a new BOQ project
  app.post(
    "/api/boq-projects",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { name, client, budget, location, client_address, gst_no, project_value, project_status } = req.body;
        console.log('/api/boq-projects POST body ->', { name, client, budget, location, client_address, gst_no, project_value, project_status });


        if (!name) {
          res.status(400).json({ message: "Project name is required" });
          return;
        }

        const projectId = `proj-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        await query(
          `INSERT INTO boq_projects (id, name, client, budget, location, client_address, gst_no, project_value, project_status, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
          [projectId, name.trim(), client || "", budget || "", location || null, client_address || null, gst_no || null, project_value || null, project_status || 'started', "draft"],
        );


        res.json({
          id: projectId,
          name: name.trim(),
          client: client || "",
          budget: budget || "",
          location: location || "",
          client_address: client_address || "",
          gst_no: gst_no || "",
          project_value: project_value || "",
          status: "draft",
        });
      } catch (err) {
        console.error("POST /api/boq-projects error", err);
        res.status(500).json({ message: "Failed to create project" });
      }
    },
  );

  // GET /api/boq-projects - List all BOQ projects
  app.get(
    "/api/boq-projects",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const { all } = req.query;
        let queryStr = `
          SELECT p.*, 
            v_bom.version_number as bom_version_number, v_bom.project_value as bom_version_price,
            v_boq.version_number as boq_version_number, v_boq.project_value as boq_version_price
          FROM boq_projects p
          LEFT JOIN (
            SELECT DISTINCT ON (project_id) project_id, version_number, project_value
            FROM boq_versions
            WHERE type = 'bom'
            ORDER BY project_id, 
              is_last_final DESC NULLS LAST, 
              (CASE WHEN status = 'approved' THEN 2 ELSE 1 END) DESC,
              version_number DESC
          ) v_bom ON p.id = v_bom.project_id
          LEFT JOIN (
            SELECT DISTINCT ON (project_id) project_id, version_number, project_value
            FROM boq_versions
            WHERE type = 'boq'
            ORDER BY project_id, 
              is_last_final DESC NULLS LAST, 
              (CASE WHEN status = 'approved' THEN 2 ELSE 1 END) DESC,
              version_number DESC
          ) v_boq ON p.id = v_boq.project_id
        `;
        const params: any[] = [];

        // Roles that bypass project-level access restrictions (see all projects)
        // Only vendors/suppliers are restricted to their assigned projects
        const privilegedRoles = ['admin', 'software_team', 'purchase_team', 'pre_sales', 'product_manager', 'finance_team'];

        // Only allow privileged roles to bypass project restrictions; vendors/suppliers are filtered
        if (privilegedRoles.includes(user?.role)) {
          // Privileged roles see all projects
        } else {
          queryStr += ` WHERE id IN (SELECT project_id FROM user_project_permissions WHERE user_id = $1)`;
          params.push(user.id);
        }

        queryStr += ` ORDER BY created_at DESC`;
        const result = await query(queryStr, params);

        const archivedIds = archiveService.getArchivedItemIds('boq_projects');
        const trashedIds = archiveService.getTrashedItemIds('boq_projects');
        const filtered = (result.rows || []).filter(
          (r: any) => !archivedIds.includes(r.id) && !trashedIds.includes(r.id)
        );

        res.json({ projects: filtered || [] });
      } catch (err) {
        console.error("GET /api/boq-projects error", err);
        res.status(500).json({ message: "Failed to fetch projects" });
      }
    },
  );

  // GET /api/boq-projects/metadata - Lightweight project list (id and name only)
  app.get(
    "/api/boq-projects/metadata",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        let queryStr = `SELECT id, name FROM boq_projects`;
        const params: any[] = [];
        const privilegedRoles = ['admin', 'software_team', 'purchase_team', 'pre_sales', 'product_manager', 'finance_team'];

        if (!privilegedRoles.includes(user?.role)) {
          queryStr += ` WHERE id IN (SELECT project_id FROM user_project_permissions WHERE user_id = $1)`;
          params.push(user.id);
        }

        queryStr += ` ORDER BY name ASC`;
        const result = await query(queryStr, params);

        const archivedIds = archiveService.getArchivedItemIds('boq_projects');
        const trashedIds = archiveService.getTrashedItemIds('boq_projects');
        const filtered = (result.rows || []).filter(
          (r: any) => !archivedIds.includes(r.id) && !trashedIds.includes(r.id)
        );

        res.json({ projects: filtered || [] });
      } catch (err) {
        console.error("GET /api/boq-projects/metadata error", err);
        res.status(500).json({ message: "Failed to fetch project metadata" });
      }
    }
  );

  // GET /api/boq-projects/:projectId - Get a specific project
  app.get(
    "/api/boq-projects/:projectId",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { projectId } = req.params;

        const result = await query(
          `SELECT id, name, client, budget, location, client_address, gst_no, project_value, status, created_at, updated_at FROM boq_projects WHERE id = $1`,
          [projectId],
        );

        if (result.rows.length === 0) {
          res.status(404).json({ message: "Project not found" });
          return;
        }

        res.json(result.rows[0]);
      } catch (err) {
        console.error("GET /api/boq-projects/:projectId error", err);
        res.status(500).json({ message: "Failed to fetch project" });
      }
    },
  );

  // PUT /api/boq-projects/:projectId - Update project
  app.put(
    "/api/boq-projects/:projectId",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { projectId } = req.params;
        const { status, name, client, budget, location, client_address, gst_no, project_value } = req.body;

        const fields: string[] = [];
        const vals: any[] = [];
        let idx = 1;

        if (name !== undefined) {
          if (!name.trim()) {
            res.status(400).json({ message: "Project name cannot be empty" });
            return;
          }
          fields.push(`name = $${idx++}`);
          vals.push(name.trim());
        }

        if (status !== undefined) {
          if (!["draft", "submitted", "finalized"].includes(status)) {
            res.status(400).json({ message: "Invalid status" });
            return;
          }
          fields.push(`status = $${idx++}`);
          vals.push(status);
        }

        if (client !== undefined) {
          fields.push(`client = $${idx++}`);
          vals.push(client);
        }

        if (budget !== undefined) {
          fields.push(`budget = $${idx++}`);
          vals.push(budget);
        }

        if (location !== undefined) {
          fields.push(`location = $${idx++}`);
          vals.push(location);
        }

        if (client_address !== undefined) {
          fields.push(`client_address = $${idx++}`);
          vals.push(client_address);
        }

        if (gst_no !== undefined) {
          fields.push(`gst_no = $${idx++}`);
          vals.push(gst_no);
        }

        if (project_value !== undefined) {
          fields.push(`project_value = $${idx++}`);
          vals.push(project_value);
        }

        const { project_status } = req.body;
        if (project_status !== undefined) {
          const validStatuses = ['started', 'in_progress', 'hold', 'cancelled', 'closed', 'bom_stage', 'boq_stage', 'client_approval', 'work_in_execution', 'finance'];
          if (!validStatuses.includes(project_status)) {
            res.status(400).json({ message: 'Invalid project_status' });
            return;
          }
          fields.push(`project_status = $${idx++}`);
          vals.push(project_status);
        }

        if (fields.length > 0) {
          fields.push(`updated_at = NOW()`);
          vals.push(projectId);
          const q = `UPDATE boq_projects SET ${fields.join(", ")} WHERE id = $${idx}`;
          await query(q, vals);
        }

        res.json({ message: "Project updated" });
      } catch (err) {
        console.error("PUT /api/boq-projects/:projectId error", err);
        res.status(500).json({ message: "Failed to update project" });
      }
    },
  );

  // DELETE /api/boq-projects/:projectId - Delete a project
  app.delete(
    "/api/boq-projects/:projectId",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { projectId } = req.params;

        // First, delete all items related to this project
        await query(`DELETE FROM boq_items WHERE project_id = $1`, [projectId]);

        // Then delete all versions related to this project
        await query(`DELETE FROM boq_versions WHERE project_id = $1`, [projectId]);

        // Finally delete the project itself
        const result = await query(
          `DELETE FROM boq_projects WHERE id = $1`,
          [projectId],
        );

        if (result.rowCount === 0) {
          res.status(404).json({ message: "Project not found" });
          return;
        }

        res.json({ message: "Project deleted successfully" });
      } catch (err) {
        console.error("DELETE /api/boq-projects/:projectId error", err);
        res.status(500).json({ message: "Failed to delete project" });
      }
    },
  );

  // GET /api/boq-projects/:projectId/items - Get all items, products and materials for site report
  app.get(
    "/api/boq-projects/:projectId/items",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { projectId } = req.params;
        const allItems: any[] = [];
        const isGlobal = !projectId || projectId === 'global' || projectId === 'none' || projectId === 'undefined';

        console.log(`[DEBUG] Fetching items for project: ${projectId} (isGlobal: ${isGlobal})`);

        // 1. Get Project BOQ Items (Only if not global)
        if (!isGlobal) {
          const latestVersionResult = await query(
            `SELECT id FROM boq_versions 
             WHERE project_id = $1 
             ORDER BY version_number DESC LIMIT 1`,
            [projectId]
          );

          if (latestVersionResult.rows.length > 0) {
            const versionId = latestVersionResult.rows[0].id;
            const itemsResult = await query(
              `SELECT id, table_data FROM boq_items WHERE version_id = $1`,
              [versionId]
            );

            itemsResult.rows.forEach(row => {
              let tableData = row.table_data;
              if (typeof tableData === 'string') {
                try { tableData = JSON.parse(tableData); } catch (e) { return; }
              }

              if (tableData && tableData.step11_items && Array.isArray(tableData.step11_items)) {
                tableData.step11_items.forEach((item: any, index: number) => {
                  allItems.push({
                    id: `boq-${row.id}-${index}`,
                    itemName: item.itemName || item.item || item.name || "Unnamed Item",
                    category: "BOQ Item",
                    type: "item"
                  });
                });
              }
            });
          }
        }

        // 2. Get All Step11 Products
        const productsResult = await query("SELECT id, product_name, category_id FROM step11_products");
        productsResult.rows.forEach(p => {
          allItems.push({
            id: `prod-${p.id}`,
            itemName: p.product_name,
            category: p.category_id || "Product",
            type: "product"
          });
        });

        // 3. Get All Materials (from estimator_step9_cart or similar master list if exists)
        // For now, let's pull names from estimator_step9_cart uniquely to act as a material list
        const materialsResult = await query("SELECT DISTINCT item FROM estimator_step9_cart WHERE item IS NOT NULL AND item != ''");
        materialsResult.rows.forEach((m, idx) => {
          allItems.push({
            id: `mat-${idx}`,
            itemName: m.item,
            category: "Material",
            type: "material"
          });
        });

        res.json({ items: allItems });
      } catch (err) {
        console.error("GET /api/boq-projects/:projectId/items error", err);
        res.status(500).json({ message: "Failed to fetch items" });
      }
    }
  );

  // ====== BOQ VERSIONS ROUTES ======

  // GET /api/boq-versions/:projectId - List all versions of a project
  app.get(
    "/api/boq-versions/:projectId",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { projectId } = req.params;

        // Ensure is_disabled column exists
        await query("ALTER TABLE boq_versions ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN DEFAULT FALSE");

        const { type } = req.query;
        let q = `SELECT id, project_id, project_name, project_client, project_location, version_number, status, type, is_locked, is_last_final, is_disabled, created_at, updated_at, category_order 
                 FROM boq_versions 
                 WHERE project_id = $1`;
        const params = [projectId];

        if (type) {
          q += ` AND type = $2`;
          params.push(type as string);
        }

        q += ` ORDER BY version_number DESC`;

        const result = await query(q, params);

        const archivedIds = archiveService.getArchivedItemIds('boq_versions');
        const trashedIds = archiveService.getTrashedItemIds('boq_versions');
        const filtered = (result.rows || []).filter(
          (r: any) => !archivedIds.includes(r.id) && !trashedIds.includes(r.id)
        );

        res.json({ versions: filtered });
      } catch (err) {
        console.error("GET /api/boq-versions error", err);
        res.status(500).json({ message: "Failed to fetch versions" });
      }
    },
  );

  // POST /api/boq-versions - Create a new version
  app.post(
    "/api/boq-versions",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { project_id, copy_from_version, type = 'bom' } = req.body;

        if (!project_id) {
          res.status(400).json({ message: "project_id is required" });
          return;
        }

        // Get next version number for this type
        const versionResult = await query(
          `SELECT MAX(version_number) as max_version FROM boq_versions WHERE project_id = $1 AND type = $2`,
          [project_id, type],
        );

        const nextVersion = (versionResult.rows[0]?.max_version || 0) + 1;
        const versionId = `ver-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Fetch project name/client/location so we can store them on the version
        let projectName: string | null = null;
        let projectClient: string | null = null;
        let projectLocation: string | null = null;
        let projectClientAddress: string | null = null;
        let projectGstNo: string | null = null;
        let projectVal: string | null = null;
        try {
          const proj = await query(`SELECT name, client, location, client_address, gst_no, project_value FROM boq_projects WHERE id = $1`, [project_id]);
          projectName = proj.rows[0]?.name ?? null;
          projectClient = proj.rows[0]?.client ?? null;
          projectLocation = proj.rows[0]?.location ?? null;
          projectClientAddress = proj.rows[0]?.client_address ?? null;
          projectGstNo = proj.rows[0]?.gst_no ?? null;
          projectVal = proj.rows[0]?.project_value ?? null;
        } catch (err) {
          // non-fatal: proceed with nulls if lookup fails
          console.warn("[db] Could not fetch project name/client/location etc:", (err as any)?.message || err);
        }


        // Create new version (store project name, client, location for easier querying/version display)
        // Also copy column_config from previous version if expanding from one
        let initialColumnConfig = null;
        if (copy_from_version) {
          const prevVer = await query("SELECT column_config FROM boq_versions WHERE id = $1", [copy_from_version]);
          if (prevVer.rows.length > 0) {
            initialColumnConfig = prevVer.rows[0].column_config;
          }
        }

        await query(
          `INSERT INTO boq_versions (id, project_id, project_name, project_client, project_location, project_client_address, project_gst_no, project_value, version_number, status, type, column_config, is_locked, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, FALSE, NOW(), NOW())`,
          [versionId, project_id, projectName, projectClient, projectLocation, projectClientAddress, projectGstNo, projectVal, nextVersion, "draft", type, initialColumnConfig],
        );


        // Copy items from previous version if requested
        if (copy_from_version) {
          // Fetch items for this version specifically, and only active (user_added) ones
          // Also ensuring items actually belong to this project for data integrity
          const itemsResult = await query(
            `SELECT * FROM boq_items 
             WHERE version_id = $1 
             AND project_id = $2 
             AND user_added = true
             ORDER BY sort_order ASC, created_at ASC`,
            [copy_from_version, project_id],
          );

          const archivedIds = archiveService.getArchivedItemIds('boq_items');
          const trashedIds = archiveService.getTrashedItemIds('boq_items');

          for (const item of itemsResult.rows) {
            // Skip archived or trashed items
            if (archivedIds.includes(item.id) || trashedIds.includes(item.id)) continue;

            const newItemId = `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            await query(
              `INSERT INTO boq_items (id, project_id, estimator, table_data, version_id, sort_order, user_added, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
              [
                newItemId,
                project_id,
                item.estimator,
                item.table_data,
                versionId,
                item.sort_order,
                item.user_added ?? true,
              ],
            );
          }
        }

        // Recalculate project value for the project (it now has a new latest version)
        await recalculateProjectValue(project_id, versionId);

        res.json({
          id: versionId,
          project_id,
          version_number: nextVersion,
          status: "draft",
          type,
        });
      } catch (err) {
        console.error("POST /api/boq-versions error", err);
        res.status(500).json({ message: "Failed to create version" });
      }
    },
  );

  // POST /api/boq-versions/:id/make-final - Manually mark a version as the final one
  app.post("/api/boq-versions/:id/make-final", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const vResp = await query("SELECT project_id, type FROM boq_versions WHERE id = $1", [id]);

      if (vResp.rows.length === 0) {
        return res.status(404).json({ message: "Version not found" });
      }

      const { project_id, type } = vResp.rows[0];

      // 1. Clear existing final flag for this project/type
      // 1. Clear ALL is_last_final flags for this project and type first (BOMs don't affect BOQs etc)
      await query("UPDATE boq_versions SET is_last_final = FALSE WHERE project_id = $1 AND type = $2", [project_id, type]);
      // Double check - ensures no "floating" flags on other projects by mistake
      await query("UPDATE boq_versions SET is_last_final = FALSE WHERE id = $1", ["some-bogus-id-that-wont-exist"]); // Just a dummy sync

      // 2. Set this one as final
      const updateRes = await query("UPDATE boq_versions SET is_last_final = TRUE WHERE id = $1", [id]);
      console.log(`[make-final] Set version ${id} to is_last_final=TRUE. Result: ${updateRes.rowCount} rows.`);

      // 3. Sync the project price to this new final version
      await recalculateProjectValue(project_id, id);

      res.json({ message: "Version set as final" });
    } catch (err) {
      console.error("[make-final] Error:", err);
      res.status(500).json({ message: "Failed to mark as final" });
    }
  });

  // POST /api/boq-versions/:versionId/save-edits - Batch save edits for BOQ items in a version
  app.post(
    "/api/boq-versions/:versionId/save-edits",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { versionId } = req.params;
        const { editedFields } = req.body;

        if (!editedFields || Object.keys(editedFields).length === 0) {
          return res.json({ message: "No edits to save" });
        }

        console.log(`Saving edits for version ${versionId}:`, Object.keys(editedFields));

        // Group edits by boqItemId and type
        const editsByItem: Record<string, { engine: Record<number, any>, manual: Record<number, any> }> = {};
        for (const [key, fields] of Object.entries(editedFields)) {
          const parts = key.split("-");
          if (parts.length < 3) {
            console.warn(`[save-edits] Invalid edit key format: ${key}`);
            continue;
          }

          const itemIdxStr = parts[parts.length - 1];
          const itemIdx = parseInt(itemIdxStr, 10);

          let type = parts[parts.length - 2];
          let boqItemId = "";

          if (type === "engine" || type === "manual") {
            boqItemId = parts.slice(0, parts.length - 2).join("-");
          } else {
            type = "manual"; // non-engine products store items in step11_items, so treat as manual
            boqItemId = parts.slice(0, parts.length - 1).join("-");
          }

          if (!editsByItem[boqItemId]) editsByItem[boqItemId] = { engine: {}, manual: {} };

          if (type === "engine") {
            editsByItem[boqItemId].engine[itemIdx] = fields;
          } else {
            editsByItem[boqItemId].manual[itemIdx] = fields;
          }
        }

        console.log("Grouped edits by BOQ Item ID:", Object.keys(editsByItem));

        // Process each BOQ item that has edits
        let totalItemsUpdated = 0;
        const updatedRows: any[] = [];

        for (const [boqItemId, types] of Object.entries(editsByItem)) {
          console.log(`Processing edits for BOQ Item ID: ${boqItemId}`);

          // Fetch existing item
          const result = await query(
            `SELECT table_data FROM boq_items WHERE id = $1`,
            [boqItemId]
          );

          if (result.rows.length === 0) {
            console.warn(`BOQ item ${boqItemId} NOT FOUND in version ${versionId}`);
            continue;
          }

          let tableData = result.rows[0].table_data;
          if (typeof tableData === "string") {
            try {
              tableData = JSON.parse(tableData);
            } catch (e) {
              console.error(`Failed to parse table_data string for item ${boqItemId}`, e);
              continue;
            }
          }

          let editsAppliedToThisItem = 0;

          // Apply Engine Edits (materialLines)
          for (const [itemIdxStr, fields] of Object.entries(types.engine)) {
            const itemIdx = parseInt(itemIdxStr, 10);
            if (tableData.materialLines && tableData.materialLines[itemIdx]) {
              console.log(`Applying ENGINE edits to material index ${itemIdx} of BOQ Item ${boqItemId}`);
              const f = fields as any;
              // MaterialLines uses supplyRate/installRate (camelCase)
              if (f.supply_rate !== undefined) tableData.materialLines[itemIdx].supplyRate = Number(f.supply_rate);
              else if (f.rate !== undefined) tableData.materialLines[itemIdx].supplyRate = Number(f.rate);
              if (f.install_rate !== undefined) tableData.materialLines[itemIdx].installRate = Number(f.install_rate);
              if (f.qty !== undefined) tableData.materialLines[itemIdx].perUnitQty = Number(f.qty);
              editsAppliedToThisItem++;
            }
          }

          // Apply Manual Edits (step11_items)
          for (const [itemIdxStr, fields] of Object.entries(types.manual)) {
            const itemIdx = parseInt(itemIdxStr, 10);
            if (tableData.step11_items && tableData.step11_items[itemIdx]) {
              console.log(`Applying MANUAL edits to sub-item index ${itemIdx} of BOQ Item ${boqItemId}`);
              tableData.step11_items[itemIdx] = {
                ...tableData.step11_items[itemIdx],
                ...fields as any
              };
              editsAppliedToThisItem++;
            }
          }

          if (editsAppliedToThisItem > 0) {
            // Update DB with modified table_data object (stringified)
            const updateResult = await query(
              `UPDATE boq_items SET table_data = $1 WHERE id = $2`,
              [JSON.stringify(tableData), boqItemId]
            );
            console.log(`[save-edits] DB UPDATE SUCCESS for ${boqItemId}. Rows affected: ${updateResult.rowCount}`);

            // Fetch the updated row so we can return authoritative data to the client
            try {
              const fresh = await query(
                `SELECT id, project_id, version_id, estimator, table_data, created_at FROM boq_items WHERE id = $1`,
                [boqItemId],
              );
              if (fresh.rows.length > 0) {
                const row = fresh.rows[0];
                updatedRows.push({
                  id: row.id,
                  project_id: row.project_id,
                  version_id: row.version_id,
                  estimator: row.estimator,
                  table_data: typeof row.table_data === "string" ? JSON.parse(row.table_data) : row.table_data,
                  created_at: row.created_at,
                });
              }
            } catch (e) {
              console.warn(`[save-edits] Failed to re-select updated row ${boqItemId}:`, e);
            }

            totalItemsUpdated++;
          }
        }

        console.log(`Successfully finished saving edits. Total BOQ items updated: ${totalItemsUpdated}`);

        // Recalculate project value for the version's project
        const verRes = await query(`SELECT project_id FROM boq_versions WHERE id = $1`, [versionId]);
        if (verRes.rows.length > 0) {
          await recalculateProjectValue(verRes.rows[0].project_id, versionId);
        }

        // Log edit in history
        if (totalItemsUpdated > 0) {
          try {
            const user = (req as any).user;
            await query(
              `INSERT INTO boq_history (version_id, user_id, user_full_name, action, created_at)
               VALUES ($1, $2, $3, 'edited', NOW())`,
              [versionId, user?.id, user?.fullName || user?.username]
            );
          } catch (hErr) {
            console.warn("Failed to log edit history:", hErr);
          }
        }

        res.json({ message: "Edits saved successfully", updatedItems: updatedRows });
      } catch (err) {
        console.error("POST /api/boq-versions/:versionId/save-edits error", err);
        res.status(500).json({ message: "Failed to save edits" });
      }
    },
  );

  // GET /api/boq-versions/:versionId/history - Fetch history for a version
  app.get(
    "/api/boq-versions/:versionId/history",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { versionId } = req.params;
        const result = await query(
          "SELECT * FROM boq_history WHERE version_id = $1 ORDER BY created_at DESC",
          [versionId]
        );
        res.json({ history: result.rows });
      } catch (err) {
        console.error("GET /api/boq-versions/:versionId/history error", err);
        res.status(500).json({ message: "Failed to fetch history" });
      }
    }
  );

  // PUT /api/boq-versions/:versionId - Update version status (lock/submit)
  app.put(
    "/api/boq-versions/:versionId",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { versionId } = req.params;
        const { status, column_config, is_locked, type: newType, is_boq_submission, is_disabled } = req.body;

        if (is_disabled !== undefined) {
          await query(
            `UPDATE boq_versions SET is_disabled = $1, updated_at = NOW() WHERE id = $2`,
            [is_disabled, versionId]
          );
        }

        if (status && !["draft", "submitted", "pending_approval", "approved", "rejected", "edit_requested"].includes(status)) {
          res.status(400).json({ message: "Invalid status" });
          return;
        }

        if (column_config !== undefined) {
          await query(
            `UPDATE boq_versions SET column_config = $1, updated_at = NOW() WHERE id = $2`,
            [column_config, versionId]
          );
        }

        if (is_boq_submission !== undefined) {
          await query(
            `UPDATE boq_versions SET is_boq_submission = $1, updated_at = NOW() WHERE id = $2`,
            [is_boq_submission, versionId]
          );
        }

        // Allow changing type (e.g. Finance team upgrading a BOM → BOQ when submitting for BOQ approval)
        if (newType && ["bom", "boq"].includes(newType)) {
          await query(
            `UPDATE boq_versions SET type = $1, updated_at = NOW() WHERE id = $2`,
            [newType, versionId]
          );
        }

        if (is_locked !== undefined) {
          await query(
            `UPDATE boq_versions SET is_locked = $1, updated_at = NOW() WHERE id = $2`,
            [is_locked, versionId]
          );

          if (is_locked) {
            try {
              const user = (req as any).user;
              // Also ensure status is 'submitted' if locked by non-admin
              if (user.role !== 'admin' && user.role !== 'software_team') {
                await query(`UPDATE boq_versions SET status = 'submitted' WHERE id = $1 AND status = 'draft'`, [versionId]);
              }
              await query(
                `INSERT INTO boq_history (version_id, user_id, user_full_name, action, created_at)
                 VALUES ($1, $2, $3, 'locked', NOW())`,
                [versionId, user?.id, user?.fullName || user?.username]
              );
            } catch (hErr) {
              console.warn("Failed to log lock history:", hErr);
            }
          }
        }

        if (status) {
          await query(
            `UPDATE boq_versions SET status = $1, is_cleared = FALSE, updated_at = NOW() WHERE id = $2`,
            [status, versionId]
          );

          try {
            const user = (req as any).user;
            await query(
              `INSERT INTO boq_history (version_id, user_id, user_full_name, action, created_at)
               VALUES ($1, $2, $3, $4, NOW())`,
              [versionId, user?.id, user?.fullName || user?.username, status]
            );
          } catch (hErr) {
            console.warn("Failed to log status history:", hErr);
          }
        }

        res.json({ message: "Version updated successfully" });
      } catch (err) {
        console.error("PUT /api/boq-versions/:versionId error", err);
        res.status(500).json({ message: "Failed to update version" });
      }
    }
  );

  // POST /api/boq-versions/:id/request-edit
  app.post(
    "/api/boq-versions/:id/request-edit",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { reason } = req.body;
        const result = await query(
          "UPDATE boq_versions SET status = 'edit_requested', is_locked = TRUE, updated_at = NOW() WHERE id = $1 AND status = 'approved' RETURNING id",
          [id]
        );

        if (result.rowCount === 0) {
          return res.status(400).json({ message: "Can only request edit for approved versions" });
        }

        const user = (req as any).user;
        await query(
          `INSERT INTO boq_history (version_id, user_id, user_full_name, action, reason, created_at)
           VALUES ($1, $2, $3, 'edit_requested', $4, NOW())`,
          [id, user?.id, user?.fullName || user?.username, reason]
        );

        res.json({ message: "Edit request submitted successfully" });
      } catch (err) {
        console.error("POST /api/boq-versions/:id/request-edit error:", err);
        res.status(500).json({ message: "Failed to submit edit request" });
      }
    }
  );

  // POST /api/boq-versions/:id/category-order - Persist custom category sequence
  app.post(
    "/api/boq-versions/:id/category-order",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { categoryOrder } = req.body;

        if (!Array.isArray(categoryOrder)) {
          return res.status(400).json({ message: "categoryOrder array is required" });
        }

        await query(
          "UPDATE boq_versions SET category_order = $1, updated_at = NOW() WHERE id = $2",
          [JSON.stringify(categoryOrder), id]
        );

        res.json({ message: "Category order saved successfully" });
      } catch (err) {
        console.error("POST /api/boq-versions/:id/category-order error:", err);
        res.status(500).json({ message: "Failed to save category order" });
      }
    }
  );

  // ==================== BOM APPROVAL ROUTES ====================

  // GET /api/bom-approvals - List all submitted BOM versions
  app.get(
    "/api/bom-approvals",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "product_manager", "pre_sales", "finance_team"),
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        // Ensure columns exist
        await query("ALTER TABLE boq_versions ADD COLUMN IF NOT EXISTS is_cleared BOOLEAN DEFAULT FALSE");
        await query("ALTER TABLE boq_versions ADD COLUMN IF NOT EXISTS purchase_approval_status TEXT DEFAULT 'pending'");
        await query("ALTER TABLE boq_versions ADD COLUMN IF NOT EXISTS purchase_rejection_reason TEXT");
        await query("ALTER TABLE boq_versions ADD COLUMN IF NOT EXISTS is_boq_submission BOOLEAN DEFAULT FALSE");

        let queryStr = "SELECT * FROM boq_versions WHERE status != 'draft' AND ((is_cleared IS FALSE OR is_cleared IS NULL) OR status = 'edit_requested' OR status = 'pending_approval' OR status = 'submitted')";
        const params: any[] = [];

        // Admin/purchase/product/pre_sales/software_team should see all approvals; enforce project permissions only on other roles.
        const allowedToSeeAll = ["admin", "software_team", "purchase_team", "product_manager", "pre_sales"].includes(user.role);

        if (!allowedToSeeAll) {
          queryStr += ` AND project_id IN (SELECT project_id FROM user_project_permissions WHERE user_id = $1)`;
          params.push(user.id);
        }

        queryStr += " ORDER BY created_at DESC";

        const result = await query(queryStr, params);
        res.json({ approvals: result.rows });
      } catch (err) {
        console.error("GET /api/bom-approvals error:", err);
        res.status(500).json({ message: "Failed to load BOM approval requests" });
      }
    }
  );

  // POST /api/bom-approvals/:id/approve - Approve a BOM version
  app.post(
    "/api/bom-approvals/:id/approve",
    authMiddleware,
    requireRole("admin", "software_team"),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { is_locked } = req.body;

        if (is_locked !== undefined) {
          await query(
            "UPDATE boq_versions SET status = 'approved', is_locked = $1, updated_at = NOW() WHERE id = $2",
            [is_locked, id]
          );
        } else {
          // If no explicit lock state is passed (Standard Admin Dashboard Approval):
          // 1. If it's a standard Engineering submission (is_boq_submission is false/null), UNLOCK it for Finance.
          // 2. If it's a Finance BOQ submission (is_boq_submission is true), KEEP it locked.
          await query(
            "UPDATE boq_versions SET status = 'approved', is_locked = CASE WHEN is_boq_submission IS TRUE THEN TRUE ELSE FALSE END, updated_at = NOW() WHERE id = $1",
            [id]
          );
        }

        // Log approval in history
        try {
          const user = (req as any).user;
          await query(
            `INSERT INTO boq_history (version_id, user_id, user_full_name, action, created_at)
             VALUES ($1, $2, $3, 'approved', NOW())`,
            [id, user?.id, user?.fullName || user?.username]
          );
        } catch (hErr) {
          console.warn("Failed to log approval history:", hErr);
        }
        res.json({ message: "BOM version approved successfully" });
      } catch (err) {
        console.error("POST /api/bom-approvals/:id/approve error:", err);
        res.status(500).json({ message: "Failed to approve BOM version" });
      }
    }
  );

  // POST /api/bom-approvals/:id/reject - Reject a BOM version
  app.post(
    "/api/bom-approvals/:id/reject",
    authMiddleware,
    requireRole("admin", "software_team"),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { reason } = req.body;
        await query(
          "UPDATE boq_versions SET status = 'rejected', rejection_reason = $1, updated_at = NOW() WHERE id = $2",
          [reason, id]
        );

        // Log rejection in history
        try {
          const user = (req as any).user;
          await query(
            `INSERT INTO boq_history (version_id, user_id, user_full_name, action, reason, created_at)
             VALUES ($1, $2, $3, 'rejected', $4, NOW())`,
            [id, user?.id, user?.fullName || user?.username, reason]
          );
        } catch (hErr) {
          console.warn("Failed to log rejection history:", hErr);
        }
        res.json({ message: "BOM version rejected successfully" });
      } catch (err) {
        console.error("POST /api/bom-approvals/:id/reject error:", err);
        res.status(500).json({ message: "Failed to reject BOM version" });
      }
    }
  );

  // POST /api/bom-approvals/:id/clear - Mark a BOM as cleared (hidden)
  app.post(
    "/api/bom-approvals/:id/clear",
    authMiddleware,
    requireRole("admin", "software_team"),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        await query("UPDATE boq_versions SET is_cleared = TRUE WHERE id = $1", [id]);
        res.json({ message: "BOM version cleared successfully" });
      } catch (err) {
        console.error("POST /api/bom-approvals/:id/clear error:", err);
        res.status(500).json({ message: "Failed to clear BOM version" });
      }
    }
  );

  // ==================== PURCHASE TEAM BOM APPROVAL ROUTES ====================

  app.get(
    "/api/purchase-team-bom-approvals",
    authMiddleware,
    requireRole("admin", "purchase_team"),
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        // Purchase team views ALL BOM versions that aren't drafts and pending purchase approval
        let queryStr = "SELECT * FROM boq_versions WHERE status != 'draft' AND (purchase_approval_status = 'pending' OR purchase_approval_status IS NULL)";
        const params: any[] = [];
        queryStr += " ORDER BY created_at DESC";

        const result = await query(queryStr, params);
        res.json({ approvals: result.rows });
      } catch (err) {
        console.error("GET /api/purchase-team-bom-approvals error:", err);
        res.status(500).json({ message: "Failed to load" });
      }
    }
  );

  app.post(
    "/api/purchase-team-bom-approvals/:id/approve",
    authMiddleware,
    requireRole("admin", "purchase_team"),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        await query(
          "UPDATE boq_versions SET purchase_approval_status = 'approved', updated_at = NOW() WHERE id = $1",
          [id]
        );
        res.json({ message: "Purchase team approved version successfully" });
      } catch (err) {
        console.error("POST /api/purchase-team-bom-approvals/:id/approve error:", err);
        res.status(500).json({ message: "Failed to approve" });
      }
    }
  );

  app.post(
    "/api/purchase-team-bom-approvals/:id/reject",
    authMiddleware,
    requireRole("admin", "purchase_team"),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { reason } = req.body;
        await query(
          "UPDATE boq_versions SET purchase_approval_status = 'rejected', purchase_rejection_reason = $1, updated_at = NOW() WHERE id = $2",
          [reason, id]
        );
        res.json({ message: "Purchase team rejected version successfully" });
      } catch (err) {
        console.error("POST /api/purchase-team-bom-approvals/:id/reject error:", err);
        res.status(500).json({ message: "Failed to reject" });
      }
    }
  );

  // POST /api/bom-approvals/:id/approve-edit - Approve an edit request (revert to draft)
  app.post(
    "/api/bom-approvals/:id/approve-edit",
    authMiddleware,
    requireRole("admin", "software_team"),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const result = await query(
          "UPDATE boq_versions SET status = 'draft', is_locked = FALSE, updated_at = NOW() WHERE id = $1 AND status = 'edit_requested' RETURNING id",
          [id]
        );

        if (result.rowCount === 0) {
          return res.status(400).json({ message: "Invalid request or version status" });
        }

        // Log approval in history
        try {
          const user = (req as any).user;
          await query(
            `INSERT INTO boq_history (version_id, user_id, user_full_name, action, created_at)
             VALUES ($1, $2, $3, 'edit_approved', NOW())`,
            [id, user?.id, user?.fullName || user?.username]
          );
        } catch (hErr) {
          console.warn("Failed to log approval history:", hErr);
        }
        res.json({ message: "Edit request approved successfully. Version is now draft." });
      } catch (err) {
        console.error("POST /api/bom-approvals/:id/approve-edit error:", err);
        res.status(500).json({ message: "Failed to approve edit request" });
      }
    }
  );

  // POST /api/bom-approvals/:id/reject-edit - Reject an edit request (keep approved)
  app.post(
    "/api/bom-approvals/:id/reject-edit",
    authMiddleware,
    requireRole("admin", "software_team"),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { reason } = req.body;
        const result = await query(
          "UPDATE boq_versions SET status = 'approved', rejection_reason = $1, updated_at = NOW() WHERE id = $2 AND status = 'edit_requested' RETURNING id",
          [reason, id]
        );

        if (result.rowCount === 0) {
          return res.status(400).json({ message: "Invalid request or version status" });
        }

        // Log rejection in history
        try {
          const user = (req as any).user;
          await query(
            `INSERT INTO boq_history (version_id, user_id, user_full_name, action, reason, created_at)
             VALUES ($1, $2, $3, 'edit_rejected', $4, NOW())`,
            [id, user?.id, user?.fullName || user?.username, reason]
          );
        } catch (hErr) {
          console.warn("Failed to log rejection history:", hErr);
        }
        res.json({ message: "Edit request rejected successfully." });
      } catch (err) {
        console.error("POST /api/bom-approvals/:id/reject-edit error:", err);
        res.status(500).json({ message: "Failed to reject edit request" });
      }
    }
  );

  // POST /api/bom-approvals/bulk-clear - Mark multiple BOMs as cleared
  app.post(
    "/api/bom-approvals/bulk-clear",
    authMiddleware,
    requireRole("admin", "software_team"),
    async (req: Request, res: Response) => {
      try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
          return res.status(400).json({ message: "No IDs provided" });
        }
        await query("UPDATE boq_versions SET is_cleared = TRUE WHERE id = ANY($1)", [ids]);
        res.json({ message: `${ids.length} BOM(s) cleared successfully` });
      } catch (err) {
        console.error("POST /api/bom-approvals/bulk-clear error:", err);
        res.status(500).json({ message: "Failed to bulk clear BOM versions" });
      }
    }
  );

  // GET /api/boq-versions/:versionId - Get a specific version
  app.get(
    "/api/boq-versions/:versionId",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { versionId } = req.params;
        const result = await query("SELECT * FROM boq_versions WHERE id = $1", [versionId]);

        if (result.rows.length === 0) {
          return res.status(404).json({ message: "Version not found" });
        }

        res.json(result.rows[0]);
      } catch (err) {
        console.error("GET /api/boq-versions/:versionId error", err);
        res.status(500).json({ message: "Failed to fetch version" });
      }
    }
  );

  // New POST route added for snapshots
  app.post("/api/boq-versions/:id/template-snapshot", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { snapshot } = req.body;

      // Updates the specific version with the current template's data
      await query("UPDATE boq_versions SET last_template_snapshot = $1 WHERE id = $2",
        [JSON.stringify(snapshot), id]
      );

      res.json({ message: "Snapshot saved" });
    } catch (err) {
      console.error("POST /api/boq-versions/:id/template-snapshot error", err);
      res.status(500).json({ message: "Failed to save template snapshot" });
    }
  });

  // DELETE /api/boq-versions/:versionId - Delete a version and its items
  app.delete(
    "/api/boq-versions/:versionId",
    authMiddleware,
    async (req: Request, res: Response) => {
      const client = await (query as any).client?.connect?.();
      const { versionId } = req.params;

      try {
        // Get full version record before archiving
        const verRes = await query(`SELECT * FROM boq_versions WHERE id = $1`, [versionId]);
        if (verRes.rows.length === 0) {
          res.status(404).json({ message: "Version not found" });
          if (client && typeof client.release === "function") client.release();
          return;
        }

        const versionData = verRes.rows[0];
        const projectId = versionData.project_id;

        // Archive the version instead of deleting
        const archived = archiveService.archiveItem('boq_versions', versionId, versionData);
        if (req.query.action === 'trash' && archived) {
          archiveService.trashArchiveItem(archived.id);
        }

        if (projectId) {
          await recalculateProjectValue(projectId);
        }

        res.json({ message: "Version archived" });
      } catch (err) {
        try {
          await query("ROLLBACK");
        } catch (e) {
          // ignore
        }
        console.error("DELETE /api/boq-versions error", err);
        res.status(500).json({ message: "Failed to delete version" });
      } finally {
        if (client && typeof client.release === "function") client.release();
      }
    },
  );

  // Helper function to update project_value in boq_projects table
  async function recalculateProjectValue(projectId: string, versionId?: string) {
    try {
      // 1. Determine which version to calculate
      let targetVersionId = versionId;
      if (!targetVersionId) {
        const versionResult = await query(
          `SELECT id FROM boq_versions WHERE project_id = $1 ORDER BY version_number DESC LIMIT 1`,
          [projectId],
        );
        if (versionResult.rows.length === 0) {
          await query(`UPDATE boq_projects SET project_value = '0', updated_at = NOW() WHERE id = $1`, [projectId]);
          return;
        }
        targetVersionId = versionResult.rows[0].id;
      }

      // Fetch all items for this version
      const itemsResult = await query(
        `SELECT id, table_data, estimator, created_at FROM boq_items WHERE version_id = $1`,
        [targetVersionId],
      );

      const archivedIds = archiveService.getArchivedItemIds('boq_items');
      const trashedIds = archiveService.getTrashedItemIds('boq_items');


      const entriesToProcess = [];
      for (const row of itemsResult.rows) {
        if (archivedIds.includes(row.id) || trashedIds.includes(row.id)) continue;

        let tableData = row.table_data;
        if (typeof tableData === "string") {
          try { tableData = JSON.parse(tableData); } catch (e) { continue; }
        }
        entriesToProcess.push({ row, tableData });
      }

      let totalValue = 0;
      for (const entry of entriesToProcess) {
        const { tableData } = entry;

        // Logic must handle BOTH Engine-based (with materialLines) and Manual items
        if (tableData.materialLines && tableData.targetRequiredQty !== undefined && tableData.configBasis) {
          // Re-calculate the grandTotal for the Engine item
          const requiredQty = Number(tableData.targetRequiredQty) || 0;
          let itemSubtotal = 0;
          if (Array.isArray(tableData.materialLines)) {
            tableData.materialLines.forEach((line: any) => {
              const perUnitQty = Number(line.perUnitQty) || 0;
              const rate = (Number(line.supplyRate) || 0) + (Number(line.installRate) || 0);
              itemSubtotal += (requiredQty * perUnitQty) * rate;
            });
          }

          // Also add manual items attached to this engine product
          if (Array.isArray(tableData.step11_items)) {
            tableData.step11_items.forEach((item: any) => {
              const qty = parseFloat(item.qty) || 0;
              const supply = parseFloat(item.supply_rate || item.rate || 0); // handle rate/supply_rate
              const install = parseFloat(item.install_rate) || 0;
              itemSubtotal += qty * (supply + install);
            });
          }
          totalValue += itemSubtotal;
        } else {
          // Manual items only
          const items = tableData.step11_items || [];
          if (Array.isArray(items)) {
            items.forEach((item: any) => {
              const qty = parseFloat(item.qty) || 0;
              const supply = parseFloat(item.supply_rate || item.rate || 0);
              const install = parseFloat(item.install_rate) || 0;
              totalValue += qty * (supply + install);
            });
          }
        }
      }

      // 2. Update the specific version's price snapshot
      await query(
        `UPDATE boq_versions SET project_value = $1, updated_at = NOW() WHERE id = $2`,
        [totalValue.toString(), targetVersionId]
      );

      // 3. Sync the main project value from the "Last Final" version
      const finalVerResult = await query(`
         SELECT project_value 
         FROM boq_versions 
         WHERE project_id = $1 AND (status = 'approved' OR is_last_final = TRUE)
         ORDER BY is_last_final DESC NULLS LAST, version_number DESC 
         LIMIT 1
      `, [projectId]);

      let consolidatedValue = totalValue.toString();
      if (finalVerResult.rows.length > 0) {
        consolidatedValue = finalVerResult.rows[0].project_value;
      }
      await query(
        `UPDATE boq_projects SET project_value = $1, updated_at = NOW() WHERE id = $2`,
        [consolidatedValue, projectId],
      );

      console.log(`[recalculateProjectValue] Updated version ${targetVersionId} price. Project ${projectId} consolidated value: ${consolidatedValue}`);
    } catch (err) {
      console.error(`[recalculateProjectValue] Error for project ${projectId}:`, err);
    }
  }

  // ====== BOQ ITEMS ROUTES ======

  // POST /api/boq-items - Save a new BOQ item (captured from estimator Step 9)
  app.post(
    "/api/boq-items",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { project_id, version_id, estimator, table_data } = req.body;
        console.log("POST /api/boq-items received:", {
          project_id,
          version_id,
          estimator,
          table_data_keys: table_data ? Object.keys(table_data) : null,
        });

        if (!project_id || !estimator || !table_data) {
          console.error("Missing required fields:", {
            has_project_id: !!project_id,
            has_estimator: !!estimator,
            has_table_data: !!table_data,
          });
          res.status(400).json({
            message: "project_id, estimator, and table_data are required",
          });
          return;
        }

        const itemId = `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        console.log("Creating BOQ item with ID:", itemId);

        // Determine the next sort_order for this version
        const maxSortOrderResult = await query(
          `SELECT MAX(sort_order) as max_sort_order FROM boq_items WHERE version_id = $1`,
          [version_id],
        );
        const nextSortOrder = (maxSortOrderResult.rows[0]?.max_sort_order || 0) + 1;

        await query(
          `INSERT INTO boq_items (id, project_id, estimator, table_data, version_id, user_added, sort_order, created_at)
         VALUES ($1, $2, $3, $4, $5, true, $6, NOW())`,
          [
            itemId,
            project_id,
            estimator,
            JSON.stringify(table_data),
            version_id || null,
            nextSortOrder,
          ],
        );

        // Recalculate project value
        await recalculateProjectValue(project_id, version_id);

        // Confirm row persisted by selecting it back
        try {
          const check = await query(
            `SELECT id, project_id, version_id, estimator, table_data, user_added, sort_order, created_at FROM boq_items WHERE id = $1`,
            [itemId],
          );
          const inserted = check.rows[0];
          console.log("BOQ item created successfully (db):", {
            id: inserted?.id,
            project_id: inserted?.project_id,
            version_id: inserted?.version_id,
            estimator: inserted?.estimator,
            user_added: inserted?.user_added,
            sort_order: inserted?.sort_order,
            created_at: inserted?.created_at,
          });
        } catch (e) {
          console.warn("Could not verify inserted BOQ item:", e);
        }

        const responseData = {
          id: itemId,
          project_id,
          version_id,
          estimator,
          table_data,
          sort_order: nextSortOrder,
        };

        res.json(responseData);
      } catch (err) {
        console.error("POST /api/boq-items error", err);
        console.error("Error details:", {
          message: (err as any)?.message,
          code: (err as any)?.code,
          detail: (err as any)?.detail,
          stack: (err as any)?.stack,
        });
        res.status(500).json({
          message: "Failed to save BOQ item",
          error: (err as any)?.message
        });
      }
    },
  );

  // POST /api/boq-items/batch - Batch save multiple BOQ items
  app.post(
    "/api/boq-items/batch",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { project_id, version_id, items } = req.body;

        if (!project_id || !Array.isArray(items)) {
          res.status(400).json({ message: "project_id and items array are required" });
          return;
        }

        console.log(`Processing batch import of ${items.length} items for project ${project_id}`);

        // Get starting sort order
        const maxSortOrderResult = await query(
          `SELECT MAX(sort_order) as max_sort_order FROM boq_items WHERE version_id = $1`,
          [version_id],
        );
        let currentSortOrder = (maxSortOrderResult.rows[0]?.max_sort_order || 0) + 1;

        const results = [];
        for (const item of items) {
          const itemId = `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          await query(
            `INSERT INTO boq_items (id, project_id, estimator, table_data, version_id, user_added, sort_order, created_at)
             VALUES ($1, $2, $3, $4, $5, true, $6, NOW())`,
            [
              itemId,
              project_id,
              item.estimator || "General",
              JSON.stringify(item.table_data),
              version_id || null,
              currentSortOrder++,
            ],
          );
          results.push({ id: itemId });
        }

        // Recalculate project value once after all items are added
        await recalculateProjectValue(project_id, version_id);

        res.status(201).json({ message: "Batch items saved successfully", count: items.length });
      } catch (err) {
        console.error("POST /api/boq-items/batch error", err);
        res.status(500).json({
          message: "Failed to batch save BOQ items",
          error: (err as any)?.message,
          stack: (err as any)?.stack
        });
      }
    },
  );

  // GET /api/boq-items/finalized - Fetch ALL finalized items
  app.get(
    "/api/boq-items/finalized",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const result = await query(
          `SELECT id, project_id, version_id, estimator, table_data, created_at 
           FROM boq_items 
           WHERE (table_data::jsonb)->>'is_finalized' = 'true'
           ORDER BY sort_order ASC, created_at DESC`
        );
        const items = result.rows.map((row: any) => ({
          id: row.id,
          project_id: row.project_id,
          version_id: row.version_id,
          estimator: row.estimator,
          table_data: typeof row.table_data === "string" ? JSON.parse(row.table_data) : row.table_data,
          created_at: row.created_at,
        }));
        res.json({ items });
      } catch (err) {
        console.error("GET /api/boq-items/finalized error", err);
        res.status(500).json({ message: "Failed to fetch finalized items" });
      }
    },
  );

  // ==================== BOQ COMMENTS ROUTES ====================

  // GET /api/boq-comments/:versionId - Get comments for a BOM version
  app.get("/api/boq-comments/:versionId", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { versionId } = req.params;
      const user = (req as any).user;
      // Server-side visibility filter:
      // Return a comment if:
      //   1. visible_to is NULL or empty (visible to everyone), OR
      //   2. the requesting user's username is in visible_to (tagged), OR
      //   3. the requesting user is the sender (user_id = user.id)
      const result = await query(
        `SELECT id, version_id, product_id, item_id, user_id, user_full_name, comment_text, version_number, visible_to, read_by, parent_id, reply_to_text, reply_to_user, created_at, updated_at
         FROM bom_comments
         WHERE version_id = $1
           AND (
             visible_to IS NULL
             OR visible_to = '{}'
             OR cardinality(visible_to) = 0
             OR $2 = ANY(visible_to)
             OR user_id = $3
           )
         ORDER BY created_at ASC`,
        [versionId, user.username, user.id]
      );
      res.json({ comments: result.rows });
    } catch (err) {
      console.error("GET /api/boq-comments error", err);
      res.status(500).json({ message: "Failed to load comments" });
    }
  });

  // POST /api/boq-comments - Save a new comment
  app.post("/api/boq-comments", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { version_id, product_id, item_id, comment_text, version_number, visible_to, parent_id, reply_to_text, reply_to_user } = req.body;

      if (!version_id || !comment_text) {
        return res.status(400).json({ message: "version_id and comment_text are required" });
      }

      const result = await query(
        `INSERT INTO bom_comments (version_id, product_id, item_id, user_id, user_full_name, comment_text, version_number, visible_to, read_by, parent_id, reply_to_text, reply_to_user, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
         RETURNING *`,
        [
          version_id,
          product_id || null,
          item_id || null,
          user.id,
          user.fullName || user.username,
          comment_text,
          version_number || 1,
          visible_to || [],
          [user.id], // Auto-mark as read by sender
          parent_id || null,
          reply_to_text || null,
          reply_to_user || null
        ]
      );

      const savedComment = result.rows[0];

      // ── Email tagged users ──────────────────────────────────────
      if (visible_to && visible_to.length > 0) {
        try {
          // Fetch usernames→email mapping for tagged users
          const taggedUsersResult = await query(
            `SELECT username, email, full_name FROM users WHERE username = ANY($1)`,
            [visible_to]
          );
          const taggedUsersWithEmail = taggedUsersResult.rows.filter((u: any) => u.email);

          if (taggedUsersWithEmail.length > 0) {
            // Get version/project context for email body
            const versionResult = await query(
              `SELECT bv.version_number, bp.name AS project_name
               FROM boq_versions bv
               LEFT JOIN boq_projects bp ON bv.project_id = bp.id
               WHERE bv.id = $1 LIMIT 1`,
              [version_id]
            );
            const vCtx = versionResult.rows[0];

            // Determine thread name
            let threadName = "Overall Version Discussion";
            if (product_id) {
              const itemRes = await query(`SELECT estimator FROM boq_items WHERE id = $1 LIMIT 1`, [product_id]);
              if (itemRes.rows[0]) threadName = itemRes.rows[0].estimator || "Product Discussion";
            } else if (item_id) {
              const productId = String(item_id).split('_')[0];
              const itemRes = await query(`SELECT estimator FROM boq_items WHERE id = $1 LIMIT 1`, [productId]);
              if (itemRes.rows[0]) threadName = `${itemRes.rows[0].estimator} (Material Discussion)`;
            }

            await sendCommentMentionEmail(
              taggedUsersWithEmail.map((u: any) => u.email),
              {
                mentionedNames: taggedUsersWithEmail.map((u: any) => u.full_name || u.username),
                senderName: user.fullName || user.username,
                commentText: comment_text,
                threadName,
                projectName: vCtx?.project_name,
                versionNumber: vCtx?.version_number,
              }
            );
          }
        } catch (emailErr) {
          console.error("[EMAIL] Failed to send mention notification:", emailErr);
          // Don't block the response — email failure is non-critical
        }
      }
      // ────────────────────────────────────────────────────────────

      res.status(201).json({ comment: savedComment });
    } catch (err) {
      console.error("POST /api/boq-comments error", err);
      res.status(500).json({ message: "Failed to save comment" });
    }
  });

  // PATCH /api/boq-comments/:id/read - Mark comment as read
  app.patch("/api/boq-comments/:id/read", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { id } = req.params;

      await query(
        `UPDATE bom_comments SET read_by = array_append(read_by, $1) 
         WHERE id = $2 AND NOT ($1 = ANY(read_by))`,
        [user.id, id]
      );

      res.json({ success: true });
    } catch (err) {
      console.error("PATCH /api/boq-comments/read error", err);
      res.status(500).json({ message: "Failed to mark comment as read" });
    }
  });

  // PATCH /api/boq-comments/read-all/:versionId - Mark all comments in a context as read
  app.patch("/api/boq-comments/read-all/:versionId", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { versionId } = req.params;
      const { itemId } = req.body;

      let q = `UPDATE bom_comments SET read_by = array_append(read_by, $1) 
               WHERE version_id = $2 AND NOT ($1 = ANY(read_by))`;
      const params: any[] = [user.id, versionId];

      if (itemId) {
        q += ` AND (item_id = $3 OR product_id = $3)`;
        params.push(itemId);
      } else {
        q += ` AND item_id IS NULL AND product_id IS NULL`;
      }

      await query(q, params);
      res.json({ success: true });
    } catch (err) {
      console.error("PATCH /api/boq-comments/read-all error", err);
      res.status(500).json({ message: "Failed to mark all as read" });
    }
  });

  // GET /api/boq-items/version/:versionId - Fetch BOQ items for a specific version
  app.get(
    "/api/boq-items/version/:versionId",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { versionId } = req.params;

        const result = await query(
          `SELECT id, project_id, version_id, estimator, table_data, created_at 
         FROM boq_items 
         WHERE version_id = $1 AND user_added = true 
         ORDER BY sort_order ASC, created_at ASC`, // Added sort_order
          [versionId],
        );

        const archivedIds = archiveService.getArchivedItemIds('boq_items');
        const trashedIds = archiveService.getTrashedItemIds('boq_items');

        const rawItems = result.rows
          .filter((row: any) => !archivedIds.includes(row.id) && !trashedIds.includes(row.id))
          .map((row: any) => ({
            id: row.id,
            project_id: row.project_id,
            version_id: row.version_id,
            estimator: row.estimator,
            table_data:
              typeof row.table_data === "string"
                ? JSON.parse(row.table_data)
                : row.table_data,
            created_at: row.created_at,
          }));

        const items = rawItems;

        res.json({ items });
      } catch (err) {
        console.error("GET /api/boq-items/version error", err);
        res.status(500).json({ message: "Failed to fetch BOQ items" });
      }
    },
  );

  // GET /api/boq-items/history/:productName - Fetch product usage history across projects
  app.get(
    "/api/boq-items/history/:productName",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { productName } = req.params;

        console.log(`[HistoryAPI] Fetching history for: "${productName}"`);
        const result = await query(
          `SELECT bi.id, p.name as project_name, 
                  (bi.table_data::jsonb->>'category') as project_area,
                  bi.table_data, bi.created_at
           FROM boq_items bi
           JOIN boq_projects p ON bi.project_id = p.id
           WHERE bi.estimator ILIKE $1 
              OR (bi.table_data::jsonb->>'product_name') ILIKE $1
           ORDER BY bi.created_at DESC
           LIMIT 50`,
          [productName]
        );
        console.log(`[HistoryAPI] Found ${result.rows.length} records`);

        const items = result.rows.map(row => {
          const td = typeof row.table_data === 'string' ? JSON.parse(row.table_data) : row.table_data;
          return {
            id: row.id,
            project_name: row.project_name,
            project_area: row.project_area || td.category || "Main Area",
            table_data: td,
            created_at: row.created_at
          };
        });

        res.json({ items });
      } catch (err) {
        console.error("GET /api/boq-items/history error", err);
        res.status(500).json({ message: "Failed to fetch product history" });
      }
    }
  );

  // PUT /api/boq-items/:id - Update BOM item data
  app.put(
    "/api/boq-items/:id",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "product_manager", "pre_sales", "finance_team"),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { table_data } = req.body;

        if (!table_data) {
          res.status(400).json({ message: "table_data is required" });
          return;
        }

        await query(
          "UPDATE boq_items SET table_data = $1, created_at = NOW() WHERE id = $2",
          [JSON.stringify(table_data), id]
        );

        res.json({ message: "BOM item updated successfully" });
      } catch (err) {
        console.error("PUT /api/boq-items/:id error:", err);
        res.status(500).json({ message: "Failed to update BOM item" });
      }
    }
  );

  // POST /api/boq-items/reorder - Persist new sort order for BOM items
  app.post(
    "/api/boq-items/reorder",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "pre_sales"),
    async (req: Request, res: Response) => {
      try {
        const { itemIds } = req.body; // Expects array of item IDs in correct order
        if (!Array.isArray(itemIds)) {
          return res.status(400).json({ message: "itemIds array is required" });
        }

        console.log("Reordering items:", itemIds.length);

        // Update each item with its new sort order (index in the array)
        // Using a transaction for efficiency and safety
        await query("BEGIN");
        for (let i = 0; i < itemIds.length; i++) {
          await query(
            "UPDATE boq_items SET sort_order = $1 WHERE id = $2",
            [i, itemIds[i]]
          );
        }
        await query("COMMIT");

        res.json({ message: "Sort order updated successfully" });
      } catch (err: any) {
        await query("ROLLBACK");
        console.error("POST /api/boq-items/reorder error", err);
        res.status(500).json({ message: "Failed to update sort order" });
      }
    },
  );

  // GET /api/boq-items - Fetch BOQ items for a project (legacy, all versions)
  app.get(
    "/api/boq-items",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { project_id } = req.query;

        if (!project_id) {
          res
            .status(400)
            .json({ message: "project_id query parameter is required" });
          return;
        }

        const result = await query(
          `SELECT id, project_id, version_id, estimator, table_data, created_at FROM boq_items 
         WHERE project_id = $1 AND user_added = true ORDER BY created_at ASC`,
          [project_id],
        );

        const items = result.rows.map((row: any) => ({
          id: row.id,
          project_id: row.project_id,
          version_id: row.version_id,
          estimator: row.estimator,
          table_data:
            typeof row.table_data === "string"
              ? JSON.parse(row.table_data)
              : row.table_data,
          created_at: row.created_at,
        }));

        res.json({ items });
      } catch (err) {
        console.error("GET /api/boq-items error", err);
        res.status(500).json({ message: "Failed to fetch BOQ items" });
      }
    },
  );

  // PUT /api/boq-items/:itemId - Update a BOQ item's table_data
  app.put(
    "/api/boq-items/:itemId",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { itemId } = req.params;
        const { table_data } = req.body;

        if (!table_data) {
          res.status(400).json({ message: "table_data is required" });
          return;
        }

        await query(
          `UPDATE boq_items SET table_data = $1, created_at = NOW() WHERE id = $2`,
          [JSON.stringify(table_data), itemId],
        );

        // Recalculate project value
        const itemRes = await query(`SELECT project_id, version_id FROM boq_items WHERE id = $1`, [itemId]);
        if (itemRes.rows.length > 0) {
          await recalculateProjectValue(itemRes.rows[0].project_id, itemRes.rows[0].version_id);
        }

        res.json({ message: "BOQ item updated successfully" });
      } catch (err) {
        console.error("PUT /api/boq-items/:itemId error", err);
        res.status(500).json({ message: "Failed to update BOQ item" });
      }
    },
  );

  // DELETE /api/boq-items/:itemId - Delete a BOQ item
  app.delete(
    "/api/boq-items/:itemId",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { itemId } = req.params;

        // Get item data before archiving
        const itemRes = await query(`SELECT * FROM boq_items WHERE id = $1`, [itemId]);
        if (itemRes.rows.length === 0) {
          return res.status(404).json({ message: "BOQ item not found" });
        }

        const itemData = itemRes.rows[0];
        const projectId = itemData.project_id;

        // Archive instead of hard delete
        const archived = archiveService.archiveItem('boq_items', itemId, itemData);
        if (req.query.action === 'trash' && archived) {
          archiveService.trashArchiveItem(archived.id);
        }

        // Recalculate project value
        if (projectId) {
          await recalculateProjectValue(projectId, itemData.version_id);
        }

        res.json({ message: "BOQ item archived" });
      } catch (err) {
        console.error("DELETE /api/boq-items/:itemId error", err);
        res.status(500).json({ message: "Failed to delete BOQ item" });
      }
    },
  );

  // ====== BOQ TEMPLATE ROUTES ======

  // GET /api/boq-templates - List all templates
  app.get("/api/boq-templates", authMiddleware, async (req: Request, res: Response) => {
    try {
      const result = await query("SELECT * FROM boq_templates ORDER BY name ASC");
      const archivedIds = archiveService.getArchivedItemIds('boq_templates');
      const trashedIds = archiveService.getTrashedItemIds('boq_templates');
      const filtered = result.rows.filter((r) => !archivedIds.includes(r.id) && !trashedIds.includes(r.id));
      res.json({ templates: filtered });
    } catch (err) {
      console.error("GET /api/boq-templates error", err);
      res.status(500).json({ message: "Failed to fetch templates" });
    }
  });

  // POST /api/boq-templates - Save a new template
  app.post("/api/boq-templates", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { name, config } = req.body;
      if (!name || !config) {
        return res.status(400).json({ message: "Name and config are required" });
      }

      const upsertResult = await query(
        `INSERT INTO boq_templates (name, config, updated_at) 
         VALUES ($1, $2, NOW()) 
         ON CONFLICT (name) DO UPDATE SET config = $2, updated_at = NOW()
         RETURNING id`,
        [name, JSON.stringify(config)]
      );

      // Ensure it's not hidden if it was previously deleted/archived
      if (upsertResult.rows[0]) {
        archiveService.restoreByOriginId('boq_templates', upsertResult.rows[0].id);
      }

      res.json({ message: "Template saved successfully" });
    } catch (err) {
      console.error("POST /api/boq-templates error", err);
      res.status(500).json({ message: "Failed to save template" });
    }
  });

  // DELETE /api/boq-templates/:id - Delete a template
  app.delete("/api/boq-templates/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const getTpl = await query("SELECT * FROM boq_templates WHERE id = $1", [id]);
      if (getTpl.rows.length === 0) return res.status(404).json({ message: "Template not found" });

      const archived = archiveService.archiveItem('boq_templates', id, getTpl.rows[0]);
      if (req.query.action === 'trash' && archived) {
        archiveService.trashArchiveItem(archived.id);
      }
      res.json({ message: "Template archived" });
    } catch (err) {
      console.error("DELETE /api/boq-templates error", err);
      res.status(500).json({ message: "Failed to delete template" });
    }
  });

  // ======================================================================
  // ✅ BOM TEMPLATES ROUTES (Generate BOM Page)
  // ======================================================================

  // GET /api/bom-templates - List all BOM templates
  app.get("/api/bom-templates", authMiddleware, async (req: Request, res: Response) => {
    try {
      const result = await query("SELECT * FROM bom_templates ORDER BY name ASC");
      const archivedIds = archiveService.getArchivedItemIds('bom_templates');
      const trashedIds = archiveService.getTrashedItemIds('bom_templates');
      const filtered = result.rows.filter((r) => !archivedIds.includes(r.id) && !trashedIds.includes(r.id));
      res.json({ templates: filtered });
    } catch (err) {
      console.error("GET /api/bom-templates error", err);
      res.status(500).json({ message: "Failed to fetch BOM templates" });
    }
  });

  // POST /api/bom-templates - Save a new BOM template
  app.post("/api/bom-templates", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { name, config } = req.body;
      if (!name || !config) {
        return res.status(400).json({ message: "Name and config are required" });
      }

      const upsertResult = await query(
        `INSERT INTO bom_templates (name, config, updated_at) 
         VALUES ($1, $2, NOW()) 
         ON CONFLICT (name) DO UPDATE SET config = $2, updated_at = NOW()
         RETURNING id`,
        [name, JSON.stringify(config)]
      );

      // Ensure it's not hidden if it was previously deleted/archived
      if (upsertResult.rows[0]) {
        archiveService.restoreByOriginId('bom_templates', upsertResult.rows[0].id);
      }

      res.json({ message: "BOM Template saved successfully" });
    } catch (err) {
      console.error("POST /api/bom-templates error", err);
      res.status(500).json({ message: "Failed to save BOM template" });
    }
  });

  // DELETE /api/bom-templates/:id - Delete a BOM template
  app.delete("/api/bom-templates/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const getTpl = await query("SELECT * FROM bom_templates WHERE id = $1", [id]);
      if (getTpl.rows.length === 0) return res.status(404).json({ message: "Template not found" });

      const archived = archiveService.archiveItem('bom_templates', id, getTpl.rows[0]);
      if (req.query.action === 'trash' && archived) {
        archiveService.trashArchiveItem(archived.id);
      }
      res.json({ message: "BOM Template archived" });
    } catch (err) {
      console.error("DELETE /api/bom-templates error", err);
      res.status(500).json({ message: "Failed to delete BOM template" });
    }
  });

  // Estimator Step Data Storage Routes
  app.post(
    "/api/estimator-step9-items",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { estimator, session_id, items, replace } = req.body;
        const userId = (req as any).user?.id;

        if (!items || !Array.isArray(items)) {
          return res.status(400).json({ message: "Items array is required" });
        }

        // Ensure table exists
        await query(`
        CREATE TABLE IF NOT EXISTS estimator_step9_cart (
          id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
          estimator TEXT NOT NULL,
          bill_no TEXT NOT NULL,
          s_no INTEGER,
          item TEXT,
          description TEXT,
          unit TEXT,
          qty DECIMAL(10,2),
          rate DECIMAL(10,2),
          amount DECIMAL(10,2),
          material_id UUID,
          batch_id TEXT,
          row_id TEXT,
          shop_id UUID,
          supply_rate DECIMAL(10,2),
          install_rate DECIMAL(10,2),
          door_type TEXT,
          panel_type TEXT,
          sub_option TEXT,
          glazing_type TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        )
      `);

        // If replace is true, delete existing items for this session first
        if (replace) {
          await query(
            `
          DELETE FROM estimator_step9_cart
          WHERE estimator = $1 AND bill_no = $2
        `,
            [estimator, session_id],
          );
        }

        for (const item of items) {
          await query(
            `
          INSERT INTO estimator_step9_cart (
            estimator, bill_no, s_no, item, description, unit, qty, rate, amount,
            material_id, batch_id, row_id, shop_id, supply_rate, install_rate,
            door_type, panel_type, sub_option, glazing_type
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        `,
            [
              estimator,
              session_id,
              item.s_no,
              item.name || item.item,
              item.description,
              item.unit,
              item.quantity || item.qty,
              (item.supply_rate || 0) + (item.install_rate || 0),
              (item.quantity || item.qty || 0) *
              ((item.supply_rate || 0) + (item.install_rate || 0)),
              item.material_id,
              item.batch_id,
              item.row_id,
              item.shop_id,
              item.supply_rate,
              item.install_rate,
              item.door_type,
              item.panel_type,
              item.sub_option,
              item.glazing_type,
            ],
          );
        }

        res.json({ message: "Step 9 items saved successfully" });
      } catch (err) {
        console.error("POST /api/estimator-step9-items error", err);
        res.status(500).json({ message: "Failed to save step 9 items" });
      }
    },
  );

  app.get(
    "/api/estimator-step9-items",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { session_id, estimator } = req.query;

        // Ensure table exists
        await query(`
        CREATE TABLE IF NOT EXISTS estimator_step9_cart (
          id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
          estimator TEXT NOT NULL,
          bill_no TEXT NOT NULL,
          s_no INTEGER,
          item TEXT,
          description TEXT,
          unit TEXT,
          qty DECIMAL(10,2),
          rate DECIMAL(10,2),
          amount DECIMAL(10,2),
          material_id UUID,
          batch_id TEXT,
          row_id TEXT,
          shop_id UUID,
          supply_rate DECIMAL(10,2),
          install_rate DECIMAL(10,2),
          door_type TEXT,
          panel_type TEXT,
          sub_option TEXT,
          glazing_type TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        )
      `);

        let queryStr =
          "SELECT * FROM estimator_step9_cart WHERE estimator = $1";
        const params: any[] = [estimator];

        // If session_id is provided, filter by it; otherwise fetch all for that estimator
        if (session_id) {
          queryStr += " AND bill_no = $2";
          params.push(session_id);
        }

        queryStr += " ORDER BY created_at DESC";

        const result = await query(queryStr, params);

        // Transform the data to match frontend expectations
        const transformedItems = result.rows.map((row) => ({
          id: row.material_id,
          session_id: row.bill_no,
          rowId: row.row_id,
          batchId: row.batch_id,
          name: row.item,
          unit: row.unit,
          quantity: parseFloat(row.qty || 0),
          rate: parseFloat(row.rate || 0),
          supplyRate: parseFloat(row.supply_rate || 0),
          installRate: parseFloat(row.install_rate || 0),
          shopId: row.shop_id,
          material_name: row.item,
          shop_name: row.shop_name || "",
          description: row.description || "",
          location: row.location || "",
          doorType: row.door_type,
          panelType: row.panel_type,
          subOption: row.sub_option,
          glazingType: row.glazing_type,
          isSaved: true, // Mark as saved since it's from DB
          // Include database ID for deletion
          dbId: row.id,
        }));

        res.json({ items: transformedItems });
      } catch (err) {
        console.error("GET /api/estimator-step9-items error", err);
        res.status(500).json({ message: "Failed to load step 9 items" });
      }
    },
  );

  app.post(
    "/api/estimator-step11-groups",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { groups } = req.body;

        if (!groups || !Array.isArray(groups)) {
          return res.status(400).json({ message: "Groups array is required" });
        }

        for (const group of groups) {
          await query(
            `
          INSERT INTO estimator_step11_finalize_boq (
            estimator, bill_no, s_no, item, location, description, unit, qty,
            supply_rate, install_rate, supply_amount, install_amount
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `,
            [
              group.estimator,
              group.session_id,
              group.s_no || null,
              group.item_name || group.item,
              group.location,
              group.description,
              group.unit,
              group.quantity || group.qty,
              group.supply_rate,
              group.install_rate,
              group.supply_amount,
              group.install_amount,
            ],
          );
        }

        res.json({ message: "Step 11 groups saved successfully" });
      } catch (err) {
        console.error("POST /api/estimator-step11-groups error", err);
        res.status(500).json({ message: "Failed to save step 11 groups" });
      }
    },
  );

  app.post(
    "/api/estimator-step12-qa-selection",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { estimator, session_id, items } = req.body;

        if (!items || !Array.isArray(items)) {
          return res.status(400).json({ message: "Items array is required" });
        }

        for (const item of items) {
          await query(
            `
          INSERT INTO estimator_step12_qa_boq (
            estimator, bill_no, s_no, item, location, description, unit, qty,
            supply_rate, install_rate, supply_amount, install_amount
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `,
            [
              estimator,
              session_id,
              item.s_no,
              item.item,
              item.location,
              item.description,
              item.unit,
              item.qty,
              item.supply_rate,
              item.install_rate,
              item.supply_amount,
              item.install_amount,
            ],
          );
        }

        res.json({ message: "Step 12 QA items saved successfully" });
      } catch (err) {
        console.error("POST /api/estimator-step12-qa-selection error", err);
        res.status(500).json({ message: "Failed to save step 12 QA items" });
      }
    },
  );

  app.get(
    "/api/estimator-step11-groups",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { session_id, estimator } = req.query;

        const result = await query(
          `
        SELECT * FROM estimator_step11_finalize_boq 
        WHERE bill_no = $1 AND estimator = $2 
        ORDER BY s_no ASC
      `,
          [session_id, estimator],
        );

        res.json({ items: result.rows });
      } catch (err) {
        console.error("GET /api/estimator-step11-groups error", err);
        res.status(500).json({ message: "Failed to load step 11 groups" });
      }
    },
  );

  // GET /api/step11-by-product - Get Step 11 data for a product
  app.get(
    "/api/step11-by-product",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { product_id, estimator } = req.query;

        if (!product_id || !estimator) {
          return res.status(400).json({
            message: "product_id and estimator query parameters are required",
          });
        }

        // First, get the product details to find matching items
        const productResult = await query(
          `SELECT name FROM products WHERE id = $1`,
          [product_id],
        );

        if (productResult.rows.length === 0) {
          return res.json({ items: [] });
        }

        const product = productResult.rows[0];
        const productName = product.name.toLowerCase();

        // Query estimator_step11_finalize_boq table
        // Filter by estimator AND match product keywords
        const result = await query(
          `
        SELECT 
          id, bill_no, estimator, s_no, item, location, unit,
          qty, supply_rate, install_rate, supply_amount, install_amount, created_at
        FROM estimator_step11_finalize_boq 
        WHERE estimator = $1
        ORDER BY s_no ASC
        LIMIT 50
      `,
          [estimator],
        );

        // Filter items that match the product name with strict matching
        // Get the first significant word of the product name (e.g., "Flush" from "Flush Door")
        const productWords = productName.split(" ").filter((w: string) => w.length > 2);
        const primaryWord = productWords[0]; // e.g., "flush" or "glass"

        const filteredRows = result.rows.filter((row: any) => {
          const itemLower = row.item?.toLowerCase() || "";

          // Match ONLY if item starts with the primary product word
          // This ensures "Flush Door" items only match "flush*" and "Glass Door" only matches "glass*"
          return itemLower.startsWith(primaryWord);
        });

        // If no matches found, return empty (don't return all items)
        if (filteredRows.length === 0) {
          return res.json({ items: [] });
        }

        // Transform data to match Step 11Preview expectations
        const items = filteredRows.map((row: any) => ({
          id: row.id || `${row.bill_no}-${row.s_no}`,
          s_no: row.s_no,
          bill_no: row.bill_no,
          estimator: row.estimator,
          title: row.item,
          description: row.item, // Use item as description since description column may not exist
          location: row.location,
          unit: row.unit,
          qty: parseFloat(row.qty || 0),
          supply_rate: parseFloat(row.supply_rate || 0),
          install_rate: parseFloat(row.install_rate || 0),
          supply_amount: parseFloat(row.supply_amount || 0),
          install_amount: parseFloat(row.install_amount || 0),
          group_id: row.bill_no,
        }));

        res.json({ items });
      } catch (err) {
        console.error("GET /api/step11-by-product error", err);
        res.status(500).json({ message: "Failed to load step 11 data" });
      }
    },
  );

  app.get(
    "/api/estimator-step12-qa-selection",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { session_id, estimator } = req.query;

        const result = await query(
          `
        SELECT * FROM estimator_step12_qa_boq 
        WHERE bill_no = $1 AND estimator = $2 
        ORDER BY s_no ASC
      `,
          [session_id, estimator],
        );

        res.json({ items: result.rows });
      } catch (err) {
        console.error("GET /api/estimator-step12-qa-selection error", err);
        res.status(500).json({ message: "Failed to load step 12 QA items" });
      }
    },
  );

  app.delete(
    "/api/estimator-step9-items",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { session_id, estimator, items } = req.body;

        // Ensure table exists
        await query(`
        CREATE TABLE IF NOT EXISTS estimator_step9_cart (
          id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
          estimator TEXT NOT NULL,
          bill_no TEXT NOT NULL,
          s_no INTEGER,
          item TEXT,
          description TEXT,
          unit TEXT,
          qty DECIMAL(10,2),
          rate DECIMAL(10,2),
          amount DECIMAL(10,2),
          material_id UUID,
          batch_id TEXT,
          row_id TEXT,
          shop_id UUID,
          supply_rate DECIMAL(10,2),
          install_rate DECIMAL(10,2),
          door_type TEXT,
          panel_type TEXT,
          sub_option TEXT,
          glazing_type TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        )
      `);

        if (items && Array.isArray(items) && items.length > 0) {
          // Delete specific items by ID
          for (const item of items) {
            await query(
              `
            DELETE FROM estimator_step9_cart
            WHERE id = $1 AND bill_no = $2 AND estimator = $3
          `,
              [item.dbId || item.id, session_id, estimator],
            );
          }
        } else {
          // Delete all items for the session (backward compatibility)
          await query(
            `
          DELETE FROM estimator_step9_cart
          WHERE bill_no = $1 AND estimator = $2
        `,
            [session_id, estimator],
          );
        }

        res.json({ message: "Step 9 items deleted successfully" });
      } catch (err) {
        console.error("DELETE /api/estimator-step9-items error", err);
        res.status(500).json({ message: "Failed to delete step 9 items" });
      }
    },
  );

  app.delete(
    "/api/estimator-step11-groups",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { session_id, estimator, ids } = req.body;

        if (ids && Array.isArray(ids) && ids.length > 0) {
          // Delete specific items by IDs
          await query(
            `
          DELETE FROM estimator_step11_finalize_boq
          WHERE id = ANY($1) AND estimator = $2
        `,
            [ids, estimator],
          );
        } else if (session_id && estimator) {
          // Delete all items for a session (legacy behavior)
          await query(
            `
          DELETE FROM estimator_step11_finalize_boq
          WHERE bill_no = $1 AND estimator = $2
        `,
            [session_id, estimator],
          );
        } else {
          return res.status(400).json({
            message: "Either ids array or session_id/estimator required",
          });
        }

        res.json({ message: "Step 11 groups deleted successfully" });
      } catch (err) {
        console.error("DELETE /api/estimator-step11-groups error", err);
        res.status(500).json({ message: "Failed to delete step 11 groups" });
      }
    },
  );

  app.delete(
    "/api/estimator-step12-qa-selection",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { session_id, estimator } = req.body;

        await query(
          `
        DELETE FROM estimator_step12_qa_boq 
        WHERE bill_no = $1 AND estimator = $2
      `,
          [session_id, estimator],
        );

        res.json({ message: "Step 12 QA items deleted successfully" });
      } catch (err) {
        console.error("DELETE /api/estimator-step12-qa-selection error", err);
        res.status(500).json({ message: "Failed to delete step 12 QA items" });
      }
    },
  );

  // ====== STEP 11 PRODUCT CONFIGURATION ROUTES ======

  // POST /api/step11-products - Save product configuration
  app.post(
    "/api/step11-products",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "product_manager", "pre_sales"),
    async (req: Request, res: Response) => {
      console.log("[POST /api/step11-products] body:", JSON.stringify(req.body).slice(0, 200) + "...");
      try {
        const {
          productId,
          productName,
          configName,
          categoryId,
          subcategoryId,
          totalCost,
          items,
        } = req.body;

        if (!productId) {
          console.warn("[POST /api/step11-products] Missing productId");
          res.status(400).json({ message: "Product ID is required" });
          return;
        }

        // Start transaction
        await query("BEGIN");

        try {
          // 1. Optional: Delete existing configuration if we specifically want to overwrite by config_name?
          // For now, let's just allow multiple. If config_name is provided, we could overwrite it.

          if (configName) {
            console.log(`[POST /api/step11-products] Checking for existing config named "${configName}" for productId: ${productId}`);
            await query("DELETE FROM step11_products WHERE product_id = $1 AND config_name = $2", [
              productId,
              configName,
            ]);
          }

          // ensure columns exist
          await query("ALTER TABLE step11_products ADD COLUMN IF NOT EXISTS required_unit_type VARCHAR(20)");
          await query("ALTER TABLE step11_products ADD COLUMN IF NOT EXISTS base_required_qty DECIMAL(10,4)");
          await query("ALTER TABLE step11_products ADD COLUMN IF NOT EXISTS wastage_pct_default DECIMAL(10,4)");
          await query("ALTER TABLE step11_products ADD COLUMN IF NOT EXISTS dim_a DECIMAL(10,4)");
          await query("ALTER TABLE step11_products ADD COLUMN IF NOT EXISTS dim_b DECIMAL(10,4)");
          await query("ALTER TABLE step11_products ADD COLUMN IF NOT EXISTS dim_c DECIMAL(10,4)");
          await query("ALTER TABLE step11_products ADD COLUMN IF NOT EXISTS description TEXT");

          // Expand text column limits to prevent saving errors on long names/descriptions
          await query("ALTER TABLE step11_products ALTER COLUMN product_name TYPE TEXT");
          await query("ALTER TABLE step11_products ALTER COLUMN config_name TYPE TEXT");

          // 2. Insert into step11_products
          console.log(`[POST /api/step11-products] Inserting new product config for productId: ${productId}`);
          const productResult = await query(
            `INSERT INTO step11_products (product_id, product_name, config_name, category_id, subcategory_id, total_cost, required_unit_type, base_required_qty, wastage_pct_default, dim_a, dim_b, dim_c, description, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
             RETURNING id`,
            [
              productId,
              productName,
              configName || 'Default Configuration',
              categoryId,
              subcategoryId,
              totalCost,
              req.body.requiredUnitType || 'Sqft',
              req.body.baseRequiredQty || 1,
              req.body.wastagePctDefault || 0,
              req.body.dimA || null,
              req.body.dimB || null,
              req.body.dimC || null,
              req.body.description || null
            ],
          );

          const step11ProductId = productResult.rows[0].id;
          console.log(`[POST /api/step11-products] Inserted step11_products with internal ID: ${step11ProductId}`);

          // 3. Insert items
          if (items && Array.isArray(items)) {
            console.log(`[POST /api/step11-products] Inserting ${items.length} items`);
            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              console.log(`[POST /api/step11-products] Inserting item ${i + 1}/${items.length}:`, JSON.stringify(item));
              // ensure column exists
              await query("ALTER TABLE step11_product_items ADD COLUMN IF NOT EXISTS apply_wastage BOOLEAN DEFAULT TRUE");
              await query("ALTER TABLE step11_product_items ADD COLUMN IF NOT EXISTS shop_name TEXT");
              await query("ALTER TABLE step11_product_items ADD COLUMN IF NOT EXISTS base_qty DECIMAL(10,4)");
              await query("ALTER TABLE step11_product_items ADD COLUMN IF NOT EXISTS freeze_and_edit BOOLEAN DEFAULT FALSE");
              await query("ALTER TABLE step11_product_items ADD COLUMN IF NOT EXISTS freeze_and_edit BOOLEAN DEFAULT FALSE");

              // Expand text column limits
              await query("ALTER TABLE step11_product_items ALTER COLUMN material_id TYPE TEXT");
              await query("ALTER TABLE step11_product_items ALTER COLUMN material_name TYPE TEXT");
              await query("ALTER TABLE step11_product_items ALTER COLUMN location TYPE TEXT");
              await query("ALTER TABLE step11_product_items ALTER COLUMN shop_name TYPE TEXT");

              await query(
                `INSERT INTO step11_product_items 
                 (step11_product_id, material_id, material_name, unit, qty, rate, supply_rate, install_rate, location, amount, freeze_and_edit, apply_wastage, shop_name, base_qty)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
                [
                  step11ProductId,
                  item.materialId,
                  item.materialName,
                  item.unit,
                  item.qty,
                  item.rate,
                  item.supplyRate,
                  item.installRate,
                  item.location,
                  item.amount,
                  item.freezeAndEdit === true || item.freeze_and_edit === true,
                  item.applyWastage !== undefined ? item.applyWastage : true,
                  item.shopName || item.shop_name || null,
                  item.baseQty ?? item.qty
                ],
              );
            }
          }

          console.log("[POST /api/step11-products] All items inserted. Committing...");
          await query("COMMIT");
          console.log("[POST /api/step11-products] Transaction committed. Sending 201 response.");
          res.status(201).json({ message: "Configuration saved successfully" });
        } catch (err) {
          console.error("[POST /api/step11-products] Internal error during transaction:", err);
          await query("ROLLBACK");
          throw err;
        }
      } catch (err) {
        console.error("POST /api/step11-products error:", err instanceof Error ? err.message : err);
        console.error("Full error:", err);
        res.status(500).json({ message: "Failed to save product configuration", error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // POST /api/product-step3-config - Save Step 3 (configuration step) data separately
  app.post(
    "/api/product-step3-config",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "product_manager", "pre_sales"),
    async (req: Request, res: Response) => {
      try {
        const {
          productId,
          productName,
          configName,
          categoryId,
          subcategoryId,
          totalCost,
          items,
          requiredUnitType,
          baseRequiredQty,
          wastagePctDefault,
          dimA,
          dimB,
          dimC,
          description
        } = req.body;

        if (!productId) {
          res.status(400).json({ message: "Product ID is required" });
          return;
        }

        await query("BEGIN");
        try {
          // Delete existing Step 3 config for this product (overwrite)
          await query("DELETE FROM product_step3_config WHERE product_id = $1", [productId]);

          // ensure columns exist
          await query("ALTER TABLE product_step3_config ADD COLUMN IF NOT EXISTS dim_a DECIMAL(10,4)");
          await query("ALTER TABLE product_step3_config ADD COLUMN IF NOT EXISTS dim_b DECIMAL(10,4)");
          await query("ALTER TABLE product_step3_config ADD COLUMN IF NOT EXISTS dim_c DECIMAL(10,4)");
          await query("ALTER TABLE product_step3_config ADD COLUMN IF NOT EXISTS description TEXT");

          await query("ALTER TABLE product_step3_config ALTER COLUMN product_name TYPE TEXT");
          await query("ALTER TABLE product_step3_config ALTER COLUMN config_name TYPE TEXT");

          // Insert new Step 3 config header
          const configResult = await query(
            `INSERT INTO product_step3_config (
              product_id, product_name, config_name, category_id, subcategory_id, 
              total_cost, required_unit_type, base_required_qty, wastage_pct_default,
              dim_a, dim_b, dim_c, description,
              created_at, updated_at
            )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()) RETURNING id`,
            [
              productId,
              productName,
              configName || "Default",
              categoryId,
              subcategoryId,
              totalCost,
              requiredUnitType || 'Sqft',
              baseRequiredQty || 1,
              wastagePctDefault || 0,
              dimA || null,
              dimB || null,
              dimC || null,
              description || null
            ],
          );

          const step3ConfigId = configResult.rows[0].id;

          // insert items
          if (items && Array.isArray(items)) {
            // ensure column exists
            await query("ALTER TABLE product_step3_config_items ADD COLUMN IF NOT EXISTS apply_wastage BOOLEAN DEFAULT TRUE");

            // Add shop_name to config items
            await query("ALTER TABLE product_step3_config_items ADD COLUMN IF NOT EXISTS freeze_and_edit BOOLEAN DEFAULT FALSE");
            await query("ALTER TABLE product_step3_config_items ADD COLUMN IF NOT EXISTS shop_name TEXT");
            await query("ALTER TABLE product_step3_config_items ADD COLUMN IF NOT EXISTS freeze_and_edit BOOLEAN DEFAULT FALSE");

            await query("ALTER TABLE product_step3_config_items ALTER COLUMN material_id TYPE TEXT");
            await query("ALTER TABLE product_step3_config_items ALTER COLUMN material_name TYPE TEXT");
            await query("ALTER TABLE product_step3_config_items ALTER COLUMN location TYPE TEXT");
            await query("ALTER TABLE product_step3_config_items ALTER COLUMN shop_name TYPE TEXT");

            for (const item of items) {
              await query(
                `INSERT INTO product_step3_config_items
                 (step3_config_id, material_id, material_name, unit, qty, rate, supply_rate, install_rate, location, amount, base_qty, wastage_pct, apply_wastage, freeze_and_edit, shop_name)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
                [
                  step3ConfigId,
                  item.materialId,
                  item.materialName,
                  item.unit,
                  item.qty,
                  item.rate,
                  item.supplyRate,
                  item.installRate,
                  item.location,
                  item.amount,
                  item.baseQty,
                  item.wastagePct,
                  item.applyWastage !== undefined ? item.applyWastage : true,
                  item.freezeAndEdit === true || item.freeze_and_edit === true,
                  item.shopName || item.shop_name || null
                ],
              );
            }
          }

          await query("COMMIT");
          res.status(201).json({ message: "Step 3 configuration saved successfully", id: step3ConfigId });
        } catch (err) {
          await query("ROLLBACK");
          throw err;
        }
      } catch (err) {
        console.error("POST /api/product-step3-config error:", err instanceof Error ? err.message : err);
        res.status(500).json({ message: "Failed to save Step 3 configuration", error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // GET /api/product-step3-config/:productId - Load Step 3 config for a product
  app.get(
    "/api/product-step3-config/:productId",
    authMiddleware,
    async (req: Request, res: Response) => {
      const { productId } = req.params;
      try {
        const isValidUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        const isUUID = isValidUUID(productId);

        let configQuery = "";
        let configParams: any[] = [];
        if (isUUID) {
          configQuery = "SELECT * FROM product_step3_config WHERE product_id = $1 ORDER BY updated_at DESC LIMIT 1";
          configParams = [productId];
        } else {
          // If productId is not a UUID, query by product_name instead
          configQuery = "SELECT * FROM product_step3_config WHERE product_name = $1 ORDER BY updated_at DESC LIMIT 1";
          configParams = [productId];
        }

        const configResult = await query(configQuery, configParams);
        if (configResult.rows.length === 0) {
          res.status(404).json({ message: "No Step 3 configuration found" });
          return;
        }
        const config = configResult.rows[0];
        const itemsResult = await query(
          "SELECT * FROM product_step3_config_items WHERE step3_config_id = $1 ORDER BY id ASC",
          [config.id],
        );
        res.json({ config, items: itemsResult.rows });
      } catch (err) {
        console.error("GET /api/product-step3-config/:productId error:", err);
        res.status(500).json({ message: "Failed to load Step 3 configuration" });
      }
    },
  );

  // GET /api/step11-products/:productId - Load ALL configurations for this product
  app.get(
    "/api/step11-products/:productId",
    async (req: Request, res: Response) => {
      const { productId } = req.params;
      const logMsg = `[${new Date().toISOString()}] GET /api/step11-products/${productId}\n`;
      fs.appendFileSync('server_api_log.txt', logMsg);

      try {
        // Helper function to check if a string is a valid UUID
        const isValidUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        const isUUID = isValidUUID(productId);

        // 0. Fetch the product name for this productId to ensure we catch all configurations
        // (Legacy data might use different UUIDs for the same product name)
        let productName = null;
        if (isUUID) {
          const productInfo = await query("SELECT name FROM products WHERE id = $1", [productId]);
          productName = productInfo.rows[0]?.name;
        }

        // 1. Fetch approved configurations (Step 11)
        // Query by BOTH productId and productName to ensure consistency, but ONLY if productId is a valid UUID
        let step11Query = "";
        let step11Params: any[] = [];
        if (isUUID) {
          step11Query = `SELECT s.*, pr.name as live_product_name, 
           COALESCE(pr.name, s.product_name) as product_name, 
           'approved' as status FROM step11_products s
           LEFT JOIN products pr ON s.product_id = pr.id
           WHERE s.product_id = $1 ${productName ? "OR s.product_name = $2" : ""} 
           ORDER BY s.updated_at DESC`;
          step11Params = productName ? [productId, productName] : [productId];
        } else {
          // If productId is not a UUID (it's a legacy name), just search by name
          const searchName = productName || productId;
          step11Query = `SELECT s.*, pr.name as live_product_name, 
           COALESCE(pr.name, s.product_name) as product_name, 
           'approved' as status FROM step11_products s
           LEFT JOIN products pr ON s.product_id = pr.id
           WHERE s.product_name = $1
           ORDER BY s.updated_at DESC`;
          step11Params = [searchName];
        }
        const step11Result = await query(step11Query, step11Params);

        // 2. Fetch draft configurations (Step 3)
        let step3Query = "";
        let step3Params: any[] = [];
        if (isUUID) {
          step3Query = `SELECT s.*, pr.name as live_product_name, 
           COALESCE(pr.name, s.product_name) as product_name, 
           'draft' as status FROM product_step3_config s
           LEFT JOIN products pr ON s.product_id = pr.id::varchar
           WHERE s.product_id = $1 ${productName ? "OR s.product_name = $2" : ""} 
           ORDER BY s.updated_at DESC`;
          step3Params = productName ? [productId, productName] : [productId];
        } else {
          const searchName = productName || productId;
          step3Query = `SELECT s.*, pr.name as live_product_name, 
           COALESCE(pr.name, s.product_name) as product_name, 
           'draft' as status FROM product_step3_config s
           LEFT JOIN products pr ON s.product_id = pr.id::varchar
           WHERE s.product_name = $1
           ORDER BY s.updated_at DESC`;
          step3Params = [searchName];
        }
        const step3Result = await query(step3Query, step3Params);

        const resLog = `  -> Found ${step11Result.rows.length} approved and ${step3Result.rows.length} draft configurations\n`;
        fs.appendFileSync('server_api_log.txt', resLog);

        // Fetch latest Step 3 config for this product to use as smart fallback for legacy records
        let step3LatestQuery = "";
        let step3LatestParams: any[] = [];
        if (isUUID) {
          step3LatestQuery = `SELECT required_unit_type, base_required_qty, wastage_pct_default, description FROM product_step3_config 
           WHERE product_id = $1 ${productName ? "OR product_name = $2" : ""} 
           ORDER BY updated_at DESC LIMIT 1`;
          step3LatestParams = productName ? [productId, productName] : [productId];
        } else {
          const searchName = productName || productId;
          step3LatestQuery = `SELECT required_unit_type, base_required_qty, wastage_pct_default, description FROM product_step3_config 
           WHERE product_name = $1
           ORDER BY updated_at DESC LIMIT 1`;
          step3LatestParams = [searchName];
        }
        const step3LatestResult = await query(step3LatestQuery, step3LatestParams);
        const step3Fallback = step3LatestResult.rows[0] || { required_unit_type: 'Sqft', base_required_qty: 100, wastage_pct_default: 0, description: null };

        // 3. Process Step 11 configurations
        const enhancedStep11 = await Promise.all(step11Result.rows.map(async (p: any) => {
          p.required_unit_type = p.required_unit_type || step3Fallback.required_unit_type || 'Sqft';
          p.base_required_qty = p.base_required_qty || step3Fallback.base_required_qty || 100;
          p.wastage_pct_default = p.wastage_pct_default || step3Fallback.wastage_pct_default || 0;
          p.description = p.description || step3Fallback.description;

          const itemsResult = await query(
            "SELECT * FROM step11_product_items WHERE step11_product_id = $1",
            [p.id],
          );
          return {
            product: p,
            items: itemsResult.rows,
          };
        }));

        // 4. Process Step 3 configurations
        const enhancedStep3 = await Promise.all(step3Result.rows.map(async (p: any) => {
          const itemsResult = await query(
            "SELECT * FROM product_step3_config_items WHERE step3_config_id = $1",
            [p.id],
          );
          return {
            product: p,
            items: itemsResult.rows,
          };
        }));

        // 5. Merge, Sort, and Deduplicate by config_name
        const mergedConfigs = [...enhancedStep11, ...enhancedStep3].sort((a, b) =>
          new Date(b.product.updated_at).getTime() - new Date(a.product.updated_at).getTime()
        );

        const seenNames = new Set<string>();
        const allConfigs = mergedConfigs.filter(cfg => {
          // Deduplicate within the same status, but allow different statuses with same name
          // This ensures an Approved config isn't hidden by a newer Draft of the same name.
          const configKey = `${(cfg.product.config_name || "").toLowerCase().trim()}|${cfg.product.status}`;
          if (seenNames.has(configKey)) {
            return false;
          }
          seenNames.add(configKey);
          return true;
        });

        res.json({
          configurations: allConfigs,
        });
      } catch (err) {
        console.error("GET /api/step11-products/:productId error", err);
        res.status(500).json({ message: "Failed to load product configurations" });
      }
    },
  );

  // GET /api/step11-products/config/:id - Load specific configuration with items
  app.get(
    "/api/step11-products/config/:id",
    async (req: Request, res: Response) => {
      const { id } = req.params;
      console.log("[GET /api/step11-products/config/:id] id:", id);
      try {
        const productResult = await query(
          `SELECT s.*, pr.name as live_product_name, 
           COALESCE(pr.name, s.product_name) as product_name
           FROM step11_products s
           LEFT JOIN products pr ON s.product_id = pr.id
           WHERE s.id = $1`,
          [id],
        );

        if (productResult.rows.length === 0) {
          res.status(404).json({ message: "Configuration not found" });
          return;
        }

        const product = productResult.rows[0];
        // Fetch Step 3 fallback for legacy records
        const step3Result = await query(
          "SELECT required_unit_type, base_required_qty, wastage_pct_default, description FROM product_step3_config WHERE product_id = $1 ORDER BY updated_at DESC LIMIT 1",
          [product.product_id]
        );
        const step3Fallback = step3Result.rows[0] || { required_unit_type: 'Sqft', base_required_qty: 100, wastage_pct_default: 0, description: null };

        // Apply fallbacks for legacy records
        product.required_unit_type = product.required_unit_type || step3Fallback.required_unit_type || 'Sqft';
        product.base_required_qty = product.base_required_qty || step3Fallback.base_required_qty || 100;
        product.wastage_pct_default = product.wastage_pct_default || step3Fallback.wastage_pct_default || 0;
        product.description = product.description || step3Fallback.description;

        const itemsResult = await query(
          "SELECT * FROM step11_product_items WHERE step11_product_id = $1",
          [id],
        );

        res.json({
          product,
          items: itemsResult.rows,
        });
      } catch (err) {
        console.error("GET /api/step11-products/config/:id error", err);
        res.status(500).json({ message: "Failed to load specific configuration" });
      }
    },
  );

  // DELETE /api/step11-products/config/:id - Delete a configuration
  app.delete(
    "/api/step11-products/config/:id",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "product_manager", "pre_sales"),
    async (req: Request, res: Response) => {
      const { id } = req.params;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

      try {
        await query("BEGIN");
        let result;
        if (isUuid) {
          // Permanent Step 11 configuration
          result = await query("DELETE FROM step11_products WHERE id = $1", [id]);
        } else {
          // Step 3 Draft configuration (ID is integer)
          result = await query("DELETE FROM product_step3_config WHERE id = $1", [id]);
        }
        await query("COMMIT");

        if (result.rowCount === 0) {
          res.status(404).json({ message: "Configuration not found" });
          return;
        }
        res.json({ message: "Configuration deleted successfully" });
      } catch (err) {
        await query("ROLLBACK");
        console.error("DELETE /api/step11-products/config/:id error", err);
        res.status(500).json({ message: "Failed to delete configuration" });
      }
    }
  );

  // PUT /api/step11-products/config/:id - Update configuration name (rename)
  app.put(
    "/api/step11-products/config/:id",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "product_manager", "pre_sales"),
    async (req: Request, res: Response) => {
      const { id } = req.params;
      const { config_name } = req.body || {};
      if (!config_name || typeof config_name !== "string") {
        res.status(400).json({ message: "Invalid config_name" });
        return;
      }

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      try {
        let result;
        if (isUuid) {
          // Permanent Step 11 configuration
          result = await query("UPDATE step11_products SET config_name = $1, updated_at = NOW() WHERE id = $2", [config_name, id]);
        } else {
          // Step 3 Draft configuration (ID is integer)
          result = await query("UPDATE product_step3_config SET config_name = $1, updated_at = NOW() WHERE id = $2", [config_name, id]);
        }

        if (result.rowCount === 0) {
          res.status(404).json({ message: "Configuration not found" });
          return;
        }

        res.json({ message: "Configuration renamed successfully", config_name });
      } catch (err) {
        console.error("PUT /api/step11-products/config/:id error", err);
        res.status(500).json({ message: "Failed to rename configuration" });
      }
    }
  );

  // ====== GLOBAL SETTINGS ROUTES ======

  app.get("/api/global-settings", authMiddleware, async (_req, res) => {
    try {
      const result = await query(`SELECT * FROM global_settings`);
      const settings: { [key: string]: any } = {};
      result.rows.forEach(row => {
        settings[row.id] = row.value;
      });
      res.json(settings);
    } catch (err) {
      console.error("Failed to fetch global settings:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/global-settings/:id", authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const { value } = req.body;
      await query(
        `INSERT INTO global_settings (id, value, updated_at) 
         VALUES ($1, $2, NOW()) 
         ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [id, JSON.stringify(value)]
      );
      res.json({ message: `Setting ${id} updated` });
    } catch (err) {
      console.error(`Failed to update global setting ${req.params.id}:`, err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ==================== PRODUCT APPROVAL ROUTES ====================
  // Ensure product_approvals has rejection_reason column
  query("ALTER TABLE product_approvals ADD COLUMN IF NOT EXISTS rejection_reason TEXT").catch(() => { });
  query("ALTER TABLE product_approval_items ADD COLUMN IF NOT EXISTS freeze_and_edit BOOLEAN DEFAULT FALSE").catch(() => { });

  // POST /api/product-approvals - Submit for approval
  app.post(
    "/api/product-approvals",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "product_manager", "pre_sales"),
    async (req: Request, res: Response) => {
      try {
        const {
          productId, productName, configName, categoryId, subcategoryId,
          totalCost, items, requiredUnitType, baseRequiredQty, wastagePctDefault,
          dimA, dimB, dimC, description
        } = req.body;

        if (!productId) {
          res.status(400).json({ message: "Product ID is required" });
          return;
        }

        await query("BEGIN");
        try {
          const approvalResult = await query(
            `INSERT INTO product_approvals (
              product_id, product_name, config_name, category_id, subcategory_id,
              total_cost, required_unit_type, base_required_qty, wastage_pct_default,
              dim_a, dim_b, dim_c, description, status, created_by,
              created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14,NOW(),NOW()) RETURNING id`,
            [
              productId, productName, configName || "Default", categoryId, subcategoryId,
              totalCost, requiredUnitType || 'Sqft', baseRequiredQty || 1, wastagePctDefault || 0,
              dimA || null, dimB || null, dimC || null, description || null,
              (req.user as any)?.username || 'unknown'
            ]
          );
          const approvalId = approvalResult.rows[0].id;

          if (items && Array.isArray(items)) {
            for (const item of items) {
              await query(
                `INSERT INTO product_approval_items
                 (approval_id, material_id, material_name, unit, qty, rate, supply_rate, install_rate, location, amount, base_qty, wastage_pct, apply_wastage, freeze_and_edit, shop_name)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
                [
                  approvalId, item.materialId, item.materialName, item.unit, item.qty, item.rate,
                  item.supplyRate, item.installRate, item.location, item.amount,
                  item.baseQty, item.wastagePct,
                  item.applyWastage !== undefined ? item.applyWastage : true,
                  item.freezeAndEdit === true || item.freeze_and_edit === true,
                  item.shopName || item.shop_name || null
                ]
              );
            }
          }

          await query("COMMIT");
          res.status(201).json({ message: "Product configuration submitted for approval", id: approvalId });
        } catch (err) {
          await query("ROLLBACK");
          throw err;
        }
      } catch (err) {
        console.error("POST /api/product-approvals error:", err);
        res.status(500).json({ message: "Failed to submit for approval" });
      }
    }
  );

  // GET /api/product-approvals - List all approval requests
  app.get(
    "/api/product-approvals",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "product_manager", "pre_sales"),
    async (_req: Request, res: Response) => {
      try {
        const result = await query(
          `WITH latest_submissions AS (
             SELECT DISTINCT ON (pa.product_id, pa.config_name) pa.*
             FROM product_approvals pa
             ORDER BY pa.product_id, pa.config_name, pa.created_at DESC
           )
           SELECT p.*, pr.name as live_product_name,
             COALESCE(pr.name, p.product_name) as product_name,
             (SELECT COUNT(*) FROM product_approvals p2 
              WHERE p2.product_id = p.product_id 
              AND p2.config_name = p.config_name) as submission_count
           FROM latest_submissions p
           LEFT JOIN products pr ON p.product_id = pr.id
           ORDER BY p.created_at DESC`
        );
        res.json({ approvals: result.rows });
      } catch (err) {
        console.error("GET /api/product-approvals error:", err);
        res.status(500).json({ message: "Failed to load approval requests" });
      }
    }
  );

  // GET /api/product-approvals/:id - Get details for a specific approval
  app.get(
    "/api/product-approvals/:id",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "product_manager", "pre_sales"),
    async (req: Request, res: Response) => {
      try {
        const approvalResult = await query(
          `SELECT pa.*, pr.name as live_product_name, 
           COALESCE(pr.name, pa.product_name) as product_name
           FROM product_approvals pa
           LEFT JOIN products pr ON pa.product_id = pr.id
           WHERE pa.id = $1`, [req.params.id]
        );
        if (approvalResult.rows.length === 0) {
          res.status(404).json({ message: "Approval request not found" });
          return;
        }
        const itemsResult = await query(
          "SELECT * FROM product_approval_items WHERE approval_id = $1 ORDER BY id ASC",
          [req.params.id]
        );
        res.json({ approval: approvalResult.rows[0], items: itemsResult.rows });
      } catch (err) {
        console.error("GET /api/product-approvals/:id error:", err);
        res.status(500).json({ message: "Failed to load approval details" });
      }
    }
  );

  // PUT /api/product-approvals/:id - Update details and items
  app.put(
    "/api/product-approvals/:id",
    authMiddleware,
    requireRole("admin", "software_team", "purchase_team", "product_manager", "pre_sales"),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const {
          configName, totalCost, items, requiredUnitType, baseRequiredQty,
          wastagePctDefault, dimA, dimB, dimC, description
        } = req.body;

        await query("BEGIN");
        try {
          // Update the approval metadata
          await query(
            `UPDATE product_approvals SET
              config_name = $1, total_cost = $2, required_unit_type = $3,
              base_required_qty = $4, wastage_pct_default = $5,
              dim_a = $6, dim_b = $7, dim_c = $8, description = $9,
              updated_at = NOW()
             WHERE id = $10`,
            [
              configName, totalCost, requiredUnitType, baseRequiredQty,
              wastagePctDefault, dimA || null, dimB || null, dimC || null,
              description || null, id
            ]
          );

          // Delete existing items and re-insert updated ones
          await query("DELETE FROM product_approval_items WHERE approval_id = $1", [id]);

          if (items && Array.isArray(items)) {
            for (const item of items) {
              await query(
                `INSERT INTO product_approval_items
                 (approval_id, material_id, material_name, unit, qty, rate, supply_rate, install_rate, location, amount, base_qty, wastage_pct, apply_wastage, freeze_and_edit, shop_name)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
                [
                  id, item.material_id || item.materialId, item.material_name || item.materialName,
                  item.unit, item.qty, item.rate, item.supply_rate || item.supplyRate,
                  item.install_rate || item.installRate, item.location, item.amount,
                  item.base_qty || item.baseQty, item.wastage_pct || item.wastagePct,
                  item.apply_wastage !== undefined ? item.apply_wastage : (item.applyWastage !== undefined ? item.applyWastage : true),
                  item.freeze_and_edit === true || item.freezeAndEdit === true,
                  item.shop_name || item.shopName || null
                ]
              );
            }
          }

          await query("COMMIT");
          res.json({ message: "Product configuration updated successfully" });
        } catch (err) {
          await query("ROLLBACK");
          throw err;
        }
      } catch (err) {
        console.error("PUT /api/product-approvals/:id error:", err);
        res.status(500).json({ message: "Failed to update configuration" });
      }
    }
  );

  // POST /api/product-approvals/:id/approve - Approve a request
  app.post(
    "/api/product-approvals/:id/approve",
    authMiddleware,
    requireRole("admin", "software_team"),
    async (req: Request, res: Response) => {
      const { id } = req.params;
      try {
        await query("BEGIN");
        try {
          const approvalResult = await query(
            "SELECT * FROM product_approvals WHERE id = $1 AND status = 'pending'", [id]
          );
          if (approvalResult.rows.length === 0) {
            await query("ROLLBACK");
            res.status(404).json({ message: "Pending approval request not found" });
            return;
          }
          const appVal = approvalResult.rows[0];
          const itemsResult = await query(
            "SELECT * FROM product_approval_items WHERE approval_id = $1", [id]
          );
          const appItems = itemsResult.rows;

          // 1. Save to product_step3_config (overwrite)
          await query("DELETE FROM product_step3_config WHERE product_id = $1", [appVal.product_id]);
          // Ensure columns exist (best-effort)
          await query("ALTER TABLE product_step3_config ADD COLUMN IF NOT EXISTS dim_a DECIMAL(10,4)").catch(() => { });
          await query("ALTER TABLE product_step3_config ADD COLUMN IF NOT EXISTS dim_b DECIMAL(10,4)").catch(() => { });
          await query("ALTER TABLE product_step3_config ADD COLUMN IF NOT EXISTS dim_c DECIMAL(10,4)").catch(() => { });
          await query("ALTER TABLE product_step3_config ADD COLUMN IF NOT EXISTS description TEXT").catch(() => { });

          const step3ConfigResult = await query(
            `INSERT INTO product_step3_config (
              product_id, product_name, config_name, category_id, subcategory_id,
              total_cost, required_unit_type, base_required_qty, wastage_pct_default,
              dim_a, dim_b, dim_c, description, created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW()) RETURNING id`,
            [
              appVal.product_id, appVal.product_name, appVal.config_name,
              appVal.category_id, appVal.subcategory_id, appVal.total_cost,
              appVal.required_unit_type, appVal.base_required_qty, appVal.wastage_pct_default,
              appVal.dim_a, appVal.dim_b, appVal.dim_c, appVal.description
            ]
          );
          const step3Id = step3ConfigResult.rows[0].id;

          // Ensure item columns exist
          await query("ALTER TABLE product_step3_config_items ADD COLUMN IF NOT EXISTS apply_wastage BOOLEAN DEFAULT TRUE").catch(() => { });
          await query("ALTER TABLE product_step3_config_items ADD COLUMN IF NOT EXISTS shop_name VARCHAR(255)").catch(() => { });
          await query("ALTER TABLE product_step3_config_items ADD COLUMN IF NOT EXISTS freeze_and_edit BOOLEAN DEFAULT FALSE").catch(() => { });

          for (const item of appItems) {
            await query(
              `INSERT INTO product_step3_config_items
               (step3_config_id, material_id, material_name, unit, qty, rate, supply_rate, install_rate, location, amount, base_qty, wastage_pct, apply_wastage, freeze_and_edit, shop_name)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
              [
                step3Id, item.material_id, item.material_name, item.unit,
                item.qty, item.rate, item.supply_rate, item.install_rate,
                item.location, item.amount, item.base_qty, item.wastage_pct,
                item.apply_wastage, item.freeze_and_edit === true || item.freezeAndEdit === true, item.shop_name
              ]
            );
          }

          // 2. Save to step11_products (include all columns matching the original POST route)
          await query("ALTER TABLE step11_products ADD COLUMN IF NOT EXISTS required_unit_type VARCHAR(20)").catch(() => { });
          await query("ALTER TABLE step11_products ADD COLUMN IF NOT EXISTS base_required_qty DECIMAL(10,4)").catch(() => { });
          await query("ALTER TABLE step11_products ADD COLUMN IF NOT EXISTS wastage_pct_default DECIMAL(10,4)").catch(() => { });
          await query("ALTER TABLE step11_products ADD COLUMN IF NOT EXISTS dim_a DECIMAL(10,4)").catch(() => { });
          await query("ALTER TABLE step11_products ADD COLUMN IF NOT EXISTS dim_b DECIMAL(10,4)").catch(() => { });
          await query("ALTER TABLE step11_products ADD COLUMN IF NOT EXISTS dim_c DECIMAL(10,4)").catch(() => { });
          await query("ALTER TABLE step11_products ADD COLUMN IF NOT EXISTS description TEXT").catch(() => { });

          // Delete existing config with same config_name if any
          if (appVal.config_name) {
            await query("DELETE FROM step11_products WHERE product_id = $1 AND config_name = $2", [appVal.product_id, appVal.config_name]);
          }

          const step11Result = await query(
            `INSERT INTO step11_products (product_id, product_name, config_name, category_id, subcategory_id, total_cost, required_unit_type, base_required_qty, wastage_pct_default, dim_a, dim_b, dim_c, description, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW()) RETURNING id`,
            [
              appVal.product_id, appVal.product_name, appVal.config_name || 'Default Configuration',
              appVal.category_id, appVal.subcategory_id, appVal.total_cost,
              appVal.required_unit_type || 'Sqft', appVal.base_required_qty || 1, appVal.wastage_pct_default || 0,
              appVal.dim_a, appVal.dim_b, appVal.dim_c, appVal.description
            ]
          );
          const step11Id = step11Result.rows[0].id;

          await query("ALTER TABLE step11_product_items ADD COLUMN IF NOT EXISTS freeze_and_edit BOOLEAN DEFAULT FALSE").catch(() => { });
          await query("ALTER TABLE step11_product_items ADD COLUMN IF NOT EXISTS apply_wastage BOOLEAN DEFAULT TRUE").catch(() => { });
          await query("ALTER TABLE step11_product_items ADD COLUMN IF NOT EXISTS shop_name VARCHAR(255)").catch(() => { });
          await query("ALTER TABLE step11_product_items ADD COLUMN IF NOT EXISTS freeze_and_edit BOOLEAN DEFAULT FALSE").catch(() => { });

          for (const item of appItems) {
            await query(
              `INSERT INTO step11_product_items (step11_product_id, material_id, material_name, unit, qty, rate, supply_rate, install_rate, location, amount, freeze_and_edit, apply_wastage, shop_name)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
              [
                step11Id, item.material_id, item.material_name, item.unit,
                item.qty, item.rate, item.supply_rate, item.install_rate,
                item.location, item.amount,
                item.freeze_and_edit === true || item.freezeAndEdit === true,
                item.apply_wastage, item.shop_name
              ]
            );
          }

          // 3. Mark approved
          await query("UPDATE product_approvals SET status = 'approved', updated_at = NOW() WHERE id = $1", [id]);

          await query("COMMIT");
          res.json({ message: "Product configuration approved and saved successfully" });
        } catch (err) {
          await query("ROLLBACK");
          throw err;
        }
      } catch (err) {
        console.error("POST /api/product-approvals/:id/approve error:", err);
        res.status(500).json({ message: "Failed to approve request" });
      }
    }
  );

  // POST /api/product-approvals/:id/reject - Reject a request
  app.post(
    "/api/product-approvals/:id/reject",
    authMiddleware,
    requireRole("admin", "software_team"),
    async (req: Request, res: Response) => {
      try {
        const { rejection_reason } = req.body;
        const result = await query(
          "UPDATE product_approvals SET status = 'rejected', rejection_reason = $1, updated_at = NOW() WHERE id = $2 AND status = 'pending' RETURNING id",
          [rejection_reason || null, req.params.id]
        );
        if (result.rows.length === 0) {
          res.status(404).json({ message: "Pending approval not found" });
          return;
        }
        res.json({ message: "Product configuration rejected", rejection_reason });
      } catch (err) {
        console.error("POST /api/product-approvals/:id/reject error:", err);
        res.status(500).json({ message: "Failed to reject request" });
      }
    }
  );

  // DELETE /api/product-approvals/:id - Delete an approval request and its items
  app.delete(
    "/api/product-approvals/:id",
    authMiddleware,
    requireRole("admin", "software_team"),
    async (req: Request, res: Response) => {
      const { id } = req.params;
      try {
        await query("BEGIN");
        try {
          // remove child items first
          await query("DELETE FROM product_approval_items WHERE approval_id = $1", [id]);
          const result = await query("DELETE FROM product_approvals WHERE id = $1 RETURNING id", [id]);
          if (result.rows.length === 0) {
            await query("ROLLBACK");
            res.status(404).json({ message: "Approval request not found" });
            return;
          }
          await query("COMMIT");
          res.json({ message: "Approval request deleted" });
        } catch (err) {
          await query("ROLLBACK");
          throw err;
        }
      } catch (err) {
        console.error("DELETE /api/product-approvals/:id error:", err);
        res.status(500).json({ message: "Failed to delete approval request" });
      }
    }
  );
  // POST /api/product-approvals/bulk-delete - Delete multiple approval requests
  app.post(
    "/api/product-approvals/bulk-delete",
    authMiddleware,
    requireRole("admin", "software_team"),
    async (req: Request, res: Response) => {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "No IDs provided" });
      }
      try {
        await query("BEGIN");
        try {
          // remove child items first
          await query("DELETE FROM product_approval_items WHERE approval_id = ANY($1)", [ids]);
          await query("DELETE FROM product_approvals WHERE id = ANY($1)", [ids]);
          await query("COMMIT");
          res.json({ message: `${ids.length} approval request(s) deleted` });
        } catch (err) {
          await query("ROLLBACK");
          throw err;
        }
      } catch (err) {
        console.error("POST /api/product-approvals/bulk-delete error:", err);
        res.status(500).json({ message: "Failed to delete approval requests" });
      }
    }
  );

  // ==================== PURCHASE ORDER ROUTES ====================

  // GET /api/purchase-orders/preview-vendors - Find unique vendors for a BOM version
  app.get("/api/purchase-orders/preview-vendors", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { versionId } = req.query;
      if (!versionId) return res.status(400).json({ message: "versionId is required" });

      const itemsResult = await query(
        `SELECT table_data FROM boq_items WHERE version_id = $1 AND user_added = true`,
        [versionId]
      );

      const shopNames = new Set();

      // Helper: recursively extract shop_name from items and their nested step11_items, but ONLY if qty > 0
      const extractShopNames = (items: any[], scale: number = 1) => {
        for (const item of items) {
          const qty = (parseFloat(item.qty || item.quantity || item.requiredQty || 1) || 0) * scale;
          
          if (qty > 0) {
            const name = item.shop_name || item.shopName;
            if (name && typeof name === "string" && name.trim().length > 0) {
              shopNames.add(name.trim());
            }
          }
          
          // Drill into nested step11_items (consolidated products)
          if (Array.isArray(item.step11_items)) {
            extractShopNames(item.step11_items, scale);
          }
        }
      }

      for (const row of itemsResult.rows) {
        const td = parseSafeTableData(row.table_data);
        
        if (td.materialLines && td.targetRequiredQty !== undefined) {
          // Engine-based product
          const base = Number(td.baseRequiredQty || td.configBasis?.baseRequiredQty || 1);
          const scale = Number(td.targetRequiredQty) / base;
          
          if (Array.isArray(td.materialLines)) extractShopNames(td.materialLines, scale);
          if (Array.isArray(td.step11_items)) extractShopNames(td.step11_items, 1);
        } else {
          // Non-engine product
          if (Array.isArray(td.step11_items)) extractShopNames(td.step11_items, 1);
          else if (Array.isArray(td.materialLines)) extractShopNames(td.materialLines, 1);
          else if (Array.isArray(td.rows)) extractShopNames(td.rows, 1);
          else if (Array.isArray(td.items)) extractShopNames(td.items, 1);
        }
      }

      if (shopNames.size === 0) {
        return res.json({ vendors: [] });
      }

      const shopNamesArr = Array.from(shopNames);
      const shopsResult = await query(
        `SELECT id, name, location FROM shops WHERE TRIM(name) = ANY($1::text[])`,
        [shopNamesArr]
      );

      // For shop names with no matching shop record, create placeholder entries
      const foundNames = new Set(shopsResult.rows.map((r) => r.name.trim()));
      const placeholders = shopNamesArr
        .filter(n => !foundNames.has(n))
        .map(n => ({ id: null, name: n, location: null }));

      res.json({ vendors: [...shopsResult.rows, ...placeholders] });
    } catch (err) {
      console.error("GET /api/purchase-orders/preview-vendors error", err);
      res.status(500).json({ message: "Failed to preview vendors" });
    }
  });

  // GET /api/purchase-orders/check-existence?versionId=...
  app.get("/api/purchase-orders/check-existence", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { versionId } = req.query;
      if (!versionId) return res.status(400).json({ message: "Version ID is required" });
      const result = await query("SELECT id FROM purchase_orders WHERE version_id = $1 LIMIT 1", [versionId]);
      res.json({ exists: result.rowCount > 0 });
    } catch (err) {
      console.error("GET /api/purchase-orders/check-existence error", err);
      res.status(500).json({ message: "Failed to check PO existence" });
    }
  });


  // POST /api/purchase-orders/generate
  app.post(
    "/api/purchase-orders/generate",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { projectId, versionId, versionNumber } = req.body;
        if (!projectId || !versionId) {
          return res
            .status(400)
            .json({ message: "Project ID and Version ID are required" });
        }

        // 1. Get BOM items for this version
        const itemsResult = await query(
          "SELECT * FROM boq_items WHERE project_id = $1 AND version_id = $2 AND user_added = true",
          [projectId, versionId],
        );

        if (itemsResult.rowCount === 0) {
          return res.status(404).json({ message: "No items found for this BOM version" });
        }

        // 2. Extract lines from each item's table_data and group by vendor (shop_id)
        const vendorGroups: Record<string, any[]> = {};

        // Helper: flatten all material lines including those nested inside consolidated products
        const flattenItems = (items: any[]): any[] => {
          const result: any[] = [];
          for (const item of items) {
            // If this item has nested step11_items (consolidated product), drill in
            if (Array.isArray(item.step11_items) && item.step11_items.length > 0) {
              result.push(...flattenItems(item.step11_items));
            } else {
              result.push(item);
            }
          }
          return result;
        }

        for (const boqItem of itemsResult.rows) {
          const tableData = parseSafeTableData(boqItem.table_data);

          let lines: any[] = [];

          if (tableData.materialLines && tableData.targetRequiredQty !== undefined) {
            // Engine-based product: must scale quantities
            const base = Number(tableData.baseRequiredQty || tableData.configBasis?.baseRequiredQty || 1);
            const target = Number(tableData.targetRequiredQty) || 0;

            // 1. Process engine lines (materialLines)
            if (Array.isArray(tableData.materialLines)) {
              const engineLines = tableData.materialLines.map((l: any) => {
                const baseQty = Number(l.baseQty || l.qty || 0);
                const applyR = l.apply_rounding !== undefined ? Boolean(l.apply_rounding) : (l.applyRounding !== undefined ? Boolean(l.applyRounding) : true);

                // Excel/BOQ Logic: Round up at basis, then scale, then round off for PO
                // Per instructions, exclude wastage for PO (use baseQty directly)
                const roundedQtyAtBasis = applyR ? Math.ceil(baseQty) : baseQty;
                const computedPerUnitQty = base > 0 ? roundedQtyAtBasis / base : 0;
                // Use l.perUnitQty if it exists (allows respecting edits from Generate PO / BOM Edit screen)
                const perUnitQty = l.perUnitQty !== undefined ? Number(l.perUnitQty) : computedPerUnitQty;

                const scaledQty = Number((perUnitQty * target).toFixed(2));
                const roundOffQty = applyR ? Math.ceil(scaledQty) : scaledQty;

                const sRate = Number(l.supply_rate || l.supplyRate || 0);
                const iRate = Number(l.install_rate || l.installRate || 0);
                const rate = sRate + iRate;
                const amount = Number((roundOffQty * rate).toFixed(2));

                return {
                  ...l,
                  qty: roundOffQty,
                  rate: rate,
                  amount: Number((roundOffQty * rate).toFixed(2)),
                  item: l.name || l.material_name || "Unknown Item"
                };
              });
              lines.push(...engineLines);
            }

            // 2. Process manual items in engine-based product (if any)
            if (Array.isArray(tableData.step11_items)) {
              const manualLines = tableData.step11_items.filter((it: any) => it.manual).map((it: any) => {
                const qty = Number(it.qty || 0);
                const sRate = Number(it.supply_rate || it.supplyRate || 0);
                const iRate = Number(it.install_rate || it.installRate || 0);
                const rate = sRate + iRate;
                const amount = qty * rate;
                return {
                  ...it,
                  qty,
                  rate,
                  amount: Number((qty * rate).toFixed(2)),
                  item: it.title || it.name || "Unknown Item"
                };
              });
              lines.push(...manualLines);
            }
          } else {
            // Non-engine product: use step11_items, materialLines or rows directly
            if (Array.isArray(tableData.step11_items)) {
              lines = flattenItems(tableData.step11_items);
            } else if (Array.isArray(tableData.materialLines)) {
              lines = flattenItems(tableData.materialLines);
            } else if (Array.isArray(tableData.rows)) {
              lines = flattenItems(tableData.rows);
            } else if (Array.isArray(tableData.items)) {
              lines = flattenItems(tableData.items);
            }
          }

          for (const line of lines) {
            const qty = parseFloat(line.qty || line.quantity || line.requiredQty || 0);
            if (qty <= 0) continue; // Skip lines with no quantity

            const vendorName = (line.shop_name || line.shopName || "unassigned").trim();
            if (!vendorGroups[vendorName]) {
              vendorGroups[vendorName] = [];
            }
            vendorGroups[vendorName].push({
              ...line,
              boq_item_id: boqItem.id,
              hsn_code: line.hsn_code || tableData.hsn_sac_code || tableData.hsn_code || null,
              sac_code: line.sac_code || tableData.sac_code || null
            });
          }
        }


        // 3. Before creating new POs, remove any existing POs for this specific version
        // This prevents duplicating POs if the user clicks "Confirm & Generate" again.
        const existingPOs = await query(
          "SELECT id FROM purchase_orders WHERE project_id = $1 AND version_id = $2",
          [projectId, versionId]
        );
        
        for (const row of existingPOs.rows) {
          await query("DELETE FROM purchase_order_items WHERE po_id = $1", [row.id]);
          await query("DELETE FROM purchase_orders WHERE id = $1", [row.id]);
        }

        const generatedPos = [];

        // 4. For each vendor group, create a PO
        for (const [vendorName, items] of Object.entries(vendorGroups)) {
          if (vendorName === "unassigned") continue;

          const poNumber = `Anx-${Math.floor(1000 + Math.random() * 9000)}-${Date.now().toString().slice(-4)}`;
          let totalAmount = 0;

          // Look up vendor's UUID by name
          const shopLookup = await query(
            `SELECT id FROM shops WHERE TRIM(name) = $1 LIMIT 1`,
            [vendorName]
          );
          const vendorId = shopLookup.rows.length > 0 ? shopLookup.rows[0].id : vendorName;

          // Create the PO first to get an ID
          const poResult = await query(
            `INSERT INTO purchase_orders (po_number, project_id, vendor_id, vendor_name, status, total, version_id, version_number) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [poNumber, projectId, vendorId, vendorName, "draft", 0, versionId, versionNumber || null],
          );

          const poId = poResult.rows[0].id;

          // Insert items
          for (const item of items) {
            const qty = parseFloat(item.qty || item.quantity || 0) || 0;
            const supplyRate = parseFloat(item.supply_rate || item.supplyRate || item.rate || 0) || 0;
            const installRate = parseFloat(item.install_rate || item.installRate || 0) || 0;
            const rate = supplyRate + installRate;
            const amount = Number((parseFloat(item.amount || 0) || (qty * rate) || 0).toFixed(2));
            totalAmount += amount;

            await query(
              `INSERT INTO purchase_order_items (po_id, material_id, item, description, unit, qty, original_qty, rate, amount, hsn_code, sac_code, qty_modified) 
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
              [
                poId,
                item.material_id || item.materialId || item.id || null,
                item.item || item.material_name || item.title || item.name || "Unknown Item",
                item.description || item.location || null,
                item.unit || null,
                qty,
                qty, // original_qty starts same as qty
                rate,
                amount,
                item.hsn_code || item.hsn_sac_code || null,
                item.sac_code || null,
                false // qty_modified starts false
              ],
            );
          }

          // Update PO with total amount
          await query("UPDATE purchase_orders SET total = $1 WHERE id = $2", [
            totalAmount,
            poId,
          ]);

          generatedPos.push({ id: poId, poNumber, vendorId, totalAmount });
        }

        res.json({
          message: "Purchase orders generated successfully",
          generatedCount: generatedPos.length,
          orders: generatedPos,
        });
      } catch (err) {
        console.error("POST /api/purchase-orders/generate error", err);
        res.status(500).json({ message: "Failed to generate POs" });
      }
    },
  );

  // Helper to parse table data safely
  function parseSafeTableData(raw: any) {
    if (typeof raw === "string") {
      try { return JSON.parse(raw); } catch { return {}; }
    }
    return raw || {};
  }

  // ====== PO REQUEST ROUTES ======

  // POST /api/po-requests - Raise a new PO Request
  app.post("/api/po-requests", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { projectId, projectName, employeeId, department, items } = req.body;
      const user = (req as any).user;

      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      if (!projectId || !projectName || !items || !items.length) {
        return res.status(400).json({ message: "Missing required fields or items" });
      }

      // Insert PO Request
      const poReqResult = await query(
        `INSERT INTO po_requests 
         (project_id, project_name, requester_id, requester_name, employee_id, department, status) 
         VALUES ($1, $2, $3, $4, $5, $6, 'pending_approval') RETURNING *`,
        [projectId, projectName, user.id, user.fullName || user.username, employeeId || user.employeeCode, department || user.department]
      );

      const poRequest = poReqResult.rows[0];

      // Insert Items
      for (const item of items) {
        await query(
          `INSERT INTO po_request_items 
           (po_request_id, material_id, item, category, subcategory, unit, qty, rate, remarks) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [poRequest.id, item.material_id || item.id || null, item.item, item.category, item.subcategory, item.unit, item.qty, item.rate || null, item.remarks]
        );
      }

      res.status(201).json({ message: "PO Request raised successfully", poRequest });
    } catch (err) {
      console.error("POST /api/po-requests error", err);
      res.status(500).json({ message: "Failed to raise PO Request" });
    }
  });

  // GET /api/po-requests - List PO Requests (with optional filters)
  app.get("/api/po-requests", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { status, view } = req.query;
      const user = (req as any).user;

      let queryStr = `SELECT * FROM po_requests WHERE 1=1`;
      const params: any[] = [];

      if (view === 'my') {
        params.push(user.id);
        queryStr += ` AND requester_id = $${params.length}`;
      }

      if (status) {
        params.push(status);
        queryStr += ` AND status = $${params.length}`;
      }

      if (user.role === 'admin' || user.role === 'software_team' || user.role === 'purchase_team') {
        // Admins, software team and purchase team see all requests
      } else if (view !== 'my') {
        params.push(user.id);
        queryStr += ` AND project_id IN (SELECT project_id FROM user_project_permissions WHERE user_id = $${params.length})`;
      }

      queryStr += ` ORDER BY created_at DESC`;

      const result = await query(queryStr, params);

      // For each request, optionally fetch item count
      const requests = result.rows;

      res.json({ poRequests: requests });
    } catch (err) {
      console.error("GET /api/po-requests error:", err);
      res.status(500).json({ message: "Failed to load PO Requests" });
    }
  });

  // GET /api/po-requests/:id - Get a single PO Request and its items
  app.get("/api/po-requests/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const reqResult = await query(`SELECT * FROM po_requests WHERE id::text = $1`, [id]);
      if (reqResult.rows.length === 0) {
        return res.status(404).json({ message: "PO Request not found" });
      }

      const itemsResult = await query(
        `SELECT i.*, i.original_qty, m.hsn_code, m.sac_code, m.shop_id, s.name as shop_name, s.location as shop_location, s.gstNo as shop_gstin
         FROM po_request_items i
         LEFT JOIN materials m ON i.material_id::text = m.id::text
         LEFT JOIN shops s ON m.shop_id::text = s.id::text
         WHERE i.po_request_id::text = $1 
         ORDER BY i.created_at ASC`,
        [id]
      );

      res.json({
        poRequest: reqResult.rows[0],
        items: itemsResult.rows
      });
    } catch (err) {
      console.error(`[GET /api/po-requests/:id] Error for ID ${req.params.id}:`, err);
      res.status(500).json({ message: "Failed to load PO Request details" });
    }
  });

  // PUT /api/po-requests/:id/items - Update PO Request items (Revise)
  app.put("/api/po-requests/:id/items", authMiddleware, requireRole('admin', 'purchase_team'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { items, deliver_to, payment_terms, terms_conditions } = req.body;

      if (items && Array.isArray(items)) {
        // Update each item
        for (const item of items) {
          await query(
            `UPDATE po_request_items SET qty = $1, remarks = $2, rate = $3, updated_at = NOW() WHERE id = $4 AND po_request_id = $5`,
            [item.qty, item.remarks || null, item.rate || null, item.id, id]
          );
        }
      }

      // Update the request with main fields
      await query(
        `UPDATE po_requests 
         SET deliver_to = COALESCE($1, deliver_to), 
             payment_terms = COALESCE($2, payment_terms), 
             terms_conditions = COALESCE($3, terms_conditions),
             updated_at = NOW() 
         WHERE id = $4`,
        [deliver_to, payment_terms, terms_conditions, id]
      );

      res.json({ message: "PO Request updated successfully" });
    } catch (err) {
      console.error("PUT /api/po-requests/:id/items error:", err);
      res.status(500).json({ message: "Failed to update PO Request items" });
    }
  });

  // PATCH /api/po-requests/:id/status - Update PO Request status
  app.patch("/api/po-requests/:id/status", authMiddleware, requireRole('admin', 'software_team', 'purchase_team'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status } = req.body; // 'approved' or 'rejected'

      if (!status) {
        return res.status(400).json({ message: "Status is required" });
      }

      const result = await query(
        `UPDATE po_requests SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [status, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: "PO Request not found" });
      }

      res.json({ message: `PO Request ${status}`, poRequest: result.rows[0] });
    } catch (err) {
      console.error("PATCH /api/po-requests/:id/status error:", err);
      res.status(500).json({ message: "Failed to update PO Request status" });
    }
  });

  // POST /api/po-requests/:id/generate-po - Generate PO from Approved Request
  app.post("/api/po-requests/:id/generate-po", authMiddleware, requireRole('admin', 'purchase_team'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { vendorId, vendorName, itemsWithRates } = req.body;
      const user = (req as any).user;

      // 1. Validate PO Request
      const reqResult = await query(`SELECT * FROM po_requests WHERE id = $1`, [id]);
      if (reqResult.rows.length === 0) {
        return res.status(404).json({ message: "PO Request not found" });
      }
      const poReq = reqResult.rows[0];

      if (poReq.status !== 'approved') {
        return res.status(400).json({ message: "Only approved PO requests can generate POs" });
      }

      if (!vendorId) {
        return res.status(400).json({ message: "Vendor ID is required" });
      }

      // 2. Generate PO Number
      const poCountRes = await query(`SELECT COUNT(*) FROM purchase_orders`);
      const poNumStr = String(parseInt(poCountRes.rows[0].count) + 1).padStart(3, "0");
      const generatedPoNumber = `Anx-${new Date().getFullYear()}-${poNumStr}`;

      // 3. Calculate Totals based on matching selected rates
      let subtotal = 0;
      const finalItems = [];

      for (const item of itemsWithRates) { // Expecting { poRequestItemId, rate, qty }
        const itemRes = await query(`SELECT * FROM po_request_items WHERE id = $1 AND po_request_id = $2`, [item.poRequestItemId, id]);
        if (itemRes.rows.length > 0) {
          const dbItem = itemRes.rows[0];
          const qty = item.qty || dbItem.qty;
          const rate = item.rate || 0;
          const amount = qty * rate;
          subtotal += amount;

          finalItems.push({
            material_id: dbItem.material_id, // Ensure material_id is carried forward
            item: dbItem.item,
            description: dbItem.remarks || '',
            unit: dbItem.unit,
            qty: qty,
            rate: rate,
            amount: amount
          });
        }
      }

      // 4. Create PO (Draft initially or Generated directly?)
      const poCreateRes = await query(
        `INSERT INTO purchase_orders 
         (po_number, project_id, project_name, vendor_id, vendor_name, subtotal, tax, total, status, requested_by) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [generatedPoNumber, poReq.project_id, poReq.project_name, vendorId, vendorName || vendorId, subtotal, 0, subtotal, 'draft', poReq.requester_name]
      );
      const newPo = poCreateRes.rows[0];

      // 5. Create PO Items
      for (const fItem of finalItems) {
        await query(
          `INSERT INTO purchase_order_items 
           (po_id, material_id, item, description, unit, qty, original_qty, rate, amount, qty_modified) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [newPo.id, fItem.material_id, fItem.item, fItem.description, fItem.unit, fItem.qty, fItem.qty, fItem.rate, fItem.amount, false]
        );
      }

      // 6. Update PO Request Status
      await query(`UPDATE po_requests SET status = 'po_generated', updated_at = NOW() WHERE id = $1`, [id]);

      res.status(201).json({ message: "Purchase Order generated successfully", po: newPo });
    } catch (err) {
      console.error("POST /api/po-requests/:id/generate-po error:", err);
      res.status(500).json({ message: "Failed to generate PO from request" });
    }
  });


  // POST /api/purchase-orders/:id/revise - Revise PO Items and Qty
  app.post("/api/purchase-orders/:id/revise", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { items, reason, deletedItems, delivery_date, shippingAddress, paymentTerms, vendor_id, vendor_name } = req.body;
      const user = (req as any).user;

      // 1. Get existing PO
      const poRes = await query(`SELECT * FROM purchase_orders WHERE id = $1`, [id]);
      if (poRes.rows.length === 0) {
        return res.status(404).json({ message: "Purchase Order not found" });
      }
      const existingPo = poRes.rows[0];

      // 2. Generate new PO Number (-R1, -R2, etc)
      let revCount = 1;
      let defCount = 1;
      let originalPoNumber = existingPo.po_number;
      let basePoNumber = originalPoNumber;

      const revMatch = basePoNumber.match(/-R(\d+)$/);
      if (revMatch) {
        revCount = parseInt(revMatch[1], 10) + 1;
        basePoNumber = basePoNumber.replace(/-R\d+$/, "");
      }
      const newPoNumber = `${basePoNumber}-R${revCount}`;

      // Look up existing deferred POs for numbering
      const defRes = await query(`SELECT boq_number FROM (SELECT po_number as boq_number FROM purchase_orders WHERE po_number LIKE $1) as tmp ORDER BY boq_number DESC LIMIT 1`, [`${basePoNumber}-Deferred%`]);
      if (defRes.rows.length > 0) {
        const dMatch = defRes.rows[0].boq_number.match(/-Deferred(\d+)$/);
        if (dMatch) defCount = parseInt(dMatch[1], 10) + 1;
      }


      // 3. Determine new status
      let hasIncrease = false;
      const existingItemsRes = await query(`SELECT * FROM purchase_order_items WHERE po_id = $1`, [id]);
      const existingItems = existingItemsRes.rows;

      for (const item of items) {
        const original = existingItems.find((i: any) => i.id === item.id);
        if (original && parseFloat(item.qty) > parseFloat(original.qty)) {
          hasIncrease = true;
          break;
        }
      }

      const newStatus = "draft";

      // Auto-generate Change Summary
      let changeSummary = "Change Log:\n";
      for (const item of items) {
        const original = existingItems.find((i: any) =>
          (i.item || i.item_name) === (item.item || item.item_name) && i.description === item.description
        );
        if (original) {
          const oldQty = parseFloat(original.qty);
          const newQty = parseFloat(item.qty);
          if (oldQty !== newQty) {
            changeSummary += `- ${item.item || item.item_name}: Qty changed from ${oldQty} to ${newQty}\n`;
          }
        } else {
          changeSummary += `- Added new item: ${item.item || item.item_name} (Qty: ${item.qty})\n`;
        }
      }

      if (deletedItems && deletedItems.length > 0) {
        for (const ditem of deletedItems) {
          changeSummary += `- Removed item: ${ditem.item || ditem.item_name} (Qty: ${ditem.qty}) -> Moved to Deferred PO\n`;
        }
      }

      const finalComments = `${reason ? reason + "\n\n" : ""}${changeSummary}`;
      const approvalComments = hasIncrease ? finalComments : (reason ? finalComments : existingPo.approval_comments);

      // Calculate new total
      let totalAmount = 0;
      for (const item of items) {
        totalAmount += parseFloat(item.amount) || (parseFloat(item.qty) * parseFloat(item.rate)) || 0;
      }

      const finalVendorId = vendor_id || existingPo.vendor_id;
      const finalVendorName = vendor_name || existingPo.vendor_name;

      console.log(`[revise-po] Attempting revision for PO ${id}. New PO Number: ${newPoNumber}. Vendor: ${finalVendorName}`);

      // 4. Create new PO
      const newPoRes = await query(
        `INSERT INTO purchase_orders (po_number, project_id, project_name, vendor_id, vendor_name, subtotal, total, status, requested_by, approval_comments, delivery_date, shipping_address, payment_terms) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [newPoNumber, existingPo.project_id, existingPo.project_name, finalVendorId, finalVendorName, totalAmount, totalAmount, newStatus, existingPo.requested_by, approvalComments, delivery_date || null, shippingAddress || null, paymentTerms || null]
      );
      const newPo = newPoRes.rows[0];
      console.log(`[revise-po] New PO created with ID: ${newPo.id}`);

      // 5. Insert new items
      for (const item of items) {
        // Find if this item existed in the previous PO
        const originalItem = existingItems.find((ei: any) =>
          (ei.id === item.id) ||
          (ei.material_id && ei.material_id === item.material_id) ||
          ((ei.item || ei.item_name) === (item.item || item.item_name) && ei.description === item.description)
        );

        let originalQty = parseFloat(item.qty);
        let qtyModified = false;

        if (originalItem) {
          // Carry forward the FIRST original_qty recorded in the chain
          originalQty = parseFloat(originalItem.original_qty || originalItem.qty);
          // qty_modified is true if current qty differs from original_qty
          qtyModified = parseFloat(item.qty) !== originalQty;
        }

        await query(
          `INSERT INTO purchase_order_items (po_id, material_id, item, description, unit, qty, original_qty, rate, amount, hsn_code, sac_code, qty_modified) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [newPo.id, item.material_id || item.id || null, item.item || item.item_name, item.description || null, item.unit || null, item.qty, originalQty, item.rate, item.amount, item.hsn_code || null, item.sac_code || null, qtyModified]
        );
      }

      // 5.5 Handle deleted items (Defer them)
      if (deletedItems && deletedItems.length > 0) {
        const deferredPoNumber = `${basePoNumber}-Deferred${defCount}`;
        let deferredTotal = 0;
        for (const ditem of deletedItems) {
          deferredTotal += parseFloat(ditem.amount) || (parseFloat(ditem.qty || 0) * parseFloat(ditem.rate || 0)) || 0;
        }

        const defPoRes = await query(
          `INSERT INTO purchase_orders (po_number, project_id, project_name, vendor_id, vendor_name, subtotal, total, status, requested_by, approval_comments) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
          [deferredPoNumber, existingPo.project_id, existingPo.project_name, finalVendorId, finalVendorName, deferredTotal, deferredTotal, "draft", existingPo.requested_by, "Items deferred due to budget constraints during revision."]
        );
        const defPo = defPoRes.rows[0];

        for (const ditem of deletedItems) {
          const originalItem = existingItems.find((ei: any) => ei.id === ditem.id);
          const originalQty = originalItem ? parseFloat(originalItem.original_qty || originalItem.qty) : parseFloat(ditem.qty);
          const qtyModified = originalItem ? (parseFloat(ditem.qty) !== originalQty) : false;

          await query(
            `INSERT INTO purchase_order_items (po_id, material_id, item, description, unit, qty, original_qty, rate, amount, hsn_code, sac_code, qty_modified) 
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [defPo.id, ditem.material_id || ditem.id || null, ditem.item || ditem.item_name, ditem.description || null, ditem.unit || null, ditem.qty, originalQty, ditem.rate, ditem.amount, ditem.hsn_code || null, ditem.sac_code || null, qtyModified]
          );
        }
      }

      // 6. Update old PO status
      await query(`UPDATE purchase_orders SET status = 'revised', updated_at = NOW() WHERE id = $1`, [id]);

      res.status(201).json({ message: "PO Revised successfully", newPo });
    } catch (err) {
      console.error("POST /api/purchase-orders/:id/revise error:", err);
      res.status(500).json({ message: "Failed to revise PO" });
    }
  });

  // GET /api/purchase-orders - List all purchase orders (with optional status filter)
  app.get("/api/purchase-orders", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { status } = req.query;
      const user = (req as any).user;
      let queryStr = `
        SELECT po.*, po.total as total_amount, p.name as project_name,
        COALESCE(po.vendor_name, s.name, po.vendor_id) as vendor_name,
        COALESCE(po.version_number::TEXT, (
          SELECT CAST(v.version_number AS TEXT)
          FROM boq_versions v
          WHERE v.id::TEXT = po.version_id::TEXT
          LIMIT 1
        )) as version_number
        FROM purchase_orders po
        LEFT JOIN boq_projects p ON po.project_id = p.id
        LEFT JOIN shops s ON(po.vendor_id:: text = s.id:: text OR TRIM(s.name) = TRIM(po.vendor_name))
        `;
      const params: any[] = [];
      const whereConditions: string[] = [];

      if (status) {
        whereConditions.push(`po.status = $${params.length + 1}`);
        params.push(status);
      }

      const privilegedRoles = ['admin', 'software_team', 'purchase_team', 'pre_sales', 'product_manager', 'finance_team'];
      if (!privilegedRoles.includes(user.role)) {
        whereConditions.push(`po.project_id IN (SELECT project_id FROM user_project_permissions WHERE user_id = $${params.length + 1})`);
        params.push(user.id);
      }

      if (whereConditions.length > 0) {
        queryStr += ` WHERE ` + whereConditions.join(" AND ");
      }

      queryStr += ` ORDER BY po.created_at DESC`;

      const result = await query(queryStr, params);
      res.json({ purchaseOrders: result.rows });
    } catch (err) {
      console.error("GET /api/purchase-orders error:", err);
      res.status(500).json({ message: "Failed to load purchase orders" });
    }
  });

  // GET /api/purchase-orders/:id - Get a single purchase order and its items
  app.get("/api/purchase-orders/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Fetch the PO header with detailed shop information
      const poResult = await query(
        `SELECT po.*, po.total as total_amount,
        p.name as project_name, p.client as project_client, p.location as project_location,
        COALESCE(po.vendor_name, s.name, po.vendor_id) as vendor_name,
        COALESCE(po.version_number, (
          SELECT CAST(v.version_number AS TEXT)
          FROM boq_versions v
          WHERE v.project_id = po.project_id AND v.created_at <= po.created_at
          ORDER BY v.created_at DESC
          LIMIT 1
        )) as version_number,
        COALESCE(po.version_id, (
          SELECT CAST(v.id AS TEXT)
          FROM boq_versions v
          WHERE v.project_id = po.project_id AND v.created_at <= po.created_at
          ORDER BY v.created_at DESC
          LIMIT 1
        )) as version_id,
        s.location as vendor_location, s.new_location as vendor_new_location, s.city as vendor_city,
        s.state as vendor_state, s.pincode as vendor_pincode, s.gstno as vendor_gstin,
        s.contactnumber as vendor_phone, s.phonecountrycode as vendor_phone_code,
        s.terms_and_conditions as vendor_terms
         FROM purchase_orders po
         LEFT JOIN boq_projects p ON po.project_id = p.id
         LEFT JOIN shops s ON(po.vendor_id:: text = s.id:: text OR TRIM(s.name) = TRIM(po.vendor_name))
         WHERE po.id = $1`,
        [id]
      );

      if (poResult.rows.length === 0) {
        res.status(404).json({ message: "Purchase order not found" });
        return;
      }

      // Fetch the PO items
      const itemsResult = await query(
        `SELECT * FROM purchase_order_items WHERE po_id = $1 ORDER BY created_at ASC`,
        [id]
      );

      // Fetch Related PO Versions
      const currentPo = poResult.rows[0];
      let fullPoNumber = currentPo.po_number;
      let basePoNumber = fullPoNumber.split('-R')[0].split('-Deferred')[0].split('-R')[0].trim();

      const relatedPosResult = await query(
        `SELECT id, po_number, status, total, approval_comments, created_at 
         FROM purchase_orders 
         WHERE (TRIM(po_number) ILIKE $1 OR TRIM(po_number) ILIKE $4) 
           AND id::text != $2::text
           AND project_id = $3
         ORDER BY created_at DESC`,
        [`${basePoNumber}%`, id, currentPo.project_id, `%${basePoNumber}%`]
      );

      console.log(`[debug-related-po] Base: ${basePoNumber}, Current: ${fullPoNumber}, Project: ${currentPo.project_id}, Found: ${relatedPosResult.rows.length}`);

      // Fetch Parent PO Items for Change Tracking
      let parentItems: any[] = [];
      const revMatch = fullPoNumber.match(/-R(\d+)$/);
      if (revMatch) {
        const revNum = parseInt(revMatch[1], 10);
        let parentNumber = revNum === 1
          ? fullPoNumber.replace(/-R\d+$/, "")
          : fullPoNumber.replace(/-R\d+$/, `-R${revNum - 1}`);

        const parentRes = await query(
          `SELECT id FROM purchase_orders WHERE po_number = $1 AND project_id = $2 LIMIT 1`,
          [parentNumber, currentPo.project_id]
        );

        if (parentRes.rows.length > 0) {
          const pItemsResult = await query(
            `SELECT * FROM purchase_order_items WHERE po_id = $1`,
            [parentRes.rows[0].id]
          );
          parentItems = pItemsResult.rows;
        }
      }

      // Fetch BOM Items for original quantity reference
      let bomItems: any[] = [];
      if (currentPo.version_id) {
        const bomResult = await query(
          `SELECT * FROM boq_items WHERE version_id = $1`,
          [currentPo.version_id]
        );

        for (const boqItem of bomResult.rows) {
          const tableData = typeof boqItem.table_data === 'string' ? JSON.parse(boqItem.table_data) : boqItem.table_data;

          if (tableData.materialLines && tableData.targetRequiredQty !== undefined) {
            const base = Number(tableData.baseRequiredQty || tableData.configBasis?.baseRequiredQty || 1);
            const target = Number(tableData.targetRequiredQty) || 0;

            if (Array.isArray(tableData.materialLines)) {
              tableData.materialLines.forEach((l: any) => {
                const baseQty = Number(l.baseQty || l.qty || 0);
                const applyR = l.apply_rounding !== undefined ? Boolean(l.apply_rounding) : true;
                const roundedQtyAtBasis = applyR ? Math.ceil(baseQty) : baseQty;
                const perUnitQty = l.perUnitQty !== undefined ? Number(l.perUnitQty) : (base > 0 ? roundedQtyAtBasis / base : 0);
                const theoreticalQty = perUnitQty * target;

                const itemName = l.name || l.material_name;
                const desc = l.description || "";
                const existing = bomItems.find(i => i.item === itemName && i.description === desc);
                if (existing) {
                  existing.qty += theoreticalQty;
                } else {
                  bomItems.push({
                    item: itemName,
                    description: desc,
                    qty: theoreticalQty,
                    unit: l.unit
                  });
                }
              });
            }

            if (Array.isArray(tableData.step11_items)) {
              tableData.step11_items.filter((it: any) => it.manual).forEach((it: any) => {
                const itemName = it.item || it.title;
                const desc = it.description || "";
                const qty = Number(it.qty || 0);

                const existing = bomItems.find(i => i.item === itemName && i.description === desc);
                if (existing) {
                  existing.qty += qty;
                } else {
                  bomItems.push({
                    item: itemName,
                    description: desc,
                    qty: qty,
                    unit: it.unit
                  });
                }
              });
            }
          }
        }
      }

      res.json({
        purchaseOrder: currentPo,
        items: itemsResult.rows,
        relatedPos: relatedPosResult.rows,
        parentItems: parentItems,
        bomItems: bomItems
      });
    } catch (err) {
      console.error("GET /api/purchase-orders/:id error:", err);
      res.status(500).json({ message: "Failed to load purchase order details" });
    }
  });

  // PATCH /api/purchase-orders/:id/status - Update purchase order status
  app.patch("/api/purchase-orders/:id/status", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status, delivery_date, dc_number, dc_date } = req.body;

      const setFields: string[] = [];
      const params: any[] = [];
      let paramCount = 1;

      if (status !== undefined) {
        setFields.push(`status = $${paramCount++}`);
        params.push(status);
      }
      if (delivery_date !== undefined) {
        setFields.push(`delivery_date = $${paramCount++}`);
        params.push(delivery_date || null);
      }
      if (dc_number !== undefined) {
        setFields.push(`dc_number = $${paramCount++}`);
        params.push(dc_number || null);
      }
      if (dc_date !== undefined) {
        setFields.push(`dc_date = $${paramCount++}`);
        params.push(dc_date || null);
      }

      if (setFields.length === 0) {
        return res.status(400).json({ message: "No fields to update" });
      }

      params.push(id);
      const result = await query(
        `UPDATE purchase_orders SET ${setFields.join(', ')}, updated_at = NOW() WHERE id = $${paramCount} RETURNING * `,
        params
      );

      if (result.rows.length === 0) {
        res.status(404).json({ message: "Purchase order not found" });
        return;
      }

      res.json({ purchaseOrder: result.rows[0] });
    } catch (err) {
      console.error("PATCH /api/purchase-orders/:id/status error:", err);
      res.status(500).json({ message: "Failed to update purchase order status" });
    }
  });

  // POST /api/purchase-orders/:id/approve - Approve or reject a purchase order
  app.post("/api/purchase-orders/:id/approve", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { approve, comment } = req.body;

      const status = approve ? 'approved' : 'rejected';

      const result = await query(
        `UPDATE purchase_orders 
         SET status = $1, approval_comments = $2, updated_at = NOW() 
         WHERE id = $3 RETURNING * `,
        [status, comment || null, id]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ message: "Purchase order not found" });
        return;
      }

      res.json({ message: `Purchase order ${status} successfully`, purchaseOrder: result.rows[0] });
    } catch (err) {
      console.error("POST /api/purchase-orders/:id/approve error:", err);
      res.status(500).json({ message: "Failed to process purchase order approval" });
    }
  });

  // DELETE /api/purchase-orders/:id - Delete a purchase order and its items
  app.delete("/api/purchase-orders/:id", authMiddleware, async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      await query("BEGIN");
      try {
        // Remove child items first
        await query("DELETE FROM purchase_order_items WHERE po_id = $1", [id]);
        const result = await query("DELETE FROM purchase_orders WHERE id = $1 RETURNING id", [id]);
        if (result.rows.length === 0) {
          await query("ROLLBACK");
          res.status(404).json({ message: "Purchase order not found" });
          return;
        }
        await query("COMMIT");
        res.json({ message: "Purchase order deleted successfully" });
      } catch (err) {
        await query("ROLLBACK");
        throw err;
      }
    } catch (err) {
      console.error("DELETE /api/purchase-orders/:id error:", err);
      res.status(500).json({ message: "Failed to delete purchase order" });
    }
  });

  // GET /api/purchase-orders/check-material-increases - Check if materials have increased qty in approved POs
  app.get("/api/purchase-orders/check-material-increases", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { materialIds } = req.query;
      if (!materialIds || typeof materialIds !== 'string') {
        return res.status(400).json({ message: "materialIds query parameter is required" });
      }

      const ids = materialIds.split(',').filter(id => id.trim());
      if (ids.length === 0) return res.json({ increases: {} });

      // Query for the latest approved PO item for each material
      // We exclude 'Deferred' POs as they are usually budget-split, not increases
      const result = await query(
        `SELECT DISTINCT ON (material_id) 
           material_id, qty, original_qty, po_id, p.po_number, p.updated_at
         FROM purchase_order_items poi
         JOIN purchase_orders p ON poi.po_id = p.id
         WHERE material_id = ANY($1) 
           AND p.status = 'approved'
           AND poi.qty_modified = true
           AND (poi.is_synced = false OR poi.is_synced IS NULL)
           AND p.po_number NOT LIKE '%Deferred%'
         ORDER BY material_id, p.updated_at DESC`,
        [ids]
      );

      const increases: Record<string, any> = {};
      result.rows.forEach((row: any) => {
        increases[row.material_id] = {
          qty: parseFloat(row.qty),
          originalQty: parseFloat(row.original_qty || row.qty),
          poNumber: row.po_number,
          poId: row.po_id,
          updatedAt: row.updated_at
        };
      });

      res.json({ increases });
    } catch (err) {
      console.error("GET /api/purchase-orders/check-material-increases error:", err);
      res.status(500).json({ message: "Failed to check material increases" });
    }
  });

  // POST /api/products/update-template-qty - Update product template with new quantity
  app.post("/api/products/update-template-qty", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { productId, materialId, newQty, originalQty, poId } = req.body;
      if (!productId || !materialId || newQty === undefined || originalQty === undefined) {
        return res.status(400).json({ message: "productId, materialId, newQty, and originalQty are required" });
      }

      const factor = parseFloat(newQty) / parseFloat(originalQty);
      if (isNaN(factor) || factor <= 0) {
        return res.status(400).json({ message: "Invalid quantity values for calculation" });
      }

      await query("BEGIN");
      try {
        // 1. Update product_step3_config_items
        const configRes = await query(`SELECT id FROM product_step3_config WHERE product_id = $1 LIMIT 1`, [productId]);
        if (configRes.rows.length > 0) {
          const configId = configRes.rows[0].id;
          await query(
            `UPDATE product_step3_config_items 
             SET qty = qty * $1, base_qty = base_qty * $1
             WHERE step3_config_id = $2 AND material_id = $3`,
            [factor, configId, materialId]
          );
        }

        // 2. Update step11_product_items (actual items in specific BOM versions)
        // Find the latest version for this product
        const step11Res = await query(`SELECT id FROM step11_products WHERE product_id = $1 ORDER BY updated_at DESC LIMIT 1`, [productId]);
        if (step11Res.rows.length > 0) {
          const step11Id = step11Res.rows[0].id;
          await query(
            `UPDATE step11_product_items 
             SET qty = qty * $1
             WHERE step11_product_id = $2 AND material_id = $3`,
            [factor, step11Id, materialId]
          );
        }

        // 3. Mark the PO item as synced to avoid duplicate prompts
        if (poId) {
          await query(
            `UPDATE purchase_order_items 
             SET is_synced = true 
             WHERE po_id = $1 AND material_id = $2`,
            [poId, materialId]
          );
        }

        await query("COMMIT");
        res.json({ message: "Product template and BOM quantities updated successfully", factor });
      } catch (err) {
        await query("ROLLBACK");
        throw err;
      }
    } catch (err) {
      console.error("POST /api/products/update-template-qty error:", err);
      res.status(500).json({ message: "Failed to update product template" });
    }
  });

  // ================= CHATBOT =================
  app.post("/api/bot-query", authMiddleware, async (req, res) => {
    try {
      const q = (req.body.query || "").toLowerCase().trim();
      let answer = "I'm sorry, I didn't understand that. You can ask me about material prices, availability, or products (e.g., 'price of MDF', 'do we have hinges', 'list restroom products').";

      // 1. HELP / GUIDE
      if (q.match(/help|guide|what can you do|how to use/i)) {
        answer = `**I'm your Assistant Bot!** I can help you find information quickly.

**Try asking me:**
- 💰 **Prices**: "Price of MDF 18mm"
- 📦 **Stock**: "Do we have hinges?"
- 📂 **Categories**: "List all categories"
- 🏗️ **Projects**: "How many projects?"
- 🏢 **Vendors**: "Info for Mohan Electricals"`;
      }
      // 2. PROJECT COUNT / LIST
      else if (q.match(/how many projects|list projects|active projects|show projects/i)) {
        const r = await query(`SELECT COUNT(*) as count FROM boq_projects`);
        const list = await query(`SELECT name FROM boq_projects ORDER BY created_at DESC LIMIT 5`);
        answer = `We have **${r.rows[0].count} total projects**.

**Recent Projects:**
${list.rows.map((row: any) => `- ${row.name}`).join('\n')}`;
      }
      // 3. CATEGORY LISTING
      else if (q.match(/list categories|show categories|what categories|all categories/i)) {
        const r = await query(`SELECT name FROM material_categories ORDER BY name ASC`);
        answer = `**Material Categories:**\n${r.rows.map((row: any) => `- ${row.name}`).join('\n')}`;
      }
      // 4. PRICE LOOKUP
      else if (q.match(/price of (.+)|cost of (.+)|rate of (.+)|how much is (.+)/i)) {
        const priceMatch = q.match(/price of (.+)|cost of (.+)|rate of (.+)|how much is (.+)/i);
        const matName = priceMatch![1] || priceMatch![2] || priceMatch![3] || priceMatch![4];
        const r = await query(`SELECT name, rate, unit FROM materials WHERE name ILIKE $1 LIMIT 5`, [`%${matName.trim()}%`]);
        if (r.rows.length === 0) {
          answer = `I couldn't find any material matching "**${matName}**".`;
        } else {
          answer = `**Price Results for "${matName}":**\n\n| Material | Rate | Unit |\n| :--- | :--- | :--- |\n` +
            r.rows.map((row: any) => `| ${row.name} | ₹${row.rate} | ${row.unit || 'unit'} |`).join('\n');
        }
      }
      // 5. VENDOR INFO
      else if (q.match(/info for (.+)|vendor (.+)|who is (.+)/i)) {
        const vendorMatch = q.match(/info for (.+)|vendor (.+)|who is (.+)/i);
        const vName = vendorMatch![1] || vendorMatch![2] || vendorMatch![3];
        const r = await query(`SELECT name, location, city, gstno FROM shops WHERE name ILIKE $1 LIMIT 1`, [`%${vName.trim()}%`]);
        if (r.rows.length === 0) {
          answer = `I couldn't find a vendor named "**${vName}**".`;
        } else {
          const v = r.rows[0];
          answer = `**Vendor Information:**
- **Name**: ${v.name}
- **Location**: ${v.location || 'N/A'}, ${v.city || ''}
- **GSTIN**: ${v.gstno || 'Not Provided'}`;
        }
      }
      // 6. AVAILABILITY
      else if (q.match(/do we have (.+)|is (.+) available|is (.+) in stock|any (.+)/i)) {
        const availMatch = q.match(/do we have (.+)|is (.+) available|is (.+) in stock|any (.+)/i);
        const matName = availMatch![1] || availMatch![2] || availMatch![3] || availMatch![4];
        const r = await query(`SELECT name FROM materials WHERE name ILIKE $1 LIMIT 5`, [`%${matName.trim()}%`]);
        if (r.rows.length === 0) {
          answer = `No, we don't have materials matching "**${matName}**" in our database.`;
        } else {
          answer = `**Yes, we have these matching items:**\n${r.rows.map((row: any) => '- ' + row.name).join('\n')}`;
        }
      }
      // 7. FALLBACK SEARCH
      else {
        const matRes = await query(`SELECT name, rate, unit FROM materials WHERE name ILIKE $1 LIMIT 3`, [`%${q}%`]);
        if (matRes.rows.length > 0) {
          answer = `I found these materials matching "**${q}**":\n${matRes.rows.map((row: any) => `- ${row.name} (₹${row.rate}/${row.unit || 'unit'})`).join('\n')}`;
        } else {
          const pRes = await query(`SELECT name FROM products WHERE name ILIKE $1 LIMIT 3`, [`%${q}%`]);
          if (pRes.rows.length > 0) {
            answer = `I found these products matching "**${q}**":\n${pRes.rows.map((p: any) => `- ${p.name}`).join('\n')}`;
          } else {
            answer = "I'm sorry, I couldn't find anything matching your query. Type **'help'** to see what I can do!";
          }
        }
      }

      res.json({ answer });
    } catch (err) {
      console.error("/api/bot-query error:", err);
      res.status(500).json({ error: "Failed to process query" });
    }
  });

  // ============================================================
  // DYNAMIC USER ACCESS CONTROL (Admin Panel Feature)
  // New tables only — no existing tables are touched.
  // ============================================================

  // Ensure user_management_registry table exists (entirely new)
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS user_management_registry (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(36) NOT NULL UNIQUE,
        is_custom_managed BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_umr_user_id ON user_management_registry(user_id)`);
  } catch (err: unknown) {
    console.warn('[dynamic-access] Could not create user_management_registry:', (err as any)?.message || err);
  }

  // Ensure user_sidebar_permissions table exists (entirely new)
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS user_sidebar_permissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(36) NOT NULL,
        module_name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, module_name)
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_usp_user_id ON user_sidebar_permissions(user_id)`);
  } catch (err: unknown) {
    console.warn('[dynamic-access] Could not create user_sidebar_permissions:', (err as any)?.message || err);
  }

  // Ensure user_project_permissions table exists
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS user_project_permissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(36) NOT NULL,
        project_id VARCHAR(100) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, project_id)
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_upp_user_id ON user_project_permissions(user_id)`);
  } catch (err: unknown) {
    console.warn('[dynamic-access] Could not create user_project_permissions:', (err as any)?.message || err);
  }

  // Ensure current_project_id column exists in users table
  try {
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS current_project_id VARCHAR(100)`);
  } catch (err: unknown) {
    console.warn('[dynamic-access] Could not add current_project_id to users:', (err as any)?.message || err);
  }

  /**
   * GET /api/admin/dynamic-access/pending-users
   * Returns users NOT yet in user_management_registry (excluding admin role)
   */
  app.get('/api/admin/dynamic-access/pending-users', authMiddleware, requireRole('admin'), async (_req: Request, res: Response) => {
    try {
      const result = await query(`
        SELECT u.id, u.username, u.role, u.full_name, u.created_at
        FROM users u
        WHERE u.role NOT IN ('admin', 'software_team')
          AND u.id NOT IN (SELECT user_id FROM user_management_registry)
        ORDER BY u.created_at DESC
      `);
      res.json({ users: result.rows });
    } catch (err) {
      console.error('/api/admin/dynamic-access/pending-users error:', err);
      res.status(500).json({ message: 'Failed to load pending users' });
    }
  });

  /**
   * GET /api/admin/dynamic-access/managed-users
   * Returns users already enrolled with their assigned modules
   */
  app.get('/api/admin/dynamic-access/managed-users', authMiddleware, requireRole('admin'), async (_req: Request, res: Response) => {
    try {
      const usersResult = await query(`
        SELECT u.id, u.username, u.role, u.full_name, umr.created_at as assigned_at
        FROM users u
        INNER JOIN user_management_registry umr ON umr.user_id = u.id
        ORDER BY umr.created_at DESC
      `);
      const users = usersResult.rows;
      // Attach permissions for each user
      for (const u of users) {
        const perms = await query(`SELECT module_name FROM user_sidebar_permissions WHERE user_id = $1 ORDER BY module_name`, [u.id]);
        u.modules = perms.rows.map((r: any) => r.module_name);

        const projects = await query(`SELECT project_id FROM user_project_permissions WHERE user_id = $1`, [u.id]);
        u.projects = projects.rows.map((r: any) => r.project_id);
      }
      res.json({ users });
    } catch (err) {
      console.error('/api/admin/dynamic-access/managed-users error:', err);
      res.status(500).json({ message: 'Failed to load managed users' });
    }
  });

  /**
   * GET /api/admin/dynamic-access/permissions/:userId
   * Returns the list of allowed module names for a specific user
   */
  app.get('/api/admin/dynamic-access/permissions/:userId', authMiddleware, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const result = await query(`SELECT module_name FROM user_sidebar_permissions WHERE user_id = $1 ORDER BY module_name`, [userId]);
      res.json({ modules: result.rows.map((r: any) => r.module_name) });
    } catch (err) {
      console.error('/api/admin/dynamic-access/permissions/:userId error:', err);
      res.status(500).json({ message: 'Failed to load permissions' });
    }
  });

  /**
   * POST /api/admin/dynamic-access/assign
   * Body: { userId: string, modules: string[] }
   * Saves permissions and registers the user into user_management_registry
   */
  app.post('/api/admin/dynamic-access/assign', authMiddleware, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const { userId, modules } = req.body as { userId: string; modules: string[] };
      if (!userId) {
        res.status(400).json({ message: 'userId is required' });
        return;
      }

      // Enroll user in management registry (upsert)
      await query(`
        INSERT INTO user_management_registry (user_id, is_custom_managed)
        VALUES ($1, TRUE)
        ON CONFLICT (user_id) DO NOTHING
      `, [userId]);

      // Delete existing permissions then insert new ones
      await query(`DELETE FROM user_sidebar_permissions WHERE user_id = $1`, [userId]);

      if (Array.isArray(modules) && modules.length > 0) {
        for (const mod of modules) {
          if (mod && typeof mod === 'string') {
            await query(`
              INSERT INTO user_sidebar_permissions (user_id, module_name)
              VALUES ($1, $2)
              ON CONFLICT (user_id, module_name) DO NOTHING
            `, [userId, mod]);
          }
        }
      }

      // Handle projects if provided
      const { projects } = req.body as { projects?: string[] };
      if (projects !== undefined) {
        await query(`DELETE FROM user_project_permissions WHERE user_id = $1`, [userId]);
        if (Array.isArray(projects) && projects.length > 0) {
          for (const pid of projects) {
            if (pid && typeof pid === 'string') {
              await query(`
                INSERT INTO user_project_permissions (user_id, project_id)
                VALUES ($1, $2)
                ON CONFLICT (user_id, project_id) DO NOTHING
              `, [userId, pid]);
            }
          }
        }
      }

      res.json({ message: 'Permissions saved successfully' });
    } catch (err) {
      console.error('/api/admin/dynamic-access/assign error:', err);
      res.status(500).json({ message: 'Failed to save permissions' });
    }
  });

  /**
   * GET /api/my-permissions
   * Returns the current logged-in user's custom module list (if custom managed)
   * Returns { isCustomManaged: false } if user is not under custom management
   */
  app.get('/api/my-permissions', authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }
      const userId = req.user.id;
      const registry = await query(`SELECT id FROM user_management_registry WHERE user_id = $1`, [userId]);
      if (registry.rows.length === 0) {
        const privilegedRoles = ['admin', 'software_team', 'purchase_team', 'pre_sales', 'product_manager', 'finance_team'];
        const projectsRes = privilegedRoles.includes(req.user.role)
          ? await query(`SELECT id as project_id FROM boq_projects`)
          : await query(`SELECT project_id FROM user_project_permissions WHERE user_id = $1`, [userId]);
        const userRes = await query(`SELECT current_project_id FROM users WHERE id = $1`, [userId]);
        res.json({
          isCustomManaged: false,
          modules: [],
          projects: projectsRes.rows.map((r: any) => r.project_id),
          currentProjectId: userRes.rows[0]?.current_project_id || null
        });
        return;
      }
      const perms = await query(`SELECT module_name FROM user_sidebar_permissions WHERE user_id = $1 ORDER BY module_name`, [userId]);
      const privilegedRoles = ['admin', 'software_team', 'purchase_team', 'pre_sales', 'product_manager', 'finance_team'];
      const projectsRes = privilegedRoles.includes(req.user.role)
        ? await query(`SELECT id as project_id FROM boq_projects`)
        : await query(`SELECT project_id FROM user_project_permissions WHERE user_id = $1`, [userId]);
      const userRes = await query(`SELECT current_project_id FROM users WHERE id = $1`, [userId]);

      res.json({
        isCustomManaged: true,
        modules: perms.rows.map((r: any) => r.module_name),
        projects: projectsRes.rows.map((r: any) => r.project_id),
        currentProjectId: userRes.rows[0]?.current_project_id || null
      });
    } catch (err) {
      console.error('/api/my-permissions error:', err);
      res.status(500).json({ message: 'Failed to load permissions' });
    }
  });

  /**
   * POST /api/set-active-project
   * Saves the current active project for the user
   */
  app.post('/api/set-active-project', authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
      const { projectId } = req.body;
      const userId = req.user.id;

      // Verify that the user has permission for this project (unless admin/software_team/purchase_team/pre_sales/product_manager)
      const privilegedRoles = ['admin', 'software_team', 'purchase_team', 'pre_sales', 'product_manager', 'finance_team'];

      if (!privilegedRoles.includes(req.user.role)) {
        const check = await query(`SELECT 1 FROM user_project_permissions WHERE user_id = $1 AND project_id = $2`, [userId, projectId]);
        if (check.rows.length === 0 && projectId !== null) {
          return res.status(403).json({ message: 'No permission for this project' });
        }
      }

      await query(`UPDATE users SET current_project_id = $1 WHERE id = $2`, [projectId, userId]);
      res.json({ message: 'Active project updated', currentProjectId: projectId });
    } catch (err) {
      console.error('/api/set-active-project error:', err);
      res.status(500).json({ message: 'Failed to update active project' });
    }
  });

  // ==================== SITE REPORT ROUTES ====================

  // GET /api/site-reports - List all reports
  app.get("/api/site-reports", authMiddleware, async (req: Request, res: Response) => {
    try {
      const result = await query("SELECT * FROM site_reports ORDER BY report_date DESC");
      res.json({ reports: result.rows });
    } catch (err) {
      console.error("GET /api/site-reports error:", err);
      res.status(500).json({ message: "Failed to fetch site reports" });
    }
  });



  // POST /api/site-reports - Create a new report (shell)
  app.post("/api/site-reports", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { project_id, project_name, report_date, summary, tasks } = req.body;
      const userId = (req as any).user?.id;

      await query("BEGIN");

      const reportResult = await query(
        `INSERT INTO site_reports (project_id, project_name, user_id, report_date, summary, status)
         VALUES ($1, $2, $3, $4, $5, 'draft')
         RETURNING *`,
        [project_id, project_name, userId, report_date || new Date(), summary]
      );
      const report = reportResult.rows[0];

      if (tasks && Array.isArray(tasks)) {
        for (const task of tasks) {
          const taskRes = await query(
            `INSERT INTO site_report_tasks (site_report_id, item_type, item_id, item_name, task_description, completion_percentage, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [report.id, task.item_type || 'item', task.item_id, task.item_name, task.task_description, task.completion_percentage || 0, task.status || 'In Progress']
          );
          const taskId = taskRes.rows[0].id;

          if (task.labour && Array.isArray(task.labour)) {
            for (const l of task.labour) {
              await query(
                `INSERT INTO site_report_labours (task_id, labour_name, count, in_time, out_time)
                 VALUES ($1, $2, $3, $4, $5)`,
                [taskId, l.labour_name, l.count || 1, l.in_time, l.out_time]
              );
            }
          }

          if (task.issues && Array.isArray(task.issues)) {
            for (const issue of task.issues) {
              await query(
                `INSERT INTO site_report_issues (task_id, description)
                 VALUES ($1, $2)`,
                [taskId, issue.description]
              );
            }
          }

          if (task.materials && Array.isArray(task.materials)) {
            for (const mat of task.materials) {
              await query(
                `INSERT INTO site_report_materials (task_id, material_name, quantity, unit)
                 VALUES ($1, $2, $3, $4)`,
                [taskId, mat.material_name || '', mat.quantity || 1, mat.unit || '']
              );
            }
          }

          if (task.media && Array.isArray(task.media)) {
            for (const m of task.media) {
              const fileUrl = m.file_url || m.url || m.fileUrl;
              const fileType = m.file_type || m.type || 'image/jpeg';
              const fileName = m.file_name || m.name || 'image';

              if (fileUrl) {
                await query(
                  `INSERT INTO site_report_media (task_id, file_url, file_type, file_name)
                   VALUES ($1, $2, $3, $4)`,
                  [taskId, fileUrl, fileType, fileName]
                );
              }
            }
          }
        }
      }

      await query("COMMIT");
      res.status(201).json({ report });
    } catch (err) {
      await query("ROLLBACK");
      console.error("POST /api/site-reports error:", err);
      res.status(500).json({ message: "Failed to create site report" });
    }
  });

  // GET /api/site-reports/:id - Get report details with tasks
  app.get("/api/site-reports/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      console.log(`[DEBUG] Fetching report details for ID: ${id}`);

      const reportRes = await query("SELECT * FROM site_reports WHERE id = $1", [id]);
      if (reportRes.rows.length === 0) {
        console.log(`[DEBUG] Report ${id} not found`);
        return res.status(404).json({ message: "Report not found" });
      }
      const report = reportRes.rows[0];

      const tasksRes = await query("SELECT * FROM site_report_tasks WHERE site_report_id = $1", [id]);
      const tasks = tasksRes.rows.map((t: any) => ({
        ...t,
        itemName: t.item_name,
        taskDescription: t.task_description,
        completionPercentage: t.completion_percentage
      }));
      console.log(`[DEBUG] Found ${tasks.length} tasks for report ${id}`);

      for (const task of tasks) {
        const labourRes = await query("SELECT * FROM site_report_labours WHERE task_id = $1", [task.id]);
        task.labour = labourRes.rows.map((l: any) => ({
          ...l,
          labourName: l.labour_name,
          inTime: l.in_time,
          outTime: l.out_time
        }));

        const mediaRes = await query("SELECT * FROM site_report_media WHERE task_id = $1", [task.id]);
        task.media = mediaRes.rows.map((m: any) => ({
          ...m,
          fileUrl: m.file_url,
          fileType: m.file_type,
          fileName: m.file_name
        }));

        const issuesRes = await query("SELECT * FROM site_report_issues WHERE task_id = $1", [task.id]);
        task.issues = issuesRes.rows;

        const materialsRes = await query("SELECT * FROM site_report_materials WHERE task_id = $1", [task.id]);
        task.materials = materialsRes.rows.map((m: any) => ({
          ...m,
          materialName: m.material_name,
        }));

        console.log(`[DEBUG] Task ${task.id} has ${task.labour.length} labour entries, ${task.issues.length} issues, and ${task.materials.length} materials`);
      }

      report.tasks = tasks;
      res.json({ report });
    } catch (err) {
      console.error("GET /api/site-reports/:id error:", err);
      res.status(500).json({ message: "Failed to fetch report details" });
    }
  });

  // POST /api/site-reports/:id/tasks - Add a task to a report
  app.post("/api/site-reports/:id/tasks", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { item_type, item_id, item_name, task_description, completion_percentage, status } = req.body;

      const result = await query(
        `INSERT INTO site_report_tasks (site_report_id, item_type, item_id, item_name, task_description, completion_percentage, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [id, item_type, item_id, item_name, task_description, completion_percentage || 0, status || 'In Progress']
      );

      res.status(201).json({ task: result.rows[0] });
    } catch (err) {
      console.error("POST /api/site-reports/tasks error:", err);
      res.status(500).json({ message: "Failed to add task to site report" });
    }
  });

  // POST /api/site-report-tasks/:id/labour - Add labour to a task
  app.post("/api/site-report-tasks/:id/labour", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { labour_name, count, in_time, out_time } = req.body;

      const result = await query(
        `INSERT INTO site_report_labours (task_id, labour_name, count, in_time, out_time)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [id, labour_name, count || 1, in_time, out_time]
      );

      res.status(201).json({ labour: result.rows[0] });
    } catch (err) {
      console.error("POST /api/site-report-tasks/:id/labour error:", err);
      res.status(500).json({ message: "Failed to add labour entry" });
    }
  });

  // POST /api/site-report-tasks/:id/media - Add media to a task
  app.post("/api/site-report-tasks/:id/media", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { file_url, file_type, file_name } = req.body;

      const result = await query(
        `INSERT INTO site_report_media (task_id, file_url, file_type, file_name)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [id, file_url, file_type, file_name]
      );

      res.status(201).json({ media: result.rows[0] });
    } catch (err) {
      console.error("POST /api/site-report-tasks/:id/media error:", err);
      res.status(500).json({ message: "Failed to add media entry" });
    }
  });

  // POST /api/site-report-tasks/:id/issues - Add issue to a task
  app.post("/api/site-report-tasks/:id/issues", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { description } = req.body;

      const result = await query(
        `INSERT INTO site_report_issues (task_id, description)
         VALUES ($1, $2)
         RETURNING *`,
        [id, description]
      );

      res.status(201).json({ issue: result.rows[0] });
    } catch (err) {
      console.error("POST /api/site-report-tasks/:id/issues error:", err);
      res.status(500).json({ message: "Failed to add issue entry" });
    }
  });

  // --- EMAIL GROUP ROUTES ---

  // GET /api/email-groups - List groups
  app.get("/api/email-groups", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const result = await query("SELECT * FROM email_groups WHERE user_id = $1", [userId]);
      const groups = result.rows;

      for (const group of groups) {
        const membersRes = await query("SELECT * FROM email_group_members WHERE group_id = $1", [group.id]);
        group.members = membersRes.rows;
      }

      res.json({ groups });
    } catch (err) {
      console.error("GET /api/email-groups error:", err);
      res.status(500).json({ message: "Failed to fetch email groups" });
    }
  });

  // POST /api/email-groups - Create group
  app.post("/api/email-groups", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { name, members, isClientGroup } = req.body;
      const userId = (req as any).user?.id;

      await query("BEGIN");

      let groupRes;
      try {
        groupRes = await query(
          "INSERT INTO email_groups (name, user_id, is_client_group) VALUES ($1, $2, $3) RETURNING *",
          [name, userId, isClientGroup || false]
        );
      } catch (insertErr: any) {
        // If is_client_group column is not present in old schema, fallback to legacy insert.
        if (insertErr.code === '42703' || /column .* does not exist/i.test(insertErr.message)) {
          groupRes = await query(
            "INSERT INTO email_groups (name, user_id) VALUES ($1, $2) RETURNING *",
            [name, userId]
          );
        } else {
          throw insertErr;
        }
      }
      const group = groupRes.rows[0];

      if (members && Array.isArray(members)) {
        for (const email of members) {
          await query("INSERT INTO email_group_members (group_id, email) VALUES ($1, $2)", [group.id, email]);
        }
      }

      await query("COMMIT");
      res.status(201).json({ group });
    } catch (err) {
      await query("ROLLBACK");
      console.error("POST /api/email-groups error:", err);
      res.status(500).json({ message: "Failed to create email group" });
    }
  });

  // DELETE /api/email-groups/:id - Delete group
  app.delete("/api/email-groups/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await query("DELETE FROM email_groups WHERE id = $1", [id]);
      res.json({ message: "Email group deleted" });
    } catch (err) {
      console.error("DELETE /api/email-groups error:", err);
      res.status(500).json({ message: "Failed to delete email group" });
    }
  });

  // PATCH /api/site-reports/:id - Update report status
  app.patch("/api/site-reports/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status, summary } = req.body;

      const updateFields: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      if (status !== undefined) {
        updateFields.push(`status = $${paramCount++}`);
        values.push(status);
      }
      if (summary !== undefined) {
        updateFields.push(`summary = $${paramCount++}`);
        values.push(summary);
      }

      if (updateFields.length === 0) {
        return res.status(400).json({ message: "No fields to update" });
      }

      values.push(id);
      await query(
        `UPDATE site_reports SET ${updateFields.join(", ")}, updated_at = NOW() WHERE id = $${paramCount}`,
        values
      );

      res.json({ message: "Site report updated" });
    } catch (err) {
      console.error("PATCH /api/site-reports/:id error:", err);
      res.status(500).json({ message: "Failed to update site report" });
    }
  });

  // DELETE /api/site-reports/:id - Delete report
  app.delete("/api/site-reports/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      // All related tasks, labour, etc. will be deleted via ON DELETE CASCADE in schema
      await query("DELETE FROM site_reports WHERE id = $1", [id]);
      res.json({ message: "Site report deleted" });
    } catch (err) {
      console.error("DELETE /api/site-reports/:id error:", err);
      res.status(500).json({ message: "Failed to delete site report" });
    }
  });

  // POST /api/site-reports/:id/send-email - Send report to an email group
  app.post("/api/site-reports/:id/send-email", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { email_group_id, additional_emails, is_client_group } = req.body;

      // Fetch report and tasks (same logic as GET /api/site-reports/:id)
      const reportRes = await query("SELECT * FROM site_reports WHERE id = $1", [id]);
      if (reportRes.rows.length === 0) return res.status(404).json({ message: "Report not found" });
      const report = reportRes.rows[0];

      const tasksRes = await query("SELECT * FROM site_report_tasks WHERE site_report_id = $1", [id]);
      const tasks = tasksRes.rows;

      for (const task of tasks) {
        const labourRes = await query("SELECT * FROM site_report_labours WHERE task_id = $1", [task.id]);
        task.labour = labourRes.rows;
        const mediaRes = await query("SELECT * FROM site_report_media WHERE task_id = $1", [task.id]);
        task.media = mediaRes.rows;
        const issuesRes = await query("SELECT * FROM site_report_issues WHERE task_id = $1", [task.id]);
        task.issues = issuesRes.rows;

        const materialsRes = await query("SELECT * FROM site_report_materials WHERE task_id = $1", [task.id]);
        task.materials = materialsRes.rows;
      }

      // Determine if it's a client group (simplified template)
      let isClientGroup = false;

      // 1. Check if explicitly passed in request body (e.g. for single email to client)
      if (is_client_group === true || is_client_group === 'true') {
        isClientGroup = true;
      }

      // 2. Collect recipient emails from group
      let recipients: string[] = [];
      if (email_group_id) {
        // If not already determined true from body, check the group's setting in DB
        if (!isClientGroup) {
          try {
            const groupRes = await query("SELECT is_client_group FROM email_groups WHERE id = $1", [email_group_id]);
            if (groupRes.rows.length > 0) {
              isClientGroup = !!groupRes.rows[0].is_client_group;
            }
          } catch (groupErr: any) {
            // Fallback for deployments where schema isn't migrated yet.
            if (groupErr.code === '42703' || /column .* does not exist/i.test(groupErr.message)) {
              isClientGroup = false;
            } else {
              throw groupErr;
            }
          }
        }

        const membersRes = await query("SELECT email FROM email_group_members WHERE group_id = $1", [email_group_id]);
        recipients = membersRes.rows.map(r => r.email);
      }
      if (additional_emails && Array.isArray(additional_emails)) {
        recipients = [...new Set([...recipients, ...additional_emails])];
      }

      if (recipients.length === 0) {
        return res.status(400).json({ message: "No recipients specified" });
      }

      // Send email
      console.log("[EMAIL_DEBUG] recipients:", recipients);
      console.log("[EMAIL_DEBUG] is_client_group from body:", is_client_group);
      console.log("[EMAIL_DEBUG] final isClientGroup flag:", isClientGroup);
      console.log("[EMAIL_DEBUG] reportId:", id);

      await sendSiteReportEmail(recipients, report, tasks, isClientGroup);

      // Update report status to submitted if it was draft
      if (report.status === 'draft') {
        await query("UPDATE site_reports SET status = 'submitted', updated_at = NOW() WHERE id = $1", [id]);
      }

      res.json({ message: "Report sent successfully", recipients });
    } catch (err: any) {
      await query("ROLLBACK");
      console.error("POST /api/site-reports/:id/send-email error:", err);
      res.status(500).json({ message: "Failed to send report email", error: err.message || String(err) });
    }
  });
  // ==================== DEDICATED PROPOSAL ROUTES ====================

  // POST /api/sketch-plans/:id/load-to-proposal - Load assigned items to proposal
  app.post("/api/sketch-plans/:id/load-to-proposal", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;

      if (userRole !== 'supplier' && userRole !== 'admin' && userRole !== 'software_team') {
        return res.status(403).json({ message: "Only vendors or admins can load items to proposal" });
      }

      const planRes = await query("SELECT * FROM sketch_plans WHERE id = $1", [id]);
      if (planRes.rows.length === 0) return res.status(404).json({ message: "Plan not found" });
      const plan = planRes.rows[0];

      if (!plan.project_id) {
        return res.status(400).json({ message: "This sketch plan is not linked to any project" });
      }

      let itemsQuery = "SELECT * FROM sketch_plan_items WHERE plan_id = $1";
      const queryParams: any[] = [id];
      let shopName = "All Vendors";
      let shopId = null;

      const shopRes = await query("SELECT id, name FROM shops WHERE owner_id::text = $1::text LIMIT 1", [userId]);
      if (userRole === 'supplier') {
        if (shopRes.rows.length === 0) {
          return res.status(400).json({ message: "No shop associated with your account" });
        }
        shopId = shopRes.rows[0].id;
        shopName = shopRes.rows[0].name || "Vendor";
        // Use case-insensitive matching for vendor name and explicit text casting for IDs
        itemsQuery += " AND (assigned_vendor_id::text = $2::text OR LOWER(vendor_name) = LOWER($3) OR assigned_vendor_id = $4)";
        queryParams.push(shopId);
        queryParams.push(shopName);
        queryParams.push(userId);
      } else if (userRole !== 'admin' && userRole !== 'software_team') {
        return res.status(403).json({ message: "Only vendors or admins can load items to proposal" });
      }

      const itemsRes = await query(itemsQuery, queryParams);
      const items = itemsRes.rows;

      if (items.length === 0) {
        return res.status(400).json({ message: "No items assigned to you in this plan" });
      }

      await query("BEGIN");
      try {
        const vendorIdToUse = shopId || userId;
        console.log(`[LoadToProposal] User: ${userId}, Role: ${userRole}, ShopId: ${shopId}, ShopName: ${shopName}`);
        console.log(`[LoadToProposal] Items found: ${items.length}`);

        const projectRes = await query("SELECT * FROM boq_projects WHERE id = $1", [plan.project_id]);
        const project = projectRes.rows[0];
        if (!project) throw new Error(`Associated project (${plan.project_id}) not found`);

        const versionRes = await query(
          "SELECT COALESCE(MAX(version_number), 0) as last_version FROM proposals WHERE project_id = $1 AND vendor_id::text = $2::text",
          [plan.project_id, vendorIdToUse]
        );
        const nextVersionNum = (versionRes.rows[0].last_version || 0) + 1;

        const proposalCreateRes = await query(
          `INSERT INTO proposals (
            project_id, project_name, vendor_id, vendor_name, version_number, status
          ) VALUES ($1, $2, $3, $4, $5, 'draft') RETURNING id`,
          [plan.project_id, project.name, vendorIdToUse, shopName, nextVersionNum]
        );
        const newProposalId = proposalCreateRes.rows[0].id;

        const materialsRes = await query("SELECT id, name, rate, unit, technicalspecification FROM materials", []);
        const materialsById = Object.fromEntries(materialsRes.rows.map(m => [m.id?.toString(), m]));
        const materialsByName = Object.fromEntries(materialsRes.rows.map(m => [m.name?.toLowerCase()?.trim() || "", m]));

        for (const item of items) {
          let matchedMaterial = item.material_id ? materialsById[item.material_id.toString()] : null;
          if (!matchedMaterial && item.item_name) {
            matchedMaterial = materialsByName[item.item_name.toLowerCase().trim()];
          }

          // Robust parsing for dimensions and quantity
          const qty = parseFloat(item.qty || item.quantity) || 0;
          const rate = matchedMaterial ? parseFloat(matchedMaterial.rate) : 0;

          await query(
            `INSERT INTO proposal_items (
              proposal_id, material_id, item_name, qty, unit, rate, amount
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              newProposalId,
              matchedMaterial?.id || item.material_id || null,
              item.item_name || "Untitled Item",
              qty,
              item.unit || matchedMaterial?.unit || "unit",
              rate,
              qty * rate
            ]
          );
        }

        await query("COMMIT");
        res.json({
          success: true,
          message: `Proposal version ${nextVersionNum} for ${shopName} created`,
          versionId: newProposalId,
          projectId: plan.project_id
        });
      } catch (err: any) {
        await query("ROLLBACK");
        console.error("[LoadToProposal] Internal error:", err);
        res.status(500).json({ message: `Database error: ${err.message}` });
      }
    } catch (err: any) {
      console.error("[LoadToProposal] Outer error:", err);
      res.status(500).json({ message: err.message || "Failed to load items to proposal" });
    }
  });

  // GET /api/proposals - Fetch proposals (Vendor sees own, Admin sees all)
  app.get("/api/proposals", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userRole = (req as any).user?.role;
      const userId = (req as any).user?.id;
      const { projectId } = req.query;

      let q = "SELECT * FROM proposals";
      const params: any[] = [];

      if (userRole === 'supplier') {
        const shopRes = await query("SELECT id FROM shops WHERE owner_id::text = $1::text LIMIT 1", [userId]);
        if (shopRes.rows.length > 0) {
          q += " WHERE vendor_id = $1";
          params.push(shopRes.rows[0].id);
        } else {
          q += " WHERE vendor_id = 'NONE'";
        }

        if (projectId) {
          q += ` AND project_id = $${params.length + 1}`;
          params.push(projectId);
        }
      } else {
        // Admin
        if (projectId) {
          q += " WHERE project_id = $1";
          params.push(projectId);
        }
      }

      q += " ORDER BY created_at DESC";
      const result = await query(q, params);
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch proposals" });
    }
  });

  // GET /api/proposals/:id/items - Fetch items for a proposal
  app.get("/api/proposals/:id/items", authMiddleware, async (req: Request, res: Response) => {
    try {
      const result = await query("SELECT * FROM proposal_items WHERE proposal_id = $1 ORDER BY created_at ASC", [req.params.id]);
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch proposal items" });
    }
  });

  // POST /api/proposals/:id/submit - Vendor submits proposal
  app.post("/api/proposals/:id/submit", authMiddleware, async (req: Request, res: Response) => {
    try {
      // Can update item rates and quantities here from req.body.items if provided
      const { items } = req.body;

      await query("BEGIN");

      if (items && Array.isArray(items)) {
        for (const it of items) {
          await query(
            "UPDATE proposal_items SET rate = $1, amount = $2 WHERE id = $3",
            [it.rate, it.amount, it.id]
          );
        }
      }

      const result = await query(
        "UPDATE proposals SET status = 'submitted', updated_at = NOW() WHERE id = $1 RETURNING *",
        [req.params.id]
      );

      await query("COMMIT");
      res.json(result.rows[0]);
    } catch (err) {
      await query("ROLLBACK");
      console.error(err);
      res.status(500).json({ message: "Failed to submit proposal" });
    }
  });

  // POST /api/proposals/:id/approve - Admin approves proposal
  app.post("/api/proposals/:id/approve", authMiddleware, requireRole('admin', 'software_team'), async (req: Request, res: Response) => {
    try {
      const result = await query(
        "UPDATE proposals SET status = 'approved', updated_at = NOW() WHERE id = $1 RETURNING *",
        [req.params.id]
      );
      const proposal = result.rows[0];

      try {
        const vendorRes = await query(`
          SELECT u.email, u.display_name 
          FROM users u 
          JOIN shops s ON u.id = s.owner_id 
          WHERE s.id = $1
        `, [proposal.vendor_id]);

        if (vendorRes.rows.length > 0 && vendorRes.rows[0].email) {
          await sendProposalStatusEmail(
            vendorRes.rows[0].email,
            vendorRes.rows[0].display_name || 'Vendor',
            proposal.project_name || 'Project',
            proposal.version_number,
            'approved'
          );
        }
      } catch (e) {
        console.error("Failed to send approval email", e);
      }

      res.json(proposal);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to approve proposal" });
    }
  });

  // POST /api/proposals/:id/reject - Admin rejects proposal
  app.post("/api/proposals/:id/reject", authMiddleware, requireRole('admin', 'software_team'), async (req: Request, res: Response) => {
    try {
      const { reason } = req.body;
      const result = await query(
        "UPDATE proposals SET status = 'rejected', rejection_reason = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
        [reason || 'No reason specified', req.params.id]
      );
      const proposal = result.rows[0];

      try {
        const vendorRes = await query(`
          SELECT u.email, u.display_name 
          FROM users u 
          JOIN shops s ON u.id = s.owner_id 
          WHERE s.id = $1
        `, [proposal.vendor_id]);

        if (vendorRes.rows.length > 0 && vendorRes.rows[0].email) {
          await sendProposalStatusEmail(
            vendorRes.rows[0].email,
            vendorRes.rows[0].display_name || 'Vendor',
            proposal.project_name || 'Project',
            proposal.version_number,
            'rejected',
            proposal.rejection_reason
          );
        }
      } catch (e) {
        console.error("Failed to send rejection email", e);
      }

      res.json(proposal);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to reject proposal" });
    }
  });

  // GET /api/boq-analysis/comparison - Fetch last 3 approved BOQ projects for comparison
  app.get("/api/boq-analysis/comparison", authMiddleware, async (_req: Request, res: Response) => {
    try {
      // 1. Fetch last 3 projects with approved BOQ versions
      const projectsResult = await query(`
        SELECT p.id as project_id, p.name as project_name, v.id as version_id, v.updated_at as completed_date, v.project_value as final_total
        FROM boq_projects p
        JOIN boq_versions v ON p.id = v.project_id
        WHERE v.type = 'boq' AND v.status = 'approved'
        ORDER BY v.updated_at DESC
        LIMIT 3
      `);

      if (projectsResult.rows.length === 0) {
        return res.json({ projects: [] });
      }

      const comparisonData = [];

      for (const proj of projectsResult.rows) {
        // 2. Fetch items for each version
        const itemsResult = await query(
          "SELECT table_data FROM boq_items WHERE version_id = $1",
          [proj.version_id]
        );

        let overrideTotal = 0;
        let overrideRateTotal = 0;
        let supplyRateTotal = 0;
        let supplyAmountTotal = 0;
        let labourRateTotal = 0;
        let labourAmountTotal = 0;

        for (const itemRow of itemsResult.rows) {
          let td = itemRow.table_data;
          if (typeof td === 'string') {
            try { td = JSON.parse(td); } catch (e) { continue; }
          }

          const step11 = Array.isArray(td.step11_items) ? td.step11_items : [];

          const finalizeQty = td.finalize_qty !== undefined && td.finalize_qty !== null ? parseFloat(td.finalize_qty) : null;
          const finalizeOverrideRateInput = td.finalize_override_rate !== undefined && td.finalize_override_rate !== null ? parseFloat(td.finalize_override_rate) : null;
          const finalizeOverrideType = td.finalize_override_type || 'value'; // Default to 'value' for backward compatibility

          for (const it of step11) {
            const qty = finalizeQty !== null ? finalizeQty : (parseFloat(it.qty) || 0);
            const supplyRate = parseFloat(it.supply_rate || it.rate || 0);
            const installRate = parseFloat(it.install_rate || 0);
            const systemTotal = qty * (supplyRate + installRate);

            supplyRateTotal += supplyRate;
            supplyAmountTotal += qty * supplyRate;
            labourRateTotal += installRate;
            labourAmountTotal += qty * installRate;

            // Calculate effective override rate based on type
            if (finalizeOverrideRateInput !== null) {
              let effectiveOverrideRate = 0;
              if (finalizeOverrideType === 'percentage') {
                // Override rate is a percentage - compute effective rate
                effectiveOverrideRate = systemTotal * finalizeOverrideRateInput / 100 / qty;
              } else {
                // Override rate is a direct value
                effectiveOverrideRate = finalizeOverrideRateInput;
              }
              
              overrideRateTotal += effectiveOverrideRate;
              overrideTotal += effectiveOverrideRate * qty;
            } else {
              overrideTotal += systemTotal;
            }
          }
        }

        comparisonData.push({
          projectName: proj.project_name,
          overrideTotal,
          overrideRateTotal,
          supplyRateTotal,
          supplyAmountTotal,
          labourRateTotal,
          labourAmountTotal,
          finalTotal: parseFloat(proj.final_total || "0"),
          completedDate: proj.completed_date
        });
      }

      res.json({ projects: comparisonData });
    } catch (err) {
      console.error("GET /api/boq-analysis/comparison error", err);
      res.status(500).json({ message: "Failed to fetch comparison data" });
    }
  });

  // GET /api/historical-rates - Fetch historical Supply and Labour rates for a specific product
  app.get("/api/historical-rates", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { productId, type } = req.query;
      if (!productId) {
        return res.status(400).json({ message: "productId is required" });
      }

      console.log(`[DEBUG] Fetching historical rates for productId: ${productId}, type: ${type}`);

      // Fetch last 100 projects where this product was used
      // We look in table_data JSON for product_id or material_id
      const result = await query(`
        SELECT 
          p.name as project_name, 
          v.updated_at as date, 
          v.status as version_status,
          bi.table_data
        FROM boq_items bi
        JOIN boq_versions v ON bi.version_id = v.id
        JOIN boq_projects p ON v.project_id = p.id
        WHERE v.type = 'boq'
          AND v.status = 'approved'
          AND (bi.table_data->>'product_id' = $1 OR bi.table_data->>'material_id' = $1)
        ORDER BY v.updated_at DESC
        LIMIT 100
      `, [productId]);

      console.log(`[DEBUG] Found ${result.rows.length} projects for this product`);

      const history = result.rows.map(row => {
        let td = row.table_data;
        if (typeof td === 'string') {
          try { td = JSON.parse(td); } catch (e) { td = {}; }
        }

        const cols = td.finalize_columns || [];
        const vals = td.finalize_column_values?.['0'] || {};

        let supplyRate = null;
        let labourRate = null;

        // Requirement: Fetch EXACT stored values from custom columns
        // STRICT filtering to prevent mixing supply and labour data
        cols.forEach((col: any) => {
          const colName = typeof col === 'string' ? col : col.name;
          const lower = colName.toLowerCase();
          const val = vals[colName];

          if (val !== undefined && val !== null && val !== "") {
            const parsedVal = typeof val === 'string' ? parseFloat(val.replace(/[^\d.]/g, '')) : parseFloat(val);
            if (isNaN(parsedVal) || parsedVal <= 0) return;

            // Supply Rate match: Must have 'supply' and 'rate', but NO 'labour', 'labor', 'install', or 'override'
            if (lower.includes("supply") && lower.includes("rate") &&
              !lower.includes("labour") && !lower.includes("labor") && !lower.includes("install") && !lower.includes("override")) {
              supplyRate = parsedVal;
            }
            // Labour/Install Rate match: Must have 'labour'/'labor'/'install' and 'rate', but NO 'supply' or 'override'
            else if ((lower.includes("labour") || lower.includes("labor") || lower.includes("install")) &&
              lower.includes("rate") && !lower.includes("supply") && !lower.includes("override")) {
              labourRate = parsedVal;
            }
          }
        });

        // Filter based on requested type if provided
        if (type === 'supply' && supplyRate === null) return null;
        if (type === 'labour' && labourRate === null) return null;
        if (!type && supplyRate === null && labourRate === null) return null;

        return {
          projectName: row.project_name,
          date: row.date,
          versionStatus: row.version_status,
          supplyRate,
          labourRate,
          qty: td.finalize_qty || null,
          total: td.finalize_override_total || null
        };
      }).filter(Boolean).slice(0, 5); // Limit to latest 5 entries

      console.log(`[DEBUG] Returning ${history.length} historical entries after filtering`);
      res.json({ history });
    } catch (err) {
      console.error("GET /api/historical-rates error", err);
      res.status(500).json({ message: "Failed to fetch historical rates" });
    }
  });

  return httpServer;
}

