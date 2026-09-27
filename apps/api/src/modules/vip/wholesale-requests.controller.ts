import { Body, Controller, Get, Headers, Param, Post, Inject, Query } from "@nestjs/common";
import { VipService, type RequestSummary } from "./vip.service";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { CatalogDomainError } from "../catalog/catalog.logic";

@Controller("wholesale/requests")
export class WholesaleRequestsController {
  constructor(@Inject(VipService) private readonly vipService: VipService) {}

  @Get()
  @Roles("vip", "customer")
  async listBuyerRequests(
    @CurrentUser() claims: Claims,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const result = await this.vipService.listBuyerWholesaleRequests(claims.sub, Number(limit), Number(offset));
    const summaries = await this.vipService.describeRequests(result.requests);
    return { ...result, requests: result.requests.map((request: any) => toBuyerRequestView(request, summaries.get(request.id))) };
  }

  @Get(":id")
  @Roles("vip", "customer")
  async getBuyerRequest(@CurrentUser() claims: Claims, @Param("id") id: string) {
    const request = await this.vipService.getBuyerWholesaleRequest(id, claims.sub);
    const summaries = await this.vipService.describeRequests([request]);
    return { request: toBuyerRequestView(request, summaries.get(request.id)) };
  }

  @Post(":id/revisions")
  @Roles("supplier", "admin")
  async proposeRevision(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idemHeader: string,
    @Headers("Idempotency-Key") idemHeader2: string,
    @Body()
    body: {
      reason: string;
      proposedQuantity?: number | null;
      proposedVariantId?: string | null;
      proposedPackageId?: string | null;
      proposedUnitPrice?: string | number | null;
      pricingUnit?: string | null;
      currency?: string;
      leadTimeDays?: number | null;
      expectedVersion?: number;
    },
  ) {
    const idempotencyKey = idemHeader || idemHeader2;
    if (!idempotencyKey) throw new CatalogDomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");

    let proposedUnitPrice: bigint | null = null;
    if (body.proposedUnitPrice != null) {
      try {
        proposedUnitPrice = BigInt(body.proposedUnitPrice as any);
      } catch {
        throw new CatalogDomainError("INVALID_PRICE", "proposedUnitPrice must be bigint string");
      }
    }

    const result = await this.vipService.proposeRevision({
      requestId: id,
      supplierUserId: claims.sub,
      reason: body.reason,
      proposedQuantity: body.proposedQuantity ?? null,
      proposedVariantId: body.proposedVariantId ?? null,
      proposedPackageId: body.proposedPackageId ?? null,
      proposedUnitPrice,
      pricingUnit: body.pricingUnit ?? null,
      currency: body.currency,
      leadTimeDays: body.leadTimeDays ?? null,
      idempotencyKey,
      expectedVersion: body.expectedVersion,
    });

    return {
      revision: {
        id: result.revision.id,
        requestId: result.revision.requestId,
        revisionNumber: result.revision.revisionNumber,
        proposedQuantity: result.revision.proposedQuantity,
        proposedVariantId: result.revision.proposedVariantId,
        proposedPackageId: result.revision.proposedPackageId,
        proposedUnitPrice: result.revision.proposedUnitPrice?.toString() ?? null,
        pricingUnit: result.revision.pricingUnit,
        currency: result.revision.currency,
        reason: result.revision.reason,
        proposedTermsHash: result.revision.proposedTermsHash,
        createdAt: result.revision.createdAt,
      },
      request: {
        id: result.request.id,
        status: result.request.status,
        version: result.request.version,
      },
      replayed: result.replayed,
    };
  }

  @Post(":id/revisions/:revisionId/accept")
  @Roles("vip", "customer", "admin")
  async acceptRevision(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Param("revisionId") revisionId: string,
    @Headers("idempotency-key") idemHeader: string,
    @Headers("Idempotency-Key") idemHeader2: string,
    @Body() body: { expectedVersion?: number },
  ) {
    const idempotencyKey = idemHeader || idemHeader2;
    if (!idempotencyKey) throw new CatalogDomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");

    const result = await this.vipService.acceptRevision({
      requestId: id,
      revisionId,
      buyerUserId: claims.sub,
      idempotencyKey,
      expectedVersion: body?.expectedVersion,
    });

    return {
      revision: {
        id: result.revision.id,
        buyerResponse: result.revision.buyerResponse,
        buyerRespondedAt: result.revision.buyerRespondedAt,
      },
      request: { id: result.request.id, status: result.request.status, version: result.request.version },
      replayed: result.replayed,
    };
  }

