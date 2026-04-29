import { useEffect, useState, useRef, useCallback } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { ChevronUp, ChevronDown, Loader2, CheckCircle2, XCircle, Lock, History, Clock, Briefcase, MapPin, IndianRupee, AlertCircle, FileText, GripVertical, Plus } from "lucide-react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import apiFetch from "@/lib/api";
import { computeBoq, UnitType } from "@/lib/boqCalc";
import { getEstimatorTypeFromProduct } from "@/lib/estimatorUtils";
import ProductPicker from "@/components/ProductPicker";
import MaterialPicker from "@/components/MaterialPicker";
import Step11Preview from "@/components/Step11Preview";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from 'xlsx';

// ─── Types ─────────────────────────────────────────────────────────────────────

type Project = { id: string; name: string; client: string; budget: string; location?: string; status?: string };
type BOMVersion = { id: string; project_id: string; version_number: number; status: "draft" | "submitted" | "pending_approval" | "approved" | "rejected" | "edit_requested"; created_at: string; rejection_reason?: string; updated_at: string; project_name?: string; project_client?: string; project_location?: string };
type BOMItem = { id: string; estimator: string; session_id: string; table_data: any; created_at: string };
type Product = { id: string; name: string; code: string; category?: string; subcategory?: string; description?: string; category_name?: string; subcategory_name?: string; tax_code_type?: string; tax_code_value?: string; hsn_code?: string; sac_code?: string };
type Step11Item = { id?: string; s_no?: number; title?: string; description?: string; unit?: string; qty?: number; supply_rate?: number; install_rate?: number;[key: string]: any };
type BOMHistory = { id: string; version_id: string; user_id: string; user_full_name: string; action: string; reason?: string; created_at: string };

// ─── Helpers ───────────────────────────────────────────────────────

const parseTableData = (raw: any): any => {
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return {}; } }
  return raw || {};
};

const safeJson = async (res: Response): Promise<any> => {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const text = await res.text();
  if (res.status === 204 || !text.trim()) return {};
  if (ct.includes("application/json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try { return JSON.parse(text); } catch { throw new Error("Invalid JSON from server"); }
  }
  throw new Error(`Non-JSON response (${res.status})`);
};

const VERSION_LABEL: Record<string, string> = {
  submitted: "Locked", pending_approval: "Pending Approval", approved: "Approved", rejected: "Rejected", draft: "Draft", edit_requested: "Edit Requested"
};

// ─── Small UI Components ───────────────────────────────────────────────────────

function CodeBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] font-bold text-gray-500 uppercase">{label}:</span>
      <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded border border-gray-200 min-w-[60px]">{value}</span>
    </div>
  );
}

function HsnSacBadges({ tableData }: { tableData: any }) {
  const hsnSacType = tableData.hsn_sac_type || tableData.tax_code_type || "";
  const hsnSacCode = tableData.hsn_sac_code || tableData.tax_code_value || "";

  const hasHsn = tableData.hsn_code || hsnSacType === "hsn";
  const hasSac = tableData.sac_code || hsnSacType === "sac";
  const hasNeither = !tableData.hsn_code && !tableData.sac_code && !hsnSacCode && !tableData.hsn_sac_code;

  return (
    <div className="flex flex-wrap items-center gap-2 mt-1">
      {hasHsn && <CodeBadge label="HSN" value={tableData.hsn_code || (hsnSacType === "hsn" ? hsnSacCode : "") || "—"} />}
      {hasSac && <CodeBadge label="SAC" value={tableData.sac_code || (hsnSacType === "sac" ? hsnSacCode : "") || "—"} />}
      {hasNeither && <CodeBadge label="HSN/SAC" value="—" />}
    </div>
  );
}

