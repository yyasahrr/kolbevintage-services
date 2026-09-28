/**
 * منطق موجودی — مالکیت تأمین‌کننده، موجودی در سطح واریانت، رزرو، دفتر کل
 *
 * معماری نهایی (فاز ۳.۸ تمیز):
 *   Product Variant Inventory (variantId+sellerId) → Reservation → Order
 *   - product_variant_inventory — موجودی در سطح واریانت + فروشنده، مالک تأمین‌کننده
 *   - inventory_reservation — رزرو با انقضا
 *   - inventory_ledger — دفتر کل حرکت موجودی
 *   - InventoryService تنها مرجع تغییر موجودی
 */

import { CatalogDomainError } from "../catalog/catalog.logic";
export { CatalogDomainError };

export type InventoryStatus = "active" | "archived";
export type ReservationStatus = "pending" | "active" | "released" | "confirmed" | "expired" | "cancelled";
export type LedgerChangeType = "INCREASE" | "DECREASE" | "RESERVE" | "RELEASE" | "ADJUSTMENT";

export type VariantInventory = {
  id: string;
  variantId: string;
  sellerId: string;
  onHand: number;
  reserved: number;
  status: InventoryStatus;
};

export type Reservation = {
  id: string;
  variantId: string;
  sellerId: string;
  quantity: number;
  status: ReservationStatus;
  expiresAt?: Date | null;
  requestId?: string | null;
  createdBy?: string | null;
};

export type ReservationPackageItem = {
  variantId: string;
  quantity: number;
};

export type ReservationPackage = {
  requestId: string;
  sellerId: string;
  items: ReservationPackageItem[];
};

export type LedgerEntry = {
  id: string;
  variantId: string;
  sellerId: string;
  changeType: LedgerChangeType;
  quantityDelta: number;
  beforeOnHand: number;
  afterOnHand: number;
  beforeReserved: number;
  afterReserved: number;
  reason?: string | null;
};

export function calculateAvailable(inventory: VariantInventory): number {
  return Math.max(0, inventory.onHand - inventory.reserved);
}

export function assertSupplierOwnsInventory(
  requesterSellerId: string,
  inventorySellerId: string,
  role: string,
): void {
  if (role === "supplier" && requesterSellerId !== inventorySellerId) {
    throw new CatalogDomainError(
      "INVENTORY_OWNERSHIP_VIOLATION",
      "موجودی فقط متعلق به تأمین‌کنندهٔ مالک است — کلبه مالک موجودی تأمین‌کننده نمی‌شود",
    );
  }
}

export function assertInventoryMutationAllowed(
  role: string,
  requesterSellerId: string | null,
  targetSellerId: string,
): void {
  // Customer/VIP cannot mutate inventory directly
  if (role === "customer" || role === "vip") {
    throw new CatalogDomainError(
      "INVENTORY_MUTATION_FORBIDDEN",
      "مشتری نمی‌تواند موجودی را تغییر دهد — فقط تأمین‌کننده و ادمین",
    );
  }
  // Supplier must have sellerId from auth and must own target
  if (role === "supplier") {
    if (!requesterSellerId) {
      throw new CatalogDomainError(
        "SUPPLIER_IDENTITY_REQUIRED",
        "هویت تأمین‌کننده از نشست احراز هویت لازم است — sellerId از کلاینت پذیرفته نمی‌شود",
      );
    }
    if (requesterSellerId !== targetSellerId) {
      throw new CatalogDomainError(
        "INVENTORY_OWNERSHIP_VIOLATION",
        "تأمین‌کننده A نمی‌تواند موجودی تأمین‌کننده B را تغییر دهد",
      );
    }
  }
  // admin and system allowed all
  if (role === "admin" || role === "system") return;
  // supplier already checked
  if (role === "supplier") return;
  throw new CatalogDomainError("INVALID_ROLE_FOR_INVENTORY", "نقش نامعتبر برای تغییر موجودی");
}

export function assertReservationMutationAllowed(
  role: string,
  requesterSellerId: string | null,
  reservationSellerId: string,
): void {
  if (role === "customer") {
    throw new CatalogDomainError("RESERVATION_FORBIDDEN", "مشتری نمی‌تواند رزرو را مستقیم تغییر دهد");
  }
  if (role === "supplier") {
    if (!requesterSellerId) {
      throw new CatalogDomainError("SUPPLIER_IDENTITY_REQUIRED", "هویت تأمین‌کننده لازم است");
    }
    if (requesterSellerId !== reservationSellerId) {
      throw new CatalogDomainError("RESERVATION_OWNERSHIP_VIOLATION", "تأمین‌کننده نمی‌تواند رزرو تأمین‌کننده دیگر را تغییر دهد");
    }
  }
  // vip can release own reservation? Allowed in transition logic for released
  // admin/system allowed
}

export function assertInventoryCanReserve(
  inventory: VariantInventory,
  quantity: number,
): void {
  if (inventory.status !== "active") {
    throw new CatalogDomainError("INVENTORY_NOT_ACTIVE", "موجودی فعال نیست");
  }
  const available = calculateAvailable(inventory);
  if (quantity > available) {
    throw new CatalogDomainError(
      "INSUFFICIENT_AVAILABLE",
      `موجودی قابل رزرو کافی نیست — در دسترس ${available}، درخواستی ${quantity}`,
    );
  }
  if (quantity <= 0) {
    throw new CatalogDomainError("INVALID_RESERVE_QUANTITY", "تعداد رزرو باید مثبت باشد");
  }
}

