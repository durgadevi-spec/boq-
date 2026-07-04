import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  integer,
  decimal,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  username: text("username").notNull().unique(),
  password: text("password").notNull(),

  // user, admin, supplier, software_team, purchase_team, pre_sales, contractor, product_manager, site_engineer, finance_team
  role: text("role").notNull().default("user"),

  // approved, pending, rejected
  approved: text("approved").notNull().default("approved"),

  // DB column is approval_reason, but TS key can be approvalReason
  approvalReason: text("approval_reason"),

  fullName: text("full_name"),
  mobileNumber: text("mobile_number"),
  department: text("department"),
  employeeCode: text("employee_code"),
  companyName: text("company_name"),
  gstNumber: text("gst_number"),
  businessAddress: text("business_address"),
  vendorCategories: text("vendor_categories"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),

  currentProjectId: varchar("current_project_id", { length: 100 }),
});

export const userProjectPermissions = pgTable("user_project_permissions", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 36 }).notNull(),
  projectId: varchar("project_id", { length: 100 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(
    sql`now()`,
  ),
});

export const estimatorStep9Cart = pgTable("estimator_step9_cart", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  estimator: text("estimator").notNull(),
  billNo: text("bill_no").notNull(), // session_id

  sNo: integer("s_no"),
  item: text("item"),
  description: text("description"),
  unit: text("unit"),
  qty: decimal("qty", { precision: 10, scale: 2 }),
  rate: decimal("rate", { precision: 10, scale: 2 }),
  amount: decimal("amount", { precision: 10, scale: 2 }),

  materialId: uuid("material_id"),
  batchId: text("batch_id"),
  rowId: text("row_id"),
  shopId: uuid("shop_id"),

  supplyRate: decimal("supply_rate", { precision: 10, scale: 2 }),
  installRate: decimal("install_rate", { precision: 10, scale: 2 }),

  doorType: text("door_type"),
  panelType: text("panel_type"),
  subOption: text("sub_option"),
  glazingType: text("glazing_type"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

/**
 * Stronger validation for insert payloads
 */
export const userRoleEnum = z.enum([
  "user",
  "admin",
  "supplier",
  "software_team",
  "purchase_team",
  "contractor",
  "pre_sales",
  "product_manager",
  "site_engineer",
  "finance_team",
]);

export const approvalStatusEnum = z.enum(["approved", "pending", "rejected"]);

export const insertUserSchema = createInsertSchema(users, {
  username: z.string().min(3),
  password: z.string().min(6),
  role: userRoleEnum.optional(),
  approved: approvalStatusEnum.optional(),
  approvalReason: z.string().nullable().optional(),
  fullName: z.string().nullable().optional(),
  mobileNumber: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  employeeCode: z.string().nullable().optional(),
  companyName: z.string().nullable().optional(),
  gstNumber: z.string().nullable().optional(),
  businessAddress: z.string().nullable().optional(),
  vendorCategories: z.string().nullable().optional(),
}).pick({
  username: true,
  password: true,
  role: true,
  approved: true,
  approvalReason: true,
  fullName: true,
  mobileNumber: true,
  department: true,
  employeeCode: true,
  companyName: true,
  gstNumber: true,
  businessAddress: true,
  vendorCategories: true,
});

export const insertEstimatorStep9CartSchema = createInsertSchema(
  estimatorStep9Cart,
  {
    estimator: z.string(),
    billNo: z.string(),
    sNo: z.number().nullable().optional(),
    item: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    qty: z.number().nullable().optional(),
    rate: z.number().nullable().optional(),
    amount: z.number().nullable().optional(),
    materialId: z.string().uuid().nullable().optional(),
    batchId: z.string().nullable().optional(),
    rowId: z.string().nullable().optional(),
    shopId: z.string().uuid().nullable().optional(),
    supplyRate: z.number().nullable().optional(),
    installRate: z.number().nullable().optional(),
    doorType: z.string().nullable().optional(),
    panelType: z.string().nullable().optional(),
    subOption: z.string().nullable().optional(),
    glazingType: z.string().nullable().optional(),
  },
);

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type EstimatorStep9Cart = typeof estimatorStep9Cart.$inferSelect;
export type InsertEstimatorStep9Cart = z.infer<
  typeof insertEstimatorStep9CartSchema
>;

export const step11Products = pgTable("step11_products", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  productId: uuid("product_id").notNull(),
  productName: text("product_name").notNull(),
  categoryId: text("category_id"),
  subcategoryId: text("subcategory_id"),
  totalCost: decimal("total_cost", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(
    sql`now()`,
  ),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(
    sql`now()`,
  ),
});

export const step11ProductItems = pgTable("step11_product_items", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  step11ProductId: uuid("step11_product_id")
    .notNull()
    .references(() => step11Products.id),
  materialId: uuid("material_id").notNull(),
  materialName: text("material_name").notNull(),
  unit: text("unit"),
  qty: decimal("qty", { precision: 10, scale: 2 }),
  rate: decimal("rate", { precision: 15, scale: 2 }),
  supplyRate: decimal("supply_rate", { precision: 15, scale: 2 }),
  installRate: decimal("install_rate", { precision: 15, scale: 2 }),
  location: text("location"),
  amount: decimal("amount", { precision: 15, scale: 2 }),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  poNumber: text("po_number").notNull().unique(),
  projectId: text("project_id").notNull(),
  projectName: text("project_name"),
  vendorId: text("vendor_id").notNull(), // maps to shop_id
  vendorName: text("vendor_name"),
  subtotal: decimal("subtotal", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  tax: decimal("tax", { precision: 15, scale: 2 }).notNull().default("0"),
  total: decimal("total", { precision: 15, scale: 2 }).notNull().default("0"),
  // draft, pending_approval, approved, ordered, delivered, rejected
  status: text("status").notNull().default("draft"),
  requestedBy: text("requested_by"),
  approvalComments: text("approval_comments"),
  poDate: timestamp("po_date", { withTimezone: true }).default(sql`now()`),
  deliveryDate: timestamp("delivery_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(
    sql`now()`,
  ),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(
    sql`now()`,
  ),
});

export const purchaseOrderItems = pgTable("purchase_order_items", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  poId: uuid("po_id")
    .notNull()
    .references(() => purchaseOrders.id, { onDelete: "cascade" }),
  materialId: text("material_id"),
  item: text("item").notNull(),
  description: text("description"),
  unit: text("unit"),
  qty: decimal("qty", { precision: 10, scale: 2 }).notNull(),
  rate: decimal("rate", { precision: 15, scale: 2 }).notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(
    sql`now()`,
  ),
});

export const poRateChangeHistory = pgTable("po_rate_change_history", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  poId: uuid("po_id")
    .notNull()
    .references(() => purchaseOrders.id, { onDelete: "cascade" }),
  poItemId: uuid("po_item_id").notNull(),
  poNumber: text("po_number"),
  projectName: text("project_name"),
  vendorName: text("vendor_name"),
  itemName: text("item_name"),
  originalRate: decimal("original_rate", { precision: 15, scale: 2 }).notNull(),
  reducedRate: decimal("reduced_rate", { precision: 15, scale: 2 }).notNull(),
  reductionAmount: decimal("reduction_amount", { precision: 15, scale: 2 }),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"), // pending, approved, rejected
  changedBy: text("changed_by"),
  changedByName: text("changed_by_name"),
  changedAt: timestamp("changed_at", { withTimezone: true }).default(
    sql`now()`,
  ),
  approvedBy: text("approved_by"),
  approvedByName: text("approved_by_name"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  adminComments: text("admin_comments"),
});

export const poRequests = pgTable("po_requests", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  projectId: text("project_id").notNull(),
  projectName: text("project_name").notNull(),
  requesterId: text("requester_id").notNull(),
  requesterName: text("requester_name").notNull(),
  employeeId: text("employee_id"),
  department: text("department"),
  // pending_approval, approved, rejected, po_generated
  status: text("status").notNull().default("pending_approval"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(
    sql`now()`,
  ),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(
    sql`now()`,
  ),
});

export const poRequestItems = pgTable("po_request_items", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  poRequestId: uuid("po_request_id")
    .notNull()
    .references(() => poRequests.id, { onDelete: "cascade" }),
  item: text("item").notNull(),
  category: text("category"),
  subcategory: text("subcategory"),
  unit: text("unit"),
  qty: decimal("qty", { precision: 10, scale: 2 }).notNull(),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(
    sql`now()`,
  ),
});

