import { useLocation } from "wouter";
import {
  LayoutDashboard,
  Package,
  MessageSquare,
  LogOut,
  Menu,
  X,
  FileText,
  Hammer,
  Settings,
  ChevronRight,
  Truck,
  MapPin,
  ShoppingBag,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";

interface SupplierLayoutProps {
  children: React.ReactNode;
  shopName?: string;
  shopLocation?: string;
  shopApproved?: boolean;
}

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/supplier/dashboard" },
  { label: "My Materials", icon: ShoppingBag, path: "/supplier/my-materials" },
  { label: "Manage Materials", icon: Package, path: "/supplier/materials" },
  { label: "Proposal", icon: FileText, path: "/proposal" },
  { label: "Sketch a Plan", icon: Hammer, path: "/sketch-plans" },
  { label: "Manage Product", icon: Settings, path: "/admin/manage-product" },
  { label: "Messages", icon: MessageSquare, path: "/supplier/support" },
];

export function SupplierLayout({
  children,
  shopName = "My Shop",
  shopLocation = "",
  shopApproved = false,
}: SupplierLayoutProps) {
  const [location, setLocation] = useLocation();
  const { logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = () => {
    logout();
    setLocation("/");
  };

  const navigate = (path: string) => {
    setLocation(path);
    setMobileOpen(false);
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Brand Section */}
      <div className="px-5 py-6 border-b border-white/10 mb-4">
        <div className="flex flex-col gap-1">
          <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded bg-white/10 backdrop-blur-md border border-white/20 w-fit">
            <span className="text-[9px] font-bold uppercase tracking-wider text-white/90">Vendor Portal</span>
          </div>
          <h2 className="text-lg font-bold text-white leading-tight truncate tracking-tight mt-2">{shopName}</h2>
          {shopLocation && (
            <div className="flex items-center gap-2 mt-1 opacity-60">
              <div className="w-1 h-1 rounded-full bg-fuchsia-300" />
              <p className="text-[10px] font-medium text-white/70 truncate uppercase tracking-wider">{shopLocation}</p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation Section */}
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto custom-scrollbar">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.path || location.startsWith(item.path + "/");
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium
                transition-all duration-200 group relative
                ${isActive
                  ? "bg-white/20 backdrop-blur-md border border-white/25 text-white shadow-lg shadow-fuchsia-500/10"
                  : "text-white/60 hover:bg-white/10 hover:text-white border border-transparent"
                }
              `}
            >
              <Icon
                size={16}
                strokeWidth={isActive ? 2 : 1.5}
                className={isActive ? "text-white" : "text-white/50 group-hover:text-white/80"}
              />
              <span className="flex-1 text-left tracking-tight">{item.label}</span>
              {isActive && (
                <ChevronRight size={12} className="opacity-70" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Logout Section */}
      <div className="px-3 py-4 border-t border-white/10">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium text-white/50 hover:bg-rose-500/20 hover:text-rose-200 transition-all duration-200 group"
        >
          <LogOut size={16} strokeWidth={2} />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="supplier-portal relative flex h-screen overflow-hidden bg-gradient-to-br from-[#1e1339] via-[#3b1359] to-[#5b1a63]">
      {/* Decorative blurred glass orbs (purely visual, sit behind everything) */}
      <div className="pointer-events-none absolute -top-24 -left-24 w-96 h-96 rounded-full bg-fuchsia-500/25 blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 -right-32 w-[28rem] h-[28rem] rounded-full bg-violet-500/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-1/4 w-80 h-80 rounded-full bg-indigo-500/20 blur-3xl" />

      {/* ── Desktop Sidebar (always visible) ── */}
      <aside className="hidden lg:flex flex-col w-60 flex-shrink-0 bg-white/10 backdrop-blur-2xl border-r border-white/10 shadow-2xl shadow-black/20 relative z-10">
        <SidebarContent />
      </aside>

      {/* ── Mobile Overlay ── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile Drawer ── */}
      <aside
        className={`
          fixed top-0 left-0 h-full w-72 bg-white/10 backdrop-blur-2xl border-r border-white/10 z-50
          transform transition-transform duration-500 cubic-bezier(0.4, 0, 0.2, 1) lg:hidden
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="flex items-center justify-between px-6 py-6 border-b border-white/10">
          <span className="text-[10px] font-black text-white/60 uppercase tracking-widest">Navigation Menu</span>
          <button onClick={() => setMobileOpen(false)} className="p-2 bg-white/10 border border-white/15 text-white/70 hover:text-white rounded-xl transition-all">
            <X size={20} />
          </button>
        </div>
        <SidebarContent />
      </aside>

      {/* ── Main Content ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10">
        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center gap-4 px-6 py-4 bg-white/10 backdrop-blur-xl border-b border-white/10 flex-shrink-0 shadow-lg">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2.5 bg-white/10 border border-white/15 text-white/80 hover:text-white rounded-xl active:scale-95 transition-all"
          >
            <Menu size={20} />
          </button>
          <div className="min-w-0">
            <p className="text-sm font-black text-white truncate tracking-tight">{shopName}</p>
            {shopLocation && <p className="text-[10px] font-bold text-fuchsia-200 uppercase tracking-widest truncate">{shopLocation}</p>}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-[#FDFDFD] min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}