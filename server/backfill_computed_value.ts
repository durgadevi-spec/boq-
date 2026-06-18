/**
 * Backfill script for boq_items.computed_value
 *
 * PURPOSE: Populate the new computed_value column for all pre-existing rows
 * that still have the default value of 0.
 *
 * INVOCATION: Run as a pre-start step in the deploy pipeline.
 *   e.g.  npx ts-node server/backfill_computed_value.ts
 *
 * SAFETY:
 *   - Cursor-based pagination (no OFFSET) — scales to any table size.
 *   - Conditional UPDATE — only touches rows where computed_value = 0 AND
 *     table_data IS NOT NULL, so a concurrent live edit that already wrote
 *     a correct computed_value is never overwritten.
 *   - Post-backfill recalculate — calls recalculateProjectValue for every
 *     distinct (project_id, version_id) pair so that boq_versions.project_value
 *     and boq_projects.project_value are consistent.
 */

import { query } from "./db/client";

// ─── computeItemValue (verbatim copy from routes.ts) ───────────────────────
function computeItemValue(tableData: any): number {
  if (!tableData) return 0;
  let itemSubtotal = 0;
  if (
    tableData.materialLines &&
    tableData.targetRequiredQty !== undefined &&
    tableData.configBasis
  ) {
    const requiredQty = Number(tableData.targetRequiredQty) || 0;
    if (Array.isArray(tableData.materialLines)) {
      const base = Number(tableData.configBasis?.baseRequiredQty || 1);
      tableData.materialLines.forEach((line: any) => {
        if (!line) return;
        const perUnitQty = parseFloat(
          line.perUnitQty || line.qty || line.baseQty || 0,
        );
        const rate = parseFloat(
          line.rate || (line.supplyRate + line.installRate) || 0,
        );
        const scaledPerUnit = base > 0 ? perUnitQty / base : 0;
        itemSubtotal += requiredQty * scaledPerUnit * rate;
      });
    }
    if (Array.isArray(tableData.step11_items)) {
      tableData.step11_items.forEach((item: any) => {
        const qty = parseFloat(item.qty) || 0;
        const supply = parseFloat(item.supply_rate || item.rate || 0);
        const install = parseFloat(item.install_rate) || 0;
        itemSubtotal += qty * (supply + install);
      });
    }
  } else {
    const items = tableData.step11_items || [];
    if (Array.isArray(items)) {
      items.forEach((item: any) => {
        const qty = parseFloat(item.qty) || 0;
        const supply = parseFloat(item.supply_rate || item.rate || 0);
        const install = parseFloat(item.install_rate) || 0;
        itemSubtotal += qty * (supply + install);
      });
    }
  }
  return itemSubtotal;
}

// ─── Main backfill logic ───────────────────────────────────────────────────
const BATCH_SIZE = 500;

async function backfill() {
  console.log("[backfill] Starting computed_value backfill...");

  let lastId = "";
  let totalProcessed = 0;
  let totalUpdated = 0;

  // Phase 1: Cursor-based pagination through all rows
  while (true) {
    const batch = await query(
      `SELECT id, table_data
       FROM boq_items
       WHERE id > $1
       ORDER BY id ASC
       LIMIT $2`,
      [lastId, BATCH_SIZE],
    );

    if (batch.rows.length === 0) break;

    for (const row of batch.rows) {
      let tableData = row.table_data;
      if (!tableData) continue;

      if (typeof tableData === "string") {
        try {
          tableData = JSON.parse(tableData);
        } catch {
          continue;
        }
      }

      const computed = computeItemValue(tableData);

      // Conditional UPDATE: only touch rows where computed_value is still
      // at its default (0) and table_data is present. This prevents
      // overwriting a value that a live edit already wrote.
      const result = await query(
        `UPDATE boq_items
         SET computed_value = $1
         WHERE id = $2
           AND computed_value = 0
           AND table_data IS NOT NULL`,
        [computed, row.id],
      );

      if (result.rowCount && result.rowCount > 0) {
        totalUpdated++;
      }
    }

    lastId = batch.rows[batch.rows.length - 1].id;
    totalProcessed += batch.rows.length;
    console.log(
      `[backfill] Processed ${totalProcessed} rows (${totalUpdated} updated so far), cursor at id="${lastId}"`,
    );
  }

  console.log(
    `[backfill] Phase 1 complete: ${totalProcessed} rows scanned, ${totalUpdated} rows updated.`,
  );

  // Phase 2: Recalculate project_value for every distinct (project_id, version_id)
  console.log("[backfill] Phase 2: Recalculating project values...");

  const pairs = await query(
    `SELECT DISTINCT project_id, version_id
     FROM boq_items
     WHERE project_id IS NOT NULL AND version_id IS NOT NULL`,
  );

  console.log(
    `[backfill] Found ${pairs.rows.length} distinct (project_id, version_id) pairs to recalculate.`,
  );

  // Import archiveService dynamically (same pattern as routes.ts)
  const { archiveService } = await import("./archive_service");

  for (const pair of pairs.rows) {
    try {
      // Inline recalculate logic (mirrors the new recalculateProjectValue in routes.ts)
      const archivedIds = await archiveService.getArchivedItemIds("boq_items");
      const trashedIds = await archiveService.getTrashedItemIds("boq_items");
      const excludedIds = [...archivedIds, ...trashedIds];

      const sumResult = await query(
        `SELECT COALESCE(SUM(computed_value), 0) AS total
         FROM boq_items
         WHERE version_id = $1
         ${excludedIds.length > 0 ? "AND id != ALL($2::text[])" : ""}`,
        excludedIds.length > 0
          ? [pair.version_id, excludedIds]
          : [pair.version_id],
      );
      const totalValue = parseFloat(sumResult.rows[0].total) || 0;

      // Update version's project_value
      await query(
        `UPDATE boq_versions SET project_value = $1, updated_at = NOW() WHERE id = $2`,
        [totalValue.toString(), pair.version_id],
      );

      // Sync the main project value from the "Last Final" version
      const finalVerResult = await query(
        `SELECT project_value
         FROM boq_versions
         WHERE project_id = $1 AND (status = 'approved' OR is_last_final = TRUE)
         ORDER BY is_last_final DESC NULLS LAST, version_number DESC
         LIMIT 1`,
        [pair.project_id],
      );

      let consolidatedValue = totalValue.toString();
      if (finalVerResult.rows.length > 0) {
        consolidatedValue = finalVerResult.rows[0].project_value;
      }
      await query(
        `UPDATE boq_projects SET project_value = $1, updated_at = NOW() WHERE id = $2`,
        [consolidatedValue, pair.project_id],
      );
    } catch (err) {
      console.error(
        `[backfill] Failed to recalculate for project=${pair.project_id} version=${pair.version_id}:`,
        err,
      );
      // Continue with next pair — don't abort the whole backfill
    }
  }

  console.log("[backfill] Phase 2 complete. All project values recalculated.");
  console.log("[backfill] Done.");
}

// Run
backfill()
  .then(() => {
    console.log("[backfill] Exiting successfully.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[backfill] FATAL ERROR:", err);
    process.exit(1);
  });
