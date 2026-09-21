import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { AdminPermissionGuard, RequireAdminPermission } from "../admin/admin-rbac.guard";
import {
  ANALYTICS_COMPARISONS,
  ANALYTICS_DATE_PRESETS,
  isAnalyticsComparison,
  isAnalyticsDatePreset,
  isAnalyticsDimension,
  parseMetricKeys,
  type AnalyticsDefinition,
  type AnalyticsDatePreset,
  type AnalyticsComparison,
  type AnalyticsDimension,
} from "./analytics.contract";
import { AnalyticsQueryService } from "./analytics-query.service";
import { AnalyticsScopeService } from "./analytics-scope.service";
import { AnalyticsValidationError } from "./analytics.errors";

const ADMIN_OVERVIEW_METRICS = [
  "platform.accounts_count",
  "platform.orders_count",
  "retail.orders_count",
  "wholesale.orders_count",
  "payments.confirmed_amount",
  "refunds.amount",
  "support.open_cases_count",
  "notifications.delivered_count",
  "production.jobs_count",
  "production.quality_releases_count",
  "production.recalls_count",
];
const ADMIN_RETAIL_METRICS = ["retail.orders_count", "retail.units_ordered", "retail.ordered_gmv", "retail.paid_orders_count", "retail.order_status_count"];
const ADMIN_WHOLESALE_METRICS = ["wholesale.orders_count", "wholesale.units_ordered", "wholesale.ordered_gmv", "marketplace.child_orders_count", "marketplace.supplier_gmv"];
const ADMIN_SUPPLIER_METRICS = ["supplier.child_orders_count", "supplier.order_units", "supplier.delivered_shipments_count", "settlement.pending_amount", "settlement.available_amount", "settlement.held_amount", "production.jobs_count", "production.actual_units", "production.quality_releases_count", "production.defects_count", "production.recalls_count"];
const ADMIN_VIP_METRICS = ["vip.active_memberships_count", "vip.orders_count", "vip.ordered_gmv"];
const ADMIN_FINANCE_METRICS = ["payments.submitted_amount", "payments.confirmed_amount", "payments.failed_count", "refunds.amount", "refunds.count", "settlement.commission_earned"];
const SUPPLIER_OVERVIEW_METRICS = ["supplier.child_orders_count", "supplier.order_units", "supplier.delivered_shipments_count", "inventory.available_units", "inventory.reserved_units", "settlement.pending_amount", "settlement.available_amount", "settlement.held_amount", "settlement.withdrawal_amount", "settlement.payout_submitted_amount", "settlement.bank_settled_amount", "production.jobs_count", "production.actual_units", "production.quality_releases_count", "production.defects_count", "production.rework_units", "production.recalls_count"];
const VIP_OVERVIEW_METRICS = ["vip.active_memberships_count", "vip.orders_count", "vip.ordered_gmv", "wholesale.units_ordered", "support.open_cases_count", "notifications.delivered_count"];

export type AnalyticsQuery = {
  metrics?: string;
  metricKeys?: string;
  scope?: string;
  scopeId?: string;
  preset?: string;
  startUtc?: string;
  endUtc?: string;
  startDate?: string;
  endDate?: string;
  timezone?: string;
  comparison?: string;
  dimensions?: string;
};

function buildDefinition(
  query: AnalyticsQuery,
  scope: { scope: AnalyticsDefinition["scope"]; scopeId: string | null },
  defaults: string[],
): AnalyticsDefinition {
  const metricKeys = parseMetricKeys(query.metricKeys || query.metrics || defaults);
  const preset = query.preset ? query.preset.toUpperCase() : undefined;
  if (preset && !isAnalyticsDatePreset(preset)) throw new AnalyticsValidationError(`Unsupported date preset '${query.preset}'`);
  const comparison = query.comparison ? query.comparison.toUpperCase() : undefined;
  if (comparison && !isAnalyticsComparison(comparison)) throw new AnalyticsValidationError(`Unsupported comparison '${query.comparison}'`);
  const dimensionValues = query.dimensions
    ? query.dimensions.split(",").map((item) => item.trim()).filter(Boolean)
    : undefined;
  if (dimensionValues?.some((dimension) => !isAnalyticsDimension(dimension))) throw new AnalyticsValidationError("Unknown analytics dimension");
  const dimensions = dimensionValues as AnalyticsDimension[] | undefined;
  return {
    metricKeys,
    scope: scope.scope,
    scopeId: scope.scopeId,
    range: {
      preset: preset as AnalyticsDatePreset | undefined,
      startUtc: query.startUtc,
      endUtc: query.endUtc,
      startDate: query.startDate,
      endDate: query.endDate,
      timezone: query.timezone,
      comparison: comparison as AnalyticsComparison | undefined,
    },
    dimensions,
  };
}

@Controller("admin/analytics")
@UseGuards(AdminPermissionGuard)
@Roles("admin")
export class AdminAnalyticsController {
  constructor(
    @Inject(AnalyticsQueryService) private readonly queries: AnalyticsQueryService,
    @Inject(AnalyticsScopeService) private readonly scopes: AnalyticsScopeService,
  ) {}

