import { useState, useEffect, useRef, useMemo } from "react";
import { differenceInDays, format } from "date-fns";
import { fuzzySearch } from "@/lib/utils";
import { Layout } from "@/components/layout/Layout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DeleteConfirmationDialog } from "@/components/ui/DeleteConfirmationDialog";
import { cn } from "@/lib/utils";
import { useData, Material, Shop } from "@/lib/store";
import {
  Plus,
  Trash2,
  Building2,
  Package,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  MapPin,
  Layers,
  Search,
  ChevronDown,
  ChevronUp,
  Copy,
  X,
  Check,
  ArrowLeft,
  Image as ImageIcon,
  PackageOpen,
  Send,
  CheckCheck,
  Loader2,
  Store,
  Diamond,
  ChevronRight,
  FileDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { postJSON, apiFetch } from "@/lib/api";
import { Link, useLocation } from "wouter";
import * as XLSX from "xlsx";
import { AllMaterialsSplitView } from "@/components/admin/AllMaterialsSplitView";
import { AllProductsSplitView } from "@/components/admin/AllProductsSplitView";

/* 🔴 REQUIRED ASTERISK */
const Required = () => <span className="text-red-500 ml-1">*</span>;

const parseImages = (imageField: string | null | undefined): string[] => {
  if (!imageField) return [];
  try {
    if (imageField.startsWith('[')) {
      return JSON.parse(imageField);
    }
    return [imageField];
  } catch (e) {
    return [imageField];
  }
};

const ImageGallery = ({ images, onRemove, onPreview }: { images: string | null | undefined, onRemove?: (index: number) => void, onPreview?: (url: string) => void }) => {
  const imageList = parseImages(images);
  if (imageList.length === 0) return null;

  return (
    <div className="mt-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {imageList.map((img, idx) => (
        <div key={idx} className="relative group aspect-square border rounded-md overflow-hidden bg-gray-50 flex items-center justify-center cursor-pointer">
          <img
            src={img}
            alt={`Preview ${idx + 1}`}
            className="max-w-full max-h-full object-contain"
            onClick={() => onPreview?.(img)}
          />
          {onRemove && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(idx);
              }}
              className="absolute top-1 right-1 p-1 bg-white/80 hover:bg-red-500 hover:text-white text-red-500 rounded-full shadow-sm transition-all"
              title="Remove image"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

const UNIT_OPTIONS = [
  "pcs", "kg", "meter", "sqft", "cum", "litre", "set", "nos",
  "Meters", "Square feet", "Numbers", "Square Meter", "Bags", "Running feet", "Running meter",
  "LS", "BOX", "LTR", "CQM", "cft", "ml", "DOZ", "PKT", "Man labour", "Points",
  "Roll", "Days", "Inches", "Hours", "Percentage", "Length", "Panel", "Drum", "Ft", "1 Pkt",
  "Job", "Units"
];

// Removed hardcoded CATEGORY_OPTIONS - will be dynamic now

const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
  "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry"
];

const COUNTRY_CODES = [
  { code: "+91", country: "India" },
  { code: "+1", country: "USA" },
  { code: "+44", country: "UK" },
  { code: "+61", country: "Australia" },
  { code: "+971", country: "UAE" },
  { code: "+81", country: "Japan" },
  { code: "+49", country: "Germany" },
];

export default function AdminDashboard() {
  const { toast } = useToast();
  const {
    shops,
    materials,
    addShop,
    addMaterial,
    user,
    approvalRequests: shopRequests = [],
    setApprovalRequests: setShopRequests,
    supportMessages = [],
    submitShopForApproval,
    submitMaterialForApproval,
    approveShop,
    rejectShop,
    deleteShop,
    deleteMaterial,
    addSupportMessage,
    updateSupportMessage,
    deleteMessage,
    materialApprovalRequests: materialRequests = [],
    setMaterialApprovalRequests: setMaterialRequests,
    approveMaterial,
    rejectMaterial,
    refreshMaterials,
    refreshPendingApprovals,
  } = useData();

  const [rejectReason, setRejectReason] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [selectedPreviewImage, setSelectedPreviewImage] = useState<string | null>(null);
  const [selectedConversationEmail, setSelectedConversationEmail] = useState<string | null>(null);
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({});
  const [isReplying, setIsReplying] = useState<string | null>(null);
  const adminChatScrollRef = useRef<HTMLDivElement>(null);

  // Duplicate detection state
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<any[]>([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [cleaningDuplicates, setCleaningDuplicates] = useState(false);
  const [selectedDuplicateGroups, setSelectedDuplicateGroups] = useState<Set<number>>(new Set());

  // Local managed copies so admin can edit/delete/disable items in UI
  const [localMaterials, setLocalMaterials] = useState(() => [] as Array<any>);
  const [localShops, setLocalShops] = useState(() => [] as Array<any>);
  const [alerts, setAlerts] = useState<Array<any>>([]);
  const [masterMaterials, setMasterMaterials] = useState<any[]>([]);
  const [supportMsgs, setSupportMsgs] = useState<any[]>([]);

  const [displayShops, setDisplayShops] = useState(0);
  const [displayMaterials, setDisplayMaterials] = useState(0);
  const [displayPricing, setDisplayPricing] = useState(0);
  const [cardsVisible, setCardsVisible] = useState(false);

  useEffect(() => {
    if (!shops.length && !materials.length) return;
    setCardsVisible(true);

    const animateCount = (
      target: number,
      setter: (v: number) => void
    ) => {
      const duration = 1500;
      const steps = 60;
      const increment = target / steps;
      let current = 0;
      const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
          setter(target);
          clearInterval(timer);
        } else {
          setter(Math.floor(current));
        }
      }, duration / steps);
    };

    animateCount(shops.length, setDisplayShops);
    animateCount(
      materials.length,
      setDisplayMaterials
    );
    animateCount(
      materials.filter((m: any) => m.is_project_pricing).length,
      setDisplayPricing
    );
  }, [shops.length, materials.length]);

  const [newMasterMaterial, setNewMasterMaterial] = useState<{
    name: string;
    code: string;
    category: string;
    subcategory: string;
    vendorCategory: string;
    taxCodeType: 'hsn' | 'sac' | null;
    taxCodeValue: string;
    hsnCode: string;
    sacCode: string;
    technicalSpecification: string;
    image?: string;
  }>({
    name: "",
    code: "",
    category: "",
    subcategory: "",
    vendorCategory: "",
    taxCodeType: null,
    taxCodeValue: "",
    hsnCode: "",
    sacCode: "",
    technicalSpecification: "",
    image: undefined,
  });

  useEffect(() => {
    if (adminChatScrollRef.current) {
      adminChatScrollRef.current.scrollTop = adminChatScrollRef.current.scrollHeight;
    }
  }, [selectedConversationEmail, supportMessages]);

  // Load proposal material submissions
  useEffect(() => {
    const loadProposalMaterials = async () => {
      try {
        setLoadingProposalMaterials(true);
        const token = localStorage.getItem("authToken");
        const response = await fetch("/api/proposal-material-submissions-pending-approval", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!response.ok) {
          console.warn("Failed to load proposal materials, status:", response.status);
          setProposalMaterialSubmissions([]);
          setLoadingProposalMaterials(false);
          return;
        }

        const data = await response.json();
        setProposalMaterialSubmissions(data.submissions?.map((s: any) => s.submission) || []);
      } catch (err) {
        console.error("Error loading proposal material submissions:", err);
        setProposalMaterialSubmissions([]);
      } finally {
        setLoadingProposalMaterials(false);
      }
    };

    // Load initially
    loadProposalMaterials();

    // Reload every 30 seconds
    const interval = setInterval(loadProposalMaterials, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleSendReply = async (id: string) => {
    const text = replyTexts[id];
    if (!text?.trim()) return;
    try {
      // Use the updateSupportMessage helper which now points to the correct API
      await updateSupportMessage?.(id, { admin_reply: text, is_read: true });
      setReplyTexts(prev => ({ ...prev, [id]: "" }));
      setIsReplying(null);
      toast({ title: "Reply Sent", description: "The supplier will see your message in their history" });
    } catch (err) {
      toast({ title: "Error", description: "Failed to send reply", variant: "destructive" });
    }
  };

  // Helper to convert an uploaded image to a Base64 string
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, callback: (base64: string) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Filter out large files
    const validFiles = files.filter(file => {
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        toast({ title: "Error", description: `File ${file.name} is too large (>5MB)`, variant: "destructive" });
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;

    const uploadedImages: string[] = [];
    let processed = 0;

    validFiles.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        uploadedImages.push(reader.result as string);
        processed++;
        if (processed === validFiles.length) {
          // If multiple files, we'll return a JSON array string.
          // If only one file, we'll return the base64 string directly for backward compatibility
          // BUT if we want to support multiple images properly, we should always store as array
          // To keep it simple, let's always store as a JSON-ified array if multiple are selected,
          // or just append if we want to merge. 
          // Actually, let's just return the new images as a JSON array string.
          callback(JSON.stringify(uploadedImages));
        }
      };
      reader.onerror = () => {
        processed++;
        toast({ title: "Error", description: `Failed to read ${file.name}`, variant: "destructive" });
      };
      reader.readAsDataURL(file);
    });
  };

  // ==== CATEGORIES & SUBCATEGORIES (Admin/Software Team Created) ====
  const [categories, setCategories] = useState<string[]>([]);
  const [disabledCategories, setDisabledCategories] = useState<string[]>([]);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingCategoryValue, setEditingCategoryValue] = useState("");
  const [subCategories, setSubCategories] = useState<any[]>([]);

  const handleCheckDuplicates = async () => {
    setCheckingDuplicates(true);
    try {
      const response = await apiFetch("/api/admin/duplicates/materials");
      if (!response.ok) throw new Error("Failed to fetch duplicates");
      const data = await response.json();
      const groups = data.duplicates || [];
      setDuplicateGroups(groups);
      setSelectedDuplicateGroups(new Set(groups.map((_: any, i: number) => i))); // Select all by default
      setShowDuplicateDialog(true);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to check for duplicates",
        variant: "destructive",
      });
    } finally {
      setCheckingDuplicates(false);
    }
  };

  const handleCleanupDuplicates = async () => {
    if (duplicateGroups.length === 0 || selectedDuplicateGroups.size === 0) return;
    setCleaningDuplicates(true);
    try {
      const groupsToCleanup = duplicateGroups.filter((_, i) => selectedDuplicateGroups.has(i));
      const response = await apiFetch("/api/admin/duplicates/materials/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups: groupsToCleanup }),
      });

      if (!response.ok) throw new Error("Cleanup failed");
      const data = await response.json();

      toast({
        title: "Success",
        description: data.message,
      });
      setShowDuplicateDialog(false);
      setDuplicateGroups([]);
      if (typeof refreshMaterials === 'function') {
        refreshMaterials();
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to cleanup duplicates",
        variant: "destructive",
      });
    } finally {
      setCleaningDuplicates(false);
    }
  };

  // Load categories from API on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/categories');
        if (res.ok) {
          const data = await res.json();
          if (data?.categories) {
            setCategories(data.categories.sort((a: string, b: string) => a.localeCompare(b)));
          }
        }
      } catch (e) {
        console.warn('load categories failed', e);
      }
    })();
  }, []);

  // Load subcategories from API on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/subcategories-admin');
        if (res.ok) {
          const data = await res.json();
          if (data?.subcategories) {
            setSubCategories(data.subcategories.sort((a: any, b: any) => (a.name || "").localeCompare(b.name || "")));
          }
        }
      } catch (e) {
        console.warn('load subcategories failed', e);
      }
    })();
  }, []);

  // Load products from API on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/products');
        if (res.ok) {
          const data = await res.json();
          if (data?.products) {
            const mapped = data.products.map((p: any) => mapProduct(p));
            setProducts(mapped.sort((a: any, b: any) => (a.name || "").localeCompare(b.name || "")));
          }
        }
      } catch (e) {
        console.warn('load products failed', e);
      }
    })();
  }, []);

  // normalize product object from server (snake_case) to camelCase
  const mapProduct = (p: any) => ({
    ...p,
    taxCodeType: p.taxCodeType ?? p.tax_code_type ?? null,
    taxCodeValue: p.taxCodeValue ?? p.tax_code_value ?? "",
    hsnCode: p.hsn_code ?? p.hsnCode ?? "",
    sacCode: p.sac_code ?? p.sacCode ?? "",
  });

  // NEW CATEGORY/SUBCATEGORY INPUT
  const [newCategory, setNewCategory] = useState("");
  const [newSubCategory, setNewSubCategory] = useState("");
  const [selectedCategoryForSubCategory, setSelectedCategoryForSubCategory] = useState("");

  // EDITING SUBCATEGORY STATE
  const [editingSubCategoryId, setEditingSubCategoryId] = useState<string | null>(null);
  const [editingSubCategoryName, setEditingSubCategoryName] = useState("");
  const [editingSubCategoryCategory, setEditingSubCategoryCategory] = useState("");

  // PRODUCTS STATE
  const [products, setProducts] = useState<any[]>([]);
  const [newProduct, setNewProduct] = useState({ name: "", subcategory: "", taxCodeType: null as 'hsn' | 'sac' | null, taxCodeValue: "", hsnCode: "", sacCode: "", image: undefined as string | undefined });
  const [showAddSubInline, setShowAddSubInline] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [productForTemplate, setProductForTemplate] = useState<any>(null);

  const handleUpdateProductImage = async (productId: string, imageUrl: string) => {
    try {
      if (productId === 'temp') {
        setNewProduct(prev => ({ ...prev, image: JSON.stringify([imageUrl]) }));
        toast({ title: "Success", description: "Template selected as product icon" });
        return;
      }

      const product = products.find((p: any) => p.id === productId);
      if (!product) return;

      const payload = {
        ...product,
        image: JSON.stringify([imageUrl])
      };

      const res = await apiFetch(`/products/${productId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const updated = await res.json();
        const updatedProd = mapProduct(updated.product || updated);
        setProducts((prev: any[]) => prev.map((p: any) => p.id === productId ? updatedProd : p));
        toast({ title: "Success", description: "Product icon updated successfully" });
      }
    } catch (err) {
      console.error('Update product image error:', err);
      toast({ title: "Error", description: "Failed to update product icon", variant: "destructive" });
    }
  };
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [searchCategories, setSearchCategories] = useState("");
  const [searchSubCategories, setSearchSubCategories] = useState("");
  const [searchProducts, setSearchProducts] = useState("");

  const [filterSubCategoryByCategory, setFilterSubCategoryByCategory] = useState("all");
  const [filterProductByCategory, setFilterProductByCategory] = useState("all");
  const [filterProductBySubCategory, setFilterProductBySubCategory] = useState("all");

  const [showAddProductDialog, setShowAddProductDialog] = useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteData, setDeleteData] = useState<{
    type: 'category' | 'subcategory';
    name: string;
    id?: string;
    impact: { subcategories?: string[], products?: string[], templates?: string[], materials?: string[] };
  } | null>(null);
  const [reassignToSubcategory, setReassignToSubcategory] = useState<string>("none");

  // GENERIC DELETE CONFIRMATION STATE (for simpler items)
  const [genericDelete, setGenericDelete] = useState<{
    isOpen: boolean;
    id: string;
    name: string;
    type: 'shop' | 'material' | 'product';
  } | null>(null);

  const confirmGenericDelete = async (action: 'archive' | 'trash') => {
    if (!genericDelete) return;
    const { id, type, name } = genericDelete;
    try {
      if (type === 'shop') {
        await deleteShop(id, action);
        setLocalShops((prev: any[]) => prev.filter((p: any) => p.id !== id));
        toast({ title: action === 'trash' ? 'Trashed' : 'Archived', description: `${name} has been moved to ${action}` });
      } else if (type === 'material') {
        await deleteMaterial(id, action);
        setLocalMaterials((prev: any[]) => prev.filter((p: any) => p.id !== id));
        toast({ title: action === 'trash' ? 'Trashed' : 'Archived', description: `${name} has been moved to ${action}` });
      } else if (type === 'product') {
        await apiFetch(`/products/${id}?action=${action}`, { method: 'DELETE' });
        setProducts((prev: any[]) => prev.filter((p: any) => p.id !== id));
        toast({ title: action === 'trash' ? 'Trashed' : 'Archived', description: `${name} has been moved to ${action}` });
      }
    } catch (err) {
      toast({ title: 'Error', description: `Failed to delete ${name}`, variant: 'destructive' });
    }
    setGenericDelete(null);
  };

  const requestDeleteCategory = async (cat: string) => {
    try {
      const impactRes = await apiFetch(`/categories/${encodeURIComponent(cat)}/impact`);
      const impact = await impactRes.json();
      setDeleteData({
        type: 'category',
        name: cat,
        impact: {
          subcategories: impact.subcategories || [],
          templates: impact.templates || [],
          materials: impact.materials || [],
          products: impact.products || []
        }
      });
      setDeleteConfirmOpen(true);
    } catch (err) {
      console.error('delete category impact error', err);
      toast({ title: 'Error', description: 'Failed to fetch impact data', variant: 'destructive' });
    }
  };

  const requestDeleteSubCategory = async (sub: any) => {
    try {
      const impactRes = await apiFetch(`/subcategories/${sub.id}/impact`);
      const impact = await impactRes.json();
      setDeleteData({
        type: 'subcategory',
        name: sub.name,
        id: sub.id,
        impact: {
          materials: impact.materials || [],
          products: impact.products || []
        }
      });
      setDeleteConfirmOpen(true);
    } catch (err) {
      console.error('delete subcategory impact error', err);
      toast({ title: 'Error', description: 'Failed to fetch impact data', variant: 'destructive' });
    }
  };

  const confirmDeleteAction = async (action: 'archive' | 'trash') => {
    if (!deleteData) return;

    try {
      if (deleteData.type === 'category') {
        const cat = deleteData.name;
        await apiFetch(`/categories/${encodeURIComponent(cat)}?action=${action}`, { method: 'DELETE' });
        setCategories(prev => prev.filter(c => c !== cat));
        setSubCategories(prev => prev.filter(s => s.category !== cat));
        toast({ title: 'Deleted', description: `Category ${cat} safely removed` });
      } else {
        const id = deleteData.id!;

        // If user picked a subcategory to reassign materials to, do that first
        if (reassignToSubcategory && reassignToSubcategory !== "none" && reassignToSubcategory !== deleteData.id) {
          try {
            await apiFetch('/subcategories/reassign', {
              method: 'POST',
              body: JSON.stringify({ fromSubcategoryId: deleteData.id, toSubcategoryId: reassignToSubcategory }),
            });
            toast({ title: 'Reassigned', description: `Materials moved to "${reassignToSubcategory}"` });
          } catch (reassignErr) {
            console.error('reassign error', reassignErr);
            toast({ title: 'Warning', description: 'Reassign failed, proceeding with delete (materials will be uncategorized)', variant: 'destructive' });
          }
        }

        const res = await apiFetch(`/subcategories/${id}?action=${action}`, { method: 'DELETE' });
        if (res.ok) {
          setSubCategories(prev => prev.filter(s => s.id !== id));
          toast({ title: 'Deleted', description: `Subcategory ${deleteData.name} safely removed` });
        } else {
          toast({ title: 'Error', description: 'Failed to delete subcategory', variant: 'destructive' });
        }
      }
    } catch (err) {
      console.error('delete action error', err);
      toast({ title: 'Error', description: `Failed to delete ${deleteData.type}`, variant: 'destructive' });
    } finally {
      setDeleteConfirmOpen(false);
      setDeleteData(null);
      setReassignToSubcategory("none");
    }
  };



  // Handle Add Category
  const handleAddCategory = async () => {
    if (!newCategory.trim()) {
      toast({
        title: "Error",
        description: "Category name is required",
        variant: "destructive",
      });
      return;
    }

    if (categories.includes(newCategory)) {
      toast({
        title: "Error",
        description: "This category already exists",
        variant: "destructive",
      });
      return;
    }

    try {
      const res = await postJSON('/categories', { name: newCategory });
      setCategories((prev: string[]) => [...prev, newCategory]);
      toast({
        title: "Success",
        description: `Category "${newCategory}" created`,
      });
      setNewCategory("");
    } catch (err: any) {
      console.error('add category error', err);
      toast({
        title: "Error",
        description: err?.message || 'Failed to create category',
        variant: "destructive",
      });
    }
  };

  // Handle Add SubCategory
  const handleAddSubCategory = async () => {
    if (!newSubCategory.trim()) {
      toast({
        title: "Error",
        description: "Sub-category name is required",
        variant: "destructive",
      });
      return;
    }

    if (!selectedCategoryForSubCategory) {
      toast({
        title: "Error",
        description: "Please select a category first",
        variant: "destructive",
      });
      return;
    }

    try {
      const res = await postJSON('/subcategories', {
        name: newSubCategory,
        category: selectedCategoryForSubCategory
      });

      const newSub = {
        id: res.subcategory.id,
        name: newSubCategory,
        category: selectedCategoryForSubCategory,
        createdAt: new Date().toISOString(),
      };

      setSubCategories((prev: any[]) => [...prev, newSub]);
      toast({
        title: "Success",
        description: `Sub-category "${newSubCategory}" created under ${selectedCategoryForSubCategory}`,
      });
      setNewSubCategory("");
    } catch (err: any) {
      console.error('add subcategory error', err);
      toast({
        title: "Error",
        description: err?.message || 'Failed to create subcategory',
        variant: "destructive",
      });
    }
  };

  // Get SubCategories for selected Category
  const getSubCategoriesForCategory = (category: string) => {
    if (!category) return [];
    const normalizedTarget = category.toLowerCase().trim();
    return subCategories.filter((sc: any) =>
      (sc.category || "").toLowerCase().trim() === normalizedTarget
    );
  };

  // Handle Add Product
  const handleAddProduct = async () => {
    if (!newProduct.name.trim()) {
      toast({
        title: "Error",
        description: "Product name is required",
        variant: "destructive",
      });
      return;
    }

    if (!newProduct.subcategory) {
      toast({
        title: "Error",
        description: "Subcategory is required",
        variant: "destructive",
      });
      return;
    }


    try {
      // Build payload: include HSN and SAC as separate fields if provided.
      const payload: any = {
        name: newProduct.name,
        subcategory: newProduct.subcategory,
      };
      if (newProduct.hsnCode && newProduct.hsnCode.trim()) payload.hsn_code = newProduct.hsnCode.trim();
      if (newProduct.sacCode && newProduct.sacCode.trim()) payload.sac_code = newProduct.sacCode.trim();
      if (newProduct.image) payload.image = newProduct.image;

      const res = await postJSON('/products', payload);
      const newProd = res.product || res;
      setProducts((prev: any[]) => [...prev, mapProduct(newProd)]);
      toast({
        title: "Success",
        description: `Product "${newProduct.name}" created`,
      });
      setNewProduct({ name: "", subcategory: "", taxCodeType: null, taxCodeValue: "", hsnCode: "", sacCode: "", image: undefined });
    } catch (err: any) {
      console.error('add product error', err);
      toast({
        title: "Error",
        description: err?.message || 'Failed to create product',
        variant: "destructive",
      });
    }
  };

  const handleCloneProduct = (product: any) => {
    setNewProduct({
      name: `${product.name} (Copy)`,
      subcategory: product.subcategory || "",
      taxCodeType: product.taxCodeType || null,
      taxCodeValue: product.taxCodeValue || "",
      hsnCode: product.hsn_code || product.hsnCode || "",
      sacCode: product.sac_code || product.sacCode || "",
      image: product.image || undefined,
    });
    setShowAddProductDialog(true);
  };

  // Handle Update Product
  const handleUpdateProduct = async () => {
    if (!editingProduct?.name?.trim()) {
      toast({
        title: "Error",
        description: "Product name is required",
        variant: "destructive",
      });
      return;
    }

    if (!editingProduct?.subcategory) {
      toast({
        title: "Error",
        description: "Subcategory is required",
        variant: "destructive",
      });
      return;
    }

    if (editingProduct.taxCodeType && !editingProduct.taxCodeValue?.trim()) {
      toast({ title: "Error", description: "Tax code value is required", variant: "destructive" });
      return;
    }

    try {
      const payload: any = {
        name: editingProduct.name,
        subcategory: editingProduct.subcategory,
      };
      if (editingProduct.taxCodeType) payload.taxCodeType = editingProduct.taxCodeType;
      if (editingProduct.taxCodeValue) payload.taxCodeValue = editingProduct.taxCodeValue;
      if (editingProduct.hsnCode !== undefined) payload.hsn_code = editingProduct.hsnCode;
      if (editingProduct.sacCode !== undefined) payload.sac_code = editingProduct.sacCode;
      if (editingProduct.image !== undefined) payload.image = editingProduct.image;

      const res = await apiFetch(`/products/${editingProduct.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      const updated = await res.json();
      const updatedProd = mapProduct(updated.product || updated);
      setProducts((prev: any[]) => prev.map((p: any) => p.id === editingProduct.id ? updatedProd : p));
      toast({
        title: "Success",
        description: `Product "${editingProduct.name}" updated`,
      });
      setEditingProduct(null);
    } catch (err: any) {
      console.error('update product error', err);
      toast({
        title: "Error",
        description: err?.message || 'Failed to update product',
        variant: "destructive",
      });
    }
  };

  // Handle Delete Product
  const handleDeleteProduct = (productId: string) => {
    const product = products.find((p: any) => p.id === productId);
    if (!product) return;
    setGenericDelete({
      isOpen: true,
      id: productId,
      name: product.name,
      type: 'product'
    });
  };

  const [usedTemplateIds, setUsedTemplateIds] = useState<Set<string>>(new Set());
  const [showOnlyUnlinked, setShowOnlyUnlinked] = useState(false);

  // Load master materials from API
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/material-templates');
        if (res.ok) {
          const data = await res.json();
          setMasterMaterials(data?.templates || []);
        }
      } catch (e) {
        console.warn('load master materials failed', e);
        setMasterMaterials([]);
      }
    })();
  }, []);

  // Load template usage summary
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/material-templates/usage');
        if (res.ok) {
          const data = await res.json();
          setUsedTemplateIds(new Set(data.usedIds || []));
        }
      } catch (e) {
        console.warn('load material-templates usage failed', e);
      }
    })();
  }, []);

  const [expandedShops, setExpandedShops] = useState<string[]>([]);
  const [masterSearch, setMasterSearch] = useState("");
  const [masterView, setMasterView] = useState<'grid' | 'list'>('grid');

  // Search inputs for dashboard lists
  const [shopSearch, setShopSearch] = useState<string>("");
  const [shopVendorCategoryFilter, setShopVendorCategoryFilter] = useState<string>("all");
  const [materialSearch, setMaterialSearch] = useState<string>("");

  // Material list filters (category + subcategory)
  const [materialCategoryFilter, setMaterialCategoryFilter] = useState<string>("all");
  const [materialSubcategoryFilter, setMaterialSubcategoryFilter] = useState<string>("all");

  // Toggle states for full-page lists
  const [showShopsList, setShowShopsList] = useState(false);
  const [showMaterialsList, setShowMaterialsList] = useState(false);
  const [showProductsList, setShowProductsList] = useState(false);

  const filteredShops = localShops.filter((s: any) => {
    // text search
    if (shopSearch) {
      if (!fuzzySearch(shopSearch, [s.name || "", s.location || "", s.city || ""])) return false;
    }

    // vendor category filter
    if (shopVendorCategoryFilter && shopVendorCategoryFilter !== 'all') {
      const shopCat = (s.vendorCategory || s.vendor_category || "").toString().trim().toLowerCase();
      if (shopCat !== shopVendorCategoryFilter.toLowerCase()) return false;
    }

    return true;
  });
  const filteredMaterials = localMaterials.filter((m: any) => {
    // text search
    if (materialSearch) {
      if (!fuzzySearch(materialSearch, [m.name || "", m.code || ""])) return false;
    }

    // category filter (supports comma-separated stored categories)
    if (materialCategoryFilter && materialCategoryFilter !== 'all') {
      const catField = (m.category || "").toString().trim();
      if (materialCategoryFilter === 'uncategorized') {
        if (catField !== "") return false;
      } else {
        const catMatches = catField
          .split(",")
          .map((s: string) => s.trim().toLowerCase())
          .includes(materialCategoryFilter.toLowerCase());
        if (!catMatches) return false;
      }
    }

    // subcategory filter
    if (materialSubcategoryFilter && materialSubcategoryFilter !== 'all') {
      const subCatField = (m.subcategory || m.sub_category || m.subCategory || "").toString().trim();
      if (materialSubcategoryFilter === 'uncategorized') {
        if (subCatField !== "") return false;
      } else {
        if (subCatField.toLowerCase() !== materialSubcategoryFilter.toLowerCase()) return false;
      }
    }

    return true;
  });

  // SUPPORT MESSAGES STATE moved to top

  useEffect(() => {
    // initialize local copies from store
    setLocalMaterials(materials || []);
  }, [materials]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiFetch('/alerts');
        if (!res || !res.ok) return setAlerts([]);
        const data = await res.json();
        if (cancelled) return;
        const list = data?.alerts || data || [];
        const normalized = (Array.isArray(list) ? list : []).map((r: any) => ({
          id: r.id?.toString?.() || String(r.id || ''),
          type: r.type || r.type,
          materialId: r.material_id || r.materialId || null,
          name: r.name || r['name'] || 'Material changed',
          oldRate: (r.old_rate !== undefined ? Number(r.old_rate) : (r.oldRate !== undefined ? Number(r.oldRate) : 0)),
          newRate: (r.new_rate !== undefined ? Number(r.new_rate) : (r.newRate !== undefined ? Number(r.newRate) : 0)),
          editedBy: r.edited_by || r.editedBy || 'unknown',
          at: r.created_at || r.at || r.createdAt || null,
          shopId: r.shop_id || r.shopId || null,
          shopName: r.shop_name || r.shopName || null,
        }));
        setAlerts(normalized);
      } catch (e) {
        console.warn('load alerts failed', e);
        setAlerts([]);
      }
    };
    load();
    const iv = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  useEffect(() => {
    setLocalShops(shops || []);
  }, [shops]);

  // Fetch vendor categories for dropdowns
  const [vendorCategories, setVendorCategories] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    const fetchVendorCategories = async () => {
      try {
        const response = await apiFetch("/api/vendor-categories");
        if (response.ok) {
          const data = await response.json();
          setVendorCategories(data.categories || []);
        }
      } catch (error) {
        console.error("Failed to load vendor categories:", error);
      }
    };
    fetchVendorCategories();
  }, []);

  // Auto-generate code when admin enters material name

  // Auto-generate code when admin enters material name
  useEffect(() => {
    if (newMasterMaterial.name) {
      const code =
        newMasterMaterial.name.substring(0, 3).toUpperCase() +
        "-" +
        Math.floor(1000 + Math.random() * 9000);
      setNewMasterMaterial((prev) => ({ ...prev, code }));
    }
  }, [newMasterMaterial.name]);

  const handleAddMasterMaterial = async () => {
    if (!(newMasterMaterial.name || "").trim()) {
      toast({
        title: "Error",
        description: "Material Name is required",
        variant: "destructive",
      });
      return;
    }

    try {
      // Persist the master material as a template so suppliers can pick it
      const payload: any = {
        name: (newMasterMaterial.name || "").trim(),
        code: newMasterMaterial.code,
        category: newMasterMaterial.category || "",
        subcategory: newMasterMaterial.subcategory || "",
        vendorCategory: (newMasterMaterial.vendorCategory || "").trim(),
        taxCodeType: newMasterMaterial.taxCodeType,
        taxCodeValue: (newMasterMaterial.taxCodeValue || "").trim(),
        hsnCode: (newMasterMaterial.hsnCode || "").trim(),
        sacCode: (newMasterMaterial.sacCode || "").trim(),
        technicalSpecification: (newMasterMaterial.technicalSpecification || "").trim(),
        image: newMasterMaterial.image
      };

      const res = await postJSON('/material-templates', payload);
      const created = res.template || res;

      setMasterMaterials((prev: any[]) => [...prev, created]);

      toast({
        title: "Success",
        description: "Master material created. Suppliers can now use this.",
      });

      setNewMasterMaterial({
        name: "",
        code: "",
        category: "",
        subcategory: "",
        vendorCategory: "",
        taxCodeType: null,
        taxCodeValue: "",
        hsnCode: "",
        sacCode: "",
        technicalSpecification: "",
        image: undefined
      });
    } catch (err: any) {
      console.error('create master material error', err);
      toast({
        title: "Error",
        description: err?.message || 'Failed to create master material',
        variant: "destructive",
      });
    }
  };

  const handleCloneMasterMaterial = (template: any) => {
    setNewMasterMaterial({
      name: `${template.name} (Copy)`,
      code: "", // Will be auto-generated by Effect on name change
      category: template.category || "",
      subcategory: template.subcategory || "",
      vendorCategory: template.vendor_category || "",
      taxCodeType: template.tax_code_type || null,
      taxCodeValue: template.tax_code_value || "",
      hsnCode: template.hsn_code || "",
      sacCode: template.sac_code || "",
      technicalSpecification: template.technicalspecification || template.technicalSpecification || "",
    });
    // Scroll to the "Create Material" form at the top of the tab
    const element = document.getElementById("create-material-section");
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    toast({
      title: "Template Cloned",
      description: "Form pre-filled with template details. A new code will be generated automatically.",
    });
  };

  // ===== SUPPLIER: Detailed Material (Select from Master + Fill Details) =====
  const [selectedMasterId, setSelectedMasterId] = useState<string>("");

  const [newMaterial, setNewMaterial] = useState<Partial<Material & { vendorCategory?: string }>>({
    name: "",
    code: "",
    rate: 0,
    unit: "pcs",
    category: "",
    subCategory: "",
    product: "",
    brandName: "",
    modelNumber: "",
    technicalSpecification: "",
    dimensions: "",
    finish: "",
    metalType: "",
    vendorCategory: "",
    taxCodeType: undefined,
    taxCodeValue: "",
    hsnCode: "",
    sacCode: "",
    shopId: "",
  });

  const handleSelectMasterMaterial = (masterId: string) => {
    const selected = masterMaterials.find((m: any) => m.id === masterId);
    if (selected) {
      setSelectedMasterId(masterId);
      setNewMaterial({
        ...newMaterial,
        name: selected.name,
        code: selected.code,
      });
    }
  };

  const handleAddMaterial = () => {
    if (!newMaterial.name || !newMaterial.rate || !newMaterial.category || !newMaterial.subCategory || !newMaterial.product) {
      toast({
        title: "Error",
        description: "Name, Rate, Category, Sub Category, and Product are required",
        variant: "destructive",
      });
      return;
    }

    // Determine Shop ID based on role
    let shopId = newMaterial.shopId || "";

    if (user?.role === "supplier" && user.shopId) {
      shopId = user.shopId;
    }

    if (!shopId || shopId === "1") {
      // If no shop selected and user is admin/purchase_team, default to first available shop or alert
      if (localShops.length > 0) {
        shopId = localShops[0].id;
      } else {
        toast({
          title: "Setup Required",
          description: "Please create at least one shop before adding materials.",
          variant: "destructive",
        });
        return;
      }
    }

    // Mock validation
    if (
      newMaterial.name.toLowerCase().includes("toy") ||
      newMaterial.name.toLowerCase().includes("game")
    ) {
      toast({
        title: "Warning Sent to Admin",
        description: "Irrelevant material detected. Flagged for review.",
        variant: "destructive",
      });
      return;
    }

    (async () => {
      try {
        const result = submitMaterialForApproval ? await submitMaterialForApproval({ ...newMaterial, shopId }) : null;
        if (result) {
          toast({
            title: "Success",
            description: "Material submitted for approval. Software team will review and approve/reject.",
          });
          // Refresh pending lists
          if (typeof refreshPendingApprovals === 'function') await refreshPendingApprovals();
          if (typeof refreshMaterials === 'function') await refreshMaterials();
        } else {
          toast({
            title: "Local Queue",
            description: "Server unreachable. Material saved locally and will sync when online.",
          });
        }
      } catch (err) {
        console.error('handleAddMaterial error', err);
        toast({
          title: "Error",
          description: "Failed to submit material",
          variant: "destructive",
        });
      }
    })();

    toast({
      title: "Success",
      description:
        "Material submitted for approval. Software team will review and approve/reject.",
    });

    // Reset form
    setNewMaterial({
      name: "",
      code: "",
      rate: 0,
      unit: "pcs",
      category: "",
      subCategory: "",
      product: "",
      brandName: "",
      modelNumber: "",
      technicalSpecification: "",
      shopId: "",
      dimensions: "",
      finish: "",
      metalType: "",
    });
    setSelectedMasterId("");
  };

  const handleEditMaterial = (mat: any) => {
    setEditingMaterialId(mat.id);

    // Find the correct category name from our master list to ensure Select component matches exactly (case-insensitive match)
    const rawCategory = mat.category || "";
    const matchedCategory = categories.find(c => c.toLowerCase().trim() === rawCategory.toLowerCase().trim()) || rawCategory;

    // Similarly normalize subcategory name
    const rawSubCategory = mat.subcategory || mat.sub_category || mat.subCategory || "";
    const matchedSubCategory = subCategories.find(s => s.name.toLowerCase().trim() === rawSubCategory.toLowerCase().trim())?.name || rawSubCategory;

    // Similarly normalize product name
    const rawProductName = mat.product || "";
    const matchedProduct = products.find(p => p.name.toLowerCase().trim() === rawProductName.toLowerCase().trim())?.name || rawProductName;

    setNewMaterial({
      name: mat.name || "",
      code: mat.code || "",
      rate: mat.rate || 0,
      unit: mat.unit || "pcs",
      category: matchedCategory,
      subCategory: matchedSubCategory,
      product: matchedProduct,
      brandName: mat.brandname || mat.brand_name || mat.brandName || "",
      modelNumber: mat.modelnumber || mat.model_number || mat.modelNumber || "",
      technicalSpecification: mat.technicalspecification || mat.technical_specification || mat.technicalSpecification || "",
      dimensions: mat.dimensions || "",
      finish: mat.finishtype || mat.finish || "",
      metalType: mat.metaltype || mat.metal_type || mat.metalType || "",
      shopId: mat.shop_id ? mat.shop_id.toString() : (mat.shopId ? mat.shopId.toString() : ""),
    });
  };

  const handleUpdateMaterial = async () => {
    if (!editingMaterialId) return;
    const prevMat = localMaterials.find((m: any) => m.id === editingMaterialId);
    const oldRate = prevMat?.rate ?? null;
    const newRate = newMaterial.rate ?? null;
    const rateChanged = oldRate != null && newRate != null && Number(oldRate) !== Number(newRate);

    try {
      // try server update using PUT (server expects lowercased field names)
      try {
        // Map client camelCase fields to server expected keys
        const payload: any = {};
        if (newMaterial.name !== undefined) payload.name = newMaterial.name;
        if (newMaterial.code !== undefined) payload.code = newMaterial.code;
        if (newMaterial.rate !== undefined) payload.rate = newMaterial.rate;
        if (newMaterial.shopId !== undefined) payload.shop_id = newMaterial.shopId === "" ? null : newMaterial.shopId;
        if (newMaterial.unit !== undefined) payload.unit = newMaterial.unit;
        if (newMaterial.category !== undefined) payload.category = newMaterial.category;
        if (newMaterial.brandName !== undefined) payload.brandname = newMaterial.brandName;
        if (newMaterial.modelNumber !== undefined) payload.modelnumber = newMaterial.modelNumber;
        if (newMaterial.subCategory !== undefined) payload.subcategory = newMaterial.subCategory;
        if (newMaterial.product !== undefined) payload.product = newMaterial.product;
        if (newMaterial.technicalSpecification !== undefined) payload.technicalspecification = newMaterial.technicalSpecification;
        if (newMaterial.dimensions !== undefined) payload.dimensions = newMaterial.dimensions;
        if (newMaterial.finish !== undefined) payload.finishtype = newMaterial.finish;
        if (newMaterial.metalType !== undefined) payload.metaltype = newMaterial.metalType;
        if (newMaterial.image !== undefined) payload.image = newMaterial.image;
        if (newMaterial.attributes !== undefined) payload.attributes = newMaterial.attributes;

        const res = await apiFetch(`/materials/${editingMaterialId}`, { method: 'PUT', body: JSON.stringify(payload) });
        if (res.ok) {
          const data = await res.json();
          const updatedRaw = data?.material || data;

          // normalize server material keys (snake_case) to client camelCase
          const normalized = {
            ...updatedRaw,
            shopId: updatedRaw.shop_id || updatedRaw.shopId || null,
            brandName: updatedRaw.brandname || updatedRaw.brandName || "",
            modelNumber: updatedRaw.modelnumber || updatedRaw.modelNumber || "",
            subCategory: updatedRaw.subcategory || updatedRaw.subCategory || "",
            technicalSpecification: updatedRaw.technicalspecification || updatedRaw.technicalSpecification || "",
            dimensions: updatedRaw.dimensions || "",
            finish: updatedRaw.finishtype || updatedRaw.finish || "",
            metalType: updatedRaw.metaltype || updatedRaw.metalType || "",
            vendorCategory: updatedRaw.vendor_category || updatedRaw.vendorCategory || "",
            taxCodeType: updatedRaw.tax_code_type || updatedRaw.taxCodeType || null,
            taxCodeValue: updatedRaw.tax_code_value || updatedRaw.taxCodeValue || "",
          };

          // update local UI state with server response
          setLocalMaterials((prev: any[]) => prev.map((m: any) => (m.id === editingMaterialId ? { ...m, ...normalized } : m)));
          setEditingMaterialId(null);
          toast({ title: "Success", description: "Material updated successfully" });
        } else {
          // log server error body
          let errorText = "Unknown error";
          try { errorText = await res.text(); } catch { }
          console.warn('[handleUpdateMaterial] server responded non-ok', res.status, errorText);
          toast({ title: "Update Failed", description: `Server returned ${res.status}: ${errorText}`, variant: "destructive" });
        }
      } catch (e) {
        console.warn('[handleUpdateMaterial] network or server error', e);
        toast({ title: "Error", description: "Network or server error while saving", variant: "destructive" });
      }
      // create alert if rate changed
      if (rateChanged) {
        // attempt to attach shop info if available
        const shopId = prevMat?.shop_id || prevMat?.shopId || newMaterial.shopId || null;
        const shopName = (shopId ? (localShops.find((s: any) => String(s.id) === String(shopId))?.name) : null) || prevMat?.shop_name || prevMat?.shopName || null;
        const alert = {
          type: 'material-rate-edit',
          materialId: editingMaterialId,
          name: (newMaterial.name || prevMat?.name || ""),
          oldRate,
          newRate,
          editedBy: user?.username || user?.fullName || user?.name || user?.id || 'unknown',
          at: new Date().toISOString(),
          shopId,
          shopName,
        };
        try {
          const created = await postJSON('/alerts', alert);
          const createdAlert = created?.alert || created;
          // normalize created alert to our client shape
          const c = createdAlert || {};
          const added = {
            id: c.id?.toString?.() || String(c.id || Date.now()),
            type: c.type || alert.type,
            materialId: c.material_id || c.materialId || alert.materialId,
            name: c.name || alert.name,
            oldRate: (c.old_rate !== undefined ? Number(c.old_rate) : Number(alert.oldRate || 0)),
            newRate: (c.new_rate !== undefined ? Number(c.new_rate) : Number(alert.newRate || 0)),
            editedBy: c.edited_by || c.editedBy || alert.editedBy,
            at: c.created_at || c.at || alert.at,
            shopId: c.shop_id || c.shopId || alert.shopId,
            shopName: c.shop_name || c.shopName || alert.shopName,
          };
          setAlerts((prev: any[]) => [added, ...(prev || [])]);
        } catch (e) {
          console.warn('create alert failed', e);
          setAlerts((prev: any[]) => [{ id: Date.now().toString(), ...alert }, ...(prev || [])]);
        }
      }

      toast({ title: 'Updated', description: 'Material details updated' });
      setEditingMaterialId(null);
      setNewMaterial({ name: '', code: '', rate: 0, unit: 'pcs', category: '', subCategory: '', product: '', brandName: '', modelNumber: '', technicalSpecification: '', dimensions: '', finish: '', metalType: '' });
    } catch (err: any) {
      toast({ title: 'Error', description: 'Failed to update material', variant: 'destructive' });
    }
  };

  // State for new shop
  const [newShop, setNewShop] = useState<Partial<Shop>>({
    name: "",
    location: "",
    city: "",
    state: "Tamil Nadu",
    country: "India",
    pincode: "",
    phoneCountryCode: "+91",
    contactNumber: "",
    gstNo: "",
    vendorCategory: "",
    rating: 5,
    new_location: "",
    terms_and_conditions: "",
  });

  // Editing states
  const [editingShopId, setEditingShopId] = useState<string | null>(null);
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null);

  // Sync newMaterial fields with master lists when they load to prevent blank dropdowns
  useEffect(() => {
    if (editingMaterialId && categories.length > 0) {
      setNewMaterial(prev => {
        const cat = prev.category;
        if (!cat) return prev;
        const matched = categories.find(c => c.toLowerCase().trim() === cat.toLowerCase().trim());
        if (matched && matched !== cat) return { ...prev, category: matched };
        return prev;
      });
    }
  }, [categories, editingMaterialId]);

  useEffect(() => {
    if (editingMaterialId && subCategories.length > 0) {
      setNewMaterial(prev => {
        const sub = prev.subCategory;
        if (!sub) return prev;
        const matched = subCategories.find(s => s.name.toLowerCase().trim() === sub.toLowerCase().trim())?.name;
        if (matched && matched !== sub) return { ...prev, subCategory: matched };
        return prev;
      });
    }
  }, [subCategories, editingMaterialId]);

  useEffect(() => {
    if (editingMaterialId && products.length > 0) {
      setNewMaterial(prev => {
        const prod = prev.product;
        if (!prod) return prev;
        const matched = products.find(p => p.name.toLowerCase().trim() === prod.toLowerCase().trim())?.name;
        if (matched && matched !== prod) return { ...prev, product: matched };
        return prev;
      });
    }
  }, [products, editingMaterialId]);

  // State for support message
  const [supportMsg, setSupportMsg] = useState("");
  const [supportSenderName, setSupportSenderName] = useState("");
  const [supportSenderInfo, setSupportSenderInfo] = useState("");

  // State for proposal material submissions
  const [proposalMaterialSubmissions, setProposalMaterialSubmissions] = useState<any[]>([]);
  const [loadingProposalMaterials, setLoadingProposalMaterials] = useState(false);
  const [rejectingProposalMaterialId, setRejectingProposalMaterialId] = useState<string | null>(null);

  const handleAddShop = () => {
    if (
      !newShop.name ||
      !newShop.phoneCountryCode ||
      !newShop.location ||
      !newShop.city ||
      !newShop.state ||
      !newShop.country ||
      !newShop.pincode
    ) {
      toast({
        title: "Error",
        description: "All fields are required (GST is optional)",
        variant: "destructive",
      });
      return;
    }

    // ✅ DUPLICATE SHOP CHECK: Prevent creating a shop that already exists
    const trimmedName = (newShop.name || "").trim().toLowerCase();
    const duplicateShop = localShops.find(
      (s: any) => (s.name || "").trim().toLowerCase() === trimmedName
    );
    if (duplicateShop) {
      toast({
        title: "Shop Already Exists",
        description: `A shop named "${newShop.name}" already exists in the system. If you are the owner of this shop, please login with your existing credentials instead of creating a new entry.`,
        variant: "destructive",
      });
      return;
    }

    (async () => {
      try {
        // Try to submit to server (requires auth). If it succeeds, use server id.
        let created: any = null;
        if (typeof submitShopForApproval === 'function') {
          created = await submitShopForApproval({ ...newShop });
        } else {
          console.warn('[handleAddShop] submitShopForApproval missing from useData; falling back to local save');
        }
        if (created && created.id) {
          const serverRequest = {
            id: created.id,
            shop: created,
            submittedBy: user?.name,
            submittedAt: new Date().toISOString(),
            status: "pending",
          };
          setShopRequests((prev: any[]) => [serverRequest, ...prev]);
          setActiveTab('approvals');
          toast({ title: "Success", description: "Shop submitted for approval (server)" });
        } else {
          // fallback to local pending request
          const newRequest = {
            id: Math.random().toString(),
            shop: { ...newShop },
            submittedBy: user?.name,
            submittedAt: new Date().toISOString(),
            status: "pending",
          };
          setShopRequests((prev: any[]) => [newRequest, ...prev]);
          setActiveTab('approvals');
          toast({ title: "Saved Locally", description: "Shop saved locally; will sync when server is available" });
        }
      } catch (err: any) {
        console.warn('submit shop failed', err);
        const msg = err?.message || String(err);
        const newRequest = {
          id: Math.random().toString(),
          shop: { ...newShop },
          submittedBy: user?.name,
          submittedAt: new Date().toISOString(),
          status: "pending",
        };
        setShopRequests((prev: any[]) => [newRequest, ...prev]);
        setActiveTab('approvals');
        if (msg.includes('401') || /unauthori/i.test(msg)) {
          toast({ title: "Saved Locally (Unauthorized)", description: "You are not logged in as admin — please log in to submit to server.", variant: 'destructive' });
        } else {
          toast({ title: "Saved Locally", description: `Shop saved locally; server submit failed: ${msg}`, variant: 'destructive' });
        }
      } finally {
        setNewShop({
          name: "",
          location: "",
          city: "",
          phoneCountryCode: "+91",
          contactNumber: "",
          state: "Tamil Nadu",
          country: "India",
          pincode: "",
          gstNo: "",
          vendorCategory: "",
          new_location: "",
          terms_and_conditions: "",
        });
        setEditingShopId(null);
      }
    })();
  };

  const handleEditShop = (shop: any) => {
    setEditingShopId(shop.id);
    setNewShop({
      name: shop.name || "",
      location: shop.location || "",
      city: shop.city || "",
      state: shop.state || "",
      country: shop.country || "",
      pincode: shop.pincode || "",
      // Handle naming variants
      phoneCountryCode: shop.phone_country_code || shop.phoneCountryCode || shop.phonecountrycode || "+91",
      contactNumber: shop.contact_number || shop.contactNumber || shop.contactnumber || shop.phone || shop.mobile || "",
      gstNo: shop.gst_no || shop.gstNo || shop.gstno || "",
      vendorCategory: shop.vendor_category || shop.vendorCategory || shop.vendorcategory || "",
      rating: shop.rating || 5,
      new_location: shop.new_location || shop.newLocation || "",
      terms_and_conditions: shop.terms_and_conditions || shop.termsAndConditions || "",
    });
    // No redirect - keep on dashboard for inline editing
  };

  const handleUpdateShop = async () => {
    if (!editingShopId) return;
    try {
      // Use PUT for updates as expected by backend
      const res = await apiFetch(`/api/shops/${editingShopId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newShop)
      });

      if (!res.ok) {
        throw new Error(`Update failed: ${res.status}`);
      }

      // update local UI state
      setLocalShops((prev: any[]) => prev.map((s: any) => (s.id === editingShopId ? { ...s, ...newShop } : s)));
      toast({ title: 'Updated', description: 'Shop details updated' });
      setEditingShopId(null);
      setNewShop({
        name: '',
        location: '',
        city: '',
        phoneCountryCode: '+91',
        contactNumber: '',
        state: '',
        country: '',
        pincode: '',
        gstNo: '',
        vendorCategory: ''
      });
    } catch (err: any) {
      console.error('Update shop error:', err);
      toast({ title: 'Error', description: 'Failed to update shop', variant: 'destructive' });
    }
  };


  const handleApproveShop = (request: any) => {
    (async () => {
      try {
        const shopId = request?.shop?.id || request?.id;
        if (!shopId) {
          toast({ title: "Cannot Approve", description: "This shop is saved locally and has not been submitted to the server.", variant: 'destructive' });
          return;
        }
        await approveShop?.(shopId);
        setShopRequests((prev: any[]) => prev.filter((r: any) => r.id !== request.id));
        toast({ title: "Approved", description: "Shop has been approved and added to the system" });
      } catch (e) {
        toast({ title: "Error", description: "Failed to approve shop", variant: "destructive" });
      }
    })();
  };

  const handleRejectShop = (request: any) => {
    if (!rejectReason.trim()) {
      toast({
        title: "Error",
        description: "Please provide a rejection reason",
        variant: "destructive",
      });
      return;
    }
    (async () => {
      try {
        // The shop ID could be in request.shop.id or directly at request.id
        const shopId = request?.shop?.id || request?.id;
        if (!shopId) {
          setShopRequests((prev: any[]) => prev.filter((r: any) => r.id !== request.id));
          setRejectingId(null);
          setRejectReason("");
          toast({ title: "Removed", description: "Local shop request removed" });
          return;
        }
        await rejectShop?.(shopId, rejectReason);
        // Remove from local state immediately
        setShopRequests((prev: any[]) => prev.filter((r: any) => r.id !== request.id && r?.shop?.id !== shopId));
        setRejectingId(null);
        setRejectReason("");
        toast({ title: "Rejected", description: "Shop has been rejected and removed" });
      } catch (e) {
        toast({ title: "Error", description: "Failed to reject shop", variant: "destructive" });
      }
    })();
  };

  const handleApproveMaterial = (requestId: string) => {
    (async () => {
      try {
        const req = materialRequests.find((r: any) => r.id === requestId);
        await approveMaterial?.(requestId, req?.source);
        toast({ title: "Approved", description: "Material approved successfully" });
      } catch (e) {
        toast({ title: "Error", description: "Failed to approve material", variant: "destructive" });
      }
    })();
  };

  const handleRejectMaterial = (requestId: string) => {
    (async () => {
      try {
        const req = materialRequests.find((r: any) => r.id === requestId);
        await rejectMaterial?.(requestId, rejectReason, req?.source);
        setRejectingId(null);
        setRejectReason("");
        toast({ title: "Rejected", description: "Material rejected successfully" });
      } catch (e) {
        toast({ title: "Error", description: "Failed to reject material", variant: "destructive" });
      }
    })();
  };

  const handleApproveProposalMaterial = async (submissionId: string) => {
    try {
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const response = await fetch(`/api/proposal-material-submissions/${submissionId}/approve`, {
        method: "POST",
        headers,
      });

      if (!response.ok) {
        throw new Error("Failed to approve");
      }

      toast({
        title: "Success",
        description: "Supplier material approved and added to materials",
      });

      // Remove from pending list
      setProposalMaterialSubmissions((prev) =>
        prev.filter((s) => s.id !== submissionId)
      );
    } catch (err) {
      console.error("Error approving proposal material:", err);
      toast({
        title: "Error",
        description: "Failed to approve proposal material",
        variant: "destructive",
      });
    }
  };

  const handleRejectProposalMaterial = async (submissionId: string) => {
    if (!rejectReason.trim()) {
      toast({
        title: "Error",
        description: "Please provide a rejection reason",
        variant: "destructive",
      });
      return;
    }

    try {
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const response = await fetch(`/api/proposal-material-submissions/${submissionId}/reject`, {
        method: "POST",
        headers,
        body: JSON.stringify({ reason: rejectReason }),
      });

      if (!response.ok) {
        throw new Error("Failed to reject");
      }

      toast({
        title: "Success",
        description: "Supplier material rejected",
      });

      setRejectReason("");
      setRejectingProposalMaterialId(null);

      // Remove from pending list
      setProposalMaterialSubmissions((prev) =>
        prev.filter((s) => s.id !== submissionId)
      );
    } catch (err) {
      console.error("Error rejecting proposal material:", err);
      toast({
        title: "Error",
        description: "Failed to reject proposal material",
        variant: "destructive",
      });
    }
  };

  const handleSupportSubmit = async () => {
    if (!supportMsg || !supportSenderName) {
      toast({
        title: "Error",
        description: "Sender name and message are required",
        variant: "destructive",
      });
      return;
    }
    try {
      const msg = await addSupportMessage?.(supportSenderName, supportMsg, supportSenderInfo);
      if (msg) {
        setSupportMsgs(prev => [msg, ...prev]);
      }
      toast({
        title: "Request Sent",
        description: "Message sent to Admin & Software Team.",
      });
      setSupportMsg("");
      setSupportSenderInfo("");
      return msg;
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to send message",
        variant: "destructive",
      });
    }
  };

  const canViewSupportMessages =
    user?.role === "admin" || user?.role === "software_team" || user?.role === "purchase_team";

  const canManageShops =
    user?.role === "admin" ||
    user?.role === "software_team" ||
    user?.role === "supplier" ||
    user?.role === "purchase_team";

  const canAddMaterials =
    user?.role === "admin" ||
    user?.role === "supplier" ||
    user?.role === "purchase_team";

  const canAccessSupport = user?.role === "supplier" || user?.role === "user";

  const isVoltAmpele = user?.username === "VoltAmpele@gmail.com";

  const canApproveReject =
    user?.role === "admin" || user?.role === "software_team" || user?.role === "purchase_team" || isVoltAmpele;

  const isProductManager = user?.role === "product_manager";

  // --- Dynamic Permissions Hook ---
  const [customModules, setCustomModules] = useState<Set<string>>(new Set());
  const [isCustomManaged, setIsCustomManaged] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    apiFetch("/api/my-permissions")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setIsCustomManaged(!!data.isCustomManaged);
        setCustomModules(new Set(data.modules || []));
      })
      .catch(() => { });

    const handler = (e: any) => {
      if (e.detail?.userId === user.id) {
        apiFetch("/api/my-permissions")
          .then((r) => r.json())
          .then((data) => {
            setIsCustomManaged(!!data.isCustomManaged);
            setCustomModules(new Set(data.modules || []));
          })
          .catch(() => { });
      }
    };
    window.addEventListener("permissions_updated", handler);
    return () => {
      cancelled = true;
      window.removeEventListener("permissions_updated", handler);
    };
  }, [user]);

  const hasPerm = (defaultVal: boolean, key: string) => {
    if (user?.role === "admin" || user?.role === "software_team" || isVoltAmpele) return true;
    if (isCustomManaged) return customModules.has(key);
    return defaultVal;
  };

  const canEditDelete = hasPerm(
    user?.role === "admin" || user?.role === "software_team" || user?.role === "purchase_team",
    "create_item"
  );

  // Controlled tab state based on URL ?tab= and location changes
  const [, loc] = useLocation();

  const computeTab = () => {
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t) return t;
    }
    // default to dashboard view
    if (user?.role === "product_manager" || isVoltAmpele) return "create-product";
    return "dashboard";
  };

  const isAdminOrSoftwareTeam =
    user?.role === "admin" || user?.role === "software_team";

  // Using the new modular keys
  const canViewCategories = hasPerm(
    user?.role === "purchase_team" || user?.role === "pre_sales" || user?.role === "product_manager",
    "create_product"
  );

  const canManageCategories = hasPerm(
    user?.role === "purchase_team" || user?.role === "pre_sales" || user?.role === "product_manager",
    "create_product_category"
  );

  const hasCategorySubCheck = Array.from(customModules).some(m => m.startsWith("create_product_category_"));
  const canAddCategories = hasPerm(user?.role === "purchase_team" || user?.role === "pre_sales" || user?.role === "product_manager", "create_product_category_add") || (!hasCategorySubCheck && canManageCategories);
  const canEditCategories = hasPerm(user?.role === "purchase_team" || user?.role === "pre_sales" || user?.role === "product_manager", "create_product_category_edit") || (!hasCategorySubCheck && canManageCategories);
  const canDeleteCategories = hasPerm(user?.role === "purchase_team" || user?.role === "pre_sales" || user?.role === "product_manager", "create_product_category_delete") || (!hasCategorySubCheck && canManageCategories);

  const canManageSubcategories = hasPerm(
    user?.role === "pre_sales",
    "create_product_subcategory"
  );

  const hasSubcategorySubCheck = Array.from(customModules).some(m => m.startsWith("create_product_subcategory_"));
  const canAddSubcategories = hasPerm(user?.role === "pre_sales", "create_product_subcategory_add") || (!hasSubcategorySubCheck && canManageSubcategories);
  const canEditSubcategories = hasPerm(user?.role === "pre_sales", "create_product_subcategory_edit") || (!hasSubcategorySubCheck && canManageSubcategories);
  const canDeleteSubcategories = hasPerm(user?.role === "pre_sales", "create_product_subcategory_delete") || (!hasSubcategorySubCheck && canManageSubcategories);

  const canCreateProduct = hasPerm(
    user?.role === "pre_sales",
    "create_product"
  );
  const canManageProducts = canCreateProduct;

  const hasProductSubCheck = Array.from(customModules).some(m => m.startsWith("create_product_product_"));
  const canAddProducts = hasPerm(user?.role === "pre_sales", "create_product_product_add") || (!hasProductSubCheck && canCreateProduct);
  const canEditProducts = hasPerm(user?.role === "pre_sales", "create_product_product_edit") || (!hasProductSubCheck && canCreateProduct);
  const canDeleteProducts = hasPerm(user?.role === "pre_sales", "create_product_product_delete") || (!hasProductSubCheck && canCreateProduct);

  const [activeTab, setActiveTab] = useState<string>(computeTab());

  // update activeTab when location changes (sidebar link navigation)
  useEffect(() => {
    setActiveTab(computeTab());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc]);

  // Also listen to history changes (pushState/replaceState/popstate) so query updates update the tab
  useEffect(() => {
    const update = () => setActiveTab(computeTab());

    // popstate covers browser navigation
    window.addEventListener("popstate", update);

    // monkey-patch pushState/replaceState to emit popstate so client-side navigations (wouter) are caught
    const origPush = history.pushState;
    const origReplace = history.replaceState;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (history as any).pushState = function (data: any, unused: string, url?: string | URL | null) {
      const res = origPush.apply(this, [data, unused, url]);
      window.dispatchEvent(new PopStateEvent("popstate"));
      return res;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (history as any).replaceState = function (data: any, unused: string, url?: string | URL | null) {
      const res = origReplace.apply(this, [data, unused, url]);
      window.dispatchEvent(new PopStateEvent("popstate"));
      return res;
    };

    // run once to sync
    update();

    return () => {
      window.removeEventListener("popstate", update);
      (history as any).pushState = origPush;
      (history as any).replaceState = origReplace;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleExportMaterials = () => {
    const exportData = localMaterials.map((mat: any) => [
      mat.name || "",
      mat.code || "",
      mat.rate || 0,
      mat.unit || "",
      mat.category || "",
      mat.subcategory || mat.subCategory || mat.sub_category || "",
      mat.product || "",
      mat.brandName || mat.brand_name || mat.brandname || "",
      mat.modelNumber || mat.model_number || mat.modelnumber || "",
      mat.technicalSpecification || mat.technicalspecification || mat.technical_specification || "",
      localShops.find(s => String(s.id) === String(mat.shopId || mat.shop_id))?.name || "Unassigned"
    ]);

    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Material Name", "Code", "Rate", "Unit", "Category", "Subcategory", "Product", "Brand", "Model", "Technical Specification", "Shop Name"],
      ...exportData
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Materials");
    XLSX.writeFile(workbook, `Materials_Full_Export_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  const handleExportShops = () => {
    const exportData = localShops.map((shop: any) => [
      shop.name || "",
      shop.location || "",
      shop.city || "",
      shop.state || "",
      shop.country || "",
      shop.pincode || "",
      `${shop.phone_country_code || shop.phoneCountryCode || "+91"} ${shop.contact_number || shop.contactNumber || ""}`,
      shop.gst_no || shop.gstNo || "",
      shop.vendor_category || shop.vendorCategory || ""
    ]);

    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Shop Name", "Address", "City", "State", "Country", "Pincode", "Contact Number", "GST No", "Vendor Category"],
      ...exportData
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Shops");
    XLSX.writeFile(workbook, `Shops_Full_Export_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight font-heading">
            {user?.role === "supplier"
              ? "Supplier Portal"
              : user?.role === "purchase_team"
                ? "Purchase Team Dashboard"
                : "Admin Dashboard"}
          </h2>
          <p className="text-muted-foreground">
            Manage your inventory and settings
          </p>
        </div>

        {/* Stats Overview (shown only on Dashboard tab) */}
        {activeTab === "dashboard" && !isProductManager && (
          <div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div
                className="rounded-2xl p-5 flex items-center gap-4 transition-all duration-700"
                style={{
                  background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
                  opacity: cardsVisible ? 1 : 0,
                  transform: cardsVisible
                    ? 'translateY(0)'
                    : 'translateY(20px)',
                  transitionDelay: '0ms'
                }}
              >
                <div className="p-3 rounded-xl bg-green-100">
                  <Store className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-green-700 font-medium">
                    Total Shops
                  </p>
                  <p className="text-2xl font-bold text-green-900">
                    {displayShops}
                  </p>
                </div>
              </div>

              <div
                className="rounded-2xl p-5 flex items-center gap-4 transition-all duration-700"
                style={{
                  background: 'linear-gradient(135deg, #faf5ff 0%, #ede9fe 100%)',
                  opacity: cardsVisible ? 1 : 0,
                  transform: cardsVisible
                    ? 'translateY(0)'
                    : 'translateY(20px)',
                  transitionDelay: '150ms'
                }}
              >
                <div className="p-3 rounded-xl bg-purple-100">
                  <Layers className="h-6 w-6 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-purple-700 font-medium">
                    Total Materials
                  </p>
                  <p className="text-2xl font-bold text-purple-900">
                    {displayMaterials}
                  </p>
                </div>
              </div>

              <div
                onClick={() => setActiveTab("project-pricing-materials")}
                className="rounded-2xl p-5 flex items-center gap-4 transition-all duration-700 cursor-pointer hover:shadow-md transition-shadow"
                style={{
                  background: 'linear-gradient(135deg, #fff7ed 0%, #fed7aa 100%)',
                  opacity: cardsVisible ? 1 : 0,
                  transform: cardsVisible
                    ? 'translateY(0)'
                    : 'translateY(20px)',
                  transitionDelay: '300ms'
                }}
              >
                <div className="p-3 rounded-xl bg-orange-100">
                  <Diamond className="h-6 w-6 text-orange-500" />
                </div>
                <div>
                  <p className="text-sm text-orange-700 font-medium">
                    Project Pricing Materials
                  </p>
                  <p className="text-2xl font-bold text-orange-900">
                    {displayPricing}
                  </p>
                </div>
              </div>
            </div>

            {(isAdminOrSoftwareTeam || user?.role === "purchase_team" || user?.role === "pre_sales") && (
              <div className="space-y-6">
                <div className="space-y-3">
                  <Card className="px-4 py-3 cursor-pointer select-none" onClick={() => setShowShopsList(!showShopsList)}>
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-green-50">
                        <Store className="h-5 w-5 text-green-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-base">All Shops</p>
                        <p className="text-xs text-muted-foreground">
                          List of registered shops
                        </p>
                      </div>
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700">
                        {shops.length}
                      </span>
                      <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", showShopsList && "rotate-90")} />
                    </div>
                    {showShopsList && (
                      <div onClick={(e) => e.stopPropagation()} className="mt-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="flex flex-col md:flex-row items-center gap-3">
                          <div className="relative flex-1">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                              value={shopSearch}
                              onChange={(e) => setShopSearch(e.target.value)}
                              placeholder="Search shops by name, city or location..."
                              className="h-10 pl-9"
                            />
                          </div>
                          <Select
                            value={shopVendorCategoryFilter}
                            onValueChange={setShopVendorCategoryFilter}
                          >
                            <SelectTrigger className="w-full md:w-[220px] h-10">
                              <SelectValue placeholder="All Vendor Categories" />
                            </SelectTrigger>
                            <SelectContent className="max-h-[300px]">
                              <SelectItem value="all">All Vendor Categories</SelectItem>
                              {vendorCategories.map((vc: any) => (
                                <SelectItem key={vc.id} value={vc.name}>{vc.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="max-h-[800px] overflow-y-auto pr-2 border rounded-md">
                          {filteredShops.length === 0 ? (
                            <p className="text-muted-foreground">No shops available</p>
                          ) : (
                            filteredShops.map((shop: any) => (
                              <div key={shop.id} className="p-3 border-b hover:bg-muted/30 transition-colors">
                                {editingShopId === shop.id ? (
                                  <div className="space-y-4 p-2 bg-muted/20 rounded-lg">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                      <div>
                                        <Label className="text-xs font-semibold">Shop Name</Label>
                                        <Input value={newShop.name || ''} onChange={(e) => setNewShop({ ...newShop, name: e.target.value })} placeholder="Shop Name" />
                                      </div>
                                      <div>
                                        <Label className="text-xs font-semibold">Address</Label>
                                        <Input value={newShop.location || ''} onChange={(e) => setNewShop({ ...newShop, location: e.target.value })} placeholder="Address" />
                                      </div>
                                      <div>
                                        <Label className="text-xs font-semibold">Location</Label>
                                        <Input value={newShop.new_location || ''} onChange={(e) => setNewShop({ ...newShop, new_location: e.target.value })} placeholder="Location" />
                                      </div>
                                      <div>
                                        <Label className="text-xs font-semibold">City</Label>
                                        <Input value={newShop.city || ''} onChange={(e) => setNewShop({ ...newShop, city: e.target.value })} placeholder="City" />
                                      </div>
                                      <div>
                                        <Label className="text-xs font-semibold">Contact Number</Label>
                                        <Input value={newShop.contactNumber || ''} onChange={(e) => setNewShop({ ...newShop, contactNumber: e.target.value })} placeholder="Phone Number" />
                                      </div>
                                      <div>
                                        <Label className="text-xs font-semibold">GST No</Label>
                                        <Input value={newShop.gstNo || ''} onChange={(e) => setNewShop({ ...newShop, gstNo: e.target.value })} placeholder="GST No" />
                                      </div>
                                      <div>
                                        <Label className="text-xs font-semibold">Terms and Conditions</Label>
                                        <Input value={newShop.terms_and_conditions || ''} onChange={(e) => setNewShop({ ...newShop, terms_and_conditions: e.target.value })} placeholder="Terms and Conditions" />
                                      </div>
                                      <div>
                                        <Label className="text-xs font-semibold">Vendor Category</Label>
                                        <Select value={newShop.vendorCategory || ''} onValueChange={(v) => setNewShop({ ...newShop, vendorCategory: v })}>
                                          <SelectTrigger>
                                            <SelectValue placeholder="Select Vendor Category" />
                                          </SelectTrigger>
                                          <SelectContent className="max-h-60 overflow-y-auto">
                                            {vendorCategories.map((vc: any) => (
                                              <SelectItem key={vc.id} value={vc.name}>{vc.name}</SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    </div>
                                    <div className="flex gap-2 pt-2">
                                      <Button size="sm" onClick={handleUpdateShop}>Save Changes</Button>
                                      <Button size="sm" variant="ghost" onClick={() => { setEditingShopId(null); setNewShop({ name: '', location: '', city: '', phoneCountryCode: '+91', state: '', country: '', pincode: '', gstNo: '' }); }}>Cancel</Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-start gap-3">
                                        <button
                                          onClick={() => setExpandedShops(prev => prev.includes(shop.id) ? prev.filter(id => id !== shop.id) : [...prev, shop.id])}
                                          aria-label={expandedShops.includes(shop.id) ? 'Collapse materials' : 'Expand materials'}
                                          className="p-1 mt-1"
                                        >
                                          {expandedShops.includes(shop.id) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                        </button>
                                        <div>
                                          <div className="font-bold text-lg text-foreground">{shop.name}</div>
                                          <div className="text-sm text-foreground/80">
                                            {shop.location}, {shop.city}
                                            {shop.new_location && <div className="text-xs text-muted-foreground mt-0.5 italic">Alt Location: {shop.new_location}</div>}
                                            {shop.terms_and_conditions && <div className="text-xs text-blue-600 mt-0.5 line-clamp-1">T&C: {shop.terms_and_conditions}</div>}
                                          </div>
                                          <div className="text-xs text-muted-foreground mt-1 font-medium">
                                            {(shop.phone_country_code || shop.phoneCountryCode || shop.phonecountrycode || '+91')}{" "}{(shop.contact_number || shop.contactNumber || shop.contactnumber || shop.phone || shop.mobile)} • {shop.gst_no || shop.gstNo || shop.gstno || 'No GST'}
                                          </div>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {(canEditDelete || user?.role === "pre_sales") && (
                                          <>
                                            <Button size="sm" variant="outline" onClick={() => handleEditShop(shop)}>Edit</Button>
                                            {canEditDelete && (
                                              <>
                                                <Button size="sm" variant="ghost" onClick={() => setLocalShops((prev: any[]) => prev.map((s: any) => s.id === shop.id ? { ...s, disabled: !s.disabled } : s))}>
                                                  {shop.disabled ? 'Enable' : 'Disable'}
                                                </Button>
                                                <Button
                                                  variant="ghost"
                                                  size="icon"
                                                  className="text-destructive"
                                                  onClick={() => {
                                                    setGenericDelete({ isOpen: true, id: shop.id, name: shop.name, type: 'shop' });
                                                  }}
                                                >
                                                  <Trash2 className="h-4 w-4" />
                                                </Button>
                                              </>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    </div>

                                    {expandedShops.includes(shop.id) && (
                                      <div className="mt-2 pl-10">
                                        {localMaterials.filter((m: any) => String(m.shopId) === String(shop.id)).length === 0 ? (
                                          <div className="text-sm text-muted-foreground">No materials for this shop</div>
                                        ) : (
                                          localMaterials
                                            .filter((m: any) => String(m.shopId) === String(shop.id))
                                            .map((mat: any) => (
                                              <div key={mat.id} className="py-1">
                                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                                                  <div className="text-sm font-medium">{mat.name}</div>
                                                  <div className="text-sm">₹{Number(mat.rate || 0).toLocaleString()}</div>
                                                </div>
                                                <div className="text-[10px] sm:text-xs flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1">
                                                  <span className="font-bold text-slate-700 bg-slate-100 px-1 rounded uppercase tracking-tighter text-[9px]">{mat.code || 'No code'}</span>
                                                  <span className="text-slate-800 font-medium">Brand:</span><span className="text-blue-600 font-semibold">{mat.brandName || mat.brand || mat.brandname || '-'}</span>
                                                  <span className="text-slate-300">•</span>
                                                  <span className="text-slate-800 font-medium">Unit:</span><span className="text-blue-600 font-semibold">{mat.unit || '-'}</span>
                                                  <span className="text-slate-300">•</span>
                                                  <span className="text-slate-800 font-medium">Model:</span><span className="text-blue-600 font-semibold">{mat.modelNumber || mat.model || '-'}</span>
                                                </div>
                                              </div>
                                            ))
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </Card>

                  <div className="grid grid-cols-2 gap-3">
                    <div onClick={handleExportShops}
                      className="flex items-center gap-2 px-4 py-3 rounded-xl border border-green-200 bg-green-50 cursor-pointer hover:bg-green-100 transition-colors">
                      <FileDown className="h-4 w-4 text-green-700" />
                      <div>
                        <p className="text-xs font-semibold text-green-700">
                          Download Shops Excel
                        </p>
                        <p className="text-[11px] text-green-600">
                          Export all shops data
                        </p>
                      </div>
                    </div>
                    <div onClick={handleCheckDuplicates}
                      className="flex items-center gap-2 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 cursor-pointer hover:bg-amber-100 transition-colors">
                      <AlertTriangle className="h-4 w-4 text-amber-700" />
                      <div>
                        <p className="text-xs font-semibold text-amber-700">
                          Check Duplicates
                        </p>
                        <p className="text-[11px] text-amber-600">
                          Find duplicate shops
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <Card className="px-4 py-3 cursor-pointer select-none" onClick={() => setShowMaterialsList(!showMaterialsList)}>
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-purple-50">
                        <Layers className="h-5 w-5 text-purple-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-base">All Materials</p>
                        <p className="text-xs text-muted-foreground">
                          Comprehensive material registry
                        </p>
                      </div>
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-100 text-purple-700">
                        {materials.length}
                      </span>
                      <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", showMaterialsList && "rotate-90")} />
                    </div>
                    {showMaterialsList && (
                      <div onClick={(e) => e.stopPropagation()} className="mt-4 animate-in fade-in slide-in-from-top-2 duration-300">
                        <AllMaterialsSplitView
                          materials={filteredMaterials.filter((m: any) => !m.is_project_pricing)}
                          localShops={localShops}
                          categories={categories}
                          getSubCategoriesForCategory={getSubCategoriesForCategory}
                          products={products}
                          UNIT_OPTIONS={UNIT_OPTIONS}
                          materialSearch={materialSearch}
                          setMaterialSearch={setMaterialSearch}
                          materialCategoryFilter={materialCategoryFilter}
                          setMaterialCategoryFilter={setMaterialCategoryFilter}
                          materialSubcategoryFilter={materialSubcategoryFilter}
                          setMaterialSubcategoryFilter={setMaterialSubcategoryFilter}
                          editingMaterialId={editingMaterialId}
                          setEditingMaterialId={setEditingMaterialId}
                          newMaterial={newMaterial}
                          setNewMaterial={setNewMaterial}
                          handleUpdateMaterial={handleUpdateMaterial}
                          onToggleDisable={(mat) => setLocalMaterials((prev: any[]) => prev.map((m: any) => m.id === mat.id ? { ...m, disabled: !m.disabled } : m))}
                          onDelete={(mat) => setGenericDelete({ isOpen: true, id: mat.id, name: mat.name, type: 'material' })}
                          canEditDelete={canEditDelete}
                          userRole={user?.role || ""}
                        />
                      </div>
                    )}
                  </Card>
                  
                  <Card className="px-4 py-3 cursor-pointer select-none" onClick={() => setShowProductsList(!showProductsList)}>
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-blue-50">
                        <Package className="h-5 w-5 text-blue-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-base">All Products</p>
                        <p className="text-xs text-muted-foreground">
                          Approved products and their materials
                        </p>
                      </div>
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">
                        {products.filter((p: any) => p.is_approved).length}
                      </span>
                      <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", showProductsList && "rotate-90")} />
                    </div>
                    {showProductsList && (
                      <div onClick={(e) => e.stopPropagation()} className="mt-4 animate-in fade-in slide-in-from-top-2 duration-300">
                        <AllProductsSplitView 
                          products={products.filter((p: any) => p.is_approved)}
                          onClose={() => setShowProductsList(false)}
                        />
                      </div>
                    )}
                  </Card>

                  <div className="grid grid-cols-2 gap-3">
                    <div onClick={handleExportMaterials}
                      className="flex items-center gap-2 px-4 py-3 rounded-xl border border-blue-200 bg-blue-50 cursor-pointer hover:bg-blue-100 transition-colors">
                      <FileDown className="h-4 w-4 text-blue-700" />
                      <div>
                        <p className="text-xs font-semibold text-blue-700">
                          Download Materials Excel
                        </p>
                        <p className="text-[11px] text-blue-600">
                          Export all materials data
                        </p>
                      </div>
                    </div>
                    <div onClick={handleCheckDuplicates}
                      className="flex items-center gap-2 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 cursor-pointer hover:bg-amber-100 transition-colors">
                      <AlertTriangle className="h-4 w-4 text-amber-700" />
                      <div>
                        <p className="text-xs font-semibold text-amber-700">
                          Check Duplicates
                        </p>
                        <p className="text-[11px] text-amber-600">
                          Find duplicate materials
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {user?.role === 'supplier' && (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Available  Materials</CardTitle>
                    <CardDescription className="text-sm">Select a material </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Input value={(typeof masterSearch !== 'undefined') ? masterSearch : ''} onChange={(e) => setMasterSearch(e.target.value)} placeholder="Search templates..." />
                        <div className="inline-flex rounded-md shadow-sm" role="group">
                          <Button size="sm" variant={masterView === 'grid' ? undefined : 'ghost'} onClick={() => setMasterView('grid')}>Grid</Button>
                          <Button size="sm" variant={masterView === 'list' ? undefined : 'ghost'} onClick={() => setMasterView('list')}>List</Button>
                        </div>
                      </div>
                      <div />
                    </div>

                    {masterMaterials.length === 0 ? (
                      <p className="text-muted-foreground">No master materials yet</p>
                    ) : (
                      <div className="space-y-2">
                        {masterMaterials.map((mm: any) => (
                          <div key={mm.id} className="p-2 border-b flex items-center justify-between">
                            <div className="text-sm">{mm.name} <span className="text-xs text-muted-foreground ml-2">{mm.code}</span></div>
                            <Link href={`/admin/dashboard?tab=materials`}>
                              <span className="text-sm text-sidebar-primary">Use</span>
                            </Link>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        )}

        {activeTab === 'alerts' && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Alerts</CardTitle>
                    <CardDescription>Recent system alerts (material rate edits)</CardDescription>
                  </div>
                  <div>
                    <Button size="sm" variant="ghost" onClick={async () => {
                      try {
                        const res = await apiFetch('/alerts', { method: 'DELETE' });
                        if (res && res.ok) setAlerts([]);
                        else setAlerts([]);
                      } catch (e) {
                        console.warn('clear alerts failed', e);
                        setAlerts([]);
                      }
                    }}>
                      Clear All
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {alerts.length === 0 ? (
                  <p className="text-muted-foreground">No alerts</p>
                ) : (
                  <div className="space-y-2">
                    {alerts.map((a: any) => (
                      <div key={a.id} className="p-3 border rounded flex items-start justify-between">
                        <div>
                          <div className="font-medium">{a.name || 'Material changed'}</div>
                          {a.shopName ? <div className="text-sm text-muted-foreground">Shop: {a.shopName}</div> : null}
                          <div className="text-sm text-muted-foreground">Rate changed from <span className="line-through">₹{Number(a.oldRate || 0).toLocaleString()}</span> to <span className="font-semibold">₹{Number(a.newRate || 0).toLocaleString()}</span></div>
                          <div className="text-xs text-muted-foreground">By {a.editedBy || 'unknown'} • {(a.at ? new Date(a.at).toLocaleString() : 'Unknown')}</div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <Button size="sm" variant="ghost" onClick={async () => {
                            try {
                              const res = await apiFetch(`/alerts/${a.id}`, { method: 'DELETE' });
                              if (res && res.ok) {
                                const next = alerts.filter((x: any) => x.id !== a.id);
                                setAlerts(next);
                              } else {
                                // fallback local
                                const next = alerts.filter((x: any) => x.id !== a.id);
                                setAlerts(next);
                              }
                            } catch (e) {
                              console.warn('dismiss alert failed', e);
                              const next = alerts.filter((x: any) => x.id !== a.id);
                              setAlerts(next);
                            }
                          }}>Dismiss</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <Tabs
          value={activeTab}
          onValueChange={(val) => {
            setActiveTab(val);
            if (typeof window !== "undefined") {
              const url = new URL(window.location.href);
              url.searchParams.set("tab", val);
              window.history.replaceState({}, "", url.toString());
            }
          }}
          className="w-full"
        >
          {/* Tabs Navigation Hidden - Navigation through sidebar only */}

          {/* === CREATE PRODUCT TAB (Admin/Software Team can manage, Purchase Team can view) === */}
          {canViewCategories && (
            <TabsContent value="create-product" className="mt-4">
              <Tabs defaultValue={canManageCategories ? "categories" : canManageSubcategories ? "subcategories" : canCreateProduct ? "products" : "none"}>
                <TabsList className="rounded-xl bg-muted/50 p-1.5 mb-6 w-full max-w-2xl flex">
                  {canManageCategories && <TabsTrigger value="categories" className="flex-1 text-sm md:text-base font-medium data-[state=active]:font-bold data-[state=active]:bg-purple-100 data-[state=active]:text-purple-900 py-2">Categories</TabsTrigger>}
                  {canManageSubcategories && <TabsTrigger value="subcategories" className="flex-1 text-sm md:text-base font-medium data-[state=active]:font-bold data-[state=active]:bg-green-100 data-[state=active]:text-green-900 py-2">Subcategories</TabsTrigger>}
                  {canCreateProduct && <TabsTrigger value="products" className="flex-1 text-sm md:text-base font-medium data-[state=active]:font-bold data-[state=active]:bg-blue-100 data-[state=active]:text-blue-900 py-2">Products</TabsTrigger>}
                </TabsList>

                {canManageCategories && (
                  <TabsContent value="categories">
                    {/* Create Categories Section */}
                    <Card className="border-purple-200 bg-purple-50">
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="text-purple-900">Create Categories</CardTitle>
                            <CardDescription className="text-purple-800">Add new product categories</CardDescription>
                          </div>
                          {canAddCategories && (<>
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button className="bg-purple-600 hover:bg-purple-700">
                                  <Plus className="h-4 w-4 mr-2" /> Add Category
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Add New Category</DialogTitle>
                                </DialogHeader>
                                <div className="space-y-4">
                                  <div className="space-y-2">
                                    <Label>Category Name <Required /></Label>
                                    <Input
                                      value={newCategory}
                                      onChange={(e) => setNewCategory(e.target.value)}
                                      placeholder="e.g. Flooring, Roofing, Doors"
                                    />
                                  </div>
                                  <Button
                                    onClick={handleAddCategory}
                                    className="w-full bg-purple-600 hover:bg-purple-700"
                                  >
                                    <Plus className="h-4 w-4 mr-2" /> Add Category
                                  </Button>
                                </div>
                              </DialogContent>
                            </Dialog>
                          </>)}
                        </div>
                      </CardHeader>
                      <CardContent>
                        {showAddSubInline && (
                          <div className="space-y-2 p-3 border rounded mb-4 bg-white">
                            <Label>Select Category <Required /></Label>
                            <Select
                              value={selectedCategoryForSubCategory}
                              onValueChange={setSelectedCategoryForSubCategory}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Choose a category..." />
                              </SelectTrigger>
                              <SelectContent className="max-h-44">
                                {categories.length === 0 ? (
                                  <div className="p-2 text-sm text-muted-foreground">No categories available</div>
                                ) : (
                                  categories.map((cat: string) => (
                                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                            <div className="space-y-2">
                              <Label>Subcategory Name <Required /></Label>
                              <Input value={newSubCategory} onChange={(e) => setNewSubCategory(e.target.value)} placeholder="e.g. Commercial, Residential" />
                            </div>
                            <Button onClick={async () => { await handleAddSubCategory(); if (newSubCategory.trim()) { setShowAddSubInline(false); } }} className="bg-green-600 hover:bg-green-700">Add Subcategory</Button>
                          </div>
                        )}
                        <div className="mb-4">
                          <Input
                            value={searchCategories}
                            onChange={(e) => setSearchCategories(e.target.value)}
                            placeholder="Search categories..."
                          />
                        </div>
                        <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                          {categories.length === 0 ? (
                            <p className="text-center text-muted-foreground py-6">No categories created yet</p>
                          ) : (
                            categories
                              .filter(cat => fuzzySearch(searchCategories, cat))
                              .map((cat: string, idx: number) => {
                                const subCats = getSubCategoriesForCategory(cat);
                                return (
                                  <div key={idx} className="p-4 border rounded-lg bg-white hover:border-purple-400 transition">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-3">
                                        <Package className="h-5 w-5 text-purple-600" />
                                        <div>
                                          <span className="font-medium">{cat}</span>
                                          {subCats.length > 0 && (
                                            <span className="text-sm text-muted-foreground ml-2">
                                              ({subCats.length} subcategories)
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      {(canEditCategories || canDeleteCategories) && (
                                        <div className="flex gap-2">
                                          {canEditCategories && (
                                            <Button size="sm" variant="outline" onClick={() => {
                                              setEditingCategory(cat);
                                              setEditingCategoryValue(cat);
                                            }}>
                                              Edit
                                            </Button>
                                          )}
                                          {canDeleteCategories && (
                                            <Button size="sm" variant="destructive" onClick={() => requestDeleteCategory(cat)}>
                                              <Trash2 className="h-4 w-4" />
                                            </Button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                    {editingCategory === cat && (
                                      <div className="mt-3 p-3 bg-gray-100 rounded border col-span-full">
                                        <div className="flex gap-2">
                                          <Input
                                            value={editingCategoryValue}
                                            onChange={(e) => setEditingCategoryValue(e.target.value)}
                                            placeholder="Category name"
                                            className="text-sm"
                                          />
                                          <Button size="sm" onClick={async () => {
                                            const oldName = editingCategory;
                                            const newName = editingCategoryValue.trim();
                                            if (!newName) {
                                              toast({ title: 'Error', description: 'Category name cannot be empty', variant: 'destructive' });
                                              return;
                                            }
                                            try {
                                              await apiFetch(`/categories/${encodeURIComponent(oldName)}`, {
                                                method: 'PUT',
                                                body: JSON.stringify({ name: newName }),
                                              });
                                              setCategories((prev: string[]) => prev.map((c: string) => c === oldName ? newName : c));
                                              setSubCategories((prev: any[]) => prev.map((s: any) => s.category === oldName ? { ...s, category: newName } : s));
                                              setEditingCategory(null);
                                              setEditingCategoryValue("");
                                              toast({ title: 'Success', description: `Category updated to ${newName}` });
                                            } catch (err) {
                                              console.error('update category error', err);
                                              toast({ title: 'Error', description: 'Failed to update category', variant: 'destructive' });
                                            }
                                          }}>Save</Button>
                                          <Button size="sm" variant="ghost" onClick={() => {
                                            setEditingCategory(null);
                                            setEditingCategoryValue("");
                                          }}>Cancel</Button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>
                )}

                {canManageSubcategories && (
                  <TabsContent value="subcategories">
                    {/* === CREATE PRODUCT TAB - Subcategories Section === */}
                    <Card className="border-green-200 bg-green-50">
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="text-green-900">Create Subcategories</CardTitle>
                            <CardDescription className="text-green-800">Add subcategories to your categories</CardDescription>
                          </div>
                          {canAddSubcategories && (<>
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button className="bg-green-600 hover:bg-green-700">
                                  <Plus className="h-4 w-4 mr-2" /> Add Subcategory
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle></DialogTitle>
                                </DialogHeader>
                                <div className="space-y-4">
                                  <div className="space-y-2">
                                    <Label>Select Category <Required /></Label>
                                    <Select
                                      value={selectedCategoryForSubCategory}
                                      onValueChange={setSelectedCategoryForSubCategory}
                                    >
                                      <SelectTrigger>
                                        <SelectValue placeholder="Choose a category..." />
                                      </SelectTrigger>
                                      <SelectContent className="max-h-64">
                                        {categories.length === 0 ? (
                                          <div className="p-2 text-sm text-muted-foreground">No categories available</div>
                                        ) : (
                                          categories.map((cat: string) => (
                                            <SelectItem key={cat} value={cat}>
                                              {cat}
                                            </SelectItem>
                                          ))
                                        )}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-2">
                                    <Label>Subcategory Name <Required /></Label>
                                    <Input
                                      value={newSubCategory}
                                      onChange={(e) => setNewSubCategory(e.target.value)}
                                      placeholder="e.g. Commercial, Residential"
                                    />
                                  </div>
                                  <Button
                                    onClick={handleAddSubCategory}
                                    className="w-full bg-green-600 hover:bg-green-700"
                                  >
                                    <Plus className="h-4 w-4 mr-2" /> Add Subcategory
                                  </Button>
                                </div>
                              </DialogContent>
                            </Dialog>

                          </>)}
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="mb-4 flex flex-col md:flex-row gap-4">
                          <div className="flex-1">
                            <Input
                              value={searchSubCategories}
                              onChange={(e) => setSearchSubCategories(e.target.value)}
                              placeholder="Search subcategories..."
                            />
                          </div>
                          <div className="w-full md:w-64">
                            <Select
                              value={filterSubCategoryByCategory}
                              onValueChange={setFilterSubCategoryByCategory}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Filter by Category" />
                              </SelectTrigger>
                              <SelectContent className="max-h-64">
                                <SelectItem value="all">All Categories</SelectItem>
                                <SelectItem value="uncategorized" className="text-destructive font-medium italic">Uncategorized</SelectItem>
                                {categories.map((cat: string) => (
                                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                          {subCategories.length === 0 ? (
                            <p className="text-center text-muted-foreground py-6">No subcategories created yet</p>
                          ) : (
                            subCategories
                              .filter(sub => {
                                const matchesSearch = fuzzySearch(searchSubCategories, sub.name);
                                const matchesCategory = filterSubCategoryByCategory === "all" ||
                                  (filterSubCategoryByCategory === "uncategorized" ? !sub.category : sub.category === filterSubCategoryByCategory);
                                return matchesSearch && matchesCategory;
                              })
                              .map((sub: any) => (
                                <div key={sub.id} className="p-4 border rounded-lg bg-white hover:border-green-400 transition">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <Layers className="h-5 w-5 text-green-600" />
                                      <div>
                                        <span className="font-medium">{sub.name}</span>
                                        <span className="text-sm text-muted-foreground ml-2">
                                          (Category: {sub.category})
                                        </span>
                                      </div>
                                    </div>
                                    {(canEditSubcategories || canDeleteSubcategories) && (
                                      <div className="flex gap-2">
                                        {canEditSubcategories && (
                                          <Button size="sm" variant="outline" onClick={() => {
                                            setEditingSubCategoryId(sub.id);
                                            setEditingSubCategoryName(sub.name);
                                            setEditingSubCategoryCategory(sub.category);
                                          }}>
                                            Edit
                                          </Button>
                                        )}
                                        {canDeleteSubcategories && (
                                          <Button size="sm" variant="destructive" onClick={() => requestDeleteSubCategory(sub)}>
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        )}
                                      </div>
                                    )}
                                    {editingSubCategoryId === sub.id && (
                                      <div className="mt-3 p-3 bg-gray-100 rounded border col-span-full w-full space-y-3">
                                        <div>
                                          <Label className="text-sm">Category</Label>
                                          <Select
                                            value={editingSubCategoryCategory}
                                            onValueChange={setEditingSubCategoryCategory}
                                          >
                                            <SelectTrigger>
                                              <SelectValue placeholder="Choose a category..." />
                                            </SelectTrigger>
                                            <SelectContent className="max-h-64">
                                              {categories.map((cat: string) => (
                                                <SelectItem key={cat} value={cat}>
                                                  {cat}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                        <div>
                                          <Label className="text-sm">Subcategory Name</Label>
                                          <Input
                                            value={editingSubCategoryName}
                                            onChange={(e) => setEditingSubCategoryName(e.target.value)}
                                            placeholder="Subcategory name"
                                            className="text-sm"
                                          />
                                        </div>
                                        <div className="flex gap-2">
                                          <Button size="sm" onClick={async () => {
                                            const newName = editingSubCategoryName.trim();
                                            if (!newName) {
                                              toast({ title: 'Error', description: 'Subcategory name cannot be empty', variant: 'destructive' });
                                              return;
                                            }
                                            if (!editingSubCategoryCategory) {
                                              toast({ title: 'Error', description: 'Please select a category', variant: 'destructive' });
                                              return;
                                            }
                                            try {
                                              const res = await apiFetch(`/subcategories/${sub.id}`, {
                                                method: 'PUT',
                                                body: JSON.stringify({ name: newName, category: editingSubCategoryCategory }),
                                              });
                                              if (res.ok) {
                                                setSubCategories(prev => prev.map(s => s.id === sub.id ? { ...s, name: newName, category: editingSubCategoryCategory } : s));
                                                setEditingSubCategoryId(null);
                                                setEditingSubCategoryName("");
                                                setEditingSubCategoryCategory("");
                                                toast({ title: 'Success', description: `Subcategory updated` });
                                              }
                                            } catch (err) {
                                              console.error('update subcategory error', err);
                                              toast({ title: 'Error', description: 'Failed to update subcategory', variant: 'destructive' });
                                            }
                                          }}>Save</Button>
                                          <Button size="sm" variant="ghost" onClick={() => {
                                            setEditingSubCategoryId(null);
                                            setEditingSubCategoryName("");
                                            setEditingSubCategoryCategory("");
                                          }}>Cancel</Button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>
                )}

                {canCreateProduct && (
                  <TabsContent value="products">
                    {/* Create Products Section */}
                    <Card className="border-blue-200 bg-blue-50">
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="text-blue-900">Create Products</CardTitle>
                            <CardDescription className="text-blue-800">Add new products and assign subcategories</CardDescription>
                          </div>
                          {canAddProducts && (<>
                            <Dialog open={showAddProductDialog} onOpenChange={setShowAddProductDialog}>
                              <DialogTrigger asChild>
                                <Button className="bg-blue-600 hover:bg-blue-700">
                                  <Plus className="h-4 w-4 mr-2" /> Add Product
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Add New Product</DialogTitle>
                                </DialogHeader>
                                <div className="space-y-4">
                                  <div className="space-y-2">
                                    <Label>Product Name <Required /></Label>
                                    <Input
                                      value={newProduct.name}
                                      onChange={(e) =>
                                        setNewProduct((prev) => ({ ...prev, name: e.target.value }))
                                      }
                                      placeholder="e.g. Ceramic Tiles, Wooden Door"
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label>Select Subcategory <Required /></Label>
                                    <Select
                                      value={newProduct.subcategory}
                                      onValueChange={(value) =>
                                        setNewProduct((prev) => ({ ...prev, subcategory: value }))
                                      }
                                    >
                                      <SelectTrigger>
                                        <SelectValue placeholder="Choose a subcategory..." />
                                      </SelectTrigger>
                                      <SelectContent className="max-h-64">
                                        {subCategories.length === 0 ? (
                                          <div className="p-2 text-sm text-muted-foreground">No subcategories available</div>
                                        ) : (
                                          subCategories.map((sub: any) => (
                                            <SelectItem key={sub.id} value={sub.name}>
                                              {sub.name} <span className="text-xs text-muted-foreground">({sub.category})</span>
                                            </SelectItem>
                                          ))
                                        )}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  {/*
<div className="flex items-center justify-between">
  <small className="text-xs text-muted-foreground"></small>
  <Button
    size="sm"
    variant="ghost"
    onClick={() => setShowAddSubInline(prev => !prev)}
  >
    {showAddSubInline ? 'Cancel' : ''}
  </Button>
</div>
*/}

                                  {showAddSubInline && (
                                    <div className="space-y-2 p-3 border rounded">
                                      <Label>Select Category <Required /></Label>
                                      <Select
                                        value={selectedCategoryForSubCategory}
                                        onValueChange={setSelectedCategoryForSubCategory}
                                      >
                                        <SelectTrigger>
                                          <SelectValue placeholder="Choose a category..." />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-44">
                                          {categories.length === 0 ? (
                                            <div className="p-2 text-sm text-muted-foreground">No categories available</div>
                                          ) : (
                                            categories.map((cat: string) => (
                                              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                                            ))
                                          )}
                                        </SelectContent>
                                      </Select>
                                      <div className="space-y-2">
                                        <Label>Subcategory Name <Required /></Label>
                                        <Input value={newSubCategory} onChange={(e) => setNewSubCategory(e.target.value)} placeholder="e.g. Commercial, Residential" />
                                      </div>
                                      <Button onClick={async () => {
                                        await handleAddSubCategory();
                                        // if created, set it as selected in product select
                                        if (newSubCategory.trim()) {
                                          setNewProduct(prev => ({ ...prev, subcategory: newSubCategory.trim() }));
                                          setShowAddSubInline(false);
                                        }
                                      }} className="w-full bg-green-600 hover:bg-green-700">Add Subcategory</Button>
                                    </div>
                                  )}

                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div className="space-y-2">
                                      <Label>HSN Code</Label>
                                      <Input value={newProduct.hsnCode} onChange={(e) => setNewProduct({ ...newProduct, hsnCode: e.target.value })} placeholder="Enter HSN code" />
                                    </div>
                                    <div className="space-y-2">
                                      <Label>SAC Code</Label>
                                      <Input value={newProduct.sacCode} onChange={(e) => setNewProduct({ ...newProduct, sacCode: e.target.value })} placeholder="Enter SAC code" />
                                    </div>
                                  </div>
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                      <Label>Product Images & Icon</Label>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 text-xs text-primary font-bold hover:bg-primary/10"
                                        onClick={() => {
                                          if (!newProduct.subcategory) {
                                            toast({ title: "Subcategory Required", description: "Please select a subcategory first to filter templates.", variant: "destructive" });
                                            return;
                                          }
                                          setProductForTemplate({ ...newProduct, id: 'temp' } as any);
                                          setShowTemplateSelector(true);
                                        }}
                                      >
                                        <Layers className="h-3 w-3 mr-1.5" /> Select Template Icon
                                      </Button>
                                    </div>
                                    <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
                                      <div
                                        className="h-20 w-20 rounded-2xl bg-white border-2 border-slate-100 shadow-sm flex items-center justify-center overflow-hidden cursor-pointer hover:border-primary/50 transition-all group shrink-0"
                                        onClick={() => {
                                          if (!newProduct.subcategory) {
                                            toast({ title: "Subcategory Required", description: "Please select a subcategory first to filter templates.", variant: "destructive" });
                                            return;
                                          }
                                          setProductForTemplate({ ...newProduct, id: 'temp' } as any);
                                          setShowTemplateSelector(true);
                                        }}
                                      >
                                        {parseImages(newProduct.image).length > 0 ? (
                                          <img src={parseImages(newProduct.image)[0]} alt="" className="max-w-full max-h-full object-contain" />
                                        ) : (
                                          <div className="flex flex-col items-center gap-1 text-slate-300 group-hover:text-primary transition-colors">
                                            <ImageIcon className="h-8 w-8" />
                                            <span className="text-[10px] font-bold uppercase tracking-tighter">Icon</span>
                                          </div>
                                        )}
                                      </div>
                                      <div className="flex-1 space-y-2">
                                        <Input
                                          type="file"
                                          accept="image/*"
                                          multiple
                                          className="h-9 text-xs file:bg-primary/5 file:text-primary file:border-none file:mr-2 file:px-3 file:py-1 file:rounded-md file:font-bold hover:file:bg-primary/10 transition-all"
                                          onChange={(e) => handleImageUpload(e, (newImagesJson) => {
                                            const newImages = JSON.parse(newImagesJson);
                                            const existing = parseImages(newProduct.image);
                                            setNewProduct({ ...newProduct, image: JSON.stringify([...existing, ...newImages]) });
                                          })}
                                        />
                                        <p className="text-[10px] text-muted-foreground italic">Uploaded images or templates will appear here.</p>
                                      </div>
                                    </div>
                                    <ImageGallery
                                      images={newProduct.image}
                                      onRemove={(idx) => {
                                        const images = parseImages(newProduct.image);
                                        images.splice(idx, 1);
                                        setNewProduct({ ...newProduct, image: images.length > 0 ? JSON.stringify(images) : null as any });
                                      }}
                                      onPreview={(url) => setSelectedPreviewImage(url)}
                                    />
                                  </div>
                                  <Button
                                    onClick={async () => {
                                      await handleAddProduct();
                                      if (newProduct.name.trim() && newProduct.subcategory) {
                                        setShowAddProductDialog(false);
                                      }
                                    }}
                                    className="w-full bg-blue-600 hover:bg-blue-700"
                                  >
                                    <Plus className="h-4 w-4 mr-2" /> Add Product
                                  </Button>
                                </div>
                              </DialogContent>
                            </Dialog>
                          </>)}
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="mb-4 flex flex-col md:flex-row gap-4">
                          <div className="flex-1">
                            <Input
                              value={searchProducts}
                              onChange={(e) => setSearchProducts(e.target.value)}
                              placeholder="Search products..."
                            />
                          </div>
                          <div className="w-full md:w-48">
                            <Select
                              value={filterProductByCategory}
                              onValueChange={(val) => {
                                setFilterProductByCategory(val);
                                setFilterProductBySubCategory("all");
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Filter by Category" />
                              </SelectTrigger>
                              <SelectContent className="max-h-64">
                                <SelectItem value="all">All Categories</SelectItem>
                                <SelectItem value="uncategorized" className="text-destructive font-medium italic">Uncategorized</SelectItem>
                                {categories.map((cat: string) => (
                                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="w-full md:w-48">
                            <Select
                              value={filterProductBySubCategory}
                              onValueChange={setFilterProductBySubCategory}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Filter by Subcategory" />
                              </SelectTrigger>
                              <SelectContent className="max-h-64">
                                <SelectItem value="all">All Subcategories</SelectItem>
                                <SelectItem value="uncategorized" className="text-destructive font-medium italic">Uncategorized</SelectItem>
                                {subCategories
                                  .filter(sub => filterProductByCategory === "all" || (filterProductByCategory === "uncategorized" ? !sub.category : sub.category === filterProductByCategory))
                                  .map((sub: any) => (
                                    <SelectItem key={sub.id} value={sub.name}>{sub.name}</SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                          {products.length === 0 ? (
                            <p className="text-center text-muted-foreground py-6">No products created yet</p>
                          ) : (
                            products
                              .filter(prod => {
                                const matchesSearch = fuzzySearch(searchProducts, prod.name);

                                let matchesSubCategory = filterProductBySubCategory === "all";
                                if (filterProductBySubCategory === "uncategorized") {
                                  matchesSubCategory = !prod.subcategory;
                                } else if (filterProductBySubCategory !== "all") {
                                  matchesSubCategory = prod.subcategory === filterProductBySubCategory;
                                }

                                const prodSub = subCategories.find(s => s.name === prod.subcategory);
                                let matchesCategory = filterProductByCategory === "all";
                                if (filterProductByCategory === "uncategorized") {
                                  matchesCategory = !prod.subcategory || (prodSub && !prodSub.category);
                                } else if (filterProductByCategory !== "all") {
                                  matchesCategory = !!(prodSub && prodSub.category === filterProductByCategory);
                                }

                                return matchesSearch && matchesSubCategory && matchesCategory;
                              })
                              .map((product: any) => (
                                <div key={product.id} className="p-4 border rounded-lg bg-white hover:border-blue-400 transition">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3 flex-1">
                                      <div
                                        className="h-14 w-14 border rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center shrink-0 cursor-pointer hover:border-blue-500 hover:bg-white transition-all group shadow-sm"
                                        onClick={() => {
                                          setProductForTemplate(product);
                                          setShowTemplateSelector(true);
                                        }}
                                        title="Click to select or change template icon"
                                      >
                                        {product.image ? (
                                          <img
                                            src={parseImages(product.image)[0]}
                                            alt=""
                                            className="max-w-full max-h-full object-contain group-hover:scale-110 transition-transform"
                                          />
                                        ) : (
                                          <Package className="h-6 w-6 text-blue-600 group-hover:rotate-12 transition-transform" />
                                        )}
                                      </div>
                                      <div className="flex-1">
                                        <span className="font-medium block">{product.name}</span>
                                        <span className="text-sm text-muted-foreground">
                                          Subcategories: {product.subcategory || "-"}
                                        </span>
                                        {product.taxCodeType && product.taxCodeValue && (
                                          <div className="text-sm text-muted-foreground mt-1">
                                            {product.taxCodeType.toUpperCase()}: {product.taxCodeValue}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                    {(canAddProducts || canEditProducts || canDeleteProducts) && (
                                      <div className="flex gap-2">
                                        {canAddProducts && (
                                          <Button size="sm" variant="ghost" onClick={() => handleCloneProduct(product)} title="Clone Product">
                                            <Copy className="h-4 w-4" />
                                          </Button>
                                        )}
                                        {canEditProducts && (
                                          <Button size="sm" variant="outline" onClick={() => {
                                            setEditingProduct(mapProduct(product));
                                          }}>
                                            Edit
                                          </Button>
                                        )}
                                        {canDeleteProducts && (
                                          <Button size="sm" variant="destructive" onClick={() => handleDeleteProduct(product.id)}>
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Edit Product Dialog */}
                    {editingProduct && (
                      <Dialog open={!!editingProduct} onOpenChange={(open) => !open && setEditingProduct(null)}>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Edit Product</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <Label>Product Name <Required /></Label>
                              <Input
                                value={editingProduct.name}
                                onChange={(e) =>
                                  setEditingProduct((prev: any) => ({ ...prev, name: e.target.value }))
                                }
                                placeholder="e.g. Ceramic Tiles, Wooden Door"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Select Subcategory <Required /></Label>
                              <Select
                                value={editingProduct.subcategory}
                                onValueChange={(value) =>
                                  setEditingProduct((prev: any) => ({ ...prev, subcategory: value }))
                                }
                              >
                                <SelectTrigger className="max-h-64 overflow-y-auto">
                                  <SelectValue placeholder="Select subcategory" />
                                </SelectTrigger>
                                <SelectContent className="max-h-64">
                                  {subCategories.map((sub: any) => (
                                    <SelectItem key={sub.id} value={sub.name}>
                                      {sub.name} ({sub.category})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label>Tax Codes</Label>
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label>HSN Code</Label>
                                  <Input
                                    value={editingProduct.hsnCode || ''}
                                    onChange={(e) => setEditingProduct((prev: any) => ({ ...prev, hsnCode: e.target.value }))}
                                    placeholder="Enter HSN code"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>SAC Code</Label>
                                  <Input
                                    value={editingProduct.sacCode || ''}
                                    onChange={(e) => setEditingProduct((prev: any) => ({ ...prev, sacCode: e.target.value }))}
                                    placeholder="Enter SAC code"
                                  />
                                </div>
                              </div>
                              <div className="space-y-2">
                                <Label>Product Images</Label>
                                <Input
                                  type="file"
                                  accept="image/*"
                                  multiple
                                  onChange={(e) => handleImageUpload(e, (newImagesJson) => {
                                    const newImages = JSON.parse(newImagesJson);
                                    const existing = parseImages(editingProduct ? editingProduct.image : "");
                                    setEditingProduct((prev: any) => ({ ...prev, image: JSON.stringify([...existing, ...newImages]) }));
                                  })}
                                />
                                <ImageGallery
                                  images={editingProduct.image}
                                  onRemove={(idx) => {
                                    const images = parseImages(editingProduct.image);
                                    images.splice(idx, 1);
                                    setEditingProduct((prev: any) => ({ ...prev, image: images.length > 0 ? JSON.stringify(images) : null }));
                                  }}
                                  onPreview={(url) => setSelectedPreviewImage(url)}
                                />
                              </div>
                              <div className="flex gap-2 justify-end">
                                <Button variant="outline" onClick={() => setEditingProduct(null)}>
                                  Cancel
                                </Button>
                                <Button
                                  onClick={() => {
                                    if (editingProduct.name.trim() && editingProduct.subcategory) {
                                      handleUpdateProduct();
                                      setEditingProduct(null);
                                    } else {
                                      toast({ title: 'Error', description: 'Please fill in all fields', variant: 'destructive' });
                                    }
                                  }}
                                  className="bg-blue-600 hover:bg-blue-700"
                                >
                                  Save Changes
                                </Button>
                              </div>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    )}
                  </TabsContent>
                )}
              </Tabs>
            </TabsContent>
          )}

          {/* === MATERIALS TAB === */}
          <TabsContent value="materials" className="space-y-4 mt-4">
            {/* ADMIN/SOFTWARE/PURCHASE_TEAM: Create Master Material */}
            {hasPerm(isAdminOrSoftwareTeam || user?.role === "purchase_team", "create_item") && (
              <Card className="border-blue-200 bg-blue-50">
                <CardHeader>
                  <CardTitle className="text-blue-900" id="create-material-section">
                    <Package className="inline-block mr-2 h-4 w-4 text-blue-900" /> Create Material
                  </CardTitle>
                  <CardDescription className="text-blue-800">
                    Add new material templates for suppliers to use
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2 md:col-span-2">
                      <Label>
                        Item Name <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        value={newMasterMaterial.name}
                        onChange={(e) =>
                          setNewMasterMaterial({
                            ...newMasterMaterial,
                            name: e.target.value,
                          })
                        }
                        placeholder="Enter Item name"
                      />
                      {newMasterMaterial.name &&
                        masterMaterials.some((m: any) => m.name.toLowerCase().trim() === newMasterMaterial.name.toLowerCase().trim()) && (
                          <p className="text-xs text-red-600 mt-1">
                            ⚠️ This material name already exists
                          </p>
                        )}
                    </div>
                    <div className="space-y-2">
                      <Label>Item Code (Auto)</Label>
                      <Input
                        value={newMasterMaterial.code}
                        disabled
                        className="bg-muted"
                      />
                      {newMasterMaterial.code &&
                        masterMaterials.some((m: any) => m.code === newMasterMaterial.code) && (
                          <p className="text-xs text-red-600 mt-1">
                            ⚠️ This item code already exists
                          </p>
                        )}
                    </div>


                    <div className="space-y-2">
                      <Label>
                        Vendor Category
                      </Label>
                      <Select
                        value={newMasterMaterial.vendorCategory}
                        onValueChange={(value) =>
                          setNewMasterMaterial({
                            ...newMasterMaterial,
                            vendorCategory: value,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select vendor category" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[200px] overflow-y-auto">
                          {vendorCategories.length === 0 ? (
                            <SelectItem value="none" disabled>
                              No categories available
                            </SelectItem>
                          ) : (
                            vendorCategories.map((cat) => (
                              <SelectItem key={cat.id} value={cat.name}>
                                {cat.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>HSN Code</Label>
                      <Input
                        value={newMasterMaterial.hsnCode}
                        onChange={(e) =>
                          setNewMasterMaterial({
                            ...newMasterMaterial,
                            hsnCode: e.target.value,
                          })
                        }
                        placeholder="Enter HSN code"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>SAC Code</Label>
                      <Input
                        value={newMasterMaterial.sacCode}
                        onChange={(e) =>
                          setNewMasterMaterial({
                            ...newMasterMaterial,
                            sacCode: e.target.value,
                          })
                        }
                        placeholder="Enter SAC code"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-3">
                      <Label>Description</Label>
                      <Textarea
                        value={newMasterMaterial.technicalSpecification}
                        onChange={(e) =>
                          setNewMasterMaterial({
                            ...newMasterMaterial,
                            technicalSpecification: e.target.value,
                          })
                        }
                        placeholder="Enter item description..."
                        className="min-h-[80px]"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-3">
                      <Label>Product Images</Label>
                      <Input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) => handleImageUpload(e, (newImagesJson) => {
                          const newImages = JSON.parse(newImagesJson);
                          const existing = parseImages(newMasterMaterial.image);
                          setNewMasterMaterial({ ...newMasterMaterial, image: JSON.stringify([...existing, ...newImages]) });
                        })}
                      />
                      <ImageGallery
                        images={newMasterMaterial.image}
                        onRemove={(idx) => {
                          const images = parseImages(newMasterMaterial.image);
                          images.splice(idx, 1);
                          setNewMasterMaterial({ ...newMasterMaterial, image: images.length > 0 ? JSON.stringify(images) : null as any });
                        }}
                        onPreview={(url) => setSelectedPreviewImage(url)}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleAddMasterMaterial}
                      disabled={
                        (!(newMasterMaterial.name || "").trim()) ||
                        masterMaterials.some((m: any) => (m.name || "").toLowerCase().trim() === (newMasterMaterial.name || "").toLowerCase().trim()) ||
                        masterMaterials.some((m: any) => m.code === newMasterMaterial.code)
                      }
                      className="w-full md:w-auto bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Plus className="mr-2 h-4 w-4" /> Create Material
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setNewMasterMaterial({
                          name: "",
                          code: "",
                          category: "",
                          subcategory: "",
                          vendorCategory: "",
                          taxCodeType: null,
                          taxCodeValue: "",
                          hsnCode: "",
                          sacCode: "",
                          technicalSpecification: "",
                          image: undefined
                        });
                        toast({
                          title: "Form Cleared",
                          description: "The creation form has been reset.",
                        });
                      }}
                      className="w-full md:w-auto"
                    >
                      Clear
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Created Material Templates List - Admin/Software/Purchase Team */}
            {hasPerm(isAdminOrSoftwareTeam || user?.role === "purchase_team", "create_item") && (
              <Card>
                <CardHeader>
                  <CardTitle>Created Material Templates</CardTitle>
                  <CardDescription>
                    Manage all material templates created for suppliers
                  </CardDescription>
                  <div className="mt-4 flex flex-wrap items-center gap-4">
                    <Input
                      placeholder="Search materials..."
                      value={masterSearch}
                      onChange={(e) => setMasterSearch(e.target.value)}
                      className="max-w-sm"
                    />
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="unlinked-filter"
                        checked={showOnlyUnlinked}
                        onCheckedChange={(checked) => setShowOnlyUnlinked(!!checked)}
                      />
                      <Label htmlFor="unlinked-filter" className="text-sm font-medium cursor-pointer">
                        Show Only Not Linked
                      </Label>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {masterMaterials.length === 0 ? (
                    <div className="text-center text-muted-foreground py-8">
                      No material templates created yet. Create one above.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto p-2">
                      {masterMaterials
                        .filter((t: any) => {
                          const matchesSearch = fuzzySearch(masterSearch, [t.name || "", t.code || "", t.category || ""]);
                          if (showOnlyUnlinked) {
                            return matchesSearch && !usedTemplateIds.has(t.id);
                          }
                          return matchesSearch;
                        })
                        .map((template: any) => (
                          <div key={template.id} className={`p-4 border rounded flex items-center justify-between ${!usedTemplateIds.has(template.id) ? 'bg-amber-50/40' : 'bg-white'}`}>
                            <div className="flex-1">
                              {editingMaterialId === template.id ? (
                                <div className="space-y-3 w-full">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div>
                                      <Label>Item Name <span className="text-red-500">*</span></Label>
                                      <Input
                                        value={newMaterial.name}
                                        onChange={(e) => setNewMaterial({ ...newMaterial, name: e.target.value })}
                                        placeholder="Enter material name"
                                      />
                                    </div>
                                    <div>
                                      <Label>Item Code</Label>
                                      <Input
                                        value={template.code}
                                        disabled
                                        className="bg-muted"
                                        placeholder="Auto-generated"
                                      />
                                    </div>
                                    <div>
                                      <Label>Vendor Category</Label>
                                      <Select
                                        value={newMaterial.vendorCategory || ""}
                                        onValueChange={(value) => setNewMaterial({ ...newMaterial, vendorCategory: value })}
                                      >
                                        <SelectTrigger>
                                          <SelectValue placeholder="Select vendor category" />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-[200px] overflow-y-auto">
                                          {vendorCategories.length === 0 ? (
                                            <SelectItem value="none" disabled>No categories available</SelectItem>
                                          ) : (
                                            vendorCategories.map((cat) => (
                                              <SelectItem key={cat.id} value={cat.name}>{cat.name}</SelectItem>
                                            ))
                                          )}
                                        </SelectContent>
                                      </Select>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                      <div>
                                        <Label>Category <span className="text-red-500">*</span></Label>
                                        <Select
                                          value={newMaterial.category || ""}
                                          onValueChange={(value) => setNewMaterial({ ...newMaterial, category: value, subCategory: "" })}
                                        >
                                          <SelectTrigger>
                                            <SelectValue placeholder="Select category" />
                                          </SelectTrigger>
                                          <SelectContent className="max-h-[200px] overflow-y-auto">
                                            {categories.length === 0 ? (
                                              <SelectItem value="none" disabled>No categories available</SelectItem>
                                            ) : (
                                              categories.map((cat: string) => (
                                                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                                              ))
                                            )}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      <div>
                                        <Label>Subcategory <span className="text-red-500">*</span></Label>
                                        <Select
                                          value={newMaterial.subCategory || ""}
                                          onValueChange={(value) => setNewMaterial({ ...newMaterial, subCategory: value })}
                                        >
                                          <SelectTrigger>
                                            <SelectValue placeholder="Select subcategory" />
                                          </SelectTrigger>
                                          <SelectContent className="max-h-[200px] overflow-y-auto">
                                            {subCategories.filter(s => s.category === newMaterial.category).length === 0 ? (
                                              <SelectItem value="none" disabled>No subcategories available</SelectItem>
                                            ) : (
                                              subCategories
                                                .filter(s => s.category === newMaterial.category)
                                                .map((sub: any) => (
                                                  <SelectItem key={sub.id} value={sub.name}>{sub.name}</SelectItem>
                                                ))
                                            )}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    </div>

                                    <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                                      <div>
                                        <Label>HSN Code</Label>
                                        <Input
                                          value={newMaterial.hsnCode || ""}
                                          onChange={(e) => setNewMaterial({ ...newMaterial, hsnCode: e.target.value })}
                                          placeholder="Enter HSN code"
                                        />
                                      </div>
                                      <div>
                                        <Label>SAC Code</Label>
                                        <Input
                                          value={newMaterial.sacCode || ""}
                                          onChange={(e) => setNewMaterial({ ...newMaterial, sacCode: e.target.value })}
                                          placeholder="Enter SAC code"
                                        />
                                      </div>
                                    </div>
                                    <div className="md:col-span-2">
                                      <Label>Description</Label>
                                      <Textarea
                                        value={newMaterial.technicalSpecification || ""}
                                        onChange={(e) => setNewMaterial({ ...newMaterial, technicalSpecification: e.target.value })}
                                        placeholder="Enter item description..."
                                        className="min-h-[80px]"
                                      />
                                    </div>
                                    <div className="md:col-span-2">
                                      <Label>Product Images</Label>
                                      <Input
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        onChange={(e) => handleImageUpload(e, (newImagesJson) => {
                                          const newImages = JSON.parse(newImagesJson);
                                          const existing = parseImages(newMaterial.image);
                                          setNewMaterial({ ...newMaterial, image: JSON.stringify([...existing, ...newImages]) });
                                        })}
                                      />
                                      <ImageGallery
                                        images={newMaterial.image}
                                        onRemove={(idx) => {
                                          const images = parseImages(newMaterial.image);
                                          images.splice(idx, 1);
                                          setNewMaterial({ ...newMaterial, image: images.length > 0 ? JSON.stringify(images) : null as any });
                                        }}
                                        onPreview={(url) => setSelectedPreviewImage(url)}
                                      />
                                    </div>
                                  </div>
                                  <div className="flex gap-2 justify-end pt-2">
                                    <Button size="sm" variant="ghost" onClick={() => setEditingMaterialId(null)}>Cancel</Button>
                                    <Button size="sm" onClick={async () => {
                                      if (!(newMaterial.name || "").trim()) {
                                        toast({ title: 'Error', description: 'Material name is required', variant: 'destructive' });
                                        return;
                                      }
                                      try {
                                        const updateData: any = {
                                          name: newMaterial.name,
                                          code: template.code,
                                          category: newMaterial.category || null,
                                          subcategory: newMaterial.subCategory || null,
                                          vendor_category: newMaterial.vendorCategory || null,
                                          hsn_code: newMaterial.hsnCode || null,
                                          sac_code: newMaterial.sacCode || null,
                                          technicalSpecification: newMaterial.technicalSpecification || null,
                                          dimensions: newMaterial.dimensions || null,
                                          finishtype: newMaterial.finish || null,
                                          metaltype: newMaterial.metalType || null,
                                          image: newMaterial.image || null
                                        };

                                        const res = await apiFetch(`/material-templates/${template.id}`, {
                                          method: 'PUT',
                                          body: JSON.stringify(updateData)
                                        });
                                        if (!res.ok) {
                                          const text = await res.text().catch(() => '');
                                          console.error('[material-templates PUT] failed', res.status, text);
                                          toast({ title: 'Error', description: text || 'Failed to update material (server error)', variant: 'destructive' });
                                          throw new Error(text || 'update failed');
                                        }
                                        const data = await res.json().catch(() => null);
                                        setMasterMaterials(prev => prev.map(m => m.id === template.id ? {
                                          ...m,
                                          name: newMaterial.name,
                                          vendor_category: newMaterial.vendorCategory,
                                          category: newMaterial.category,
                                          subcategory: newMaterial.subCategory,
                                          hsn_code: newMaterial.hsnCode,
                                          sac_code: newMaterial.sacCode,
                                          technicalspecification: newMaterial.technicalSpecification,
                                          dimensions: newMaterial.dimensions,
                                          finishtype: newMaterial.finish,
                                          metaltype: newMaterial.metalType,
                                          ...(data?.template || {})
                                        } : m));
                                        setEditingMaterialId(null);
                                        toast({ title: 'Success', description: 'Material template updated' });
                                      } catch (err) {
                                        console.error('update error', err);
                                        if (!(err as any)?.message?.includes('update failed')) {
                                          toast({ title: 'Error', description: 'Failed to update material template', variant: 'destructive' });
                                        }
                                      }
                                    }}>Save Changes</Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center gap-3">
                                  <div className="h-10 w-10 border rounded bg-gray-50 overflow-hidden flex items-center justify-center shrink-0">
                                    {template.image ? (
                                      <img
                                        src={parseImages(template.image)[0]}
                                        alt=""
                                        className="max-w-full max-h-full object-contain cursor-pointer"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedPreviewImage(parseImages(template.image)[0]);
                                        }}
                                      />
                                    ) : (
                                      <Package className="h-4 w-4 text-muted-foreground" />
                                    )}
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <div className="font-medium text-sm">{template.name}</div>
                                      {!usedTemplateIds.has(template.id) && (
                                        <Badge variant="outline" className="text-[9px] h-4 px-1.5 bg-amber-50 text-amber-600 border-amber-200">
                                          Not Linked
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                                      <span className="font-medium">{template.code}</span>
                                      {(template.hsn_code || template.hsnCode) && (
                                        <>
                                          <span className="text-slate-300">•</span>
                                          <span className="text-slate-800 font-medium">HSN:</span> <span className="text-blue-600 font-semibold">{template.hsn_code || template.hsnCode}</span>
                                        </>
                                      )}
                                      {(template.sac_code || template.sacCode) && (
                                        <>
                                          <span className="text-slate-300">•</span>
                                          <span className="text-slate-800 font-medium">SAC:</span> <span className="text-blue-600 font-semibold">{template.sac_code || template.sacCode}</span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                            {editingMaterialId !== template.id && (
                              <div className="flex items-center gap-2">

                                {canEditDelete ? (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleCloneMasterMaterial(template)}
                                      title="Clone Template"
                                    >
                                      <Copy className="h-4 w-4" />
                                    </Button>
                                    <Button size="sm" onClick={() => {
                                      setEditingMaterialId(template.id);
                                      setNewMaterial({
                                        ...newMaterial,
                                        name: template.name,
                                        category: template.category || '',
                                        subCategory: template.subcategory || template.sub_category || template.subCategory || '',
                                        vendorCategory: template.vendor_category || '',
                                        hsnCode: template.hsn_code || template.hsnCode || '',
                                        sacCode: template.sac_code || template.sacCode || '',
                                        technicalSpecification: template.technicalspecification || template.technicalSpecification || '',
                                        dimensions: template.dimensions || '',
                                        finish: template.finishtype || template.finish || '',
                                        metalType: template.metaltype || template.metalType || '',
                                        image: template.image || null
                                      });
                                    }}>Edit</Button>
                                    <Button size="sm" variant="destructive" onClick={async () => {
                                      if (!window.confirm(`Delete "${template.name}"? This cannot be undone.`)) return;
                                      try {
                                        console.log('[DELETE template]', template.id, template.name);
                                        const res = await apiFetch(`/material-templates/${template.id}`, { method: 'DELETE' });
                                        console.log('[DELETE response]', res.status, res.ok);
                                        if (!res.ok) {
                                          const errorData = await res.json();
                                          throw new Error(errorData.message || 'Failed to delete');
                                        }
                                        setMasterMaterials(prev => prev.filter(m => m.id !== template.id));
                                        toast({ title: 'Success', description: 'Material deleted' });
                                      } catch (err) {
                                        console.error('delete error', err);
                                        toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to delete material', variant: 'destructive' });
                                      }
                                    }}>Delete</Button>
                                  </>
                                ) : (
                                  <Link href={`/admin/dashboard?tab=materials`}>
                                    <span className="text-sm text-sidebar-primary pr-2">View</span>
                                  </Link>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Materials list moved to Dashboard */}
          </TabsContent>

          {/* === SHOPS TAB === */}
          <TabsContent value="shops" className="space-y-4 mt-4">
            {(isAdminOrSoftwareTeam || user?.role === "purchase_team") && (
              <Card>
                <CardHeader>
                  <CardTitle>Add New Shop</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Shop Name <span className="text-red-500">*</span></Label>
                      <Input
                        value={newShop.name}
                        onChange={(e) =>
                          setNewShop({ ...newShop, name: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Address <span className="text-red-500">*</span></Label>
                      <Input
                        value={newShop.location}
                        onChange={(e) =>
                          setNewShop({ ...newShop, location: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Location</Label>
                      <Input
                        value={newShop.new_location}
                        onChange={(e) =>
                          setNewShop({ ...newShop, new_location: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>City <span className="text-red-500">*</span></Label>
                      <Input
                        value={newShop.city}
                        onChange={(e) =>
                          setNewShop({ ...newShop, city: e.target.value })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Phone Number <span className="text-red-500">*</span></Label>
                      <div className="flex gap-2">
                        <Select
                          value={newShop.phoneCountryCode || "+91"}
                          onValueChange={(value) =>
                            setNewShop({ ...newShop, phoneCountryCode: value })
                          }
                        >
                          <SelectTrigger className="w-28">
                            <SelectValue placeholder="+91" />
                          </SelectTrigger>
                          <SelectContent>
                            {COUNTRY_CODES.map((c) => (
                              <SelectItem key={c.code} value={c.code}>
                                {c.code}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Input
                          value={newShop.contactNumber || ""}
                          onChange={(e) =>
                            setNewShop({
                              ...newShop,
                              contactNumber: e.target.value,
                            })
                          }
                          placeholder="Enter phone number"
                          type="tel"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>State <span className="text-red-500">*</span></Label>
                      <Select
                        value={newShop.state}
                        onValueChange={(value) =>
                          setNewShop({ ...newShop, state: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select state" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px] overflow-y-auto">
                          {INDIAN_STATES.map((state) => (
                            <SelectItem key={state} value={state}>
                              {state}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Country <span className="text-red-500">*</span></Label>
                      <Input
                        value={newShop.country}
                        onChange={(e) =>
                          setNewShop({ ...newShop, country: e.target.value })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Pincode / Zipcode <span className="text-red-500">*</span></Label>
                      <Input
                        value={newShop.pincode}
                        onChange={(e) =>
                          setNewShop({ ...newShop, pincode: e.target.value })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>GST No (Optional)</Label>
                      <Input
                        value={newShop.gstNo}
                        onChange={(e) =>
                          setNewShop({ ...newShop, gstNo: e.target.value })
                        }
                        placeholder="29ABCDE1234F1Z5"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Vendor Category (Optional)</Label>
                      <Select
                        value={newShop.vendorCategory}
                        onValueChange={(value) =>
                          setNewShop({ ...newShop, vendorCategory: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select vendor category" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[200px] overflow-y-auto">
                          {vendorCategories.length === 0 ? (
                            <SelectItem value="none" disabled>
                              No categories available
                            </SelectItem>
                          ) : (
                            vendorCategories.map((cat: any) => (
                              <SelectItem key={cat.id} value={cat.name}>
                                {cat.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Terms and Conditions</Label>
                      <Input
                        value={newShop.terms_and_conditions}
                        onChange={(e) =>
                          setNewShop({ ...newShop, terms_and_conditions: e.target.value })
                        }
                        placeholder="Enter terms and conditions"
                      />
                    </div>
                  </div>
                  <Button onClick={editingShopId ? handleUpdateShop : handleAddShop}>{editingShopId ? 'Save Changes' : 'Add Shop'}</Button>
                </CardContent>
              </Card>
            )}
            {/* Shops list moved to Dashboard */}
          </TabsContent>

          {/* === APPROVALS TAB === */}
          {canManageShops && (
            <TabsContent value="approvals" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Shop Approval Requests</CardTitle>
                  <CardDescription>
                    Review and approve/reject new shop submissions
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {shopRequests.filter((r: any) => r.status === "pending").length ===
                    0 ? (
                    <p className="text-muted-foreground">
                      No pending approval requests
                    </p>
                  ) : (
                    shopRequests
                      .filter((r: any) => r.status === "pending")
                      .map((request: any) => (
                        <Card key={request.id} className="border-border/50">
                          <CardContent className="pt-6 space-y-4">
                            <div>
                              <h3 className="text-lg font-bold">
                                {request.shop.name}
                              </h3>
                              <p className="text-sm text-muted-foreground">
                                Submitted by: {request.submittedBy} at{" "}
                                {new Date(
                                  request.submittedAt
                                ).toLocaleDateString()}
                              </p>
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <p className="font-semibold">Address</p>
                                <p>{request.shop.location}</p>
                              </div>
                              {request.shop.new_location && (
                                <div>
                                  <p className="font-semibold">Location</p>
                                  <p>{request.shop.new_location}</p>
                                </div>
                              )}
                              <div>
                                <p className="font-semibold">City</p>
                                <p>{request.shop.city}</p>
                              </div>
                              <div>
                                <p className="font-semibold">State</p>
                                <p>{request.shop.state}</p>
                              </div>
                              {request.shop.terms_and_conditions && (
                                <div className="col-span-2">
                                  <p className="font-semibold">Terms and Conditions</p>
                                  <p className="text-xs italic">{request.shop.terms_and_conditions}</p>
                                </div>
                              )}
                              <div>
                                <p className="font-semibold">Country</p>
                                <p>{request.shop.country}</p>
                              </div>
                              <div>
                                <p className="font-semibold">Pincode</p>
                                <p>{request.shop.pincode}</p>
                              </div>
                              <div>
                                <p className="font-semibold">Phone</p>
                                <p>
                                  {request.shop.phoneCountryCode}
                                  {request.shop.contactNumber}
                                </p>
                              </div>
                              {request.shop.gstNo && (
                                <div>
                                  <p className="font-semibold">GST No</p>
                                  <p>{request.shop.gstNo}</p>
                                </div>
                              )}
                            </div>

                            {/* Approve / Reject Buttons - Admin/Software Team/Purchase Team */}
                            {canApproveReject && (
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => handleApproveShop(request)}
                                  className="gap-2"
                                  disabled={!request?.shop?.id}
                                >
                                  <CheckCircle2 className="h-4 w-4" /> Approve
                                </Button>

                                {rejectingId === request.id ? (
                                  <div className="flex gap-2 flex-1">
                                    <Input
                                      placeholder="Reason..."
                                      value={rejectReason}
                                      onChange={(e) =>
                                        setRejectReason(e.target.value)
                                      }
                                      className="text-sm"
                                    />
                                    <Button
                                      size="sm"
                                      onClick={() =>
                                        handleRejectShop(request)
                                      }
                                    >
                                      Confirm
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => setRejectingId(null)}
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setRejectingId(request.id)}
                                    className="gap-2"
                                  >
                                    <XCircle className="h-4 w-4" /> Reject
                                  </Button>
                                )}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))
                  )}
                </CardContent>

                {/* Processed Requests */}
                {shopRequests.filter((r: any) => r.status !== "pending").length >
                  0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">
                          Processed Requests
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {shopRequests
                          .filter((r: any) => r.status !== "pending")
                          .map((request: any) => (
                            <div
                              key={request.id}
                              className="flex justify-between items-start p-3 bg-muted/50 rounded"
                            >
                              <div>
                                <p className="font-semibold">
                                  {request.shop.name}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {request.submittedBy}
                                </p>
                              </div>
                              <div className="text-right">
                                <Badge
                                  variant={
                                    request.status === "approved"
                                      ? "default"
                                      : "destructive"
                                  }
                                >
                                  {request.status === "approved"
                                    ? "LA"
                                    : request.status.charAt(0).toUpperCase() +
                                    request.status.slice(1)}
                                </Badge>
                              </div>
                            </div>
                          ))}
                      </CardContent>
                    </Card>
                  )}
              </Card>
            </TabsContent>
          )}

          {/* === MATERIAL APPROVALS TAB === */}
          {(isAdminOrSoftwareTeam || user?.role === "purchase_team") && (
            <TabsContent value="material-approvals" className="space-y-4 mt-4">
              <Tabs defaultValue="material-requests" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-4">
                  <TabsTrigger value="material-requests">
                    Material Requests
                    {materialRequests.filter((r: any) => r.status === "pending").length > 0 && (
                      <Badge variant="secondary" className="ml-2">
                        {materialRequests.filter((r: any) => r.status === "pending").length}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="supplier-proposal-materials">
                    Supplier Proposal Materials
                    {proposalMaterialSubmissions.length > 0 && (
                      <Badge variant="secondary" className="ml-2">
                        {proposalMaterialSubmissions.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                </TabsList>

                {/* Material Requests Tab */}
                <TabsContent value="material-requests">
                  <Card>
                    <CardHeader>
                      <CardTitle>Material Approval Requests</CardTitle>
                      <CardDescription>
                        Review and approve/reject new material submissions
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {materialRequests.filter((r: any) => r.status === "pending")
                        .length === 0 ? (
                        <p className="text-muted-foreground">
                          No pending material approvals
                        </p>
                      ) : (
                        materialRequests
                          .filter((r: any) => r.status === "pending")
                          .map((request: any) => (
                            <Card key={request.id} className="border-border/50">
                              <CardContent className="pt-6 space-y-4">
                                <div className="flex items-center gap-3 mb-4">
                                  <div className="h-12 w-12 border rounded bg-gray-50 overflow-hidden flex items-center justify-center shrink-0">
                                    {request.material.image ? (
                                      <img
                                        src={parseImages(request.material.image)[0]}
                                        alt=""
                                        className="max-w-full max-h-full object-contain"
                                      />
                                    ) : (
                                      <Package className="h-6 w-6 text-muted-foreground" />
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <h3 className="text-lg font-bold flex items-center gap-2 flex-wrap">
                                      {request.material.name}
                                      {request.material.is_project_pricing && (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                                          ★ Project Pricing Material
                                        </span>
                                      )}
                                    </h3>
                                    <p className="text-sm text-muted-foreground">
                                      Submitted by: {request.submittedBy} at{" "}
                                      {new Date(
                                        request.submittedAt
                                      ).toLocaleDateString()}
                                    </p>
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3 text-sm mt-2">
                                  <div>
                                    <p className="font-semibold">Code</p>
                                    <p>{request.material.code || request.material.template_code || request.material.templateCode || '-'}</p>
                                  </div>
                                  <div>
                                    <p className="font-semibold">Rate</p>
                                    <p>₹{request.material.rate ?? request.material.price ?? '-'}</p>
                                  </div>
                                  <div>
                                    <p className="font-semibold">Unit</p>
                                    <p>{request.material.unit || request.material.uom || '-'}</p>
                                  </div>
                                  <div>
                                    <p className="font-semibold">Category</p>
                                    <p>{request.material.category || request.material.categoryName || request.material.category_name || request.material.vendorCategory || request.material.vendor_category || '-'}</p>
                                  </div>
                                  <div>
                                    <p className="font-semibold">Sub Category</p>
                                    <p>{request.material.subCategory || request.material.subcategory || request.material.sub_category || '-'}</p>
                                  </div>
                                  <div>
                                    <p className="font-semibold">Brand</p>
                                    <p>{request.material.brandName || request.material.brandname || request.material.brand || request.material.make || '-'}</p>
                                  </div>
                                  {(request.material.technicalSpecification || request.material.technicalspecification) && (
                                    <div className="col-span-2">
                                      <p className="font-semibold">Technical Specification</p>
                                      <p className="text-blue-600 italic text-xs">{request.material.technicalSpecification || request.material.technicalspecification}</p>
                                    </div>
                                  )}
                                </div>

                                {/* Approve / Reject Buttons - Admin/Software Team/Purchase Team */}
                                {canApproveReject && (
                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      onClick={() => handleApproveMaterial(request.id)}
                                      className="gap-2"
                                      disabled={!request?.material?.id}
                                    >
                                      <CheckCircle2 className="h-4 w-4" /> Approve
                                    </Button>

                                    {rejectingId === request.id ? (
                                      <div className="flex gap-2 flex-1">
                                        <Input
                                          placeholder="Reason..."
                                          value={rejectReason}
                                          onChange={(e) =>
                                            setRejectReason(e.target.value)
                                          }
                                          className="text-sm"
                                        />
                                        <Button
                                          size="sm"
                                          onClick={() =>
                                            handleRejectMaterial(request.id)
                                          }
                                        >
                                          Confirm
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => setRejectingId(null)}
                                        >
                                          Cancel
                                        </Button>
                                      </div>
                                    ) : (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setRejectingId(request.id)}
                                        className="gap-2"
                                      >
                                        <XCircle className="h-4 w-4" /> Reject
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          ))
                      )}
                    </CardContent>

                    {/* Processed Requests */}
                    {materialRequests.filter((r: any) => r.status !== "pending").length >
                      0 && (
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-base">
                              Processed Requests
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {materialRequests
                              .filter((r: any) => r.status !== "pending")
                              .map((request: any) => (
                                <div
                                  key={request.id}
                                  className="flex justify-between items-start p-3 bg-muted/50 rounded"
                                >
                                  <div>
                                    <p className="font-semibold">
                                      {request.material.name}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                      {request.submittedBy}
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <Badge
                                      variant={
                                        request.status === "approved"
                                          ? "default"
                                          : "destructive"
                                      }
                                    >
                                      {request.status === "approved"
                                        ? "Approved"
                                        : request.status.charAt(0).toUpperCase() +
                                        request.status.slice(1)}
                                    </Badge>
                                  </div>
                                </div>
                              ))}
                          </CardContent>
                        </Card>
                      )}
                  </Card>
                </TabsContent>

                {/* Supplier Proposal Materials Tab */}
                <TabsContent value="supplier-proposal-materials">
                  <Card>
                    <CardHeader>
                      <CardTitle>Supplier Proposal Materials</CardTitle>
                      <CardDescription>
                        Materials submitted by suppliers through proposal submissions
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {loadingProposalMaterials ? (
                        <div className="flex justify-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : proposalMaterialSubmissions.length === 0 ? (
                        <p className="text-muted-foreground">
                          No pending supplier proposal materials for approval
                        </p>
                      ) : (
                        proposalMaterialSubmissions.map((submission: any) => (
                          <Card key={submission.id} className="border-blue-200 border-l-4">
                            <CardContent className="pt-6 space-y-4">
                              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                {/* Material Info */}
                                <div>
                                  <p className="text-sm text-muted-foreground font-semibold">Material</p>
                                  <p className="font-bold">{submission.template_name}</p>
                                  <p className="text-xs text-muted-foreground">{submission.template_code}</p>
                                </div>

                                {/* Project Info */}
                                <div>
                                  <p className="text-sm text-muted-foreground font-semibold">Project</p>
                                  <p className="font-semibold">{submission.project_name}</p>
                                </div>

                                {/* Supplier Info */}
                                <div>
                                  <p className="text-sm text-muted-foreground font-semibold">Supplier</p>
                                  <p className="font-semibold">{submission.shop_name}</p>
                                  <p className="text-xs text-muted-foreground">{submission.submitted_by_name || submission.submitted_by_email}</p>
                                </div>

                                {/* Rate and Unit */}
                                <div>
                                  <p className="text-sm text-muted-foreground font-semibold">Proposed Rate</p>
                                  <p className="font-bold text-blue-600">
                                    ₹{Number(submission.rate).toFixed(2)} / {submission.unit}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {new Date(submission.submitted_at).toLocaleDateString()}
                                  </p>
                                </div>
                              </div>

                              {submission.template_category && (
                                <div className="text-sm">
                                  <p className="text-muted-foreground font-semibold">Category</p>
                                  <p>{submission.template_category}</p>
                                </div>
                              )}

                              {/* Rejection Reason Section (if rejecting) */}
                              {rejectingProposalMaterialId === submission.id && (
                                <div className="p-4 bg-red-50 border border-red-200 rounded">
                                  <Label className="text-red-900 font-semibold">
                                    Rejection Reason <span className="text-red-600">*</span>
                                  </Label>
                                  <Textarea
                                    placeholder="Explain why this submission is being rejected"
                                    value={rejectReason}
                                    onChange={(e) => setRejectReason(e.target.value)}
                                    rows={3}
                                    className="mt-2"
                                  />
                                </div>
                              )}

                              {/* Action Buttons */}
                              <div className="flex gap-2">
                                {rejectingProposalMaterialId === submission.id ? (
                                  <>
                                    <Button
                                      size="sm"
                                      onClick={() => handleRejectProposalMaterial(submission.id)}
                                      variant="destructive"
                                      disabled={!rejectReason.trim()}
                                      className="gap-2"
                                    >
                                      <XCircle className="h-4 w-4" />
                                      Confirm Rejection
                                    </Button>
                                    <Button
                                      size="sm"
                                      onClick={() => {
                                        setRejectingProposalMaterialId(null);
                                        setRejectReason("");
                                      }}
                                      variant="outline"
                                    >
                                      Cancel
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <Button
                                      size="sm"
                                      onClick={() => handleApproveProposalMaterial(submission.id)}
                                      className="gap-2 bg-green-600 hover:bg-green-700"
                                    >
                                      <CheckCircle2 className="h-4 w-4" />
                                      Approve
                                    </Button>
                                    <Button
                                      size="sm"
                                      onClick={() => setRejectingProposalMaterialId(submission.id)}
                                      variant="outline"
                                      className="gap-2"
                                    >
                                      <XCircle className="h-4 w-4" />
                                      Reject
                                    </Button>
                                  </>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        ))
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </TabsContent>
          )}

          {/* === PROJECT PRICING MATERIALS TAB === */}
          {(isAdminOrSoftwareTeam || user?.role === "pre_sales") && (
            <TabsContent value="project-pricing-materials" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" onClick={() => setActiveTab("dashboard")} className="mr-2 h-8 w-8 hover:bg-slate-100">
                          <ArrowLeft className="h-4 w-4" />
                        </Button>
                        Project Pricing Materials
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                          ★ Project Pricing
                        </span>
                      </CardTitle>
                      <CardDescription className="ml-12">
                        Materials marked as Project Pricing — approved and available for project-based pricing
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <AllMaterialsSplitView
                    materials={filteredMaterials.filter((m: any) => m.is_project_pricing === true)}
                    localShops={localShops}
                    categories={categories}
                    getSubCategoriesForCategory={getSubCategoriesForCategory}
                    products={products}
                    UNIT_OPTIONS={UNIT_OPTIONS}
                    materialSearch={materialSearch}
                    setMaterialSearch={setMaterialSearch}
                    materialCategoryFilter={materialCategoryFilter}
                    setMaterialCategoryFilter={setMaterialCategoryFilter}
                    materialSubcategoryFilter={materialSubcategoryFilter}
                    setMaterialSubcategoryFilter={setMaterialSubcategoryFilter}
                    editingMaterialId={editingMaterialId}
                    setEditingMaterialId={setEditingMaterialId}
                    newMaterial={newMaterial}
                    setNewMaterial={setNewMaterial}
                    handleUpdateMaterial={handleUpdateMaterial}
                    onToggleDisable={(mat: any) => setLocalMaterials((prev: any[]) => prev.map((m: any) => m.id === mat.id ? { ...m, disabled: !m.disabled } : m))}
                    onDelete={(mat: any) => setGenericDelete({ isOpen: true, id: mat.id, name: mat.name, type: 'material' })}
                    canEditDelete={canEditDelete}
                    userRole={user?.role || ""}
                  />
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* === MESSAGES TAB === */}
          {canViewSupportMessages && (
            <TabsContent value="messages" className="mt-4 h-[700px]">
              <Card className="h-full overflow-hidden flex flex-col border-none shadow-xl">
                <div className="flex h-full">
                  {/* Left Sidebar: Conversations List */}
                  <div className="w-1/3 border-r border-slate-100 bg-slate-50/50 flex flex-col">
                    <div className="p-4 border-b bg-white">
                      <h3 className="font-bold text-lg text-slate-800">Conversations</h3>
                      <p className="text-xs text-slate-500">Active support threads</p>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                      {(() => {
                        const conversations = (supportMessages || []).reduce((acc: any, msg: any) => {
                          const email = msg.sender_email || msg.sender_name || 'unknown';
                          if (!acc[email]) {
                            acc[email] = {
                              email,
                              name: msg.sender_name || 'Unknown User',
                              lastMessage: msg.message,
                              lastTime: msg.submitted_at || msg.sent_at || msg.sentAt,
                              unreadCount: msg.is_read ? 0 : 1,
                              messages: []
                            };
                          } else {
                            if (!msg.is_read) acc[email].unreadCount++;
                            // Keep track of latest time/message
                            const msgTime = new Date(msg.submitted_at || msg.sent_at || msg.sentAt).getTime();
                            const accTime = new Date(acc[email].lastTime).getTime();
                            if (msgTime > accTime) {
                              acc[email].lastMessage = msg.message;
                              acc[email].lastTime = msg.submitted_at || msg.sent_at || msg.sentAt;
                            }
                          }
                          acc[email].messages.push(msg);
                          return acc;
                        }, {});

                        const sortedConvos = Object.values(conversations).sort((a: any, b: any) =>
                          new Date(b.lastTime).getTime() - new Date(a.lastTime).getTime()
                        );

                        if (sortedConvos.length === 0) {
                          return <div className="p-8 text-center text-slate-400 text-sm">No conversations found</div>;
                        }

                        return sortedConvos.map((convo: any) => (
                          <div
                            key={convo.email}
                            onClick={() => setSelectedConversationEmail(convo.email)}
                            className={`
                              p-4 border-b cursor-pointer transition-all hover:bg-white
                              ${selectedConversationEmail === convo.email ? 'bg-white border-l-4 border-l-blue-600 shadow-sm' : 'border-l-4 border-l-transparent'}
                            `}
                          >
                            <div className="flex justify-between items-start mb-1">
                              <span className="font-bold text-sm text-slate-900 truncate pr-2">{convo.name}</span>
                              <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">
                                {new Date(convo.lastTime).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <p className="text-xs text-slate-500 truncate italic">"{convo.lastMessage}"</p>
                              {convo.unreadCount > 0 && (
                                <Badge className="bg-blue-600 h-4 min-w-[16px] px-1 text-[9px]">{convo.unreadCount}</Badge>
                              )}
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>

                  {/* Right Pane: Chat Window */}
                  <div className="flex-1 flex flex-col bg-white">
                    {selectedConversationEmail ? (() => {
                      const convoMessages = (supportMessages || [])
                        .filter((m: any) => (m.sender_email || m.sender_name) === selectedConversationEmail)
                        .sort((a: any, b: any) => new Date(a.submitted_at || a.sent_at || a.sentAt).getTime() - new Date(b.submitted_at || b.sent_at || b.sentAt).getTime());

                      const latestMessage = convoMessages[convoMessages.length - 1];

                      return (
                        <>
                          {/* Chat Header */}
                          <div className="p-4 border-b flex justify-between items-center bg-slate-50/30">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold">
                                {selectedConversationEmail?.[0].toUpperCase()}
                              </div>
                              <div>
                                <h3 className="font-bold text-slate-900">{convoMessages[0]?.sender_name || 'Supplier'}</h3>
                                <p className="text-[10px] text-slate-500 font-medium">{selectedConversationEmail}</p>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-slate-400 hover:text-red-600"
                                onClick={() => {
                                  if (confirm("Delete this entire conversation?")) {
                                    // Normally we'd have a bulk delete, but let's just delete the messages if needed
                                    toast({ title: "Note", description: "Bulk delete not enabled. Please delete messages individually if required." });
                                  }
                                }}
                              >
                                <Trash2 size={16} />
                              </Button>
                            </div>
                          </div>

                          {/* Message List */}
                          <div
                            ref={adminChatScrollRef}
                            className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#efe7dd] relative scroll-smooth"
                          >
                            <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: "url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')" }} />

                            {convoMessages.map((msg: any) => (
                              <div key={msg.id} className="space-y-4">
                                {/* Supplier Bubble */}
                                <div className="flex justify-start group relative">
                                  <div className="max-w-[75%] bg-white p-3 rounded-2xl rounded-tl-none shadow-sm border border-slate-100">
                                    <p className="text-sm text-slate-800 leading-relaxed font-medium">{msg.message}</p>
                                    <p className="text-[9px] text-slate-400 mt-1 text-right font-bold">
                                      {new Date(msg.submitted_at || msg.sent_at || msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                  </div>
                                  {canEditDelete && (
                                    <button
                                      onClick={() => deleteMessage?.(msg.id)}
                                      className="ml-2 opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 self-center"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  )}
                                </div>

                                {/* Admin Reply Bubble */}
                                {msg.admin_reply && (
                                  <div className="flex justify-end">
                                    <div className="max-w-[75%] bg-[#dcf8c6] p-3 rounded-2xl rounded-tr-none shadow-md border border-green-100">
                                      <p className="text-[9px] font-black text-green-700 uppercase mb-1 tracking-wider">Your Official Response</p>
                                      <p className="text-sm text-slate-800 leading-relaxed">{msg.admin_reply}</p>
                                      <div className="flex items-center justify-end gap-1 mt-1">
                                        <p className="text-[9px] text-slate-500 font-bold">
                                          {new Date(msg.submitted_at || msg.sent_at || msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                        <CheckCheck size={12} className="text-blue-500" />
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>

                          {/* Reply Area */}
                          <div className="p-4 bg-slate-50 border-t">
                            <div className="flex flex-col gap-3">
                              <Label className="text-[10px] font-black uppercase text-blue-800">Reply to this conversation</Label>
                              <div className="flex gap-2">
                                <Textarea
                                  placeholder="Type your official response..."
                                  value={replyTexts[latestMessage.id] || ""}
                                  onChange={(e) => setReplyTexts(prev => ({ ...prev, [latestMessage.id]: e.target.value }))}
                                  className="min-h-[80px] bg-white border-slate-200 focus:ring-blue-500 rounded-xl"
                                />
                                <Button
                                  className="self-end bg-blue-600 hover:bg-blue-700 rounded-xl px-6 h-12"
                                  onClick={() => handleSendReply(latestMessage.id)}
                                >
                                  <Send size={18} className="mr-2" /> Send
                                </Button>
                              </div>
                              <p className="text-[10px] text-slate-400 text-center font-medium">Your reply will be attached to the latest message in this thread.</p>
                            </div>
                          </div>
                        </>
                      );
                    })() : (
                      <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-12 text-center">
                        <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                          <MessageSquare size={40} className="opacity-20" />
                        </div>
                        <h4 className="font-bold text-slate-600 mb-1">Select a Conversation</h4>
                        <p className="text-sm max-w-xs">Click on a user from the list to view the message history and send a reply.</p>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </TabsContent>
          )}

          {/* === SUPPORT TAB === */}
          <TabsContent value="support" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Technical Support</CardTitle>
                <CardDescription>
                  Request new categories or report issues to the software team.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Sender Name Input */}
                <div className="space-y-2">
                  <Label>Your Name <Required /></Label>
                  <Input
                    placeholder="Enter your name..."
                    value={supportSenderName}
                    onChange={(e) => setSupportSenderName(e.target.value)}
                  />
                </div>

                {/* Additional Info Input */}
                <div className="space-y-2">
                  <Label>Additional Information (Optional)</Label>
                  <Textarea
                    placeholder="Any additional context or details..."
                    className="min-h-[80px]"
                    value={supportSenderInfo}
                    onChange={(e) => setSupportSenderInfo(e.target.value)}
                  />
                </div>

                {/* Message Input */}
                <div className="space-y-2">
                  <Label>Message / Request <Required /></Label>
                  <Textarea
                    placeholder="I need a new category for 'Smart Home Devices'..."
                    className="min-h-[150px]"
                    value={supportMsg}
                    onChange={(e) => setSupportMsg(e.target.value)}
                    data-testid="textarea-support-message"
                  />
                </div>

                <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded text-sm text-blue-700 dark:text-blue-300">
                  ✓ This message will be sent to Admin & Software Team
                </div>

                <Button
                  onClick={handleSupportSubmit}
                  data-testid="button-send-support"
                >
                  <MessageSquare className="mr-2 h-4 w-4" /> Send Request
                </Button>

                {/* Display list of messages */}
                {supportMsgs.length === 0 ? (
                  <p className="text-muted-foreground">No messages yet</p>
                ) : (
                  supportMsgs.map((msg: any) => (
                    <Card key={msg.id} className="border-border/50">
                      <CardContent className="pt-6 space-y-3">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <p className="font-semibold">You ({supportSenderName || msg.sender_name})</p>
                            <p className="text-sm text-muted-foreground">
                              {new Date(msg.submitted_at || msg.sent_at || msg.sentAt).toLocaleString(undefined, {
                                dateStyle: 'medium',
                                timeStyle: 'short'
                              })}
                            </p>
                            {msg.info && (
                              <p className="text-xs text-muted-foreground mt-1">
                                <span className="font-semibold">Info: </span>{msg.info}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2 items-start">
                            {!msg.is_read && (
                              <Badge variant="default">Unread</Badge>
                            )}
                            {canEditDelete && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  (async () => {
                                    try {
                                      await deleteMessage?.(msg.id);
                                      toast({
                                        title: "Success",
                                        description: "Message deleted",
                                      });
                                    } catch (err) {
                                      toast({
                                        title: "Error",
                                        description: "Failed to delete message",
                                        variant: "destructive",
                                      });
                                    }
                                  })();
                                }}
                              >
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <p className="text-sm leading-relaxed bg-muted/50 p-3 rounded">
                          {msg.message}
                        </p>
                      </CardContent>
                    </Card>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>

        {/* GENERIC DELETE DIALOG */}
        {genericDelete && (
          <DeleteConfirmationDialog
            isOpen={genericDelete.isOpen}
            onOpenChange={(open) => !open && setGenericDelete(null)}
            onConfirm={confirmGenericDelete}
            itemName={genericDelete.name}
            title={`Remove ${genericDelete.type.charAt(0).toUpperCase() + genericDelete.type.slice(1)} "${genericDelete.name}"?`}
          />
        )}

        {/* DELETE CONFIRMATION MODAL */}
        <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <AlertDialogContent className="max-w-3xl max-h-[95vh] flex flex-col border-none shadow-2xl p-0 overflow-hidden">
            <div className="bg-destructive h-1.5 w-full shrink-0" />

            <AlertDialogHeader className="px-6 pt-6 pb-2 shrink-0">
              <AlertDialogTitle className="flex items-center gap-2 text-destructive text-xl font-bold">
                <div className="p-1.5 bg-destructive/10 rounded-full text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                Confirm Deletion
              </AlertDialogTitle>
            </AlertDialogHeader>

            <div className="flex-1 overflow-y-auto px-6 py-2 custom-scrollbar">
              <div className="space-y-4">
                <div className="text-base text-foreground/90 font-medium py-2">
                  Are you sure you want to delete {deleteData?.type} <span className="font-bold text-destructive underline decoration-destructive/30 underline-offset-4 font-mono tracking-tight px-1.5 py-0.5 bg-destructive/5 rounded">"{deleteData?.name}"</span>?
                </div>

                <div className="bg-muted/30 rounded-xl border border-border/50 overflow-hidden">
                  <div className="p-4">
                    {deleteData?.type === 'category' ? (
                      <div className="space-y-5">
                        {deleteData.impact.subcategories && deleteData.impact.subcategories.filter(s => s && s.trim()).length > 0 && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                                <Layers className="h-3 w-3" /> Subcategories ({deleteData.impact.subcategories.filter(s => s && s.trim()).length})
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {deleteData.impact.subcategories.filter(s => s && s.trim()).slice(0, 50).map((s, i) => (
                                <Badge key={i} variant="outline" className="bg-white hover:bg-white text-xs font-normal py-1 border-border/60 shadow-sm">{s}</Badge>
                              ))}
                              {deleteData.impact.subcategories.filter(s => s && s.trim()).length > 50 && (
                                <Badge variant="outline" className="text-xs font-medium py-1 border-dashed">+ {deleteData.impact.subcategories.filter(s => s && s.trim()).length - 50} more</Badge>
                              )}
                            </div>
                          </div>
                        )}

                        {deleteData.impact.templates && deleteData.impact.templates.filter(t => t && t.trim()).length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                              <Package className="h-3 w-3" /> Material Templates ({deleteData.impact.templates.filter(t => t && t.trim()).length})
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {deleteData.impact.templates.filter(t => t && t.trim()).slice(0, 30).map((t, i) => (
                                <Badge key={i} variant="secondary" className="bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200/50 text-xs font-normal py-1 shadow-sm">{t}</Badge>
                              ))}
                              {deleteData.impact.templates.filter(t => t && t.trim()).length > 30 && (
                                <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-dashed border-amber-200">+ {deleteData.impact.templates.filter(t => t && t.trim()).length - 30} more</Badge>
                              )}
                            </div>
                          </div>
                        )}

                        {deleteData.impact.materials && deleteData.impact.materials.filter(m => m && m.trim()).length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                              <div className="h-1.5 w-1.5 rounded-full bg-orange-500" /> Materials ({deleteData.impact.materials.filter(m => m && m.trim()).length})
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {deleteData.impact.materials.filter(m => m && m.trim()).slice(0, 20).map((m, i) => (
                                <div key={i} className="flex items-center gap-2 p-2 bg-orange-50/50 border border-orange-100/50 rounded-lg text-xs text-orange-800">
                                  <div className="h-1 w-1 rounded-full bg-orange-400 shrink-0" />
                                  <span className="truncate" title={m}>{m}</span>
                                </div>
                              ))}
                            </div>
                            {deleteData.impact.materials.filter(m => m && m.trim()).length > 20 && (
                              <p className="text-[10px] text-muted-foreground italic pl-1">...and {deleteData.impact.materials.filter(m => m && m.trim()).length - 20} other materials will be affected</p>
                            )}
                          </div>
                        )}

                        {deleteData.impact.products && deleteData.impact.products.filter(p => p && p.trim()).length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                              <div className="h-1.5 w-1.5 rounded-full bg-blue-500" /> Products ({deleteData.impact.products.filter(p => p && p.trim()).length})
                            </p>
                            <div className="grid grid-cols-1 gap-2">
                              {deleteData.impact.products.filter(p => p && p.trim()).slice(0, 15).map((p, i) => (
                                <div key={i} className="flex items-center gap-2 p-2.5 bg-blue-50/50 border border-blue-100/50 rounded-lg text-xs text-blue-800 font-medium">
                                  <div className="h-1 w-1 rounded-full bg-blue-400 shrink-0" />
                                  <span className="leading-tight shrink">{p}</span>
                                </div>
                              ))}
                            </div>
                            {deleteData.impact.products.filter(p => p && p.trim()).length > 15 && (
                              <p className="text-[10px] text-muted-foreground italic pl-1">...and {deleteData.impact.products.filter(p => p && p.trim()).length - 15} other products will be affected</p>
                            )}
                          </div>
                        )}

                        {(!deleteData.impact.subcategories?.filter(s => s && s.trim()).length && !deleteData.impact.templates?.filter(t => t && t.trim()).length && !deleteData.impact.materials?.filter(m => m && m.trim()).length && !deleteData.impact.products?.filter(p => p && p.trim()).length) && (
                          <div className="py-8 text-center bg-muted/20 rounded-lg border border-dashed">
                            <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2 opacity-50" />
                            <p className="text-xs text-muted-foreground font-medium italic">No linked items will be affected.</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-5">
                        {deleteData?.impact.materials && deleteData.impact.materials.filter(m => m && m.trim()).length > 0 && (
                          <div className="space-y-3">
                            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                              <div className="h-2 w-2 rounded-full bg-orange-500" />
                              Materials affected ({deleteData.impact.materials.filter(m => m && m.trim()).length})
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {deleteData.impact.materials.filter(m => m && m.trim()).slice(0, 20).map((m, i) => (
                                <div key={i} className="flex items-center gap-2 p-2 bg-orange-50/50 border border-orange-100/50 rounded-lg text-xs text-orange-800 group hover:border-orange-200 transition-colors">
                                  <div className="h-1 w-1 rounded-full bg-orange-400 shrink-0" />
                                  <span className="truncate" title={m}>{m}</span>
                                </div>
                              ))}
                            </div>
                            {deleteData.impact.materials.filter(m => m && m.trim()).length > 20 && (
                              <Badge variant="outline" className="text-[10px] py-0 h-5 border-dashed bg-white text-muted-foreground">+ {deleteData.impact.materials.filter(m => m && m.trim()).length - 20} more materials</Badge>
                            )}

                            {/* Reassign option */}
                            <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-1.5">
                              <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                                ⚡ Reassign these materials to another subcategory?
                              </p>
                              <p className="text-[11px] text-amber-700">
                                If not selected, these materials will become <strong>uncategorized</strong>.
                              </p>
                              <Select
                                value={reassignToSubcategory}
                                onValueChange={setReassignToSubcategory}
                              >
                                <SelectTrigger className="h-8 text-xs bg-white border-amber-300">
                                  <SelectValue placeholder="Leave uncategorized (default)" />
                                </SelectTrigger>
                                <SelectContent className="max-h-52">
                                  <SelectItem value="none" className="text-xs text-muted-foreground italic">Leave uncategorized</SelectItem>
                                  {subCategories
                                    .filter((s: any) => s.id !== deleteData?.id)
                                    .map((s: any) => (
                                      <SelectItem key={s.id} value={s.id} className="text-xs">
                                        {s.name} <span className="text-muted-foreground">({s.category})</span>
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        )}

                        {deleteData?.impact.products && deleteData.impact.products.filter(p => p && p.trim()).length > 0 && (
                          <div className="space-y-3">
                            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                              <div className="h-2 w-2 rounded-full bg-blue-500" />
                              Products affected ({deleteData.impact.products.filter(p => p && p.trim()).length})
                            </p>
                            <div className="grid grid-cols-1 gap-2">
                              {deleteData.impact.products.filter(p => p && p.trim()).slice(0, 15).map((p, i) => (
                                <div key={i} className="flex items-start gap-3 p-3 bg-blue-50/50 border border-blue-100/80 rounded-xl text-[13px] text-blue-900 font-medium leading-snug shadow-sm">
                                  <div className="h-1.5 w-1.5 rounded-full bg-blue-400 shrink-0 mt-1.5" />
                                  <span>{p}</span>
                                </div>
                              ))}
                            </div>
                            {deleteData.impact.products.filter(p => p && p.trim()).length > 15 && (
                              <div className="flex justify-center pt-1">
                                <Badge variant="outline" className="text-[10px] py-0 h-5 border-dashed bg-white text-muted-foreground">
                                  + {deleteData.impact.products.filter(p => p && p.trim()).length - 15} more products will be permanently deleted
                                </Badge>
                              </div>
                            )}
                          </div>
                        )}

                        {(!deleteData?.impact.materials?.filter(m => m && m.trim()).length && !deleteData?.impact.products?.filter(p => p && p.trim()).length) && (
                          <div className="py-8 text-center bg-muted/20 rounded-lg border border-dashed">
                            <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2 opacity-50" />
                            <p className="text-xs text-muted-foreground font-medium italic">No linked materials or products will be affected.</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-3 p-4 bg-red-50 rounded-xl border border-red-100 text-red-900 animate-pulse-slow">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
                  <p className="text-[13px] font-semibold leading-relaxed">
                    CRITICAL WARNING: The selected items listed above will be permanently removed from the system. This action cannot be undone.
                  </p>
                </div>
              </div>
            </div>

            <AlertDialogFooter className="bg-muted/40 px-6 py-4 flex items-center justify-end gap-3 border-t shrink-0">
              <AlertDialogCancel
                onClick={() => setDeleteConfirmOpen(false)}
                className="rounded-lg h-10 px-6 font-medium border-border/60 hover:bg-white transition-all"
              >
                Go Back
              </AlertDialogCancel>
              <Button
                variant="secondary"
                onClick={() => confirmDeleteAction('archive')}
                className="shadow-md rounded-lg h-10 px-8 font-bold transition-all"
              >
                Archive
              </Button>
              <Button
                variant="destructive"
                onClick={() => confirmDeleteAction('trash')}
                className="shadow-lg shadow-destructive/20 rounded-lg h-10 px-8 font-bold transition-all transform hover:scale-[1.02]"
              >
                Trash {deleteData?.type}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      </div >

      {/* Template Selector Modal */}
      <Dialog open={showTemplateSelector} onOpenChange={setShowTemplateSelector}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-blue-600" />
              Select Template Icon
            </DialogTitle>
            <DialogDescription>
              Choose a template icon for <strong>{productForTemplate?.name}</strong>.
              Showing templates for subcategory: <em>{productForTemplate?.subcategory}</em>
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-4">
            {(() => {
              const filteredList = (masterMaterials.filter(tpl =>
                !productForTemplate?.subcategory ||
                (tpl.subcategory && tpl.subcategory.toLowerCase().trim() === productForTemplate.subcategory.toLowerCase().trim())
              ).length > 0
                ? masterMaterials.filter(tpl =>
                  !productForTemplate?.subcategory ||
                  (tpl.subcategory && tpl.subcategory.toLowerCase().trim() === productForTemplate.subcategory.toLowerCase().trim())
                )
                : masterMaterials
              ).filter(tpl => {
                const imgs = parseImages(tpl.image);
                return imgs.length > 0 && !!imgs[0];
              });

              if (filteredList.length === 0) {
                return (
                  <div className="text-center py-12 border-2 border-dashed rounded-xl bg-muted/30">
                    <ImageIcon className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-20" />
                    <p className="text-muted-foreground font-medium">No templates with images found</p>
                    <p className="text-xs text-muted-foreground mt-1">Upload images to your materials first</p>
                  </div>
                );
              }

              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {filteredList.map((template: any) => {
                    const templateImgs = parseImages(template.image);
                    const templateImg = templateImgs.length > 0 ? templateImgs[0] : null;
                    const productImgs = parseImages(productForTemplate?.image);
                    const isSelected = templateImg && productImgs.length > 0 && productImgs[0] === templateImg;

                    return (
                      <div
                        key={template.id}
                        className={`
                          relative group cursor-pointer border rounded-xl p-3 flex flex-col items-center gap-3 transition-all
                          ${isSelected ? 'border-blue-500 bg-blue-50 shadow-md ring-2 ring-blue-500/20' : 'hover:border-blue-400 hover:bg-muted/50'}
                        `}
                        onClick={() => {
                          if (templateImg) {
                            handleUpdateProductImage(productForTemplate.id, templateImg);
                            setShowTemplateSelector(false);
                          }
                        }}
                      >
                        <div className="w-16 h-16 rounded-lg bg-white border flex items-center justify-center overflow-hidden shrink-0 shadow-sm group-hover:shadow transition-shadow">
                          <img src={templateImg!} alt="" className="max-w-full max-h-full object-contain p-1" />
                        </div>
                        <div className="text-center">
                          <p className="text-xs font-semibold line-clamp-2 leading-tight h-8 flex items-center justify-center">{template.name}</p>
                          <p className="text-[10px] text-muted-foreground mt-1 font-mono uppercase tracking-tighter opacity-70">{template.code}</p>
                        </div>

                        {isSelected && (
                          <div className="absolute -top-2 -right-2 bg-blue-500 text-white rounded-full p-1 shadow-lg ring-2 ring-white">
                            <Check className="h-3 w-3" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setShowTemplateSelector(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedPreviewImage} onOpenChange={() => setSelectedPreviewImage(null)}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden bg-transparent border-none">
          {selectedPreviewImage && (
            <img src={selectedPreviewImage} alt="Full Preview" className="w-full h-auto max-h-[90vh] object-contain" />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showDuplicateDialog} onOpenChange={setShowDuplicateDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="w-5 h-5" />
              Duplicate Materials Detected
            </DialogTitle>
            <DialogDescription className="flex items-center justify-between">
              <span>The following groups have exactly the same fields. The oldest entry will be kept.</span>
              {duplicateGroups.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <Checkbox
                    id="select-all-duplicates"
                    checked={selectedDuplicateGroups.size === duplicateGroups.length}
                    onCheckedChange={(checked) => {
                      if (checked) setSelectedDuplicateGroups(new Set(duplicateGroups.map((_, i) => i)));
                      else setSelectedDuplicateGroups(new Set());
                    }}
                  />
                  <Label htmlFor="select-all-duplicates" className="cursor-pointer">Select All</Label>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto my-4 border rounded-md">
            {duplicateGroups.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-2" />
                <p className="font-bold">No duplicates found!</p>
                <p className="text-sm">Your material library is clean.</p>
              </div>
            ) : (
              <div className="divide-y">
                {duplicateGroups.map((group, idx) => (
                  <div key={idx} className={cn(
                    "p-4 bg-white hover:bg-slate-50 flex gap-3",
                    !selectedDuplicateGroups.has(idx) && "opacity-60"
                  )}>
                    <div className="pt-1">
                      <Checkbox
                        checked={selectedDuplicateGroups.has(idx)}
                        onCheckedChange={(checked) => {
                          const next = new Set(selectedDuplicateGroups);
                          if (checked) next.add(idx);
                          else next.delete(idx);
                          setSelectedDuplicateGroups(next);
                        }}
                      />
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-bold text-slate-800 text-sm">{group.name}</div>
                        <div className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-bold">
                          {group.duplicate_count} Copies Found
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-500">
                        <div><span className="font-semibold text-slate-700">Shop:</span> {shops.find(s => s.id === group.shop_id)?.name || group.shop_id}</div>
                        <div><span className="font-semibold text-slate-700">Rate:</span> ₹{group.rate} / {group.unit}</div>
                        <div><span className="font-semibold text-slate-700">Brand:</span> {group.brandname || 'None'}</div>
                        <div><span className="font-semibold text-slate-700">Model:</span> {group.modelnumber || 'None'}</div>
                        <div className="col-span-2 flex items-center gap-2 mt-1">
                          <span className="italic">First entry: {new Date(group.creation_dates[0]).toLocaleDateString()}</span>
                          <span className="text-[10px] bg-green-50 text-green-700 px-1.5 rounded border border-green-100 font-medium">This record will be kept</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDuplicateDialog(false)}>
              Close
            </Button>
            {duplicateGroups.length > 0 && (
              <Button
                variant="destructive"
                className="gap-2"
                onClick={handleCleanupDuplicates}
                disabled={cleaningDuplicates || selectedDuplicateGroups.size === 0}
              >
                {cleaningDuplicates ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                Delete {duplicateGroups.filter((_, i) => selectedDuplicateGroups.has(i)).reduce((acc, g) => acc + (g.duplicate_count - 1), 0)} Duplicates
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
