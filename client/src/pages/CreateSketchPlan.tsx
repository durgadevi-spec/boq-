import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Save, ArrowLeft, Camera, Pencil, Layers, X, GripVertical, FileText, Search, MessageSquare, Image as ImageIcon, Move, Lock, Unlock, ShieldAlert, Cloud, Check, AlertCircle, AlertTriangle, FileUp, FileSpreadsheet, Download, Paperclip, ArrowUp, ArrowDown, ArrowUpToLine, ArrowDownToLine, GitBranch, Store, ChevronDown, ChevronLeft, ChevronRight, ArrowUpDown, ArrowDownAz, Users, Copy } from "lucide-react";
import { Reorder, useDragControls } from "framer-motion";
import { SketchPad } from "@/components/SketchPad";
import apiFetch from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import Draggable from "react-draggable";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/auth-context";
import { SupplierLayout } from "@/components/layout/SupplierLayout";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

interface PlanImage {
  id?: string;
  url: string;
  name: string;
  item_id?: string | null;
}

interface PlanAttachment {
  id?: string;
  url: string; // base64 or URL
  name: string;
  type: "pdf" | "excel" | "other";
}
interface PlanItem {
  id: string;
  material_id?: string;
  item_name: string;
  description: string; // Used as Notes
  length: string;
  width: string;
  height: string;
  qty: string;
  unit: string;
  dimension_unit: "feet" | "mm" | "inch" | "cm" | "meter" | "sqft" | "sqmt" | "rft" | "rmt" | "nos" | "pcs" | "kg" | "litre" | "set" | "ls";
  remarks: string;
  dimensions?: { id: string; length: string; width: string; height: string; note?: string }[];
  preImages: PlanImage[]; // PRE-work images
  postImages: PlanImage[]; // POST-work images
  images?: PlanImage[]; // Legacy field for compatibility
  category?: string; // NEW
  assigned_vendor_id?: string;
  vendor_name?: string;
  assigned_user_id?: string;
  assigned_user_name?: string;
  user_task_status?: string;
  sort_order?: number;
}

const parseImages = (imageField: any): string[] => {
  if (!imageField) return [];
  if (Array.isArray(imageField)) return imageField;
  if (typeof imageField !== 'string') return [String(imageField)];
  try {
    if (imageField.startsWith('[') || imageField.startsWith('{')) {
      const parsed = JSON.parse(imageField);
      return Array.isArray(parsed) ? parsed : [imageField];
    }
    return [imageField];
  } catch (e) {
    return [imageField];
  }
};

// Helper to append auth token to URLs for <img> and <a> tags
const appendAuthToken = (url: string) => {
  if (!url || url.startsWith('data:')) return url;
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("authToken") : null;
  if (!token) return url;
  return url.includes('?') ? `${url}&token=${token}` : `${url}?token=${token}`;
};

