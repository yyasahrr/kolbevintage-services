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

/**
 * پاسخِ واقعیِ `POST /catalog/supplier-submissions`.
 *
 * کنترلر خروجیِ `createSupplierSubmission` را بدونِ تغییر برمی‌گرداند، یعنی
 * `{ submission, duplicateCandidates }` — نه یک آبجکتِ تخت. پیش‌تر قراردادِ
 * سمتِ کلاینت `{id,name,sku,status}` ادعا می‌کرد، پس شناسه و وضعیت در UI
 * «نامشخص» می‌شد. این تایپ همان چیزی است که سرور واقعاً می‌فرستد.
 */
export type SupplierStagedSubmissionResult = {
  submission: {
    id: string;
    status: string;
    matchedProductId: string | null;
    createdAt?: string;
  };
  /**
   * محصول‌های کانونیکالی که سرور شبیه این پیشنهاد تشخیص داده. فقط برای
   * آگاهی‌رسانی است؛ هیچ تطبیقِ خودکاری انجام نمی‌شود.
   */
  duplicateCandidates: Array<{ id: string; name: string; slug: string }>;
};

/* ── محصولِ کامل (capability parity) ──────────────────────────────────────────
 * قراردادهای تایپ‌شده برای گرافِ کاملِ محصولِ تأمین‌کننده، منطبق بر بک‌اند:
 *   POST /catalog/supplier-submissions  (attributes, variants[], media[], commercial)
 *   POST /offers                        (wholesalePrice/Money, moq, moqUnit, packageType)
 *   POST /offers/packages               (SIZE_RUN/FIXED_QUANTITY/COLOR_MIX/CUSTOM_BUNDLE)
 *   POST /offers/pricing-tiers          (unitPrice/Money, minQuantity, maxQuantity?)
 *   POST /inventory/variant             (onHandDelta + idempotency-key)
 * پول همیشه `Money` (رشتهٔ ده‌دهی) است؛ هرگز number. شناسهٔ فروشنده از نشستِ
 * سرور مشتق می‌شود و هرگز از کلاینت گرفته نمی‌شود.
 * ─────────────────────────────────────────────────────────────────────────── */

export const MOQ_UNITS = ["PIECE", "PACKAGE", "SERIES", "BOX", "CARTON", "SET"] as const;
export type MoqUnit = (typeof MOQ_UNITS)[number];
export function isMoqUnit(value: unknown): value is MoqUnit {
  return typeof value === "string" && (MOQ_UNITS as readonly string[]).includes(value);
}

export const PACKAGE_TYPES = ["SIZE_RUN", "FIXED_QUANTITY", "COLOR_MIX", "CUSTOM_BUNDLE"] as const;
export type PackageType = (typeof PACKAGE_TYPES)[number];
export function isPackageType(value: unknown): value is PackageType {
  return typeof value === "string" && (PACKAGE_TYPES as readonly string[]).includes(value);
}

/** یک واریانتِ پیشنهادی: SKU + صفاتِ انعطاف‌پذیر (size/color/material/fit/…). */
export type SupplierVariantInput = {
  sku: string;
  attributes: Record<string, string | number | null>;
};

/** رسانهٔ محصول/واریانت (URL واقعیِ ذخیره‌سازی؛ هرگز URL جعلی). */
export type SupplierMediaInput = {
  url: string;
  type?: "image" | "video";
  position?: number;
  /** اگر رسانه مخصوصِ یک واریانت است. */
  variantId?: string | null;
};

/** بخشِ تجاریِ پیشنهاد (پولِ ده‌دهی + MOQ + واحدِ MOQ + نوعِ بسته). */
export type SupplierCommercialInput = {
  sku: string;
  wholesalePrice: Money;
  retailPrice?: Money;
  moq: number;
  moqUnit: MoqUnit;
  packageType?: PackageType;
};

