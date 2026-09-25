/**
 * قراردادهای دامنهٔ تأمین‌کننده (فاز ۶.۲).
 *
 * این فایل فقط **تایپ و نگاشتِ مسیر** است — هیچ رفتار HTTPای اینجا نیست.
 * تمام فراخوانی‌ها از `client.ts` و با همان `ApiClient` مشترکِ فاز ۶.۱ انجام
 * می‌شوند؛ بنابراین خطا، نشست، لغو و پایهٔ نشانی فقط یک پیاده‌سازی دارند.
 *
 * قواعد:
 *  - مسیرها از روی کنترلرهای واقعی Nest استخراج شده‌اند؛ هیچ مسیری حدس زده نشده.
 *  - مقادیر پولی همیشه `MoneyString` (رشتهٔ ده‌دهی) هستند.
 *  - هر جا سرور چیزی را اعلام نکرده (مثل نقشِ عضو در برخی پاسخ‌ها)، نوع
 *    `unknown`/اختیاری است تا کلاینت چیزی اختراع نکند.
 */

import type { MoneyString } from "../money/money";
import type { Page } from "../pagination/pagination";
import type { PaginationMode } from "../pagination/pagination";

/* ── پول و شناسه‌ها ─────────────────────────────────────────────────────────── */

export type SupplierId = string;
export type Money = MoneyString;

/** کلیدِ یکتای عملیات — برای هدر Idempotency-Key (غیرِ تجاری، فقط ضدِ تکرار). */
export type IdempotencyKey = string;

/* ── نشست ──────────────────────────────────────────────────────────────────── */

export type SupplierLoginInput = {
  email: string;
  password: string;
};

export type SupplierSessionContext = {
  supplierId: SupplierId | null;
  displayName: string | null;
  legalName: string | null;
};

export type SupplierApplicationInput = {
  companyName: string;
  representativeName: string;
  phone: string;
  category: string;
  monthlyCapacity: number | null;
};

/* ── تحلیل/داشبورد ─────────────────────────────────────────────────────────── */

export type AnalyticsMetricUnit = "COUNT" | "INTEGER" | "IRR" | "RATIO";

export type AnalyticsMetricValue = {
  raw: string;
  display?: string;
  formatted?: string;
  unit?: AnalyticsMetricUnit | null;
};

export type AnalyticsMetricResult = {
  key: string;
  label?: string;
  unit?: AnalyticsMetricUnit;
  value: AnalyticsMetricValue;
  breakdown?: Array<{ label?: string; value?: AnalyticsMetricValue }> | null;
  comparison?: { mode?: string; value: AnalyticsMetricValue | null } | null;
  freshness?: Record<string, unknown> | null;
};

export type AnalyticsResult = {
  scope?: string;
  scopeId?: string | null;
  timezone?: string;
  range?: { preset?: string; startUtc?: string; endUtc?: string; comparisonStartUtc?: string | null; comparisonEndUtc?: string | null };
  metrics: AnalyticsMetricResult[];
  freshness?: Record<string, unknown> | null;
};

export type AnalyticsQueryInput = {
  from?: string;
  to?: string;
  preset?: string;
  compare?: boolean;
  scope?: string;
  scopeId?: string;
};

/* ── محصولات ───────────────────────────────────────────────────────────────── */

export type SupplierSubmissionStatus =
  | "draft"
  | "submitted"
  | "pending_review"
  | "approved"
  | "changes_requested"
  | "rejected"
  | string;

export type SupplierProduct = {
  id: string;
  name: string;
  sku: string;
  category: string;
  description: string | null;
  wholesalePrice: Money;
  imageUrl: string | null;
  status: SupplierSubmissionStatus;
  productVariants: Array<Record<string, unknown>>;
  createdAt?: string | null;
  updatedAt?: string | null;
  rejectionReason?: string | null;
};

export type SupplierProductInput = {
  name: string;
  sku: string;
  category: string;
  description?: string;
  wholesalePrice: string;
  stock: number;
  size?: string;
  color?: string;
  colorHex?: string | null;
  imageUrl?: string | null;
};

export type SupplierSubmissionResult = {
  id: string;
  name: string;
  sku: string;
  status: SupplierSubmissionStatus;
};

/* ── RFQ / پیشنهاد ─────────────────────────────────────────────────────────── */

