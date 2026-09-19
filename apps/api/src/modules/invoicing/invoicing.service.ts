import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { commercialInvoice, commercialInvoiceLine, fiscalDocument, fiscalSubmissionEvent, taxConfiguration } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { OrdersService } from "../orders/orders.service";
import { PaymentsService } from "../payments/payments.service";
import { VipService } from "../vip/vip.service";
import { SuppliersService } from "../suppliers/suppliers.service";
import { ComplianceService } from "../compliance/compliance.service";
import { SupplierComplianceService } from "../compliance/supplier-compliance.service";
import { InvoicingDomainError } from "./invoicing.errors";
import { TaxInvoiceProviderRegistry } from "./tax-invoice-provider.registry";
import type { FiscalInvoiceSnapshot } from "./tax-invoice-provider.interface";

type Executor = any;
type Actor = { userId: string | null; role: "customer" | "vip" | "supplier" | "admin" | "finance" | "system" };

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Date) return v.toISOString();
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) sorted[key] = (v as Record<string, unknown>)[key];
      return sorted;
    }
    return v;
  });
}

function sha256(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex");
}

/** Order states in which the commercial obligation is settled enough to invoice (business policy). */
const INVOICEABLE_ORDER_STATUSES = ["processing", "fulfillment", "shipped", "delivered", "completed"] as const;

export function invoiceView(row: any, lines: any[] = []) {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    scope: row.scope,
    wholesaleOrderId: row.wholesaleOrderId,
    childOrderId: row.childOrderId,
    retailOrderRef: row.retailOrderRef,
    sellerId: row.sellerId,
    sellerSnapshot: row.sellerSnapshot,
    buyerSnapshot: row.buyerSnapshot,
    currency: row.currency,
    subtotal: row.subtotal,
    shippingTotal: row.shippingTotal,
    taxTotal: row.taxTotal,
    taxStatus: row.taxStatus,
    taxBasisReference: row.taxBasisReference,
    grandTotal: row.grandTotal,
    status: row.status,
    issuedAt: row.issuedAt,
    voidedAt: row.voidedAt,
    voidReason: row.voidReason,
    documentHash: row.documentHash,
    sourceSnapshotHash: row.sourceSnapshotHash,
    /** A commercial invoice is NOT a fiscal (tax-authority) document. */
    documentKind: "COMMERCIAL_INVOICE",
    lines: lines.map((l: any) => ({ lineNo: l.lineNo, orderItemRef: l.orderItemRef, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal, currency: l.currency })),
  };
}

export function fiscalView(row: any, provider?: { isRealAuthorityIntegration: boolean } | null) {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    provider: row.provider,
    status: row.status,
    payloadHash: row.payloadHash,
    providerReference: row.providerReference,
    lastError: row.lastError,
    preparedAt: row.preparedAt,
    submittedAt: row.submittedAt,
    resolvedAt: row.resolvedAt,
    /** Only a real authority integration can ever make this true — the fake provider never does. */
    authorityAcknowledged: Boolean(provider?.isRealAuthorityIntegration) && row.status === "accepted",
    isRealAuthorityIntegration: Boolean(provider?.isRealAuthorityIntegration),
  };
}