export const insertStep11ProductSchema = createInsertSchema(step11Products);
export const insertStep11ProductItemSchema =
  createInsertSchema(step11ProductItems);
export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders);
export const insertPurchaseOrderItemSchema =
  createInsertSchema(purchaseOrderItems);
export const insertPoRequestSchema = createInsertSchema(poRequests);
export const insertPoRequestItemSchema = createInsertSchema(poRequestItems);

export type Step11Product = typeof step11Products.$inferSelect;
export type InsertStep11Product = z.infer<typeof insertStep11ProductSchema>;
export type Step11ProductItem = typeof step11ProductItems.$inferSelect;
export type InsertStep11ProductItem = z.infer<
  typeof insertStep11ProductItemSchema
>;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type PurchaseOrderItem = typeof purchaseOrderItems.$inferSelect;
export type InsertPurchaseOrderItem = z.infer<
  typeof insertPurchaseOrderItemSchema
>;
export type PoRequest = typeof poRequests.$inferSelect;
export type InsertPoRequest = z.infer<typeof insertPoRequestSchema>;
export type PoRequestItem = typeof poRequestItems.$inferSelect;
export type InsertPoRequestItem = z.infer<typeof insertPoRequestItemSchema>;

// --- SITE REPORT TABLES ---

export const siteReports = pgTable("site_reports", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  projectId: text("project_id").notNull(),
  projectName: text("project_name").notNull(),
  userId: text("user_id").notNull(),
  reportDate: timestamp("report_date", { withTimezone: true }).default(
    sql`now()`,
  ),
  summary: text("summary"),
  // draft, submitted
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(
    sql`now()`,
  ),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(
    sql`now()`,
  ),
});