  @Get("overview")
  @RequireAdminPermission("analytics:dashboard:view")
  async overview(@CurrentUser() _claims: Claims, @Query() query: AnalyticsQuery) {
    return this.runAdmin(query, ADMIN_OVERVIEW_METRICS);
  }

  @Get("metrics")
  @RequireAdminPermission("analytics:dashboard:view")
  async metrics(@CurrentUser() _claims: Claims, @Query() query: AnalyticsQuery) {
    return this.runAdmin(query, []);
  }

  @Get("retail")
  @RequireAdminPermission("analytics:dashboard:view")
  async retail(@Query() query: AnalyticsQuery) {
    return this.runAdmin({ ...query, scope: "RETAIL" }, ADMIN_RETAIL_METRICS);
  }

  @Get("wholesale")
  @RequireAdminPermission("analytics:dashboard:view")
  async wholesale(@Query() query: AnalyticsQuery) {
    return this.runAdmin({ ...query, scope: "WHOLESALE" }, ADMIN_WHOLESALE_METRICS);
  }

  @Get("suppliers")
  @RequireAdminPermission("analytics:dashboard:view")
  async suppliers(@Query() query: AnalyticsQuery) {
    return this.runAdmin({ ...query, scope: "SUPPLIER" }, ADMIN_SUPPLIER_METRICS);
  }

  @Get("vip")
  @RequireAdminPermission("analytics:dashboard:view")
  async vip(@Query() query: AnalyticsQuery) {
    return this.runAdmin({ ...query, scope: "VIP_ACCOUNT" }, ADMIN_VIP_METRICS);
  }

  @Get("finance")
  @RequireAdminPermission("analytics:dashboard:view")
  async finance(@Query() query: AnalyticsQuery) {
    return this.runAdmin({ ...query, scope: query.scope || "PLATFORM" }, ADMIN_FINANCE_METRICS);
  }

  private async runAdmin(query: AnalyticsQuery, defaults: string[]) {
    const scope = await this.scopes.resolveAdmin(query.scope, query.scopeId);
    const definition = buildDefinition(query, scope, defaults);
    return toApiJson(await this.queries.run(definition));
  }
}

@Controller("supplier/analytics")
@Roles("supplier")
export class SupplierAnalyticsController {
  constructor(
    @Inject(AnalyticsQueryService) private readonly queries: AnalyticsQueryService,
    @Inject(AnalyticsScopeService) private readonly scopes: AnalyticsScopeService,
  ) {}

  @Get("overview")
  async overview(@CurrentUser() claims: Claims, @Query() query: AnalyticsQuery) {
    return this.run(claims, query, SUPPLIER_OVERVIEW_METRICS);
  }

  @Get("orders")
  async orders(@CurrentUser() claims: Claims, @Query() query: AnalyticsQuery) {
    return this.run(claims, query, ["supplier.child_orders_count", "supplier.order_units", "supplier.delivered_shipments_count"]);
  }

  @Get("inventory")
  async inventory(@CurrentUser() claims: Claims, @Query() query: AnalyticsQuery) {
    return this.run(claims, query, ["inventory.on_hand_units", "inventory.available_units", "inventory.reserved_units"]);
  }

  @Get("settlement")
  async settlement(@CurrentUser() claims: Claims, @Query() query: AnalyticsQuery) {
    return this.run(claims, query, ["settlement.pending_amount", "settlement.available_amount", "settlement.held_amount", "settlement.payout_submitted_amount", "settlement.bank_settled_amount"]);
  }

  private async run(claims: Claims, query: AnalyticsQuery, defaults: string[]) {
    const scope = await this.scopes.resolveSupplier(claims.sub, query.scope, query.scopeId);
    const definition = buildDefinition(query, scope, defaults);
    return toApiJson(await this.queries.run(definition));
  }
}

@Controller("vip/analytics")
@Roles("vip")
export class VipAnalyticsController {
  constructor(
    @Inject(AnalyticsQueryService) private readonly queries: AnalyticsQueryService,
    @Inject(AnalyticsScopeService) private readonly scopes: AnalyticsScopeService,
  ) {}

  @Get("overview")
  async overview(@CurrentUser() claims: Claims, @Query() query: AnalyticsQuery) {
    return this.run(claims, query, VIP_OVERVIEW_METRICS);
  }

  @Get("orders")
  async orders(@CurrentUser() claims: Claims, @Query() query: AnalyticsQuery) {
    return this.run(claims, query, ["vip.orders_count", "vip.ordered_gmv", "wholesale.units_ordered"]);
  }

  private async run(claims: Claims, query: AnalyticsQuery, defaults: string[]) {
    const scope = await this.scopes.resolveVip(claims.sub, query.scope, query.scopeId);
    const definition = buildDefinition(query, scope, defaults);
    return toApiJson(await this.queries.run(definition));
  }
}

export { ANALYTICS_DATE_PRESETS, ANALYTICS_COMPARISONS };
