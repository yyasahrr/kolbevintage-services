import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  knownTables,
  MODULES,
  moduleByName,
  ownerOfTable,
  UNASSIGNED_TABLES,
  validateRegistry,
} from "../src/modules/registry";

const SRC_MODULES_DIR = path.resolve(import.meta.dirname, "..", "src", "modules");

function listModuleDirectories(): string[] {
  if (!fs.existsSync(SRC_MODULES_DIR)) return [];
  return fs
    .readdirSync(SRC_MODULES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readModuleSources(moduleName: string): { file: string; content: string }[] {
  const root = path.join(SRC_MODULES_DIR, moduleName);
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) files.push(full);
    }
  };
  walk(root);
  return files.map((file) => ({
    file: path.relative(SRC_MODULES_DIR, file),
    content: fs.readFileSync(file, "utf8"),
  }));
}

function camelCase(table: string): string {
  return table.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

describe("دفتر مالکیت ماژول‌ها", () => {
  it("ساختار دفتر بی‌عیب است", () => {
    expect(validateRegistry()).toEqual([]);
  });

  it("هر ماژول فهرست‌شده در دفتر، پوشهٔ خودش را دارد (یا وضعیتش planned است)", () => {
    const directories = new Set(listModuleDirectories());
    for (const module of MODULES) {
      if (module.status === "planned") continue;
      expect(
        directories.has(module.name),
        `ماژول ${module.name} در دفتر ثبت شده اما پوشهٔ src/modules/${module.name} وجود ندارد`,
      ).toBe(true);
    }
  });

  it("هر پوشهٔ ماژول در دفتر ثبت شده است (ماژول ثبت‌نشده ممنوع)", () => {
    for (const directory of listModuleDirectories()) {
      expect(moduleByName(directory), `پوشهٔ ${directory} در registry.ts ثبت نشده است`).toBeDefined();
    }
  });

  it("هیچ جدولی دو مالک ندارد", () => {
    for (const table of knownTables()) {
      const owners = MODULES.filter((module) => module.tables.includes(table)).map((module) => module.name);
      expect(owners.length, `جدول ${table}`).toBeLessThanOrEqual(1);
    }
  });

  it("جدول‌های اسکیمای فعلی همه تعیین‌تکلیف شده‌اند (مالک‌دار یا صریحاً بی‌مالک)", () => {
    const schemaTables = [
      "account_user",
      "audit_log",
      "purchase_order",
      "purchase_order_item",
      "quote",
      "retail_order",
      "retail_order_item",
      "rfq",
      "site_setting",
      "supplier",
      "supplier_application",
      "supplier_member",
      "support_ticket",
      "system_log",
      "wholesale_account",
      "wholesale_order",
      "wholesale_order_item",
      "wholesale_order_request",
      "brand",
      "category",
      "product",
      "product_media",
      "product_variant",
      "product_variant_media",
      "supplier_product_submission",
      "seller",
      "seller_offer",
      "offer_media",
      "wholesale_package",
      "wholesale_package_item",
      "wholesale_pricing_tier",
      "supplier_permission_config",
      "vip_plan",
      "vip_subscription",
      "wholesale_request",
      "product_rating",
      "supplier_rating",
      "transaction_rating",
      "product_variant_inventory",
      "inventory_reservation",
      "inventory_ledger",
      "command_idempotency",
      "login_attempt",
      "user_session",
      "order_status_history",
      "order_event",
      "wholesale_request_revision",
      "fulfillment_exception",
      "fulfillment_replacement_request",
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
      "shipping_quote",
      "shipment",
      "shipment_item",
      "shipment_event",
      // Phase 4.7.5
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
      "commercial_invoice",
      "commercial_invoice_line",
      "fiscal_document",
      "fiscal_submission_event",
      "tax_configuration",
      // Phase 4.8
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
      // Phase 5.0
      "wholesale_plan",
      "wholesale_plan_version",
      "wholesale_plan_feature",
      "wholesale_plan_limit",
      "wholesale_membership",
      "wholesale_membership_history",
      "admin_role",
      "admin_role_permission",
      "admin_user_role",
      "approval_request",
      "business_setting",
      "business_setting_history",
      "admin_internal_note",
    ];
    const unowned = schemaTables.filter((table) => !ownerOfTable(table) && !UNASSIGNED_TABLES.includes(table));
    expect(unowned, "جدول‌های بی‌مالک — ثبت در registry.ts لازم است").toEqual([]);
  });
});

describe("مرزهای کد ماژول‌ها (A2/A3)", () => {
  it("هیچ ماژولی نام جدول خارج از مالکیت خود را در کد نمی‌آورد", () => {
    const tables = [...knownTables()];
    const violations: string[] = [];
    const READ_EXCEPTIONS: Record<string, string[]> = {
      auth: ["supplier", "supplier_member"],
      catalog: [
        "seller",
        "supplier",
        "seller_offer",
        "supplier_member",
        "brand",
        "category",
        "product_variant",
        "product_media",
        "product_variant_media",
        "product_variant_inventory",
        "rfq",
        "quote",
        "wholesale_order_item",
        "purchase_order_item",
        "offer_media",
      ],
      offers: [
        "product",
        "seller",
        "supplier",
        "product_variant",
        "wholesale_package",
        "wholesale_package_item",
        "wholesale_pricing_tier",
        "offer_media",
        "product_media",
        "product_variant_media",
        "product_variant_inventory",
        "brand",
        "category",
        "supplier_member",
      ],
      suppliers: ["seller", "supplier_member", "supplier_permission_config"],
      "supplier-team": ["supplier", "supplier_member"],
      vip: [
        "wholesale_account",
        "vip_plan",
        "vip_subscription",
        "wholesale_request",
        "wholesale_request_revision",
        "product",
        "seller_offer",
        "wholesale_package",
        "wholesale_package_item",
        "wholesale_pricing_tier",
        "seller",
        "supplier",
        "supplier_member",
        "product_variant",
        "product_variant_inventory",
        "inventory_reservation",
        "inventory_ledger",
        "command_idempotency",
        "wholesale_order",
        "wholesale_order_item",
        "wholesale_order_request",
        "product_media",
        "fulfillment_exception",
        "account_user",
      ],
      inventory: [
        "supplier",
        "supplier_member",
        "product_variant",
        "seller_offer",
        "product",
        "seller",
        "wholesale_request",
        "wholesale_account",
        "product_variant_inventory",
        "inventory_reservation",
        "inventory_ledger",
        "command_idempotency",
        "wholesale_package",
        "wholesale_package_item",
        "wholesale_order",
        "wholesale_order_item",
        "purchase_order",
        "purchase_order_item",
        "account_user",
        "audit_log",
        "brand",
        "category",
      ],
      admin: [
        "brand",
        "category",
        "product",
        "product_variant",
        "seller",
        "seller_offer",
        "supplier",
        "vip_plan",
        "wholesale_request",
        "supplier_member",
        "product_variant_inventory",
        "inventory_reservation",
        "inventory_ledger",
        "wholesale_account",
        "wholesale_order",
        "purchase_order",
        "offer_media",
        "product_media",
        "account_user",
        "audit_log",
        "wholesale_plan",
        "wholesale_plan_version",
        "wholesale_plan_feature",
        "wholesale_plan_limit",
        "wholesale_membership",
        "wholesale_membership_history",
        "wholesale_proforma",
        "payment",
        "shipment",
        "settlement_account",
        "settlement_hold",
        "supplier_compliance_hold",
      ],
      pricing: ["product", "product_variant", "seller", "wholesale_package", "wholesale_package_item", "seller_offer"],
      ratings: ["product_rating", "supplier_rating", "transaction_rating", "product", "supplier", "product_variant"],
      crm: [
        "account_user",
        "admin_internal_note",
        "wholesale_order",
        "wholesale_order_item",
        "retail_order",
        "retail_order_item",
        "wholesale_account",
        "wholesale_membership",
        "wholesale_plan",
        "consent_event",
        "payment",
        "audit_log",
      ],
      orders: [
        "wholesale_account",
        "wholesale_request",
        "wholesale_request_revision",
        "vip_plan",
        "vip_subscription",
        "product",
        "product_variant",
        "seller_offer",
        "wholesale_package",
        "wholesale_package_item",
        "wholesale_pricing_tier",
        "seller",
        "supplier",
        "supplier_member",
        "product_variant_inventory",
        "inventory_reservation",
        "inventory_ledger",
        "command_idempotency",
        "account_user",
        "audit_log",
        "brand",
        "category",
        "offer_media",
        "product_media",
        "product_variant_media",
        "quote",
        "rfq",
        "fulfillment_exception",
        "fulfillment_replacement_request",
      ],
      fulfillment: [
        "purchase_order",
        "purchase_order_item",
        "wholesale_order",
        "wholesale_order_item",
        "wholesale_order_request",
        "seller",
        "supplier",
        "supplier_member",
        "command_idempotency",
        "audit_log",
        "inventory_reservation",
        "product_variant_inventory",
        "account_user",
        "wholesale_account",
        "wholesale_request",
        "wholesale_proforma",
        "payment",
        "refund",
      ],
      payments: ["command_idempotency", "seller", "supplier", "supplier_member", "account_user", "audit_log"],
      finance: ["seller", "supplier", "supplier_member", "command_idempotency", "account_user", "audit_log"],
      shipping: ["seller", "supplier", "supplier_member", "product_variant", "product_variant_inventory", "inventory_reservation", "command_idempotency", "account_user", "audit_log"],
    };

    for (const module of MODULES) {
      if (module.status === "planned") continue;
      const owned = new Set(module.tables);
      const allowedRead = new Set(READ_EXCEPTIONS[module.name] ?? []);
      const aliases = new Map(tables.map((table) => [table, camelCase(table)]));

      for (const { file, content } of readModuleSources(module.name)) {
        const lines = content.split("\n");
        for (const [table, alias] of aliases) {
          if (owned.has(table)) continue;
          if (allowedRead.has(table)) continue;
          const sqlTablePatterns = [
            new RegExp(`\\bFROM\\s+\"?${table}\"?\\b`, "i"),
            new RegExp(`\\bINTO\\s+\"?${table}\"?\\b`, "i"),
            new RegExp(`\\bUPDATE\\s+\"?${table}\"?\\b`, "i"),
            new RegExp(`\\bJOIN\\s+\"?${table}\"?\\b`, "i"),
            new RegExp(`\\bDELETE\\s+FROM\\s+\"?${table}\"?\\b`, "i"),
            new RegExp(`\\b${table}Table\\b`),
            new RegExp(`\\b${alias}Table\\b`),
          ];
          let found = false;
          for (let idx = 0; idx < lines.length; idx++) {
            const line = lines[idx];
            if (/^\s*(payment|refund)\s*:\s*\{/.test(line)) continue;
            if (/result\.(payment|refund)\b/.test(line)) continue;
            if (/owns NO tables|owns/.test(line)) continue;
            if (/scopeType/.test(line) && /wOrder/.test(line)) continue;
            if (/PAYMENT_GATE_BLOCKED|Cannot submit payment from/.test(line)) continue;
            for (const pat of sqlTablePatterns) {
              if (pat.test(line)) {
                found = true;
                break;
              }
            }
            if (found) break;
          }
          if (found) {
            violations.push(
              `ماژول ${module.name} به جدول ${table} (مالک: ${ownerOfTable(table) ?? "بی‌مالک"}) در ${file} اشاره کرده است`,
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("ماژول‌ها فقط سطح عمومی ماژول‌های دیگر را import می‌کنند", () => {
    const allowedSurface = /(\.module|\.service|index|\.contract)\.ts$/;
    const violations: string[] = [];

    for (const module of MODULES) {
      if (module.status === "planned") continue;
      for (const { file, content } of readModuleSources(module.name)) {
        for (const match of content.matchAll(/from\s+"([^\"]*modules\/([^/\"]+)\/[^\"]+)"/g)) {
          const [, importPath, targetModule] = match;
          if (targetModule === module.name) continue;
          if (!allowedSurface.test(importPath)) {
            violations.push(
              `ماژول ${module.name} در ${file} به بخش داخلی ماژول ${targetModule} دست برده است (${importPath})`,
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("وابستگی بین ماژول‌ها فقط رو به جلو و بدون حلقه است", () => {
    for (const module of MODULES) {
      for (const dependency of module.dependsOn) {
        expect(moduleByName(dependency), `${module.name} → ${dependency}`).toBeDefined();
      }
    }
  });
});
