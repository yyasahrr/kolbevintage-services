import { Body, Controller, Get, Headers, Inject, Param, Post, Query } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { InvoicingService } from "./invoicing.service";

function actorOf(claims: Claims) {
  return { userId: claims.sub, role: claims.role };
}

/** Phase 4.7.5 — admin invoicing & tax-readiness surface. */
@Controller("admin/invoicing")
export class InvoicingAdminController {
  constructor(@Inject(InvoicingService) private readonly invoicing: InvoicingService) {}

  @Post("wholesale/:orderId/children/:childOrderId/issue")
  @Roles("admin")
  async issue(@CurrentUser() claims: Claims, @Param("orderId") orderId: string, @Param("childOrderId") childOrderId: string) {
    return toApiJson(await this.invoicing.issueWholesaleChildInvoice(actorOf(claims), { wholesaleOrderId: orderId, childOrderId }));
  }

  @Get("wholesale/:orderId")
  @Roles("admin")
  async listForOrder(@CurrentUser() claims: Claims, @Param("orderId") orderId: string) {
    return toApiJson({ invoices: await this.invoicing.listInvoicesForOrder(actorOf(claims), orderId) });
  }

  @Get("invoices/:id")
  @Roles("admin")
  async get(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return toApiJson({ invoice: await this.invoicing.getInvoiceForActor(actorOf(claims), id) });
  }

  @Post("invoices/:id/void")
  @Roles("admin")
  async voidInvoice(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: { reason: string }) {
    return toApiJson({ invoice: await this.invoicing.voidInvoice(actorOf(claims), id, { reason: body?.reason }) });
  }

  @Get("invoices/:id/fiscal")
  @Roles("admin")
  async fiscalDocs(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return toApiJson({ fiscalDocuments: await this.invoicing.listFiscalDocuments(actorOf(claims), id) });
  }

  @Post("invoices/:id/fiscal/prepare")
  @Roles("admin")
  async prepare(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: { provider?: string }) {
    return toApiJson(await this.invoicing.prepareFiscalDocument(actorOf(claims), id, { provider: body?.provider ?? null }));
  }

  @Post("fiscal/:fiscalDocumentId/submit")
  @Roles("admin")
  async submit(@CurrentUser() claims: Claims, @Param("fiscalDocumentId") fiscalDocumentId: string, @Headers("idempotency-key") idem?: string) {
    return toApiJson(await this.invoicing.submitFiscalDocument(actorOf(claims), fiscalDocumentId, { idempotencyKey: idem as string }));
  }

  @Post("fiscal/:fiscalDocumentId/query-status")
  @Roles("admin")
  async queryStatus(@CurrentUser() claims: Claims, @Param("fiscalDocumentId") fiscalDocumentId: string) {
    return toApiJson(await this.invoicing.queryFiscalStatus(actorOf(claims), fiscalDocumentId));
  }

  @Post("fiscal/:fiscalDocumentId/cancel")
  @Roles("admin")
  async cancel(@CurrentUser() claims: Claims, @Param("fiscalDocumentId") fiscalDocumentId: string, @Body() body: { reason?: string }) {
    return toApiJson(await this.invoicing.cancelFiscalDocument(actorOf(claims), fiscalDocumentId, body ?? {}));
  }

  @Get("tax-config")
  @Roles("admin")
  async taxConfigs() {
    return toApiJson({ configs: await this.invoicing.listTaxConfigs() });
  }

  @Post("tax-config")
  @Roles("admin")
  async createTaxConfig(@CurrentUser() claims: Claims, @Body() body: Record<string, unknown>) {
    return toApiJson({ config: await this.invoicing.createTaxConfig(actorOf(claims), body as any) });
  }

  @Post("tax-config/:id/verify")
  @Roles("admin")
  async verifyTaxConfig(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: { sourceReference: string }) {
    return toApiJson({ config: await this.invoicing.verifyTaxConfig(actorOf(claims), id, { sourceReference: body?.sourceReference }) });
  }

  @Post("tax-config/:id/activate")
  @Roles("admin")
  async activateTaxConfig(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return toApiJson({ config: await this.invoicing.activateTaxConfig(actorOf(claims), id) });
  }
}

/** Buyer / supplier read access to their own commercial invoices. */
@Controller("invoicing")
export class InvoicingReadController {
  constructor(@Inject(InvoicingService) private readonly invoicing: InvoicingService) {}

  @Get("wholesale/:orderId")
  @Roles("vip", "customer", "supplier", "admin")
  async listForOrder(@CurrentUser() claims: Claims, @Param("orderId") orderId: string) {
    return toApiJson({ invoices: await this.invoicing.listInvoicesForOrder(actorOf(claims), orderId) });
  }

  @Get("invoices/:id")
  @Roles("vip", "customer", "supplier", "admin")
  async get(@CurrentUser() claims: Claims, @Param("id") id: string, @Query("format") _format?: string) {
    return toApiJson({ invoice: await this.invoicing.getInvoiceForActor(actorOf(claims), id) });
  }
}
