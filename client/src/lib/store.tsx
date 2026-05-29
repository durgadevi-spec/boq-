import React, { createContext, useContext, useState, ReactNode, useEffect } from "react";
import { getJSON, postJSON, apiFetch } from "./api";
import { useAuth } from "./auth-context";

export type Role = "admin" | "supplier" | "user" | "purchase_team" | "software_team" | "pre_sales" | "contractor" | "product_manager" | "site_engineer" | "finance_team";

export interface User {
  id: string;
  username: string;
  role: Role;
  approved?: string;
  approvalReason?: string;
  fullName?: string;
  mobileNumber?: string;
  department?: string;
  employeeCode?: string;
  companyName?: string;
  gstNumber?: string;
  businessAddress?: string;
  createdAt?: string;
  updatedAt?: string;
  shopId?: string;
  // Legacy fields for backward compatibility
  name?: string;
  email?: string;
}
export interface Shop { id: string; name: string; location?: string; phoneCountryCode?: string; contactNumber?: string; city?: string; state?: string; country?: string; pincode?: string; image?: string; rating?: number; categories?: string[]; gstNo?: string; vendorCategory?: string; ownerId?: string; disabled?: boolean; new_location?: string; terms_and_conditions?: string; }
export interface Material { id: string; name: string; code: string; rate: number; shopId?: string; unit?: string; category?: string; brandName?: string; modelNumber?: string; subCategory?: string; product?: string; technicalSpecification?: string; dimensions?: string; finish?: string; metalType?: string; image?: string; attributes?: any; masterMaterialId?: string; disabled?: boolean; vendorCategory?: string; taxCodeType?: 'hsn' | 'sac'; taxCodeValue?: string; hsnCode?: string; sacCode?: string; created_at?: string; }
export interface Product { id: string; name: string; subcategory?: string; category?: string; subcategory_name?: string; category_name?: string; hsnCode?: string; sacCode?: string; image?: string; created_at?: string; created_by?: string }