export const siteReportTasks = pgTable("site_report_tasks", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  siteReportId: uuid("site_report_id")
    .notNull()
    .references(() => siteReports.id, { onDelete: "cascade" }),
  itemType: text("item_type").notNull(), // 'item' or 'product'
  itemId: text("item_id").notNull(),
  itemName: text("item_name").notNull(),
  taskDescription: text("task_description"),
  completionPercentage: integer("completion_percentage").notNull().default(0),
  status: text("status"), // 'Not Started', 'In Progress', 'Completed'
  createdAt: timestamp("created_at", { withTimezone: true }).default(
    sql`now()`,
  ),
});

export const siteReportLabours = pgTable("site_report_labours", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  taskId: uuid("task_id")
    .notNull()
    .references(() => siteReportTasks.id, { onDelete: "cascade" }),
  labourName: text("labour_name"),
  count: integer("count").notNull().default(1),
  inTime: text("in_time"),
  outTime: text("out_time"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(
    sql`now()`,
  ),
});

export const siteReportMedia = pgTable("site_report_media", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  taskId: uuid("task_id")
    .notNull()
    .references(() => siteReportTasks.id, { onDelete: "cascade" }),
  fileUrl: text("file_url").notNull(),
  fileType: text("file_type").notNull(), // 'image' or 'video'
  fileName: text("file_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(
    sql`now()`,
  ),
});

export const siteReportIssues = pgTable("site_report_issues", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  taskId: uuid("task_id")
    .notNull()
    .references(() => siteReportTasks.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(
    sql`now()`,
  ),
});

export const emailGroups = pgTable("email_groups", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  userId: text("user_id").notNull(),
  isClientGroup: boolean("is_client_group").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).default(
    sql`now()`,
  ),
});

export const emailGroupMembers = pgTable("email_group_members", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  groupId: uuid("group_id")
    .notNull()
    .references(() => emailGroups.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(
    sql`now()`,
  ),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 36 }),
  username: text("username"),
  role: text("role"),
  action: text("action").notNull(), // LOGIN, LOGOUT, CREATE, UPDATE, DELETE, NAVIGATE
  module: text("module"), // Projects, Materials, BOM, etc.
  page: text("page"), // Current URL/Page
  details: text("details"), // Description
  beforeData: text("before_data"), // JSON stringified
  afterData: text("after_data"), // JSON stringified
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(
    sql`now()`,
  ),
});

