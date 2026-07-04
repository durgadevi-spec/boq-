import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { ChevronUp, ChevronDown, Loader2, CheckCircle2, XCircle, Lock, History, Clock, Briefcase, MapPin, IndianRupee, GripVertical, Search, ArrowUp, ArrowLeft, ArrowRight, ArrowDown, Plus, Trash2, Save, MessageSquare, Users, ChevronsUpDown, Check, X, RefreshCw, Star, Edit, Reply, AlertTriangle } from "lucide-react";
import { fuzzySearch, cn } from "@/lib/utils";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import apiFetch from "@/lib/api";
import { computeBoq, UnitType } from "@/lib/boqCalc";
import { getEstimatorTypeFromProduct } from "@/lib/estimatorUtils";
import ProductPicker from "@/components/ProductPicker";
import MaterialPicker from "@/components/MaterialPicker";
import Step11Preview from "@/components/Step11Preview";
import { BomSketchCompareDialog } from "@/components/BomSketchCompareDialog";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from 'xlsx';
import { DeleteConfirmationDialog } from "../../../components/ui/DeleteConfirmationDialog";
import { ProductAnalysisDialog } from "@/components/ProductAnalysisDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../../../components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { Textarea } from "../../../components/ui/textarea";
import { Checkbox } from "../../../components/ui/checkbox";
import { useData } from "../../../lib/store";
import { Project, BOMVersion, BOMItem, Product, Step11Item, BOMHistory, BOMComment, User, PROJECT_STATUSES, getProjectStatusMeta } from '../types';
import { parseTableData, parseImages, safeJson, VERSION_LABEL } from '../utils';
import { EditableHsnSac } from './EditableHsnSac';
import { BoqItemRow } from './BoqItemRow';