@Injectable()
export class InvoicingService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(VipService) private readonly vip: VipService,
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
    @Inject(ComplianceService) private readonly compliance: ComplianceService,
    @Inject(SupplierComplianceService) private readonly supplierCompliance: SupplierComplianceService,
    @Inject(TaxInvoiceProviderRegistry) private readonly providers: TaxInvoiceProviderRegistry,
  ) {}

  private assertAdmin(actor: Actor) {
    if (actor.role !== "admin") throw new InvoicingDomainError("ROLE_NOT_ALLOWED", "فقط مدیر مجاز است");
  }

  private async dbNow(executor?: Executor): Promise<Date> {
    const db = executor || this.db;
    const result = await db.execute(sql`SELECT NOW() AS now`);
    return new Date((result as any).rows?.[0]?.now ?? (result as any)[0]?.now);
  }

  /* ───────────────────────── tax configuration (data-driven, accountant-verified) ───────────────────────── */

  async createTaxConfig(actor: Actor, input: { configKey: unknown; configValue: unknown; sourceReference?: unknown; effectiveAt?: unknown }) {
    this.assertAdmin(actor);
    if (typeof input.configKey !== "string" || !/^[A-Z0-9_]{3,64}$/.test(input.configKey)) throw new InvoicingDomainError("VALIDATION_ERROR", "configKey باید UPPER_SNAKE_CASE باشد", 400);
    if (!input.configValue || typeof input.configValue !== "object") throw new InvoicingDomainError("VALIDATION_ERROR", "configValue باید شیء باشد", 400);
    const effectiveAt = input.effectiveAt ? new Date(String(input.effectiveAt)) : await this.dbNow();
    if (Number.isNaN(effectiveAt.getTime())) throw new InvoicingDomainError("VALIDATION_ERROR", "effectiveAt نامعتبر است", 400);
    return this.db.transaction(async (tx: Executor) => {
      const [latest] = await tx.select({ version: taxConfiguration.version }).from(taxConfiguration).where(eq(taxConfiguration.configKey, input.configKey as string)).orderBy(desc(taxConfiguration.version)).limit(1);
      const id = newId("txc");
      const [row] = await tx
        .insert(taxConfiguration)
        .values({ id, configKey: input.configKey as string, configValue: input.configValue as any, sourceReference: typeof input.sourceReference === "string" ? input.sourceReference.slice(0, 300) : null, effectiveAt, version: (latest?.version ?? 0) + 1, reviewStatus: "NEEDS_TAX_ACCOUNTANT_REVIEW", status: "draft", createdBy: actor.userId })
        .returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "tax_config.created", entityType: "tax_configuration", entityId: id, after: { configKey: row.configKey, version: row.version } }, tx);
      return row;
    });
  }

  /** Marks a config as reviewed by a tax accountant (explicit, audited, source required). */
  async verifyTaxConfig(actor: Actor, id: string, input: { sourceReference: unknown }) {
    this.assertAdmin(actor);
    const sourceReference = typeof input.sourceReference === "string" ? input.sourceReference.trim() : "";
    if (sourceReference.length === 0) throw new InvoicingDomainError("VALIDATION_ERROR", "sourceReference الزامی است", 400);
    return this.db.transaction(async (tx: Executor) => {
      const [row] = await tx.select().from(taxConfiguration).where(eq(taxConfiguration.id, id)).for("update").limit(1);
      if (!row) throw new InvoicingDomainError("TAX_CONFIG_NOT_FOUND", "پیکربندی مالیاتی یافت نشد");
      const [updated] = await tx.update(taxConfiguration).set({ reviewStatus: "VERIFIED", sourceReference: sourceReference.slice(0, 300) }).where(eq(taxConfiguration.id, id)).returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "tax_config.verified", entityType: "tax_configuration", entityId: id, after: { sourceReference: updated.sourceReference } }, tx);
      return updated;
    });
  }

  async activateTaxConfig(actor: Actor, id: string) {
    this.assertAdmin(actor);
    return this.db.transaction(async (tx: Executor) => {
      const [row] = await tx.select().from(taxConfiguration).where(eq(taxConfiguration.id, id)).for("update").limit(1);
      if (!row) throw new InvoicingDomainError("TAX_CONFIG_NOT_FOUND", "پیکربندی مالیاتی یافت نشد");
      if (row.status !== "draft") throw new InvoicingDomainError("TAX_CONFIG_INVALID_TRANSITION", `پیکربندی در وضعیت ${row.status} است`);
      if (row.reviewStatus !== "VERIFIED") throw new InvoicingDomainError("TAX_CONFIG_NOT_VERIFIED", "پیکربندی بدون تأیید حسابدار مالیاتی فعال نمی‌شود");
      const [current] = await tx.select().from(taxConfiguration).where(and(eq(taxConfiguration.configKey, row.configKey), eq(taxConfiguration.status, "active"))).for("update").limit(1);
      if (current) await tx.update(taxConfiguration).set({ status: "retired" }).where(eq(taxConfiguration.id, current.id));
      const [updated] = await tx.update(taxConfiguration).set({ status: "active" }).where(eq(taxConfiguration.id, id)).returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "tax_config.activated", entityType: "tax_configuration", entityId: id, before: { retiredId: current?.id ?? null }, after: { configKey: row.configKey, version: row.version } }, tx);
      return updated;
    });
  }

  async listTaxConfigs() {
    return this.db.select().from(taxConfiguration).orderBy(taxConfiguration.configKey, desc(taxConfiguration.version));
  }

  /** Active + VERIFIED VAT rate, if any. Absence ⇒ tax is NOT assessed (never a guessed rate). */
  private async resolveVatRate(executor: Executor): Promise<{ percent: number; reference: string } | null> {
    const [row] = await executor.select().from(taxConfiguration).where(and(eq(taxConfiguration.configKey, "VAT_RATE_PERCENT"), eq(taxConfiguration.status, "active"), eq(taxConfiguration.reviewStatus, "VERIFIED"))).limit(1);
    if (!row) return null;
    const percent = Number((row.configValue as any)?.percent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
    return { percent, reference: `${row.configKey}@v${row.version}` };
  }

  /* ───────────────────────── commercial invoices (wholesale child orders) ───────────────────────── */

  /**
   * Issues the commercial invoice of one wholesale child order from the immutable
   * order snapshot + issued proforma. Idempotent per child (one issued invoice).
   */
  async issueWholesaleChildInvoice(actor: Actor, input: { wholesaleOrderId: string; childOrderId: string }) {
    this.assertAdmin(actor);
    return this.db.transaction(async (tx: Executor) => {
      const [existing] = await tx.select().from(commercialInvoice).where(and(eq(commercialInvoice.childOrderId, input.childOrderId), eq(commercialInvoice.status, "issued"))).limit(1);
      if (existing) {
        const lines = await tx.select().from(commercialInvoiceLine).where(eq(commercialInvoiceLine.invoiceId, existing.id)).orderBy(asc(commercialInvoiceLine.lineNo));
        return { invoice: invoiceView(existing, lines), replayed: true };
      }
      const order = await this.orders.getWholesaleOrderById(input.wholesaleOrderId, tx);
      if (!order) throw new InvoicingDomainError("ORDER_NOT_FOUND", "سفارش عمده یافت نشد");
      const releases = await this.payments.listFinancialReleases(input.wholesaleOrderId, tx);
      const statusOk = (INVOICEABLE_ORDER_STATUSES as readonly string[]).includes(order.status);
      if (!statusOk && releases.length === 0) {
        throw new InvoicingDomainError("INVOICE_NOT_ELIGIBLE", `سفارش در وضعیت ${order.status} و بدون آزادسازی مالی قابل صدور صورتحساب نیست`);
      }
      const snapshot = await this.orders.getOrderFinancialSnapshot(input.wholesaleOrderId, tx);
      const child = snapshot.children.find((c: any) => c.childOrderId === input.childOrderId);
      if (!child) throw new InvoicingDomainError("CHILD_ORDER_NOT_FOUND", "سفارش فرزند متعلق به این سفارش نیست");
      const proforma = await this.payments.getIssuedProformaForChild(input.childOrderId, tx);
      const subtotal = child.items.reduce((s: bigint, i: any) => s + BigInt(i.lineTotal), 0n);
      const shippingTotal = BigInt(proforma?.shippingTotal ?? 0);
      const vat = await this.resolveVatRate(tx);
      const taxTotal = vat ? (subtotal * BigInt(Math.round(vat.percent * 100))) / 10000n : 0n;
      const grandTotal = subtotal + shippingTotal + taxTotal;

      const sellerSnapshot = child.supplierId ? await this.supplierCompliance.getSellerIdentitySnapshot(child.supplierId, tx) : await this.kolbeSellerSnapshot();
      const account = await this.vip.getWholesaleAccountForOrder(order.accountId, tx);
      const buyerSnapshot = { buyerUserId: order.buyerUserId, storeName: account.storeName ?? null, memberName: account.memberName ?? null, city: account.city ?? null, billingAddress: order.billingAddressSnapshot ?? {} };

      const now = await this.dbNow(tx);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('commercial_invoice_number'))`);
      const year = now.getUTCFullYear();
      const [countRow] = await tx.select({ count: sql<number>`count(*)::int` }).from(commercialInvoice).where(sql`${commercialInvoice.invoiceNumber} LIKE ${`INV-${year}-%`}`);
      const invoiceNumber = `INV-${year}-${String(Number(countRow?.count ?? 0) + 1).padStart(6, "0")}`;
      const id = newId("inv");
      const lineRows = child.items.map((item: any, idx: number) => ({
        id: newId("invl"),
        invoiceId: id,
        lineNo: idx + 1,
        orderItemRef: item.wholesaleOrderItemId ?? item.purchaseOrderItemId ?? null,
        description: item.descriptionSnapshot || item.skuSnapshot || "item",
        quantity: Number(item.quantity),
        unitPrice: BigInt(item.unitPrice),
        lineTotal: BigInt(item.lineTotal),
        currency: child.currency || snapshot.currency || "IRR",
      }));
      for (const line of lineRows) {
        if (line.unitPrice * BigInt(line.quantity) !== line.lineTotal) throw new InvoicingDomainError("INVOICE_NOT_ELIGIBLE", `خط ${line.lineNo}: unit_price × quantity با line_total برابر نیست`);
      }
      const header = { invoiceNumber, scope: "wholesale", wholesaleOrderId: input.wholesaleOrderId, childOrderId: input.childOrderId, sellerId: child.sellerId, sellerSnapshot, buyerSnapshot, currency: child.currency || "IRR", subtotal, shippingTotal, taxTotal, taxStatus: vat ? "assessed" : "not_assessed", taxBasisReference: vat?.reference ?? null, grandTotal, issuedAt: now };
      const documentHash = sha256({ header, lines: lineRows.map((l: any) => ({ lineNo: l.lineNo, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal })) });
      const [created] = await tx
        .insert(commercialInvoice)
        .values({ id, ...header, status: "issued", issuedBy: actor.userId, documentHash, sourceSnapshotHash: sha256(snapshot) } as any)
        .returning();
      if (lineRows.length > 0) await tx.insert(commercialInvoiceLine).values(lineRows as any);
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "invoice.issued", entityType: "commercial_invoice", entityId: id, after: { invoiceNumber, childOrderId: input.childOrderId, grandTotal: grandTotal.toString(), taxStatus: header.taxStatus } }, tx);
      return { invoice: invoiceView(created, lineRows), replayed: false };
    });
  }

  private async kolbeSellerSnapshot() {
    const profile = await this.compliance.getPublicBusinessProfile();
    return { sellerKind: "KOLBE" as const, legalName: profile.legalName, tradeName: profile.tradeName, entityType: profile.entityType, registrationIdentifier: profile.registrationIdentifier, taxIdentifier: profile.taxIdentifier, businessAddress: profile.businessAddress, disclosureComplete: profile.disclosureComplete };
  }

  async voidInvoice(actor: Actor, invoiceId: string, input: { reason: unknown }) {
    this.assertAdmin(actor);
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (reason.length === 0) throw new InvoicingDomainError("VALIDATION_ERROR", "دلیل ابطال الزامی است", 400);
    return this.db.transaction(async (tx: Executor) => {
      const [inv] = await tx.select().from(commercialInvoice).where(eq(commercialInvoice.id, invoiceId)).for("update").limit(1);
      if (!inv) throw new InvoicingDomainError("INVOICE_NOT_FOUND", "صورتحساب یافت نشد");
      if (inv.status !== "issued") throw new InvoicingDomainError("INVOICE_INVALID_TRANSITION", `صورتحساب در وضعیت ${inv.status} است`);
      const now = await this.dbNow(tx);
      const [updated] = await tx.update(commercialInvoice).set({ status: "voided", voidedAt: now, voidReason: reason.slice(0, 2000), updatedAt: now }).where(eq(commercialInvoice.id, invoiceId)).returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "invoice.voided", entityType: "commercial_invoice", entityId: invoiceId, before: { status: "issued" }, after: { status: "voided", reason: updated.voidReason } }, tx);
      return invoiceView(updated);
    });
  }

  async getInvoiceForActor(actor: Actor, invoiceId: string) {
    const [inv] = await this.db.select().from(commercialInvoice).where(eq(commercialInvoice.id, invoiceId)).limit(1);
    if (!inv) throw new InvoicingDomainError("INVOICE_NOT_FOUND", "صورتحساب یافت نشد");
    await this.authorizeRead(actor, inv);
    const lines = await this.db.select().from(commercialInvoiceLine).where(eq(commercialInvoiceLine.invoiceId, inv.id)).orderBy(asc(commercialInvoiceLine.lineNo));
    return invoiceView(inv, lines);
  }

  async listInvoicesForOrder(actor: Actor, wholesaleOrderId: string) {
    const rows = await this.db.select().from(commercialInvoice).where(eq(commercialInvoice.wholesaleOrderId, wholesaleOrderId)).orderBy(asc(commercialInvoice.createdAt));
    const visible = [];
    for (const row of rows) {
      try {
        await this.authorizeRead(actor, row);
        visible.push(invoiceView(row));
      } catch {
        /* not visible to this actor */
      }
    }
    return visible;
  }

  /** Admin: any. Buyer: own order. Supplier: child orders of a supplier they belong to (owner/finance). */
  private async authorizeRead(actor: Actor, inv: any) {
    if (actor.role === "admin") return;
    if (!actor.userId) throw new InvoicingDomainError("INVOICE_ACCESS_DENIED", "دسترسی مجاز نیست");
    if (inv.wholesaleOrderId) {
      const order = await this.orders.getWholesaleOrderById(inv.wholesaleOrderId);
      if (order && order.buyerUserId === actor.userId && (actor.role === "vip" || actor.role === "customer")) return;
    }
    if (actor.role === "supplier") {
      const memberships = await this.suppliers.getUserMemberships(actor.userId);
      const ok = memberships.some((m: any) => m.sellerId === inv.sellerId && ["owner", "finance"].includes(m.role));
      if (ok) return;
    }
    throw new InvoicingDomainError("INVOICE_ACCESS_DENIED", "دسترسی به این صورتحساب مجاز نیست");
  }

  /* ───────────────────────── fiscal documents (tax readiness — provider port) ───────────────────────── */

  private async fiscalSnapshot(inv: any, executor: Executor): Promise<FiscalInvoiceSnapshot> {
    const lines = await executor.select().from(commercialInvoiceLine).where(eq(commercialInvoiceLine.invoiceId, inv.id)).orderBy(asc(commercialInvoiceLine.lineNo));
    return {
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      issuedAt: new Date(inv.issuedAt).toISOString(),
      currency: inv.currency,
      seller: inv.sellerSnapshot ?? {},
      buyer: inv.buyerSnapshot ?? {},
      lines: lines.map((l: any) => ({ lineNo: l.lineNo, description: l.description, quantity: l.quantity, unitPrice: String(l.unitPrice), lineTotal: String(l.lineTotal) })),
      totals: { subtotal: String(inv.subtotal), shippingTotal: String(inv.shippingTotal), taxTotal: String(inv.taxTotal), grandTotal: String(inv.grandTotal), taxStatus: inv.taxStatus, taxBasisReference: inv.taxBasisReference },
      documentHash: inv.documentHash,
    };
  }

  private async recordEvent(tx: Executor, input: { fiscalDocumentId: string; eventType: string; provider: string; idempotencyKey: string; outcome: string; providerReference?: string | null; safeMetadata?: Record<string, unknown> }) {
    await tx.insert(fiscalSubmissionEvent).values({ id: newId("fse"), fiscalDocumentId: input.fiscalDocumentId, eventType: input.eventType, provider: input.provider, idempotencyKey: input.idempotencyKey, outcome: input.outcome, providerReference: input.providerReference ?? null, safeMetadata: (input.safeMetadata ?? {}) as any });
  }

  /** prepare + validate → `ready` (or `draft` with problems). Requires an issued invoice and no open fiscal document. */
  async prepareFiscalDocument(actor: Actor, invoiceId: string, input: { provider?: string | null } = {}) {
    this.assertAdmin(actor);
    const provider = this.providers.resolve(input.provider ?? null);
    return this.db.transaction(async (tx: Executor) => {
      const [inv] = await tx.select().from(commercialInvoice).where(eq(commercialInvoice.id, invoiceId)).for("update").limit(1);
      if (!inv) throw new InvoicingDomainError("INVOICE_NOT_FOUND", "صورتحساب یافت نشد");
      if (inv.status !== "issued") throw new InvoicingDomainError("FISCAL_SUBMISSION_INVALID_STATE", "فقط صورتحساب صادرشده قابل آماده‌سازی است");
      const [open] = await tx.select().from(fiscalDocument).where(and(eq(fiscalDocument.invoiceId, invoiceId), sql`${fiscalDocument.status} NOT IN ('rejected', 'cancelled')`)).limit(1);
      if (open) throw new InvoicingDomainError("FISCAL_DOCUMENT_EXISTS", "سند مالیاتی باز برای این صورتحساب وجود دارد");
      const snapshot = await this.fiscalSnapshot(inv, tx);
      const prepared = await provider.prepare(snapshot);
      const validation = await provider.validate(prepared.payload);
      const now = await this.dbNow(tx);
      const id = newId("fd");
      const [doc] = await tx
        .insert(fiscalDocument)
        .values({ id, invoiceId, provider: provider.name, status: validation.valid ? "ready" : "draft", payloadHash: prepared.payloadHash, lastError: validation.valid ? null : validation.problems.join(" | "), preparedAt: now })
        .returning();
      await this.recordEvent(tx, { fiscalDocumentId: id, eventType: "prepare", provider: provider.name, idempotencyKey: `prepare:${id}`, outcome: "ok", safeMetadata: { payloadHash: prepared.payloadHash } });
      await this.recordEvent(tx, { fiscalDocumentId: id, eventType: "validate", provider: provider.name, idempotencyKey: `validate:${id}:${prepared.payloadHash}`, outcome: validation.valid ? "ok" : "rejected", safeMetadata: { problems: validation.problems } });
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "fiscal_document.prepared", entityType: "fiscal_document", entityId: id, after: { invoiceId, provider: provider.name, status: doc.status, problems: validation.problems } }, tx);
      return { fiscalDocument: fiscalView(doc, provider), validation };
    });
  }

  /** Submits a `ready` document through the provider port. Idempotent by key; the provider result is authoritative for status. */
  async submitFiscalDocument(actor: Actor, fiscalDocumentId: string, input: { idempotencyKey: string }) {
    this.assertAdmin(actor);
    if (!input.idempotencyKey || typeof input.idempotencyKey !== "string") throw new InvoicingDomainError("VALIDATION_ERROR", "Idempotency-Key الزامی است", 400);
    const idemKey = `submit:${fiscalDocumentId}:${input.idempotencyKey}`;
    // Phase 1 (TxA): claim + mark pending.
    const claim = await this.db.transaction(async (tx: Executor) => {
      const [doc] = await tx.select().from(fiscalDocument).where(eq(fiscalDocument.id, fiscalDocumentId)).for("update").limit(1);
      if (!doc) throw new InvoicingDomainError("FISCAL_DOCUMENT_NOT_FOUND", "سند مالیاتی یافت نشد");
      const [priorEvent] = await tx.select().from(fiscalSubmissionEvent).where(eq(fiscalSubmissionEvent.idempotencyKey, idemKey)).limit(1);
      if (priorEvent) return { doc, replayed: true, provider: this.providers.resolve(doc.provider) };
      if (doc.status !== "ready") throw new InvoicingDomainError("FISCAL_SUBMISSION_INVALID_STATE", `سند در وضعیت ${doc.status} قابل ارسال نیست`);
      const provider = this.providers.resolve(doc.provider);
      const now = await this.dbNow(tx);
      await tx.update(fiscalDocument).set({ status: "submission_pending", updatedAt: now }).where(eq(fiscalDocument.id, doc.id));
      await this.recordEvent(tx, { fiscalDocumentId: doc.id, eventType: "submit", provider: provider.name, idempotencyKey: idemKey, outcome: "ok", safeMetadata: { phase: "claimed" } });
      return { doc, replayed: false, provider };
    });
    if (claim.replayed) {
      const [current] = await this.db.select().from(fiscalDocument).where(eq(fiscalDocument.id, fiscalDocumentId)).limit(1);
      return { fiscalDocument: fiscalView(current, claim.provider), replayed: true };
    }
    // Provider I/O outside any DB lock.
    const [inv] = await this.db.select().from(commercialInvoice).where(eq(commercialInvoice.id, claim.doc.invoiceId)).limit(1);
    const snapshot = await this.fiscalSnapshot(inv, this.db);
    const prepared = await claim.provider.prepare(snapshot);
    let result: { status: "submitted" | "accepted" | "rejected"; providerReference: string | null; message?: string | null };
    try {
      result = await claim.provider.submit({ payload: prepared.payload, payloadHash: prepared.payloadHash, idempotencyKey: idemKey });
    } catch (error: any) {
      await this.db.transaction(async (tx: Executor) => {
        const now = await this.dbNow(tx);
        await tx.update(fiscalDocument).set({ status: "ready", lastError: String(error?.message ?? "provider error").slice(0, 1000), updatedAt: now }).where(eq(fiscalDocument.id, fiscalDocumentId));
        await this.recordEvent(tx, { fiscalDocumentId, eventType: "submit", provider: claim.provider.name, idempotencyKey: `${idemKey}:failed:${now.getTime()}`, outcome: "failed", safeMetadata: { message: String(error?.message ?? "").slice(0, 300) } });
      });
      throw new InvoicingDomainError("FISCAL_PROVIDER_ERROR", "ارسال به ارائه‌دهنده ناموفق بود؛ سند برای تلاش مجدد در وضعیت ready ماند");
    }
    // Phase 2 (TxB): persist provider result.
    return this.db.transaction(async (tx: Executor) => {
      const now = await this.dbNow(tx);
      const [updated] = await tx
        .update(fiscalDocument)
        .set({ status: result.status, providerReference: result.providerReference, submittedAt: now, resolvedAt: result.status === "submitted" ? null : now, lastError: result.status === "rejected" ? result.message ?? "rejected" : null, updatedAt: now })
        .where(eq(fiscalDocument.id, fiscalDocumentId))
        .returning();
      await this.recordEvent(tx, { fiscalDocumentId, eventType: "submit", provider: claim.provider.name, idempotencyKey: `${idemKey}:result`, outcome: result.status === "rejected" ? "rejected" : "ok", providerReference: result.providerReference, safeMetadata: { status: result.status } });
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "fiscal_document.submitted", entityType: "fiscal_document", entityId: fiscalDocumentId, after: { status: result.status, provider: claim.provider.name, providerReference: result.providerReference } }, tx);
      return { fiscalDocument: fiscalView(updated, claim.provider), replayed: false };
    });
  }

  async queryFiscalStatus(actor: Actor, fiscalDocumentId: string) {
    this.assertAdmin(actor);
    const [doc] = await this.db.select().from(fiscalDocument).where(eq(fiscalDocument.id, fiscalDocumentId)).limit(1);
    if (!doc) throw new InvoicingDomainError("FISCAL_DOCUMENT_NOT_FOUND", "سند مالیاتی یافت نشد");
    if (doc.status !== "submitted" || !doc.providerReference) throw new InvoicingDomainError("FISCAL_SUBMISSION_INVALID_STATE", `سند در وضعیت ${doc.status} قابل استعلام نیست`);
    const provider = this.providers.resolve(doc.provider);
    const result = await provider.queryStatus({ providerReference: doc.providerReference });
    return this.db.transaction(async (tx: Executor) => {
      const now = await this.dbNow(tx);
      const [updated] = await tx
        .update(fiscalDocument)
        .set({ status: result.status, resolvedAt: result.status === "submitted" ? null : now, lastError: result.status === "rejected" ? result.message ?? "rejected" : null, updatedAt: now })
        .where(eq(fiscalDocument.id, fiscalDocumentId))
        .returning();
      await this.recordEvent(tx, { fiscalDocumentId, eventType: "status_query", provider: provider.name, idempotencyKey: `status:${fiscalDocumentId}:${now.getTime()}`, outcome: result.status === "rejected" ? "rejected" : "ok", providerReference: result.providerReference, safeMetadata: { status: result.status } });
      return { fiscalDocument: fiscalView(updated, provider) };
    });
  }

  async cancelFiscalDocument(actor: Actor, fiscalDocumentId: string, input: { reason?: unknown } = {}) {
    this.assertAdmin(actor);
    return this.db.transaction(async (tx: Executor) => {
      const [doc] = await tx.select().from(fiscalDocument).where(eq(fiscalDocument.id, fiscalDocumentId)).for("update").limit(1);
      if (!doc) throw new InvoicingDomainError("FISCAL_DOCUMENT_NOT_FOUND", "سند مالیاتی یافت نشد");
      if (!["draft", "ready"].includes(doc.status)) throw new InvoicingDomainError("FISCAL_SUBMISSION_INVALID_STATE", `سند در وضعیت ${doc.status} قابل لغو نیست`);
      const now = await this.dbNow(tx);
      const [updated] = await tx.update(fiscalDocument).set({ status: "cancelled", resolvedAt: now, updatedAt: now }).where(eq(fiscalDocument.id, fiscalDocumentId)).returning();
      await this.recordEvent(tx, { fiscalDocumentId, eventType: "cancel", provider: doc.provider, idempotencyKey: `cancel:${fiscalDocumentId}`, outcome: "ok", safeMetadata: { reason: typeof input.reason === "string" ? input.reason.slice(0, 300) : null } });
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "fiscal_document.cancelled", entityType: "fiscal_document", entityId: fiscalDocumentId, before: { status: doc.status }, after: { status: "cancelled" } }, tx);
      return { fiscalDocument: fiscalView(updated, null) };
    });
  }

  async listFiscalDocuments(actor: Actor, invoiceId: string) {
    this.assertAdmin(actor);
    const docs = await this.db.select().from(fiscalDocument).where(eq(fiscalDocument.invoiceId, invoiceId)).orderBy(asc(fiscalDocument.createdAt));
    const out = [];
    for (const doc of docs) {
      const events = await this.db.select().from(fiscalSubmissionEvent).where(eq(fiscalSubmissionEvent.fiscalDocumentId, doc.id)).orderBy(asc(fiscalSubmissionEvent.createdAt));
      let provider: { isRealAuthorityIntegration: boolean } | null = null;
      try {
        provider = this.providers.resolve(doc.provider);
      } catch {
        provider = null;
      }
      out.push({ ...fiscalView(doc, provider), events: events.map((e: any) => ({ id: e.id, eventType: e.eventType, outcome: e.outcome, providerReference: e.providerReference, createdAt: e.createdAt })) });
    }
    return out;
  }
}
