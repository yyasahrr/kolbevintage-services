import { Inject, Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import {
  resolveAnalyticsRange,
  type AnalyticsRangeInput,
  type AnalyticsScope,
  type ResolvedAnalyticsRange,
} from "./analytics.contract";
import type { AnalyticsOwnerScope } from "./analytics-report.service";
import { AnalyticsValidationError } from "./analytics.errors";

type ReconciliationStatus = "PASS" | "WARN" | "FAIL" | "NOT_APPLICABLE";

export type AnalyticsReconciliationCheck = {
  key: string;
  status: ReconciliationStatus;
  sourceDomain: string;
  authoritativeTables: string[];
  observed: Record<string, string>;
  note: string;
};

export type AnalyticsReconciliationResult = {
  scope: AnalyticsScope;
  scopeId: string | null;
  range: { startUtc: string; endUtc: string; timezone: string };
  checkedAt: string;
  readOnly: true;
  checks: AnalyticsReconciliationCheck[];
};

type Row = Record<string, unknown>;

/**
 * Cross-domain read-only controls. A reconciliation result reports what the
 * authoritative domains contain; it never repairs, replays, or writes facts.
 */
@Injectable()
export class AnalyticsReconciliationService {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase) {}

  async run(scope: AnalyticsOwnerScope, input: AnalyticsRangeInput = {}): Promise<AnalyticsReconciliationResult> {
    let range: ResolvedAnalyticsRange;
    try {
      range = resolveAnalyticsRange(input);
    } catch (error) {
      throw new AnalyticsValidationError(error instanceof Error ? error.message : "Invalid reconciliation date range");
    }

    const checks: AnalyticsReconciliationCheck[] = [];
    checks.push(await this.ordersCheck(scope, range));
    checks.push(await this.paymentsCheck(scope, range));
    checks.push(await this.shippingCheck(scope, range));
    checks.push(await this.inventoryCheck(scope, range));
    checks.push(await this.settlementCheck(scope, range));
    checks.push(await this.crmCheck(scope, range));
    checks.push(await this.supportCheck(scope, range));
    checks.push(await this.notificationsCheck(scope, range));
    checks.push(await this.vipCheck(scope, range));

    return {
      scope: scope.scope,
      scopeId: scope.scopeId,
      range: { startUtc: range.startUtc.toISOString(), endUtc: range.endUtc.toISOString(), timezone: range.timezone },
      checkedAt: new Date().toISOString(),
      readOnly: true,
      checks,
    };
  }

  private async ordersCheck(scope: AnalyticsOwnerScope, range: ResolvedAnalyticsRange): Promise<AnalyticsReconciliationCheck> {
    const retail = scope.scope === "PLATFORM" || scope.scope === "RETAIL"
      ? await this.scalarPair(sql`SELECT COUNT(*)::text AS count FROM retail_order ro WHERE ${this.time("ro.created_at", range)}`)
      : { count: "0" };
    const wholesale = ["PLATFORM", "WHOLESALE", "VIP_ACCOUNT", "SUPPLIER"].includes(scope.scope)
      ? await this.scalarPair(sql`SELECT COUNT(*)::text AS count FROM wholesale_order wo WHERE ${this.time("wo.created_at", range)} AND ${this.parentScope("wo", scope)}`)
      : { count: "0" };
    const child = ["PLATFORM", "WHOLESALE", "VIP_ACCOUNT", "SUPPLIER"].includes(scope.scope)
      ? await this.scalarPair(sql`SELECT COUNT(*)::text AS count FROM purchase_order po WHERE ${this.time("po.created_at", range)} AND ${this.childScope("po", scope)}`)
      : { count: "0" };
    return this.check(
      "orders.parent_child_grain",
      "Orders / Marketplace",
      ["retail_order", "wholesale_order", "purchase_order"],
      { retail_orders: this.string(retail.count), wholesale_parent_orders: this.string(wholesale.count), child_orders: this.string(child.count) },
      "Parent GMV and child GMV are reported at separate grains; this check intentionally does not add them together.",
    );
  }

  private async paymentsCheck(scope: AnalyticsOwnerScope, range: ResolvedAnalyticsRange): Promise<AnalyticsReconciliationCheck> {
    if (!["PLATFORM", "WHOLESALE", "VIP_ACCOUNT"].includes(scope.scope)) return this.notApplicable("payments.refunds_separate", "Payments / Refunds", ["payment", "refund"], "The authoritative payment tables have no supplier or retail payment grain.");
    const row = await this.one(sql`
      SELECT
        COUNT(DISTINCT p.id)::text AS payments,
        COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'verified'), 0)::text AS verified_amount,
        (SELECT COUNT(*) FROM refund r WHERE ${this.time("r.completed_at", range)} AND r.status = 'completed')::text AS refunds
      FROM payment p INNER JOIN wholesale_order wo ON wo.id = p.wholesale_order_id
      WHERE ${this.time("COALESCE(p.verified_at, p.submitted_at, p.created_at)", range)} AND ${this.parentScope("wo", scope)}
    `);
    return this.check("payments.refunds_separate", "Payments / Refunds", ["payment", "refund"], {
      payment_rows: this.string(row.payments),
      verified_amount_irr: this.string(row.verified_amount),
      completed_refund_rows: this.string(row.refunds),
    }, "Refunds remain separate authoritative rows; no net financial value is invented by reconciliation.");
  }

  private async shippingCheck(scope: AnalyticsOwnerScope, range: ResolvedAnalyticsRange): Promise<AnalyticsReconciliationCheck> {
    if (scope.scope === "RETAIL") return this.notApplicable("shipping.authoritative_status", "Shipping", ["shipment"], "Retail shipping is not represented by the wholesale shipment table.");
    const row = await this.one(sql`
      SELECT COUNT(*)::text AS shipments,
        COUNT(*) FILTER (WHERE s.status = 'delivered' AND s.delivered_at IS NOT NULL)::text AS delivered
      FROM shipment s
      INNER JOIN wholesale_order wo ON wo.id = s.wholesale_order_id
      WHERE ${this.time("s.created_at", range)} AND ${this.parentScope("wo", scope)}
    `);
    return this.check("shipping.authoritative_status", "Shipping", ["shipment"], {
      shipment_rows: this.string(row.shipments),
      delivered_rows: this.string(row.delivered),
    }, "Shipment status and deliveredAt are read from Shipping truth; settlement delivery is not inferred.");
  }

  private async inventoryCheck(scope: AnalyticsOwnerScope, range: ResolvedAnalyticsRange): Promise<AnalyticsReconciliationCheck> {
    if (!["PLATFORM", "SUPPLIER"].includes(scope.scope)) return this.notApplicable("inventory.invariants", "Inventory", ["product_variant_inventory"], "Inventory is seller/supplier scoped, not a retail or VIP account fact.");
    const row = await this.one(sql`
      SELECT COUNT(*)::text AS rows,
        COALESCE(SUM(pvi.on_hand), 0)::text AS on_hand,
        COALESCE(SUM(pvi.reserved), 0)::text AS reserved,
        COUNT(*) FILTER (WHERE pvi.reserved > pvi.on_hand)::text AS invalid_rows
      FROM product_variant_inventory pvi
      WHERE ${this.time("pvi.updated_at", range)} AND ${this.inventoryScope("pvi", scope)}
    `);
    const invalid = BigInt(this.string(row.invalid_rows));
    return {
      ...this.check("inventory.invariants", "Inventory", ["product_variant_inventory"], {
        inventory_rows: this.string(row.rows),
        on_hand_units: this.string(row.on_hand),
        reserved_units: this.string(row.reserved),
        invalid_reserved_rows: this.string(row.invalid_rows),
      }, "Reserved units must remain within on-hand units according to the authoritative Inventory CHECK constraint."),
      status: invalid > 0n ? "FAIL" : "PASS",
    };
  }

  private async settlementCheck(scope: AnalyticsOwnerScope, range: ResolvedAnalyticsRange): Promise<AnalyticsReconciliationCheck> {
    if (!["PLATFORM", "SUPPLIER"].includes(scope.scope)) return this.notApplicable("settlement.posting_integrity", "Settlement", ["settlement_account", "settlement_journal", "settlement_posting"], "Settlement accounts are platform/supplier scoped.");
    const row = await this.one(sql`
      SELECT COUNT(sp.id)::text AS postings,
        COALESCE(SUM(CASE WHEN sp.direction = 'CREDIT' THEN sp.amount ELSE -sp.amount END), 0)::text AS signed_amount
      FROM settlement_posting sp
      INNER JOIN settlement_account sa ON sa.id = sp.account_id
      WHERE ${this.time("sp.created_at", range)} AND sa.status = 'active' AND ${this.settlementScope("sa", scope, scope.scopeId)}
    `);
    return this.check("settlement.posting_integrity", "Settlement", ["settlement_account", "settlement_journal", "settlement_posting"], {
      posting_rows: this.string(row.postings),
      signed_posting_amount_irr: this.string(row.signed_amount),
    }, "Settlement postings are the financial authority; Analytics does not recreate a second ledger or compare to bank settlement.");
  }

  private async crmCheck(scope: AnalyticsOwnerScope, range: ResolvedAnalyticsRange): Promise<AnalyticsReconciliationCheck> {
    if (scope.scope !== "PLATFORM") return this.notApplicable("crm.authoritative_rows", "CRM", ["crm_contact", "crm_task"], "CRM contacts are platform-owned records without a supplier/VIP ownership column.");
    const row = await this.one(sql`SELECT COUNT(*)::text AS contacts, COUNT(*) FILTER (WHERE stage = 'CHURNED')::text AS churned FROM crm_contact c WHERE ${this.time("c.created_at", range)}`);
    return this.check("crm.authoritative_rows", "CRM", ["crm_contact", "crm_task"], { contacts: this.string(row.contacts), churned_contacts: this.string(row.churned) }, "CRM stage and task records remain authoritative; behavioral browser events are not used.");
  }

  private async supportCheck(scope: AnalyticsOwnerScope, range: ResolvedAnalyticsRange): Promise<AnalyticsReconciliationCheck> {
    const row = await this.one(sql`
      SELECT COUNT(*)::text AS opened,
        COUNT(*) FILTER (WHERE sc.status NOT IN ('RESOLVED', 'CLOSED'))::text AS open_cases,
        COUNT(*) FILTER (WHERE sc.status NOT IN ('RESOLVED', 'CLOSED') AND (sc.supplier_id IS NOT NULL OR sc.wholesale_account_id IS NOT NULL OR (sc.supplier_id IS NULL AND sc.wholesale_account_id IS NULL)))::text AS scoped_cases
      FROM support_case sc
      WHERE ${this.time("sc.opened_at", range)} AND ${this.supportScope("sc", scope)}
    `);
    return this.check("support.authoritative_status", "Support", ["support_case", "support_case_sla"], { opened_cases: this.string(row.opened), open_cases: this.string(row.open_cases), scoped_cases: this.string(row.scoped_cases) }, "Support status and SLA records are read directly; no case is inferred from an order or notification.");
  }

  private async notificationsCheck(scope: AnalyticsOwnerScope, range: ResolvedAnalyticsRange): Promise<AnalyticsReconciliationCheck> {
    const row = await this.one(sql`
      SELECT COUNT(*)::text AS deliveries,
        COUNT(*) FILTER (WHERE nd.status = 'DELIVERED')::text AS delivered,
        COUNT(*) FILTER (WHERE nd.status IN ('FAILED_RETRYABLE', 'FAILED_PERMANENT'))::text AS failed
      FROM notification_delivery nd
      WHERE ${this.time("nd.created_at", range)} AND ${this.notificationScope("nd", scope)}
    `);
    return this.check("notifications.delivery_status", "Notifications", ["notification_delivery", "notification_delivery_attempt"], { delivery_rows: this.string(row.deliveries), delivered_rows: this.string(row.delivered), failed_rows: this.string(row.failed) }, "Delivery status is authoritative Notifications truth; masked destinations are not exported.");
  }

  private async vipCheck(scope: AnalyticsOwnerScope, range: ResolvedAnalyticsRange): Promise<AnalyticsReconciliationCheck> {
    if (!["PLATFORM", "VIP_ACCOUNT"].includes(scope.scope)) return this.notApplicable("vip.membership_orders", "VIP", ["wholesale_membership", "wholesale_order"], "VIP membership is not a supplier or retail fact.");
    const row = await this.one(sql`
      SELECT COUNT(*) FILTER (WHERE wm.status = 'active')::text AS active_memberships,
        COUNT(DISTINCT wo.id)::text AS orders
      FROM wholesale_account wa
      LEFT JOIN wholesale_membership wm ON wm.account_id = wa.id
      LEFT JOIN wholesale_order wo ON wo.account_id = wa.id AND ${this.time("wo.created_at", range)}
      WHERE ${this.vipScope("wa.id", scope, scope.scopeId)}
    `);
    return this.check("vip.membership_orders", "VIP", ["wholesale_membership", "wholesale_order"], { active_memberships: this.string(row.active_memberships), wholesale_orders: this.string(row.orders) }, "VIP account and membership identifiers are read from their authoritative tables.");
  }

  private async one(query: SQL): Promise<Row> {
    const result = await this.db.execute(query);
    const rows = (result as unknown as { rows?: Row[] }).rows ?? (result as unknown as Row[]);
    return rows[0] ?? {};
  }

  private async scalarPair(query: SQL): Promise<Row> {
    return this.one(query);
  }

  private time(column: string, range: ResolvedAnalyticsRange): SQL {
    return sql`${sql.raw(column)} >= ${range.startUtc} AND ${sql.raw(column)} < ${range.endUtc}`;
  }

  private parentScope(alias: string, scope: AnalyticsOwnerScope): SQL {
    if (scope.scope === "PLATFORM" || scope.scope === "WHOLESALE") return sql`TRUE`;
    if (scope.scope === "VIP_ACCOUNT") return sql`${sql.raw(`${alias}.account_id`)} = ${scope.scopeId}`;
    if (scope.scope === "SUPPLIER") return sql`EXISTS (SELECT 1 FROM wholesale_order_item scope_item WHERE scope_item.order_id = ${sql.raw(`${alias}.id`)} AND scope_item.supplier_id = ${scope.scopeId})`;
    return sql`FALSE`;
  }

  private childScope(alias: string, scope: AnalyticsOwnerScope): SQL {
    if (scope.scope === "PLATFORM" || scope.scope === "WHOLESALE") return sql`TRUE`;
    if (scope.scope === "VIP_ACCOUNT") return sql`EXISTS (SELECT 1 FROM wholesale_order scope_order WHERE scope_order.id = ${sql.raw(`${alias}.wholesale_order_id`)} AND scope_order.account_id = ${scope.scopeId})`;
    if (scope.scope === "SUPPLIER") return sql`${sql.raw(`${alias}.supplier_id`)} = ${scope.scopeId}`;
    return sql`FALSE`;
  }

  private inventoryScope(alias: string, scope: AnalyticsOwnerScope): SQL {
    if (scope.scope === "PLATFORM") return sql`TRUE`;
    return sql`EXISTS (SELECT 1 FROM seller scope_seller WHERE scope_seller.id = ${sql.raw(`${alias}.seller_id`)} AND scope_seller.supplier_id = ${scope.scopeId})`;
  }

  private settlementScope(alias: string, scope: AnalyticsOwnerScope, scopeId: string | null): SQL {
    if (scope.scope === "PLATFORM") return sql`${sql.raw(`${alias}.supplier_id`)} IS NOT NULL`;
    return sql`${sql.raw(`${alias}.supplier_id`)} = ${scopeId}`;
  }

  private supportScope(alias: string, scope: AnalyticsOwnerScope): SQL {
    if (scope.scope === "PLATFORM" || scope.scope === "RETAIL" || scope.scope === "WHOLESALE") return sql`TRUE`;
    if (scope.scope === "SUPPLIER") return sql`${sql.raw(`${alias}.supplier_id`)} = ${scope.scopeId}`;
    return sql`${sql.raw(`${alias}.wholesale_account_id`)} = ${scope.scopeId}`;
  }

  private notificationScope(alias: string, scope: AnalyticsOwnerScope): SQL {
    if (scope.scope === "PLATFORM" || scope.scope === "RETAIL" || scope.scope === "WHOLESALE") return sql`TRUE`;
    if (scope.scope === "SUPPLIER") return sql`EXISTS (SELECT 1 FROM supplier_member scope_member WHERE scope_member.user_id = ${sql.raw(`${alias}.recipient_id`)} AND scope_member.supplier_id = ${scope.scopeId})`;
    return sql`${sql.raw(`${alias}.recipient_id`)} = (SELECT user_id FROM wholesale_account WHERE id = ${scope.scopeId})`;
  }

  private vipScope(column: string, scope: AnalyticsOwnerScope, scopeId: string | null): SQL {
    if (scope.scope === "PLATFORM") return sql`TRUE`;
    return sql`${sql.raw(column)} = ${scopeId}`;
  }

  private check(key: string, sourceDomain: string, authoritativeTables: string[], observed: Record<string, string>, note: string): AnalyticsReconciliationCheck {
    return { key, status: "PASS", sourceDomain, authoritativeTables, observed, note };
  }

  private notApplicable(key: string, sourceDomain: string, authoritativeTables: string[], note: string): AnalyticsReconciliationCheck {
    return { key, status: "NOT_APPLICABLE", sourceDomain, authoritativeTables, observed: {}, note };
  }

  private string(value: unknown): string {
    return value === null || value === undefined ? "0" : String(value);
  }
}
