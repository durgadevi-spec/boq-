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
import { DeleteConfirmationDialog } from "../../components/ui/DeleteConfirmationDialog";
import { ProductAnalysisDialog } from "@/components/ProductAnalysisDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../../components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { Textarea } from "../../components/ui/textarea";
import { Checkbox } from "../../components/ui/checkbox";
import { useData } from "../../lib/store";

import { Project, BOMVersion, BOMItem, Product, Step11Item, BOMHistory, BOMComment, User, PROJECT_STATUSES, getProjectStatusMeta } from './types';
import { parseTableData, parseImages, safeJson, VERSION_LABEL } from './utils';
import { CodeBadge } from './components/CodeBadge';
import { PriceUpdateBanner } from './components/PriceUpdateBanner';
import { ProjectPricingBanner } from './components/ProjectPricingBanner';
import { EditableHsnSac } from './components/EditableHsnSac';
import { VersionStatusBanner } from './components/VersionStatusBanner';
import { BoqItemCard } from './components/BoqItemCard';
import { BoqItemRow } from './components/BoqItemRow';
import { HistorySection } from './components/HistorySection';
import { ApprovalsList } from './components/ApprovalsList';
import { ApprovalPreviewDialog } from './components/ApprovalPreviewDialog';
import { VersionHistoryModal } from '@/components/ui/VersionHistoryModal';


// ─── Small UI Components ───────────────────────────────────────────────────────



// ─── Project Pricing Banner ────────────────────────────────────────────────────



// ─── BOQ Item Card ─────────────────────────────────────────────────────────────




// ─── Approvals Components ───────────────────────────────────────────────────



// ─── Main Component ────────────────────────────────────────────────────────────

