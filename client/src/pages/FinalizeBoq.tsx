import React, { useEffect, useState, useRef, useCallback } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { Layout } from "@/components/layout/Layout";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { fuzzySearch, cn } from "@/lib/utils";
import XLSX from 'xlsx-js-style';
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import apiFetch from "@/lib/api";
import { computeBoq } from "@/lib/boqCalc";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { DeleteConfirmationDialog } from "@/components/ui/DeleteConfirmationDialog";
import {
  Trash2,
  Copy,
  GripVertical,
  GripHorizontal,
  Eye,
  EyeOff,
  Edit2,
  ChevronDown,
  Briefcase,
  MapPin,
  IndianRupee,
  Lock,
  LayoutTemplate,
  Edit3,
  CheckCircle2,
  Clock,
  Search,
  Plus,
  X,
  Maximize2,
  Minimize2,
  Settings2,
  Share2,
  Users,
  Unlock,
  Type,
  Mail,
  Download,
  Save
} from "lucide-react";

/** Helper to generate Excel-style column names (A, B, C... Z, AA, AB...) */
const getExcelColumnName = (n: number) => {
  let name = "";
  while (n >= 0) {
    name = String.fromCharCode((n % 26) + 65) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
};

// ─── Shared helpers ──────────────────────────────────────────────────────────
const applyOperator = (base: number, mult: number, op: string) => {
  if (op === "%") return base * (mult / 100);
  if (op === "*") return base * mult;
  if (op === "/") return mult !== 0 ? base / mult : 0;
  return base + mult; // "+"
};

type SrcCtx = {
  totalVal: number; rate: number; qty: number;
  overrideRate: number; overrideTotal: number;
  rowCalc: Record<string, number>;
  customVals: Record<string, string>;
};

const resolveSource = (src: string, ctx: SrcCtx): number => {
  if (src === "Total Value (₹)") return ctx.totalVal;
  if (src === "Rate / Unit") return ctx.rate;
  if (src === "Qty") return ctx.qty;
  if (src === "Override Rate") return ctx.overrideRate;
  if (src === "Override Total") return ctx.overrideTotal;
  if (ctx.rowCalc[src] !== undefined) return ctx.rowCalc[src];
  return parseFloat(ctx.customVals[src] || "0") || 0;
};

const getItemMetrics = (td: any) => {
  const step11 = Array.isArray(td.step11_items) ? td.step11_items : [];
  let itemTotal = 0, itemQty = 0;
  if (td.materialLines && td.targetRequiredQty !== undefined) {
    const res = computeBoq(td.configBasis, td.materialLines, td.targetRequiredQty);
    const manualTotal = step11.filter((it: any) => it.manual).reduce((s: number, it: any) =>
      s + (Number(it.qty) || 0) * (Number(it.supply_rate || 0) + Number(it.install_rate || 0)), 0);
    itemTotal = res.grandTotal + manualTotal;
    itemQty = td.targetRequiredQty;
  } else {
    itemTotal = step11.reduce((s: number, it: any) =>
      s + (it.qty || 0) * ((it.supply_rate || 0) + (it.install_rate || 0)), 0);
    itemQty = step11[0]?.qty || 0;
  }
  const itemRate = itemQty > 0 ? itemTotal / itemQty : itemTotal;
  return { itemTotal, itemQty, itemRate, step11 };
};
// ─────────────────────────────────────────────────────────────────────────────

/** Parse a product image field which may be a plain URL or a JSON-serialised array of URLs */
const parseProductImage = (imageField: string | null | undefined): string | null => {
  if (!imageField) return null;
  try {
    if (imageField.startsWith('[')) {
      const arr = JSON.parse(imageField);
      return Array.isArray(arr) && arr.length > 0 ? String(arr[0]) : null;
    }
    return imageField;
  } catch {
    return imageField;
  }
};

type Project = {
  id: string;
  name: string;
  client: string;
  budget: string;
  location?: string;
  status?: string;
  project_status?: string;
};

const PROJECT_STATUSES: { value: string; label: string; color: string }[] = [
  { value: 'started', label: 'Started', color: 'bg-blue-100 text-blue-700' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-amber-100 text-amber-700' },
  { value: 'hold', label: 'Hold', color: 'bg-orange-100 text-orange-700' },
  { value: 'cancelled', label: 'Cancelled', color: 'bg-red-100 text-red-700' },
  { value: 'closed', label: 'Closed', color: 'bg-gray-200 text-gray-600' },
];
const getProjectStatusMeta = (s?: string) => PROJECT_STATUSES.find(x => x.value === s) ?? { label: s || 'Started', color: 'bg-blue-100 text-blue-700' };

type BOQVersion = {
  id: string;
  project_id: string;
  version_number: number;
  status: "draft" | "submitted" | "pending_approval" | "approved" | "rejected" | "edit_requested";
  is_locked?: boolean;
  type: "bom" | "boq";
  created_at: string;
  updated_at: string;
  project_name?: string;
  project_client?: string;
  project_location?: string;
};

type BOMItem = {
  id: string;
  estimator: string;
  session_id: string;
  table_data: any;
  created_at: string;
};

type Product = {
  id: string;
  name: string;
  code: string;
  category?: string;
  subcategory?: string;
  description?: string;
  category_name?: string;
  subcategory_name?: string;
  tax_code_type?: string;
  tax_code_value?: string;
  hsn_code?: string;
  sac_code?: string;
};

type BOQTemplate = {
  id: string;
  name: string;
  config: any;
  created_at: string;
  updated_at: string;
};

type Step11Item = {
  id?: string;
  s_no?: number;
  bill_no?: string;
  estimator?: string;
  group_id?: string;
  title?: string;
  description?: string;
  unit?: string;
  qty?: number;
  supply_rate?: number;
  install_rate?: number;
  [key: string]: any;
};

type DraggableHeaderColProps = { col: any; idx: number; isVersionSubmitted: boolean; allCols: any[]; getExcelColumnName: (n: number) => string; handleGlobalCalculation: any; globalColSettings: any; handleHideColumn: any; boqItems: any[]; customColumns: any; customColumnValues: any; saveItemLayout: any; toast: any; setCustomColumns: any; setCustomColumnValues: any; openDeleteConfirm: (title: string, itemName: string, onConfirm: (action: "archive" | "trash") => void) => void; };

const DraggableHeaderCol = ({
  col,
  idx,
  isVersionSubmitted,
  allCols,
  getExcelColumnName,
  handleGlobalCalculation,
  globalColSettings,
  handleHideColumn,
  boqItems,
  customColumns,
  customColumnValues,
  saveItemLayout,
  toast,
  setCustomColumns,
  setCustomColumnValues,
  setGlobalColSettings,
  openDeleteConfirm
}: DraggableHeaderColProps & { setGlobalColSettings: any }) => {
  const controls = useDragControls();

  const handleRenameColumn = async () => {
    const oldName = col.name;
    const newName = window.prompt(`Enter new name for column "${oldName}":`, oldName);
    if (!newName || newName === oldName) return;

    // Check for duplicates
    if (allCols.some(c => c.name === newName)) {
      toast({ title: "Error", description: "Column name already exists", variant: "destructive" });
      return;
    }

    const updates = boqItems.map(item => {
      const itemCols = [...(customColumns[item.id] || [])];
      const colIdx = itemCols.findIndex(c => c.name === oldName);
      if (colIdx === -1) return Promise.resolve();

      // Update column definition
      itemCols[colIdx] = { ...itemCols[colIdx], name: newName };

      // Update values
      const itemValues = { ...(customColumnValues[item.id] || {}) };
      Object.keys(itemValues).forEach(r => {
        const ri = parseInt(r);
        const rowVals = { ...(itemValues[ri] || {}) };
        if (rowVals[oldName] !== undefined) {
          rowVals[newName] = rowVals[oldName];
          delete rowVals[oldName];
        }
        itemValues[ri] = rowVals;
      });

      setCustomColumns((prev: any) => ({ ...prev, [item.id]: itemCols }));
      setCustomColumnValues((prev: any) => ({ ...prev, [item.id]: itemValues }));

      // Also update global settings if any
      if (globalColSettings[oldName]) {
        setGlobalColSettings((prev: any) => {
          const next = { ...prev };
          next[newName] = next[oldName];
          delete next[oldName];
          return next;
        });
      }

      return saveItemLayout(item.id, itemCols, itemValues);
    });

    await Promise.all(updates);
    toast({ title: "Column Renamed", description: `"${oldName}" is now "${newName}"` });
  };

  return (
    <Reorder.Item
      key={col.name}
      value={col}
      as="th"
      dragListener={false}
      dragControls={controls}
      className={`border-r border-gray-200 px-2 py-2 text-left min-w-[130px] group relative bg-white text-slate-900 ${col.isTotal ? "font-semibold" : ""}`}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-1 overflow-hidden">
          <div className="flex items-center gap-1.5 overflow-hidden">
            {!isVersionSubmitted && (
              <GripHorizontal
                size={12}
                className="text-slate-400 cursor-grab active:cursor-grabbing flex-shrink-0"
                onPointerDown={(e) => controls.start(e)}
              />
            )}
            <span className="truncate font-black text-[11px] uppercase tracking-normal text-slate-800">{col.name}</span>
          </div>
          {!isVersionSubmitted && (
            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={async () => {
                  if (!confirm(`Clone "${col.name}"?`)) return;
                  const newColName = `${col.name} (Copy)`;
                  const updates = boqItems.map(item => {
                    const itemCols = customColumns[item.id] || [];
                    const nextCols = [...itemCols, { ...col, name: newColName }];
                    const itemValues = { ...(customColumnValues[item.id] || {}) };
                    Object.keys(itemValues).forEach(r => {
                      const ri = parseInt(r);
                      const rowVals = { ...(itemValues[ri] || {}) };
                      if (rowVals[col.name] !== undefined) rowVals[newColName] = rowVals[col.name];
                      itemValues[ri] = rowVals;
                    });
                    setCustomColumns((prev: any) => ({ ...prev, [item.id]: nextCols }));
                    setCustomColumnValues((prev: any) => ({ ...prev, [item.id]: itemValues }));
                    return saveItemLayout(item.id, nextCols, itemValues);
                  });
                  await Promise.all(updates);
                }}
                className="text-gray-400 hover:text-blue-500"
              ><Copy size={10} /></button>
              <button
                onClick={handleRenameColumn}
                className="text-gray-400 hover:text-green-500"
                title="Rename Column"
              >
                <Edit2 size={10} />
              </button>
              <button onClick={() => handleHideColumn(col.name, true)} className="text-gray-400 hover:text-orange-500"><EyeOff size={10} /></button>
              <button
                onClick={() => {
                  openDeleteConfirm(`Delete Column "${col.name}"?`, col.name, async (action: "archive" | "trash") => {
                    const updates = boqItems.map(item => {
                      const nextCols = (customColumns[item.id] || []).filter((c: any) => c.name !== col.name);
                      const itemValues = { ...(customColumnValues[item.id] || {}) };
                      Object.keys(itemValues).forEach(r => {
                        const ri = parseInt(r);
                        const rowVals = { ...itemValues[ri] };
                        delete rowVals[col.name];
                        itemValues[ri] = rowVals;
                      });
                      setCustomColumns((prev: any) => ({ ...prev, [item.id]: nextCols }));
                      setCustomColumnValues((prev: any) => ({ ...prev, [item.id]: itemValues }));
                      return saveItemLayout(item.id, nextCols, itemValues);
                    });
                    await Promise.all(updates);
                    toast({ title: action === 'trash' ? "Moved to Trash" : "Archived", description: `Column "${col.name}" removed.` });
                  });
                }}
                className="text-gray-400 hover:text-red-500"
              ><Trash2 size={10} /></button>
            </div>
          )}
        </div>

        {(col as any).isPercentage && !isVersionSubmitted && (
          <div className="mt-0.5 pt-0.5 border-t border-purple-200/40 flex flex-col gap-0.5">
            <div className="flex items-center gap-1 overflow-hidden h-4">
              <span className="text-[6px] font-bold text-gray-400 shrink-0">B:</span>
              <select
                className="bg-white/60 text-[8px] font-bold text-purple-700 uppercase px-0.5 py-0 rounded border border-purple-200/50 outline-none h-3.5 w-full truncate"
                value={globalColSettings[col.name]?.baseSource || ((col as any).isPercentage ? "Total Value (₹)" : "manual")}
                onChange={(e) => handleGlobalCalculation(col.name, globalColSettings[col.name]?.baseValue || 0, globalColSettings[col.name]?.percentageValue || 0, e.target.value, globalColSettings[col.name]?.operator || "%", globalColSettings[col.name]?.multiplierSource || "manual")}
              >
                <option value="manual">Fixed</option>
                <option value="Rate / Unit">G: Rate</option>
                <option value="Unit">H: Unit</option>
                <option value="Qty">I: Qty</option>
                <option value="Total Value (₹)">J: Total</option>
                <option value="Override Rate">K: O.Rate</option>
                <option value="Override Total">L: O.Total</option>
                {allCols.filter(c => c.name !== col.name).map((c) => {
                  const ci = allCols.findIndex(cc => cc.name === c.name);
                  return <option key={c.name} value={c.name}>{getExcelColumnName(ci + 12)}: {c.name.substring(0, 8)}</option>;
                })}
              </select>
              <select
                className="bg-white/60 text-[8px] font-bold text-purple-700 px-0.5 rounded border border-purple-200/50 outline-none h-3.5"
                value={globalColSettings[col.name]?.operator || "%"}
                onChange={(e) => handleGlobalCalculation(col.name, globalColSettings[col.name]?.baseValue || 0, globalColSettings[col.name]?.percentageValue || 0, globalColSettings[col.name]?.baseSource || ((col as any).isPercentage ? "Total Value (₹)" : "manual"), e.target.value, globalColSettings[col.name]?.multiplierSource || "manual")}
              >
                <option value="%">%</option><option value="*">×</option><option value="/">÷</option><option value="+">+</option>
              </select>
            </div>
            <div className="flex items-center gap-1 overflow-hidden h-4">
              <select
                className="bg-white/60 text-[8px] font-bold text-purple-700 uppercase px-0.5 rounded border border-purple-200/50 outline-none h-3.5 w-full truncate"
                value={globalColSettings[col.name]?.multiplierSource || "manual"}
                onChange={(e) => handleGlobalCalculation(col.name, globalColSettings[col.name]?.baseValue || 0, globalColSettings[col.name]?.percentageValue || 0, globalColSettings[col.name]?.baseSource || ((col as any).isPercentage ? "Total Value (₹)" : "manual"), globalColSettings[col.name]?.operator || "%", e.target.value)}
              >
                <option value="manual">Val</option>
                <option value="Rate / Unit">G: Rate</option>
                <option value="Unit">H: Unit</option>
                <option value="Qty">I: Qty</option>
                <option value="Total Value (₹)">J: Total</option>
                <option value="Override Rate">K: O.Rate</option>
                <option value="Override Total">L: O.Total</option>
                {allCols.filter(c => c.name !== col.name).map((c) => {
                  const ci = allCols.findIndex(cc => cc.name === c.name);
                  return <option key={c.name} value={c.name}>{getExcelColumnName(ci + 12)}: {c.name.substring(0, 8)}</option>;
                })}
              </select>
              {(!globalColSettings[col.name]?.multiplierSource || globalColSettings[col.name]?.multiplierSource === "manual") ? (
                <div className="relative flex items-center shrink-0">
                  <input
                    type="number"
                    className="w-8 bg-white text-[8px] font-bold text-gray-700 px-0.5 rounded border border-purple-200 h-3.5 text-right"
                    value={globalColSettings[col.name]?.percentageValue || 0}
                    onChange={(e) => handleGlobalCalculation(col.name, globalColSettings[col.name]?.baseValue || 0, parseFloat(e.target.value) || 0, globalColSettings[col.name]?.baseSource || ((col as any).isPercentage ? "Total Value (₹)" : "manual"), globalColSettings[col.name]?.operator || "%", "manual")}
                  />
                </div>
              ) : <div className="w-8 bg-gray-100 rounded border border-gray-200 h-3.5 shrink-0" />}

            </div>
          </div>
        )}
      </div>
    </Reorder.Item>
  );
};

export default function FinalizeBoq() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [boqItems, setBoqItems] = useState<BOMItem[]>([]);
  const [bomVersions, setBomVersions] = useState<BOQVersion[]>([]);
  const [boqVersions, setBoqVersions] = useState<BOQVersion[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedBomVersionId, setSelectedBomVersionId] = useState<string | null>(null);
  const [selectedBoqVersionId, setSelectedBoqVersionId] = useState<string | null>(null);
  const [showFinalizedPicker, setShowFinalizedPicker] = useState(false);
  const [finalizedItems, setFinalizedItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const dragControls = useDragControls();
  const [templates, setTemplates] = useState<BOQTemplate[]>([]);
  const [isSaveTemplateDialogOpen, setIsSaveTemplateDialogOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");

  // Delete Confirmation Dialog State
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmCallback, setDeleteConfirmCallback] = useState<(action: "archive" | "trash") => void>(() => () => { });
  const [deleteConfirmTitle, setDeleteConfirmTitle] = useState("");
  const [deleteConfirmItem, setDeleteConfirmItem] = useState("");

  const openDeleteConfirm = (title: string, itemName: string, onConfirm: (action: "archive" | "trash") => void) => {
    setDeleteConfirmTitle(title);
    setDeleteConfirmItem(itemName);
    setDeleteConfirmCallback(() => (action: "archive" | "trash") => onConfirm(action));
    setDeleteConfirmOpen(true);
  };
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  const [customColumns, setCustomColumns] = useState<{ [id: string]: any[] }>({});
  const [customColumnValues, setCustomColumnValues] = useState<{ [id: string]: { [rowIdx: number]: { [col: string]: string } } }>({});
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [productDescriptions, setProductDescriptions] = useState<{ [id: string]: string }>({});
  const [projectStatusFilter, setProjectStatusFilter] = useState<string>("all");
  const [projectSearchTerm, setProjectSearchTerm] = useState("");

  const filteredProjects = React.useMemo(() => {
    return projects.filter((p) => {
      // Filter by search term
      if (projectSearchTerm && !fuzzySearch(projectSearchTerm, [p.name, p.client])) return false;

      // Filter by status
      if (projectStatusFilter === "all") return true;
      return p.project_status === projectStatusFilter;
    });
  }, [projects, projectStatusFilter, projectSearchTerm]);
  const [savingLayoutId, setSavingLayoutId] = useState<string | null>(null);
  const [showColumnTotals, setShowColumnTotals] = useState(true);
  const [hideSystemTotalFooter, setHideSystemTotalFooter] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [productQuantities, setProductQuantities] = useState<{ [id: string]: string }>({});
  const [productUnits, setProductUnits] = useState<{ [id: string]: string }>({});
  const [overrideRates, setOverrideRates] = useState<{ [id: string]: string }>({});
  const [grandTotalColumn, setGrandTotalColumn] = useState<string>("Total Value (₹)");
  const [termsAndConditions, setTermsAndConditions] = useState<string>("");

  const [globalColSettings, setGlobalColSettings] = useState<{ [colName: string]: any }>({});
  const [isColumnManagerOpen, setIsColumnManagerOpen] = useState(false);

  const handleHideSelectedRows = async (hide: boolean) => {
    if (selectedProductIds.size === 0) return;
    try {
      const ids = Array.from(selectedProductIds);
      await Promise.all(ids.map(id => {
        const item = boqItems.find(i => i.id === id);
        let td = item?.table_data || {};
        if (typeof td === "string") try { td = JSON.parse(td); } catch { td = {}; }
        const updatedTd = { ...td, finalize_hide_row: hide };
        return apiFetch(`/api/boq-items/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ table_data: updatedTd }),
        });
      }));
      loadBoqItemsAndEdits(activeVersionId);
      setSelectedProductIds(new Set());
      toast({ title: hide ? "Rows Hidden" : "Rows Restored", description: `${ids.length} row(s) updated.` });
    } catch (e) {
      toast({ title: "Error", description: "Failed to update row visibility", variant: "destructive" });
    }
  };



  // BOM versions: only show approved versions for selection
  const filteredBomVersions = React.useMemo(() => {
    return bomVersions.filter(v => v.status === "approved");
  }, [bomVersions]);

  // BOQ versions: show draft and approved so users can work on them
  const filteredBoqVersions = React.useMemo(() => {
    return boqVersions.filter(v => v.status === "draft" || v.status === "approved" || v.status === "submitted");
  }, [boqVersions]);

  const activeVersionId = selectedBoqVersionId || selectedBomVersionId;
  const activeVersion = [...bomVersions, ...boqVersions].find(v => v.id === activeVersionId);

  const snapshot = (activeVersion as any)?.last_template_snapshot;
  const getIsModified = (itemId: string, field: string, currentValue: any) => {
    if (!snapshot || !snapshot.itemData) return false;
    const originalItem = snapshot.itemData[itemId];
    if (!originalItem) return false;

    if (field === "columns") {
      const colName = currentValue;
      const originalCol = snapshot.columns.find((c: any) => c.name === colName);
      if (!originalCol) return true; // NEW Column!

      const itemCols = customColumns[itemId] || [];
      const currentCol = itemCols.find(c => c.name === colName);
      if (!currentCol) return false;
      return (
        currentCol.baseSource !== originalCol.baseSource ||
        currentCol.operator !== originalCol.operator ||
        String(currentCol.percentageValue) !== String(originalCol.percentageValue) ||
        currentCol.multiplierSource !== originalCol.multiplierSource ||
        currentCol.isTotal !== originalCol.isTotal
      );
    }

    const originalVal = String(originalItem[field] ?? "");
    const curVal = String(currentValue ?? "");
    return curVal !== originalVal;
  };

  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [selectedExportCols, setSelectedExportCols] = useState<string[]>(() => {
    try { const saved = localStorage.getItem('finalize_excel_export_cols'); return saved ? JSON.parse(saved) : []; } catch { return []; }
  });
  const [isPdfExportDialogOpen, setIsPdfExportDialogOpen] = useState(false);
  const [selectedPdfExportCols, setSelectedPdfExportCols] = useState<string[]>(() => {
    try { const saved = localStorage.getItem('finalize_pdf_export_cols'); return saved ? JSON.parse(saved) : []; } catch { return []; }
  });
  const [hiddenPredefinedCols, setHiddenPredefinedCols] = useState<Record<string, boolean>>({});

  const handleToggleColumnTotalVisibility = async (colName: string, hide: boolean) => {
    const updates = boqItems.map(item => {
      const nextCols = (customColumns[item.id] || []).map(c =>
        c.name === colName ? { ...c, hideTotal: hide } : c
      );
      setCustomColumns(prev => ({ ...prev, [item.id]: nextCols }));
      return saveItemLayout(item.id, nextCols);
    });
    await Promise.all(updates);
    toast({ title: hide ? "Total Hidden" : "Total Shown", description: `Column total for "${colName}" updated.` });
  };

  const handleSetGrandTotalColumn = async (colName: string) => {
    setGrandTotalColumn(colName);
    // Persist to all items in version
    const updates = boqItems.map(item => {
      let td = item.table_data || {};
      if (typeof td === "string") try { td = JSON.parse(td); } catch { td = {}; }
      const updatedTd = { ...td, finalize_grand_total_column: colName };
      return apiFetch(`/api/boq-items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table_data: updatedTd }),
      });
    });
    await Promise.all(updates);
    toast({ title: "Grand Total Updated", description: `Source changed to "${colName}"` });
  };

  const handleUpdateTermsAndConditions = async (val: string) => {
    setTermsAndConditions(val);
    try {
      await apiFetch("/api/global-settings/terms_and_conditions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: val }),
      });
    } catch (err) {
      console.error("Failed to update terms and conditions:", err);
    }
  };

  const handleHideColumn = async (colName: string, hide: boolean) => {
    const mapping: Record<string, string> = {
      "S.No": "sno",
      "Product / Material": "product",
      "Description / Location": "description",
      "HSN": "hsn",
      "SAC": "sac",
      "Rate": "rate",
      "Unit": "unit",
      "Qty": "qty",
      "System Total (J)": "system_total",
      "Rate (K)": "override_rate",
      "Total (L)": "override_total"
    };

    if (mapping[colName]) {
      const nextHidden = { ...hiddenPredefinedCols, [mapping[colName]]: hide };
      setHiddenPredefinedCols(nextHidden);

      const updates = boqItems.map(item => saveItemLayout(item.id, undefined, undefined, undefined, undefined, undefined, undefined, nextHidden));
      await Promise.all(updates);

      toast({ title: hide ? "Column Hidden" : "Column Restored", description: `Column "${colName}" visibility updated.` });
      return;
    }

    const updates = boqItems.map(item => {
      const nextCols = (customColumns[item.id] || []).map(c =>
        c.name === colName ? { ...c, hideColumn: hide } : c
      );
      setCustomColumns(prev => ({ ...prev, [item.id]: nextCols }));
      return saveItemLayout(item.id, nextCols);
    });
    await Promise.all(updates);
    toast({ title: hide ? "Column Hidden" : "Column Restored", description: `Column "${colName}" visibility updated.` });
  };

  const handleSetSystemTotalVisibility = async (visible: boolean) => {
    setHideSystemTotalFooter(!visible);
    // Persist this flag to all items in current version
    const updates = boqItems.map(item => {
      let td = item.table_data || {};
      if (typeof td === "string") try { td = JSON.parse(td); } catch { td = {}; }
      const updatedTd = { ...td, finalize_hide_system_total: !visible };
      return apiFetch(`/api/boq-items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table_data: updatedTd }),
      });
    });
    await Promise.all(updates);
    toast({
      title: visible ? "System Total Restored" : "System Total Hidden",
      description: visible ? "Reference value is now visible." : "Reference value removed from footer."
    });
  };

  const allCols = React.useMemo(() => {
    const cols: { name: string, isTotal: boolean, isPercentage?: boolean, percentageValue?: number, baseValue?: number, baseSource?: string, multiplierSource?: string, operator?: string, hideTotal?: boolean, hideColumn?: boolean }[] = [];
    boqItems.forEach(item => {
      (customColumns[item.id] || []).forEach(col => {
        const c = { ...col, isPercentage: col.isPercentage ?? (col.baseSource && col.baseSource !== "manual") };
        if (!cols.find(cc => cc.name === c.name)) cols.push(c);
      });
    });
    return cols;
  }, [boqItems, customColumns]);

  const hiddenCols = React.useMemo(() => {
    const hidden: string[] = [];
    boqItems.forEach(item => {
      (customColumns[item.id] || []).forEach(col => {
        if (col.hideColumn && !hidden.includes(col.name)) {
          hidden.push(col.name);
        }
      });
    });

    const mapping: Record<string, string> = {
      sno: "S.No",
      product: "Product / Material",
      description: "Description / Location",
      hsn: "HSN",
      sac: "SAC",
      rate: "Rate",
      unit: "Unit",
      qty: "Qty",
      system_total: "System Total (J)",
      override_rate: "Rate (K)",
      override_total: "Total (L)"
    };
    Object.entries(hiddenPredefinedCols).forEach(([id, isHidden]) => {
      if (isHidden && mapping[id] && !hidden.includes(mapping[id])) {
        hidden.push(mapping[id]);
      }
    });

    return hidden;
  }, [boqItems, customColumns, hiddenPredefinedCols]);

  const calculatedColumnTotals = React.useMemo(() => {
    let totals = allCols.map(() => 0);
    let totalValueSum = 0;
    let totalRateSum = 0;
    let totalQtySum = 0;
    let overrideTotalSum = 0;

    boqItems.forEach(item => {
      let td = item.table_data || {};
      if (typeof td === "string") try { td = JSON.parse(td); } catch { td = {}; }

      const { itemRate, itemQty } = getItemMetrics(td);

      const manualQtyStr = productQuantities[item.id];
      const displayQty = manualQtyStr !== undefined
        ? (parseFloat(manualQtyStr) || 0)
        : itemQty;

      const baseTotalValue = itemRate * displayQty;
      totalValueSum += baseTotalValue;
      totalRateSum += itemRate;

      const overrideRate = parseFloat(overrideRates[item.id] || "0") || 0;
      const overrideTotalVal = overrideRate * displayQty;
      overrideTotalSum += overrideTotalVal;

      let currentItemRunningTotal = overrideRate > 0 ? overrideTotalVal : baseTotalValue;
      let accumulator = 0;
      const rowCalculatedValues: { [colName: string]: number } = {};

      allCols.forEach((col, idx) => {
        const itemCol = (customColumns[item.id] || []).find(c => c.name === col.name) || col;

        if (col.isTotal) {
          currentItemRunningTotal += accumulator;
          accumulator = 0;
          rowCalculatedValues[col.name] = currentItemRunningTotal;
          totals[idx] += currentItemRunningTotal;
        } else {
          let val = 0;
          const baseSource = itemCol.baseSource;
          const operator = itemCol.operator || "%";
          const multiplierSource = itemCol.multiplierSource || "manual";
          const manualMultiplier = itemCol.percentageValue || 0;

          if (baseSource && baseSource !== "manual") {
            const _ctx: SrcCtx = {
              totalVal: baseTotalValue, rate: itemRate, qty: displayQty,
              overrideRate: parseFloat(overrideRates[item.id] || "0") || 0,
              overrideTotal: (parseFloat(overrideRates[item.id] || "0") || 0) * displayQty,
              rowCalc: rowCalculatedValues, customVals: customColumnValues[item.id]?.[0] || {},
            };
            const baseVal = resolveSource(baseSource, _ctx);
            const multiplierVal = multiplierSource === "manual" ? manualMultiplier : resolveSource(multiplierSource, _ctx);
            val = applyOperator(baseVal, multiplierVal, operator);
          } else {
            // Manual entry column
            val = parseFloat(customColumnValues[item.id]?.[0]?.[col.name] || "0") || 0;
          }

          rowCalculatedValues[col.name] = val;
          accumulator += val;
          totals[idx] += val;
        }
      });
    });

    return { totals, totalValueSum, totalRateSum, totalQtySum, overrideTotalSum };
  }, [boqItems, allCols, customColumns, customColumnValues, productQuantities, overrideRates]);

  const handleColumnReorder = async (newOrder: typeof allCols) => {
    // Optimistically update local state for all items
    const nextColsMap: any = {};
    boqItems.forEach(item => {
      const itemCols = customColumns[item.id] || [];
      // Keep hidden columns but align visible ones to the new order
      const hidden = itemCols.filter(c => c.hideColumn);
      const sortedVisible = newOrder
        .map(oc => itemCols.find(ic => ic.name === oc.name))
        .filter(Boolean);
      nextColsMap[item.id] = [...sortedVisible, ...hidden];
    });

    setCustomColumns(prev => ({ ...prev, ...nextColsMap }));

    try {
      const updates = boqItems.map(item => saveItemLayout(item.id, nextColsMap[item.id]));
      await Promise.all(updates);
      toast({ title: "Order Saved", description: "Column sequence updated." });
    } catch (e) {
      console.error("Column sort failed:", e);
      toast({ title: "Error", description: "Failed to save column order", variant: "destructive" });
    }
  };

  const getItemTotal = (boqItem: BOMItem) => {
    let td = boqItem.table_data || {};
    if (typeof td === 'string') try { td = JSON.parse(td); } catch { td = {}; }
    let total = 0;
    if (td.materialLines && td.targetRequiredQty !== undefined) {
      total = computeBoq(td.configBasis, td.materialLines, td.targetRequiredQty).grandTotal;
    } else {
      const items = Array.isArray(td.step11_items) ? td.step11_items : [];
      total = items.reduce((s: number, it: any) =>
        s + (it.qty || 0) * ((it.supply_rate || 0) + (it.install_rate || 0)), 0);
    }
    return total;
  };

  const [editedFields, setEditedFields] = useState<{
    [key: string]: {
      description?: string;
      unit?: string;
      qty?: number;
      supply_rate?: number;
      install_rate?: number;
    };
  }>({});
  const editedFieldsRef = useRef(editedFields);
  useEffect(() => {
    editedFieldsRef.current = editedFields;
  }, [editedFields]);

  useEffect(() => {
    const loadProjects = async () => {
      try {
        const response = await apiFetch("/api/boq-projects", {
          headers: {},
        });
        if (response.ok) {
          const data = await response.json();
          setProjects(data.projects || []);
        }
      } catch (err) {
        console.error("Failed to load projects:", err);
      } finally {
        setLoading(false);
      }
    };

    loadProjects();
  }, []);

  useEffect(() => {
    if (selectedProjectId && !filteredProjects.some((p) => p.id === selectedProjectId)) {
      setSelectedProjectId(null);
      setSelectedBomVersionId(null);
      setSelectedBoqVersionId(null);
    }
  }, [filteredProjects, selectedProjectId]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isFullscreen]);

  const loadTemplates = React.useCallback(async () => {
    try {
      const resp = await apiFetch("/api/boq-templates");
      if (resp.ok) {
        const data = await resp.json();
        setTemplates(data.templates || []);
      }
    } catch (e) {
      console.error("Failed to load templates:", e);
    }
  }, []);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [, settingsResp] = await Promise.all([
          loadTemplates(),
          apiFetch("/api/global-settings")
        ]);

        if (settingsResp.ok) {
          const settings = await settingsResp.json();
          if (settings.terms_and_conditions) {
            setTermsAndConditions(settings.terms_and_conditions);
          }
        }
      } catch (err) {
        console.error("Failed to load initial data:", err);
      }
    };
    loadInitialData();
  }, [loadTemplates]);

  useEffect(() => {
    if (!selectedProjectId) {
      setBomVersions([]);
      setBoqVersions([]);
      setSelectedBomVersionId(null);
      setSelectedBoqVersionId(null);
      setBoqItems([]);
      setSelectedProductIds(new Set());
      setIsFullscreen(false);
      setCustomColumns({});
      setCustomColumnValues({});
      setProductDescriptions({});
      setProductQuantities({});
      setProductUnits({});
      setOverrideRates({});
      setGlobalColSettings({});
      return;
    }

    const loadVersions = async () => {
      try {
        const [bomResp, boqResp] = await Promise.all([
          apiFetch(`/api/boq-versions/${encodeURIComponent(selectedProjectId)}?type=bom`),
          apiFetch(`/api/boq-versions/${encodeURIComponent(selectedProjectId)}?type=boq`)
        ]);

        if (bomResp.ok && boqResp.ok) {
          const bomData = await bomResp.json();
          const boqData = await boqResp.json();
          const bomList = bomData.versions || [];
          const boqList = boqData.versions || [];
          setBomVersions(bomList);
          setBoqVersions(boqList);

          // Logic for selecting initial BOM version
          if (selectedBomVersionId && bomList.some((v: BOQVersion) => v.id === selectedBomVersionId)) {
            // keep existing
          } else {
            const approved = bomList.find((v: BOQVersion) => v.status === "approved");
            const selectable = bomList.filter((v: BOQVersion) => v.status === "approved");

            if (approved && selectable.some((v: BOQVersion) => v.id === approved.id)) {
              setSelectedBomVersionId(approved.id);
            } else if (selectable.length > 0) {
              setSelectedBomVersionId(selectable[0].id);
            } else {
              setSelectedBomVersionId(null);
            }
          }

          // Logic for selecting initial BOQ version
          if (selectedBoqVersionId && boqList.some((v: BOQVersion) => v.id === selectedBoqVersionId)) {
            // keep existing
          } else if (boqList.length > 0) {
            setSelectedBoqVersionId(boqList[0].id);
          } else {
            setSelectedBoqVersionId(null);
          }
        }
      } catch (err) {
        console.error("Failed to load versions:", err);
      }
    };

    loadVersions();
  }, [selectedProjectId]);

  const loadBoqItemsAndEdits = useCallback(async (versionId: string | null) => {
    // ... clearing states ...
    setBoqItems([]);
    setSelectedProductIds(new Set());
    // ... (rest of clears)
    setCustomColumns({});
    setCustomColumnValues({});
    setProductDescriptions({});
    setProductQuantities({});
    setProductUnits({});
    setOverrideRates({});
    setGlobalColSettings({});
    setHideSystemTotalFooter(false);
    setGrandTotalColumn("Total Value (₹)");
    setHiddenPredefinedCols({});

    if (!versionId) return;
    try {
      const safeParseJson = async (res: Response) => {
        const text = await res.text();
        if (!text.trim() || res.status === 204) return {};
        try { return JSON.parse(text); } catch { throw new Error(`Invalid JSON (status=${res.status})`); }
      };

      const response = await apiFetch(
        `/api/boq-items/version/${encodeURIComponent(versionId)}`,
        { headers: {} },
      );
      if (response.ok) {
        try {
          const data = await safeParseJson(response as unknown as Response);
          const items: BOMItem[] = data.items || [];
          setBoqItems(items);

          const restoredCols: { [id: string]: { name: string, isTotal: boolean, hideTotal?: boolean }[] } = {};
          const restoredVals: { [id: string]: { [rowIdx: number]: { [col: string]: string } } } = {};
          const restoredDescs: { [id: string]: string } = {};
          const restoredQtys: { [id: string]: string } = {};
          const restoredUnits: { [id: string]: string } = {};
          const restoredOverrideRates: { [id: string]: string } = {};
          let sysTotalHidden = false;
          let restoredGrandTotalCol = "Total Value (₹)";
          let restoredHiddenPredefined: Record<string, boolean> = {};

          for (const item of items) {
            let td = item.table_data || {};
            if (typeof td === "string") try { td = JSON.parse(td); } catch { td = {}; }

            if (td.finalize_hide_system_total) sysTotalHidden = true;
            if (td.finalize_grand_total_column) restoredGrandTotalCol = td.finalize_grand_total_column;
            if (td.finalize_hidden_predefined_cols) {
              restoredHiddenPredefined = { ...restoredHiddenPredefined, ...td.finalize_hidden_predefined_cols };
            }

            if (Array.isArray(td.finalize_columns) && td.finalize_columns.length > 0) {
              restoredCols[item.id] = td.finalize_columns.map((c: any) =>
                typeof c === "string" ? { name: c, isTotal: false, hideTotal: false } : c
              );
            }
            if (td.finalize_column_values && typeof td.finalize_column_values === "object") {
              restoredVals[item.id] = td.finalize_column_values;
            }
            if (typeof td.finalize_description === "string") {
              restoredDescs[item.id] = td.finalize_description;
            }
            if (td.finalize_qty !== undefined && td.finalize_qty !== null) {
              restoredQtys[item.id] = String(td.finalize_qty);
            }
            if (td.finalize_unit !== undefined && td.finalize_unit !== null) {
              restoredUnits[item.id] = String(td.finalize_unit);
            }
            if (td.finalize_override_rate !== undefined && td.finalize_override_rate !== null) {
              restoredOverrideRates[item.id] = String(td.finalize_override_rate);
            }
          }

          try {
            const productsResp = await apiFetch("/api/products");
            if (productsResp.ok) {
              const productsData = await productsResp.json();
              const productsList: any[] = productsData.products || [];
              const productsById: { [id: string]: any } = {};
              productsList.forEach((p: any) => { productsById[p.id] = p; });

              for (const item of items) {
                let td = item.table_data || {};
                if (typeof td === "string") try { td = JSON.parse(td); } catch { td = {}; }
                if (td.product_id) {
                  const prod = productsById[td.product_id];
                  if (prod) {
                    // Update missing HSN/SAC
                    if (!td.hsn_code && !td.sac_code) {
                      if (prod.hsn_code) td.hsn_code = prod.hsn_code;
                      if (prod.sac_code) td.sac_code = prod.sac_code;
                      if (prod.tax_code_value) {
                        td.hsn_sac_code = prod.tax_code_value;
                        td.hsn_sac_type = prod.tax_code_type || null;
                      }
                    }
                    // Always try to attach image if it exists in the catalog but not in table_data
                    if (prod.image && !td.image) {
                      td.image = prod.image;
                    }
                    item.table_data = td;
                  }
                }
              }
            }
          } catch (e) {
            console.warn("Failed to backfill HSN/SAC codes in FinalizeBoq:", e);
          }
          if (Object.keys(restoredCols).length > 0) {
            setCustomColumns(restoredCols);
            const firstItemId = Object.keys(restoredCols)[0];
            if (firstItemId) {
              const initialGlobal: any = {};
              restoredCols[firstItemId].forEach((col: any) => {
                initialGlobal[col.name] = {
                  baseValue: col.baseValue,
                  percentageValue: col.percentageValue,
                  baseSource: col.baseSource
                };
              });
              setGlobalColSettings(initialGlobal);
            }
          }
          if (Object.keys(restoredVals).length > 0) setCustomColumnValues(restoredVals);
          if (Object.keys(restoredDescs).length > 0) setProductDescriptions(restoredDescs);
          if (Object.keys(restoredQtys).length > 0) setProductQuantities(restoredQtys);
          if (Object.keys(restoredUnits).length > 0) setProductUnits(restoredUnits);
          if (Object.keys(restoredOverrideRates).length > 0) setOverrideRates(restoredOverrideRates);
          setHideSystemTotalFooter(sysTotalHidden);
          setGrandTotalColumn(restoredGrandTotalCol);
          setHiddenPredefinedCols(restoredHiddenPredefined);
        } catch (e) {
          toast({ title: "Error", description: "Failed to parse BOM items response", variant: "destructive" });
          console.error("BOM items parse error:", e);
        }
      } else {
        const body = await response.text();
        console.error("Failed to fetch BOM items:", response.status, body);
        toast({ title: "Error", description: `Failed to load BOM items (${response.status})`, variant: "destructive" });
      }
    } catch (err) {
      console.error("Failed to load BOM items:", err);
      toast({ title: "Error", description: "Failed to load BOM items", variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => {
    loadBoqItemsAndEdits(selectedBoqVersionId || selectedBomVersionId);
  }, [selectedBomVersionId, selectedBoqVersionId, loadBoqItemsAndEdits]);

  useEffect(() => {
    try {
      const qs =
        typeof location === "string" ? location.split("?")[1] || "" : "";
      const params = new URLSearchParams(qs);
      const projectParam = params.get("project");
      if (projectParam && projectParam !== selectedProjectId) {
        const exists = projects.find((p) => p.id === projectParam);
        if (exists) setSelectedProjectId(projectParam);
      }
    } catch (e) {
      // ignore
    }
  }, [location, projects]);

  // Project creation moved to dedicated Create Project page

  const handleAddFinalized = async () => {
    if (!selectedProjectId) return;
    try {
      const response = await apiFetch("/api/boq-items/finalized", { headers: {} });
      if (response.ok) {
        const data = await response.json();
        setFinalizedItems(data.items || []);
        setShowFinalizedPicker(true);
      } else {
        toast({ title: "Error", description: "Failed to load finalized items", variant: "destructive" });
      }
    } catch (e) {
      console.error("Failed to load finalized items", e);
      toast({ title: "Error", description: "Failed to load finalized items", variant: "destructive" });
    }
  };

  const handleSelectFinalizedItem = async (originalItem: any) => {
    if (!selectedProjectId || !activeVersionId) return;

    try {
      const tableData = typeof originalItem.table_data === 'string'
        ? JSON.parse(originalItem.table_data)
        : originalItem.table_data;

      const response = await apiFetch("/api/boq-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: selectedProjectId,
          version_id: activeVersionId,
          estimator: originalItem.estimator,
          table_data: tableData, // Copy exact data including is_finalized flag
        }),
      });

      if (response.ok) {
        const newItem = await response.json();
        const td = newItem.table_data;

        // Initialize local state for the new item
        if (Array.isArray(td.finalize_columns)) {
          setCustomColumns(prev => ({ ...prev, [newItem.id]: td.finalize_columns }));
        }
        if (td.finalize_column_values) {
          setCustomColumnValues(prev => ({ ...prev, [newItem.id]: td.finalize_column_values }));
        }
        if (td.finalize_description) {
          setProductDescriptions(prev => ({ ...prev, [newItem.id]: td.finalize_description }));
        }
        if (td.finalize_qty !== undefined) {
          setProductQuantities(prev => ({ ...prev, [newItem.id]: String(td.finalize_qty) }));
        }
        if (td.finalize_unit) {
          setProductUnits(prev => ({ ...prev, [newItem.id]: td.finalize_unit }));
        }
        if (td.finalize_override_rate) {
          setOverrideRates(prev => ({ ...prev, [newItem.id]: String(td.finalize_override_rate) }));
        }

        setBoqItems(prev => [...prev, newItem]);
        setShowFinalizedPicker(false);
        toast({ title: "Success", description: "Added finalized item" });
        loadBoqItemsAndEdits(selectedBoqVersionId || selectedBomVersionId);
      } else {
        throw new Error("Failed to add item");
      }
    } catch (e) {
      console.error("Failed to add finalized item", e);
      toast({ title: "Error", description: "Failed to add item", variant: "destructive" });
    }
  };

  const handleSelectFinalizedItemWrapper = async (originalItem: any) => {
    const td = typeof originalItem.table_data === 'string' ? JSON.parse(originalItem.table_data) : originalItem.table_data;
    await handleSelectFinalizedItem(originalItem);
  };

  const updateEditedField = (itemKey: string, field: string, value: any) => {
    setEditedFields((prev) => {
      const next = {
        ...prev,
        [itemKey]: {
          ...prev[itemKey],
          [field]: value,
        },
      };
      editedFieldsRef.current = next;
      return next;
    });
  };

  const saveItemLayout = async (boqItemId: string, updatedCols?: any[], updatedVals?: any, updatedDesc?: string, updatedQty?: string, updatedOverrideRate?: string, updatedUnit?: string, updatedHiddenPredefinedCols?: Record<string, boolean>) => {
    try {
      const boqItem = boqItems.find(i => i.id === boqItemId);
      if (!boqItem) return;

      let existingTd = boqItem.table_data || {};
      if (typeof existingTd === "string") {
        try { existingTd = JSON.parse(existingTd); } catch { existingTd = {}; }
      }

      const updatedTd = {
        ...existingTd,
        finalize_columns: updatedCols !== undefined ? updatedCols : (customColumns[boqItemId] || []),
        finalize_column_values: updatedVals !== undefined ? updatedVals : (customColumnValues[boqItemId] || {}),
        finalize_description: updatedDesc !== undefined ? updatedDesc : (productDescriptions[boqItemId] ?? ""),
        finalize_qty: updatedQty !== undefined ? updatedQty : (productQuantities[boqItemId] ?? null),
        finalize_unit: updatedUnit !== undefined ? updatedUnit : (productUnits[boqItemId] ?? null),
        finalize_override_rate: updatedOverrideRate !== undefined ? updatedOverrideRate : (overrideRates[boqItemId] ?? null),
        finalize_hide_system_total: hideSystemTotalFooter,
        finalize_grand_total_column: grandTotalColumn,
        finalize_hidden_predefined_cols: updatedHiddenPredefinedCols !== undefined ? updatedHiddenPredefinedCols : hiddenPredefinedCols,
      };

      const resp = await apiFetch(`/api/boq-items/${boqItemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table_data: updatedTd }),
      });

      if (resp.ok) {
        setBoqItems(prev => prev.map(i =>
          i.id === boqItemId ? { ...i, table_data: updatedTd } : i
        ));
      } else {
        throw new Error("Save failed");
      }
    } catch (e) {
      console.error("Failed to save item layout:", e);
      toast({ title: "Error", description: "Failed to persist changes to database", variant: "destructive" });
    }
  };

  const handleDeleteColumn = async (boqItemId: string, colIdx: number) => {
    const colName = customColumns[boqItemId][colIdx].name;
    openDeleteConfirm(`Delete Column "${colName}"?`, colName, async (action) => {
      const nextCols = [...(customColumns[boqItemId] || [])];
      nextCols.splice(colIdx, 1);

      const itemValues = { ...(customColumnValues[boqItemId] || {}) };
      Object.keys(itemValues).forEach((rowIdxStr) => {
        const rowIdx = parseInt(rowIdxStr);
        const rowVals = { ...itemValues[rowIdx] };
        delete rowVals[colName];
        itemValues[rowIdx] = rowVals;
      });

      setCustomColumns((prev) => ({ ...prev, [boqItemId]: nextCols }));
      setCustomColumnValues((prev) => ({ ...prev, [boqItemId]: itemValues }));

      await saveItemLayout(boqItemId, nextCols, itemValues);
      toast({ title: action === 'trash' ? "Moved to Trash" : "Archived", description: `Column "${colName}" removed and saved.` });
    });
  };

  const handleCloneColumn = async (boqItemId: string, colIdx: number) => {
    const originalCol = customColumns[boqItemId][colIdx];
    const newColName = `${originalCol.name} (Copy)`;

    const nextCols = [...(customColumns[boqItemId] || []), { ...originalCol, name: newColName }];

    const itemValues = { ...(customColumnValues[boqItemId] || {}) };
    Object.keys(itemValues).forEach((rowIdxStr) => {
      const rowIdx = parseInt(rowIdxStr);
      const rowVals = { ...(itemValues[rowIdx] || {}) };
      if (rowVals[originalCol.name] !== undefined) {
        rowVals[newColName] = rowVals[originalCol.name];
      }
      itemValues[rowIdx] = rowVals;
    });

    // Strategy: We check the value AFTER clonning. 
    // Since cloning just copies a column, it might increase the project value if the column is part of the total.
    // However, usually cloning doesn't immediately change the 'totalValueSum' unless it's a total column (which we don't allow cloning easily).
    // But to be safe, we wrap it.
    setCustomColumns((prev) => ({ ...prev, [boqItemId]: nextCols }));
    setCustomColumnValues((prev) => ({ ...prev, [boqItemId]: itemValues }));

    await saveItemLayout(boqItemId, nextCols, itemValues);
    toast({ title: "Column Cloned", description: `Column "${originalCol.name}" cloned to "${newColName}" and saved.` });
  };

  const handleGlobalCalculation = async (colName: string, base: number, multiplier: number, baseSource: string = "manual", operator: string = "%", multiplierSource: string = "manual") => {
    const oldSettings = globalColSettings[colName] || {};
    const oldMultiplier = oldSettings.percentageValue || 0;
    const deltaMultiplier = multiplier - oldMultiplier;

    // Calculate future total
    let futureTotal = 0;
    boqItems.forEach(item => {
      let td = item.table_data || {};
      if (typeof td === "string") try { td = JSON.parse(td); } catch { td = {}; }
      const { itemRate, itemQty } = getItemMetrics(td);
      const displayQty = productQuantities[item.id] !== undefined ? (parseFloat(productQuantities[item.id]) || 0) : itemQty;
      const baseTotalValue = itemRate * displayQty;

      let itemCols = [...(customColumns[item.id] || [])];
      let colIdx = itemCols.findIndex(c => c.name === colName);
      if (colIdx === -1) {
        const globalCol = allCols.find(c => c.name === colName);
        if (globalCol) itemCols.push({ ...globalCol });
        else itemCols.push({ name: colName, isTotal: false });
        colIdx = itemCols.length - 1;
      }
      const itemCol = itemCols[colIdx];
      const currentRowMultiplier = itemCol?.percentageValue || oldMultiplier;
      const newRowMultiplier = currentRowMultiplier + deltaMultiplier;

      const overrideRate = parseFloat(overrideRates[item.id] || "0") || 0;
      const srcCtx: SrcCtx = {
        totalVal: baseTotalValue, rate: itemRate, qty: displayQty,
        overrideRate, overrideTotal: overrideRate * displayQty,
        rowCalc: {}, customVals: customColumnValues[item.id]?.[0] || {},
      };
      const rowBase = baseSource === "manual" ? base : resolveSource(baseSource, srcCtx);
      const rowMultiplierVal = multiplierSource === "manual" ? newRowMultiplier : resolveSource(multiplierSource, srcCtx);
      const calculated = applyOperator(rowBase, rowMultiplierVal, operator);

      // This is a simplified check - we assume the rest of the row stays same.
      // Accurate enough for a warning.
      futureTotal += baseTotalValue; // Base value
      // Plus calculated columns... (this is complex because columns depend on each other)
      // For now, we use the easiest approximation: base value + the change in THIS column.
      // But currentProjectValue is already reactive.
    });

    // Better approach: Since currentProjectValue is reactive to state, 
    // but withBudgetCheck needs to know the FUTURE value before we update state.
    // We'll use a pragmatic approach: if the multiplier/item changes, we check if it increases.

    setGlobalColSettings(prev => ({
      ...prev,
      [colName]: { baseValue: base, percentageValue: multiplier, baseSource, operator, multiplierSource }
    }));

    const nextColsMap: any = {};
    const nextValsMap: any = {};

    boqItems.forEach(item => {
      let itemCols = [...(customColumns[item.id] || [])];
      let colIdx = itemCols.findIndex(c => c.name === colName);

      if (colIdx === -1) {
        const globalCol = allCols.find(c => c.name === colName);
        if (globalCol) itemCols.push({ ...globalCol });
        else itemCols.push({ name: colName, isTotal: false });
        colIdx = itemCols.length - 1;
      }

      const itemCol = itemCols[colIdx];
      const currentRowMultiplier = itemCol?.percentageValue || oldMultiplier;
      const newRowMultiplier = currentRowMultiplier + deltaMultiplier;

      let td = item.table_data || {};
      if (typeof td === "string") try { td = JSON.parse(td); } catch { td = {}; }
      const { itemRate, itemQty } = getItemMetrics(td);
      const displayQty = productQuantities[item.id] !== undefined ? (parseFloat(productQuantities[item.id]) || 0) : itemQty;

      const overrideRate = parseFloat(overrideRates[item.id] || "0") || 0;
      const srcCtx: SrcCtx = {
        totalVal: itemRate * displayQty, rate: itemRate, qty: displayQty,
        overrideRate, overrideTotal: overrideRate * displayQty,
        rowCalc: {}, customVals: customColumnValues[item.id]?.[0] || {},
      };
      const rowBase = baseSource === "manual" ? base : resolveSource(baseSource, srcCtx);

      itemCols[colIdx] = {
        ...itemCols[colIdx],
        baseValue: base,
        percentageValue: newRowMultiplier,
        baseSource,
        operator,
        multiplierSource
      };
      const updatedCols = itemCols;
      nextColsMap[item.id] = updatedCols;

      const rowMultiplierVal = multiplierSource === "manual" ? newRowMultiplier : resolveSource(multiplierSource, srcCtx);
      const calculated = applyOperator(rowBase, rowMultiplierVal, operator);

      const itemVals = { ...(customColumnValues[item.id] || {}) };
      itemVals[0] = { ...(itemVals[0] || {}), [colName]: calculated.toFixed(2) };
      nextValsMap[item.id] = itemVals;
    });

    setCustomColumns(prev => ({ ...prev, ...nextColsMap }));
    setCustomColumnValues(prev => ({ ...prev, ...nextValsMap }));

    await Promise.all(boqItems.map(item =>
      saveItemLayout(item.id, nextColsMap[item.id], nextValsMap[item.id])
    ));
  };

  const handleItemCalculation = async (boqItemId: string, colName: string, multiplier: number, operator: string = "%", multiplierSource: string = "manual", baseSourceOverride?: string) => {
    const item = boqItems.find(i => i.id === boqItemId);
    if (!item) return;

    let itemCols = [...(customColumns[item.id] || [])];
    let colIdx = itemCols.findIndex(c => c.name === colName);

    if (colIdx === -1) {
      const globalCol = allCols.find(c => c.name === colName);
      if (!globalCol) return;
      itemCols.push({ ...globalCol });
      colIdx = itemCols.length - 1;
    }

    const itemCol = itemCols[colIdx];

    const baseSource = baseSourceOverride || itemCol.baseSource || "Total Value (₹)";
    let td = item.table_data || {};
    if (typeof td === "string") try { td = JSON.parse(td); } catch { td = {}; }
    const { itemRate, itemQty } = getItemMetrics(td);
    const displayQty = productQuantities[item.id] !== undefined ? (parseFloat(productQuantities[item.id]) || 0) : itemQty;
    const overrideRate = parseFloat(overrideRates[item.id] || "0") || 0;
    const srcCtx: SrcCtx = {
      totalVal: itemRate * displayQty, rate: itemRate, qty: displayQty,
      overrideRate, overrideTotal: overrideRate * displayQty,
      rowCalc: {}, customVals: customColumnValues[item.id]?.[0] || {},
    };
    const rowBase = baseSource === "manual" ? 0 : resolveSource(baseSource, srcCtx);
    const rowMultiplierVal = multiplierSource === "manual" ? multiplier : resolveSource(multiplierSource, srcCtx);
    const calculated = applyOperator(rowBase, rowMultiplierVal, operator);

    itemCols[colIdx] = {
      ...itemCols[colIdx],
      baseSource,
      percentageValue: multiplier,
      operator,
      multiplierSource
    };
    const updatedCols = itemCols;

    const itemVals = { ...(customColumnValues[item.id] || {}) };
    itemVals[0] = { ...(itemVals[0] || {}), [colName]: calculated.toFixed(2) };

    setCustomColumns(prev => ({ ...prev, [item.id]: updatedCols }));
    setCustomColumnValues(prev => ({ ...prev, [item.id]: itemVals }));

    await saveItemLayout(item.id, updatedCols, itemVals);
  };

  const getEditedValue = (
    itemKey: string,
    field: string,
    originalValue: any,
  ) => {
    return (
      editedFields[itemKey]?.[
      field as keyof (typeof editedFields)[keyof typeof editedFields]
      ] ?? originalValue
    );
  };

  const handleSaveProject = async () => {
    if (!activeVersionId) return;
    try {
      // Permanently save the current edited fields to the database (use ref to avoid race)
      const payload = editedFieldsRef.current || {};
      const response = await apiFetch(
        `/api/boq-versions/${encodeURIComponent(activeVersionId)}/save-edits`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ editedFields: payload }),
        },
      );

      if (response.ok) {
        // Prefer authoritative data from server when available (server will return
        // `updatedItems`). If not present, fall back to optimistic merge + reload.
        let saveResp: any = null;
        try {
          saveResp = await response.json();
        } catch (e) {
          // ignore non-JSON
        }

        if (saveResp?.updatedItems && saveResp.updatedItems.length > 0) {
          setBoqItems((prev) => {
            const byId = new Map(prev.map((i) => [i.id, i]));
            for (const up of saveResp.updatedItems) {
              const td = typeof up.table_data === "string" ? JSON.parse(up.table_data) : up.table_data;
              const existing = byId.get(up.id) || {};
              byId.set(up.id, { ...existing, ...up, table_data: td });
            }
            return prev.map((p) => {
              const updated = byId.get(p.id);
              return updated ? updated : p;
            });
          });
          setEditedFields({});
          editedFieldsRef.current = {};
        } else {
          setBoqItems((prev) =>
            prev.map((item) => {
              const keys = Object.keys(editedFields).filter((k) => k.startsWith(`${item.id}-`));
              if (keys.length === 0) return item;

              const tableData =
                typeof item.table_data === "string"
                  ? JSON.parse(item.table_data)
                  : { ...(item.table_data || {}) };
              const step11_items = Array.isArray(tableData.step11_items)
                ? [...tableData.step11_items]
                : [];

              for (const key of keys) {
                const idxStr = key.substring(key.lastIndexOf("-") + 1);
                const idx = parseInt(idxStr, 10);
                const fields = editedFields[key] || {};
                if (step11_items[idx]) {
                  step11_items[idx] = { ...step11_items[idx], ...fields };
                }
              }

              return { ...item, table_data: { ...tableData, step11_items } };
            }),
          );

          try {
            const loadResponse = await apiFetch(
              `/api/boq-items/version/${encodeURIComponent(activeVersionId)}`,
              { headers: {} },
            );

            if (loadResponse.ok) {
              const data = await loadResponse.json();
              setBoqItems(data.items || []);
              setEditedFields({});
              editedFieldsRef.current = {};
            } else {
              console.warn("[FinalizeBoq] Failed to reload items after save; keeping optimistic local state");
            }
          } catch (loadErr) {
            console.error("[FinalizeBoq] Failed to reload items after save:", loadErr);
          }
        }

        toast({
          title: "Success",
          description: "Draft saved",
        });
      } else {
        const errText = await response.text().catch(() => null);
        throw new Error("Failed to save edits" + (errText ? `: ${errText}` : ""));
      }
    } catch (err) {
      console.error("Failed to save project:", err);
      toast({
        title: "Error",
        description: `Failed to save ${activeVersion?.type === 'boq' ? 'BOQ' : 'BOM'} version`,
        variant: "destructive",
      });
    }
  };

  const handleSubmitVersion = async () => {
    if (!activeVersionId) return;
    try {
      await apiFetch(`/api/boq-versions/${activeVersionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved", is_locked: true }),
      });

      const [bomResp, boqResp] = await Promise.all([
        apiFetch(`/api/boq-versions/${encodeURIComponent(selectedProjectId!)}?type=bom`),
        apiFetch(`/api/boq-versions/${encodeURIComponent(selectedProjectId!)}?type=boq`)
      ]);
      if (bomResp.ok) setBomVersions((await bomResp.json()).versions || []);
      if (boqResp.ok) setBoqVersions((await boqResp.json()).versions || []);

      toast({
        title: "Success",
        description: `${activeVersion?.type === 'boq' ? 'BOQ' : 'BOM'} version submitted and locked`,
      });
    } catch (err) {
      console.error("Failed to submit version:", err);
      toast({
        title: "Error",
        description: "Failed to submit version",
        variant: "destructive",
      });
    }
  };


  const handleSaveAsTemplate = async () => {
    if (!newTemplateName.trim()) {
      toast({ title: "Error", description: "Template name is required", variant: "destructive" });
      return;
    }

    const firstItemId = boqItems[0]?.id;
    if (!firstItemId) {
      toast({ title: "Error", description: "No items to capture configuration from", variant: "destructive" });
      return;
    }

    const config = {
      columns: customColumns[firstItemId] || [],
      globalColSettings: globalColSettings,
    };

    try {
      const resp = await apiFetch("/api/boq-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTemplateName, config }),
      });

      if (resp.ok) {
        toast({ title: "Success", description: "Template saved successfully" });
        setIsSaveTemplateDialogOpen(false);
        setNewTemplateName("");
        loadTemplates();
      } else {
        throw new Error("Save failed");
      }
    } catch (e) {
      console.error("Save template error:", e);
      toast({ title: "Error", description: "Failed to save template", variant: "destructive" });
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!templateId) return;
    const templateToDelete = templates.find((t) => t.id === templateId);
    if (!templateToDelete) return;

    openDeleteConfirm(`Delete Template "${templateToDelete.name}"?`, templateToDelete.name, async (action) => {
      try {
        const resp = await apiFetch(`/api/boq-templates/${templateId}?action=${action}`, {
          method: "DELETE",
        });

        if (resp.ok) {
          setTemplates((prev) => prev.filter((t) => t.id !== templateId));
          if (selectedTemplateId === templateId) {
            setSelectedTemplateId("");
          }
          toast({
            title: action === 'trash' ? "Moved to Trash" : "Archived",
            description: `Template "${templateToDelete.name}" removed.`,
          });
        } else {
          const errorData = await resp.json().catch(() => ({}));
          throw new Error(errorData.message || "Failed to delete template");
        }
      } catch (error: any) {
        console.error("Failed to delete template:", error);
        toast({
          title: "Error",
          description: error.message || "Failed to delete template",
          variant: "destructive",
        });
      }
    });
  };

  const handleApplyTemplate = async (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (!template) return;

    if (!confirm(`Apply template "${template.name}"? This will overwrite existing column configurations and formulas for ALL products.`)) {
      return;
    }

    try {
      const config = typeof template.config === 'string' ? JSON.parse(template.config) : template.config;
      const { columns, globalColSettings: newGlobalSettings } = config;

      if (newGlobalSettings) setGlobalColSettings(newGlobalSettings);

      // We snapshoet what we consider "original" from the template's perspective.
      // Since templates don't store row-level data (Qty/Unit/Rate), the snapshot will reflect
      // what the items looked like *immediately* after applying the template's structure.
      const snapshot: any = {
        columns: columns,
        globalSettings: newGlobalSettings || {},
        itemData: boqItems.reduce((acc, it) => {
          let td = it.table_data || {};
          if (typeof td === 'string') try { td = JSON.parse(td); } catch { td = {}; }
          acc[it.id] = {
            qty: String(productQuantities[it.id] ?? td.finalize_qty ?? ""),
            rate: String(overrideRates[it.id] ?? td.finalize_override_rate ?? ""),
            unit: String(productUnits[it.id] ?? td.finalize_unit ?? ""),
            description: String(productDescriptions[it.id] ?? td.finalize_description ?? ""),
            columns: columns, // The cols from the template
          };
          return acc;
        }, {} as Record<string, any>),
        templateId: templateId,
        templateName: template.name
      };

      const updates = boqItems.map(item => {
        setCustomColumns(prev => ({ ...prev, [item.id]: columns }));
        return saveItemLayout(item.id, columns);
      });

      await Promise.all(updates);

      // Persist snapshot to the version itself
      await apiFetch(`/api/boq-versions/${activeVersionId}/template-snapshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot }),
      });
      // Update local state to show highlights immediately
      if (activeVersion) {
        setBoqVersions(prev => prev.map(v => v.id === activeVersion.id ? { ...v, last_template_snapshot: snapshot } : v));
        setBomVersions(prev => prev.map(v => v.id === activeVersion.id ? { ...v, last_template_snapshot: snapshot } : v));
      }

      toast({ title: "Template Applied", description: `Applied "${template.name}" configuration to all products. Changes since this snapshot will be blue.` });
      setSelectedTemplateId("");
    } catch (e) {
      console.error("Apply template error:", e);
      toast({ title: "Error", description: "Failed to apply template", variant: "destructive" });
    }
  };

  const handleDownloadExcel = () => {
    if (!selectedProjectId || boqItems.length === 0) {
      toast({ title: "Info", description: `No ${activeVersion?.type === 'boq' ? 'BOQ' : 'BOM'} items to download`, variant: "default" });
      return;
    }

    // Identify ALL potential columns first to populate selection list in correct visual order
    const potentialCols = [
      "S.No",
      "Product / Material",
      "Description / Location",
      "HSN",
      "SAC",
      "Unit",
      "Qty",
      "Rate / Unit",
      "Total Value (₹)",
      "Override Rate",
      "Override Total",
      ...allCols.map(c => c.name)
    ];

    const defaultSelection = potentialCols.filter(c => {
      const standardColsUntilQty = ["S.No", "Product / Material", "Description / Location", "HSN", "SAC", "Unit", "Qty"];
      if (standardColsUntilQty.includes(c)) return true;
      if (c === "Supply Rate" || c === "Supply Amount") return true;
      return false;
    });

    // Load persisted selection from localStorage; fall back to defaults
    try {
      const saved = localStorage.getItem('finalize_excel_export_cols');
      if (saved) {
        const parsed: string[] = JSON.parse(saved);
        // Filter to only cols that are currently valid
        const valid = parsed.filter(c => potentialCols.includes(c));
        setSelectedExportCols(valid.length > 0 ? valid : defaultSelection);
      } else {
        setSelectedExportCols(defaultSelection);
      }
    } catch {
      setSelectedExportCols(defaultSelection);
    }
    setIsExportDialogOpen(true);
  };

  const performExcelExport = () => {
    try {
      if (selectedExportCols.length === 0) {
        toast({ title: "Warning", description: "Please select at least one column" });
        return;
      }

      const sheetData: any[] = [];

      // Add Project Information Headers
      sheetData.push(["PROJECT:", selectedProject?.name || "-"]);
      sheetData.push(["CLIENT:", selectedProject?.client || "-"]);
      if (activeVersion) {
        sheetData.push(["VERSION:", `V${activeVersion.version_number} (${activeVersion.type === 'bom' ? 'BOQ' : 'BOM'})`]);
      }
      sheetData.push(["DATE:", new Date().toLocaleDateString()]);
      sheetData.push([]); // Spacer row

      const headers = selectedExportCols.map(colName => colName);
      sheetData.push(headers);

      boqItems.forEach((boqItem, boqIdx) => {
        let tableData = boqItem.table_data || {};
        if (typeof tableData === "string") try { tableData = JSON.parse(tableData); } catch { tableData = {}; }

        const currentStep11Items: Step11Item[] = Array.isArray(tableData.step11_items) ? tableData.step11_items : [];
        const derivedProductName = tableData.product_name || boqItem.estimator || "—";
        const productName = (derivedProductName === "Manual Product" || derivedProductName === "Manual" || boqItem.estimator === "manual_product" || boqItem.estimator === "Manual")
          ? (currentStep11Items[0]?.title || currentStep11Items[0]?.description || derivedProductName)
          : derivedProductName;
        const category = tableData.category || "";

        const manualQtyStr = productQuantities[boqItem.id];
        const displayQty = manualQtyStr !== undefined
          ? (parseFloat(manualQtyStr) || 0)
          : (tableData.materialLines && tableData.targetRequiredQty !== undefined
            ? tableData.targetRequiredQty
            : (currentStep11Items[0]?.qty || 0));

        const { itemRate: rateSqft } = getItemMetrics(tableData);
        const totalVal = rateSqft * displayQty;

        const manualDesc = productDescriptions[boqItem.id] ?? (
          tableData.subcategory || currentStep11Items[0]?.description || category || ""
        );

        const rowValues: { [colName: string]: any } = {};
        const rowCalculatedValues: { [colName: string]: number } = {};
        const overrideRateVal = parseFloat(overrideRates[boqItem.id] || "0") || 0;
        const overrideTotalVal = overrideRateVal * displayQty;
        let currentRunningTotal = overrideRateVal > 0 ? overrideTotalVal : totalVal;
        let accumulator = 0;

        const allPotentialColsInOrder = [
          "S.No",
          "Product / Material",
          "Description / Location",
          "HSN",
          "SAC",
          "Unit",
          "Qty",
          "Rate / Unit",
          "Total Value (₹)",
          "Override Rate",
          "Override Total",
          ...allCols.map(c => c.name)
        ];

        allPotentialColsInOrder.forEach(colName => {
          if (colName === "S.No") rowValues[colName] = boqIdx + 1;
          else if (colName === "Product / Material") rowValues[colName] = productName;
          else if (colName === "Description / Location") rowValues[colName] = manualDesc;
          else if (colName === "HSN") rowValues[colName] = tableData.hsn_code || (tableData.hsn_sac_type === 'hsn' ? tableData.hsn_sac_code : "") || "—";
          else if (colName === "SAC") rowValues[colName] = tableData.sac_code || (tableData.hsn_sac_type === 'sac' ? tableData.hsn_sac_code : "") || "—";
          else if (colName === "Rate / Unit") rowValues[colName] = Number(rateSqft.toFixed(2));
          else if (colName === "Unit") rowValues[colName] = productUnits[boqItem.id] ?? (currentStep11Items[0]?.unit || tableData.unit || "");
          else if (colName === "Qty") rowValues[colName] = Number(displayQty.toFixed(2));
          else if (colName === "Total Value (₹)") rowValues[colName] = Number(totalVal.toFixed(2));
          else if (colName === "Override Rate") rowValues[colName] = Number((parseFloat(overrideRates[boqItem.id] || "0") || 0).toFixed(2));
          else if (colName === "Override Total") rowValues[colName] = Number(((parseFloat(overrideRates[boqItem.id] || "0") || 0) * displayQty).toFixed(2));
          else {
            const currentCol = allCols.find(c => c.name === colName);
            if (!currentCol) {
              rowValues[colName] = 0;
              return;
            }

            if (currentCol.isTotal) {
              currentRunningTotal += accumulator;
              accumulator = 0;
              rowCalculatedValues[colName] = currentRunningTotal;
              rowValues[colName] = Number(currentRunningTotal.toFixed(2));
            } else {
              const itemColList = customColumns[boqItem.id] || [];
              const itemCol = itemColList.find((c: any) => c.name === colName) || currentCol;
              const baseSource = (itemCol as any).baseSource;
              const isCalculated = baseSource && baseSource !== "manual";
              let valNum = 0;

              if (isCalculated) {
                const multiplierSource = (itemCol as any).multiplierSource || "manual";
                const manualMultiplier = (itemCol as any).percentageValue || 0;
                const operator = (itemCol as any).operator || "%";
                const _oRate = parseFloat(overrideRates[boqItem.id] || "0") || 0;
                const _ctx: SrcCtx = {
                  totalVal, rate: rateSqft, qty: displayQty,
                  overrideRate: _oRate, overrideTotal: _oRate * displayQty,
                  rowCalc: rowCalculatedValues, customVals: customColumnValues[boqItem.id]?.[0] || {},
                };
                const baseVal = resolveSource(baseSource, _ctx);
                const multiplierVal = multiplierSource === "manual" ? manualMultiplier : resolveSource(multiplierSource, _ctx);
                valNum = applyOperator(baseVal, multiplierVal, operator);
              } else {
                valNum = parseFloat(customColumnValues[boqItem.id]?.[0]?.[colName] || "0") || 0;
              }

              rowCalculatedValues[colName] = valNum;
              accumulator += valNum;
              rowValues[colName] = Number(valNum.toFixed(2));
            }
          }
        });

        const row: any[] = [];
        selectedExportCols.forEach(colName => {
          row.push(rowValues[colName] ?? "");
        });
        sheetData.push(row);
      });

      const footerRow: any[] = Array(selectedExportCols.length).fill("");
      selectedExportCols.forEach((colName, idx) => {
        if (colName === "Product / Material") footerRow[idx] = "GRAND TOTAL";
        else if (colName === "Total Value (₹)") {
          footerRow[idx] = hideSystemTotalFooter ? "" : Number(calculatedColumnTotals.totalValueSum.toFixed(2));
        } else if (colName === "Rate / Unit") {
          footerRow[idx] = Number(calculatedColumnTotals.totalRateSum.toFixed(2));
        } else if (colName === "Override Total") {
          footerRow[idx] = Number(calculatedColumnTotals.overrideTotalSum.toFixed(2));
        } else if (colName === "Qty" || colName === "Description / Location" || colName === "HSN" || colName === "SAC" || colName === "Unit" || colName === "Override Rate") {
          footerRow[idx] = "";
        } else if (allCols.some(c => c.name === colName)) {
          const colIdx = allCols.findIndex(c => c.name === colName);
          const col = allCols[colIdx];
          footerRow[idx] = col.hideTotal ? "" : Number(calculatedColumnTotals.totals[colIdx].toFixed(2));
        }
      });
      sheetData.push(footerRow);

      if (termsAndConditions && termsAndConditions.trim()) {
        sheetData.push([]); // Spacer
        sheetData.push([]); // Spacer

        const termsHeaderRow = Array(selectedExportCols.length).fill("");
        termsHeaderRow[0] = "Terms & Conditions:";
        sheetData.push(termsHeaderRow);

        const lines = termsAndConditions.split("\n");
        lines.forEach(line => {
          const lineRow = Array(selectedExportCols.length).fill("");
          lineRow[0] = line.trim();
          sheetData.push(lineRow);
        });
      }

      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "BOQ");

      // ── Apply per-column cell fill colours ──────────────────────────────────
      // Rules (by column name in selectedExportCols):
      //   • "Rate / Unit", "Total Value (₹)"  → light blue  (#D6EAF8)
      //   • "Override Rate" / "Override Total"         → light blue  (#D6EAF8)
      //   • Custom cols (GST, Finance, etc.) BEFORE any "Supply Rate" col → light orange (#FFF3E0)
      //   • Custom cols AT or AFTER a "Supply Rate" col → no fill (white)
      //   • All other predefined cols (S.No, Product, etc.) → no fill
      const LIGHT_BLUE_COLS_SET = new Set(["Rate / Unit", "Total Value (₹)", "Override Rate", "Override Total"]);

      // Index of the first column whose name (case-insensitive) is/contains "Supply Rate"
      const supplyRateColIdx = selectedExportCols.findIndex(
        c => c.toLowerCase().includes("supply rate")
      );

      const getColFillRgb = (colName: string, colPos: number): string | null => {
        if (LIGHT_BLUE_COLS_SET.has(colName)) return "D6EAF8"; // light blue
        const isCustomCol = allCols.some(c => c.name === colName);
        if (!isCustomCol) return null; // predefined col — no colour
        // Custom col: only colour if it comes BEFORE the Supply Rate col (or if no Supply Rate exists)
        if (supplyRateColIdx !== -1 && colPos >= supplyRateColIdx) return null;
        return "FFF3E0"; // light orange — custom calculated cols (GST, Finance, etc.)
      };

      const totalSheetRows = sheetData.length;
      for (let r = 0; r < totalSheetRows; r++) {
        selectedExportCols.forEach((colName, c) => {
          const rgb = getColFillRgb(colName, c);
          if (!rgb) return;
          const addr = XLSX.utils.encode_cell({ r, c });
          // Ensure the cell exists — use type "s" (string) so xlsx-js-style writes it
          if (!ws[addr]) ws[addr] = { t: "s", v: "" };
          // Apply fill style (xlsx-js-style format)
          ws[addr].s = {
            ...(ws[addr].s || {}),
            fill: {
              patternType: "solid",
              fgColor: { rgb },
            },
          };
        });
      }
      // ─────────────────────────────────────────────────────────────────────────

      const typeStr = activeVersion ? activeVersion.type.toUpperCase() : "BOM";
      const filename = `${selectedProject?.name || "BOQ"}_${activeVersion ? `V${activeVersion.version_number}` : "draft"}_${typeStr}.xlsx`;
      XLSX.writeFile(wb, filename, { cellStyles: true });

      setIsExportDialogOpen(false);
      toast({ title: "Success", description: `Downloaded ${filename}` });
    } catch (error) {
      console.error("Excel download failed:", error);
      toast({ title: "Error", description: "Failed to download Excel", variant: "destructive" });
    }
  };

  const handleDownloadPdfOpenDialog = () => {
    if (!selectedProjectId || boqItems.length === 0) {
      toast({ title: "Info", description: `No ${activeVersion?.type === 'boq' ? 'BOQ' : 'BOM'} items to download`, variant: "default" });
      return;
    }

    const potentialPdfCols = [
      "S.No", "Product / Material", "Description", "HSN", "SAC",
      "Unit", "Qty", "Rate", "Total",
      "Override Rate", "Override Total",
      ...allCols.map(c => c.name)
    ];

    const defaultPdfSelection = potentialPdfCols.filter(c => {
      const standardPdfColsUntilQty = ["S.No", "Product / Material", "Description", "HSN", "SAC", "Unit", "Qty"];
      if (standardPdfColsUntilQty.includes(c)) return true;
      if (c === "Supply Rate" || c === "Supply Amount") return true;
      return false;
    });

    // Load persisted selection from localStorage; fall back to defaults
    try {
      const saved = localStorage.getItem('finalize_pdf_export_cols');
      if (saved) {
        const parsed: string[] = JSON.parse(saved);
        const valid = parsed.filter(c => potentialPdfCols.includes(c));
        setSelectedPdfExportCols(valid.length > 0 ? valid : defaultPdfSelection);
      } else {
        setSelectedPdfExportCols(defaultPdfSelection);
      }
    } catch {
      setSelectedPdfExportCols(defaultPdfSelection);
    }
    setIsPdfExportDialogOpen(true);
  };

  const handleDownloadPdf = async () => {
    if (!selectedProjectId || boqItems.length === 0) {
      toast({ title: "Info", description: `No ${activeVersion?.type === 'boq' ? 'BOQ' : 'BOM'} items to download`, variant: "default" });
      return;
    }

    try {
      // 2. Prepare Headers for PDF based on selection
      const headerMap: { [key: string]: string } = {
        "S.No": "S.No",
        "Product / Material": "Product / Material",
        "Description": "Description",
        "HSN": "HSN",
        "SAC": "SAC",
        "Rate": "Rate",
        "Unit": "Unit",
        "Qty": "Qty",
        "Total": "Total",
        "Override Rate": "O.Rate",
        "Override Total": "O.Total"
      };

      const headers = selectedPdfExportCols.map(colName => headerMap[colName] || colName);

      // 3. Prepare Body Rows
      const body: any[] = [];
      const rowImages: { [rowIndex: number]: string } = {};
      const productColIndex = selectedPdfExportCols.indexOf("Product / Material");

      boqItems.forEach((boqItem, boqIdx) => {
        let tableData = boqItem.table_data || {};
        if (typeof tableData === "string") try { tableData = JSON.parse(tableData); } catch { tableData = {}; }

        const currentStep11Items: Step11Item[] = Array.isArray(tableData.step11_items) ? tableData.step11_items : [];
        const derivedProductName = tableData.product_name || boqItem.estimator || "—";
        const productName = (derivedProductName === "Manual Product" || derivedProductName === "Manual" || boqItem.estimator === "manual_product" || boqItem.estimator === "Manual")
          ? (currentStep11Items[0]?.title || currentStep11Items[0]?.description || derivedProductName)
          : derivedProductName;
        const category = tableData.category || "";

        const parsedImageUrl = parseProductImage(tableData.image);
        if (parsedImageUrl) {
          rowImages[boqIdx] = parsedImageUrl;
        }

        const manualQtyStr = productQuantities[boqItem.id];
        const displayQty = manualQtyStr !== undefined
          ? (parseFloat(manualQtyStr) || 0)
          : (tableData.materialLines && tableData.targetRequiredQty !== undefined
            ? tableData.targetRequiredQty
            : (currentStep11Items[0]?.qty || 0));

        // Totals
        const { itemRate: rateSqft } = getItemMetrics(tableData);
        const totalVal = rateSqft * displayQty;

        const manualDesc = productDescriptions[boqItem.id] ?? (
          tableData.subcategory || currentStep11Items[0]?.description || category || ""
        );

        const customVals: string[] = [];
        const overrideRateVal = parseFloat(overrideRates[boqItem.id] || "0") || 0;
        const overrideTotalVal = overrideRateVal * displayQty;
        let runningTotal = overrideRateVal > 0 ? overrideTotalVal : totalVal;
        let accumulator = 0;
        const rowCalculatedValues: { [colName: string]: number } = {};

        allCols.forEach(col => {
          const itemCol = (customColumns[boqItem.id] || []).find(c => c.name === col.name) || col;
          if (col.isTotal) {
            runningTotal += accumulator;
            accumulator = 0;
            rowCalculatedValues[col.name] = runningTotal;
            customVals.push(runningTotal.toFixed(2));
          } else {
            let val = 0;
            const baseSource = (itemCol as any).baseSource;
            const operator = (itemCol as any).operator || "%";
            const multiplierSource = (itemCol as any).multiplierSource || "manual";
            const manualMultiplier = (itemCol as any).percentageValue || 0;

            if (baseSource && baseSource !== "manual") {
              const _oRate = parseFloat(overrideRates[boqItem.id] || "0") || 0;
              const _ctx: SrcCtx = {
                totalVal, rate: rateSqft, qty: displayQty,
                overrideRate: _oRate, overrideTotal: _oRate * displayQty,
                rowCalc: rowCalculatedValues, customVals: customColumnValues[boqItem.id]?.[0] || {},
              };
              const bVal = resolveSource(baseSource, _ctx);
              const mVal = multiplierSource === "manual" ? manualMultiplier : resolveSource(multiplierSource, _ctx);
              val = applyOperator(bVal, mVal, operator);
            } else {
              val = parseFloat(customColumnValues[boqItem.id]?.[0]?.[col.name] || "0") || 0;
            }
            rowCalculatedValues[col.name] = val;
            accumulator += val;
            customVals.push(val.toFixed(2));
          }
        });

        const row: any[] = [];
        if (selectedPdfExportCols.includes("S.No")) row.push((boqIdx + 1).toString());
        if (selectedPdfExportCols.includes("Product / Material")) row.push(productName);
        if (selectedPdfExportCols.includes("Description")) row.push(manualDesc);
        if (selectedPdfExportCols.includes("HSN")) row.push(tableData.hsn_code || (tableData.hsn_sac_type === 'hsn' ? tableData.hsn_sac_code : "") || "—");
        if (selectedPdfExportCols.includes("SAC")) row.push(tableData.sac_code || (tableData.hsn_sac_type === 'sac' ? tableData.hsn_sac_code : "") || "—");
        if (selectedPdfExportCols.includes("Unit")) row.push(productUnits[boqItem.id] ?? (currentStep11Items[0]?.unit || tableData.unit || ""));
        if (selectedPdfExportCols.includes("Qty")) row.push(displayQty.toFixed(2));
        if (selectedPdfExportCols.includes("Rate")) row.push(rateSqft.toFixed(2));
        if (selectedPdfExportCols.includes("Total")) row.push(totalVal.toFixed(2));
        if (selectedPdfExportCols.includes("Override Rate")) row.push((parseFloat(overrideRates[boqItem.id] || "0") || 0).toFixed(2));
        if (selectedPdfExportCols.includes("Override Total")) row.push(((parseFloat(overrideRates[boqItem.id] || "0") || 0) * displayQty).toFixed(2));

        allCols.forEach((col, idx) => {
          if (selectedPdfExportCols.includes(col.name)) {
            row.push(customVals[idx]);
          }
        });

        body.push(row);
      });

      const fmtNum = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      const footerRow: any[] = [];
      if (selectedPdfExportCols.includes("S.No")) footerRow.push("");
      if (selectedPdfExportCols.includes("Product / Material")) footerRow.push("TOTAL");
      if (selectedPdfExportCols.includes("Description")) footerRow.push("");
      if (selectedPdfExportCols.includes("HSN")) footerRow.push("");
      if (selectedPdfExportCols.includes("SAC")) footerRow.push("");
      if (selectedPdfExportCols.includes("Unit")) footerRow.push("");
      if (selectedPdfExportCols.includes("Qty")) footerRow.push("");
      if (selectedPdfExportCols.includes("Rate")) footerRow.push(fmtNum(calculatedColumnTotals.totalRateSum));
      if (selectedPdfExportCols.includes("Total")) footerRow.push(hideSystemTotalFooter ? "" : fmtNum(calculatedColumnTotals.totalValueSum));
      if (selectedPdfExportCols.includes("Override Rate")) footerRow.push("");
      if (selectedPdfExportCols.includes("Override Total")) footerRow.push(fmtNum(calculatedColumnTotals.overrideTotalSum));

      allCols.forEach((col: any, idx) => {
        if (selectedPdfExportCols.includes(col.name)) {
          // Hide totals only for supply/install/labour RATE columns in PDF footer
          const lower = String(col.name || "").toLowerCase();
          const isRateCol = lower.includes("rate") && (lower.includes("supply") || lower.includes("labour") || lower.includes("install"));
          footerRow.push(col.hideTotal || isRateCol ? "" : fmtNum(calculatedColumnTotals.totals[idx] || 0));
        }
      });

      const grandTotalRow: any[] = Array(selectedPdfExportCols.length).fill("");
      const pIdx = selectedPdfExportCols.indexOf("Product / Material");
      if (pIdx !== -1) grandTotalRow[pIdx] = "GRAND TOTAL";

      let gtValIdx = -1;
      if (grandTotalColumn === "Total Value (₹)") gtValIdx = selectedPdfExportCols.indexOf("Total");
      else if (grandTotalColumn === "Override Total") gtValIdx = selectedPdfExportCols.indexOf("Override Total");
      else gtValIdx = selectedPdfExportCols.indexOf(grandTotalColumn);

      const gtStr = fmtNum(currentProjectValue);
      if (gtValIdx !== -1) {
        grandTotalRow[gtValIdx] = gtStr;
      } else {
        grandTotalRow[selectedPdfExportCols.length - 1] = gtStr;
      }

      // 4. Logo Fetching
      const logoPath = "/image.png";
      let logoDataUrl: string | null = null;
      try {
        const resp = await fetch(logoPath);
        const blob = await resp.blob();
        const reader = new FileReader();
        logoDataUrl = await new Promise<string | null>((resolve) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        console.warn("Could not load logo for PDF header", e);
      }

      // Pre-fetch all product images as base64 data URLs (jsPDF requires data URLs, not raw URLs)
      const fetchedImages: { [rowIndex: number]: string } = {};
      await Promise.all(
        Object.entries(rowImages).map(async ([idxStr, url]) => {
          const idx = parseInt(idxStr);
          try {
            const resp = await fetch(url);
            if (!resp.ok) return;
            const blob = await resp.blob();
            const dataUrl = await new Promise<string | null>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = () => resolve(null);
              reader.readAsDataURL(blob);
            });
            if (dataUrl) fetchedImages[idx] = dataUrl;
          } catch (e) {
            console.warn(`Failed to pre-fetch product image for row ${idx}:`, e);
          }
        })
      );

      // 5. PDF Generation
      const doc = new jsPDF({ orientation: "landscape" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const marginX = 10;
      const headerBoxY = 8;
      const headerBoxH = 28;

      // Draw header box — 3 sides only (no bottom), table top border acts as shared edge
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.5);
      const boxRight = pageWidth - marginX;
      const boxBottom = headerBoxY + headerBoxH;
      // Top line
      doc.line(marginX, headerBoxY, boxRight, headerBoxY);
      // Left line
      doc.line(marginX, headerBoxY, marginX, boxBottom);
      // Right line
      doc.line(boxRight, headerBoxY, boxRight, boxBottom);

      // Logo inside box (left side)
      if (logoDataUrl) {
        const imgProps: any = doc.getImageProperties(logoDataUrl);
        const imgH = 22;
        const imgW = (imgProps.width / imgProps.height) * imgH;
        doc.addImage(logoDataUrl, "PNG", marginX + 2, headerBoxY + 3, imgW, imgH);
      }

      // Centered title inside box
      doc.setFontSize(15);
      doc.setFont("helvetica", "bold");
      doc.text("CONCEPT TRUNK INTERIORS", pageWidth / 2, headerBoxY + 13, { align: "center" });

      // Project info on right inside box
      const metaX = pageWidth - marginX - 2;
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      const projNameStr = selectedProject?.name || "BOM";
      doc.text(`Project: ${projNameStr}`, metaX, headerBoxY + 7, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.text(`Client: ${selectedProject?.client || "-"}`, metaX, headerBoxY + 13, { align: "right" });
      doc.text(`Date: ${new Date().toLocaleDateString()}`, metaX, headerBoxY + 19, { align: "right" });
      if (activeVersion) {
        doc.setFont("helvetica", "bold");
        doc.text(`Version: V${activeVersion.version_number}`, metaX, headerBoxY + 25, { align: "right" });
        doc.setFont("helvetica", "normal");
      }

      const colStyles: any = {};
      selectedPdfExportCols.forEach((col, i) => {
        if (["Rate", "Total", "Override Rate", "Override Total", ...allCols.map(c => c.name)].includes(col)) {
          colStyles[i] = { halign: 'right' };
        } else if (col === "S.No" || col === "Qty" || col === "Unit" || col === "HSN" || col === "SAC") {
          colStyles[i] = { halign: 'center' };
        }
      });
      if (selectedPdfExportCols.includes("S.No")) {
        const snoIdx = selectedPdfExportCols.indexOf("S.No");
        colStyles[snoIdx] = { ...colStyles[snoIdx], cellWidth: 10 };
      }

      const numCols = selectedPdfExportCols.length;
      // Dynamically shrink font as columns grow - much more generous now
      const dynFontSize = numCols <= 6 ? 10 : numCols <= 10 ? 9 : numCols <= 14 ? 8 : numCols <= 20 ? 7 : 6;

      // Available width for the table
      const tableAvailW = pageWidth - 20; // margin 10 each side

      // Per-column suggested widths (mm)
      const colBaseWidths: Record<string, number> = {
        "S.No": 8,
        "Product / Material": 55,
        "Description": 45,
        "HSN": 15,
        "SAC": 15,
        "Unit": 12,
        "Qty": 12,
        "Rate": 20,
        "Total": 22,
        "Override Rate": 20,
        "Override Total": 22,
      };

      const totalBaseW = selectedPdfExportCols.reduce((sum, col) => {
        return sum + (colBaseWidths[col] ?? 20);
      }, 0);

      // If we have room, we don't need to scale down. If we are over, scale precisely.
      const scale = totalBaseW > tableAvailW ? tableAvailW / totalBaseW : 1;

      const dynColStyles: any = {};
      selectedPdfExportCols.forEach((col, i) => {
        const calculatedW = (colBaseWidths[col] ?? 20) * scale;

        let halign: 'left' | 'center' | 'right' = 'left';
        if (["Rate", "Total", "Override Rate", "Override Total", ...allCols.map(c => c.name)].includes(col)) {
          halign = 'right';
        } else if (["S.No", "Qty", "Unit", "HSN", "SAC"].includes(col)) {
          halign = 'center';
        }

        dynColStyles[i] = {
          cellWidth: totalBaseW > tableAvailW ? calculatedW : 'auto',
          halign
        };

        // Always keep S.No narrow if it exists
        if (col === "S.No") {
          dynColStyles[i].cellWidth = 8;
        }
      });

      // @ts-ignore - autotable types
      autoTable(doc, {
        head: [headers],
        body: body,
        startY: headerBoxY + headerBoxH, // attach directly to header box
        margin: { left: 10, right: 10 },
        tableWidth: tableAvailW,
        styles: {
          fontSize: dynFontSize,
          lineColor: [0, 0, 0],
          lineWidth: 0.3,
          overflow: 'linebreak',
          cellPadding: 1.5,
        },
        headStyles: {
          fillColor: [40, 40, 40],
          textColor: [255, 255, 255],
          fontStyle: "bold",
          lineColor: [0, 0, 0],
          lineWidth: 0.4,
          fontSize: dynFontSize,
        },
        bodyStyles: {
          lineColor: [0, 0, 0],
          lineWidth: 0.3,
          minCellHeight: 6,
        },
        theme: "grid",
        showFoot: 'lastPage',
        foot: [footerRow, grandTotalRow],
        footStyles: {
          fillColor: [220, 220, 220],
          textColor: [0, 0, 0],
          fontStyle: "bold",
          fontSize: dynFontSize,
          lineColor: [0, 0, 0],
          lineWidth: 0.4,
        },
        columnStyles: dynColStyles,
        tableLineColor: [0, 0, 0],
        tableLineWidth: 0.5,
        didParseCell: (data: any) => {
          if (data.section === 'body' && data.column.index === productColIndex && rowImages[data.row.index]) {
            data.cell.styles.minCellHeight = 27; // At least 25mm + 2mm margin
            data.cell.styles.cellPadding = { top: 1.5, right: 1.5, bottom: 1.5, left: 30 }; // 25mm + 5mm gap
          }
        },
        didDrawCell: (data: any) => {
          if (data.section === 'body' && data.column.index === productColIndex && fetchedImages[data.row.index]) {
            try {
              const base64Img = fetchedImages[data.row.index];
              const format = base64Img.startsWith('data:image/png') ? "PNG" : "JPEG";
              doc.addImage(base64Img, format, data.cell.x + 2, data.cell.y + 1, 25, 25);
            } catch (e) {
              console.warn("Failed to add image to PDF cell", e);
            }
          }
        }
      });

      // 6. Terms and Conditions
      if (termsAndConditions && termsAndConditions.trim()) {
        const finalY = (doc as any).lastAutoTable.finalY + 10;
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text("Terms & Conditions:", 10, finalY);
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        const lines = doc.splitTextToSize(termsAndConditions, pageWidth - 20);
        doc.text(lines, 10, finalY + 6);
      }

      const typeStr = activeVersion ? activeVersion.type.toUpperCase() : "BOM";
      const filename = `${projNameStr}_${activeVersion ? `V${activeVersion.version_number}` : "draft"}_${typeStr}.pdf`;
      doc.save(filename);
      toast({ title: "Success", description: `Downloaded ${filename}` });
    } catch (err) {
      console.error("Failed to generate PDF", err);
      toast({ title: "Error", description: "Failed to generate PDF", variant: "destructive" });
    }
  };

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const isVersionSubmitted = !!activeVersion && (activeVersion.is_locked || ["submitted", "pending_approval", "edit_requested"].includes(activeVersion.status));

  // Budget (read-only) should come from the generated BOQ total (sum of displayed item amounts)
  const calculateGeneratedBudget = () => {
    return boqItems.reduce((acc: number, bi: BOMItem) => {
      let total = 0;
      let td = bi.table_data || {};
      if (typeof td === "string") try { td = JSON.parse(td); } catch { td = {}; }
      const step11 = Array.isArray(td.step11_items) ? td.step11_items : [];

      if (td.materialLines && td.targetRequiredQty !== undefined) {
        try {
          const res = computeBoq(td.configBasis, td.materialLines, td.targetRequiredQty);
          if (Array.isArray(res.computed)) {
            res.computed.forEach((l: any) => {
              const lineAmount = Number(l.lineTotal ?? ((Number(l.scaledQty) || 0) * (Number(l.supplyRate) + Number(l.installRate)))) || 0;
              total += lineAmount;
            });
          }
        } catch { }
        // include manual step11 items (user-added)
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

  const generatedBudget = calculateGeneratedBudget();
  // Project Value is the total shown on this Finalize BOQ page
  const currentProjectValue = (() => {
    if (grandTotalColumn === "Total Value (₹)") return calculatedColumnTotals.totalValueSum;
    if (grandTotalColumn === "Override Total") return calculatedColumnTotals.overrideTotalSum;
    const idx = allCols.findIndex(c => c.name === grandTotalColumn);
    return idx >= 0 ? calculatedColumnTotals.totals[idx] : 0;
  })();
  const revenue = currentProjectValue - generatedBudget;


  if (loading) {
    return (
      <Layout>
        <div className="text-center py-8">Loading projects...</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Finalize {activeVersion?.type === 'boq' ? 'BOQ' : 'BOM'}</h1>

        {/* Project creation moved to dedicated Create Project page */}

        {/* Header Controls Section */}
        <Card className="border-none shadow-sm bg-slate-50/50">
          <CardContent className="p-2 space-y-2">
            {/* Filter by Status Row */}
            <div className="flex items-center gap-3 px-3 py-1.5 bg-slate-50/80 rounded-lg border border-slate-100/50 shadow-sm">
              <Label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold whitespace-nowrap">Filter Status:</Label>
              <div className="flex flex-wrap md:flex-nowrap gap-1.5">
                {PROJECT_STATUSES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setProjectStatusFilter(s.value)}
                    className={cn(
                      "px-2.5 py-1 text-[9px] font-bold uppercase rounded-md transition-all border border-transparent hover:bg-slate-100",
                      projectStatusFilter === s.value ? "bg-white text-blue-600 shadow-sm border-blue-100 ring-1 ring-blue-100" : "text-slate-500"
                    )}
                  >
                    {s.label}
                  </button>
                ))}
                <button
                  onClick={() => setProjectStatusFilter("all")}
                  className={cn(
                    "px-2.5 py-1 text-[9px] font-bold uppercase rounded-md transition-all border border-transparent hover:bg-slate-100",
                    projectStatusFilter === "all" ? "bg-white text-blue-600 shadow-sm border-blue-100 ring-1 ring-blue-100" : "text-slate-500"
                  )}
                >
                  All
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end pt-1">
              {/* Project Select */}
              <div className="md:col-span-4 space-y-1">
                <Label className="text-[11px] uppercase tracking-wider text-slate-500 font-bold ml-1">Project</Label>
                <Select onValueChange={(v) => setSelectedProjectId(v || null)} value={selectedProjectId || ""}>
                  <SelectTrigger className="bg-white border-slate-200">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[350px] overflow-hidden flex flex-col">
                    <div className="sticky top-0 z-10 bg-white p-2 border-b border-slate-100">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                          placeholder="Search projects..."
                          value={projectSearchTerm}
                          onChange={(e) => setProjectSearchTerm(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                          className="pl-8 h-9 text-xs border-slate-200 bg-slate-50 focus:bg-white transition-colors w-full"
                        />
                      </div>
                    </div>
                    <div className="overflow-y-auto max-h-[250px]">
                      {filteredProjects.map((p) => {
                        const sm = getProjectStatusMeta(p.project_status);
                        return (
                          <SelectItem value={p.id} key={p.id}>
                            <span className="flex items-center gap-2">
                              {p.name}
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${sm.color}`}>{sm.label}</span>
                            </span>
                          </SelectItem>
                        );
                      })}
                      {filteredProjects.length === 0 && (
                        <div className="py-6 text-center text-slate-400 text-xs italic">
                          No projects found
                        </div>
                      )}
                    </div>
                  </SelectContent>
                </Select>
                {selectedProjectId && (() => {
                  const selProj = projects.find(p => p.id === selectedProjectId);
                  return (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-slate-500 font-bold uppercase">Project Status:</span>
                      <select
                        className="text-xs border border-slate-200 rounded px-2 py-1 bg-white font-semibold focus:ring-1 ring-blue-400 outline-none"
                        value={selProj?.project_status || 'started'}
                        onChange={async (e) => {
                          const newStatus = e.target.value;
                          try {
                            await apiFetch(`/api/boq-projects/${selectedProjectId}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ project_status: newStatus }),
                            });
                            setProjects(prev => prev.map(p => p.id === selectedProjectId ? { ...p, project_status: newStatus } : p));
                          } catch (err) { console.error('Failed to update project status', err); }
                        }}
                      >
                        {PROJECT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>
                  );
                })()}
              </div>

              {/* BOM Version Select */}
              {selectedProjectId && (
                <div className="md:col-span-2 space-y-1">
                  <Label className="text-[11px] uppercase tracking-wider text-slate-500 font-bold ml-1">BOM Version</Label>
                  <div className="flex gap-2">
                    <Select
                      value={selectedBomVersionId || ""}
                      onValueChange={(v) => {
                        setSelectedBomVersionId(v);
                        setSelectedBoqVersionId(null);
                      }}
                    >
                      <SelectTrigger className="bg-white border-slate-200">
                        <SelectValue placeholder="Select BOM" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px] overflow-y-auto">
                        {filteredBomVersions.map((v) => (
                          <SelectItem value={v.id} key={v.id}>
                            V{v.version_number} ({v.status === "approved" ? "Appr" : v.status === "submitted" ? "Lock" : "Draft"})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-slate-400 hover:text-red-600 hover:bg-red-50"
                      onClick={() => {
                        if (!selectedBomVersionId) return;
                        openDeleteConfirm("Delete this BOM version?", "BOM Version", async (action) => {
                          try {
                            const resp = await apiFetch(`/api/boq-versions/${encodeURIComponent(selectedBomVersionId)}?action=${action}`, { method: "DELETE" });
                            if (resp.ok) {
                              toast({ title: action === 'trash' ? "Moved to Trash" : "Archived", description: "BOM Version removed" });
                              // Re-load versions
                              const bomResp = await apiFetch(`/api/boq-versions/${encodeURIComponent(selectedProjectId)}?type=bom`);
                              if (bomResp.ok) {
                                const bomData = await bomResp.json();
                                const bomList = bomData.versions || [];
                                setBomVersions(bomList);
                                if (bomList.length > 0) setSelectedBomVersionId(bomList[0].id);
                                else setSelectedBomVersionId(null);
                              }
                            }
                          } catch (e) {
                            console.error(e);
                            toast({ title: "Error", description: "Failed to delete", variant: "destructive" });
                          }
                        });
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {/* BOQ Version Select */}
              {selectedProjectId && (
                <div className="md:col-span-3 space-y-1">
                  <div className="flex justify-between items-center ml-1">
                    <Label className="text-[11px] uppercase tracking-wider text-slate-500 font-bold">BOQ Version</Label>
                    <button
                      onClick={async () => {
                        if (!confirm("Create a new BOQ version?")) return;
                        try {
                          const resp = await apiFetch("/api/boq-versions", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              project_id: selectedProjectId,
                              type: "boq",
                              copy_from_version: selectedBoqVersionId || selectedBomVersionId
                            })
                          });
                          if (resp.ok) {
                            const newVer = await resp.json();
                            toast({ title: "Success", description: "BOQ Version created" });

                            // Immediately fetch updated version list
                            const boqResp = await apiFetch(`/api/boq-versions/${encodeURIComponent(selectedProjectId)}?type=boq`);
                            if (boqResp.ok) {
                              const boqData = await boqResp.json();
                              const newVersions = boqData.versions || [];
                              setBoqVersions(newVersions);

                              // Clear BOM selection and select the new BOQ version
                              setSelectedBomVersionId(null);
                              setSelectedBoqVersionId(newVer.id);
                            }
                          }
                        } catch (e) {
                          console.error(e);
                          toast({ title: "Error", description: "Failed to create BOQ version", variant: "destructive" });
                        }
                      }}
                      className="text-[10px] text-emerald-600 font-semibold hover:underline"
                    >
                      + CREATE NEW BOQ
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <Select
                      value={selectedBoqVersionId || ""}
                      onValueChange={(v) => {
                        setSelectedBoqVersionId(v);
                        setSelectedBomVersionId(null);
                      }}
                    >
                      <SelectTrigger className="bg-white border-slate-200">
                        <SelectValue placeholder="Select BOQ" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px] overflow-y-auto">
                        {filteredBoqVersions.length === 0 ? (
                          <div className="p-2 text-xs text-slate-400 text-center">No BOQ versions</div>
                        ) : (
                          filteredBoqVersions.map((v) => (
                            <SelectItem value={v.id} key={v.id}>
                              BOQ V{v.version_number} ({v.status})
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-slate-400 hover:text-red-600 hover:bg-red-50"
                      onClick={() => {
                        if (!selectedBoqVersionId) return;
                        openDeleteConfirm("Delete this BOQ version?", "BOQ Version", async (action) => {
                          try {
                            const resp = await apiFetch(`/api/boq-versions/${encodeURIComponent(selectedBoqVersionId)}?action=${action}`, { method: "DELETE" });
                            if (resp.ok) {
                              toast({ title: action === 'trash' ? "Moved to Trash" : "Archived", description: "BOQ Version removed" });
                              const boqResp = await apiFetch(`/api/boq-versions/${encodeURIComponent(selectedProjectId)}?type=boq`);
                              if (boqResp.ok) {
                                const boqData = await boqResp.json();
                                const boqList = boqData.versions || [];
                                setBoqVersions(boqList);
                                if (boqList.length > 0) setSelectedBoqVersionId(boqList[0].id);
                                else setSelectedBoqVersionId(null);
                              }
                            }
                          } catch (e) {
                            console.error(e);
                            toast({ title: "Error", description: "Failed to delete", variant: "destructive" });
                          }
                        });
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Template Select */}
              {selectedProjectId && (
                <div className="md:col-span-3 space-y-1">
                  <div className="flex justify-between items-center ml-1">
                    <Label className="text-[11px] uppercase tracking-wider text-slate-500 font-bold">Template</Label>
                    <button
                      onClick={() => setIsSaveTemplateDialogOpen(true)}
                      className="text-[10px] text-blue-600 font-semibold hover:underline"
                    >
                      SAVE NEW
                    </button>
                  </div>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-between bg-white border-slate-200 font-normal h-9 px-3"
                      >
                        <span className="truncate text-sm">
                          {selectedTemplateId
                            ? templates.find((t) => t.id === selectedTemplateId)?.name
                            : "Select template..."}
                        </span>
                        <ChevronDown className="h-3 w-3 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[200px] p-0" align="end">
                      <div className="max-h-[250px] overflow-y-auto">
                        {templates.length === 0 ? (
                          <div className="p-3 text-center text-xs text-slate-400">No templates</div>
                        ) : (
                          <div className="p-1">
                            {templates.map((t) => (
                              <div
                                key={t.id}
                                className="flex items-center justify-between p-2 rounded hover:bg-slate-100 cursor-pointer group"
                                onClick={() => handleApplyTemplate(t.id)}
                              >
                                <span className="text-xs truncate">{t.name}</span>
                                <Trash2
                                  className="h-3.3 w-3.5 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                                  onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(t.id); }}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>

            {/* Compact Summary Bar */}
            {activeVersion && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-1.5 px-4 bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden text-[11px]">
                <div className="flex items-center gap-2 min-w-fit">
                  <div className="p-1.5 bg-blue-50 rounded text-blue-600"><Briefcase className="h-3.5 w-3.5" /></div>
                  <div className="flex flex-col">
                    <span className="text-[10px] leading-none text-slate-400 font-bold uppercase tracking-tight">Client</span>
                    <span className="text-xs font-semibold text-slate-700">{activeVersion.project_client || "—"}</span>
                  </div>
                </div>

                <div className="hidden md:block w-px h-6 bg-slate-100" />

                <div className="flex items-center gap-2 min-w-fit">
                  <div className="p-1.5 bg-indigo-50 rounded text-indigo-600"><MapPin className="h-3.5 w-3.5" /></div>
                  <div className="flex flex-col">
                    <span className="text-[10px] leading-none text-slate-400 font-bold uppercase tracking-tight">Location</span>
                    <span className="text-xs font-semibold text-slate-700">{activeVersion.project_location || "—"}</span>
                  </div>
                </div>

                <div className="hidden md:block w-px h-6 bg-slate-100" />

                <div className="flex items-center gap-2 min-w-fit">
                  <div className="p-1.5 bg-emerald-50 rounded text-emerald-600"><IndianRupee className="h-3.5 w-3.5" /></div>
                  <div className="flex flex-col">
                    <span className="text-[10px] leading-none text-slate-400 font-bold uppercase tracking-tight">Budget</span>
                    <span className="text-xs font-semibold text-slate-700">₹{generatedBudget.toLocaleString()}</span>
                  </div>
                </div>

                <div className="hidden md:block w-px h-6 bg-slate-100" />

                <div className="flex items-center gap-2 min-w-fit">
                  <div className="p-1.5 bg-blue-50 rounded text-blue-600"><IndianRupee className="h-3.5 w-3.5" /></div>
                  <div className="flex flex-col">
                    <span className="text-[10px] leading-none text-slate-400 font-bold uppercase tracking-tight">Project Value</span>
                    <span className="text-xs font-semibold text-slate-700">₹{currentProjectValue.toLocaleString()}</span>
                  </div>
                </div>

                <div className="hidden md:block w-px h-6 bg-slate-100" />

                <div className="flex items-center gap-2 min-w-fit">
                  <div className={`p-1.5 rounded ${revenue < 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}><IndianRupee className="h-3.5 w-3.5" /></div>
                  <div className="flex flex-col">
                    <span className="text-[10px] leading-none text-slate-400 font-bold uppercase tracking-tight">Revenue</span>
                    <span className={`text-xs font-semibold ${revenue < 0 ? 'text-red-600' : 'text-green-600'}`}>₹{revenue.toLocaleString()}</span>
                  </div>
                </div>

                <div className="ml-auto flex items-center gap-3">
                  {activeVersion?.status === "approved" ? (
                    <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] font-bold px-2 py-0 h-6">
                      <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> APPROVED
                    </Badge>
                  ) : activeVersion?.status === "edit_requested" ? (
                    <Badge variant="outline" className="bg-indigo-100 text-indigo-700 border-indigo-200 text-[10px] font-bold px-2 py-0 h-6">
                      <Clock className="h-2.5 w-2.5 mr-1" /> EDIT REQUESTED
                    </Badge>
                  ) : isVersionSubmitted ? (
                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-bold px-2 py-0 h-6">
                      <Lock className="h-2.5 w-2.5 mr-1" /> LOCKED
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] font-bold px-2 py-0 h-6">
                      <Edit3 className="h-2.5 w-2.5 mr-1" /> DRAFT
                    </Badge>
                  )}
                  {snapshot && (
                    <Badge variant="outline" className="bg-blue-600 text-white border-blue-700 text-[10px] font-bold px-2 py-0 h-6 animate-pulse hover:animate-none cursor-help" title={`Highlights show changes since template "${snapshot.templateName || 'Modified'}" was applied`}>
                      <LayoutTemplate className="h-2.5 w-2.5 mr-1" /> TEMPLATE MODIFIED (HIGHLIGHTS ON)
                    </Badge>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Excel Export Dialog */}
        <Dialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Select Columns for Excel Export</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-4">
              {[
                { label: "B: #", name: "S.No" },
                { label: "C: Product / Material", name: "Product / Material" },
                { label: "D: Description / Location", name: "Description / Location" },
                { label: "E: HSN", name: "HSN" },
                { label: "F: SAC", name: "SAC" },
                { label: "G: Unit", name: "Unit" },
                { label: "H: Qty", name: "Qty" },
                { label: "I: Rate / Unit", name: "Rate / Unit" },
                { label: "J: Total Value (₹)", name: "Total Value (₹)" },
                { label: "K: Override Rate (₹)", name: "Override Rate" },
                { label: "L: Override Total (₹)", name: "Override Total" },
                ...allCols.map((c, idx) => ({
                  label: `${getExcelColumnName(idx + 12)}: ${c.name}`,
                  name: c.name
                }))
              ].map(col => (
                <div key={col.name} className="flex items-center space-x-2">
                  <Checkbox
                    id={`col-${col.name}`}
                    checked={selectedExportCols.includes(col.name)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedExportCols(prev => {
                          const next = [...prev, col.name];
                          const order = [
                            "S.No", "Product / Material", "Description / Location",
                            "HSN", "SAC", "Unit", "Qty", "Rate / Unit", "Total Value (₹)",
                            "Override Rate", "Override Total",
                            ...allCols.map(c => c.name)
                          ];
                          const result = order.filter(o => next.includes(o));
                          try { localStorage.setItem('finalize_excel_export_cols', JSON.stringify(result)); } catch { }
                          return result;
                        });
                      } else {
                        setSelectedExportCols(prev => {
                          const result = prev.filter(c => c !== col.name);
                          try { localStorage.setItem('finalize_excel_export_cols', JSON.stringify(result)); } catch { }
                          return result;
                        });
                      }
                    }}
                  />
                  <label
                    htmlFor={`col-${col.name}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {col.label}
                  </label>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsExportDialogOpen(false)}>Cancel</Button>
              <Button className="bg-green-600 hover:bg-green-700" onClick={performExcelExport}>Download Excel</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* PDF Export Dialog */}
        <Dialog open={isPdfExportDialogOpen} onOpenChange={setIsPdfExportDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Select Columns for PDF Export</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-4">
              {[
                { label: "#", name: "S.No" },
                { label: "Product / Material", name: "Product / Material" },
                { label: "Description", name: "Description" },
                { label: "HSN", name: "HSN" },
                { label: "SAC", name: "SAC" },
                { label: "Unit", name: "Unit" },
                { label: "Qty", name: "Qty" },
                { label: "Rate (₹)", name: "Rate" },
                { label: "Total (₹)", name: "Total" },
                { label: "Override Rate (₹)", name: "Override Rate" },
                { label: "Override Total (₹)", name: "Override Total" },
                ...allCols.map(c => ({
                  label: c.name,
                  name: c.name
                }))
              ].map(col => (
                <div key={col.name} className="flex items-center space-x-2">
                  <Checkbox
                    id={`pdf-col-${col.name}`}
                    checked={selectedPdfExportCols.includes(col.name)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedPdfExportCols(prev => {
                          const next = [...prev, col.name];
                          const order = [
                            "S.No", "Product / Material", "Description", "HSN", "SAC",
                            "Unit", "Qty", "Rate", "Total",
                            "Override Rate", "Override Total",
                            ...allCols.map(c => c.name)
                          ];
                          const result = order.filter(o => next.includes(o));
                          try { localStorage.setItem('finalize_pdf_export_cols', JSON.stringify(result)); } catch { }
                          return result;
                        });
                      } else {
                        setSelectedPdfExportCols(prev => {
                          const result = prev.filter(c => c !== col.name);
                          try { localStorage.setItem('finalize_pdf_export_cols', JSON.stringify(result)); } catch { }
                          return result;
                        });
                      }
                    }}
                  />
                  <label
                    htmlFor={`pdf-col-${col.name}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {col.label}
                  </label>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsPdfExportDialogOpen(false)}>Cancel</Button>
              <Button className="bg-red-600 hover:bg-red-700" onClick={() => { setIsPdfExportDialogOpen(false); handleDownloadPdf(); }}>Download PDF</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {/* Column Manager Dialog */}
        <Dialog open={isColumnManagerOpen} onOpenChange={setIsColumnManagerOpen}>
          <DialogContent className="max-w-[450px]">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold">Manage Column Visibility</DialogTitle>
              <DialogDescription className="text-xs">Select columns you want to display in the main table.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 py-4 max-h-[400px] overflow-y-auto px-1">
              <div className="space-y-3">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b pb-1">Predefined Columns</h4>
                {[
                  { label: "S.No", id: "sno" },
                  { label: "Product / Material", id: "product" },
                  { label: "Description / Location", id: "description" },
                  { label: "HSN", id: "hsn" },
                  { label: "SAC", id: "sac" },
                  { label: "Unit", id: "unit" },
                  { label: "Qty", id: "qty" },
                  { label: "Rate", id: "rate" },
                  { label: "System Total (J)", id: "system_total" },
                  { label: "Override Rate (K)", id: "override_rate" },
                  { label: "Override Total (L)", id: "override_total" }
                ].map((col) => {
                  const mapping: Record<string, string> = {
                    sno: "S.No", product: "Product / Material", description: "Description / Location",
                    hsn: "HSN", sac: "SAC", rate: "Rate", unit: "Unit", qty: "Qty",
                    system_total: "System Total (J)", override_rate: "Rate (K)", override_total: "Total (L)"
                  };
                  const colName = mapping[col.id];
                  const isVisible = !hiddenCols.includes(colName);
                  return (
                    <div key={col.id} className="flex items-center space-x-2.5">
                      <Checkbox
                        id={`mgr-col-${col.id}`}
                        checked={isVisible}
                        onCheckedChange={(checked) => handleHideColumn(colName, !checked)}
                      />
                      <label htmlFor={`mgr-col-${col.id}`} className="text-[12px] font-semibold text-slate-700 cursor-pointer">
                        {col.label}
                      </label>
                    </div>
                  );
                })}
              </div>

              {allCols.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b pb-1">Custom Columns</h4>
                  {allCols.map((col) => (
                    <div key={col.name} className="flex items-center space-x-2.5">
                      <Checkbox
                        id={`mgr-custom-${col.name}`}
                        checked={!col.hideColumn}
                        onCheckedChange={(checked) => handleHideColumn(col.name, !checked)}
                      />
                      <label htmlFor={`mgr-custom-${col.name}`} className="text-[12px] font-semibold text-slate-700 cursor-pointer truncate max-w-[150px]">
                        {col.name}
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter className="bg-slate-50 border-t p-4 -m-6 mt-4">
              <Button onClick={() => setIsColumnManagerOpen(false)} className="bg-slate-800 text-white font-bold h-9 px-6 uppercase text-[11px]">Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {/* BOM Items Section — one card+table per product */}
        {selectedProjectId && (
          <div className="space-y-4">
            {/* Header + bulk actions */}
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-800">{activeVersion?.type === 'boq' ? 'BOQ' : 'BOM'} Items</h2>
              {selectedProductIds.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isVersionSubmitted}
                  onClick={() => {
                    openDeleteConfirm(`Delete ${selectedProductIds.size} selected product(s)?`, `${selectedProductIds.size} products`, async (action) => {
                      try {
                        await Promise.all(
                          Array.from(selectedProductIds).map(id => apiFetch(`/api/boq-items/${id}?action=${action}`, { method: "DELETE" }))
                        );
                        setBoqItems(prev => prev.filter(i => !selectedProductIds.has(i.id)));
                        setSelectedProductIds(new Set());
                        toast({ title: action === 'trash' ? "Moved to Trash" : "Archived", description: `${selectedProductIds.size} product(s) removed` });
                      } catch {
                        toast({ title: "Error", description: "Failed to delete selected products", variant: "destructive" });
                      }
                    });
                  }}
                >
                  🗑 Delete Selected ({selectedProductIds.size})
                </Button>
              )}
            </div>

            {boqItems.length === 0 ? (
              <Card>
                <CardContent className="text-gray-500 text-center py-10">
                  No products found for this version. Go to Create BOM to add products.
                </CardContent>
              </Card>
            ) : (
              <Card className={`border-2 border-gray-200 overflow-hidden shadow-sm ${isFullscreen ? 'fixed inset-0 z-50 m-0 p-6 bg-white overflow-auto' : ''}`}>
                {isFullscreen && (
                  <div className="absolute top-4 right-6 z-50">
                    <Button variant="ghost" onClick={() => setIsFullscreen(false)} className="bg-white/80">Close</Button>
                  </div>
                )}
                {!isVersionSubmitted && (
                  <div className="flex items-center gap-3 p-4 bg-gray-50/80 border-b overflow-x-auto whitespace-nowrap scrollbar-hide">
                    <span className="text-[12px] font-semibold uppercase tracking-widest text-gray-500 mr-2 flex-shrink-0">Unified BOM Actions:</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 px-4 text-[12px] font-bold uppercase border-purple-300 text-purple-700 hover:bg-purple-100/80 hover:border-purple-400 transition-all shadow-sm"
                      onClick={async () => {
                        const colName = window.prompt("Enter new column name (adds to all products):");
                        if (!colName?.trim()) return;
                        const isPct = window.confirm("Do you want to calculate percentage for this column?");
                        const updates = boqItems.map(item => {
                          const nextCols = [...(customColumns[item.id] || []), {
                            name: colName.trim(),
                            isTotal: false,
                            isPercentage: isPct,
                            percentageValue: 0,
                            baseSource: isPct ? "Total Value (₹)" : "manual",
                            operator: "%",
                            multiplierSource: "manual"
                          }];
                          setCustomColumns(prev => ({ ...prev, [item.id]: nextCols }));
                          return saveItemLayout(item.id, nextCols);
                        });
                        if (isPct) {
                          setGlobalColSettings(prev => ({
                            ...prev,
                            [colName.trim()]: {
                              baseValue: 0,
                              percentageValue: 0,
                              baseSource: "Total Value (₹)",
                              operator: "%",
                              multiplierSource: "manual"
                            }
                          }));
                        }
                        await Promise.all(updates);
                        toast({ title: "Global Column Added", description: `"${colName}" added.` });
                      }}
                    >
                      + Add Global Column
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 px-4 text-[12px] font-bold uppercase border-gray-300 text-gray-700 hover:bg-gray-100 transition-all shadow-sm ml-2"
                      onClick={() => setIsFullscreen(true)}
                    >
                      Full Screen
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 px-4 text-[12px] font-bold uppercase border-blue-300 text-blue-700 hover:bg-blue-100/80 hover:border-blue-400 transition-all shadow-sm"
                      onClick={async () => {
                        const colName = window.prompt("Enter Global Total column name:");
                        if (!colName?.trim()) return;
                        const updates = boqItems.map(item => {
                          const nextCols = [...(customColumns[item.id] || []), { name: colName.trim(), isTotal: true }];
                          setCustomColumns(prev => ({ ...prev, [item.id]: nextCols }));
                          return saveItemLayout(item.id, nextCols);
                        });
                        await Promise.all(updates);
                        toast({ title: "Global Total Added", description: `"${colName}" added.` });
                      }}
                    >
                      + Add Global Total
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`h-9 px-4 text-[12px] font-bold uppercase transition-all shadow-sm ${showColumnTotals ? "border-orange-300 text-orange-700 hover:bg-orange-50" : "border-gray-300 text-gray-500 hover:bg-gray-100"}`}
                      onClick={() => setShowColumnTotals(!showColumnTotals)}
                    >
                      {showColumnTotals ? "Hide Totals Row" : "Show Totals Row"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 px-4 text-[12px] font-bold uppercase border-yellow-300 text-yellow-700 hover:bg-yellow-50 hover:border-yellow-400 transition-all shadow-sm"
                      onClick={async () => {
                        if (!confirm("Restoring all hidden totals, columns, and rows for all lines?")) return;
                        setHideSystemTotalFooter(false);
                        setHiddenPredefinedCols({});
                        const updates = boqItems.map(item => {
                          const nextCols = (customColumns[item.id] || []).map(c => ({ ...c, hideTotal: false, hideColumn: false }));
                          setCustomColumns(prev => ({ ...prev, [item.id]: nextCols }));
                          let td = item.table_data || {};
                          if (typeof td === "string") try { td = JSON.parse(td); } catch { td = {}; }
                          const updatedTd = { ...td, finalize_hide_row: false };
                          return apiFetch(`/api/boq-items/${item.id}`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ table_data: updatedTd }),
                          });
                        });
                        await Promise.all(updates);
                        loadBoqItemsAndEdits(activeVersionId);
                        toast({ title: "Visibility Restored", description: "All hidden rows, columns and totals are now visible." });
                      }}
                    >
                      🔄 Reset All Visibility
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 px-4 text-[12px] font-bold uppercase border-orange-300 text-orange-600 hover:bg-orange-50 hover:border-orange-400 transition-all shadow-sm h-9"
                      disabled={selectedProductIds.size === 0}
                      onClick={() => handleHideSelectedRows(true)}
                    >
                      <EyeOff className="w-3.5 h-3.5 mr-1.5" /> Hide Selected ({selectedProductIds.size})
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 px-4 text-[12px] font-bold uppercase border-slate-300 text-slate-700 hover:bg-slate-50 transition-all shadow-sm h-9"
                      onClick={() => setIsColumnManagerOpen(true)}
                    >
                      <Eye className="w-3.5 h-3.5 mr-1.5" /> Manage Columns
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 px-4 text-[12px] font-bold uppercase border-green-300 text-green-700 hover:bg-green-100/80 hover:border-green-400 transition-all shadow-sm"
                      onClick={async () => {
                        const updates = boqItems.map(item => saveItemLayout(item.id));
                        await Promise.all(updates);
                        toast({ title: "✅ Saved All", description: "Manual descriptions and layouts saved." });
                      }}
                    >
                      💾 Save All Layouts
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 px-4 text-[12px] font-bold uppercase border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400 transition-all shadow-sm"
                      disabled={selectedProductIds.size === 0}
                      onClick={() => {
                        openDeleteConfirm(`Delete ${selectedProductIds.size} selected products from this BOM?`, `${selectedProductIds.size} products`, async (action) => {
                          try {
                            const ids = Array.from(selectedProductIds);
                            await Promise.all(ids.map(id => apiFetch(`/api/boq-items/${id}?action=${action}`, { method: "DELETE" })));
                            setBoqItems(prev => prev.filter(item => !selectedProductIds.has(item.id)));
                            setSelectedProductIds(new Set());
                            toast({ title: action === 'trash' ? "Moved to Trash" : "Archived", description: `${ids.length} products removed successfully.` });
                          } catch {
                            toast({ title: "Error", description: "Failed to delete some products", variant: "destructive" });
                          }
                        });
                      }}
                    >
                      🗑 Delete Selected
                    </Button>
                  </div>
                )}

                {!isVersionSubmitted && (hiddenCols.length > 0 || boqItems.some(i => {
                  let td = i.table_data; if (typeof td === 'string') try { td = JSON.parse(td); } catch { td = {}; }
                  return !!td.finalize_hide_row;
                })) && (
                    <div className="flex flex-col gap-2 p-3 bg-orange-50/50 border-b border-orange-100 overflow-x-auto whitespace-nowrap scrollbar-hide">
                      {hiddenCols.length > 0 && (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-orange-600 mr-2 flex-shrink-0">Hidden Columns:</span>
                          {hiddenCols.map(colName => (
                            <button
                              key={colName}
                              onClick={() => handleHideColumn(colName, false)}
                              className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-orange-200 rounded-full text-[11px] font-bold text-orange-700 hover:bg-orange-100 hover:border-orange-300 transition-all shadow-sm group"
                            >
                              <Eye size={12} className="text-orange-400 group-hover:text-orange-600" />
                              {colName}
                              <span className="text-[9px] opacity-70 ml-1">Restore</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {boqItems.some(i => {
                        let td = i.table_data; if (typeof td === 'string') try { td = JSON.parse(td); } catch { td = {}; }
                        return !!td.finalize_hide_row;
                      }) && (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-semibold uppercase tracking-widest text-orange-600 mr-2 flex-shrink-0">Hidden Rows:</span>
                            {boqItems.filter(i => {
                              let td = i.table_data; if (typeof td === 'string') try { td = JSON.parse(td); } catch { td = {}; }
                              return !!td.finalize_hide_row;
                            }).map(item => {
                              let td = item.table_data; if (typeof td === 'string') try { td = JSON.parse(td); } catch { td = {}; }
                              const productName = td.product_name || td.name || "Unknown Product";
                              return (
                                <button
                                  key={item.id}
                                  onClick={async () => {
                                    let td = item.table_data; if (typeof td === 'string') try { td = JSON.parse(td); } catch { td = {}; }
                                    await apiFetch(`/api/boq-items/${item.id}`, {
                                      method: "PUT",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ table_data: { ...td, finalize_hide_row: false } }),
                                    });
                                    loadBoqItemsAndEdits(activeVersionId);
                                  }}
                                  className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-orange-200 rounded-full text-[11px] font-bold text-orange-700 hover:bg-orange-100 hover:border-orange-300 transition-all shadow-sm group"
                                >
                                  <Eye size={12} className="text-orange-400 group-hover:text-orange-600" />
                                  <span className="max-w-[150px] truncate">{productName}</span>
                                  <span className="text-[9px] opacity-70 ml-1">Restore</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                    </div>
                  )}

                <div className="overflow-x-auto">
                  <table className="border-collapse text-sm min-w-full">
                    <thead>
                      {/* Excel-style Column Labels */}
                      <tr className="bg-gray-100 border-b border-gray-200 text-[11px] font-semibold text-gray-700">
                        {!hiddenPredefinedCols.sno && <th className="border-r border-gray-200 py-1.5 w-10 text-center">A</th>}
                        {!hiddenPredefinedCols.sno && <th className="border-r border-gray-200 py-1.5 w-12 text-center text-gray-700">B</th>}
                        {!hiddenPredefinedCols.product && <th className="border-r border-gray-200 py-1.5 text-center w-64">C</th>}
                        {!hiddenPredefinedCols.description && <th className="border-r border-gray-200 py-1.5 text-center w-72">D</th>}
                        {!hiddenPredefinedCols.hsn && <th className="border-r border-gray-200 py-1.5 text-center w-24">E</th>}
                        {!hiddenPredefinedCols.sac && <th className="border-r border-gray-200 py-1.5 text-center w-24">F</th>}
                        {!hiddenPredefinedCols.unit && <th className="border-r border-gray-200 py-1.5 text-center w-24">G</th>}
                        {!hiddenPredefinedCols.qty && <th className="border-r border-gray-200 py-1.5 text-center w-28">H</th>}
                        {!hiddenPredefinedCols.rate && <th className="border-r border-gray-200 py-1.5 text-center w-32">I</th>}
                        {!hiddenPredefinedCols.system_total && <th className="border-r border-gray-200 py-1.5 text-center text-gray-700 w-32">J</th>}
                        {!hiddenPredefinedCols.override_rate && <th className="border-r border-gray-200 py-1.5 text-center text-gray-700 w-32">K</th>}
                        {!hiddenPredefinedCols.override_total && <th className="border-r border-gray-200 py-1.5 text-center text-gray-700 w-32">L</th>}
                        {allCols.filter(c => !c.hideColumn).map((_, idx) => (
                          <th key={idx} className="border-r border-gray-200 py-1.5 text-center text-slate-900 text-[11px] font-semibold bg-gray-50">
                            {getExcelColumnName(idx + 12)}
                          </th>
                        ))}
                      </tr>
                      {/* Grouping Header Row */}
                      <tr className="bg-gray-100 text-slate-900 text-[13px] font-semibold uppercase tracking-widest border-b border-gray-200">
                        <th colSpan={10 - (hiddenPredefinedCols.sno ? 2 : 0) - (hiddenPredefinedCols.product ? 1 : 0) - (hiddenPredefinedCols.description ? 1 : 0) - (hiddenPredefinedCols.hsn ? 1 : 0) - (hiddenPredefinedCols.sac ? 1 : 0) - (hiddenPredefinedCols.rate ? 1 : 0) - (hiddenPredefinedCols.unit ? 1 : 0) - (hiddenPredefinedCols.qty ? 1 : 0) - (hiddenPredefinedCols.system_total ? 1 : 0)} className="py-2.5 border-r border-gray-200 bg-gray-50/40">Item Details</th>
                        {(!hiddenPredefinedCols.override_rate || !hiddenPredefinedCols.override_total) && (
                          <th colSpan={2 - (hiddenPredefinedCols.override_rate ? 1 : 0) - (hiddenPredefinedCols.override_total ? 1 : 0)} className="py-2.5 border-r border-gray-200 bg-gray-50 text-gray-700">OVERRIDE</th>
                        )}
                        <th colSpan={allCols.filter(c => !c.hideColumn).length} className="py-2.5 bg-gray-50 text-gray-700">Custom Filters & Totals</th>
                      </tr>
                      <Reorder.Group
                        as="tr"
                        axis="x"
                        values={allCols.filter(c => !c.hideColumn)}
                        onReorder={handleColumnReorder}
                        className="bg-gray-200 text-slate-900 border-b border-gray-300 text-[12px] font-semibold uppercase tracking-wider shadow-sm"
                      >
                        <th className="border-r border-gray-300 px-2 py-2.5 text-center w-10">
                          <GripVertical size={18} className="mx-auto text-gray-500" />
                        </th>
                        {!hiddenPredefinedCols.sno && (
                          <th className="border-r border-gray-300 px-1 py-2.5 text-left min-w-[30px] w-12 text-[11px] group relative">
                            <div className="flex items-center justify-between gap-1">
                              <span>S.No</span>
                              {!isVersionSubmitted && (
                                <button onClick={() => handleHideColumn("S.No", true)} className="text-gray-400 hover:text-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Hide Column"><EyeOff size={10} /></button>
                              )}
                            </div>
                          </th>
                        )}
                        {!hiddenPredefinedCols.product && (
                          <th className="border-r border-gray-300 px-3 py-2.5 text-left min-w-[250px] text-[11px] group relative">
                            <div className="flex items-center justify-between gap-1">
                              <span>Product / Material</span>
                              {!isVersionSubmitted && (
                                <button onClick={() => handleHideColumn("Product / Material", true)} className="text-gray-400 hover:text-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Hide Column"><EyeOff size={10} /></button>
                              )}
                            </div>
                          </th>
                        )}
                        {!hiddenPredefinedCols.description && (
                          <th className="border-r border-gray-300 px-3 py-2.5 text-left min-w-[250px] text-[11px] group relative">
                            <div className="flex items-center justify-between gap-1">
                              <span>Description / Location</span>
                              {!isVersionSubmitted && (
                                <button onClick={() => handleHideColumn("Description / Location", true)} className="text-gray-400 hover:text-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Hide Column"><EyeOff size={10} /></button>
                              )}
                            </div>
                          </th>
                        )}
                        {!hiddenPredefinedCols.hsn && (
                          <th className="border-r border-gray-300 px-1 py-2.5 text-center w-24 text-[11px] group relative">
                            <div className="flex items-center justify-between gap-1 px-1">
                              <span className="w-full text-center">HSN</span>
                              {!isVersionSubmitted && (
                                <button onClick={() => handleHideColumn("HSN", true)} className="text-gray-400 hover:text-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Hide Column"><EyeOff size={10} /></button>
                              )}
                            </div>
                          </th>
                        )}
                        {!hiddenPredefinedCols.sac && (
                          <th className="border-r border-gray-300 px-1 py-2.5 text-center w-24 text-[11px] group relative">
                            <div className="flex items-center justify-between gap-1 px-1">
                              <span className="w-full text-center">SAC</span>
                              {!isVersionSubmitted && (
                                <button onClick={() => handleHideColumn("SAC", true)} className="text-gray-400 hover:text-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Hide Column"><EyeOff size={10} /></button>
                              )}
                            </div>
                          </th>
                        )}
                        {!hiddenPredefinedCols.unit && (
                          <th className="border-r border-gray-300 px-1 py-2.5 text-center w-24 text-[11px] group relative">
                            <div className="flex items-center justify-between gap-1 px-1">
                              <span className="w-full text-center">Unit</span>
                              {!isVersionSubmitted && (
                                <button onClick={() => handleHideColumn("Unit", true)} className="text-gray-400 hover:text-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Hide Column"><EyeOff size={10} /></button>
                              )}
                            </div>
                          </th>
                        )}
                        {!hiddenPredefinedCols.qty && (
                          <th className="border-r border-gray-300 px-1 py-2.5 text-center w-28 text-[11px] group relative">
                            <div className="flex items-center justify-between gap-1 px-1">
                              <span className="w-full text-center">Qty</span>
                              {!isVersionSubmitted && (
                                <button onClick={() => handleHideColumn("Qty", true)} className="text-gray-400 hover:text-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Hide Column"><EyeOff size={10} /></button>
                              )}
                            </div>
                          </th>
                        )}
                        {!hiddenPredefinedCols.rate && (
                          <th className="border-r border-gray-300 px-1 py-2.5 text-right w-32 text-[11px] group relative">
                            <div className="flex items-center justify-between gap-1">
                              <span className="w-full text-right">Rate</span>
                              {!isVersionSubmitted && (
                                <button onClick={() => handleHideColumn("Rate", true)} className="text-gray-400 hover:text-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Hide Column"><EyeOff size={10} /></button>
                              )}
                            </div>
                          </th>
                        )}
                        {!hiddenPredefinedCols.system_total && (
                          <th className="border-r border-gray-300 px-1 py-1.5 text-right w-32 text-gray-800 bg-gray-50/20 text-[11px] group relative">
                            <div className="flex items-center justify-between gap-1">
                              <span className="w-full text-right">System Total (J)</span>
                              {!isVersionSubmitted && (
                                <button onClick={() => handleHideColumn("System Total (J)", true)} className="text-gray-400 hover:text-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Hide Column"><EyeOff size={10} /></button>
                              )}
                            </div>
                          </th>
                        )}
                        {!hiddenPredefinedCols.override_rate && (
                          <th className="border-r border-gray-300 px-1 py-1.5 text-right w-32 text-gray-800 bg-gray-50/20 text-[11px] group relative">
                            <div className="flex items-center justify-between gap-1">
                              <span className="w-full text-right">Rate (K)</span>
                              {!isVersionSubmitted && (
                                <button onClick={() => handleHideColumn("Rate (K)", true)} className="text-gray-400 hover:text-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Hide Column"><EyeOff size={10} /></button>
                              )}
                            </div>
                          </th>
                        )}
                        {!hiddenPredefinedCols.override_total && (
                          <th className="border-r border-gray-300 px-1 py-1.5 text-right w-32 text-gray-800 bg-gray-50/20 text-[11px] group relative">
                            <div className="flex items-center justify-between gap-1">
                              <span className="w-full text-right">Total (L)</span>
                              {!isVersionSubmitted && (
                                <button onClick={() => handleHideColumn("Total (L)", true)} className="text-gray-400 hover:text-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Hide Column"><EyeOff size={10} /></button>
                              )}
                            </div>
                          </th>
                        )}
                        {allCols.map((col, realIdx) => {
                          if (col.hideColumn) return null;
                          return (
                            <DraggableHeaderCol
                              key={col.name}
                              col={col}
                              idx={realIdx}
                              isVersionSubmitted={isVersionSubmitted}
                              allCols={allCols}
                              getExcelColumnName={getExcelColumnName}
                              handleGlobalCalculation={handleGlobalCalculation}
                              globalColSettings={globalColSettings}
                              handleHideColumn={handleHideColumn}
                              boqItems={boqItems}
                              customColumns={customColumns}
                              customColumnValues={customColumnValues}
                              saveItemLayout={saveItemLayout}
                              toast={toast}
                              setCustomColumns={setCustomColumns}
                              setCustomColumnValues={setCustomColumnValues}
                              setGlobalColSettings={setGlobalColSettings}
                            />
                          );
                        })}
                      </Reorder.Group>
                    </thead>
                    <Reorder.Group
                      axis="y"
                      values={boqItems}
                      onReorder={async (newItems) => {
                        setBoqItems(newItems);
                        if (isVersionSubmitted) return;

                        try {
                          const resp = await apiFetch("/api/boq-items/reorder", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ itemIds: newItems.map((i) => i.id) }),
                          });

                          if (resp.ok) {
                            toast({
                              title: "Sequence Saved",
                              description: "BOM item order has been updated.",
                            });
                          } else {
                            throw new Error("Failed to save order");
                          }
                        } catch (e) {
                          console.error("Sort order sync failed:", e);
                          toast({
                            title: "Error",
                            description: "Failed to save row order",
                            variant: "destructive",
                          });
                        }
                      }}
                      as="tbody"
                    >
                      {boqItems.map((boqItem, boqIdx) => {
                        let tableData = boqItem.table_data || {};
                        if (typeof tableData === "string") {
                          try { tableData = JSON.parse(tableData); } catch { tableData = {}; }
                        }

                        if (tableData.finalize_hide_row) return null;

                        const currentStep11Items: Step11Item[] = Array.isArray(tableData.step11_items) ? tableData.step11_items : [];
                        const derivedProductName = tableData.product_name || boqItem.estimator || "—";
                        const productName = (derivedProductName === "Manual Product" || derivedProductName === "Manual" || boqItem.estimator === "manual_product" || boqItem.estimator === "Manual")
                          ? (currentStep11Items[0]?.title || currentStep11Items[0]?.description || derivedProductName)
                          : derivedProductName;
                        const category = tableData.category || "";
                        const isSelected = selectedProductIds.has(boqItem.id);

                        let total = 0;
                        let rateSqft = 0;
                        if (tableData.materialLines && tableData.targetRequiredQty !== undefined) {
                          const result = computeBoq(tableData.configBasis, tableData.materialLines, tableData.targetRequiredQty);
                          const manualTotal = currentStep11Items.filter((it: any) => it.manual).reduce((s: number, it: any) =>
                            s + (Number(it.qty) || 0) * (Number(it.supply_rate || 0) + Number(it.install_rate || 0)), 0);
                          total = result.grandTotal + manualTotal;
                          rateSqft = tableData.targetRequiredQty > 0 ? total / tableData.targetRequiredQty : 0;
                        } else {
                          total = currentStep11Items.reduce((s: number, it: any) =>
                            s + (it.qty || 0) * ((it.supply_rate || 0) + (it.install_rate || 0)), 0);
                          rateSqft = (currentStep11Items[0]?.qty ?? 0) > 0 ? total / (currentStep11Items[0]?.qty || 1) : total;
                        }

                        const manualDesc = productDescriptions[boqItem.id] ?? (
                          tableData.subcategory || currentStep11Items[0]?.description || category || ""
                        );

                        return (
                          <Reorder.Item
                            key={boqItem.id}
                            value={boqItem}
                            as="tr"
                            className={`hover:bg-blue-50/40 cursor-default transition-colors border-b border-gray-100 ${isSelected ? "bg-blue-50/60" : "bg-white"}`}
                          >
                            {!hiddenPredefinedCols.sno && (
                              <td className="border-r px-2 py-1.5 text-center bg-gray-50/50 align-middle" style={{ cursor: "grab" }}>
                                <div className="flex flex-col items-center gap-1">
                                  <span className="text-[10px] font-bold text-gray-500">{boqIdx + 1}</span>
                                  <div className="text-gray-300 hover:text-blue-400 transition-colors flex items-center justify-center">
                                    <GripVertical size={14} className="mx-auto" />
                                  </div>
                                </div>
                              </td>
                            )}
                            {!hiddenPredefinedCols.sno && (
                              <td className="border-r px-2 py-1.5 text-center align-middle">
                                <div className="flex flex-col items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    disabled={isVersionSubmitted}
                                    onChange={e => {
                                      setSelectedProductIds(prev => {
                                        const next = new Set(prev);
                                        e.target.checked ? next.add(boqItem.id) : next.delete(boqItem.id);
                                        return next;
                                      });
                                    }}
                                    className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
                                  />
                                </div>
                              </td>
                            )}
                            {!hiddenPredefinedCols.product && (
                              <td className="border-r px-1.5 py-1 font-medium text-gray-800 text-[10px] align-middle">
                                <div className="flex items-center gap-2">
                                  {(() => {
                                    const imgSrc = parseProductImage(tableData.image);
                                    return imgSrc ? (
                                      <div className="flex-shrink-0">
                                        <img
                                          src={imgSrc}
                                          alt={productName}
                                          className="h-10 w-10 object-cover rounded border shadow-sm"
                                          title="Product Image"
                                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                        />
                                      </div>
                                    ) : null;
                                  })()}
                                  <div className="flex flex-col gap-0.5">
                                    <div className="font-bold leading-tight line-clamp-2">{productName}</div>
                                    {category && <div className="text-[8px] text-blue-500 font-extrabold uppercase tracking-tighter">{category}</div>}
                                  </div>
                                </div>
                              </td>
                            )}
                            {!hiddenPredefinedCols.description && (
                              <td className="border-r px-1.5 py-1 align-middle">
                                <textarea
                                  value={manualDesc || tableData.finalize_description || ""}
                                  disabled={isVersionSubmitted}
                                  onChange={e => setProductDescriptions(prev => ({ ...prev, [boqItem.id]: e.target.value }))}
                                  onBlur={() => saveItemLayout(boqItem.id, undefined, undefined, productDescriptions[boqItem.id])}
                                  rows={2}
                                  className={`w-full border-none rounded p-1 text-[10px] focus:ring-1 ring-blue-300 outline-none bg-transparent resize-y min-h-[35px] leading-tight ${getIsModified(boqItem.id, "description", manualDesc) ? "text-blue-600 font-bold italic" : ""}`}
                                  placeholder="Description..."
                                />
                              </td>
                            )}
                            {!hiddenPredefinedCols.hsn && (
                              <td className="border-r px-2 py-1 text-center font-semibold text-gray-700 text-[10px] align-middle bg-gray-50/30">
                                {tableData.hsn_code || (tableData.hsn_sac_type === 'hsn' ? tableData.hsn_sac_code : "") || "—"}
                              </td>
                            )}
                            {!hiddenPredefinedCols.sac && (
                              <td className="border-r px-2 py-1 text-center font-semibold text-gray-700 text-[10px] align-middle bg-gray-50/30">
                                {tableData.sac_code || (tableData.hsn_sac_type === 'sac' ? tableData.hsn_sac_code : "") || "—"}
                              </td>
                            )}
                            {!hiddenPredefinedCols.unit && (
                              <td className="border-r px-2 py-1 text-center font-medium text-gray-800 align-middle w-24 min-w-[80px]">
                                <input
                                  type="text"
                                  value={productUnits[boqItem.id] ?? (currentStep11Items[0]?.unit || tableData.unit || "")}
                                  disabled={isVersionSubmitted}
                                  onChange={e => setProductUnits(prev => ({ ...prev, [boqItem.id]: e.target.value }))}
                                  onBlur={() => saveItemLayout(boqItem.id, undefined, undefined, undefined, undefined, undefined, productUnits[boqItem.id])}
                                  className={`w-full border-none rounded p-0.5 text-[10px] focus:ring-1 ring-blue-300 outline-none bg-transparent text-center font-semibold h-7 ${getIsModified(boqItem.id, "unit", productUnits[boqItem.id] ?? (currentStep11Items[0]?.unit || tableData.unit || "")) ? "text-blue-600 underline" : ""}`}
                                  placeholder="Unit"
                                />
                              </td>
                            )}
                            {!hiddenPredefinedCols.qty && (
                              <td className="border-r px-2 py-1 text-center font-semibold text-gray-800 align-middle w-32 min-w-[100px]">
                                <input
                                  type="number"
                                  value={productQuantities[boqItem.id] ?? (tableData.materialLines && tableData.targetRequiredQty !== undefined ? tableData.targetRequiredQty : (currentStep11Items[0]?.qty || 0))}
                                  disabled={isVersionSubmitted}
                                  onChange={e => setProductQuantities(prev => ({ ...prev, [boqItem.id]: e.target.value }))}
                                  onBlur={async () => { await saveItemLayout(boqItem.id, undefined, undefined, undefined, productQuantities[boqItem.id]); }}
                                  className={`w-full border-none rounded p-0.5 text-[10px] focus:ring-1 ring-blue-300 outline-none bg-blue-100/50 text-center font-semibold h-7 ${getIsModified(boqItem.id, "qty", productQuantities[boqItem.id] ?? (tableData.materialLines && tableData.targetRequiredQty !== undefined ? tableData.targetRequiredQty : (currentStep11Items[0]?.qty || 0))) ? "text-blue-600 border-b border-blue-400" : ""}`}
                                  placeholder="Qty"
                                />
                              </td>
                            )}
                            {!hiddenPredefinedCols.rate && (
                              <td className="border-r px-2 py-1.5 text-right font-semibold text-gray-500 text-[10px] align-middle">
                                ₹{rateSqft.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                            )}
                            {!hiddenPredefinedCols.system_total && (
                              <td className="border-r px-2 py-1.5 text-right font-semibold text-gray-800 bg-gray-50 align-middle text-[10px] w-32">
                                ₹{(rateSqft * (productQuantities[boqItem.id] !== undefined ? parseFloat(productQuantities[boqItem.id]) || 0 : (tableData.materialLines && tableData.targetRequiredQty !== undefined ? Number(tableData.targetRequiredQty) : Number(currentStep11Items[0]?.qty || 0)))).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                            )}
                            {!hiddenPredefinedCols.override_rate && (
                              <td className="border-r px-2 py-1 text-center font-semibold text-gray-800 align-middle w-32 min-w-[100px]">
                                <input
                                  type="number"
                                  value={overrideRates[boqItem.id] ?? ""}
                                  disabled={isVersionSubmitted}
                                  onChange={e => setOverrideRates(prev => ({ ...prev, [boqItem.id]: e.target.value }))}
                                  onBlur={async () => { await saveItemLayout(boqItem.id, undefined, undefined, undefined, undefined, overrideRates[boqItem.id]); }}
                                  className={`w-full border-none rounded p-0.5 text-[10px] focus:ring-1 ring-gray-300 outline-none bg-gray-50 text-right font-semibold h-7 px-2 ${getIsModified(boqItem.id, "rate", overrideRates[boqItem.id] ?? "") ? "text-blue-600 font-bold" : ""}`}
                                  placeholder="0.00"
                                />
                              </td>
                            )}
                            {!hiddenPredefinedCols.override_total && (
                              <td className="border-r px-2 py-1.5 text-right font-semibold text-gray-800 bg-gray-50 align-middle text-[10px] w-32">
                                ₹{((parseFloat(overrideRates[boqItem.id] || "0") || 0) * (productQuantities[boqItem.id] !== undefined ? parseFloat(productQuantities[boqItem.id]) || 0 : (tableData.targetRequiredQty || currentStep11Items[0]?.qty || 0))).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                            )}
                            {/* Custom columns */}
                            {(() => {
                              const manualQtyStr = productQuantities[boqItem.id];
                              const displayQty = manualQtyStr !== undefined ? (parseFloat(manualQtyStr) || 0) : (tableData.targetRequiredQty || currentStep11Items[0]?.qty || 0);
                              const baseTotalValue = rateSqft * displayQty;

                              let itemRunningTotal = (parseFloat(overrideRates[boqItem.id] || "0") || 0) > 0
                                ? ((parseFloat(overrideRates[boqItem.id] || "0") || 0) * displayQty)
                                : baseTotalValue;
                              let accumulator = 0;
                              const rowCalculatedValues: { [colName: string]: number } = {};

                              // Calculate ALL columns first to ensure math remains correct even if some are hidden
                              const allCells = allCols.map((col, idx) => {
                                let valNum = 0;
                                let isTotalColumn = col.isTotal;

                                if (isTotalColumn) {
                                  itemRunningTotal += accumulator;
                                  accumulator = 0;
                                  rowCalculatedValues[col.name] = itemRunningTotal;
                                  valNum = itemRunningTotal;
                                } else {
                                  const itemColList = customColumns[boqItem.id] || [];
                                  const itemCol = itemColList.find((c: any) => c.name === col.name) || col;
                                  const baseSource = (itemCol as any).baseSource;
                                  const currentBaseSource = baseSource || "Total Value (₹)";
                                  const isCalculated = currentBaseSource && currentBaseSource !== "manual";

                                  if (isCalculated) {
                                    const _oRate = parseFloat(overrideRates[boqItem.id] || "0") || 0;
                                    const _ctx: SrcCtx = {
                                      totalVal: baseTotalValue, rate: rateSqft, qty: displayQty,
                                      overrideRate: _oRate, overrideTotal: _oRate * displayQty,
                                      rowCalc: rowCalculatedValues, customVals: customColumnValues[boqItem.id]?.[0] || {},
                                    };
                                    const baseVal = resolveSource(baseSource, _ctx);
                                    const multiplierSource = (itemCol as any).multiplierSource || "manual";
                                    const manualMultiplier = (itemCol as any).percentageValue || 0;
                                    const operator = (itemCol as any).operator || "%";
                                    const multiplierVal = multiplierSource === "manual" ? manualMultiplier : resolveSource(multiplierSource, _ctx);
                                    valNum = applyOperator(baseVal, multiplierVal, operator);
                                  } else {
                                    valNum = parseFloat(customColumnValues[boqItem.id]?.[0]?.[col.name] || "0") || 0;
                                  }

                                  rowCalculatedValues[col.name] = valNum;
                                  accumulator += valNum;
                                }

                                if (col.hideColumn) return null;

                                // Render the cell only if not hidden
                                if (isTotalColumn) {
                                  return (
                                    <td key={`${col.name}-${idx}`} className={`border-r px-2 py-1.5 text-right font-semibold text-green-900 bg-green-100/40 text-[10px] ${getIsModified(boqItem.id, "columns", col.name) ? "text-blue-600 border-2 border-blue-100" : ""}`}>
                                      ₹{valNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                  );
                                } else {
                                  const itemColList = customColumns[boqItem.id] || [];
                                  const itemCol = itemColList.find((c: any) => c.name === col.name) || col;
                                  const savedVal = customColumnValues[boqItem.id]?.[0]?.[col.name];
                                  const currentBaseSource = (itemCol as any).baseSource || "Total Value (₹)";
                                  const isCalculated = currentBaseSource && currentBaseSource !== "manual";

                                  const displayVal = isCalculated
                                    ? valNum.toFixed(2)
                                    : ((savedVal !== undefined && savedVal !== null && savedVal !== "") ? String(savedVal) : "");
                                  const itemMultiplier = (itemCol as any).percentageValue || 0;
                                  const itemOp = (itemCol as any).operator || "%";

                                  return (
                                    <td
                                      key={`${col.name}-${idx}`}
                                      className={`border-r px-2 py-1 relative group/cell align-middle text-[11px] min-w-[180px] ${getIsModified(boqItem.id, "columns", col.name) ? "bg-blue-50/40 text-blue-600 border-2 border-blue-100" : "bg-transparent"}`}
                                      title={getIsModified(boqItem.id, "columns", col.name) ? "Modified from Template" : ""}
                                    >
                                      <div className="flex flex-col h-full min-h-[45px] justify-between">
                                        <div className="absolute left-1 top-1 z-20 pointer-events-none group-hover/cell:pointer-events-auto focus-within:pointer-events-auto">
                                          <div className="flex items-center gap-1 opacity-0 group-hover/cell:opacity-100 focus-within:opacity-100 transition-opacity bg-white/95 p-1 rounded-md shadow-md border border-purple-200">
                                            <select
                                              className="bg-white border border-purple-300 rounded text-[10px] font-semibold text-purple-700 outline-none h-6 px-1 cursor-pointer"
                                              value={(itemCol as any).multiplierSource || "manual"}
                                              disabled={isVersionSubmitted}
                                              onChange={(e) => {
                                                handleItemCalculation(boqItem.id, col.name, itemMultiplier, itemOp, e.target.value);
                                              }}
                                            >
                                              <option value="manual">Val</option>
                                              <option value="Rate / Unit">G: Rate</option>
                                              <option value="Unit">H: Unit</option>
                                              <option value="Qty">I: Qty</option>
                                              <option value="Total Value (₹)">J: Total</option>
                                              <option value="Override Rate">K: O.Rate</option>
                                              <option value="Override Total">L: O.Total</option>
                                              {allCols.filter(c => c.name !== col.name).map((c) => {
                                                const visibleCols = allCols.filter(vc => !vc.hideColumn);
                                                const vIdx = visibleCols.findIndex(vc => vc.name === c.name);
                                                return (
                                                  <option key={c.name} value={c.name}>
                                                    {getExcelColumnName(vIdx + 12)}: {c.name.substring(0, 8)}
                                                  </option>
                                                );
                                              })}
                                            </select>

                                            <select
                                              className="bg-white border border-purple-300 rounded text-[10px] font-semibold text-purple-700 outline-none h-6 px-1 cursor-pointer"
                                              value={(itemCol as any).baseSource || "Total Value (₹)"}
                                              disabled={isVersionSubmitted}
                                              onChange={(e) => {
                                                handleItemCalculation(boqItem.id, col.name, itemMultiplier, itemOp, (itemCol as any).multiplierSource || "manual", e.target.value);
                                              }}
                                            >
                                              <option value="manual">Fixed Value</option>
                                              <option value="Total Value (₹)">J: Total</option>

                                              <option value="Rate / Unit">G: Rate</option>
                                              <option value="Qty">I: Qty</option>
                                              <option value="Override Rate">K: O.Rate</option>
                                              <option value="Override Total">L: O.Total</option>
                                              {allCols.filter(c => c.name !== col.name).map((c) => {
                                                const visibleCols = allCols.filter(vc => !vc.hideColumn);
                                                const vIdx = visibleCols.findIndex(vc => vc.name === c.name);
                                                return (
                                                  <option key={c.name} value={c.name}>
                                                    {getExcelColumnName(vIdx + 12)}: {c.name.substring(0, 8)}
                                                  </option>
                                                );
                                              })}
                                            </select>

                                            {((itemCol as any).multiplierSource || "manual") === "manual" && (
                                              <input
                                                type="number"
                                                className="w-16 h-6 bg-white border border-purple-400 rounded-md px-1.5 text-[11px] font-semibold text-purple-800 outline-none text-right shadow-sm focus:ring-1 ring-purple-600/30"
                                                value={itemMultiplier}
                                                disabled={isVersionSubmitted}
                                                onChange={(e) => {
                                                  const newVal = parseFloat(e.target.value) || 0;
                                                  handleItemCalculation(boqItem.id, col.name, newVal, itemOp, (itemCol as any).multiplierSource || "manual", (itemCol as any).baseSource || "Total Value (₹)");
                                                }}
                                              />
                                            )}

                                            <select
                                              className="bg-white border border-purple-300 rounded text-[10px] font-semibold text-purple-700 outline-none h-6 px-1 cursor-pointer"
                                              value={itemOp}
                                              disabled={isVersionSubmitted}
                                              onChange={(e) => {
                                                handleItemCalculation(boqItem.id, col.name, itemMultiplier, e.target.value, (itemCol as any).multiplierSource || "manual", (itemCol as any).baseSource || "Total Value (₹)");
                                              }}
                                            >
                                              <option value="%">%</option>
                                              <option value="*">×</option>
                                              <option value="/">÷</option>
                                              <option value="+">+</option>
                                            </select>
                                          </div>
                                        </div>

                                        <input
                                          type="number"
                                          disabled={isVersionSubmitted || isCalculated}
                                          value={displayVal}
                                          onChange={e => setCustomColumnValues(prev => ({
                                            ...prev,
                                            [boqItem.id]: {
                                              ...prev[boqItem.id],
                                              0: { ...(prev[boqItem.id]?.[0] || {}), [col.name]: e.target.value }
                                            }
                                          }))}
                                          onBlur={() => saveItemLayout(boqItem.id)}
                                          className={`w-full h-7 border-transparent rounded px-1 py-0.5 text-[11px] outline-none bg-transparent text-right font-bold transition-colors text-gray-800`}
                                          placeholder="0.00"
                                        />
                                        {/* Row-level badges removed per user request */}
                                      </div>
                                    </td>
                                  );
                                }
                              });

                              return allCells;
                            })()}
                          </Reorder.Item>
                        );
                      })}
                    </Reorder.Group>
                    {showColumnTotals && (
                      <tfoot>
                        <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold group">
                          {!hiddenPredefinedCols.sno && <td className="border-r bg-gray-100/50"></td>}
                          {!hiddenPredefinedCols.sno && <td className="border-r text-center text-xs text-gray-400 bg-gray-100/50">∑</td>}
                          {!hiddenPredefinedCols.product && (
                            <td className="border-r px-2 py-1.5 font-bold text-gray-800 relative text-[11px]">
                              COLUMN TOTALS
                              <button
                                onClick={() => setShowColumnTotals(false)}
                                className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-600"
                                title="Hide Column Totals"
                              >
                                <Trash2 size={12} />
                              </button>
                            </td>
                          )}
                          {!hiddenPredefinedCols.description && (
                            <td className="border-r px-4 py-3 text-right font-semibold text-gray-600 bg-gray-50/50">
                              {/* Description total - empty */}
                            </td>
                          )}
                          {!hiddenPredefinedCols.hsn && (
                            <td className="border-r px-2 py-1.5 text-right font-semibold text-gray-600 bg-gray-50/50 text-[11px] w-24">
                              {/* HSN Total - empty */}
                            </td>
                          )}
                          {!hiddenPredefinedCols.sac && (
                            <td className="border-r px-2 py-1.5 text-right font-semibold text-gray-600 bg-gray-50/50 text-[11px] w-24">
                              {/* SAC Total - empty */}
                            </td>
                          )}
                          {!hiddenPredefinedCols.rate && (
                            <td className="border-r px-2 py-1.5 text-right font-semibold text-gray-600 bg-gray-50/50 text-[11px] w-32">
                              ₹{calculatedColumnTotals.totalRateSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          )}
                          {!hiddenPredefinedCols.unit && (
                            <td className="border-r px-4 py-3 text-right font-semibold text-gray-600 bg-gray-50/50">
                              {/* Unit Total - empty */}
                            </td>
                          )}
                          {!hiddenPredefinedCols.qty && (
                            <td className="border-r px-4 py-3 text-right font-semibold text-gray-600 bg-gray-50/50">
                              {/* Qty Total intentionally left empty per user request */}
                            </td>
                          )}
                          {!hiddenPredefinedCols.system_total && (
                            <td className="border-r px-2 py-1.5 text-right font-semibold text-gray-800 bg-gray-50 group/total relative text-[11px] w-32">
                              {!hideSystemTotalFooter ? (
                                <>
                                  ₹{calculatedColumnTotals.totalValueSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  <button
                                    onClick={() => handleSetSystemTotalVisibility(false)}
                                    className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/total:opacity-100 transition-opacity text-red-400 hover:text-red-600"
                                    title="Hide System Total"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => handleSetSystemTotalVisibility(true)}
                                  className="text-gray-700 hover:text-gray-900 text-[10px] font-bold uppercase transition-colors"
                                >
                                  + Restore Total
                                </button>
                              )}
                            </td>
                          )}
                          {!hiddenPredefinedCols.override_rate && (
                            <td className="border-r px-2 py-1.5 text-right font-semibold text-gray-600 bg-gray-50 text-[11px] w-32">
                              {/* Override Rate total - empty */}
                            </td>
                          )}
                          {!hiddenPredefinedCols.override_total && (
                            <td className="border-r px-2 py-1.5 text-right font-semibold text-gray-800 bg-gray-50 text-[11px] w-32">
                              ₹{calculatedColumnTotals.overrideTotalSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          )}
                          {allCols.map((col, realIdx) => {
                            if (col.hideColumn) return null;
                            return (
                              <td
                                key={`total-${realIdx}`}
                                className={`border-r px-2 py-1.5 text-right font-semibold group/total relative text-[11px] text-gray-800 bg-gray-50`}
                              >
                                {!col.hideTotal ? (
                                  <>
                                    ₹{calculatedColumnTotals.totals[realIdx].toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    <button
                                      onClick={() => handleToggleColumnTotalVisibility(col.name, true)}
                                      className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/total:opacity-100 transition-opacity text-red-400 hover:text-red-600"
                                      title="Hide Column Total"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    onClick={() => handleToggleColumnTotalVisibility(col.name, false)}
                                    className="text-gray-700 hover:text-gray-900 text-[10px] font-bold uppercase transition-colors"
                                  >
                                    + Restore
                                  </button>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </Card>
            )}

            {boqItems.length > 0 && showColumnTotals && (
              <div className="flex flex-col lg:flex-row gap-4 pt-4">
                {/* Terms and Conditions Section */}
                <div className="flex-1 min-w-[300px]">
                  <Card className="bg-gray-50/50 border-gray-200">
                    <CardHeader className="py-2 px-4 border-b">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">Global Terms & Conditions</span>
                        <span className="text-[9px] text-gray-400 font-medium italic">(Applied to all projects)</span>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      <textarea
                        className="w-full min-h-[100px] p-4 bg-transparent outline-none text-[12px] text-gray-700 leading-relaxed scrollbar-hide resize-y"
                        placeholder="Enter terms and conditions here..."
                        value={termsAndConditions}
                        onChange={(e) => handleUpdateTermsAndConditions(e.target.value)}
                      />
                    </CardContent>
                  </Card>
                </div>

                {/* Grand Total Section */}
                <div className="flex flex-col items-end">
                  <div className="bg-gray-800 text-white rounded-lg px-4 py-3 flex items-center gap-8 shadow-lg group relative border border-gray-700 w-full lg:w-auto min-w-[500px]">
                    <button
                      onClick={() => setShowColumnTotals(false)}
                      className="absolute -left-2 -top-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover/total:opacity-100 transition-opacity shadow-md hover:bg-red-600 z-10"
                      title="Hide Grand Total"
                    >
                      <Trash2 size={12} />
                    </button>

                    <div className="flex flex-col gap-1 flex-1">
                      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">Grand Total Source</span>
                      <Select value={grandTotalColumn} onValueChange={handleSetGrandTotalColumn}>
                        <SelectTrigger className="h-8 bg-gray-700/50 border-gray-600 text-white text-[11px] font-semibold w-full">
                          <SelectValue placeholder="Select summary column" />
                        </SelectTrigger>
                        <SelectContent className="bg-gray-800 text-white border-gray-700 max-h-[300px] overflow-y-auto">
                          <SelectItem value="Total Value (₹)">Standard Total</SelectItem>
                          <SelectItem value="Override Total">Override Total</SelectItem>
                          {allCols.map(col => (
                            <SelectItem key={col.name} value={col.name}>{col.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="h-10 w-[1px] bg-gray-600/50 mx-2" />

                    <div className="flex flex-col items-end min-w-[150px]">
                      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-green-400/80 mb-1">
                        {grandTotalColumn === "Total Value (₹)" ? "Base Grand Total" :
                          grandTotalColumn === "Override Total" ? "Override Grand Total" :
                            `${grandTotalColumn} Total`}
                      </span>
                      <span className="text-2xl font-black text-green-400 font-mono tracking-tighter">
                        ₹{currentProjectValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        {
          selectedProjectId && activeVersionId && (
            <Card>
              <CardContent className="space-y-3 pt-6">
                {isVersionSubmitted ? (
                  <div className="bg-yellow-50 border border-yellow-200 rounded p-4 text-sm text-yellow-800">
                    <strong>This version is locked.</strong> Submit a new version
                    to make edits.
                  </div>
                ) : null}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Button
                    onClick={handleSaveProject}
                    variant="outline"
                    disabled={isVersionSubmitted || Object.keys(editedFields).length === 0}
                  >
                    Save Draft
                  </Button>
                  <Button
                    onClick={handleSubmitVersion}
                    variant="default"
                    disabled={isVersionSubmitted || boqItems.length === 0}
                  >
                    Lock Version
                  </Button>
                  <Button
                    onClick={handleDownloadExcel}
                    variant="outline"
                    disabled={boqItems.length === 0}
                  >
                    Download as Excel
                  </Button>
                  <Button
                    onClick={handleDownloadPdfOpenDialog}
                    variant="outline"
                    disabled={boqItems.length === 0}
                  >
                    Download as PDF
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        }

        {/* Save Template Dialog */}
        <Dialog open={isSaveTemplateDialogOpen} onOpenChange={setIsSaveTemplateDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Save BOQ Template</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Template Name</Label>
                <Input
                  placeholder="e.g., Standard Office Interior"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                />
                <p className="text-xs text-gray-500">
                  This will save the current column names and formulas.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsSaveTemplateDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveAsTemplate}>
                Save Template
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <DeleteConfirmationDialog
          isOpen={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
          onConfirm={deleteConfirmCallback}
          title={deleteConfirmTitle}
          itemName={deleteConfirmItem}
        />
      </div>
    </Layout>
  );
}
