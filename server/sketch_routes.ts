import type { Express, Request, Response } from "express";
import { pool, query } from "./db/client";
import { authMiddleware, requireRole } from "./middleware";

import { sendSketchPlanEmail } from "./email";
import { convertSketchToBoqItems } from "./lib/sketch_converter";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabaseStorage = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, {
  realtime: { transport: ws as any }
}) : null;

/** Delete files from Supabase bucket. Only deletes files with http URLs (Supabase-hosted). Old base64 images are safely ignored. */
const deleteFromSupabaseBucket = async (urls: string[]) => {
  if (!supabaseStorage) return;
  const filePaths = urls
    .filter(url => url && url.startsWith('http'))
    .map(url => {
      // Extract filename from URL like https://xxx.supabase.co/storage/v1/object/public/boq-images/filename.webp
      const parts = url.split('/boq-images/');
      return parts.length > 1 ? parts[1].split('?')[0] : null;
    })
    .filter(Boolean) as string[];

  if (filePaths.length > 0) {
    try {
      await supabaseStorage.storage.from('boq-images').remove(filePaths);
    } catch (err) {
      console.error('Failed to delete files from Supabase bucket:', err);
    }
  }
};


/**
 * Optimized image serving to allow browser caching and reduce JSON payload size
 */
const serveBase64Resource = async (res: Response, table: string, id: string, column: string) => {
  try {
    const result = await query(`SELECT ${column} FROM ${table} WHERE id = $1`, [id]);
    if (result.rows.length === 0) return res.status(404).send("Not found");

    const dataUrl = result.rows[0][column];
    if (!dataUrl || !dataUrl.startsWith("data:")) {
      return res.send(dataUrl);
    }

    const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) return res.send(dataUrl);

    const contentType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buffer);
  } catch (err) {
    console.error(`Error serving ${table}.${column}:`, err);
    res.status(500).send("Internal Server Error");
  }
};

// Helper to parse numeric values safely
const parseSafeNumeric = (val: any) => {
  if (val === null || val === undefined || val === '') return 0;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? 0 : parsed;
};

