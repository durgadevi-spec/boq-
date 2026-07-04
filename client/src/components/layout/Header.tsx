import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { ChevronDown, Bell, Search, LogOut, Zap } from "lucide-react";
import { useData } from "@/lib/store";
import apiFetch from "@/lib/api";

export function Header() {
  const [, setLocation] = useLocation();
  const { user, logout } = useData();

  // Permission state — same as Sidebar.tsx
  const [customModules, setCustomModules] = useState<Set<string>>(new Set());
  const [isCustomManaged, setIsCustomManaged] = useState(false);
  const [permsLoaded, setPermsLoaded] = useState(false);

  // Approval counts
  const [pendingShopCount, setPendingShopCount] = useState(0);
  const [pendingMaterialCount, setPendingMaterialCount] = useState(0);
  const [pendingProductCount, setPendingProductCount] = useState(0);
  const [pendingBomCount, setPendingBomCount] = useState(0);
  const [pendingBoqCount, setPendingBoqCount] = useState(0);

  // Dropdown state
  const [approvalsOpen, setApprovalsOpen] = useState(false);
  const approvalsRef = useRef<HTMLDivElement>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [alertsCount, setAlertsCount] = useState(0);

  // Easy Access Dropdown state
  const [easyAccessOpen, setEasyAccessOpen] = useState(false);
  const easyAccessRef = useRef<HTMLDivElement>(null);
  
  // Quick Access Items State
  const [easyAccessItems, setEasyAccessItems] = useState<{label: string, href: string}[]>([]);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("quick_access_items");
    if (saved) {
      try {
        setEasyAccessItems(JSON.parse(saved));
      } catch(e) {}
    } else {
      setEasyAccessItems([
        { label: "Create Project", href: "/create-project" },
        { label: "Generate BOM", href: "/create-bom" },
        { label: "Generate PO", href: "/generate-po" },
        { label: "Finalize BOQ", href: "/finalize-bom" },
      ]);
    }
  }, []);

  const saveQuickAccess = (items: {label: string, href: string}[]) => {
    setEasyAccessItems(items);
    localStorage.setItem("quick_access_items", JSON.stringify(items));
  };

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const searchablePages = [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Project Dashboard", href: "/project-dashboard" },
    { label: "Alerts", href: "/admin/dashboard?tab=alerts" },
    { label: "Access Control", href: "/admin/access-control" },
    { label: "Spy (Activity Log)", href: "/admin/spy" },
    { label: "Create Item", href: "/admin/dashboard?tab=materials" },
    { label: "Create Product", href: "/admin/dashboard?tab=create-product" },
    { label: "Create Project", href: "/create-project" },
    { label: "Create Vendor Category", href: "/admin/vendor-categories" },
    { label: "Sketch a Plan", href: "/sketch-plans" },
    { label: "Manage Product", href: "/admin/manage-product" },
    { label: "Manage Materials", href: "/admin/manage-materials" },
    { label: "Manage Shops", href: "/admin/dashboard?tab=shops" },
    { label: "Manage Categories", href: "/admin/manage-categories" },
    { label: "Bulk Upload", href: "/admin/bulk-material-upload" },
    { label: "Generate BOM", href: "/create-bom" },
    { label: "Generate PO", href: "/generate-po" },
    { label: "Finalize BOQ", href: "/finalize-bom" },
    { label: "Site Reports", href: "/site-reports" },
    { label: "Purchase Orders", href: "/purchase-orders" },
    { label: "Delivery Tracker", href: "/delivery-tracker" },
    { label: "PO Approvals", href: "/po-approvals" },
    { label: "Raise PO Request", href: "/raise-po-request" },
    { label: "My PO Requests", href: "/my-po-requests" },
    { label: "Shop Approvals", href: "/admin/dashboard?tab=approvals" },
    { label: "Material Approvals", href: "/admin/dashboard?tab=material-approvals" },
    { label: "Supplier Approvals", href: "/admin/suppliers" },
    { label: "Product Approvals", href: "/admin/product-approvals" },
    { label: "BOM Approvals", href: "/admin/bom-approvals" },
    { label: "BOQ Approvals", href: "/admin/boq-approvals" },
    { label: "Purchase Team BOM", href: "/admin/purchase-team-bom-approvals" },
    { label: "Proposal Approvals", href: "/admin/proposal-approvals" },
    { label: "Archive", href: "/admin/archive" },
    { label: "Trash", href: "/admin/trash" },
    { label: "Support / Messages", href: "/admin/dashboard?tab=messages" },
    { label: "Subscription", href: "/subscription" },
    { label: "User Manual", href: "/user-manual" },
  ];

  const filteredSearchPages = searchablePages.filter(p => p.label.toLowerCase().includes(searchQuery.toLowerCase()));

  // Role helpers — same as Sidebar.tsx
  const isAdmin = user?.role === "admin";
  const isSoftwareTeam = user?.role === "software_team";
  const isPurchaseTeam = user?.role === "purchase_team";
  const isProductManager = user?.role === "product_manager";
  const isPreSales = user?.role === "pre_sales";
  const isContractor = user?.role === "contractor";
  const isAdminOrSoftware = isAdmin || isSoftwareTeam;
  const isAdminOnly = isAdmin;

  // isVisible — same logic as Sidebar.tsx
  const isVisible = (
    moduleKey: string,
    defaultCondition: boolean
  ): boolean => {
    if (!permsLoaded) return false;
    if (isAdmin || isSoftwareTeam) return true;
    if (isCustomManaged) return customModules.has(moduleKey);
    return defaultCondition;
  };

  // Fetch alerts count
  useEffect(() => {
    let cancelled = false;
    const loadAlerts = async () => {
      try {
        const res = await apiFetch("/alerts");
        if (!res || !res.ok) return setAlertsCount(0);
        const data = await res.json();
        if (cancelled) return;
        const list = data?.alerts || data || [];
        setAlertsCount(Array.isArray(list) ? list.length : 0);
      } catch (e) {
        console.warn("load alerts count failed", e);
        setAlertsCount(0);
      }
    };

    loadAlerts();
    const interval = setInterval(loadAlerts, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Fetch permissions — same as Sidebar.tsx
  useEffect(() => {
    setPermsLoaded(false);
    setIsCustomManaged(false);
    setCustomModules(new Set());

    if (!user?.id) return;

    apiFetch("/api/my-permissions")
      .then((r) => r.json())
      .then((data) => {
        setIsCustomManaged(!!data.isCustomManaged);
        setCustomModules(
          new Set(Array.isArray(data.modules) ? data.modules : [])
        );
        setPermsLoaded(true);
      })
      .catch(() => {
        setIsCustomManaged(false);
        setCustomModules(new Set());
        setPermsLoaded(true);
      });
  }, [user?.id]);

  // Fetch approval counts — same as Sidebar.tsx
  useEffect(() => {
    if (!user) return;
    apiFetch("/api/approval-requests")
      .then((r) => r.json())
      .then((data) => {
        setPendingShopCount(Array.isArray(data) ? data.length : 0);
      })
      .catch(() => setPendingShopCount(0));

    apiFetch("/api/material-approval-requests")
      .then((r) => r.json())
      .then((data) => {
        setPendingMaterialCount(Array.isArray(data) ? data.length : 0);
      })
      .catch(() => setPendingMaterialCount(0));

    apiFetch("/api/product-approvals")
      .then((r) => r.json())
      .then((data) => {
        setPendingProductCount(Array.isArray(data) ? data.length : 0);
      })
      .catch(() => setPendingProductCount(0));

    apiFetch("/api/bom-approvals")
      .then((r) => r.json())
      .then((data) => {
        setPendingBomCount(Array.isArray(data) ? data.length : 0);
      })
      .catch(() => setPendingBomCount(0));

    apiFetch("/api/boq-approvals")
      .then((r) => r.json())
      .then((data) => {
        setPendingBoqCount(Array.isArray(data) ? data.length : 0);
      })
      .catch(() => setPendingBoqCount(0));
  }, [user?.id]);

  // Close approvals dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        approvalsRef.current &&
        !approvalsRef.current.contains(e.target as Node)
      ) {
        setApprovalsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Close easy access dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        easyAccessRef.current &&
        !easyAccessRef.current.contains(e.target as Node)
      ) {
        setEasyAccessOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Close approvals dropdown on Escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setApprovalsOpen(false);
    };
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("keydown", handleEsc);
    };
  }, []);

  // Click outside listener to close the user profile dropdown
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // Click outside listener for search bar
  useEffect(() => {
    const handleSearchOutsideClick = (e: MouseEvent) => {
      if (
        searchRef.current &&
        !searchRef.current.contains(e.target as Node)
      ) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handleSearchOutsideClick);
    return () => document.removeEventListener("mousedown", handleSearchOutsideClick);
  }, []);

  const handleLogout = () => {
    logout();
    setLocation("/login");
  };

  const initial = (
    user?.fullName?.[0] ??
    user?.username?.[0] ??
    user?.email?.[0] ??
    "U"
  ).toUpperCase();

  const getRoleBadgeClass = (role?: string) => {
    switch (role) {
      case "admin":
      case "software_team":
        return "bg-purple-100 text-purple-800 border-purple-200";
      case "purchase_team":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "supplier":
        return "bg-green-100 text-green-800 border-green-200";
      case "pre_sales":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  // Build approval items array
  const approvalItems = [
    {
      id: "shop_approvals",
      label: "Shop Approvals",
      href: "/admin/dashboard?tab=approvals",
      count: pendingShopCount,
      show: isVisible("shop_approvals", (isAdminOrSoftware || isPurchaseTeam) && !isPreSales && !isContractor && !isProductManager),
    },
    {
      id: "material_approvals",
      label: "Material Approvals",
      href: "/admin/dashboard?tab=material-approvals",
      count: pendingMaterialCount,
      show: isVisible("material_approvals", (isAdminOrSoftware || isPurchaseTeam) && !isPreSales && !isContractor && !isProductManager),
    },
    {
      id: "supplier_approvals",
      label: "Supplier Approvals",
      href: "/admin/suppliers",
      count: 0,
      show: isVisible("supplier_approvals", isAdminOnly),
    },
    {
      id: "product_approvals",
      label: "Product Approvals",
      href: "/admin/product-approvals",
      count: pendingProductCount,
      show: isVisible("product_approvals", isAdminOrSoftware || isProductManager),
    },
    {
      id: "bom_approvals",
      label: "BOM Approvals",
      href: "/admin/bom-approvals",
      count: pendingBomCount,
      show: isVisible("bom_approvals", isAdminOrSoftware),
    },
    {
      id: "boq_approvals",
      label: "BOQ Approvals",
      href: "/admin/boq-approvals",
      count: pendingBoqCount,
      show: isVisible("boq_approvals", isAdminOrSoftware),
    },
    {
      id: "purchase_team_bom_approvals",
      label: "Purchase Team BOM",
      href: "/admin/purchase-team-bom-approvals",
      count: 0,
      show: isVisible("purchase_team_bom_approvals", isAdminOrSoftware || isPurchaseTeam),
    },
    {
      id: "proposal_approvals",
      label: "Proposal Approvals",
      href: "/admin/proposal-approvals",
      count: 0,
      show: isVisible("proposal_approvals", isAdminOrSoftware),
    },
  ].filter((item) => item.show);

  const totalApprovalCount = approvalItems.reduce(
    (sum, item) => sum + (item.count || 0),
    0
  );

  const showApprovalsButton = permsLoaded && approvalItems.length > 0;


  return (
    <>
    <header className="sticky top-0 z-40 w-full h-12 bg-white border-b border-[#E5E7EB] px-4 flex items-center justify-between no-print">
      {/* CENTER-RIGHT SECTION */}
      <div className="flex items-center gap-2 ml-auto">
        {/* Easy Access Dropdown */}
        <div className="relative" ref={easyAccessRef}>
          <button
            onClick={() => setEasyAccessOpen(!easyAccessOpen)}
            className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium border transition-all duration-150 ${
              easyAccessOpen
                ? "bg-[#FEF3C7] border-[#F59E0B] text-[#D97706]"
                : "bg-transparent border-[#E5E7EB] text-[#374151] hover:bg-[#F3F4F6] hover:border-[#D1D5DB]"
            }`}
          >
            <Zap className={`h-3.5 w-3.5 ${easyAccessOpen ? "text-[#D97706]" : "text-[#9CA3AF]"}`} />
            Quick Access
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-200 ${
                easyAccessOpen ? "rotate-180 text-[#D97706]" : "text-[#9CA3AF]"
              }`}
            />
          </button>

          {/* Dropdown Menu */}
          {easyAccessOpen && (
            <div className="absolute top-10 right-0 w-[200px] bg-white border border-[#E5E7EB] rounded-[10px] shadow-[0_4px_16px_rgba(0,0,0,0.08)] p-1 z-[100] animate-in fade-in-0 zoom-in-95 duration-150">
              <div className="px-3 py-1.5 text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">
                Quick Links
              </div>
              {easyAccessItems.map((item, index) => (
                <button
                  key={index}
                  onClick={() => {
                    setLocation(item.href);
                    setEasyAccessOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3 h-9 rounded-md text-[13px] text-[#374151] hover:bg-[#F3F4F6] hover:text-[#111827] transition-colors duration-100"
                >
                  <span>{item.label}</span>
                </button>
              ))}
              <div className="h-[1px] bg-[#F3F4F6] my-1" />
              <button
                onClick={() => {
                  setEasyAccessOpen(false);
                  setCustomizeOpen(true);
                }}
                className="w-full text-left px-3 py-2 text-[12px] text-[#6366f1] font-medium hover:bg-[#F9FAFB] transition-colors rounded-b-md"
              >
                + Customize Quick Access
              </button>
            </div>
          )}
        </div>

        {/* Approvals Dropdown */}
        {showApprovalsButton && (
          <div className="relative" ref={approvalsRef}>
            {/* Approvals Button */}
            <button
              onClick={() => setApprovalsOpen(!approvalsOpen)}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium border transition-all duration-150 ${
                approvalsOpen
                  ? "bg-[#EDE9FE] border-[#6366f1] text-[#6366f1]"
                  : "bg-transparent border-[#E5E7EB] text-[#374151] hover:bg-[#F3F4F6] hover:border-[#D1D5DB]"
              }`}
            >
              Approvals
              {totalApprovalCount > 0 && (
                <span className="bg-[#EF4444] text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                  {totalApprovalCount}
                </span>
              )}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform duration-200 ${
                  approvalsOpen ? "rotate-180 text-[#6366f1]" : "text-[#9CA3AF]"
                }`}
              />
            </button>

            {/* Dropdown Menu */}
            {approvalsOpen && (
              <div className="absolute top-10 left-0 w-[220px] bg-white border border-[#E5E7EB] rounded-[10px] shadow-[0_4px_16px_rgba(0,0,0,0.08)] p-1 z-[100] animate-in fade-in-0 zoom-in-95 duration-150">
                {approvalItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (item.id === "bom_approvals" && window.location.pathname === "/create-bom") {
                        window.dispatchEvent(new Event("open-bom-approvals"));
                      } else {
                        setLocation(item.href);
                      }
                      setApprovalsOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-3 h-9 rounded-md text-[13px] text-[#374151] hover:bg-[#F3F4F6] hover:text-[#111827] transition-colors duration-100"
                  >
                    <span>{item.label}</span>
                    {item.count > 0 && (
                      <span className="bg-[#EF4444] text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                        {item.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 1. SEARCH BAR */}
        <div className="relative w-[280px]" ref={searchRef}>
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF] pointer-events-none" />
          <input
            type="text"
            placeholder="Search menus (e.g. Finalize BOQ)..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            className="w-full h-8 pl-8 pr-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg text-[13px] text-[#374151] placeholder-[#9CA3AF] focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/10 focus:outline-none transition-all"
          />
          {searchOpen && searchQuery.length > 0 && (
            <div className="absolute top-10 left-0 w-full bg-white border border-[#E5E7EB] rounded-[10px] shadow-[0_4px_16px_rgba(0,0,0,0.08)] py-1 max-h-[300px] overflow-y-auto z-[100] animate-in fade-in-0 zoom-in-95 duration-150">
              {filteredSearchPages.length > 0 ? (
                filteredSearchPages.map((page, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setLocation(page.href);
                      setSearchOpen(false);
                      setSearchQuery("");
                    }}
                    className="w-full text-left px-3 py-2 text-[13px] text-[#374151] hover:bg-[#F3F4F6] hover:text-[#111827] transition-colors"
                  >
                    {page.label}
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-[13px] text-[#9CA3AF]">
                  No results found
                </div>
              )}
            </div>
          )}
        </div>

        {/* 2. NOTIFICATION BELL */}
        <button
          onClick={() => console.log("notifications")}
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[#F3F4F6] transition-colors relative"
          title="Notifications"
        >
          <Bell className="h-4 w-4 text-[#6B7280] hover:text-[#111827] transition-colors" />
          {alertsCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#EF4444] ring-1 ring-white" />
          )}
        </button>

        {/* 3. USER AVATAR & DROPDOWN */}
        <div className="relative" ref={dropdownRef}>
          <div
            onClick={() => setDropdownOpen((prev) => !prev)}
            className="w-7 h-7 rounded-full bg-[#6366f1] text-white flex items-center justify-center text-[11px] font-semibold select-none hover:opacity-85 cursor-pointer uppercase transition-opacity"
            title={user?.fullName || user?.username || "User profile"}
          >
            {initial}
          </div>

          {dropdownOpen && (
            <div className="absolute right-0 top-10 w-[200px] bg-white border border-[#E5E7EB] rounded-[10px] shadow-[0_4px_16px_rgba(0,0,0,0.08)] py-2 z-50">
              <div className="px-3 py-1.5 flex flex-col min-w-0">
                <span className="text-[13px] font-semibold text-[#111827] truncate">
                  {user?.fullName || user?.name || "User"}
                </span>
                <span className="text-[11px] text-[#6B7280] truncate">
                  {user?.username || user?.email || ""}
                </span>
              </div>
              <div className="h-[1px] bg-[#F3F4F6] my-1" />
              <div className="px-3 py-1">
                <span
                  className={`inline-block text-[9px] font-bold px-2 py-0.5 rounded-full border ${getRoleBadgeClass(
                    user?.role
                  )}`}
                >
                  {user?.role?.toUpperCase().replace("_", " ") || "USER"}
                </span>
              </div>
              <div className="h-[1px] bg-[#F3F4F6] my-1" />
              <button
                onClick={handleLogout}
                className="w-full text-left px-3 py-1.5 text-[12px] text-[#EF4444] hover:bg-[#F9FAFB] flex items-center gap-2 transition-colors font-medium"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Log Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
      {customizeOpen && (
        <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl w-[400px] max-h-[80vh] flex flex-col">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className="font-semibold text-[#111827]">Customize Quick Access</h3>
              <button onClick={() => setCustomizeOpen(false)} className="text-[#9CA3AF] hover:text-[#374151]">✕</button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-2">
              {searchablePages.map((page, i) => {
                const isSelected = easyAccessItems.some(item => item.href === page.href);
                return (
                  <label key={i} className="flex items-center gap-3 p-2 hover:bg-[#F9FAFB] rounded-lg cursor-pointer border border-transparent hover:border-[#E5E7EB]">
                    <input 
                      type="checkbox" 
                      className="rounded border-[#D1D5DB] text-[#6366f1] focus:ring-[#6366f1]"
                      checked={isSelected}
                      onChange={(e) => {
                        if (e.target.checked) {
                          saveQuickAccess([...easyAccessItems, page]);
                        } else {
                          saveQuickAccess(easyAccessItems.filter(item => item.href !== page.href));
                        }
                      }}
                    />
                    <span className="text-[13px] text-[#374151]">{page.label}</span>
                  </label>
                )
              })}
            </div>
            <div className="p-4 border-t flex justify-end">
              <button onClick={() => setCustomizeOpen(false)} className="px-4 py-2 bg-[#6366f1] text-white rounded-lg text-[13px] font-medium hover:bg-[#4f46e5]">Done</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
