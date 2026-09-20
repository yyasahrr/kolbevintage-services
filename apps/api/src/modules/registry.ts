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
    tables: [
      "wholesale_account",
      "vip_plan",
      "vip_subscription",
      "wholesale_request",
      "wholesale_request_revision",
      "wholesale_plan",
      "wholesale_plan_version",
      "wholesale_plan_feature",
      "wholesale_plan_limit",
      "wholesale_membership",
      "wholesale_membership_history",
    ],
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
    dependsOn: ["compliance", "audit"],
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
    dependsOn: ["suppliers", "supplier-team", "catalog", "compliance"],
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
  { name: "fulfillment", tables: ["fulfillment_exception", "fulfillment_replacement_request"], dependsOn: ["orders", "inventory", "suppliers", "supplier-team", "audit"], status: "scaffolded", phase: 4 },
  { name: "shipments", tables: [], dependsOn: ["orders", "shipping"], status: "planned", phase: 4 },
  {
    name: "shipping",
    tables: ["shipping_quote", "shipment", "shipment_item", "shipment_event"],
    dependsOn: ["orders", "inventory", "suppliers", "audit"],
    status: "scaffolded",
    phase: 4,
  },
  {
    name: "payments",
    tables: [
      "wholesale_proforma",
      "wholesale_proforma_line",
      "payment",
      "payment_allocation",
      "order_financial_release",
      "financial_ledger_entry",
      "refund",
      "refund_allocation",
      "refund_line",
      "payment_provider_event",
    ],
    dependsOn: ["orders", "fulfillment", "audit"],
    status: "scaffolded",
    phase: 4,
  },
  { name: "finance", tables: [], dependsOn: ["payments", "orders", "fulfillment", "compliance", "audit"], status: "scaffolded", phase: 4 },
  {
    // Phase 4.7.5 — legal/consent/KYB/product-compliance/privacy foundation.
    // Owns ONLY compliance evidence tables; reads other domains through owner services.
    name: "compliance",
    tables: [
      "legal_policy_document",
      "legal_policy_acceptance",
      "consent_event",
      "business_legal_profile",
      "business_compliance_credential",
      "supplier_compliance_profile",
      "supplier_compliance_review",
      "supplier_compliance_document",
      "supplier_contract_acceptance",
      "supplier_compliance_hold",
      "supplier_bank_verification",
      "product_compliance_record",
      "product_compliance_document",
      "data_retention_policy",
      "data_subject_request",
      "legal_hold",
      "transaction_compliance_snapshot",
    ],
    dependsOn: ["auth", "suppliers", "supplier-team", "audit"],
    status: "scaffolded",
    phase: 4,
  },
  {
    // Phase 4.7.5 — commercial invoice ≠ proforma ≠ fiscal document (tax readiness only).
    name: "invoicing",
    tables: ["commercial_invoice", "commercial_invoice_line", "fiscal_document", "fiscal_submission_event", "tax_configuration"],
    dependsOn: ["orders", "payments", "compliance", "audit"],
    status: "scaffolded",
    phase: 4,
  },
  {
    // Phase 4.7.6 — read-only settlement-readiness diagnostics (admin/finance). Owns NO tables, moves
    // no money, exposes no balance; NOT the Phase 4.8 settlement module (see phase-4-8-domain-ownership).
    name: "settlement-readiness",
    tables: [],
    dependsOn: ["orders", "payments", "shipping", "compliance", "invoicing"],
    status: "scaffolded",
    phase: 4,
  },
  {
    // Phase 4.8 — Supplier Financial Account, Settlement & Payout Foundation.
    // Owns ONLY settlement tables; reads other domains through owner services.
    name: "settlement",
    tables: [
      "settlement_account",
      "settlement_journal",
      "settlement_posting",
      "commission_policy",
      "commission_snapshot",
      "shipping_economics_policy",
      "settlement_hold_policy",
      "settlement_hold",
      "settlement_batch",
      "settlement_batch_item",
      "withdrawal_request",
      "payout",
      "payout_provider_event",
      "settlement_reconciliation_run",
      "settlement_adjustment",
    ],
    dependsOn: ["orders", "payments", "shipping", "compliance", "invoicing", "suppliers", "supplier-team", "audit"],
    status: "scaffolded",
    phase: 4,
  },
  {
    // Phase 4.9 — Production Reliability, Disaster Recovery & Distributed Worker Locks.
    // Owns NO tables; delegates to owner domain services and coordinates via Postgres advisory locks.
    name: "recovery",
    tables: [],
    dependsOn: ["inventory", "shipping", "payments", "settlement", "audit"],
    status: "scaffolded",
    phase: 4,
  },
  { name: "payment-providers", tables: [], dependsOn: [], status: "planned", phase: 5 },
  { name: "refunds", tables: [], dependsOn: ["payments", "orders"], status: "planned", phase: 5 },
  { name: "ledger", tables: [], dependsOn: [], status: "planned", phase: 5 },
  { name: "wallet", tables: [], dependsOn: ["ledger", "customers"], status: "planned", phase: 5 },
  { name: "claims", tables: [], dependsOn: ["orders", "support"], status: "planned", phase: 5 },
  {
    name: "support",
    tables: [
      "support_ticket",
      "support_case",
      "support_case_status_history",
      "support_case_priority_history",
      "support_case_assignment_history",
      "support_case_relation",
      "support_message",
      "support_internal_note",
      "support_attachment",
      "support_sla_policy",
      "support_case_sla",
      "support_case_escalation_history",
      "support_case_action",
    ],
    dependsOn: ["auth", "orders", "suppliers", "vip", "audit", "admin"],
    status: "live",
    phase: 5,
  },
  { name: "notifications", tables: [], dependsOn: [], status: "planned", phase: 6 },
  { name: "integrations", tables: [], dependsOn: ["audit"], status: "planned", phase: 6 },
  { name: "style-builder", tables: [], dependsOn: ["catalog", "customers"], status: "planned", phase: 6 },
  { name: "try-on", tables: [], dependsOn: ["files", "catalog"], status: "planned", phase: 6 },
  { name: "analytics", tables: ["system_log"], dependsOn: [], status: "planned", phase: 6 },
  { name: "audit", tables: ["audit_log"], dependsOn: [], status: "live", phase: 0 },
  {
    name: "admin",
    tables: [
      "admin_role",
      "admin_role_permission",
      "admin_user_role",
      "approval_request",
      "business_setting",
      "business_setting_history",
      "admin_internal_note",
    ],
    dependsOn: ["auth", "audit", "catalog", "suppliers", "vip", "orders", "payments", "shipping", "settlement", "compliance"],
    status: "scaffolded",
    phase: 3,
  },
  {
    name: "crm",
    tables: [
      "crm_contact",
      "crm_contact_identity_link",
      "crm_stage_history",
      "crm_assignment_history",
      "crm_tag",
      "crm_contact_tag",
      "crm_activity",
      "crm_task",
    ],
    dependsOn: ["auth", "audit", "compliance", "orders", "vip", "admin"],
    status: "live",
    phase: 5,
  },
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
