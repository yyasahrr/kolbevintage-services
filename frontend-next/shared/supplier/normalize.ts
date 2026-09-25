/**
 * نرمال‌سازیِ پاسخ‌های سرور به قراردادهای تایپ‌شدهٔ تأمین‌کننده (فاز ۶.۲).
 *
 * چرا این لایه لازم است (بررسی‌شده روی کنترلرهای واقعی):
 *
 *   - `GET /compat/supplier/orders`  → SQL خام: `order_code`, `total_amount`,
 *     `purchase_order_items[]` با `product_name`/`unit_price`
 *   - `GET /supplier/orders`         → ردیف‌های Drizzle: `orderCode`, `totalAmount`
 *   - `GET /compat/supplier/products`→ `wholesale_price`, `product_variants`
 *   - `GET /compat/supplier/rfqs`    → `reference_code`, `requested_delivery_date`
 *
 * یعنی دو سبکِ نام‌گذاری از دو مسیرِ متفاوت می‌آید. بدون این لایه، صفحه‌ها
 * مجبور بودند هر دو را بشناسند و عملاً «نگاشت» در UI پخش می‌شد.
 *
 * قاعدهٔ پول: مقدار پولی هرگز به float تبدیل نمی‌شود. اگر سرور عدد فرستاد
 * (مسیرِ compat با `Number(...)` این کار را می‌کند)، آن را **بدون هیچ محاسبه‌ای**
 * به رشته تبدیل می‌کنیم؛ مرجعِ محاسبات همچنان سرور است.
 */

import type {
  ChildOrder,
  ChildOrderItem,
  FinancialHistoryEntry,
  InventoryRecord,
  ProductionJob,
  RecallRecord,
  SupplierProduct,
  SupplierRfq,
  SupportCase,
  WithdrawalRequest,
} from "./contracts";

type Raw = Record<string, unknown>;

function record(value: unknown): Raw | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : null;
}

/** اولین مقدارِ موجود از میان کلیدهای جایگزین (camelCase یا snake_case). */
function pick(source: Raw | null, keys: readonly string[]): unknown {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

export function asString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
  return null;
}

/**
 * پول: رشتهٔ ده‌دهی یا `null`.
 * هیچ گردکردن/جمع/تفریقی انجام نمی‌شود؛ فقط «رشته‌سازیِ وفادار».
 */
export function asMoney(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return Number.isInteger(value) ? value.toString() : value.toString();
  return null;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asArray(value: unknown): Raw[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Raw => typeof item === "object" && item !== null && !Array.isArray(item));
}

/* ── محصولات ──────────────────────────────────────────────────────────────── */

export function normalizeSupplierProduct(raw: unknown): SupplierProduct | null {
  const source = record(raw);
  if (!source) return null;
  const id = asString(pick(source, ["id"]));
  if (!id) return null;
  return {
    id,
    name: asString(pick(source, ["name", "proposed_name"])) ?? "",
    sku: asString(pick(source, ["sku"])) ?? "",
    category: asString(pick(source, ["category"])) ?? "",
    description: asString(pick(source, ["description", "proposed_description"])),
    wholesalePrice: asMoney(pick(source, ["wholesalePrice", "wholesale_price"])) ?? "0",
    imageUrl: asString(pick(source, ["imageUrl", "image_url"])),
    status: asString(pick(source, ["status"])) ?? "draft",
    productVariants: asArray(pick(source, ["productVariants", "product_variants"])),
    createdAt: asString(pick(source, ["createdAt", "created_at"])),
    updatedAt: asString(pick(source, ["updatedAt", "updated_at"])),
    rejectionReason: asString(pick(source, ["rejectionReason", "rejection_reason", "reviewNote", "review_note"])),
  };
}

/* ── RFQ ──────────────────────────────────────────────────────────────────── */

