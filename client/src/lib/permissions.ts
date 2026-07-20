// ─── Flat list for legacy use (sidebar visibility) ────────────────────────────
export const ALL_SIDEBAR_MODULES = [
  { key: "dashboard", label: "Dashboard" },
  { key: "project_dashboard", label: "Project Dashboard" },
  { key: "alerts", label: "Alerts" },
  { key: "create_item", label: "Create Item" },
  { key: "create_product", label: "Create Product (Page Access)" },
  { key: "create_project", label: "Create Project" },
  { key: "create_vendor_category", label: "Create Vendor Category" },
  { key: "manage_product", label: "Manage Product (Page Access)" },
  { key: "manage_materials", label: "Manage Materials" },
  { key: "manage_shops", label: "Manage Shops" },
  { key: "manage_categories", label: "Manage Categories" },
  { key: "bulk_upload", label: "Bulk Upload" },
  { key: "generate_bom", label: "Generate BOM" },
  { key: "generate_po", label: "Generate PO" },
  { key: "finalize_boq", label: "Finalize BOQ" },
  { key: "purchase_orders", label: "Purchase Orders" },
  { key: "po_approvals", label: "PO Approvals" },
  { key: "raise_po_request", label: "Raise PO Request" },
  { key: "my_po_requests", label: "My Requests" },
  { key: "pending_approvals", label: "Pending Approvals" },
  { key: "approved_requests", label: "Approved Requests" },
  { key: "shop_approvals", label: "Shop Approvals" },
  { key: "material_approvals", label: "Material Approvals" },
  { key: "supplier_approvals", label: "Supplier Approvals" },
  { key: "product_approvals", label: "Product Approvals" },
  { key: "bom_approvals", label: "BOM Approvals" },
  { key: "support_chat", label: "Support / Chat" },
  { key: "subscription", label: "Subscription" },
  { key: "user_manual", label: "User Manual" },
  { key: "sketch_plan", label: "Sketch a Plan" },
  { key: "access_control", label: "Access Control" },
  { key: "spy", label: "Spy (Activity Log)" },
  // ── Create Product: granular sub-permissions ──────────────────────────────
  { key: "create_product_category", label: "Create Product → Manage Categories (Page Access)" },
  { key: "create_product_category_add", label: "Categories → Add Category" },
  { key: "create_product_category_edit", label: "Categories → Edit Category" },
  { key: "create_product_category_delete", label: "Categories → Delete Category" },

  { key: "create_product_subcategory", label: "Create Product → Manage Subcategories (Page Access)" },
  { key: "create_product_subcategory_add", label: "Subcategories → Add Subcategory" },
  { key: "create_product_subcategory_edit", label: "Subcategories → Edit Subcategory" },
  { key: "create_product_subcategory_delete", label: "Subcategories → Delete Subcategory" },

  { key: "create_product_product", label: "Create Product → Manage Products (Page Access)" },
  { key: "create_product_product_add", label: "Products → Add Product" },
  { key: "create_product_product_edit", label: "Products → Edit Product" },
  { key: "create_product_product_delete", label: "Products → Delete Product" },
  // ── Manage Product: granular sub-permissions ──────────────────────────────
  { key: "manage_product_work", label: "Manage Product → Needs Work (Edit/Submit)" },
  { key: "manage_product_approval", label: "Manage Product → Approve / Reject" },
  { key: "manage_product_edit_locked", label: "Manage Product → Edit Approved / Submitted Configs" },
];

