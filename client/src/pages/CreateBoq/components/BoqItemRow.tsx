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

export const BoqItemRow = React.memo(function BoqItemRow({ item, itemIdx, boqItem, tableData, isEngineBased, isVersionSubmitted, getEditedValue, updateEditedField, handleDeleteRow, checkBudgetEarly, handleSaveProject, isDraggable, isDragOver, onDragStart, onDragOver, onDrop, mismatch, isCompactView, comments, users, currentUser, onAddComment, selectedVersionId, isBifProd, totalItems, onOrdinalChange, amendRatesActive }: {
  item: any; itemIdx: number; boqItem: BOMItem; tableData: any; isEngineBased: boolean; isVersionSubmitted: boolean;
  getEditedValue: (k: string, f: string, v: any) => any;
  updateEditedField: (k: string, f: string, v: any) => void;
  handleDeleteRow: (id: string, td: any, idx: number, item?: any) => void;
  checkBudgetEarly: () => Promise<boolean>;
  handleSaveProject: () => Promise<void>;
  isDraggable?: boolean;
  isDragOver?: boolean;
  onDragStart?: () => void;
  onDragOver?: () => void;
  onDrop?: () => void;
  mismatch?: any;
  isCompactView?: boolean;
  comments: BOMComment[];
  users: User[];
  currentUser: any;
  onAddComment: (versionId: string, itemId?: string) => void;
  selectedVersionId: string | null;
  isBifProd?: boolean;
  totalItems?: number;
  onOrdinalChange?: (toIdx: number) => void;
  amendRatesActive?: boolean;
}) {
  const { toast } = useToast();
  const itemKey = item.itemKey || `${boqItem.id}-manual-${itemIdx}`;

  // Engine items (from computeBoq) have pre-computed rateSqft/requiredQty/roundOff/amount.
  // Rendering them through the editable path reads supply_rate=0, causing the "0 rate" bug.
  const perItemIsEngine = isEngineBased && !item.manual;

  // ── Shared Editable States ──────────────────────────────────────
  const baseQty = Number(getEditedValue(itemKey, "qty", item.qty ?? 0)) || 0;
  const sRate = Number(getEditedValue(itemKey, "supply_rate", item.supply_rate ?? item.rateSqft ?? 0)) || 0;
  const iRate = Number(getEditedValue(itemKey, "install_rate", item.install_rate ?? 0)) || 0;
  const rate = Number(getEditedValue(itemKey, "rate", sRate + iRate)) || (sRate + iRate);
  const desc = getEditedValue(itemKey, "description", item.description || "");
  const unit = getEditedValue(itemKey, "unit", item.unit || "nos");

  // Local state for smooth typing
  const [localDesc, setLocalDesc] = useState(desc);
  const [localUnit, setLocalUnit] = useState(unit);
  const [localQty, setLocalQty] = useState(baseQty.toString());
  const [localRate, setLocalRate] = useState(rate.toString());
  const [isFocused, setIsFocused] = useState(false);
  const isIndicate = getEditedValue(itemKey, "indicate", item.indicate || false);

  const hasUnreadComments = comments.some(c => {
    if (c.item_id !== itemKey) return false;
    if (c.user_id === currentUser?.id) return false;
    const isVisible = (!c.visible_to || c.visible_to.length === 0 || c.visible_to.includes(currentUser?.username));
    return isVisible && (!c.read_by || !c.read_by.includes(currentUser?.id));
  });

  useEffect(() => { if (!isFocused) setLocalDesc(desc); }, [desc, isFocused]);
  useEffect(() => { if (!isFocused) setLocalUnit(unit); }, [unit, isFocused]);
  useEffect(() => { if (!isFocused) setLocalQty(baseQty.toString()); }, [baseQty, isFocused]);
  useEffect(() => { if (!isFocused) setLocalRate(rate.toString()); }, [rate, isFocused]);

  const isFreezed = item.freezeAndEdit === true || item.freezeAndEdit === "true" || item.freezeAndEdit === 1 || item.freeze_and_edit === true || item.freeze_and_edit === "true" || item.freeze_and_edit === 1;
  const rateAmendStatus = (item.rate_amendment_status === 'approved' || item.rate_amendment_status === 'rejected')
    ? item.rate_amendment_status
    : getEditedValue(itemKey, "rate_amendment_status", item.rate_amendment_status);
  const isRateAmended = rateAmendStatus === 'pending' || rateAmendStatus === 'draft';
  const isRateApproved = rateAmendStatus === 'approved';

  if (perItemIsEngine) {
    // Read-only display for engine-computed items (with optional rate editing)
    return (
      <tr
        className={`border-b border-gray-200 transition-colors text-xs ${isRateAmended ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300 hover:bg-amber-200' : isRateApproved ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200 hover:bg-emerald-100' : isDragOver ? 'bg-blue-50 border-blue-300' : hasUnreadComments ? 'bg-amber-50/70 hover:bg-amber-100 ring-1 ring-amber-200/50 relative z-10' : isIndicate ? 'bg-rose-50 hover:bg-rose-100' : isFreezed ? 'bg-cyan-100' : 'hover:bg-gray-50'}`}
        draggable={isDraggable}
        onDragStart={onDragStart}
        onDragOver={(e) => { e.preventDefault(); onDragOver?.(); }}
        onDrop={onDrop}
      >
        <td className="border px-1 py-2 text-center w-8 text-gray-400">{isDraggable && <GripVertical className="h-3 w-3 mx-auto cursor-grab hover:text-blue-500" />}</td>
        <td className="border px-2 py-2 text-center font-medium w-12">
          {!isVersionSubmitted ? (
            <select
              value={itemIdx}
              onChange={(e) => onOrdinalChange?.(parseInt(e.target.value))}
              className="text-xs p-0.5 border border-slate-200 rounded w-full bg-white outline-none cursor-pointer"
            >
              {Array.from({ length: totalItems || 1 }).map((_, i) => (
                <option key={i} value={i}>{i + 1}</option>
              ))}
            </select>
          ) : (
            item.s_no || itemIdx + 1
          )}
        </td>
        <td className="border px-0.5 py-0.5 text-center w-12 bg-gray-50/30">
          <div className="w-10 h-10 rounded border border-gray-200 bg-white overflow-hidden flex items-center justify-center mx-auto shadow-sm">
            {item.image ? (<img src={item.image.startsWith('data:') ? item.image : parseImages(item.image)[0]} alt="material" className="max-w-full max-h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/100x100?text=No+Image'; }} />) : (<span className="text-[8px] text-gray-400">N/A</span>)}
          </div>
        </td>
        <td className="border px-2 py-2 text-left w-64">
          <div className="font-medium text-gray-900">
            <div className="flex items-center gap-2 flex-wrap">
              <span>{item.title || item.name || "-"}</span>
              {item.category && item.category !== "General" && (
                <Badge variant="secondary" className="bg-indigo-50 text-indigo-600 border-indigo-100 text-[9px] px-1.5 py-0 h-4 font-bold uppercase tracking-tight">
                  {item.category}
                </Badge>
              )}
              {item.is_project_pricing && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-300 whitespace-nowrap">
                  ★ Project Pricing
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between gap-1 mt-1">
            <span></span>
            {!isVersionSubmitted && (
              <label className="flex items-center gap-1 text-[10px] text-rose-600 font-bold bg-white px-1.5 py-0.5 rounded border border-rose-200 shadow-sm whitespace-nowrap cursor-pointer">
                <input type="checkbox" checked={isIndicate} onChange={(e) => updateEditedField(itemKey, "indicate", e.target.checked)} className="cursor-pointer" />
                Indicate
              </label>
            )}
          </div>
          {mismatch && (<div className="mt-1 flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-200"><ArrowUp className="h-3 w-3" />Rate updated ₹{mismatch.new.toLocaleString()}</div>)}
        </td>
        {!isCompactView && (
          <td className="border px-2 py-2 text-left w-24">
            <Input
              value={item.category || ""}
              onChange={(e) => updateEditedField(itemKey, "category", e.target.value)}
              placeholder="Area..."
              className="h-7 text-[10px] border-gray-200 focus:border-blue-400 px-1.5"
              disabled={isVersionSubmitted}
            />
          </td>
        )}
        {!isCompactView && <td className="border px-2 py-2 text-left w-32 text-gray-600">{item.shop_name || "-"}</td>}
        {!isCompactView && <td className="border px-2 py-2 text-left w-[300px] text-gray-600 truncate max-w-[300px] hover:cursor-help hover:bg-blue-50" title={item.description || "-"}>{item.description || "-"}</td>}
        <td className="border px-2 py-2 text-center w-16">{item.unit || "-"}</td>
        <td className="border px-2 py-2 text-center w-20 font-medium">{(item.qtyPerSqf ?? 0).toFixed(3)}</td>
        <td className="border px-2 py-2 text-center w-24 text-blue-600 font-medium">{(item.requiredQty ?? 0).toFixed(2)}</td>
        {!isCompactView && <td className="border px-2 py-2 text-center w-24 font-bold">{item.roundOff}</td>}
        <td className={`border px-2 py-2 text-center w-24 ${mismatch ? 'bg-amber-50' : ''} ${isRateAmended ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300' : isRateApproved ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200' : ''}`}>
          {((item.freezeAndEdit === true || item.freezeAndEdit === "true" || item.freezeAndEdit === 1 || item.freeze_and_edit === true || item.freeze_and_edit === "true" || item.freeze_and_edit === 1) || amendRatesActive) && !tableData.is_finalized ? (
            <Input
              type="text"
              value={localRate}
              onChange={(e) => {
                const val = e.target.value;
                const parsed = parseFloat(val);
                if (amendRatesActive && !isNaN(parsed)) {
                  const origRate = item.original_rate ?? item.original_engine_rate ?? item.rateSqft;
                  if (parsed < origRate) {
                    // Clamp immediately — don't allow decrease
                    setLocalRate(origRate.toString());
                    updateEditedField(itemKey, "rate", origRate);
                    updateEditedField(itemKey, "supply_rate", origRate);
                    updateEditedField(itemKey, "install_rate", 0);
                    updateEditedField(itemKey, "rate_amendment_status", null);
                    toast({ title: "Rate cannot be decreased", description: `Minimum rate is ₹${origRate}`, variant: "destructive" });
                    return;
                  }
                }
                setLocalRate(val);
                if (!isNaN(parsed)) {
                  updateEditedField(itemKey, "rate", parsed);
                  updateEditedField(itemKey, "supply_rate", parsed);
                  updateEditedField(itemKey, "install_rate", 0);
                  if (amendRatesActive) {
                    const origRate = item.original_rate ?? item.original_engine_rate ?? item.rateSqft;
                    if (parsed > origRate) {
                      updateEditedField(itemKey, "rate_amendment_status", "draft");
                      if (item.original_rate === undefined && item.original_engine_rate !== undefined) {
                        updateEditedField(itemKey, "original_rate", item.original_engine_rate);
                      }
                    } else {
                      updateEditedField(itemKey, "rate_amendment_status", null);
                    }
                  }
                } else if (val === "") {
                  updateEditedField(itemKey, "rate", 0);
                  updateEditedField(itemKey, "supply_rate", 0);
                  updateEditedField(itemKey, "install_rate", 0);
                }
              }}
              onBlur={() => {
                setIsFocused(false);
                const v = parseFloat(localRate) || 0;
                if (amendRatesActive) {
                  const origRate = item.original_rate ?? item.original_engine_rate ?? item.rateSqft;
                  if (v < origRate) {
                    toast({
                      title: "Validation Error",
                      description: `Amended rate cannot be less than the original rate (₹${origRate})`,
                      variant: "destructive"
                    });
                    setLocalRate(origRate.toString());
                    updateEditedField(itemKey, "rate", origRate);
                    updateEditedField(itemKey, "supply_rate", origRate);
                    updateEditedField(itemKey, "install_rate", 0);
                    updateEditedField(itemKey, "rate_amendment_status", null);
                  } else if (v > origRate) {
                    updateEditedField(itemKey, "rate", v);
                    updateEditedField(itemKey, "supply_rate", v);
                    updateEditedField(itemKey, "install_rate", 0);
                    updateEditedField(itemKey, "rate_amendment_status", "draft");
                    if (item.original_rate === undefined && item.original_engine_rate !== undefined) {
                      updateEditedField(itemKey, "original_rate", item.original_engine_rate);
                    }
                  } else {
                    updateEditedField(itemKey, "rate", v);
                    updateEditedField(itemKey, "supply_rate", v);
                    updateEditedField(itemKey, "install_rate", 0);
                    updateEditedField(itemKey, "rate_amendment_status", null);
                  }
                } else {
                  updateEditedField(itemKey, "rate", v);
                  updateEditedField(itemKey, "supply_rate", v);
                  updateEditedField(itemKey, "install_rate", 0);
                }
              }}
              className={`h-7 w-20 text-xs text-center border-gray-200 focus:border-blue-400 ${amendRatesActive ? 'border-orange-300 bg-orange-50' : ''}`}
              disabled={isVersionSubmitted}
              onFocus={() => { setIsFocused(true); checkBudgetEarly(); }}
            />
          ) : (
            <span className={mismatch ? 'text-amber-700 font-bold' : ''}>₹{(item.rateSqft || 0).toLocaleString()}</span>
          )}
          {(isRateAmended || isRateApproved) && (item.original_rate ?? item.original_engine_rate) !== undefined && (
            <div className="text-[9px] text-slate-400 line-through leading-tight mt-0.5">
              ₹{Number(item.original_rate ?? item.original_engine_rate).toLocaleString()}
            </div>
          )}
        </td>
        <td className="border px-2 py-2 text-center w-28 font-bold text-green-700 bg-green-50">₹{(item.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td className="border px-2 py-2 text-center w-16">
          <div className="flex items-center justify-center gap-1">
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-blue-600 hover:text-blue-800 hover:bg-blue-50 relative" onClick={() => onAddComment(selectedVersionId!, itemKey)} title={`Comments (${comments.filter(c => c.item_id === itemKey).length})`}>
              <MessageSquare className="h-3 w-3" />
              {(() => {
                const unread = comments.filter(c => {
                  if (c.item_id !== itemKey) return false;
                  if (c.user_id === currentUser?.id) return false;
                  const isVisible = (!c.visible_to || c.visible_to.length === 0 || c.visible_to.includes(currentUser?.username));
                  return isVisible && (!c.read_by || !c.read_by.includes(currentUser?.id));
                }).length;
                return unread > 0 ? (
                  <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] rounded-full h-3.5 min-w-3.5 flex items-center justify-center font-bold px-0.5 shadow-sm border border-white">{unread}</span>
                ) : null;
              })()}
            </Button>
            {!isBifProd && (
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-600 hover:text-red-800 hover:bg-red-50" onClick={() => handleDeleteRow(boqItem.id, tableData, itemIdx, item)} disabled={isVersionSubmitted} title="Delete Item"><Trash2 className="h-3 w-3" /></Button>
            )}
          </div>
        </td>
      </tr>
    );
  }

  // ── Manual / non-engine editable path ──────────────────────────────────────
  // Preview values — manual items: qty × rate directly, no project-target scaling
  const previewQtyValue = parseFloat(localQty) || 0;
  const previewRateValue = parseFloat(localRate) || 0;
  const previewAmount = Number((previewQtyValue * previewRateValue).toFixed(2));

  return (
    <tr
      className={`border-b border-gray-200 transition-colors text-xs ${isRateAmended ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300 hover:bg-amber-200' : isRateApproved ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200 hover:bg-emerald-100' : isDragOver ? 'bg-blue-50 border-blue-300' : hasUnreadComments ? 'bg-amber-50/70 hover:bg-amber-100 ring-1 ring-amber-200/50 relative z-10' : isIndicate ? 'bg-rose-50 hover:bg-rose-100' : isFreezed ? 'bg-cyan-100' : 'hover:bg-gray-50'}`}
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragOver={(e) => { e.preventDefault(); onDragOver?.(); }}
      onDrop={onDrop}
    >
      <td className="border px-1 py-2 text-center w-8 text-gray-400">
        {isDraggable && <GripVertical className="h-3 w-3 mx-auto cursor-grab hover:text-blue-500" />}
      </td>
      <td className="border px-2 py-2 text-center font-medium w-12">
        {!isVersionSubmitted ? (
          <select
            value={itemIdx}
            onChange={(e) => onOrdinalChange?.(parseInt(e.target.value))}
            className="text-xs p-0.5 border border-slate-200 rounded w-full bg-white outline-none cursor-pointer"
          >
            {Array.from({ length: totalItems || 1 }).map((_, i) => (
              <option key={i} value={i}>{i + 1}</option>
            ))}
          </select>
        ) : (
          item.s_no || itemIdx + 1
        )}
      </td>
      <td className="border px-0.5 py-0.5 text-center w-12 bg-gray-50/30">
        <div className="w-10 h-10 rounded border border-gray-200 bg-white overflow-hidden flex items-center justify-center mx-auto shadow-sm">
          {item.image ? (
            <img
              src={item.image.startsWith('data:') ? item.image : parseImages(item.image)[0]}
              alt="material"
              className="max-w-full max-h-full object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).src = 'https://placehold.co/100x100?text=No+Image';
              }}
            />
          ) : (
            <span className="text-[8px] text-gray-400">N/A</span>
          )}
        </div>
      </td>
      <td className="border px-2 py-2 text-left w-64">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-2">
            <div className="flex flex-col">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="font-medium text-gray-900">{item.title || item.name || "-"}</div>
                {item.category && item.category !== "General" && (
                  <Badge variant="secondary" className="bg-indigo-50 text-indigo-600 border-indigo-100 text-[9px] px-1.5 py-0 h-4 font-bold uppercase tracking-tight">
                    {item.category}
                  </Badge>
                )}
              </div>
            </div>
            {item.manual && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[9px] px-1.5 py-0 font-bold uppercase leading-tight">
                Manual
              </Badge>
            )}
            {item.is_project_pricing && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-300 whitespace-nowrap">
                ★ Project Pricing
              </span>
            )}
          </div>
          {!isVersionSubmitted && (
            <label className="flex items-center gap-1 text-[10px] text-rose-600 font-bold bg-white px-1.5 py-0.5 rounded border border-rose-200 shadow-sm whitespace-nowrap cursor-pointer">
              <input type="checkbox" checked={isIndicate} onChange={(e) => updateEditedField(itemKey, "indicate", e.target.checked)} className="cursor-pointer" />
              Indicate
            </label>
          )}
        </div>
        {mismatch && (
          <div className="mt-1 flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-200">
            <ArrowUp className="h-3 w-3" />
            Rate increased to ₹{mismatch.new.toLocaleString()}
          </div>
        )}
      </td>
      {!isCompactView && (
        <td className="border px-2 py-2 text-left w-24">
          <Input
            value={item.category || ""}
            onChange={(e) => updateEditedField(itemKey, "category", e.target.value)}
            placeholder="Area..."
            className="h-7 text-[10px] border-gray-200 focus:border-blue-400 px-1.5"
            disabled={isVersionSubmitted}
          />
        </td>
      )}
      {!isCompactView && <td className="border px-2 py-2 text-left w-32 text-gray-600">{item.shop_name || "-"}</td>}
      {!isCompactView && <td className="border px-2 py-2 text-left w-[300px]">
        <Input
          value={localDesc}
          onChange={(e) => setLocalDesc(e.target.value)}
          onBlur={() => { setIsFocused(false); updateEditedField(itemKey, "description", localDesc); }}
          placeholder="Description..."
          title={localDesc}
          className="h-7 text-xs border-gray-200 focus:border-blue-400 hover:bg-blue-50"
          disabled={isVersionSubmitted || (item.freezeAndEdit || item.freeze_and_edit)}
          onFocus={() => { setIsFocused(true); checkBudgetEarly(); }}
        />
      </td>}
      <td className="border px-2 py-2 text-center w-16">
        <Input
          type="text"
          value={localUnit}
          onChange={(e) => {
            const val = e.target.value;
            setLocalUnit(val);
            if (val.toLowerCase() === "ls") {
              setLocalQty("1");
              updateEditedField(itemKey, "qty", 1);
            }
          }}
          onBlur={() => {
            setIsFocused(false);
            updateEditedField(itemKey, "unit", localUnit);
            if (localUnit.toLowerCase() === "ls") {
              setLocalQty("1");
              updateEditedField(itemKey, "qty", 1);
            }
          }}
          className="h-7 w-12 text-xs text-center border-gray-200 focus:border-blue-400"
          disabled={isVersionSubmitted || (item.freezeAndEdit || item.freeze_and_edit)}
          onFocus={() => { setIsFocused(true); checkBudgetEarly(); }}
        />
      </td>
      <td className="border px-2 py-2 text-center w-20">
        <Input
          type="text"
          value={localQty}
          onChange={(e) => {
            if (localUnit.toLowerCase() === "ls") {
              setLocalQty("1");
              updateEditedField(itemKey, "qty", 1);
              return;
            }
            const val = e.target.value;
            setLocalQty(val);
            const parsed = parseFloat(val);
            if (!isNaN(parsed)) {
              updateEditedField(itemKey, "qty", parsed);
            } else if (val === "") {
              updateEditedField(itemKey, "qty", 0);
            }
          }}
          onBlur={() => {
            setIsFocused(false);
            const finalQty = localUnit.toLowerCase() === "ls" ? 1 : (parseFloat(localQty) || 0);
            if (localUnit.toLowerCase() === "ls") setLocalQty("1");
            updateEditedField(itemKey, "qty", finalQty);
          }}
          className="h-7 w-16 text-xs text-center border-gray-200 focus:border-blue-400"
          disabled={isVersionSubmitted || (item.freezeAndEdit || item.freeze_and_edit)}
          onFocus={() => { setIsFocused(true); checkBudgetEarly(); }}
        />
      </td>
      {/* Required Qty — manual items show qty directly (no scaling) */}
      <td className="border px-2 py-2 text-center w-24 font-medium text-gray-900">
        {previewQtyValue.toFixed(2)}
      </td>
      {/* Round off — not applicable for manual items */}
      {!isCompactView && <td className="border px-2 py-2 text-center w-24 font-medium text-gray-500">-</td>}
      <td className={`border px-2 py-2 text-center w-24 ${isRateAmended ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300' : isRateApproved ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200' : ''}`}>
        <Input
          type="text"
          value={localRate}
          onChange={(e) => {
            const val = e.target.value;
            const parsed = parseFloat(val);
            if (amendRatesActive && !isNaN(parsed)) {
              const origRate = item.original_rate ?? item.original_engine_rate ?? (Number(item.supply_rate || 0) + Number(item.install_rate || 0));
              if (parsed < origRate) {
                setLocalRate(origRate.toString());
                updateEditedField(itemKey, "rate", origRate);
                updateEditedField(itemKey, "supply_rate", origRate);
                updateEditedField(itemKey, "install_rate", 0);
                updateEditedField(itemKey, "rate_amendment_status", null);
                toast({ title: "Rate cannot be decreased", description: `Minimum rate is ₹${origRate}`, variant: "destructive" });
                return;
              }
            }
            setLocalRate(val);
            if (!isNaN(parsed)) {
              updateEditedField(itemKey, "rate", parsed);
              updateEditedField(itemKey, "supply_rate", parsed);
              updateEditedField(itemKey, "install_rate", 0);
              if (amendRatesActive) {
                const origRate = item.original_rate ?? item.original_engine_rate ?? (Number(item.supply_rate || 0) + Number(item.install_rate || 0));
                if (parsed > origRate) {
                  updateEditedField(itemKey, "rate_amendment_status", "draft");
                  if (item.original_rate === undefined) {
                    updateEditedField(itemKey, "original_rate", origRate);
                  }
                } else {
                  updateEditedField(itemKey, "rate_amendment_status", null);
                }
              }
            } else if (val === "") {
              updateEditedField(itemKey, "rate", 0);
              updateEditedField(itemKey, "supply_rate", 0);
              updateEditedField(itemKey, "install_rate", 0);
            }
          }}
          onBlur={() => {
            setIsFocused(false);
            const v = parseFloat(localRate) || 0;
            if (amendRatesActive) {
              const origRate = item.original_rate ?? item.original_engine_rate ?? (Number(item.supply_rate || 0) + Number(item.install_rate || 0));
              if (v < origRate) {
                toast({
                  title: "Validation Error",
                  description: `Amended rate cannot be less than the original rate (₹${origRate})`,
                  variant: "destructive"
                });
                setLocalRate(origRate.toString());
                updateEditedField(itemKey, "rate", origRate);
                updateEditedField(itemKey, "supply_rate", origRate);
                updateEditedField(itemKey, "install_rate", 0);
                updateEditedField(itemKey, "rate_amendment_status", null);
              } else if (v > origRate) {
                updateEditedField(itemKey, "rate", v);
                updateEditedField(itemKey, "supply_rate", v);
                updateEditedField(itemKey, "install_rate", 0);
                updateEditedField(itemKey, "rate_amendment_status", "draft");
                if (item.original_rate === undefined) {
                  updateEditedField(itemKey, "original_rate", origRate);
                }
              } else {
                updateEditedField(itemKey, "rate", v);
                updateEditedField(itemKey, "supply_rate", v);
                updateEditedField(itemKey, "install_rate", 0);
                updateEditedField(itemKey, "rate_amendment_status", null);
              }
            } else {
              updateEditedField(itemKey, "rate", v);
              updateEditedField(itemKey, "supply_rate", v);
              updateEditedField(itemKey, "install_rate", 0);
            }
          }}
          className={`h-7 w-20 text-xs text-center border-gray-200 focus:border-blue-400 ${amendRatesActive ? 'border-orange-300 bg-orange-50' : ''}`}
          disabled={isVersionSubmitted}
          onFocus={() => { setIsFocused(true); checkBudgetEarly(); }}
        />
        {(isRateAmended || isRateApproved) && item.original_rate !== undefined && (
          <div className="text-[9px] text-slate-400 line-through leading-tight mt-0.5">
            ₹{Number(item.original_rate).toLocaleString()}
          </div>
        )}
      </td>
      <td className="border px-2 py-2 text-center w-28 font-bold text-green-700 bg-green-50">
        ₹{previewAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </td>
      <td className="border px-2 py-2 text-center w-16">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="sm" className="h-6 w-6 p-0 text-blue-600 hover:text-blue-800 hover:bg-blue-50 relative"
            onClick={() => onAddComment(selectedVersionId!, itemKey)}
            title={`Comments (${comments.filter(c => c.item_id === itemKey).length})`}
          >
            <MessageSquare className="h-3 w-3" />
            {(() => {
              const unread = comments.filter(c => {
                if (c.item_id !== itemKey) return false;
                if (c.user_id === currentUser?.id) return false;
                const isVisible = (!c.visible_to || c.visible_to.length === 0 || c.visible_to.includes(currentUser?.username));
                return isVisible && (!c.read_by || !c.read_by.includes(currentUser?.id));
              }).length;
              return unread > 0 ? (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] rounded-full h-3.5 min-w-3.5 flex items-center justify-center font-bold px-0.5 shadow-sm border border-white">{unread}</span>
              ) : null;
            })()}
          </Button>
          {!isBifProd && (
            <Button
              variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-600 hover:text-red-800 hover:bg-red-50"
              onClick={() => handleDeleteRow(boqItem.id, tableData, itemIdx, item)}
              disabled={isVersionSubmitted} title="Delete Item"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.item === nextProps.item &&
    prevProps.tableData === nextProps.tableData &&
    prevProps.isVersionSubmitted === nextProps.isVersionSubmitted &&
    prevProps.isDragOver === nextProps.isDragOver &&
    prevProps.mismatch === nextProps.mismatch &&
    prevProps.isCompactView === nextProps.isCompactView
  );
});