import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Save, ArrowLeft, Camera, Pencil, Layers, X, GripVertical, FileText, Search, MessageSquare, Image as ImageIcon, Move, Lock, Unlock, ShieldAlert, Cloud, Check, AlertTriangle, FileUp, FileSpreadsheet, Download, Paperclip, ArrowUp, ArrowDown, ArrowUpToLine, ArrowDownToLine, GitBranch, Store } from "lucide-react";
import { Reorder, useDragControls } from "framer-motion";
import { SketchPad } from "@/components/SketchPad";
import apiFetch from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/auth-context";
import { SupplierLayout } from "@/components/layout/SupplierLayout";

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
  preImages: PlanImage[]; // PRE-work images
  postImages: PlanImage[]; // POST-work images
  images?: PlanImage[]; // Legacy field for compatibility
  category?: string; // NEW
  assigned_vendor_id?: string;
  vendor_name?: string;
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

// Helper Component for Image Columns (Pre/Post)
const PhotoColumn = ({
  item, idx, category, images, isLocked, isCompact,
  handleRowImageUpload, removeRowImage, renameRowImage,
  setPreviewImage, setSketchTarget, setSketchInitialData,
  lastSketchItemIdxRef, setSketchDialogOpen
}: any) => {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <div className={cn(
          "relative inline-block cursor-pointer p-0.5 border rounded hover:border-amber-300 transition-colors bg-white shadow-sm",
          isLocked && "pointer-events-auto hover:border-slate-200",
          isCompact ? "scale-100" : ""
        )}>
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
        </div>
      </DialogTrigger>
      <DialogContent className="max-w-2xl z-[120]">
        <DialogHeader>
          <DialogTitle>Item {category === "pre" ? "Pre-work" : "Post-work"} Photos - {item.item_name || `Item ${idx + 1}`}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-4 gap-4 py-4 max-h-[60vh] overflow-y-auto">
          {images.map((img: any, imgIdx: number) => (
            <div key={imgIdx} className="relative group aspect-square rounded border overflow-hidden bg-slate-100">
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
const SketchPlanRow = ({
  item, idx, itemsLength, updateItem, removeItem, moveItemToPosition, selectMaterial,
  searchResults, searching, loadMaterials, setMaterialSearch,
  openPopoverIdx, setOpenPopoverIdx, renameRowImage, removeRowImage,
  handleRowImageUpload, isLocked, isCompact, setPreviewImage,
  setSketchTarget, setSketchInitialData, lastSketchItemIdxRef, toast, setSketchDialogOpen,
  isSelected, toggleSelect, userRole
}: any) => {
  const dragControls = useDragControls();
  const isSupplier = userRole === "supplier";

  return (
    <Reorder.Item
      as="tr"
      key={item.id}
      value={item}
      dragListener={!isLocked}
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
          <SelectTrigger className="w-12 h-6 text-[10px] p-1 border-slate-200">
            <SelectValue />
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

          <DialogContent className="z-[110]">
            <DialogHeader>
              <DialogTitle>Notes for {item.item_name || `Item ${idx + 1}`}</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <Textarea
                value={item.description}
                onChange={(e) => updateItem(idx, "description", e.target.value)}
                placeholder="Enter detailed site notes or specifications..."
                className="min-h-[200px]"
                disabled={isLocked}
              />
            </div>
            <DialogFooter>
              <DialogTrigger asChild>
                <Button className="bg-indigo-600 text-white">Save Notes</Button>
              </DialogTrigger>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </td>
      <td className={cn("px-2", isCompact ? "py-0 w-[120px] min-w-[120px] max-w-[120px]" : "py-2 w-[160px] min-w-[160px] max-w-[160px]")}>
        <Dialog open={openPopoverIdx === idx} onOpenChange={(open) => {
          if (open) {
            setOpenPopoverIdx(idx);
            setMaterialSearch("");
            loadMaterials();
          } else {
            setOpenPopoverIdx(null);
          }
        }}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className={cn("w-full justify-start text-left font-normal border-dashed border-slate-300 hover:border-indigo-400 p-1", isLocked && "pointer-events-none", isCompact ? "h-6 text-[9px]" : "h-8 text-[11px]")} disabled={isLocked}>
              {item.item_name ? (
                <span className={cn("truncate", isCompact ? "max-w-[80px]" : "max-w-[120px]")}>{item.item_name}</span>
              ) : (
                <span className="text-slate-400 italic font-normal">+ Add Item</span>
              )}
              <Search className={cn("ml-auto opacity-50", isCompact ? "h-2 w-2" : "h-3 w-3")} />
            </Button>
          </DialogTrigger>
          <DialogContent className="p-0 sm:max-w-[500px]">
            <DialogHeader className="p-4 border-b">
              <DialogTitle>Select Item for Row #{idx + 1}</DialogTitle>
            </DialogHeader>
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search materials, templates, products..."
                onValueChange={setMaterialSearch}
                className="h-10"
              />
              <CommandList className="max-h-[280px]">
                {searching && <CommandEmpty>Loading...</CommandEmpty>}
                {!searching && searchResults.length === 0 && <CommandEmpty>No items found.</CommandEmpty>}
                {!searching && searchResults.length > 0 && (
                  <CommandGroup heading={`All Items (${searchResults.length})`}>
                    {searchResults.map((m: any) => (
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
      <td className={cn("px-1", isCompact ? "py-0" : "py-2")}>
        <Input value={item.length} onChange={(e) => updateItem(idx, "length", e.target.value)} className={cn("px-1", isCompact ? "h-5 text-[10px]" : "h-8 text-xs")} placeholder="0" disabled={isLocked} />
      </td>
      <td className={cn("px-1", isCompact ? "py-0" : "py-2")}>
        <Input value={item.width} onChange={(e) => updateItem(idx, "width", e.target.value)} className={cn("px-1", isCompact ? "h-5 text-[10px]" : "h-8 text-xs")} placeholder="0" disabled={isLocked} />
      </td>
      <td className={cn("px-1", isCompact ? "py-0" : "py-2")}>
        <Input value={item.height} onChange={(e) => updateItem(idx, "height", e.target.value)} className={cn("px-1", isCompact ? "h-5 text-[10px]" : "h-8 text-xs")} placeholder="0" disabled={isLocked} />
      </td>
      <td className={cn("px-1", isCompact ? "py-0" : "py-2")}>
        <Input value={item.qty} onChange={(e) => updateItem(idx, "qty", e.target.value)} className={cn("bg-slate-50 font-bold text-indigo-700 px-1", isCompact ? "h-5 text-[10px]" : "h-8 text-xs")} disabled={isLocked} />
      </td>
      {!isSupplier && (
        <td className={cn("px-1", isCompact ? "py-0" : "py-2")}>
          <div className="flex flex-col">
            <span className={cn("truncate font-medium text-indigo-600", isCompact ? "text-[8px]" : "text-[10px]")}>
              {item.vendor_name || "-"}
            </span>
          </div>
        </td>
      )}
      {/* Pre-work Photos Column */}
      <td className={cn("px-1 text-center", isCompact ? "py-0" : "py-2")}>
        <PhotoColumn
          item={item}
          idx={idx}
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
        />
      </td>
      {/* Post-work Photos Column */}
      <td className={cn("px-1 text-center border-l", isCompact ? "py-0" : "py-2")}>
        <PhotoColumn
          item={item}
          idx={idx}
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
        />
      </td>
      <td className={cn("px-1 text-center border-l", isCompact ? "py-0" : "py-2")}>
        <Button variant="ghost" size="icon" onClick={() => removeItem(idx)} className={cn("text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors bg-slate-50 border border-transparent hover:border-red-200", isCompact ? "h-5 w-5" : "h-6 w-6")} disabled={isLocked} title="Remove Item"><Trash2 className={isCompact ? "w-3 h-3" : "w-3.5 h-3.5"} /></Button>
      </td>
    </Reorder.Item>
  );
};

export default function CreateSketchPlan() {
  const { id: paramId } = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [currentId, setCurrentId] = useState<string | null>(paramId || null);
  const isEditing = !!currentId;

  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState<string>("none");
  const [locationStr, setLocationStr] = useState("");
  const [planDate, setPlanDate] = useState(new Date().toISOString().split("T")[0]);
  const [items, setItems] = useState<PlanItem[]>([
    { id: "1", item_name: "", description: "", length: "", width: "", height: "", qty: "1", unit: "Nos", dimension_unit: "feet", remarks: "", preImages: [], postImages: [], images: [] }
  ]);

  const [projects, setProjects] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [planImages, setPlanImages] = useState<PlanImage[]>([]);
  const [attachments, setAttachments] = useState<PlanAttachment[]>([]);
  const [sketchTarget, setSketchTarget] = useState<string>("main"); // "main" or row id/index
  const [openPopoverIdx, setOpenPopoverIdx] = useState<number | null>(null);

  // PDF / Export State
  const [isPdfDialogOpen, setIsPdfDialogOpen] = useState(false);
  const [selectedPdfCols, setSelectedPdfCols] = useState<string[]>(["#", "Item", "Notes", "L", "W", "H", "Qty", "Unit", "Pre Photos", "Post Photos"]
  );
  const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [isCompact, setIsCompact] = useState(false);

  const [materialSearch, setMaterialSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [vendors, setVendors] = useState<any[]>([]);
  const [assigningLoading, setAssigningLoading] = useState(false);
  const [loadingToProposal, setLoadingToProposal] = useState(false);
  const [vendorSearchTerm, setVendorSearchTerm] = useState("");

  // New state
  const [projectOpen, setProjectOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string, name: string } | null>(null);
  const [sketchInitialData, setSketchInitialData] = useState<string | undefined>(undefined);
  const lastSketchItemIdxRef = useRef<number | null>(null); // To track which image we are "continously" auto-saving
  const lastSketchPlanImgIdxRef = useRef<number | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [sketchDialogOpen, setSketchDialogOpen] = useState(false);

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
  const lastSavedRef = useRef<string>("");

  // Versioning State
  const [siblingVersions, setSiblingVersions] = useState<any[]>([]);
  const [currentVersionNumber, setCurrentVersionNumber] = useState<number>(1);
  const [showNewVersionDialog, setShowNewVersionDialog] = useState(false);
  const [creatingVersion, setCreatingVersion] = useState(false);

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
    setAutoSaveStatus("saving");
    setTimeout(() => setAutoSaveStatus("saved"), 1000);
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

  const handleAssignToVendor = async (shopId: string) => {
    if (selectedItemIds.size === 0) return;
    
    setAssigningLoading(true);
    try {
      const shopName = vendors.find(v => v.id === shopId)?.name || "Vendor";
      const updatedItems = items.map(item => {
        if (selectedItemIds.has(item.id)) {
          return { ...item, assigned_vendor_id: shopId, vendor_name: shopName };
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
        setLocation(`/proposal/${data.projectId}?versionId=${data.versionId}`);
      } else {
        const error = await res.json();
        toast({ title: "Error", description: error.message || "Failed to load to proposal", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error", description: "Something went wrong", variant: "destructive" });
    } finally {
      setLoadingToProposal(false);
    }
  };

  // Load initial data
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        if (!isSupplier) {
          const projectsRes = await apiFetch("/api/boq-projects");
          if (projectsRes.ok) {
            const data = await projectsRes.json();
            setProjects(data.projects || []);
          }
        }

        if (paramId) {
          const planRes = await apiFetch(`/api/sketch-plans/${paramId}`);
          if (planRes.ok) {
            const data = await planRes.json();
            const p = data.plan;
            setName(p.name || "");
            setProjectId(p.project_id || "none");
            setLocationStr(p.location || "");
            if (p.plan_date) setPlanDate(new Date(p.plan_date).toISOString().split("T")[0]);

            // Lock Info
            setIsLocked(!!p.is_locked);
            setRequestStatus(p.request_status || "none");
            setRequestReason(p.request_reason || "");

            // Map items and their images
            const mappedItems = data.items.map((it: any) => {
              const itemImages = data.images.filter((img: any) => img.item_id === it.id);
              const preImages: PlanImage[] = [];
              const postImages: PlanImage[] = [];

              itemImages.forEach((img: any) => {
                const cleanedName = (img.image_name || img.name || "").replace(/^(PRE_|POST_)/, "");
                const mappedImg = {
                  id: img.id,
                  url: img.image_url,
                  name: cleanedName || `Photo ${img.id.split('-').pop()}`
                };

                if ((img.image_name || img.name || "").startsWith("POST_")) {
                  postImages.push(mappedImg);
                } else {
                  preImages.push(mappedImg);
                }
              });

              return { ...it, preImages, postImages, images: [] };
            });
            setItems(mappedItems.length > 0 ? mappedItems : items);

            // Plan-level images
            const plImages = data.images
              .filter((img: any) => !img.item_id)
              .map((img: any) => ({
                id: img.id,
                url: img.image_url,
                name: img.image_name || img.name || `Site Photo ${img.id.split('-').pop()}`
              }));
            setPlanImages(plImages);

            // Attachments
            if (data.attachments && Array.isArray(data.attachments)) {
              const mappedAtts: PlanAttachment[] = data.attachments.map((att: any) => ({
                id: att.id,
                url: att.file_url,
                name: att.file_name,
                type: att.file_type as any
              }));
              setAttachments(mappedAtts);
            }

            // Initialize lastSavedRef to prevent redundant save on mount
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
        } else {
          const templateDataStr = sessionStorage.getItem("sketch_template_data");
          if (templateDataStr) {
            try {
              const td = JSON.parse(templateDataStr);
              if (td.items) setItems(td.items.map((it: any) => ({ ...it, id: Date.now().toString() + Math.random(), preImages: it.preImages || [], postImages: it.postImages || [], images: [] })));
              if (td.location) setLocationStr(td.location);
              sessionStorage.removeItem("sketch_template_data");
              toast({ title: "Template Applied", description: "Form pre-filled from template" });
            } catch (e) {
              console.error("Failed to parse template data", e);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load initial data", err);
      }
    };

    loadInitialData();
  }, [paramId]);
  // Only run when URL parameter changes

  // Load sibling versions for this plan
  const loadSiblingVersions = useCallback(async (planId: string) => {
    try {
      const res = await apiFetch("/api/sketch-plans");
      if (!res.ok) return;
      const data = await res.json();
      const allPlans: any[] = data.plans || [];

      // Find the current plan to get its root
      const currentPlan = allPlans.find(p => p.id === planId);
      if (!currentPlan) return;

      setCurrentVersionNumber(currentPlan.version_number || 1);

      const rootId = currentPlan.parent_plan_id || planId;
      // Get all siblings: same root or is the root
      const siblings = allPlans
        .filter(p => (p.id === rootId || p.parent_plan_id === rootId))
        .sort((a, b) => (a.version_number || 1) - (b.version_number || 1));

      setSiblingVersions(siblings.length > 0 ? siblings : [currentPlan]);
    } catch (e) {
      console.error("loadSiblingVersions error", e);
    }
  }, []);

  useEffect(() => {
    if (currentId) loadSiblingVersions(currentId);
  }, [currentId, loadSiblingVersions]);

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

  const addItem = () => {
    // Clear filters to ensure the new item is visible
    setSearchTerm("");
    setCategoryFilter("all");

    setItems([
      ...items,
      { id: `ski-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, item_name: "", description: "", length: "", width: "", height: "", qty: "1", unit: "Nos", dimension_unit: "feet", remarks: "", preImages: [], postImages: [], images: [] }
    ]);
  };

  const removeItem = (idx: number) => {
    if (items.length === 1) return;
    const newItems = [...items];
    newItems.splice(idx, 1);
    setItems(newItems);
  };

  const moveItemToPosition = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || items.length <= 1) return;
    const newItems = [...items];
    const item = newItems.splice(fromIdx, 1)[0];
    newItems.splice(toIdx, 0, item);
    setItems(newItems);
  };

  const updateItem = (idx: number, field: keyof PlanItem, value: any) => {
    const newItems = [...items];
    newItems[idx] = { ...newItems[idx], [field]: value };

    // Auto-calculate quantity if dimensions or unit change
    if (["length", "width", "height", "dimension_unit"].includes(field)) {
      const l = parseFloat(newItems[idx].length) || 0;
      const w = parseFloat(newItems[idx].width) || 0;
      const h = parseFloat(newItems[idx].height) || 0;
      if (l > 0 || w > 0 || h > 0) {
        const dims = [l, w, h].filter(v => v > 0);
        const autoQty = dims.reduce((acc, v) => acc * v, 1);
        // If dimension_unit is mm, round to nearest integer. Otherwise use 2 decimal places.
        newItems[idx].qty = newItems[idx].dimension_unit === "mm"
          ? Math.round(autoQty).toString()
          : autoQty.toFixed(2);
      } else if (newItems[idx].dimension_unit === "mm") {
        // Ensure existing qty is also rounded when unit switches to mm
        const currentQty = parseFloat(newItems[idx].qty) || 0;
        newItems[idx].qty = Math.round(currentQty).toString();
      }
    }

    setItems(newItems);
  };

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
    if (category === "pre") {
      newItems[itemIdx].preImages.splice(imgIdx, 1);
    } else {
      newItems[itemIdx].postImages.splice(imgIdx, 1);
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
    const newItems = [...items];
    newItems[idx].material_id = material.id;
    newItems[idx].item_name = material.name;
    if (material.category) newItems[idx].category = material.category;
    if (material.unit) newItems[idx].unit = material.unit;

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

  const performSave = async (showToast: boolean = true) => {
    if (isLocked) return;
    if (!name.trim()) {
      if (showToast) {
        toast({
          title: "Validation Error",
          description: "Please enter a Plan Name before saving.",
          variant: "destructive"
        });
      }
      return;
    }

    if (!showToast) setAutoSaveStatus("saving");
    else setSaving(true);

    try {
      const payload = {
        name,
        project_id: projectId === "none" ? null : projectId,
        location: locationStr,
        plan_date: planDate,
        items: items.map(it => {
          const flattenedImages = [
            ...(it.preImages || []).map(img => ({ ...img, name: `PRE_${img.name}` })),
            ...(it.postImages || []).map(img => ({ ...img, name: `POST_${img.name}` }))
          ];
          return { 
            ...it, 
            images: flattenedImages,
            assigned_vendor_id: it.assigned_vendor_id,
            vendor_name: it.vendor_name
          };
        }),
        images: planImages.map((img: any) => ({ item_id: null, image_url: img.url, name: img.name })),
        attachments: attachments.map(att => ({ file_url: att.url, file_name: att.name, file_type: att.type }))
      };

      const jsonStr = JSON.stringify(payload);
      if (jsonStr === lastSavedRef.current) {
        if (!showToast) {
          setAutoSaveStatus("saved");
          return;
        }
        // If it's a manual save and already identical, just treat as success
        toast({ title: "Already Saved", description: "Your changes were already captured by auto-save." });
        setLocation("/sketch-plans");
        return;
      }

      const res = await apiFetch(currentId ? `/api/sketch-plans/${currentId}` : "/api/sketch-plans", {
        method: currentId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: jsonStr
      });

      if (res.ok) {
        const data = await res.json();
        lastSavedRef.current = jsonStr;

        if (!currentId && data.id) {
          setCurrentId(data.id);
          // Update URL without full reload if possible, or just let it stay as is for now
          // For now, let's just update common state
        }

        if (showToast) {
          toast({ title: "Success", description: `Plan ${isEditing ? "updated" : "created"} successfully` });
          setLocation("/sketch-plans");
        } else {
          setAutoSaveStatus("saved");
        }
      } else {
        const errorData = await res.json().catch(() => ({ message: "Unknown error" }));
        if (showToast) {
          toast({ title: "Error", description: errorData.message || "Failed to save plan", variant: "destructive" });
        } else {
          setAutoSaveStatus("error");
        }
      }
    } catch (err) {
      console.error("Save error", err);
      if (showToast) {
        toast({ title: "Error", description: "Failed to save plan", variant: "destructive" });
      } else {
        setAutoSaveStatus("error");
      }
    } finally {
      setSaving(false);
    }
  };

  const savePlan = () => performSave(true);

  // Debounced auto-save
  useEffect(() => {
    if (isLocked || !name.trim()) return;

    // Don't auto-save if we are already in the middle of a manual save
    if (saving) return;

    const timer = setTimeout(() => {
      performSave(false);
    }, 3000); // 3 second debounce for auto-save

    return () => clearTimeout(timer);
  }, [name, projectId, locationStr, planDate, items, planImages, isLocked]);

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
      const processedItems = await Promise.all(items.map(async (item) => {
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

      const headers = selectedPdfCols;
      const body = processedItems.map((item, idx) => {
        const row: any[] = [];
        headers.forEach(h => {
          if (h === "#") row.push(idx + 1);
          else if (h === "Item") row.push(item.item_name);
          else if (h === "Notes") row.push(item.description);
          else if (h === "L") row.push(item.length);
          else if (h === "W") row.push(item.width);
          else if (h === "H") row.push(item.height);
          else if (h === "Qty") row.push(item.qty);
          else if (h === "Unit") row.push(item.unit);
          else if (h === "Pre Photos") row.push("");
          else if (h === "Post Photos") row.push("");
        });
        return row;
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
        didParseCell: (data) => {
          if (data.section === 'body' && (data.column.index === prePhotoColIdx || data.column.index === postPhotoColIdx)) {
            const item = processedItems[data.row.index];
            if (!item) return;
            const pdfImg = data.column.index === prePhotoColIdx ? item._pdfPre : item._pdfPost;
            if (pdfImg) {
              data.cell.styles.minCellHeight = 25;
            }
          }
        },
        didDrawCell: (data) => {
          if (data.section === 'body' && (data.column.index === prePhotoColIdx || data.column.index === postPhotoColIdx)) {
            const item = processedItems[data.row.index];
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
      if (processedPlanImages.length > 0) {
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

  const LayoutComponent = isSupplier ? SupplierLayout : Layout;

  return (
    <LayoutComponent {...(isSupplier ? { shopName: "", shopLocation: "", shopApproved: true } : {})}>
      <div className="max-w-7xl mx-auto space-y-2 pb-20">
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
              <FileText className="w-3 h-3" /> Export PDF
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
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-md border border-slate-100 min-w-[140px] justify-center transition-all">
              {autoSaveStatus === "saving" && (
                <>
                  <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
                  <span className="text-[10px] font-medium text-slate-500 italic">Saving changes...</span>
                </>
              )}
              {autoSaveStatus === "saved" && (
                <>
                  <Check className="w-3 h-3 text-green-500" />
                  <span className="text-[10px] font-medium text-slate-500">All changes saved</span>
                </>
              )}
              {autoSaveStatus === "error" && (
                <>
                  <AlertTriangle className="w-3 h-3 text-red-500" />
                  <span className="text-[10px] font-medium text-red-500">Save failed</span>
                </>
              )}
              {autoSaveStatus === "idle" && (
                <>
                  <Cloud className="w-3 h-3 text-slate-300" />
                  <span className="text-[10px] font-medium text-slate-400">Auto-save ready</span>
                </>
              )}
            </div>
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

        <div className={cn("space-y-4 transition-all duration-300 relative", (isLocked || isSupplier) && "opacity-[0.8] grayscale-[20%] pointer-events-none select-none")}>
          {(isLocked || isSupplier) && (
            <div className="absolute inset-0 z-40 rounded-xl" title="Plan is locked" aria-hidden="true" />
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
                        {projectId !== "none" ? projects.find((project) => project.id === projectId)?.name || "Select project..." : "No Project"}
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
                          {projects.map((project) => (
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
          <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-2">
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
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[180px] h-10 bg-white">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {Array.from(new Set(items.map(it => it.category).filter(Boolean))).map(cat => (
                    <SelectItem key={cat as string} value={cat as string}>{cat as string}</SelectItem>
                  ))}
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
                    <Button 
                      onClick={() => { loadVendors(); setShowAssignDialog(true); }} 
                      size="sm" 
                      variant="outline" 
                      className="h-8 gap-1 border-amber-500 text-amber-600 hover:bg-amber-50"
                    >
                      Assign to Vendor ({selectedItemIds.size})
                    </Button>
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
                      <th className={cn("w-[220px] min-w-[220px] px-2 text-left", isCompact ? "py-1" : "py-3")}>Notes/Review</th>
                      <th className={cn("w-[160px] min-w-[160px] max-w-[160px] px-2 text-left", isCompact ? "py-1" : "py-3")}>Item/Product</th>
                      <th className={cn("w-[60px] px-2 text-left", isCompact ? "py-1" : "py-3")}>Unit</th>
                      <th className={cn("w-[60px] px-2 text-left font-bold text-indigo-900 border-l border-slate-200/50 bg-indigo-50/20", isCompact ? "py-1" : "py-3")}>L</th>
                      <th className={cn("w-[60px] px-2 text-left font-bold text-indigo-900 bg-indigo-50/20", isCompact ? "py-1" : "py-3")}>W</th>
                      <th className={cn("w-[60px] px-2 text-left font-bold text-indigo-900 bg-indigo-50/20", isCompact ? "py-1" : "py-3")}>H</th>
                      <th className={cn("w-[80px] px-2 text-center bg-indigo-50 font-bold text-indigo-700", isCompact ? "py-1" : "py-3")}>QTY</th>
                      {!isSupplier && (
                        <th className={cn("w-[100px] px-2 text-left font-bold text-indigo-900 border-l border-slate-200/50 bg-indigo-50/20", isCompact ? "py-1" : "py-3")}>Assignee</th>
                      )}
                      <th className={cn("w-[60px] px-2 text-center border-l bg-amber-50/20 font-bold text-amber-700", isCompact ? "py-1" : "py-3")}>Pre</th>
                      <th className={cn("w-[60px] px-2 text-center bg-amber-50/20 font-bold text-amber-700", isCompact ? "py-1" : "py-3")}>Post</th>
                      <th className={cn("w-10 px-2 text-center", isCompact ? "py-1" : "py-3")}>Del</th>
                    </tr>
                  </thead>
                  <Reorder.Group as="tbody" axis="y" values={items} onReorder={setItems}>
                    {items.filter(it =>
                      (isSupplier ? it.assigned_vendor_id === (user as any)?.shopId : true) &&
                      (it.item_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        it.description.toLowerCase().includes(searchTerm.toLowerCase())) &&
                      (categoryFilter === "all" || it.category === categoryFilter)
                    ).map((item, idx) => (
                      <SketchPlanRow
                        key={item.id}
                        item={item}
                        idx={items.indexOf(item)}
                        itemsLength={items.length}
                        isLocked={isLocked || userRole === "supplier"}
                        isCompact={isCompact}
                        updateItem={updateItem}
                        addItem={addItem}
                        removeItem={removeItem}
                        moveItemToPosition={moveItemToPosition}
                        selectMaterial={selectMaterial}
                        searchResults={searchResults}
                        searching={searching}
                        loadMaterials={loadMaterials}
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
                      />
                    ))}
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
              <CardContent className="p-3 flex-1 overflow-y-auto max-h-[220px] relative z-20">
                <div className="grid grid-cols-4 gap-2">
                  {planImages.map((img, idx) => (
                    <div key={idx} className={cn("relative group aspect-square rounded border overflow-hidden bg-slate-100", (isLocked || userRole === "supplier") && "pointer-events-auto")}>
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
                      {!(isLocked || userRole === "supplier") && (
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
                  {!(isLocked || userRole === "supplier") && (
                    <>
                      <input type="file" multiple accept="image/*" className="hidden" id="plan-photo-upload" onChange={handlePlanImageUpload} disabled={isLocked || userRole === "supplier"} />
                      <Button variant="ghost" size="sm" className="col-span-4 border-2 border-dashed border-slate-200 h-10 hover:bg-slate-100 p-0" asChild disabled={isLocked || userRole === "supplier"}>
                        <label htmlFor="plan-photo-upload" className="cursor-pointer flex flex-col items-center justify-center w-full h-full">
                          <Plus className="w-5 h-5 text-slate-400" />
                        </label>
                      </Button>
                      <label className="aspect-square rounded border-2 border-dashed border-indigo-200 flex flex-col items-center justify-center text-indigo-400 hover:border-indigo-400 hover:bg-indigo-50 cursor-pointer transition-all shadow-sm bg-white">
                        <Camera className="w-5 h-5" />
                        <span className="text-[8px] font-bold mt-1 uppercase text-center">Open<br />Camera</span>
                        <input type="file" accept="image/*" capture="environment" onChange={(e) => {
                          const files = e.target.files;
                          if (files) {
                            Array.from(files).forEach(file => {
                              const reader = new FileReader();
                              const fileName = `CAM_${new Date().getTime()}`;
                              reader.onloadend = () => setPlanImages(prev => [
                                ...prev,
                                { url: reader.result as string, name: fileName }
                              ]);
                              reader.readAsDataURL(file);
                            });
                          }
                        }} className="hidden" />
                      </label>
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
                          {autoSaveStatus !== "idle" && (
                            <Badge variant="outline" className={cn(
                              "text-[9px] font-black uppercase tracking-widest px-2 py-0 border-none",
                              autoSaveStatus === "saving" ? "bg-amber-100 text-amber-600 animate-pulse" : "bg-emerald-100 text-emerald-600"
                            )}>
                              {autoSaveStatus === "saving" ? "Saving..." : "Saved"}
                            </Badge>
                          )}
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
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Select Columns for PDF Report</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-4">
              {["#", "Item", "Notes", "L", "W", "H", "Qty", "Unit", "Pre Photos", "Post Photos"].map((col) => (
                <div key={col} className="flex items-center space-x-2">
                  <Checkbox
                    id={`col-${col}`}
                    checked={selectedPdfCols.includes(col)}
                    onCheckedChange={(checked) => {
                      if (checked) setSelectedPdfCols([...selectedPdfCols, col]);
                      else setSelectedPdfCols(selectedPdfCols.filter(c => c !== col));
                    }}
                  />
                  <label htmlFor={`col-${col}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    {col}
                  </label>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsPdfDialogOpen(false)}>Cancel</Button>
              <Button className="bg-indigo-600 hover:bg-indigo-700" onClick={() => { setIsPdfDialogOpen(false); handleDownloadPdf(); }}>Download PDF</Button>
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
          <DialogContent className="max-w-4xl p-1 bg-transparent border-none shadow-none [&>button]:text-white [&>button]:bg-black/50 [&>button]:hover:bg-black/80 [&>button]:rounded-full [&>button]:p-2 [&>button]:z-50 [&>button]:top-4 [&>button]:right-4">
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
                    ).map(v => (
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

        {/* New Version Dialog */}
        <Dialog open={showNewVersionDialog} onOpenChange={setShowNewVersionDialog}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><GitBranch className="w-4 h-4 text-violet-600" />Create New Version</DialogTitle></DialogHeader>
            <div className="py-4 space-y-3"><p className="text-sm text-slate-600">Do you want to copy all items from <strong>V{currentVersionNumber}</strong> into the new version?</p><div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-500 border space-y-1"><p><strong>Copy Items</strong> — Start from the same item list</p><p><strong>Start Fresh</strong> — Begin with an empty list</p></div></div>
            <DialogFooter className="flex gap-2"><Button variant="outline" onClick={() => setShowNewVersionDialog(false)} className="flex-1">Cancel</Button><Button variant="outline" className="flex-1" onClick={() => handleCreateNewVersion(false)} disabled={creatingVersion}>{creatingVersion ? "Creating..." : "Start Fresh"}</Button><Button className="flex-1 bg-violet-600 hover:bg-violet-700 text-white" onClick={() => handleCreateNewVersion(true)} disabled={creatingVersion}>{creatingVersion ? "Creating..." : "Copy Items"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </LayoutComponent>
  );
}