interface DataContextType {
  user: User | null;
  login: (u: User) => void;
  logout: () => void;
  shops: Shop[];
  materials: Material[];
  products: Product[];
  approvalRequests?: any[];
  supportMessages?: any[];
  pendingShops?: any[];
  pendingMaterials?: any[];
  materialApprovalRequests?: any[];
  setApprovalRequests: React.Dispatch<React.SetStateAction<any[]>>;
  setMaterialApprovalRequests: React.Dispatch<React.SetStateAction<any[]>>;
  submitShopForApproval?: (shop: Partial<Shop>) => Promise<Shop | null>;
  submitMaterialForApproval?: (mat: Partial<Material>) => Promise<Material | null>;
  addShop: (shop: Partial<Shop>) => Promise<void>;
  addMaterial: (mat: Partial<Material>) => Promise<void>;
  deleteShop: (id: string, action?: 'archive' | 'trash') => Promise<void>;
  deleteMaterial: (id: string, action?: 'archive' | 'trash') => Promise<void>;
  approveShop?: (id: string) => Promise<any>;
  rejectShop?: (id: string, reason?: string | null) => Promise<any>;
  approveMaterial?: (id: string, source?: string) => Promise<any>;
  rejectMaterial?: (id: string, reason?: string | null, source?: string) => Promise<any>;
  addSupportMessage?: (senderName: string, message: string, info?: string, admin_reply?: string) => Promise<any>;
  updateSupportMessage?: (id: string, updates: { info?: string, admin_reply?: string, is_read?: boolean }) => Promise<any>;
  deleteMessage?: (id: string) => Promise<void>;
  refreshMaterials: () => Promise<void>;
  refreshPendingApprovals: () => Promise<void>;
  assignedProjects: string[];
  currentProjectId: string | null;
  setActiveProject: (projectId: string | null) => Promise<void>;
  refreshPermissions: () => Promise<void>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export function DataProvider({ children }: { children: ReactNode }) {
  // Get auth user and sync it with data store user
  const authContext = useAuth();

  const [user, setUser] = useState<User | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [approvalRequests, setApprovalRequests] = useState<any[]>([]);
  const [supportMessages, setSupportMessages] = useState<any[]>([]);
  const [pendingShops, setPendingShops] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem('pendingShopRequests') || '[]'); } catch { return []; }
  });
  const [pendingMaterials, setPendingMaterials] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem('pendingMaterialRequests') || '[]'); } catch { return []; }
  });
  const [materialApprovalRequests, setMaterialApprovalRequests] = useState<any[]>([]);
  const [flushAttemptCount, setFlushAttemptCount] = useState(0);
  const [lastFlushTime, setLastFlushTime] = useState(0);

  const [assignedProjects, setAssignedProjects] = useState<string[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);

  /* =========================
     SYNC AUTH USER WITH DATA STORE USER
  ========================= */
  useEffect(() => {
    if (authContext?.user) {
      setUser(authContext.user as User);
      refreshPermissions();
    }
  }, [authContext?.user]);

  const refreshPermissions = async () => {
    try {
      const res = await apiFetch("/api/my-permissions");
      if (res.ok) {
        const data = await res.json();
        setAssignedProjects(data.projects || []);
        setCurrentProjectId(data.currentProjectId || null);
      }
    } catch (e) {
      console.warn('refreshPermissions failed', e);
    }
  };

  const setActiveProject = async (projectId: string | null) => {
    try {
      const res = await apiFetch("/api/set-active-project", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId })
      });
      if (res.ok) {
        setCurrentProjectId(projectId);
        // Refresh project-dependent data
        await Promise.all([
          refreshMaterials(),
          refreshPendingApprovals()
        ]);
      }
    } catch (e) {
      console.warn('setActiveProject failed', e);
    }
  };

  // Helper function to normalize server material keys (snake_case) to client camelCase
  const normalizeMaterial = (mat: any) => ({
    id: mat.id,
    name: mat.name,
    code: mat.code,
    rate: mat.rate,
    shopId: mat.shop_id || mat.shopId || null,
    unit: mat.unit,
    category: mat.category,
    brandName: mat.brandname || mat.brandName || mat.brand || mat.make || "",
    modelNumber: mat.modelnumber || mat.modelNumber || mat.model || "",
    subCategory: mat.subcategory || mat.subCategory || "",
    product: mat.product || "",
    technicalSpecification: mat.technicalspecification || mat.technicalSpecification || "",
    dimensions: mat.dimensions || "",
    finish: mat.finishtype || mat.finish || "",
    metalType: mat.metaltype || mat.metalType || "",
    image: mat.image,
    attributes: mat.attributes || {},
    disabled: mat.disabled || false,
    vendorCategory: mat.vendor_category || mat.vendorCategory || "",
    taxCodeType: mat.tax_code_type || mat.taxCodeType || null,
    taxCodeValue: mat.tax_code_value || mat.taxCodeValue || "",
    hsnCode: mat.hsn_code || mat.hsnCode || "",
    sacCode: mat.sac_code || mat.sacCode || "",
    created_at: mat.created_at || mat.submitted_at || null,
    is_project_pricing: mat.is_project_pricing || false,
  } as Material);

  const refreshMaterials = async () => {
    try {
      const dd = await getJSON('/materials');
      if (dd?.materials) {
        setMaterials(dd.materials.map(normalizeMaterial));
      }
    } catch (e) {
      console.warn('refreshMaterials failed', e);
    }
  };

  const refreshPendingApprovals = async () => {
    try {
      const res = await apiFetch("/api/material-submissions-pending-approval");
      if (res.ok) {
        const data = await res.json();
        const submissions = (data.submissions || []).map((s: any) => ({
          id: s.submission.id,
          status: "pending",
          source: 'submission',
          material: {
            id: s.submission.id,
            name: s.submission.template_name || "Supplier Material",
            code: s.submission.template_code || "",
            rate: s.submission.rate,
            unit: s.submission.unit,
            category: s.submission.category || s.submission.template_category || s.submission.template_category_name || "",
            subCategory: s.submission.subcategory || s.submission.sub_category || "",
            brandName: s.submission.brandname || s.submission.brandName || s.submission.brand || s.submission.make || "",
            modelNumber: s.submission.modelnumber || s.submission.modelNumber || "",
            technicalSpecification: s.submission.technicalspecification || s.submission.technicalSpecification || "",
            image: s.submission.image || s.submission.template_image || null,
            is_project_pricing: s.submission.is_project_pricing,
          },
          submittedBy: s.submission.shop_name || "Supplier",
          submittedAt: s.submission.submitted_at || s.submission.created_at,
          templateId: s.submission.template_id,
          shopId: s.submission.shop_id,
        }));
        setMaterialApprovalRequests(submissions);
      }
    } catch (e) {
      console.warn('refreshPendingApprovals failed', e);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const s = await getJSON('/shops');
        if (mounted && s?.shops) {
          setShops(s.shops.sort((a: any, b: any) => (a.name || "").localeCompare(b.name || "")));
        }
      } catch (e) { console.warn('load shops failed', e); }
      try {
        const m = await getJSON('/materials');
        if (mounted && m?.materials) {
          const normalized = m.materials.map(normalizeMaterial);
          setMaterials(normalized.sort((a: any, b: any) => (a.name || "").localeCompare(b.name || "")));
        }
      } catch (e) { console.warn('load materials failed', e); }
      try {
        const p = await getJSON('/products');
        if (mounted && p?.products) {
          setProducts(p.products.sort((a: any, b: any) => (a.name || "").localeCompare(b.name || "")));
        }
      } catch (e) { console.warn('load products failed', e); }
      // load server-side pending approval lists into central state
      try {
        const ps = await getJSON('/shops-pending-approval');
        if (mounted && ps?.shops) setApprovalRequests(ps.shops);
      } catch (e) { console.warn('load pending shops failed', e); }
      // load server-side pending approval list (unified)
      await refreshPendingApprovals();
      // load support messages
      try {
        const sm = await getJSON('/support-messages');
        if (mounted && sm?.messages) setSupportMessages(sm.messages);
      } catch (e) { console.warn('load support messages failed', e); }
    })();
    return () => { mounted = false };
  }, []);

  // persist pending queues to localStorage whenever they change
  useEffect(() => {
    try { localStorage.setItem('pendingShopRequests', JSON.stringify(pendingShops)); } catch (e) { /* ignore */ }
  }, [pendingShops]);
  useEffect(() => {
    try { localStorage.setItem('pendingMaterialRequests', JSON.stringify(pendingMaterials)); } catch (e) { /* ignore */ }
  }, [pendingMaterials]);

  // helper to flush pending queues when a token becomes available
  const flushPendingQueues = async () => {
    const now = Date.now();
    // Rate limit: don't try more than once per 5 seconds, and max 10 attempts total per session
    if (now - lastFlushTime < 5000 || flushAttemptCount >= 10) {
      return;
    }

    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('authToken') : null;
    if (!token) return;

    setFlushAttemptCount(c => c + 1);
    setLastFlushTime(now);

    // try flush shops first
    if (pendingShops.length > 0) {
      const remaining: any[] = [];
      for (const req of pendingShops) {
        try {
          const created = await submitShopForApproval(req.shop);
          if (created && created.id) {
            // refresh server pending list
            try { const ps = await getJSON('/shops-pending-approval'); if (ps?.shops) setApprovalRequests(ps.shops); } catch (e) { console.warn('refresh pending shops failed', e); }
            continue; // successful, don't keep
          }
        } catch (e) {
          console.warn('flush pending shop failed', e);
        }
        remaining.push(req);
      }
      setPendingShops(remaining);
    }

    if (pendingMaterials.length > 0) {
      const remainingMat: any[] = [];
      for (const req of pendingMaterials) {
        try {
          const created = await submitMaterialForApproval(req.material);
          if (created && created.id) {
            try { const pm = await getJSON('/materials-pending-approval'); if (pm?.materials) setMaterialApprovalRequests(pm.materials); } catch (e) { console.warn('refresh pending materials failed', e); }
            continue;
          }
        } catch (e) {
          console.warn('flush pending material failed', e);
        }
        remainingMat.push(req);
      }
      setPendingMaterials(remainingMat);
    }
  };

  // watch for auth token changes and user state to trigger flush (only once)
  useEffect(() => {
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === 'authToken' && ev.newValue) {
        flushPendingQueues().catch((e) => console.warn('flush failed', e));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // try initial flush on mount when user is present
  useEffect(() => {
    if (user && pendingShops.length + pendingMaterials.length > 0) {
      flushPendingQueues().catch(() => { });
    }
  }, [user]);

  const login = (u: User) => setUser(u);
  const logout = () => setUser(null);

  const addShop = async (shop: Partial<Shop>) => {
    const data = await postJSON('/shops', shop);
    if (data?.shop) {
      setShops((p) => [data.shop, ...p]);
      return data.shop;
    }
    throw new Error('addShop: server did not return created shop');
  };

  const addMaterial = async (mat: Partial<Material>) => {
    const data = await postJSON('/materials', mat);
    if (data?.material) {
      // normalize server material
      const normalized = normalizeMaterial(data.material);
      setMaterials((p) => [normalized, ...p]);
      return data.material;
    }
    throw new Error('addMaterial: server did not return created material');
  };

  const submitShopForApproval = async (shop: Partial<Shop>) => {
    try {
      const data = await postJSON('/shops', shop);
      return data?.shop || null;
    } catch (e: any) {
      console.warn('[submitShopForApproval] server submit failed, enqueueing locally', e?.message || e);
      const req = { id: Math.random().toString(), shop };
      setPendingShops((p) => [req, ...p]);
      return null;
    }
  };

  const submitMaterialForApproval = async (mat: Partial<Material>) => {
    try {
      const data = await postJSON('/materials', mat);
      return data?.material || null;
    } catch (e: any) {
      console.warn('[submitMaterialForApproval] server submit failed, enqueueing locally', e?.message || e);
      const req = { id: Math.random().toString(), material: mat };
      setPendingMaterials((p) => [req, ...p]);
      return null;
    }
  };

  const deleteShop = async (id: string, action?: 'archive' | 'trash') => {
    console.log('[deleteShop] attempting to delete shop', id);
    try {
      const url = action ? `/shops/${id}?action=${action}` : `/shops/${id}`;
      const res = await apiFetch(url, { method: 'DELETE' });
      console.log('[deleteShop] response status:', res.status);
      if (res.ok) {
        // successful delete on server, update local list
        console.log('[deleteShop] delete successful, removing from local list');
        setShops((p) => p.filter(s => s.id !== id));
        return;
      }
      // server returned non-ok response; log and fallthrough to re-sync
      try { const txt = await res.text(); console.warn('[deleteShop] failed:', res.status, txt); } catch { console.warn('[deleteShop] failed:', res.status); }
    } catch (e) {
      console.warn('[deleteShop] exception:', e);
    }
    // Re-sync from server to restore accurate state when delete failed
    console.log('[deleteShop] re-syncing from server');
    try { const dd = await getJSON('/shops'); if (dd?.shops) setShops(dd.shops); } catch (e) { console.warn('refresh shops failed', e); }
  };

  const deleteMaterial = async (id: string, action?: 'archive' | 'trash') => {
    console.log('[deleteMaterial] attempting to delete material', id);
    try {
      const url = action ? `/materials/${id}?action=${action}` : `/materials/${id}`;
      const res = await apiFetch(url, { method: 'DELETE' });
      console.log('[deleteMaterial] response status:', res.status);
      if (res.ok) {
        console.log('[deleteMaterial] delete successful, removing from local list');
        setMaterials((p) => p.filter(m => m.id !== id));
        return;
      }
      try { const txt = await res.text(); console.warn('[deleteMaterial] failed:', res.status, txt); } catch { console.warn('[deleteMaterial] failed:', res.status); }
    } catch (e) {
      console.warn('[deleteMaterial] exception:', e);
    }
    console.log('[deleteMaterial] re-syncing from server');
    try { const dd = await getJSON('/materials'); if (dd?.materials) setMaterials(dd.materials.map(normalizeMaterial)); } catch (e) { console.warn('refresh materials failed', e); }
  };

  const approveShop = async (id: string) => {
    const data = await postJSON(`/shops/${id}/approve`, {});
    try { const dd = await getJSON('/shops'); if (dd?.shops) setShops(dd.shops); } catch (e) { console.warn('approveShop refresh failed', e); }
    return data?.shop;
  };

  const rejectShop = async (id: string, reason?: string | null) => {
    const data = await postJSON(`/shops/${id}/reject`, { reason });
    // Remove from local approval requests immediately
    setApprovalRequests((prev) => prev.filter((r: any) => r.id !== id));
    // Also refresh shops from server
    try { const dd = await getJSON('/shops'); if (dd?.shops) setShops(dd.shops); } catch (e) { console.warn('rejectShop refresh failed', e); }
    // Refresh pending approvals list
    try { const ps = await getJSON('/shops-pending-approval'); if (ps?.shops) setApprovalRequests(ps.shops); } catch (e) { console.warn('rejectShop pending refresh failed', e); }
    return data;
  };

  const approveMaterial = async (id: string, source?: string) => {
    let res;
    if (source === 'submission') {
      res = await apiFetch(`/material-submissions/${id}/approve`, { method: 'POST' });
    } else {
      res = await apiFetch(`/materials/${id}/approve`, { method: 'POST' });
    }

    if (res.ok) {
      setMaterialApprovalRequests(prev => prev.filter(r => r.id !== id));

      // Refresh EVERYTHING to ensure sync
      try {
        await refreshPendingApprovals(); // Clear from "pending" list
        const dd = await getJSON('/materials');
        if (dd?.materials) setMaterials(dd.materials.map(normalizeMaterial));
      } catch (e) { console.warn('approveMaterial refresh failed', e); }
      return res.json();
    }
    throw new Error('Approval failed');
  };

  const rejectMaterial = async (id: string, reason?: string | null, source?: string) => {
    let res;
    if (source === 'submission') {
      res = await apiFetch(`/material-submissions/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
    } else {
      res = await apiFetch(`/materials/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
    }

    if (res.ok) {
      setMaterialApprovalRequests(prev => prev.filter(r => r.id !== id));

      // Refresh pending list to ensure it disappears locally
      try {
        await refreshPendingApprovals();
        const dd = await getJSON('/materials');
        if (dd?.materials) setMaterials(dd.materials.map(normalizeMaterial));
      } catch (e) { console.warn('rejectMaterial refresh failed', e); }
      return res.json();
    }
    throw new Error('Rejection failed');
  };

  const addSupportMessage = async (senderName: string, message: string, info?: string, admin_reply?: string) => {
    try {
      const data = await postJSON('/support-messages', {
        senderName,
        message,
        info: info || null,
        admin_reply: admin_reply || null,
      });
      if (data?.message) {
        setSupportMessages((p) => [data.message, ...p]);
        return data.message;
      }
    } catch (e) {
      console.warn('addSupportMessage failed', e);
      throw e;
    }
  };

  const updateSupportMessage = async (id: string, updates: { info?: string, admin_reply?: string, is_read?: boolean }) => {
    try {
      const res = await apiFetch(`/api/support-messages/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        const updated = data.message || data;
        setSupportMessages((p) => p.map((m: any) => m.id === id ? updated : m));
        return updated;
      }
      throw new Error('Failed to update message');
    } catch (e) {
      console.warn('updateSupportMessage failed', e);
      throw e;
    }
  };

  const deleteMessage = async (id: string) => {
    try {
      const res = await apiFetch(`/api/support-messages/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSupportMessages((p) => p.filter((m: any) => m.id !== id));
        return;
      }
      throw new Error('Failed to delete message');
    } catch (e) {
      console.warn('deleteMessage failed', e);
      throw e;
    }
  };

  const contextValue: DataContextType = {
    user,
    login,
    logout,
    shops,
    materials,
    products,
    approvalRequests,
    supportMessages,
    pendingShops,
    pendingMaterials,
    materialApprovalRequests,
    setApprovalRequests,
    setMaterialApprovalRequests,
    addShop,
    addMaterial,
    deleteShop,
    deleteMaterial,
    approveShop,
    rejectShop,
    approveMaterial,
    rejectMaterial,
    submitShopForApproval,
    submitMaterialForApproval,
    addSupportMessage,
    updateSupportMessage,
    deleteMessage,
    refreshMaterials,
    refreshPendingApprovals,
    assignedProjects,
    currentProjectId,
    setActiveProject,
    refreshPermissions,
  };

  return (
    <DataContext.Provider value={contextValue}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside DataProvider');
  return ctx;
}