export function normalizeSupplierRfq(raw: unknown): SupplierRfq | null {
  const source = record(raw);
  if (!source) return null;
  const id = asString(pick(source, ["id"]));
  if (!id) return null;
  const specs = pick(source, ["specifications"]);
  return {
    id,
    referenceCode: asString(pick(source, ["referenceCode", "reference_code"])),
    title: asString(pick(source, ["title"])) ?? "درخواست تولید",
    customerName: asString(pick(source, ["customerName", "customer_name"])),
    quantity: asNumber(pick(source, ["quantity"])),
    requestedDeliveryDate: asString(pick(source, ["requestedDeliveryDate", "requested_delivery_date"])),
    status: asString(pick(source, ["status"])) ?? "open",
    specifications: record(specs),
    createdAt: asString(pick(source, ["createdAt", "created_at"])),
  };
}

/* ── سفارش‌ها ─────────────────────────────────────────────────────────────── */

function normalizeOrderItem(raw: unknown): ChildOrderItem | null {
  const source = record(raw);
  if (!source) return null;
  return {
    id: asString(pick(source, ["id"])) ?? undefined,
    productName: asString(pick(source, ["productName", "product_name"])),
    sku: asString(pick(source, ["sku", "variantSku", "variant_sku"])),
    quantity: asNumber(pick(source, ["quantity"])),
    unitPrice: asMoney(pick(source, ["unitPrice", "unit_price"])),
    totalPrice: asMoney(pick(source, ["totalPrice", "total_price", "lineTotal", "line_total"])),
  };
}

export function normalizeChildOrder(raw: unknown): ChildOrder | null {
  const source = record(raw);
  if (!source) return null;
  const id = asString(pick(source, ["id"]));
  if (!id) return null;

  const rawItems = pick(source, ["items", "purchaseOrderItems", "purchase_order_items", "children"]);
  const items = asArray(rawItems)
    .map(normalizeOrderItem)
    .filter((item): item is ChildOrderItem => item !== null);

  return {
    id,
    orderCode: asString(pick(source, ["orderCode", "order_code"])),
    status: asString(pick(source, ["status"])) ?? "pending",
    sellerId: asString(pick(source, ["sellerId", "seller_id"])),
    totalAmount: asMoney(pick(source, ["totalAmount", "total_amount"])),
    currency: asString(pick(source, ["currency"])),
    dueDate: asString(pick(source, ["dueDate", "due_date", "dueAt", "due_at"])),
    trackingCode: asString(pick(source, ["trackingCode", "tracking_code"])),
    version: asNumber(pick(source, ["version"])),
    createdAt: asString(pick(source, ["createdAt", "created_at"])),
    updatedAt: asString(pick(source, ["updatedAt", "updated_at"])),
    items,
  };
}

/* ── موجودی ───────────────────────────────────────────────────────────────── */

export function normalizeInventoryRecord(raw: unknown): InventoryRecord | null {
  const source = record(raw);
  if (!source) return null;
  return {
    variantId: asString(pick(source, ["variantId", "variant_id"])),
    packageId: asString(pick(source, ["packageId", "package_id"])),
    sku: asString(pick(source, ["sku"])),
    productName: asString(pick(source, ["productName", "product_name"])),
    onHand: pick(source, ["onHand", "on_hand"]) as number | string | null,
    reserved: pick(source, ["reserved"]) as number | string | null,
    available: pick(source, ["available"]) as number | string | null,
    updatedAt: asString(pick(source, ["updatedAt", "updated_at"])),
  };
}

/* ── مالی ─────────────────────────────────────────────────────────────────── */

export function normalizeHistoryEntry(raw: unknown): FinancialHistoryEntry | null {
  const source = record(raw);
  if (!source) return null;
  const id = asString(pick(source, ["id"]));
  if (!id) return null;
  return {
    id,
    type: asString(pick(source, ["type", "entryType", "entry_type"])),
    direction: asString(pick(source, ["direction"])),
    amount: asMoney(pick(source, ["amount"])),
    balanceAfter: asMoney(pick(source, ["balanceAfter", "balance_after"])),
    referenceType: asString(pick(source, ["referenceType", "reference_type"])),
    referenceId: asString(pick(source, ["referenceId", "reference_id"])),
    description: asString(pick(source, ["description", "note"])),
    createdAt: asString(pick(source, ["createdAt", "created_at"])),
  };
}

