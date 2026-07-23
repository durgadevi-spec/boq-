import { useState, useEffect } from "react";
import { SupplierLayout } from "@/components/layout/SupplierLayout";
import { useAuth } from "@/lib/auth-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Package,
  Search,
  Loader2,
  Tag,
  Ruler,
  IndianRupee,
  Store,
  ShoppingBag,
  AlertCircle,
  SlidersHorizontal,
  CheckCircle2,
  Clock,
  XCircle,
  LayoutGrid,
  List,
} from "lucide-react";

interface Material {
  id: string;
  name: string;
  code?: string;
  rate?: number | string;
  unit?: string;
  category?: string;
  subcategory?: string;
  brandname?: string;
  modelnumber?: string;
  technicalspecification?: string;
  dimensions?: string;
  finishtype?: string;
  metaltype?: string;
  image?: string;
  shop_name?: string;
  shop_id?: string;
  approved?: boolean | null;
  source?: "material" | "submission";
}

interface Shop {
  id: string;
  name: string;
  location?: string;
}

export default function SupplierMyMaterials() {
  const { user } = useAuth();

  // Shop info for layout
  const [shopName, setShopName] = useState("");
  const [shopLocation, setShopLocation] = useState("");

  // Data
  const [shops, setShops] = useState<Shop[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [selectedShop, setSelectedShop] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};

      // Use the dedicated supplier endpoint that reads from BOTH tables
      const res = await fetch("/api/supplier/my-materials", { headers });
      if (!res.ok) {
        const msg = await res.text();
        setError(`Failed to load materials (${res.status}): ${msg}`);
        return;
      }

      const data = await res.json();
      const mats: Material[] = data.materials || [];
      const fetchedShops: Shop[] = data.shops || [];

      setMaterials(mats);
      setShops(fetchedShops);

      // Set sidebar shop name from first shop
      if (fetchedShops.length > 0) {
        setShopName(fetchedShops[0].name);
        setShopLocation((fetchedShops[0] as any).location || "");
      }
    } catch (err: any) {
      console.error("SupplierMyMaterials load error:", err);
      setError("Unexpected error loading materials.");
    } finally {
      setLoading(false);
    }
  };

  // Derived filter options
  const categories = Array.from(
    new Set(materials.map((m) => m.category).filter(Boolean))
  ).sort() as string[];

  const statusLabel = (m: Material) => {
    if (m.approved === true) return "approved";
    if (m.approved === false) return "rejected";
    return "pending";
  };

  // Filtered list
  const filtered = materials.filter((m) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      (m.name || "").toLowerCase().includes(q) ||
      (m.code || "").toLowerCase().includes(q) ||
      (m.category || "").toLowerCase().includes(q) ||
      (m.brandname || "").toLowerCase().includes(q);

    const matchShop = selectedShop === "all" || m.shop_id === selectedShop;
    const matchCat =
      selectedCategory === "all" || m.category === selectedCategory;
    const matchStatus =
      selectedStatus === "all" || statusLabel(m) === selectedStatus;

    return matchSearch && matchShop && matchCat && matchStatus;
  });

  // Counts for chips
  const approvedCount = materials.filter((m) => m.approved === true).length;
  const pendingCount = materials.filter((m) => m.approved == null).length;
  const rejectedCount = materials.filter((m) => m.approved === false).length;

  return (
    <SupplierLayout
      shopName={shopName}
      shopLocation={shopLocation}
      shopApproved={true}
    >
      <div className="min-h-screen bg-[#FDFDFD]">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">

          {/* ── Header ── */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 text-[9px] font-bold uppercase tracking-wider">
                <ShoppingBag size={10} />
                My Catalog
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                My Materials
              </h1>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">
                All materials under your shop — read-only view.
              </p>
            </div>

            {/* Summary chips */}
            <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
              <div className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold flex items-center gap-1.5 border border-emerald-100">
                <CheckCircle2 size={12} /> {approvedCount} Approved
              </div>
              <div className="px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-xs font-bold flex items-center gap-1.5 border border-amber-100">
                <Clock size={12} /> {pendingCount} Pending
              </div>
              <div className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-bold flex items-center gap-1.5 border border-red-100">
                <XCircle size={12} /> {rejectedCount} Rejected
              </div>
              <div className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-bold flex items-center gap-2">
                <Package size={14} />
                {filtered.length} Shown
              </div>
              {/* View toggle */}
              <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-1">
                <button
                  onClick={() => setViewMode("list")}
                  title="List view"
                  className={`p-1.5 rounded-md transition-all ${viewMode === "list" ? "bg-white shadow-sm text-slate-900" : "text-slate-400 hover:text-slate-600"
                    }`}
                >
                  <List size={16} />
                </button>
                <button
                  onClick={() => setViewMode("grid")}
                  title="Grid view"
                  className={`p-1.5 rounded-md transition-all ${viewMode === "grid" ? "bg-white shadow-sm text-slate-900" : "text-slate-400 hover:text-slate-600"
                    }`}
                >
                  <LayoutGrid size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* ── Error ── */}
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-700 rounded-xl p-4 text-sm font-medium flex items-center gap-2">
              <AlertCircle size={16} /> {error}
            </div>
          )}

          {/* ── Filters ── */}
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
            <div className="flex items-center gap-2 mb-3">
              <SlidersHorizontal size={14} className="text-slate-400" />
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Filters
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Search */}
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Search</Label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Name, code, brand…"
                    className="h-9 pl-8 rounded-lg text-sm"
                  />
                </div>
              </div>

              {/* Shop filter — only shown if >1 shop */}
              {shops.length > 1 && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-700">Shop</Label>
                  <select
                    value={selectedShop}
                    onChange={(e) => setSelectedShop(e.target.value)}
                    className="w-full h-9 rounded-lg border border-slate-200 px-3 text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  >
                    <option value="all">All Shops</option>
                    {shops.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Category filter */}
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Category</Label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full h-9 rounded-lg border border-slate-200 px-3 text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                >
                  <option value="all">All Categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Status filter */}
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Status</Label>
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="w-full h-9 rounded-lg border border-slate-200 px-3 text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                >
                  <option value="all">All Statuses</option>
                  <option value="approved">Approved</option>
                  <option value="pending">Pending</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── Content ── */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
              <p className="text-slate-500 text-sm font-medium">Loading your materials…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm flex flex-col items-center justify-center py-24 gap-4 text-center px-6">
              <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center">
                <AlertCircle size={26} className="text-slate-300" />
              </div>
              <div>
                <p className="font-bold text-slate-800 text-base">
                  {materials.length === 0 ? "No materials found for your shop" : "No materials match your filters"}
                </p>
                <p className="text-slate-400 text-sm mt-1">
                  {materials.length === 0
                    ? "Submit materials via Manage Materials to see them here."
                    : "Try adjusting your search or filter criteria."}
                </p>
              </div>
            </div>
          ) : viewMode === "list" ? (
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
              {/* Table header — desktop only */}
              <div className="hidden md:grid grid-cols-[1fr_140px_120px_140px_110px] gap-4 px-5 py-3 bg-slate-50 border-b border-slate-100 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <div>Product Name</div>
                <div>Category</div>
                <div>Brand</div>
                <div>Shop</div>
                <div className="text-right">Rate</div>
              </div>
              <div className="divide-y divide-slate-50">
                {filtered.map((material) => (
                  <MaterialListRow key={material.id} material={material} />
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map((material) => (
                <MaterialCard key={material.id} material={material} />
              ))}
            </div>
          )}
        </div>
      </div>
    </SupplierLayout>
  );
}