  @Post(":id/revisions/:revisionId/reject")
  @Roles("vip", "customer", "admin")
  async rejectRevision(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Param("revisionId") revisionId: string,
    @Headers("idempotency-key") idemHeader: string,
    @Headers("Idempotency-Key") idemHeader2: string,
    @Body() body: { reason?: string },
  ) {
    const idempotencyKey = idemHeader || idemHeader2;
    if (!idempotencyKey) throw new CatalogDomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");

    const result = await this.vipService.rejectRevision({
      requestId: id,
      revisionId,
      buyerUserId: claims.sub,
      idempotencyKey,
      reason: body?.reason,
    });

    return {
      revision: { id: result.revision.id, buyerResponse: result.revision.buyerResponse },
      request: { id: result.request.id, status: result.request.status, version: result.request.version },
      replayed: result.replayed,
    };
  }

  @Post(":id/reject")
  @Roles("supplier", "admin")
  async rejectRequest(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idemHeader: string,
    @Headers("Idempotency-Key") idemHeader2: string,
    @Body() body: { reason: string; expectedVersion?: number },
  ) {
    const idempotencyKey = idemHeader || idemHeader2;
    if (!idempotencyKey) throw new CatalogDomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");
    const result = await this.vipService.rejectRequest({
      requestId: id,
      actorId: claims.sub,
      actorRole: claims.role === "admin" ? "admin" : "supplier",
      reason: body.reason,
      idempotencyKey,
      expectedVersion: body.expectedVersion,
    });
    return { request: { id: result.request.id, status: result.request.status, version: result.request.version }, replayed: result.replayed };
  }

  @Post(":id/cancel")
  @Roles("vip", "customer", "admin")
  async cancelRequest(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idemHeader: string,
    @Headers("Idempotency-Key") idemHeader2: string,
    @Body() body: { reason?: string; expectedVersion?: number },
  ) {
    const idempotencyKey = idemHeader || idemHeader2;
    if (!idempotencyKey) throw new CatalogDomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");
    const result = await this.vipService.cancelRequest({
      requestId: id,
      actorId: claims.sub,
      actorRole: claims.role === "admin" ? "admin" : "vip",
      reason: body.reason,
      idempotencyKey,
      expectedVersion: body.expectedVersion,
    });
    return { request: { id: result.request.id, status: result.request.status, version: result.request.version }, replayed: result.replayed };
  }

  @Get(":id/revisions")
  @Roles("vip", "customer", "supplier", "admin")
  async listRevisions(@CurrentUser() claims: Claims, @Param("id") id: string) {
    const revisions = claims.role === "vip" || claims.role === "customer"
      ? await this.vipService.listBuyerRequestRevisions(id, claims.sub)
      : claims.role === "supplier"
        ? await this.vipService.listSupplierRequestRevisions(id, claims.sub)
        : await this.vipService.listRevisions(id);
    return {
      revisions: revisions.map((r: any) => ({
        id: r.id,
        requestId: r.requestId,
        revisionNumber: r.revisionNumber,
        proposedQuantity: r.proposedQuantity,
        proposedVariantId: r.proposedVariantId,
        proposedPackageId: r.proposedPackageId,
        proposedUnitPrice: r.proposedUnitPrice?.toString() ?? null,
        pricingUnit: r.pricingUnit,
        currency: r.currency,
        reason: r.reason,
        proposedTermsHash: r.proposedTermsHash,
        buyerResponse: r.buyerResponse,
        buyerRespondedAt: r.buyerRespondedAt,
        createdAt: r.createdAt,
      })),
    };
  }
}

/**
 * `summary` is the server's own description of the request — product, colour,
 * series and the piece total implied by the supplier's recipe. It travels with
 * the request so the inbox can show what was asked for without the browser
 * fetching a product per row or guessing what a package id means.
 */
function toBuyerRequestView(request: any, summary?: RequestSummary) {
  return {
    id: request.id,
    summary: summary ?? null,
    productId: request.productId,
    offerId: request.offerId,
    variantId: request.variantId,
    packageId: request.packageId,
    quantity: request.quantity,
    status: request.status,
    rejectionReason: request.rejectionReason,
    version: request.version,
    acceptedAt: request.acceptedAt,
    acceptanceExpiresAt: request.acceptanceExpiresAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}
