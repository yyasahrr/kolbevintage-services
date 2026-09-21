import { Inject, Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type { AnalyticsScope } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import {
  ANALYTICS_MAX_METRICS_PER_RUN,
  type AnalyticsBreakdownItem,
  type AnalyticsDefinition,
  type AnalyticsMetricResult,
  type AnalyticsMetricValue,
  type AnalyticsReportResult,
  type AnalyticsRatioValue,
  type ResolvedAnalyticsRange,
  parseInteger,
  ratioValue,
  resolveAnalyticsRange,
} from "./analytics.contract";
import { getMetricDefinition, type AnalyticsMetricDefinition } from "./analytics-metrics";
import { AnalyticsValidationError } from "./analytics.errors";

export type AnalyticsScopeContext = {
  scope: AnalyticsScope;
  scopeId: string | null;
};

type MetricQueryValue = {
  value: AnalyticsMetricValue;
  breakdown?: AnalyticsBreakdownItem[];
};

type DbRow = Record<string, unknown>;

/**
 * Read-only query layer for the metric dictionary. Every SQL statement in this
 * service is fixed in source code; user input is only passed as parameters.
 */
@Injectable()
export class AnalyticsQueryService {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase) {}

  async run(definition: AnalyticsDefinition, reportRunId?: string): Promise<AnalyticsReportResult> {
    const range = this.resolveRange(definition);
    this.validateDefinition(definition);
    const dataAsOf = await this.databaseNow();
    const metrics: AnalyticsMetricResult[] = [];

    for (const key of definition.metricKeys) {
      const metric = getMetricDefinition(key);
      if (!metric) throw new AnalyticsValidationError(`Unknown analytics metric '${key}'`);
      const value = await this.queryMetric(metric, range, definition.scope, definition.scopeId ?? null, dataAsOf);
      let comparison: AnalyticsMetricValue | null = null;
      if (range.comparisonStartUtc && range.comparisonEndUtc) {
        const comparisonValue = await this.queryMetric(
          metric,
          {
            ...range,
            startUtc: range.comparisonStartUtc,
            endUtc: range.comparisonEndUtc,
          },
          definition.scope,
          definition.scopeId ?? null,
          dataAsOf,
        );
        comparison = comparisonValue.value;
      }

      metrics.push({
        key: metric.key,
        label: metric.label,
        unit: metric.unit,
        value: value.value,
        ...(value.breakdown ? { breakdown: value.breakdown } : {}),
        range: { startUtc: range.startUtc.toISOString(), endUtc: range.endUtc.toISOString() },
        comparison: { mode: range.comparison, value: comparison },
        freshness: {
          mode: "LIVE",
          sourceMode: "AUTHORITATIVE_LIVE",
          dataAsOf: dataAsOf.toISOString(),
          snapshot: false,
          // No cached watermark is claimed. The value was read from the source
          // tables in this run; source-specific updated_at is not a snapshot.
          sourceLastUpdatedAt: null,
        },
      });
    }

    const freshness = {
      mode: "LIVE" as const,
      sourceMode: "AUTHORITATIVE_LIVE" as const,
      dataAsOf: dataAsOf.toISOString(),
      snapshot: false as const,
      sourceLastUpdatedAt: null,
    };

    return {
      ...(reportRunId ? { reportRunId } : {}),
      scope: definition.scope,
      scopeId: definition.scopeId ?? null,
      timezone: range.timezone,
      range: {
        ...range,
        startUtc: range.startUtc.toISOString(),
        endUtc: range.endUtc.toISOString(),
        comparisonStartUtc: range.comparisonStartUtc?.toISOString() ?? null,
        comparisonEndUtc: range.comparisonEndUtc?.toISOString() ?? null,
      },
      metrics,
      freshness,
    };
  }

  private resolveRange(definition: AnalyticsDefinition): ResolvedAnalyticsRange {
    try {
      return resolveAnalyticsRange(definition.range);
    } catch (error) {
      throw new AnalyticsValidationError(error instanceof Error ? error.message : "Invalid analytics date range");
    }
  }

  private validateDefinition(definition: AnalyticsDefinition): void {
    if (!definition || !Array.isArray(definition.metricKeys) || definition.metricKeys.length === 0) {
      throw new AnalyticsValidationError("At least one allowlisted analytics metric is required");
    }
    if (definition.metricKeys.length > ANALYTICS_MAX_METRICS_PER_RUN) {
      throw new AnalyticsValidationError(`A report may contain at most ${ANALYTICS_MAX_METRICS_PER_RUN} metrics`);
    }
    if (!definition.scope) throw new AnalyticsValidationError("Analytics scope is required");
    if (["SUPPLIER", "VIP_ACCOUNT"].includes(definition.scope) && !definition.scopeId) {
      throw new AnalyticsValidationError(`${definition.scope} requires a server-resolved scopeId`);
    }
    if (!["SUPPLIER", "VIP_ACCOUNT"].includes(definition.scope) && definition.scopeId) {
      throw new AnalyticsValidationError(`${definition.scope} cannot carry a tenant scopeId`);
    }
    for (const key of definition.metricKeys) {
      const metric = getMetricDefinition(key);
      if (!metric) throw new AnalyticsValidationError(`Unknown analytics metric '${key}'`);
      if (!metric.supportedScopes.includes(definition.scope)) {
        throw new AnalyticsValidationError(`Metric '${key}' is not defined for scope '${definition.scope}'`);
      }
    }
  }

  private async databaseNow(): Promise<Date> {
    const rows = await this.rows<{ now: unknown }>(sql`SELECT NOW() AS now`);
    const value = rows[0]?.now;
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return new Date();
    return date;
  }

  private async rows<T extends DbRow>(query: SQL): Promise<T[]> {
    const result = await this.db.execute(query);
    const rows = (result as unknown as { rows?: T[] }).rows;
    return rows ?? (result as unknown as T[]);
  }

  private async queryMetric(
    metric: AnalyticsMetricDefinition,
    range: Pick<ResolvedAnalyticsRange, "startUtc" | "endUtc">,
    scope: AnalyticsScope,
    scopeId: string | null,
    dataAsOf: Date,
  ): Promise<MetricQueryValue> {
    const kind = metric.queryKind;
    switch (kind) {
      case "platform_accounts":
        return this.count(sql`
          SELECT COUNT(*)::text AS value
          FROM account_user u
          WHERE ${this.time("u.created_at", range)}
        `);
      case "platform_orders":
        return this.count(sql`
          SELECT (
            (SELECT COUNT(*) FROM retail_order ro WHERE ${this.time("ro.created_at", range)}) +
            (SELECT COUNT(*) FROM wholesale_order wo WHERE ${this.time("wo.created_at", range)})
          )::text AS value
        `);
      case "retail_orders":
        return this.count(sql`
          SELECT COUNT(*)::text AS value FROM retail_order ro
          WHERE ${this.time("ro.created_at", range)}
        `);
      case "retail_units":
        return this.count(sql`
          SELECT COALESCE(SUM(roi.quantity), 0)::text AS value
          FROM retail_order_item roi
          INNER JOIN retail_order ro ON ro.id = roi.order_id
          WHERE ${this.time("ro.created_at", range)}
        `, "integer");
      case "retail_ordered_gmv":
        return this.money(sql`
          SELECT COALESCE(SUM(ro.total_amount), 0)::text AS value FROM retail_order ro
          WHERE ${this.time("ro.created_at", range)}
        `);
      case "retail_paid_orders":
        return this.count(sql`
          SELECT COUNT(*)::text AS value FROM retail_order ro
          WHERE ${this.time("ro.created_at", range)} AND ro.payment_status = 'paid'
        `);
      case "retail_status_counts":
        return this.groupedCount(sql`
          SELECT ro.order_status AS bucket, COUNT(*)::text AS value
          FROM retail_order ro
          WHERE ${this.time("ro.created_at", range)}
          GROUP BY ro.order_status ORDER BY ro.order_status
        `);
      case "wholesale_orders":
        return this.count(sql`
          SELECT COUNT(*)::text AS value FROM wholesale_order wo
          WHERE ${this.time("wo.created_at", range)} AND ${this.parentScope("wo", scope, scopeId)}
        `);
      case "wholesale_units":
        return this.count(sql`
          SELECT COALESCE(SUM(woi.piece_quantity), 0)::text AS value
          FROM wholesale_order_item woi
          INNER JOIN wholesale_order wo ON wo.id = woi.order_id
          WHERE ${this.time("wo.created_at", range)} AND ${this.parentScope("wo", scope, scopeId)}
        `, "integer");
      case "wholesale_ordered_gmv":
        return this.money(sql`
          SELECT COALESCE(SUM(wo.grand_total), 0)::text AS value FROM wholesale_order wo
          WHERE ${this.time("wo.created_at", range)} AND ${this.parentScope("wo", scope, scopeId)}
        `);
      case "wholesale_confirmed_orders":
        return this.count(sql`
          SELECT COUNT(*)::text AS value FROM wholesale_order wo
          WHERE ${this.time("wo.created_at", range)}
            AND wo.status IN ('confirmed', 'awaiting_payment', 'processing', 'fulfillment', 'shipped', 'completed')
            AND ${this.parentScope("wo", scope, scopeId)}
        `);
      case "child_orders":
        return this.count(sql`
          SELECT COUNT(*)::text AS value FROM purchase_order po
          WHERE ${this.time("po.created_at", range)} AND ${this.childScope("po", scope, scopeId)}
        `);
      case "child_gmv":
        return this.money(sql`
          SELECT COALESCE(SUM(po.grand_total), 0)::text AS value FROM purchase_order po
          WHERE ${this.time("po.created_at", range)} AND ${this.childScope("po", scope, scopeId)}
        `);
      case "supplier_child_orders":
        return this.count(sql`
          SELECT COUNT(*)::text AS value FROM purchase_order po
          WHERE ${this.time("po.created_at", range)} AND ${this.supplierIdPredicate("po.supplier_id", scope, scopeId)}
        `);
      case "supplier_units":
        return this.count(sql`
          SELECT COALESCE(SUM(poi.quantity), 0)::text AS value
          FROM purchase_order_item poi
          INNER JOIN purchase_order po ON po.id = poi.purchase_order_id
          WHERE ${this.time("po.created_at", range)} AND ${this.supplierIdPredicate("po.supplier_id", scope, scopeId)}
        `, "integer");
      case "supplier_delivered_shipments":
        return this.count(sql`
          SELECT COUNT(*)::text AS value
          FROM shipment sh
          INNER JOIN seller ss ON ss.id = sh.seller_id
          WHERE sh.status = 'delivered'
            AND ${this.time("sh.delivered_at", range)}
            AND ${this.supplierIdPredicate("ss.supplier_id", scope, scopeId)}
        `);
      case "vip_active_memberships":
        return this.count(sql`
          SELECT COUNT(*)::text AS value
          FROM wholesale_membership wm
          WHERE wm.status = 'active'
            AND wm.updated_at < ${range.endUtc}
            AND ${this.vipScope("wm.account_id", scope, scopeId)}
        `);
      case "vip_orders":
        return this.count(sql`
          SELECT COUNT(*)::text AS value FROM wholesale_order wo
          WHERE ${this.time("wo.created_at", range)} AND ${this.parentScope("wo", scope, scopeId)}
        `);
      case "vip_gmv":
        return this.money(sql`
          SELECT COALESCE(SUM(wo.grand_total), 0)::text AS value FROM wholesale_order wo
          WHERE ${this.time("wo.created_at", range)} AND ${this.parentScope("wo", scope, scopeId)}
        `);
      case "inventory_on_hand":
        return this.inventory(sql`SELECT COALESCE(SUM(pvi.on_hand), 0)::text AS value
          FROM product_variant_inventory pvi
          WHERE pvi.status = 'active' AND pvi.updated_at < ${range.endUtc} AND ${this.inventoryScope("pvi", scope, scopeId)}`);
      case "inventory_reserved":
        return this.inventory(sql`SELECT COALESCE(SUM(pvi.reserved), 0)::text AS value
          FROM product_variant_inventory pvi
          WHERE pvi.status = 'active' AND pvi.updated_at < ${range.endUtc} AND ${this.inventoryScope("pvi", scope, scopeId)}`);
      case "inventory_available":
        return this.inventory(sql`SELECT COALESCE(SUM(pvi.on_hand - pvi.reserved), 0)::text AS value
          FROM product_variant_inventory pvi
          WHERE pvi.status = 'active' AND pvi.updated_at < ${range.endUtc} AND ${this.inventoryScope("pvi", scope, scopeId)}`);
      case "payment_submitted_amount":
        return this.money(sql`SELECT COALESCE(SUM(p.amount), 0)::text AS value
          FROM payment p INNER JOIN wholesale_order wo ON wo.id = p.wholesale_order_id
          WHERE ${this.time("COALESCE(p.submitted_at, p.created_at)", range)} AND ${this.parentScope("wo", scope, scopeId)}`);
      case "payment_confirmed_amount":
        return this.money(sql`SELECT COALESCE(SUM(p.amount), 0)::text AS value
          FROM payment p INNER JOIN wholesale_order wo ON wo.id = p.wholesale_order_id
          WHERE p.status = 'verified' AND ${this.time("p.verified_at", range)} AND ${this.parentScope("wo", scope, scopeId)}`);
      case "payment_failed_count":
        return this.count(sql`SELECT COUNT(*)::text AS value
          FROM payment p INNER JOIN wholesale_order wo ON wo.id = p.wholesale_order_id
          WHERE p.status IN ('failed', 'cancelled') AND ${this.time("p.updated_at", range)} AND ${this.parentScope("wo", scope, scopeId)}`);
      case "refund_completed_amount":
        return this.money(sql`SELECT COALESCE(SUM(r.amount), 0)::text AS value
          FROM refund r INNER JOIN wholesale_order wo ON wo.id = r.wholesale_order_id
          WHERE r.status = 'completed' AND ${this.time("r.completed_at", range)} AND ${this.parentScope("wo", scope, scopeId)}`);
      case "refund_completed_count":
        return this.count(sql`SELECT COUNT(*)::text AS value
          FROM refund r INNER JOIN wholesale_order wo ON wo.id = r.wholesale_order_id
          WHERE r.status = 'completed' AND ${this.time("r.completed_at", range)} AND ${this.parentScope("wo", scope, scopeId)}`);
      case "settlement_pending":
        return this.settlementBalance("SUPPLIER_PENDING_PAYABLE", scopeId, range, scope);
      case "settlement_available":
        return this.settlementBalance("SUPPLIER_AVAILABLE_PAYABLE", scopeId, range, scope);
      case "settlement_held":
        return this.settlementBalance("SUPPLIER_HOLD", scopeId, range, scope);
      case "settlement_commission":
        return this.settlementBalance("PLATFORM_FEE", null, range, scope);
      case "withdrawal_amount":
        return this.money(sql`SELECT COALESCE(SUM(wr.amount), 0)::text AS value FROM withdrawal_request wr
          WHERE ${this.time("wr.created_at", range)} AND ${this.supplierIdPredicate("wr.supplier_id", scope, scopeId)}`);
      case "payout_submitted":
        return this.money(sql`SELECT COALESCE(SUM(p.amount), 0)::text AS value FROM payout p
          WHERE p.status IN ('pending', 'processing') AND ${this.time("COALESCE(p.processing_at, p.created_at)", range)} AND ${this.supplierIdPredicate("p.supplier_id", scope, scopeId)}`);
      case "payout_succeeded":
        return this.money(sql`SELECT COALESCE(SUM(p.amount), 0)::text AS value FROM payout p
          WHERE p.status = 'succeeded' AND ${this.time("p.succeeded_at", range)} AND ${this.supplierIdPredicate("p.supplier_id", scope, scopeId)}`);
      case "crm_contacts":
        return this.count(sql`SELECT COUNT(*)::text AS value FROM crm_contact c WHERE ${this.time("c.created_at", range)}`);
      case "crm_overdue_tasks":
        return this.count(sql`SELECT COUNT(*)::text AS value FROM crm_task t
          WHERE t.status = 'OPEN' AND t.due_at IS NOT NULL AND t.due_at < ${dataAsOf}`);
      case "support_open_cases":
        return this.count(sql`SELECT COUNT(*)::text AS value FROM support_case sc
          WHERE sc.opened_at < ${range.endUtc} AND sc.status NOT IN ('RESOLVED', 'CLOSED') AND ${this.supportScope("sc", scope, scopeId)}`);
      case "support_sla_breaches":
        return this.count(sql`SELECT COUNT(*)::text AS value
          FROM support_case sc INNER JOIN support_case_sla sla ON sla.case_id = sc.id
          WHERE sc.opened_at < ${range.endUtc} AND sc.status NOT IN ('RESOLVED', 'CLOSED')
            AND ((sla.first_response_due_at < ${dataAsOf} AND sla.first_response_at IS NULL)
              OR (sla.resolution_due_at < ${dataAsOf} AND sla.resolved_at IS NULL))
            AND ${this.supportScope("sc", scope, scopeId)}`);
      case "notification_sent_count":
        return this.count(sql`SELECT COUNT(*)::text AS value FROM notification_delivery nd
          WHERE nd.status IN ('SENT', 'DELIVERED') AND ${this.time("COALESCE(nd.last_attempt_at, nd.scheduled_at)", range)}
            AND ${this.notificationScope("nd", scope, scopeId)}`);
      case "notification_delivered_count":
        return this.count(sql`SELECT COUNT(*)::text AS value FROM notification_delivery nd
          WHERE nd.status = 'DELIVERED' AND ${this.time("nd.delivered_at", range)}
            AND ${this.notificationScope("nd", scope, scopeId)}`);
      case "notification_failed_count":
        return this.count(sql`SELECT COUNT(*)::text AS value FROM notification_delivery nd
          WHERE nd.status IN ('FAILED_RETRYABLE', 'FAILED_PERMANENT') AND ${this.time("COALESCE(nd.failed_at, nd.updated_at)", range)}
            AND ${this.notificationScope("nd", scope, scopeId)}`);
      case "notification_delivery_success_rate":
        return this.ratio(sql`SELECT
            COUNT(*) FILTER (WHERE nd.status = 'DELIVERED')::text AS numerator,
            COUNT(*) FILTER (WHERE nd.status IN ('DELIVERED', 'FAILED_PERMANENT'))::text AS denominator
          FROM notification_delivery nd
          WHERE ${this.time("COALESCE(nd.delivered_at, nd.failed_at, nd.updated_at)", range)}
            AND ${this.notificationScope("nd", scope, scopeId)}`);
      default:
        throw new AnalyticsValidationError(`Metric '${metric.key}' has no query implementation`);
    }
  }

  private time(column: string, range: Pick<ResolvedAnalyticsRange, "startUtc" | "endUtc">): SQL {
    return sql`${sql.raw(column)} >= ${range.startUtc} AND ${sql.raw(column)} < ${range.endUtc}`;
  }

  private parentScope(alias: string, scope: AnalyticsScope, scopeId: string | null): SQL {
    if (scope === "PLATFORM" || scope === "WHOLESALE") return sql`TRUE`;
    if (scope === "VIP_ACCOUNT") return sql`${sql.raw(`${alias}.account_id`)} = ${scopeId}`;
    if (scope === "SUPPLIER") {
      return sql`EXISTS (SELECT 1 FROM wholesale_order_item scope_woi WHERE scope_woi.order_id = ${sql.raw(`${alias}.id`)} AND scope_woi.supplier_id = ${scopeId})`;
    }
    throw new AnalyticsValidationError(`Wholesale source cannot be queried with scope '${scope}'`);
  }

  private childScope(alias: string, scope: AnalyticsScope, scopeId: string | null): SQL {
    if (scope === "PLATFORM" || scope === "WHOLESALE") return sql`TRUE`;
    if (scope === "SUPPLIER") return sql`${sql.raw(`${alias}.supplier_id`)} = ${scopeId}`;
    if (scope === "VIP_ACCOUNT") return sql`EXISTS (SELECT 1 FROM wholesale_order scope_wo WHERE scope_wo.id = ${sql.raw(`${alias}.wholesale_order_id`)} AND scope_wo.account_id = ${scopeId})`;
    throw new AnalyticsValidationError(`Marketplace source cannot be queried with scope '${scope}'`);
  }

  private vipScope(accountColumn: string, scope: AnalyticsScope, scopeId: string | null): SQL {
    if (scope === "PLATFORM") return sql`TRUE`;
    if (scope === "VIP_ACCOUNT") return sql`${sql.raw(accountColumn)} = ${scopeId}`;
    throw new AnalyticsValidationError(`VIP source cannot be queried with scope '${scope}'`);
  }

  private inventoryScope(alias: string, scope: AnalyticsScope, scopeId: string | null): SQL {
    if (scope === "PLATFORM") return sql`TRUE`;
    if (scope === "SUPPLIER") return sql`EXISTS (SELECT 1 FROM seller scope_seller WHERE scope_seller.id = ${sql.raw(`${alias}.seller_id`)} AND scope_seller.supplier_id = ${scopeId})`;
    throw new AnalyticsValidationError(`Inventory source cannot be queried with scope '${scope}'`);
  }

  private supplierIdPredicate(column: string, scope: AnalyticsScope, scopeId: string | null): SQL {
    if (scope === "PLATFORM") return sql`${sql.raw(column)} IS NOT NULL`;
    if (scope === "SUPPLIER") return sql`${sql.raw(column)} = ${scopeId}`;
    throw new AnalyticsValidationError(`Supplier source cannot be queried with scope '${scope}'`);
  }

  private supportScope(alias: string, scope: AnalyticsScope, scopeId: string | null): SQL {
    if (scope === "PLATFORM" || scope === "RETAIL" || scope === "WHOLESALE") return sql`TRUE`;
    if (scope === "SUPPLIER") return sql`${sql.raw(`${alias}.supplier_id`)} = ${scopeId}`;
    if (scope === "VIP_ACCOUNT") return sql`${sql.raw(`${alias}.wholesale_account_id`)} = ${scopeId}`;
    throw new AnalyticsValidationError(`Support source cannot be queried with scope '${scope}'`);
  }

  private notificationScope(alias: string, scope: AnalyticsScope, scopeId: string | null): SQL {
    if (scope === "PLATFORM" || scope === "RETAIL" || scope === "WHOLESALE") return sql`TRUE`;
    if (scope === "SUPPLIER") return sql`EXISTS (SELECT 1 FROM supplier_member scope_member WHERE scope_member.user_id = ${sql.raw(`${alias}.recipient_id`)} AND scope_member.supplier_id = ${scopeId})`;
    if (scope === "VIP_ACCOUNT") return sql`${sql.raw(`${alias}.recipient_id`)} = (SELECT user_id FROM wholesale_account WHERE id = ${scopeId})`;
    throw new AnalyticsValidationError(`Notification source cannot be queried with scope '${scope}'`);
  }

  private async count(query: SQL, unit: "count" | "integer" = "count"): Promise<MetricQueryValue> {
    const rows = await this.rows<{ value: unknown }>(query);
    return { value: parseInteger(rows[0]?.value).toString() };
  }

  private async money(query: SQL): Promise<MetricQueryValue> {
    const rows = await this.rows<{ value: unknown }>(query);
    return { value: parseInteger(rows[0]?.value).toString() };
  }

  private async inventory(query: SQL): Promise<MetricQueryValue> {
    return this.count(query, "integer");
  }

  private async groupedCount(query: SQL): Promise<MetricQueryValue> {
    const rows = await this.rows<{ bucket: unknown; value: unknown }>(query);
    let total = 0n;
    const breakdown = rows.map((row) => {
      const value = parseInteger(row.value);
      total += value;
      return { key: String(row.bucket ?? "UNKNOWN"), value: value.toString() };
    });
    return { value: total.toString(), breakdown };
  }

  private async ratio(query: SQL): Promise<MetricQueryValue> {
    const rows = await this.rows<{ numerator: unknown; denominator: unknown }>(query);
    const numerator = parseInteger(rows[0]?.numerator);
    const denominator = parseInteger(rows[0]?.denominator);
    const value: AnalyticsRatioValue = ratioValue(numerator, denominator);
    return { value };
  }

  private async settlementBalance(
    accountType: string,
    supplierId: string | null,
    range: Pick<ResolvedAnalyticsRange, "startUtc" | "endUtc">,
    scope: AnalyticsScope,
  ): Promise<MetricQueryValue> {
    const supplierPredicate = scope === "SUPPLIER"
      ? sql`AND sa.supplier_id = ${supplierId}`
      : accountType === "PLATFORM_FEE"
        ? sql`AND sa.supplier_id IS NULL`
        : sql`AND sa.supplier_id IS NOT NULL`;
    const rows = await this.rows<{ value: unknown }>(sql`
      SELECT COALESCE(SUM(CASE WHEN sp.direction = 'CREDIT' THEN sp.amount ELSE -sp.amount END), 0)::text AS value
      FROM settlement_posting sp
      INNER JOIN settlement_journal sj ON sj.id = sp.journal_id
      INNER JOIN settlement_account sa ON sa.id = sp.account_id
      WHERE sa.account_type = ${accountType}
        AND sa.status = 'active'
        ${supplierPredicate}
        AND sp.created_at < ${range.endUtc}
    `);
    const amount = parseInteger(rows[0]?.value);
    return { value: (amount < 0n ? 0n : amount).toString() };
  }
}