// ─── Grouped view used by PermissionDialog ────────────────────────────────────
export const PERMISSION_GROUPS = [
  {
    section: "Overview",
    keys: ["dashboard", "project_dashboard", "alerts", "access_control", "spy"],
  },
  {
    section: "Create Product",
    keys: [
      "create_product",
      "create_product_category",
      "create_product_category_add",
      "create_product_category_edit",
      "create_product_category_delete",
      "create_product_subcategory",
      "create_product_subcategory_add",
      "create_product_subcategory_edit",
      "create_product_subcategory_delete",
      "create_product_product",
      "create_product_product_add",
      "create_product_product_edit",
      "create_product_product_delete",
    ],
  },
  {
    section: "Manage Product",
    keys: [
      "manage_product",
      "manage_product_work",
      "manage_product_approval",
      "manage_product_edit_locked",
    ],
  },
  {
    section: "Creations",
    keys: ["create_item", "create_project", "create_vendor_category", "sketch_plan"],
  },
  {
    section: "Management",
    keys: ["manage_materials", "manage_shops", "manage_categories", "bulk_upload"],
  },
  {
    section: "BOQ / Projects",
    keys: ["generate_bom", "generate_po", "finalize_boq"],
  },
  {
    section: "Procurement",
    keys: ["purchase_orders", "po_approvals"],
  },
  {
    section: "PO Requests",
    keys: ["raise_po_request", "my_po_requests", "pending_approvals", "approved_requests"],
  },
  {
    section: "Approvals",
    keys: [
      "shop_approvals",
      "material_approvals",
      "supplier_approvals",
      "product_approvals",
      "bom_approvals",
    ],
  },
  {
    section: "Other",
    keys: ["support_chat", "subscription", "user_manual"],
  },
];

export function getDefaultPermissions(role: string): string[] {
  const modules: string[] = [];

  // Basics for everyone except some specific exclusions
  if (role !== 'supplier' && role !== 'pre_sales' && role !== 'contractor' && role !== 'product_manager') {
    modules.push('dashboard');
  }

  if (role !== 'pre_sales' && role !== 'contractor') {
    modules.push('user_manual');
  }

  // Admin & Software Team (Full Access mostly)
  if (role === 'admin' || role === 'software_team') {
    modules.push('project_dashboard', 'finalize_boq', 'purchase_orders', 'po_approvals', 'pending_approvals', 'approved_requests', 'bom_approvals', 'sketch_plan');
    if (role === 'admin') {
      modules.push('alerts', 'supplier_approvals');
    }
  }

  // Purchase Team, Admin, Software Team
  if (role === 'admin' || role === 'software_team' || role === 'purchase_team') {
    modules.push('create_item', 'create_vendor_category', 'manage_materials', 'manage_shops', 'manage_categories', 'bulk_upload', 'support_chat', 'shop_approvals', 'material_approvals');
  }

  // Creations & Management (Wide access)
  if (role === 'admin' || role === 'software_team' || role === 'purchase_team' || role === 'pre_sales' || role === 'product_manager' || role === 'contractor') {
    modules.push('create_product', 'manage_product');
    // Create Product granular
    modules.push(
      'create_product_category', 'create_product_category_add', 'create_product_category_edit', 'create_product_category_delete',
      'create_product_subcategory', 'create_product_subcategory_add', 'create_product_subcategory_edit', 'create_product_subcategory_delete',
      'create_product_product', 'create_product_product_add', 'create_product_product_edit', 'create_product_product_delete'
    );
    // Manage Product granular
    modules.push('manage_product_work');
  }

  // Project Creation
  if (role === 'admin' || role === 'software_team' || role === 'pre_sales') {
    modules.push('create_project', 'generate_po', 'sketch_plan');
  }

  // BOQ / Projects
  if (role === 'admin' || role === 'software_team' || role === 'pre_sales' || role === 'product_manager') {
    modules.push('generate_bom');
  }

  // PO Requests (Most roles)
  if (role !== 'contractor' && role !== 'supplier') {
    modules.push('raise_po_request', 'my_po_requests');
  }

  // Approvals (Specialized) — admin & software_team get full approval access
  if (role === 'admin' || role === 'software_team' || role === 'product_manager') {
    modules.push('product_approvals');
    modules.push('manage_product_approval');
  }

  return modules;
}