import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Building2,
  BrickWall,
  DoorOpen,
  Cloud,
  Layers,
  PaintBucket,
  Blinds,
  Zap,
  Droplets,
  Hammer,
  ShieldAlert,
  Menu,
  X,
  LogOut,
  Settings,
  Package,
  MessageSquare,
  CheckCircle2,
  ShoppingCart,
  AlertCircle,
  Users,
  Tags,
  FolderKanban,
  Truck,
  FileText,
  ClipboardCheck,
  BookOpen,
  ShieldCheck,
  Eye,
  EyeOff,
  RotateCcw,
  Edit3,
  Archive,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useData } from "@/lib/store";
import apiFetch from "@/lib/api";

type SubcategoryItem = {
  id: string;
  name: string;
  href: string | null;
  icon: string;
  category: string;
};

const iconMap: Record<string, any> = {
  BrickWall: BrickWall,
  DoorOpen: DoorOpen,
  Cloud: Cloud,
  Layers: Layers,
  PaintBucket: PaintBucket,
  Blinds: Blinds,
  Zap: Zap,
  Droplets: Droplets,
  Hammer: Hammer,
  ShieldAlert: ShieldAlert,
};

const estimatorItems = [
  { icon: BrickWall, label: "Civil ", href: "/estimators/civil-wall" },
  { icon: DoorOpen, label: "Doors", href: "/estimators/doors" },
  { icon: Cloud, label: "False Ceiling", href: "/estimators/false-ceiling" },
  { icon: Layers, label: "Flooring", href: "/estimators/flooring" },
  { icon: PaintBucket, label: "Painting", href: "/estimators/painting" },
  { icon: Blinds, label: "Blinds", href: "/estimators/blinds" },
  { icon: Zap, label: "Electrical", href: "/estimators/electrical" },
  { icon: Droplets, label: "Plumbing", href: "/estimators/plumbing" },
  //{ icon: Hammer, label: "MS Work", href: "/estimators/ms-work" },
  //{ icon: Hammer, label: "SS Work", href: "/estimators/ss-work" },
  //{ icon: ShieldAlert, label: "Fire-Fighting", href: "/estimators/fire-fighting" },
];

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export function Sidebar({ isOpen, setIsOpen }: SidebarProps) {
  const [location, setLocation] = useLocation();
  const [estSearch, setEstSearch] = useState("");
  const [subcategories, setSubcategories] = useState<SubcategoryItem[]>([]);
  const [loadingSubcategories, setLoadingSubcategories] = useState(true);
  const { user, logout, supportMessages, materialApprovalRequests } = useData();
  const [alertsCount, setAlertsCount] = useState(0);

  // --- Sidebar Hiding Logic ---
  const [hiddenItems, setHiddenItems] = useState<Set<string>>(new Set());
  const [isEditMode, setIsEditMode] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("sidebar_hidden_items");
    if (saved) {
      try {
        setHiddenItems(new Set(JSON.parse(saved)));
      } catch (e) {
        console.error("Failed to parse hidden items", e);
      }
    }
  }, []);

  const toggleHideItem = (e: React.MouseEvent, itemKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    setHiddenItems(prev => {
      const next = new Set(prev);
      if (next.has(itemKey)) next.delete(itemKey);
      else next.add(itemKey);
      localStorage.setItem("sidebar_hidden_items", JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const resetHiddenItems = () => {
    if (confirm("Show all hidden sidebar items?")) {
      setHiddenItems(new Set());
      localStorage.removeItem("sidebar_hidden_items");
    }
  };

  const SidebarNavItem = ({ href, icon: Icon, label, badge, count, adminTab, id, condition = true }: {
    href: string | null;
    icon: any;
    label: string;
    badge?: React.ReactNode;
    count?: number;
    adminTab?: string;
    id: string;
    condition?: boolean;
  }) => {
    if (!isVisible(id, condition)) return null;
    if (!href) return null;
    const isHidden = hiddenItems.has(id);
    if (isHidden && !isEditMode) return null;

    const currentTab = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("tab");
    const isActive = adminTab ? currentTab === adminTab : location === href;

    return (
      <Link href={href} onClick={(e) => {
        if ((window as any).isSketchPlanDirty) {
          if (!window.confirm("⚠️ WARNING: You have UNSAVED changes! ⚠️\n\nClick 'Cancel' to STAY on this page so you can save your work.\nClick 'OK' to DISCARD your changes and exit.")) {
            e.preventDefault();
            return;
          }
        }
      }}>
        <span
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors mb-2 cursor-pointer group relative",
            isActive
              ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
              : "text-sidebar-foreground hover:bg-sidebar-accent",
            isHidden && "opacity-40 grayscale-[0.5]"
          )}
          onClick={closeSidebarOnMobile}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="truncate flex-1">{label}</span>
          {count !== undefined && count > 0 && (
            <Badge variant="destructive" className="ml-auto pointer-events-none">
              {count}
            </Badge>
          )}
          {badge && !count && <span className="ml-auto">{badge}</span>}

          <button
            onClick={(e) => toggleHideItem(e, id)}
            className={cn(
              "p-1 rounded-full bg-black/10 hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/20 transition-all",
              isEditMode ? "opacity-100 scale-100" : "opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100"
            )}
            title={isHidden ? "Unhide" : "Hide"}
          >
            {isHidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          </button>
        </span>
      </Link>
    );
  };
  // ----------------------------

  const closeSidebarOnMobile = () => {
    if (window.innerWidth < 768) {
      setIsOpen(false);
    }
  };

  // Custom permission state (dynamic access control)
  const [customModules, setCustomModules] = useState<Set<string>>(new Set());
  const [isCustomManaged, setIsCustomManaged] = useState(false);

  // Helper: returns true if the module is allowed.
  // Full access for admin and software_team; others filter if managed by admin.
  const isVisible = (moduleKey: string, defaultCondition: boolean): boolean => {
    if (user?.role === 'admin' || user?.role === 'software_team') return true;
    if (user?.role === 'pre_sales' && moduleKey === 'dashboard') return true;
    if (isCustomManaged) return customModules.has(moduleKey);
    return defaultCondition;
  };



  // Fetch custom permissions for the current user
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const fetchPerms = () => {
      apiFetch('/api/my-permissions')
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          setIsCustomManaged(!!data.isCustomManaged);
          setCustomModules(new Set(data.modules || []));
        })
        .catch(() => {
          if (!cancelled) {
            setIsCustomManaged(false);
            setCustomModules(new Set());
          }
        });
    };

    fetchPerms();

    const handlePermissionsUpdated = (e: any) => {
      if (e.detail?.userId === user.id) {
        fetchPerms();
      }
    };
    window.addEventListener('permissions_updated', handlePermissionsUpdated);

    return () => {
      cancelled = true;
      window.removeEventListener('permissions_updated', handlePermissionsUpdated);
    };
  }, [user]);



  // Fetch pending counts from API
  const [pendingShopCount, setPendingShopCount] = useState(0);
  const [pendingMaterialCount, setPendingMaterialCount] = useState(0);
  const [pendingProductCount, setPendingProductCount] = useState(0);
  const [pendingBomCount, setPendingBomCount] = useState(0);
  const [pendingBoqCount, setPendingBoqCount] = useState(0);
  const [messageCount, setMessageCount] = useState(0);

  // Fetch subcategories from API
  useEffect(() => {
    const loadSubcategories = async () => {
      try {
        setLoadingSubcategories(true);
        const response = await apiFetch("/api/sidebar-subcategories", {
          headers: {},
        });
        if (response.ok) {
          const data = await response.json();
          const items = data.subcategories || [];

          // Map subcategories to items with icons
          const mappedItems = items.map((item: SubcategoryItem) => ({
            ...item,
            icon: iconMap[item.icon] || Layers,
          }));

          setSubcategories(mappedItems);
        }
      } catch (error) {
        console.warn("Failed to load subcategories:", error);
        // Fallback to predefined items if API fails
        setSubcategories(estimatorItems.map(item => ({
          id: item.label,
          name: item.label,
          href: item.href,
          icon: Object.entries(iconMap).find(([_, icon]) => icon === item.icon)?.[0] || "Layers",
          category: "Estimators",
        })));
      } finally {
        setLoadingSubcategories(false);
      }
    };

    loadSubcategories();

    // Refresh subcategories every 30 seconds to pick up new database entries
    const interval = setInterval(loadSubcategories, 30000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiFetch('/alerts');
        if (!res || !res.ok) return setAlertsCount(0);
        const data = await res.json();
        if (cancelled) return;
        const list = data?.alerts || data || [];
        setAlertsCount(Array.isArray(list) ? list.length : 0);
      } catch (e) {
        console.warn('load alerts count failed', e);
        setAlertsCount(0);
      }
    };

    load();
    const iv = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/shops-pending-approval");
        if (res.ok) {
          const data = await res.json();
          setPendingShopCount(
            (data?.shops || []).filter((r: any) => r.status === "pending")
              .length,
          );
        }
      } catch (e) {
        console.warn("load shop count failed", e);
      }
    })();
  }, []);

  // fetch pending product approvals count
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiFetch("/api/product-approvals");
        if (!res || !res.ok) return setPendingProductCount(0);
        const data = await res.json();
        if (cancelled) return;
        setPendingProductCount((data?.approvals || []).filter((a: any) => a.status === "pending").length || 0);
      } catch (e) {
        console.warn("load product approval count failed", e);
        setPendingProductCount(0);
      }
    };

    load();
    const iv = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // fetch pending BOM and BOQ approvals counts
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiFetch("/api/bom-approvals");
        if (!res || !res.ok) {
          setPendingBomCount(0);
          setPendingBoqCount(0);
          return;
        }
        const data = await res.json();
        if (cancelled) return;

        const allApprovals = data?.approvals || [];
        const isPending = (a: any) => a.status === "pending_approval" || a.status === "submitted" || a.status === "edit_requested";

        setPendingBomCount(allApprovals.filter((a: any) => isPending(a) && (a.type === 'bom' || !a.type)).length);
        setPendingBoqCount(allApprovals.filter((a: any) => isPending(a) && a.type === 'boq').length);
      } catch (e) {
        console.warn("load BOM/BOQ approval counts failed", e);
        setPendingBomCount(0);
        setPendingBoqCount(0);
      }
    };

    load();
    const iv = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // derive material pending count from central store (keeps counts consistent)
  useEffect(() => {
    try {
      if (!materialApprovalRequests) {
        setPendingMaterialCount(0);
        return;
      }
      setPendingMaterialCount(
        (materialApprovalRequests || []).filter(
          (r: any) => r.status === "pending",
        ).length,
      );
    } catch (e) {
      console.warn("compute material pending count failed", e);
      setPendingMaterialCount(0);
    }
  }, [materialApprovalRequests]);

  // derive message count from store-loaded support messages (prefer unread count)
  useEffect(() => {
    try {
      if (!supportMessages) {
        setMessageCount(0);
        return;
      }
      // count unread messages for admin view, otherwise count messages sent by the user
      const unread = (supportMessages || []).filter(
        (m: any) => m.is_read === false,
      ).length;
      setMessageCount(unread || (supportMessages || []).length);
    } catch (e) {
      console.warn("compute message count failed", e);
      setMessageCount(0);
    }
  }, [supportMessages]);

  const handleLogout = () => {
    logout();
    setLocation("/");
  };

  const isAdminOrSoftware =
    user?.role === "admin" || user?.role === "software_team";
  const isPreSales = user?.role === "pre_sales";
  const isContractor = user?.role === "contractor";
  const isAdminOrSoftwareOrPurchaseTeam =
    user?.role === "admin" ||
    user?.role === "software_team" ||
    user?.role === "purchase_team";
  const isSupplierOrPurchase =
    user?.role === "supplier" || user?.role === "purchase_team";
  const isPurchaseTeam = user?.role === "purchase_team";
  const isProductManager = user?.role === "product_manager";
  const isFinance = user?.role === "finance_team";
  const isClient = user?.role === "user";
  const isVoltAmpele = user?.username === "VoltAmpele@gmail.com";

  // ✅ Supplier approval visible ONLY for admin
  const isAdminOnly = user?.role === "admin";

  // ✅ Create BOQ and Create Project visible for ADMIN, SOFTWARE TEAM and PRE_SALES
  const canCreateBOQAndProject =
    user?.role === "admin" || user?.role === "software_team" || isPreSales;

  const getAdminTab = () => {
    if (typeof window === "undefined") return null;
    return new URL(window.location.href).searchParams.get("tab");
  };

  const currentAdminTab = getAdminTab();

  const filteredEstimators = estSearch
    ? subcategories.filter((item: any) =>
      (item.name || item.label).toLowerCase().includes(estSearch.toLowerCase()),
    )
    : subcategories;

  return (
    <>
      {/* Mobile/Desktop Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-30 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Toggle Button (Trigger) when closed */}
      {!isOpen && (
        <Button
          variant="ghost"
          size="icon"
          className="fixed top-4 left-4 z-50 bg-background shadow-sm border hover:bg-accent"
          onClick={() => setIsOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 transform bg-sidebar border-r border-sidebar-border transition-transform duration-300 ease-in-out flex flex-col shadow-xl md:shadow-none",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between px-4 border-b border-sidebar-border bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-slate-900 dark:to-slate-800">
          <h1 className="text-xl font-bold tracking-tight text-sidebar-primary font-heading">
            BUILD<span className="text-foreground">ESTIMATE</span>
          </h1>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8 hover:bg-black/5 dark:hover:bg-white/5", isEditMode && "text-sidebar-primary bg-sidebar-primary/10")}
              onClick={() => setIsEditMode(!isEditMode)}
              title={isEditMode ? "Exit Edit Mode" : "Manage Sidebar items"}
            >
              <Settings className={cn("h-4 w-4 transition-transform duration-500", isEditMode && "rotate-90 text-sidebar-primary")} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
              onClick={() => setIsOpen(false)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {/* Edit Mode Controls */}
          {isEditMode && (
            <div className="px-3 py-2 mb-4 bg-sidebar-primary/5 rounded-md border border-sidebar-primary/10 shadow-inner">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black uppercase tracking-tight text-sidebar-primary">Manage Sidebar</span>
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-sidebar-primary/30 text-sidebar-primary font-bold">Edit Mode</Badge>
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px] w-full justify-start font-bold border-white/30 text-white hover:bg-white/10 hover:text-white"
                  onClick={resetHiddenItems}
                >
                  <RotateCcw className="h-3 w-3 mr-2" /> Reset All Hidden
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 text-[10px] w-full bg-sidebar-primary hover:bg-sidebar-primary/90 text-white font-bold"
                  onClick={() => setIsEditMode(false)}
                >
                  <CheckCircle2 className="h-3 w-3 mr-2 text-white" /> Finish Editing
                </Button>
              </div>
            </div>
          )}

          {/* Overview Section */}
          {!isVoltAmpele && (isPreSales || isVisible('dashboard', !isContractor && user?.role !== "supplier" && !isProductManager) || isVisible('project_dashboard', isAdminOrSoftware) || isVisible('alerts', isAdminOnly) || isAdminOnly) && (
            <>
              <div className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Overview
              </div>
              <SidebarNavItem
                id="dashboard"
                href="/dashboard"
                icon={LayoutDashboard}
                label="Dashboard"
                condition={!isContractor && !isProductManager}
              />
              <SidebarNavItem
                id="project_dashboard"
                href="/project-dashboard"
                icon={FolderKanban}
                label="Project Dashboard"
                condition={isAdminOrSoftware}
              />
              <SidebarNavItem
                id="alerts"
                href="/admin/dashboard?tab=alerts"
                icon={AlertCircle}
                label="Alerts"
                count={alertsCount}
                adminTab="alerts"
                condition={isAdminOnly}
              />
              <SidebarNavItem
                id="access_control"
                href="/admin/access-control"
                icon={ShieldCheck}
                label="Access Control"
                condition={isAdminOnly}
              />
              <SidebarNavItem
                id="spy"
                href="/admin/spy"
                icon={Eye}
                label="Spy (Activity Log)"
                condition={isAdminOrSoftware}
              />
            </>
          )}

          {/* Creations Section */}
          {(isVisible('create_item', isAdminOrSoftwareOrPurchaseTeam && !isPreSales && !isContractor && !isProductManager && !isVoltAmpele) ||
            isVisible('create_product', isAdminOrSoftwareOrPurchaseTeam || isPreSales || isProductManager || isVoltAmpele) ||
            isVisible('create_project', canCreateBOQAndProject && !isProductManager && !isVoltAmpele) ||
            isVisible('create_vendor_category', isAdminOrSoftwareOrPurchaseTeam && !isPreSales && !isContractor && !isProductManager) ||
            isVisible('sketch_plan', canCreateBOQAndProject)) && (
              <>
                <div className="px-3 mb-2 mt-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Creations
                </div>
                <SidebarNavItem
                  id="create_item"
                  href="/admin/dashboard?tab=materials"
                  icon={Package}
                  label="Create Item"
                  adminTab="materials"
                  condition={isAdminOrSoftwareOrPurchaseTeam && !isPreSales && !isContractor && !isProductManager && !isVoltAmpele}
                />
                <SidebarNavItem
                  id="create_product"
                  href="/admin/dashboard?tab=create-product"
                  icon={Package}
                  label="Create Product"
                  adminTab="create-product"
                  condition={isAdminOrSoftwareOrPurchaseTeam || isPreSales || isProductManager || isContractor || isVoltAmpele}
                />
                <SidebarNavItem
                  id="create_project"
                  href="/create-project"
                  icon={Building2}
                  label="Create Project"
                  condition={canCreateBOQAndProject && !isProductManager && !isVoltAmpele}
                />
                <SidebarNavItem
                  id="create_vendor_category"
                  href="/admin/vendor-categories"
                  icon={Tags}
                  label="Create Vendor Category"
                  condition={isAdminOrSoftwareOrPurchaseTeam && !isPreSales && !isContractor && !isProductManager}
                />
                <SidebarNavItem
                  id="sketch_plan"
                  href="/sketch-plans"
                  icon={Hammer}
                  label="Sketch a Plan"
                  condition={canCreateBOQAndProject}
                />
              </>
            )}

          {/* Management Section */}
          {(isVisible('manage_product', isAdminOrSoftware) ||
            isVisible('manage_materials', isAdminOrSoftware && !isPreSales && !isContractor && !isProductManager) ||
            isVisible('manage_shops', isAdminOrSoftware && !isPreSales && !isContractor && !isProductManager) ||
            isVisible('manage_categories', isAdminOrSoftware && !isPreSales && !isContractor && !isProductManager) ||
            isVisible('bulk_upload', isAdminOrSoftware && !isPreSales && !isContractor && !isProductManager)) && (
              <>
                <div className="px-3 mb-2 mt-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Management
                </div>
                <SidebarNavItem
                  id="manage_product"
                  href="/admin/manage-product"
                  icon={Package}
                  label="Manage Product"
                  condition={isAdminOrSoftware}
                />
                <SidebarNavItem
                  id="manage_materials"
                  href="/admin/manage-materials"
                  icon={Package}
                  label="Manage Materials"
                  condition={!isVoltAmpele && isAdminOrSoftware && !isPreSales && !isContractor && !isProductManager}
                />
                <SidebarNavItem
                  id="manage_shops"
                  href="/admin/dashboard?tab=shops"
                  icon={Building2}
                  label="Manage Shops"
                  adminTab="shops"
                  condition={!isVoltAmpele && isAdminOrSoftware && !isPreSales && !isContractor && !isProductManager}
                />
                <SidebarNavItem
                  id="manage_categories"
                  href="/admin/manage-categories"
                  icon={Tags}
                  label="Manage Categories"
                  condition={!isVoltAmpele && isAdminOrSoftware && !isPreSales && !isContractor && !isProductManager}
                />
                <SidebarNavItem
                  id="bulk_upload"
                  href="/admin/bulk-material-upload"
                  icon={Package}
                  label="Bulk Upload"
                  condition={!isVoltAmpele && isAdminOrSoftware && !isPreSales && !isContractor && !isProductManager}
                />

              </>
            )}

          {/* BOQ / Projects Section */}
          {(isVisible('generate_bom', isAdminOrSoftware || isPreSales || isProductManager || isPurchaseTeam) ||
            isVisible('generate_po', (isAdminOrSoftware || isPreSales || isProductManager || isPurchaseTeam) && !isProductManager) ||
            isVisible('finalize_boq', isAdminOrSoftware || isFinance)) && (
              <>
                <div className="px-3 mb-2 mt-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  BOQ / Projects
                </div>
                <SidebarNavItem
                  id="generate_bom"
                  href="/create-bom"
                  icon={ShoppingCart}
                  label="Generate BOM"
                  condition={isAdminOrSoftware || isPreSales || isProductManager || isPurchaseTeam}
                />
                <SidebarNavItem
                  id="generate_po"
                  href="/generate-po"
                  icon={FileText}
                  label="Generate PO"
                  condition={(isAdminOrSoftware || isPreSales || isProductManager || isPurchaseTeam) && !isProductManager}
                />
                <SidebarNavItem
                  id="finalize_boq"
                  href="/finalize-bom"
                  icon={CheckCircle2}
                  label="Finalize BOQ"
                  condition={isAdminOrSoftware || isFinance}
                />
              </>
            )}

          {/* Site Management Section */}
          {(user?.role === "admin" || user?.role === "software_team" || user?.role === "site_engineer") && (
            <>
              <div className="px-3 mb-2 mt-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Site Management
              </div>
              <SidebarNavItem
                id="site_reports"
                href="/site-reports"
                icon={FileText}
                label="Site Reports"
              />
            </>
          )}

          {/* Procurement Section */}
          {(isVisible('purchase_orders', isAdminOrSoftware || isPurchaseTeam) ||
            isVisible('delivery_tracker', isAdminOrSoftware || isPurchaseTeam || user?.role === 'site_engineer') ||
            isVisible('po_approvals', isAdminOrSoftware)) && (
              <>
                <div className="px-3 mb-2 mt-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Procurement
                </div>
                <SidebarNavItem
                  id="purchase_orders"
                  href="/purchase-orders"
                  icon={FileText}
                  label="Purchase Orders"
                  condition={isAdminOrSoftware || isPurchaseTeam}
                />
                <SidebarNavItem
                  id="delivery_tracker"
                  href="/delivery-tracker"
                  icon={Truck}
                  label="Delivery Tracker"
                  condition={isAdminOrSoftware || isPurchaseTeam || user?.role === 'site_engineer'}
                />
                <SidebarNavItem
                  id="po_approvals"
                  href="/po-approvals"
                  icon={ClipboardCheck}
                  label="PO Approvals"
                  condition={isAdminOrSoftware}
                />
              </>
            )}

          {/* PO Requests Section */}
          {(isVisible('raise_po_request', !isVoltAmpele && !isContractor && user?.role !== "supplier") ||
            isVisible('my_po_requests', !isVoltAmpele && !isContractor && user?.role !== "supplier") ||
            isVisible('pending_approvals', isAdminOrSoftware) ||
            isVisible('approved_requests', isAdminOrSoftware)) && (
              <>
                <div className="px-3 mb-2 mt-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  PO Requests
                </div>
                <SidebarNavItem
                  id="raise_po_request"
                  href="/raise-po-request"
                  icon={FileText}
                  label="Raise PO Request"
                  badge={<Badge variant="outline" className="ml-auto text-[9px] px-1 py-0 h-3.5 border-amber-200 bg-amber-50 text-amber-700 font-medium tracking-wide">Under Const.</Badge>}
                  condition={!isVoltAmpele && !isContractor && user?.role !== "supplier"}
                />
                <SidebarNavItem
                  id="my_po_requests"
                  href="/my-po-requests"
                  icon={ClipboardCheck}
                  label="My Requests"
                  badge={<Badge variant="outline" className="ml-auto text-[9px] px-1 py-0 h-3.5 border-amber-200 bg-amber-50 text-amber-700 font-medium tracking-wide">Under Const.</Badge>}
                  condition={!isVoltAmpele && !isContractor && user?.role !== "supplier"}
                />
              </>
            )}

          {/* Approvals Section */}
          {(isVisible('shop_approvals', (isAdminOrSoftwareOrPurchaseTeam || isProductManager) && !isPreSales && !isContractor && !isProductManager) ||
            isVisible('material_approvals', (isAdminOrSoftwareOrPurchaseTeam || isProductManager) && !isPreSales && !isContractor && !isProductManager) ||
            isVisible('supplier_approvals', (isAdminOrSoftwareOrPurchaseTeam || isProductManager) && !isPreSales && !isContractor && isAdminOnly) ||
            isVisible('product_approvals', (isAdminOrSoftwareOrPurchaseTeam || isProductManager) && !isPreSales && !isContractor && (isAdminOrSoftware || isProductManager)) ||
            isVisible('bom_approvals', (isAdminOrSoftwareOrPurchaseTeam || isProductManager) && !isPreSales && !isContractor && isAdminOrSoftware) ||
            isVisible('boq_approvals', isAdminOrSoftware)) && (
              <>
                <div className="px-3 mb-2 mt-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Approvals
                </div>
                <SidebarNavItem
                  id="shop_approvals"
                  href="/admin/dashboard?tab=approvals"
                  icon={ShieldAlert}
                  label="Shop Approvals"
                  count={pendingShopCount}
                  adminTab="approvals"
                  condition={!isProductManager}
                />
                <SidebarNavItem
                  id="material_approvals"
                  href="/admin/dashboard?tab=material-approvals"
                  icon={CheckCircle2}
                  label="Material Approvals"
                  count={pendingMaterialCount}
                  adminTab="material-approvals"
                  condition={!isProductManager}
                />
                <SidebarNavItem
                  id="supplier_approvals"
                  href="/admin/suppliers"
                  icon={Users}
                  label="Supplier Approvals"
                  condition={isAdminOnly}
                />
                <SidebarNavItem
                  id="product_approvals"
                  href="/admin/product-approvals"
                  icon={FolderKanban}
                  label="Product Approvals"
                  count={pendingProductCount}
                  condition={isAdminOrSoftware || isProductManager}
                />
                <SidebarNavItem
                  id="bom_approvals"
                  href="/admin/bom-approvals"
                  icon={CheckCircle2}
                  label="BOM Approvals"
                  count={pendingBomCount}
                  condition={isAdminOrSoftware}
                />
                <SidebarNavItem
                  id="boq_approvals"
                  href="/admin/boq-approvals"
                  icon={CheckCircle2}
                  label="BOQ Approvals"
                  count={pendingBoqCount}
                  condition={isAdminOrSoftware}
                />
                <SidebarNavItem
                  id="purchase_team_bom_approvals"
                  href="/admin/purchase-team-bom-approvals"
                  icon={CheckCircle2}
                  label="Purchase Team BOM Approvals"
                  condition={isAdminOrSoftware || isPurchaseTeam}
                />
                <SidebarNavItem
                  id="proposal_approvals"
                  href="/admin/proposal-approvals"
                  icon={ClipboardCheck}
                  label="Proposal Approvals"
                  condition={isAdminOrSoftware}
                />
              </>
            )}

          {/* Storage Section */}
          {(user?.role === "admin" || user?.role === "software_team") && (
            <>
              <div className="px-3 mb-2 mt-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Storage
              </div>
              <SidebarNavItem
                id="archive"
                href="/admin/archive"
                icon={Archive}
                label="Archive"
              />
              <SidebarNavItem
                id="trash"
                href="/admin/trash"
                icon={Trash2}
                label="Trash"
              />
            </>
          )}

          {/* Communication Section */}
          {isVisible('support_chat', !isVoltAmpele && isAdminOrSoftwareOrPurchaseTeam && !isPreSales && !isContractor && !isProductManager) && (
            <>
              <div className="px-3 mb-2 mt-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Communication
              </div>
              <SidebarNavItem
                id="support_chat"
                href="/admin/dashboard?tab=messages"
                icon={MessageSquare}
                label="Messages"
                count={messageCount}
                adminTab="messages"
                condition={!isVoltAmpele && isAdminOrSoftwareOrPurchaseTeam && !isPreSales && !isContractor && !isProductManager}
              />
            </>
          )}

          {/* Supplier Role Sections */}
          {!isVoltAmpele && !isPreSales && !isContractor && user?.role === "supplier" && (
            <>
              <div className="px-3 mb-2 mt-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Supplier Portal
              </div>
              <SidebarNavItem
                id="supplier_dashboard"
                href="/dashboard"
                icon={LayoutDashboard}
                label="Dashboard"
              />
              <SidebarNavItem
                id="supplier_manage_materials"
                href="/supplier/materials"
                icon={Package}
                label="Manage Materials"
              />
              <SidebarNavItem
                id="supplier_delivery_tracker"
                href="/delivery-tracker"
                icon={Truck}
                label="Delivery Tracker"
              />
              <SidebarNavItem
                id="supplier_sketch_plan"
                href="/sketch-plans"
                icon={Hammer}
                label="Sketch a Plan"
              />
              <SidebarNavItem
                id="supplier_manage_product"
                href="/admin/manage-product"
                icon={Package}
                label="Manage Product"
              />
              <SidebarNavItem
                id="supplier_proposal"
                href="/proposal"
                icon={FileText}
                label="Proposal"
              />
              <SidebarNavItem
                id="supplier_support"
                href="/supplier/support"
                icon={MessageSquare}
                label="Messages"
              />
            </>
          )}

          {/* Other Resources Section */}
          {(isVisible('subscription', !isVoltAmpele && !isPreSales && !isContractor) ||
            isVisible('user_manual', !isVoltAmpele && !isPreSales && !isContractor)) && (
              <>
                <div className="mt-6 px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Resources
                </div>
                <SidebarNavItem
                  id="subscription"
                  href="/subscription"
                  icon={Package}
                  label="Subscription"
                  condition={!isVoltAmpele && !isPreSales && !isContractor}
                />
                <SidebarNavItem
                  id="user_manual"
                  href="/user-manual"
                  icon={BookOpen}
                  label="User Manual"
                  condition={!isVoltAmpele && !isPreSales && !isContractor}
                />
              </>
            )}

        </nav>

        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-8 w-8 rounded-full bg-sidebar-primary/20 flex items-center justify-center text-sidebar-primary font-bold">
              {((user as any)?.fullName || (user as any)?.username || "")?.charAt(0)?.toUpperCase() || "U"}
            </div>
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-medium text-sidebar-foreground truncate">
                {(user as any)?.fullName || (user as any)?.username || "Guest"}
              </span>
              <span className="text-xs text-muted-foreground truncate capitalize">
                {user?.role?.replace("_", " ") || "Visitor"}
              </span>
            </div>
          </div>
          <Button
            variant="outline"
            className="w-full justify-start text-destructive hover:text-destructive"
            onClick={handleLogout}
          >
            <LogOut className="mr-2 h-4 w-4" /> Log Out
          </Button>
        </div>
      </aside>
    </>
  );
}
