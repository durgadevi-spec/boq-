import { useEffect, useState, useMemo } from "react";
import { format, differenceInDays } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, Plus, ArrowRight, ArrowLeft, Trash2, Edit, Check, XCircle, Layers, Copy, GripVertical, TrendingUp, TrendingDown, AlertTriangle, Package, Lock, Clock } from "lucide-react";
import { Reorder } from "framer-motion";
import { Textarea } from "@/components/ui/textarea";
import * as XLSX from "xlsx";
import apiFetch from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/layout/Layout";
import { SupplierLayout } from "@/components/layout/SupplierLayout";
import { useAuth } from "@/lib/auth-context";
import { useLocation } from "wouter";
import { computeBoq, UnitType } from "@/lib/boqCalc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AllProductsSplitView } from "@/components/admin/AllProductsSplitView";
import { fuzzySearch } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DeleteConfirmationDialog } from "@/components/ui/DeleteConfirmationDialog";

type Product = { id: string; name: string; subcategory: string; created_at: string; created_by?: string; image?: string; has_price_updates?: boolean; is_approved?: boolean };
type Material = { id: string; name: string; unit: string; rate: number; category: string; subcategory: string; description?: string; shop_name?: string; shop_id?: string; shopId?: string; code?: string; hsn_code?: string; sac_code?: string; technicalspecification?: string; technicalSpecification?: string; created_at?: string; brandName?: string; brand_name?: string; modelNumber?: string; model_number?: string; is_project_pricing?: boolean };
type SelectedMaterial = Material & { qty: number; baseQty: number; wastagePct?: number; amount: number; rate: number; supplyRate: number; installRate: number; location: string; applyWastage: boolean; applyRounding: boolean; freezeAndEdit?: boolean };

const ALL = "__ALL__";

const LabeledField = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="space-y-2">
        <label className="text-xs font-bold uppercase text-muted-foreground">{label}</label>
        {children}
    </div>
);

const EmptyState = ({ icon: Icon, title, subtitle, className = "" }: { icon: any; title: string; subtitle?: string; className?: string }) => (
    <div className={`flex flex-col items-center justify-center text-center space-y-3 p-6 ${className}`}>
        <Icon className="h-10 w-10 text-muted-foreground opacity-20" />
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {subtitle && <p className="text-[10px] text-muted-foreground/60">{subtitle}</p>}
    </div>
);

const parseImages = (imageField: string | null | undefined): string[] => {
    if (!imageField) return [];
    try {
        if (imageField.startsWith('[')) return JSON.parse(imageField);
        return [imageField];
    } catch (e) {
        return [imageField];
    }
};

