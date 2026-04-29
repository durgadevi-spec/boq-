/**
 * BOQ Calculation Engine
 * Single source of truth for all BOQ math — matches Excel BOQ logic.
 *
 * Recipe (ManageProduct) defines structure at a base quantity.
 * Project (CreateBoq) scales to target quantity.
 */

export type UnitType = string;

export type ConfigBasis = {
    requiredUnitType: UnitType;
    baseRequiredQty: number;      // The basis quantity (e.g. 100 Sqft)
    wastagePctDefault?: number;   // e.g. 0.05 for 5%
};

export type MaterialLine = {
    id?: string;
    name?: string;
    unit?: string;
    location?: string;
    baseQty: number;              // Qty entered in config (at basis)
    wastagePct?: number;          // Per-row override; if undefined, use config default
    supplyRate: number;
    installRate: number;
    applyWastage?: boolean;
    applyRounding?: boolean;
    freezeAndEdit?: boolean;
    [key: string]: any; // Preserve extra fields like shop_name, description
};

export type ComputedLine = MaterialLine & {
    wastagePctUsed: number;
    wastageQty: number;
    effectiveQty: number;         // baseQty + wastageQty (at basis)
    perUnitQty: number;           // effectiveQty / baseRequiredQty

    scaledQty: number;            // perUnitQty * targetRequiredQty
    roundOffQty: number;          // Math.ceil(scaledQty)
    supplyAmount: number;         // roundOffQty * supplyRate
    installAmount: number;        // roundOffQty * installRate
    lineTotal: number;            // supplyAmount + installAmount
};

export type BoqResult = {
    computed: ComputedLine[];
    totalSupply: number;
    totalInstall: number;
    grandTotal: number;
    ratePerUnit: number;          // grandTotal / targetRequiredQty
    ratePerSqmt?: number;         // only when unitType === "Sqmt"
};

/**
 * Core calculation function.
 * @param basis  - Config-level settings (unit type, base qty, default wastage)
 * @param lines  - Material rows from the config
 * @param targetRequiredQty - Project quantity (how much is needed in this project)
 */
export function computeBoq(
    basis: ConfigBasis,
    lines: MaterialLine[],
    targetRequiredQty: number,
): BoqResult {
    const base = Number(basis.baseRequiredQty) || 1; // avoid div-by-zero
    const target = Number(targetRequiredQty) || 0;
    // Wastage is ALWAYS stored and entered as a percentage (e.g. 5 = 5%).
    // Always divide by 100 to get the fraction for calculation.
    let defaultW = Number(basis.wastagePctDefault ?? 0) / 100;

    const computed: ComputedLine[] = lines.map((l) => {
        const baseQty = Number(l.baseQty) || 0;
        const applyW = l.applyWastage !== false; // Default to true if undefined
        const applyR = l.applyRounding !== false; // Default to true if undefined

        // Per-row wastage is always a percentage (e.g. 5 = 5%). Divide by 100.
        const rowWRaw = l.wastagePct !== undefined ? Number(l.wastagePct) : NaN;
        const rowW = !isNaN(rowWRaw) ? rowWRaw / 100 : undefined;
        const wastagePctUsed = applyW ? (rowW !== undefined ? rowW : defaultW) : 0;

        const wastageQty = baseQty * wastagePctUsed;
        const isFrozenQty = (l.freezeAndEdit === true || (l as any).freezeAndEdit === "true" || (l as any).freezeAndEdit === 1 || l.freeze_and_edit === true || l.freeze_and_edit === "true" || l.freeze_and_edit === 1);
        const effectiveQtyAtBasis = baseQty + wastageQty;

        // Excel Logic: The rounding happens at the "Basis" level (the recipe).
        // This establishes a fixed "Rounded Qty per Basis Unit" which is then scaled linearly.
        // Example: If 16.5 units are needed for 100 Sqft, we round to 17. 
        // The rate becomes 17/100 = 0.17 per Sqft.
        const roundedQtyAtBasis = applyR ? Math.ceil(effectiveQtyAtBasis) : effectiveQtyAtBasis;
        const perUnitQty = base > 0 ? roundedQtyAtBasis / base : 0;

        const scaledQty = isFrozenQty ? roundedQtyAtBasis : perUnitQty * target;
        const roundOffQty = isFrozenQty ? roundedQtyAtBasis : (applyR ? Math.ceil(scaledQty) : scaledQty);

        const supplyRate = Number(l.supplyRate) || 0;
        const installRate = Number(l.installRate) || 0;

        const supplyAmount = Number((roundOffQty * supplyRate).toFixed(2));
        const installAmount = Number((roundOffQty * installRate).toFixed(2));
        const lineTotal = Number((supplyAmount + installAmount).toFixed(2));

        return {
            ...l,
            wastagePctUsed,
            wastageQty,
            effectiveQty: effectiveQtyAtBasis,
            perUnitQty,
            scaledQty,
            roundOffQty,
            supplyAmount,
            installAmount,
            lineTotal,
        };
    });

    const totalSupply = computed.reduce((s, r) => s + r.supplyAmount, 0);
    const totalInstall = computed.reduce((s, r) => s + r.installAmount, 0);
    const grandTotal = totalSupply + totalInstall;

    const ratePerUnit = target > 0 ? grandTotal / target : 0;

    // Excel: Sqmt rate = Sqft rate * 10.76
    const ratePerSqmt =
        basis.requiredUnitType === "Sqmt" ? ratePerUnit * 10.76 : undefined;

    return { computed, totalSupply, totalInstall, grandTotal, ratePerUnit, ratePerSqmt };
}

