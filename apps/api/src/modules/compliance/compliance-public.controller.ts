import { Body, Controller, Get, Headers, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../../common/guards/session.guard";
import { toApiJson } from "../../common/api-json";
import { ComplianceService, publicPolicyView } from "./compliance.service";
import { SupplierComplianceService } from "./supplier-compliance.service";
import { ProductComplianceService } from "./product-compliance.service";
import { ComplianceDomainError } from "./compliance.errors";
import type { LegalPolicyScope, RetailCheckoutGateInput } from "./compliance.contract";

const PUBLIC_SCOPES: readonly LegalPolicyScope[] = ["RETAIL", "WHOLESALE_VIP", "SUPPLIER", "PUBLIC"];

function parseScope(raw: unknown): LegalPolicyScope {
  if (typeof raw !== "string" || !PUBLIC_SCOPES.includes(raw as LegalPolicyScope)) {
    throw new ComplianceDomainError("VALIDATION_ERROR", `scope باید یکی از ${PUBLIC_SCOPES.join("، ")} باشد`, 400);
  }
  return raw as LegalPolicyScope;
}

/**
 * Phase 4.7.5 — public legal surface.
 *
 * Everything here is either read-only public disclosure (published policies,
 * sanitized business identity) or the retail checkout binding used by the
 * checkout owner (legacy Next handler today, Nest checkout module later).
 */
@Controller("legal")
export class CompliancePublicController {
  constructor(
    @Inject(ComplianceService) private readonly compliance: ComplianceService,
    @Inject(SupplierComplianceService) private readonly supplierCompliance: SupplierComplianceService,
    @Inject(ProductComplianceService) private readonly productCompliance: ProductComplianceService,
  ) {}

  @Get("policies")
  @Public()
  async listPublished(@Query("scope") scope?: string) {
    const docs = await this.compliance.getPublishedPolicies(parseScope(scope ?? "PUBLIC"));
    return toApiJson({ scope: scope ?? "PUBLIC", policies: docs.map(publicPolicyView) });
  }

  @Get("policies/history")
  @Public()
  async history(@Query("policyType") policyType?: string, @Query("scope") scope?: string, @Query("locale") locale?: string) {
    if (!policyType) throw new ComplianceDomainError("VALIDATION_ERROR", "policyType الزامی است", 400);
    return toApiJson({ versions: await this.compliance.getPolicyVersionHistory(policyType, parseScope(scope ?? "PUBLIC"), locale || "fa-IR") });
  }

  @Get("policies/:id")
  @Public()
  async getPolicy(@Param("id") id: string) {
    return toApiJson(await this.compliance.getPublicPolicy(id));
  }

  /** The exact set of document ids a client must present at a binding point. */
  @Get("requirements")
  @Public()
  async requirements(@Query("scope") scope?: string) {
    const resolved = parseScope(scope ?? "RETAIL");
    return toApiJson({ scope: resolved, required: await this.compliance.getRequiredBundle(resolved) });
  }

  @Get("business-profile")
  @Public()
  async businessProfile() {
    return toApiJson(await this.compliance.getPublicBusinessProfile());
  }

  @Get("return-policy/evaluate")
  @Public()
  async evaluateReturn(@Query("scope") scope?: string, @Query("policyDocumentId") policyDocumentId?: string, @Query("deliveredAt") deliveredAt?: string, @Query("orderedAt") orderedAt?: string) {
    if (scope !== "RETAIL" && scope !== "WHOLESALE") throw new ComplianceDomainError("VALIDATION_ERROR", "scope باید RETAIL یا WHOLESALE باشد", 400);
    return toApiJson(await this.compliance.evaluateReturnEligibility({ scope, policyDocumentId: policyDocumentId || null, deliveredAt: deliveredAt || null, orderedAt: orderedAt || null }));
  }

  /**
   * Retail binding gate — called server-to-server by the checkout owner inside
   * its order transaction. Guest subjects are identified by hashed contact.
   * Protected by the internal service token when one is configured (mandatory
   * in production — see legal-launch-checklist.md).
   */
  @Post("retail/checkout-binding")
  @Public()
  async retailCheckoutBinding(@Body() body: RetailCheckoutGateInput, @Headers("x-kolbe-internal-token") internalToken: string | undefined, @Req() req: Request) {
    const expected = process.env.KOLBE_INTERNAL_API_TOKEN?.trim();
    if (process.env.NODE_ENV === "production" && !expected) {
      throw new ComplianceDomainError("INTERNAL_TOKEN_NOT_CONFIGURED", "KOLBE_INTERNAL_API_TOKEN در production الزامی است", 503);
    }
    if (expected && internalToken !== expected) throw new ComplianceDomainError("COMPLIANCE_ACCESS_DENIED", "توکن سرویس داخلی معتبر نیست");
    const requestMetadata = { ip: req.ip ?? null, userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null, requestId: typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : null };
    return toApiJson(await this.compliance.bindRetailCheckout({ ...body, requestMetadata }));
  }

  /** Server-derived retail disclosure preview (no evidence written). */
  @Post("retail/disclosure-preview")
  @Public()
  async disclosurePreview(@Body() body: { facts: RetailCheckoutGateInput["facts"] }) {
    if (!body?.facts) throw new ComplianceDomainError("VALIDATION_ERROR", "facts الزامی است", 400);
    return toApiJson(await this.compliance.buildRetailDisclosure(body.facts));
  }

  /** Short-lived signed access to a private compliance document (token carries kind + document id). */
  @Get("documents/access/:token")
  @Public()
  async documentAccess(@Param("token") token: string, @Res() res: Response) {
    const kind = decodeKind(token);
    const file = kind === "product_document" ? await this.productCompliance.readByToken(token) : await this.supplierCompliance.readByToken(token);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.filename)}"`);
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).send(file.bytes);
  }
}

function decodeKind(token: string): string {
  try {
    const body = String(token).split(".")[0];
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return String(payload?.kind ?? "");
  } catch {
    return "";
  }
}
