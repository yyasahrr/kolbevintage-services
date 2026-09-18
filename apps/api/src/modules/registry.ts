/**
 * دفتر مالکیت ماژول‌ها (Module Ownership Registry).
 *
 * ⚠️ این فایل **قرارداد اجرایی** قاعده‌های A1–A3 است، نه مستندات:
 *
 *   A1 «No microservices» — یک اپلیکیشن NestJS با فهرست بستهٔ ماژول‌ها.
 *   A2 «A module owns its tables» — هر جدول دقیقاً به یک ماژول نسبت داده می‌شود.
 *   A3 «No cross-module table writes» — آزمون `module-boundaries.test.ts` کد هر
 *      ماژول را می‌خواند و اگر جدولی را ببیند که مالکش نیست، شکست می‌خورد.
 *
 * افزودن ماژول تازه بدون ثبت اینجا، در همان آزمون شکست می‌خورد.
 */

export type ModuleStatus = "live" | "scaffolded" | "planned";

export type ModuleDefinition = {
  /** نام پوشه در `src/modules/` (یا ماژول‌های منطقی که هنوز ساخته نشده‌اند). */
  name: string;
  /** جدول‌هایی که این ماژول مالک آن‌هاست؛ هیچ ماژول دیگری اجازهٔ نوشتن ندارد. */
  tables: string[];
  /** ماژول‌هایی که این ماژول مجاز است سرویس‌شان را import کند. */
  dependsOn: string[];
  status: ModuleStatus;
  /** فاز نقشهٔ مهاجرت که این ماژول در آن ساخته می‌شود. */
  phase: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
};

/**
 * فهرست کامل ۳۷ دامنهٔ بک‌اند.
 *
 * `tables: []` یعنی ماژول جدول اختصاصی ندارد (مثل `admin` که فقط ارکستراسیون و
 * محافظ دسترسی است) یا جدول‌هایش در فاز هدف ساخته می‌شوند.
 */
export const MODULES: readonly ModuleDefinition[] = [
  // ماژول‌های زیرساختی
  { name: "health", tables: [], dependsOn: [], status: "live", phase: 0 },
  { name: "auth", tables: ["account_user", "login_attempt", "user_session"], dependsOn: ["audit"], status: "live", phase: 2 },
  { name: "users", tables: [], dependsOn: ["auth", "audit"], status: "planned", phase: 2 },
  { name: "customers", tables: [], dependsOn: ["auth", "audit"], status: "planned", phase: 4 },
  // فاز ۳ — بازار عمده و کاتالوگ
  {
    name: "vip",
    tables: ["wholesale_account", "vip_plan", "vip_subscription", "wholesale_request"],
    dependsOn: ["customers", "pricing", "suppliers", "supplier-team", "offers", "catalog", "audit"],
    status: "scaffolded",
    phase: 3,
  },
  {
    name: "suppliers",
    tables: ["supplier", "supplier_application", "seller", "supplier_permission_config"],
    dependsOn: ["auth", "audit"],
    status: "scaffolded",
    phase: 3,
  },
  {
    name: "supplier-team",
    tables: ["supplier_member"],
    dependsOn: ["suppliers", "auth"],
    status: "scaffolded",
    phase: 3,
  },
  {
    name: "catalog",
    tables: ["brand", "category", "product", "product_media", "product_variant", "product_variant_media", "supplier_product_submission"],
    dependsOn: ["audit"],
    status: "scaffolded",
    phase: 3,
  },
  {
    name: "offers",
    tables: [
      "seller_offer",
      "offer_media",
      "wholesale_package",
      "wholesale_package_item",
      "wholesale_pricing_tier",
      "rfq",
      "quote",
    ],
    dependsOn: ["suppliers", "supplier-team", "catalog"],
    status: "scaffolded",
    phase: 3,
  },
  { name: "pricing", tables: [], dependsOn: ["offers"], status: "scaffolded", phase: 3 },
  { name: "promotions", tables: [], dependsOn: ["pricing", "orders"], status: "planned", phase: 4 },
  {
    name: "inventory",
    tables: ["product_variant_inventory", "inventory_reservation", "inventory_ledger", "command_idempotency"],
    dependsOn: ["offers", "catalog", "suppliers", "vip", "audit"],
    status: "scaffolded",
    phase: 3,
  },
  { name: "warehouses", tables: [], dependsOn: ["suppliers"], status: "planned", phase: 3 },
  { name: "carts", tables: [], dependsOn: ["catalog", "pricing"], status: "planned", phase: 4 },
  { name: "checkout", tables: ["retail_order", "retail_order_item"], dependsOn: ["pricing", "inventory", "orders"], status: "planned", phase: 4 },
  {
    name: "orders",
    tables: [
      "wholesale_order",
      "wholesale_order_item",
      "wholesale_order_request",
      "purchase_order",
      "purchase_order_item",
      "order_status_history",
      "order_event",
    ],
    dependsOn: ["vip", "pricing", "offers", "inventory", "suppliers", "catalog", "audit"],
    status: "scaffolded",
    phase: 4,
  },
  { name: "fulfillment", tables: [], dependsOn: ["orders", "inventory"], status: "planned", phase: 4 },
  { name: "shipments", tables: [], dependsOn: ["orders", "shipping"], status: "planned", phase: 4 },
  { name: "shipping", tables: [], dependsOn: ["warehouses"], status: "planned", phase: 4 },
  { name: "payments", tables: [], dependsOn: ["orders", "payment-providers"], status: "planned", phase: 5 },
  { name: "payment-providers", tables: [], dependsOn: [], status: "planned", phase: 5 },
  { name: "refunds", tables: [], dependsOn: ["payments", "orders"], status: "planned", phase: 5 },
  { name: "ledger", tables: [], dependsOn: [], status: "planned", phase: 5 },
  { name: "wallet", tables: [], dependsOn: ["ledger", "customers"], status: "planned", phase: 5 },
  { name: "settlements", tables: [], dependsOn: ["ledger", "suppliers"], status: "planned", phase: 5 },
  { name: "withdrawals", tables: [], dependsOn: ["wallet", "ledger"], status: "planned", phase: 5 },
  { name: "payouts", tables: [], dependsOn: ["settlements", "payment-providers"], status: "planned", phase: 5 },
  { name: "claims", tables: [], dependsOn: ["orders", "support"], status: "planned", phase: 5 },
  { name: "support", tables: ["support_ticket"], dependsOn: ["auth", "orders"], status: "planned", phase: 4 },
  { name: "notifications", tables: [], dependsOn: [], status: "planned", phase: 6 },
  { name: "integrations", tables: [], dependsOn: ["audit"], status: "planned", phase: 6 },
  { name: "style-builder", tables: [], dependsOn: ["catalog", "customers"], status: "planned", phase: 6 },
  { name: "try-on", tables: [], dependsOn: ["files", "catalog"], status: "planned", phase: 6 },
  { name: "analytics", tables: ["system_log"], dependsOn: [], status: "planned", phase: 6 },
  { name: "audit", tables: ["audit_log"], dependsOn: [], status: "live", phase: 0 },
  { name: "admin", tables: [], dependsOn: ["auth", "audit", "catalog", "suppliers", "vip"], status: "scaffolded", phase: 3 },
  { name: "files", tables: [], dependsOn: [], status: "planned", phase: 6 },
  // Rating foundations — part of catalog/offers
  {
    name: "ratings",
    tables: ["product_rating", "supplier_rating", "transaction_rating"],
    dependsOn: ["catalog", "suppliers", "orders"],
    status: "scaffolded",
    phase: 3,
  },
] as const;