/* ── قراردادِ کانونیکِ «گرافِ مرحله‌بندی‌شده» ──────────────────────────────────
 *
 * این انواع **دقیقاً** همان چیزی است که `POST /catalog/supplier-submissions`
 * می‌پذیرد و `approveSubmissionAsNew` ماده‌سازی می‌کند؛ نه آنچه حدس زده شده.
 * مرجعِ صحت: `apps/api/test/phase-6-7-supplier-product-roundtrip.test.ts`.
 *
 * دو تفاوتِ مهم با قراردادِ جداگانهٔ `POST /offers*` (که پایین‌تر آمده و برای
 * ویرایشِ پس‌ازتأیید است):
 *   ۱) بسته‌ها و پله‌های قیمت **داخلِ `commercial`** مرحله‌بندی می‌شوند، چون پیش
 *      از تأیید هیچ `offerId` ای وجود ندارد.
 *   ۲) ارجاع به واریانت با **SKU** است نه `variantId`، چون واریانت‌ها هنوز ساخته
 *      نشده‌اند؛ سرور هنگامِ ماده‌سازی SKU را به شناسهٔ کانونیکال نگاشت می‌کند.
 * ─────────────────────────────────────────────────────────────────────────── */

/** رسانهٔ مرحله‌بندی‌شده؛ ارجاع به واریانت با SKU. */
export type StagedMediaInput = {
  url: string;
  type?: "image" | "video";
  position?: number;
  /** SKU واریانتی که این رسانه به آن تعلق دارد؛ `null` یعنی رسانهٔ سطحِ محصول. */
  variantSku?: string | null;
};

/** موجودیِ پیشنهادیِ یک واریانت (مقدارِ مطلق، نه دلتا). */
export type StagedInventoryInput = {
  onHand: number;
};

/** واریانتِ مرحله‌بندی‌شده با صفاتِ انعطاف‌پذیر، رسانه و موجودیِ خودش. */
export type StagedVariantInput = {
  sku: string;
  attributes: Record<string, string | number | null>;
  /**
   * قصدِ تأمین‌کننده برای وضعیت؛ سرور آن را حفظ می‌کند.
   *
   * مقادیر مجاز = `PRODUCT_VARIANT_STATUSES` در اسکیما (`draft`/`active`/
   * `archived`) که با قیدِ `product_variant_status_allowed` محافظت می‌شود. این
   * فهرست با `PRODUCT_STATUSES` (وضعیتِ خودِ محصول) **یکی نیست**.
   */
  status?: "draft" | "active" | "archived";
  media?: Array<{ url: string; type?: "image" | "video"; position?: number }>;
  inventory?: StagedInventoryInput;
};

/** قلمِ یک بسته؛ ارجاع با SKU. */
export type StagedPackageItemInput = {
  sku: string;
  quantity: number;
};

/** بسته/سریِ مرحله‌بندی‌شده. `totalPieces` را سرور محاسبه و اعتبارسنجی می‌کند. */
export type StagedPackageInput = {
  packageType: PackageType;
  name: string;
  description?: string;
  items: StagedPackageItemInput[];
};

/** پلهٔ قیمتِ مرحله‌بندی‌شده؛ `maxQuantity` نبودن یعنی بدونِ سقف. */
export type StagedPricingTierInput = {
  minQuantity: number;
  maxQuantity?: number;
  unitPrice: Money;
  moqUnit?: MoqUnit;
};

/** بخشِ تجاریِ مرحله‌بندی‌شده — شاملِ بسته‌ها و پله‌های قیمت. */
export type StagedCommercialInput = {
  sku: string;
  wholesalePrice: Money;
  retailPrice?: Money;
  currency?: string;
  moq: number;
  moqUnit: MoqUnit;
  packageType?: PackageType;
  /** SKU واریانتی که پیشنهاد به آن مقید است؛ پیش‌فرض `sku`. */
  variantSku?: string | null;
  packages?: StagedPackageInput[];
  pricingTiers?: StagedPricingTierInput[];
};

/** گرافِ کاملِ مرحله‌بندی‌شده برای `POST /catalog/supplier-submissions`. */
export type SupplierStagedProductInput = {
  name: string;
  slug: string;
  description?: string;
  brandId?: string;
  proposedBrandId?: string;
  categoryId?: string;
  /** ویژگی‌های سطحِ محصول؛ فیلدهای تجاری در آن ممنوع است. */
  attributes?: Record<string, unknown>;
  variants: StagedVariantInput[];
  media: StagedMediaInput[];
  commercial?: StagedCommercialInput;
};