/**
 * Helper: build a ConfigBasis from raw table_data (handles missing/old fields gracefully)
 */
export function basisFromTableData(tableData: any): ConfigBasis {
    const basis = tableData?.configBasis || tableData;
    return {
        requiredUnitType: (basis?.requiredUnitType as UnitType) || "Sqft",
        baseRequiredQty: Number(basis?.baseRequiredQty) || 1,
        wastagePctDefault: Number(basis?.wastagePctDefault) || 0,
    };
}

/**
 * Helper: build MaterialLine[] from table_data.lines (snapshot stored in BOQ item)
 * Falls back to step11_items for backward compatibility.
 */
export function linesFromTableData(tableData: any): MaterialLine[] {
    const lines = tableData?.lines || tableData?.materialLines;
    if (Array.isArray(lines) && lines.length > 0) {
        return lines.map((l: any) => ({
            id: l.id || l.material_id,
            name: l.name || l.material_name,
            unit: l.unit,
            location: l.location || "Main Area",
            baseQty: Number(l.baseQty ?? l.qty ?? 0),
            wastagePct: l.wastagePct !== undefined ? Number(l.wastagePct) : undefined,
            supplyRate: Number(l.supplyRate ?? l.supply_rate ?? 0),
            installRate: Number(l.installRate ?? l.install_rate ?? 0),
            shop_name: l.shop_name,
            shop_id: l.shop_id || l.shopId,
            applyWastage: l.apply_wastage !== undefined ? Boolean(l.apply_wastage) : (l.applyWastage !== undefined ? Boolean(l.applyWastage) : true),
            applyRounding: l.apply_rounding !== undefined ? Boolean(l.apply_rounding) : (l.applyRounding !== undefined ? Boolean(l.applyRounding) : true),
            freezeAndEdit: (l.freeze_and_edit === true || l.freeze_and_edit === "true" || l.freeze_and_edit === 1 || l.freezeAndEdit === true || l.freezeAndEdit === "true" || l.freezeAndEdit === 1),
            description: l.description || l.technicalspecification || l.name,
            technicalspecification: l.technicalspecification
        }));
    }
    // Backward compat: old step11_items
    const items = tableData?.step11_items;
    if (Array.isArray(items)) {
        return items.map((item: any) => ({
            id: item.id,
            name: item.title || item.name,
            unit: item.unit,
            location: item.location || "Main Area",
            baseQty: Number(item.qty ?? 0),
            wastagePct: undefined,
            supplyRate: Number(item.supply_rate ?? 0),
            installRate: Number(item.install_rate ?? 0),
            shop_name: item.shop_name || item.shopName,
            shop_id: item.shop_id || item.shopId,
            freezeAndEdit: (item.freeze_and_edit === true || item.freeze_and_edit === "true" || item.freeze_and_edit === 1 || item.freezeAndEdit === true || item.freezeAndEdit === "true" || item.freezeAndEdit === 1)
        }));
    }
    return [];
}