export function normalizeWithdrawal(raw: unknown): WithdrawalRequest | null {
  const source = record(raw);
  if (!source) return null;
  const id = asString(pick(source, ["id"]));
  if (!id) return null;
  const destination = pick(source, ["destination"]);
  return {
    id,
    supplierId: asString(pick(source, ["supplierId", "supplier_id"])),
    amount: asMoney(pick(source, ["amount"])) ?? "0",
    status: asString(pick(source, ["status"])) ?? "requested",
    requestedAt: asString(pick(source, ["requestedAt", "requested_at", "createdAt", "created_at"])),
    decidedAt: asString(pick(source, ["decidedAt", "decided_at"])),
    paidAt: asString(pick(source, ["paidAt", "paid_at"])),
    rejectionReason: asString(pick(source, ["rejectionReason", "rejection_reason", "reason"])),
    destination: record(destination),
  };
}

/* ── پشتیبانی ─────────────────────────────────────────────────────────────── */

export function normalizeSupportCase(raw: unknown): SupportCase | null {
  const source = record(raw);
  if (!source) return null;
  const id = asString(pick(source, ["id"]));
  if (!id) return null;
  return {
    id,
    subject: asString(pick(source, ["subject"])),
    category: asString(pick(source, ["category"])),
    status: asString(pick(source, ["status"])),
    priority: asString(pick(source, ["priority"])),
    supplierId: asString(pick(source, ["supplierId", "supplier_id"])),
    createdAt: asString(pick(source, ["createdAt", "created_at"])),
    updatedAt: asString(pick(source, ["updatedAt", "updated_at"])),
    slaDueAt: asString(pick(source, ["slaDueAt", "sla_due_at"])),
  };
}

/* ── تولید ────────────────────────────────────────────────────────────────── */

export function normalizeProductionJob(raw: unknown): ProductionJob | null {
  const source = record(raw);
  if (!source) return null;
  const id = asString(pick(source, ["id"]));
  if (!id) return null;
  return {
    id,
    supplierId: asString(pick(source, ["supplierId", "supplier_id"])),
    childOrderId: asString(pick(source, ["childOrderId", "child_order_id", "purchaseOrderId", "purchase_order_id"])),
    sellerId: asString(pick(source, ["sellerId", "seller_id"])),
    status: asString(pick(source, ["status"])) ?? undefined,
    plannedStartAt: asString(pick(source, ["plannedStartAt", "planned_start_at"])),
    plannedEndAt: asString(pick(source, ["plannedEndAt", "planned_end_at"])),
    actualUnits: asNumber(pick(source, ["actualUnits", "actual_units"])),
    expectedUnits: asNumber(pick(source, ["expectedUnits", "expected_units", "plannedUnits", "planned_units"])),
    requiresSampleApproval: pick(source, ["requiresSampleApproval", "requires_sample_approval"]) === true,
    requiresQualityRelease: pick(source, ["requiresQualityRelease", "requires_quality_release"]) === true,
    version: asNumber(pick(source, ["version"])),
    createdAt: asString(pick(source, ["createdAt", "created_at"])),
    updatedAt: asString(pick(source, ["updatedAt", "updated_at"])),
  };
}

export function normalizeRecall(raw: unknown): RecallRecord | null {
  const source = record(raw);
  if (!source) return null;
  const id = asString(pick(source, ["id"]));
  if (!id) return null;
  return {
    id,
    supplierId: asString(pick(source, ["supplierId", "supplier_id"])),
    status: asString(pick(source, ["status"])),
    reason: asString(pick(source, ["reason"])),
    createdAt: asString(pick(source, ["createdAt", "created_at"])),
    submittedAt: asString(pick(source, ["submittedAt", "submitted_at"])),
  };
}

/* ── ابزارِ فهرست ─────────────────────────────────────────────────────────── */

/**
 * فهرست را از بدنهٔ پاسخ بیرون می‌کشد و نرمال می‌کند.
 *
 * نکتهٔ مهم: `null`ها حذف می‌شوند، اما یک پاسخِ نامعتبر هرگز به «فهرستِ خالیِ
 * موفق» تبدیل نمی‌شود — تصمیم دربارهٔ خالی/خطا با لایهٔ وضعیت است.
 */
export function normalizeList<T>(value: unknown, normalize: (raw: unknown) => T | null): T[] {
  const items = Array.isArray(value) ? value : asArray(value);
  return items.map(normalize).filter((item): item is T => item !== null);
}