/**
 * آنچه ادمین پیش از تأیید می‌بیند (`GET /catalog/supplier-submissions/:id`).
 *
 * ادمین نباید دادهٔ تجاریِ پنهان را تأیید کند؛ پس این قرارداد کلِ گراف را دارد.
 */
export type SupplierSubmissionReview = {
  id: string;
  status: string;
  supplierId: string;
  sellerId: string;
  createdBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  adminReviewNote: string | null;
  matchedProductId: string | null;
  approvedProductId: string | null;
  createdAt: string;
  updatedAt: string;
  product: {
    name: string;
    slug: string;
    description: string;
    brandId: string | null;
    proposedBrandId: string | null;
    categoryId: string | null;
    attributes: Record<string, unknown>;
  };
  variants: StagedVariantInput[];
  media: StagedMediaInput[];
  commercial: StagedCommercialInput;
  packageTotals: Array<{
    name: string;
    packageType: PackageType;
    totalPieces: number;
    items: StagedPackageItemInput[];
  }>;
};

/** گرافِ کاملِ محصول برای `POST /catalog/supplier-submissions`. */
export type SupplierProductGraphInput = {
  name: string;
  slug: string;
  description?: string;
  brandId?: string;
  proposedBrandId?: string;
  categoryId?: string;
  attributes?: Record<string, unknown>;
  variants: SupplierVariantInput[];
  media: SupplierMediaInput[];
  commercial?: SupplierCommercialInput;
};

/** `POST /offers` — sellerId/sellerType از نشستِ سرور. */
export type SupplierOfferInput = {
  productId: string;
  variantId?: string | null;
  sku: string;
  wholesalePrice: Money;
  retailPrice?: Money;
  moq: number;
  moqUnit: MoqUnit;
  packageType?: PackageType;
};

/** `POST /offers/packages` — ترکیبِ بسته؛ اعتبارسنجیِ نهایی با سرور است. */
export type SupplierPackageInput = {
  offerId: string;
  packageType: PackageType;
  name: string;
  description?: string;
  items: Array<{ variantId: string; quantity: number }>;
};

/** `POST /offers/pricing-tiers` — unitPrice ده‌دهی؛ جمعِ تجاری با سرور است. */
export type SupplierPricingTierInput = {
  offerId: string;
  minQuantity: number;
  maxQuantity?: number;
  unitPrice: Money;
  moqUnit?: MoqUnit;
};

/** `POST /inventory/variant` — دلتا (نه مقدارِ مطلق) + کلیدِ idempotency. */
export type SupplierInventoryDeltaInput = {
  variantId: string;
  onHandDelta: number;
  reason?: string;
};

/**
 * جمعِ قطعاتِ یک بسته فقط برای **پیش‌نمایش** — مرجعِ نهایی سرور است.
 * (هیچ محاسبهٔ پولی اینجا انجام نمی‌شود.)
 */
export function packageTotalUnits(items: ReadonlyArray<{ quantity: number }>): number {
  return items.reduce((sum, item) => sum + (Number.isFinite(item.quantity) ? Math.max(0, Math.trunc(item.quantity)) : 0), 0);
}

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

/* ── دسته‌بندی/برند کانونیک و رسانهٔ بارگذاری‌شده ──────────────────────────────
 *
 * این انواع از پاسخِ واقعیِ `GET /catalog/categories`، `GET /catalog/brands` و
 * `POST /media/upload` آمده‌اند. دسته‌بندی درختی است و `attributesSchema` را
 * همراه دارد تا ویرایشگر ورودیِ ویژگی‌ها را از همان طرح بسازد.
 * ─────────────────────────────────────────────────────────────────────────── */

export type SupplierCategoryNode = {
  id: string;
  name: string;
  slug: string;
  /**
   * طرحِ ویژگی‌های همان دسته. ساختارِ آن در مخزن آزاد است (JSONB)، پس مقادیر
   * را بدونِ فرضِ نوع خاصی نگه می‌داریم و در لایهٔ نمایش تفسیر می‌کنیم.
   */
  attributesSchema: Record<string, unknown>;
  children: SupplierCategoryNode[];
};

export type SupplierBrand = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
};

/** پاسخِ `POST /media/upload` — هیچ اعتبارنامه‌ای در آن نیست. */
export type SupplierUploadedMedia = {
  url: string;
  key: string;
  size: number;
  kind: "image" | "video";
  provider: string;
};