export type RfqStatus = "open" | "quoted" | "awarded" | "closed" | "cancelled" | string;

export type SupplierRfq = {
  id: string;
  referenceCode: string | null;
  title: string;
  customerName: string | null;
  quantity: number | null;
  requestedDeliveryDate: string | null;
  status: RfqStatus;
  specifications: Record<string, unknown> | null;
  createdAt?: string | null;
};

export type QuoteInput = {
  unitPrice: string;
  leadTimeDays: number;
  notes?: string;
  validUntil?: string | null;
  currency?: string;
};

/* ── سفارش‌ها ──────────────────────────────────────────────────────────────── */

export type ChildOrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "shipped"
  | "delivered"
  | "cancelled"
  | string;

export type ChildOrderItem = {
  id?: string;
  productName: string | null;
  sku: string | null;
  quantity: number | null;
  unitPrice?: Money | null;
  totalPrice?: Money | null;
};

export type ChildOrder = {
  id: string;
  orderCode: string | null;
  status: ChildOrderStatus;
  sellerId: string | null;
  totalAmount: Money | null;
  currency?: string | null;
  dueDate?: string | null;
  trackingCode?: string | null;
  version?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  children?: ChildOrderItem[];
  purchaseOrderItems?: ChildOrderItem[];
  items?: ChildOrderItem[];
};

export type OrderTransition = "confirm" | "start-preparation" | "ready" | "dispatch" | "deliver" | "cancel";

export type OrderActionInput = {
  idempotencyKey: IdempotencyKey;
  expectedVersion?: number;
  /** فقط برای انتقال‌هایی که سرور دلیل می‌پذیرد (block/cancel). */
  reason?: string;
  /** فقط برای `dispatch`: کد رهگیری واقعیِ اپراتور — هرگز تولیدشده در مرورگر. */
  trackingCode?: string;
  carrier?: string;
};

/* ── ارسال ─────────────────────────────────────────────────────────────────── */

export type Shipment = {
  id: string;
  childOrderId: string | null;
  status: string | null;
  carrier: string | null;
  trackingCode: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  createdAt?: string | null;
};

export type ShipmentTrackingInput = {
  trackingCode: string;
  carrier?: string;
};

export type ShipmentException = {
  id: string;
  childOrderId?: string | null;
  type?: string | null;
  status?: string | null;
  note?: string | null;
  createdAt?: string | null;
};

/* ── موجودی ────────────────────────────────────────────────────────────────── */

export type InventoryRecord = {
  variantId?: string | null;
  packageId?: string | null;
  sku?: string | null;
  productName?: string | null;
  onHand?: number | string | null;
  reserved?: number | string | null;
  available?: number | string | null;
  updatedAt?: string | null;
};

/* ── مالی ──────────────────────────────────────────────────────────────────── */

export type FinancialAccountSummary = {
  supplierId?: SupplierId;
  currency?: string | null;
  pendingAmount?: Money | null;
  availableAmount?: Money | null;
  heldAmount?: Money | null;
  withdrawableAmount?: Money | null;
  lifetimeSettledAmount?: Money | null;
  payoutSubmittedAmount?: Money | null;
  bankSettledAmount?: Money | null;
  updatedAt?: string | null;
};

export type FinancialHistoryEntry = {
  id: string;
  type?: string | null;
  direction?: string | null;
  amount?: Money | null;
  balanceAfter?: Money | null;
  referenceType?: string | null;
  referenceId?: string | null;
  description?: string | null;
  createdAt?: string | null;
};

export type WithdrawalStatus = "requested" | "approved" | "rejected" | "paid" | "failed" | string;

export type WithdrawalRequest = {
  id: string;
  supplierId?: SupplierId | null;
  amount: Money;
  status: WithdrawalStatus;
  requestedAt?: string | null;
  decidedAt?: string | null;
  paidAt?: string | null;
  rejectionReason?: string | null;
  destination?: Record<string, unknown> | null;
};

export type ProformaInvoice = {
  id: string;
  reference?: string | null;
  status?: string | null;
  totalAmount?: Money | null;
  currency?: string | null;
  issuedAt?: string | null;
  dueAt?: string | null;
};

/* ── انطباق ────────────────────────────────────────────────────────────────── */

