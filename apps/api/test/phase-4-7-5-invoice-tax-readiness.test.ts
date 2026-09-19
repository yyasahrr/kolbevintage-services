import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootHarness, confirmToAwaitingPayment, createFakeIntent, createOrder, fakeWebhookBody, makeId, one, q, seedTwoSuppliers, signedFakeHeaders, type Harness, type SupplierContext } from "./helpers/phase-4-7-1.harness";

/**
 * Phase 4.7.5 — C: Proforma ≠ Commercial Invoice ≠ Fiscal document; tax readiness
 * without any real tax-authority integration; data-driven tax configuration.
 */
const TEST_DB = "kolbe_phase_4_7_5_invoice_tax_test";

let h: Harness;
let ctx: SupplierContext;
let invoicing: any;
let registry: any;
let fakeTax: any;

const cookie = (userId: string, role: string) => `kolbe_session=${h.issueToken(userId, role)}`;
const api = () => request(h.app.getHttpServer());
const admin = () => ({ userId: ctx.userAdmin, role: "admin" as const });

async function paidOrder(opts: { qtyA?: number; qtyB?: number } = {}) {
  const created = await createOrder(h, ctx, { qtyA: opts.qtyA ?? 2, qtyB: opts.qtyB ?? 0 });
  await confirmToAwaitingPayment(h, created.order.id, ctx.userBuyer);
  const intent = await createFakeIntent(h, created.order.id, ctx.userBuyer);
  await h.paymentProviderOrchestrator.ingestWebhook({ provider: "fake", request: { headers: signedFakeHeaders(), body: fakeWebhookBody(intent.providerReference, { eventId: makeId("evt") }) } });
  const status = await one(h.pool, `SELECT status FROM wholesale_order WHERE id=$1`, [created.order.id]);
  return { ...created, status: status.status };
}

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 50 });
  const { InvoicingService } = await import("../src/modules/invoicing/invoicing.service");
  const { TaxInvoiceProviderRegistry } = await import("../src/modules/invoicing/tax-invoice-provider.registry");
  const { FakeTaxInvoiceProvider } = await import("../src/modules/invoicing/providers/fake-tax-invoice.provider");
  invoicing = h.app.get(InvoicingService);
  registry = h.app.get(TaxInvoiceProviderRegistry);
  fakeTax = h.app.get(FakeTaxInvoiceProvider);
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe("Phase 4.7.5 — commercial invoice lifecycle", () => {
  let orderId: string;
  let childAId: string;
  let invoiceId: string;

  it("a draft (unpaid, unreleased) order is not invoiceable", async () => {
    const { order, childA } = await createOrder(h, ctx, { qtyA: 1 });
    const res = await api().post(`/api/v1/admin/invoicing/wholesale/${order.id}/children/${childA.id}/issue`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(409);
    expect(res.body.error).toBe("INVOICE_NOT_ELIGIBLE");
    await api().post(`/api/v1/admin/invoicing/wholesale/${order.id}/children/${childA.id}/issue`).set("Cookie", cookie(ctx.userBuyer, "vip")).expect(403);
  });

  it("issues a commercial invoice from the immutable order snapshot after payment; idempotent per child; proforma stays a separate artifact", async () => {
    const paid = await paidOrder({ qtyA: 2 });
    expect(["processing", "fulfillment"]).toContain(paid.status);
    orderId = paid.order.id;
    childAId = paid.childA.id;
    const proformasBefore = await one(h.pool, `SELECT count(*)::int AS c FROM wholesale_proforma WHERE wholesale_order_id=$1`, [orderId]);

    const issued = await api().post(`/api/v1/admin/invoicing/wholesale/${orderId}/children/${childAId}/issue`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(201);
    const inv = issued.body.invoice;
    invoiceId = inv.id;
    expect(issued.body.replayed).toBe(false);
    expect(inv.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(inv.documentKind).toBe("COMMERCIAL_INVOICE");
    expect(inv.status).toBe("issued");
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0]).toMatchObject({ quantity: 2, unitPrice: "1000000", lineTotal: "2000000" });
    expect(inv.subtotal).toBe("2000000");
    expect(inv.taxStatus).toBe("not_assessed");
    expect(inv.taxTotal).toBe("0");
    expect(BigInt(inv.grandTotal)).toBe(BigInt(inv.subtotal) + BigInt(inv.shippingTotal));
    expect(inv.sellerSnapshot).toMatchObject({ sellerKind: "SUPPLIER", supplierId: ctx.supA, kybStatus: "missing" });
    expect(inv.sellerSnapshot.taxIdentifier).toBeNull(); // no approved KYB → no identifiers claimed
    expect(inv.buyerSnapshot.buyerUserId).toBe(ctx.userBuyer);
    expect(inv.documentHash).toHaveLength(64);
    expect(inv.sourceSnapshotHash).toHaveLength(64);

    const replay = await api().post(`/api/v1/admin/invoicing/wholesale/${orderId}/children/${childAId}/issue`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(201);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.invoice.id).toBe(invoiceId);
    expect(await one(h.pool, `SELECT count(*)::int AS c FROM commercial_invoice WHERE child_order_id=$1`, [childAId])).toMatchObject({ c: 1 });
    const proformasAfter = await one(h.pool, `SELECT count(*)::int AS c FROM wholesale_proforma WHERE wholesale_order_id=$1`, [orderId]);
    expect(proformasAfter.c).toBe(proformasBefore.c);
    const proforma = await one(h.pool, `SELECT id FROM wholesale_proforma WHERE child_order_id=$1 AND status='issued'`, [childAId]);
    expect(proforma.id).not.toBe(invoiceId);
  });

  it("read access: buyer of the order and owner/finance of the seller only", async () => {
    const buyer = await api().get(`/api/v1/invoicing/invoices/${invoiceId}`).set("Cookie", cookie(ctx.userBuyer, "vip")).expect(200);
    expect(buyer.body.invoice.id).toBe(invoiceId);
    const list = await api().get(`/api/v1/invoicing/wholesale/${orderId}`).set("Cookie", cookie(ctx.userBuyer, "vip")).expect(200);
    expect(list.body.invoices).toHaveLength(1);
    await api().get(`/api/v1/invoicing/invoices/${invoiceId}`).set("Cookie", cookie(ctx.userAOwner, "supplier")).expect(200);
    await api().get(`/api/v1/invoicing/invoices/${invoiceId}`).set("Cookie", cookie(ctx.userAFinance, "supplier")).expect(200);
    await api().get(`/api/v1/invoicing/invoices/${invoiceId}`).set("Cookie", cookie(ctx.userASales, "supplier")).expect(403);
    await api().get(`/api/v1/invoicing/invoices/${invoiceId}`).set("Cookie", cookie(ctx.userBOwner, "supplier")).expect(403);
    const otherList = await api().get(`/api/v1/invoicing/wholesale/${orderId}`).set("Cookie", cookie(ctx.userBOwner, "supplier")).expect(200);
    expect(otherList.body.invoices).toEqual([]);
  });

  it("an issued invoice is immutable at DB level; void is a state transition with a reason, never an edit", async () => {
    await expect(q(h.pool, `UPDATE commercial_invoice SET subtotal = subtotal + 1, grand_total = grand_total + 1 WHERE id=$1`, [invoiceId])).rejects.toThrow(/immutable/);
    await expect(q(h.pool, `DELETE FROM commercial_invoice WHERE id=$1`, [invoiceId])).rejects.toThrow(/cannot be deleted/);
    const line = await one(h.pool, `SELECT id FROM commercial_invoice_line WHERE invoice_id=$1`, [invoiceId]);
    await expect(q(h.pool, `UPDATE commercial_invoice_line SET quantity=1, line_total=unit_price WHERE id=$1`, [line.id])).rejects.toThrow(/append-only/);
    await api().post(`/api/v1/admin/invoicing/invoices/${invoiceId}/void`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({}).expect(400);
    const voided = await api().post(`/api/v1/admin/invoicing/invoices/${invoiceId}/void`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ reason: "issued against wrong child" }).expect(201);
    expect(voided.body.invoice.status).toBe("voided");
    const again = await api().post(`/api/v1/admin/invoicing/invoices/${invoiceId}/void`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ reason: "x" }).expect(409);
    expect(again.body.error).toBe("INVOICE_INVALID_TRANSITION");
    await expect(q(h.pool, `UPDATE commercial_invoice SET void_reason='changed' WHERE id=$1`, [invoiceId])).rejects.toThrow(/voided and immutable/);
    // a new invoice may now be issued for the same child (the void one stays in history)
    const reissued = await api().post(`/api/v1/admin/invoicing/wholesale/${orderId}/children/${childAId}/issue`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(201);
    expect(reissued.body.invoice.id).not.toBe(invoiceId);
    expect(reissued.body.invoice.invoiceNumber).not.toBe(voided.body.invoice.invoiceNumber);
    invoiceId = reissued.body.invoice.id;
  });

  it("fiscal document: prepare → ready → submit (idempotent) → status query; the fake provider never counts as authority acknowledgement", async () => {
    const prepared = await api().post(`/api/v1/admin/invoicing/invoices/${invoiceId}/fiscal/prepare`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({}).expect(201);
    expect(prepared.body.fiscalDocument).toMatchObject({ provider: "fake", status: "ready", isRealAuthorityIntegration: false, authorityAcknowledged: false });
    expect(prepared.body.validation.valid).toBe(true);
    const dup = await api().post(`/api/v1/admin/invoicing/invoices/${invoiceId}/fiscal/prepare`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({}).expect(409);
    expect(dup.body.error).toBe("FISCAL_DOCUMENT_EXISTS");
    const fdId = prepared.body.fiscalDocument.id;

    await api().post(`/api/v1/admin/invoicing/fiscal/${fdId}/submit`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(400); // Idempotency-Key required
    const submitted = await api().post(`/api/v1/admin/invoicing/fiscal/${fdId}/submit`).set("Cookie", cookie(ctx.userAdmin, "admin")).set("Idempotency-Key", "submit-1").expect(201);
    expect(submitted.body.fiscalDocument).toMatchObject({ status: "submitted", authorityAcknowledged: false });
    expect(submitted.body.fiscalDocument.providerReference).toMatch(/^FAKE-/);
    const replay = await api().post(`/api/v1/admin/invoicing/fiscal/${fdId}/submit`).set("Cookie", cookie(ctx.userAdmin, "admin")).set("Idempotency-Key", "submit-1").expect(201);
    expect(replay.body.replayed).toBe(true);
    const second = await api().post(`/api/v1/admin/invoicing/fiscal/${fdId}/submit`).set("Cookie", cookie(ctx.userAdmin, "admin")).set("Idempotency-Key", "submit-2").expect(409);
    expect(second.body.error).toBe("FISCAL_SUBMISSION_INVALID_STATE");

    const queried = await api().post(`/api/v1/admin/invoicing/fiscal/${fdId}/query-status`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(201);
    expect(queried.body.fiscalDocument.status).toBe("accepted");
    expect(queried.body.fiscalDocument.authorityAcknowledged).toBe(false); // fake ≠ tax authority
    const events = await q(h.pool, `SELECT event_type, outcome FROM fiscal_submission_event WHERE fiscal_document_id=$1 ORDER BY created_at`, [fdId]);
    expect(events.map((e: any) => e.event_type)).toEqual(["prepare", "validate", "submit", "submit", "status_query"]);
    await expect(q(h.pool, `DELETE FROM fiscal_submission_event WHERE fiscal_document_id=$1`, [fdId])).rejects.toThrow(/append-only/);
    const cancel = await api().post(`/api/v1/admin/invoicing/fiscal/${fdId}/cancel`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({}).expect(409);
    expect(cancel.body.error).toBe("FISCAL_SUBMISSION_INVALID_STATE");
    const listed = await api().get(`/api/v1/admin/invoicing/invoices/${invoiceId}/fiscal`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(200);
    expect(listed.body.fiscalDocuments[0].events).toHaveLength(5);
  });

  it("a provider rejection is recorded honestly and a rejected document can be re-prepared", async () => {
    const paid = await paidOrder({ qtyA: 1 });
    const issued = await api().post(`/api/v1/admin/invoicing/wholesale/${paid.order.id}/children/${paid.childA.id}/issue`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(201);
    const prepared = await api().post(`/api/v1/admin/invoicing/invoices/${issued.body.invoice.id}/fiscal/prepare`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({}).expect(201);
    fakeTax.forcedOutcome = "rejected";
    try {
      const rejected = await api().post(`/api/v1/admin/invoicing/fiscal/${prepared.body.fiscalDocument.id}/submit`).set("Cookie", cookie(ctx.userAdmin, "admin")).set("Idempotency-Key", "submit-rej").expect(201);
      expect(rejected.body.fiscalDocument.status).toBe("rejected");
      expect(rejected.body.fiscalDocument.lastError).toBeTruthy();
    } finally {
      fakeTax.forcedOutcome = null;
    }
    const again = await api().post(`/api/v1/admin/invoicing/invoices/${issued.body.invoice.id}/fiscal/prepare`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({}).expect(201);
    expect(again.body.fiscalDocument.status).toBe("ready");
  });

  it("the fake provider is refused in production and a disabled mode yields FISCAL_PROVIDER_NOT_CONFIGURED", () => {
    const env = process.env.NODE_ENV;
    const mode = process.env.TAX_INVOICE_PROVIDER_MODE;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.TAX_INVOICE_PROVIDER_MODE;
      expect(() => registry.resolve(null)).toThrow(expect.objectContaining({ code: "FISCAL_PROVIDER_NOT_CONFIGURED", status: 503 }));
      process.env.TAX_INVOICE_PROVIDER_MODE = "fake";
      expect(() => registry.resolve("fake")).toThrow(expect.objectContaining({ code: "FISCAL_PROVIDER_NOT_ALLOWED_IN_PRODUCTION", status: 403 }));
      process.env.NODE_ENV = env;
      process.env.TAX_INVOICE_PROVIDER_MODE = "disabled";
      expect(() => registry.resolve(null)).toThrow(expect.objectContaining({ code: "FISCAL_PROVIDER_NOT_CONFIGURED" }));
      expect(() => registry.resolve("samaneh-modian")).toThrow(expect.objectContaining({ code: "FISCAL_PROVIDER_NOT_CONFIGURED" }));
    } finally {
      process.env.NODE_ENV = env;
      if (mode === undefined) delete process.env.TAX_INVOICE_PROVIDER_MODE;
      else process.env.TAX_INVOICE_PROVIDER_MODE = mode;
    }
  });
});

describe("Phase 4.7.5 — data-driven tax configuration (nothing assessed until an accountant verifies)", () => {
  it("draft → verify (source required) → activate; unverified config can never become active; assessed invoices reference the config version", async () => {
    const created = await api().post("/api/v1/admin/invoicing/tax-config").set("Cookie", cookie(ctx.userAdmin, "admin")).send({ configKey: "VAT_RATE_PERCENT", configValue: { percent: 10 }, sourceReference: "TEST VALUE — not a legal rate" }).expect(201);
    expect(created.body.config).toMatchObject({ version: 1, status: "draft", reviewStatus: "NEEDS_TAX_ACCOUNTANT_REVIEW" });
    const blocked = await api().post(`/api/v1/admin/invoicing/tax-config/${created.body.config.id}/activate`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(409);
    expect(blocked.body.error).toBe("TAX_CONFIG_NOT_VERIFIED");
    await expect(q(h.pool, `UPDATE tax_configuration SET status='active' WHERE id=$1`, [created.body.config.id])).rejects.toThrow(/tax_configuration_active_requires_review/);
    await api().post(`/api/v1/admin/invoicing/tax-config/${created.body.config.id}/verify`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({}).expect(400);
    await api().post(`/api/v1/admin/invoicing/tax-config/${created.body.config.id}/verify`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ sourceReference: "S-07 (test) — accountant sign-off simulated" }).expect(201);
    const active = await api().post(`/api/v1/admin/invoicing/tax-config/${created.body.config.id}/activate`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(201);
    expect(active.body.config.status).toBe("active");

    const paid = await paidOrder({ qtyA: 3 });
    const issued = await api().post(`/api/v1/admin/invoicing/wholesale/${paid.order.id}/children/${paid.childA.id}/issue`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(201);
    const inv = issued.body.invoice;
    expect(inv.taxStatus).toBe("assessed");
    expect(inv.taxBasisReference).toBe("VAT_RATE_PERCENT@v1");
    expect(inv.taxTotal).toBe(((3_000_000n * 10n) / 100n).toString());
    expect(BigInt(inv.grandTotal)).toBe(BigInt(inv.subtotal) + BigInt(inv.shippingTotal) + BigInt(inv.taxTotal));

    // a second version supersedes atomically; only one active per key
    const v2 = await invoicing.createTaxConfig(admin(), { configKey: "VAT_RATE_PERCENT", configValue: { percent: 9 } });
    await invoicing.verifyTaxConfig(admin(), v2.id, { sourceReference: "test v2" });
    await invoicing.activateTaxConfig(admin(), v2.id);
    const actives = await q(h.pool, `SELECT version, status FROM tax_configuration WHERE config_key='VAT_RATE_PERCENT' ORDER BY version`);
    expect(actives).toEqual([{ version: 1, status: "retired" }, { version: 2, status: "active" }]);
    const audit = await q(h.pool, `SELECT action FROM audit_log WHERE entity_type='tax_configuration' ORDER BY created_at`);
    expect(audit.map((a: any) => a.action)).toEqual(expect.arrayContaining(["tax_config.created", "tax_config.verified", "tax_config.activated"]));
  });
});