export const BoqItemCard = React.memo(function BoqItemCard({ boqItem, boqIdx, isVersionSubmitted, expandedProductIds, setExpandedProductIds, getEditedValue, updateEditedField, handleDeleteRow, handleFinalizeProduct, handleAddItem, loadBoqItemsAndEdits, setBoqItems, checkBudgetEarly, handleSaveProject, onCardDragStart, onCardDragOver, onCardDrop, isCardDragOver, mismatches, isCompactView, onSaveAsTemplate, editedFields, comments, users, currentUser, onAddComment, selectedVersionId, totalProducts, onProductOrdinalChange, itemCategoryFilter, bomButtonsEnabled, onAnalysis }: {
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
  onCardDragStart?: (e: React.DragEvent) => void;
  onCardDragOver?: (e: React.DragEvent) => void;
  onCardDrop?: (e: React.DragEvent) => void;
  isCardDragOver?: boolean;
  mismatches?: any[];
  isCompactView?: boolean;
  onSaveAsTemplate?: (boqItem: BOMItem) => void;
  editedFields: Record<string, any>;
  comments: BOMComment[];
  users: User[];
  currentUser: any;
  onAddComment: (versionId: string, itemId?: string) => void;
  selectedVersionId: string | null;
  totalProducts?: number;
  onProductOrdinalChange?: (toIdx: number) => void;
  itemCategoryFilter: string;
  bomButtonsEnabled?: boolean;
  onAnalysis: (productName: string) => void;
}) {
  const { toast } = useToast();
  const tableData = parseTableData(boqItem.table_data);
  const [localTarget, setLocalTarget] = useState(tableData.targetRequiredQty || 0);
  const [showDescTooltip, setShowDescTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [amendRatesActive, setAmendRatesActive] = useState(false);

  const performDelete = async (action: "archive" | "trash", reason?: string) => {
    try {
      const url = reason
        ? `/api/boq-items/${boqItem.id}?reason=${encodeURIComponent(reason)}`
        : `/api/boq-items/${boqItem.id}`;

      const res = await apiFetch(url, { method: "DELETE" });
      if (res.ok) {
        setBoqItems(prev => prev.filter(i => i.id !== boqItem.id));
        toast({ title: "Product Deleted", description: "The product has been deleted permanently." });
        loadBoqItemsAndEdits();
      }
    } catch (err) {
      console.error("Failed to delete product", err);
    }
  };

  useEffect(() => {
    setLocalTarget(tableData.targetRequiredQty || 0);
  }, [tableData.targetRequiredQty]);

  const step11Items = Array.isArray(tableData.step11_items) ? tableData.step11_items : [];
  const productName = tableData.product_name || boqItem.estimator;
  const isBifProd = (productName || "").toLowerCase().includes('bif');
  const isLumpSum = getEditedValue(boqItem.id, "is_lump_sum", tableData.is_lump_sum || false);
  const isExpanded = expandedProductIds.has(boqItem.id);
  const isProductIndicate = getEditedValue(boqItem.id, "indicate", tableData.indicate || false);
  const toggle = () => setExpandedProductIds((prev: Set<string>) => { const n = new Set(prev); n.has(boqItem.id) ? n.delete(boqItem.id) : n.add(boqItem.id); return n; });

  // Drag state for row reorder
  const dragIdxRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // local ordered items state for drag reorder (non-engine)
  const [localItems, setLocalItems] = useState<any[]>([]);
  const [reorderInit, setReorderInit] = useState(false);

  const calculationTarget = (localTarget === undefined || localTarget === null || localTarget === "" || isNaN(Number(localTarget))) ? 1 : Math.max(0, Number(localTarget));


  let displayLines: any[] = step11Items;
  let isEngineBased = false;

  if (tableData.materialLines && tableData.targetRequiredQty !== undefined) {
    isEngineBased = true;
    const boqResult = computeBoq(
      tableData.configBasis || { requiredUnitType: "Sqft", baseRequiredQty: 1, wastagePctDefault: 0 },
      tableData.materialLines || [],
      calculationTarget
    );
    const computedLines = boqResult.computed.map((line: any, idx: number) => {
      const itemKey = `${boqItem.id}-engine-${idx}`;
      const isFrozen = line.freezeAndEdit || line.freeze_and_edit;
      const qty = Number(getEditedValue(itemKey, "qty", line.perUnitQty));
      const sRate = Number(getEditedValue(itemKey, "supply_rate", line.supplyRate));
      const iRate = Number(getEditedValue(itemKey, "install_rate", line.installRate));
      const rate = Number(getEditedValue(itemKey, "rate", sRate + iRate)) || (sRate + iRate);
      // Original engine rate (before any user edits) — used for rate amendment comparison
      const originalEngineRate = Number(line.supplyRate || 0) + Number(line.installRate || 0);

      const isLumpSumLine = (line.unit || "").toLowerCase() === "ls";
      const reqQty = calculationTarget === 0 ? 0 : (isFrozen ? line.roundOffQty : (isLumpSumLine ? 1 : Number((qty * calculationTarget).toFixed(2))));
      const roundOff = calculationTarget === 0 ? 0 : (isFrozen ? line.roundOffQty : (isLumpSumLine ? 1 : (line.applyRounding !== false ? Math.ceil(reqQty) : reqQty)));

      return {
        title: line.name, description: line.name, unit: line.unit, shop_name: line.shop_name,
        qtyPerSqf: isLumpSumLine ? 1 : qty, requiredQty: reqQty, roundOff: roundOff,
        rateSqft: rate, amount: Number((roundOff * rate).toFixed(2)), s_no: idx + 1, manual: false,
        _materialIdx: idx, itemKey,
        freezeAndEdit: line.freezeAndEdit,
        freeze_and_edit: line.freeze_and_edit,
        category: line.category,
        is_project_pricing: line.is_project_pricing,
        // Rate amendment fields
        original_engine_rate: originalEngineRate,
        original_rate: getEditedValue(itemKey, "original_rate", line.original_rate),
        rate_amendment_status: getEditedValue(itemKey, "rate_amendment_status", line.rate_amendment_status),
        id: line.id || line.materialId,
        materialId: line.materialId || line.id
      };
    });
    const manualStep11 = step11Items.map((it: any, s11Idx: number) => {
      if (!it?.manual) return null;
      // Also skip if this item is somehow already represented in materialLines (by ID comparison)
      // This handles cases where a template might have both populated inconsistently
      if (tableData.materialLines?.some((ml: any) => (ml.id || ml.materialId) === it.id)) return null;

      const itemKey = it.itemKey || `${boqItem.id}-manual-${s11Idx}`;
      const qty = Number(getEditedValue(itemKey, "qty", it.qtyPerSqf ?? it.qty ?? 0)) || 0;
      const sRate = Number(getEditedValue(itemKey, "supply_rate", it.supply_rate ?? 0)) || 0;
      const iRate = Number(getEditedValue(itemKey, "install_rate", it.install_rate ?? 0)) || 0;
      const rate = Number(getEditedValue(itemKey, "rate", sRate + iRate)) || (sRate + iRate);

      // --- FIX: Manual items should NOT be scaled by calculationTarget ---
      const isLumpSumLine = (it.unit || "").toLowerCase() === "ls";
      const reqQty = calculationTarget === 0 ? 0 : (isLumpSumLine ? 1 : qty);
      const roundOff = reqQty; // No rounding for manual items usually, or just keep as is
      const amount = Number((reqQty * rate).toFixed(2));
      const originalEngineRate = Number(it.supply_rate || 0) + Number(it.install_rate || 0);
      return {
        ...it,
        manual: true,
        itemKey,
        _s11Idx: s11Idx,
        qtyPerSqf: isLumpSumLine ? 1 : qty,
        requiredQty: reqQty,
        roundOff,
        amount,
        supply_rate: sRate,
        install_rate: iRate,
        original_engine_rate: originalEngineRate,
        original_rate: getEditedValue(itemKey, "original_rate", it.original_rate),
        rate_amendment_status: getEditedValue(itemKey, "rate_amendment_status", it.rate_amendment_status),
        id: it.id || it.materialId,
        materialId: it.materialId || it.id
      };
    }).filter(Boolean);
    displayLines = [...computedLines, ...manualStep11];
  } else {
    displayLines = step11Items.map((it: any, s11Idx: number) => {
      const itemKey = it.itemKey || `${boqItem.id}-manual-${s11Idx}`;
      const baseQty = Number(getEditedValue(itemKey, "qty", it.qtyPerSqf ?? it.qty ?? 0)) || 0;
      const sRate = Number(getEditedValue(itemKey, "supply_rate", it.supply_rate ?? 0)) || 0;
      const iRate = Number(getEditedValue(itemKey, "install_rate", it.install_rate ?? 0)) || 0;
      const rate = Number(getEditedValue(itemKey, "rate", sRate + iRate)) || (sRate + iRate);

      // --- FIX: For non-engine products/manual items, don't scale by default if it's a fixed item ---
      // However, some "Product Templates" might still want scaling. 
      // But based on user feedback, manual additions should not scale.
      const isManual = it.manual || !tableData.materialLines;
      const isLumpSumLine = (it.unit || "").toLowerCase() === "ls";
      const scaledQty = isManual ? (isLumpSumLine ? 1 : baseQty) : (calculationTarget === 0 ? 0 : (isLumpSumLine ? 1 : Number((baseQty * calculationTarget).toFixed(2))));
      const roundOff = isManual ? scaledQty : (calculationTarget === 0 ? 0 : ((it.applyRounding !== false && !isLumpSumLine) ? Math.ceil(scaledQty) : scaledQty));
      const amount = Number((roundOff * rate).toFixed(2));
      const originalEngineRate = Number(it.supply_rate || 0) + Number(it.install_rate || 0);
      return {
        ...it,
        itemKey,
        _s11Idx: s11Idx,
        qtyPerSqf: isLumpSumLine ? 1 : baseQty,
        qty: scaledQty,
        roundOff,
        rateSqft: rate,
        amount,
        manual: isManual,
        original_engine_rate: originalEngineRate,
        original_rate: getEditedValue(itemKey, "original_rate", it.original_rate),
        rate_amendment_status: getEditedValue(itemKey, "rate_amendment_status", it.rate_amendment_status),
        id: it.id || it.materialId,
        materialId: it.materialId || it.id
      };
    });
  }

  // Sync localItems when displayLines change from outside (add/delete/save)
  useEffect(() => {
    setLocalItems(displayLines);
    setReorderInit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step11Items.length, isEngineBased, boqItem.id, tableData.materialLines?.length, boqItem.table_data, calculationTarget, editedFields]);

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

  // Calculate Standard Rate at Base Qty (e.g. 100 Sqft) to ensure consistency across projects
  const baseQty = Number(tableData.configBasis?.baseRequiredQty || 1);
  let standardRate = 0;
  if (isEngineBased) {
    // Priority 1: Use the total_cost saved in tableData/configBasis (from Manage Product)
    const savedTotalCost = Number(tableData.total_cost ?? tableData.configBasis?.total_cost ?? 0);
    if (savedTotalCost > 0) {
      standardRate = savedTotalCost / baseQty;
    } else {
      // Priority 2: Fallback to dynamic calculation if no saved cost exists
      try {
        const resBase = computeBoq(
          { ...(tableData.configBasis || { requiredUnitType: "Sqft", baseRequiredQty: 1, wastagePctDefault: 0 }), wastagePctDefault: 0 },
          (tableData.materialLines || []).map((l: any) => ({ ...l, applyWastage: false })),
          baseQty
        );
        standardRate = resBase.grandTotal / baseQty;
      } catch { }
    }
  }

  // Use normalized standard rate if enabled
  const useStandardRate = !!tableData.use_standard_rate;
  const ratePerUnit = useStandardRate ? standardRate : (calculationTarget > 0 ? totalAmount / calculationTarget : (isEngineBased ? 0 : totalAmount));

  // Final grand total reflects the standard rate if used
  const grandTotalValue = useStandardRate ? (standardRate * calculationTarget) : totalAmount;
  const displayQty = isLumpSum ? 1 : calculationTarget;
  const displayRate = isLumpSum ? grandTotalValue : ratePerUnit;

  const roundOffAdjustment = grandTotalValue - totalAmount;

  const images = parseImages(tableData.image);
  const displayImage = images.length > 0 ? images[0] : null;

  return (
    <div
      className={`border rounded-lg overflow-hidden transition-all ${isCardDragOver ? 'ring-2 ring-blue-400 bg-blue-50/30' : ''} ${isProductIndicate ? 'border-rose-300 ring-1 ring-rose-200' : ''}`}
      draggable={!isVersionSubmitted}
      onDragStart={onCardDragStart}
      onDragOver={onCardDragOver}
      onDrop={onCardDrop}
    >
      {/* Header Row */}
      <div className={`${isProductIndicate ? 'bg-rose-100/50 border-rose-200' : 'bg-gray-100 border-gray-200'} px-4 py-2 flex flex-wrap justify-between items-center border-b gap-x-4 gap-y-2`}>
        <div className="flex items-center gap-3 font-bold text-gray-800 flex-1 min-w-0">
          <GripVertical className={`h-4 w-4 flex-shrink-0 ${isVersionSubmitted ? 'text-gray-200' : 'text-gray-400 hover:text-blue-500 cursor-grab'}`} />
          {!isVersionSubmitted && (
            <select
              value={boqIdx}
              onChange={(e) => onProductOrdinalChange?.(parseInt(e.target.value))}
              onClick={(e) => e.stopPropagation()}
              className={`text-xs p-0.5 border border-slate-200 rounded outline-none cursor-pointer text-slate-700 ${isProductIndicate ? 'bg-rose-50 border-rose-200' : 'bg-white'}`}
            >
              {Array.from({ length: totalProducts || 1 }).map((_, i) => (
                <option key={i} value={i}>{i + 1}</option>
              ))}
            </select>
          )}
          {displayImage && <img src={displayImage} alt={productName} className="h-7 w-7 object-cover rounded shadow-sm border border-slate-200" />}
          <span className="truncate max-w-[200px] sm:max-w-sm text-sm" title={productName}>
            {isVersionSubmitted ? `${boqIdx + 1}. ` : ""}{productName}
          </span>

          {!isCompactView && !isVersionSubmitted && (
            <div className="flex items-center gap-2 ml-2">
              <label className="flex items-center gap-1 text-[10px] text-blue-600 font-bold bg-white px-1.5 py-0.5 rounded border border-blue-200 shadow-sm cursor-pointer whitespace-nowrap" onClick={e => e.stopPropagation()}>
                <input type="checkbox" checked={isLumpSum} onChange={async (e) => {
                  const checked = e.target.checked;
                  updateEditedField(boqItem.id, "is_lump_sum", checked);
                  try {
                    let updatedTd = { ...tableData, is_lump_sum: checked };
                    const resp = await apiFetch(`/api/boq-items/${boqItem.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table_data: updatedTd }) });
                    if (resp.ok) { setBoqItems((prev: BOMItem[]) => prev.map((i: BOMItem) => i.id === boqItem.id ? { ...i, table_data: updatedTd } : i)); }
                  } catch (err) { console.error("Failed to save is_lump_sum", err); }
                }} />
                Convert to LS
              </label>
              <label className="flex items-center gap-1 text-[10px] text-blue-700 font-bold bg-white px-1.5 py-0.5 rounded border border-blue-300 shadow-sm cursor-pointer whitespace-nowrap" onClick={e => e.stopPropagation()}>
                <input type="checkbox" checked={useStandardRate} onChange={async (e) => {
                  const checked = e.target.checked;
                  try {
                    const updatedTd = { ...tableData, use_standard_rate: checked };
                    const resp = await apiFetch(`/api/boq-items/${boqItem.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table_data: updatedTd }) });
                    if (resp.ok) { setBoqItems((prev: BOMItem[]) => prev.map((i: BOMItem) => i.id === boqItem.id ? { ...i, table_data: updatedTd } : i)); }
                  } catch (err) { console.error("Failed to toggle standard rate", err); }
                }} />
                Fixed Rate
              </label>
              <label className="flex items-center gap-1 text-[10px] text-rose-600 font-bold bg-white px-1.5 py-0.5 rounded border border-rose-200 shadow-sm cursor-pointer whitespace-nowrap" onClick={e => e.stopPropagation()}>
                <input type="checkbox" checked={isProductIndicate} onChange={(e) => updateEditedField(boqItem.id, "indicate", e.target.checked)} />
                Indicate
              </label>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {isCompactView && (
            <div className="flex items-center gap-3 text-[11px] bg-white px-2 py-0.5 rounded border border-slate-200 shadow-sm whitespace-nowrap">
              <span className="font-semibold text-slate-500">Rate: <span className="text-blue-700 font-bold">₹{displayRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
              <div className="w-px h-3 bg-slate-300"></div>
              <span className="font-semibold text-slate-500">Total: <span className="text-slate-900 font-bold">₹{grandTotalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>

            </div>
          )}
          {tableData.is_finalized && <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded font-bold text-[10px]">Finalized</span>}
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title={isExpanded ? "Collapse" : "Expand"} onClick={toggle}>
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Content Area */}
      {!isCompactView && (
        <div className="px-4 py-3 space-y-3">
          <div className="space-y-3">
            {/* Row 2: Area + Add Item + Finalize */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded px-2 py-1 shadow-sm">
                <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                <input
                  type="text"
                  placeholder="Area (e.g. Hall)"
                  className="text-xs w-32 h-6 border-none outline-none focus:ring-0 bg-transparent font-bold text-slate-700"
                  value={tableData.category || ""}
                  onChange={(e) => {
                    const newArea = e.target.value;
                    updateEditedField(boqItem.id, "category", newArea);
                    updateEditedField(boqItem.id, "category_name", newArea);
                  }}
                  onBlur={async () => {
                    const newArea = editedFields[boqItem.id]?.category;
                    if (newArea === undefined) return;
                    try {
                      const updatedTd = { ...tableData, category: newArea, category_name: newArea };
                      if (updatedTd.materialLines) {
                        updatedTd.materialLines = updatedTd.materialLines.map((ml: any) => ({ ...ml, category: newArea }));
                      }
                      const resp = await apiFetch(`/api/boq-items/${boqItem.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table_data: updatedTd }) });
                      if (resp.ok) { setBoqItems((prev: BOMItem[]) => prev.map((i: BOMItem) => i.id === boqItem.id ? { ...i, table_data: updatedTd } : i)); }
                    } catch (err) { console.error("Failed to save area", err); }
                  }}
                />
              </div>

              <div className="flex items-center gap-2">
                {!tableData.is_finalized && (
                  <Button variant="outline" size="sm" className="h-7 text-xs border-slate-300 font-bold" disabled={isVersionSubmitted || !bomButtonsEnabled} onClick={() => handleAddItem(boqItem.id)}>+ Add Item</Button>
                )}
                <Button variant="default" size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white font-bold" disabled={isVersionSubmitted || tableData.is_finalized} onClick={() => handleFinalizeProduct(boqItem.id)}>Finalize</Button>
              </div>
            </div>

            {/* Row 3: Rate, Total, Analysis, Save, Comments, Delete */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="flex flex-col bg-white border border-slate-200 rounded px-3 py-1 shadow-sm min-w-[100px]">
                  <span className="text-[9px] text-slate-400 font-black uppercase tracking-tight">Rate per {isLumpSum ? "LS" : (tableData.configBasis?.requiredUnitType || "Unit")}</span>
                  <div className="text-sm font-black text-blue-700 leading-tight">
                    ₹{displayRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div className="flex flex-col bg-white border border-slate-200 rounded px-3 py-1 shadow-sm min-w-[100px]">
                  <span className="text-[9px] text-slate-400 font-black uppercase tracking-tight">Grand Total</span>
                  <span className="text-sm font-black text-slate-900 leading-tight">₹{grandTotalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>

                </div>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  className={`h-7 text-xs font-bold shadow-sm ${amendRatesActive ? 'bg-orange-100 text-orange-700 border-orange-300' : 'border-slate-300 bg-white hover:bg-slate-50'}`}
                  title={amendRatesActive ? "Finish editing rates. Use 'Submit Rate Amend Request' at the bottom of the page to send changes for admin approval." : "Enable rate editing for this product"}
                  onClick={() => setAmendRatesActive(!amendRatesActive)}
                  disabled={isVersionSubmitted || tableData.is_finalized}
                >
                  <Edit className="h-3.5 w-3.5 mr-1" />
                  {amendRatesActive ? "Done Editing" : "Amend Rates"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 font-bold shadow-sm"
                  onClick={() => onAnalysis(productName)}
                >
                  <History className="h-3.5 w-3.5 mr-1" />
                  Analysis
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs font-bold border-slate-300 shadow-sm" disabled={isVersionSubmitted} onClick={() => onSaveAsTemplate?.(boqItem)}>Save as Template</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs font-bold border-slate-300 shadow-sm relative" onClick={() => onAddComment(selectedVersionId!, boqItem.id)}>
                  <MessageSquare className="h-3 w-3 mr-1" />
                  Comments ({comments.filter(c => c.product_id === boqItem.id || (c.item_id && c.item_id.startsWith(boqItem.id))).length})
                  {(() => {
                    const unread = comments.filter(c => {
                      if (c.product_id !== boqItem.id && !(c.item_id && c.item_id.startsWith(boqItem.id))) return false;
                      if (c.user_id === currentUser?.id) return false;
                      const isVisible = (!c.visible_to || c.visible_to.length === 0 || c.visible_to.includes(currentUser?.username));
                      return isVisible && (!c.read_by || !c.read_by.includes(currentUser?.id));
                    }).length;
                    return unread > 0 ? (
                      <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] rounded-full h-4 min-w-4 flex items-center justify-center px-1 font-bold shadow border border-white">{unread}</span>
                    ) : null;
                  })()}
                </Button>
                {!isBifProd && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 w-7 p-0 bg-red-500 hover:bg-red-600 shadow-sm"
                    disabled={isVersionSubmitted}
                    onClick={() => setDeleteConfirmOpen(true)}
                    title="Delete Product"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            {/* Row 4: Description + HSN/SAC */}
            <div className="flex flex-wrap items-center gap-4 pt-1">
              <div className="relative flex-1 min-w-[300px]"
                onMouseEnter={(e) => {
                  if (tableData.finalize_description) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setTooltipPos({ x: rect.left, y: rect.bottom + 5 });
                    setShowDescTooltip(true);
                  }
                }}
                onMouseLeave={() => setShowDescTooltip(false)}
              >
                <Input
                  placeholder="Enter product description..."
                  className="h-8 text-xs w-full font-bold text-slate-700 bg-slate-50 border-slate-200 hover:bg-white focus:bg-white focus:ring-1 ring-blue-100"
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
                {showDescTooltip && tableData.finalize_description && (
                  <div className="fixed bg-gray-900 text-white text-[10px] rounded px-3 py-2 shadow-lg z-50 max-w-xs break-words font-medium" style={{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px` }}>
                    {tableData.finalize_description}
                  </div>
                )}
              </div>

              <EditableHsnSac
                tableData={tableData}
                onUpdate={async (hsn, sac) => {
                  try {
                    const updatedTd = { ...tableData, hsn_code: hsn, sac_code: sac, hsn_sac_type: hsn ? 'hsn' : (sac ? 'sac' : null), hsn_sac_code: hsn || sac || "" };
                    const resp = await apiFetch(`/api/boq-items/${boqItem.id}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ table_data: updatedTd })
                    });
                    if (resp.ok) { setBoqItems((prev: BOMItem[]) => prev.map((i: BOMItem) => i.id === boqItem.id ? { ...i, table_data: updatedTd } : i)); }
                  } catch (err) { console.error("Failed to save HSN/SAC", err); }
                }}
              />
            </div>

            {/* Row 5: Project Target */}
            {isEngineBased && (
              <div className={`flex items-center gap-3 pt-1 ${isLumpSum ? "opacity-50 pointer-events-none" : ""}`}>
                <span className="text-xs font-black text-slate-500 uppercase tracking-tight">Project Target:</span>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    className="h-8 w-24 text-xs font-black text-blue-600 border-blue-200 focus:ring-1 ring-blue-100 bg-white"
                    value={displayQty}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      if (isLumpSum) return;
                      setLocalTarget(Math.max(0, val));
                    }}

                    disabled={isVersionSubmitted || tableData.is_finalized}
                    onBlur={async (e) => {
                      const newVal = parseFloat(e.target.value);
                      const currentVal = tableData.targetRequiredQty ?? 1;
                      if (isNaN(newVal) || newVal === currentVal || newVal < 0) { setLocalTarget(currentVal); return; }
                      try {
                        const updatedTd = { ...tableData, targetRequiredQty: newVal };
                        const resp = await apiFetch(`/api/boq-items/${boqItem.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table_data: updatedTd }) });
                        if (resp.ok) { setBoqItems((prev: BOMItem[]) => prev.map((i: BOMItem) => i.id === boqItem.id ? { ...i, table_data: updatedTd } : i)); }
                      } catch (err) { console.error("Failed to update target qty", err); }
                    }}
                  />
                  <span className="text-xs font-black text-blue-600">{isLumpSum ? "LS" : (tableData.configBasis?.requiredUnitType || "Unit")}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Items Table */}
      {isExpanded && (
        <>
          <div className="overflow-x-auto">
            <table className="border-collapse text-xs min-w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="border px-1 py-2 text-center w-8 text-gray-400" title="Drag to reorder"><GripVertical className="h-3 w-3 mx-auto" /></th>
                  <th className="border px-2 py-2 text-left font-semibold w-10">Sl</th>
                  <th className="border px-1 py-1 text-center w-12 font-semibold">Image</th>
                  <th className="border px-2 py-2 text-left font-semibold w-64">Item</th>
                  {!isCompactView && <th className="border px-2 py-2 text-left font-semibold w-24">Project Area</th>}
                  {!isCompactView && <th className="border px-2 py-2 text-left font-semibold w-32">Shop</th>}
                  {!isCompactView && <th className="border px-2 py-2 text-left font-semibold w-[300px]">Description</th>}
                  <th className="border px-2 py-2 text-center font-semibold w-16">Unit</th>
                  <th className="border px-2 py-2 text-center font-semibold w-20">Qty/{tableData.configBasis?.requiredUnitType || "Sqf"}</th>
                  <th className="border px-2 py-2 text-center font-semibold w-24">Required Qty</th>
                  {!isCompactView && <th className="border px-2 py-2 text-center font-semibold w-24">Round off</th>}
                  <th className="border px-2 py-2 text-center font-semibold w-24">Rate/{tableData.configBasis?.requiredUnitType || "Unit"}</th>
                  <th className="border px-2 py-2 text-center font-semibold w-28 text-green-700">Amount</th>
                  <th className="border px-2 py-2 text-center font-semibold w-16">Action</th>
                </tr>
              </thead>
              <tbody>
                {renderLines.length === 0
                  ? <tr><td colSpan={12} className="text-center py-4 text-gray-500 italic">No items. Click "+ Add Item" to add one.</td></tr>
                  : renderLines
                    .map((item, originalIdx) => ({ ...item, originalIdx }))
                    .filter(item => itemCategoryFilter === "all" || item.category === itemCategoryFilter)
                    .map((item: any) => (
                      <BoqItemRow
                        key={item.itemKey || `${boqItem.id}-${item.originalIdx}`}
                        item={item} itemIdx={item.originalIdx} boqItem={boqItem}
                        tableData={tableData} isEngineBased={isEngineBased} isVersionSubmitted={isVersionSubmitted}
                        amendRatesActive={amendRatesActive}
                        getEditedValue={getEditedValue} updateEditedField={updateEditedField}
                        handleDeleteRow={handleDeleteRow} checkBudgetEarly={checkBudgetEarly}
                        handleSaveProject={handleSaveProject}
                        isDraggable={!isVersionSubmitted && !tableData.is_finalized}
                        isDragOver={dragOverIdx === item.originalIdx}
                        onDragStart={() => { dragIdxRef.current = item.originalIdx; }}
                        onDragOver={() => setDragOverIdx(item.originalIdx)}
                        onDrop={() => {
                          setDragOverIdx(null);
                          const from = dragIdxRef.current;
                          if (from === null || from === item.originalIdx) return;
                          dragIdxRef.current = null;
                          const newOrder = [...renderLines];
                          const [moved] = newOrder.splice(from, 1);
                          newOrder.splice(item.originalIdx, 0, moved);
                          handleRowReorder(newOrder);
                        }}
                        mismatch={mismatches?.find(m => m.index === (isEngineBased ? item._materialIdx : item._s11Idx) && m.type === (isEngineBased ? 'materialLine' : 'step11'))}
                        isCompactView={isCompactView}
                        comments={comments}
                        users={users}
                        currentUser={currentUser}
                        onAddComment={onAddComment}
                        selectedVersionId={selectedVersionId}
                        isBifProd={isBifProd}
                        totalItems={renderLines.length}
                        onOrdinalChange={(toIdx: number) => {
                          if (toIdx === item.originalIdx) return;
                          const newOrder = [...renderLines];
                          const [moved] = newOrder.splice(item.originalIdx, 1);
                          newOrder.splice(toIdx, 0, moved);
                          handleRowReorder(newOrder);
                        }}
                      />
                    ))
                }
              </tbody>
              <tfoot className="bg-gray-50/50 border-t-2 border-gray-200">
                <tr className="text-gray-600 font-medium">
                  <td colSpan={isCompactView ? 8 : 11} className="border px-2 py-1 text-right uppercase tracking-wider text-[10px]">Material Sub-total</td>
                  <td className="border px-2 py-1 text-right">₹{totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="border px-2 py-1"></td>
                </tr>
                {useStandardRate && Math.abs(roundOffAdjustment) >= 0.01 && (
                  <tr className="text-gray-500 italic">
                    <td colSpan={isCompactView ? 8 : 11} className="border px-2 py-1 text-right uppercase tracking-wider text-[10px]">Rounding Adjustment</td>
                    <td className="border px-2 py-1 text-right">{roundOffAdjustment > 0 ? "+" : ""}₹{roundOffAdjustment.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="border px-2 py-1"></td>
                  </tr>
                )}
                {!useStandardRate && (() => {
                  const targetQty = calculationTarget;
                  const displayRate = Number(ratePerUnit.toFixed(2));
                  const logicalTotal = targetQty * displayRate;
                  const roundOff = logicalTotal - totalAmount;

                  if (Math.abs(roundOff) < 0.01) return null;

                  return (
                    <tr className="text-gray-500 italic">
                      <td colSpan={isCompactView ? 8 : 11} className="border px-2 py-1 text-right uppercase tracking-wider text-[10px]">Round Off (Adjustment)</td>
                      <td className="border px-2 py-1 text-right">{roundOff > 0 ? "+" : ""}₹{roundOff.toFixed(2)}</td>
                      <td className="border px-2 py-1"></td>
                    </tr>
                  );
                })()}
                <tr className="font-bold bg-blue-50/20 text-blue-900">
                  <td colSpan={isCompactView ? 8 : 11} className="border px-2 py-1.5 text-right uppercase tracking-wider text-[10px]">Grand Total</td>
                  <td className="border px-2 py-1.5 text-right bg-blue-50/30">
                    ₹{grandTotalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
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

      <DeleteConfirmationDialog
        isOpen={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        onConfirm={performDelete}
        title="Delete this product?"
        permanentDelete={true}
        requireJustification={!!(boqItem as any).copied_from_item_id}
      />
    </div>
  );
}, (prevProps, nextProps) => {
  const prevExpanded = prevProps.expandedProductIds.has(prevProps.boqItem.id);
  const nextExpanded = nextProps.expandedProductIds.has(nextProps.boqItem.id);

  // editedFields is keyed by itemKey (`${boqItem.id}-engine-N` / `${boqItem.id}-manual-N`),
  // never by boqItem.id directly, so comparing editedFields[boqItem.id] always compared {} to {}
  // and never detected real edits (rate changes, rate_amendment_status, etc). Compare every
  // entry whose key belongs to this boqItem (prefix match) instead.
  const prefix = `${prevProps.boqItem.id}-`;
  const prevOwn: Record<string, any> = {};
  const nextOwn: Record<string, any> = {};
  for (const k of Object.keys(prevProps.editedFields)) {
    if (k.startsWith(prefix)) prevOwn[k] = prevProps.editedFields[k];
  }
  for (const k of Object.keys(nextProps.editedFields)) {
    if (k.startsWith(prefix)) nextOwn[k] = nextProps.editedFields[k];
  }

  // Only re-render if the boqItem data itself changed, or its expanded state, or if dragging state changed
  return (
    prevProps.boqItem.table_data === nextProps.boqItem.table_data &&
    prevExpanded === nextExpanded &&
    prevProps.isVersionSubmitted === nextProps.isVersionSubmitted &&
    prevProps.isCardDragOver === nextProps.isCardDragOver &&
    prevProps.isCompactView === nextProps.isCompactView &&
    prevProps.bomButtonsEnabled === nextProps.bomButtonsEnabled &&
    // Check if any edited field belonging to this specific product changed
    JSON.stringify(prevOwn) === JSON.stringify(nextOwn)
  );
});