function VersionStatusBanner({ version }: { version: BOMVersion }) {
  if (version.status === "submitted") return (
    <div className="bg-yellow-50 border border-yellow-200 rounded p-4 text-sm text-yellow-800 flex items-center gap-2">
      <Lock className="h-4 w-4" /><div><strong>Version Locked.</strong> This version is locked from further edits.</div>
    </div>
  );
  if (version.status === "pending_approval") return (
    <div className="bg-blue-50 border border-blue-200 rounded p-4 text-sm text-blue-800 flex items-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin" /><div><strong>Pending Approval.</strong> This version is being reviewed by admin.</div>
    </div>
  );
  if (version.status === "approved") {
    return (
      <div className="bg-green-50 border border-green-200 rounded p-4 text-sm text-green-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          <div><strong>Approved!</strong> This version has been approved. You can now generate Purchase Orders.</div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="bg-white border-green-200 text-green-700 hover:bg-green-100 h-8 font-bold"
          onClick={async () => {
            if (confirm("Are you sure you want to request approval to edit this BOM?")) {
              try {
                const res = await apiFetch(`/api/boq-versions/${version.id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ status: "edit_requested" })
                });
                if (res.ok) {
                  window.location.reload(); // Simplest way to refresh state
                }
              } catch (err) {
                console.error("Failed to request edit:", err);
              }
            }
          }}
        >
          Request to Edit
        </Button>
      </div>
    );
  }
  if (version.status === "edit_requested") return (
    <div className="bg-indigo-50 border border-indigo-200 rounded p-4 text-sm text-indigo-800 flex items-center gap-2">
      <Clock className="h-4 w-4" /><div><strong>Edit Requested.</strong> Waiting for admin approval to edit this version.</div>
    </div>
  );
  if (version.status === "rejected") return (
    <div className="bg-red-50 border border-red-200 rounded p-4 text-sm text-red-800 space-y-1">
      <div className="flex items-center gap-2"><XCircle className="h-4 w-4" /><strong>Rejected.</strong> This version was rejected.</div>
      {version.rejection_reason && <p className="italic">Reason: {version.rejection_reason}</p>}
      <p className="text-xs font-semibold underline text-blue-700">You can now edit this version and resubmit it for approval.</p>
    </div>
  );
  return null;
}

// ─── BOQ Item Row ─────────────────────────────────────────────────────────────

function BoqItemRow({ item, itemIdx, boqItem, tableData, isEngineBased, isVersionSubmitted,
  getEditedValue, updateEditedField, handleDeleteRow, checkBudgetEarly, handleSaveProject,
  isDraggable, onDragStart, onDragOver, onDrop, isDragOver, isPurchaseTeam }: {
    item: any; itemIdx: number; boqItem: BOMItem; tableData: any; isEngineBased: boolean;
    isVersionSubmitted: boolean; getEditedValue: (k: string, f: string, v: any) => any;
    updateEditedField: (k: string, f: string, v: any) => void;
    handleDeleteRow: (id: string, td: any, idx: number, item?: any) => void;
    checkBudgetEarly: () => Promise<boolean>;
    handleSaveProject: () => Promise<void>;
    isDraggable?: boolean; onDragStart?: () => void;
    onDragOver?: (e: React.DragEvent) => void; onDrop?: () => void;
    isDragOver?: boolean;
    isPurchaseTeam?: boolean;
  }) {
  const itemKey = item.itemKey || `${boqItem.id}-${itemIdx}`;
  const perItemIsEngine = isEngineBased && !item.manual;
  const qty = perItemIsEngine ? (item.qty || 0) : getEditedValue(itemKey, "qty", item.qty || 0);
  const supplyRate = perItemIsEngine ? (item.supply_rate ?? 0) : getEditedValue(itemKey, "supply_rate", item.supply_rate || 0);
  const installRate = perItemIsEngine ? (item.install_rate ?? 0) : getEditedValue(itemKey, "install_rate", item.install_rate || 0);
  const description = perItemIsEngine ? (item.description || "") : getEditedValue(itemKey, "description", item.description || "");
  const unit = perItemIsEngine ? (item.unit || "pcs") : getEditedValue(itemKey, "unit", item.unit || "pcs");
  const editedRate = getEditedValue(itemKey, "rate", undefined);
  const rateVal = perItemIsEngine ? (item.rateSqft ?? (supplyRate + installRate)) : (editedRate ?? (supplyRate + installRate));
  const isLocked = isVersionSubmitted || tableData.is_finalized;

  const ManualBadge = () => item.manual
    ? <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-700 border border-amber-200 uppercase tracking-tighter">Manual</span>
    : null;

  const DeleteBtn = () => isPurchaseTeam ? null : (
    <Button title="Delete" variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-600 hover:text-red-800 hover:bg-red-100 font-bold" disabled={isLocked}
      onClick={() => { if (confirm("Delete this item?")) handleDeleteRow(boqItem.id, tableData, itemIdx, item); }}>🗑</Button>
  );

  const rowClass = `border-b border-gray-100 hover:bg-blue-50/50 ${isDragOver ? "bg-blue-100/60 border-t-2 border-t-blue-400" : ""}`;

  if (perItemIsEngine) return (
    <tr
      className={`${rowClass} text-xs`}
      draggable={isDraggable && !isLocked}
      onDragStart={isDraggable ? onDragStart : undefined}
      onDragOver={isDraggable ? (e) => { e.preventDefault(); onDragOver?.(e); } : undefined}
      onDrop={isDraggable ? onDrop : undefined}
    >
      <td className="border px-1 py-1 text-center bg-gray-50 w-8" style={{ cursor: isLocked || isPurchaseTeam ? "default" : "grab" }} title={isPurchaseTeam ? "" : "Drag to reorder"}>
        {!isPurchaseTeam && <GripVertical className={`h-3.5 w-3.5 mx-auto ${isLocked ? "text-gray-200" : "text-gray-400 hover:text-blue-500"}`} />}
      </td>
      <td className="border px-2 py-1 text-center">{itemIdx + 1}</td>
      <td className="border px-2 py-1 font-medium">{item.title}<ManualBadge /></td>
      <td className="border px-2 py-1 text-gray-600">{item.shop_name || "-"}</td>
      <td className="border px-2 py-1 text-gray-600 truncate max-w-[200px]" title={description}>{description}</td>
      <td className="border px-2 py-1 text-center">{unit}</td>
      <td className="border px-2 py-1 text-center">{(item.qtyPerSqf ?? 0).toFixed(3)}</td>
      <td className="border px-2 py-1 text-center text-blue-600">{(item.requiredQty ?? item.qty ?? 0).toFixed(2)}</td>
      <td className="border px-2 py-1 text-center font-bold">{item.roundOff}</td>
      <td className="border px-2 py-1 text-right">₹{(item.rateSqft || 0).toLocaleString()}</td>
      <td className="border px-2 py-1 text-right font-bold bg-green-50/30">₹{(item.amount || 0).toLocaleString()}</td>
      <td className="border px-2 py-1 text-center"><DeleteBtn /></td>
    </tr>
  );

  return (
    <tr
      className={rowClass}
      draggable={isDraggable && !isLocked}
      onDragStart={isDraggable ? onDragStart : undefined}
      onDragOver={isDraggable ? (e) => { e.preventDefault(); onDragOver?.(e); } : undefined}
      onDrop={isDraggable ? onDrop : undefined}
    >
      <td className="border px-1 py-1 text-center bg-gray-50 w-8" style={{ cursor: isLocked ? "default" : "grab" }} title="Drag to reorder">
        <GripVertical className={`h-3.5 w-3.5 mx-auto ${isLocked ? "text-gray-200" : "text-gray-400 hover:text-blue-500"}`} />
      </td>
      <td className="border px-2 py-1 text-center text-xs">{itemIdx + 1}</td>
      <td className="border px-2 py-1 font-medium text-xs">{item.title || "Item"}<ManualBadge /></td>
      <td className="border px-2 py-1 text-gray-600">{item.shop_name || "-"}</td>
      <td className="border px-2 py-1">
        <textarea value={description} onChange={e => updateEditedField(itemKey, "description", e.target.value)} disabled={isLocked}
          onFocus={checkBudgetEarly}
          onBlur={handleSaveProject}
          className="w-full border rounded px-1 py-0.5 text-xs min-h-[60px] resize-y focus:ring-1 ring-blue-500 outline-none" placeholder="Description" />
      </td>
      <td className="border px-2 py-1">
        <input type="text" value={unit} onChange={e => updateEditedField(itemKey, "unit", e.target.value)} disabled={isLocked}
          onBlur={handleSaveProject}
          className="w-full border rounded px-1 py-0.5 text-xs text-center focus:ring-1 ring-blue-500 outline-none" />
      </td>
      <td className="border px-2 py-1 text-center">
        <input type="number" value={qty} onChange={e => updateEditedField(itemKey, "qty", parseFloat(e.target.value) || 0)} disabled={isLocked}
          onFocus={checkBudgetEarly}
          onBlur={handleSaveProject}
          className="w-full border rounded px-1 py-0.5 text-xs text-center font-medium focus:ring-1 ring-blue-500 outline-none" />
      </td>
      <td className="border px-2 py-1 text-center text-blue-600">{(getEditedValue(itemKey, "qty", item.qty || 0) || 0).toFixed(2)}</td>
      <td className="border px-2 py-1 font-bold text-center">-</td>
      <td className="border px-1 py-1">
        <input type="number" value={rateVal} disabled={isLocked}
          onFocus={checkBudgetEarly}
          onBlur={handleSaveProject}
          onChange={e => { const v = parseFloat(e.target.value) || 0; updateEditedField(itemKey, "rate", v); updateEditedField(itemKey, "supply_rate", v); updateEditedField(itemKey, "install_rate", 0); }}
          className="w-full border rounded px-1 py-0.5 text-xs text-right focus:ring-1 ring-blue-500 outline-none" placeholder="Rate" />
      </td>
      <td className="border px-1 py-1 text-right text-xs bg-gray-50/50 font-bold">₹{(qty * (rateVal || 0)).toFixed(2)}</td>
      <td className="border px-2 py-1 text-center"><DeleteBtn /></td>
    </tr>
  );
}


// ─── BOQ Item Card ─────────────────────────────────────────────────────────────

function BoqItemCard({ boqItem, boqIdx, isVersionSubmitted, expandedProductIds, setExpandedProductIds, getEditedValue, updateEditedField, handleDeleteRow, handleFinalizeProduct, handleAddItem, loadBoqItemsAndEdits, setBoqItems, checkBudgetEarly, handleSaveProject, isPurchaseTeam }: {
  boqItem: BOMItem; boqIdx: number; isVersionSubmitted: boolean;
  expandedProductIds: Set<string>; setExpandedProductIds: (fn: (p: Set<string>) => Set<string>) => void;
  getEditedValue: (k: string, f: string, v: any) => any;
  updateEditedField: (k: string, f: string, v: any) => void;
  handleDeleteRow: (id: string, td: any, idx: number, item?: any) => void;
  handleFinalizeProduct: (id: string) => void;
  handleAddItem: (id: string) => void;
  loadBoqItemsAndEdits: () => void;
  setBoqItems: React.Dispatch<React.SetStateAction<BOMItem[]>>;
  checkBudgetEarly: () => Promise<boolean>;
  handleSaveProject: () => Promise<void>;
  isPurchaseTeam?: boolean;
}) {
  const tableData = parseTableData(boqItem.table_data);
  const step11Items = Array.isArray(tableData.step11_items) ? tableData.step11_items : [];
  const productName = tableData.product_name || boqItem.estimator;
  const isExpanded = expandedProductIds.has(boqItem.id);
  const toggle = () => setExpandedProductIds((prev: Set<string>) => { const n = new Set(prev); n.has(boqItem.id) ? n.delete(boqItem.id) : n.add(boqItem.id); return n; });

  // Drag state for row reorder
  const dragIdxRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // local ordered items state for drag reorder (non-engine)
  const [localItems, setLocalItems] = useState<any[]>([]);
  const [reorderInit, setReorderInit] = useState(false);

  let displayLines: any[] = step11Items;
  let isEngineBased = false;

  if (tableData.materialLines && tableData.targetRequiredQty !== undefined) {
    isEngineBased = true;
    const boqResult = computeBoq({ ...tableData.configBasis, wastagePctDefault: 0 }, tableData.materialLines.map((l: any) => ({ ...l, applyWastage: false })), tableData.targetRequiredQty);
    const computedLines = boqResult.computed.map((line: any, idx: number) => {
      const itemKey = `${boqItem.id}-engine-${idx}`;
      const qty = Number(getEditedValue(itemKey, "qty", line.perUnitQty));
      const sRate = Number(getEditedValue(itemKey, "supply_rate", line.supplyRate));
      const iRate = Number(getEditedValue(itemKey, "install_rate", line.installRate));
      const rate = Number(getEditedValue(itemKey, "rate", sRate + iRate)) || (sRate + iRate);
      const reqQty = Number((qty * (tableData.targetRequiredQty || 1)).toFixed(2));
      const applyR = line.apply_rounding !== undefined ? Boolean(line.apply_rounding) : (line.applyRounding !== undefined ? Boolean(line.applyRounding) : true);
      const roundOff = applyR ? Math.ceil(reqQty) : reqQty;
      return {
        title: line.name, description: line.name, unit: line.unit, shop_name: line.shop_name,
        qtyPerSqf: qty, requiredQty: reqQty, roundOff: roundOff,
        rateSqft: rate, amount: Number((roundOff * rate).toFixed(2)), s_no: idx + 1, manual: false,
        _materialIdx: idx, itemKey
      };
    });
    const manualStep11 = step11Items.map((it: any, s11Idx: number) => {
      if (!it?.manual) return null;
      const itemKey = `${boqItem.id}-manual-${s11Idx}`;
      const qty = Number(getEditedValue(itemKey, "qty", it.qty ?? 0)) || 0;
      const sRate = Number(getEditedValue(itemKey, "supply_rate", it.supply_rate ?? 0)) || 0;
      const iRate = Number(getEditedValue(itemKey, "install_rate", it.install_rate ?? 0)) || 0;
      const rate = Number(getEditedValue(itemKey, "rate", sRate + iRate)) || (sRate + iRate);
      return { ...it, manual: true, itemKey, _s11Idx: s11Idx, qtyPerSqf: it.qtyPerSqf ?? 0, supply_rate: sRate, install_rate: iRate, amount: Number((qty * rate).toFixed(2)) };
    }).filter(Boolean);
    displayLines = [...computedLines, ...manualStep11];
  } else {
    displayLines = step11Items.map((it: any, s11Idx: number) => {
      const itemKey = it.itemKey || `${boqItem.id}-${s11Idx}`;
      const qty = Number(getEditedValue(itemKey, "qty", it.qty ?? 0)) || 0;
      const sRate = Number(getEditedValue(itemKey, "supply_rate", it.supply_rate ?? 0)) || 0;
      const iRate = Number(getEditedValue(itemKey, "install_rate", it.install_rate ?? 0)) || 0;
      const rate = Number(getEditedValue(itemKey, "rate", sRate + iRate)) || (sRate + iRate);
      return { ...it, itemKey, _s11Idx: s11Idx, qty, rateSqft: rate, amount: Number((qty * rate).toFixed(2)) };
    });
  }

  // Sync localItems when displayLines change from outside (add/delete/save)
  useEffect(() => {
    setLocalItems(displayLines);
    setReorderInit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step11Items.length, isEngineBased, boqItem.id, tableData.materialLines?.length, boqItem.table_data]);

  // use localItems for rendering always (gives immediate reorder feedback)
  const renderLines = (reorderInit ? localItems : displayLines);

  const handleRowReorder = async (newOrder: any[]) => {
    setLocalItems(newOrder);

    // Prepare updated data structures for persistence
    let updatedTd = { ...tableData };

    if (isEngineBased) {
      // Reorder materialLines for engine products
      const newMaterialLines = newOrder
        .filter(item => item._materialIdx !== undefined)
        .map(item => tableData.materialLines[item._materialIdx]);

      // Reorder step11_items for manual products within engine project
      const newStep11 = newOrder
        .filter(item => item._s11Idx !== undefined)
        .map(item => step11Items[item._s11Idx]);

      updatedTd = { ...updatedTd, materialLines: newMaterialLines, step11_items: newStep11 };
    } else {
      // Reorder step11_items for non-engine products
      const newStep11 = newOrder.map(item => {
        const origIdx = item._s11Idx;
        return origIdx !== undefined ? step11Items[origIdx] : item;
      });
      updatedTd = { ...updatedTd, step11_items: newStep11 };
    }

    try {
      const resp = await apiFetch(`/api/boq-items/${boqItem.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table_data: updatedTd }),
      });
      if (resp.ok) {
        setBoqItems((prev: BOMItem[]) => prev.map((i: BOMItem) => i.id === boqItem.id ? { ...i, table_data: updatedTd } : i));
      }
    } catch (err) {
      console.error("Failed to save row order", err);
    }
  };


  const totalAmount = displayLines.reduce((sum: number, it: any) => sum + (Number(it.amount) || 0), 0);
  const ratePerUnit = totalAmount / (tableData.targetRequiredQty || (Number(displayLines[0]?.qty) || Number(step11Items[0]?.qty) || 1));

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gray-100 px-4 py-3 flex justify-between items-center border-b border-gray-200">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 font-semibold text-sm text-gray-800">
            {boqIdx + 1}. {productName}
            {tableData.category && <span className="text-xs text-gray-500 font-normal">({tableData.category})</span>}
            {tableData.is_finalized && <span className="inline-block bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs font-semibold ml-2">Finalized</span>}
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 ml-1" title={isExpanded ? "Collapse" : "Expand"} onClick={toggle}>
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                placeholder="Enter product description..."
                className="h-8 text-xs w-full max-w-md mt-1"
                defaultValue={tableData.finalize_description || ""}
                disabled={isVersionSubmitted}
                onFocus={checkBudgetEarly}
                onBlur={async e => {
                  const newDesc = e.target.value;
                  if (newDesc === (tableData.finalize_description || "")) return;
                  try {
                    const updatedTd = { ...tableData, finalize_description: newDesc };
                    const resp = await apiFetch(`/api/boq-items/${boqItem.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table_data: updatedTd }) });
                    if (resp.ok) { setBoqItems((prev: BOMItem[]) => prev.map((i: BOMItem) => i.id === boqItem.id ? { ...i, table_data: updatedTd } : i)); }
                  } catch (err) { console.error("Failed to save description", err); }
                }}
              />
              <HsnSacBadges tableData={tableData} />
            </div>
            {isEngineBased && (
              <div className="flex items-center gap-2 text-[11px] text-gray-600 font-medium">
                Project Target: <span className="text-blue-600 font-bold">{tableData.targetRequiredQty} {tableData.configBasis?.requiredUnitType}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          {!isPurchaseTeam && !tableData.is_finalized && (
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={isVersionSubmitted} onClick={() => handleAddItem(boqItem.id)}>+ Add Item</Button>
          )}
          {!isPurchaseTeam && (
            <Button variant="default" size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white" disabled={isVersionSubmitted || tableData.is_finalized} onClick={() => handleFinalizeProduct(boqItem.id)}>Finalize</Button>
          )}
          {!isPurchaseTeam && (
            <Button variant="destructive" size="sm" className="h-7 text-xs" disabled={isVersionSubmitted}
              onClick={async () => {
                if (!confirm("Delete this product and all its items?")) return;
                try { await apiFetch(`/api/boq-items/${boqItem.id}`, { method: "DELETE" }); loadBoqItemsAndEdits(); } catch { /* handled */ }
              }}>Delete Product</Button>
          )}
        </div>
      </div>

      {/* Items Table */}
      {isExpanded && (
        <>
          <div className="overflow-x-auto">
            <table className="border-collapse text-xs min-w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="border px-1 py-2 text-center w-8 text-gray-400" title="Drag to reorder"><GripVertical className="h-3 w-3 mx-auto" /></th>
                  <th className="border px-2 py-2 text-left font-semibold w-10">Sl</th>
                  <th className="border px-2 py-2 text-left font-semibold w-64">Item</th>
                  <th className="border px-2 py-2 text-left font-semibold w-32">Shop</th>
                  <th className="border px-2 py-2 text-left font-semibold w-[300px]">Description</th>
                  <th className="border px-2 py-2 text-center font-semibold w-16">Unit</th>
                  <th className="border px-2 py-2 text-center font-semibold w-20">Qty/{tableData.configBasis?.requiredUnitType || "Sqf"}</th>
                  <th className="border px-2 py-2 text-center font-semibold w-24">Required Qty</th>
                  <th className="border px-2 py-2 text-center font-semibold w-24">Round off</th>
                  <th className="border px-2 py-2 text-center font-semibold w-24">Rate/{tableData.configBasis?.requiredUnitType || "Unit"}</th>
                  <th className="border px-2 py-2 text-center font-semibold w-28 text-green-700">Amount</th>
                  <th className="border px-2 py-2 text-center font-semibold w-16">Action</th>
                </tr>
              </thead>
              <tbody>
                {renderLines.length === 0
                  ? <tr><td colSpan={12} className="text-center py-4 text-gray-500 italic">No items. Click "+ Add Item" to add one.</td></tr>
                  : renderLines.map((item: any, itemIdx: number) => (
                    <BoqItemRow
                      key={item.itemKey || `${boqItem.id}-${itemIdx}`}
                      item={item} itemIdx={itemIdx} boqItem={boqItem}
                      tableData={tableData} isEngineBased={isEngineBased} isVersionSubmitted={isVersionSubmitted}
                      getEditedValue={getEditedValue} updateEditedField={updateEditedField}
                      handleDeleteRow={handleDeleteRow} checkBudgetEarly={checkBudgetEarly}
                      handleSaveProject={handleSaveProject}
                      isDraggable={!isVersionSubmitted && !tableData.is_finalized && !isPurchaseTeam}
                      isPurchaseTeam={isPurchaseTeam}
                      isDragOver={dragOverIdx === itemIdx}
                      onDragStart={() => { dragIdxRef.current = itemIdx; }}
                      onDragOver={() => setDragOverIdx(itemIdx)}
                      onDrop={() => {
                        setDragOverIdx(null);
                        const from = dragIdxRef.current;
                        if (from === null || from === itemIdx) return;
                        dragIdxRef.current = null;
                        const newOrder = [...renderLines];
                        const [moved] = newOrder.splice(from, 1);
                        newOrder.splice(itemIdx, 0, moved);
                        handleRowReorder(newOrder);
                      }}
                    />
                  ))
                }
              </tbody>
              <tfoot className="bg-gray-50/50 font-bold border-t-2 border-gray-200">
                <tr>
                  <td colSpan={10} className="border px-2 py-1.5 text-right uppercase tracking-wider text-[10px] text-gray-500">Total</td>
                  <td className="border px-2 py-1.5 text-right text-green-700 bg-green-50/50">₹{totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="border px-2 py-1.5"></td>
                </tr>
              </tfoot>
            </table>
          </div>
          {(isEngineBased || step11Items.length > 0) && (
            <div className="bg-gray-50 px-4 py-2 flex justify-end border-t border-gray-200">
              <div className="flex items-center gap-4">
                <span className="text-xs font-bold text-gray-500 uppercase">Rate per {tableData.configBasis?.requiredUnitType || "Unit"}:</span>
                <span className="text-sm font-extrabold text-blue-700 border-b-2 border-blue-600">₹{ratePerUnit.toFixed(2)}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function HistorySection({ history }: { history: BOMHistory[] }) {
  if (history.length === 0) return null;

  const getActionStyles = (action: string) => {
    switch (action) {
      case "submitted": return "bg-blue-100 text-blue-700";
      case "approved": return "bg-green-100 text-green-700";
      case "rejected": return "bg-red-100 text-red-700";
      case "edited": return "bg-amber-100 text-amber-700";
      default: return "bg-gray-100 text-gray-700";
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Approval & Activity History</h3>
      <div className="space-y-3">
        {history.map((h) => (
          <div key={h.id} className="flex gap-3 text-xs border-l-2 border-gray-200 pl-4 py-1 relative">
            <div className="absolute -left-[5px] top-2 w-[8px] h-[8px] rounded-full bg-gray-300 border border-white" />
            <div className="flex-1">
              <div className="flex justify-between items-center mb-1">
                <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[9px] ${getActionStyles(h.action)}`}>
                  {h.action}
                </span>
                <span className="text-gray-400 font-medium">
                  {new Date(h.created_at).toLocaleString()}
                </span>
              </div>
              <div className="text-gray-800">
                <span className="font-bold">{h.user_full_name}</span> {h.action === 'edited' ? 'saved a draft' : `${h.action} this PO`}
                {h.reason && (
                  <div className="mt-1 p-2 bg-gray-50 rounded border border-gray-100 italic text-gray-600">
                    Reason: {h.reason}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function GeneratePo() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [boqItems, setBoqItems] = useState<BOMItem[]>([]);
  const [versions, setVersions] = useState<BOMVersion[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [history, setHistory] = useState<BOMHistory[]>([]);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [showMaterialPicker, setShowMaterialPicker] = useState(false);
  const [showStep11Preview, setShowStep11Preview] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [targetQtyModalOpen, setTargetQtyModalOpen] = useState(false);
  const [targetRequiredQty, setTargetRequiredQty] = useState<number>(1);
  const [pendingItems, setPendingItems] = useState<Step11Item[]>([]);
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(new Set());
  const [targetBoqItemId, setTargetBoqItemId] = useState<string | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [editedFields, setEditedFields] = useState<Record<string, any>>({});
  const [isGeneratingPO, setIsGeneratingPO] = useState(false);
  const [isPOModalOpen, setIsPOModalOpen] = useState(false);
  const [previewVendors, setPreviewVendors] = useState<any[]>([]);
  const [isLoadingVendors, setIsLoadingVendors] = useState(false);
  const [loading, setLoading] = useState(true);
  // Budget warning/modals removed for Generate BOM page per request
  const editedFieldsRef = useRef(editedFields);
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const isPurchaseTeam = user?.role === 'purchase_team';

  const handleOpenPOModal = async () => {
    if (!selectedVersionId) return;
    setIsPOModalOpen(true);
    setIsLoadingVendors(true);
    try {
      const res = await apiFetch(`/api/purchase-orders/preview-vendors?versionId=${selectedVersionId}`);
      if (res.ok) {
        const data = await res.json();
        setPreviewVendors(data.vendors || []);
      }
    } catch (err) {
      console.error("Failed to fetch preview vendors", err);
    } finally {
      setIsLoadingVendors(false);
    }
  };

  const handleGeneratePO = async () => {
    if (!selectedVersionId || isGeneratingPO) return;

    setIsGeneratingPO(true);
    try {
      // 1. Check if already generated
      const checkRes = await apiFetch(`/api/purchase-orders/check-existence?versionId=${selectedVersionId}`);
      if (checkRes.ok) {
        const { exists } = await checkRes.json();
        if (exists) {
          const proceed = window.confirm("Annexures have already been generated for this version. Do you want to generate them again?");
          if (!proceed) {
            setIsGeneratingPO(false);
            return;
          }
        }
      }

      // 2. Generate
      const res = await apiFetch("/api/purchase-orders/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProjectId,
          versionId: selectedVersionId,
          versionNumber: selectedVersion?.version_number
        }),
      });
      if (res.ok) {
        toast({ title: "Success", description: "Annexures generated successfully!" });
      } else {
        const err = await res.json();
        toast({ title: "Error", description: err.message || "Failed to generate Annexures", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to generate Annexures", variant: "destructive" });
    } finally {
      setIsGeneratingPO(false);
    }
  };

  useEffect(() => { editedFieldsRef.current = editedFields; }, [editedFields]);

  // Auto-expand new products
  useEffect(() => {
    setExpandedProductIds((prev: Set<string>) => { const n = new Set(prev); boqItems.forEach((it: BOMItem) => n.add(it.id)); return n; });
  }, [boqItems]);

  // Load projects
  useEffect(() => {
    apiFetch("/api/boq-projects", { headers: {} })
      .then(r => r.ok ? r.json() : null)
      .then(async d => {
        if (!d) return;
        let projectList = d.projects || [];

        if (isPurchaseTeam) {
          // For purchase team, only show projects that have at least one approved version
          const filtered = [];
          for (const p of projectList) {
            try {
              const vRes = await apiFetch(`/api/boq-versions/${encodeURIComponent(p.id)}`);
              if (vRes.ok) {
                const vData = await vRes.json();
                const hasApproved = (vData.versions || []).some((v: any) => v.status === 'approved');
                if (hasApproved) filtered.push(p);
              }
            } catch (err) { console.error(err); }
          }
          projectList = filtered;
        }

        setProjects(projectList);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [isPurchaseTeam]);

  // Load versions when project changes
  useEffect(() => {
    if (!selectedProjectId) { setVersions([]); setSelectedVersionId(null); setBoqItems([]); return; }
    apiFetch(`/api/boq-versions/${encodeURIComponent(selectedProjectId)}`, { headers: {} })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        let list: BOMVersion[] = data.versions || [];

        if (isPurchaseTeam) {
          list = list.filter(v => v.status === 'approved');
        }

        setVersions(list);
        setSelectedVersionId((prev: string | null) => {
          if (prev && list.some((v: BOMVersion) => v.id === prev)) return prev;
          if (isPurchaseTeam) return list[0]?.id ?? null;
          const draft = list.find((v: BOMVersion) => v.status === "draft");
          return draft?.id ?? list[0]?.id ?? null;
        });
      })
      .catch(console.error);
  }, [selectedProjectId, isPurchaseTeam]);

  // Load History
  const loadHistory = useCallback(async () => {
    if (!selectedVersionId) { setHistory([]); return; }
    try {
      const res = await apiFetch(`/api/boq-versions/${encodeURIComponent(selectedVersionId)}/history`, { headers: {} });
      if (res.ok) {
        const data = await res.json();
        setHistory(data.history || []);
      }
    } catch (err) {
      console.error("Failed to load history", err);
    }
  }, [selectedVersionId]);

  // Load BOQ items
  const loadBoqItemsAndEdits = useCallback(async () => {
    if (!selectedVersionId) return;
    try {
      const res = await apiFetch(`/api/boq-items/version/${encodeURIComponent(selectedVersionId)}`, { headers: {} });
      if (!res.ok) { toast({ title: "Error", description: `Failed to load items (${res.status})`, variant: "destructive" }); return; }
      const data = await safeJson(res as unknown as Response);
      const items: BOMItem[] = data.items || [];
      // Backfill HSN/SAC
      try {
        const pr = await apiFetch("/api/products");
        if (pr.ok) {
          const pd = await pr.json();
          const byId: Record<string, any> = Object.fromEntries((pd.products || []).map((p: any) => [p.id, p]));
          items.forEach(item => {
            const td = parseTableData(item.table_data);
            if (td.product_id && !td.hsn_code && !td.sac_code) {
              const prod = byId[td.product_id];
              if (prod) {
                if (prod.hsn_code) td.hsn_code = prod.hsn_code;
                if (prod.sac_code) td.sac_code = prod.sac_code;
                if (prod.tax_code_value) { td.hsn_sac_code = prod.tax_code_value; td.hsn_sac_type = prod.tax_code_type || null; }
                item.table_data = td;
              }
            }
          });
        }
      } catch { /* ignore */ }
      setBoqItems(items);
    } catch { toast({ title: "Error", description: "Failed to load BOQ items", variant: "destructive" }); }
  }, [selectedVersionId]);

  useEffect(() => {
    if (!selectedVersionId) { setBoqItems([]); setEditedFields({}); editedFieldsRef.current = {}; return; }
    loadBoqItemsAndEdits();
    loadHistory();
  }, [selectedVersionId, loadBoqItemsAndEdits, loadHistory]);

  // Auto-select project from URL
  useEffect(() => {
    try {
      const qs = typeof location === "string" ? location.split("?")[1] || "" : "";
      const projectParam = new URLSearchParams(qs).get("project");
      if (projectParam && projectParam !== selectedProjectId && projects.find(p => p.id === projectParam))
        setSelectedProjectId(projectParam);
    } catch { /* ignore */ }
  }, [location, projects]);

  // ── Field helpers ──────────────────────────────────────────────────────────

  const updateEditedField = (itemKey: string, field: string, value: any) => {
    setEditedFields((prev: Record<string, any>) => { const next = { ...prev, [itemKey]: { ...prev[itemKey], [field]: value } }; editedFieldsRef.current = next; return next; });
  };

  const getEditedValue = (itemKey: string, field: string, original: any) =>
    editedFields[itemKey]?.[field] ?? original;

  // ── Budget Helpers ──────────────────────────────────────────────────────────

  const calculateCurrentProjectValue = () => {
    // Sum amounts as displayed in the BOQ items table to ensure UI budget matches totals
    return boqItems.reduce((acc, bi) => {
      let total = 0;
      const td = parseTableData(bi.table_data);
      const step11 = Array.isArray(td.step11_items) ? td.step11_items : [];

      if (td.materialLines && td.targetRequiredQty !== undefined) {
        try {
          const res = computeBoq({ ...td.configBasis, wastagePctDefault: 0 }, td.materialLines.map((l: any) => ({ ...l, applyWastage: false })), td.targetRequiredQty);
          if (Array.isArray(res.computed)) {
            res.computed.forEach((l: any) => {
              const lineAmount = Number(l.lineTotal ?? ((Number(l.scaledQty) || 0) * (Number(l.supplyRate) + Number(l.installRate)))) || 0;
              total += lineAmount;
            });
          }
        } catch { }
        // include manual step11 items (user-added) which are displayed below computed lines
        step11.filter((i: any) => i.manual).forEach((i: any, idx: number) => {
          const key = i.itemKey || `${bi.id}-manual-${i._s11Idx ?? idx}`;
          const qty = Number(getEditedValue(key, "qty", i.qty ?? 0)) || 0;
          const sr = Number(getEditedValue(key, "supply_rate", i.supply_rate ?? 0)) || 0;
          const ir = Number(getEditedValue(key, "install_rate", i.install_rate ?? 0)) || 0;
          const amt = Number(i.amount ?? (qty * (sr + ir))) || 0;
          total += amt;
        });
      } else {
        step11.forEach((it: any, idx: number) => {
          const key = it.itemKey || `${bi.id}-${idx}`;
          const qty = Number(getEditedValue(key, "qty", it.qty ?? 0)) || 0;
          const sr = Number(getEditedValue(key, "supply_rate", it.supply_rate ?? 0)) || 0;
          const ir = Number(getEditedValue(key, "install_rate", it.install_rate ?? 0)) || 0;
          const amt = Number(it.amount ?? (qty * (sr + ir))) || 0;
          total += amt;
        });
      }

      return acc + total;
    }, 0);
  };

  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const selectedVersion = versions.find(v => v.id === selectedVersionId);

  const projectBudget = parseFloat(selectedProject?.budget || "0");
  const currentProjectValue = calculateCurrentProjectValue();
  // Simplify budget checks on Generate PO page: always allow actions (no warnings)
  const isExceeded = false;
  const withBudgetCheck = (_getFutureValue: () => number, action: () => Promise<void>) => {
    return async () => { await action(); };
  };
  const checkBudgetEarly = async () => false;

  // ── API helpers ────────────────────────────────────────────────────────────

  const updateBoqItem = (id: string, tableData: any) =>
    apiFetch(`/api/boq-items/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table_data: tableData }) });

  const resolveMaterialFields = async (template: any) => {
    let unit = template.unit || template.uom || "pcs";
    let rate = Number(template.rate ?? template.supply_rate ?? template.default_rate ?? 0) || 0;
    let shopName = template.shop_name || template.shopName || "";
    let hsnSacType = template.tax_code_type || template.taxCodeType || null;
    let hsnSacCode = template.tax_code_value || template.taxCodeValue || "";

    if (template.id) {
      try {
        const r = await apiFetch(`/api/materials/${encodeURIComponent(template.id)}`);
        if (r.ok) {
          const d = await r.json();
          const m = d.material || d;
          unit = m.unit || unit;
          rate = Number(m.rate ?? m.supply_rate ?? rate) || rate;
          shopName = m.shop_name || m.shopName || shopName;
          hsnSacType = m.tax_code_type || m.taxCodeType || hsnSacType;
          hsnSacCode = m.tax_code_value || m.taxCodeValue || hsnSacCode;
        }
      } catch { /* ignore */ }
    }
    return { unit, rate, shopName, hsnSacType, hsnSacCode };
  };

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAddProduct = async () => {
    if (await checkBudgetEarly()) return;
    setShowProductPicker(true);
  };
  const handleAddProductManual = async () => {
    if (await checkBudgetEarly()) return;
    setTargetBoqItemId(null);
    setShowMaterialPicker(true);
  };
  const handleSelectProduct = (product: Product) => { setSelectedProduct(product); setShowStep11Preview(true); };
  const handleAddItem = (boqItemId: string) => { setTargetBoqItemId(boqItemId); setShowMaterialPicker(true); };

  const handleSelectMaterialTemplate = async (template: any) => {
    if (targetBoqItemId) { await handleAddItemToProduct(targetBoqItemId, template); setTargetBoqItemId(null); }
    else { await handleAddMaterialToBoq(template); }
  };

  const handleAddMaterialToBoq = async (template: any) => {
    const rate = Number(template.rate ?? template.supply_rate ?? template.default_rate ?? 0) || 0;
    const futureVal = currentProjectValue + rate;
    await withBudgetCheck(() => futureVal, async () => {
      if (!selectedProjectId || !selectedVersionId) { toast({ title: "Error", description: "Select a project and version first", variant: "destructive" }); return; }
      try {
        const { unit, rate, shopName, hsnSacType, hsnSacCode } = await resolveMaterialFields(template);
        const materialItem = {
          title: template.name,
          description: template.technicalspecification || template.technicalSpecification || template.name,
          unit,
          qty: 1,
          supply_rate: rate,
          install_rate: 0,
          location: "Main Area",
          s_no: 1,
          shop_name: shopName,
          hsn_code: hsnSacType === "HSN" ? hsnSacCode : null,
          sac_code: hsnSacType === "SAC" ? hsnSacCode : null,
        };
        const res = await apiFetch("/api/boq-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: selectedProjectId,
            version_id: selectedVersionId,
            estimator: `material_${template.id}`,
            table_data: {
              product_name: template.name,
              step11_items: [materialItem],
              hsn_sac_type: hsnSacType,
              hsn_sac_code: hsnSacCode,
              finalize_description: materialItem.description
            }
          })
        });
        if (!res.ok) throw new Error(`${res.status}`);
        toast({ title: "Success", description: `Added ${template.name} to Annexure` });
        loadBoqItemsAndEdits();
      } catch { toast({ title: "Error", description: "Failed to add material", variant: "destructive" }); }
    })();
  };

  const handleAddItemToProduct = async (boqItemId: string, template: any) => {
    const rate = Number(template.rate ?? template.supply_rate ?? template.default_rate ?? 0) || 0;
    const futureVal = currentProjectValue + rate;
    await withBudgetCheck(() => futureVal, async () => {
      try {
        const existing = boqItems.find(i => i.id === boqItemId);
        if (!existing) throw new Error("Product group not found");
        const tableData = parseTableData(existing.table_data);
        const currentStep11 = Array.isArray(tableData.step11_items) ? tableData.step11_items : [];
        const { unit, rate, shopName, hsnSacType, hsnSacCode } = await resolveMaterialFields(template);
        const newItem: Step11Item = {
          title: template.name,
          description: template.technicalspecification || template.technicalSpecification || template.name,
          unit,
          qty: 1,
          supply_rate: rate,
          install_rate: 0,
          location: template.location || "Main Area",
          s_no: currentStep11.length + 1,
          shop_name: shopName,
          hsn_code: hsnSacType === "HSN" ? hsnSacCode : null,
          sac_code: hsnSacType === "SAC" ? hsnSacCode : null,
        } as any;
        const updatedTableData = tableData.materialLines && tableData.targetRequiredQty !== undefined
          ? { ...tableData, step11_items: [...currentStep11, { ...newItem, manual: true }] }
          : { ...tableData, step11_items: [...currentStep11, newItem], hsn_sac_type: hsnSacType, hsn_sac_code: hsnSacCode };
        if (!tableData.hsn_sac_type && !tableData.hsn_sac_code && (hsnSacType || hsnSacCode)) {
          updatedTableData.hsn_sac_type = hsnSacType;
          updatedTableData.hsn_sac_code = hsnSacCode;
        }
        if (!tableData.finalize_description || tableData.finalize_description.trim() === "") {
          updatedTableData.finalize_description = newItem.description;
        }
        setBoqItems(prev => prev.map(i => i.id === boqItemId ? { ...i, table_data: updatedTableData } : i));
        const res = await updateBoqItem(boqItemId, updatedTableData);
        if (!res.ok) throw new Error("Failed to update");
        toast({ title: "Success", description: `Added ${template.name}` });
        loadBoqItemsAndEdits();
      } catch { toast({ title: "Error", description: "Failed to add item", variant: "destructive" }); }
    })();
  };

  const handleFinalizeProduct = async (boqItemId: string) => {
    if (!confirm("Mark this product as finalized?")) return;
    try {
      const existing = boqItems.find(i => i.id === boqItemId);
      if (!existing) return;
      const newTd = { ...parseTableData(existing.table_data), is_finalized: true };
      setBoqItems(prev => prev.map(i => i.id === boqItemId ? { ...i, table_data: newTd } : i));
      await updateBoqItem(boqItemId, newTd);
      toast({ title: "Success", description: "Product finalized" });
      loadBoqItemsAndEdits();
    } catch { toast({ title: "Error", description: "Failed to finalize", variant: "destructive" }); }
  };

  const handleDeleteRow = async (boqItemId: string, tableData: any, itemIdx: number, displayItem?: any) => {
    try {
      let computedLen = 0;
      if (tableData?.materialLines && tableData.targetRequiredQty !== undefined) {
        try { const r = computeBoq({ ...tableData.configBasis, wastagePctDefault: 0 }, tableData.materialLines.map((l: any) => ({ ...l, applyWastage: false })), tableData.targetRequiredQty); computedLen = Array.isArray(r.computed) ? r.computed.length : 0; }
        catch { computedLen = Array.isArray(tableData.materialLines) ? tableData.materialLines.length : 0; }
      }
      let newTd = { ...tableData };
      if (itemIdx < computedLen) {
        const ml = [...(tableData.materialLines || [])]; ml.splice(itemIdx, 1); newTd = { ...tableData, materialLines: ml };
      } else {
        const s11Idx = displayItem?._s11Idx ?? (itemIdx - computedLen);
        const s11 = [...(tableData.step11_items || [])]; if (s11Idx >= 0 && s11Idx < s11.length) s11.splice(s11Idx, 1);
        newTd = { ...tableData, step11_items: s11 };
      }
      setBoqItems(prev => prev.map(i => i.id === boqItemId ? { ...i, table_data: newTd } : i));
      toast({ title: "Item Deleted" });
      await updateBoqItem(boqItemId, newTd);
    } catch { toast({ title: "Error", description: "Failed to delete item", variant: "destructive" }); }
  };

  const handleAddToPo = (selectedItems: Step11Item[]) => {
    if (!selectedProjectId || !selectedProduct || !selectedVersionId) { toast({ title: "Error", description: "Select a project, version, and product", variant: "destructive" }); return; }
    setTargetRequiredQty(100); setPendingItems(selectedItems); setTargetQtyModalOpen(true);
  };

  const confirmAddToPo = withBudgetCheck(() => currentProjectValue, async () => {
    if (!selectedProduct || !selectedProjectId || !selectedVersionId) return;
    setTargetQtyModalOpen(false);
    try {
      const configRes = await apiFetch(`/api/product-step3-config/${selectedProduct.id}`);
      let configBasis: any = null; let materialLines: any[] = [];
      if (configRes.ok) {
        const { config, items } = await configRes.json();
        if (config) {
          configBasis = { requiredUnitType: config.required_unit_type as UnitType, baseRequiredQty: Math.max(0.001, Number(config.base_required_qty || 100)), wastagePctDefault: Number(config.wastage_pct_default || 0) };
          materialLines = (items || []).map((item: any) => ({ id: item.material_id, name: item.material_name, unit: item.unit, baseQty: Number(item.base_qty ?? item.qty ?? 0), wastagePct: item.wastage_pct != null ? Number(item.wastage_pct) : undefined, supplyRate: Number(item.supply_rate), installRate: Number(item.install_rate), shop_name: item.shop_name }));
        }
      }
      if (!configBasis) {
        configBasis = { requiredUnitType: "Sqft" as UnitType, baseRequiredQty: 1, wastagePctDefault: 0 };
        materialLines = pendingItems.map(i => ({ materialId: i.id || Math.random().toString(), materialName: i.title || "Item", unit: i.unit || "nos", baseQty: i.qty || 1, supplyRate: i.supply_rate || 0, installRate: i.install_rate || 0 }));
      }
      const tableData = {
        product_name: selectedProduct.name,
        product_id: selectedProduct.id,
        category: selectedProduct.category,
        subcategory: selectedProduct.subcategory,
        hsn_sac_type: selectedProduct.tax_code_type || null,
        hsn_sac_code: selectedProduct.tax_code_value || null,
        hsn_code: selectedProduct.hsn_code || null,
        sac_code: selectedProduct.sac_code || null,
        targetRequiredQty,
        unit: configBasis.requiredUnitType,
        configBasis,
        materialLines,
        step11_items: pendingItems,
        finalize_description: pendingItems[0]?.description || "",
        created_at: new Date().toISOString()
      };
      const res = await apiFetch("/api/boq-items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: selectedProjectId, version_id: selectedVersionId, estimator: getEstimatorTypeFromProduct(selectedProduct) || "General", table_data: tableData }) });
      if (!res.ok) throw new Error("Failed to save");
      const newItem = await res.json();
      setBoqItems(prev => [...prev, newItem]);
      toast({ title: "Success", description: `Added ${selectedProduct.name}` });
      setShowStep11Preview(false); setSelectedProduct(null); setPendingItems([]);
      loadBoqItemsAndEdits();
    } catch { toast({ title: "Error", description: "Failed to add product", variant: "destructive" }); }
  });

  const handleSaveProject = async () => {
    if (!selectedVersionId) return;
    const payload = editedFieldsRef.current || {};
    if (Object.keys(payload).length === 0) return;

    try {
      const res = await apiFetch(`/api/boq-versions/${encodeURIComponent(selectedVersionId)}/save-edits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editedFields: payload })
      });

      if (!res.ok) throw new Error(await res.text().catch(() => ""));

      const saveResp = await res.json();
      if (saveResp?.updatedItems?.length) {
        setBoqItems(prev => {
          const byId = new Map(prev.map(i => [i.id, i]));
          saveResp.updatedItems.forEach((up: any) => {
            const existing = byId.get(up.id) || {};
            byId.set(up.id, { ...existing, ...up, table_data: parseTableData(up.table_data) });
          });
          return prev.map(p => byId.get(p.id) ?? p);
        });
        setEditedFields({});
        editedFieldsRef.current = {};
      }

      toast({ title: "Success", description: "Draft saved automatically" });
      loadHistory();
    } catch (err) {
      console.error("Failed to auto-save:", err);
      toast({ title: "Error", description: "Failed to save draft", variant: "destructive" });
    }
  };

  const handleSubmitVersion = async (status: "submitted" | "pending_approval" = "pending_approval") => {
    if (!selectedVersionId) return;
    try {
      await apiFetch(`/api/boq-versions/${selectedVersionId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const r = await apiFetch(`/api/boq-versions/${encodeURIComponent(selectedProjectId!)}`, { headers: {} });
      if (r.ok) { const d = await r.json(); setVersions(d.versions || []); }
      toast({ title: "Success", description: status === "pending_approval" ? "Submitted for approval" : "Version locked" });
      loadHistory();
    } catch { toast({ title: "Error", description: "Failed to update version status", variant: "destructive" }); }
  };

  const handleCreateNewVersion = async (copyFromPrevious: boolean) => {
    if (!selectedProjectId) return;
    try {
      const prevId = copyFromPrevious && versions.length > 0 ? versions[0].id : null;
      const res = await apiFetch("/api/boq-versions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: selectedProjectId, copy_from_version: prevId }) });
      if (!res.ok) throw new Error();
      const v = await res.json(); setVersions(prev => [v, ...prev]); setSelectedVersionId(v.id);
      toast({ title: "Success", description: `Created Version ${v.version_number}` });
    } catch { toast({ title: "Error", description: "Failed to create version", variant: "destructive" }); }
  };

  const handleDeleteVersion = async () => {
    if (!selectedVersionId || !confirm("Delete this version and all its BOQ items? This cannot be undone.")) return;
    try {
      const res = await apiFetch(`/api/boq-versions/${encodeURIComponent(selectedVersionId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      const r = await apiFetch(`/api/boq-versions/${encodeURIComponent(selectedProjectId!)}`, { headers: {} });
      if (r.ok) {
        const d = await r.json(); const list = d.versions || [];
        setVersions(list);
        const draft = list.find((v: BOMVersion) => v.status === "draft");
        setSelectedVersionId(draft?.id ?? list[0]?.id ?? null);
        setBoqItems([]);
        toast({ title: "Deleted", description: "Version removed" });
      }
    } catch { toast({ title: "Error", description: "Failed to delete version", variant: "destructive" }); }
  };

  const buildDisplayLines = (boqItem: BOMItem) => {
    const td = parseTableData(boqItem.table_data);
    const step11 = Array.isArray(td.step11_items) ? td.step11_items : [];
    if (td.materialLines && td.targetRequiredQty !== undefined) {
      return computeBoq({ ...td.configBasis, wastagePctDefault: 0 }, td.materialLines.map((l: any) => ({ ...l, applyWastage: false })), td.targetRequiredQty).computed.map((l: any) => ({ title: l.name, description: l.name, unit: l.unit, qty: l.scaledQty, supply_rate: l.supplyRate, install_rate: l.installRate, supply_amount: l.supplyAmount, install_amount: l.installAmount, shop_name: l.shop_name }));
    }
    return step11.map((it: any, idx: number) => {
      const key = `${boqItem.id}-${idx}`;
      return { ...it, qty: getEditedValue(key, "qty", it.qty ?? 0), supply_rate: getEditedValue(key, "supply_rate", it.supply_rate ?? 0), install_rate: getEditedValue(key, "install_rate", it.install_rate ?? 0), description: getEditedValue(key, "description", it.description ?? ""), unit: getEditedValue(key, "unit", it.unit ?? "") };
    });
  };

  const handleDownloadExcel = () => {
    if (!selectedProjectId || !boqItems.length) {
      toast({ title: "Info", description: "No BOQ items to download" });
      return;
    }
    try {
      const workbook = XLSX.utils.book_new();
      const exportData: any[] = [];

      // Main Header
      const mainHeaders = ["Sl", "Item", "Shop", "Description", "Unit", "Qty/Unit", "Required Qty", "Round off", "Rate/Unit", "Amount"];
      exportData.push(["ANNEXURE"]);
      exportData.push([`Project: ${selectedProject?.name || "-"}`]);
      exportData.push([`Client: ${selectedProject?.client || "-"}`]);
      exportData.push([`Version: ${selectedVersion ? `V${selectedVersion.version_number} (${VERSION_LABEL[selectedVersion.status] || selectedVersion.status})` : "Draft"}`]);
      exportData.push([]); // Spacing
      exportData.push(mainHeaders);

      let grandTotal = 0;

      boqItems.forEach((boqItem, boqIdx) => {
        const tableData = parseTableData(boqItem.table_data);
        const step11Items = Array.isArray(tableData.step11_items) ? tableData.step11_items : [];
        const productName = tableData.product_name || boqItem.estimator;
        const hsnType = tableData.hsn_sac_type || tableData.tax_code_type || "";
        const hsnCode = tableData.hsn_sac_code || tableData.tax_code_value || tableData.hsn_code || tableData.sac_code || "";
        const hsnFull = hsnCode ? ` [${hsnType.toUpperCase()}: ${hsnCode}]` : "";

        // Product header row
        exportData.push([(boqIdx + 1).toString(), (productName + hsnFull).toUpperCase(), "", tableData.finalize_description || "", "", "", "", "", "", ""]);

        let displayLines: any[] = [];
        let isEngineBased = false;

        if (tableData.materialLines && tableData.targetRequiredQty !== undefined) {
          isEngineBased = true;
          const boqResult = computeBoq({ ...tableData.configBasis, wastagePctDefault: 0 }, tableData.materialLines.map((l: any) => ({ ...l, applyWastage: false })), tableData.targetRequiredQty);
          const computedLines = boqResult.computed.map((line: any, idx: number) => ({
            title: line.name, description: line.name, unit: line.unit, shop_name: line.shop_name,
            qtyPerSqf: line.perUnitQty, requiredQty: line.scaledQty, roundOff: line.roundOffQty,
            rateSqft: line.supplyRate + line.installRate, amount: line.lineTotal, s_no: idx + 1, manual: false,
          }));
          const manualStep11 = step11Items.map((it: any, s11Idx: number) => {
            if (!it?.manual) return null;
            const itemKey = `${boqItem.id}-manual-${s11Idx}`;
            const qty = Number(getEditedValue(itemKey, "qty", it.qty ?? 0)) || 0;
            const sRate = Number(getEditedValue(itemKey, "supply_rate", it.supply_rate ?? 0)) || 0;
            const iRate = Number(getEditedValue(itemKey, "install_rate", it.install_rate ?? 0)) || 0;
            const rate = Number(getEditedValue(itemKey, "rate", sRate + iRate)) || (sRate + iRate);
            const desc = getEditedValue(itemKey, "description", it.description || "");
            const u = getEditedValue(itemKey, "unit", it.unit || "nos");
            return {
              ...it, manual: true, itemKey, _s11Idx: s11Idx, qtyPerSqf: it.qtyPerSqf ?? 0,
              requiredQty: qty, roundOff: "-", description: desc, unit: u,
              rateSqft: rate, amount: Number((qty * rate).toFixed(2))
            };
          }).filter(Boolean);
          displayLines = [...computedLines, ...manualStep11];
        } else {
          displayLines = step11Items.map((it: any, s11Idx: number) => {
            const itemKey = it.itemKey || `${boqItem.id}-${s11Idx}`;
            const qty = Number(getEditedValue(itemKey, "qty", it.qty ?? 0)) || 0;
            const sRate = Number(getEditedValue(itemKey, "supply_rate", it.supply_rate ?? 0)) || 0;
            const iRate = Number(getEditedValue(itemKey, "install_rate", it.install_rate ?? 0)) || 0;
            const rate = Number(getEditedValue(itemKey, "rate", sRate + iRate)) || (sRate + iRate);
            const desc = getEditedValue(itemKey, "description", it.description || "");
            const u = getEditedValue(itemKey, "unit", it.unit || "nos");
            return {
              ...it, itemKey, _s11Idx: s11Idx,
              qtyPerSqf: qty, requiredQty: qty, roundOff: "-", description: desc, unit: u,
              rateSqft: rate, amount: Number((qty * rate).toFixed(2))
            };
          });
        }

        let productTotal = 0;
        displayLines.forEach((l: any, idx: number) => {
          const rowData = [
            `${boqIdx + 1}.${idx + 1}`,
            l.title || "-",
            l.shop_name || "-",
            l.description || "-",
            l.unit || "-",
            l.qtyPerSqf !== undefined && l.qtyPerSqf !== "-" ? (typeof l.qtyPerSqf === 'number' ? l.qtyPerSqf.toFixed(3) : l.qtyPerSqf) : "-",
            l.requiredQty !== undefined && l.requiredQty !== "-" ? (typeof l.requiredQty === 'number' ? l.requiredQty.toFixed(2) : l.requiredQty) : "-",
            l.roundOff !== undefined ? l.roundOff.toString() : "-",
            l.rateSqft !== undefined ? l.rateSqft : 0,
            (l.amount || 0)
          ];
          exportData.push(rowData);
          productTotal += (l.amount || 0);
        });

        // Product total row
        exportData.push(["", "Product Total", "", "", "", "", "", "", "", productTotal]);
        exportData.push([]); // spacing
        grandTotal += productTotal;
      });

      // Grand total row
      exportData.push(["", "GRAND TOTAL", "", "", "", "", "", "", "", grandTotal]);

      const worksheet = XLSX.utils.aoa_to_sheet(exportData);

      // Add some basic styling/formatting
      worksheet['!cols'] = [
        { wch: 5 },  // Sl
        { wch: 30 }, // Item
        { wch: 15 }, // Shop
        { wch: 50 }, // Description
        { wch: 10 }, // Unit
        { wch: 12 }, // Qty/Unit
        { wch: 15 }, // Required Qty
        { wch: 12 }, // Round off
        { wch: 15 }, // Rate/Unit
        { wch: 18 }, // Amount
      ];

      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      for (let R = range.s.r; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cell_ref = XLSX.utils.encode_cell({ r: R, c: C });
          if (!worksheet[cell_ref]) continue;
          if (C === 8 || C === 9) { // Rate and Amount columns
            if (typeof worksheet[cell_ref].v === 'number') {
              worksheet[cell_ref].z = '"₹"#,##0.00';
            }
          }
        }
      }

      XLSX.utils.book_append_sheet(workbook, worksheet, "Annexure");
      const filename = `${selectedProject?.name || "Annexure"}_${selectedVersion ? `V${selectedVersion.version_number}` : "draft"}_Annexure.xlsx`;

      XLSX.writeFile(workbook, filename);
      toast({ title: "Success", description: `Downloaded ${filename}` });
    } catch (err) {
      console.error(err);
      toast({ title: "Error", description: "Failed to download Excel", variant: "destructive" });
    }
  };

  const handleDownloadPdf = async () => {
    if (!selectedProjectId || !boqItems.length) {
      toast({ title: "Info", description: "No BOQ items to download" });
      return;
    }
    try {
      const doc = new jsPDF({ orientation: "landscape", unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // 1. Fetch Logo
      let logoDataUrl: string | null = null;
      try {
        const r = await fetch("/image.png");
        if (r.ok) {
          const b = await r.blob();
          logoDataUrl = await new Promise(res => {
            const reader = new FileReader();
            reader.onloadend = () => res(reader.result as string);
            reader.onerror = () => res(null);
            reader.readAsDataURL(b);
          });
        }
      } catch (err) {
        console.warn("Logo fetch failed", err);
      }

      // 2. Header Section
      if (logoDataUrl) {
        try {
          const ip: any = doc.getImageProperties(logoDataUrl);
          const ih = 20;
          const iw = (ip.width / ip.height) * ih;
          doc.addImage(logoDataUrl, "PNG", 10, 10, iw, ih);
        } catch (e) { console.error("Logo error", e); }
      }

      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(selectedProject?.name || "BILL OF QUANTITIES", pageWidth - 10, 16, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`Client: ${selectedProject?.client || "-"}`, pageWidth - 10, 22, { align: "right" });
      doc.text(`Budget: ${selectedProject?.budget || "-"}`, pageWidth - 10, 28, { align: "right" });
      doc.text(`Version: ${selectedVersion ? `V${selectedVersion.version_number}` : "Draft"}`, pageWidth - 10, 34, { align: "right" });

      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("ANNEXURE", pageWidth / 2, 25, { align: "center" });

      // 3. Prepare Table columns and body
      const tableHeaders = ["Sl", "Item / Component", "Shop", "Description", "Unit", "Qty/Unit", "Req Qty", "R.Off", "Rate", "Total (₹)"];
      const tableBody: any[] = [];
      let grandTotal = 0;

      boqItems.forEach((boqItem, boqIdx) => {
        const td = parseTableData(boqItem.table_data);
        const step11Items = Array.isArray(td.step11_items) ? td.step11_items : [];
        const productName = td.product_name || boqItem.estimator;
        const hsnType = td.hsn_sac_type || td.tax_code_type || "";
        const hsnCode = td.hsn_sac_code || td.tax_code_value || td.hsn_code || td.sac_code || "";
        const hsnFull = hsnCode ? ` [${hsnType.toUpperCase()}: ${hsnCode}]` : "";

        // Product Header Row (Gray background)
        tableBody.push([
          { content: (boqIdx + 1).toString(), styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } },
          { content: (productName + hsnFull).toUpperCase(), styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } },
          { content: td.finalize_description || "", colSpan: 8, styles: { fontStyle: 'italic', fillColor: [240, 240, 240] } }
        ]);

        let displayLines: any[] = [];
        if (td.materialLines && td.targetRequiredQty !== undefined) {
          const boqResult = computeBoq({ ...td.configBasis, wastagePctDefault: 0 }, td.materialLines.map((l: any) => ({ ...l, applyWastage: false })), td.targetRequiredQty);
          const computedLines = boqResult.computed.map((line: any, idx: number) => ({
            title: line.name, description: line.name, unit: line.unit, shop_name: line.shop_name,
            qtyPerSqf: line.perUnitQty, requiredQty: line.scaledQty, roundOff: line.roundOffQty,
            rate: line.supplyRate + line.installRate, amount: line.lineTotal
          }));
          const manualStep11 = step11Items.filter((i: any) => i?.manual).map((it: any, s11Idx: number) => {
            const key = `${boqItem.id}-manual-${it._s11Idx ?? s11Idx}`;
            const qty = Number(getEditedValue(key, "qty", it.qty ?? 0)) || 0;
            const rate = Number(getEditedValue(key, "rate", (it.supply_rate ?? 0) + (it.install_rate ?? 0)));
            return {
              ...it, manual: true, title: it.title, description: getEditedValue(key, "description", it.description || ""),
              unit: getEditedValue(key, "unit", it.unit || "nos"), qtyPerSqf: "-", requiredQty: qty, roundOff: "-",
              rate, amount: qty * rate
            };
          }).filter(Boolean);
          displayLines = [...computedLines, ...manualStep11];
        } else {
          displayLines = step11Items.map((it: any, idx: number) => {
            const key = it.itemKey || `${boqItem.id}-${idx}`;
            const qty = Number(getEditedValue(key, "qty", it.qty ?? 0)) || 0;
            const rate = Number(getEditedValue(key, "rate", (it.supply_rate ?? 0) + (it.install_rate ?? 0)));
            return {
              ...it, title: it.title, description: getEditedValue(key, "description", it.description || ""),
              unit: getEditedValue(key, "unit", it.unit || "nos"), qtyPerSqf: qty, requiredQty: qty, roundOff: "-",
              rate, amount: qty * rate
            };
          });
        }

        let productTotal = 0;
        displayLines.forEach((l, lIdx) => {
          tableBody.push([
            `${boqIdx + 1}.${lIdx + 1}`,
            l.title || "-",
            l.shop_name || "-",
            l.description || "-",
            l.unit || "-",
            typeof l.qtyPerSqf === 'number' ? l.qtyPerSqf.toFixed(3) : l.qtyPerSqf,
            typeof l.requiredQty === 'number' ? l.requiredQty.toFixed(2) : l.requiredQty,
            l.roundOff || "-",
            (l.rate || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            (l.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          ]);
          productTotal += (l.amount || 0);
        });

        // Product Subtotal Row
        tableBody.push([
          { content: "", colSpan: 8, styles: { borderTop: [1, 0, 0, 0] } },
          { content: "Product Total", styles: { fontStyle: 'bold', fillColor: [250, 250, 250] } },
          { content: productTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), styles: { fontStyle: 'bold', fillColor: [250, 250, 250], halign: 'right' } }
        ]);

        grandTotal += productTotal;
      });

      // Grand Total Row (Dark accent)
      tableBody.push([
        { content: "GRAND TOTAL", colSpan: 9, styles: { fontStyle: 'bold', halign: 'right', fillColor: [41, 41, 41], textColor: [255, 255, 255] } },
        { content: grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), styles: { fontStyle: 'bold', halign: 'right', fillColor: [41, 41, 41], textColor: [255, 255, 255] } }
      ]);

      // 4. Render Table
      // @ts-ignore
      autoTable(doc, {
        head: [tableHeaders],
        body: tableBody,
        startY: 42,
        styles: { fontSize: 7, cellPadding: 1.5, lineColor: [220, 220, 220], lineWidth: 0.1 },
        headStyles: { fillColor: [41, 41, 41], textColor: [255, 255, 255], fontStyle: "bold" },
        theme: "grid",
        columnStyles: {
          0: { cellWidth: 10 },    // Sl
          1: { cellWidth: 40 },    // Item
          2: { cellWidth: 25 },    // Shop
          4: { cellWidth: 12 },    // Unit
          5: { cellWidth: 15 },    // Qty/Unit
          6: { cellWidth: 15 },    // Req Qty
          7: { cellWidth: 12 },    // R.Off
          8: { cellWidth: 25, halign: 'right' },    // Rate
          9: { cellWidth: 25, halign: 'right' },    // Amount
        }
      });

      // 5. Terms & Conditions (as per image)
      const finalY = (doc as any).lastAutoTable.finalY + 12;
      if (finalY < pageHeight - 30) {
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text("Terms & Conditions:", 10, finalY);
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.text("GST Extra", 10, finalY + 6);
      }

      const filename = `${selectedProject?.name || "Annexure"}_${selectedVersion ? `V${selectedVersion.version_number}` : "draft"}_Annexure.pdf`;
      doc.save(filename);
      toast({ title: "Success", description: `Downloaded ${filename}` });
    } catch (err) {
      console.error("PDF Export Error:", err);
      toast({ title: "Error", description: "Failed to download PDF", variant: "destructive" });
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const isVersionSubmitted = !!selectedVersion && ["submitted", "pending_approval", "approved", "edit_requested"].includes(selectedVersion.status);



  // Budget reason logging removed for Generate PO page

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return <Layout><div className="text-center py-8">Loading projects...</div></Layout>;

  return (
    <>
      <Layout>
        <div className="space-y-6">
          <h1 className="text-2xl font-semibold">Generate Annexure</h1>

          {/* Project Selector */}
          {/* Project & Version Selector (Compact & Professional) */}
          <Card className="border-slate-200 shadow-sm overflow-hidden">
            <CardContent className="p-4 bg-white">
              <div className="flex flex-col gap-4">
                {/* Top Row: Selectors & Actions */}
                <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
                  {/* Container 1: Project Selector */}
                  <div className="flex-[2] min-w-[300px] space-y-1.5">
                    <Label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold ml-1">Project</Label>
                    <Select onValueChange={v => setSelectedProjectId(v || null)} value={selectedProjectId || ""}>
                      <SelectTrigger className="w-full bg-slate-50 border-slate-200 h-9 px-3">
                        <SelectValue placeholder={projects.length === 0 ? "No projects" : "Select project"} />
                      </SelectTrigger>
                      <SelectContent className="max-h-60 overflow-auto">
                        {projects.map((p: Project) => <SelectItem value={p.id} key={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Container 2: Version Selector & Actions */}
                  {selectedProjectId && (
                    <div className="flex-[3] min-w-[500px] space-y-1.5 text-slate-900">
                      <Label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold ml-1">Version & Actions</Label>
                      <div className="flex flex-wrap gap-2">
                        <Select value={selectedVersionId || ""} onValueChange={setSelectedVersionId}>
                          <SelectTrigger className="flex-1 min-w-[140px] bg-slate-50 border-slate-200 h-9 px-3">
                            <SelectValue placeholder="Select version" />
                          </SelectTrigger>
                          <SelectContent className="max-h-60 overflow-auto">
                            {versions.map((v: BOMVersion) => <SelectItem value={v.id} key={v.id}>V{v.version_number} {!isPurchaseTeam && `(${VERSION_LABEL[v.status] ?? v.status})`}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {!isPurchaseTeam && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 px-3 bg-white border-slate-200 hover:bg-slate-50 text-slate-600 hover:text-blue-600 gap-2 font-semibold"
                              title="View History"
                              onClick={() => setShowHistoryModal(true)}
                              disabled={!selectedVersionId || history.length === 0}
                            >
                              <History className="h-4 w-4" />
                              <span>History</span>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 px-3 bg-white border-slate-200 hover:bg-slate-50 text-slate-600 hover:text-red-600 gap-2 font-semibold"
                              title="Delete Version"
                              onClick={handleDeleteVersion}
                              disabled={!selectedVersionId}
                            >
                              <XCircle className="h-4 w-4" />
                              <span>Delete</span>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 px-3 bg-white border-slate-200 hover:bg-slate-50 text-slate-600 hover:text-emerald-600 gap-2 font-semibold"
                              title="New Version"
                              onClick={() => {
                                if (versions.length > 0) {
                                  const last = versions[0];
                                  handleCreateNewVersion(confirm(`Copy items from V${last.version_number}?`));
                                } else {
                                  handleCreateNewVersion(false);
                                }
                              }}
                            >
                              <Clock className="h-4 w-4" />
                              <span>New Version</span>
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 h-9 ml-auto">
                    {!isPurchaseTeam && (
                      <>
                        <Button onClick={() => setShowProductPicker(true)} className="bg-primary text-white h-full px-5 text-xs font-bold shadow-sm" disabled={isVersionSubmitted || !selectedVersionId}>+ Add Product</Button>
                        <Button onClick={() => setShowMaterialPicker(true)} variant="outline" className="border-slate-200 h-full px-5 text-xs font-bold shadow-sm bg-white" disabled={isVersionSubmitted || !selectedVersionId}>+ Add Item</Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Bottom Row: Project Info Summary (if selected) */}
                {selectedVersion && (
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-2.5 px-4 bg-slate-50/50 border border-slate-100 rounded-lg overflow-hidden">
                    <div className="flex items-center gap-2 min-w-fit">
                      <div className="p-1.5 bg-blue-50 rounded text-blue-600"><Briefcase className="h-3.5 w-3.5" /></div>
                      <div className="flex flex-col">
                        <span className="text-[10px] leading-none text-slate-400 font-bold uppercase tracking-tight">Client</span>
                        <span className="text-xs font-semibold text-slate-700">{selectedVersion.project_client || "—"}</span>
                      </div>
                    </div>

                    <div className="hidden md:block w-px h-6 bg-slate-200" />

                    <div className="flex items-center gap-2 min-w-fit">
                      <div className="p-1.5 bg-indigo-50 rounded text-indigo-600"><MapPin className="h-3.5 w-3.5" /></div>
                      <div className="flex flex-col">
                        <span className="text-[10px] leading-none text-slate-400 font-bold uppercase tracking-tight">Location</span>
                        <span className="text-xs font-semibold text-slate-700">{selectedVersion.project_location || "—"}</span>
                      </div>
                    </div>

                    <div className="hidden md:block w-px h-6 bg-slate-200" />

                    <div className="flex items-center gap-2 min-w-fit">
                      <div className="p-1.5 bg-emerald-50 rounded text-emerald-600"><IndianRupee className="h-3.5 w-3.5" /></div>
                      <div className="flex flex-col">
                        <span className="text-[10px] leading-none text-slate-400 font-bold uppercase tracking-tight">Budget</span>
                        <span className="text-xs font-semibold text-slate-700">₹{currentProjectValue.toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="ml-auto flex items-center gap-3">
                      {selectedVersion.status === "approved" ? (
                        <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] font-bold px-2 py-0 h-6">
                          <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> APPROVED
                        </Badge>
                      ) : selectedVersion.status === "edit_requested" ? (
                        <Badge variant="outline" className="bg-indigo-100 text-indigo-700 border-indigo-200 text-[10px] font-bold px-2 py-0 h-6">
                          <Clock className="h-2.5 w-2.5 mr-1" /> EDIT REQUESTED
                        </Badge>
                      ) : isVersionSubmitted ? (
                        <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200 text-[10px] font-bold px-2 py-0 h-6">
                          <Lock className="h-2.5 w-2.5 mr-1" /> SUBMITTED
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-200 text-[10px] font-bold px-2 py-0 h-6">
                          <Clock className="h-2.5 w-2.5 mr-1" /> DRAFT
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>

            {/* History Modal */}
            <Dialog open={showHistoryModal} onOpenChange={setShowHistoryModal}>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle className="text-lg font-bold flex items-center gap-2">
                    <History className="h-5 w-5 text-blue-600" />
                    Approval & Activity History
                  </DialogTitle>
                  <DialogDescription>
                    Tracking all major actions and approval status changes.
                  </DialogDescription>
                </DialogHeader>
                <div className="py-4 max-h-[60vh] overflow-y-auto px-1">
                  <HistorySection history={history} />
                </div>
                <DialogFooter>
                  <Button onClick={() => setShowHistoryModal(false)}>Close</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <ProductPicker open={showProductPicker} onOpenChange={setShowProductPicker} onSelectProduct={handleSelectProduct} selectedProjectId={selectedProjectId!} />
            <MaterialPicker open={showMaterialPicker} onOpenChange={setShowMaterialPicker} onSelectTemplate={handleSelectMaterialTemplate} />

            {selectedProduct && (
              <Step11Preview product={selectedProduct} open={showStep11Preview} onClose={() => { setShowStep11Preview(false); setTimeout(() => setSelectedProduct(null), 300); }} onAddToBoq={handleAddToPo} />
            )}
          </Card>

          {/* BOQ Items */}
          {selectedProjectId && (
            <Card>
              <CardContent className="space-y-4 pt-6">
                <h2 className="text-lg font-semibold">Annexure Items</h2>
                {boqItems.length === 0
                  ? <div className="text-gray-500 text-center py-4">No products added yet. Click Add Product +</div>
                  : <div className="space-y-8">
                    {boqItems.map((boqItem: BOMItem, boqIdx: number) => (
                      <BoqItemCard key={boqItem.id} boqItem={boqItem} boqIdx={boqIdx} isVersionSubmitted={isVersionSubmitted}
                        expandedProductIds={expandedProductIds} setExpandedProductIds={setExpandedProductIds}
                        getEditedValue={getEditedValue} updateEditedField={updateEditedField}
                        handleDeleteRow={handleDeleteRow} handleFinalizeProduct={handleFinalizeProduct}
                        handleAddItem={handleAddItem} loadBoqItemsAndEdits={loadBoqItemsAndEdits} setBoqItems={setBoqItems}
                        checkBudgetEarly={checkBudgetEarly}
                        handleSaveProject={handleSaveProject}
                        isPurchaseTeam={isPurchaseTeam}
                      />
                    ))}
                  </div>
                }
              </CardContent>
            </Card>
          )}

          {/* Action Buttons */}
          {selectedProjectId && selectedVersionId && (
            <Card>
              <CardContent className="space-y-3 pt-6">
                {selectedVersion && <VersionStatusBanner version={selectedVersion} />}
                <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                  <Button onClick={withBudgetCheck(() => currentProjectValue, handleSaveProject)} variant="outline" disabled={isVersionSubmitted || Object.keys(editedFields).length === 0}>Save Draft</Button>
                  <Button onClick={() => handleSubmitVersion("submitted")} variant="outline" className="border-primary text-primary hover:bg-primary/5 font-bold" disabled={isVersionSubmitted || boqItems.length === 0}>Lock Version</Button>
                  <Button
                    onClick={handleOpenPOModal}
                    disabled={isGeneratingPO || boqItems.length === 0}
                    className="bg-green-600 hover:bg-green-700 text-white font-bold"
                  >
                    {isGeneratingPO ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
                    Generate Annexure
                  </Button>
                  <Button onClick={handleDownloadExcel} variant="outline" disabled={boqItems.length === 0}>Download Excel</Button>
                  <Button onClick={handleDownloadPdf} variant="outline" disabled={boqItems.length === 0}>Download PDF</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </Layout>

      {/* Target Qty Modal */}
      <Dialog open={targetQtyModalOpen} onOpenChange={setTargetQtyModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Project Requirement</DialogTitle>
            <DialogDescription>Enter the required quantity for this product in your project.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm font-medium">Required quantity for <span className="font-bold underline">{selectedProduct?.name}</span>:</p>
            <div className="flex items-center gap-3">
              <Input type="number" value={targetRequiredQty} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTargetRequiredQty(Number(e.target.value))} className="text-lg font-bold" />
              <span className="text-muted-foreground font-semibold">{pendingItems[0]?.unit || "Sqft"}</span>
            </div>
            <p className="text-xs text-muted-foreground italic">Quantity will be scaled according to product recipe.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTargetQtyModalOpen(false)}>Cancel</Button>
            <Button onClick={withBudgetCheck(() => {
              let addon = 0;
              pendingItems.forEach(i => {
                addon += (Number(i.qty) || 1) * ((Number(i.supply_rate) || 0) + (Number(i.install_rate) || 0));
              });
              return currentProjectValue + (addon * targetRequiredQty);
            }, confirmAddToPo)} className="bg-primary text-white font-bold">Add to PO</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PO Confirmation Modal */}
      <Dialog open={isPOModalOpen} onOpenChange={setIsPOModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Generate Annexures</DialogTitle>
            <DialogDescription>
              We found the following vendors for this project. Individual Annexures will be created for each vendor.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {isLoadingVendors ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : previewVendors.length === 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded p-4 text-sm text-amber-800 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                <div><strong>No Vendors Found.</strong> Please ensure you have selected vendors for your items before generating POs.</div>
              </div>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                <p className="text-xs font-bold text-gray-500 uppercase">Found {previewVendors.length} Vendors:</p>
                {previewVendors.map((vendor, idx) => (
                  <div key={vendor.id} className="flex items-center gap-3 p-2 rounded border bg-gray-50">
                    <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xs">
                      {idx + 1}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-gray-800">{vendor.name}</div>
                      <div className="text-[10px] text-gray-500">{vendor.location || "No location set"}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPOModalOpen(false)} disabled={isGeneratingPO}>
              Cancel
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => {
                setIsPOModalOpen(false);
                handleGeneratePO();
              }}
              disabled={isGeneratingPO || previewVendors.length === 0}
            >
              {isGeneratingPO ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm & Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Floating Action Menu - Hide for purchase team */}
      {!isPurchaseTeam && (
        <div className="fixed bottom-8 right-8 flex flex-col gap-4 z-50">
          <Button size="icon" className="h-14 w-14 rounded-full bg-slate-900 shadow-2xl hover:bg-slate-800 transform transition-transform hover:scale-110" onClick={() => setShowProductPicker(true)}>
            <Plus className="h-6 w-6 text-white" />
          </Button>
        </div>
      )}
      {/* Budget warning dialogs removed for Generate BOM page */}
    </>
  );
}
