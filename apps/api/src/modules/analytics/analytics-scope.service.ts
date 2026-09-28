import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { AnalyticsScope } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AnalyticsForbiddenError, AnalyticsValidationError } from "./analytics.errors";

const SCOPES = new Set<AnalyticsScope>(["PLATFORM", "RETAIL", "WHOLESALE", "SUPPLIER", "VIP_ACCOUNT"]);

@Injectable()
export class AnalyticsScopeService {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase) {}

  parseScope(value: unknown, fallback: AnalyticsScope): AnalyticsScope {
    const scope = typeof value === "string" && value.trim() ? value.trim().toUpperCase() : fallback;
    if (!SCOPES.has(scope as AnalyticsScope)) throw new AnalyticsValidationError(`Unsupported analytics scope '${String(value)}'`);
    return scope as AnalyticsScope;
  }

  async resolveAdmin(scopeValue: unknown, scopeId?: string | null): Promise<{ scope: AnalyticsScope; scopeId: string | null }> {
    const scope = this.parseScope(scopeValue, "PLATFORM");
    if (scope === "SUPPLIER") {
      if (!scopeId) throw new AnalyticsValidationError("Admin supplier analytics requires scopeId");
      await this.assertSupplierExists(scopeId);
      return { scope, scopeId };
    }
    if (scope === "VIP_ACCOUNT") {
      if (!scopeId) throw new AnalyticsValidationError("Admin VIP analytics requires scopeId");
      await this.assertVipAccountExists(scopeId);
      return { scope, scopeId };
    }
    if (scopeId) throw new AnalyticsValidationError(`${scope} analytics cannot carry scopeId`);
    return { scope, scopeId: null };
  }

  async resolveSupplier(userId: string, requestedScope: unknown, requestedScopeId?: string | null) {
    const scope = this.parseScope(requestedScope, "SUPPLIER");
    if (scope !== "SUPPLIER") throw new AnalyticsForbiddenError("A supplier session may access only SUPPLIER analytics");
    const rows = await this.db.execute<{ supplier_id: string }>(sql`
      SELECT supplier_id FROM supplier_member WHERE user_id = ${userId} ORDER BY created_at ASC LIMIT 2
    `);
    const memberships = ((rows as unknown as { rows?: Array<{ supplier_id: string }> }).rows ?? rows) as Array<{ supplier_id: string }>;
    if (memberships.length === 0) throw new AnalyticsForbiddenError("Supplier membership is required for analytics");
    if (memberships.length > 1 && !requestedScopeId) {
      throw new AnalyticsForbiddenError("An explicit member supplier scope is required");
    }
    const serverSupplierId = requestedScopeId
      ? memberships.find((row) => row.supplier_id === requestedScopeId)?.supplier_id
      : memberships[0].supplier_id;
    if (!serverSupplierId) throw new AnalyticsForbiddenError("The requested supplier is not owned by this session");
    return { scope, scopeId: serverSupplierId } as const;
  }

  async resolveVip(userId: string, requestedScope: unknown, requestedScopeId?: string | null) {
    const scope = this.parseScope(requestedScope, "VIP_ACCOUNT");
    if (scope !== "VIP_ACCOUNT") throw new AnalyticsForbiddenError("A VIP session may access only VIP_ACCOUNT analytics");
    const rows = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM wholesale_account WHERE user_id = ${userId} LIMIT 2
    `);
    const accounts = ((rows as unknown as { rows?: Array<{ id: string }> }).rows ?? rows) as Array<{ id: string }>;
    if (accounts.length === 0) throw new AnalyticsForbiddenError("VIP account ownership is required for analytics");
    if (accounts.length > 1 && !requestedScopeId) throw new AnalyticsForbiddenError("An explicit member account scope is required");
    const accountId = requestedScopeId
      ? accounts.find((row) => row.id === requestedScopeId)?.id
      : accounts[0].id;
    if (!accountId) throw new AnalyticsForbiddenError("The requested VIP account is not owned by this session");
    return { scope, scopeId: accountId } as const;
  }

  private async assertSupplierExists(supplierId: string): Promise<void> {
    const rows = await this.db.execute<{ id: string }>(sql`SELECT id FROM supplier WHERE id = ${supplierId} LIMIT 1`);
    const result = ((rows as unknown as { rows?: Array<{ id: string }> }).rows ?? rows) as Array<{ id: string }>;
    if (!result.length) throw new AnalyticsValidationError(`Supplier '${supplierId}' does not exist`);
  }

  private async assertVipAccountExists(accountId: string): Promise<void> {
    const rows = await this.db.execute<{ id: string }>(sql`SELECT id FROM wholesale_account WHERE id = ${accountId} LIMIT 1`);
    const result = ((rows as unknown as { rows?: Array<{ id: string }> }).rows ?? rows) as Array<{ id: string }>;
    if (!result.length) throw new AnalyticsValidationError(`VIP account '${accountId}' does not exist`);
  }
}