export const bomComments = pgTable("bom_comments", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  versionId: uuid("version_id").notNull(),
  productId: text("product_id"),
  itemId: text("item_id"),
  userId: text("user_id").notNull(),
  userFullName: text("user_full_name").notNull(),
  commentText: text("comment_text").notNull(),
  versionNumber: integer("version_number").notNull(),
  visibleTo: text("visible_to").array(),
  readBy: text("read_by")
    .array()
    .default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at", { withTimezone: true }).default(
    sql`now()`,
  ),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(
    sql`now()`,
  ),
});

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(
    sql`now()`,
  ),
});

// Zod schemas and types
export const insertSiteReportSchema = createInsertSchema(siteReports);
export const insertSiteReportTaskSchema = createInsertSchema(siteReportTasks);
export const insertSiteReportLabourSchema =
  createInsertSchema(siteReportLabours);
export const insertSiteReportMediaSchema = createInsertSchema(siteReportMedia);
export const insertSiteReportIssueSchema = createInsertSchema(siteReportIssues);
export const insertEmailGroupSchema = createInsertSchema(emailGroups);
export const insertEmailGroupMemberSchema =
  createInsertSchema(emailGroupMembers);
export const insertAuditLogSchema = createInsertSchema(auditLogs);
export const insertBomCommentSchema = createInsertSchema(bomComments);
export const insertSystemSettingsSchema = createInsertSchema(systemSettings);

export type SiteReport = typeof siteReports.$inferSelect;
export type InsertSiteReport = z.infer<typeof insertSiteReportSchema>;
export type SiteReportTask = typeof siteReportTasks.$inferSelect;
export type InsertSiteReportTask = z.infer<typeof insertSiteReportTaskSchema>;
export type SiteReportLabour = typeof siteReportLabours.$inferSelect;
export type InsertSiteReportLabour = z.infer<
  typeof insertSiteReportLabourSchema
>;
export type SiteReportMedia = typeof siteReportMedia.$inferSelect;
export type InsertSiteReportMedia = z.infer<typeof insertSiteReportMediaSchema>;
export type SiteReportIssue = typeof siteReportIssues.$inferSelect;
export type InsertSiteReportIssue = z.infer<typeof insertSiteReportIssueSchema>;
export type EmailGroup = typeof emailGroups.$inferSelect;
export type InsertEmailGroup = z.infer<typeof insertEmailGroupSchema>;
export type EmailGroupMember = typeof emailGroupMembers.$inferSelect;
export type InsertEmailGroupMember = z.infer<
  typeof insertEmailGroupMemberSchema
>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type BomComment = typeof bomComments.$inferSelect;
export type InsertBomComment = z.infer<typeof insertBomCommentSchema>;
export type SystemSettings = typeof systemSettings.$inferSelect;
export type InsertSystemSettings = z.infer<typeof insertSystemSettingsSchema>;

// --- ARCHIVE RECORDS ---

export const archiveRecords = pgTable("archive_records", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  module: text("module").notNull(),
  originId: text("origin_id").notNull(),
  data: text("data"), // Store JSON as string
  status: text("status").notNull(), // 'archived' or 'trashed'
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  trashedAt: timestamp("trashed_at", { withTimezone: true }),
});

export const insertArchiveRecordSchema = createInsertSchema(archiveRecords);
export type ArchiveRecord = typeof archiveRecords.$inferSelect;
export type InsertArchiveRecord = z.infer<typeof insertArchiveRecordSchema>;

export const bomRateChangeRequests = pgTable("bom_rate_change_requests", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: text("project_id").notNull(),
  projectName: text("project_name"),
  bomName: text("bom_name"),
  versionId: text("version_id"),
  boqItemId: text("boq_item_id"),
  productId: text("product_id"),
  productName: text("product_name"),
  materialId: text("material_id"),
  materialName: text("material_name").notNull(),
  originalRate: decimal("original_rate", { precision: 15, scale: 2 }).notNull(),
  requestedRate: decimal("requested_rate", { precision: 15, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"),
  remarks: text("remarks"),
  requestedBy: text("requested_by"),
  requestedByName: text("requested_by_name"),
  approvedBy: text("approved_by"),
  approvedByName: text("approved_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`),
});

export const insertBomRateChangeRequestSchema = createInsertSchema(bomRateChangeRequests);
export type BomRateChangeRequest = typeof bomRateChangeRequests.$inferSelect;
export type InsertBomRateChangeRequest = z.infer<typeof insertBomRateChangeRequestSchema>;