// Helper Component for Image Columns (Pre/Post)
const PhotoColumn = ({
  item, idx, displayIdx, category, images, isLocked, isCompact,
  handleRowImageUpload, removeRowImage, renameRowImage,
  setPreviewImage, setSketchTarget, setSketchInitialData,
  lastSketchItemIdxRef, setSketchDialogOpen,
  onImageDragStart, onImageDrop
}: any) => {
  const [isOver, setIsOver] = useState(false);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <div
          className={cn(
            "relative inline-block cursor-pointer p-0.5 border rounded hover:border-amber-300 transition-all bg-white shadow-sm",
            isLocked && "pointer-events-auto hover:border-slate-200",
            isCompact ? "scale-100" : "",
            isOver && "border-indigo-500 bg-indigo-50 scale-110 shadow-md ring-2 ring-indigo-200 z-10"
          )}
          onDragOver={(e) => {
            if (isLocked) return;
            e.preventDefault();
            setIsOver(true);
          }}
          onDragLeave={() => setIsOver(false)}
          onDrop={(e) => {
            if (isLocked) return;
            setIsOver(false);
            onImageDrop(e, { type: category, rowIdx: idx });
          }}
        >
          {images.length > 0 ? (
            <div className={cn("relative rounded overflow-hidden", isCompact ? "w-6 h-6" : "w-8 h-8")}>
              <img src={images[0].url} className="w-full h-full object-cover" />
              <span className="absolute bottom-0 right-0 bg-amber-500 text-white text-[7px] px-0.5 rounded-tl font-bold leading-none">
                {images.length}
              </span>
            </div>
          ) : (
            <div className={cn("flex items-center justify-center bg-slate-50 text-slate-300", isCompact ? "w-6 h-6" : "w-8 h-8")}>
              <Camera className={cn(isCompact ? "w-3 h-3" : "w-4 h-4")} />
            </div>
          )}
          {isOver && (
            <div className="absolute inset-0 flex items-center justify-center bg-indigo-500/20 rounded pointer-events-none">
              <Plus className="w-4 h-4 text-indigo-600 animate-bounce" />
            </div>
          )}
        </div>
      </DialogTrigger>
      <DialogContent className="max-w-2xl z-[120]">
        <DialogHeader>
          <DialogTitle>Item {category === "pre" ? "Pre-work" : "Post-work"} Photos - {item.item_name || `Item ${displayIdx}`}</DialogTitle>
        </DialogHeader>
        <div
          className="grid grid-cols-4 gap-4 py-4 max-h-[60vh] overflow-y-auto"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            if (isLocked) return;
            onImageDrop(e, { type: category, rowIdx: idx });
          }}
        >
          {images.map((img: any, imgIdx: number) => (
            <div
              key={imgIdx}
              className={cn(
                "relative group aspect-square rounded border overflow-hidden bg-slate-100",
                !isLocked && "cursor-grab active:cursor-grabbing"
              )}
              draggable={!isLocked}
              onDragStart={(e) => onImageDragStart(e, { type: category, rowIdx: idx, imgIdx })}
            >
              <img
                src={img.url}
                className="w-full h-full object-cover cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => setPreviewImage(img)}
                title="Click to view full image"
              />
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] p-1 truncate opacity-0 group-hover:opacity-100 transition-opacity pr-6 pointer-events-none">
                {img.name}
              </div>
              {!isLocked && (
                <div className="absolute top-1 left-1 flex gap-1 z-10">
                  <button onClick={() => {
                    setSketchTarget(`${category}-${idx}`);
                    setSketchInitialData(img.url);
                    lastSketchItemIdxRef.current = imgIdx;
                    setSketchDialogOpen(true);
                  }} className="bg-slate-800 text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity" title="Edit in Sketch Editor">
                    <Pencil className="w-3 h-3" />
                  </button>
                  <div className="bg-indigo-500 text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-grab shadow-sm" title="Drag to move image">
                    <Move className="w-3 h-3" />
                  </div>
                </div>
              )}
              {!isLocked && (
                <>
                  <button onClick={() => renameRowImage(idx, imgIdx, category)} className="absolute bottom-1 right-1 bg-indigo-500 text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10" title="Rename photo">
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button onClick={() => removeRowImage(idx, imgIdx, category)} className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10" title="Delete photo">
                    <X className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          ))}
          {!isLocked && (
            <>
              <label className="aspect-square rounded border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 hover:border-indigo-300 hover:text-indigo-400 cursor-pointer bg-slate-50 transition-colors">
                <Plus className="w-5 h-5 mb-1" />
                <span className="text-[10px] uppercase font-bold text-center">Add<br />Photo</span>
                <input type="file" multiple accept="image/*" onChange={(e) => handleRowImageUpload(idx, e, category)} className="hidden" />
              </label>
              <label className="aspect-square rounded border-2 border-dashed border-indigo-200 flex flex-col items-center justify-center text-indigo-400 hover:border-indigo-400 hover:bg-indigo-50 cursor-pointer transition-colors">
                <Camera className="w-5 h-5 mb-1" />
                <span className="text-[10px] uppercase font-bold text-center">Open<br />Camera</span>
                <input type="file" accept="image/*" capture="environment" onChange={(e) => handleRowImageUpload(idx, e, category)} className="hidden" />
              </label>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Row Component for Drag and Drop
const SketchPlanRow = React.memo(({
  item, idx, displayIdx, itemsLength, updateItem, setOpenNotesIdx, removeItem, moveItemToPosition, selectMaterial,
  searchResults, searching, loadMaterials, materialSearch, setMaterialSearch,
  openPopoverIdx, setOpenPopoverIdx, renameRowImage, removeRowImage,
  handleRowImageUpload, isLocked, isFiltering, isCompact, setPreviewImage,
  setSketchTarget, setSketchInitialData, lastSketchItemIdxRef, toast, setSketchDialogOpen,
  isSelected, toggleSelect, userRole, onImageDragStart, onImageDrop,
  addDimension, removeDimension, updateDimension, cloneItem, categories
}: any) => {
  const [itemSearchTab, setItemSearchTab] = useState<"all" | "material" | "product">("all");
  const dragControls = useDragControls();
  const isSupplier = userRole === "supplier";
  const dialogRef = useRef<HTMLDivElement>(null);

  const dims = item.dimensions?.length ? item.dimensions : [{ id: "def", length: item.length, width: item.width, height: item.height, note: item.description }];

  return (
    <Reorder.Item
      as="tr"
      key={item.id}
      value={item}
      dragListener={!isLocked && !isFiltering}
      dragControls={dragControls}
      className="border-b hover:bg-slate-50/30 transition-colors bg-white"
    >
      <td className="px-2 py-2 text-center">
        {!isSupplier && (
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => toggleSelect(item.id)}
            className="mr-2"
          />
        )}
        <GripVertical
          className="w-4 h-4 text-slate-300 cursor-grab active:cursor-grabbing hover:text-indigo-400 m-auto inline-block"
          onPointerDown={(e) => dragControls.start(e)}
        />
      </td>
      <td className={cn("px-1", isCompact ? "py-0" : "py-2")}>
        <Select value={String(idx + 1)} onValueChange={(val) => moveItemToPosition(idx, parseInt(val) - 1)} disabled={isLocked || itemsLength <= 1}>
          <SelectTrigger className="w-[52px] h-6 text-[10px] p-1 border-slate-200">
            <div className="flex items-center justify-center gap-1 w-full">
              <span className="font-bold text-indigo-600">{displayIdx}</span>
              <span className="text-slate-400 text-[8px] opacity-70">#{idx + 1}</span>
            </div>
          </SelectTrigger>
          <SelectContent className="min-w-[3rem] max-h-40">
            {Array.from({ length: itemsLength }).map((_, i) => (
              <SelectItem key={i + 1} value={String(i + 1)} className="text-[10px] px-1">{i + 1}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className={cn("px-1", isCompact ? "py-0 w-[130px] min-w-[130px]" : "py-2 w-[220px] min-w-[220px] max-w-[220px]")}>
        <Dialog>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <DialogTrigger asChild>
                  <div className={cn("cursor-pointer hover:bg-slate-100 p-0.5 rounded flex items-center justify-between group border border-transparent hover:border-slate-200 w-full", isLocked && "pointer-events-auto hover:bg-transparent", isCompact ? "min-h-[22px]" : "min-h-[32px]")}>
                    <div className="flex-1 overflow-hidden">
                      {item.description ? (
                        <p className={cn("line-clamp-1 text-slate-700 font-medium italic leading-tight", isCompact ? "text-[9px]" : "text-[11px]")}>"{item.description}"</p>
                      ) : (
                        <p className={cn("text-slate-400 italic", isCompact ? "text-[9px]" : "text-[11px]")}>No notes...</p>
                      )}
                    </div>
                    <MessageSquare className={cn("text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity ml-1 shrink-0", isCompact ? "w-2.5 h-2.5" : "w-3 h-3")} />
                  </div>
                </DialogTrigger>
              </TooltipTrigger>
              {item.description && (
                <TooltipContent side="top" className="max-w-[350px] bg-slate-900 text-white py-2 px-3 rounded-md shadow-lg border border-slate-700 z-[100]">
                  <p className="text-[12px] font-medium leading-relaxed whitespace-normal">"{item.description}"</p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>

          <DialogContent className="sm:max-w-[750px] max-h-[90vh] flex flex-col p-0">
            <DialogHeader className="p-6 pb-2">
              <DialogTitle>Notes for {item.item_name || `Item ${displayIdx}`}</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto p-6 pt-2 custom-scrollbar space-y-4">
              <div>
                <Label className="text-xs font-bold uppercase text-slate-500 mb-2 block">Main Item Notes (Site Specifications)</Label>
                <Textarea
                  value={item.description}
                  onChange={(e) => updateItem(idx, "description", e.target.value)}
                  placeholder="Enter detailed site notes or specifications..."
                  className="min-h-[120px] resize-none"
                  disabled={isLocked}
                />
              </div>

              <div className="border-t pt-4">
                <div className="flex justify-between items-center mb-3">
                  <Label className="text-xs font-bold uppercase text-slate-500">Sub-Notes (Per Dimension Row)</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px] bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-100"
                    onClick={() => addDimension(idx)}
                    disabled={isLocked}
                  >
                    <Plus className="w-3 h-3 mr-1" /> Add Sub Note
                  </Button>
                </div>

                <div className="space-y-4">
                  {dims.map((dim: any, dIdx: number) => (
                    <div key={dim.id} className="flex gap-3 items-start bg-slate-50 p-3 rounded-lg border border-slate-100 shadow-sm">
                      <div className="flex-1">
                        <Label className="text-[10px] text-slate-400 font-bold mb-1.5 block uppercase tracking-tight">
                          {dIdx === 0 ? "Linked to Main Notes" : `Sub Note #${dIdx}`}
                        </Label>
                        <Input
                          value={dIdx === 0 ? item.description : (dim.note || "")}
                          onChange={(e) => {
                            if (dIdx === 0) {
                              updateItem(idx, "description", e.target.value);
                            } else {
                              updateDimension(idx, dIdx, "note" as any, e.target.value);
                            }
                          }}
                          placeholder={dIdx === 0 ? "Main notes..." : "Enter sub-note for this dimension..."}
                          className="h-9 text-xs bg-white"
                          disabled={isLocked}
                        />
                      </div>
                      <div className="w-[180px] shrink-0">
                        <Label className="text-[10px] text-slate-400 font-bold mb-1.5 block text-center uppercase tracking-tight">Dimensions (L / W / H)</Label>
                        <div className="flex gap-1 px-1">
                          <Input
                            value={dim.length}
                            onChange={(e) => updateDimension(idx, dIdx, "length", e.target.value)}
                            placeholder="L"
                            className="h-9 text-[11px] text-center px-0.5 font-bold bg-white border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                            disabled={isLocked}
                          />
                          <div className="flex items-center text-slate-300 px-0.5">/</div>
                          <Input
                            value={dim.width}
                            onChange={(e) => updateDimension(idx, dIdx, "width", e.target.value)}
                            placeholder="W"
                            className="h-9 text-[11px] text-center px-0.5 font-bold bg-white border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                            disabled={isLocked}
                          />
                          <div className="flex items-center text-slate-300 px-0.5">/</div>
                          <Input
                            value={dim.height}
                            onChange={(e) => updateDimension(idx, dIdx, "height", e.target.value)}
                            placeholder="H"
                            className="h-9 text-[11px] text-center px-0.5 font-bold bg-white border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                            disabled={isLocked}
                          />
                        </div>
                      </div>
                      {dIdx > 0 && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-9 w-9 text-red-400 mt-5 hover:bg-red-50 hover:text-red-500 rounded-md"
                          onClick={() => removeDimension(idx, dIdx)}
                          disabled={isLocked}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter className="p-6 border-t bg-slate-50/50">
              <DialogTrigger asChild>
                <Button className="bg-indigo-600 text-white hover:bg-indigo-700 h-10 px-8 text-sm font-bold shadow-lg shadow-indigo-100">Save Changes</Button>
              </DialogTrigger>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </td>
      <td className={cn("px-1", isCompact ? "py-0 w-[80px] min-w-[80px]" : "py-2 w-[100px] min-w-[100px] max-w-[100px]")}>
        <Popover>
          <PopoverTrigger asChild>
            <div className={cn("bg-slate-50 border border-slate-200 rounded px-1.5 flex items-center h-8 cursor-pointer hover:border-indigo-400", isCompact ? "h-6" : "h-8")}>
              <span className={cn("truncate font-bold italic text-slate-500", isCompact ? "text-[8px]" : "text-[10px]")}>
                {item.category || "-"}
              </span>
            </div>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-[200px]" align="start">
            <Command>
              <CommandInput placeholder="Search category..." className="h-8 text-xs" />
              <CommandList className="max-h-[200px]">
                <CommandEmpty>No category found.</CommandEmpty>
                <CommandGroup heading="Existing Categories">
                  {categories.map((catName: string, cIdx: number) => (
                    <CommandItem
                      key={cIdx}
                      onSelect={() => {
                        updateItem(idx, "category", catName);
                      }}
                      className="text-xs cursor-pointer"
                    >
                      {catName}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
            <div className="p-2 border-t bg-slate-50">
              <Input
                placeholder="Manual entry..."
                className="h-8 text-xs"
                value={item.category || ""}
                onChange={(e) => updateItem(idx, "category", e.target.value)}
              />
            </div>
          </PopoverContent>
        </Popover>
      </td>
      <td className={cn("px-2", isCompact ? "py-0 w-[120px] min-w-[120px] max-w-[120px]" : "py-2 w-[160px] min-w-[160px] max-w-[160px]")}>
        <Dialog modal={false} open={openPopoverIdx === idx} onOpenChange={(open) => {
          if (open) {
            setOpenPopoverIdx(idx);
            setMaterialSearch("");
            loadMaterials();
          } else {
            setOpenPopoverIdx(null);
          }
        }}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className={cn("w-full justify-start text-left font-normal border-dashed border-slate-300 hover:border-indigo-400 p-1", isLocked && "pointer-events-auto hover:bg-transparent", isCompact ? "h-6 text-[9px]" : "h-8 text-[11px]")} disabled={isLocked}>
              {item.item_name ? (
                <span className={cn("truncate", isCompact ? "max-w-[80px]" : "max-w-[120px]")}>{item.item_name}</span>
              ) : (
                <span className="text-slate-400 italic font-normal">+ Add Item</span>
              )}
              <Search className={cn("ml-auto opacity-50", isCompact ? "h-2 w-2" : "h-3 w-3")} />
            </Button>
          </DialogTrigger>
          <DialogContent hideOverlay className="p-0 sm:max-w-[500px] bg-transparent border-none shadow-none [&>button]:hidden pointer-events-none">
            <Draggable nodeRef={dialogRef} handle=".drag-handle">
              <div ref={dialogRef} className="bg-white border shadow-lg sm:rounded-lg pointer-events-auto flex flex-col w-full relative">
                <DialogHeader className="p-4 border-b drag-handle cursor-move bg-slate-50 hover:bg-slate-100 transition-colors select-none rounded-t-lg flex flex-row items-center justify-between">
                  <DialogTitle>Select Item for Row #{displayIdx}</DialogTitle>
                  <DialogClose className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
                    <X className="h-4 w-4" />
                    <span className="sr-only">Close</span>
                  </DialogClose>
                </DialogHeader>
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Search materials, products..."
                    value={materialSearch}
                    onValueChange={setMaterialSearch}
                    className="h-10"
                  />
                  <div className="flex border-b">
                    <button
                      onClick={() => setItemSearchTab("all")}
                      className={cn(
                        "flex-1 py-1 text-[10px] font-bold uppercase tracking-wider transition-all border-b-2",
                        itemSearchTab === "all" ? "border-indigo-600 text-indigo-600 bg-indigo-50/50" : "border-transparent text-slate-400 hover:bg-slate-50"
                      )}
                    >
                      All
                    </button>
                    <button
                      onClick={() => setItemSearchTab("material")}
                      className={cn(
                        "flex-1 py-1 text-[10px] font-bold uppercase tracking-wider transition-all border-b-2",
                        itemSearchTab === "material" ? "border-indigo-600 text-indigo-600 bg-indigo-50/50" : "border-transparent text-slate-400 hover:bg-slate-50"
                      )}
                    >
                      Materials
                    </button>
                    <button
                      onClick={() => setItemSearchTab("product")}
                      className={cn(
                        "flex-1 py-1 text-[10px] font-bold uppercase tracking-wider transition-all border-b-2",
                        itemSearchTab === "product" ? "border-indigo-600 text-indigo-600 bg-indigo-50/50" : "border-transparent text-slate-400 hover:bg-slate-50"
                      )}
                    >
                      Products
                    </button>
                  </div>
                  <CommandList className="max-h-[280px]">
                    {searching && <CommandEmpty>Loading...</CommandEmpty>}
                    {!searching && searchResults.length === 0 && <CommandEmpty>No items found.</CommandEmpty>}
                    {!searching && searchResults.length > 0 && (
                      <CommandGroup heading={`${itemSearchTab === 'all' ? 'All Items' : itemSearchTab === 'material' ? 'Materials' : 'Products'} (${searchResults.filter((m: any) => (itemSearchTab === 'all' && m.type !== 'Template') || (itemSearchTab === 'material' && m.type === 'Material') || (itemSearchTab === 'product' && m.type === 'Product')).length})`}>
                        {searchResults
                          .filter((m: any) => {
                            if (itemSearchTab === "all") return m.type !== "Template";
                            if (itemSearchTab === "material") return m.type === "Material";
                            if (itemSearchTab === "product") return m.type === "Product";
                            return true;
                          })
                          .sort((a: any, b: any) => (a.name || "").localeCompare(b.name || ""))
                          .map((m: any) => (
                            <CommandItem
                              key={`${m.type}-${m.id}`}
                              onSelect={() => { selectMaterial(idx, m); setOpenPopoverIdx(null); }}
                              className="cursor-pointer"
                            >
                              <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-sm">{m.name}</span>
                                  <Badge variant="outline" className="text-[10px] scale-90">{m.type}</Badge>
                                </div>
                                <div className="flex gap-2 text-[10px] text-slate-500">
                                  {m.code && <span>Code: {m.code}</span>}
                                  {m.category && <span>Category: {m.category}</span>}
                                </div>
                              </div>
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
                <div className="p-3 border-t bg-slate-50 flex flex-col gap-2">
                  <p className="text-[10px] uppercase font-bold text-slate-400">Custom Item</p>
                  <Input
                    placeholder="Or type a custom name and press Enter..."
                    className="h-10 text-sm"
                    onChange={(e) => updateItem(idx, "item_name", e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setOpenPopoverIdx(null);
                      }
                    }}
                  />
                </div>
              </div>
            </Draggable>
          </DialogContent>
        </Dialog>
      </td>
      <td className={cn("px-1", isCompact ? "py-0" : "py-2")}>
        <Select value={item.dimension_unit} onValueChange={(val: any) => updateItem(idx, "dimension_unit", val)} disabled={isLocked}>
          <SelectTrigger className={cn("text-[9px] py-0 px-1 min-w-[50px]", isCompact ? "h-5" : "h-8")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[110] max-h-[180px] overflow-y-auto">
            <SelectItem value="feet">ft</SelectItem>
            <SelectItem value="mm">mm</SelectItem>
            <SelectItem value="inch">inch</SelectItem>
            <SelectItem value="cm">cm</SelectItem>
            <SelectItem value="meter">m</SelectItem>
            <SelectItem value="sqft">sqft</SelectItem>
            <SelectItem value="sqmt">sqmt</SelectItem>
            <SelectItem value="rft">rft</SelectItem>
            <SelectItem value="rmt">rmt</SelectItem>
            <SelectItem value="nos">nos</SelectItem>
            <SelectItem value="pcs">pcs</SelectItem>
            <SelectItem value="kg">kg</SelectItem>
            <SelectItem value="litre">ltr</SelectItem>
            <SelectItem value="set">set</SelectItem>
            <SelectItem value="ls">LS</SelectItem>
          </SelectContent>
        </Select>
      </td>
      <td className={cn("px-2 align-top border-l w-[110px] min-w-[110px] max-w-[110px]", isCompact ? "py-1" : "py-2")}>
        <div className="flex flex-col gap-1 w-full h-[calc(100%-4px)] relative justify-center">
          <div className={cn("relative flex items-center justify-center w-full", isCompact ? "h-5 text-[10px]" : "h-8 text-xs")}>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" className={cn("w-full justify-between px-2 text-slate-500 hover:text-indigo-600 bg-slate-50 relative top-1", isCompact ? "h-5 text-[9px]" : "h-8 text-[11px]", dims.length > 1 && "bg-indigo-100 text-indigo-700 border-indigo-200 font-bold")}>
                  <span className="truncate">
                    {dims[0].length || dims[0].width || dims[0].height ? `${dims[0].length || '-'} × ${dims[0].width || '-'} × ${dims[0].height || '-'}` + (dims.length > 1 ? ` (+${dims.length - 1})` : '') : "Add Dims"}
                  </span>
                  <ChevronDown className="w-3 h-3 ml-1 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[300px] p-3 shadow-xl z-[200]">
                <div className="flex justify-between items-center mb-3 border-b pb-2">
                  <div className="flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-indigo-500" />
                    <span className="font-bold text-[10px] uppercase text-slate-500 tracking-wider">Site Measurements</span>
                  </div>
                  {!isLocked && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => addDimension(idx)} className="h-6 px-2 text-[10px] text-indigo-600 hover:bg-indigo-50 font-bold uppercase">
                      <Plus className="w-3 h-3 mr-1" /> Add Sub Note
                    </Button>
                  )}
                </div>
                <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1 custom-scrollbar">
                  {dims.map((dim: any, dIdx: number) => (
                    <div key={dim.id} className={cn("bg-white border rounded-lg shadow-sm overflow-hidden", dIdx === 0 ? "border-slate-200" : "border-indigo-100")}>
                      <div className={cn("px-2 py-1.5 flex items-center gap-2", dIdx === 0 ? "bg-slate-50" : "bg-indigo-50/50")}>
                        {dIdx === 0 ? (
                          <FileText className="w-3 h-3 text-slate-400" />
                        ) : (
                          <GitBranch className="w-3 h-3 text-indigo-400" />
                        )}
                        <span className={cn("text-[9px] font-bold uppercase truncate flex-1", dIdx === 0 ? "text-slate-500" : "text-indigo-600")}>
                          {dIdx === 0 ? "Primary Dimensions" : `Sub: ${dim.note || 'Untitled'}`}
                        </span>
                        {dIdx > 0 && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button className="p-0.5 hover:bg-indigo-100 rounded text-indigo-400">
                                <ChevronDown className="w-3 h-3" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent side="right" className="w-[200px] p-2 text-[10px] bg-slate-900 text-white border-slate-700">
                              <p className="font-bold border-b border-slate-700 pb-1 mb-1">Sub Note Detail</p>
                              <p className="italic text-slate-300">"{dim.note || 'No description provided'}"</p>
                            </PopoverContent>
                          </Popover>
                        )}
                        {dIdx > 0 && !isLocked && (
                          <button type="button" onClick={() => removeDimension(idx, dIdx)} className="p-0.5 hover:bg-red-50 text-red-400 rounded transition-colors ml-1">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>

                      <div className="p-2 grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[8px] text-slate-400 font-bold uppercase block text-center">Length</Label>
                          <Input value={dim.length} onChange={(e) => updateDimension(idx, dIdx, "length", e.target.value)} placeholder="0" className="h-7 text-[11px] text-center px-1 font-bold" disabled={isLocked} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[8px] text-slate-400 font-bold uppercase block text-center">Width</Label>
                          <Input value={dim.width} onChange={(e) => updateDimension(idx, dIdx, "width", e.target.value)} placeholder="0" className="h-7 text-[11px] text-center px-1 font-bold" disabled={isLocked} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[8px] text-slate-400 font-bold uppercase block text-center">Height</Label>
                          <Input value={dim.height} onChange={(e) => updateDimension(idx, dIdx, "height", e.target.value)} placeholder="0" className="h-7 text-[11px] text-center px-1 font-bold" disabled={isLocked} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </td>
      <td className={cn("px-1 align-top w-[80px] min-w-[80px] max-w-[80px]", isCompact ? "py-1" : "py-2")}>
        <div className="flex flex-col gap-1 w-full relative h-[calc(100%-4px)]">
          <div className={cn("relative flex items-center justify-center top-1")}>
            <Input value={item.qty} onChange={(e) => updateItem(idx, "qty", e.target.value)} className={cn("bg-slate-50 font-bold text-indigo-700 px-1 w-full max-w-[80px] text-center", isCompact ? "h-5 text-[10px]" : "h-8 text-xs")} disabled={isLocked} />
          </div>
        </div>
      </td>
      {!isSupplier && (
        <td className={cn("px-1", isCompact ? "py-0" : "py-2")}>
          <div className="flex flex-col gap-0.5">
            {item.vendor_name && (
              <span className={cn("truncate font-medium text-amber-600", isCompact ? "text-[8px]" : "text-[10px]")}>
                V: {item.vendor_name}
              </span>
            )}
            {item.assigned_user_name && (
              <span className={cn("flex items-center gap-1 font-medium text-blue-600", isCompact ? "text-[8px]" : "text-[10px]")}>
                <span className="truncate">U: {item.assigned_user_name}</span>
                {item.user_task_status === 'completed' && (
                  <Badge className="bg-green-100 text-green-700 hover:bg-green-200 border-none px-1 h-3.5 text-[7px] font-black tracking-tighter shadow-none">
                    DONE
                  </Badge>
                )}
              </span>
            )}
            {!item.vendor_name && !item.assigned_user_name && (
              <span className={cn("truncate font-medium text-slate-400", isCompact ? "text-[8px]" : "text-[10px]")}>
                -
              </span>
            )}
          </div>
        </td>
      )}
      {/* Pre-work Photos Column */}
      <td className={cn("px-1 text-center", isCompact ? "py-0" : "py-2")}>
        <PhotoColumn
          item={item}
          idx={idx}
          displayIdx={displayIdx}
          category="pre"
          images={item.preImages || []}
          isLocked={isLocked}
          isCompact={isCompact}
          handleRowImageUpload={handleRowImageUpload}
          removeRowImage={removeRowImage}
          renameRowImage={renameRowImage}
          setPreviewImage={setPreviewImage}
          setSketchTarget={setSketchTarget}
          setSketchInitialData={setSketchInitialData}
          lastSketchItemIdxRef={lastSketchItemIdxRef}
          setSketchDialogOpen={setSketchDialogOpen}
          onImageDragStart={onImageDragStart}
          onImageDrop={onImageDrop}
        />
      </td>
      {/* Post-work Photos Column */}
      <td className={cn("px-1 text-center border-l", isCompact ? "py-0" : "py-2")}>
        <PhotoColumn
          item={item}
          idx={idx}
          displayIdx={displayIdx}
          category="post"
          images={item.postImages || []}
          isLocked={isLocked}
          isCompact={isCompact}
          handleRowImageUpload={handleRowImageUpload}
          removeRowImage={removeRowImage}
          renameRowImage={renameRowImage}
          setPreviewImage={setPreviewImage}
          setSketchTarget={setSketchTarget}
          setSketchInitialData={setSketchInitialData}
          lastSketchItemIdxRef={lastSketchItemIdxRef}
          setSketchDialogOpen={setSketchDialogOpen}
          onImageDragStart={onImageDragStart}
          onImageDrop={onImageDrop}
        />
      </td>
      <td className={cn("px-1 text-center border-l", isCompact ? "py-0" : "py-2")}>
        <div className="flex items-center justify-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => cloneItem(idx)} className={cn("text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors border border-transparent hover:border-indigo-200", isCompact ? "h-5 w-5" : "h-6 w-6")} disabled={isLocked} title="Clone Row">
            <Copy className={isCompact ? "w-3 h-3" : "w-3.5 h-3.5"} />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => removeItem(idx)} className={cn("text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors border border-transparent hover:border-red-200", isCompact ? "h-5 w-5" : "h-6 w-6")} disabled={isLocked} title="Remove Item">
            <Trash2 className={isCompact ? "w-3 h-3" : "w-3.5 h-3.5"} />
          </Button>
        </div>
      </td>
    </Reorder.Item>
  );
});

export default function CreateSketchPlan() {
  const { id: paramId } = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [currentId, setCurrentId] = useState<string | null>(paramId || null);
  const isEditing = !!currentId;

  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState<string>("none");
  const [projectName, setProjectName] = useState<string>("");
  const [locationStr, setLocationStr] = useState("");
  const [planDate, setPlanDate] = useState(new Date().toISOString().split("T")[0]);
  const [items, setItems] = useState<PlanItem[]>([
    { id: "1", item_name: "", description: "", length: "", width: "", height: "", qty: "1", unit: "Nos", dimension_unit: "feet", category: "", remarks: "", preImages: [], postImages: [], images: [] }
  ]);

  const [projects, setProjects] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [planImages, setPlanImages] = useState<PlanImage[]>([]);
  const [attachments, setAttachments] = useState<PlanAttachment[]>([]);
  
  // Delta tracking for faster saves
  const [deletedItemIds, setDeletedItemIds] = useState<string[]>([]);
  const [deletedImageIds, setDeletedImageIds] = useState<string[]>([]);
  const [deletedAttachmentIds, setDeletedAttachmentIds] = useState<string[]>([]);
  
  const [sketchTarget, setSketchTarget] = useState<string>("main"); // "main" or row id/index
  const [openPopoverIdx, setOpenPopoverIdx] = useState<number | null>(null);

  // PDF / Export State
  const [isPdfDialogOpen, setIsPdfDialogOpen] = useState(false);
  const [includePlanPhotosInExport, setIncludePlanPhotosInExport] = useState(true);
  const [includeSubNotesInExport, setIncludeSubNotesInExport] = useState(true);
  const [selectedPdfCols, setSelectedPdfCols] = useState<string[]>(["#", "Item", "Notes", "L", "W", "H", "Qty", "Unit", "Pre Photos", "Post Photos"]
  );
  const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [categoryOrder, setCategoryOrder] = useState<string[]>([]);

  useEffect(() => {
    // Automatically add new categories to the end of categoryOrder
    const currentCats = Array.from(new Set(items.map(it => it.category).filter(Boolean))) as string[];
    const newCats = currentCats.filter(cat => !categoryOrder.includes(cat));
    if (newCats.length > 0) {
      setCategoryOrder(prev => [...prev, ...newCats]);
    }
  }, [items, categoryOrder]);

  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [isCompact, setIsCompact] = useState(false);
  const [sortBy, setSortBy] = useState<string>("none");

  const [materialSearch, setMaterialSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [vendors, setVendors] = useState<any[]>([]);
  const [assigningLoading, setAssigningLoading] = useState(false);
  const [loadingToProposal, setLoadingToProposal] = useState(false);
  const [vendorSearchTerm, setVendorSearchTerm] = useState("");
  const [usersList, setUsersList] = useState<any[]>([]);
  const [showAssignUserDialog, setShowAssignUserDialog] = useState(false);
  const [userSearchTerm, setUserSearchTerm] = useState("");
  const [categories, setCategories] = useState<any[]>([]);
  const [showAssignCategoryDialog, setShowAssignCategoryDialog] = useState(false);
  const [categorySearchTerm, setCategorySearchTerm] = useState("");
  const [rowToConfirm, setRowToConfirm] = useState<{ idx: number, material: any } | null>(null);
  const [showCategoryConfirm, setShowCategoryConfirm] = useState(false);

  // New state
  const [projectOpen, setProjectOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string, name: string } | null>(null);
  const [sketchInitialData, setSketchInitialData] = useState<string | undefined>(undefined);
  const lastSketchItemIdxRef = useRef<number | null>(null); // To track which image we are "continously" auto-saving

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, categoryFilter]);
  const lastSketchPlanImgIdxRef = useRef<number | null>(null);
  const [sketchDialogOpen, setSketchDialogOpen] = useState(false);
  const lastSavedRef = useRef<string>("");
  const isSavingRef = useRef<boolean>(false);
  const [initialLoading, setInitialLoading] = useState(!!paramId);

  // Lock & Approval State
  const [isLocked, setIsLocked] = useState(false);
  const [requestStatus, setRequestStatus] = useState<string>("none");
  const [requestReason, setRequestReason] = useState("");
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [unlockReason, setUnlockReason] = useState("");
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const { user } = useAuth();
  const userRole = user?.role || "user";
  const isSupplier = userRole === "supplier";
  const isAdmin = userRole === "admin";

  // Versioning State
  const [siblingVersions, setSiblingVersions] = useState<any[]>([]);
  const [currentVersionNumber, setCurrentVersionNumber] = useState<number>(1);
  const [showNewVersionDialog, setShowNewVersionDialog] = useState(false);
  const [creatingVersion, setCreatingVersion] = useState(false);

  // Duplicate Check State
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<any[][]>([]);
  const [selectedDuplicateIndices, setSelectedDuplicateIndices] = useState<Set<number>>(new Set());


  // Memoized Sketch Editor Handlers
  const handleSketchAutoSave = useCallback((dataUrl: string) => {
    const fileName = `Sketch_Auto_${new Date().getTime()}`;
    if (sketchTarget === "main") {
      setPlanImages(prev => {
        const next = [...prev];
        if (lastSketchPlanImgIdxRef.current !== null && next[lastSketchPlanImgIdxRef.current]) {
          next[lastSketchPlanImgIdxRef.current] = { ...next[lastSketchPlanImgIdxRef.current], url: dataUrl };
          return next;
        } else {
          lastSketchPlanImgIdxRef.current = next.length;
          return [...prev, { url: dataUrl, name: fileName }];
        }
      });
    } else {
      const isPre = sketchTarget.startsWith("pre-");
      const isPost = sketchTarget.startsWith("post-");
      const idx = parseInt(sketchTarget.replace(/^(pre-|post-)/, ""));

      if (!isNaN(idx) && idx >= 0 && idx < items.length) {
        setItems(prev => {
          const next = [...prev];
          const imgField = isPost ? "postImages" : "preImages";
          const rowImages = [...(next[idx][imgField] || [])];

          if (lastSketchItemIdxRef.current !== null && rowImages[lastSketchItemIdxRef.current]) {
            rowImages[lastSketchItemIdxRef.current] = { ...rowImages[lastSketchItemIdxRef.current], url: dataUrl };
          } else {
            lastSketchItemIdxRef.current = rowImages.length;
            rowImages.push({ url: dataUrl, name: fileName });
          }
          next[idx][imgField] = rowImages;
          return next;
        });
      }
    }
  }, [sketchTarget, items.length]);

  const handleSketchSave = useCallback((dataUrl: string) => {
    const fileName = `Sketch_${new Date().getTime()}`;
    if (sketchTarget === "main") {
      setPlanImages(prev => {
        const next = [...prev];
        if (lastSketchPlanImgIdxRef.current !== null && next[lastSketchPlanImgIdxRef.current]) {
          next[lastSketchPlanImgIdxRef.current] = { ...next[lastSketchPlanImgIdxRef.current], url: dataUrl, name: fileName };
          return next;
        }
        return [...prev, { url: dataUrl, name: fileName }];
      });
      toast({ title: "Sketch Saved", description: "Added to Plan-level Photos" });
    } else {
      const isPre = sketchTarget.startsWith("pre-");
      const isPost = sketchTarget.startsWith("post-");
      const idx = parseInt(sketchTarget.replace(/^(pre-|post-)/, ""));

      if (!isNaN(idx) && idx >= 0 && idx < items.length) {
        setItems(prev => {
          const next = [...prev];
          const imgField = isPost ? "postImages" : "preImages";
          const rowImages = [...(next[idx][imgField] || [])];

          if (lastSketchItemIdxRef.current !== null && rowImages[lastSketchItemIdxRef.current]) {
            rowImages[lastSketchItemIdxRef.current] = { ...rowImages[lastSketchItemIdxRef.current], url: dataUrl, name: fileName };
          } else {
            rowImages.push({ url: dataUrl, name: fileName });
          }
          next[idx][imgField] = rowImages;
          return next;
        });
        toast({ title: "Sketch Saved", description: `Attached to Row ${idx + 1} (${isPost ? "Post" : "Pre"})` });
      }
    }
    lastSketchItemIdxRef.current = null;
    lastSketchPlanImgIdxRef.current = null;
    setSketchInitialData(undefined);
    setSketchDialogOpen(false);
  }, [sketchTarget, items.length, toast]);

  const toggleSelectItem = (id: string) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedItemIds.size === items.length) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(items.map(item => item.id)));
    }
  };

  const loadVendors = async () => {
    try {
      setVendorSearchTerm(""); // Reset search when loading
      const res = await apiFetch("/api/shops");
      if (res.ok) {
        const data = await res.json();
        setVendors(data.shops || []);
      }
    } catch (e) {
      console.error("Failed to load vendors", e);
    }
  };

  const loadUsers = async () => {
    try {
      setUserSearchTerm("");
      const res = await apiFetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        setUsersList(data.users || []);
      }
    } catch (e) {
      console.error("Failed to load users", e);
    }
  };

  const handleAssignToUser = async (userId: string) => {
    if (selectedItemIds.size === 0) return;

    setAssigningLoading(true);
    try {
      const userObj = usersList.find(u => u.id === userId);
      const userName = userObj ? (userObj.fullName || userObj.username) : "User";

      const updatedItems = items.map(item => {
        if (selectedItemIds.has(item.id)) {
          return { ...item, assigned_user_id: String(userId), assigned_user_name: userName, user_task_status: 'pending' };
        }
        return item;
      });

      setItems(updatedItems);
      toast({ title: "Success", description: `Assigned ${selectedItemIds.size} items to ${userName}` });
      setSelectedItemIds(new Set());
      setShowAssignUserDialog(false);
    } catch (err) {
      toast({ title: "Error", description: "Failed to assign items to user", variant: "destructive" });
    } finally {
      setAssigningLoading(false);
    }
  };

  const handleAssignToVendor = async (shopId: string) => {
    if (selectedItemIds.size === 0) return;

    setAssigningLoading(true);
    try {
      const shopName = vendors.find(v => v.id === shopId)?.name || "Vendor";
      const updatedItems = items.map(item => {
        if (selectedItemIds.has(item.id)) {
          return { ...item, assigned_vendor_id: String(shopId), vendor_name: shopName };
        }
        return item;
      });

      setItems(updatedItems);
      toast({ title: "Success", description: `Assigned ${selectedItemIds.size} items to ${shopName}` });
      setSelectedItemIds(new Set());
      setShowAssignDialog(false);
    } catch (err) {
      toast({ title: "Error", description: "Failed to assign items", variant: "destructive" });
    } finally {
      setAssigningLoading(false);
    }
  };

  const handleAssignToCategory = async (catName: string) => {
    if (selectedItemIds.size === 0) return;

    setAssigningLoading(true);
    try {
      const updatedItems = items.map(item => {
        if (selectedItemIds.has(item.id)) {
          return { ...item, category: catName };
        }
        return item;
      });

      setItems(updatedItems);
      toast({ title: "Success", description: `Assigned category "${catName}" to ${selectedItemIds.size} items` });
      setSelectedItemIds(new Set());
      setShowAssignCategoryDialog(false);
    } catch (err) {
      toast({ title: "Error", description: "Failed to assign category", variant: "destructive" });
    } finally {
      setAssigningLoading(false);
    }
  };

  const handleLoadToProposal = async () => {
    if (!currentId) return;
    setLoadingToProposal(true);
    try {
      const res = await apiFetch(`/api/sketch-plans/${currentId}/load-to-proposal`, {
        method: "POST"
      });
      if (res.ok) {
        const data = await res.json();
        toast({ title: "Success", description: "Items loaded to proposal successfully" });

        // Proper internal redirect
        const targetUrl = `/proposal/${data.projectId}?versionId=${data.versionId}`;
        setTimeout(() => {
          setLocation(targetUrl);
        }, 500);
      } else {
        const error = await res.json().catch(() => ({ message: "Failed to load to proposal" }));
        toast({ title: "Error", description: error.message || "Failed to load to proposal", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error", description: "Something went wrong", variant: "destructive" });
    } finally {
      setLoadingToProposal(false);
    }
  };

  const handleSort = useCallback((criteria: string) => {
    setSortBy(criteria);
    if (criteria === "none") return;

    setItems(prevItems => {
      const sorted = [...prevItems].sort((a, b) => {
        switch (criteria) {
          case "name-asc":
            return (a.item_name || "").trim().localeCompare((b.item_name || "").trim());
          case "name-desc":
            return (b.item_name || "").trim().localeCompare((a.item_name || "").trim());
          case "qty-asc":
            return (Number(a.qty) || 0) - (Number(b.qty) || 0);
          case "qty-desc":
            return (Number(b.qty) || 0) - (Number(a.qty) || 0);
          case "category-asc":
            return (a.category || "").trim().localeCompare((b.category || "").trim());
          case "category-desc":
            return (b.category || "").trim().localeCompare((a.category || "").trim());
          case "notes-asc":
            return (a.description || "").trim().localeCompare((b.description || "").trim());
          case "notes-desc":
            return (b.description || "").trim().localeCompare((a.description || "").trim());
          case "vendor-asc":
            return (a.vendor_name || "").localeCompare(b.vendor_name || "");
          case "vendor-desc":
            return (b.vendor_name || "").localeCompare(a.vendor_name || "");
          default:
            return 0;
        }
      });
      return sorted;
    });
  }, []);

  // Load initial data - Progressive population
  useEffect(() => {
    let isMounted = true;

    const loadCategories = async () => {
      try {
        const res = await apiFetch("/api/categories");
        if (res.ok && isMounted) {
          const catData = await res.json();
          setCategories(catData.categories || []);
        }
      } catch (e) { console.error("Categories fetch failed", e); }
    };

    const loadProjectsMetadata = async () => {
      if (isSupplier) return;
      try {
        const res = await apiFetch("/api/boq-projects/metadata");
        if (res.ok && isMounted) {
          const data = await res.json();
          setProjects(data.projects || []);
        }
      } catch (e) { console.error("Projects fetch failed", e); }
    };

    const loadPlanDetails = async () => {
      if (!paramId) {
        const templateDataStr = sessionStorage.getItem("sketch_template_data");
        if (templateDataStr && isMounted) {
          try {
            const td = JSON.parse(templateDataStr);
            if (td.items) setItems(td.items.map((it: any) => ({ ...it, id: `ski-${Date.now()}-${Math.random()}`, preImages: it.preImages || [], postImages: it.postImages || [], images: [] })));
            if (td.location) setLocationStr(td.location);
            sessionStorage.removeItem("sketch_template_data");
            toast({ title: "Template Applied", description: "Form pre-filled from template" });
          } catch (e) { console.error("Template parse failed", e); }
        }
        if (isMounted) setInitialLoading(false);
        return;
      }

      try {
        const res = await apiFetch(`/api/sketch-plans/${paramId}`);
        if (res.ok && isMounted) {
          const data = await res.json();
          const p = data.plan;
          setName(p.name || "");
          setProjectId(p.project_id || "none");
          setProjectName(p.project_name || "");
          setLocationStr(p.location || "");
          if (data.plan && data.plan.category_order) {
            setCategoryOrder(Array.isArray(data.plan.category_order) ? data.plan.category_order : []);
          } else {
            // Fallback: derive from items if not stored
            const cats = Array.from(new Set(data.items.map((it: any) => it.category).filter(Boolean))) as string[];
            setCategoryOrder(cats.sort());
          }

          if (p.plan_date) setPlanDate(new Date(p.plan_date).toISOString().split("T")[0]);

          setIsLocked(!!p.is_locked);
          setRequestStatus(p.request_status || "none");
          setRequestReason(p.request_reason || "");

          const imagesByItemId = new Map<string, any[]>();
          if (data.images && Array.isArray(data.images)) {
            data.images.forEach((img: any) => {
              if (img.item_id) {
                if (!imagesByItemId.has(img.item_id)) imagesByItemId.set(img.item_id, []);
                imagesByItemId.get(img.item_id)?.push(img);
              }
            });
          }

          const seenIds = new Set();
          const mappedItems = (data.items || [])
            .filter((it: any) => it.id && !seenIds.has(it.id) && seenIds.add(it.id))
            .map((it: any) => {
              const itemImages = imagesByItemId.get(it.id) || [];
              const preImages: PlanImage[] = [];
              const postImages: PlanImage[] = [];
              itemImages.forEach((img: any) => {
                const cleanedName = (img.image_name || img.name || "").replace(/^(PRE_|POST_)/, "");
                const mappedImg = { id: img.id, url: appendAuthToken(img.image_url), name: cleanedName || `Photo ${img.id.split('-').pop()}` };
                if ((img.image_name || img.name || "").startsWith("POST_")) postImages.push(mappedImg);
                else preImages.push(mappedImg);
              });
              return { ...it, preImages, postImages, images: [] };
            });

          setItems(mappedItems.length > 0 ? mappedItems : [{ id: `ski-${Date.now()}`, item_name: "", description: "", length: "", width: "", height: "", qty: "1", unit: "Nos", dimension_unit: "feet", category: "", remarks: "", preImages: [], postImages: [], images: [] }]);

          const plImages = (data.images || [])
            .filter((img: any) => !img.item_id)
            .map((img: any) => ({ id: img.id, url: appendAuthToken(img.image_url), name: img.image_name || img.name || `Site Photo ${img.id.split('-').pop()}` }));
          setPlanImages(plImages);

          if (data.attachments && Array.isArray(data.attachments)) {
            setAttachments(data.attachments.map((att: any) => ({ id: att.id, url: appendAuthToken(att.file_url), name: att.file_name, type: att.file_type as any })));
          }

          lastSavedRef.current = JSON.stringify({
            name: p.name || "",
            project_id: p.project_id || "none",
            location: p.location || "",
            plan_date: p.plan_date ? new Date(p.plan_date).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
            items: mappedItems,
            images: plImages.map((img: any) => ({ item_id: null, image_url: img.url, name: img.name })),
            attachments: data.attachments || []
          });
        }
      } catch (err) {
        console.error("Failed to load plan details", err);
      } finally {
        if (isMounted) setInitialLoading(false);
      }
    };

    loadCategories();
    loadProjectsMetadata();
    loadPlanDetails();

    return () => { isMounted = false; };
  }, [paramId]);
  // Only run when URL parameter changes

  // Load sibling versions for this plan
  const loadSiblingVersions = useCallback(async (p: any) => {
    try {
      const rootId = p.parent_plan_id || p.id;
      if (!rootId) return;

      const res = await apiFetch(`/api/sketch-plans?parent_id=${rootId}`);
      if (!res.ok) return;
      const data = await res.json();
      const siblings = (data.plans || []).sort((a: any, b: any) => (a.version_number || 1) - (b.version_number || 1));

      setSiblingVersions(siblings.length > 0 ? siblings : [p]);
      setCurrentVersionNumber(p.version_number || 1);
    } catch (e) {
      console.error("loadSiblingVersions error", e);
    }
  }, []);

  useEffect(() => {
    // This is now partially handled in loadInitialData for the initial load,
    // but we keep this for when currentId changes (e.g. after save)
    const currentPlan = siblingVersions.find(v => v.id === currentId);
    if (currentId && !currentPlan) {
      // If we don't have the plan object, we can't easily find siblings without rootId
      // In that case, we might need to fetch the plan details first, but usually 
      // loadInitialData handles this.
    }
  }, [currentId, siblingVersions]);

  const handleCreateNewVersion = async (copyItems: boolean) => {
    if (!currentId) return;
    setCreatingVersion(true);
    try {
      const res = await apiFetch(`/api/sketch-plans/${currentId}/new-version`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ copyItems })
      });
      if (res.ok) {
        const data = await res.json();
        toast({ title: "Version Created", description: `Version ${data.version_number} created. Opening...` });
        setShowNewVersionDialog(false);
        setLocation(`/edit-sketch-plan/${data.id}`);
      } else {
        toast({ title: "Error", description: "Failed to create version", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Error", description: "Failed to create version", variant: "destructive" });
    } finally {
      setCreatingVersion(false);
    }
  };

  // Fetch materials from API
  const loadMaterials = useCallback(async (q: string = "") => {
    setSearching(true);
    try {
      const url = q.trim().length >= 2
        ? `/api/materials/search?q=${encodeURIComponent(q.trim())}`
        : `/api/materials/search`;
      const res = await apiFetch(url);
      if (res.ok) {
        const data = await res.json();
        console.log("[SketchPlan] loadMaterials got", data.materials?.length, "results");
        setSearchResults(data.materials || []);
      } else {
        const text = await res.text();
        console.error("[SketchPlan] loadMaterials API error", res.status, text);
        setSearchResults([]);
      }
    } catch (err) {
      console.error("Material search error", err);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  // Re-run search when user types (debounced)
  useEffect(() => {
    const q = materialSearch.trim();
    if (openPopoverIdx === null) return; // only search when panel is open
    const timer = setTimeout(() => loadMaterials(q), q.length >= 2 ? 300 : 0);
    return () => clearTimeout(timer);
  }, [materialSearch, openPopoverIdx, loadMaterials]);

  const addItem = useCallback(() => {
    // Clear filters to ensure the new item is visible
    setSearchTerm("");
    setCategoryFilter("all");
    setSortBy("none");

    setItems(prev => [
      ...prev,
      { id: `ski-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, item_name: "", description: "", length: "", width: "", height: "", qty: "1", unit: "Nos", dimension_unit: "feet", remarks: "", preImages: [], postImages: [], images: [] }
    ]);
  }, []);

  const removeItem = useCallback((idx: number) => {
    setItems(prev => {
      if (prev.length === 1) return prev;
      const itemToRemove = prev[idx];
      if (itemToRemove && itemToRemove.id) {
        setDeletedItemIds(d => [...d, itemToRemove.id]);
      }
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    });
    setSortBy("none");
  }, []);

  const cloneItem = useCallback((idx: number) => {
    setItems(prev => {
      const itemToClone = prev[idx];
      const clonedItem: PlanItem = {
        ...JSON.parse(JSON.stringify(itemToClone)),
        id: `ski-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        // Reset image IDs for the clone so they are treated as new uploads if saved
        preImages: (itemToClone.preImages || []).map(img => ({ ...img, id: undefined })),
        postImages: (itemToClone.postImages || []).map(img => ({ ...img, id: undefined }))
      };

      const next = [...prev];
      next.splice(idx + 1, 0, clonedItem);
      return next;
    });
    setSortBy("none");
    toast({ title: "Row Cloned", description: `Successfully duplicated item` });
  }, [toast]);

  const moveItemToPosition = useCallback((fromIdx: number, toIdx: number) => {
    setItems(prev => {
      if (fromIdx === toIdx || prev.length <= 1) return prev;
      const next = [...prev];
      const item = next.splice(fromIdx, 1)[0];
      next.splice(toIdx, 0, item);
      return next;
    });
    setSortBy("none");
  }, []);

  const addDimension = useCallback((itemIdx: number) => {
    setItems((prevItems) => {
      const newItems = [...prevItems];
      const item = { ...newItems[itemIdx] };
      const dims = item.dimensions?.length ? [...item.dimensions] : [{ id: "def", length: item.length, width: item.width, height: item.height, note: item.description }];
      dims.push({ id: `dim-${Date.now()}`, length: "", width: "", height: "", note: "" });
      item.dimensions = dims;
      newItems[itemIdx] = item;
      return newItems;
    });
  }, []);

  const removeDimension = useCallback((itemIdx: number, dimIdx: number) => {
    setItems((prevItems) => {
      const newItems = [...prevItems];
      const item = { ...newItems[itemIdx] };
      if (!item.dimensions || item.dimensions.length <= 1) return prevItems;
      const dims = [...item.dimensions];
      dims.splice(dimIdx, 1);
      item.dimensions = dims;

      if (item.dimension_unit === "ls") {
        item.qty = "1";
      } else {
        let totalQty = 0;
        dims.forEach(d => {
          const l = parseFloat(d.length) || 0;
          const w = parseFloat(d.width) || 0;
          const h = parseFloat(d.height) || 0;
          if (l > 0 || w > 0 || h > 0) {
            const p = [l, w, h].filter(v => v > 0);
            totalQty += p.reduce((acc, v) => acc * v, 1);
          }
        });
        item.qty = item.dimension_unit === "mm" ? Math.round(totalQty).toString() : totalQty.toFixed(2);
      }

      item.length = dims[0].length;
      item.width = dims[0].width;
      item.height = dims[0].height;

      newItems[itemIdx] = item;
      return newItems;
    });
  }, []);

  const updateDimension = useCallback((itemIdx: number, dimIdx: number, field: "length" | "width" | "height", value: string) => {
    setItems((prevItems) => {
      const newItems = [...prevItems];
      const item = { ...newItems[itemIdx] };
      const dims = item.dimensions?.length ? [...item.dimensions] : [{ id: "def", length: item.length, width: item.width, height: item.height, note: item.description }];

      dims[dimIdx] = { ...dims[dimIdx], [field]: value };
      item.dimensions = dims;

      if (item.dimension_unit === "ls") {
        item.qty = "1";
      } else {
        let totalQty = 0;
        dims.forEach(d => {
          const l = parseFloat(d.length) || 0;
          const w = parseFloat(d.width) || 0;
          const h = parseFloat(d.height) || 0;
          if (l > 0 || w > 0 || h > 0) {
            const p = [l, w, h].filter(v => v > 0);
            totalQty += p.reduce((acc, v) => acc * v, 1);
          }
        });

        if (totalQty > 0) {
          item.qty = item.dimension_unit === "mm" ? Math.round(totalQty).toString() : totalQty.toFixed(2);
        } else {
          item.qty = "0";
        }
      }

      if (dimIdx === 0) {
        item.length = dims[0].length;
        item.width = dims[0].width;
        item.height = dims[0].height;
      }

      newItems[itemIdx] = item;
      return newItems;
    });
  }, []);

  const updateItem = useCallback((idx: number, field: keyof PlanItem, value: any) => {
    setItems(prev => {
      const next = [...prev];
      if (!next[idx]) return prev;
      next[idx] = { ...next[idx], [field]: value };

      // If unit is LS, force quantity to 1
      if (next[idx].dimension_unit === "ls") {
        next[idx].qty = "1";
      } else if (["length", "width", "height", "dimension_unit"].includes(field as string)) {
        // Auto-calculate quantity if dimensions or unit change
        if (field === "dimension_unit") {
          const dims = next[idx].dimensions?.length ? next[idx].dimensions : [{ id: "def", length: next[idx].length, width: next[idx].width, height: next[idx].height, note: next[idx].description }];
          let totalQty = 0;
          dims.forEach((d: any) => {
            const l = parseFloat(d.length) || 0;
            const w = parseFloat(d.width) || 0;
            const h = parseFloat(d.height) || 0;
            if (l > 0 || w > 0 || h > 0) {
              const p = [l, w, h].filter(v => v > 0);
              totalQty += p.reduce((acc, v) => acc * v, 1);
            }
          });
          if (totalQty > 0) {
            next[idx].qty = value === "mm" ? Math.round(totalQty).toString() : totalQty.toFixed(2);
          } else if (value === "mm") {
            const currentQty = parseFloat(next[idx].qty) || 0;
            next[idx].qty = Math.round(currentQty).toString();
          }
        } else {
          const l = parseFloat(next[idx].length) || 0;
          const w = parseFloat(next[idx].width) || 0;
          const h = parseFloat(next[idx].height) || 0;
          if (l > 0 || w > 0 || h > 0) {
            const dimsArr = [l, w, h].filter(v => v > 0);
            const autoQty = dimsArr.reduce((acc, v) => acc * v, 1);
            next[idx].qty = next[idx].dimension_unit === "mm"
              ? Math.round(autoQty).toString()
              : autoQty.toFixed(2);
          } else if (next[idx].dimension_unit === "mm") {
            const currentQty = parseFloat(next[idx].qty) || 0;
            next[idx].qty = Math.round(currentQty).toString();
          }
        }
      }
      return next;
    });
    setSortBy("none");
  }, []);

  const handlePlanImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const reader = new FileReader();
      const fileName = file.name;
      reader.onloadend = () => {
        setPlanImages(prev => [...prev, { url: reader.result as string, name: fileName }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleAttachmentUpload = (e: React.ChangeEvent<HTMLInputElement>, type: "pdf" | "excel") => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const reader = new FileReader();
      const fileName = file.name;
      reader.onloadend = () => {
        setAttachments(prev => [...prev, { url: reader.result as string, name: fileName, type }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleRowImageUpload = (idx: number, e: React.ChangeEvent<HTMLInputElement>, category: "pre" | "post") => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      const fileName = file.name.split('.').slice(0, -1).join('.') || "Untitled Photo";
      reader.onloadend = () => {
        const newItems = [...items];
        if (category === "pre") {
          newItems[idx].preImages = [...newItems[idx].preImages, { url: reader.result as string, name: fileName }];
        } else {
          newItems[idx].postImages = [...newItems[idx].postImages, { url: reader.result as string, name: fileName }];
        }
        setItems(newItems);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeRowImage = (itemIdx: number, imgIdx: number, category: "pre" | "post") => {
    const newItems = [...items];
    let removedImg;
    if (category === "pre") {
      removedImg = newItems[itemIdx].preImages.splice(imgIdx, 1)[0];
    } else {
      removedImg = newItems[itemIdx].postImages.splice(imgIdx, 1)[0];
    }
    if (removedImg?.id) {
       setDeletedImageIds(prev => [...prev, removedImg.id!]);
    }
    setItems(newItems);
  };

  const renameRowImage = (itemIdx: number, imgIdx: number, category: "pre" | "post") => {
    const currentImages = category === "pre" ? items[itemIdx].preImages : items[itemIdx].postImages;
    const currentName = currentImages[imgIdx].name;
    const newName = prompt("Rename Photo:", currentName);
    if (newName && newName !== currentName) {
      const newItems = [...items];
      if (category === "pre") {
        newItems[itemIdx].preImages[imgIdx] = { ...newItems[itemIdx].preImages[imgIdx], name: newName };
      } else {
        newItems[itemIdx].postImages[imgIdx] = { ...newItems[itemIdx].postImages[imgIdx], name: newName };
      }
      setItems(newItems);
    }
  };

  const renamePlanImage = (idx: number) => {
    const currentName = planImages[idx].name;
    const newName = prompt("Rename Site Photo:", currentName);
    if (newName && newName !== currentName) {
      const next = [...planImages];
      next[idx] = { ...next[idx], name: newName };
      setPlanImages(next);
    }
  };

  const selectMaterial = (idx: number, material: any) => {
    const currentCategory = items[idx].category;
    const materialCategory = material.category;

    if (currentCategory && materialCategory && currentCategory !== materialCategory) {
      setRowToConfirm({ idx, material });
      setShowCategoryConfirm(true);
      return;
    }

    applyMaterialSelection(idx, material);
  };

  const applyMaterialSelection = (idx: number, material: any, updateCategory: boolean = true) => {
    const newItems = [...items];
    newItems[idx].material_id = material.id;
    newItems[idx].item_name = material.name;
    if (updateCategory && material.category) newItems[idx].category = material.category;
    if (material.unit) {
      newItems[idx].unit = material.unit;
      if (material.unit.toLowerCase() === "ls") {
        newItems[idx].dimension_unit = "ls";
        newItems[idx].qty = "1";
      }
    }

    // Automatically load material image into PRE option if available
    if (material.image) {
      const imageUrls = parseImages(material.image);
      if (imageUrls.length > 0) {
        const firstUrl = imageUrls[0];
        const hasImage = (newItems[idx].preImages || []).some(img => img.url === firstUrl);
        if (!hasImage) {
          const materialImage = {
            url: firstUrl,
            name: `Template_${material.name}`
          };
          newItems[idx].preImages = [...(newItems[idx].preImages || []), materialImage];
        }
      }
    }

    setItems(newItems);
    setMaterialSearch("");
    setSearchResults([]);
  };

  const confirmCategoryReplace = () => {
    if (rowToConfirm) {
      applyMaterialSelection(rowToConfirm.idx, rowToConfirm.material, true);
      setRowToConfirm(null);
      setShowCategoryConfirm(false);
    }
  };

  const cancelCategoryReplace = () => {
    // "On cancel → keep existing category and prevent mismatch"
    // This implies we don't apply the material selection because it has a different category.
    setRowToConfirm(null);
    setShowCategoryConfirm(false);
    setOpenPopoverIdx(null); // Close the item picker
    setMaterialSearch("");
    setSearchResults([]);
  };

  const findDuplicatesInCurrentPlan = () => {
    const groups: Record<string, PlanItem[]> = {};
    items.forEach(item => {
      // Create a composite key for comparison
      const dimsStr = JSON.stringify(item.dimensions?.map(d => ({ l: d.length, w: d.width, h: d.height, note: d.note })) || []);
      const key = `${item.item_name || ''}|${item.description || ''}|${item.qty || ''}|${item.unit || ''}|${item.category || ''}|${dimsStr}`;

      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });

    const duplicates = Object.values(groups).filter(group => group.length > 1);
    setDuplicateGroups(duplicates);
    setSelectedDuplicateIndices(new Set(duplicates.map((_, i) => i)));
    setShowDuplicateDialog(true);
  };

  const cleanUpDuplicates = () => {
    // Keep the first item of each duplicate group, delete the rest
    const idsToRemove = new Set<string>();
    duplicateGroups.forEach((group, idx) => {
      if (selectedDuplicateIndices.has(idx)) {
        // Keep group[0], remove from group[1] to end
        for (let i = 1; i < group.length; i++) {
          idsToRemove.add(group[i].id);
        }
      }
    });

    if (idsToRemove.size > 0) {
      const newItems = items.filter(item => !idsToRemove.has(item.id));
      setItems(newItems);
      toast({ title: "Duplicates Cleaned", description: `Removed ${idsToRemove.size} redundant rows. Don't forget to save your changes.` });
      setDuplicateGroups([]);
      setSelectedDuplicateIndices(new Set());
      setShowDuplicateDialog(false);
      if (sortBy !== "none") setSortBy("none");
    } else {
      setShowDuplicateDialog(false);
    }
  };


  const performSave = async () => {
    if (isSavingRef.current || saving) return;

    if (!name.trim()) {
      toast({ title: "Validation Error", description: "Please enter a Plan Name before saving.", variant: "destructive" });
      return;
    }

    isSavingRef.current = true;
    setSaving(true);

    try {
      // Delta-based saving: only send what changed
      let lastSaved: any = {};
      try { lastSaved = JSON.parse(lastSavedRef.current || "{}"); } catch(e) {}

      // Identify modified items
      const modifiedItems = items.map((item, idx) => ({ ...item, sort_order: idx })).filter(item => {
        const original = (lastSaved.items || []).find((it: any) => it.id === item.id);
        if (!original) return true; // New item
        
        // Include sort_order in comparison
        const currentClean = { ...item, images: [] };
        const originalClean = { ...original, images: [] };
        return JSON.stringify(currentClean) !== JSON.stringify(originalClean);
      });

      // Identify modified plan images
      const modifiedPlanImages = planImages.filter(img => {
        const original = (lastSaved.images || []).find((it: any) => it.id === img.id);
        return !original || JSON.stringify(img) !== JSON.stringify(original);
      });

      // Identify modified attachments
      const modifiedAttachments = attachments.filter(att => {
        const original = (lastSaved.attachments || []).find((it: any) => it.id === att.id);
        return !original || JSON.stringify(att) !== JSON.stringify(original);
      });

      const payload = {
        name,
        project_id: projectId === "none" ? null : projectId,
        location: locationStr,
        plan_date: planDate,
        items: modifiedItems.map(it => {
          const flattenedImages = [
            ...(it.preImages || []).map(img => ({ ...img, name: `PRE_${img.name}` })),
            ...(it.postImages || []).map(img => ({ ...img, name: `POST_${img.name}` }))
          ].filter(img => img.url); // Ensure URL exists
          return {
            ...it,
            images: flattenedImages,
            assigned_vendor_id: it.assigned_vendor_id,
            vendor_name: it.vendor_name
          };
        }),
        images: modifiedPlanImages.filter(img => img.url).map((img: any) => ({ ...img, item_id: null, image_url: img.url, name: img.name })),
        attachments: modifiedAttachments.filter(att => att.url).map(att => ({ ...att, file_url: att.url, file_name: att.name, file_type: att.type })),
        deletedItemIds,
        deletedImageIds,
        deletedAttachmentIds,
        category_order: categoryOrder,
        isDelta: true
      };

      const res = await apiFetch(currentId ? `/api/sketch-plans/${currentId}` : "/api/sketch-plans", {
        method: currentId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        if (!currentId && data.id) {
          setCurrentId(data.id);
        }

        // CRITICAL: Sync items with server IDs to prevent duplication on next save
        if (data.items && Array.isArray(data.items)) {
          const imagesByItemId = new Map<string, any[]>();
          if (data.images && Array.isArray(data.images)) {
            data.images.forEach((img: any) => {
              if (img.item_id) {
                if (!imagesByItemId.has(img.item_id)) imagesByItemId.set(img.item_id, []);
                imagesByItemId.get(img.item_id)?.push(img);
              }
            });
          }

          const seenIds = new Set();
          const syncedItems = data.items
            .filter((it: any) => {
              if (!it.id || seenIds.has(it.id)) return false;
              seenIds.add(it.id);
              return true;
            })
            .map((it: any) => {
              const itemImages = imagesByItemId.get(it.id) || [];
              const preImages: PlanImage[] = [];
              const postImages: PlanImage[] = [];
              itemImages.forEach((img: any) => {
                const cleanedName = (img.image_name || img.name || "").replace(/^(PRE_|POST_)/, "");
                const mappedImg = { id: img.id, url: appendAuthToken(img.image_url), name: cleanedName || `Photo ${img.id.split('-').pop()}` };
                if ((img.image_name || img.name || "").startsWith("POST_")) postImages.push(mappedImg);
                else preImages.push(mappedImg);
              });
              return { ...it, preImages, postImages, images: [] };
            });

          if (syncedItems.length > 0) setItems(syncedItems);

          // Update plan images and attachments too
          if (data.images && Array.isArray(data.images)) {
            const plImages = data.images
              .filter((img: any) => !img.item_id)
              .map((img: any) => ({ id: img.id, url: appendAuthToken(img.image_url), name: img.image_name || img.name || `Site Photo ${img.id.split('-').pop()}` }));
            setPlanImages(plImages);
          }
          if (data.attachments && Array.isArray(data.attachments)) {
            setAttachments(data.attachments.map((att: any) => ({ id: att.id, url: appendAuthToken(att.file_url), name: att.file_name, type: att.file_type as any })));
          }

          // Update lastSavedRef to prevent next save from being too large
          lastSavedRef.current = JSON.stringify({
            name,
            project_id: projectId === "none" ? null : projectId,
            location: locationStr,
            plan_date: planDate,
            items: syncedItems,
            images: data.images?.filter((img: any) => !img.item_id),
            attachments: data.attachments || []
          });
        }

        toast({ title: "Success", description: "Plan saved successfully" });

        // Clear delta trackers after successful save
        setDeletedItemIds([]);
        setDeletedImageIds([]);
        setDeletedAttachmentIds([]);
      } else {
        const errorData = await res.json().catch(() => ({ message: "Unknown error" }));
        toast({ title: "Error", description: errorData.message || "Failed to save plan", variant: "destructive" });
      }
    } catch (err) {
      console.error("Save error:", err);
      toast({ title: "Error", description: "Failed to save plan", variant: "destructive" });
    } finally {
      setSaving(false);
      isSavingRef.current = false;
    }
  };

  const savePlan = () => performSave();

  const prepareImageForPdf = (url: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "Anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(url);
          return;
        }
        ctx.drawImage(img, 0, 0);
        try {
          resolve(canvas.toDataURL("image/jpeg", 0.8));
        } catch (e) {
          resolve(url);
        }
      };
      img.onerror = () => {
        resolve(url);
      };
      img.src = url;
    });
  };

  const handleDownloadPdf = async (forEmail: boolean = false): Promise<string | undefined> => {
    try {
      toast({ title: "Preparing PDF", description: "Processing images, please wait..." });

      // Pre-process all images to ensure compatibility (WEBP/large images)
      const processedItems = await Promise.all(filteredItems.map(async (item) => {
        const preImg = item.preImages && item.preImages.length > 0 ? await prepareImageForPdf(item.preImages[0].url) : null;
        const postImg = item.postImages && item.postImages.length > 0 ? await prepareImageForPdf(item.postImages[0].url) : null;
        return { ...item, _pdfPre: preImg, _pdfPost: postImg };
      }));

      const processedPlanImages = await Promise.all(planImages.map(async (img) => {
        return { ...img, url: await prepareImageForPdf(img.url) };
      }));

      const doc = new jsPDF({ orientation: "landscape" });

      const pageWidth = doc.internal.pageSize.getWidth();
      const marginX = 10;
      const headerBoxY = 10;
      const headerBoxH = 25;

      // Header Box
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.5);
      doc.rect(marginX, headerBoxY, pageWidth - 2 * marginX, headerBoxH);

      // logo placeholder or fetch? for now text
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text("CONCEPT TRUNK INTERIORS", marginX + 5, headerBoxY + 12);
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text("SITE SKETCH PLAN REPORT", marginX + 5, headerBoxY + 18);

      // Meta info on right
      doc.setFontSize(8);
      const metaX = pageWidth - marginX - 5;
      doc.text(`Project: ${projects.find(p => p.id === projectId)?.name || "N/A"}`, metaX, headerBoxY + 7, { align: "right" });
      doc.text(`Plan: ${name}`, metaX, headerBoxY + 13, { align: "right" });
      doc.text(`Date: ${planDate}`, metaX, headerBoxY + 19, { align: "right" });

      const getDisplayUnit = (u: string) => {
        const unitMap: any = { feet: "ft", mm: "mm", inch: "in", cm: "cm", meter: "m", sqft: "sqft", sqmt: "sqmt", rft: "rft", rmt: "rmt", nos: "nos", pcs: "pcs", kg: "kg", litre: "ltr", set: "set", ls: "LS" };
        return unitMap[u] || u;
      };

      const headers = selectedPdfCols;
      const body: any[] = [];
      processedItems.forEach((item, idx) => {
        const itemDims = (includeSubNotesInExport && item.dimensions?.length) ? item.dimensions : [{ id: "def", length: item.length, width: item.width, height: item.height, note: item.description }];

        itemDims.forEach((dim: any, dIdx: number) => {
          const row: any[] = [];
          headers.forEach(h => {
            if (h === "#") {
              row.push(dIdx === 0 ? sortedAllItems.findIndex(it => it.id === item.id) + 1 : "");
            } else if (h === "Item") {
              row.push(dIdx === 0 ? item.item_name : "");
            } else if (h === "Notes") {
              const noteText = dIdx === 0 ? item.description : (dim.note || "");
              row.push(dIdx === 0 ? noteText : `     -  ${noteText}`);
            } else if (h === "L") {
              row.push(dim.length || "");
            } else if (h === "W") {
              row.push(dim.width || "");
            } else if (h === "H") {
              row.push(dim.height || "");
            } else if (h === "Qty") {
              // Only show total qty on the first row of the item to avoid confusion
              row.push(dIdx === 0 ? item.qty : "");
            } else if (h === "Unit") {
              row.push(dIdx === 0 ? getDisplayUnit(item.dimension_unit) : "");
            } else if (h === "Pre Photos") {
              row.push("");
            } else if (h === "Post Photos") {
              row.push("");
            }
          });
          body.push(row);
        });
      });

      const prePhotoColIdx = headers.indexOf("Pre Photos");
      const postPhotoColIdx = headers.indexOf("Post Photos");

      autoTable(doc, {
        head: [headers],
        body: body,
        startY: headerBoxY + headerBoxH + 5,
        styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
        headStyles: { fillColor: [40, 40, 40], textColor: [255, 255, 255] },
        columnStyles: {
          // Ensure Notes column doesn't squeeze others too much if it's long
          [headers.indexOf("Notes")]: { cellWidth: 'auto' },
          [prePhotoColIdx]: { cellWidth: 25 },
          [postPhotoColIdx]: { cellWidth: 25 },
        },
        didParseCell: (data: any) => {
          // Check if this is a sub-row (empty S.No cell)
          const sNoIdx = headers.indexOf("#");
          const isSubRow = data.section === 'body' && (sNoIdx !== -1 ? !data.row.raw[sNoIdx] : !data.row.raw[0]);

          if (isSubRow) {
            data.cell.styles.fillColor = [240, 245, 250]; // Slightly stronger blue-ish gray
            data.cell.styles.textColor = [80, 80, 80];
            data.cell.styles.fontStyle = 'italic';
            data.cell.styles.fontSize = 7.5;
          }

          if (data.section === 'body' && (data.column.index === prePhotoColIdx || data.column.index === postPhotoColIdx)) {
            const itemIdx = processedItems.findIndex((it, i) => {
              // Find which item this row belongs to by matching cumulative row count
              let count = 0;
              for (let j = 0; j <= i; j++) {
                count += (processedItems[j].dimensions?.length || 1);
                if (count > data.row.index) return true;
              }
              return false;
            });
            const item = processedItems[itemIdx];
            if (!item) return;
            // Photos should only appear on the first row of an item to save space or be handled specially
            // For now, let's only allow photos on the main row (where # is present)
            const hasSNo = !!data.row.raw[headers.indexOf("#")];
            const pdfImg = hasSNo ? (data.column.index === prePhotoColIdx ? item._pdfPre : item._pdfPost) : null;
            if (pdfImg) {
              data.cell.styles.minCellHeight = 25;
            } else if (!hasSNo) {
              data.cell.text = ""; // Clear text for sub-row photo cells
            }
          }
        },
        didDrawCell: (data: any) => {
          if (data.section === 'body' && (data.column.index === prePhotoColIdx || data.column.index === postPhotoColIdx)) {
            const hasSNo = !!data.row.raw[headers.indexOf("#")];
            if (!hasSNo) return; // Don't draw images on sub-rows

            const itemIdx = processedItems.findIndex((it, i) => {
              let count = 0;
              for (let j = 0; j <= i; j++) {
                count += (processedItems[j].dimensions?.length || 1);
                if (count > data.row.index) return true;
              }
              return false;
            });
            const item = processedItems[itemIdx];
            if (!item) return;
            const pdfImg = data.column.index === prePhotoColIdx ? item._pdfPre : item._pdfPost;
            if (pdfImg) {
              const xPos = data.cell.x + 2;
              try {
                doc.addImage(pdfImg, "JPEG", xPos, data.cell.y + 2, 20, 20);
              } catch (e) {
                console.warn("Failed to add table image to PDF", e);
              }
            }
          }
        }
      });

      // Add plan-level images if space remains
      if (includePlanPhotosInExport && processedPlanImages.length > 0) {
        let finalY = (doc as any).lastAutoTable.finalY + 15;
        if (finalY + 60 > doc.internal.pageSize.getHeight()) {
          doc.addPage();
          finalY = 20;
        }
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text("Plan-Level Photos:", 10, finalY);

        let px = 10;
        let py = finalY + 8;
        const imgSize = 45;
        const spacing = 10;
        const rowHeight = 65; // Image + text + spacing

        processedPlanImages.forEach((img, i) => {
          if (px + imgSize > pageWidth - 10) {
            px = 10;
            py += rowHeight;
          }
          if (py + rowHeight > doc.internal.pageSize.getHeight()) {
            doc.addPage();
            py = 20;
            px = 10;
          }
          try {
            doc.addImage(img.url, "JPEG", px, py, imgSize, imgSize);

            // Photo Name - Smaller font and better placement
            doc.setFontSize(7);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(100);
            const truncatedName = img.name.length > 30 ? img.name.substring(0, 27) + "..." : img.name;
            doc.text(truncatedName, px, py + imgSize + 5);
            doc.setTextColor(0);

            px += imgSize + spacing;
          } catch (e) {
            console.warn("Failed to add plan image to PDF", e);
          }
        });
      }

      if (forEmail) {
        return doc.output("datauristring").split(',')[1];
      } else {
        doc.save(`${name.replace(/\s+/g, '_')}_Report.pdf`);
        toast({ title: "Success", description: "PDF downloaded successfully" });
      }
    } catch (err) {
      console.error("PDF Error", err);
      toast({ title: "Error", description: "Failed to generate PDF", variant: "destructive" });
    }
  };

  const handleDownloadExcel = () => {
    try {
      toast({ title: "Preparing Excel", description: "Generating spreadsheet..." });

      // 1. Prepare Header Info (Metadata)
      const info = [
        ["Project", projects.find(p => p.id === projectId)?.name || "N/A"],
        ["Plan Name", name],
        ["Location", locationStr],
        ["Date", planDate],
        ["Generated", new Date().toLocaleString()],
        [], // Spacing row
      ];

      const getDisplayUnit = (u: string) => {
        const unitMap: any = { feet: "ft", mm: "mm", inch: "in", cm: "cm", meter: "m", sqft: "sqft", sqmt: "sqmt", rft: "rft", rmt: "rmt", nos: "nos", pcs: "pcs", kg: "kg", litre: "ltr", set: "set", ls: "LS" };
        return unitMap[u] || u;
      };

      // 2. Prepare Table Data
      const tableData: any[] = [];
      filteredItems.forEach((item, idx) => {
        const itemDims = (includeSubNotesInExport && item.dimensions?.length) ? item.dimensions : [{ id: "def", length: item.length, width: item.width, height: item.height, note: item.description }];

        itemDims.forEach((dim: any, dIdx: number) => {
          const row: any = {};
          if (selectedPdfCols.includes("#")) row["S.No"] = dIdx === 0 ? sortedAllItems.findIndex(it => it.id === item.id) + 1 : "";
          if (selectedPdfCols.includes("Item")) row["Item Name"] = dIdx === 0 ? item.item_name : "";
          if (selectedPdfCols.includes("Notes")) row["Notes"] = dIdx === 0 ? item.description : (dim.note || "");
          if (selectedPdfCols.includes("L")) row["L"] = dim.length || "";
          if (selectedPdfCols.includes("W")) row["W"] = dim.width || "";
          if (selectedPdfCols.includes("H")) row["H"] = dim.height || "";
          if (selectedPdfCols.includes("Qty")) row["Quantity"] = dIdx === 0 ? item.qty : "";
          if (selectedPdfCols.includes("Unit")) row["Unit"] = dIdx === 0 ? getDisplayUnit(item.dimension_unit) : "";
          tableData.push(row);
        });
      });

      // 3. Create Worksheet
      // Start with an empty sheet
      const ws = XLSX.utils.aoa_to_sheet(info);

      // 4. Add Table Data below the info
      const dataStartRow = info.length;
      XLSX.utils.sheet_add_json(ws, tableData, {
        origin: `A${dataStartRow + 1}`,
        skipHeader: false
      });

      // 5. Basic cell width adjustments (approximation)
      const colWidths = [
        { wch: 8 },  // S.No
        { wch: 25 }, // Item Name
        { wch: 35 }, // Notes
        { wch: 8 },  // L
        { wch: 8 },  // W
        { wch: 8 },  // H
        { wch: 10 }, // Qty
        { wch: 10 }, // Unit
      ];
      ws['!cols'] = colWidths;

      // 6. Finalize and Save
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Site Report");
      XLSX.writeFile(wb, `${name.replace(/\s+/g, '_')}_Report.xlsx`);

      toast({ title: "Success", description: "Excel downloaded successfully" });
    } catch (err) {
      console.error("Excel Error", err);
      toast({ title: "Error", description: "Failed to generate Excel", variant: "destructive" });
    }
  };

  const handleSendEmail = async () => {
    if (!recipientEmail.trim()) {
      toast({ title: "Error", description: "Recipient email is required", variant: "destructive" });
      return;
    }
    setSendingEmail(true);
    try {
      const pdfBase64 = await handleDownloadPdf(true);
      if (!pdfBase64) return;

      const res = await apiFetch("/api/send-sketch-plan-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: recipientEmail,
          planName: name,
          pdfBase64,
          planData: {
            projectName: projects.find(p => p.id === projectId)?.name,
            location: locationStr,
            planDate: planDate,
            items: items.map(it => ({
              item_name: it.item_name,
              description: it.description,
              length: it.length,
              width: it.width,
              height: it.height,
              qty: it.qty,
              unit: it.unit,
              dimension_unit: it.dimension_unit
            }))
          }
        })
      });

      if (res.ok) {
        toast({ title: "Success", description: "Email sent successfully" });
        setIsEmailDialogOpen(false);
      } else {
        throw new Error("Failed to send");
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to send email", variant: "destructive" });
    } finally {
      setSendingEmail(false);
    }
  };

  const handleLockPlan = async () => {
    if (!confirm("Are you sure you want to lock this plan? Once locked, further editing will be disabled until approved by an admin.")) return;
    try {
      const res = await apiFetch(`/api/sketch-plans/${currentId}/lock`, { method: "POST" });
      if (res.ok) {
        toast({ title: "Plan Locked", description: "This plan is now read-only." });
        setIsLocked(true);
      }
    } catch (e) { toast({ title: "Error", description: "Failed to lock plan", variant: "destructive" }); }
  };

  const handleRequestUnlock = async () => {
    if (!unlockReason.trim()) {
      toast({ title: "Error", description: "Please provide a reason for the edit request.", variant: "destructive" });
      return;
    }
    setSubmittingRequest(true);
    try {
      const res = await apiFetch(`/api/sketch-plans/${currentId}/request-unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: unlockReason })
      });
      if (res.ok) {
        toast({ title: "Request Sent", description: "An admin will review your edit request." });
        setRequestStatus("pending");
        setRequestReason(unlockReason);
        setShowUnlockDialog(false);
      }
    } catch (e) { toast({ title: "Error", description: "Failed to send request", variant: "destructive" }); }
    finally { setSubmittingRequest(false); }
  };

  const handleAdminUnlock = async (action: 'approve' | 'reject') => {
    try {
      const res = await apiFetch(`/api/sketch-plans/${currentId}/handle-unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      if (res.ok) {
        toast({ title: `Request ${action}d`, description: action === 'approve' ? "Plan is now editable." : "Request has been rejected." });
        if (action === 'approve') {
          setIsLocked(false);
          setRequestStatus("approved");
        } else {
          setRequestStatus("rejected");
        }
      }
    } catch (e) { toast({ title: "Error", description: "Failed to process request", variant: "destructive" }); }
  };

  const handleDeleteVersion = async () => {
    if (!currentId) return;
    if (!confirm(`Are you sure you want to permanently delete Version ${currentVersionNumber}? This action cannot be undone.`)) return;

    try {
      const res = await apiFetch(`/api/sketch-plans/${currentId}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: "Version Deleted", description: `Version ${currentVersionNumber} has been deleted.` });

        // Find if there are other sibling versions we can redirect to
        const remainingSiblings = siblingVersions.filter(v => v.id !== currentId);
        if (remainingSiblings.length > 0) {
          // Go to the highest version available
          const nextVersion = remainingSiblings[remainingSiblings.length - 1];
          setLocation(`/edit-sketch-plan/${nextVersion.id}`);
        } else {
          // No versions left, go back to main list
          setLocation("/sketch-plans");
        }
      } else {
        toast({ title: "Error", description: "Failed to delete version", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to delete version", variant: "destructive" });
    }
  };

  const handleImageDragStart = (e: React.DragEvent, source: any) => {
    e.dataTransfer.setData("imageSource", JSON.stringify(source));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleImageDrop = (e: React.DragEvent, target: any) => {
    e.preventDefault();
    if (isLocked) return;

    const sourceStr = e.dataTransfer.getData("imageSource");
    if (!sourceStr) return;
    const source = JSON.parse(sourceStr);

    if (source.type === target.type && source.rowIdx === target.rowIdx && source.imgIdx === target.imgIdx) return;

    // Clone current states
    const nextItems = [...items];
    const nextPlanImages = [...planImages];
    let imageSource: PlanImage | undefined;

    // Decide if copy or move
    const isSameSection = source.type === target.type && (source.type === "main" ? true : source.rowIdx === target.rowIdx);
    const isTargetItemSection = target.type === "pre" || target.type === "post";
    // Copy if dragging to pre/post and it's not the same spot
    const shouldCopy = isTargetItemSection && !isSameSection;

    // 1. Identify image and remove from source if moving
    if (source.type === "main") {
      imageSource = nextPlanImages[source.imgIdx];
      if (!shouldCopy) nextPlanImages.splice(source.imgIdx, 1);
    } else {
      const field = source.type === "pre" ? "preImages" : "postImages";
      const row = { ...nextItems[source.rowIdx] };
      const images = [...(row[field] || [])];
      imageSource = images[source.imgIdx];
      if (!shouldCopy) {
        images.splice(source.imgIdx, 1);
        row[field] = images;
        nextItems[source.rowIdx] = row;
      }
    }

    if (!imageSource) return;

    // 2. Add to target (clear ID for copies so they are saved as new records)
    const finalImage = shouldCopy ? { ...imageSource, id: undefined } : imageSource;

    if (target.type === "main") {
      nextPlanImages.push(finalImage);
    } else {
      const field = target.type === "pre" ? "preImages" : "postImages";
      const row = { ...nextItems[target.rowIdx] };
      row[field] = [...(row[field] || []), finalImage];
      nextItems[target.rowIdx] = row;
    }

    // Update states
    setPlanImages(nextPlanImages);
    setItems(nextItems);
    toast({
      title: `Image ${shouldCopy ? "Copied" : "Moved"}`,
      description: `${shouldCopy ? "Copied" : "Moved"} image into ${target.type === "main" ? "Plan Photos" : `Row ${target.rowIdx + 1} (${target.type})`}`
    });
  };

  const sortedAllItems = React.useMemo(() => {
    const baseItems = items.filter(it =>
      (isSupplier ? it.assigned_vendor_id === (user as any)?.shopId : true) &&
      ((it.item_name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (it.description || "").toLowerCase().includes(searchTerm.toLowerCase()))
    );

    if (categoryOrder.length === 0) return baseItems;

    return [...baseItems].sort((a, b) => {
      const indexA = categoryOrder.indexOf(a.category || "");
      const indexB = categoryOrder.indexOf(b.category || "");

      if (indexA !== -1 && indexB !== -1) {
        if (indexA !== indexB) return indexA - indexB;
      } else if (indexA !== -1) {
        return -1;
      } else if (indexB !== -1) {
        return 1;
      }
      // Within same category or both unassigned, use item sort_order
      return (a.sort_order || 0) - (b.sort_order || 0);
    });
  }, [items, searchTerm, categoryOrder, isSupplier, user]);

  const filteredItems = React.useMemo(() => {
    if (categoryFilter === "all") return sortedAllItems;
    return sortedAllItems.filter(it => it.category === categoryFilter);
  }, [sortedAllItems, categoryFilter]);

  const isFiltering = filteredItems.length !== items.length;

  const totalPages = Math.ceil(filteredItems.length / pageSize);
  const paginatedItems = React.useMemo(() => {
    return filteredItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  }, [filteredItems, currentPage, pageSize]);

  const LayoutComponent = isSupplier ? SupplierLayout : Layout;

  return (
    <LayoutComponent {...(isSupplier ? { shopName: "", shopLocation: "", shopApproved: true } : {})}>
      <div className="max-w-7xl mx-auto space-y-2 pb-20">
        {initialLoading ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <div className="relative">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-indigo-600"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-10 w-10 bg-indigo-50 rounded-full animate-pulse"></div>
              </div>
            </div>
            <div className="flex flex-col items-center gap-1">
              <p className="text-indigo-900 font-bold text-lg animate-pulse tracking-tight">Initializing Workspace</p>
              <p className="text-slate-400 text-xs font-medium">Preparing your sketch plan details...</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 flex-wrap">
                <Button variant="ghost" size="icon" onClick={() => setLocation("/sketch-plans")} className="hover:bg-slate-100 h-7 w-7">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                <h1 className="text-lg font-bold tracking-tight text-slate-800">{isSupplier ? "View Sketch Plan" : (isEditing ? "Edit Sketch Plan" : "Create New Sketch Plan")}</h1>

                {/* Version dropdown - only shown when editing */}
                {isEditing && siblingVersions.length > 0 && (
                  <div className="flex items-center gap-2 ml-2">
                    <span className="text-xs text-slate-500 font-bold uppercase">Ver:</span>
                    <Select
                      value={currentId || ''}
                      onValueChange={(val) => val !== currentId && setLocation(`/edit-sketch-plan/${val}`)}
                    >
                      <SelectTrigger className="h-8 w-24 text-xs font-bold border-indigo-200 bg-indigo-50 text-indigo-700">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {siblingVersions.map(v => (
                          <SelectItem key={v.id} value={v.id} className="text-xs font-medium">
                            V{v.version_number || 1} {v.is_locked ? '🔒' : ''} {v.version_status === 'approved' ? '✅' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setIsPdfDialogOpen(true)} className="gap-1.5 h-8 text-[10px] border-indigo-200 text-indigo-600 hover:bg-indigo-50">
                  <FileText className="w-3 h-3" /> Export
                </Button>
                <Button variant="outline" size="sm" onClick={() => setIsEmailDialogOpen(true)} className="gap-1.5 h-8 text-[10px] border-indigo-200 text-indigo-600 hover:bg-indigo-50">
                  <MessageSquare className="w-3 h-3" /> Email Plan
                </Button>
                {userRole !== "supplier" && (
                  <Button variant="outline" size="sm" onClick={() => {
                    const templateName = prompt("Enter a name for this template:", name);
                    if (templateName) {
                      apiFetch("/api/sketch-templates", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name: templateName, template_data: { items, location: locationStr } })
                      }).then(res => res.ok && toast({ title: "Success", description: "Template saved" }));
                    }
                  }} className="gap-1.5 h-8 text-[10px]">
                    <Layers className="w-3 h-3" /> Save as Template
                  </Button>
                )}
                {userRole !== "supplier" && (
                  <Button variant="outline" size="sm" onClick={findDuplicatesInCurrentPlan} className="gap-1.5 h-8 text-[10px] border-amber-200 text-amber-600 hover:bg-amber-50">
                    <Copy className="w-3 h-3" /> Check Duplicates
                  </Button>
                )}

                {userRole !== "supplier" && (
                  <Button onClick={savePlan} disabled={saving || isLocked} className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white h-8 px-4 text-[10px] font-bold shadow-sm">
                    <Save className="w-3 h-3" /> {saving ? "Saving..." : "Save Plan"}
                  </Button>
                )}

                {/* Delete Version Button */}
                {isEditing && userRole !== 'supplier' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-8 w-8 p-0 text-red-500 border-red-200 hover:bg-red-50"
                    onClick={handleDeleteVersion}
                    disabled={saving || isLocked}
                    title="Delete this version"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}

                {/* New Version Button */}
                {isEditing && userRole !== 'supplier' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-8 text-[10px] text-violet-600 border-violet-200 hover:bg-violet-50"
                    onClick={() => setShowNewVersionDialog(true)}
                    title="Create a new version of this plan"
                  >
                    <GitBranch className="w-3 h-3" />
                    New Version
                  </Button>
                )}

                {isEditing && (
                  <div className="flex items-center gap-2 border-l pl-2 ml-1">
                    {isLocked ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 gap-1 py-1 h-9">
                          <Lock className="w-3 h-3" /> LOCKED
                        </Badge>
                        {isAdmin ? (
                          <div className="flex gap-1">
                            {requestStatus === 'pending' && (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button size="sm" variant="outline" className="h-9 gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-100">
                                    <ShieldAlert className="w-3.5 h-3.5" /> Review Request
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-80">
                                  <div className="space-y-4">
                                    <div className="space-y-2">
                                      <h4 className="font-bold leading-none">Edit Request</h4>
                                      <p className="text-sm text-slate-500 italic">"{requestReason}"</p>
                                    </div>
                                    <div className="flex gap-2">
                                      <Button size="sm" className="bg-green-600 hover:bg-green-700 flex-1" onClick={() => handleAdminUnlock('approve')}>Approve</Button>
                                      <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 flex-1" onClick={() => handleAdminUnlock('reject')}>Reject</Button>
                                    </div>
                                  </div>
                                </PopoverContent>
                              </Popover>
                            )}
                            <Button size="sm" variant="outline" onClick={() => handleAdminUnlock('approve')} className="h-9 gap-1.5 border-indigo-200 text-indigo-700">
                              <Unlock className="w-3.5 h-3.5" /> Force Unlock
                            </Button>
                          </div>
                        ) : (
                          requestStatus === 'pending' ? (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 h-9">
                              Request Pending...
                            </Badge>
                          ) : (
                            <Dialog open={showUnlockDialog} onOpenChange={setShowUnlockDialog}>
                              <DialogTrigger asChild>
                                <Button size="sm" variant="outline" className="h-9 gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50">
                                  <Pencil className="w-3.5 h-3.5" /> Request Edit
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Request Edit Permission</DialogTitle>
                                </DialogHeader>
                                <div className="py-4 space-y-4">
                                  <div className="space-y-2">
                                    <Label>Reason for Editing</Label>
                                    <Textarea
                                      placeholder="Explain why you need to modify this locked plan..."
                                      value={unlockReason}
                                      onChange={(e) => setUnlockReason(e.target.value)}
                                    />
                                  </div>
                                </div>
                                <DialogFooter>
                                  <Button variant="outline" onClick={() => setShowUnlockDialog(false)}>Cancel</Button>
                                  <Button className="bg-indigo-600" disabled={submittingRequest} onClick={handleRequestUnlock}>
                                    {submittingRequest ? "Sending..." : "Submit Request"}
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                          )
                        )}
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" onClick={handleLockPlan} className="h-9 gap-1.5 border-slate-200 text-slate-600 hover:text-amber-700 hover:border-amber-300">
                        <Lock className="w-3.5 h-3.5" /> Lock Plan
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className={cn("space-y-4 transition-all duration-300 relative", isLocked && "opacity-[0.9] grayscale-[10%]")}>
              {isLocked && (
                <div className="absolute inset-0 z-40 rounded-xl pointer-events-none" title="Plan is locked" aria-hidden="true" />
              )}

              {/* Basic Details - Compact */}
              <Card className="border-slate-200 shadow-sm relative z-10">
                <CardContent className="p-3 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                  <div className="space-y-1 col-span-1 md:col-span-3">
                    <Label className="text-[10px] uppercase font-bold text-slate-500">Plan Name</Label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={cn("h-8 text-xs", !name.trim() && "border-red-300 bg-red-50 focus:ring-red-500")}
                      placeholder="Enter Plan Name (Required)"
                      disabled={isLocked || userRole === "supplier"}
                    />
                  </div>
                  <div className="space-y-1 col-span-1 md:col-span-3">
                    <Label className="text-[10px] uppercase font-bold text-slate-500">Associated Project</Label>
                    <Popover open={projectOpen} onOpenChange={setProjectOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={projectOpen}
                          className="w-full justify-between h-8 text-xs font-normal px-2"
                          disabled={isLocked || isSupplier}
                        >
                          <span className="truncate">
                            {projectId !== "none"
                              ? (projects.find((proj) => proj.id === projectId)?.name || projectName || "Select project...")
                              : "No Project"}
                          </span>
                          <Search className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[300px] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search project..." />
                          <CommandList>
                            <CommandEmpty>No project found.</CommandEmpty>
                            <CommandGroup>
                              <CommandItem
                                onSelect={() => {
                                  setProjectId("none");
                                  setProjectOpen(false);
                                }}
                              >
                                No Project
                              </CommandItem>
                              {projects.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")).map((project) => (
                                <CommandItem
                                  key={project.id}
                                  onSelect={() => {
                                    setProjectId(project.id);
                                    setProjectOpen(false);
                                  }}
                                >
                                  {project.name}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-1 col-span-1 md:col-span-2">
                    <Label className="text-[10px] uppercase font-bold text-slate-500">Plan Date</Label>
                    <Input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} className="h-8 text-xs" disabled={isLocked || userRole === "supplier"} />
                  </div>
                  <div className="space-y-1 col-span-1 md:col-span-4">
                    <Label className="text-[10px] uppercase font-bold text-slate-500">Site Location / Address</Label>
                    <Input value={locationStr} onChange={(e) => setLocationStr(e.target.value)} className="h-8 text-xs" placeholder="Address" disabled={isLocked || userRole === "supplier"} />
                  </div>
                </CardContent>
              </Card>

              {/* Enhanced Items Section */}
              {/* Project Items - Main Workspace */}
              <div className="sticky top-0 z-20 bg-white shadow-sm border-b border-slate-200 p-4 rounded-lg mb-4 flex flex-col gap-4">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                  <div className="flex items-center gap-2 w-full md:w-auto flex-1">
                    <div className="relative w-full max-w-sm">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search item name or notes..."
                        className="pl-9 h-10 border-slate-200 shadow-sm focus:ring-indigo-500"
                      />
                    </div>
                    <Select value={sortBy} onValueChange={handleSort}>
                      <SelectTrigger className="w-[160px] h-10 bg-white">
                        <div className="flex items-center gap-2">
                          <ArrowDownAz className="w-4 h-4 text-slate-400" />
                          <SelectValue placeholder="Sort Items" />
                        </div>
                      </SelectTrigger>
                      <SelectContent className="z-[110]">
                        <SelectItem value="none">Manual Order</SelectItem>
                        <SelectItem value="name-asc">Item Sort (A-Z)</SelectItem>
                        <SelectItem value="name-desc">Item Sort (Z-A)</SelectItem>
                        <SelectItem value="category-asc">Category Sort (A-Z)</SelectItem>
                        <SelectItem value="category-desc">Category Sort (Z-A)</SelectItem>
                        <SelectItem value="notes-asc">Notes Sort (A-Z)</SelectItem>
                        <SelectItem value="notes-desc">Notes Sort (Z-A)</SelectItem>
                        <SelectItem value="qty-desc">Qty Sort (High to Low)</SelectItem>
                        <SelectItem value="qty-asc">Qty Sort (Low to High)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-3 bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
                    <Label htmlFor="compact-mode" className="text-xs font-bold text-slate-600 cursor-pointer">Compact View</Label>
                    <Checkbox
                      id="compact-mode"
                      checked={isCompact}
                      onCheckedChange={(checked) => setIsCompact(!!checked)}
                    />
                  </div>
                </div>

                {/* Category Tabs - Horizontal Scrolling */}
                <div className="border-t pt-3 relative bg-slate-50/30 px-4 -mx-4">
                  <div className="overflow-x-auto pb-1 custom-scrollbar scroll-smooth">
                    <Tabs value={categoryFilter} onValueChange={setCategoryFilter} className="w-full">
                      <TabsList className="bg-transparent p-0 flex justify-start h-10 flex-nowrap gap-1 w-full overflow-visible">
                        <TabsTrigger value="all" className="text-[10px] font-black px-6 h-9 uppercase tracking-widest rounded-t-lg border-x border-t border-transparent data-[state=active]:border-slate-200 data-[state=active]:bg-white data-[state=active]:text-indigo-600 transition-all shrink-0">
                          All ({items.length})
                        </TabsTrigger>

                        <Reorder.Group
                          axis="x"
                          values={categoryOrder}
                          onReorder={setCategoryOrder}
                          className="flex h-10 gap-1 overflow-visible"
                          as="div"
                        >
                          {categoryOrder.map((cat) => {
                            const count = items.filter(it => it.category === cat).length;
                            if (count === 0 && cat !== categoryFilter) return null;
                            return (
                              <Reorder.Item
                                key={cat}
                                value={cat}
                                className="relative select-none shrink-0"
                              >
                                <TabsTrigger
                                  value={cat}
                                  className="text-[10px] font-black px-6 h-9 uppercase tracking-widest rounded-t-lg border-x border-t border-transparent data-[state=active]:border-slate-200 data-[state=active]:bg-white data-[state=active]:text-indigo-600 transition-all whitespace-nowrap"
                                >
                                  {cat} ({count})
                                </TabsTrigger>
                              </Reorder.Item>
                            );
                          })}
                        </Reorder.Group>
                      </TabsList>
                    </Tabs>
                  </div>
                </div>
              </div>

              <Card className="border-slate-200 shadow-sm overflow-hidden">
                <CardHeader className="bg-slate-50/50 py-3 border-b flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <FileText className="w-4 h-4 text-indigo-500" /> Project Itemized Requirements
                  </CardTitle>
                  <div className="flex gap-2">
                    {userRole === "supplier" && currentId && (
                      <Button
                        onClick={handleLoadToProposal}
                        disabled={loadingToProposal}
                        size="sm"
                        className="h-8 gap-1 bg-green-600 hover:bg-green-700 text-white"
                      >
                        {loadingToProposal ? "Loading..." : "Load to Proposal"}
                      </Button>
                    )}
                    {selectedItemIds.size > 0 && !isSupplier && (
                      <>
                        <Button
                          onClick={() => { setShowAssignCategoryDialog(true); }}
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1 border-indigo-500 text-indigo-600 hover:bg-blue-50"
                        >
                          <Layers className="w-3.5 h-3.5" /> Assign Category ({selectedItemIds.size})
                        </Button>
                        <Button
                          onClick={() => { loadUsers(); setShowAssignUserDialog(true); }}
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1 border-blue-500 text-blue-600 hover:bg-blue-50"
                        >
                          <Users className="w-3.5 h-3.5" /> Assign to User ({selectedItemIds.size})
                        </Button>
                        <Button
                          onClick={() => { loadVendors(); setShowAssignDialog(true); }}
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1 border-amber-500 text-amber-600 hover:bg-amber-50"
                        >
                          Assign to Vendor ({selectedItemIds.size})
                        </Button>
                      </>
                    )}
                    {userRole !== "supplier" && (
                      <Button onClick={addItem} size="sm" variant="outline" className="h-8 gap-1 border-indigo-200 text-indigo-600 hover:bg-indigo-50" disabled={isLocked}>
                        <Plus className="w-3.5 h-3.5" /> Add New Row
                      </Button>
                    )}
                    <Button onClick={() => setLocation("/sketch-plans")} size="sm" variant="ghost" className="h-8 text-slate-500">
                      Cancel
                    </Button>
                  </div>
                </CardHeader>

                {/* Top Navigation Bar */}
                <div className="py-2.5 px-4 border-b bg-slate-50/50 flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-3 gap-1.5 font-bold text-[10px] uppercase tracking-widest border-slate-200 text-slate-600 hover:bg-white shadow-sm"
                      onClick={() => {
                        if (currentPage > 1) {
                          setCurrentPage(prev => prev - 1);
                        } else {
                          const catList = ["all", ...Array.from(new Set(items.map(it => it.category).filter(Boolean) as string[]))].sort();
                          const currentIdx = catList.indexOf(categoryFilter);
                          if (currentIdx > 0) {
                            setCategoryFilter(catList[currentIdx - 1] || "all");
                            setCurrentPage(1);
                          }
                        }
                      }}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" /> Previous
                    </Button>

                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        {totalPages > 1 && Array.from({ length: totalPages }).map((_, i) => (
                          <button
                            key={i}
                            onClick={() => setCurrentPage(i + 1)}
                            className={cn(
                              "w-7 h-7 rounded-full text-[10px] font-bold transition-all",
                              currentPage === i + 1 ? "bg-indigo-600 text-white shadow-md scale-105" : "bg-white text-slate-400 hover:text-indigo-600 border border-slate-100"
                            )}
                          >
                            {i + 1}
                          </button>
                        ))}
                        {totalPages <= 1 && (
                          <Badge variant="outline" className="bg-white text-indigo-900 border-indigo-100 text-[9px] font-bold px-2 py-0.5 uppercase tracking-tighter">
                            Single Page
                          </Badge>
                        )}
                      </div>
                      <div className="h-4 w-px bg-slate-200 mx-1" />
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black text-indigo-900 uppercase tracking-widest leading-none">
                          {categoryFilter === "all" ? "Master View" : categoryFilter}
                        </span>
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                          Page {currentPage} of {totalPages}
                        </span>
                      </div>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-3 gap-1.5 font-bold text-[10px] uppercase tracking-widest border-slate-200 text-slate-600 hover:bg-white shadow-sm"
                      onClick={() => {
                        if (currentPage < totalPages) {
                          setCurrentPage(prev => prev + 1);
                        } else {
                          const catList = ["all", ...Array.from(new Set(items.map(it => it.category).filter(Boolean) as string[]))].sort();
                          const currentIdx = catList.indexOf(categoryFilter);
                          if (currentIdx < catList.length - 1) {
                            setCategoryFilter(catList[currentIdx + 1] || "all");
                            setCurrentPage(1);
                          }
                        }
                      }}
                    >
                      Next <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  <div className="hidden lg:flex items-center gap-1.5">
                    {(["all", ...Array.from(new Set(items.map(it => it.category).filter(Boolean) as string[]))].sort() as string[]).map((cat, idx) => (
                      <TooltipProvider key={cat}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className={cn(
                                "h-1.5 rounded-full transition-all cursor-pointer",
                                categoryFilter === cat ? "w-8 bg-indigo-600" : "w-3 bg-slate-200 hover:bg-slate-300"
                              )}
                              onClick={() => setCategoryFilter(cat)}
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-[10px] font-bold">{cat === "all" ? "All Materials" : cat}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ))}
                  </div>
                </div>

                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 border-b">
                          <th className={cn("w-12 px-2", isCompact ? "py-1" : "py-3")}>
                            {!isSupplier && (
                              <Checkbox
                                checked={selectedItemIds.size === items.length && items.length > 0}
                                onCheckedChange={toggleSelectAll}
                              />
                            )}
                          </th>
                          <th className={cn("w-10 px-2 text-left", isCompact ? "py-1" : "py-3")}>#</th>
                          <th className={cn("w-[200px] min-w-[200px] px-2 text-left", isCompact ? "py-1" : "py-3")}>Notes/Review</th>
                          <th className={cn("w-[100px] min-w-[100px] px-2 text-left", isCompact ? "py-1" : "py-3")}>Category</th>
                          <th className={cn("w-[160px] min-w-[160px] max-w-[160px] px-2 text-left", isCompact ? "py-1" : "py-3")}>Item/Product</th>
                          <th className={cn("w-[60px] px-2 text-left", isCompact ? "py-1" : "py-3")}>Unit</th>
                          <th className={cn("w-[110px] min-w-[110px] max-w-[110px] px-2 text-center font-bold text-indigo-900 border-l border-slate-200/50 bg-indigo-50/20", isCompact ? "py-1" : "py-3")}>Dimensions</th>
                          <th className={cn("w-[80px] min-w-[80px] max-w-[80px] px-2 text-center bg-indigo-50 font-bold text-indigo-700", isCompact ? "py-1" : "py-3")}>QTY</th>
                          {!isSupplier && (
                            <th className={cn("w-[100px] px-2 text-left font-bold text-indigo-900 border-l border-slate-200/50 bg-indigo-50/20", isCompact ? "py-1" : "py-3")}>Assignee</th>
                          )}
                          <th className={cn("w-[60px] px-2 text-center border-l bg-amber-50/20 font-bold text-amber-700", isCompact ? "py-1" : "py-3")}>Pre</th>
                          <th className={cn("w-[60px] px-2 text-center bg-amber-50/20 font-bold text-amber-700", isCompact ? "py-1" : "py-3")}>Post</th>
                          <th className={cn("w-10 px-2 text-center", isCompact ? "py-1" : "py-3")}>Del</th>
                        </tr>
                      </thead>
                      <Reorder.Group as="tbody" axis="y" values={paginatedItems} onReorder={(newPaginatedOrder) => {
                        if (isFiltering) return;
                        const startIndex = (currentPage - 1) * pageSize;
                        const nextItems = [...items];
                        nextItems.splice(startIndex, paginatedItems.length, ...newPaginatedOrder);
                        setItems(nextItems);
                        if (sortBy !== "none") setSortBy("none");
                      }} key={`${sortBy}-${currentPage}`}>
                        {paginatedItems.map((item, pIdx) => {
                          const globalIdx = (currentPage - 1) * pageSize + pIdx;
                          return (
                            <SketchPlanRow
                              key={item.id}
                              item={item}
                              idx={items.indexOf(item)} // Keep original items index for reordering logic
                              displayIdx={globalIdx + 1}
                              itemsLength={items.length}
                            isLocked={isLocked || userRole === "supplier"}
                            isFiltering={isFiltering}
                            isCompact={isCompact}
                            updateItem={updateItem}
                            removeItem={removeItem}
                            moveItemToPosition={moveItemToPosition}
                            selectMaterial={selectMaterial}
                            searchResults={searchResults}
                            searching={searching}
                            loadMaterials={loadMaterials}
                            materialSearch={materialSearch}
                            setMaterialSearch={setMaterialSearch}
                            openPopoverIdx={openPopoverIdx}
                            setOpenPopoverIdx={setOpenPopoverIdx}
                            renameRowImage={renameRowImage}
                            removeRowImage={removeRowImage}
                            handleRowImageUpload={handleRowImageUpload}
                            setPreviewImage={setPreviewImage}
                            lastSketchItemIdxRef={lastSketchItemIdxRef}
                            setSketchTarget={setSketchTarget}
                            setSketchInitialData={setSketchInitialData}
                            toast={toast}
                            setSketchDialogOpen={setSketchDialogOpen}
                            isSelected={selectedItemIds.has(item.id)}
                            toggleSelect={toggleSelectItem}
                            userRole={userRole}
                            onImageDragStart={handleImageDragStart}
                            onImageDrop={handleImageDrop}
                            addDimension={addDimension}
                            removeDimension={removeDimension}
                            updateDimension={updateDimension}
                            cloneItem={cloneItem}
                            categories={categories}
                          />
                          );
                        })}
                      </Reorder.Group>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Bottom Utils */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
                {/* Plan-level Site Photos */}
                <Card className="border-slate-200 shadow-sm col-span-1 md:col-span-2 lg:col-span-1 flex flex-col">
                  <CardHeader className="bg-slate-50/50 py-2 border-b">
                    <CardTitle className="text-xs font-bold flex items-center gap-2">
                      <Camera className="w-3.5 h-3.5 text-indigo-500" /> Plan-Level Site Photos
                    </CardTitle>
                  </CardHeader>
                  <CardContent
                    className={cn(
                      "p-3 flex-1 overflow-y-auto max-h-[220px] relative z-20 transition-colors",
                      !(isLocked || userRole === "supplier") && "min-h-[100px]"
                    )}
                    onDragOver={(e) => {
                      if (isLocked || userRole === "supplier") return;
                      e.preventDefault();
                    }}
                    onDrop={(e) => {
                      if (isLocked || userRole === "supplier") return;
                      handleImageDrop(e, { type: "main" });
                    }}
                  >
                    <div className="grid grid-cols-4 gap-2">
                      {planImages.map((img, idx) => (
                        <div
                          key={idx}
                          className={cn(
                            "relative group aspect-square rounded border overflow-hidden bg-slate-100 transition-all",
                            (isLocked || userRole === "supplier") ? "pointer-events-auto" : "cursor-grab active:cursor-grabbing hover:ring-2 hover:ring-indigo-300"
                          )}
                          draggable={!(isLocked || userRole === "supplier")}
                          onDragStart={(e) => handleImageDragStart(e, { type: "main", imgIdx: idx })}
                        >
                          <img src={img.url} className="w-full h-full object-cover cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setPreviewImage(img)} title="Click to view full image" />
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] p-1 truncate opacity-0 group-hover:opacity-100 transition-opacity pr-6 pointer-events-none">
                            {img.name}
                          </div>
                          {!(isLocked || userRole === "supplier") && (
                            <div className="absolute top-1 left-1 flex gap-1 z-10">
                              <button onClick={() => {
                                setSketchTarget("main");
                                setSketchInitialData(img.url);
                                lastSketchPlanImgIdxRef.current = idx;
                                setSketchDialogOpen(true);
                              }} className="bg-slate-800 text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity" title="Edit in Sketch Editor">
                                <Pencil className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                          {!(isLocked || isSupplier) && (
                            <>
                              <button onClick={() => renamePlanImage(idx)} className="absolute bottom-1 right-1 bg-indigo-500 text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10" title="Rename photo">
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button onClick={() => setPlanImages(planImages.filter((_, i) => i !== idx))} className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10" title="Delete photo">
                                <X className="w-3 h-3" />
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                      {!(isLocked || isSupplier) && (
                        <>
                          <input type="file" multiple accept="image/*" className="hidden" id="plan-photo-upload" onChange={handlePlanImageUpload} disabled={isLocked || isSupplier} />
                          <Button variant="ghost" size="sm" className="col-span-4 border-2 border-dashed border-slate-200 h-10 hover:bg-slate-100 p-0" asChild disabled={isLocked || isSupplier}>
                            <label htmlFor="plan-photo-upload" className="cursor-pointer flex flex-col items-center justify-center w-full h-full">
                              <Plus className="w-5 h-5 text-slate-400" />
                            </label>
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Plan-level Attachments (PDF/Excel) */}
                <Card className="border-slate-200 shadow-sm col-span-1 md:col-span-2 lg:col-span-1 flex flex-col">
                  <CardHeader className="bg-slate-50/50 py-2 border-b flex flex-row items-center justify-between">
                    <CardTitle className="text-xs font-bold flex items-center gap-2">
                      <Paperclip className="w-3.5 h-3.5 text-blue-500" /> Plan Attachments (PDF/Excel)
                    </CardTitle>
                    {userRole !== "supplier" && (
                      <div className="flex gap-1">
                        <input type="file" accept=".pdf" className="hidden" id="pdf-upload" onChange={(e) => handleAttachmentUpload(e, "pdf")} disabled={isLocked} />
                        <label htmlFor="pdf-upload" className={cn("cursor-pointer p-1 rounded hover:bg-slate-200 transition-colors", isLocked && "opacity-50 cursor-not-allowed")}>
                          <FileUp className="w-3.5 h-3.5 text-red-500" />
                        </label>
                        <input type="file" accept=".xlsx,.xls" className="hidden" id="excel-upload" onChange={(e) => handleAttachmentUpload(e, "excel")} disabled={isLocked} />
                        <label htmlFor="excel-upload" className={cn("cursor-pointer p-1 rounded hover:bg-slate-200 transition-colors", isLocked && "opacity-50 cursor-not-allowed")}>
                          <FileSpreadsheet className="w-3.5 h-3.5 text-green-600" />
                        </label>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className="p-3 flex-1 overflow-y-auto max-h-[220px]">
                    {attachments.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-20 text-slate-400 text-[10px] border-2 border-dashed rounded">
                        <p>No attachments uploaded</p>
                        <p>Click icons above to add PDF or Excel</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {attachments.map((att, idx) => (
                          <div key={idx} className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-100 group">
                            <div className="flex items-center gap-2 overflow-hidden">
                              {att.type === "pdf" ? <FileText className="w-4 h-4 text-red-500 shrink-0" /> : <FileSpreadsheet className="w-4 h-4 text-green-600 shrink-0" />}
                              <span className="text-[10px] font-medium truncate">{att.name}</span>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <a href={att.url} download={att.name} className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-white rounded transition-colors">
                                <Download className="w-3.5 h-3.5" />
                              </a>
                              {!(isLocked || userRole === "supplier") && (
                                <button onClick={() => setAttachments(attachments.filter((_, i) => i !== idx))} className="p-1 text-slate-500 hover:text-red-500 hover:bg-white rounded transition-colors">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Sketch pad Section */}
                <Card className="border-slate-200 shadow-sm flex flex-col">
                  <CardHeader className="bg-slate-50/50 py-2 border-b">
                    <CardTitle className="text-xs font-bold flex items-center gap-2">
                      <Pencil className="w-3.5 h-3.5 text-indigo-500" /> Freehand Sketch pad
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 flex flex-col justify-between flex-1">
                    <div className="flex items-center gap-3">
                      <div className="bg-amber-100 p-2 rounded-full text-amber-600 shrink-0">
                        <Pencil className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-700">Need specific visual notes?</p>
                        <p className="text-[9px] text-slate-500">Draw once and attach it to any row or main plan photos.</p>
                      </div>
                    </div>
                    <Dialog open={sketchDialogOpen} onOpenChange={setSketchDialogOpen}>
                      <DialogTrigger asChild>
                        <Button onClick={() => {
                          // Clear initial data if opening fresh
                          if (!sketchInitialData) {
                            setSketchInitialData(undefined);
                            lastSketchItemIdxRef.current = null;
                            lastSketchPlanImgIdxRef.current = null;
                          }
                        }} size="sm" className="bg-slate-800 hover:bg-black text-white text-[10px] h-8 px-4 w-full mt-3" disabled={isLocked || userRole === "supplier"}>Open Sketch Editor</Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-[850px] w-[95vw] max-h-[95vh] h-[90vh] overflow-y-auto flex flex-col p-1 sm:p-4">
                        <DialogHeader className="px-2 sm:px-4">
                          <DialogTitle className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pr-8">
                            <div className="flex items-center gap-3">
                              <span className="text-sm sm:text-base">Site Sketch Editor</span>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] sm:text-xs font-normal">
                              <span className="text-slate-500">Save to:</span>
                              <Select value={sketchTarget} onValueChange={setSketchTarget}>
                                <SelectTrigger className="w-[140px] h-7 text-[10px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="main">Main (Plan Photos)</SelectItem>
                                  {items.map((item, i) => (
                                    <React.Fragment key={item.id}>
                                      <SelectItem value={`pre-${i}`}>Row {i + 1} (Pre): {item.item_name || "Untitled"}</SelectItem>
                                      <SelectItem value={`post-${i}`}>Row {i + 1} (Post): {item.item_name || "Untitled"}</SelectItem>
                                    </React.Fragment>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </DialogTitle>
                        </DialogHeader>
                        <div className="py-2">
                          <SketchPad
                            readOnly={isLocked || userRole === "supplier"}
                            initialData={sketchInitialData}
                            unitPrefix={sketchTarget === "main" ? (items[0]?.dimension_unit || "ft") as string : (items[parseInt(sketchTarget.replace(/^(pre-|post-)/, ""))]?.dimension_unit || "ft") as string}
                            onAutoSave={handleSketchAutoSave}
                            onSave={handleSketchSave}
                          />
                        </div>
                      </DialogContent>
                    </Dialog>
                  </CardContent>
                </Card>

                {/* Quick Tips */}
                <Card className="border-slate-200 shadow-sm bg-slate-50/30 flex flex-col">
                  <CardContent className="p-4 flex flex-col justify-center h-full text-[10px] text-slate-500">
                    <p className="font-bold text-slate-700 mb-2 flex items-center gap-1.5 underline decoration-indigo-300 underline-offset-4"><FileText className="w-3.5 h-3.5" /> Site Visit Tips:</p>
                    <ul className="list-disc list-inside space-y-1 ml-1 leading-relaxed">
                      <li>Use the <span className="text-indigo-600 font-bold">Unit Toggle</span> for each row (ft/mm).</li>
                      <li>Dimensions <span className="text-indigo-600 font-bold">auto-calculate</span> Qty (override if needed).</li>
                      <li>Search <span className="text-indigo-600 font-bold">Materials/Products</span> from multiple DB sources.</li>
                      <li>Snap photos per item for accurate documentation.</li>
                      <li>Save as <span className="text-indigo-600 font-bold">Template</span> for repeated site structures.</li>
                    </ul>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* PDF Export Dialog */}
            <Dialog open={isPdfDialogOpen} onOpenChange={setIsPdfDialogOpen}>
              <DialogContent className="sm:max-w-[450px]">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-indigo-600" />
                    Export Report Options
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-6 py-4">
                  <div>
                    <Label className="text-[10px] uppercase font-bold text-slate-500 mb-3 block">Column Selection</Label>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                      {["#", "Item", "Notes", "L", "W", "H", "Qty", "Unit", "Pre Photos", "Post Photos"].map((col) => (
                        <div key={col} className="flex items-center space-x-2 bg-slate-50 p-2 rounded border border-slate-100">
                          <Checkbox
                            id={`col-${col}`}
                            checked={selectedPdfCols.includes(col)}
                            onCheckedChange={(checked) => {
                              if (checked) setSelectedPdfCols([...selectedPdfCols, col]);
                              else setSelectedPdfCols(selectedPdfCols.filter(c => c !== col));
                            }}
                          />
                          <label htmlFor={`col-${col}`} className="text-xs font-semibold leading-none cursor-pointer text-slate-700">
                            {col}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100">
                    <Label className="text-[10px] uppercase font-bold text-slate-500 mb-3 block">Additional Content</Label>
                    <div className="space-y-3">
                      <div className="flex items-center space-x-2 bg-amber-50 p-3 rounded border border-amber-100">
                        <Checkbox
                          id="include-plan-photos"
                          checked={includePlanPhotosInExport}
                          onCheckedChange={(checked) => setIncludePlanPhotosInExport(!!checked)}
                        />
                        <label htmlFor="include-plan-photos" className="text-xs font-bold leading-none cursor-pointer text-amber-900 flex items-center gap-2">
                          <ImageIcon className="w-3.5 h-3.5" /> Include Plan-Level Site Photos
                        </label>
                      </div>
                      <div className="flex items-center space-x-2 bg-indigo-50 p-3 rounded border border-indigo-100">
                        <Checkbox
                          id="include-sub-notes"
                          checked={includeSubNotesInExport}
                          onCheckedChange={(checked) => setIncludeSubNotesInExport(!!checked)}
                        />
                        <label htmlFor="include-sub-notes" className="text-xs font-bold leading-none cursor-pointer text-indigo-900 flex items-center gap-2">
                          <GitBranch className="w-3.5 h-3.5" /> Include Sub-Notes & Detailed Dimensions
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
                <DialogFooter className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                  <Button variant="outline" onClick={() => setIsPdfDialogOpen(false)} className="w-full sm:w-auto">Cancel</Button>
                  <div className="flex gap-2 w-full sm:w-auto">
                    <Button variant="outline" className="flex-1 sm:flex-initial gap-1 border-green-600 text-green-700 hover:bg-green-50" onClick={() => { setIsPdfDialogOpen(false); handleDownloadExcel(); }}>
                      <FileSpreadsheet className="w-4 h-4" /> Excel
                    </Button>
                    <Button className="flex-1 sm:flex-initial bg-indigo-600 hover:bg-indigo-700 gap-1" onClick={() => { setIsPdfDialogOpen(false); handleDownloadPdf(); }}>
                      <Download className="w-4 h-4" /> PDF
                    </Button>
                  </div>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Email Dialog */}
            <Dialog open={isEmailDialogOpen} onOpenChange={setIsEmailDialogOpen}>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Send Plan as Email Report</DialogTitle>
                </DialogHeader>
                <div className="py-4 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Recipient Email Address</Label>
                    <Input id="email" type="email" placeholder="client@example.com" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} />
                  </div>
                  <p className="text-[10px] text-slate-500 italic">The plan will be sent as a PDF attachment with the columns currently selected in the "Export PDF" settings.</p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsEmailDialogOpen(false)}>Cancel</Button>
                  <Button className="bg-indigo-600 hover:bg-indigo-700 font-bold" disabled={sendingEmail} onClick={handleSendEmail}>
                    {sendingEmail ? "Sending..." : "Send Email"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Image Preview Dialog */}
            <Dialog open={!!previewImage} onOpenChange={(open) => !open && setPreviewImage(null)}>
              <DialogContent className="max-w-4xl p-1 bg-transparent border-none shadow-none [&>button]:text-white [&>button]:bg-black/50 [&>button]:hover:bg-black/80 [&>button]:rounded-full [&>button]:p-2 [&>button]:z-[210] [&>button]:top-4 [&>button]:right-4 z-[200]">
                <DialogHeader className="sr-only">
                  <DialogTitle>Image Preview</DialogTitle>
                </DialogHeader>
                {previewImage && (
                  <div className="relative flex flex-col items-center justify-center w-full h-full min-h-[50vh]">
                    <img src={previewImage.url} alt={previewImage.name} className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl bg-white/5" />
                    <div className="absolute bottom-4 bg-black/70 text-white px-4 py-2 rounded-full text-sm font-medium backdrop-blur-sm border border-white/10 shadow-lg">
                      {previewImage.name}
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>

            {/* Assign Vendor Dialog */}
            <Dialog open={showAssignDialog} onOpenChange={(open) => {
              setShowAssignDialog(open);
              if (!open) setVendorSearchTerm("");
            }}>
              <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden border-none shadow-2xl max-h-[85vh] flex flex-col">
                <div className="bg-gradient-to-r from-violet-600 to-indigo-600 p-6 text-white shrink-0">
                  <DialogHeader>
                    <div className="flex items-center justify-between">
                      <DialogTitle className="text-white flex items-center gap-2 text-xl font-bold">
                        <Store className="w-6 h-6 border-2 border-violet-400 rounded-full p-0.5" />
                        Assign Items to Vendor
                      </DialogTitle>
                    </div>
                    <p className="text-violet-100 text-sm mt-1">
                      You have selected <span className="font-bold underline decoration-amber-400 underline-offset-4">{selectedItemIds.size}</span> items to distribute.
                    </p>
                  </DialogHeader>
                </div>

                <div className="p-4 space-y-4 bg-white flex-1 overflow-hidden flex flex-col">
                  <div className="relative group shrink-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-violet-500 transition-colors" />
                    <Input
                      placeholder="Search vendors by name or city..."
                      className="pl-9 h-11 bg-slate-50 border-slate-200 focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all font-medium"
                      value={vendorSearchTerm}
                      onChange={(e) => setVendorSearchTerm(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2 overflow-y-auto pr-1 flex-1 custom-scrollbar min-h-[100px]">
                    {vendors.filter(v =>
                      v.name?.toLowerCase().includes(vendorSearchTerm.toLowerCase()) ||
                      v.city?.toLowerCase().includes(vendorSearchTerm.toLowerCase())
                    ).length === 0 ? (
                      <div className="text-center py-10 bg-slate-50 rounded-xl border border-dashed border-slate-200 flex flex-col items-center gap-2 m-2">
                        <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center">
                          <Search className="w-6 h-6 text-slate-300" />
                        </div>
                        <p className="text-sm text-slate-500 font-medium">No matching vendors found.</p>
                        <Button variant="link" size="sm" onClick={() => setVendorSearchTerm("")} className="text-violet-600 p-0 h-auto">Clear Search</Button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-2 p-1">
                        {vendors.filter(v =>
                          v.name?.toLowerCase().includes(vendorSearchTerm.toLowerCase()) ||
                          v.city?.toLowerCase().includes(vendorSearchTerm.toLowerCase())
                        ).sort((a, b) => (a.name || "").localeCompare(b.name || "")).map(v => (
                          <Button
                            key={v.id}
                            variant="outline"
                            className="w-full justify-start h-auto py-3 px-4 hover:border-violet-400 hover:bg-violet-50 group transition-all duration-200 border-slate-200 shadow-sm hover:shadow-md hover:-translate-y-0.5"
                            onClick={() => handleAssignToVendor(v.id)}
                            disabled={assigningLoading}
                          >
                            <div className="w-10 h-10 rounded-lg bg-slate-100 group-hover:bg-violet-100 flex items-center justify-center mr-3 shrink-0 transition-colors">
                              <Store className="w-5 h-5 text-slate-500 group-hover:text-violet-600" />
                            </div>
                            <div className="flex flex-col items-start min-w-0 flex-1 text-left">
                              <span className="font-bold text-slate-700 group-hover:text-violet-900 truncate w-full text-sm">{v.name}</span>
                              <div className="flex items-center gap-2 mt-0.5">
                                {v.city && (
                                  <span className="text-[11px] text-slate-500 font-medium flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400"></span> {v.city}
                                  </span>
                                )}
                                {v.gstno && (
                                  <span className="text-[10px] text-slate-400 font-mono tracking-tighter">
                                    {v.gstno}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="opacity-0 group-hover:opacity-100 transition-all ml-2 shrink-0 translate-x-2 group-hover:translate-x-0">
                              <Check className="w-5 h-5 text-violet-600" />
                            </div>
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border-t flex justify-end shrink-0">
                  <Button variant="ghost" onClick={() => setShowAssignDialog(false)} className="text-slate-500 hover:text-slate-700 font-semibold h-9">
                    Close
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* Assign User Dialog */}
            <Dialog open={showAssignUserDialog} onOpenChange={(open) => {
              setShowAssignUserDialog(open);
              if (!open) setUserSearchTerm("");
            }}>
              <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden border-none shadow-2xl max-h-[85vh] flex flex-col">
                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-white shrink-0">
                  <DialogHeader>
                    <div className="flex items-center justify-between">
                      <DialogTitle className="text-white flex items-center gap-2 text-xl font-bold">
                        <Users className="w-6 h-6 border-2 border-blue-400 rounded-full p-0.5" />
                        Assign Items to User
                      </DialogTitle>
                    </div>
                    <p className="text-blue-100 text-sm mt-1">
                      You have selected <span className="font-bold underline decoration-blue-400 underline-offset-4">{selectedItemIds.size}</span> items to assigned directly to a team member.
                    </p>
                  </DialogHeader>
                </div>

                <div className="p-4 space-y-4 bg-white flex-1 overflow-hidden flex flex-col">
                  <div className="relative group shrink-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                    <Input
                      placeholder="Search users by name..."
                      className="pl-9 h-11 bg-slate-50 border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
                      value={userSearchTerm}
                      onChange={(e) => setUserSearchTerm(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2 overflow-y-auto pr-1 flex-1 custom-scrollbar min-h-[100px]">
                    {usersList.filter(u =>
                      u.username?.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
                      u.fullName?.toLowerCase().includes(userSearchTerm.toLowerCase())
                    ).length === 0 ? (
                      <div className="text-center py-10 bg-slate-50 rounded-xl border border-dashed border-slate-200 flex flex-col items-center gap-2 m-2">
                        <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center">
                          <Search className="w-6 h-6 text-slate-300" />
                        </div>
                        <p className="text-sm text-slate-500 font-medium">No matching users found.</p>
                        <Button variant="link" size="sm" onClick={() => setUserSearchTerm("")} className="text-blue-600 p-0 h-auto">Clear Search</Button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-2 p-1">
                        {usersList.filter(u =>
                          u.username?.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
                          u.fullName?.toLowerCase().includes(userSearchTerm.toLowerCase())
                        ).sort((a, b) => ((a.fullName || a.username) || "").localeCompare((b.fullName || b.username) || "")).map(u => (
                          <Button
                            key={u.id}
                            variant="outline"
                            className="w-full justify-start h-auto py-3 px-4 hover:border-blue-400 hover:bg-blue-50 group transition-all duration-200 border-slate-200 shadow-sm hover:shadow-md hover:-translate-y-0.5"
                            onClick={() => handleAssignToUser(u.id)}
                            disabled={assigningLoading}
                          >
                            <div className="w-10 h-10 rounded-lg bg-slate-100 group-hover:bg-blue-100 flex items-center justify-center mr-3 shrink-0 transition-colors">
                              <Users className="w-5 h-5 text-slate-500 group-hover:text-blue-600" />
                            </div>
                            <div className="flex flex-col items-start min-w-0 flex-1 text-left">
                              <span className="font-bold text-slate-700 group-hover:text-blue-900 truncate w-full text-sm">{u.fullName || u.username}</span>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-slate-400 font-mono tracking-tighter">
                                  Role: {u.role}
                                </span>
                              </div>
                            </div>
                            <div className="opacity-0 group-hover:opacity-100 transition-all ml-2 shrink-0 translate-x-2 group-hover:translate-x-0">
                              <Check className="w-5 h-5 text-blue-600" />
                            </div>
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border-t flex justify-end shrink-0">
                  <Button variant="ghost" onClick={() => setShowAssignUserDialog(false)} className="text-slate-500 hover:text-slate-700 font-semibold h-9">
                    Close
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* Assign Category Dialog */}
            <Dialog open={showAssignCategoryDialog} onOpenChange={(open) => {
              setShowAssignCategoryDialog(open);
              if (!open) setCategorySearchTerm("");
            }}>
              <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden border-none shadow-2xl max-h-[85vh] flex flex-col">
                <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-6 text-white shrink-0">
                  <DialogHeader>
                    <div className="flex items-center justify-between">
                      <DialogTitle className="text-white flex items-center gap-2 text-xl font-bold">
                        <Layers className="w-6 h-6 border-2 border-indigo-400 rounded-full p-0.5" />
                        Assign Category to Items
                      </DialogTitle>
                    </div>
                    <p className="text-indigo-100 text-sm mt-1">
                      Assign a category to <span className="font-bold underline decoration-amber-400 underline-offset-4">{selectedItemIds.size}</span> selected items.
                    </p>
                  </DialogHeader>
                </div>

                <div className="p-4 space-y-4 bg-white flex-1 overflow-hidden flex flex-col">
                  <div className="relative group shrink-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                    <Input
                      placeholder="Search categories..."
                      className="pl-9 h-11 bg-slate-50 border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                      value={categorySearchTerm}
                      onChange={(e) => setCategorySearchTerm(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2 overflow-y-auto pr-1 flex-1 custom-scrollbar min-h-[100px]">
                    {categories.filter(cat =>
                      cat.toLowerCase().includes(categorySearchTerm.toLowerCase())
                    ).length === 0 ? (
                      <div className="text-center py-10 bg-slate-50 rounded-xl border border-dashed border-slate-200 flex flex-col items-center gap-2 m-2">
                        <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center">
                          <Search className="w-6 h-6 text-slate-300" />
                        </div>
                        <p className="text-sm text-slate-500 font-medium">No matching categories found.</p>
                        <Button variant="link" size="sm" onClick={() => setCategorySearchTerm("")} className="text-indigo-600 p-0 h-auto">Clear Search</Button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-2 p-1">
                        {categories.filter(cat =>
                          cat.toLowerCase().includes(categorySearchTerm.toLowerCase())
                        ).sort((a, b) => a.localeCompare(b)).map((cat, idx) => (
                          <Button
                            key={idx}
                            variant="outline"
                            className="w-full justify-start h-auto py-3 px-4 hover:border-indigo-400 hover:bg-indigo-50 group transition-all duration-200 border-slate-200 shadow-sm hover:shadow-md hover:-translate-y-0.5"
                            onClick={() => handleAssignToCategory(cat)}
                            disabled={assigningLoading}
                          >
                            <div className="w-10 h-10 rounded-lg bg-slate-100 group-hover:bg-indigo-100 flex items-center justify-center mr-3 shrink-0 transition-colors">
                              <Layers className="w-5 h-5 text-slate-500 group-hover:text-indigo-600" />
                            </div>
                            <div className="flex flex-col items-start min-w-0 flex-1 text-left">
                              <span className="font-bold text-slate-700 group-hover:text-indigo-900 truncate w-full text-sm">{cat}</span>
                            </div>
                            <div className="opacity-0 group-hover:opacity-100 transition-all ml-2 shrink-0 translate-x-2 group-hover:translate-x-0">
                              <Check className="w-5 h-5 text-indigo-600" />
                            </div>
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border-t flex flex-col gap-3 shrink-0">
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-[10px] uppercase font-bold text-slate-400">Manual Entry</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Type custom category..."
                        className="h-9 text-xs bg-white"
                        value={categorySearchTerm}
                        onChange={(e) => setCategorySearchTerm(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && categorySearchTerm.trim()) {
                            handleAssignToCategory(categorySearchTerm.trim());
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        className="bg-indigo-600 hover:bg-indigo-700 h-9"
                        onClick={() => {
                          if (categorySearchTerm.trim()) {
                            handleAssignToCategory(categorySearchTerm.trim());
                          }
                        }}
                      >
                        Assign
                      </Button>
                    </div>
                  </div>
                  <div className="flex justify-end pt-1 border-t border-slate-200">
                    <Button variant="ghost" onClick={() => setShowAssignCategoryDialog(false)} className="text-slate-500 hover:text-slate-700 font-semibold h-8 text-xs">
                      Close
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* New Version Dialog */}
            <Dialog open={showNewVersionDialog} onOpenChange={setShowNewVersionDialog}>
              <DialogContent className="sm:max-w-[420px]">
                <DialogHeader><DialogTitle className="flex items-center gap-2"><GitBranch className="w-4 h-4 text-violet-600" />Create New Version</DialogTitle></DialogHeader>
                <div className="py-4 space-y-3"><p className="text-sm text-slate-600">Do you want to copy all items from <strong>V{currentVersionNumber}</strong> into the new version?</p><div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-500 border space-y-1"><p><strong>Copy Items</strong> — Start from the same item list</p><p><strong>Start Fresh</strong> — Begin with an empty list</p></div></div>
                <DialogFooter className="flex gap-2"><Button variant="outline" onClick={() => setShowNewVersionDialog(false)} className="flex-1">Cancel</Button><Button variant="outline" className="flex-1" onClick={() => handleCreateNewVersion(false)} disabled={creatingVersion}>{creatingVersion ? "Creating..." : "Start Fresh"}</Button><Button className="flex-1 bg-violet-600 hover:bg-violet-700 text-white" onClick={() => handleCreateNewVersion(true)} disabled={creatingVersion}>{creatingVersion ? "Creating..." : "Copy Items"}</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>

      {/* Floating Action Button */}
      <div className="fixed right-6 bottom-24 z-[100] flex flex-col items-end gap-2 md:gap-3">
        <Button
          onClick={() => setIsCompact(!isCompact)}
          variant="outline"
          className={`h-8 px-3 text-xs font-semibold shadow-sm ${isCompact ? 'bg-indigo-50 text-indigo-600 border-indigo-300' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
          title="Toggle Compact View"
        >
          Compact View
        </Button>
      </div>
      {/* Category Mismatch Confirmation Dialog */}
      <Dialog open={showCategoryConfirm} onOpenChange={setShowCategoryConfirm}>
        <DialogContent className="sm:max-w-[425px] z-[300]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              Category Mismatch
            </DialogTitle>
            <DialogDescription className="py-2 text-slate-600 font-medium">
              This item belongs to a different category (<strong>{rowToConfirm?.material?.category}</strong>).
              Do you want to replace the current category (<strong>{rowToConfirm?.idx !== undefined ? items[rowToConfirm.idx]?.category : ""}</strong>)?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={cancelCategoryReplace} className="flex-1 sm:flex-none">
              Cancel
            </Button>
            <Button onClick={confirmCategoryReplace} className="bg-amber-600 hover:bg-amber-700 text-white flex-1 sm:flex-none">
              Replace Category
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate Checker Dialog */}
      <Dialog open={showDuplicateDialog} onOpenChange={setShowDuplicateDialog}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              Duplicate Rows Found
            </DialogTitle>
            <DialogDescription>
              {duplicateGroups.length > 0
                ? `Found ${duplicateGroups.length} groups of exact duplicate rows. Cleaning up will keep one instance and remove the rest.`
                : "Great! No exact duplicates were found in your plan."}
            </DialogDescription>
          </DialogHeader>

          {duplicateGroups.length > 0 && (
            <div className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar">
              {duplicateGroups.map((group, idx) => (
                <div key={idx} className={`border rounded-md p-3 flex gap-3 transition-colors ${selectedDuplicateIndices.has(idx) ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-slate-50 opacity-70'}`}>
                  <div className="pt-1">
                    <Checkbox
                      checked={selectedDuplicateIndices.has(idx)}
                      onCheckedChange={(checked) => {
                        const next = new Set(selectedDuplicateIndices);
                        if (checked) next.add(idx);
                        else next.delete(idx);
                        setSelectedDuplicateIndices(next);
                      }}
                    />
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h4 className={`font-bold text-sm ${selectedDuplicateIndices.has(idx) ? 'text-amber-800' : 'text-slate-700'}`}>{group[0].item_name || "Unnamed Item"}</h4>
                        <p className={`text-xs ${selectedDuplicateIndices.has(idx) ? 'text-amber-600' : 'text-slate-500'}`}>Repeated <strong>{group.length} times</strong></p>
                      </div>
                      <Badge variant="outline" className="bg-white">Qty: {group[0].qty} {group[0].unit}</Badge>
                    </div>
                    {group[0].description && (
                      <p className="text-xs text-slate-600 italic line-clamp-2 mt-1">"{group[0].description}"</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <DialogFooter className="mt-4 pt-4 border-t">
            <Button variant="outline" onClick={() => setShowDuplicateDialog(false)}>
              {duplicateGroups.length > 0 ? "Cancel" : "Close"}
            </Button>
            {duplicateGroups.length > 0 && (
              <Button
                onClick={cleanUpDuplicates}
                className="bg-amber-600 hover:bg-amber-700 text-white"
                disabled={selectedDuplicateIndices.size === 0}
              >
                Clean Up {selectedDuplicateIndices.size === duplicateGroups.length ? "All" : "Selected"} Duplicates
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </LayoutComponent>
  );
}