export default function CreateBom() {
  const { user } = useData();
  const [projects, setProjects] = useState<Project[]>([]);
  const [boqItems, setBoqItems] = useState<BOMItem[]>([]);
  const [versions, setVersions] = useState<BOMVersion[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const selectedVersion = versions.find(v => v.id === selectedVersionId);
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
  const [productSearch, setProductSearch] = useState("");
  const [productCategoryFilter, setProductCategoryFilter] = useState("all");
  const [itemCategoryFilter, setItemCategoryFilter] = useState("all");
  const [projectPricingFilter, setProjectPricingFilter] = useState(false);
  const [isCompactView, setIsCompactView] = useState(false);
  const [analysisProduct, setAnalysisProduct] = useState<string | null>(null);
  const [cardDragOverIdx, setCardDragOverIdx] = useState<number | null>(null);
  const cardDragIdxRef = useRef<number | null>(null);
  const [bomButtonsEnabled, setBomButtonsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [materialsById, setMaterialsById] = useState<Record<string, any>>({});
  const [isUpdatingRates, setIsUpdatingRates] = useState(false);
  const [showQtyIncreaseDialog, setShowQtyIncreaseDialog] = useState(false);
  const [qtyIncreases, setQtyIncreases] = useState<any[]>([]);
  const [pendingAddProductData, setPendingAddProductData] = useState<any>(null);
  const [ignoredMismatches, setIgnoredMismatches] = useState<Set<string>>(new Set());
  const [ignoredPpMismatches, setIgnoredPpMismatches] = useState<Set<string>>(new Set());
  const [projectStatusFilter, setProjectStatusFilter] = useState<string>("all");
  const [projectSearchTerm, setProjectSearchTerm] = useState("");
  const [productCategoryOrder, setProductCategoryOrder] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isSinglePage, setIsSinglePage] = useState(false);
  const [isRefreshingCategories, setIsRefreshingCategories] = useState(false);
  const [refreshLog, setRefreshLog] = useState<{ itemName: string; from: string; to: string }[]>([]);
  const [showRefreshLogDialog, setShowRefreshLogDialog] = useState(false);

  const productCategories = useMemo(() => {
    const cats = new Set<string>();
    boqItems.forEach(item => {
      const td = parseTableData(item.table_data);
      const c = td.category_name || td.category || "General";
      if (c) cats.add(c);
    });
    return Array.from(cats).sort();
  }, [boqItems]);

  useEffect(() => {
    let initialOrder: string[] = [];
    if (selectedVersion && (selectedVersion as any).category_order) {
      try {
        const savedOrder = (selectedVersion as any).category_order;
        if (Array.isArray(savedOrder) && savedOrder.length > 0) {
          initialOrder = savedOrder;
        }
      } catch (e) { console.error("Failed to parse category_order", e); }
    }

    setProductCategoryOrder(prev => {
      // Use initialOrder if this is the first time we're setting state, else use prev
      const base = (prev.length === 0) ? initialOrder : prev;

      const newCats = productCategories.filter(c => !base.includes(c));
      const stillPresent = base.filter(c => productCategories.includes(c));

      const result = [...stillPresent, ...newCats];
      // Avoid state updates if nothing changed
      if (prev.length > 0 && JSON.stringify(result) === JSON.stringify(prev)) return prev;
      return result;
    });
  }, [productCategories, selectedVersionId, selectedVersion]);

  // Auto-save category order when it changes
  useEffect(() => {
    if (selectedVersionId && productCategoryOrder.length > 0) {
      const saveOrder = async () => {
        try {
          await apiFetch(`/api/boq-versions/${selectedVersionId}/category-order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categoryOrder: productCategoryOrder })
          });
        } catch (err) {
          console.error("Failed to auto-save category order", err);
        }
      };

      const timer = setTimeout(saveOrder, 300);

      return () => clearTimeout(timer);
    }
  }, [productCategoryOrder, selectedVersionId]);

  const itemCategories = useMemo(() => {
    const cats = new Set<string>();
    boqItems.forEach(item => {
      const td = parseTableData(item.table_data);
      // For standalone items (no product_id), treat their top-level category as the item category.
      if (!td.product_id) {
        const c = td.category_name || td.category || "General";
        if (c) cats.add(c);
        return;
      }
      if (td.materialLines) td.materialLines.forEach((ml: any) => { cats.add(ml.category || "General"); });
      if (td.step11_items) td.step11_items.forEach((it: any) => { cats.add(it.category || "General"); });
    });
    return Array.from(cats).sort();
  }, [boqItems]);

  // Comments state
  const [comments, setComments] = useState<BOMComment[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [showCommentDialog, setShowCommentDialog] = useState(false);
  const [commentTarget, setCommentTarget] = useState<{ type: 'product' | 'item' | 'overall'; id: string; name: string } | null>(null);
  const [newComment, setNewComment] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [showProposalImportDialog, setShowProposalImportDialog] = useState(false);
  const [selectedProposalImportIds, setSelectedProposalImportIds] = useState<string[]>([]);
  const [expandedProposalId, setExpandedProposalId] = useState<string | null>(null);
  const [proposalItemsPreview, setProposalItemsPreview] = useState<Record<string, any[]>>({});
  const [loadingPreviewId, setLoadingPreviewId] = useState<string | null>(null);

  // Duplicate Check State
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<any[][]>([]);
  const [selectedDuplicateIndices, setSelectedDuplicateIndices] = useState<Set<number>>(new Set());
  const [replyingTo, setReplyingTo] = useState<BOMComment | null>(null);
  const [commentInboxView, setCommentInboxView] = useState(false);
  const [isSelectingThread, setIsSelectingThread] = useState(false);
  const [threadSearchQuery, setThreadSearchQuery] = useState("");

  const [approvedProposals, setApprovedProposals] = useState<any[]>([]);
  const [bomTemplates, setBomTemplates] = useState<any[]>([]);
  const [sketchTemplates, setSketchTemplates] = useState<any[]>([]);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [showSaveTemplateDialog, setShowSaveTemplateDialog] = useState(false);
  const [showCompareDialog, setShowCompareDialog] = useState(false);
  const [activeTab, setActiveTab] = useState("bom");
  const [approvals, setApprovals] = useState<any[]>([]);
  const [approvalsModalOpen, setApprovalsModalOpen] = useState(false);
  const [rateChangeRequests, setRateChangeRequests] = useState<any[]>([]);
  const [rateActionLoading, setRateActionLoading] = useState<string | null>(null);
  const [loadingApprovals, setLoadingApprovals] = useState(false);
  const [approvalActionLoading, setApprovalActionLoading] = useState<string | null>(null);
  const [previewApprovalId, setPreviewApprovalId] = useState<string | null>(null);
  const [previewApprovalItems, setPreviewApprovalItems] = useState<any[]>([]);
  const [loadingPreviewItems, setLoadingPreviewItems] = useState(false);
  const [templateToSave, setTemplateToSave] = useState<BOMItem | null>(null);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [templateSearch, setTemplateSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; type: 'template' | 'sketch' | 'version'; id: string; name: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const loadTemplates = useCallback(async () => {
    try {
      // Fetch BOM templates and Sketch templates in parallel
      const [bomResp, sketchResp] = await Promise.all([
        apiFetch("/api/bom-templates"),
        apiFetch("/api/sketch-templates")
      ]);

      if (bomResp.ok) {
        const data = await bomResp.json();
        setBomTemplates(data.templates || []);
      }

      if (sketchResp.ok) {
        const sData = await sketchResp.json();
        const parsedTemplates = (sData.templates || []).map((t: any) => {
          // Use pre-calculated fields from optimized API
          return {
            ...t,
            itemCount: t.item_count ?? 0,
            created_at: t.last_updated
          };
        });
        setSketchTemplates(parsedTemplates);
      }
    } catch (e) {
      console.error("Failed to load templates:", e);
    }
  }, []);

  const fetchSystemSettings = useCallback(async () => {
    try {
      const resp = await apiFetch("/api/system-settings/bom_buttons_enabled");
      if (resp.ok) {
        const data = await resp.json();
        setBomButtonsEnabled(data.value === "true");
      }
    } catch (err) {
      console.error("Failed to fetch system settings", err);
    }
  }, []);

  useEffect(() => {
    fetchSystemSettings();
  }, [fetchSystemSettings]);

  const toggleBomButtons = async () => {
    const newValue = !bomButtonsEnabled;
    try {
      const resp = await apiFetch("/api/system-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "bom_buttons_enabled", value: String(newValue) })
      });
      if (resp.ok) {
        setBomButtonsEnabled(newValue);
        toast({ title: newValue ? "Buttons Enabled" : "Buttons Disabled", description: `BOM modification buttons are now ${newValue ? "enabled" : "disabled"} globally.` });
      }
    } catch (err) {
      console.error("Failed to toggle BOM buttons", err);
      toast({ title: "Error", description: "Failed to update settings", variant: "destructive" });
    }
  };

  const fetchApprovals = useCallback(async () => {
    try {
      setLoadingApprovals(true);
      const res = await apiFetch("/api/bom-approvals");
      if (res.ok) {
        const data = await res.json();
        // Strictly filter for BOM type to separate from BOQ approvals
        const filtered = (data.approvals || []).filter((a: any) =>
          (a.type === 'bom' || !a.type)
        );
        setApprovals(filtered);
        try {
          const rateRes = await apiFetch("/api/bom-rate-changes/all");
          if (rateRes.ok) {
            const rateData = await rateRes.json();
            setRateChangeRequests(rateData.rateChanges || []);
          }
        } catch (e) {
          console.error("Failed to fetch rate changes", e);
        }
      }
    } catch (err) {
      console.error("Failed to load BOM approvals:", err);
    } finally {
      setLoadingApprovals(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "approvals" && (user?.role === 'admin' || user?.role === 'software_team')) {
      fetchApprovals();
    }
  }, [activeTab, user?.role, fetchApprovals]);


  const handleRateAction = async (id: string, action: 'approve' | 'reject') => {
    try {
      setRateActionLoading(id);
      const res = await apiFetch(`/api/bom-rate-changes/${id}/${action}`, { method: 'POST' });
      if (!res.ok) throw new Error("Failed to update rate change");
      toast({ title: "Success", description: `Rate change ${action}d successfully` });
      fetchApprovals(); // Refresh the list
    } catch (err) {
      toast({ title: "Error", description: `Failed to ${action} rate change`, variant: "destructive" });
    } finally {
      setRateActionLoading(null);
    }
  };

  const handleApprovalAction = async (id: string, action: 'approve' | 'reject' | 'approve-edit' | 'reject-edit') => {
    let reason = "";
    if (action === 'reject' || action === 'reject-edit') {
      const r = prompt("Please enter a reason for rejection:");
      if (r === null) return;
      reason = r;
    } else {
      const confirmMsg = action === 'approve-edit' ? "Approve this edit request?" : "Approve this BOM version?";
      if (!confirm(confirmMsg)) return;
    }

    setApprovalActionLoading(id);
    try {
      const res = await apiFetch(`/api/bom-approvals/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: reason ? JSON.stringify({ reason }) : undefined
      });

      if (res.ok) {
        toast({ title: "Success", description: `BOM ${action.replace('-', ' ')}ed successfully.` });
        fetchApprovals();
        if (previewApprovalId === id) setPreviewApprovalId(null);
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.message || `Failed to ${action}`, variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error", description: `Failed to ${action}`, variant: "destructive" });
    } finally {
      setApprovalActionLoading(null);
    }
  };

  const handlePreviewApproval = async (approval: any) => {
    setPreviewApprovalId(approval.id);
    setLoadingPreviewItems(true);
    try {
      const res = await apiFetch(`/api/boq-items/version/${approval.id}`);
      if (res.ok) {
        const data = await res.json();
        setPreviewApprovalItems(data.items || []);
      }
    } catch (err) {
      console.error("Failed to load items for preview:", err);
    } finally {
      setLoadingPreviewItems(false);
    }
  };

  const handleSaveAsTemplate = async (name: string, config: any) => {
    try {
      const resp = await apiFetch("/api/bom-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, config }),
      });
      if (resp.ok) {
        toast({ title: "Template Saved", description: `"${name}" has been saved as a BOM template.` });
        loadTemplates();
        setShowSaveTemplateDialog(false);
        setNewTemplateName("");
      } else {
        const error = await resp.json();
        toast({ title: "Error", description: error.message || "Failed to save template", variant: "destructive" });
      }
    } catch (e) {
      console.error("Save template error:", e);
      toast({ title: "Error", description: "Failed to connect to server", variant: "destructive" });
    }
  };

  const handleApplyTemplate = async (template: any) => {
    if (!selectedVersionId) {
      toast({ title: "Version Required", description: "Please select or create a BOQ version first before applying templates.", variant: "destructive" });
      return;
    }
    if (isSaving) return;
    setIsSaving(true);

    try {
      // Resolve latest category from master data if possible
      let finalConfig = { ...template.config };
      if (finalConfig.product_id) {
        try {
          const prodRes = await apiFetch("/api/products");
          if (prodRes.ok) {
            const { products } = await prodRes.json();
            const master = products.find((p: any) => String(p.id) === String(finalConfig.product_id));
            if (master) {
              const latestCat = master.category_name || master.category;
              if (latestCat) {
                finalConfig.category = latestCat;
                finalConfig.category_name = latestCat;
              }
            }
          }
        } catch (e) { console.warn("Template category resolution failed", e); }
      }

      const newItem = {
        project_id: selectedProjectId,
        version_id: selectedVersionId,
        estimator: (finalConfig.product_name || "Template Product").substring(0, 50),
        table_data: finalConfig,
        sort_order: boqItems.length,
      };

      const resp = await apiFetch("/api/boq-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newItem),
      });

      if (resp.ok) {
        toast({ title: "Template Applied", description: `"${template.name}" added to BOM.` });
        const created = await resp.json();
        const itemWithParsedData = { ...created, table_data: parseTableData(created.table_data) };
        setBoqItems(prev => [...prev, itemWithParsedData]);
        setExpandedProductIds(prev => {
          const next = new Set(prev);
          next.add(created.id);
          return next;
        });
        setShowTemplateManager(false);

      } else {
        const errorData = await resp.json();
        toast({ title: "Error", description: errorData.message || "Failed to apply template", variant: "destructive" });
      }
    } catch (e) {
      console.error("Apply template error:", e);
      toast({ title: "Error", description: "Failed to apply template", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleApplySketchTemplate = async (template: any) => {
    if (!selectedProjectId || !selectedVersionId) {
      toast({ title: "Version Required", description: "Please select or create a BOQ version first before applying sketch templates.", variant: "destructive" });
      return;
    }
    if (isSaving) return;
    setIsSaving(true);

    try {
      let data = template.template_data;

      // If template_data is missing (due to optimized list API), fetch full details
      if (!data) {
        const detailResp = await apiFetch(`/api/sketch-templates/${template.id}`);
        if (detailResp.ok) {
          const detailData = await detailResp.json();
          data = detailData.template?.template_data;
        } else {
          toast({ title: "Error", description: "Failed to fetch template details", variant: "destructive" });
          setIsSaving(false);
          return;
        }
      }

      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { console.error("Parse error", e); setIsSaving(false); return; }
      }

      const items = Array.isArray(data) ? data : (data?.items || []);

      if (items.length === 0) {
        toast({ title: "Empty Template", description: "This sketch template has no items.", variant: "destructive" });
        setIsSaving(false);
        return;
      }

      // 1. Fetch products & materials once to avoid over-fetching in loops
      const [prodResp, matResp] = await Promise.all([
        apiFetch("/api/products"),
        apiFetch("/api/materials")
      ]);

      const allProds: Product[] = prodResp.ok ? (await prodResp.json()).products || [] : [];
      const allMats: any[] = matResp.ok ? (await matResp.json()).materials || [] : [];
      const matMap = Object.fromEntries(allMats.map(m => [m.id, m]));

      toast({ title: "Importing Sketch", description: `Processing ${items.length} items...` });

      const batchItems = [];

      // To prevent duplicates within the sketch import itself, we will track added items by name + material_id
      const batchAddedMap = new Set();

      for (const item of items) {
        const itemName = (item.item_name || "").toLowerCase().trim();
        const mId = item.material_id || item.id;
        const area = (item.category_name || item.category || "General").trim();
        const cleanName = itemName.replace(/\s+/g, '').toLowerCase();
        // Check if this exact item was already added in this batch
        const batchKey = `${cleanName}-${mId}`;
        if (batchAddedMap.has(batchKey)) {
          console.log(`Skipping duplicate sketch item within batch: ${itemName}`);
          continue;
        }
        batchAddedMap.add(batchKey);

        // Try to find a matching product
        const matchedProd = allProds.find(p => {
          const pId = String(p.id);
          const sMId = mId ? String(mId) : null;
          const pName = (p.name || "").toLowerCase().replace(/\s+/g, ' ').trim();
          const cleanItemName = itemName.replace(/\s+/g, ' ').trim();

          const idMatch = sMId && pId === sMId;
          const nameMatch = pName === cleanItemName;

          if (idMatch && !nameMatch) {
            console.log(`[SketchImport] Found match by ID for "${itemName}" (ID=${mId}) -> DB name is "${p.name}"`);
          }
          return idMatch || nameMatch;
        });

        const dims = [item.length, item.width, item.height].filter(Boolean).filter(d => d !== "0" && d !== "").join(' x ');
        const itemDesc = item.item_description || item.description || '';
        const desc = `${itemDesc} ${dims ? `(Dims: ${dims} ${item.dimension_unit || ''})` : ''}`.trim();
        // Resolve qty from sketch template item - try all possible field names
        const rawQty = item.qty ?? item.quantity ?? item.qty_required ?? item.requiredQty ?? item.targetRequiredQty;
        const qty = (rawQty !== null && rawQty !== undefined && Number(rawQty) > 0) ? Number(rawQty) : 1;
        console.log(`[SketchImport] item="${item.item_name}" rawQty=${rawQty} resolvedQty=${qty}`);

        if (matchedProd) {
          // It's a product! Fetch its config.
          // Priority: Step 3 draft config → Step 11 approved config → manual fallback.
          let resolvedConfigLines: any[] | null = null;
          let resolvedConfig: any | null = null;

          // --- Try Step 3 (draft) config first ---
          try {
            const configRes = await apiFetch(`/api/product-step3-config/${matchedProd.id}`);
            if (configRes.ok) {
              const { items: configLines, config } = await configRes.json();
              if (configLines && configLines.length > 0) {
                resolvedConfigLines = configLines;
                resolvedConfig = config;
                console.log(`[SketchImport] "${matchedProd.name}" resolved via Step3 config (${configLines.length} materials)`);
              }
            }
          } catch (e) {
            console.warn("[SketchImport] Step3 config fetch failed for", matchedProd.name, e);
          }

          // --- Fallback: Try Step 11 (approved) config if Step 3 not available ---
          if (!resolvedConfigLines) {
            try {
              const approvedRes = await apiFetch(`/api/step11-products/${matchedProd.id}`);
              if (approvedRes.ok) {
                const { configurations } = await approvedRes.json();
                // Pick the first approved config, else first available
                const approvedCfg = (configurations || []).find((c: any) => c.product?.status === 'approved') || configurations?.[0];
                if (approvedCfg && approvedCfg.items && approvedCfg.items.length > 0) {
                  resolvedConfigLines = approvedCfg.items;
                  resolvedConfig = approvedCfg.product;
                  console.log(`[SketchImport] "${matchedProd.name}" resolved via Step11 approved config (${approvedCfg.items.length} materials)`);
                }
              }
            } catch (e) {
              console.warn("[SketchImport] Step11 config fetch failed for", matchedProd.name, e);
            }
          }

          if (resolvedConfigLines && resolvedConfigLines.length > 0 && resolvedConfig) {
            const materialLines = resolvedConfigLines.map((it: any) => {
              // baseQty: the qty-per-unit-area for this material.
              // Try: base_qty first (explicit per-unit qty), then qty (legacy). Never silently allow 0.
              const rawBaseQty = it.base_qty ?? it.qty ?? null;
              const baseQty = (rawBaseQty !== null && rawBaseQty !== undefined) ? Number(rawBaseQty) : 0;
              if (baseQty === 0) {
                console.warn(`[SketchImport] material "${it.material_name}" has baseQty=0 (base_qty=${it.base_qty}, qty=${it.qty}). Qty=0 will appear in BOM.`);
              }
              return {
                id: it.material_id,
                name: it.material_name,
                unit: it.unit,
                baseQty,
                wastagePct: it.wastage_pct != null ? Number(it.wastage_pct) : undefined,
                supplyRate: Number(it.supply_rate ?? it.rate ?? 0),
                installRate: Number(it.install_rate ?? 0),
                shop_name: it.shop_name,
                freezeAndEdit: it.freezeAndEdit || it.freeze_and_edit,
                freeze_and_edit: it.freezeAndEdit || it.freeze_and_edit,
                applyWastage: it.apply_wastage !== false,
                category: area,
                is_project_pricing: it.is_project_pricing === true
              };
            });

            batchItems.push({
              estimator: matchedProd.name.substring(0, 50),
              table_data: {
                product_name: matchedProd.name,
                product_id: matchedProd.id,
                image: matchedProd.image,
                category: area,
                category_name: area,
                hsn_sac_type: matchedProd.tax_code_type || null,
                hsn_sac_code: matchedProd.tax_code_value || null,
                hsn_code: matchedProd.hsn_code || null,
                sac_code: matchedProd.sac_code || null,
                targetRequiredQty: qty,
                configBasis: {
                  requiredUnitType: resolvedConfig.required_unit_type || resolvedConfig.basis_unit || "Sqft",
                  baseRequiredQty: Number(resolvedConfig.base_required_qty || resolvedConfig.basis_qty || 1),
                  wastagePctDefault: Number(resolvedConfig.wastage_pct_default || 0)
                },
                materialLines,
                step11_items: [],
                finalize_description: resolvedConfig?.description || desc || matchedProd.name,
                created_at: new Date().toISOString()
              }
            });
            continue;
          }
        }

        // Fallback: Manual Item (either product config failed or it's a raw material)
        let rate = Number(item.rate ?? item.price ?? item.unit_rate ?? item.unitRate ?? (item.amount && qty > 0 ? Number(item.amount) / qty : undefined) ?? 0) || 0;
        let hsn = "";
        let sac = "";
        let taxType = null;
        let taxValue = "";

        const mat = matMap[mId] || allMats.find(m => {
          const mName = (m.name || "").toLowerCase().replace(/\s+/g, ' ').trim();
          const cleanItemName = itemName.replace(/\s+/g, ' ').trim();
          return mName === cleanItemName;
        });

        if (mat) {
          if (rate === 0) rate = Number(mat.rate || 0);
          hsn = mat.hsn_code || mat.template_hsn_code || "";
          sac = mat.sac_code || mat.template_sac_code || "";
          taxType = mat.tax_code_type || (hsn ? "hsn" : (sac ? "sac" : null));
          taxValue = mat.tax_code_value || hsn || sac || "";
          console.log(`[SketchImport] manual fallback for "${itemName}" resolved via Material library match (rate=${rate})`);
        } else {
          console.warn(`[SketchImport] manual fallback for "${itemName}" (ID=${mId}) - NO matching product config or material found. Rate will be 0.`);
          if (matchedProd) {
            console.warn(`[SketchImport] Note: "${itemName}" matched product "${matchedProd.name}" but it has NO valid config in DB.`);
          }
        }

        batchItems.push({
          estimator: "General",
          table_data: {
            product_name: item.item_name || "Sketch Item",
            product_id: null,
            material_id: mId || null,
            hsn_code: hsn,
            sac_code: sac,
            hsn_sac_type: taxType,
            hsn_sac_code: taxValue,
            category: area,
            category_name: area,
            finalize_description: desc,
            finalize_qty: qty,
            targetRequiredQty: qty,
            finalize_rate: rate,
            unit: item.dimension_unit || item.unit || "nos",
            step11_items: [
              {
                s_no: 1,
                material_id: mId || null,
                title: item.item_name || "Sketch Item",
                description: desc,
                unit: item.dimension_unit || item.unit || "nos",
                qty,
                supply_rate: rate,
                install_rate: 0,
                rate,
                manual: true,
                category: area
              }
            ],
            created_at: new Date().toISOString()
          }
        });
      }

      const resp = await apiFetch("/api/boq-items/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: selectedProjectId,
          version_id: selectedVersionId,
          items: batchItems
        }),
      });

      if (resp.ok) {
        setShowTemplateManager(false);
        toast({ title: "Sketch Imported", description: `${items.length} items added from sketch template.` });
        loadBoqItemsAndEdits();
      } else {
        const errData = await resp.json().catch(() => ({}));
        console.error("Batch import failed details:", errData);
        throw new Error(errData.error || errData.message || "Batch import failed");
      }
    } catch (e) {
      console.error("Apply sketch template error:", e);
      toast({ title: "Error", description: "Failed to import sketch template", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTemplate = (id: string) => {
    const tpl = bomTemplates.find(t => t.id === id);
    if (!tpl) return;
    setDeleteConfirm({ isOpen: true, type: 'template', id, name: tpl.name || "BOM Template" });
  };

  const handleDeleteSketchTemplate = (id: string) => {
    const tpl = sketchTemplates.find(t => t.id === id);
    if (!tpl) return;
    setDeleteConfirm({ isOpen: true, type: 'sketch', id, name: tpl.name || "Sketch Template" });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    const { type, id } = deleteConfirm;

    try {
      if (type === 'template') {
        const resp = await apiFetch(`/api/bom-templates/${id}`, { method: "DELETE" });
        if (resp.ok) {
          toast({ title: "Template deleted permanently" });
          loadTemplates();
        }
      } else if (type === 'version') {
        const res = await apiFetch(`/api/boq-versions/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (res.ok) {
          const r = await apiFetch(`/api/boq-versions/${encodeURIComponent(selectedProjectId!)}`, { headers: {} });
          if (r.ok) {
            const d = await r.json(); const list = d.versions || [];
            setVersions(list);
            const draft = list.find((v: BOMVersion) => v.status === "draft");
            setSelectedVersionId(draft?.id ?? list[0]?.id ?? null);
            setBoqItems([]);
            toast({ title: "Version deleted permanently" });
          }
        }
      } else if (type === 'sketch') {
        const resp = await apiFetch(`/api/sketch-templates/${id}`, { method: "DELETE" });
        if (resp.ok) {
          toast({ title: "Sketch template deleted" });
          loadTemplates();
        }
      }
    } catch (e) {
      console.error("Delete error:", e);
      toast({ title: "Error", description: "Failed to delete", variant: "destructive" });
    } finally {
      setDeleteConfirm(null);
    }
  };
  // Budget warning/modals removed for Generate BOM page per request
  const editedFieldsRef = useRef(editedFields);
  const [location, setLocation] = useLocation();
  const { toast } = useToast();


  useEffect(() => { editedFieldsRef.current = editedFields; }, [editedFields]);

  // Auto-expand new products (kept empty to stay collapsed by default)
  useEffect(() => {
    // setExpandedProductIds(...) removed to stay collapsed by default
  }, [boqItems.length]);

  // Load projects
  useEffect(() => {
    apiFetch("/api/boq-projects", { headers: {} })
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setProjects(d.projects || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // URL Parameter Handling
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pId = params.get("projectId");
    const vId = params.get("versionId");
    if (pId) setSelectedProjectId(pId);
    if (vId) setSelectedVersionId(vId);
  }, []);

  // Load versions when project changes
  useEffect(() => {
    if (!selectedProjectId) { setVersions([]); setSelectedVersionId(null); setBoqItems([]); return; }

    // Fetch all versions (including approved ones)
    apiFetch(`/api/boq-versions/${encodeURIComponent(selectedProjectId)}?type=bom`, { headers: {} })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        let list: BOMVersion[] = data.versions || [];
        const isReadOnlyMode = user?.role === 'finance_team' || user?.role === 'purchase_team';
        if (isReadOnlyMode) {
          list = list.filter((v: BOMVersion) => v.status === 'approved');
        }
        setVersions(list);

        // Priority: 1. Previously selected ID (from URL or state), 2. First Draft, 3. Latest version
        setSelectedVersionId((prev: string | null) => {
          if (prev && list.some((v: BOMVersion) => v.id === prev)) return prev;
          const draft = list.find((v: BOMVersion) => v.status === "draft");
          return draft?.id ?? list[0]?.id ?? null;
        });
      })
      .catch(console.error);

    // Fetch Approved Proposals for this project
    apiFetch(`/api/proposals?projectId=${encodeURIComponent(selectedProjectId)}&status=approved`, { headers: {} })
      .then(r => r.ok ? r.json() : [])
      .then(async d => {
        const list = Array.isArray(d) ? d : (d.proposals || []);
        const approved = list.filter((p: any) => p.status === 'approved');
        setApprovedProposals(approved);

        // Pre-fetch items for all approved proposals to get correct totals upfront
        for (const prop of approved) {
          if (!proposalItemsPreview[prop.id]) {
            try {
              const res = await apiFetch(`/api/proposals/${prop.id}/items`);
              if (res.ok) {
                const items = await res.json();
                setProposalItemsPreview(prev => ({ ...prev, [prop.id]: items }));
              }
            } catch (err) { console.error("Prefetch failed", err); }
          }
        }
      })
      .catch(err => console.warn("Failed to fetch approved proposals", err));
  }, [selectedProjectId]);

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

  // Load Comments
  const loadComments = useCallback(async () => {
    if (!selectedVersionId) { setComments([]); return; }
    try {
      const res = await apiFetch(`/api/boq-comments/${encodeURIComponent(selectedVersionId)}`, { headers: {} });
      if (res.ok) {
        const data = await res.json();
        setComments(data.comments || []);
      }
    } catch (err) {
      console.error("Failed to load comments", err);
    }
  }, [selectedVersionId]);

  // Load Users
  const loadUsers = useCallback(async () => {
    try {
      const res = await apiFetch("/api/users", { headers: {} });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (err) {
      console.error("Failed to load users", err);
    }
  }, []);

  // Load BOQ items
  const loadBoqItemsAndEdits = useCallback(async () => {
    if (!selectedVersionId) return;
    try {
      // Fetch all materials to compare rates
      const materialsRes = await apiFetch("/api/materials");
      if (materialsRes.ok) {
        const materialsData = await materialsRes.json();
        setMaterialsById(Object.fromEntries((materialsData.materials || []).map((m: any) => [m.id, m])));
      } else {
        console.warn("Failed to load materials for rate comparison.");
      }

      const res = await apiFetch(`/api/boq-items/version/${encodeURIComponent(selectedVersionId)}`, { headers: {} });
      if (!res.ok) { toast({ title: "Error", description: `Failed to load items (${res.status})`, variant: "destructive" }); return; }
      const data = await safeJson(res as unknown as Response);
      const items: BOMItem[] = data.items || [];
      // Backfill HSN/SAC and Shop Names
      try {
        const pr = await apiFetch("/api/products");
        if (pr.ok) {
          const pd = await pr.json();
          const prodById: Record<string, any> = Object.fromEntries((pd.products || []).map((p: any) => [p.id, p]));
          items.forEach(item => {
            const td = parseTableData(item.table_data);
            let needsSave = false;

            if (!td.hsn_code && !td.sac_code) {
              if (td.product_id) {
                const prod = prodById[td.product_id];
                if (prod) {
                  if (prod.hsn_code) { td.hsn_code = prod.hsn_code; needsSave = true; }
                  if (prod.sac_code) { td.sac_code = prod.sac_code; needsSave = true; }
                  if (prod.tax_code_value) { td.hsn_sac_code = prod.tax_code_value; td.hsn_sac_type = prod.tax_code_type || null; needsSave = true; }
                }
              } else if (td.material_id && materialsById[td.material_id]) {
                const mat = materialsById[td.material_id];
                if (mat.hsn_code || mat.template_hsn_code) { td.hsn_code = mat.hsn_code || mat.template_hsn_code; needsSave = true; }
                if (mat.sac_code || mat.template_sac_code) { td.sac_code = mat.sac_code || mat.template_sac_code; needsSave = true; }
                if (mat.tax_code_value || mat.hsn_sac_code) {
                  td.hsn_sac_code = mat.tax_code_value || mat.hsn_sac_code;
                  td.hsn_sac_type = mat.tax_code_type || mat.hsn_sac_type || null;
                  needsSave = true;
                }
              }
            }

            if (td.step11_items && Array.isArray(td.step11_items)) {
              td.step11_items.forEach((s11: any) => {
                if (!s11.shop_name || s11.shop_name === "-") {
                  const matId = s11.material_id || s11.id;
                  if (matId && materialsById[matId]) {
                    const mat = materialsById[matId];
                    if (mat.shop_name && mat.shop_name !== "-") {
                      s11.shop_name = mat.shop_name;
                      needsSave = true;
                    }
                  }
                }
              });
            }

            if (needsSave) {
              item.table_data = td;
              apiFetch(`/api/boq-items/${item.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ table_data: td })
              }).catch(e => console.error("Auto-save backfill failed", e));
            }
          });
        }
      } catch (e) { console.warn("Backfill error", e); }
      setBoqItems(items);
      loadHistory();
    } catch { toast({ title: "Error", description: "Failed to load BOQ items", variant: "destructive" }); }
  }, [selectedVersionId, toast, loadHistory]);

  // ─── Refresh Categories ──────────────────────────────────────────────────────
  const handleRefreshCategories = useCallback(async () => {
    if (!selectedVersionId || isRefreshingCategories) return;
    setIsRefreshingCategories(true);
    try {
      const res = await apiFetch("/api/boq-items/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version_id: selectedVersionId })
      });

      if (!res.ok) throw new Error("Failed to refresh categories");
      const result = await res.json();

      if (result.success) {
        // Reload items from server to get updated data
        const itemsRes = await apiFetch(`/api/boq-items/version/${selectedVersionId}`);
        if (itemsRes.ok) {
          const data = await itemsRes.json();
          setBoqItems(data.items || []);
        }

        if (result.updatedCount === 0) {
          toast({
            title: "Already Up to Date",
            description: "All item categories match the master library.",
          });
        } else {
          setRefreshLog(result.changeLog || []);
          setShowRefreshLogDialog(true);
          toast({
            title: "Refresh Complete",
            description: `${result.updatedCount} items were updated with latest master library data.`,
          });
        }
      }
    } catch (err) {
      console.error("Refresh categories error:", err);
      toast({
        title: "Error",
        description: "Failed to refresh categories. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRefreshingCategories(false);
    }
  }, [selectedVersionId, isRefreshingCategories, toast]);

  const handleSendComment = async () => {
    if (!newComment.trim() || !commentTarget || !selectedVersionId) return;
    setIsSaving(true);

    // Automatically make replies visible to the person you are replying to (like a direct message)
    let finalVisibleTo = [...selectedMembers];
    if (replyingTo?.user_id) {
      const repliedUser = users.find(u => u.id === replyingTo.user_id)?.username;
      if (repliedUser && !finalVisibleTo.includes(repliedUser)) {
        finalVisibleTo.push(repliedUser);
      }
    }

    try {
      const res = await apiFetch("/api/boq-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version_id: selectedVersionId,
          product_id: commentTarget.type === 'product' ? commentTarget.id : null,
          item_id: commentTarget.type === 'item' ? commentTarget.id : null,
          comment_text: newComment.trim(),
          visible_to: finalVisibleTo,
          parent_id: replyingTo?.id || null,
          reply_to_text: replyingTo?.comment_text || null,
          reply_to_user: replyingTo?.user_full_name || null
        })
      });

      if (res.ok) {
        await loadComments();
        setNewComment("");
        setSelectedMembers([]);
        setReplyingTo(null);
      } else {
        toast({ title: "Error", description: "Failed to send comment", variant: "destructive" });
      }
    } catch (err) {
      console.error("Failed to add comment", err);
      toast({ title: "Error", description: "Failed to add comment", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!selectedVersionId) { setBoqItems([]); setEditedFields({}); editedFieldsRef.current = {}; return; }
    loadBoqItemsAndEdits();
    loadHistory();
    loadComments();
    loadTemplates();
  }, [selectedVersionId, loadBoqItemsAndEdits, loadHistory, loadComments, loadTemplates]);

  // Load users once on component mount
  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleImportApprovedProposal = async (proposalId: string) => {
    if (!selectedVersionId || !selectedProjectId) return;

    const prop = approvedProposals.find((p: any) => p.id === proposalId);
    if (!prop) return;

    if (!confirm(`Import items from approved proposal "${prop.vendor_name} (V${prop.version_number})"? This will add items to your current BOM draft.`)) return;

    setIsSaving(true);
    try {
      // Fetch items for this proposal
      const res = await apiFetch(`/api/proposals/${proposalId}/items`);
      if (!res.ok) throw new Error("Failed to load proposal items");
      const items = await res.json();

      if (!items || items.length === 0) {
        toast({ title: "No Items", description: "This proposal has no items to import." });
        setIsSaving(false);
        return;
      }

      toast({ title: "Importing Proposal", description: `Adding ${items.length} items from ${prop.vendor_name}...` });

      const batchItems = items.map((item: any) => {
        return {
          estimator: "General",
          table_data: {
            product_name: item.item_name || "Vendor Item",
            product_id: null,
            material_id: item.material_id || null,
            category: "Vendor Proposal",
            finalize_description: item.remarks || "",
            finalize_qty: Number(item.qty) || 1,
            finalize_rate: Number(item.rate) || 0,
            unit: item.unit || "nos",
            is_finalized: true, // Auto-finalize vendor items
            vendor_id: prop.vendor_id,
            vendor_name: prop.vendor_name,
            step11_items: [
              {
                s_no: 1,
                material_id: item.material_id || null,
                title: item.item_name || "Vendor Item",
                description: item.remarks || "",
                unit: item.unit || "nos",
                qty: Number(item.qty) || 1,
                supply_rate: Number(item.rate) || 0,
                install_rate: 0,
                manual: true,
                category: "Vendor Proposal"
              }
            ],
            created_at: new Date().toISOString()
          }
        };
      });

      const resp = await apiFetch("/api/boq-items/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: selectedProjectId,
          version_id: selectedVersionId,
          items: batchItems
        }),
      });

      if (resp.ok) {
        toast({ title: "Success", description: `${items.length} items imported from vendor proposal.` });
        loadBoqItemsAndEdits();
      } else {
        throw new Error("Batch import failed");
      }
    } catch (err: any) {
      console.error("Import proposal error:", err);
      toast({ title: "Import Failed", description: err.message || "Failed to import vendor proposal", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const mismatches = useMemo(() => {
    const list: any[] = [];
    boqItems.forEach(boqItem => {
      const td = parseTableData(boqItem.table_data);
      const productName = td.product_name || boqItem.estimator || "Unknown Product";
      if (td.materialLines) {
        td.materialLines.forEach((ml: any, idx: number) => {
          const latest = materialsById[ml.id || ml.materialId];
          if (latest && latest.rate > ml.supplyRate) {
            list.push({ boqItemId: boqItem.id, type: 'materialLine', index: idx, old: ml.supplyRate, new: latest.rate, name: ml.materialName || ml.name || latest.name || "Material", productName });
          }
        });
      }
      if (td.step11_items) {
        td.step11_items.forEach((s11: any, idx: number) => {
          const latest = materialsById[s11.id];
          if (latest && latest.rate > (s11.supply_rate || 0)) {
            list.push({ boqItemId: boqItem.id, type: 'step11', index: idx, old: (s11.supply_rate || 0), new: latest.rate, name: s11.title || latest.name || "Item", productName });
          }
        });
      }
    });
    return list;
  }, [boqItems, materialsById]);

  const handleRefreshRates = async () => {
    if (!selectedVersionId || isUpdatingRates) return;
    if (!confirm("This will pull current rates from the materials master table for all items in this version. Continue?")) return;

    setIsUpdatingRates(true);
    try {
      const response = await apiFetch(`/api/boq-versions/${selectedVersionId}/refresh-rates`, {
        method: "POST"
      });
      if (response.ok) {
        const data = await response.json();
        if (data.updatedItems && data.updatedItems.length > 0) {
          // Merge updated items into local state
          setBoqItems((prev) => {
            const byId = new Map(prev.map((i) => [i.id, i]));
            for (const up of data.updatedItems) {
              const td = typeof up.table_data === "string" ? JSON.parse(up.table_data) : up.table_data;
              const existing = byId.get(up.id) || {};
              // Ensure table_data is parsed
              byId.set(up.id, { ...existing, ...up, table_data: td });
            }
            return prev.map((p) => byId.get(p.id) || p);
          });
          toast({ title: "Rates Refreshed", description: data.message });
        } else {
          toast({ title: "Up to Date", description: "All rates are already current." });
        }
      }
    } catch (e) {
      console.error("Failed to refresh rates", e);
      toast({ title: "Error", description: "Failed to refresh rates", variant: "destructive" });
    } finally {
      setIsUpdatingRates(false);
    }
  };

  const activeMismatches = useMemo(() => {
    return mismatches.filter(m => !ignoredMismatches.has(`${m.boqItemId}-${m.type}-${m.index}`));
  }, [mismatches, ignoredMismatches]);

  const handleUpdateAllRates = async () => {
    if (activeMismatches.length === 0 || isUpdatingRates) return;
    if (!confirm(`This will update rates for ${activeMismatches.length} items to the latest market prices. Continue?`)) return;

    setIsUpdatingRates(true);
    try {
      // Group mismatches by boqItemId to minimize API calls
      const byBoqItem: Record<string, any[]> = {};
      activeMismatches.forEach(m => {
        if (!byBoqItem[m.boqItemId]) byBoqItem[m.boqItemId] = [];
        byBoqItem[m.boqItemId].push(m);
      });

      const updates = Object.entries(byBoqItem).map(async ([boqItemId, ms]) => {
        const boqItem = boqItems.find(i => i.id === boqItemId);
        if (!boqItem) return;

        const td = parseTableData(boqItem.table_data);
        ms.forEach(m => {
          if (m.type === 'materialLine') {
            td.materialLines[m.index].supplyRate = m.new;
          } else if (m.type === 'step11') {
            td.step11_items[m.index].supply_rate = m.new;
          }
        });

        return apiFetch(`/api/boq-items/${boqItemId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ table_data: td }),
        });
      });

      await Promise.all(updates);
      toast({ title: "Success", description: "All rates updated successfully" });
      loadBoqItemsAndEdits();
    } catch (err) {
      console.error(err);
      toast({ title: "Error", description: "Failed to update rates", variant: "destructive" });
    } finally {
      setIsUpdatingRates(false);
    }
  };

  const handleUpdateSingleMismatch = async (m: any) => {
    setIsUpdatingRates(true);
    try {
      const boqItem = boqItems.find(i => i.id === m.boqItemId);
      if (!boqItem) return;

      const td = parseTableData(boqItem.table_data);
      if (m.type === 'materialLine') {
        td.materialLines[m.index].supplyRate = m.new;
      } else if (m.type === 'step11') {
        td.step11_items[m.index].supply_rate = m.new;
      }

      await apiFetch(`/api/boq-items/${m.boqItemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table_data: td }),
      });
      toast({ title: "Success", description: `Updated rate for ${m.name}` });
      loadBoqItemsAndEdits();
    } catch (err) {
      console.error(err);
      toast({ title: "Error", description: "Failed to update rate", variant: "destructive" });
    } finally {
      setIsUpdatingRates(false);
    }
  };

  const handleIgnoreMismatch = (m: any) => {
    setIgnoredMismatches(prev => {
      const next = new Set(prev);
      next.add(`${m.boqItemId}-${m.type}-${m.index}`);
      return next;
    });
  };

  const ppMatches = useMemo(() => {
    const list: any[] = [];
    boqItems.forEach(boqItem => {
      const td = parseTableData(boqItem.table_data);
      const productName = td.product_name || boqItem.estimator || "Unknown Product";
      if (td.materialLines) {
        td.materialLines.forEach((ml: any, idx: number) => {
          if (!ml.is_project_pricing) {
            const currentMat = materialsById[ml.id || ml.materialId];
            const templateId = currentMat?.template_id || ml.template_id;
            if (templateId) {
              const ppAlt = Object.values(materialsById).find(mat => mat.template_id === templateId && mat.is_project_pricing);
              if (ppAlt) {
                list.push({ boqItemId: boqItem.id, type: 'materialLine', index: idx, currentRate: ml.supplyRate, ppRate: ppAlt.rate, name: ml.materialName || ml.name || "Material", productName, ppAlt });
              }
            }
          }
        });
      }
      if (td.step11_items) {
        td.step11_items.forEach((s11: any, idx: number) => {
          if (!s11.is_project_pricing) {
            const currentMat = materialsById[s11.id];
            const templateId = currentMat?.template_id || s11.template_id;
            if (templateId) {
              const ppAlt = Object.values(materialsById).find(mat => mat.template_id === templateId && mat.is_project_pricing);
              if (ppAlt) {
                list.push({ boqItemId: boqItem.id, type: 'step11', index: idx, currentRate: (s11.supply_rate || 0), ppRate: ppAlt.rate, name: s11.title || "Item", productName, ppAlt });
              }
            }
          }
        });
      }
    });
    return list;
  }, [boqItems, materialsById]);

  const activePpMatches = useMemo(() => {
    return ppMatches.filter(m => !ignoredPpMismatches.has(`${m.boqItemId}-${m.type}-${m.index}`));
  }, [ppMatches, ignoredPpMismatches]);

  const handleUpdateAllPp = async () => {
    if (activePpMatches.length === 0 || isUpdatingRates) return;
    setIsUpdatingRates(true);
    try {
      const byBoqItem: Record<string, any[]> = {};
      activePpMatches.forEach(m => {
        if (!byBoqItem[m.boqItemId]) byBoqItem[m.boqItemId] = [];
        byBoqItem[m.boqItemId].push(m);
      });

      const updates = Object.entries(byBoqItem).map(async ([boqItemId, ms]) => {
        const boqItem = boqItems.find(i => i.id === boqItemId);
        if (!boqItem) return;

        const td = parseTableData(boqItem.table_data);
        ms.forEach(m => {
          if (m.type === 'materialLine') {
            td.materialLines[m.index].supplyRate = m.ppRate;
            td.materialLines[m.index].is_project_pricing = true;
            td.materialLines[m.index].materialId = m.ppAlt.id;
          } else if (m.type === 'step11') {
            td.step11_items[m.index].supply_rate = m.ppRate;
            td.step11_items[m.index].is_project_pricing = true;
            td.step11_items[m.index].id = m.ppAlt.id;
          }
        });

        return apiFetch(`/api/boq-items/${boqItemId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ table_data: td }),
        });
      });

      await Promise.all(updates);
      toast({ title: "Success", description: "Applied Project Pricing" });
      loadBoqItemsAndEdits();
    } catch (err) {
      console.error(err);
      toast({ title: "Error", description: "Failed to apply project pricing", variant: "destructive" });
    } finally {
      setIsUpdatingRates(false);
    }
  };

  const handleUpdateSinglePp = async (m: any) => {
    setIsUpdatingRates(true);
    try {
      const boqItem = boqItems.find(i => i.id === m.boqItemId);
      if (!boqItem) return;

      const td = parseTableData(boqItem.table_data);
      if (m.type === 'materialLine') {
        td.materialLines[m.index].supplyRate = m.ppRate;
        td.materialLines[m.index].is_project_pricing = true;
        td.materialLines[m.index].materialId = m.ppAlt.id;
      } else if (m.type === 'step11') {
        td.step11_items[m.index].supply_rate = m.ppRate;
        td.step11_items[m.index].is_project_pricing = true;
        td.step11_items[m.index].id = m.ppAlt.id;
      }

      await apiFetch(`/api/boq-items/${m.boqItemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table_data: td }),
      });
      toast({ title: "Success", description: `Applied project pricing for ${m.name}` });
      loadBoqItemsAndEdits();
    } catch (err) {
      console.error(err);
      toast({ title: "Error", description: "Failed to apply project pricing", variant: "destructive" });
    } finally {
      setIsUpdatingRates(false);
    }
  };

  const handleIgnoreSinglePp = (m: any) => {
    setIgnoredPpMismatches(prev => {
      const next = new Set(prev);
      next.add(`${m.boqItemId}-${m.type}-${m.index}`);
      return next;
    });
  };

  const handleViewMismatch = (m: any) => {
    setExpandedProductIds(prev => new Set(prev).add(m.boqItemId));
    // Optional: scroll to the element. We'll add a slight delay to allow expansion.
    setTimeout(() => {
      const el = document.getElementById(`boq-item-card-${m.boqItemId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Flash effect
        el.classList.add('ring-2', 'ring-blue-500');
        setTimeout(() => el.classList.remove('ring-2', 'ring-blue-500'), 1500);
      }
    }, 100);
  };


  // Auto-select project and version from URL
  useEffect(() => {
    try {
      const qs = window.location.search || "";
      const params = new URLSearchParams(qs);
      const projectParam = params.get("projectId") || params.get("project");
      const versionParam = params.get("versionId") || params.get("version");

      if (projectParam && projectParam !== selectedProjectId && projects.find(p => p.id === projectParam)) {
        setSelectedProjectId(projectParam);
      }

      // We can only set version if the versions array is loaded and contains the versionId.
      // But versions array is loaded based on selectedProjectId. 
      // If versionParam is present, it will be set once versions array is loaded.
      if (versionParam && versionParam !== selectedVersionId && versions.find(v => v.id === versionParam)) {
        setSelectedVersionId(versionParam);
      }
    } catch { /* ignore */ }
  }, [window.location.search, projects, versions]);

  // Listen for top header 'Approvals' click to open the in-page modal directly
  useEffect(() => {
    const handleOpen = () => {
      setApprovalsModalOpen(true);
      fetchApprovals();
    };
    window.addEventListener('open-bom-approvals', handleOpen);
    return () => window.removeEventListener('open-bom-approvals', handleOpen);
  }, [fetchApprovals]);

  // ── Rate Amendment Guard ──────────────────────────────────────────────────
  // 'draft'   = user typed a new rate locally, not yet sent to admin for approval.
  // 'pending' = already sent to admin (POST /api/bom-rate-changes succeeded), awaiting decision.
  // Check both in-memory edits AND already-saved table_data for either status.
  const rateAmendmentSummary = useMemo(() => {
    const draftItems: Array<{
      boqItemId: string; itemKey: string; materialId: string; materialName: string;
      productName: string; projectId: string; projectName: string; originalRate: number; requestedRate: number;
    }> = [];
    let hasPending = false;

    for (const boqItem of boqItems) {
      let td: any;
      try {
        td = typeof boqItem.table_data === 'string' ? JSON.parse(boqItem.table_data) : boqItem.table_data;
      } catch { continue; }
      if (!td) continue;
      const productName = td.product_name || (boqItem as any).estimator || '';
      const projectId = td.project_id || boqItem.id;
      const projectName = td.project_name || productName;

      const materialLines: any[] = td.materialLines || [];
      const step11Items: any[] = td.step11_items || [];
      const processLine = (line: any, idx: number, prefix: 'engine' | 'manual') => {
        const itemKey = line.itemKey || `${boqItem.id}-${prefix}-${idx}`;
        // Backend "approved"/"rejected" is a resolved outcome and always wins over a stale
        // local "pending" flag left in editedFields from when this browser session submitted it.
        const backendStatus = line.rate_amendment_status;
        const status = (backendStatus === 'approved' || backendStatus === 'rejected')
          ? backendStatus
          : (editedFields[itemKey]?.rate_amendment_status ?? backendStatus);
        if (status === 'pending') { hasPending = true; return; }
        if (status === 'draft') {
          // IMPORTANT: raw engine (materialLines) rows store their rate as
          // supplyRate/installRate (camelCase). Raw manual (step11) rows store
          // it as supply_rate/install_rate (snake_case). Using the wrong casing
          // as a fallback silently resolves to 0 whenever the editedFields
          // lookup misses — which is exactly why "inside product" items were
          // showing ₹0.00 while directly-added items were not.
          const rawSupply = prefix === 'engine' ? Number(line.supplyRate ?? 0) : Number(line.supply_rate ?? 0);
          const rawInstall = prefix === 'engine' ? Number(line.installRate ?? 0) : Number(line.install_rate ?? 0);
          const rawOriginal = prefix === 'engine' ? (rawSupply + rawInstall) : (line.original_rate ?? line.original_engine_rate);
          const requestedRate = editedFields[itemKey]?.rate ?? line.rate ?? line.rateSqft ?? (rawSupply + rawInstall);
          const originalRate = editedFields[itemKey]?.original_rate ?? line.original_rate ?? line.original_engine_rate ?? rawOriginal;
          draftItems.push({
            boqItemId: boqItem.id,
            itemKey,
            materialId: line.id || line.materialId || line.name,
            materialName: line.title || line.name || 'Unknown',
            productName,
            projectId,
            projectName,
            originalRate: Number(originalRate) || 0,
            requestedRate: Number(requestedRate) || 0,
          });
        }
      };
      materialLines.forEach((line, idx) => processLine(line, idx, 'engine'));
      step11Items.forEach((line, idx) => processLine(line, idx, 'manual'));
    }
    return { hasDraft: draftItems.length > 0, hasPending, draftItems };
  }, [editedFields, boqItems]);

  const hasPendingRateAmendments = rateAmendmentSummary.hasDraft || rateAmendmentSummary.hasPending;

  const handleSubmitRateAmendRequests = async () => {
    const items = rateAmendmentSummary.draftItems;
    if (items.length === 0) return;
    // Safety net: never let a zero/invalid amended rate reach the admin queue,
    // even if some edge case elsewhere produced a bad draft entry.
    const validItems = items.filter(it => it.requestedRate > 0 && it.requestedRate > it.originalRate);
    const skippedCount = items.length - validItems.length;
    if (validItems.length === 0) {
      toast({ title: 'Nothing to submit', description: 'No valid rate amendments were found. Please re-enter the new rate and try again.', variant: 'destructive' });
      return;
    }
    try {
      for (const it of validItems) {
        await apiFetch('/api/bom-rate-changes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: it.projectId,
            project_name: it.projectName,
            bom_name: it.productName,
            version_id: selectedVersionId,
            boq_item_id: it.boqItemId,
            product_id: it.boqItemId,
            product_name: it.productName,
            material_id: it.materialId,
            material_name: it.materialName,
            original_rate: it.originalRate,
            requested_rate: it.requestedRate,
            remarks: 'Amended during BOQ creation',
          }),
        });
        // Flip local status from 'draft' (unsent) to 'pending' (awaiting admin decision)
        updateEditedField(it.itemKey, 'rate_amendment_status', 'pending');
      }
      await handleSaveProject();
      toast({
        title: 'Rate Change Request Submitted',
        description: `Sent ${validItems.length} rate amendment${validItems.length > 1 ? 's' : ''} for admin approval.${skippedCount > 0 ? ` (${skippedCount} skipped due to an invalid rate — please re-enter and resubmit.)` : ''}`
      });
    } catch (err) {
      console.error('Failed to submit rate change requests', err);
      toast({ title: 'Error', description: 'Failed to submit rate change request(s)', variant: 'destructive' });
    }
  };

  // ── Field helpers ──────────────────────────────────────────────────────────

  const updateEditedField = (itemKey: string, field: string, value: any) => {
    setEditedFields((prev: Record<string, any>) => {
      const next = { ...prev, [itemKey]: { ...prev[itemKey], [field]: value } };
      editedFieldsRef.current = next;
      return next;
    });
    // Debounced auto-save (e.g., 2 seconds after user stops typing)
    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    autoSaveTimeoutRef.current = setTimeout(() => {
      handleSaveProject();
    }, 2000);
  };

  const getEditedValue = (itemKey: string, field: string, original: any) =>
    editedFields[itemKey]?.[field] ?? original;

  // ── Budget Helpers ──────────────────────────────────────────────────────────

  const getSingleBoqItemTotal = (bi: BOMItem) => {
    const td = parseTableData(bi.table_data);
    const isEngine = !!(td.materialLines && td.targetRequiredQty !== undefined);
    const target = td.targetRequiredQty || 1;
    const step11Items = Array.isArray(td.step11_items) ? td.step11_items : [];

    let totalAmount = 0;

    if (isEngine) {
      // 1. Calculate engine lines total
      try {
        const res = computeBoq(
          td.configBasis || { requiredUnitType: "Sqft", baseRequiredQty: 1, wastagePctDefault: 0 },
          td.materialLines || [],
          target
        );
        if (Array.isArray(res.computed)) {
          res.computed.forEach((line: any, idx: number) => {
            const itemKey = `${bi.id}-engine-${idx}`;
            const isFrozen = line.freezeAndEdit || line.freeze_and_edit;
            const qty = Number(getEditedValue(itemKey, "qty", line.perUnitQty));
            const sRate = Number(getEditedValue(itemKey, "supply_rate", line.supplyRate));
            const iRate = Number(getEditedValue(itemKey, "install_rate", line.installRate));
            let rate = Number(getEditedValue(itemKey, "rate", sRate + iRate)) || (sRate + iRate);
            // Only fall back to the pre-amendment rate while the amendment is still
            // pending/draft/rejected. Once approved, keep the actual (amended) rate.
            const itemRateAmendStatus = (line.rate_amendment_status === 'approved' || line.rate_amendment_status === 'rejected')
              ? line.rate_amendment_status
              : getEditedValue(itemKey, "rate_amendment_status", line.rate_amendment_status);
            if (line.original_rate !== undefined && line.original_rate !== null && itemRateAmendStatus !== 'approved') {
              rate = Number(line.original_rate);
            }

            const isLumpSumLine = (line.unit || "").toLowerCase() === "ls";
            const reqQty = isFrozen ? line.roundOffQty : (isLumpSumLine ? 1 : Number((qty * target).toFixed(2)));
            const roundOff = isFrozen ? line.roundOffQty : (isLumpSumLine ? 1 : (line.applyRounding !== false ? Math.ceil(reqQty) : reqQty));

            totalAmount += Number((roundOff * rate).toFixed(2));
          });
        }
      } catch { }

      // 2. Add manual step11 items
      step11Items.forEach((it: any, s11Idx: number) => {
        if (!it?.manual) return;
        if (td.materialLines?.some((ml: any) => (ml.id || ml.materialId) === it.id)) return;

        const itemKey = `${bi.id}-manual-${s11Idx}`;
        const qty = Number(getEditedValue(itemKey, "qty", it.qtyPerSqf ?? it.qty ?? 0)) || 0;
        const sRate = Number(getEditedValue(itemKey, "supply_rate", it.supply_rate ?? 0)) || 0;
        const iRate = Number(getEditedValue(itemKey, "install_rate", it.install_rate ?? 0)) || 0;
        const rate = Number(getEditedValue(itemKey, "rate", sRate + iRate)) || (sRate + iRate);
        const u = getEditedValue(itemKey, "unit", it.unit || "nos");
        const isLumpSum = u.toLowerCase() === "ls";
        const displayQty = isLumpSum ? 1 : qty;

        totalAmount += Number((displayQty * rate).toFixed(2));
      });
    } else {
      // Non-engine product
      step11Items.forEach((it: any, s11Idx: number) => {
        const itemKey = it.itemKey || `${bi.id}-manual-${s11Idx}`;
        const baseQty = Number(getEditedValue(itemKey, "qty", it.qtyPerSqf ?? it.qty ?? 0)) || 0;
        const u = getEditedValue(itemKey, "unit", it.unit || "nos");
        const isLumpSum = u.toLowerCase() === "ls";
        const isManual = it.manual || !td.materialLines;
        const scaledQty = isManual ? (isLumpSum ? 1 : baseQty) : (isLumpSum ? 1 : Number((baseQty * target).toFixed(2)));
        const roundOff = (it.applyRounding !== false && !isManual && !isLumpSum) ? Math.ceil(scaledQty) : scaledQty;
        const sRate = Number(getEditedValue(itemKey, "supply_rate", it.supply_rate ?? 0)) || 0;
        const iRate = Number(getEditedValue(itemKey, "install_rate", it.install_rate ?? 0)) || 0;
        const rate = Number(getEditedValue(itemKey, "rate", sRate + iRate)) || (sRate + iRate);

        totalAmount += Number((roundOff * rate).toFixed(2));
      });
    }

    // 3. Apply use_standard_rate (Fixed Rate) if checked
    const useStandardRate = !!td.use_standard_rate;
    if (useStandardRate && isEngine) {
      const baseQty = Number(td.configBasis?.baseRequiredQty || 1);
      let standardRate = 0;
      const savedTotalCost = Number(td.total_cost ?? td.configBasis?.total_cost ?? 0);
      if (savedTotalCost > 0) {
        standardRate = savedTotalCost / baseQty;
      } else {
        try {
          const resBase = computeBoq(
            { ...(td.configBasis || { requiredUnitType: "Sqft", baseRequiredQty: 1, wastagePctDefault: 0 }), wastagePctDefault: 0 },
            (td.materialLines || []).map((l: any) => ({ ...l, applyWastage: false })),
            baseQty
          );
          standardRate = resBase.grandTotal / baseQty;
        } catch { }
      }
      return standardRate * target;
    }

    return totalAmount;
  };

  const calculateCurrentProjectValue = () => {
    return boqItems.reduce((acc, bi) => acc + getSingleBoqItemTotal(bi), 0);
  };


  const projectBudget = parseFloat(selectedProject?.budget || "0");
  const currentProjectValue = calculateCurrentProjectValue();
  // Simplify budget checks on Generate BOM page: always allow actions (no warnings)
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
    let hsnCode = template.hsn_code || template.hsnCode || null;
    let sacCode = template.sac_code || template.sacCode || null;
    let category = template.category || "";

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
          hsnCode = m.hsn_code || m.hsnCode || m.template_hsn_code || hsnCode;
          sacCode = m.sac_code || m.sacCode || m.template_sac_code || sacCode;
          if (m.category) category = m.category;
        }
      } catch { /* ignore */ }
    }
    return { unit, rate, shopName, hsnSacType, hsnSacCode, hsnCode, sacCode, category };
  };

  const getMergedTableData = (boqItem: BOMItem) => {
    const td = parseTableData(boqItem.table_data);
    const isEngine = !!(td.materialLines && td.targetRequiredQty !== undefined);

    if (isEngine) {
      if (Array.isArray(td.materialLines)) {
        td.materialLines = td.materialLines.map((line: any, idx: number) => {
          const itemKey = `${boqItem.id}-engine-${idx}`;
          const qty = Number(getEditedValue(itemKey, "qty", line.perUnitQty));
          const sRate = Number(getEditedValue(itemKey, "supply_rate", line.supplyRate));
          const iRate = Number(getEditedValue(itemKey, "install_rate", line.installRate));
          return { ...line, perUnitQty: qty, baseQty: qty, supplyRate: sRate, installRate: iRate };
        });
      }
      if (Array.isArray(td.step11_items)) {
        td.step11_items = td.step11_items.map((it: any, s11Idx: number) => {
          if (!it?.manual) return it;
          const itemKey = `${boqItem.id}-manual-${s11Idx}`;
          const qty = Number(getEditedValue(itemKey, "qty", it.qty ?? 0));
          const sRate = Number(getEditedValue(itemKey, "supply_rate", it.supply_rate ?? 0));
          const iRate = Number(getEditedValue(itemKey, "install_rate", it.install_rate ?? 0));
          return { ...it, qty, supply_rate: sRate, install_rate: iRate };
        });
      }
    } else {
      if (Array.isArray(td.step11_items)) {
        td.step11_items = td.step11_items.map((it: any, s11Idx: number) => {
          const itemKey = it.itemKey || `${boqItem.id}-manual-${s11Idx}`;
          const qty = Number(getEditedValue(itemKey, "qty", it.qty ?? 0));
          const sRate = Number(getEditedValue(itemKey, "supply_rate", it.supply_rate ?? 0));
          const iRate = Number(getEditedValue(itemKey, "install_rate", it.install_rate ?? 0));
          return { ...it, qty, supply_rate: sRate, install_rate: iRate };
        });
      }
    }
    return td;
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

  const findDuplicatesInBOM = () => {
    const groups: Record<string, BOMItem[]> = {};
    const debugKeys: { id: string; name: string; key: string }[] = [];

    boqItems.forEach(item => {
      const td = parseTableData(item.table_data);

      const cleanStr = (s: string) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

      const category = cleanStr(td.category_name || td.category || "General");
      const productName = cleanStr(td.product_name || td.item || td.name || "Unnamed Item");
      const targetQty = Number(td.targetRequiredQty || td.finalize_qty || 1);

      // Extremely permissive key: If they have the same category, same exact name, and same target quantity, they are duplicates.
      // We ignore price calculations here because visually identical items might have different internal engine structures 
      // (e.g. manual vs engine-based) which caused them to miss the duplicate check.
      const key = `${category}|${productName}|${targetQty}`;

      debugKeys.push({ id: item.id, name: productName, key });

      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });

    // Filter debug keys to show relevant ones (like the sprinklers)
    const relevantDebugKeys = debugKeys.filter(k => k.name.includes("removing") || k.name.includes("sprinkler") || k.name.includes("remo"));

    // Store debug info in a global variable or state for viewing
    (window as any).__duplicateDebug = debugKeys;
    console.log("Duplicate Check Keys:", debugKeys);

    const duplicates = Object.values(groups).filter(group => group.length > 1);

    // If no duplicates, let's force the dialog open to show the debug keys
    if (duplicates.length === 0) {
      const debugText = relevantDebugKeys.length > 0
        ? JSON.stringify(relevantDebugKeys, null, 2)
        : JSON.stringify(debugKeys.slice(0, 5), null, 2);

      setDuplicateGroups(([[{ table_data: { product_name: "DEBUG INFO (Keys for matching items)", finalize_description: debugText } }]] as any));
    } else {
      setDuplicateGroups(duplicates);
    }

    setSelectedDuplicateIndices(new Set(duplicates.map((_, i) => i)));
    setShowDuplicateDialog(true);
  };

  const cleanUpDuplicates = async () => {
    const idsToRemove = new Set<string>();
    duplicateGroups.forEach((group, idx) => {
      if (selectedDuplicateIndices.has(idx)) {
        // Keep group[0], remove the rest
        for (let i = 1; i < group.length; i++) {
          idsToRemove.add(group[i].id);
        }
      }
    });

    if (idsToRemove.size > 0) {
      try {
        const newItems = boqItems.filter(item => !idsToRemove.has(item.id));
        setBoqItems(newItems);

        // Remove from database
        for (const id of Array.from(idsToRemove)) {
          await apiFetch(`/api/boq-items/${id}`, { method: "DELETE" });
        }

        toast({ title: "Duplicates Cleaned", description: `Removed ${idsToRemove.size} redundant products.` });
        setDuplicateGroups([]);
        setSelectedDuplicateIndices(new Set());
        setShowDuplicateDialog(false);
      } catch (err) {
        console.error(err);
        toast({ title: "Error", description: "Failed to remove some duplicates from database", variant: "destructive" });
      }
    } else {
      setShowDuplicateDialog(false);
    }
  };

  const handleSelectMaterialTemplate = async (template: any) => {
    // ask for quantity before adding
    const qtyStr = prompt("Enter quantity to add", "1");
    if (qtyStr === null) return; // user cancelled
    const qty = Number(qtyStr);
    if (!qty || qty <= 0) { toast({ title: "Error", description: "Invalid quantity", variant: "destructive" }); return; }
    if (targetBoqItemId) { await handleAddItemToProduct(targetBoqItemId, template, qty); setTargetBoqItemId(null); }
    else { await handleAddMaterialToBoq(template, qty); }
  };

  const handleAddMaterialToBoq = async (template: any, qty: number = 1) => {
    if (isSaving) return;
    const rate = Number(template.rate ?? template.supply_rate ?? template.default_rate ?? 0) || 0;
    const futureVal = currentProjectValue + (rate * qty);
    await withBudgetCheck(() => futureVal, async () => {
      if (!selectedProjectId || !selectedVersionId) { toast({ title: "Error", description: "Select a project and version first", variant: "destructive" }); return; }
      setIsSaving(true);
      try {
        const { unit, rate, shopName, hsnSacType, hsnSacCode, hsnCode, sacCode, category } = await resolveMaterialFields(template);
        if (!shopName || shopName.trim() === "-" || shopName.trim() === "") {
          toast({ title: "Error", description: "Cannot add item: Shop name is missing for this material. Please update the material in the master list first.", variant: "destructive" });
          return;
        }
        const materialItem = {
          id: template.id,
          title: template.name,
          description: template.technicalspecification || template.technicalSpecification || template.name,
          unit,
          qty,
          supply_rate: rate,
          install_rate: 0,
          location: "Main Area",
          s_no: 1,
          shop_name: shopName,
          category: category || "General",
          is_project_pricing: template.is_project_pricing || false
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
              category: category || "General",
              category_name: category || "General",
              step11_items: [materialItem],
              hsn_sac_type: hsnSacType,
              hsn_sac_code: hsnSacCode,
              hsn_code: hsnCode,
              sac_code: sacCode,
              finalize_description: materialItem.description
            }
          })
        });
        if (!res.ok) throw new Error(`${res.status}`);
        toast({ title: "Success", description: `Added ${template.name} to BOM` });
        loadBoqItemsAndEdits();
      } catch { toast({ title: "Error", description: "Failed to add material", variant: "destructive" }); }
      finally { setIsSaving(false); }
    })();
  };

  const handleAddItemToProduct = async (boqItemId: string, template: any, qty: number = 1) => {
    if (isSaving) return;
    const rate = Number(template.rate ?? template.supply_rate ?? template.default_rate ?? 0) || 0;
    const futureVal = currentProjectValue + (rate * qty);
    await withBudgetCheck(() => futureVal, async () => {
      setIsSaving(true);
      try {
        const existing = boqItems.find(i => i.id === boqItemId);
        if (!existing) throw new Error("Product group not found");
        const tableData = parseTableData(existing.table_data);
        const currentStep11 = Array.isArray(tableData.step11_items) ? tableData.step11_items : [];
        const { unit, rate, shopName, hsnSacType, hsnSacCode, hsnCode, sacCode, category } = await resolveMaterialFields(template);
        if (!shopName || shopName.trim() === "-" || shopName.trim() === "") {
          toast({ title: "Error", description: "Cannot add item: Shop name is missing for this material. Please update the material in the master list first.", variant: "destructive" });
          return;
        }
        const newItem: Step11Item = {
          id: template.id,
          title: template.name,
          description: template.technicalspecification || template.technicalSpecification || template.name,
          unit,
          qty,
          supply_rate: rate,
          install_rate: 0,
          location: template.location || "Main Area",
          s_no: currentStep11.length + 1,
          shop_name: shopName,
          category: category,
          is_project_pricing: template.is_project_pricing || false
        };
        const updatedTableData = tableData.materialLines && tableData.targetRequiredQty !== undefined
          ? { ...tableData, step11_items: [...currentStep11, { ...newItem, manual: true }] }
          : { ...tableData, step11_items: [...currentStep11, newItem], hsn_sac_type: hsnSacType, hsn_sac_code: hsnSacCode };
        if (!tableData.hsn_sac_type && !tableData.hsn_sac_code && (hsnSacType || hsnSacCode)) {
          updatedTableData.hsn_sac_type = hsnSacType;
          updatedTableData.hsn_sac_code = hsnSacCode;
        }
        if (!tableData.hsn_code && hsnCode) updatedTableData.hsn_code = hsnCode;
        if (!tableData.sac_code && sacCode) updatedTableData.sac_code = sacCode;
        if (!tableData.finalize_description || tableData.finalize_description.trim() === "") {
          updatedTableData.finalize_description = newItem.description;
        }
        setBoqItems(prev => prev.map(i => i.id === boqItemId ? { ...i, table_data: updatedTableData } : i));
        const res = await updateBoqItem(boqItemId, updatedTableData);
        if (!res.ok) throw new Error("Failed to update");
        toast({ title: "Success", description: `Added ${template.name}` });
        // No need to loadBoqItemsAndEdits() here as we updated state locally
      } catch (err) {
        toast({ title: "Error", description: "Failed to add item", variant: "destructive" });
      } finally {
        setIsSaving(false);
      }
    })();
  };


  const handleFinalizeProduct = async (boqItemId: string) => {
    if (!confirm("Mark this product as finalized?") || isSaving) return;
    setIsSaving(true);
    try {
      const existing = boqItems.find(i => i.id === boqItemId);
      if (!existing) return;
      const newTd = { ...parseTableData(existing.table_data), is_finalized: true };
      setBoqItems(prev => prev.map(i => i.id === boqItemId ? { ...i, table_data: newTd } : i));
      await updateBoqItem(boqItemId, newTd);
      toast({ title: "Success", description: "Product finalized" });
    } catch {
      toast({ title: "Error", description: "Failed to finalize", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };


  const handleDeleteRow = async (boqItemId: string, tableData: any, itemIdx: number, displayItem?: any) => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      let computedLen = 0;
      if (tableData?.materialLines && tableData.targetRequiredQty !== undefined) {
        try {
          const r = computeBoq(
            tableData.configBasis || { requiredUnitType: "Sqft", baseRequiredQty: 1, wastagePctDefault: 0 },
            tableData.materialLines || [],
            tableData.targetRequiredQty || 1
          );
          computedLen = Array.isArray(r.computed) ? r.computed.length : 0;
        } catch {
          computedLen = Array.isArray(tableData.materialLines) ? tableData.materialLines.length : 0;
        }
      }
      let newTd = { ...tableData };
      if (itemIdx < computedLen) {
        const ml = [...(tableData.materialLines || [])];
        ml.splice(itemIdx, 1);
        newTd = { ...tableData, materialLines: ml };
      } else {
        const s11Idx = displayItem?._s11Idx ?? (itemIdx - computedLen);
        const s11 = [...(tableData.step11_items || [])];
        if (s11Idx >= 0 && s11Idx < s11.length) s11.splice(s11Idx, 1);
        newTd = { ...tableData, step11_items: s11 };
      }
      setBoqItems(prev => prev.map(i => i.id === boqItemId ? { ...i, table_data: newTd } : i));
      toast({ title: "Item Deleted" });
      await updateBoqItem(boqItemId, newTd);
    } catch {
      toast({ title: "Error", description: "Failed to delete item", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };


  const handleAddToBom = (selectedItems: Step11Item[]) => {
    if (!selectedProjectId || !selectedProduct || !selectedVersionId) { toast({ title: "Error", description: "Select a project, version, and product", variant: "destructive" }); return; }
    setTargetRequiredQty(100); setPendingItems(selectedItems); setTargetQtyModalOpen(true);
  };

  const confirmAddToBom = withBudgetCheck(() => currentProjectValue, async () => {
    if (!selectedProduct || !selectedProjectId || !selectedVersionId) return;
    setTargetQtyModalOpen(false);
    try {
      // Apply all edited fields to pendingItems before saving
      const updatedPendingItems = pendingItems.map((item, idx) => {
        const itemKey = `${selectedVersionId}-pending-${idx}`;
        const edited = editedFieldsRef.current[itemKey] || {};
        return {
          ...item,
          qty: edited.qty !== undefined ? edited.qty : item.qty,
          unit: edited.unit !== undefined ? edited.unit : item.unit,
          supply_rate: edited.supply_rate !== undefined ? edited.supply_rate : item.supply_rate,
          install_rate: edited.install_rate !== undefined ? edited.install_rate : item.install_rate,
          description: edited.description !== undefined ? edited.description : item.description,
          rate: edited.rate !== undefined ? edited.rate : item.rate,
          category: item.category
        };
      });

      const configRes = await apiFetch(`/api/product-step3-config/${selectedProduct.id}`);
      let configBasis: any = null; let materialLines: any[] = [];
      if (configRes.ok) {
        const { config, items } = await configRes.json();
        if (config) {
          const savedTotalCost = Number(config.total_cost || 0);
          configBasis = {
            requiredUnitType: config.required_unit_type as UnitType,
            baseRequiredQty: Math.max(0.001, Number(config.base_required_qty || 100)),
            wastagePctDefault: Number(config.wastage_pct_default || 0),
            total_cost: savedTotalCost // Store it in configBasis for easier access
          };
          materialLines = (items || []).map((item: any) => ({
            id: item.material_id,
            name: item.material_name,
            unit: item.unit,
            baseQty: Number(item.base_qty ?? item.qty ?? 0),
            wastagePct: item.wastage_pct != null ? Number(item.wastage_pct) : undefined,
            supplyRate: Number(item.supply_rate ?? item.rate ?? 0),
            installRate: Number(item.install_rate ?? 0),
            shop_name: item.shop_name,
            category: item.category || "General",
            freeze_and_edit: (item.freeze_and_edit === true || item.freeze_and_edit === "true" || item.freeze_and_edit === 1 || item.freezeAndEdit === true || item.freezeAndEdit === "true" || item.freezeAndEdit === 1),
            is_project_pricing: item.is_project_pricing === true
          }));
        }
      }
      if (!configBasis) {
        configBasis = { requiredUnitType: "Sqft" as UnitType, baseRequiredQty: 1, wastagePctDefault: 0 };
        materialLines = updatedPendingItems.map(i => ({ materialId: i.id || Math.random().toString(), materialName: i.title || "Item", unit: i.unit || "nos", baseQty: i.qty || 1, supplyRate: i.supply_rate || 0, installRate: i.install_rate || 0, category: i.category || "General" }));
      }
      const tableData = {
        product_name: selectedProduct.name,
        product_id: selectedProduct.id,
        image: selectedProduct.image,
        category: selectedProduct.category_name || selectedProduct.category || "General",
        category_name: selectedProduct.category_name || selectedProduct.category || "General",
        subcategory: selectedProduct.subcategory,
        hsn_sac_type: selectedProduct.tax_code_type || null,
        hsn_sac_code: selectedProduct.tax_code_value || null,
        hsn_code: selectedProduct.hsn_code || null,
        sac_code: selectedProduct.sac_code || null,
        targetRequiredQty,
        configBasis,
        total_cost: configBasis?.total_cost || 0,
        materialLines,
        step11_items: updatedPendingItems.map(i => ({ ...i, category: i.category || "General" })),
        finalize_description: updatedPendingItems[0]?.description || "",
        created_at: new Date().toISOString()
      };

      // --- NEW: Check for Material Quantity Increases in Approved POs ---
      const materialIds = materialLines.map(ml => ml.id || ml.materialId).filter(Boolean);
      if (materialIds.length > 0) {
        const increaseRes = await apiFetch(`/api/purchase-orders/check-material-increases?materialIds=${materialIds.join(',')}`);
        if (increaseRes.ok) {
          const { increases } = await increaseRes.json();
          const detectedIncreases: any[] = [];

          materialLines.forEach(ml => {
            const mId = ml.id || ml.materialId;
            const inc = increases[mId];
            if (inc) {
              detectedIncreases.push({
                materialId: mId,
                name: ml.materialName || ml.name || "Unknown",
                templateQty: inc.originalQty, // Use original qty from PO for "from" label
                poQty: inc.qty,               // Use current qty from PO for "to" label
                originalQty: inc.originalQty,
                poId: inc.poId,
                poNumber: inc.poNumber
              });
            }
          });

          if (detectedIncreases.length > 0) {
            setQtyIncreases(detectedIncreases);
            setPendingAddProductData(tableData);
            setShowQtyIncreaseDialog(true);
            return; // Wait for user confirmation via dialog
          }
        }
      }
      // --- END NEW ---

      await saveBoqItem(tableData);
    } catch { toast({ title: "Error", description: "Failed to add product", variant: "destructive" }); }
  });

  const saveBoqItem = async (tableData: any) => {
    const product = selectedProduct;
    if (!product || !selectedProjectId || !selectedVersionId || isSaving) return;
    setIsSaving(true);
    try {
      const res = await apiFetch("/api/boq-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: selectedProjectId,
          version_id: selectedVersionId,
          estimator: getEstimatorTypeFromProduct(product) || "General",
          table_data: tableData
        })
      });
      if (!res.ok) throw new Error("Failed to save");
      const newItem = await res.json();
      setBoqItems(prev => [...prev, newItem]);
      toast({ title: "Success", description: `Added ${selectedProduct.name}` });
      setShowStep11Preview(false); setSelectedProduct(null); setPendingItems([]);
      loadTemplates();
    } catch (err) {
      toast({ title: "Error", description: "Failed to save BOQ item", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveProject = async () => {
    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
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
        // Incrementally clear ONLY the fields we sent, instead of a blanket reset.
        // This prevents overwriting new typing that happened while the request was in flight.
        setEditedFields(prev => {
          const next = { ...prev };
          Object.keys(payload).forEach(key => {
            // Only clear if the current edit state matches what we just sent
            // (Prevents clearing items if user kept typing)
            if (JSON.stringify(next[key]) === JSON.stringify(payload[key])) {
              delete next[key];
            }
          });
          editedFieldsRef.current = next;
          return next;
        });

        // Update local items state with authoritative server data immediately
        // This stops the "flicker" where values jump between old/new state during re-loads.
        setBoqItems((prev: BOMItem[]) => {
          const updatedMap = new Map((saveResp.updatedItems || []).map((i: any) => [i.id, i]));
          return prev.map(i => {
            const up = updatedMap.get(i.id);
            if (!up) return i;
            return { ...i, table_data: (up as any).table_data };
          });
        });

        // Still reload background data (history) but the primary UI stays smooth
        loadHistory();
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
      // Always copy from the currently selected version — not versions[0] — 
      // to avoid cumulative duplication across all past versions.
      const prevId = copyFromPrevious && selectedVersionId ? selectedVersionId : null;
      const res = await apiFetch("/api/boq-versions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: selectedProjectId, copy_from_version: prevId }) });
      if (!res.ok) throw new Error();
      const v = await res.json(); setVersions(prev => [v, ...prev]); setSelectedVersionId(v.id);
      toast({ title: "Success", description: `Created Version ${v.version_number}` });
    } catch { toast({ title: "Error", description: "Failed to create version", variant: "destructive" }); }
  };

  const getProposalTotal = (prop: any) => {
    const items = proposalItemsPreview[prop.id] || [];
    if (items.length > 0) {
      return items.reduce((sum, item) => sum + (Number(item.rate) * (Number(item.qty) || 1)), 0);
    }
    return Number(prop.total_amount || prop.final_amount || 0);
  };

  const handleImportApprovedProposals = async () => {
    if (!selectedVersionId || !selectedProjectId || selectedProposalImportIds.length === 0) return;

    const count = selectedProposalImportIds.length;
    if (!confirm(`Import items from ${count} approved proposal(s)? This will add all vendor items to your current BOM draft.`)) return;

    setIsSaving(true);
    try {
      let totalImported = 0;

      for (const proposalId of selectedProposalImportIds) {
        const prop = approvedProposals.find((p: any) => p.id === proposalId);
        if (!prop) continue;

        // Fetch items for this proposal
        const res = await apiFetch(`/api/proposals/${proposalId}/items`);
        if (!res.ok) continue;
        const items = await res.json();

        if (!items || items.length === 0) continue;

        const batchItems = items.map((item: any) => {
          return {
            estimator: "General",
            table_data: {
              product_name: item.item_name || "Vendor Item",
              product_id: null,
              material_id: item.material_id || null,
              category: "Vendor Proposal",
              finalize_description: item.remarks || "",
              finalize_qty: Number(item.qty) || 1,
              finalize_rate: Number(item.rate) || 0,
              unit: item.unit || "nos",
              is_finalized: true,
              vendor_id: prop.vendor_id,
              vendor_name: prop.vendor_name,
              step11_items: [
                {
                  s_no: 1,
                  material_id: item.material_id || null,
                  title: item.item_name || "Vendor Item",
                  description: item.remarks || "",
                  unit: item.unit || "nos",
                  qty: Number(item.qty) || 1,
                  supply_rate: Number(item.rate) || 0,
                  install_rate: 0,
                  manual: true,
                  category: "Vendor Proposal"
                }
              ],
              created_at: new Date().toISOString()
            }
          };
        });

        const resp = await apiFetch("/api/boq-items/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: selectedProjectId,
            version_id: selectedVersionId,
            items: batchItems
          }),
        });

        if (resp.ok) totalImported += items.length;
      }

      if (totalImported > 0) {
        toast({ title: "Success", description: `${totalImported} items imported from ${count} proposals.` });
        setShowProposalImportDialog(false);
        setSelectedProposalImportIds([]);
        // Direct call to reload and force state update
        await loadBoqItemsAndEdits();
        // Force a minor delay then reload again to ensure database replication hasn't lagged
        setTimeout(() => loadBoqItemsAndEdits(), 500);
      } else {
        throw new Error("No items were imported.");
      }
    } catch (err: any) {
      console.error("Import proposals error:", err);
      toast({ title: "Import Failed", description: err.message || "Failed to import vendor proposals", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleProposalPreview = async (proposalId: string) => {
    if (expandedProposalId === proposalId) {
      setExpandedProposalId(null);
      return;
    }
    setExpandedProposalId(proposalId);
    if (!proposalItemsPreview[proposalId]) {
      setLoadingPreviewId(proposalId);
      try {
        const res = await apiFetch(`/api/proposals/${proposalId}/items`);
        if (res.ok) {
          const items = await res.json();
          setProposalItemsPreview(prev => ({ ...prev, [proposalId]: items }));
        }
      } catch (err) {
        console.error("Failed to fetch preview items", err);
      } finally {
        setLoadingPreviewId(null);
      }
    }
  };

  const handleDeleteVersion = async () => {
    if (!selectedVersionId) return;
    setDeleteConfirm({
      isOpen: true,
      type: 'version',
      id: selectedVersionId,
      name: `Version ${selectedVersion?.version_number || ""}`
    });
  };

  const buildDisplayLines = (boqItem: BOMItem) => {
    const td = parseTableData(boqItem.table_data);
    const step11 = Array.isArray(td.step11_items) ? td.step11_items : [];
    const target = td.targetRequiredQty || 1;
    if (td.materialLines && td.targetRequiredQty !== undefined) {
      return computeBoq(
        td.configBasis || { requiredUnitType: "Sqft", baseRequiredQty: 1, wastagePctDefault: 0 },
        td.materialLines || [],
        target
      ).computed.map((l: any) => ({ title: l.name, description: l.name, unit: l.unit, qty: l.scaledQty, supply_rate: l.supplyRate, install_rate: l.installRate, supply_amount: l.supplyAmount, install_amount: l.installAmount, shop_name: l.shop_name }));
    }
    return step11.map((it: any, idx: number) => {
      const key = `${boqItem.id}-${idx}`;
      const baseQty = Number(getEditedValue(key, "qty", it.qty ?? 0)) || 0;
      const itemUnit = getEditedValue(key, "unit", it.unit ?? "");
      const isLumpSum = itemUnit.toLowerCase() === "ls";
      const scaledQty = isLumpSum ? baseQty : Number((baseQty * target).toFixed(2));
      return {
        ...it,
        qty: scaledQty,
        supply_rate: getEditedValue(key, "supply_rate", it.supply_rate ?? 0),
        install_rate: getEditedValue(key, "install_rate", it.install_rate ?? 0),
        description: getEditedValue(key, "description", it.description ?? ""),
        unit: itemUnit
      };
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
      const mainHeaders = ["Sl", "Area/Category", "Item", "Shop", "Description", "Unit", "Qty/Unit", "Required Qty", "Round off", "Rate/Unit", "Amount"];
      exportData.push(["BILL OF QUANTITIES (BOQ)"]);
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
        exportData.push([(boqIdx + 1).toString(), tableData.category || "-", (productName + hsnFull).toUpperCase(), "", tableData.finalize_description || "", "", "", "", "", "", ""]);

        let displayLines: any[] = [];
        let isEngineBased = false;

        if (tableData.materialLines && tableData.targetRequiredQty !== undefined) {
          isEngineBased = true;
          const targetQtyEngine = tableData.targetRequiredQty || 1;
          const boqResult = computeBoq(
            tableData.configBasis || { requiredUnitType: "Sqft", baseRequiredQty: 1, wastagePctDefault: 0 },
            tableData.materialLines || [],
            targetQtyEngine
          );
          // FIX: Read user-edited values (freeze-and-edit rates, qty edits) — match UI logic
          const computedLines = boqResult.computed.map((line: any, idx: number) => {
            const itemKey = `${boqItem.id}-engine-${idx}`;
            const isFrozen = line.freezeAndEdit || line.freeze_and_edit;
            const qty = Number(getEditedValue(itemKey, "qty", line.perUnitQty));
            const sRate = Number(getEditedValue(itemKey, "supply_rate", line.supplyRate));
            const iRate = Number(getEditedValue(itemKey, "install_rate", line.installRate));
            let rate = Number(getEditedValue(itemKey, "rate", sRate + iRate)) || (sRate + iRate);
            // Only fall back to the pre-amendment rate while the amendment is still
            // pending/draft/rejected. Once approved, keep the actual (amended) rate.
            const itemRateAmendStatus = (line.rate_amendment_status === 'approved' || line.rate_amendment_status === 'rejected')
              ? line.rate_amendment_status
              : getEditedValue(itemKey, "rate_amendment_status", line.rate_amendment_status);
            if (line.original_rate !== undefined && line.original_rate !== null && itemRateAmendStatus !== 'approved') {
              rate = Number(line.original_rate);
            }
            const isLumpSumLine = (line.unit || "").toLowerCase() === "ls";
            const reqQty = isFrozen ? line.roundOffQty : (isLumpSumLine ? 1 : Number((qty * targetQtyEngine).toFixed(2)));
            const roundOff = isFrozen ? line.roundOffQty : (isLumpSumLine ? 1 : (line.applyRounding !== false ? Math.ceil(reqQty) : reqQty));
            return {
              title: line.name, description: line.name, unit: line.unit, shop_name: line.shop_name,
              qtyPerSqf: isLumpSumLine ? 1 : qty, requiredQty: reqQty, roundOff: roundOff,
              rateSqft: rate, amount: Number((roundOff * rate).toFixed(2)), s_no: idx + 1, manual: false,
            };
          });
          const manualStep11 = step11Items.map((it: any, s11Idx: number) => {
            if (!it?.manual) return null;
            if (tableData.materialLines?.some((ml: any) => (ml.id || ml.materialId) === it.id)) return null;

            const itemKey = `${boqItem.id}-manual-${s11Idx}`;
            const qty = Number(getEditedValue(itemKey, "qty", it.qtyPerSqf ?? it.qty ?? 0)) || 0;
            const sRate = Number(getEditedValue(itemKey, "supply_rate", it.supply_rate ?? 0)) || 0;
            const iRate = Number(getEditedValue(itemKey, "install_rate", it.install_rate ?? 0)) || 0;
            const rate = Number(getEditedValue(itemKey, "rate", sRate + iRate)) || (sRate + iRate);
            const desc = getEditedValue(itemKey, "description", it.description || "");
            const u = getEditedValue(itemKey, "unit", it.unit || "nos");
            const isLumpSum = u.toLowerCase() === "ls";
            const displayQty = isLumpSum ? 1 : qty;
            return {
              ...it, manual: true, itemKey, _s11Idx: s11Idx, qtyPerSqf: isLumpSum ? 1 : qty,
              requiredQty: displayQty, roundOff: "-", description: desc, unit: u,
              rateSqft: rate, amount: Number((displayQty * rate).toFixed(2))
            };
          }).filter(Boolean);
          displayLines = [...computedLines, ...manualStep11];
        } else {
          const target = tableData.targetRequiredQty || 1;


          displayLines = step11Items.map((it: any, s11Idx: number) => {
            const itemKey = it.itemKey || `${boqItem.id}-${s11Idx}`;
            const baseQty = Number(getEditedValue(itemKey, "qty", it.qtyPerSqf ?? it.qty ?? 0)) || 0;
            const u = getEditedValue(itemKey, "unit", it.unit || "nos");
            const isLumpSum = u.toLowerCase() === "ls";
            // FIX: Match UI logic — manual items should NOT be scaled by target
            const isManual = it.manual || !tableData.materialLines;
            const scaledQty = isManual ? (isLumpSum ? 1 : baseQty) : (isLumpSum ? 1 : Number((baseQty * target).toFixed(2)));
            const roundOff = (it.applyRounding !== false && !isManual && !isLumpSum) ? Math.ceil(scaledQty) : scaledQty;
            const sRate = Number(getEditedValue(itemKey, "supply_rate", it.supply_rate ?? 0)) || 0;
            const iRate = Number(getEditedValue(itemKey, "install_rate", it.install_rate ?? 0)) || 0;
            const rate = Number(getEditedValue(itemKey, "rate", sRate + iRate)) || (sRate + iRate);
            const desc = getEditedValue(itemKey, "description", it.description || "");
            return {
              ...it, itemKey, _s11Idx: s11Idx,
              qtyPerSqf: isLumpSum ? 1 : baseQty, requiredQty: scaledQty, roundOff: roundOff, description: desc, unit: u,
              rateSqft: rate, amount: Number((roundOff * rate).toFixed(2))
            };
          });
        }

        let productTotal = 0;
        displayLines.forEach((l: any, idx: number) => {
          const rowData = [
            `${boqIdx + 1}.${idx + 1}`,
            tableData.category || "-",
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

        // Calculate logical rounding or standard rate rounding
        const useStandardRate = !!tableData.use_standard_rate;
        const targetQty = tableData.targetRequiredQty || 1;

        let productGrandTotal = productTotal;
        let roundOff = 0;
        let adjustmentLabel = "Round Off (Adjustment)";

        if (useStandardRate && isEngineBased) {
          // Standard Rate / Fixed Rate logic
          const baseQty = Number(tableData.configBasis?.baseRequiredQty || 1);
          let standardRate = 0;
          const savedTotalCost = Number(tableData.total_cost ?? tableData.configBasis?.total_cost ?? 0);
          if (savedTotalCost > 0) {
            standardRate = savedTotalCost / baseQty;
          } else {
            try {
              const resBase = computeBoq(
                { ...(tableData.configBasis || { requiredUnitType: "Sqft", baseRequiredQty: 1, wastagePctDefault: 0 }), wastagePctDefault: 0 },
                (tableData.materialLines || []).map((l: any) => ({ ...l, applyWastage: false })),
                baseQty
              );
              standardRate = resBase.grandTotal / baseQty;
            } catch { }
          }
          productGrandTotal = standardRate * targetQty;
          roundOff = productGrandTotal - productTotal;
          adjustmentLabel = "Rounding Adjustment";
        } else {
          // Normal logic (logical rounding)
          const productRate = targetQty > 0 ? productTotal / targetQty : 0;
          const displayRate = Number(productRate.toFixed(2));
          const logicalTotal = targetQty * displayRate;
          roundOff = logicalTotal - productTotal;
        }

        if (Math.abs(roundOff) >= 0.01) {
          exportData.push(["", adjustmentLabel, "", "", "", "", "", "", "", "", roundOff]);
        }

        // Product total row
        exportData.push(["", "Grand Total", "", "", "", "", "", "", "", "", productGrandTotal]);
        exportData.push([]); // spacing
        grandTotal += productGrandTotal;
      });

      // Grand total row
      exportData.push(["", "GRAND TOTAL", "", "", "", "", "", "", "", "", grandTotal]);

      const worksheet = XLSX.utils.aoa_to_sheet(exportData);

      // Add some basic styling/formatting
      worksheet['!cols'] = [
        { wch: 5 },  // Sl
        { wch: 20 }, // Area/Category
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
          if (C === 9 || C === 10) { // Rate and Amount columns
            if (typeof worksheet[cell_ref].v === 'number') {
              worksheet[cell_ref].z = '"₹"#,##0.00';
            }
          }
        }
      }

      XLSX.utils.book_append_sheet(workbook, worksheet, "BOQ");
      const filename = `${selectedProject?.name || "BOQ"}_${selectedVersion ? `V${selectedVersion.version_number}` : "draft"}_BOM.xlsx`;

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
      doc.text("BILL OF QUANTITIES (BOQ)", pageWidth / 2, 25, { align: "center" });

      // 3. Prepare Table columns and body
      const tableHeaders = ["Sl", "Img", "Area", "Item / Component", "Shop", "Description", "Unit", "Qty/Unit", "Req Qty", "R.Off", "Rate", "Total (₹)"];
      const tableBody: any[] = [];
      const rowImages: { [rowIndex: number]: string } = {};
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
          { content: "", styles: { fillColor: [240, 240, 240] } },
          { content: (td.category || "-").toUpperCase(), styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } },
          { content: (productName + hsnFull).toUpperCase(), styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } },
          { content: td.finalize_description || "", colSpan: 8, styles: { fontStyle: 'italic', fillColor: [240, 240, 240] } }
        ]);

        let displayLines: any[] = [];
        if (td.materialLines && td.targetRequiredQty !== undefined) {
          const targetQtyEngine = td.targetRequiredQty || 1;
          const boqResult = computeBoq(
            td.configBasis || { requiredUnitType: "Sqft", baseRequiredQty: 1, wastagePctDefault: 0 },
            td.materialLines || [],
            targetQtyEngine
          );
          // FIX: Read user-edited values (freeze-and-edit rates, qty edits)
          const computedLines = boqResult.computed.map((line: any, idx: number) => {
            const itemKey = `${boqItem.id}-engine-${idx}`;
            const isFrozen = line.freezeAndEdit || line.freeze_and_edit;
            const qty = Number(getEditedValue(itemKey, "qty", line.perUnitQty));
            const sRate = Number(getEditedValue(itemKey, "supply_rate", line.supplyRate));
            const iRate = Number(getEditedValue(itemKey, "install_rate", line.installRate));
            let rate = Number(getEditedValue(itemKey, "rate", sRate + iRate)) || (sRate + iRate);
            // Only fall back to the pre-amendment rate while the amendment is still
            // pending/draft/rejected. Once approved, keep the actual (amended) rate.
            const itemRateAmendStatus = (line.rate_amendment_status === 'approved' || line.rate_amendment_status === 'rejected')
              ? line.rate_amendment_status
              : getEditedValue(itemKey, "rate_amendment_status", line.rate_amendment_status);
            if (line.original_rate !== undefined && line.original_rate !== null && itemRateAmendStatus !== 'approved') {
              rate = Number(line.original_rate);
            }
            const isLumpSumLine = (line.unit || "").toLowerCase() === "ls";
            const reqQty = isFrozen ? line.roundOffQty : (isLumpSumLine ? 1 : Number((qty * targetQtyEngine).toFixed(2)));
            const roundOff = isFrozen ? line.roundOffQty : (isLumpSumLine ? 1 : (line.applyRounding !== false ? Math.ceil(reqQty) : reqQty));
            return {
              title: line.name, description: line.name, unit: line.unit, shop_name: line.shop_name,
              qtyPerSqf: isLumpSumLine ? 1 : qty, requiredQty: reqQty, roundOff: roundOff,
              rate: rate, amount: Number((roundOff * rate).toFixed(2)), image: line.image
            };
          });
          const manualStep11 = step11Items.filter((i: any) => {
            if (!i?.manual) return false;
            if (td.materialLines?.some((ml: any) => (ml.id || ml.materialId) === i.id)) return false;
            return true;
          }).map((it: any, s11Idx: number) => {
            const key = `${boqItem.id}-manual-${it._s11Idx ?? s11Idx}`;
            const qty = Number(getEditedValue(key, "qty", it.qtyPerSqf ?? it.qty ?? 0)) || 0;
            const sRate = Number(getEditedValue(key, "supply_rate", it.supply_rate ?? 0)) || 0;
            const iRate = Number(getEditedValue(key, "install_rate", it.install_rate ?? 0)) || 0;
            const rate = Number(getEditedValue(key, "rate", sRate + iRate)) || (sRate + iRate);
            const u = getEditedValue(key, "unit", it.unit || "nos");
            const isLumpSum = u.toLowerCase() === "ls";
            const displayQty = isLumpSum ? 1 : qty;
            return {
              ...it, manual: true, title: it.title, description: getEditedValue(key, "description", it.description || ""),
              unit: u, qtyPerSqf: isLumpSum ? 1 : qty, requiredQty: displayQty, roundOff: "-",
              rate, amount: Number((displayQty * rate).toFixed(2)), image: it.image
            };
          }).filter(Boolean);
          displayLines = [...computedLines, ...manualStep11];
        } else {
          const target = td.targetRequiredQty || 1;

          displayLines = step11Items.map((it: any, idx: number) => {
            const key = it.itemKey || `${boqItem.id}-${idx}`;
            const baseQty = Number(getEditedValue(key, "qty", it.qtyPerSqf ?? it.qty ?? 0)) || 0;
            const u = getEditedValue(key, "unit", it.unit || "nos");
            const isLumpSum = u.toLowerCase() === "ls";
            const isManual = it.manual || !td.materialLines;
            const scaledQty = isManual ? (isLumpSum ? 1 : baseQty) : (isLumpSum ? 1 : Number((baseQty * target).toFixed(2)));
            const roundOff = (it.applyRounding !== false && !isManual && !isLumpSum) ? Math.ceil(scaledQty) : scaledQty;
            const sRate = Number(getEditedValue(key, "supply_rate", it.supply_rate ?? 0)) || 0;
            const iRate = Number(getEditedValue(key, "install_rate", it.install_rate ?? 0)) || 0;
            const rate = Number(getEditedValue(key, "rate", sRate + iRate)) || (sRate + iRate);
            return {
              ...it, title: it.title, description: getEditedValue(key, "description", it.description || ""),
              unit: u, qtyPerSqf: isLumpSum ? 1 : baseQty, requiredQty: scaledQty, roundOff: roundOff,
              rate, amount: Number((roundOff * rate).toFixed(2)), image: it.image
            };
          });
        }

        let productTotal = 0;
        displayLines.forEach((l, lIdx) => {
          const rowIndex = tableBody.length;
          if (l.image) rowImages[rowIndex] = l.image;

          tableBody.push([
            `${boqIdx + 1}.${lIdx + 1}`,
            "", // image cell
            "", // Area (empty for lines)
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

        // Calculate logical rounding or standard rate rounding
        const useStandardRate = !!td.use_standard_rate;
        const targetQty = td.targetRequiredQty || 1;
        const isEngineBased = !!(td.materialLines && td.targetRequiredQty !== undefined);

        let productGrandTotal = productTotal;
        let roundOff = 0;
        let adjustmentLabel = "Round Off";

        if (useStandardRate && isEngineBased) {
          // Standard Rate / Fixed Rate logic
          const baseQty = Number(td.configBasis?.baseRequiredQty || 1);
          let standardRate = 0;
          const savedTotalCost = Number(td.total_cost ?? td.configBasis?.total_cost ?? 0);
          if (savedTotalCost > 0) {
            standardRate = savedTotalCost / baseQty;
          } else {
            try {
              const resBase = computeBoq(
                { ...(td.configBasis || { requiredUnitType: "Sqft", baseRequiredQty: 1, wastagePctDefault: 0 }), wastagePctDefault: 0 },
                (td.materialLines || []).map((l: any) => ({ ...l, applyWastage: false })),
                baseQty
              );
              standardRate = resBase.grandTotal / baseQty;
            } catch { }
          }
          productGrandTotal = standardRate * targetQty;
          roundOff = productGrandTotal - productTotal;
          adjustmentLabel = "Rounding Adjustment";
        } else {
          // Normal logic (logical rounding)
          const productRate = targetQty > 0 ? productTotal / targetQty : 0;
          const displayRate = Number(productRate.toFixed(2));
          const logicalTotal = targetQty * displayRate;
          roundOff = logicalTotal - productTotal;
        }

        if (Math.abs(roundOff) >= 0.01) {
          tableBody.push([
            { content: "", colSpan: 10 },
            { content: adjustmentLabel, styles: { fontStyle: 'italic', textColor: [100, 100, 100], fillColor: [252, 252, 252] } },
            { content: (roundOff > 0 ? "+" : "") + roundOff.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), styles: { fontStyle: 'italic', textColor: [100, 100, 100], fillColor: [252, 252, 252], halign: 'right' } }
          ]);
        }

        // Product Subtotal Row
        tableBody.push([
          { content: "", colSpan: 10, styles: { borderTop: [1, 0, 0, 0] } },
          { content: "Grand Total", styles: { fontStyle: 'bold', fillColor: [250, 250, 250] } },
          { content: productGrandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), styles: { fontStyle: 'bold', fillColor: [250, 250, 250], halign: 'right' } }
        ]);

        grandTotal += productGrandTotal;
      });

      // Grand Total Row (Dark accent)
      tableBody.push([
        { content: "GRAND TOTAL", colSpan: 11, styles: { fontStyle: 'bold', halign: 'right', fillColor: [41, 41, 41], textColor: [255, 255, 255] } },
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
          1: { cellWidth: 15 },    // Img
          2: { cellWidth: 20 },    // Area
          3: { cellWidth: 35 },    // Item
          4: { cellWidth: 20 },    // Shop
          6: { cellWidth: 12 },    // Unit
          7: { cellWidth: 15 },    // Qty/Unit
          8: { cellWidth: 15 },    // Req Qty
          9: { cellWidth: 12 },    // R.Off
          10: { cellWidth: 20, halign: 'right' },    // Rate
          11: { cellWidth: 20, halign: 'right' },   // Amount
        },
        didParseCell: (data: any) => {
          if (data.section === 'body' && data.column.index === 1 && rowImages[data.row.index]) {
            data.cell.styles.minCellHeight = 15;
          }
        },
        didDrawCell: (data: any) => {
          if (data.section === 'body' && data.column.index === 1 && rowImages[data.row.index]) {
            try {
              const base64Img = rowImages[data.row.index];
              const format = base64Img.includes("png") ? "PNG" : "JPEG";
              const imgData = base64Img.startsWith('data:') ? base64Img : parseImages(base64Img)[0];
              if (imgData) {
                doc.addImage(imgData, format, data.cell.x + 0.5, data.cell.y + 0.5, 14, 14);
              }
            } catch (e) {
              console.warn("PDF Line image error", e);
            }
          }
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

      const filename = `${selectedProject?.name || "BOQ"}_${selectedVersion ? `V${selectedVersion.version_number}` : "draft"}_BOM.pdf`;
      doc.save(filename);
      toast({ title: "Success", description: `Downloaded ${filename}` });
    } catch (err) {
      console.error("PDF Export Error:", err);
      toast({ title: "Error", description: "Failed to download PDF", variant: "destructive" });
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const isReadOnlyMode = user?.role === 'finance_team' || user?.role === 'purchase_team';
  const isVersionSubmitted = isReadOnlyMode || (!!selectedVersion && ["submitted", "pending_approval", "approved", "edit_requested"].includes(selectedVersion.status));
  // Budget reason logging removed for Generate BOM page

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return <Layout><div className="text-center py-8">Loading projects...</div></Layout>;

  return (
    <>
      <Layout>
        <div className="space-y-6 pb-24 md:pb-32">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
              <h1 className="text-2xl font-semibold font-outfit text-slate-900 tracking-tight flex items-center gap-2">
                Generate BOM
                {activeTab === 'approvals' && <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-blue-200 uppercase tracking-widest text-[10px]">Approvals View</Badge>}
                {user?.role === 'admin' && (
                  <div className="flex items-center gap-2 ml-4">
                    <span className="text-[10px] font-bold text-slate-500 uppercase">Modification:</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`h-6 px-2 text-[10px] font-bold ${bomButtonsEnabled ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100' : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'}`}
                      onClick={toggleBomButtons}
                    >
                      {bomButtonsEnabled ? 'Enabled' : 'Disabled'}
                    </Button>
                  </div>
                )}
              </h1>

              {(user?.role === 'admin' || user?.role === 'software_team') && (
                <div className="flex items-center gap-2">
                  <div className="px-5 py-1.5 text-xs font-bold bg-white text-blue-600 shadow-sm rounded-md border border-slate-200">
                    BOM Builder
                  </div>
                  <Button
                    variant="outline"
                    className="px-5 py-1.5 h-auto text-xs font-bold bg-white hover:bg-slate-50 text-slate-700 shadow-sm border-slate-200 flex items-center gap-2"
                    onClick={() => { setApprovalsModalOpen(true); fetchApprovals(); }}
                  >
                    Approvals
                    {(approvals.length > 0 || rateChangeRequests.filter(r => r.status === 'pending').length > 0) && (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[10px] text-white font-bold">
                        {approvals.length + rateChangeRequests.filter(r => r.status === 'pending').length}
                      </span>
                    )}
                  </Button>
                </div>
              )}
            </div>

            <TabsContent value="bom" className="space-y-6 mt-0">

              {/* Project Selector */}
              {/* Project & Version Selector (Compact & Professional) */}
              <Card className="border-slate-200 shadow-sm overflow-hidden">
                <CardContent className="p-4 bg-white">
                  <div className="flex flex-col gap-4">
                    {/* Top Row: Selectors & Actions */}
                    {/* Row 1: Project Filters */}
                    <div className="flex items-center gap-3 p-1.5 bg-slate-50 rounded-lg border border-slate-200 w-full">
                      <Label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold ml-2 whitespace-nowrap">Project Filters:</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {PROJECT_STATUSES.map(s => (
                          <button
                            key={s.value}
                            onClick={() => setProjectStatusFilter(s.value)}
                            className={cn(
                              "px-2 py-1 text-[9px] font-bold uppercase rounded-md transition-all border border-transparent",
                              projectStatusFilter === s.value ? "bg-white text-blue-600 shadow-sm border-blue-100 ring-1 ring-blue-50/50" : "text-slate-500 hover:bg-slate-100"
                            )}
                          >
                            {s.label}
                          </button>
                        ))}
                        <button
                          onClick={() => setProjectStatusFilter("all")}
                          className={cn(
                            "px-2 py-1 text-[9px] font-bold uppercase rounded-md transition-all border border-transparent",
                            projectStatusFilter === "all" ? "bg-white text-blue-600 shadow-sm border-blue-100 ring-1 ring-blue-50/50" : "text-slate-500 hover:bg-slate-100"
                          )}
                        >
                          All
                        </button>
                      </div>
                    </div>

                    {/* Row 2: Select Project & Version Actions */}
                    <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
                      <div className="flex-[2] min-w-[350px] space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold ml-1">Select Project</Label>
                        <Select onValueChange={v => setSelectedProjectId(v || null)} value={selectedProjectId || ""}>
                          <SelectTrigger className="w-full bg-slate-50 border-slate-200 h-9 px-3 hover:bg-slate-100/50 transition-colors">
                            <SelectValue placeholder={projects.length === 0 ? "No projects" : "Choose from filtered list..."} />
                          </SelectTrigger>
                          <SelectContent className="max-h-[300px] overflow-hidden flex flex-col">
                            <div className="sticky top-0 z-10 bg-white p-2 border-b border-slate-100">
                              <div className="relative">
                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
                                <Input
                                  placeholder="Search projects..."
                                  value={projectSearchTerm}
                                  onChange={(e) => setProjectSearchTerm(e.target.value)}
                                  onKeyDown={(e) => e.stopPropagation()}
                                  className="pl-7 h-8 text-[11px] border-slate-200 bg-slate-50 focus:bg-white transition-colors w-full"
                                />
                              </div>
                            </div>
                            <div className="overflow-y-auto max-h-[250px]">
                              {projects
                                .filter(p => {
                                  // Filter by search term
                                  if (projectSearchTerm && !fuzzySearch(projectSearchTerm, [p.name, p.client])) return false;

                                  // Filter by status
                                  if (projectStatusFilter === "all") return true;
                                  return p.project_status === projectStatusFilter;
                                })
                                .map((p: Project) => {
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
                            </div>
                          </SelectContent>
                        </Select>
                      </div>

                      {selectedProjectId && (
                        <div className="flex-[3] min-w-[500px] space-y-1.5 text-slate-900">
                          <Label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold ml-1">Version & Actions</Label>
                          <div className="flex flex-wrap gap-2">
                            <div className="flex gap-1">
                              <Select value={selectedVersionId || ""} onValueChange={setSelectedVersionId}>
                                <SelectTrigger className="flex-1 min-w-[140px] bg-slate-50 border-slate-200 h-9 px-3">
                                  <SelectValue placeholder="Select version" />
                                </SelectTrigger>
                                <SelectContent className="max-h-[300px] overflow-y-auto">
                                  {versions.map((v: BOMVersion) => {
                                    const isManualFinal = (v as any).is_last_final;
                                    const isLatestApproved = !versions.some(x => (x as any).is_last_final) && v.status === 'approved' && v.version_number === Math.max(...versions.filter(x => x.status === 'approved').map(x => x.version_number), 0);
                                    const isFinal = isManualFinal || isLatestApproved;
                                    return (
                                      <SelectItem value={v.id} key={v.id}>
                                        <div className="flex items-center justify-between w-full gap-2">
                                          <span>V{v.version_number} ({VERSION_LABEL[v.status] ?? v.status})</span>
                                          {isFinal && <span className="bg-green-600 text-white text-[8px] h-3.5 px-1 rounded-sm leading-none uppercase font-bold shrink-0 flex items-center">Last Final</span>}
                                        </div>
                                      </SelectItem>
                                    );
                                  })}
                                </SelectContent>
                              </Select>
                              {(() => {
                                const latestApprovedVer = versions.reduce((prev: any, current: any) => {
                                  if ((current as any).is_last_final) return current;
                                  if (prev && (prev as any).is_last_final) return prev;
                                  return (current.status === 'approved' && (!prev || current.version_number > prev.version_number)) ? current : prev;
                                }, null);

                                const showJump = latestApprovedVer && selectedVersionId !== latestApprovedVer.id;
                                const currentV = versions.find(v => v.id === selectedVersionId);
                                const showMark = currentV && currentV.status === 'approved' && !(currentV as any).is_last_final;

                                return (
                                  <div className="flex items-center gap-1">
                                    {showJump && (
                                      <Button
                                        variant="outline"
                                        size="icon"
                                        className="h-9 w-9 border-green-200 text-green-600 hover:bg-green-50 shadow-sm shrink-0"
                                        title="Jump to Last Final Version"
                                        onClick={() => setSelectedVersionId(latestApprovedVer.id)}
                                      >
                                        <CheckCircle2 className="h-4 w-4" />
                                      </Button>
                                    )}

                                    {showMark && (
                                      <Button
                                        variant="outline"
                                        size="icon"
                                        className="h-9 w-9 border-slate-200 text-slate-400 hover:text-green-600 hover:border-green-200 shadow-sm shrink-0"
                                        title="Mark this as Last Final"
                                        onClick={async () => {
                                          if (!confirm("Are you sure you want to mark this version as the Last Final version?")) return;
                                          try {
                                            const resp = await apiFetch(`/api/boq-versions/${selectedVersionId}/make-final`, { method: "POST" });
                                            if (resp.ok) {
                                              toast({ title: "Success", description: "Version marked as Last Final" });
                                              // Refresh versions
                                              const boqResp = await apiFetch(`/api/boq-versions/${encodeURIComponent(selectedProjectId!)}?type=bom`);
                                              if (boqResp.ok) {
                                                const boqData = await boqResp.json();
                                                setVersions(boqData.versions || []);
                                              }
                                            }
                                          } catch (e) {
                                            console.error("Failed to mark final", e);
                                            toast({ title: "Error", description: "Failed to mark as final", variant: "destructive" });
                                          }
                                        }}
                                      >
                                        <Star className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 px-3 bg-white border-slate-200 hover:bg-slate-50 text-slate-600 hover:text-blue-600 gap-2 font-semibold"
                              title="View History"
                              onClick={() => setShowHistoryModal(true)}
                              disabled={!selectedVersionId}
                            >
                              <History className="h-4 w-4" />
                              <span>History</span>
                            </Button>
                            {(user?.role === 'admin' || user?.role === 'software_team') && (
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
                            )}
                            {!isReadOnlyMode && (
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
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Row 3: Project Status & Actions */}
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                      {selectedProjectId && (() => {
                        const selProj = projects.find(p => p.id === selectedProjectId);
                        return (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-500 font-bold uppercase">Project Status:</span>
                            <select
                              className="text-xs border border-slate-200 rounded px-2 py-1 bg-white font-semibold focus:ring-1 ring-blue-400 outline-none disabled:bg-slate-50 disabled:text-slate-500"
                              value={selProj?.project_status || 'started'}
                              disabled={isReadOnlyMode}
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

                      {!isReadOnlyMode && (
                        <div className="flex gap-2 h-9 ml-auto">
                          <Button onClick={() => setShowTemplateManager(true)} variant="outline" className="border-slate-200 h-full px-4 text-xs font-bold shadow-sm bg-white flex items-center gap-2" disabled={isVersionSubmitted || !selectedVersionId}>
                            <History className="h-4 w-4" /> Load Template
                          </Button>

                          {approvedProposals.length > 0 && (
                            <Button
                              onClick={() => {
                                setSelectedProposalImportIds([]);
                                setShowProposalImportDialog(true);
                              }}
                              variant="outline"
                              className="border-emerald-200 h-full px-4 text-xs font-bold shadow-sm bg-white flex items-center gap-2 text-emerald-700 hover:bg-emerald-50"
                              disabled={isVersionSubmitted || !selectedVersionId}
                            >
                              <CheckCircle2 className="h-4 w-4" /> Import Approved Proposals ({approvedProposals.length})
                            </Button>
                          )}
                          <Button onClick={findDuplicatesInBOM} variant="outline" className="border-amber-200 h-full px-4 text-xs font-bold shadow-sm bg-amber-50 text-amber-700 hover:bg-amber-100 flex items-center gap-2" disabled={!selectedProjectId}>
                            <AlertTriangle className="h-4 w-4" /> Check Duplicates
                          </Button>
                          <Button
                            onClick={handleRefreshCategories}
                            variant="outline"
                            className="border-emerald-200 h-full px-4 text-xs font-bold shadow-sm bg-emerald-50 text-emerald-700 hover:bg-emerald-100 flex items-center gap-2"
                            disabled={!selectedVersionId || isRefreshingCategories || boqItems.length === 0}
                            title="Refresh: detect and update any item categories that changed in the master product library"
                          >
                            {isRefreshingCategories
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <RefreshCw className="h-4 w-4" />}
                            {isRefreshingCategories ? "Refreshing..." : "Refresh"}
                          </Button>
                          <Button onClick={() => setShowCompareDialog(true)} variant="outline" className="border-blue-200 h-full px-4 text-xs font-bold shadow-sm bg-blue-50 text-blue-700 hover:bg-blue-100 flex items-center gap-2" disabled={!selectedProjectId}>
                            <ChevronsUpDown className="h-4 w-4" /> Compare
                          </Button>
                          <Button onClick={handleAddProduct} className="bg-primary text-white h-full px-5 text-xs font-bold shadow-sm" disabled={isVersionSubmitted || !selectedVersionId || !bomButtonsEnabled || isSaving}>
                            {isSaving ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
                            + Add Product
                          </Button>

                          <Button onClick={handleAddProductManual} variant="outline" className="border-slate-200 h-full px-5 text-xs font-bold shadow-sm bg-white" disabled={isVersionSubmitted || !selectedVersionId || !bomButtonsEnabled || isSaving}>
                            {isSaving ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
                            + Add Item
                          </Button>

                        </div>
                      )}
                    </div>



                    {/* Row 4: Project Info Summary & Comment */}
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
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 px-3 bg-white border-slate-200 hover:bg-slate-50 text-slate-600 hover:text-blue-600 gap-2 font-semibold relative"
                            title="View All Comments"
                            onClick={() => {
                              if (!selectedVersionId) return;
                              setCommentInboxView(true);
                              setCommentTarget(null);
                              setShowCommentDialog(true);
                            }}
                            disabled={!selectedVersionId}
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            <span className="text-xs">Comment</span>
                            {(() => {
                              const unreadCount = comments.filter(c => {
                                if (c.user_id === user?.id) return false;
                                const isVisible = (!c.visible_to || c.visible_to.length === 0 || c.visible_to.includes(user?.username || ""));
                                return isVisible && (!c.read_by || !c.read_by.includes(user?.id || ""));
                              }).length;
                              return unreadCount > 0 ? (
                                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] rounded-full h-4 min-w-4 flex items-center justify-center font-bold px-1 shadow-sm border border-white">{unreadCount}</span>
                              ) : null;
                            })()}
                          </Button>

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
                <VersionHistoryModal
                  isOpen={showHistoryModal}
                  onOpenChange={setShowHistoryModal}
                  versionId={selectedVersionId}
                  projectId={selectedProjectId}
                  boqItems={boqItems}
                  isAdmin={user?.role === 'admin' || user?.role === 'software_team'}
                  projectName={selectedProject?.name}
                  clientName={selectedProject?.client}
                />

                <Dialog open={showProposalImportDialog} onOpenChange={setShowProposalImportDialog}>
                  <DialogContent className="sm:max-w-[700px]">
                    <DialogHeader>
                      <DialogTitle className="text-lg font-bold flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                        Finalized Vendor Proposals
                      </DialogTitle>
                      <DialogDescription>
                        Select one or more approved proposals to import their items into your current BOM draft.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                      <div className="border rounded-md overflow-hidden bg-white">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              <th className="w-10 px-4 py-3 text-center">
                                <input
                                  type="checkbox"
                                  className="rounded border-slate-300"
                                  checked={selectedProposalImportIds.length === approvedProposals.length && approvedProposals.length > 0}
                                  onChange={(e) => {
                                    if (e.target.checked) setSelectedProposalImportIds(approvedProposals.map(p => p.id));
                                    else setSelectedProposalImportIds([]);
                                  }}
                                />
                              </th>
                              <th className="px-4 py-3 text-left font-bold text-slate-700">Proposal Details</th>
                              <th className="px-4 py-3 text-right font-bold text-slate-700">Final Amount</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {approvedProposals.map((prop) => (
                              <React.Fragment key={prop.id}>
                                <tr
                                  className={`hover:bg-slate-50 transition-colors cursor-pointer border-t border-slate-100 ${selectedProposalImportIds.includes(prop.id) ? 'bg-emerald-50/20' : ''}`}
                                  onClick={() => {
                                    setSelectedProposalImportIds(prev =>
                                      prev.includes(prop.id) ? prev.filter(id => id !== prop.id) : [...prev, prop.id]
                                    );
                                  }}
                                >
                                  <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                                    <input
                                      type="checkbox"
                                      className="rounded border-slate-300 h-4 w-4 accent-emerald-600"
                                      checked={selectedProposalImportIds.includes(prop.id)}
                                      onChange={(e) => {
                                        setSelectedProposalImportIds(prev =>
                                          e.target.checked ? [...prev, prop.id] : prev.filter(id => id !== prop.id)
                                        );
                                      }}
                                    />
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="flex items-start gap-3">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); toggleProposalPreview(prop.id); }}
                                        className="mt-1 p-1 hover:bg-slate-200 rounded transition-colors text-slate-400 hover:text-slate-600"
                                      >
                                        {expandedProposalId === prop.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                      </button>
                                      <div className="flex flex-col">
                                        <div className="flex items-center gap-2">
                                          <span className="font-bold text-slate-900 text-sm">{prop.vendor_name}</span>
                                          <Badge className="text-[10px] h-4 bg-emerald-100 text-emerald-700 border-emerald-200 font-bold">V{prop.version_number}</Badge>
                                        </div>
                                        <span className="text-[11px] text-slate-500 font-bold mt-0.5">Project: {prop.project_name || selectedProject?.name || "Target Project"}</span>
                                        <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-1 font-medium">
                                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Approved: {new Date(prop.updated_at || prop.created_at).toLocaleDateString()}</span>
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <span className="font-extrabold text-slate-950 text-sm">
                                      ₹{getProposalTotal(prop).toLocaleString()}
                                    </span>
                                  </td>
                                </tr>

                                {/* Expandable Material List Preview */}
                                {expandedProposalId === prop.id && (
                                  <tr className="bg-slate-50/50">
                                    <td colSpan={3} className="px-4 py-0">
                                      <div className="p-4 border-l-2 border-emerald-500 my-2 ml-10">
                                        <div className="bg-white border rounded-lg shadow-sm overflow-hidden">
                                          <table className="w-full text-[11px]">
                                            <thead className="bg-slate-100/80 text-slate-600 font-bold uppercase tracking-wider border-b">
                                              <tr>
                                                <th className="px-3 py-2 text-left">Item Name</th>
                                                <th className="px-3 py-2 text-center">Qty</th>
                                                <th className="px-3 py-2 text-center">Unit</th>
                                                <th className="px-3 py-2 text-right">Rate</th>
                                                <th className="px-3 py-2 text-right w-24">Total</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                              {loadingPreviewId === prop.id ? (
                                                <tr>
                                                  <td colSpan={5} className="px-3 py-4 text-center">
                                                    <div className="flex items-center justify-center gap-2 text-slate-500">
                                                      <Loader2 className="h-3 w-3 animate-spin" />
                                                      <span>Loading materials list...</span>
                                                    </div>
                                                  </td>
                                                </tr>
                                              ) : (proposalItemsPreview[prop.id]?.length || 0) > 0 ? (
                                                proposalItemsPreview[prop.id]?.map((item, idx) => (
                                                  <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                                                    <td className="px-3 py-2 font-medium text-slate-800">{item.item_name}</td>
                                                    <td className="px-3 py-2 text-center font-bold text-slate-700">{item.qty}</td>
                                                    <td className="px-3 py-2 text-center text-slate-500">{item.unit || "nos"}</td>
                                                    <td className="px-3 py-2 text-right font-medium text-slate-600">₹{Number(item.rate).toLocaleString()}</td>
                                                    <td className="px-3 py-2 text-right font-bold text-slate-900 bg-slate-100/30">₹{(Number(item.rate) * Number(item.qty)).toLocaleString()}</td>
                                                  </tr>
                                                ))
                                              ) : (
                                                <tr>
                                                  <td colSpan={5} className="px-3 py-8 text-center text-slate-400 italic">No materials found in this proposal.</td>
                                                </tr>
                                              )}
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <DialogFooter className="bg-slate-50 p-4 rounded-b-lg border-t border-slate-200">
                      <div className="flex items-center justify-between w-full">
                        <span className="text-xs font-bold text-slate-500">{selectedProposalImportIds.length} proposals selected</span>
                        <div className="flex gap-2">
                          <Button variant="outline" onClick={() => setShowProposalImportDialog(false)}>Cancel</Button>
                          <Button
                            disabled={selectedProposalImportIds.length === 0 || isSaving}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                            onClick={handleImportApprovedProposals}
                          >
                            {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                            Import Selected Items
                          </Button>
                        </div>
                      </div>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <ProductPicker open={showProductPicker} onOpenChange={setShowProductPicker} onSelectProduct={handleSelectProduct} selectedProjectId={selectedProjectId!} />
                <MaterialPicker open={showMaterialPicker} onOpenChange={setShowMaterialPicker} onSelectTemplate={handleSelectMaterialTemplate} />

                {selectedProduct && (
                  <Step11Preview product={selectedProduct} open={showStep11Preview} onClose={() => { setShowStep11Preview(false); setTimeout(() => setSelectedProduct(null), 300); }} onAddToBoq={handleAddToBom} />
                )}
              </Card>

              {/* BOQ Items */}
              {selectedProjectId && (
                <Card>
                  <CardContent className="space-y-0 pt-0">
                    <div className="sticky top-0 z-20 bg-white rounded-t-lg shadow-sm border-b border-slate-200 p-6 pb-4">
                      <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                          <h2 className="text-lg font-bold text-gray-800">BOQ Items</h2>
                          <div className="flex items-center gap-4">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setIsCompactView(!isCompactView)}
                              className={`h-9 px-3 font-semibold ${isCompactView ? 'bg-blue-50 text-blue-600 border-blue-300' : 'text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                            >
                              Compact View
                            </Button>
                            <div className="flex items-center gap-2">
                              <div className="flex items-center space-x-2 mr-2 bg-amber-50 px-3 py-1.5 rounded-md border border-amber-200">
                                <Checkbox
                                  id="project-pricing-filter-bom"
                                  checked={projectPricingFilter}
                                  onCheckedChange={(c) => { setProjectPricingFilter(c as boolean); setCurrentPage(1); }}
                                />
                                <Label
                                  htmlFor="project-pricing-filter-bom"
                                  className="text-xs font-bold text-amber-900 cursor-pointer flex items-center gap-1"
                                >
                                  Project Pricing Only
                                </Label>
                              </div>
                              <Select value={itemCategoryFilter} onValueChange={setItemCategoryFilter}>
                                <SelectTrigger className="h-9 w-[160px] text-xs border-slate-200">
                                  <SelectValue placeholder="Item Category" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="all">All Item Categories</SelectItem>
                                  {itemCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                </SelectContent>
                              </Select>

                              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}>
                                <SelectTrigger className="h-9 w-[100px] text-xs border-slate-200">
                                  <SelectValue placeholder="Page Size" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="10">10 / page</SelectItem>
                                  <SelectItem value="20">20 / page</SelectItem>
                                  <SelectItem value="50">50 / page</SelectItem>
                                  <SelectItem value="100">100 / page</SelectItem>
                                </SelectContent>
                              </Select>

                              <div className="relative w-64">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <Input
                                  placeholder="Search products..."
                                  value={productSearch}
                                  onChange={(e) => setProductSearch(e.target.value)}
                                  className="pl-9 h-9 text-sm border-slate-200 focus:ring-blue-500 shadow-sm"
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="overflow-x-auto pb-2 custom-scrollbar">
                          <Tabs value={productCategoryFilter} onValueChange={(v) => { setProductCategoryFilter(v); setCurrentPage(1); }} className="w-full">
                            <TabsList className="bg-transparent p-0 flex justify-start h-10 flex-nowrap gap-1 w-full overflow-visible">
                              <TabsTrigger
                                value="all"
                                className={cn(
                                  "px-4 h-9 text-[11px] font-bold uppercase tracking-wider transition-all border shrink-0",
                                  productCategoryFilter === "all"
                                    ? "bg-blue-600 text-white border-blue-600 shadow-md translate-y-[-2px]"
                                    : "bg-white text-slate-500 border-slate-200 hover:border-blue-300 hover:text-blue-600"
                                )}
                              >
                                All ({boqItems.length})
                              </TabsTrigger>
                              <Reorder.Group
                                axis="x"
                                values={productCategoryOrder}
                                onReorder={setProductCategoryOrder}
                                className="flex gap-1"
                              >
                                {productCategoryOrder.map((cat) => {
                                  const count = boqItems.filter(bi => {
                                    const td = parseTableData(bi.table_data);
                                    return (td.category_name || td.category || "General") === cat;
                                  }).length;
                                  return (
                                    <Reorder.Item
                                      key={cat}
                                      value={cat}
                                      className="shrink-0"
                                    >
                                      <TabsTrigger
                                        value={cat}
                                        className={cn(
                                          "px-4 h-9 text-[11px] font-bold uppercase tracking-wider transition-all border",
                                          productCategoryFilter === cat
                                            ? "bg-blue-600 text-white border-blue-600 shadow-md translate-y-[-2px]"
                                            : "bg-white text-slate-500 border-slate-200 hover:border-blue-300 hover:text-blue-600"
                                        )}
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
                    <div className="pt-6">
                      {boqItems.length === 0
                        ? <div className="text-gray-500 text-center py-4">No products added yet. Click Add Product +</div>
                        : <div className="space-y-6">
                          {(() => {
                            const sortedAllItems = boqItems.map((item, index) => ({ item, index }))
                              .sort((a, b) => {
                                if (productCategoryOrder.length === 0) return a.index - b.index;
                                const tda = parseTableData(a.item.table_data);
                                const tdb = parseTableData(b.item.table_data);
                                const catA = tda.category_name || tda.category || "General";
                                const catB = tdb.category_name || tdb.category || "General";
                                const indexA = productCategoryOrder.indexOf(catA);
                                const indexB = productCategoryOrder.indexOf(catB);
                                if (indexA !== -1 && indexB !== -1) {
                                  if (indexA !== indexB) return indexA - indexB;
                                } else if (indexA !== -1) return -1;
                                else if (indexB !== -1) return 1;
                                return a.index - b.index;
                              })
                              .map(x => x.item);


                            const filteredItems = sortedAllItems.filter(item => {
                              const td = parseTableData(item.table_data);
                              const name = td.product_name || td.item || td.name || "Unnamed Item";
                              const desc = td.finalize_description || td.description || "";
                              const matchesSearch = fuzzySearch(productSearch, [name, desc]);
                              const cat = td.category_name || td.category || "General";
                              const matchesProductCat = productCategoryFilter === "all" || cat === productCategoryFilter;

                              let hasMatchingItem = true;
                              if (itemCategoryFilter !== "all") {
                                const materialLines = td.materialLines || [];
                                const step11Items = td.step11_items || [];
                                hasMatchingItem = materialLines.some((ml: any) => (ml.category || "General") === itemCategoryFilter) ||
                                  step11Items.some((si: any) => (si.category || "General") === itemCategoryFilter);
                              }
                              let hasProjectPricing = true;
                              if (projectPricingFilter) {
                                const materialLines = td.materialLines || [];
                                const step11Items = td.step11_items || [];
                                hasProjectPricing = td.is_project_pricing === true ||
                                  materialLines.some((ml: any) => ml.is_project_pricing === true) ||
                                  step11Items.some((si: any) => si.is_project_pricing === true);
                              }

                              return matchesSearch && matchesProductCat && hasMatchingItem && hasProjectPricing;
                            });

                            const effectivePageSize = isSinglePage ? 1000 : pageSize;
                            const totalPages = Math.ceil(filteredItems.length / effectivePageSize);
                            const paginatedItems = filteredItems.slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize);

                            return (
                              <div className="space-y-6">
                                {/* Pagination Header / Master View Bar */}
                                <div className="flex items-center justify-between bg-slate-50 border rounded-lg p-3 px-6 shadow-sm mb-6">
                                  <div className="flex items-center gap-3">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={currentPage === 1}
                                      onClick={() => {
                                        if (currentPage > 1) {
                                          setCurrentPage(prev => prev - 1);
                                        } else {
                                          const catList = ["all", ...productCategoryOrder];
                                          const currentIdx = catList.indexOf(productCategoryFilter);
                                          if (currentIdx > 0) {
                                            setProductCategoryFilter(catList[currentIdx - 1]);
                                            setCurrentPage(1);
                                          }
                                        }
                                      }}
                                      className="h-9 gap-2 font-bold text-[10px] uppercase tracking-widest bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                                    >
                                      <ArrowLeft className="w-3.5 h-3.5" /> Previous
                                    </Button>

                                    <Button
                                      variant={isSinglePage ? "default" : "outline"}
                                      size="sm"
                                      onClick={() => {
                                        setIsSinglePage(!isSinglePage);
                                        setCurrentPage(1);
                                      }}
                                      className={cn(
                                        "h-9 font-bold text-[10px] uppercase tracking-widest px-5 transition-all",
                                        isSinglePage ? "bg-blue-600 text-white border-blue-600 shadow-md" : "bg-white border-slate-200 text-slate-600 hover:border-blue-300"
                                      )}
                                    >
                                      {isSinglePage ? "Paginated View" : "Single Page"}
                                    </Button>
                                  </div>

                                  <div className="flex flex-col items-center">
                                    <span className="text-[11px] font-black text-blue-900 uppercase tracking-[0.25em]">Master View</span>
                                    <span className="text-[10px] font-bold text-slate-400 uppercase mt-0.5">Page {currentPage} of {totalPages || 1}</span>
                                  </div>

                                  <div className="flex items-center gap-6">
                                    <div className="flex items-center gap-1.5">
                                      {Array.from({ length: Math.min(totalPages, 15) }).map((_, i) => (
                                        <div
                                          key={i}
                                          onClick={() => setCurrentPage(i + 1)}
                                          className={cn(
                                            "w-2 h-2 rounded-full cursor-pointer transition-all duration-300",
                                            currentPage === i + 1 ? "bg-blue-600 w-5" : "bg-slate-300 hover:bg-slate-400"
                                          )}
                                        />
                                      ))}
                                    </div>

                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={currentPage === totalPages || totalPages === 0}
                                      onClick={() => {
                                        if (currentPage < totalPages) {
                                          setCurrentPage(prev => prev + 1);
                                        } else {
                                          const catList = ["all", ...productCategoryOrder];
                                          const currentIdx = catList.indexOf(productCategoryFilter);
                                          if (currentIdx < catList.length - 1) {
                                            setProductCategoryFilter(catList[currentIdx + 1]);
                                            setCurrentPage(1);
                                          }
                                        }
                                      }}
                                      className="h-9 gap-2 font-bold text-[10px] uppercase tracking-widest bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                                    >
                                      Next <ArrowRight className="w-3.5 h-3.5" />
                                    </Button>
                                  </div>
                                </div>

                                <div className="space-y-6">
                                  {paginatedItems.map((boqItem: BOMItem, pIdx: number) => {
                                    const boqIdx = boqItems.findIndex(bi => bi.id === boqItem.id);
                                    // Use the global index in the sorted list to ensure sequential numbering across categories
                                    const displayIdx = sortedAllItems.findIndex(bi => bi.id === boqItem.id);

                                    return (
                                      <div key={boqItem.id} id={`boq-item-card-${boqItem.id}`} className="transition-all duration-300">
                                        <BoqItemCard boqItem={boqItem} boqIdx={displayIdx} isVersionSubmitted={isVersionSubmitted}
                                          expandedProductIds={expandedProductIds} setExpandedProductIds={setExpandedProductIds}
                                          getEditedValue={getEditedValue} updateEditedField={updateEditedField}
                                          handleDeleteRow={handleDeleteRow} handleFinalizeProduct={handleFinalizeProduct}
                                          handleAddItem={handleAddItem} loadBoqItemsAndEdits={loadBoqItemsAndEdits} setBoqItems={setBoqItems}
                                          checkBudgetEarly={checkBudgetEarly} handleSaveProject={handleSaveProject}
                                          onAnalysis={(name) => setAnalysisProduct(name)}
                                          isCardDragOver={cardDragOverIdx === boqIdx}
                                          onCardDragStart={(e) => { cardDragIdxRef.current = boqIdx; e.dataTransfer.effectAllowed = 'move'; }}
                                          onCardDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setCardDragOverIdx(boqIdx); }}
                                          onCardDrop={(e) => {
                                            e.preventDefault();
                                            setCardDragOverIdx(null);
                                            const fromIdx = cardDragIdxRef.current;
                                            if (fromIdx === null || fromIdx === boqIdx) return;
                                            const reordered = [...boqItems];
                                            const [moved] = reordered.splice(fromIdx, 1);
                                            reordered.splice(boqIdx, 0, moved);
                                            setBoqItems(reordered);
                                            apiFetch('/api/boq-items/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemIds: reordered.map(i => i.id) }) }).catch(console.error);
                                            cardDragIdxRef.current = null;
                                          }}
                                          mismatches={activeMismatches.filter(m => m.boqItemId === boqItem.id)}
                                          isCompactView={isCompactView}
                                          onSaveAsTemplate={(item) => {
                                            setTemplateToSave(item);
                                            setNewTemplateName(parseTableData(item.table_data).product_name || item.estimator);
                                            setShowSaveTemplateDialog(true);
                                          }}
                                          editedFields={editedFields}
                                          comments={comments}
                                          users={users}
                                          currentUser={user}
                                          onAddComment={(versionId: string, itemId?: string) => {
                                            const productName = parseTableData(boqItem.table_data).product_name || boqItem.estimator;
                                            setCommentTarget({ type: itemId ? 'item' : 'product', id: itemId || boqItem.id, name: itemId ? `${productName} - Item ${itemId}` : productName });
                                            setShowCommentDialog(true);
                                          }}
                                          selectedVersionId={selectedVersionId}
                                          totalProducts={boqItems.length}
                                          itemCategoryFilter={itemCategoryFilter}
                                          bomButtonsEnabled={bomButtonsEnabled}
                                          onProductOrdinalChange={(toIdx) => {
                                            if (toIdx === displayIdx) return;
                                            const reordered = [...boqItems];
                                            const [moved] = reordered.splice(boqIdx, 1);
                                            reordered.splice(toIdx, 0, moved);
                                            setBoqItems(reordered);
                                            apiFetch('/api/boq-items/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemIds: reordered.map(i => i.id) }) }).catch(console.error);
                                          }}
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      }
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Action Buttons */}
              {selectedProjectId && selectedVersionId && (
                <Card>
                  <CardContent className="space-y-3 pt-6">
                    {selectedVersion && <VersionStatusBanner version={selectedVersion} />}
                    <PriceUpdateBanner
                      mismatches={activeMismatches}
                      onApplyAll={handleUpdateAllRates}
                      onApplySingle={handleUpdateSingleMismatch}
                      onIgnoreSingle={handleIgnoreMismatch}
                      onViewSingle={handleViewMismatch}
                      isUpdating={isUpdatingRates}
                    />
                    <ProjectPricingBanner
                      items={activePpMatches}
                      onApplyAll={handleUpdateAllPp}
                      onApplySingle={handleUpdateSinglePp}
                      onIgnoreSingle={handleIgnoreSinglePp}
                      isUpdating={isUpdatingRates}
                    />

                    {/* Version History Modal */}
                    <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                      {!isReadOnlyMode && (
                        <>
                          <Button onClick={withBudgetCheck(() => currentProjectValue, handleSaveProject)} variant="outline" disabled={isVersionSubmitted || Object.keys(editedFields).length === 0}>Save Draft</Button>
                          <Button onClick={() => handleSubmitVersion("submitted")} variant="outline" className="border-primary text-primary hover:bg-primary/5 font-bold" disabled={isVersionSubmitted || boqItems.length === 0 || hasPendingRateAmendments} title={hasPendingRateAmendments ? "Cannot lock: There are rate amendments that must be submitted and approved first." : undefined}>Lock Version</Button>
                          {rateAmendmentSummary.hasDraft ? (
                            <Button onClick={handleSubmitRateAmendRequests} variant="default" className="bg-amber-600 hover:bg-amber-700 font-bold" title="Send the amended rate(s) to admin for approval">
                              Submit Rate Amend Request
                            </Button>
                          ) : rateAmendmentSummary.hasPending ? (
                            <Button variant="default" className="bg-amber-300 font-bold cursor-not-allowed" disabled title="Waiting for admin to approve or reject the submitted rate change request(s)">
                              Awaiting Rate Approval
                            </Button>
                          ) : (
                            <Button onClick={() => handleSubmitVersion("pending_approval")} variant="default" className="bg-primary hover:bg-primary/90 font-bold" disabled={isVersionSubmitted || boqItems.length === 0}>Submit for Approval</Button>
                          )}
                        </>
                      )}
                      <Button onClick={handleDownloadExcel} variant="outline" disabled={boqItems.length === 0}>Download Excel</Button>
                      <Button onClick={handleDownloadPdf} variant="outline" disabled={boqItems.length === 0}>Download PDF</Button>
                    </div>
                    {rateAmendmentSummary.hasDraft && (
                      <div className="col-span-full flex items-center gap-2 mt-2 p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
                        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                        <span>You've amended one or more rates. Click "Submit Rate Amend Request" to send them for admin approval — Submit for Approval will unlock once approved.</span>
                      </div>
                    )}
                    {!rateAmendmentSummary.hasDraft && rateAmendmentSummary.hasPending && (
                      <div className="col-span-full flex items-center gap-2 mt-2 p-2 rounded-md bg-orange-50 border border-orange-200 text-orange-700 text-xs font-semibold">
                        <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
                        <span>Rate change request submitted. Waiting for admin approval — Submit for Approval will become available once approved.</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <Dialog open={approvalsModalOpen} onOpenChange={setApprovalsModalOpen}>
              <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Approvals & Requests</DialogTitle>
                  <DialogDescription>Review pending BOM approvals and rate change requests.</DialogDescription>
                </DialogHeader>
                <div className="py-4">
                  <ApprovalsList
                    approvals={approvals}
                    rateChangeRequests={rateChangeRequests}
                    onPreview={(a) => { setApprovalsModalOpen(false); handlePreviewApproval(a); }}
                    onAction={handleApprovalAction}
                    onRateAction={handleRateAction}
                    actionLoading={approvalActionLoading || rateActionLoading}
                  />
                </div>
              </DialogContent>
            </Dialog>
          </Tabs>
        </div>
      </Layout>

      {/* Small floating Add buttons at bottom-right (duplicate of top actions) */}
      <div className="fixed right-6 bottom-24 z-50 flex flex-col items-end gap-2 md:gap-3">
        {!isReadOnlyMode && (
          <>
            <Button onClick={handleAddProduct} className="bg-primary text-white h-8 px-3 text-xs font-semibold shadow-sm" disabled={isVersionSubmitted || !selectedVersionId || !bomButtonsEnabled || isSaving} title="Add Product">
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
              + Add Product
            </Button>

            <Button onClick={handleAddProductManual} variant="outline" className="border-slate-200 h-8 px-3 text-xs font-semibold shadow-sm bg-white" disabled={isVersionSubmitted || !selectedVersionId || !bomButtonsEnabled || isSaving} title="Add Item">
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
              + Add Item
            </Button>
          </>
        )}

        <Button
          onClick={() => setIsCompactView(!isCompactView)}
          variant="outline"
          className={`h-8 px-3 text-xs font-semibold shadow-sm ${isCompactView ? 'bg-blue-50 text-blue-600 border-blue-300' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
          title="Toggle Compact View"
        >
          Compact View
        </Button>
      </div>

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
              <input
                type="number"
                value={targetRequiredQty}
                onChange={(e) => setTargetRequiredQty(Number(e.target.value))}
                className="w-full border rounded px-3 py-2 text-lg font-bold focus:ring-1 ring-blue-500 outline-none"
              />
              <span className="text-muted-foreground font-semibold">{pendingItems[0]?.unit || "Unit"}</span>
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
            }, confirmAddToBom)} className="bg-primary text-white font-bold" disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Add to BOM
            </Button>

          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Material Quantity Increase Dialog */}
      <Dialog open={showQtyIncreaseDialog} onOpenChange={setShowQtyIncreaseDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <ArrowUp className="h-5 w-5" />
              Quantity Increase Detected
            </DialogTitle>
            <DialogDescription>
              The following materials have higher quantities in recently approved Purchase Orders compared to the product template.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left font-bold text-slate-500 uppercase">Material</th>
                    <th className="px-3 py-2 text-center font-bold text-slate-500 uppercase">Template Qty</th>
                    <th className="px-3 py-2 text-center font-bold text-slate-500 uppercase">Latest PO Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {qtyIncreases.map((inc, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      <td className="px-3 py-2 font-medium">
                        {inc.name}
                        <div className="text-[10px] text-slate-400 font-normal">Approved in PO: {inc.poNumber}</div>
                      </td>
                      <td className="px-3 py-2 text-center text-slate-500">{inc.templateQty}</td>
                      <td className="px-3 py-2 text-center font-bold text-amber-700 bg-amber-50">
                        {inc.poQty}
                        <ArrowUp className="inline h-2 w-2 ml-0.5" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-sm text-slate-600 font-medium italic text-center">
              Do you want to update the product template with these new quantities?
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={async () => {
                if (pendingAddProductData) {
                  await saveBoqItem(pendingAddProductData);
                }
                setShowQtyIncreaseDialog(false);
              }}
              className="font-bold"
            >
              No, Keep Original
            </Button>
            <Button
              onClick={async () => {
                if (pendingAddProductData) {
                  const updatedTd = { ...pendingAddProductData };

                  // Update template in DB and local tableData
                  for (const inc of qtyIncreases) {
                    try {
                      await apiFetch("/api/products/update-template-qty", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          productId: updatedTd.product_id,
                          materialId: inc.materialId,
                          newQty: inc.poQty,
                          originalQty: inc.originalQty,
                          poId: inc.poId
                        })
                      });

                      // Update local materialLines using factor
                      if (updatedTd.materialLines) {
                        const factor = parseFloat(inc.poQty) / parseFloat(inc.originalQty);
                        updatedTd.materialLines = updatedTd.materialLines.map((ml: any) =>
                          (ml.id === inc.materialId || ml.materialId === inc.materialId)
                            ? { ...ml, baseQty: ml.baseQty * factor }
                            : ml
                        );
                      }
                    } catch (err) {
                      console.error("Failed to update template qty for", inc.name, err);
                    }
                  }

                  await saveBoqItem(updatedTd);
                  toast({ title: "Template Updated", description: "Product template and current item updated with new quantities." });
                }
                setShowQtyIncreaseDialog(false);
              }}
              className="bg-amber-600 hover:bg-amber-700 text-white font-bold"
            >
              Yes, Update Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Budget warning dialogs removed for Generate BOM page */}

      {/* Load Template Dialog */}
      <Dialog open={showTemplateManager} onOpenChange={setShowTemplateManager}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-blue-600" />
              BOM Templates
            </DialogTitle>
            <DialogDescription>
              Select a saved BOM template to add it to your current version.
            </DialogDescription>
          </DialogHeader>
          <div className="px-1 pt-2 pb-1">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search templates by name..."
                className="pl-9 h-9 text-sm bg-slate-50/50 border-slate-200 focus:bg-white transition-colors"
                value={templateSearch}
                onChange={(e) => setTemplateSearch(e.target.value)}
              />
            </div>
          </div>
          {!selectedVersionId && (
            <div className="mx-0 mb-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <div className="text-xs font-bold text-red-800">⚠️ No Version Selected</div>
              <div className="text-xs text-red-700">Please select or create a BOQ version first to apply templates.</div>
            </div>
          )}
          <div className="py-2">
            <Tabs defaultValue="bom" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="bom" className="text-xs font-bold">BOM Templates</TabsTrigger>
                <TabsTrigger value="sketch" className="text-xs font-bold">Sketch Templates</TabsTrigger>
              </TabsList>

              <TabsContent value="bom">
                <div className="py-2 max-h-[50vh] overflow-y-auto">
                  {bomTemplates.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                      <div className="text-sm font-medium">No BOM templates saved yet.</div>
                      <div className="text-xs">Save any product card as a template to see it here.</div>
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {bomTemplates
                        .filter(t => fuzzySearch(templateSearch, [t.name, t.config?.product_name || ""]))
                        .map((template) => (
                          <div key={template.id} className="flex items-center justify-between p-3 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                            <div className="flex flex-col">
                              <span className="text-sm font-bold text-slate-800">{template.name}</span>
                              <span className="text-[10px] text-slate-500 uppercase font-medium">
                                {template.config?.product_name || "Custom Product"} • Created {new Date(template.created_at).toLocaleDateString()}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button variant="outline" size="sm" onClick={() => handleApplyTemplate(template)} className="h-8 text-xs font-bold">
                                Apply
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => handleDeleteTemplate(template.id)} className="h-8 w-8 p-0 text-slate-400 hover:text-red-600">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="sketch">
                <div className="py-2 max-h-[50vh] overflow-y-auto">
                  {sketchTemplates.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                      <div className="text-sm font-medium">No Sketch templates found.</div>
                      <div className="text-xs">Save templates in the "Sketch a Plan" module to see them here.</div>
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {sketchTemplates
                        .filter(t => fuzzySearch(templateSearch, [t.name]))
                        .map((template) => {
                          const itemCount = template.itemCount || 0;

                          return (
                            <div key={template.id} className="flex items-center justify-between p-3 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                              <div className="flex flex-col">
                                <span className="text-sm font-bold text-slate-800">{template.name}</span>
                                <span className="text-[10px] text-slate-500 uppercase font-medium">
                                  Sketch Template • {itemCount} items • Created {new Date(template.created_at).toLocaleDateString()}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button variant="outline" size="sm" onClick={() => handleApplySketchTemplate(template)} className="h-8 text-xs font-bold bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100">
                                  Apply to BOM
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => handleDeleteSketchTemplate(template.id)} className="h-8 w-8 p-0 text-slate-400 hover:text-red-600">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTemplateManager(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save Template Dialog */}
      <Dialog open={showSaveTemplateDialog} onOpenChange={setShowSaveTemplateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Save className="h-5 w-5 text-green-600" />
              Save as BOM Template
            </DialogTitle>
            <DialogDescription>
              Enter a name for this template to reuse it in other projects.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="templateName">Template Name</Label>
              <Input
                id="templateName"
                placeholder="e.g. Standard Kitchen Cabinet"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                autoFocus
              />
            </div>
            {templateToSave && (
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Product Details</div>
                <div className="text-xs font-bold text-slate-700">{parseTableData(templateToSave.table_data).product_name || templateToSave.estimator}</div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveTemplateDialog(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!templateToSave) return;
                const mergedData = getMergedTableData(templateToSave);
                handleSaveAsTemplate(newTemplateName, mergedData);
              }}
              disabled={!newTemplateName.trim()}
              className="bg-green-600 hover:bg-green-700 text-white font-bold"
            >
              Save Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deleteConfirm && (
        <DeleteConfirmationDialog
          isOpen={!!deleteConfirm}
          onOpenChange={(open) => !open && setDeleteConfirm(null)}
          onConfirm={confirmDelete}
          itemName={deleteConfirm.name}
          title={deleteConfirm.type === 'template' ? "Delete BOM Template?" : "Delete BOQ Version?"}
          permanentDelete={true}
        />
      )}

      {/* Chat Comment Dialog */}
      <Dialog open={showCommentDialog} onOpenChange={(open) => {
        if (!open) {
          setShowCommentDialog(false);
          setCommentTarget(null);
          setReplyingTo(null);
          setCommentInboxView(false);
          setIsSelectingThread(false);
        }
        setShowCommentDialog(open);
      }}>
        <DialogContent className="sm:max-w-[420px] md:max-w-[480px] max-h-[520px] h-[520px] flex flex-col p-0 overflow-hidden bg-[#f0f2f5] gap-0">
          {(commentInboxView && !commentTarget) ? (
            <>
              <DialogHeader className="p-4 border-b bg-white shrink-0 flex flex-row items-center gap-3">
                <div className="bg-blue-600 p-2 rounded-full">
                  <MessageSquare className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1">
                  <DialogTitle className="text-lg font-bold text-gray-900 leading-tight">
                    {isSelectingThread ? "New Chat" : "Discussions"}
                  </DialogTitle>
                  <div className="text-xs text-gray-500">
                    {isSelectingThread ? "Choose a product to start a discussion" : "Stay updated on all BOQ threads"}
                  </div>
                </div>
                {!isSelectingThread ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full h-8 w-8 text-blue-600 hover:bg-blue-50"
                    onClick={() => {
                      setIsSelectingThread(true);
                      setThreadSearchQuery("");
                    }}
                    title="Start New Discussion"
                  >
                    <Plus className="h-5 w-5" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-gray-500 text-xs font-semibold"
                    onClick={() => setIsSelectingThread(false)}
                  >
                    Cancel
                  </Button>
                )}
              </DialogHeader>
              <div className="flex-1 overflow-y-auto bg-white flex flex-col">
                {isSelectingThread ? (
                  <div className="flex flex-col">
                    {/* Search Bar */}
                    <div className="p-3 bg-gray-50 border-b sticky top-0 z-10">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                        <Input
                          placeholder="Search products or topics..."
                          className="pl-9 h-9 bg-white border-gray-200 text-xs rounded-lg"
                          value={threadSearchQuery}
                          onChange={e => setThreadSearchQuery(e.target.value)}
                          autoFocus
                        />
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                      {/* Overall Version Option - only show if matches search or search is empty */}
                      {("Overall Version Discussion".toLowerCase().includes(threadSearchQuery.toLowerCase())) && (
                        <div
                          className="flex items-center gap-4 p-4 hover:bg-gray-50 cursor-pointer border-b"
                          onClick={() => {
                            setCommentTarget({ type: 'overall', id: selectedVersionId!, name: 'Overall Version Discussion' });
                            setCommentInboxView(false);
                            setIsSelectingThread(false);
                            setThreadSearchQuery("");
                          }}
                        >
                          <div className="h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
                            <Users className="h-5 w-5" />
                          </div>
                          <div className="flex-1">
                            <div className="font-bold text-sm text-gray-900">Overall Version</div>
                            <div className="text-[10px] text-gray-500 uppercase tracking-tighter">Budget • Timeline • General Info</div>
                          </div>
                        </div>
                      )}

                      {/* Filtered Products */}
                      {Array.isArray(boqItems) && boqItems
                        .filter(bi => {
                          const td = parseTableData(bi.table_data);
                          const name = td.product_name || bi.estimator;
                          return name.toLowerCase().includes(threadSearchQuery.toLowerCase());
                        })
                        .map(bi => {
                          const td = parseTableData(bi.table_data);
                          const pName = td.product_name || bi.estimator;
                          return (
                            <div
                              key={bi.id}
                              className="flex items-center gap-4 p-4 hover:bg-gray-50 cursor-pointer border-b"
                              onClick={() => {
                                setCommentTarget({ type: 'product', id: bi.id, name: pName });
                                setCommentInboxView(false);
                                setIsSelectingThread(false);
                                setThreadSearchQuery("");
                              }}
                            >
                              <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                                <Briefcase className="h-5 w-5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-bold text-sm text-gray-900 truncate">{pName}</div>
                                <div className="text-[10px] text-gray-500 uppercase tracking-tighter truncate">Product ID: {bi.id.slice(0, 8)}...</div>
                              </div>
                            </div>
                          );
                        })}

                      {boqItems.length > 0 && boqItems.filter(bi => (parseTableData(bi.table_data).product_name || bi.estimator).toLowerCase().includes(threadSearchQuery.toLowerCase())).length === 0 && (
                        <div className="p-10 text-center text-gray-400 text-xs">
                          No products match your search.
                        </div>
                      )}
                    </div>
                  </div>
                ) : (() => {
                  const threads: Record<string, { lastComment: BOMComment, count: number, name: string, type: 'product' | 'item' | 'overall', id: string }> = {};

                  comments
                    .filter(c => !c.visible_to || c.visible_to.length === 0 || c.visible_to.includes(user?.username || "") || c.user_id === user?.id)
                    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                    .forEach(c => {
                      const id = c.item_id || c.product_id || 'overall';
                      const type = c.item_id ? 'item' : (c.product_id ? 'product' : 'overall');

                      let name = "Overall Version";
                      if (type === 'product') {
                        const boqItem = (boqItems as BOMItem[]).find(bi => bi.id === c.product_id);
                        name = boqItem ? (parseTableData(boqItem.table_data).product_name || boqItem.estimator) : "Product Discussion";
                      } else if (type === 'item') {
                        const productId = c.item_id!.split('_')[0];
                        const boqItem = (boqItems as BOMItem[]).find(bi => bi.id === productId);
                        const productName = boqItem ? (parseTableData(boqItem.table_data).product_name || boqItem.estimator) : "BOM Item";
                        name = `${productName} (Material)`;
                      }

                      threads[id] = {
                        lastComment: c,
                        count: (threads[id]?.count || 0) + 1,
                        name,
                        type,
                        id: c.item_id || c.product_id || 'overall'
                      };
                    });

                  const sortedThreads = Object.values(threads).sort((a, b) =>
                    new Date(b.lastComment.created_at).getTime() - new Date(a.lastComment.created_at).getTime()
                  );

                  if (sortedThreads.length === 0) return (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 p-10 text-center">
                      <MessageSquare className="h-12 w-12 mb-4 opacity-20" />
                      <div className="font-semibold">No discussions yet</div>
                      <div className="text-xs">Individual item chats will appear here.</div>
                    </div>
                  );

                  return sortedThreads.map(thread => {
                    const unread = comments.filter(c => {
                      const contextId = c.item_id || c.product_id || 'overall';
                      if (contextId !== thread.id) return false;
                      if (c.user_id === user?.id) return false; // my own sent messages aren't unread
                      const isVisible = (!c.visible_to || c.visible_to.length === 0 || c.visible_to.includes(user?.username || ""));
                      return isVisible && (!c.read_by || !c.read_by.includes(user?.id || ""));
                    }).length;

                    return (
                      <div
                        key={thread.id}
                        className="flex items-center gap-3 p-3 border-b hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => {
                          if (thread.type === 'overall' && !selectedVersionId) return;
                          setCommentTarget({ type: thread.type, id: thread.id === 'overall' ? (selectedVersionId || "") : thread.id, name: thread.name });
                        }}
                      >
                        <div className={`h-12 w-12 rounded-full flex items-center justify-center shrink-0 ${thread.type === 'overall' ? 'bg-indigo-100 text-indigo-600' : thread.type === 'product' ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'}`}>
                          {thread.type === 'overall' ? <Users className="h-6 w-6" /> : thread.type === 'product' ? <Briefcase className="h-6 w-6" /> : <MessageSquare className="h-6 w-6" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start mb-0.5">
                            <h4 className="font-bold text-gray-900 truncate text-sm">{thread.name}</h4>
                            <span className="text-[10px] text-gray-400 whitespace-nowrap ml-2">
                              {new Date(thread.lastComment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <p className="text-xs text-gray-500 truncate italic pr-4">
                              {thread.lastComment.user_full_name}: {thread.lastComment.comment_text}
                            </p>
                            {unread > 0 && (
                              <Badge className="bg-[#25D366] text-white text-[10px] rounded-full h-5 min-w-5 flex items-center justify-center px-1 font-bold shadow-sm border-0">
                                {unread}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </>
          ) : (
            <>
              <DialogHeader className="p-3 border-b bg-gray-50 shrink-0 flex flex-row items-center gap-3">
                {commentInboxView && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-gray-500 hover:bg-gray-200" onClick={() => setCommentTarget(null)}>
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                )}
                <div className={`${commentTarget?.type === 'overall' ? 'bg-indigo-100 text-indigo-600' : commentTarget?.type === 'product' ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'} p-2 rounded-full`}>
                  {commentTarget?.type === 'overall' ? <Users className="h-5 w-5" /> : commentTarget?.type === 'product' ? <Briefcase className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <DialogTitle className="text-base font-bold text-gray-900 leading-tight truncate">
                    {commentTarget?.name}
                  </DialogTitle>
                  <div className="text-xs text-gray-500">Chat Discussion</div>
                </div>
              </DialogHeader>
              <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")' }}>
                {comments
                  .filter(c => commentTarget && (
                    commentTarget.type === 'product' ? c.product_id === commentTarget.id : (commentTarget.type === 'overall' ? (!c.product_id && !c.item_id) : c.item_id === commentTarget.id)
                  ))
                  .filter(c => {
                    if (!c.visible_to || c.visible_to.length === 0) return true;
                    return c.visible_to.includes(user?.username || "") || c.user_id === user?.id;
                  })
                  .map(c => {
                    const isMine = c.user_id === user?.id;
                    return (
                      <div key={c.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'} group`}>
                        <div className={`max-w-[85%] rounded-lg px-3 py-1.5 shadow-sm relative ${isMine ? 'bg-[#dcf8c6] text-gray-900 rounded-tr-none' : 'bg-white text-gray-900 rounded-tl-none'}`}>
                          <div className="flex justify-between items-start gap-4">
                            {!isMine && <div className="text-[11px] font-bold text-blue-600 mb-0.5">{c.user_full_name}</div>}
                            <button
                              onClick={() => {
                                setReplyingTo(c);
                                const ta = document.querySelector('textarea');
                                if (ta) ta.focus();
                              }}
                              className={`${isMine ? 'opacity-0 group-hover:opacity-100' : 'opacity-70 hover:opacity-100'} transition-opacity text-gray-400 hover:text-blue-500 p-0`}
                              title="Reply"
                            >
                              <Reply className="h-4 w-4" />
                            </button>
                          </div>

                          {c.parent_id && (
                            <div className="bg-black/5 border-l-4 border-blue-500 rounded p-1.5 mb-1 text-[11px] flex flex-col">
                              <span className="font-bold text-blue-600">{c.reply_to_user}</span>
                              <span className="text-gray-600 truncate">{c.reply_to_text}</span>
                            </div>
                          )}

                          {c.visible_to && c.visible_to.length > 0 && (
                            <div className="text-[9px] font-semibold text-blue-500/80 mb-0.5 uppercase tracking-tighter">
                              <span className="text-gray-400 mr-1">@</span>{c.visible_to.join(', ')}
                            </div>
                          )}
                          <div className="text-[13px] leading-snug break-words pr-10">{c.comment_text}</div>
                          <div className="text-[9px] text-gray-500 text-right mt-1 absolute bottom-1 right-2 flex items-center justify-end">
                            {new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {isMine && <Check className="h-3 w-3 ml-1 text-blue-500" />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
              {/* message input area */}
              <div className="p-3 bg-gray-50 border-t shrink-0 flex flex-col gap-2 bottom-0">
                {selectedMembers.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1 px-1">
                    {selectedMembers.map(mUsername => {
                      const u = users.find(user => user.username === mUsername);
                      return (
                        <Badge key={mUsername} variant="secondary" className="text-[10px] py-0 h-5 bg-blue-100 text-blue-700">
                          @{u?.fullName || u?.username || mUsername}
                          <X className="h-2.5 w-2.5 ml-1 cursor-pointer" onClick={() => setSelectedMembers(prev => prev.filter(x => x !== mUsername))} />
                        </Badge>
                      );
                    })}
                  </div>
                )}
                {replyingTo && (
                  <div className="bg-white/80 border-l-4 border-blue-500 p-2 rounded relative mb-1 mx-1 animate-in slide-in-from-bottom-2">
                    <div className="text-[11px] font-bold text-blue-600">{replyingTo.user_full_name}</div>
                    <div className="text-[12px] text-gray-600 truncate pr-6">{replyingTo.comment_text}</div>
                    <button onClick={() => setReplyingTo(null)} className="absolute top-1 right-1 text-gray-400 hover:text-gray-600">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <div className="flex gap-2 items-center">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-10 w-10 p-0 rounded-full text-gray-400 hover:text-blue-500 hover:bg-blue-50">
                        <Users className="h-5 w-5" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Tag members..." />
                        <CommandList>
                          <CommandEmpty>No members found.</CommandEmpty>
                          <CommandGroup heading="Group Participants">
                            {users
                              .map((u) => (
                                <CommandItem
                                  key={u.id}
                                  onSelect={() => {
                                    setSelectedMembers(prev =>
                                      prev.includes(u.username)
                                        ? prev.filter(m => m !== u.username)
                                        : [...prev, u.username]
                                    );
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      selectedMembers.includes(u.username) ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  <div className="flex flex-col">
                                    <span className="font-bold text-sm">{u.fullName || u.username}</span>
                                    <span className="text-[10px] text-gray-500 uppercase font-medium">{u.role} {u.department ? `• ${u.department}` : ''}</span>
                                  </div>
                                </CommandItem>
                              ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>

                  <Textarea
                    value={newComment}
                    onChange={e => setNewComment(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 rounded-2xl bg-white border-none py-2.5 px-4 resize-none shadow-sm h-10 min-h-[40px] max-h-32 text-sm focus-visible:ring-0"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendComment();
                      }
                    }}
                  />
                  <Button
                    onClick={handleSendComment}
                    disabled={!newComment.trim() || isSaving}
                    className="rounded-full h-10 w-10 p-0 bg-[#00a884] hover:bg-[#008f6f] text-white flex shrink-0 items-center justify-center shadow-sm"
                  >
                    <ArrowUp className="h-5 w-5 ml-0.5" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <BomSketchCompareDialog
        isOpen={showCompareDialog}
        onClose={() => setShowCompareDialog(false)}
        projectId={selectedProjectId}
        currentBomVersionId={selectedVersionId}
        onItemAdded={() => {
          loadBoqItemsAndEdits();
        }}
      />
      <ApprovalPreviewDialog
        approval={approvals.find(a => a.id === previewApprovalId)}
        items={previewApprovalItems}
        loading={loadingPreviewItems}
        open={!!previewApprovalId}
        onClose={() => setPreviewApprovalId(null)}
        onAction={handleApprovalAction}
        actionLoading={approvalActionLoading}
      />
      <ProductAnalysisDialog
        productName={analysisProduct || ""}
        isOpen={!!analysisProduct}
        onClose={() => setAnalysisProduct(null)}
      />

      {/* ── Refresh Categories Log Dialog ───────────────────────────────────── */}
      <Dialog open={showRefreshLogDialog} onOpenChange={setShowRefreshLogDialog}>
        <DialogContent className="sm:max-w-[560px] max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-700">
              <RefreshCw className="h-5 w-5" />
              Category Refresh Complete
            </DialogTitle>
            <DialogDescription>
              {refreshLog.length} item {refreshLog.length === 1 ? "category" : "categories"} updated
              to match the master product library. All other data (quantities, rates,
              materials) is untouched.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-2 py-2 pr-1">
            {refreshLog.map((entry, i) => (
              <div
                key={i}
                className="flex items-start gap-2.5 p-2.5 bg-emerald-50 border border-emerald-100 rounded-md text-sm"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-slate-800">{entry.itemName}</span>
                  <span className="text-slate-500 text-xs">
                    Category changed from{" "}
                    <span className="font-bold text-red-500">{entry.from}</span>
                    {" "}→{" "}
                    <span className="font-bold text-emerald-700">{entry.to}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter className="mt-4 pt-4 border-t">
            <Button
              onClick={() => setShowRefreshLogDialog(false)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            >
              Done
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
              Duplicate Products Found
            </DialogTitle>
            <DialogDescription>
              {duplicateGroups.length > 0
                ? `Found ${duplicateGroups.length} groups of exact duplicate products. Cleaning up will keep one instance of each and remove the rest.`
                : "Great! No exact duplicates were found in your BOM."}
            </DialogDescription>
          </DialogHeader>

          {duplicateGroups.length > 0 && (
            <div className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar">
              {duplicateGroups.map((group, idx) => {
                const td = parseTableData(group[0].table_data);
                return (
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
                          <h4 className={`font-bold text-sm ${selectedDuplicateIndices.has(idx) ? 'text-amber-800' : 'text-slate-700'}`}>{td.product_name || "Unnamed Product"}</h4>
                          <p className={`text-xs ${selectedDuplicateIndices.has(idx) ? 'text-amber-600' : 'text-slate-500'}`}>Repeated <strong>{group.length} times</strong></p>
                        </div>
                        <Badge variant="outline" className="bg-white">Qty: {td.targetRequiredQty || 1}</Badge>
                      </div>
                      {td.finalize_description && (
                        <p className="text-xs text-slate-600 italic line-clamp-2 mt-1">"{td.finalize_description}"</p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(td.step11_items || []).slice(0, 3).map((it: any, i: number) => (
                          <Badge key={i} variant="secondary" className="text-[9px] px-1 h-4 bg-slate-100 text-slate-500">{it.title || it.item_name}</Badge>
                        ))}
                        {(td.step11_items || []).length > 3 && <span className="text-[9px] text-slate-400">+{td.step11_items.length - 3} more</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
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

      {/* Floating Project Pricing Indicator */}
      {activePpMatches && activePpMatches.length > 0 && (
        <div
          className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5 fade-in duration-500"
          title="Project Pricing Available"
        >
          <Button
            onClick={() => document.getElementById('project-pricing-banner')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg h-14 w-14 p-0 flex items-center justify-center gap-2 overflow-hidden group transition-all duration-300 hover:w-auto hover:px-4 border-2 border-white/20"
          >
            <div className="relative flex items-center justify-center shrink-0">
              <Star className="h-6 w-6 fill-yellow-400 text-yellow-400 animate-pulse" />
              <div className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold h-4 w-4 rounded-full flex items-center justify-center ring-2 ring-blue-600">
                {activePpMatches.length}
              </div>
            </div>
            <span className="font-bold text-sm whitespace-nowrap opacity-0 w-0 group-hover:opacity-100 group-hover:w-auto transition-all duration-300 overflow-hidden">
              Project Pricing Available
            </span>
          </Button>
        </div>
      )}
    </>
  );
}