export type ComplianceProfile = Record<string, unknown> & {
  supplierId?: SupplierId;
  status?: string | null;
  updatedAt?: string | null;
};

export type ComplianceDocument = {
  id: string;
  documentType: string | null;
  originalFilename?: string | null;
  mimeType?: string | null;
  status?: string | null;
  reviewNote?: string | null;
  uploadedAt?: string | null;
  /** کلیدِ شیء هرگز در پاسخ‌های پورتال نمی‌آید؛ فقط برای ساختِ لینکِ دارای مجوز. */
  objectKey?: string | null;
};

/** پاسخِ صدورِ دسترسی: URL امضا/دارای مجوز با انقضا — جایگزینِ افشای کلیدِ شیء. */
export type DocumentAccessGrant = {
  url?: string | null;
  token?: string | null;
  expiresAt?: string | null;
  method?: string | null;
};

export type ComplianceHold = {
  id: string;
  reason?: string | null;
  status?: string | null;
  createdAt?: string | null;
  releasedAt?: string | null;
};

export type SettlementEligibility = {
  eligible?: boolean | null;
  reasons?: string[] | null;
  blockers?: string[] | null;
  evaluatedAt?: string | null;
};

export type BankDestination = {
  destinationKind?: string | null;
  value?: string | null;
  holderName?: string | null;
  status?: string | null;
  verifiedAt?: string | null;
};

export type AgreementStatus = {
  required?: unknown;
  published?: Array<{ id: string; policyType?: string; version?: string; title?: string; contentHash?: string }>;
  accepted?: boolean | null;
  acceptedAt?: string | null;
  pendingPolicyDocumentIds?: string[] | null;
};

/* ── پشتیبانی ──────────────────────────────────────────────────────────────── */

export type SupplierCasePriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type SupportCase = {
  id: string;
  subject: string | null;
  category?: string | null;
  status?: string | null;
  priority?: SupplierCasePriority | string | null;
  supplierId?: SupplierId | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  slaDueAt?: string | null;
};

export type SupportMessage = {
  id: string;
  body: string | null;
  authorType?: string | null;
  authorUserId?: string | null;
  visibility?: string | null;
  createdAt?: string | null;
};

export type SupportCaseDetail = {
  case: SupportCase;
  messages: SupportMessage[];
  relations?: unknown;
};

export type CreateCaseInput = {
  category: string;
  subject: string;
  initialMessage: string;
  priority?: SupplierCasePriority;
};

/* ── تولید ─────────────────────────────────────────────────────────────────── */

export type ProductionJobStatus =
  | "draft"
  | "planned"
  | "in_progress"
  | "blocked"
  | "completed"
  | "cancelled"
  | string;