export default function ManageProduct() {
    const { user } = useAuth();
    const isSupplier = user?.role === "supplier";
    const [location] = useLocation();
    const [step, setStep] = useState(1);
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [configName, setConfigName] = useState("");
    const [selectedCategory, setSelectedCategory] = useState(ALL);
    const [selectedSubcategory, setSelectedSubcategory] = useState(ALL);
    const [selectedMaterials, setSelectedMaterials] = useState<Material[]>([]);
    const [configMaterials, setConfigMaterials] = useState<SelectedMaterial[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [previousConfigs, setPreviousConfigs] = useState<any[]>([]);
    const [productApprovals, setProductApprovals] = useState<any[]>([]);
    const [rejectedConfigs, setRejectedConfigs] = useState<any[]>([]);
    const [pendingConfigs, setPendingConfigs] = useState<any[]>([]);
    const [draftConfigs, setDraftConfigs] = useState<any[]>([]);
    const [isLoadingConfigs, setIsLoadingConfigs] = useState(false);
    const [productSearch, setProductSearch] = useState("");
    const [materialSearch, setMaterialSearch] = useState("");
    const [projectPricingFilter, setProjectPricingFilter] = useState(false);
    const [requiredUnitType, setRequiredUnitType] = useState<UnitType>("Sqft");
    const [baseRequiredQty, setBaseRequiredQty] = useState(100);
    const [wastagePctDefault, setWastagePctDefault] = useState(5);
    const [dimA, setDimA] = useState<number | undefined>();
    const [dimB, setDimB] = useState<number | undefined>();
    const [dimC, setDimC] = useState<number | undefined>();
    const [productDescription, setProductDescription] = useState("");
    const [compactMode, setCompactMode] = useState(false);
    const [step3MaterialSearch, setStep3MaterialSearch] = useState("");
    const [cloneSearch, setCloneSearch] = useState("");
    const [isCloneDialogOpen, setIsCloneDialogOpen] = useState(false);
    const [targetProductForClone, setTargetProductForClone] = useState<Product | null>(null);
    const [ignoredMismatches, setIgnoredMismatches] = useState<Set<string>>(new Set());
    const [isUpdatingRates, setIsUpdatingRates] = useState(false);
    const [genericDelete, setGenericDelete] = useState<{ isOpen: boolean, id: number, name: string } | null>(null);
    const [showTemplateSelector, setShowTemplateSelector] = useState(false);
    const [productForTemplate, setProductForTemplate] = useState<Product | null>(null);
    const [templates, setTemplates] = useState<any[]>([]);
    const [supplierShops, setSupplierShops] = useState<any[]>([]);
    const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
    const [showAllProducts, setShowAllProducts] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [loadedConfig, setLoadedConfig] = useState<any | null>(null);
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [dateSort, setDateSort] = useState<"newest" | "oldest">("newest");
    const [statusFilter, setStatusFilter] = useState<string>("All");

    // Check if the current configName has an approved version (in step11 configs or product_approvals)
    const configNameIsApproved = useMemo(() => {
        if (!configName) return false;
        const approvedInStep11 = previousConfigs.some(c =>
            c.product.config_name === configName && c.product.status === "approved"
        );
        const approvedInApprovals = productApprovals.some((a: any) =>
            a.config_name === configName && a.status === "approved"
        );
        return approvedInStep11 || approvedInApprovals;
    }, [configName, previousConfigs, productApprovals]);

    // Check if user has been granted edit access for this config_name (admin-approved draft in product_approvals)
    const hasEditAccess = useMemo(() => {
        if (!configName) return false;
        return draftConfigs.some((d: any) => d.config_name === configName);
    }, [configName, draftConfigs]);

    const isReadOnly = loadedConfig?.status === "approved" || loadedConfig?.status === "pending" || isSubmitted || (configNameIsApproved && !hasEditAccess);
    const { toast } = useToast();

    const searchParams = useMemo(() => new URLSearchParams(location.split('?')[1] || ""), [location]);
    const approvalIdParam = searchParams.get("approvalId");
    const productIdParam = searchParams.get("productId");

    const resetSelection = () => {
        setConfigName(""); setSelectedCategory(""); setSelectedSubcategory("");
        setSelectedMaterials([]); setConfigMaterials([]);
        setRequiredUnitType("Sqft"); setBaseRequiredQty(100); setWastagePctDefault(5);
        setDimA(undefined); setDimB(undefined); setDimC(undefined); setProductDescription("");
        setLoadedConfig(null);
        setIsSubmitted(false);
    };

    const fetchPreviousConfigs = async (productId: string) => {
        setIsLoadingConfigs(true);
        try {
            const [pRes, aRes] = await Promise.all([apiFetch(`/api/step11-products/${productId}`), apiFetch(`/api/product-approvals`)]);
            if (pRes.ok) { const d = await pRes.json(); setPreviousConfigs(d.configurations || []); }
            if (aRes.ok) {
                const d = await aRes.json();
                const pa = (d.approvals || []).filter((a: any) => String(a.product_id) === String(productId));
                setProductApprovals(pa);
                setRejectedConfigs(pa.filter((a: any) => a.status === "rejected"));
                setPendingConfigs(pa.filter((a: any) => a.status === "pending"));
                setDraftConfigs(pa.filter((a: any) => a.status === "draft"));
            }
        } catch (e) { console.error(e); } finally { setIsLoadingConfigs(false); }
    };

    useEffect(() => {
        if (dimA !== undefined || dimB !== undefined || dimC !== undefined)
            setBaseRequiredQty((Number(dimA) || 1) * (Number(dimB) || 1) * (Number(dimC) || 1));
    }, [dimA, dimB, dimC]);

    useEffect(() => {
        if (selectedProduct) fetchPreviousConfigs(selectedProduct.id);
        else setPreviousConfigs([]);
    }, [selectedProduct?.id]);

    const { data: productsData, isLoading: loadingProducts } = useQuery({
        queryKey: ["/api/products"],
        queryFn: async () => {
            const res = await apiFetch("/api/products");
            if (!res.ok) throw new Error("Failed to fetch products");
            const d = await res.json();
            return ((d.products || []) as Product[]).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        },
    });

    useEffect(() => {
        if (approvalIdParam && productIdParam && productsData && !selectedProduct) {
            const product = (productsData as Product[]).find((p: any) => p.id === productIdParam);
            if (product) {
                setSelectedProduct(product);
                loadApprovalConfig({ id: approvalIdParam, config_name: "Loading..." }, "Pending");
                setStep(3);
                // Clear the URL to avoid reloading on every re-render
                window.history.replaceState({}, '', '/admin/manage-product');
            }
        }
    }, [approvalIdParam, productIdParam, productsData, selectedProduct]);
    useEffect(() => {
        const fetchShops = async () => {
            if (!isSupplier) return;
            try {
                const shopRes = await apiFetch("/api/supplier/my-shops");
                if (shopRes.ok) {
                    const shopData = await shopRes.json();
                    setSupplierShops(shopData.shops || []);
                }
            } catch (e) {
                console.error("Failed to fetch shops:", e);
            }
        };
        fetchShops();

        const fetchTemplates = async () => {
            try {
                const res = await apiFetch("/api/material-templates");
                if (res.ok) {
                    const d = await res.json();
                    setTemplates(d.templates || []);
                }
            } catch (error) {
                console.error("Failed to load templates:", error);
            }
        };
        fetchTemplates();
    }, [isSupplier]);

    const updateProductImage = async (productId: string, imageUrl: string) => {
        try {
            const product = (productsData as Product[])?.find(p => p.id === productId);
            if (!product) return;

            const res = await apiFetch(`/api/products/${productId}`, {
                method: 'PUT',
                body: JSON.stringify({
                    id: productId,
                    name: product.name,
                    subcategory: product.subcategory,
                    image: JSON.stringify([imageUrl])
                }),
            });

            if (res.ok) {
                toast({ title: "Success", description: "Product icon updated successfully" });
                // Re-fetch products or update local state if possible
                // Since products are managed by react-query, we can invalidate it
            }
        } catch (error) {
            console.error('Update product image error:', error);
            toast({ title: "Error", description: "Failed to update product icon", variant: "destructive" });
        }
    };

    const { data: allApprovals } = useQuery({
        queryKey: ["/api/product-approvals-all"],
        queryFn: async () => {
            const res = await apiFetch("/api/product-approvals");
            if (!res.ok) return [];
            const d = await res.json();
            return d.approvals || [];
        }
    });

    const { data: approvedConfigsData } = useQuery({
        queryKey: ["/api/product-approvals-approved"],
        queryFn: async () => {
            const res = await apiFetch("/api/product-approvals?status=approved");
            if (!res.ok) return [];
            const d = await res.json();
            return d.approvals || [];
        }
    });



    const pendingProductIds = useMemo(() => {
        if (!allApprovals) return new Set();
        return new Set((allApprovals as any[]).filter(a => a.status === "pending").map(a => a.product_id));
    }, [allApprovals]);

    const rejectedProductIds = useMemo(() => {
        if (!allApprovals) return new Set();
        return new Set((allApprovals as any[]).filter(a => a.status === "rejected").map(a => a.product_id));
    }, [allApprovals]);

    const filteredProducts = useMemo(() => {
        if (!productsData) return [];
        let list = productsData.filter(p => fuzzySearch(productSearch, p.name || ""));

        if (statusFilter !== "All") {
            list = list.filter(p => {
                const hasPendingApproval = (allApprovals as any[] || []).some(a => a.product_id === p.id && a.status === "pending");
                const isRejected = (allApprovals as any[] || []).some(a => a.product_id === p.id && a.status === "rejected");
                const isAppr = p.is_approved || (allApprovals as any[] || []).some(a => a.product_id === p.id && a.status === "approved");
                const isDraft = !isAppr && !hasPendingApproval && !isRejected;

                if (statusFilter === "Draft") return isDraft;
                if (statusFilter === "Pending Approval") return hasPendingApproval && !isAppr;
                if (statusFilter === "Revision Pending") return hasPendingApproval && isAppr;
                if (statusFilter === "Approved") return isAppr && !hasPendingApproval;
                if (statusFilter === "Rejected") return isRejected;
                return true;
            });
        }

        list.sort((a, b) => {
            const dateA = new Date(a.created_at || 0).getTime();
            const dateB = new Date(b.created_at || 0).getTime();
            return dateSort === "newest" ? dateB - dateA : dateA - dateB;
        });

        return list;
    }, [productsData, productSearch, statusFilter, dateSort, allApprovals]);

    const approvedProducts = useMemo(() => {
        return filteredProducts.filter(p => p.is_approved);
    }, [filteredProducts]);

    const allApprovedConfigs = useMemo(() => {
        if (!approvedConfigsData) return [];
        return (approvedConfigsData as any[]).filter(a => a.status === "approved");
    }, [approvedConfigsData]);

    const filteredCloneConfigs = useMemo(() => {
        return allApprovedConfigs.filter(c =>
            fuzzySearch(cloneSearch, [c.product_name || "", c.config_name || ""])
        );
    }, [allApprovedConfigs, cloneSearch]);

    const needsWorkProducts = useMemo(() => {
        return filteredProducts.filter(p => !p.is_approved);
    }, [filteredProducts]);

    const { data: categoriesData } = useQuery({
        queryKey: ["/api/material-categories"],
        queryFn: async () => {
            const res = await apiFetch("/api/material-categories");
            if (!res.ok) throw new Error();
            const d = await res.json();
            return ((d.categories || []) as string[]).sort((a, b) => a.localeCompare(b));
        },
        enabled: step === 2,
    });

    const { data: subcategoriesData } = useQuery({
        queryKey: ["/api/material-subcategories", selectedCategory],
        queryFn: async () => {
            const res = await apiFetch(`/api/material-subcategories/${selectedCategory}`);
            if (!res.ok) throw new Error();
            const d = await res.json();
            return ((d.subcategories || []) as string[]).sort((a, b) => a.localeCompare(b));
        },
        enabled: step === 2 && !!selectedCategory && selectedCategory !== ALL,
    });

    const { data: materialsData, isLoading: loadingMaterials } = useQuery({
        queryKey: ["/api/materials"],
        queryFn: async () => {
            const res = await apiFetch("/api/materials");
            if (!res.ok) throw new Error();
            const d = await res.json();
            return ((d.materials || []) as Material[]).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        },
        staleTime: 0,
        refetchOnMount: "always",
    });

    const rawMaterials = materialsData || [];
    const uniqueMaterials = Array.from(new Map(
        rawMaterials
            .filter(m => {
                if (!isSupplier) return true;
                return supplierShops.some(s => String(s.id) === String(m.shop_id || m.shopId) || (s.name && s.name === m.shop_name));
            })
            .map(m => [(m.id || Math.random()).toString(), m])
    ).values());

    const availableUnitTypes = useMemo(() => {
        const defaults = ["Sqft", "Sqmt", "Length", "LS", "RFT", "RMT"];
        const finalUnits = [...defaults];
        (materialsData || []).map(m => m.unit?.trim()).filter(Boolean).forEach((u: string) => {
            const lowerU = u.toLowerCase();
            const isSqftVariant = lowerU === "sft" || lowerU === "sqft";
            const hasSqftVariant = finalUnits.some(fu => { const lfu = fu.toLowerCase(); return lfu === "sft" || lfu === "sqft"; });
            if (isSqftVariant && hasSqftVariant) return;
            if (!finalUnits.some(fu => fu.toLowerCase() === lowerU)) finalUnits.push(u);
        });
        return finalUnits.sort();
    }, [materialsData]);

    const filteredMaterials = uniqueMaterials.filter(m => {
        if (materialSearch) {
            if (!fuzzySearch(materialSearch, [m.name || "", m.code || ""])) return false;
        }
        const inc = (field: string | undefined | null, val: string) => {
            if (!val || val === ALL) return true;
            if (!field) return false;
            return field === val || field.split(",").map(s => s.trim().toLowerCase()).includes(val.trim().toLowerCase());
        };
        const categoryMatch = inc(m.category, selectedCategory) && inc(m.subcategory, selectedSubcategory);
        if (!categoryMatch) return false;

        if (projectPricingFilter) {
            return m.is_project_pricing === true;
        }

        return true;
    });

    const nextStep = () => {
        if (step === 1 && !selectedProduct) { toast({ title: "Product Required", description: "Please select a product.", variant: "destructive" }); return; }
        if (step === 2 && selectedMaterials.length === 0) { toast({ title: "Selection Required", description: "Select at least one material.", variant: "destructive" }); return; }
        if (step === 2) {
            const existingMap = new Map(configMaterials.map(m => [m.id, m]));
            setConfigMaterials(selectedMaterials.map(m => {
                const ex = existingMap.get(m.id);
                if (ex) return ex;
                const rate = Number(m.rate) || 0;
                return { ...m, qty: 1, baseQty: 1, wastagePct: undefined, amount: rate, rate, supplyRate: rate, installRate: 0, location: m.technicalspecification || m.name || "", description: m.technicalspecification || m.name || "", applyWastage: true, applyRounding: true, freezeAndEdit: false, shop_id: m.shop_id || m.shopId, shopId: m.shop_id || m.shopId };
            }));
        }
        setStep(step + 1);
    };

    const buildPayloadItems = () => boqResults.computed.map(m => ({
        materialId: m.id, materialName: m.name, unit: m.unit, qty: m.roundOffQty, rate: m.rate,
        supplyRate: m.supplyRate, installRate: m.installRate, location: m.location, amount: m.lineTotal,
        baseQty: m.baseQty, wastagePct: m.wastagePct ?? null, applyWastage: m.applyWastage, applyRounding: m.applyRounding, shop_name: m.shop_name, shop_id: m.shop_id || m.shopId, freeze_and_edit: m.freezeAndEdit,
        is_project_pricing: m.is_project_pricing
    }));

    const buildPayload = (extra?: object) => ({
        productId: selectedProduct!.id, productName: selectedProduct!.name,
        configName: configName || "Latest Draft", categoryId: selectedCategory, subcategoryId: selectedSubcategory,
        totalCost, requiredUnitType, baseRequiredQty, wastagePctDefault, dimA, dimB, dimC,
        description: productDescription, items: buildPayloadItems(), ...extra
    });

    const handleSave = async () => {
        if (!selectedProduct) return;
        setIsSaving(true);
        try {
            const configN = configName || `${selectedProduct.name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const res = await apiFetch("/api/step11-products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...buildPayload(), configName: configN }) });
            if (!res.ok) throw new Error("Failed to save");
            toast({ title: "Success", description: "Product configuration saved permanently." });
            setStep(1); setSelectedProduct(null); setConfigName(""); setSelectedMaterials([]); setConfigMaterials([]);
        } catch (e: any) { toast({ title: "Error", description: e.message || "Failed to save", variant: "destructive" }); }
        finally { setIsSaving(false); }
    };

    const handleSaveInPlace = async () => {
        if (!selectedProduct) return;
        setIsSaving(true);
        try {
            const res = await apiFetch("/api/product-approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildPayload()) });
            if (!res.ok) throw new Error("Failed to submit");
            toast({ title: "Submitted for Approval", description: `"${selectedProduct.name}" submitted for approval.` });
            setIsSubmitted(true);
        } catch (e: any) { toast({ title: "Error", description: e.message || "Failed to submit", variant: "destructive" }); }
        finally { setIsSaving(false); }
    };

    const handleSaveDraft = async () => {
        if (!selectedProduct) return;
        setIsSaving(true);
        try {
            const res = await apiFetch("/api/product-step3-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildPayload()) });
            if (!res.ok) throw new Error("Failed to save draft");
            toast({ title: "Draft Saved", description: "Your configuration progress has been saved." });
        } catch (e: any) { toast({ title: "Error", description: e.message || "Failed to save draft", variant: "destructive" }); }
        finally { setIsSaving(false); }
    };

    const mapItems = (items: any[]) => items.map((item: any) => ({
        id: item.material_id, name: item.material_name, unit: item.unit,
        qty: Number(item.qty || 0), baseQty: Number(item.base_qty ?? item.qty ?? 0),
        wastagePct: item.wastage_pct != null ? Number(item.wastage_pct) : undefined,
        rate: Number(item.rate), supplyRate: Number(item.supply_rate != null ? item.supply_rate : item.rate || 0),
        install_rate: Number(item.install_rate || 0), installRate: Number(item.install_rate || 0),
        location: item.location || "Main Area", amount: Number(item.amount),
        rejection_reason: item.rejection_reason || null,
        applyWastage: item.apply_wastage !== undefined ? Boolean(item.apply_wastage) : (item.applyWastage !== undefined ? Boolean(item.applyWastage) : true),
        applyRounding: item.apply_rounding !== undefined ? Boolean(item.apply_rounding) : (item.applyRounding !== undefined ? Boolean(item.applyRounding) : true),
        freezeAndEdit: (item.freeze_and_edit === true || item.freeze_and_edit === "true" || item.freeze_and_edit === 1 || item.freezeAndEdit === true || item.freezeAndEdit === "true" || item.freezeAndEdit === 1),
        shop_name: item.shop_name, shop_id: item.shop_id || item.shopId, shopId: item.shop_id || item.shopId, category: "", subcategory: "",
        is_project_pricing: item.is_project_pricing
    }));

    const applyConfig = (config: any, items: any[], src: string) => {
        setConfigName(config.config_name || ""); setSelectedCategory(config.category_id || ""); setSelectedSubcategory(config.subcategory_id || "");
        setRequiredUnitType(config.required_unit_type || "Sqft"); setBaseRequiredQty(Number(config.base_required_qty || 100));
        setWastagePctDefault(Number(config.wastage_pct_default || 0));
        setDimA(config.dim_a ? Number(config.dim_a) : undefined); setDimB(config.dim_b ? Number(config.dim_b) : undefined); setDimC(config.dim_c ? Number(config.dim_c) : undefined);
        setProductDescription(config.description || "");
        const mapped = mapItems(items);
        setSelectedMaterials(mapped); setConfigMaterials(mapped);
        setIgnoredMismatches(new Set());
        setLoadedConfig(config);
        setIsSubmitted(false);
        toast({ title: "Configuration Loaded", description: src });
    };

    const loadExistingConfig = async (product: Product) => {
        try {
            // Fetch step11 configurations and approvals first to check for approved configs
            const [s3Res, step11Res, approvalsRes] = await Promise.all([
                apiFetch(`/api/product-step3-config/${product.id}`),
                apiFetch(`/api/step11-products/${product.id}`),
                apiFetch(`/api/product-approvals`)
            ]);

            let step11Configs: any[] = [];
            if (step11Res.ok) {
                const d = await step11Res.json();
                step11Configs = d.configurations || [];
            }

            // Build a set of approved config_names for this product
            const approvedConfigNames = new Set<string>();
            step11Configs.filter((c: any) => c.product.status === "approved").forEach((c: any) => {
                if (c.product.config_name) approvedConfigNames.add(c.product.config_name);
            });
            if (approvalsRes.ok) {
                const d = await approvalsRes.json();
                (d.approvals || []).filter((a: any) => String(a.product_id) === String(product.id) && a.status === "approved")
                    .forEach((a: any) => { if (a.config_name) approvedConfigNames.add(a.config_name); });
            }

            // Try Step 3 draft — but skip if its config_name matches an approved config
            if (s3Res.ok) {
                const d = await s3Res.json();
                if (d.items?.length > 0) {
                    const s3ConfigName = d.config?.config_name || "";
                    if (!s3ConfigName || !approvedConfigNames.has(s3ConfigName)) {
                        applyConfig(d.config, d.items, `Loaded Step 3 config for ${product.name}.`);
                        return;
                    }
                    // Step 3 draft matches approved config — skip it, fall through to load approved
                }
            }

            // Try Step 11 configs — prefer approved, skip drafts that match approved
            if (step11Configs.length > 0) {
                // First try to load the approved config
                const approvedConfig = step11Configs.find((c: any) => c.product.status === "approved");
                if (approvedConfig) {
                    applyConfig(approvedConfig.product, approvedConfig.items, `Loaded approved config "${approvedConfig.product.config_name || "Unnamed"}" for ${product.name}.`);
                    return;
                }
                // Then try drafts that DON'T match an approved name
                const safeDraft = step11Configs.find((c: any) => {
                    if (c.product.status !== "draft") return false;
                    const cn = c.product.config_name || "";
                    return !cn || !approvedConfigNames.has(cn);
                });
                if (safeDraft) {
                    applyConfig(safeDraft.product, safeDraft.items, `Loaded config "${safeDraft.product.config_name || "Unnamed"}" for ${product.name}.`);
                    return;
                }
            }

            // Auto-load pending config if no other config exists
            let pending = null;
            if (allApprovals) {
                pending = (allApprovals as any[]).find((a: any) => a.product_id === product.id && a.status === "pending");
            } else {
                const pRes = await apiFetch(`/api/product-approvals`);
                if (pRes.ok) {
                    const d = await pRes.json();
                    pending = (d.approvals || []).find((a: any) => a.product_id === product.id && a.status === "pending");
                }
            }
            if (pending) {
                loadApprovalConfig(pending, "Pending");
            }
        } catch (e) { console.error(e); }
    };

    const loadSpecificConfig = async (configData: any) => {
        try { applyConfig(configData.product, configData.items, `Config "${configData.product.config_name || "Unnamed"}" loaded.`); }
        catch (e) { console.error(e); toast({ title: "Error", description: "Failed to load config.", variant: "destructive" }); }
    };

    const loadApprovalConfig = async (config: any, statusLabel: string = "Rejected") => {
        try {
            setIsLoadingConfigs(true);
            const res = await apiFetch(`/api/product-approvals/${config.id}`);
            if (res.ok) { const d = await res.json(); applyConfig(d.approval, d.items, `${statusLabel} config "${config.config_name}" loaded for viewing/editing.`); }
            else throw new Error("Failed to load details");
        } catch (e) { console.error(e); toast({ title: "Error", description: `Failed to load ${statusLabel.toLowerCase()} configuration.`, variant: "destructive" }); }
        finally { setIsLoadingConfigs(false); }
    };

    const handleCloneConfig = async (config: any) => {
        try {
            setIsLoadingConfigs(true);
            const res = await apiFetch(`/api/product-approvals/${config.id}`);
            if (res.ok) {
                const d = await res.json();

                // Set the target product as selected
                const target = targetProductForClone || (productsData || []).find((p: any) => p.id === config.product_id);
                if (target) {
                    setSelectedProduct(target);
                    // Load the config into the target product
                    applyConfig(d.approval, d.items, `Cloned configuration from "${config.product_name}" to "${target.name}"`);
                    // Override loadedConfig to null so clone is editable (draft state)
                    setLoadedConfig(null);
                }

                setIsCloneDialogOpen(false);
                setTargetProductForClone(null);
                setStep(3); // Go to detail step after cloning
            } else {
                throw new Error("Failed to load details");
            }
        } catch (e) {
            console.error(e);
            toast({ title: "Error", description: "Failed to clone configuration.", variant: "destructive" });
        } finally {
            setIsLoadingConfigs(false);
        }
    };

    const openCloneDialog = (e: React.MouseEvent, product: Product) => {
        e.stopPropagation();
        setTargetProductForClone(product);
        setIsCloneDialogOpen(true);
    };

    const confirmDeleteConfig = async (action?: 'archive' | 'trash') => {
        if (!genericDelete || !action) return;
        const configId = genericDelete.id;
        try {
            const res = await apiFetch(`/api/step11-products/config/${configId}?action=${action}`, { method: "DELETE" });
            if (res.ok) { setPreviousConfigs(prev => prev.filter(c => c.product.id !== configId)); toast({ title: "Deleted", description: `Configuration moved to ${action}.` }); }
            else throw new Error();
        } catch { toast({ title: "Error", description: "Failed to delete.", variant: "destructive" }); }
        setGenericDelete(null);
    };

    const requestDeleteConfig = (configId: number) => {
        setGenericDelete({ isOpen: true, id: configId, name: 'Configuration' });
    };

    const toggleMaterial = (m: Material) => {
        if (isReadOnly) return;
        setSelectedMaterials(prev => prev.find(x => x.id === m.id) ? prev.filter(x => x.id !== m.id) : [...prev, m]);
    };

    const updateConfig = (id: string | number, field: keyof SelectedMaterial, value: any) => {
        if (isReadOnly) return;
        setConfigMaterials(prev => prev.map(m => {
            if (String(m.id) !== String(id)) return m;
            const u = { ...m, [field]: value };
            if (field === "supplyRate" || field === "installRate") u.rate = (Number(u.supplyRate) || 0) + (Number(u.installRate) || 0);
            return u;
        }));
    };

    const removeConfigMaterial = (id: string | number) => {
        if (isReadOnly) return;
        const sid = String(id);
        setSelectedMaterials(prev => prev.filter(m => String(m.id) !== sid));
        setConfigMaterials(prev => prev.filter(m => String(m.id) !== sid));
    };

    useEffect(() => {
        if (step === 2) {
            const existingMap = new Map(configMaterials.map(m => [String(m.id), m]));
            setConfigMaterials(selectedMaterials.map(m => {
                const ex = existingMap.get(String(m.id));
                if (ex) return ex;
                const rate = Number(m.rate) || 0;
                const sm = m as any;
                return {
                    ...m,
                    qty: sm.qty ?? 1,
                    baseQty: sm.baseQty ?? 1,
                    wastagePct: sm.wastagePct,
                    amount: sm.amount ?? rate,
                    rate,
                    supplyRate: sm.supplyRate ?? rate,
                    installRate: sm.installRate ?? 0,
                    location: sm.location || sm.technicalspecification || sm.description || m.description || m.name || "",
                    description: sm.description || sm.technicalspecification || m.description || m.name || "",
                    applyWastage: (sm.applyWastage === true || sm.apply_wastage === true || sm.applyWastage === undefined),
                    applyRounding: (sm.applyRounding === true || sm.apply_rounding === true || sm.applyRounding === undefined),
                    freezeAndEdit: (sm.freezeAndEdit === true || sm.freeze_and_edit === true),
                    shop_id: m.shop_id || m.shopId,
                    shopId: m.shop_id || m.shopId
                } as SelectedMaterial;
            }));
        }
    }, [selectedMaterials, step]);

    const boqResults = useMemo(() => computeBoq({ requiredUnitType, baseRequiredQty, wastagePctDefault }, configMaterials, baseRequiredQty), [requiredUnitType, baseRequiredQty, wastagePctDefault, configMaterials]);
    const totalCost = boqResults.grandTotal;

    // Build a map from materialId -> latest library rate for fast lookup
    const materialsById = useMemo(() => {
        const map: Record<string, Material> = {};
        (materialsData || []).forEach(m => { map[String(m.id)] = m; });
        return map;
    }, [materialsData]);

    const getConfigCurrentTotal = (configWrapper: any) => {
        if (!configWrapper.items || !configWrapper.product || Object.keys(materialsById).length === 0) return null;

        const mappedItems = mapItems(configWrapper.items);
        const updatedItems = mappedItems.map((m: any) => {
            const latest = materialsById[String(m.id)];
            if (latest) {
                return { ...m, supplyRate: latest.rate, rate: latest.rate + (m.installRate || 0) };
            }
            return m;
        });

        const basis = {
            requiredUnitType: configWrapper.product.required_unit_type || "Sqft",
            baseRequiredQty: Number(configWrapper.product.base_required_qty || 100),
            wastagePctDefault: Number(configWrapper.product.wastage_pct_default || 0),
        };

        const res = computeBoq(basis, updatedItems, basis.baseRequiredQty);
        return res.grandTotal;
    };

    const getConfigPriceMismatches = (configWrapper: any) => {
        if (!configWrapper.items || !configWrapper.product || Object.keys(materialsById).length === 0) return [];

        const mappedItems = mapItems(configWrapper.items);
        const mismatches: Array<{ name: string, oldRate: number, newRate: number }> = [];

        mappedItems.forEach((m: any) => {
            const latest = materialsById[String(m.id)];
            if (latest) {
                const savedRate = m.supplyRate || 0;
                if (Math.abs(savedRate - latest.rate) > 0.01) {
                    mismatches.push({ name: m.name, oldRate: savedRate, newRate: latest.rate });
                }
            }
        });

        return mismatches;
    };

    // Detect mismatches: library rate is different from what's saved in config
    const mismatches = useMemo(() => {
        const list: Array<{ index: number; materialId: string; name: string; oldRate: number; newRate: number }> = [];
        configMaterials.forEach((cm, idx) => {
            const latest = materialsById[String(cm.id)];
            if (latest && Math.abs(latest.rate - (cm.supplyRate || 0)) > 0.01) {
                list.push({ index: idx, materialId: String(cm.id), name: cm.name, oldRate: cm.supplyRate || 0, newRate: latest.rate });
            }
        });
        return list;
    }, [configMaterials, materialsById]);

    const activeMismatches = useMemo(
        () => mismatches.filter(m => !ignoredMismatches.has(`${m.materialId}-${m.index}`)),
        [mismatches, ignoredMismatches]
    );

    const handleUpdateAllRates = () => {
        if (activeMismatches.length === 0 || isUpdatingRates) return;
        setIsUpdatingRates(true);
        setConfigMaterials(prev => prev.map((cm, idx) => {
            const mismatch = activeMismatches.find(m => m.index === idx);
            if (mismatch) {
                const newSupply = Number(mismatch.newRate);
                return { ...cm, supplyRate: newSupply, rate: newSupply + Number(cm.installRate || 0) };
            }
            return cm;
        }));
        setIgnoredMismatches(new Set());
        toast({ title: "Rates Updated", description: `${activeMismatches.length} material rate(s) updated to latest prices.` });
        setIsUpdatingRates(false);
    };

    // Trigger notification if there are price changes
    useEffect(() => {
        if (selectedProduct && previousConfigs.length > 0 && Object.keys(materialsById).length > 0) {
            const hasUpdates = previousConfigs.some(cd => {
                const mismatches = getConfigPriceMismatches(cd);
                const savedCost = Number(cd.product.total_cost || 0);
                const currentCost = getConfigCurrentTotal(cd);
                return mismatches.length > 0 || (currentCost !== null && Math.abs(savedCost - currentCost) > 0.01);
            });
            if (hasUpdates) {
                toast({
                    title: "Price Updates Detected",
                    description: "Some existing configurations for this product have updated material rates.",
                    variant: "default",
                });
            }
        }
    }, [selectedProduct, previousConfigs, materialsById]);

    const handleUpdateSingleRate = (mismatch: typeof mismatches[0]) => {
        setConfigMaterials(prev => prev.map((cm, idx) => {
            if (idx === mismatch.index) {
                const newSupply = Number(mismatch.newRate);
                return { ...cm, supplyRate: newSupply, rate: newSupply + Number(cm.installRate || 0) };
            }
            return cm;
        }));
        toast({ title: "Rate Updated", description: `"${mismatch.name}" rate updated to ₹${mismatch.newRate.toLocaleString()}.` });
    };

    const handleIgnoreMismatch = (mismatch: typeof mismatches[0]) => {
        setIgnoredMismatches(prev => new Set(prev).add(`${mismatch.materialId}-${mismatch.index}`));
    };

    useEffect(() => {
        if (selectedProduct && (step === 2 || step === 3)) {
            const timer = setTimeout(async () => {
                try { await apiFetch("/api/product-step3-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildPayload()) }); }
                catch (e) { console.error("Auto-save failed:", e); }
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [selectedProduct, configName, selectedCategory, selectedSubcategory, totalCost, requiredUnitType, baseRequiredQty, wastagePctDefault, dimA, dimB, dimC, productDescription, configMaterials, step]);

    const handleExportExcel = async () => {
        if (selectedProductIds.size === 0) return;
        setIsExporting(true);
        try {
            const workbook = XLSX.utils.book_new();
            const exportData: any[] = [
                ["Product Name", "Category", "Material Name", "Unit", "Rate", "Quantity", "Total Amount"]
            ];

            // Fetch data for each selected product
            for (const productId of Array.from(selectedProductIds)) {
                const product = productsData?.find(p => p.id === productId);
                const res = await apiFetch(`/api/step11-products/${productId}`);
                if (res.ok) {
                    const data = await res.json();
                    const configurations = data.configurations || [];
                    // Use the first configuration (usually the latest or approved)
                    if (configurations.length > 0) {
                        const config = configurations[0];
                        const items = config.items || [];
                        items.forEach((item: any, idx: number) => {
                            exportData.push([
                                idx === 0 ? (product?.name || "") : "",
                                idx === 0 ? (product?.subcategory || "") : "",
                                item.material_name || "",
                                item.unit || "",
                                item.rate || 0,
                                item.qty || 0,
                                (Number(item.rate) || 0) * (Number(item.qty) || 0)
                            ]);
                        });
                    } else {
                        // If no configuration, just add the product row
                        exportData.push([product?.name || "", product?.subcategory || "", "No materials configured", "", "", "", ""]);
                    }
                }
            }

            const worksheet = XLSX.utils.aoa_to_sheet(exportData);
            XLSX.utils.book_append_sheet(workbook, worksheet, "Products and Materials");
            XLSX.writeFile(workbook, `Products_Export_${format(new Date(), "yyyy-MM-dd_HHmm")}.xlsx`);
            toast({ title: "Success", description: `Exported ${selectedProductIds.size} products to Excel.` });
        } catch (error) {
            console.error("Export error:", error);
            toast({ title: "Error", description: "Failed to export to Excel.", variant: "destructive" });
        } finally {
            setIsExporting(false);
        }
    };

    const toggleSelectProduct = (id: string) => {
        setSelectedProductIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectEverything = () => {
        if (!productsData) return;
        if (selectedProductIds.size === productsData.length) {
            setSelectedProductIds(new Set());
        } else {
            setSelectedProductIds(new Set(productsData.map(p => p.id)));
        }
    };

    const toggleSelectAll = (products: Product[]) => {
        const productIds = products.map(p => p.id);
        const allSelected = productIds.every(id => selectedProductIds.has(id));

        setSelectedProductIds(prev => {
            const next = new Set(prev);
            if (allSelected) {
                productIds.forEach(id => next.delete(id));
            } else {
                productIds.forEach(id => next.add(id));
            }
            return next;
        });
    };

    const selectProduct = (product: Product) => { setSelectedProduct(product); resetSelection(); loadExistingConfig(product); };

    const LayoutComponent = isSupplier ? SupplierLayout : Layout;

    return (
        <LayoutComponent>
            <div className="container mx-auto py-8 px-4">
                <Card className="max-w-6xl mx-auto shadow-xl border-none">
                    <CardHeader className="bg-primary/5 border-b pb-6">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                            <CardTitle className="flex items-center gap-4">
                                <span className="text-3xl font-extrabold tracking-tight">Manage Product</span>
                                {selectedProduct && <Badge variant="outline" className="text-sm font-semibold py-1.5 px-4 bg-primary/10 border-primary/20">{selectedProduct.name}</Badge>}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowAllProducts(true)}
                                    className="h-9 font-bold border-blue-200 text-blue-700 hover:bg-blue-50 hover:border-blue-400 gap-2"
                                >
                                    <Layers className="h-4 w-4" />
                                    View All Products
                                </Button>
                                {productsData && productsData.length > 0 && (
                                    <div className="flex items-center gap-2 ml-4">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={toggleSelectEverything}
                                            className="h-9 font-bold border-primary/20 hover:bg-primary/5"
                                        >
                                            {selectedProductIds.size === productsData.length ? "Deselect All" : "Select All Products"}
                                        </Button>
                                        {selectedProductIds.size > 0 && (
                                            <Button
                                                onClick={handleExportExcel}
                                                disabled={isExporting}
                                                className="bg-green-600 hover:bg-green-700 text-white font-bold gap-2 h-9"
                                            >
                                                {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />}
                                                Export as Excel ({selectedProductIds.size})
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </CardTitle>
                            {step === 2 && (
                                <div className="flex flex-wrap items-center gap-4 animate-in fade-in duration-300">
                                    {[
                                        { label: "Category", value: selectedCategory, onChange: (val: string) => { setSelectedCategory(val); setSelectedSubcategory(ALL); }, data: categoriesData, placeholder: "All Categories" },
                                        { label: "Subcategory", value: selectedSubcategory, onChange: setSelectedSubcategory, data: subcategoriesData, placeholder: "All Subcategories", disabled: selectedCategory === ALL },
                                    ].map(({ label, value, onChange, data, placeholder, disabled }: any) => (
                                        <div key={label} className="flex items-center gap-2">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground whitespace-nowrap">{label}</label>
                                            <Select value={value} onValueChange={onChange} disabled={disabled}>
                                                <SelectTrigger className="h-9 w-[180px] bg-white border-primary/20 shadow-sm text-xs font-bold"><SelectValue placeholder={placeholder} /></SelectTrigger>
                                                <SelectContent className="max-h-[300px] overflow-y-auto">
                                                    <SelectItem value={ALL}>{placeholder}</SelectItem>
                                                    {data?.map((item: string) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="p-8">

                        {/* All Products Split View Dialog */}
                        <Dialog open={showAllProducts} onOpenChange={setShowAllProducts}>
                            <DialogContent className="max-w-[98vw] w-[1400px] p-0 overflow-hidden border-none shadow-2xl rounded-xl" style={{ maxHeight: '95vh' }}>
                                <DialogHeader className="sr-only">
                                    <DialogTitle>View All Products</DialogTitle>
                                    <DialogDescription>Browse all products with detailed configuration view</DialogDescription>
                                </DialogHeader>
                                <AllProductsSplitView
                                    products={productsData || []}
                                    approvals={allApprovals || []}
                                    onClose={() => setShowAllProducts(false)}
                                />
                            </DialogContent>
                        </Dialog>

                        {genericDelete && (
                            <DeleteConfirmationDialog
                                isOpen={genericDelete.isOpen}
                                onOpenChange={(open) => !open && setGenericDelete(null)}
                                onConfirm={confirmDeleteConfig}
                                itemName={genericDelete.name}
                            />
                        )}


                        {/* Step 1 */}
                        {step === 1 && (

                            <div className="space-y-8">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <h2 className="text-2xl font-bold">1. Select Base Product</h2>
                                    <div className="flex flex-col md:flex-row items-center gap-3 w-full md:w-auto">
                                        <div className="relative w-full md:w-64">
                                            <Search className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                                            <Input placeholder="Search by name..." className="pl-10 h-10" value={productSearch} onChange={e => setProductSearch(e.target.value)} />
                                        </div>
                                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                                            <SelectTrigger className="w-full md:w-44 h-10"><SelectValue placeholder="Status" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="All">All Statuses</SelectItem>
                                                <SelectItem value="Draft">Draft</SelectItem>
                                                <SelectItem value="Pending Approval">Pending Approval</SelectItem>
                                                <SelectItem value="Revision Pending">Revision Pending</SelectItem>
                                                <SelectItem value="Approved">Approved</SelectItem>
                                                <SelectItem value="Rejected">Rejected</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Select value={dateSort} onValueChange={(val: any) => setDateSort(val)}>
                                            <SelectTrigger className="w-full md:w-44 h-10"><SelectValue placeholder="Sort by Date" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="newest">Newest to Oldest</SelectItem>
                                                <SelectItem value="oldest">Oldest to Newest</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                <Dialog open={isCloneDialogOpen} onOpenChange={(open) => { setIsCloneDialogOpen(open); if (!open) setTargetProductForClone(null); }}>
                                    <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden border-none shadow-2xl">
                                        <DialogHeader className="p-6 bg-primary/5 border-b">
                                            <DialogTitle className="text-xl font-bold flex items-center gap-2">
                                                <Copy className="h-5 w-5 text-primary" />
                                                Clone to {targetProductForClone?.name}
                                            </DialogTitle>
                                            <p className="text-xs text-muted-foreground mt-1">Select an existing approved configuration to copy its materials and settings into this product.</p>
                                        </DialogHeader>
                                        <div className="p-6 space-y-4 flex-1 flex flex-col min-h-0">
                                            <div className="relative">
                                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                                <Input
                                                    placeholder="Search approved configurations..."
                                                    className="pl-10 h-10 border-primary/10 shadow-sm"
                                                    value={cloneSearch}
                                                    onChange={e => setCloneSearch(e.target.value)}
                                                />
                                            </div>
                                            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2 min-h-[300px]">
                                                {filteredCloneConfigs.length === 0 ? (
                                                    <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
                                                        <Search className="h-10 w-10 text-muted-foreground opacity-20" />
                                                        <p className="text-sm font-medium text-muted-foreground">No approved configurations found</p>
                                                    </div>
                                                ) : (
                                                    filteredCloneConfigs.map(config => (
                                                        <div
                                                            key={config.id}
                                                            className="flex items-center justify-between p-4 bg-white rounded-xl border-2 border-slate-50 hover:border-primary/20 hover:bg-slate-50/50 transition-all cursor-pointer group"
                                                            onClick={() => handleCloneConfig(config)}
                                                        >
                                                            <div className="space-y-1">
                                                                <div className="font-bold text-sm text-slate-800 group-hover:text-primary transition-colors">
                                                                    {config.product_name}
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-xs font-semibold text-muted-foreground">{config.config_name || "Default Config"}</span>
                                                                    <Badge variant="outline" className="h-4 text-[8px] uppercase px-1.5 font-bold bg-green-50 text-green-700 border-green-200">Approved</Badge>
                                                                </div>
                                                                <div className="text-[10px] text-muted-foreground mt-1">
                                                                    Updated: {new Date(config.updated_at || config.created_at).toLocaleDateString()} • {config.total_cost ? `₹${Number(config.total_cost).toLocaleString()}` : 'N/A'}
                                                                </div>
                                                            </div>
                                                            <Button variant="ghost" size="sm" className="h-8 font-bold text-primary group-hover:bg-primary group-hover:text-white transition-all">Select</Button>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    </DialogContent>
                                </Dialog>
                                {loadingProducts ? (
                                    <div className="flex flex-col items-center justify-center p-20 space-y-4">
                                        <Loader2 className="h-10 w-10 animate-spin text-primary" />
                                        <p className="text-muted-foreground font-medium">Loading products...</p>
                                    </div>
                                ) : (needsWorkProducts.length > 0 || approvedProducts.length > 0) ? (
                                    <Tabs defaultValue="needs-work" className="w-full">
                                        <TabsList className="grid w-full grid-cols-2 mb-6">
                                            <TabsTrigger value="needs-work" className="font-bold">Needs Work ({needsWorkProducts.length})</TabsTrigger>
                                            <TabsTrigger value="approved" className="font-bold">Approved ({approvedProducts.length})</TabsTrigger>
                                        </TabsList>

                                        <TabsContent value="needs-work" className="mt-0">
                                            <div className="rounded-xl border shadow-sm overflow-hidden bg-white max-h-[500px] overflow-y-auto">
                                                <Table>
                                                    <TableHeader className="bg-muted/30 sticky top-0 z-10">
                                                        <TableRow>
                                                            <TableHead className="w-[60px]">
                                                                <Checkbox
                                                                    checked={needsWorkProducts.length > 0 && needsWorkProducts.every(p => selectedProductIds.has(p.id))}
                                                                    onCheckedChange={() => toggleSelectAll(needsWorkProducts)}
                                                                />
                                                            </TableHead>
                                                            <TableHead className="font-bold">Product Name</TableHead>
                                                            <TableHead className="font-bold">Created Date</TableHead>
                                                            <TableHead className="font-bold text-center w-[120px]">Status</TableHead>
                                                            <TableHead className="w-[100px]"></TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {needsWorkProducts.length === 0 ? (
                                                            <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">No products currently need work.</TableCell></TableRow>
                                                        ) : needsWorkProducts.map(product => {
                                                            const isPending = (allApprovals as any[] || []).some(a => a.product_id === product.id && a.status === "pending");
                                                            const isRejected = (allApprovals as any[] || []).some(a => a.product_id === product.id && a.status === "rejected");
                                                            return (
                                                                <TableRow key={product.id} className={`transition-colors cursor-pointer ${selectedProduct?.id === product.id ? "bg-primary/5 hover:bg-primary/10" : product.has_price_updates ? "bg-amber-200/70 hover:bg-amber-200/90" : "hover:bg-muted/20"}`} onClick={() => selectProduct(product)}>
                                                                    <TableCell onClick={e => e.stopPropagation()}>
                                                                        <Checkbox
                                                                            checked={selectedProductIds.has(product.id)}
                                                                            onCheckedChange={() => toggleSelectProduct(product.id)}
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell className="font-semibold text-base py-4">
                                                                        <div className="flex items-center gap-3">
                                                                            <div
                                                                                className="cursor-pointer hover:ring-2 hover:ring-primary rounded-md transition-all group relative shrink-0 overflow-hidden"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    setProductForTemplate(product);
                                                                                    setShowTemplateSelector(true);
                                                                                }}
                                                                                title="Change Product Icon"
                                                                            >
                                                                                <img
                                                                                    src={parseImages(product.image).length > 0 ? parseImages(product.image)[0] : "/placeholder-product.png"}
                                                                                    alt={product.name}
                                                                                    className="h-10 w-10 object-cover rounded shadow-sm border border-slate-200"
                                                                                />
                                                                                {!product.image && (
                                                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                                        <Plus className="h-4 w-4 text-primary" />
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                            <div className="flex flex-col gap-1">
                                                                                <div className="flex items-center gap-2">
                                                                                    <span>{product.name}</span>
                                                                                    {product.has_price_updates && (
                                                                                        <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200 text-[8px] h-4 px-1.5 font-bold uppercase flex items-center gap-1 w-fit">
                                                                                            <ArrowRight className="h-3 w-3" />
                                                                                            Price Update
                                                                                        </Badge>
                                                                                    )}
                                                                                </div>
                                                                                <div className="flex gap-2">
                                                                                    {isPending && <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200 text-[8px] h-4 px-1.5 font-bold uppercase flex items-center gap-1 w-fit"><Loader2 className="h-2 w-2 animate-spin" /> Pending Approval</Badge>}
                                                                                    {isRejected && <Badge variant="outline" className="bg-red-100 text-red-700 border-red-200 text-[8px] h-4 px-1.5 font-bold uppercase flex items-center gap-1 w-fit"><XCircle className="h-2 w-2" /> Rejected</Badge>}
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </TableCell>
                                                                    <TableCell className="text-muted-foreground">{product.created_at ? new Date(product.created_at).toLocaleDateString() : "N/A"}</TableCell>
                                                                    <TableCell className="text-center">
                                                                        {isPending ? (
                                                                            <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200 text-[10px] h-5 px-1.5 font-bold uppercase tracking-tight whitespace-nowrap">Submitted</Badge>
                                                                        ) : isRejected ? (
                                                                            <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200 text-[10px] h-5 px-1.5 font-bold uppercase tracking-tight whitespace-nowrap">Action Required</Badge>
                                                                        ) : (
                                                                            <span className="text-[10px] font-medium text-muted-foreground border border-dashed border-muted/50 px-2 py-0.5 rounded-sm whitespace-nowrap">Needs Work</span>
                                                                        )}
                                                                    </TableCell>
                                                                    <TableCell onClick={e => e.stopPropagation()}>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            className="h-8 w-8 p-0 text-primary hover:bg-primary hover:text-white rounded-full transition-all"
                                                                            title="Clone from another config"
                                                                            onClick={(e) => openCloneDialog(e, product)}
                                                                        >
                                                                            <Copy className="h-4 w-4" />
                                                                        </Button>
                                                                    </TableCell>
                                                                </TableRow>
                                                            )
                                                        })}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        </TabsContent>

                                        <TabsContent value="approved" className="mt-0">
                                            <div className="rounded-xl border shadow-sm overflow-hidden bg-white max-h-[500px] overflow-y-auto">
                                                <Table>
                                                    <TableHeader className="bg-muted/30 sticky top-0 z-10">
                                                        <TableRow>
                                                            <TableHead className="w-[60px]">
                                                                <Checkbox
                                                                    checked={approvedProducts.length > 0 && approvedProducts.every(p => selectedProductIds.has(p.id))}
                                                                    onCheckedChange={() => toggleSelectAll(approvedProducts)}
                                                                />
                                                            </TableHead>
                                                            <TableHead className="font-bold">Product Name</TableHead>
                                                            <TableHead className="font-bold">Created Date</TableHead>
                                                            <TableHead className="font-bold text-center w-[120px]">Status</TableHead>
                                                            <TableHead className="w-[100px]"></TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {approvedProducts.length === 0 ? (
                                                            <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">No approved products found matching your search.</TableCell></TableRow>
                                                        ) : approvedProducts.map(product => {
                                                            const isPendingRevision = pendingProductIds.has(product.id);
                                                            return (
                                                                <TableRow key={product.id} className={`transition-colors cursor-pointer ${selectedProduct?.id === product.id ? "bg-primary/5 hover:bg-primary/10" : product.has_price_updates ? "bg-amber-200/70 hover:bg-amber-200/90" : "bg-green-50/50 hover:bg-green-100"}`} onClick={() => selectProduct(product)}>
                                                                    <TableCell onClick={e => e.stopPropagation()}>
                                                                        <Checkbox
                                                                            checked={selectedProductIds.has(product.id)}
                                                                            onCheckedChange={() => toggleSelectProduct(product.id)}
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell className="font-semibold text-base py-4">
                                                                        <div className="flex items-center gap-3">
                                                                            <div
                                                                                className="cursor-pointer hover:ring-2 hover:ring-primary rounded-md transition-all group relative shrink-0 overflow-hidden"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    setProductForTemplate(product);
                                                                                    setShowTemplateSelector(true);
                                                                                }}
                                                                                title="Change Product Icon"
                                                                            >
                                                                                <img
                                                                                    src={parseImages(product.image).length > 0 ? parseImages(product.image)[0] : "/placeholder-product.png"}
                                                                                    alt={product.name}
                                                                                    className="h-10 w-10 object-cover rounded shadow-sm border border-slate-200"
                                                                                />
                                                                                {!product.image && (
                                                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                                        <Plus className="h-4 w-4 text-primary" />
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                            <div className="flex flex-col gap-1">
                                                                                <div className="flex items-center gap-2">
                                                                                    <span>{product.name}</span>
                                                                                    {product.has_price_updates && (
                                                                                        <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200 text-[8px] h-4 px-1.5 font-bold uppercase flex items-center gap-1 w-fit">
                                                                                            <ArrowRight className="h-3 w-3" />
                                                                                            Price Update
                                                                                        </Badge>
                                                                                    )}
                                                                                </div>
                                                                                {isPendingRevision && <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200 text-[8px] h-4 px-1.5 font-bold uppercase flex items-center gap-1 w-fit"><Loader2 className="h-2 w-2 animate-spin" /> Revision Pending</Badge>}
                                                                            </div>
                                                                        </div>
                                                                    </TableCell>
                                                                    <TableCell className="text-muted-foreground">{product.created_at ? new Date(product.created_at).toLocaleDateString() : "N/A"}</TableCell>
                                                                    <TableCell className="text-center">
                                                                        <div className="flex flex-col items-center gap-1">
                                                                            <Badge variant="outline" className="bg-green-100 text-green-700 border-green-200 text-[10px] h-5 px-1.5 font-bold uppercase tracking-tight whitespace-nowrap flex items-center gap-1 justify-center w-fit mx-auto"><Check className="h-3 w-3" /> Approved</Badge>
                                                                        </div>
                                                                    </TableCell>
                                                                    <TableCell onClick={e => e.stopPropagation()}>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            className="h-8 w-8 p-0 text-primary hover:bg-primary hover:text-white rounded-full transition-all"
                                                                            title="Clone from another config"
                                                                            onClick={(e) => openCloneDialog(e, product)}
                                                                        >
                                                                            <Copy className="h-4 w-4" />
                                                                        </Button>
                                                                    </TableCell>
                                                                </TableRow>
                                                            )
                                                        })}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        </TabsContent>
                                    </Tabs>
                                ) : (
                                    <EmptyState
                                        icon={Package}
                                        title="No Products Found"
                                        subtitle="No products available in the selected category/subcategory."
                                        className="py-20 border-2 border-dashed rounded-xl bg-slate-50/50"
                                    />
                                )}
                                {selectedProduct && (
                                    <div className="space-y-3 p-6 bg-primary/5 rounded-xl border border-primary/20">
                                        <div className="flex flex-col md:flex-row gap-6">
                                            {previousConfigs.length > 0 && (
                                                <div className="flex-1 space-y-3">
                                                    <label className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Select Existing Configuration</label>
                                                    <Select onValueChange={val => { if (val === "none") { resetSelection(); return; } const c = previousConfigs.find(c => c.product.id.toString() === val); if (c) loadSpecificConfig(c); }}>
                                                        <SelectTrigger className="h-12 bg-white border-primary/30 shadow-sm"><SelectValue placeholder="Choose a previous config..." /></SelectTrigger>
                                                        <SelectContent className="max-h-[300px]">
                                                            <SelectItem value="none" className="text-muted-foreground italic border-b border-muted/20 pb-2">-- Clear Selection / Start Fresh --</SelectItem>
                                                            {previousConfigs.filter(cd => {
                                                                // Hide drafts whose config_name matches an approved config (avoid duplicates)
                                                                if (cd.product.status === "draft") {
                                                                    const cn = cd.product.config_name || "";
                                                                    if (cn && (
                                                                        previousConfigs.some(ac => ac.product.config_name === cn && ac.product.status === "approved") ||
                                                                        productApprovals.some((a: any) => a.config_name === cn && a.status === "approved")
                                                                    )) return false;
                                                                }
                                                                return true;
                                                            }).map(cd => (
                                                                <SelectItem key={cd.product.id} value={cd.product.id.toString()}>
                                                                    <div className="flex flex-col">
                                                                        <span className="font-bold">{cd.product.config_name || "Unnamed Configuration"}</span>
                                                                        <span className="text-[10px] text-muted-foreground">Saved: {new Date(cd.product.created_at).toLocaleDateString()}</span>
                                                                    </div>
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            )}
                                            <div className="flex-1 space-y-3">
                                                <label className="text-sm font-bold uppercase tracking-wider text-muted-foreground">{previousConfigs.length > 0 ? "Or Create New Name" : "Configuration Name (Optional)"}</label>
                                                <Input value={configName} onChange={e => setConfigName(e.target.value)} placeholder="Enter a name (e.g., 'Standard', 'Premium')" className="h-12 bg-white border-primary/30 shadow-sm" />
                                            </div>
                                        </div>
                                        <p className="text-xs text-muted-foreground">{previousConfigs.length > 0 ? "Select a previous configuration to load its data, or type a new name to save a distinct version." : "Give this configuration a name to distinguish it from others."}</p>
                                        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                                            {/* Approved Configurations */}
                                            <div className="space-y-4 p-5 bg-green-50/10 rounded-2xl border border-green-100 shadow-sm animate-in fade-in slide-in-from-left-4 duration-500">
                                                <div className="flex items-center justify-between px-1">
                                                    <h3 className="text-sm font-black uppercase tracking-widest text-green-600 flex items-center gap-2"><Check className="h-4 w-4" /> Approved Configurations</h3>
                                                    {isLoadingConfigs && <Loader2 className="h-3 w-3 animate-spin text-green-600" />}
                                                </div>
                                                <div className="space-y-3 min-h-[100px] max-h-[500px] overflow-y-auto pr-2">
                                                    {previousConfigs.filter(c => c.product.status === "approved").length > 0 ? (
                                                        previousConfigs.filter(c => c.product.status === "approved").map(cd => {
                                                            const savedPrice = Number(cd.product.total_cost || 0);
                                                            const currentPrice = getConfigCurrentTotal(cd);
                                                            const priceMismatches = getConfigPriceMismatches(cd);
                                                            const hasChanged = priceMismatches.length > 0 || (currentPrice !== null && Math.abs(savedPrice - currentPrice) > 0.01);
                                                            const approvalRecord = productApprovals.find(a => a.config_name === cd.product.config_name);
                                                            return (
                                                                <div key={cd.product.id} className="flex flex-col p-4 bg-white rounded-xl border-2 border-green-50 shadow-sm hover:border-green-200 hover:shadow-md transition-all group">
                                                                    <div className="flex items-center justify-between">
                                                                        <div className="space-y-1">
                                                                            <div className="font-bold text-sm text-slate-800">{cd.product.config_name || "Unnamed Config"}</div>
                                                                            <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-tighter">Approved: {new Date(cd.product.updated_at).toLocaleDateString()} • {cd.items?.length || 0} Materials</div>
                                                                            {hasChanged && currentPrice !== null ? (
                                                                                <div className="flex items-center mt-1">
                                                                                    <Badge variant="outline" className={`flex items-center gap-1.5 px-2 py-0.5 shadow-sm text-[10px] ${currentPrice > savedPrice ? "bg-amber-100/50 text-amber-700 border-amber-300" : "bg-green-100/50 text-green-700 border-green-300"}`}>
                                                                                        {currentPrice > savedPrice ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                                                                        <span className="line-through opacity-70">₹{savedPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                                                        <ArrowRight className="h-3 w-3" />
                                                                                        <span className="font-bold">₹{currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                                                    </Badge>
                                                                                </div>
                                                                            ) : (
                                                                                savedPrice > 0 && <div className="text-[10px] text-slate-500 font-bold mt-1">₹{savedPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                                                            )}
                                                                        </div>
                                                                        <div className="flex items-center gap-2 shrink-0">
                                                                            {(!approvalRecord || approvalRecord.status === "approved") ? (
                                                                                <Button
                                                                                    variant="outline"
                                                                                    size="sm"
                                                                                    onClick={async () => {
                                                                                        if (!confirm(`Are you sure you want to request edit for approved configuration "${cd.product.config_name}"?`)) return;
                                                                                        try {
                                                                                            let res;
                                                                                            if (approvalRecord) {
                                                                                                res = await apiFetch(`/api/product-approvals/${approvalRecord.id}/request-edit`, { method: "POST" });
                                                                                            } else {
                                                                                                res = await apiFetch(`/api/product-approvals/request-edit`, {
                                                                                                    method: "POST",
                                                                                                    headers: { "Content-Type": "application/json" },
                                                                                                    body: JSON.stringify({
                                                                                                        product_id: selectedProduct?.id || cd.product.product_id,
                                                                                                        config_name: cd.product.config_name
                                                                                                    })
                                                                                                });
                                                                                            }
                                                                                            if (res.ok) {
                                                                                                toast({ title: "Edit Requested", description: `Your request to edit "${cd.product.config_name}" has been submitted.` });
                                                                                                if (selectedProduct) fetchPreviousConfigs(selectedProduct.id);
                                                                                            } else {
                                                                                                toast({ title: "Error", description: "Failed to submit edit request.", variant: "destructive" });
                                                                                            }
                                                                                        } catch (err) {
                                                                                            console.error(err);
                                                                                            toast({ title: "Error", description: "Failed to submit edit request.", variant: "destructive" });
                                                                                        }
                                                                                    }}
                                                                                    className="h-8 text-indigo-700 border-indigo-200 hover:bg-indigo-50 font-bold px-3 shadow-sm shrink-0"
                                                                                >
                                                                                    <Lock className="h-3.5 w-3.5 mr-1" /> Request Edit
                                                                                </Button>
                                                                            ) : approvalRecord.status === "edit_requested" ? (
                                                                                <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200 font-bold text-[10px] px-2.5 py-1.5 flex items-center gap-1 shadow-sm shrink-0">
                                                                                    <Clock className="h-3 w-3 animate-pulse text-indigo-600" /> Edit Requested
                                                                                </Badge>
                                                                            ) : null}
                                                                            <Button variant="ghost" size="sm" onClick={() => loadSpecificConfig(cd)} className="h-8 text-green-700 hover:text-green-800 hover:bg-green-100 font-bold px-3"><Edit className="h-3.5 w-3.5 mr-1" /> Load</Button>
                                                                            <Button variant="ghost" size="sm" onClick={() => requestDeleteConfig(cd.product.id)} className="h-8 w-8 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></Button>
                                                                        </div>
                                                                    </div>
                                                                    {hasChanged && priceMismatches.length > 0 && (
                                                                        <div className="mt-4 pt-3 border-t border-amber-100/50">
                                                                            <div className="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-2">Material Prices Updated:</div>
                                                                            <div className="grid grid-cols-1 gap-1.5">
                                                                                {priceMismatches.map((pm, idx) => (
                                                                                    <div key={idx} className="flex items-center justify-between bg-amber-50/50 px-2.5 py-1.5 rounded-md border border-amber-100/50">
                                                                                        <span className="text-[11px] font-semibold text-slate-700 truncate pr-2">{pm.name}</span>
                                                                                        <div className="flex items-center gap-1.5 shrink-0 text-[11px]">
                                                                                            <span className="text-slate-400 line-through">₹{pm.oldRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                                                            <ArrowRight className={`h-3 w-3 ${pm.newRate > pm.oldRate ? "text-amber-400" : "text-green-400"}`} />
                                                                                            <span className={`font-bold ${pm.newRate > pm.oldRate ? "text-amber-700" : "text-green-700"}`}>₹{pm.newRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                                                        </div>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })
                                                    ) : !isLoadingConfigs && (
                                                        <div className="flex flex-col items-center justify-center py-10 px-4 text-center border-2 border-dashed border-green-100/50 rounded-xl bg-green-50/5 italic text-muted-foreground text-xs font-medium">
                                                            No approved configurations found for this product.
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Right Column: Draft / Pending / Rejected */}
                                            <div className="space-y-6">

                                                {/* Draft Configs (approved-edit unlocked) */}
                                                {draftConfigs.length > 0 && (
                                                    <div className="space-y-3 p-5 bg-indigo-50/30 rounded-2xl border border-indigo-200 shadow-sm animate-in fade-in slide-in-from-right-4 duration-500">
                                                        <div className="flex items-center gap-2 px-1">
                                                            <h3 className="text-sm font-black uppercase tracking-widest text-indigo-700 flex items-center gap-2">
                                                                <Edit className="h-4 w-4" /> Draft — Edit Approved
                                                            </h3>
                                                            <span className="ml-auto text-[10px] font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full border border-indigo-200">
                                                                {draftConfigs.length} pending edit{draftConfigs.length !== 1 ? 's' : ''}
                                                            </span>
                                                        </div>
                                                        <p className="text-[10px] text-indigo-600/70 px-1">Admin approved your edit request. Load this config, make changes, then resubmit for approval.</p>
                                                        <div className="space-y-3 max-h-[280px] overflow-y-auto pr-2">
                                                            {draftConfigs.map(config => (
                                                                <div key={config.id} className="flex items-center justify-between p-4 bg-white rounded-xl border-2 border-indigo-100 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all group">
                                                                    <div className="space-y-1">
                                                                        <div className="font-bold text-sm text-slate-800">{config.config_name || "Unnamed Config"}</div>
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-[10px] text-muted-foreground font-medium uppercase">{new Date(config.updated_at).toLocaleDateString()}</span>
                                                                            <Badge variant="outline" className="h-4 text-[8px] uppercase px-1.5 font-black bg-indigo-100 text-indigo-700 border-indigo-200 flex items-center gap-1">
                                                                                <Edit className="h-2.5 w-2.5" /> Draft
                                                                            </Badge>
                                                                        </div>
                                                                    </div>
                                                                    <Button
                                                                        variant="outline"
                                                                        size="sm"
                                                                        onClick={() => loadApprovalConfig(config, "Draft")}
                                                                        className="h-8 text-[10px] font-black uppercase tracking-tight border-indigo-300 hover:bg-indigo-50 text-indigo-700 px-3 shrink-0"
                                                                    >
                                                                        <Edit className="h-3 w-3 mr-1" /> Load & Edit
                                                                    </Button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Pending */}
                                                <div className="space-y-3 p-5 bg-amber-50/20 rounded-2xl border border-amber-100 shadow-sm animate-in fade-in slide-in-from-right-4 duration-500">
                                                    <h3 className="text-sm font-black uppercase tracking-widest text-amber-600 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin-slow" /> Pending Review</h3>
                                                    <div className="space-y-3 max-h-[250px] overflow-y-auto pr-2">
                                                        {pendingConfigs.length > 0 ? pendingConfigs.map(config => {
                                                            const priceMismatches = getConfigPriceMismatches(config);
                                                            const hasChanged = priceMismatches.length > 0;
                                                            return (
                                                                <div key={config.id} className="flex flex-col p-4 bg-white rounded-xl border-2 border-amber-50 shadow-sm hover:border-amber-200 transition-all">
                                                                    <div className="flex items-center justify-between">
                                                                        <div className="space-y-1">
                                                                            <div className="font-bold text-sm text-slate-800">{config.config_name || "Unnamed Config"}</div>
                                                                            <div className="flex items-center gap-2">
                                                                                <span className="text-[10px] text-muted-foreground font-medium uppercase">{new Date(config.created_at).toLocaleDateString()}</span>
                                                                                <Badge variant="outline" className="h-4 text-[8px] uppercase px-1.5 font-black bg-amber-100 text-amber-700 border-amber-200">Pending</Badge>
                                                                            </div>
                                                                            {hasChanged && (
                                                                                <div className="flex items-center gap-1.5 mt-1 text-amber-600">
                                                                                    <AlertTriangle className="h-3 w-3" />
                                                                                    <span className="text-[10px] font-bold">Price Update Available</span>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                        <Button variant="outline" size="sm" onClick={() => loadApprovalConfig(config, "Pending")} className="h-8 text-[10px] font-black uppercase tracking-tight border-amber-200 hover:bg-amber-50 text-amber-600 px-3">View / Load</Button>
                                                                    </div>
                                                                    {hasChanged && (
                                                                        <div className="mt-3 space-y-2 pt-2 border-t border-amber-50">
                                                                            {priceMismatches.map((pm, idx) => (
                                                                                <div key={idx} className="flex items-center justify-between text-[11px] bg-amber-50/50 p-2 rounded">
                                                                                    <span className="font-semibold text-slate-700 truncate pr-2">{pm.name}</span>
                                                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                                                        <span className="text-slate-400 line-through">₹{pm.oldRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                                                        <ArrowRight className={`h-3 w-3 ${pm.newRate > pm.oldRate ? "text-amber-400" : "text-green-400"}`} />
                                                                                        <span className={`font-bold ${pm.newRate > pm.oldRate ? "text-amber-700" : "text-green-700"}`}>₹{pm.newRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                                                    </div>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        }) : (
                                                            <div className="py-4 text-center border border-dashed border-amber-100 rounded-lg bg-amber-50/50 italic text-muted-foreground text-[10px] font-medium">No configurations pending review.</div>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Rejected */}
                                                {rejectedConfigs.length > 0 && (
                                                    <div className="space-y-3 p-5 bg-red-50/30 rounded-2xl border border-red-100 shadow-sm animate-in fade-in slide-in-from-right-4 duration-500">
                                                        <h3 className="text-sm font-black uppercase tracking-widest text-red-600 flex items-center gap-2"><XCircle className="h-4 w-4" /> Rejected</h3>
                                                        <div className="space-y-3 max-h-[250px] overflow-y-auto pr-2">
                                                            {rejectedConfigs.map(config => {
                                                                const priceMismatches = getConfigPriceMismatches(config);
                                                                const hasChanged = priceMismatches.length > 0;
                                                                return (
                                                                    <div key={config.id} className="flex flex-col p-4 bg-white rounded-xl border-2 border-red-50 shadow-sm hover:border-red-200 transition-all">
                                                                        <div className="flex items-center justify-between">
                                                                            <div className="space-y-1">
                                                                                <div className="font-bold text-sm text-slate-800">{config.config_name || "Unnamed Config"}</div>
                                                                                <div className="text-[10px] text-red-600 font-bold italic line-clamp-1">{config.rejection_reason || "Check feedback"}</div>
                                                                                {hasChanged && (
                                                                                    <div className="flex items-center gap-1.5 mt-1 text-red-600">
                                                                                        <AlertTriangle className="h-3 w-3" />
                                                                                        <span className="text-[10px] font-bold">Rates Changed Since Rejection</span>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                            <Button variant="outline" size="sm" onClick={() => loadApprovalConfig(config, "Rejected")} className="h-8 text-[10px] font-black uppercase tracking-tight border-red-200 hover:bg-red-50 text-red-600 px-3">Resubmit</Button>
                                                                        </div>
                                                                        {hasChanged && (
                                                                            <div className="mt-3 space-y-2 pt-2 border-t border-red-50">
                                                                                {priceMismatches.map((pm, idx) => (
                                                                                    <div key={idx} className="flex items-center justify-between text-[11px] bg-red-50/50 p-2 rounded">
                                                                                        <span className="font-semibold text-slate-700 truncate pr-2">{pm.name}</span>
                                                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                                                            <span className="text-slate-400 line-through">₹{pm.oldRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                                                            <ArrowRight className={`h-3 w-3 ${pm.newRate > pm.oldRate ? "text-amber-400" : "text-green-400"}`} />
                                                                                            <span className={`font-bold ${pm.newRate > pm.oldRate ? "text-amber-700" : "text-green-700"}`}>₹{pm.newRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                                                        </div>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Drafts — hide drafts whose config_name matches an approved config */}
                                                <div className="space-y-3 p-5 bg-blue-50/10 rounded-2xl border border-blue-100 shadow-sm animate-in fade-in slide-in-from-right-4 duration-500">
                                                    <h3 className="text-sm font-black uppercase tracking-widest text-blue-600 flex items-center gap-2"><Layers className="h-4 w-4" /> Recent Drafts</h3>
                                                    <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                                                        {previousConfigs.filter(c => {
                                                            if (c.product.status !== "draft") return false;
                                                            // Hide drafts whose config_name matches an approved config (they already show in Approved section)
                                                            const cn = c.product.config_name || "";
                                                            if (cn && (
                                                                previousConfigs.some(ac => ac.product.config_name === cn && ac.product.status === "approved") ||
                                                                productApprovals.some((a: any) => a.config_name === cn && a.status === "approved")
                                                            )) return false;
                                                            return true;
                                                        }).length > 0 ? (
                                                            previousConfigs.filter(c => {
                                                                if (c.product.status !== "draft") return false;
                                                                const cn = c.product.config_name || "";
                                                                if (cn && (
                                                                    previousConfigs.some(ac => ac.product.config_name === cn && ac.product.status === "approved") ||
                                                                    productApprovals.some((a: any) => a.config_name === cn && a.status === "approved")
                                                                )) return false;
                                                                return true;
                                                            }).map(cd => {
                                                                const savedPrice = Number(cd.product.total_cost || 0);
                                                                const currentPrice = getConfigCurrentTotal(cd);
                                                                const priceMismatches = getConfigPriceMismatches(cd);
                                                                const hasChanged = priceMismatches.length > 0 || (currentPrice !== null && Math.abs(savedPrice - currentPrice) > 0.01);
                                                                return (
                                                                    <div key={cd.product.id} className="flex flex-col p-4 bg-white rounded-xl border-2 border-blue-50 shadow-sm hover:border-blue-200 hover:shadow-md transition-all group">
                                                                        <div className="flex items-center justify-between">
                                                                            <div className="space-y-1">
                                                                                <div className="font-bold text-sm text-slate-800">{cd.product.config_name || "Unnamed Draft"}</div>
                                                                                <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-tighter">Edited: {new Date(cd.product.updated_at).toLocaleDateString()}</div>
                                                                                {hasChanged && currentPrice !== null ? (
                                                                                    <div className="flex items-center mt-1">
                                                                                        <Badge variant="outline" className={`flex items-center gap-1.5 px-2 py-0.5 shadow-sm text-[10px] ${currentPrice > savedPrice ? "bg-amber-100/50 text-amber-700 border-amber-300" : "bg-green-100/50 text-green-700 border-green-300"}`}>
                                                                                            {currentPrice > savedPrice ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                                                                            <span className="line-through opacity-70">₹{savedPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                                                            <ArrowRight className="h-3 w-3" />
                                                                                            <span className="font-bold">₹{currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                                                        </Badge>
                                                                                    </div>
                                                                                ) : (
                                                                                    savedPrice > 0 && <div className="text-[10px] text-slate-500 font-bold mt-1">₹{savedPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                                                                )}
                                                                            </div>
                                                                            <div className="flex items-center gap-2 shrink-0">
                                                                                <Button variant="ghost" size="sm" onClick={() => loadSpecificConfig(cd)} className="h-8 text-blue-700 hover:text-blue-800 hover:bg-blue-100 font-bold px-3">Continue</Button>
                                                                                <Button variant="ghost" size="sm" onClick={() => requestDeleteConfig(cd.product.id)} className="h-8 w-8 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></Button>
                                                                            </div>
                                                                        </div>
                                                                        {hasChanged && priceMismatches.length > 0 && (
                                                                            <div className="mt-4 pt-3 border-t border-amber-100/50">
                                                                                <div className="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-2">Material Prices Updated:</div>
                                                                                <div className="grid grid-cols-1 gap-1.5">
                                                                                    {priceMismatches.map((pm, idx) => (
                                                                                        <div key={idx} className="flex items-center justify-between bg-amber-50/50 px-2.5 py-1.5 rounded-md border border-amber-100/50">
                                                                                            <span className="text-[11px] font-semibold text-slate-700 truncate pr-2">{pm.name}</span>
                                                                                            <div className="flex items-center gap-1.5 shrink-0 text-[11px]">
                                                                                                <span className="text-slate-400 line-through">₹{pm.oldRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                                                                <ArrowRight className={`h-3 w-3 ${pm.newRate > pm.oldRate ? "text-amber-400" : "text-green-400"}`} />
                                                                                                <span className={`font-bold ${pm.newRate > pm.oldRate ? "text-amber-700" : "text-green-700"}`}>₹{pm.newRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                                                            </div>
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })
                                                        ) : (
                                                            <div className="py-8 text-center border-2 border-dashed border-blue-100/50 rounded-xl bg-blue-50/5 italic text-muted-foreground text-xs font-medium">No local drafts found.</div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div className="flex justify-end pt-4">
                                    <Button size="sm" onClick={nextStep} disabled={!selectedProduct} className="px-6 h-10">Next Step <ArrowRight className="ml-2 h-4 w-4" /></Button>
                                </div>
                            </div>
                        )}

                        {/* Step 2 */}
                        {step === 2 && (
                            <div className="space-y-8 animate-in fade-in duration-500">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-2xl font-bold flex items-center gap-3">
                                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-black">2</div>
                                        Select Materials/Items
                                    </h2>
                                    <div className="flex items-center gap-4">
                                        <div className="flex items-center space-x-2">
                                            <Checkbox
                                                id="project-pricing-filter"
                                                checked={projectPricingFilter}
                                                onCheckedChange={(checked: boolean) => setProjectPricingFilter(!!checked)}
                                            />
                                            <label htmlFor="project-pricing-filter" className="text-sm font-semibold cursor-pointer whitespace-nowrap">
                                                Project Pricing Only
                                            </label>
                                        </div>
                                        <div className="relative w-64">
                                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                            <Input placeholder="Search materials..." className="pl-10 h-10 bg-muted/5 font-medium" value={materialSearch} onChange={e => setMaterialSearch(e.target.value)} />
                                        </div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                                    {/* Available Materials */}
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between px-2">
                                            <h3 className="text-sm font-black uppercase tracking-widest text-slate-600 flex items-center gap-2"><Layers className="h-4 w-4" /> Available Materials ({filteredMaterials.length})</h3>
                                            <span className="text-[10px] font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Filtered View</span>
                                        </div>
                                        <div className="rounded-2xl border-2 border-slate-100 bg-white shadow-inner min-h-[450px] max-h-[600px] overflow-y-auto">
                                            {loadingMaterials ? (
                                                <div className="flex flex-col items-center justify-center h-[400px] space-y-4">
                                                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                                                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Loading Items...</p>
                                                </div>
                                            ) : filteredMaterials.length === 0 ? (
                                                <EmptyState icon={Search} title="No matching materials found" subtitle="Try adjusting your filters or search term." className="h-[400px]" />
                                            ) : (
                                                <div className="divide-y divide-slate-50">
                                                    {filteredMaterials.map(material => {
                                                        const isSelected = selectedMaterials.some(m => m.id === material.id);
                                                        return (
                                                            <div key={material.id} onClick={() => toggleMaterial(material)}
                                                                className={`p-4 flex items-center justify-between cursor-pointer transition-all hover:bg-slate-50 relative overflow-hidden group ${isSelected ? "opacity-40 grayscale-[0.5]" : ""}`}>
                                                                {isSelected && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />}
                                                                <div className="flex-1 min-w-0 pr-4">
                                                                    <div className="flex items-center gap-2 mb-0.5">
                                                                        <span className="font-bold text-slate-900 group-hover:text-primary transition-colors">{material.name}</span>
                                                                        {material.is_project_pricing && (
                                                                            <Badge className="bg-amber-500 hover:bg-amber-600 text-white text-[9px] px-1.5 py-0 h-4 uppercase tracking-wider ml-1">
                                                                                Project Pricing
                                                                            </Badge>
                                                                        )}
                                                                        {isSelected && <Check className="h-3 w-3 text-primary animate-in zoom-in" />}
                                                                    </div>
                                                                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-medium uppercase tracking-tight">
                                                                        <span className="text-slate-400 font-semibold">Unit:</span><span className="text-blue-600 font-bold">{material.unit}</span><span className="text-slate-300">•</span>
                                                                        <span className="text-slate-400 font-semibold">Shop:</span><span className="text-blue-600 font-bold truncate max-w-[120px]">{material.shop_name || "Multiple Vendors"}</span><span className="text-slate-300">•</span>
                                                                        <span className="text-slate-400 font-semibold">Code:</span><span className="text-blue-600 font-bold font-mono">{material.code || material.id?.slice(0, 8)}</span><span className="text-slate-300">•</span>
                                                                        <span className="text-slate-400 font-semibold">Brand:</span><span className="text-violet-600 font-bold">{material.brandName || material.brand_name || (material as any).brandname || '-'}</span><span className="text-slate-300">•</span>
                                                                        <span className="text-slate-400 font-semibold">Model:</span><span className="text-emerald-600 font-bold">{material.modelNumber || material.model_number || (material as any).modelnumber || '-'}</span>
                                                                        {material.hsn_code && <><span className="text-slate-300">•</span><span className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200 text-[9px] font-bold">HSN: {material.hsn_code}</span></>}
                                                                        {material.sac_code && <><span className="text-slate-300">•</span><span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200 text-[9px] font-bold">SAC: {material.sac_code}</span></>}
                                                                    </div>
                                                                    <div className={`text-[10px] flex items-center gap-1 font-medium mt-1 ${!material.created_at ? 'text-muted-foreground' :
                                                                        differenceInDays(new Date(), new Date(material.created_at)) > 90 ? 'text-amber-600 bg-amber-50 px-1 py-0.5 rounded-sm inline-flex w-fit border border-amber-200' : 'text-green-600'
                                                                        }`}>
                                                                        {material.created_at ? (
                                                                            <>
                                                                                {differenceInDays(new Date(), new Date(material.created_at)) > 90 ? '⚠️' : '🗓️'}
                                                                                Price Added On {format(new Date(material.created_at), 'dd/MM/yyyy')}
                                                                                ({differenceInDays(new Date(), new Date(material.created_at))} days ago)
                                                                            </>
                                                                        ) : (
                                                                            'No date recorded'
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <div className="text-right shrink-0">
                                                                    <div className="text-xs font-black text-slate-800">₹{material.rate?.toLocaleString()}</div>
                                                                    <div className={`text-[10px] font-bold mt-0.5 ${isSelected ? "text-primary" : "text-muted-foreground group-hover:text-primary"} transition-colors`}>{isSelected ? "Added" : "+ Add to list"}</div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Selected Materials */}
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between px-2">
                                            <h3 className="text-sm font-black uppercase tracking-widest text-blue-600 flex items-center gap-2"><Check className="h-4 w-4" /> Selected Materials ({selectedMaterials.length})</h3>
                                            {selectedMaterials.length > 0 && !isReadOnly && <Button variant="ghost" size="sm" onClick={() => setSelectedMaterials([])} className="text-[10px] font-bold text-red-500 hover:text-red-600 hover:bg-red-50 h-7">Clear All</Button>}
                                        </div>
                                        <div className="rounded-2xl border-2 border-dashed border-blue-100 bg-blue-50/20 min-h-[450px] max-h-[600px] overflow-y-auto p-4">
                                            {selectedMaterials.length === 0 ? (
                                                <div className="flex flex-col items-center justify-center h-[400px] text-center space-y-3 p-6">
                                                    <div className="h-16 w-16 rounded-full bg-blue-50 flex items-center justify-center"><Plus className="h-8 w-8 text-blue-300" /></div>
                                                    <p className="text-sm font-semibold text-blue-400">No materials selected yet</p>
                                                    <p className="text-xs text-muted-foreground max-w-[200px]">Click on materials from the left panel to add them to your configuration.</p>
                                                </div>
                                            ) : (
                                                <div className="space-y-2">
                                                    {selectedMaterials.map(material => (
                                                        <div key={material.id} className="flex items-center justify-between p-3 bg-white rounded-xl border-2 border-blue-100 shadow-sm hover:border-blue-300 transition-all group animate-in slide-in-from-right-4 duration-300">
                                                            <div className="flex flex-col min-w-0 pr-4">
                                                                <span className="font-bold text-slate-800 text-sm truncate">{material.name}</span>
                                                                <div className="flex items-center gap-2 mt-0.5">
                                                                    <Badge variant="outline" className="text-[9px] h-4 px-1 bg-blue-50/50 text-blue-600 font-bold border-blue-100">{material.unit}</Badge>
                                                                    {material.is_project_pricing && (
                                                                        <Badge className="bg-amber-500 hover:bg-amber-600 text-white text-[9px] px-1.5 py-0 h-4 uppercase tracking-wider">PP</Badge>
                                                                    )}
                                                                    <span className="text-[10px] text-muted-foreground font-medium truncate">{material.shop_name}</span>
                                                                </div>
                                                                <div className="flex flex-wrap items-center gap-1 text-[10px] mt-0.5">
                                                                    <span className="text-slate-400 font-semibold uppercase">Code:</span>
                                                                    <span className="text-blue-600 font-bold font-mono">{material.code || material.id?.slice(0, 8)}</span>
                                                                    <span className="text-slate-300">•</span>
                                                                    <span className="text-slate-400 font-semibold uppercase">Brand:</span>
                                                                    <span className="text-violet-600 font-bold">{material.brandName || material.brand_name || (material as any).brandname || '-'}</span>
                                                                    <span className="text-slate-300">•</span>
                                                                    <span className="text-slate-400 font-semibold uppercase">Model:</span>
                                                                    <span className="text-emerald-600 font-bold">{material.modelNumber || material.model_number || (material as any).modelnumber || '-'}</span>
                                                                </div>
                                                                <div className={`text-[9px] flex items-center gap-1 font-medium mt-1 ${!material.created_at ? 'text-muted-foreground' :
                                                                    differenceInDays(new Date(), new Date(material.created_at)) > 90 ? 'text-amber-600 bg-amber-50 px-1 py-0.5 rounded-sm inline-flex w-fit border border-amber-200' : 'text-green-600'
                                                                    }`}>
                                                                    {material.created_at ? (
                                                                        <>
                                                                            {differenceInDays(new Date(), new Date(material.created_at)) > 90 ? '⚠️' : '🗓️'}
                                                                            Added {format(new Date(material.created_at), 'dd/MM/yy')}
                                                                        </>
                                                                    ) : (
                                                                        'No date'
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-2 shrink-0">
                                                                <span className="text-xs font-black text-slate-700">₹{material.rate?.toLocaleString()}</span>
                                                                <Button variant="ghost" size="sm" onClick={() => toggleMaterial(material)} disabled={isReadOnly} className="h-8 w-8 p-0 text-red-400 hover:text-red-600 hover:bg-red-50 group-hover:scale-110 transition-transform"><Trash2 className="h-4 w-4" /></Button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-8 mt-4 border-t border-dashed">
                                    <Button variant="outline" size="sm" onClick={() => setStep(step - 1)} className="w-full sm:w-auto px-8 h-10 border-slate-200 font-bold uppercase tracking-wide"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
                                    <div className="flex items-center gap-6 w-full sm:w-auto">
                                        <div className="flex flex-col items-end">
                                            <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase leading-none mb-1">Total Selected</p>
                                            <p className="text-sm font-black text-primary leading-none">{selectedMaterials.length} Items</p>
                                        </div>
                                        <Button size="sm" onClick={nextStep} disabled={selectedMaterials.length === 0} className="w-full sm:w-auto h-12 px-12 bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest shadow-xl shadow-primary/20 transition-all hover:scale-[1.02]">
                                            Continue <ArrowRight className="ml-2 h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Step 3 */}
                        {step === 3 && (
                            <div className="space-y-8">
                                {/* Read-only banner with Request Edit button */}
                                {isReadOnly && (
                                    <div className="bg-amber-50 border-2 border-amber-200 p-5 rounded-xl flex flex-col sm:flex-row items-start sm:items-center gap-4 animate-in fade-in slide-in-from-top-4 duration-500 shadow-sm">
                                        <div className="flex items-start gap-3 flex-1">
                                            <Lock className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" />
                                            <div>
                                                <h4 className="font-bold text-amber-800 uppercase text-xs tracking-wider mb-1">Configuration Locked</h4>
                                                <p className="text-sm text-amber-700 font-medium">
                                                    {loadedConfig?.status === "approved"
                                                        ? "This configuration has been approved and can no longer be edited. To make changes, you must request edit access."
                                                        : "This configuration has been submitted and is pending approval. It can no longer be edited."}
                                                </p>
                                            </div>
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={async () => {
                                                if (!confirm(`Are you sure you want to request edit access for "${configName || 'this configuration'}"?`)) return;
                                                try {
                                                    const approvalRecord = productApprovals.find((a: any) => a.config_name === configName && (a.status === "approved"));
                                                    let res;
                                                    if (approvalRecord) {
                                                        res = await apiFetch(`/api/product-approvals/${approvalRecord.id}/request-edit`, { method: "POST" });
                                                    } else {
                                                        res = await apiFetch(`/api/product-approvals/request-edit`, {
                                                            method: "POST",
                                                            headers: { "Content-Type": "application/json" },
                                                            body: JSON.stringify({
                                                                product_id: selectedProduct?.id,
                                                                config_name: configName
                                                            })
                                                        });
                                                    }
                                                    if (res.ok) {
                                                        toast({ title: "Edit Requested", description: `Your request to edit "${configName}" has been submitted. You'll be notified when it's approved.` });
                                                        if (selectedProduct) fetchPreviousConfigs(selectedProduct.id);
                                                    } else {
                                                        const errData = await res.json().catch(() => ({}));
                                                        toast({ title: "Error", description: errData.message || "Failed to submit edit request.", variant: "destructive" });
                                                    }
                                                } catch (err) {
                                                    console.error(err);
                                                    toast({ title: "Error", description: "Failed to submit edit request.", variant: "destructive" });
                                                }
                                            }}
                                            className="h-10 text-amber-700 border-amber-300 hover:bg-amber-100 font-bold px-5 shadow-sm shrink-0 gap-2"
                                        >
                                            <Lock className="h-4 w-4" /> Request Edit
                                        </Button>
                                    </div>
                                )}

                                {rejectedConfigs.some(rc => rc.config_name === configName) && (
                                    <div className="bg-red-50 border-2 border-red-200 p-4 rounded-xl flex items-start gap-3 animate-in fade-in slide-in-from-top-4 duration-500">
                                        <XCircle className="h-6 w-6 text-red-600 shrink-0 mt-0.5" />
                                        <div>
                                            <h4 className="font-bold text-red-800 uppercase text-xs tracking-wider mb-1">Rejection Reason</h4>
                                            <p className="text-sm text-red-700 font-medium">{rejectedConfigs.find(rc => rc.config_name === configName)?.rejection_reason || "No specific reason provided."}</p>
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-6">
                                    <div className="flex flex-col md:flex-row items-center justify-between gap-6 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-6 rounded-2xl border-2 border-primary/10 shadow-sm">
                                        <div className="flex items-center gap-4">
                                            <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/20">
                                                <Layers className="h-6 w-6" />
                                            </div>
                                            <div>
                                                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">Configuration For</h3>
                                                <p className="text-2xl font-extrabold text-slate-900">{selectedProduct?.name}</p>
                                            </div>
                                        </div>
                                        <div className="flex flex-col md:flex-row items-center md:items-end gap-8">
                                            <div className="flex items-center gap-3 bg-white px-3 py-1.5 rounded-lg border shadow-sm">
                                                <span className="text-[10px] font-black text-muted-foreground uppercase tracking-tighter">Compact View</span>
                                                <Checkbox checked={compactMode} onCheckedChange={val => setCompactMode(!!val)} />
                                            </div>
                                            <div className="text-center md:text-right">
                                                <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1">Total Cost (for {baseRequiredQty} {requiredUnitType})</h3>
                                                <p className="text-3xl font-black text-slate-900">₹{totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                            </div>
                                            <div className="text-center md:text-right bg-primary/5 px-6 py-3 rounded-xl border border-primary/20">
                                                <h3 className="text-[10px] font-black text-primary uppercase tracking-widest mb-1">Final Rate per {requiredUnitType}</h3>
                                                <p className="text-4xl font-black text-primary">₹{(totalCost / (baseRequiredQty || 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-6 gap-4 p-6 bg-white rounded-xl border shadow-sm items-end">
                                        <LabeledField label="Unit Type">
                                            <Select value={requiredUnitType} onValueChange={(val: string) => setRequiredUnitType(val)} disabled={isReadOnly}>
                                                <SelectTrigger className="font-bold"><SelectValue placeholder="Select unit" /></SelectTrigger>
                                                <SelectContent className="max-h-[300px] overflow-y-auto">
                                                    {availableUnitTypes.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </LabeledField>
                                        <div className="md:col-span-5 space-y-2">
                                            <label className="text-xs font-bold uppercase text-muted-foreground">Product Description</label>
                                            <Textarea placeholder="Enter a description..." value={productDescription} onChange={e => setProductDescription(e.target.value)} disabled={isReadOnly} className="min-h-[80px] font-medium" />
                                        </div>
                                        {([["Dim A", dimA, setDimA], ["Dim B", dimB, setDimB], ["Dim C", dimC, setDimC]] as const).map(([label, val, setter]: any) => (
                                            <LabeledField key={label} label={label}>
                                                <Input type="number" value={val ?? ""} onChange={e => setter(e.target.value ? Number(e.target.value) : undefined)} placeholder={label.split(" ")[1]} disabled={isReadOnly} className="font-bold" />
                                            </LabeledField>
                                        ))}
                                        <LabeledField label="Basis Qty">
                                            <Input type="number" value={baseRequiredQty} onChange={e => setBaseRequiredQty(Number(e.target.value) || 0)} disabled={isReadOnly} className="font-bold bg-muted/30" />
                                        </LabeledField>
                                        <LabeledField label="Wastage %">
                                            <Input type="number" value={wastagePctDefault} onChange={e => { const v = Number(e.target.value) || 0; setWastagePctDefault(v); setConfigMaterials(prev => prev.map(m => m.applyWastage ? { ...m, wastagePct: v } : m)); }} disabled={isReadOnly} className="font-bold border-orange-200" />
                                        </LabeledField>
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold uppercase text-muted-foreground invisible">Actions</label>
                                            <Dialog>
                                                <DialogTrigger asChild>
                                                    <Button variant="outline" size="sm" disabled={isReadOnly} className="w-full h-10 px-4 text-xs font-bold text-primary border-primary hover:bg-primary/10 transition-all flex items-center justify-center gap-2"><Plus className="h-4 w-4" /> Add Item</Button>
                                                </DialogTrigger>
                                                <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
                                                    <DialogHeader><DialogTitle className="text-xl font-bold">Add Additional Materials</DialogTitle></DialogHeader>
                                                    <div className="relative my-4">
                                                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                                        <Input placeholder="Search materials by name or code..." className="pl-10 h-10" value={step3MaterialSearch} onChange={e => setStep3MaterialSearch(e.target.value)} />
                                                    </div>
                                                    <div className="overflow-y-auto border rounded-xl flex-1">
                                                        <Table>
                                                            <TableHeader className="bg-muted/50 sticky top-0 z-10">
                                                                <TableRow>
                                                                    <TableHead className="font-bold">Material Name</TableHead>
                                                                    <TableHead className="font-bold">Unit</TableHead>
                                                                    <TableHead className="font-bold">Shop</TableHead>
                                                                    <TableHead className="text-right font-bold pr-6">Action</TableHead>
                                                                </TableRow>
                                                            </TableHeader>
                                                            <TableBody>
                                                                {loadingMaterials ? (
                                                                    <TableRow><TableCell colSpan={4} className="text-center py-10"><Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" /></TableCell></TableRow>
                                                                ) : (uniqueMaterials || []).filter(m => {
                                                                    return fuzzySearch(step3MaterialSearch, [m.name || "", m.code || ""]);
                                                                }).map(material => (
                                                                    <TableRow key={material.id} className="hover:bg-muted/10">
                                                                        <TableCell className="font-medium">
                                                                            <div className="flex items-center gap-2">
                                                                                <span>{material.name}</span>
                                                                                {material.is_project_pricing && (
                                                                                    <Badge className="bg-amber-500 hover:bg-amber-600 text-white text-[9px] px-1.5 py-0 h-4 uppercase tracking-wider">
                                                                                        Project Pricing
                                                                                    </Badge>
                                                                                )}
                                                                            </div>
                                                                            <div className="text-[10px] text-muted-foreground">Code: {material.code || material.id}</div>
                                                                        </TableCell>
                                                                        <TableCell>{material.unit || "-"}</TableCell>
                                                                        <TableCell>{material.shop_name || "-"}</TableCell>
                                                                        <TableCell className="text-right pr-4">
                                                                            <Button size="sm" variant="outline" className="h-8 text-xs font-bold border-primary text-primary hover:bg-primary hover:text-white"
                                                                                onClick={() => {
                                                                                    if (configMaterials.some(m => m.id === material.id)) { toast({ title: "Already Added", description: "This material is already in your configuration.", variant: "destructive" }); return; }
                                                                                    const rate = Number(material.rate) || 0;
                                                                                    const newItem: SelectedMaterial = { ...material, qty: 1, baseQty: 1, wastagePct: wastagePctDefault, amount: rate, rate, supplyRate: rate, installRate: 0, location: material.technicalspecification || material.name || "", description: material.technicalspecification || material.name || "", applyWastage: true, applyRounding: true, freezeAndEdit: false, shop_id: material.shop_id || material.shopId, shopId: material.shop_id || material.shopId };
                                                                                    setConfigMaterials(prev => [...prev, newItem]);
                                                                                    setSelectedMaterials(prev => [...prev, material]);
                                                                                    toast({ title: "Material Added", description: `${material.name} added to configuration.` });
                                                                                }}>Add</Button>
                                                                        </TableCell>
                                                                    </TableRow>
                                                                ))}
                                                            </TableBody>
                                                        </Table>
                                                    </div>
                                                </DialogContent>
                                            </Dialog>
                                        </div>
                                    </div>

                                    <div className="rounded-xl border shadow-sm overflow-hidden bg-white">
                                        <Table>
                                            <TableHeader className="bg-muted/30">
                                                <TableRow>
                                                    <TableHead className="w-[30px]"></TableHead>
                                                    {["Sl", "", "Item", "Shop", "Item Description", "Unit"].map((h, i) => (
                                                        <TableHead key={i} className={`font-bold ${i < 2 ? "w-[40px]" : i === 2 ? "py-4" : i === 3 ? "w-[100px]" : i === 4 ? "w-[120px]" : "w-[60px]"}`}>{h}</TableHead>
                                                    ))}
                                                    <TableHead className="w-[120px] font-bold text-center">Qty / {baseRequiredQty} {requiredUnitType}</TableHead>
                                                    <TableHead className="w-[120px] font-bold">Rate / Material Unit</TableHead>
                                                    {!compactMode && (
                                                        <>
                                                            <TableHead className="w-[110px] font-bold">Base Amount</TableHead>
                                                            <TableHead className="w-[70px] font-bold">
                                                                <div className="flex flex-col items-center gap-1">
                                                                    <span className="text-[10px]">Wastage</span>
                                                                    <Checkbox checked={configMaterials.length > 0 && configMaterials.every(m => m.applyWastage)} onCheckedChange={checked => setConfigMaterials(prev => prev.map(m => ({ ...m, applyWastage: !!checked })))} disabled={isReadOnly} />
                                                                </div>
                                                            </TableHead>
                                                            <TableHead className="w-[70px] font-bold">
                                                                <div className="flex flex-col items-center gap-1">
                                                                    <span className="text-[10px]">Round Off</span>
                                                                    <Checkbox checked={configMaterials.length > 0 && configMaterials.every(m => m.applyRounding)} onCheckedChange={checked => setConfigMaterials(prev => prev.map(m => ({ ...m, applyRounding: !!checked })))} disabled={isReadOnly} />
                                                                </div>
                                                            </TableHead>
                                                            <TableHead className="w-[80px] font-bold">Wastage %</TableHead>
                                                            <TableHead className="w-[80px] font-bold">Wastage Qty</TableHead>
                                                            <TableHead className="w-[90px] font-bold">Total Qty</TableHead>
                                                        </>
                                                    )}
                                                    <TableHead className="w-[80px] font-bold">
                                                        <div className="flex flex-col items-center gap-1">
                                                            <span className="text-[10px] text-center leading-tight">Freeze &<br />Edit</span>
                                                        </div>
                                                    </TableHead>
                                                    <TableHead className="w-[90px] font-bold">Final Amount</TableHead>
                                                    {!compactMode && <TableHead className="w-[90px] font-bold">Per {requiredUnitType} Qty</TableHead>}
                                                </TableRow>
                                            </TableHeader>
                                            <Reorder.Group as="tbody" axis="y" values={configMaterials} onReorder={isReadOnly ? () => { } : setConfigMaterials}>
                                                {boqResults.computed.map((m, idx) => {
                                                    const baseAmt = m.baseQty * (m.supplyRate + m.installRate);
                                                    const isFreezed = !!m.freezeAndEdit;
                                                    return (
                                                        <Reorder.Item key={m.id} value={configMaterials.find(cm => cm.id === m.id) || m} drag={!isReadOnly ? "y" : false} as="tr" className={`hover:bg-muted/5 transition-colors cursor-default border-b ${isFreezed ? 'bg-cyan-100 border-cyan-200' : 'bg-white'}`}>
                                                            <TableCell className="text-center cursor-grab active:cursor-grabbing">
                                                                {!isReadOnly && <GripVertical className="h-4 w-4 text-muted-foreground/40" />}
                                                            </TableCell>
                                                            <TableCell className="text-center font-medium text-[10px]">{idx + 1}</TableCell>
                                                            <TableCell className="text-center">
                                                                <Button variant="ghost" size="sm" onClick={() => removeConfigMaterial(m.id!)} disabled={isReadOnly} className="h-6 w-6 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"><span className="text-xs font-bold">×</span></Button>
                                                            </TableCell>
                                                            <TableCell className="font-semibold text-[10px] whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px]">
                                                                <TooltipProvider>
                                                                    <Tooltip>
                                                                        <TooltipTrigger asChild>
                                                                            <span className="cursor-help flex items-center gap-1">
                                                                                {m.name}
                                                                                {m.is_project_pricing && (
                                                                                    <Badge className="bg-amber-500 hover:bg-amber-600 text-white text-[8px] px-1 py-0 h-3 uppercase tracking-wider ml-1">PP</Badge>
                                                                                )}
                                                                            </span>
                                                                        </TooltipTrigger>
                                                                        <TooltipContent className="max-w-[300px] break-words">
                                                                            <p className="text-xs font-bold">{m.name}</p>
                                                                        </TooltipContent>
                                                                    </Tooltip>
                                                                </TooltipProvider>
                                                            </TableCell>
                                                            <TableCell className="text-[10px] whitespace-nowrap overflow-hidden text-ellipsis max-w-[100px]">{m.shop_name || "N/A"}</TableCell>
                                                            <TableCell>
                                                                <TooltipProvider delayDuration={300}>
                                                                    <Tooltip>
                                                                        <TooltipTrigger asChild>
                                                                            <div className="w-full">
                                                                                <Input value={m.location} onChange={e => updateConfig(m.id!, "location", e.target.value)} disabled={isReadOnly} className="h-8 border-muted text-[10px] px-2 truncate" />
                                                                            </div>
                                                                        </TooltipTrigger>
                                                                        {m.location && (
                                                                            <TooltipContent className="max-w-xs break-words whitespace-normal text-xs p-3">
                                                                                {m.location}
                                                                            </TooltipContent>
                                                                        )}
                                                                    </Tooltip>
                                                                </TooltipProvider>
                                                            </TableCell>
                                                            <TableCell className="text-[10px] font-medium">{m.unit}</TableCell>
                                                            <TableCell><div className="flex justify-center"><Input type="number" value={m.baseQty} onChange={e => updateConfig(m.id!, "baseQty", Number(e.target.value))} disabled={isReadOnly} className="h-8 border-muted text-[11px] px-2 font-bold w-20 text-center" /></div></TableCell>
                                                            <TableCell className="text-[10px] font-bold">₹{(m.supplyRate + m.installRate).toLocaleString()}</TableCell>
                                                            {!compactMode && (
                                                                <>
                                                                    <TableCell className="text-[10px] font-bold">₹{baseAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                                                    <TableCell className="text-center"><Checkbox checked={!!m.applyWastage} onCheckedChange={checked => updateConfig(m.id!, "applyWastage", !!checked)} disabled={isReadOnly} /></TableCell>
                                                                    <TableCell className="text-center"><Checkbox checked={!!m.applyRounding} onCheckedChange={checked => updateConfig(m.id!, "applyRounding", !!checked)} disabled={isReadOnly} /></TableCell>
                                                                    <TableCell><Input type="number" value={m.wastagePct ?? ""} onChange={e => updateConfig(m.id!, "wastagePct", e.target.value ? Number(e.target.value) : undefined)} placeholder="Global" disabled={isReadOnly} className="h-8 border-orange-200 text-[10px] px-2 font-bold w-full" /></TableCell>
                                                                    <TableCell className="text-[10px] font-bold text-orange-600">{m.wastageQty.toFixed(2)}</TableCell>
                                                                    <TableCell className="text-[10px] font-bold">{m.roundOffQty.toFixed(2)}</TableCell>
                                                                </>
                                                            )}
                                                            <TableCell className="text-center">
                                                                <Checkbox checked={!!m.freezeAndEdit} onCheckedChange={checked => updateConfig(m.id!, "freezeAndEdit", !!checked)} disabled={isReadOnly} />
                                                            </TableCell>
                                                            <TableCell className="text-[10px] font-bold text-blue-600">₹{m.lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                                            {!compactMode && <TableCell className="text-[10px] font-bold text-primary">{m.perUnitQty.toFixed(4)}</TableCell>}
                                                        </Reorder.Item>
                                                    );
                                                })}
                                                <TableRow className="bg-muted/20 font-black">
                                                    <TableCell colSpan={compactMode ? 10 : 16} className="text-right py-3 pr-4">Total (Incl. Wastage)</TableCell>
                                                    <TableCell className="text-[11px] text-primary">₹{totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                                    {!compactMode && <TableCell></TableCell>}
                                                </TableRow>
                                                <TableRow className="bg-primary/5 font-black border-t-2 border-primary/20">
                                                    <TableCell colSpan={compactMode ? 10 : 16} className="text-right py-4 pr-4 text-primary uppercase tracking-widest text-xs">Rate per {requiredUnitType}</TableCell>
                                                    <TableCell className="text-sm text-primary font-black underline decoration-primary decoration-2 underline-offset-8">₹{(totalCost / (baseRequiredQty || 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                                    {!compactMode && <TableCell></TableCell>}
                                                </TableRow>
                                            </Reorder.Group>
                                        </Table>
                                    </div>

                                    {/* Price Update Notice above footer */}
                                    {activeMismatches.length > 0 && (
                                        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1.5">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-1.5">
                                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                                                    <span className="text-[11px] font-bold text-amber-800">Price Update Available — {activeMismatches.length} material{activeMismatches.length > 1 ? 's' : ''} updated in library</span>
                                                </div>
                                                <button onClick={handleUpdateAllRates} disabled={isUpdatingRates} className="flex items-center gap-1 px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold rounded transition-colors disabled:opacity-50 shrink-0">
                                                    {isUpdatingRates ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                                    Update All ({activeMismatches.length})
                                                </button>
                                            </div>
                                            {activeMismatches.map((m) => (
                                                <div key={`${m.materialId}-${m.index}`} className="flex items-center justify-between gap-2 bg-white border border-amber-100 rounded px-2.5 py-1.5">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                                                        <span className="text-[11px] font-semibold text-slate-800 truncate">{m.name}</span>
                                                        <span className="text-[10px] text-slate-400 line-through shrink-0">₹{m.oldRate.toLocaleString()}</span>
                                                        <span className="text-[11px] font-bold text-green-700 shrink-0">₹{m.newRate.toLocaleString()}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        <button onClick={() => handleUpdateSingleRate(m)} className="text-[10px] font-bold px-2 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded border border-amber-200 transition-colors">Update</button>
                                                        <button onClick={() => handleIgnoreMismatch(m)} className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded border border-slate-200 transition-colors">Ignore</button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-6 mt-4 border-t">
                                        <div className="flex items-center gap-3 w-full sm:w-auto">
                                            <Button variant="outline" size="sm" onClick={() => setStep(step - 1)} className="w-full sm:w-auto px-6 h-10"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Selection</Button>
                                            <Button variant="outline" size="sm" onClick={() => { resetSelection(); setStep(1); setSelectedProduct(null); }} className="w-full sm:w-auto px-6 h-10 border-blue-400 text-blue-700 hover:bg-blue-50">+ Add Another Product</Button>
                                        </div>
                                        <div className="flex items-center gap-3 w-full sm:w-auto">
                                            <Button variant="outline" size="sm" onClick={handleSaveDraft} disabled={isSaving || configMaterials.length === 0 || isReadOnly} className="w-full sm:w-auto h-10 border-orange-400 text-orange-700 hover:bg-orange-50 px-6">
                                                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Save Draft"}
                                            </Button>
                                            <Button size="sm" onClick={handleSaveInPlace} disabled={isSaving || configMaterials.length === 0 || isReadOnly} className="w-full sm:w-auto h-10 bg-green-600 hover:bg-green-700 text-white font-bold px-6 transition-all shadow-md">
                                                {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting...</> : "Submit for Approval"}
                                            </Button>
                                            <Button size="sm" onClick={nextStep} className="w-full sm:w-auto h-10 bg-primary hover:bg-primary/90 text-white font-bold px-6 transition-all">Continue to Review <ArrowRight className="ml-2 h-4 w-4" /></Button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Step 4 */}
                        {step === 4 && (
                            <div className="space-y-8 animate-in fade-in duration-500">
                                <div className="grid grid-cols-2 gap-8 py-4 px-6 bg-muted/30 rounded-xl border border-dashed border-muted-foreground/30">
                                    <div>
                                        <p className="text-[10px] font-black uppercase text-muted-foreground mb-1">Product Configuration For</p>
                                        <p className="text-xl font-bold uppercase">{selectedProduct?.name}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] font-black uppercase text-muted-foreground mb-1">Category / Subcategory</p>
                                        <p className="text-lg font-bold">{selectedCategory} <span className="text-muted-foreground mx-1">/</span> {selectedSubcategory}</p>
                                    </div>
                                </div>
                                <div className="overflow-x-auto border-2 border-black rounded-sm shadow-xl">
                                    <table className="w-full border-collapse">
                                        <thead>
                                            <tr className="bg-white text-black text-[11px] font-black uppercase tracking-widest border-b border-black">
                                                {["S.No", "Item", "Location", "Description", "Unit", "Qty"].map((h, i) => (
                                                    <th key={h} rowSpan={2} className={`border border-black p-3 ${i === 0 ? "text-center w-[50px]" : i === 2 ? "text-center w-[120px]" : i >= 4 ? `text-center w-[${i === 4 ? 80 : 80}px]` : "text-left"}`}>{h}</th>
                                                ))}
                                                <th colSpan={2} className="border border-black p-3 text-center border-b-0">Rate (INR)</th>
                                                <th colSpan={2} className="border border-black p-3 text-center border-b-0">Amount (INR)</th>
                                            </tr>
                                            <tr className="bg-white text-black text-[9px] font-black uppercase tracking-widest border-t border-black">
                                                {["Supply", "Installation", "Supply", "Installation"].map(h => (
                                                    <th key={h} className="border border-black p-2 text-right w-[100px]">{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white">
                                            <tr className="text-[12px] border-b border-black/10 hover:bg-muted/10 transition-colors">
                                                <td className="border-r border-black p-3 text-center font-bold">1</td>
                                                <td className="border-r border-black p-3 font-black text-xs uppercase">{selectedProduct?.name}</td>
                                                <td className="border-r border-black p-3 text-center italic">Main Area</td>
                                                <td className="border-r border-black p-3 text-[10px] text-muted-foreground leading-tight truncate max-w-[200px]">
                                                    <TooltipProvider delayDuration={300}>
                                                        <Tooltip>
                                                            <TooltipTrigger className="truncate w-full text-left cursor-default">
                                                                {productDescription || `Consolidated configuration for ${selectedProduct?.name}`}
                                                            </TooltipTrigger>
                                                            <TooltipContent className="max-w-xs break-words whitespace-normal text-xs p-3">
                                                                {productDescription || `Consolidated configuration for ${selectedProduct?.name}`}
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                </td>
                                                <td className="border-r border-black p-3 text-center font-bold text-xs">{requiredUnitType}</td>
                                                <td className="border-r border-black p-3 text-center font-black">{baseRequiredQty}</td>
                                                <td className="border-r border-black p-3 text-right font-bold">₹{boqResults.totalSupply.toLocaleString()}</td>
                                                <td className="border-r border-black p-3 text-right font-bold">₹{boqResults.totalInstall.toLocaleString()}</td>
                                                <td className="border-r border-black p-3 text-right font-black text-primary">₹{boqResults.totalSupply.toLocaleString()}</td>
                                                <td className="border-black p-3 text-right font-black text-primary">₹{boqResults.totalInstall.toLocaleString()}</td>
                                            </tr>
                                        </tbody>
                                        <tfoot className="bg-black/5">
                                            <tr className="border-t-2 border-black font-black">
                                                <td colSpan={8} className="p-4 text-right uppercase tracking-tighter">Grand Total Amount (INR)</td>
                                                <td colSpan={2} className="p-4 text-right pr-6 text-xl text-primary bg-primary/5 border-l border-black/10">₹{totalCost.toLocaleString()}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                                <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-8 mt-8 border-t border-black/10">
                                    <Button variant="outline" size="sm" onClick={() => setStep(step - 1)} className="w-full sm:w-auto px-6 h-10 font-bold uppercase tracking-wide" disabled={isSaving}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
                                    <div className="flex items-center gap-3 w-full sm:w-auto">
                                        {isReadOnly && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={async () => {
                                                    if (!confirm(`Request edit access for "${configName || 'this configuration'}"?`)) return;
                                                    try {
                                                        const approvalRecord = productApprovals.find((a: any) => a.config_name === configName && (a.status === "approved"));
                                                        let res;
                                                        if (approvalRecord) {
                                                            res = await apiFetch(`/api/product-approvals/${approvalRecord.id}/request-edit`, { method: "POST" });
                                                        } else {
                                                            res = await apiFetch(`/api/product-approvals/request-edit`, {
                                                                method: "POST",
                                                                headers: { "Content-Type": "application/json" },
                                                                body: JSON.stringify({
                                                                    product_id: selectedProduct?.id,
                                                                    config_name: configName
                                                                })
                                                            });
                                                        }
                                                        if (res.ok) {
                                                            toast({ title: "Edit Requested", description: `Your request to edit "${configName}" has been submitted.` });
                                                            if (selectedProduct) fetchPreviousConfigs(selectedProduct.id);
                                                        } else {
                                                            const errData = await res.json().catch(() => ({}));
                                                            toast({ title: "Error", description: errData.message || "Failed to submit edit request.", variant: "destructive" });
                                                        }
                                                    } catch (err) {
                                                        console.error(err);
                                                        toast({ title: "Error", description: "Failed to submit edit request.", variant: "destructive" });
                                                    }
                                                }}
                                                className="w-full sm:w-auto h-10 text-amber-700 border-amber-300 hover:bg-amber-100 font-bold px-6 uppercase tracking-wide transition-all shadow-sm gap-2"
                                            >
                                                <Lock className="h-4 w-4" /> Request Edit
                                            </Button>
                                        )}
                                        <Button size="sm" onClick={handleSave} disabled={isSaving || isReadOnly} className="w-full sm:w-auto h-10 bg-blue-600 hover:bg-blue-700 text-white font-bold px-8 uppercase tracking-wide transition-all shadow-md">
                                            {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Finalizing...</> : "Add to Create BOQ"}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}

                    </CardContent>
                </Card>
            </div>

            {/* Template Selector Dialog */}
            <Dialog open={showTemplateSelector} onOpenChange={setShowTemplateSelector}>
                <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-6 overflow-hidden">
                    <DialogHeader className="pb-4 border-b">
                        <DialogTitle className="text-xl font-bold flex items-center gap-2">
                            <Layers className="h-5 w-5 text-primary" />
                            Select Product Template
                        </DialogTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                            Choose an image from existing templates for <strong>{productForTemplate?.name}</strong>.
                        </p>
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto py-6 pr-2">
                        {templates.filter(tpl =>
                            !productForTemplate?.subcategory ||
                            (tpl.subcategory && tpl.subcategory.toLowerCase().trim() === productForTemplate.subcategory.toLowerCase().trim())
                        ).length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed rounded-2xl bg-muted/20">
                                <Search className="h-12 w-12 text-muted-foreground opacity-20 mb-4" />
                                <p className="text-base font-bold text-muted-foreground">No templates available</p>
                                <p className="text-sm text-muted-foreground opacity-60">No templates found matching this product's subcategory: <em>{productForTemplate?.subcategory}</em></p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                                {templates.filter(tpl =>
                                    !productForTemplate?.subcategory ||
                                    (tpl.subcategory && tpl.subcategory.toLowerCase().trim() === productForTemplate.subcategory.toLowerCase().trim())
                                ).map((template: any) => {
                                    const templateImgs = parseImages(template.image);
                                    const tplImg = templateImgs.length > 0 ? templateImgs[0] : null;
                                    const productImgs = parseImages(productForTemplate?.image);
                                    const isSelected = tplImg && productImgs.length > 0 && productImgs[0] === tplImg;

                                    return (
                                        <div
                                            key={template.id}
                                            className={`
                                                relative cursor-pointer border-2 rounded-2xl p-4 flex flex-col items-center gap-3 transition-all animate-in zoom-in-95 duration-200
                                                ${isSelected ? 'border-primary bg-primary/5 ring-4 ring-primary/10 shadow-lg' : 'border-border bg-white hover:border-primary/50 hover:shadow-md'}
                                            `}
                                            onClick={async () => {
                                                if (tplImg) {
                                                    await updateProductImage(productForTemplate!.id, tplImg);
                                                    setShowTemplateSelector(false);
                                                } else {
                                                    toast({ title: "No Image", description: "This template has no image.", variant: "destructive" });
                                                }
                                            }}
                                        >
                                            <div className="w-full aspect-square rounded-xl bg-slate-50 border flex items-center justify-center overflow-hidden shadow-inner group-hover:shadow transition-shadow">
                                                {tplImg ? (
                                                    <img src={tplImg} alt="" className="max-w-full max-h-full object-contain p-2" />
                                                ) : (
                                                    <Layers className="h-10 w-10 text-slate-200" />
                                                )}
                                            </div>
                                            <div className="text-center w-full">
                                                <p className="text-xs font-bold truncate text-slate-700" title={template.name}>{template.name}</p>
                                                <p className="text-[10px] text-muted-foreground mt-1 font-semibold uppercase tracking-widest">{template.code}</p>
                                            </div>
                                            {isSelected && (
                                                <div className="absolute -top-2 -right-2 bg-primary text-white rounded-full p-1 shadow-lg ring-2 ring-white">
                                                    <Check className="h-3 w-3" />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="pt-4 border-t flex justify-end">
                        <Button variant="outline" onClick={() => setShowTemplateSelector(false)} className="px-8 font-bold">Close</Button>
                    </div>
                </DialogContent>
            </Dialog>
        </LayoutComponent>
    );
}