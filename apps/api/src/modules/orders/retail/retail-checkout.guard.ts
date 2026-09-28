import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { eq } from "drizzle-orm";
import { accountUser } from "@kolbe/database";
import { ForbiddenError, UnauthorizedError } from "@kolbe/shared";
import { CONFIG_TOKEN, type AppConfig } from "../../../config/configuration";
import { KOLBE_DB, type KolbeDatabase } from "../../../database/database.module";
import { RequestContext } from "../../../common/context/request-context";
import { extractToken, SessionVerifier } from "../../../common/session";
import { RetailDomainError, type RetailActor } from "./retail-orders.contract";

export type RequestWithRetailActor = Request & { retailActor?: RetailActor };

/**
 * Phase 5.8 — dual-auth guard for canonical retail checkout.
 *
 * 1. Session callers (direct API or authed compat proxy): verified exactly
 *    like SessionGuard (token version, active account, role match), then
 *    restricted to customer/vip. Admins, suppliers and finance cannot place
 *    retail orders for themselves through this route.
 * 2. Guest callers: ONLY via the server-side compat proxy, proven by the
 *    internal token (strictly required to be configured AND matching —
 *    unlike the compliance precedent, there is no open-by-default mode on
 *    a money-writing route). Guests resolve to customer_id NULL with a
 *    validated contact snapshot; direct anonymous browser calls stay 401.
 */
@Injectable()
export class RetailCheckoutGuard implements CanActivate {
  private readonly verifier: SessionVerifier;

  constructor(
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
  ) {
    this.verifier = new SessionVerifier(config.sessionSecret);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithRetailActor>();
    const token = extractToken(request.headers as Record<string, unknown>);
    const claims = token ? this.verifier.verify(token) : null;
    if (claims) {
      if (claims.role !== "customer" && claims.role !== "vip") {
        throw new ForbiddenError("FORBIDDEN", "retail checkout is for customer accounts");
      }
      const [user] = await this.db
        .select({ id: accountUser.id, role: accountUser.role, status: accountUser.status, tokenVersion: accountUser.tokenVersion })
        .from(accountUser)
        .where(eq(accountUser.id, claims.sub))
        .limit(1);
      if (!user) throw new UnauthorizedError();
      if (user.status !== "active") throw new ForbiddenError("ACCOUNT_SUSPENDED", "account is not active");
      if (claims.tv !== undefined) {
        if (claims.tv !== user.tokenVersion) throw new UnauthorizedError();
      } else if (user.tokenVersion !== 0) {
        throw new UnauthorizedError();
      }
      if (user.role !== claims.role) throw new UnauthorizedError();
      request.retailActor = { kind: "customer", userId: claims.sub };
      RequestContext.setActor(claims.sub, claims.role);
      return true;
    }

    const expected = (this.config.internalApiToken ?? process.env.KOLBE_INTERNAL_API_TOKEN ?? "").trim();
    if (!expected) {
      throw new RetailDomainError("RETAIL_INTERNAL_TOKEN_NOT_CONFIGURED", "guest checkout proxy is not configured");
    }
    const provided = request.headers["x-kolbe-internal-token"];
    if (typeof provided !== "string" || provided !== expected) throw new UnauthorizedError();
    request.retailActor = { kind: "guest", userId: null };
    return true;
  }
}