export async function registerSketchRoutes(app: Express) {
  const { archiveService } = await import("./archive_service");

  // Optimized Resource Serving Endpoints
  app.get("/api/sketch-images/:id", authMiddleware, (req, res) => {
    serveBase64Resource(res, 'sketch_plan_images', req.params.id, 'image_url');
  });

  app.get("/api/sketch-attachments/:id", authMiddleware, (req, res) => {
    serveBase64Resource(res, 'sketch_plan_attachments', req.params.id, 'file_url');
  });

  // Add versioning columns to sketch_plans (safe migration)
  // Performance indexes
  await query(`CREATE INDEX IF NOT EXISTS idx_sketch_templates_created_at ON sketch_templates (created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_sketch_plans_project_id ON sketch_plans (project_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_sketch_plan_items_plan_id ON sketch_plan_items (plan_id)`);

  // GET /api/sketch-plans - List all sketch plans
  app.get("/api/sketch-plans", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { parent_id } = req.query;
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;
      
      let queryStr = `
        SELECT sp.*, p.name as project_name, spl.is_locked, spl.request_status
        FROM sketch_plans sp 
        LEFT JOIN boq_projects p ON sp.project_id = p.id 
        LEFT JOIN sketch_plan_locks spl ON sp.id = spl.plan_id
      `;
      const queryParams: any[] = [];
      let whereConditions: string[] = [];

      // For suppliers, filter to only show plans with assigned items
      if (userRole === 'supplier' && userId) {
        // Get supplier's shops
        const shopsRes = await query(
          "SELECT id FROM shops WHERE owner_id = $1",
          [userId]
        );
        const shopIds = shopsRes.rows.map((row: any) => row.id);
        
        if (shopIds.length > 0) {
          // Add subquery to filter plans that have items assigned to this supplier's shops
          queryStr = `
            SELECT DISTINCT sp.*, p.name as project_name, spl.is_locked, spl.request_status
            FROM sketch_plans sp 
            LEFT JOIN boq_projects p ON sp.project_id = p.id 
            LEFT JOIN sketch_plan_locks spl ON sp.id = spl.plan_id
            WHERE sp.id IN (
              SELECT DISTINCT plan_id FROM sketch_plan_items 
              WHERE assigned_vendor_id = ANY($1)
            )
          `;
          queryParams.push(shopIds);
          
          if (parent_id) {
            whereConditions.push(`(sp.id = $${queryParams.length + 1} OR sp.parent_plan_id = $${queryParams.length + 1})`);
            queryParams.push(parent_id);
          }
        } else {
          // Supplier has no shops, return empty result
          res.json({ plans: [] });
          return;
        }
      } else {
        // Non-suppliers see all plans (existing behavior)
        if (parent_id) {
          whereConditions.push(`(sp.id = $1 OR sp.parent_plan_id = $1)`);
          queryParams.push(parent_id);
        }
      }

      if (whereConditions.length > 0) {
        queryStr += " AND " + whereConditions.join(" AND ");
      }

      queryStr += ` ORDER BY sp.project_id NULLS LAST, sp.created_at ASC`;

      const result = await query(queryStr, queryParams);
      const archivedIds = await archiveService.getArchivedItemIds('sketch_plans');
      const trashedIds = await archiveService.getTrashedItemIds('sketch_plans');
      const filtered = (result.rows || []).filter((r: any) => !archivedIds.includes(r.id) && !trashedIds.includes(r.id));
      res.json({ plans: filtered });
    } catch (err) {
      console.error("GET /api/sketch-plans error", err);
      res.status(500).json({ message: "Failed to fetch sketch plans" });
    }
  });

  // POST /api/sketch-plans/:id/new-version - Create a new version from an existing plan
  app.post("/api/sketch-plans/:id/new-version", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { copyItems = true } = req.body;
      const created_by = (req as any).user?.id || null;

      const planRes = await query("SELECT * FROM sketch_plans WHERE id = $1", [id]);
      if (planRes.rows.length === 0) return res.status(404).json({ message: "Plan not found" });
      const sourcePlan = planRes.rows[0];

      const rootId = sourcePlan.parent_plan_id || id;

      const maxVerRes = await query(
        `SELECT COALESCE(MAX(version_number), 1) as max_ver FROM sketch_plans WHERE id = $1 OR parent_plan_id = $1`,
        [rootId]
      );
      const nextVersion = (maxVerRes.rows[0]?.max_ver || 1) + 1;

      const newId = `skp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO sketch_plans (id, name, project_id, location, plan_date, created_by, version_number, parent_plan_id, version_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft')`,
          [newId, sourcePlan.name, sourcePlan.project_id, sourcePlan.location, sourcePlan.plan_date, created_by, nextVersion, rootId]
        );

        if (copyItems) {
          const srcItemsRes = await client.query("SELECT * FROM sketch_plan_items WHERE plan_id = $1 ORDER BY created_at ASC", [id]);
          const srcItems = srcItemsRes.rows;
          for (let i = 0; i < srcItems.length; i++) {
            const srcItem = srcItems[i];
            const newItemId = `ski-${Date.now()}-${String(i).padStart(4, '0')}-${Math.random().toString(36).substr(2, 5)}`;
            await client.query(
              `INSERT INTO sketch_plan_items (id, plan_id, item_name, description, length, width, height, qty, unit, remarks, material_id, dimension_unit, assigned_vendor_id, vendor_name, dimensions, assigned_user_id, assigned_user_name, user_task_status, category, sort_order, item_description)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
              [
                newItemId, newId, srcItem.item_name, srcItem.description, srcItem.length, srcItem.width, srcItem.height, srcItem.qty, srcItem.unit, srcItem.remarks, srcItem.material_id, srcItem.dimension_unit || 'feet', srcItem.assigned_vendor_id || null, srcItem.vendor_name || null,
                srcItem.dimensions ? JSON.stringify(srcItem.dimensions) : null,
                srcItem.assigned_user_id || null, srcItem.assigned_user_name || null, srcItem.user_task_status || 'unassigned', srcItem.category || null, srcItem.sort_order, srcItem.item_description]
            );

            const srcItemImagesRes = await client.query("SELECT * FROM sketch_plan_images WHERE plan_id = $1 AND item_id = $2", [id, srcItem.id]);
            for (const img of srcItemImagesRes.rows) {
              const newImgId = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              await client.query(
                `INSERT INTO sketch_plan_images (id, plan_id, item_id, image_url, image_name) VALUES ($1, $2, $3, $4, $5)`,
                [newImgId, newId, newItemId, img.image_url, img.image_name]
              );
            }
          }

          const srcPlanImagesRes = await client.query("SELECT * FROM sketch_plan_images WHERE plan_id = $1 AND item_id IS NULL", [id]);
          for (const img of srcPlanImagesRes.rows) {
            const newImgId = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            await client.query(
              `INSERT INTO sketch_plan_images (id, plan_id, item_id, image_url, image_name) VALUES ($1, $2, $3, $4, $5)`,
              [newImgId, newId, null, img.image_url, img.image_name]
            );
          }

          const srcAttachmentsRes = await client.query("SELECT * FROM sketch_plan_attachments WHERE plan_id = $1", [id]);
          for (const att of srcAttachmentsRes.rows) {
            const newAttId = `att-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            await client.query(
              `INSERT INTO sketch_plan_attachments (id, plan_id, file_url, file_name, file_type) VALUES ($1, $2, $3, $4, $5)`,
              [newAttId, newId, att.file_url, att.file_name, att.file_type]
            );
          }
        }

        await client.query("COMMIT");
        res.json({ id: newId, version_number: nextVersion, message: `Version ${nextVersion} created` });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("POST /api/sketch-plans/:id/new-version error", err);
      res.status(500).json({ message: "Failed to create new version" });
    }
  });

  // POST /api/sketch-plans/:id/clone - Clone a plan into a new root plan
  app.post("/api/sketch-plans/:id/clone", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { name, projectId } = req.body;
      const created_by = (req as any).user?.id || null;

      const planRes = await query("SELECT * FROM sketch_plans WHERE id = $1", [id]);
      if (planRes.rows.length === 0) return res.status(404).json({ message: "Plan not found" });
      const sourcePlan = planRes.rows[0];

      const newId = `skp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newName = name || `${sourcePlan.name} (Clone)`;
      const newProjId = (projectId === "none" || !projectId) ? null : projectId;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO sketch_plans (id, name, project_id, location, plan_date, created_by, version_number, parent_plan_id, version_status)
           VALUES ($1, $2, $3, $4, $5, $6, 1, NULL, 'draft')`,
          [newId, newName, newProjId, sourcePlan.location, sourcePlan.plan_date, created_by]
        );

        const srcItemsRes = await client.query("SELECT * FROM sketch_plan_items WHERE plan_id = $1 ORDER BY created_at ASC", [id]);
        const srcItems = srcItemsRes.rows;
        for (let i = 0; i < srcItems.length; i++) {
          const srcItem = srcItems[i];
          const newItemId = `ski-${Date.now()}-${String(i).padStart(4, '0')}-${Math.random().toString(36).substr(2, 5)}`;
          const safeMatId = srcItem.material_id || null;
          const safeVendorId = srcItem.assigned_vendor_id || null;

          await client.query(
            `INSERT INTO sketch_plan_items (id, plan_id, item_name, description, length, width, height, qty, unit, remarks, material_id, dimension_unit, assigned_vendor_id, vendor_name, dimensions, assigned_user_id, assigned_user_name, user_task_status, category, sort_order, item_description)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
            [
              newItemId, newId, srcItem.item_name, srcItem.description, srcItem.length, srcItem.width, srcItem.height, srcItem.qty, srcItem.unit, srcItem.remarks, safeMatId, srcItem.dimension_unit || 'feet', safeVendorId, srcItem.vendor_name || null,
              srcItem.dimensions ? JSON.stringify(srcItem.dimensions) : null,
              srcItem.assigned_user_id || null, srcItem.assigned_user_name || null, srcItem.user_task_status || 'unassigned',
              srcItem.category || null, srcItem.sort_order, srcItem.item_description]
          );

          const srcItemImagesRes = await client.query("SELECT * FROM sketch_plan_images WHERE plan_id = $1 AND item_id = $2", [id, srcItem.id]);
          for (const img of srcItemImagesRes.rows) {
            const newImgId = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            await client.query(
              `INSERT INTO sketch_plan_images (id, plan_id, item_id, image_url, image_name) VALUES ($1, $2, $3, $4, $5)`,
              [newImgId, newId, newItemId, img.image_url, img.image_name]
            );
          }
        }

        const srcPlanImagesRes = await client.query("SELECT * FROM sketch_plan_images WHERE plan_id = $1 AND item_id IS NULL", [id]);
        for (const img of srcPlanImagesRes.rows) {
          const newImgId = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          await client.query(
            `INSERT INTO sketch_plan_images (id, plan_id, item_id, image_url, image_name) VALUES ($1, $2, $3, $4, $5)`,
            [newImgId, newId, null, img.image_url, img.image_name]
          );
        }

        const srcAttachmentsRes = await client.query("SELECT * FROM sketch_plan_attachments WHERE plan_id = $1", [id]);
        for (const att of srcAttachmentsRes.rows) {
          const newAttId = `att-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          await client.query(
            `INSERT INTO sketch_plan_attachments (id, plan_id, file_url, file_name, file_type) VALUES ($1, $2, $3, $4, $5)`,
            [newAttId, newId, att.file_url, att.file_name, att.file_type]
          );
        }

        await client.query("COMMIT");
        res.json({ id: newId, message: "Plan cloned successfully" });
      } catch (err) {
        await client.query("ROLLBACK");
        console.error("[clone] Transaction error:", err);
        throw err;
      } finally {
        client.release();
      }
    } catch (err: any) {
      console.error("POST /api/sketch-plans/:id/clone error", err);
      res.status(500).json({ message: "Failed to clone plan", details: err.message });
    }
  });

  // GET /api/sketch-plans/assigned-tasks - Get tasks assigned to the current user
  app.get("/api/sketch-plans/assigned-tasks", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const result = await query(
        `SELECT spi.*, sp.name as plan_name, sp.project_id 
         FROM sketch_plan_items spi
         JOIN sketch_plans sp ON spi.plan_id = sp.id
         WHERE spi.assigned_user_id = $1
         ORDER BY sp.created_at DESC`,
        [userId]
      );
      res.json({ tasks: result.rows });
    } catch (err) {
      console.error("GET /api/sketch-plans/assigned-tasks error", err);
      res.status(500).json({ message: "Failed to fetch assigned tasks" });
    }
  });

  // POST /api/sketch-plans/assigned-tasks/:id/status - Update task status
  app.post("/api/sketch-plans/assigned-tasks/:id/status", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const checkRes = await query("SELECT id FROM sketch_plan_items WHERE id = $1 AND assigned_user_id = $2", [id, userId]);
      if (checkRes.rows.length === 0) {
        return res.status(403).json({ message: "Not authorized to update this task" });
      }

      await query("UPDATE sketch_plan_items SET user_task_status = $1 WHERE id = $2", [status, id]);
      res.json({ message: "Task status updated successfully" });
    } catch (err) {
      console.error("POST /api/sketch-plans/assigned-tasks/:id/status error", err);
      res.status(500).json({ message: "Failed to update task status" });
    }
  });

  // GET /api/sketch-plans/:id - Get plan details
  app.get("/api/sketch-plans/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const planRes = await query(
        `SELECT sp.*, spl.is_locked, spl.request_status, spl.request_reason,
                p.name as project_name
         FROM sketch_plans sp
         LEFT JOIN sketch_plan_locks spl ON sp.id = spl.plan_id
         LEFT JOIN boq_projects p ON sp.project_id = p.id
         WHERE sp.id = $1`,
        [id]
      );
      if (planRes.rows.length === 0) {
        return res.status(404).json({ message: "Plan not found" });
      }

      const itemsRes = await query(`
        SELECT spi.*
        FROM sketch_plan_items spi
        WHERE spi.plan_id = $1 
        ORDER BY spi.sort_order ASC, spi.created_at ASC, spi.id ASC`,
        [id]
      );
      const imagesRes = await query(
        "SELECT id, item_id, image_url, image_name FROM sketch_plan_images WHERE plan_id = $1",
        [id]
      );
      const attachmentsRes = await query(
        "SELECT id, file_url, file_name, file_type FROM sketch_plan_attachments WHERE plan_id = $1",
        [id]
      );

      const plan = planRes.rows[0];
      res.json({
        plan: {
          ...plan,
          category_order: plan.category_order || []
        },
        items: itemsRes.rows || [],
        images: (imagesRes.rows || []).map(img => ({
          ...img,
          image_url: img.image_url?.startsWith('http') ? img.image_url : `/api/sketch-images/${img.id}`
        })),
        attachments: (attachmentsRes.rows || []).map(att => ({
          ...att,
          file_url: att.file_url?.startsWith('http') ? att.file_url : `/api/sketch-attachments/${att.id}`
        }))
      });
    } catch (err) {
      console.error("GET /api/sketch-plans/:id error", err);
      res.status(500).json({ message: "Failed to fetch plan details" });
    }
  });

  // POST /api/sketch-plans - Create a new sketch plan
  app.post("/api/sketch-plans", authMiddleware, async (req: Request, res: Response) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { name, project_id, location, plan_date, items, images, attachments } = req.body;
      const id = `skp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const created_by = (req as any).user?.id || null;
      const finalPlanDate = (plan_date && plan_date.trim() !== "") ? plan_date : new Date().toISOString().split("T")[0];

      await client.query(
        `INSERT INTO sketch_plans (id, name, project_id, location, plan_date, created_by) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, name, project_id || null, location || null, finalPlanDate, created_by]
      );

      if (items && Array.isArray(items)) {
        // Batch item inserts
        await Promise.all(items.map((item, i) => {
          // ALWAYS generate a new ID for a brand new plan to avoid collisions with templates or other plans
          const itemId = `ski-${`${Date.now()}`.padStart(15, '0')}-${String(i).padStart(4, '0')}-${Math.random().toString(36).substr(2, 5)}`;
          item.id = itemId; // Sync ID for image mapping
          return client.query(
            `INSERT INTO sketch_plan_items (id, plan_id, item_name, description, length, width, height, qty, unit, remarks, material_id, dimension_unit, assigned_vendor_id, vendor_name, dimensions, assigned_user_id, assigned_user_name, user_task_status, category, sort_order, item_description) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
            [
              itemId, id, item.item_name, item.description,
              parseSafeNumeric(item.length), parseSafeNumeric(item.width), parseSafeNumeric(item.height),
              parseSafeNumeric(item.qty), item.unit, item.remarks,
              item.material_id || null, item.dimension_unit || 'feet',
              item.assigned_vendor_id || null, item.vendor_name || null,
              item.dimensions ? JSON.stringify(item.dimensions) : null,
              item.assigned_user_id || null, item.assigned_user_name || null,
              item.user_task_status || 'unassigned', item.category || null, i,
              item.item_description || null
            ]
          );
        }));

        // Batch all images
        const allImages: any[] = [];
        items.forEach((item: any) => {
          if (item.images && Array.isArray(item.images)) {
            item.images.forEach((img: any) => {
              allImages.push({
                item_id: item.id,
                url: typeof img === "string" ? img : (img.url || img.image_url),
                name: typeof img === "string" ? null : (img.name || img.image_name)
              });
            });
          }
        });
        if (images && Array.isArray(images)) {
          images.forEach((img: any) => {
            if (!img.item_id) {
              allImages.push({
                item_id: null,
                url: typeof img === "string" ? img : (img.image_url || img.url),
                name: typeof img === "string" ? null : (img.name || img.image_name)
              });
            }
          });
        }

        if (allImages.length > 0) {
          await Promise.all(allImages.map((img: any) => {
            const imgId = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            return client.query(
              `INSERT INTO sketch_plan_images (id, plan_id, item_id, image_url, image_name) VALUES ($1, $2, $3, $4, $5)`,
              [imgId, id, img.item_id, img.url, img.name]
            );
          }));
        }
      }

      if (attachments && Array.isArray(attachments)) {
        await Promise.all(attachments.map((att: any) => {
          const attId = `att-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          return client.query(
            `INSERT INTO sketch_plan_attachments (id, plan_id, file_url, file_name, file_type) 
             VALUES ($1, $2, $3, $4, $5)`,
            [attId, id, att.file_url || att.url, att.file_name || att.name, att.file_type || att.type]
          );
        }));
      }

      await client.query("COMMIT");

      // Refetch full plan to return to client (sync IDs)
      const itemsRes = await client.query(`
        SELECT spi.*
        FROM sketch_plan_items spi
        WHERE spi.plan_id = $1 ORDER BY spi.sort_order ASC, spi.created_at ASC, spi.id ASC`, [id]);
      const imagesRes = await client.query("SELECT id, item_id, image_url, image_name FROM sketch_plan_images WHERE plan_id = $1", [id]);
      const attachmentsRes = await client.query("SELECT id, file_url, file_name, file_type FROM sketch_plan_attachments WHERE plan_id = $1", [id]);

      res.status(201).json({
        id,
        message: "Sketch plan created successfully",
        items: itemsRes.rows || [],
        images: imagesRes.rows || [],
        attachments: attachmentsRes.rows || []
      });
    } catch (err) {
      if (client) await client.query("ROLLBACK");
      console.error("POST /api/sketch-plans error:", err);
      res.status(500).json({ message: "Failed to create sketch plan" });
    } finally {
      if (client) client.release();
    }
  });

  // PUT /api/sketch-plans/:id - Update sketch plan (Optimized Delta Save)
  app.put("/api/sketch-plans/:id", authMiddleware, async (req: Request, res: Response) => {
    let client;
    try {
      const { id } = req.params;
      const { name, project_id, location, plan_date, items, images, attachments, deletedItemIds, deletedImageIds, deletedAttachmentIds, isDelta, category_order } = req.body;

      client = await pool.connect();
      await client.query("BEGIN");

      const lockRes = await client.query("SELECT id FROM sketch_plans WHERE id = $1 FOR UPDATE", [id]);
      if (lockRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Plan not found" });
      }

      const finalPlanDate = (plan_date && plan_date.trim() !== "") ? plan_date : null;
      await client.query(
        `UPDATE sketch_plans SET 
           name = $1, project_id = $2, location = $3, plan_date = $4, updated_at = NOW(),
           category_order = $5
         WHERE id = $6`,
        [name, project_id || null, location || null, finalPlanDate, category_order ? JSON.stringify(category_order) : null, id]
      );

      // Handle deletions
      if (isDelta) {
        if (deletedItemIds && Array.isArray(deletedItemIds) && deletedItemIds.length > 0) {
          // Fetch image URLs for items being deleted, then clean up from Supabase
          const itemImgRes = await client.query("SELECT image_url FROM sketch_plan_images WHERE plan_id = $1 AND item_id IN (SELECT unnest($2::text[]))", [id, deletedItemIds]);
          await deleteFromSupabaseBucket(itemImgRes.rows.map((r: any) => r.image_url));
          await client.query("DELETE FROM sketch_plan_items WHERE plan_id = $1 AND id IN (SELECT unnest($2::text[]))", [id, deletedItemIds]);
        }
        if (deletedImageIds && Array.isArray(deletedImageIds) && deletedImageIds.length > 0) {
          // Fetch URLs before deleting, then clean up from Supabase
          const imgRes = await client.query("SELECT image_url FROM sketch_plan_images WHERE plan_id = $1 AND id IN (SELECT unnest($2::text[]))", [id, deletedImageIds]);
          await deleteFromSupabaseBucket(imgRes.rows.map((r: any) => r.image_url));
          await client.query("DELETE FROM sketch_plan_images WHERE plan_id = $1 AND id IN (SELECT unnest($2::text[]))", [id, deletedImageIds]);
        }
        if (deletedAttachmentIds && Array.isArray(deletedAttachmentIds) && deletedAttachmentIds.length > 0) {
          // Fetch URLs before deleting, then clean up from Supabase
          const attRes = await client.query("SELECT file_url FROM sketch_plan_attachments WHERE plan_id = $1 AND id IN (SELECT unnest($2::text[]))", [id, deletedAttachmentIds]);
          await deleteFromSupabaseBucket(attRes.rows.map((r: any) => r.file_url));
          await client.query("DELETE FROM sketch_plan_attachments WHERE plan_id = $1 AND id IN (SELECT unnest($2::text[]))", [id, deletedAttachmentIds]);
        }
      } else {
        const incomingItemIds = (items || []).map((it: any) => it.id).filter(Boolean);
        if (incomingItemIds.length > 0) {
          await client.query("DELETE FROM sketch_plan_items WHERE plan_id = $1 AND id NOT IN (SELECT unnest($2::text[]))", [id, incomingItemIds]);
        } else {
          await client.query("DELETE FROM sketch_plan_items WHERE plan_id = $1", [id]);
        }
        await client.query("DELETE FROM sketch_plan_images WHERE plan_id = $1", [id]);
        await client.query("DELETE FROM sketch_plan_attachments WHERE plan_id = $1", [id]);
      }

      // 1. Resolve all Proxy URLs to raw data before starting the loop
      const proxyUrlsToResolve = new Set<string>();
      const addProxies = (obj: any) => {
        const url = obj.url || obj.image_url || obj.file_url;
        if (url && (url.startsWith('/api/sketch-images/') || url.startsWith('/api/sketch-attachments/'))) {
          proxyUrlsToResolve.add(url);
        }
      };
      if (items && Array.isArray(items)) {
        items.forEach(it => {
          if (it.images) it.images.forEach(addProxies);
          if (it.preImages) it.preImages.forEach(addProxies);
          if (it.postImages) it.postImages.forEach(addProxies);
        });
      }
      if (images && Array.isArray(images)) images.forEach(addProxies);
      if (attachments && Array.isArray(attachments)) attachments.forEach(addProxies);

      const resolvedProxyMap = new Map<string, string>();
      if (proxyUrlsToResolve.size > 0) {
        const urls = Array.from(proxyUrlsToResolve);
        const imageIds = urls.filter(u => u.startsWith('/api/sketch-images/')).map(u => u.split('?')[0].split('/').pop());
        const attIds = urls.filter(u => u.startsWith('/api/sketch-attachments/')).map(u => u.split('?')[0].split('/').pop());

        if (imageIds.length > 0) {
          const res = await client.query("SELECT id, image_url FROM sketch_plan_images WHERE id IN (SELECT unnest($1::text[]))", [imageIds]);
          res.rows.forEach(r => resolvedProxyMap.set(`/api/sketch-images/${r.id}`, r.image_url));
        }
        if (attIds.length > 0) {
          const res = await client.query("SELECT id, file_url FROM sketch_plan_attachments WHERE id IN (SELECT unnest($1::text[]))", [attIds]);
          res.rows.forEach(r => resolvedProxyMap.set(`/api/sketch-attachments/${r.id}`, r.file_url));
        }
      }

      const getResolvedData = (url: string) => {
        if (!url) return null;
        const base = url.split('?')[0];
        if (resolvedProxyMap.has(base)) return resolvedProxyMap.get(base);
        if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) return url;
        return null;
      };

      // 2. Upsert items and their images
      if (items && Array.isArray(items)) {
        for (const item of items) {
          const itemId = item.id ? item.id : `ski-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
          await client.query(
            `INSERT INTO sketch_plan_items (
              id, plan_id, item_name, description, length, width, height, qty, unit, 
              remarks, material_id, dimension_unit, assigned_vendor_id, vendor_name, 
              dimensions, assigned_user_id, assigned_user_name, user_task_status, category, sort_order, item_description
            ) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
             ON CONFLICT (id) DO UPDATE SET 
               item_name = EXCLUDED.item_name, description = EXCLUDED.description,
               length = EXCLUDED.length, width = EXCLUDED.width, height = EXCLUDED.height,
               qty = EXCLUDED.qty, unit = EXCLUDED.unit, remarks = EXCLUDED.remarks,
               material_id = EXCLUDED.material_id, dimension_unit = EXCLUDED.dimension_unit,
               assigned_vendor_id = EXCLUDED.assigned_vendor_id, vendor_name = EXCLUDED.vendor_name,
               dimensions = EXCLUDED.dimensions, assigned_user_id = EXCLUDED.assigned_user_id,
               assigned_user_name = EXCLUDED.assigned_user_name, user_task_status = EXCLUDED.user_task_status,
               category = EXCLUDED.category, sort_order = EXCLUDED.sort_order, item_description = EXCLUDED.item_description`,
            [
              itemId, id, item.item_name, item.description,
              parseSafeNumeric(item.length), parseSafeNumeric(item.width), parseSafeNumeric(item.height), parseSafeNumeric(item.qty),
              item.unit, item.remarks, item.material_id || null, item.dimension_unit || 'feet',
              item.assigned_vendor_id || null, item.vendor_name || null,
              item.dimensions ? JSON.stringify(item.dimensions) : null,
              item.assigned_user_id || null, item.assigned_user_name || null,
              item.user_task_status || 'unassigned', item.category || null,
              item.sort_order || 0, item.item_description || null]
          );

          if (item.images && Array.isArray(item.images)) {
            for (const img of item.images) {
              const rawImgUrl = typeof img === "string" ? img : (img.image_url || img.url);
              const imgName = typeof img === "string" ? null : (img.name || img.image_name);
              const imgId = img.id ? img.id : `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              const resolvedData = getResolvedData(rawImgUrl);

              if (resolvedData) {
                await client.query(
                  `INSERT INTO sketch_plan_images (id, plan_id, item_id, image_url, image_name) 
                   VALUES ($1, $2, $3, $4, $5)
                   ON CONFLICT (id) DO UPDATE SET item_id = $3, image_url = $4, image_name = $5`,
                  [imgId, id, itemId, resolvedData, imgName]
                );
              }
            }
          }
        }
      }

      // 3. Upsert standalone plan images
      if (images && Array.isArray(images)) {
        for (const img of images) {
          if (img.item_id) continue;
          const rawImgUrl = typeof img === "string" ? img : (img.image_url || img.url);
          const imgName = typeof img === "string" ? null : (img.name || img.image_name);
          const imgId = img.id ? img.id : `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const resolvedData = getResolvedData(rawImgUrl);

          if (resolvedData) {
            await client.query(
              `INSERT INTO sketch_plan_images (id, plan_id, item_id, image_url, image_name) 
               VALUES ($1, $2, NULL, $3, $4)
               ON CONFLICT (id) DO UPDATE SET item_id = NULL, image_url = $3, image_name = $4`,
              [imgId, id, resolvedData, imgName]
            );
          }
        }
      }

      // 4. Upsert attachments
      if (attachments && Array.isArray(attachments)) {
        for (const att of attachments) {
          const attId = att.id ? att.id : `att-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const rawAttUrl = att.file_url || att.url;
          const resolvedData = getResolvedData(rawAttUrl);

          if (resolvedData) {
            await client.query(
              `INSERT INTO sketch_plan_attachments (id, plan_id, file_url, file_name, file_type) 
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (id) DO UPDATE SET file_url = $3, file_name = $4, file_type = $5`,
              [attId, id, resolvedData, att.file_name || att.name, att.file_type || att.type]
            );
          }
        }
      }

      await client.query("COMMIT");

      const itemsRes = await client.query(`
        SELECT spi.*
        FROM sketch_plan_items spi
        WHERE spi.plan_id = $1 ORDER BY spi.sort_order ASC, spi.created_at ASC, spi.id ASC`, [id]);
      const imagesRes = await client.query("SELECT id, item_id, image_url, image_name FROM sketch_plan_images WHERE plan_id = $1", [id]);
      const attachmentsRes = await client.query("SELECT id, file_url, file_name, file_type FROM sketch_plan_attachments WHERE plan_id = $1", [id]);

      res.json({
        message: "Sketch plan updated successfully",
        items: itemsRes.rows || [],
        images: (imagesRes.rows || []).map(img => ({
          ...img,
          image_url: img.image_url?.startsWith('http') ? img.image_url : `/api/sketch-images/${img.id}`
        })),
        attachments: (attachmentsRes.rows || []).map(att => ({
          ...att,
          file_url: att.file_url?.startsWith('http') ? att.file_url : `/api/sketch-attachments/${att.id}`
        }))
      });
    } catch (err) {
      if (client) await client.query("ROLLBACK");
      console.error("PUT /api/sketch-plans/:id error", err);
      res.status(500).json({ message: "Failed to update sketch plan" });
    } finally {
      if (client) client.release();
    }
  });

  // DELETE /api/sketch-plans/:id - Delete sketch plan
  app.delete("/api/sketch-plans/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const planRes = await query("SELECT * FROM sketch_plans WHERE id = $1", [id]);
      if (planRes.rows.length === 0) return res.status(404).json({ message: "Plan not found" });

      const archived = await archiveService.archiveItem('sketch_plans', id, planRes.rows[0]);
      if (req.query.action === 'trash' && archived) {
        await archiveService.trashArchiveItem(archived.id);
      }
      res.json({ message: "Sketch plan deleted successfully" });
    } catch (err) {
      console.error("DELETE /api/sketch-plans/:id error", err);
      res.status(500).json({ message: "Failed to delete sketch plan" });
    }
  });

  // POST /api/sketch-plans/:id/lock - Lock
  app.post("/api/sketch-plans/:id/lock", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const lockId = `spl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await query(
        `INSERT INTO sketch_plan_locks (id, plan_id, is_locked, updated_at)
         VALUES ($1, $2, TRUE, NOW())
         ON CONFLICT (plan_id) DO UPDATE SET is_locked = TRUE, updated_at = NOW()`,
        [lockId, id]
      );
      res.json({ message: "Plan locked successfully" });
    } catch (err) {
      console.error("POST /api/sketch-plans/:id/lock error", err);
      res.status(500).json({ message: "Failed to lock plan" });
    }
  });

  // POST /api/sketch-plans/:id/request-unlock - Request unlock
  app.post("/api/sketch-plans/:id/request-unlock", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const lockId = `spl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await query(
        `INSERT INTO sketch_plan_locks (id, plan_id, request_status, request_reason, updated_at)
         VALUES ($1, $2, 'pending', $3, NOW())
         ON CONFLICT (plan_id) DO UPDATE SET request_status = 'pending', request_reason = $3, updated_at = NOW()`,
        [lockId, id, reason || "No reason provided"]
      );
      res.json({ message: "Unlock request submitted" });
    } catch (err) {
      console.error("POST /api/sketch-plans/:id/request-unlock error", err);
      res.status(500).json({ message: "Failed to submit unlock request" });
    }
  });

  // POST /api/sketch-plans/:id/handle-unlock - Admin: approve or reject
  app.post("/api/sketch-plans/:id/handle-unlock", authMiddleware, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { action } = req.body;
      if (action === 'approve') {
        await query(`UPDATE sketch_plan_locks SET is_locked = FALSE, request_status = 'approved', updated_at = NOW() WHERE plan_id = $1`, [id]);
        res.json({ message: "Unlock request approved" });
      } else {
        await query(`UPDATE sketch_plan_locks SET request_status = 'rejected', updated_at = NOW() WHERE plan_id = $1`, [id]);
        res.json({ message: "Unlock request rejected" });
      }
    } catch (err) {
      console.error("POST /api/sketch-plans/:id/handle-unlock error", err);
      res.status(500).json({ message: "Failed to handle unlock request" });
    }
  });

  // POST /api/send-sketch-plan-email
  app.post("/api/send-sketch-plan-email", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { to, planName, pdfBase64, planData } = req.body;
      if (!to || !pdfBase64) return res.status(400).json({ message: "Recipient and PDF content are required" });
      await sendSketchPlanEmail(to, planName || "SketchPlan", pdfBase64, planData);
      res.json({ message: "Email sent successfully" });
    } catch (err) {
      console.error("POST /api/send-sketch-plan-email error", err);
      res.status(500).json({ message: "Failed to send email" });
    }
  });

  // GET /api/sketch-templates - List template metadata (Fast)
  app.get("/api/sketch-templates", authMiddleware, async (req: Request, res: Response) => {
    try {
      // Return only metadata to keep payload small
      const result = await query(`
        SELECT 
          id, 
          name, 
          created_at as last_updated,
          COALESCE(jsonb_array_length((template_data::jsonb)->'items'), 0) as item_count
        FROM sketch_templates 
        ORDER BY created_at DESC
      `);
      res.json({ templates: result.rows || [] });
    } catch (err) {
      console.error("GET /api/sketch-templates error", err);
      res.status(500).json({ message: "Failed to fetch templates" });
    }
  });

  // GET /api/sketch-templates/:id - Fetch full template data (Lazy Load)
  app.get("/api/sketch-templates/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = await query("SELECT * FROM sketch_templates WHERE id = $1", [id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Template not found" });
      }
      res.json({ template: result.rows[0] });
    } catch (err) {
      console.error("GET /api/sketch-templates/:id error", err);
      res.status(500).json({ message: "Failed to fetch template details" });
    }
  });

  // POST /api/sketch-templates - Create template
  app.post("/api/sketch-templates", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { name, template_data } = req.body;
      const id = `skt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await query(`INSERT INTO sketch_templates (id, name, template_data) VALUES ($1, $2, $3)`, [id, name, JSON.stringify(template_data)]);
      res.json({ id, message: "Template saved" });
    } catch (err) {
      console.error("POST /api/sketch-templates error", err);
      res.status(500).json({ message: "Failed to save template" });
    }
  });

  // DELETE /api/sketch-templates/:id - Delete template
  app.delete("/api/sketch-templates/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await query("DELETE FROM sketch_templates WHERE id = $1", [id]);
      res.json({ message: "Template deleted" });
    } catch (err) {
      console.error("DELETE /api/sketch-templates/:id error", err);
      res.status(500).json({ message: "Failed to delete template" });
    }
  });
  // GET /api/sketch-plans/:id/preview-boq - Preview BOQ without saving
  app.get("/api/sketch-plans/:id/preview-boq", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const boqItems = await convertSketchToBoqItems(id);
      res.json({ items: boqItems });
    } catch (err: any) {
      console.error("GET /api/sketch-plans/:id/preview-boq error", err);
      res.status(500).json({ message: err.message || "Failed to generate BOQ preview" });
    }
  });
}