export function transitionReservation(
  current: ReservationStatus,
  next: ReservationStatus,
  actorRole: "vip" | "supplier" | "admin" | "system",
): void {
  const allowed: Record<ReservationStatus, Array<{ to: ReservationStatus; roles: string[] }>> = {
    pending: [
      { to: "active", roles: ["supplier", "admin", "system"] },
      { to: "cancelled", roles: ["vip", "supplier", "admin", "system"] },
      { to: "expired", roles: ["system"] },
    ],
    active: [
      { to: "confirmed", roles: ["supplier", "admin", "system"] },
      { to: "released", roles: ["supplier", "admin", "system", "vip"] },
      { to: "expired", roles: ["system"] },
      { to: "cancelled", roles: ["supplier", "admin", "system"] },
    ],
    released: [],
    confirmed: [],
    expired: [],
    cancelled: [],
  };

  const transitions = allowed[current] || [];
  const found = transitions.find((t) => t.to === next && t.roles.includes(actorRole));
  if (!found) {
    throw new CatalogDomainError(
      "INVALID_RESERVATION_TRANSITION",
      `انتقال رزرو از ${current} به ${next} با نقش ${actorRole} مجاز نیست`,
    );
  }
}

export function assertReservationTransition(
  reservation: Reservation,
  next: ReservationStatus,
  requester: { userId: string; role: string },
): void {
  const role = requester.role as "vip" | "supplier" | "admin" | "system";
  return transitionReservation(reservation.status, next, role);
}

export function validateReservationPackage(pkg: ReservationPackage): void {
  if (!pkg.items || pkg.items.length === 0) {
    throw new CatalogDomainError("PACKAGE_EMPTY", "بستهٔ رزرو نمی‌تواند خالی باشد");
  }
  for (const item of pkg.items) {
    if (!item.variantId) throw new CatalogDomainError("PACKAGE_VARIANT_REQUIRED", "شناسهٔ واریانت لازم است");
    if (item.quantity <= 0) throw new CatalogDomainError("PACKAGE_QTY_INVALID", "تعداد هر آیتم باید مثبت باشد");
  }
  // No partial — duplicate variant means partial logic, forbidden
  const seen = new Set<string>();
  for (const item of pkg.items) {
    if (seen.has(item.variantId)) {
      throw new CatalogDomainError("PACKAGE_DUPLICATE_VARIANT", "واریانت تکراری در بسته مجاز نیست — all-or-nothing");
    }
    seen.add(item.variantId);
  }
}

export function isReservationExpired(reservation: Reservation): boolean {
  if (!reservation.expiresAt) return false;
  return new Date(reservation.expiresAt).getTime() < Date.now();
}

export function createLedgerEntry(
  inventory: VariantInventory,
  changeType: LedgerChangeType,
  quantityDelta: number,
  reason?: string,
  actorId?: string,
): LedgerEntry {
  let beforeOnHand = inventory.onHand;
  let afterOnHand = inventory.onHand;
  let beforeReserved = inventory.reserved;
  let afterReserved = inventory.reserved;

  switch (changeType) {
    case "INCREASE":
      afterOnHand = beforeOnHand + quantityDelta;
      break;
    case "DECREASE":
      afterOnHand = Math.max(0, beforeOnHand - Math.abs(quantityDelta));
      break;
    case "RESERVE":
      afterReserved = beforeReserved + quantityDelta;
      break;
    case "RELEASE":
      afterReserved = Math.max(0, beforeReserved - Math.abs(quantityDelta));
      break;
    case "ADJUSTMENT":
      afterOnHand = beforeOnHand + quantityDelta;
      break;
  }

  return {
    id: `iled_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    variantId: inventory.variantId,
    sellerId: inventory.sellerId,
    changeType,
    quantityDelta,
    beforeOnHand,
    afterOnHand,
    beforeReserved,
    afterReserved,
    reason: reason || null,
  };
}

/**
 * محاسبهٔ موجودی بستهٔ عمده — حداقل موجودی در بین واریانت‌ها
 * مثال: بسته شامل S:2, M:2, L:2 — اگر S فقط 1 موجود باشد، کل بسته 0 قابل عرضه
 */
export function calculatePackageAvailability(
  packageItems: Array<{ variantId: string; requiredQty: number; available: number }>,
): number {
  if (packageItems.length === 0) return 0;
  const packageCounts = packageItems.map((item) => Math.floor(item.available / item.requiredQty));
  return Math.min(...packageCounts);
}

/**
 * اعتبارسنجی موجودی واریانت برای پوشاک/کفش/اکسسوری
 */
export function validateVariantInventoryExamples(): void {
  // پوشاک: S:10, M:20, L:5
  // کفش: 40:10, 41:20, 42:5
  // اکسسوری: Black:100, White:50
  // این تابع فقط برای مستندسازی است — منطق واقعی در سرویس است
}