/**
 * جدول‌هایی که در اسکیمای فعلی وجود دارند ولی هنوز ماژول مالک مشخصی ندارند.
 * پس از فاز ۳، rfq/quote به offers رفتند.
 */
export const UNASSIGNED_TABLES: readonly string[] = ["site_setting"] as const;

export const MODULE_NAMES = MODULES.map((module) => module.name);

export function moduleByName(name: string): ModuleDefinition | undefined {
  return MODULES.find((module) => module.name === name);
}

/** مالک یک جدول — یا `undefined` اگر جدول بی‌مالک باشد. */
export function ownerOfTable(table: string): string | undefined {
  return MODULES.find((module) => module.tables.includes(table))?.name;
}

/** همهٔ جدول‌های شناخته‌شده (مالک‌دار + بی‌مالک). */
export function knownTables(): Set<string> {
  return new Set([...MODULES.flatMap((module) => module.tables), ...UNASSIGNED_TABLES]);
}

/** خطاهای ساختاری دفتر مالکیت — برای آزمون و بررسی زمان راه‌اندازی. */
export function validateRegistry(): string[] {
  const problems: string[] = [];
  const seenModules = new Set<string>();
  const tableOwners = new Map<string, string>();

  for (const module of MODULES) {
    if (seenModules.has(module.name)) problems.push(`ماژول تکراری: ${module.name}`);
    seenModules.add(module.name);

    for (const table of module.tables) {
      const existing = tableOwners.get(table);
      if (existing) problems.push(`جدول ${table} هم به ${existing} و هم به ${module.name} نسبت داده شده است`);
      tableOwners.set(table, module.name);
      if (UNASSIGNED_TABLES.includes(table)) {
        problems.push(`جدول ${table} هم بی‌مالک اعلام شده و هم به ${module.name} نسبت داده شده است`);
      }
    }
  }

  for (const module of MODULES) {
    for (const dependency of module.dependsOn) {
      if (!seenModules.has(dependency)) {
        problems.push(`ماژول ${module.name} به ماژول ناشناخته ${dependency} وابسته است`);
      }
    }
  }

  // حلقهٔ وابستگی ساده (A→B→A) ممنوع است: نشانهٔ مرز اشتباه است.
  for (const module of MODULES) {
    for (const dependency of module.dependsOn) {
      const other = moduleByName(dependency);
      if (other?.dependsOn.includes(module.name)) {
        problems.push(`وابستگی دوطرفه بین ${module.name} و ${dependency}`);
      }
    }
  }

  return problems;
}