// ── Approval status badge ─────────────────────────────────────────────────────
function StatusBadge({ approved }: { approved?: boolean | null }) {
  if (approved === true)
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-500 text-white px-2 py-0.5 rounded-full">
        <CheckCircle2 size={9} /> Approved
      </span>
    );
  if (approved === false)
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-red-500 text-white px-2 py-0.5 rounded-full">
        <XCircle size={9} /> Rejected
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-400 text-white px-2 py-0.5 rounded-full">
      <Clock size={9} /> Pending
    </span>
  );
}

// ── Individual Material Row (list view) ──────────────────────────────────────
function MaterialListRow({ material }: { material: Material }) {
  const rate = material.rate
    ? parseFloat(String(material.rate)).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_120px_140px_110px] gap-2 md:gap-4 px-5 py-4 hover:bg-slate-50/60 transition-colors items-center">
      {/* Name + thumbnail + code + status */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0 border border-slate-100">
          {material.image ? (
            <img src={material.image} alt={material.name} className="w-full h-full object-cover" />
          ) : (
            <Package size={18} className="text-slate-200" strokeWidth={1.5} />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-slate-900 text-sm leading-tight truncate">
              {material.name}
            </p>
            <StatusBadge approved={material.approved} />
          </div>
          {material.code && (
            <p className="text-[11px] text-slate-400 font-medium mt-0.5">#{material.code}</p>
          )}
        </div>
      </div>

      {/* Category */}
      <div className="md:text-left">
        {material.category ? (
          <span className="inline-flex text-[10px] font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full truncate max-w-full">
            {material.category}
          </span>
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </div>

      {/* Brand */}
      <div>
        {material.brandname ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full truncate max-w-full">
            <Tag size={9} /> {material.brandname}
          </span>
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </div>

      {/* Shop */}
      <div className="flex items-center gap-1.5 min-w-0">
        {material.shop_name ? (
          <>
            <Store size={11} className="text-slate-400 flex-shrink-0" />
            <span className="text-[11px] text-slate-500 font-medium truncate">{material.shop_name}</span>
          </>
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </div>

      {/* Rate */}
      <div className="text-left md:text-right">
        {rate ? (
          <div>
            <span className="text-sm font-black text-slate-900">₹{rate}</span>
            {material.unit && <span className="text-xs text-slate-400 font-medium"> / {material.unit}</span>}
          </div>
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </div>
    </div>
  );
}

// ── Individual Material Card ──────────────────────────────────────────────────
function MaterialCard({ material }: { material: Material }) {
  const rate = material.rate
    ? parseFloat(String(material.rate)).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    : null;

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md hover:border-blue-100 transition-all duration-200 overflow-hidden flex flex-col group">
      {/* Image or placeholder */}
      <div className="relative w-full h-36 bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center overflow-hidden">
        {material.image ? (
          <img
            src={material.image}
            alt={material.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <Package size={38} className="text-slate-200" strokeWidth={1.5} />
        )}

        {/* Status badge — top left */}
        <div className="absolute top-2 left-2">
          <StatusBadge approved={material.approved} />
        </div>

        {/* Category — top right */}
        {material.category && (
          <span className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm text-slate-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-slate-100 shadow-sm max-w-[90px] truncate">
            {material.category}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-4 flex-1 flex flex-col gap-3">
        {/* Name + Code */}
        <div>
          <p className="font-bold text-slate-900 text-sm leading-tight line-clamp-2">
            {material.name}
          </p>
          {material.code && (
            <p className="text-[11px] text-slate-400 font-medium mt-0.5">
              #{material.code}
            </p>
          )}
        </div>

        {/* Rate */}
        {rate && (
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-6 bg-emerald-50 rounded-md flex items-center justify-center flex-shrink-0">
              <IndianRupee size={12} className="text-emerald-600" />
            </div>
            <span className="text-base font-black text-slate-900">₹{rate}</span>
            {material.unit && (
              <span className="text-xs text-slate-400 font-medium">/ {material.unit}</span>
            )}
          </div>
        )}

        {/* Meta pills */}
        <div className="flex flex-wrap gap-1.5 mt-auto">
          {material.brandname && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
              <Tag size={9} /> {material.brandname}
            </span>
          )}
          {material.subcategory && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
              {material.subcategory}
            </span>
          )}
          {material.finishtype && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
              {material.finishtype}
            </span>
          )}
          {material.dimensions && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">
              <Ruler size={9} /> {material.dimensions}
            </span>
          )}
        </div>

        {/* Shop name */}
        {material.shop_name && (
          <div className="pt-3 border-t border-slate-50 flex items-center gap-1.5">
            <Store size={11} className="text-slate-400 flex-shrink-0" />
            <span className="text-[11px] text-slate-400 font-medium truncate">
              {material.shop_name}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}