export type ProductionJob = {
  id: string;
  supplierId?: SupplierId | null;
  childOrderId?: string | null;
  sellerId?: string | null;
  status?: ProductionJobStatus;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  actualUnits?: number | null;
  expectedUnits?: number | null;
  requiresSampleApproval?: boolean | null;
  requiresQualityRelease?: boolean | null;
  version?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ProductionMilestone = {
  id: string;
  jobId?: string;
  definitionId?: string | null;
  title?: string | null;
  status?: string | null;
  sequence?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type ProductionCapability = {
  id: string;
  capabilityCode: string;
  label: string | null;
  status?: string | null;
  declaredUnitsPerPeriod?: number | null;
};

export type CapacityPeriod = {
  id: string;
  supplierId?: SupplierId | null;
  startsAt?: string | null;
  endsAt?: string | null;
  declaredUnits?: number | null;
  reservedUnits?: number | null;
  unavailableUnits?: number | null;
  actualUnits?: number | null;
  availableUnits?: number | null;
  status?: string | null;
};

export type ProductionClosure = {
  id: string;
  capacityPeriodId?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  unavailableUnits?: number | null;
  reason?: string | null;
  status?: string | null;
};

export type ProductionSample = {
  id: string;
  jobId?: string;
  status?: string | null;
  requiredAt?: string | null;
  approvedAt?: string | null;
  revisions?: unknown[];
};

export type ProductionLot = {
  id: string;
  jobId?: string;
  lotCode?: string | null;
  status?: string | null;
  plannedUnits?: number | null;
  outputUnits?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type ProductionInspection = {
  id: string;
  jobId?: string;
  status?: string | null;
  checklistId?: string | null;
  result?: string | null;
  submittedAt?: string | null;
};

export type ProductionDefect = {
  id: string;
  jobId?: string;
  severity?: string | null;
  status?: string | null;
  description?: string | null;
  quantity?: number | null;
  dispositionNote?: string | null;
};

export type ProductionRework = {
  id: string;
  jobId?: string;
  status?: string | null;
  reason?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type ProductionChangeRequest = {
  id: string;
  jobId?: string;
  status?: string | null;
  reason?: string | null;
  requestedAt?: string | null;
  decidedAt?: string | null;
};

export type ProductionEvent = {
  id: string;
  eventType?: string | null;
  payload?: unknown;
  createdAt?: string | null;
  status?: string | null;
};

export type ReleaseReadiness = {
  ready?: boolean | null;
  blockers?: string[] | null;
  checks?: Array<{ key?: string; label?: string | null; ready?: boolean | null; detail?: string | null }> | null;
};

export type RecallRecord = {
  id: string;
  supplierId?: SupplierId | null;
  status?: string | null;
  reason?: string | null;
  createdAt?: string | null;
  submittedAt?: string | null;
};

/* ── تیم و دسترسی‌ها ─────────────────────────────────────────────────────────
 *
 * منبعِ حقیقت: `GET/PATCH/DELETE /api/v1/supplier/team/...` (بند C فاز ۶.۲).
 * پیش از این، پورتال هیچ قراردادی برای تیم نداشت و صفحهٔ «تیم» صریحاً همین
 * شکاف را اعلام می‌کرد. اکنون فهرست، نقش‌ها، افزودن، تغییرِ نقش و حذف از سرور
 * می‌آیند.
 *
 * دو نکتهٔ دامنه‌ای که از اسکیما می‌آید و در UI هم محترم است:
 *   - «دعوت‌نامهٔ ایمیلی» وجود ندارد (نه جدولِ invitation، نه ستونِ ایمیل)؛
 *     عملیاتِ پشتیبانی‌شده «افزودنِ حسابِ کاربریِ موجود» است.
 *   - ستونِ `status` در `supplier_member` نیست؛ «فعال بودن» از
 *     `account_user.status` خوانده می‌شود و «غیرفعال‌سازی» همان «حذفِ عضویت» است.
 */

/** نقش‌های عضوِ تیم — دقیقاً قیدِ CHECK دیتابیس. */
export type SupplierTeamRole = "owner" | "sales" | "warehouse" | "finance";

export type SupplierTeamMember = {
  id: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: string;
  title: string;
  /** وضعیتِ حسابِ کاربر از `account_user.status`. */
  userStatus: string;
  createdAt: string | null;
  /** آیا این ردیف خودِ کاربرِ واردشده است؟ */
  isSelf: boolean;
};

export type SupplierTeamRoleInfo = {
  code: string;
  label: string;
  permissions: readonly string[];
  canManageTeam: boolean;
};

export type SupplierTeamList = {
  members: readonly SupplierTeamMember[];
  self: SupplierTeamMember | null;
};

export type SupplierTeamRoles = {
  roles: readonly SupplierTeamRoleInfo[];
};

export type TeamMemberAddInput = {
  /** ایمیلِ حسابِ کاربریِ موجود در پلتفرم. */
  email: string;
  role: string;
  title?: string;
};

export type TeamMemberUpdateInput = {
  role?: string;
  title?: string;
};

/* ── صفحه‌بندی ─────────────────────────────────────────────────────────────── */

export type ListQuery = {
  limit?: number;
  offset?: number;
  page?: number;
  status?: string;
};

/** حالتِ صفحه‌بندیِ قراردادِ هر فهرست (طبق truth-registry). */
export const SUPPLIER_PAGINATION: Record<string, PaginationMode> = {
  products: "OFFSET",
  rfqs: "OFFSET",
  orders: "NONE",
  inventory: "NONE",
  withdrawals: "OFFSET",
  history: "OFFSET",
  supportCases: "OFFSET",
  productionJobs: "OFFSET",
  productionEvents: "OFFSET",
  capacityPeriods: "OFFSET",
  recalls: "OFFSET",
};

export type SupplierList<T> = {
  items: readonly T[];
  page: Page<T> | null;
};
