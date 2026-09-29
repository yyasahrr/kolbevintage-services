import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, VIP, call, cleanupUser, dbQuery, ensureInitialized, login, unique } from "./helpers";
import { signGatewayPayload } from "@server/platform-360";

const email = `${unique("platform")}@example.test`;
const supplierEmail = `${unique("supplier")}@example.test`;
const password = "Platform1404!";
let adminToken = "";
let customerToken = "";
let supplierToken = "";
let supplierId = "";
let accountId = "";
let paymentId = "";

beforeAll(ensureInitialized);
afterAll(async () => {
  if (supplierId) {
    await dbQuery("DELETE FROM supplier_restriction WHERE supplier_id=$1", [supplierId]);
    await dbQuery("DELETE FROM supplier_status_event WHERE supplier_id=$1", [supplierId]);
    await dbQuery("DELETE FROM supplier_profile_revision WHERE supplier_id=$1", [supplierId]);
    await dbQuery("DELETE FROM party_document WHERE party_id=$1", [supplierId]);
    await dbQuery("DELETE FROM ledger_entry WHERE party_id=$1", [supplierId]);
    await dbQuery("DELETE FROM invoice WHERE owner_id=$1", [supplierId]);
    await dbQuery("DELETE FROM supplier_member WHERE supplier_id=$1", [supplierId]);
    await dbQuery("DELETE FROM supplier WHERE id=$1", [supplierId]);
  }
  if (accountId) {
    await dbQuery("DELETE FROM invoice_file WHERE invoice_id IN (SELECT id FROM invoice WHERE owner_id=$1)", [accountId]);
    await dbQuery("DELETE FROM invoice WHERE owner_id=$1", [accountId]);
    await dbQuery("DELETE FROM ledger_entry WHERE party_id=$1", [accountId]);
    await dbQuery("DELETE FROM membership_history WHERE account_id=$1", [accountId]);
    await dbQuery("DELETE FROM crm_assignment WHERE subject_id=$1", [accountId]);
    await dbQuery("DELETE FROM membership_payment WHERE account_id=$1", [accountId]);
  }
  await cleanupUser(email);
  await cleanupUser(supplierEmail);
});

describe("platform 360, membership, CRM and invoices", () => {
  it("creates a pending membership payment and refuses frontend success flags", async () => {
    await call("POST", "auth/register", { body: { email, password, name: "عضو تست", phone: "09120000991" } });
    customerToken = await login(email, password);
    adminToken = await login(ADMIN.email, ADMIN.password);

    const checkout = await call("POST", "membership/checkout", {
      token: customerToken,
      body: { planCode: "vip", storeName: "فروشگاه پرونده", phone: "09120000991", city: "تهران", memberName: "عضو تست" },
    });
    expect(checkout.status).toBe(201);
    expect(checkout.data.activated).toBe(false);
    expect(checkout.data.status).toBe("pending");
    expect(checkout.data.intent).toBe("purchase");
    paymentId = checkout.data.paymentId;
    accountId = (await dbQuery<any>("SELECT id FROM wholesale_account WHERE user_id=(SELECT id FROM account_user WHERE email=$1)", [email]))[0].id;

    const fake = await call("POST", `membership/payments/${paymentId}/complete`, { token: customerToken, body: { success: true } });
    expect(fake.status).toBe(422);
    expect(fake.data.error).toBe("PAYMENT_NOT_VERIFIED");

    const [gateway] = await dbQuery<any>("SELECT value FROM site_setting WHERE setting_key='payment_gateway'");
    const forged = await call("POST", "payments/gateway/verify", {
      body: {
        paymentId,
        providerRef: "forged",
        signature: signGatewayPayload(paymentId, "forged", Number(checkout.data.amount) + 1, gateway.value.secret),
        success: true,
      },
    });
    expect(forged.status).toBe(422);
    const [user] = await dbQuery<any>("SELECT role FROM account_user WHERE email=$1", [email]);
    expect(user.role).toBe("customer");
    const [account] = await dbQuery<any>("SELECT status FROM wholesale_account WHERE id=$1", [accountId]);
    expect(account.status).toBe("pending");
  });

  it("activates only after a server-signed gateway confirmation and snapshots the invoice", async () => {
    const verified = await call("POST", `admin/membership/payments/${paymentId}/verify-sandbox`, { token: adminToken, body: {} });
    expect(verified.status).toBe(200);
    expect(verified.data.activated).toBe(true);

    const [user] = await dbQuery<any>("SELECT role FROM account_user WHERE email=$1", [email]);
    expect(user.role).toBe("vip");
    const [account] = await dbQuery<any>("SELECT status, plan_code, credit_limit FROM wholesale_account WHERE id=$1", [accountId]);
    expect(account.status).toBe("approved");
    expect(account.plan_code).toBe("vip");
    expect(Number(account.credit_limit)).toBe(200_000_000);

    const [invoice] = await dbQuery<any>("SELECT * FROM invoice WHERE reference_id=$1 AND kind='vip'", [paymentId]);
    expect(invoice.template_version).toBeGreaterThan(0);
    const issuedVersion = invoice.template_version;
    expect(invoice.snapshot.invoice.number).toMatch(/^INV-/);
    expect(invoice.snapshot.customer.name).toBe("عضو تست");
    const before = JSON.stringify(invoice.snapshot);

    const template = await call("POST", "admin/invoice-templates", {
      token: adminToken,
      body: { code: "official", name: "عنوان عوض‌شده", kind: "vip", body: { title: "عنوان عوض‌شده", seller: { name: "فروشنده جدید", address: "اصفهان", taxId: "999" }, terms: "{{invoice.number}}", footer: "{{seller.name}}" } },
    });
    expect(template.status).toBe(201);
    expect(template.data.version).toBeGreaterThan(issuedVersion);

    const [again] = await dbQuery<any>("SELECT snapshot, template_version FROM invoice WHERE id=$1", [invoice.id]);
    expect(JSON.stringify(again.snapshot)).toBe(before);
    expect(again.template_version).toBe(issuedVersion);

    const hidden = await call("GET", `invoices/${invoice.id}/pdf`);
    expect(hidden.status).toBe(401);
    const pdf = await call("GET", `admin/invoices/${invoice.id}/pdf`, { token: adminToken });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toContain("application/pdf");
  });

  it("schedules a downgrade instead of applying it immediately", async () => {
    const checkout = await call("POST", "membership/checkout", {
      token: customerToken,
      body: { planCode: "basic", storeName: "فروشگاه پرونده", phone: "09120000991", city: "تهران", memberName: "عضو تست" },
    });
    expect(checkout.data.intent).toBe("downgrade");
    const verified = await call("POST", `admin/membership/payments/${checkout.data.paymentId}/verify-sandbox`, { token: adminToken, body: {} });
    expect(verified.status).toBe(200);
    const [account] = await dbQuery<any>("SELECT plan_code, scheduled_plan_code FROM wholesale_account WHERE id=$1", [accountId]);
    expect(account.plan_code).toBe("vip");
    expect(account.scheduled_plan_code).toBe("basic");
  });

  it("enforces supplier restrictions and records status reasons", async () => {
    const application = await call("POST", "supplier/apply", {
      body: { companyName: "کارگاه تست", representativeName: "مسئول تست", phone: "09120000992", category: "پوشاک" },
    });
    const approved = await call("POST", `admin/supplier-applications/${application.data.id}`, {
      token: adminToken,
      body: { status: "approved", loginEmail: supplierEmail, loginPassword: password },
    });
    expect(approved.status).toBe(200);
    supplierId = approved.data.supplier_id;
    supplierToken = await login(supplierEmail, password);

    const blocked = await call("POST", `admin/suppliers/${supplierId}/restrictions`, {
      token: adminToken,
      body: { code: "create_product", active: true, reason: "نقض رویه بارگذاری" },
    });
    expect(blocked.status).toBe(200);
    const create = await call("POST", "supplier/products", {
      token: supplierToken,
      body: { name: "محصول محدود", sku: unique("sku"), category: "پوشاک", wholesalePrice: 1000, stock: 1 },
    });
    expect(create.status).toBe(403);
    expect(create.data.error).toBe("SUPPLIER_RESTRICTED");

    await call("POST", `admin/suppliers/${supplierId}/restrictions`, {
      token: adminToken,
      body: { code: "create_product", active: false, reason: "رفع محدودیت" },
    });
    const status = await call("POST", `admin/suppliers/${supplierId}/status`, {
      token: adminToken,
      body: { status: "limited", reason: "بررسی مدارک", note: "موقت" },
    });
    expect(status.status).toBe(200);
    const [event] = await dbQuery<any>("SELECT reason, actor_id, to_status FROM supplier_status_event WHERE supplier_id=$1 ORDER BY created_at DESC LIMIT 1", [supplierId]);
    expect(event.reason).toBe("بررسی مدارک");
    expect(event.to_status).toBe("limited");
    expect(event.actor_id).toBeTruthy();

    const file = await call("GET", `admin/suppliers/${supplierId}/360`, { token: adminToken });
    expect(file.status).toBe(200);
    expect(file.data.finance.salesTotal).toBe(0);
    expect(file.data.supplier.cooperation_status).toBe("limited");
    expect(Array.isArray(file.data.timeline)).toBe(true);

    await call("POST", `admin/suppliers/${supplierId}/status`, {
      token: adminToken,
      body: { status: "active", reason: "بازگشت به همکاری" },
    });
  });

  it("evaluates CRM rules and queues a segment SMS without a frontend webhook", async () => {
    const evaluated = await call("POST", "admin/crm/evaluate", { token: adminToken, body: {} });
    expect(evaluated.status).toBe(200);
    const labels = await dbQuery<any>(
      `SELECT l.code FROM crm_assignment s JOIN crm_label l ON l.id=s.label_id WHERE s.subject_id=$1`,
      [accountId],
    );
    const codes = labels.map((row) => row.code);
    expect(codes).toContain("vip");
    expect(codes).toContain("active_member");

    const campaign = await call("POST", "admin/crm/campaigns", {
      token: adminToken,
      body: { name: "یادآوری انقضا", labelCode: "vip", body: "{{customer.name}} پلن {{plan.name}}" },
    });
    expect(campaign.status).toBe(201);
    expect(campaign.data.recipients).toBeGreaterThan(0);

    const endpoint = await call("POST", "admin/integrations", {
      token: adminToken,
      body: { name: "n8n تست", url: "http://127.0.0.1:9/hook", secret: "sandbox-secret", events: ["membership.activated"] },
    });
    expect(endpoint.status).toBe(201);
    expect(JSON.stringify(endpoint.data)).not.toContain("kolbevintage.ir");
    const listed = await call("GET", "admin/integrations", { token: adminToken });
    expect(JSON.stringify(listed.data.endpoints)).not.toContain("secret");
  });

  it("keeps a zero credit limit uncapped and rejects a positive cap", async () => {
    const [vip] = await dbQuery<any>("SELECT id, credit_limit FROM wholesale_account WHERE user_id=(SELECT id FROM account_user WHERE email=$1)", [VIP.email]);
    const original = Number(vip.credit_limit);
    await dbQuery("UPDATE wholesale_account SET credit_limit=1 WHERE id=$1", [vip.id]);
    const vipToken = await login(VIP.email, VIP.password);
    const [variant] = await dbQuery<any>("SELECT variant_id FROM supplier_inventory WHERE on_hand - reserved >= 12 LIMIT 1");
    const denied = await call("POST", "wholesale/orders", {
      token: vipToken,
      body: { lines: [{ variantId: variant.variant_id, quantity: 12 }] },
    });
    expect(denied.status).toBe(422);
    expect(denied.data.error).toBe("CREDIT_LIMIT_EXCEEDED");
    await dbQuery("UPDATE wholesale_account SET credit_limit=$2 WHERE id=$1", [vip.id, original]);
  });

  it("issues a retail invoice only after the paid transition and a settlement statement from the ledger", async () => {
    const order = await call("POST", "retail/orders", {
      body: {
        customer: { name: "خریدار خرده", phone: "09120000993", email: "retail-platform@example.test" },
        lines: [{ id: "shirt-linen", qty: 1, price: 1 }],
        address: { province: "تهران", city: "تهران", address: "خیابان تست", plaque: "۱", postal: "1234567890" },
        shipping: { id: "post" },
        payMethod: "gateway",
      },
    });
    expect(order.status).toBe(201);
    const [pending] = await dbQuery<any>("SELECT id, payment_status FROM retail_order WHERE order_code=$1", [order.data.orderCode]);
    expect(pending.payment_status).not.toBe("paid");
    const issued = await call("POST", `admin/retail-orders/${pending.id}/mark-paid`, { token: adminToken, body: {} });
    expect(issued.status).toBe(201);
    expect(issued.data.invoice.kind).toBe("retail");
    expect(issued.data.invoice.snapshot.total).toBeGreaterThan(0);
    const replay = await call("POST", `admin/retail-orders/${pending.id}/mark-paid`, { token: adminToken, body: {} });
    expect(replay.data.invoice.id).toBe(issued.data.invoice.id);

    const settlement = await call("POST", "admin/settlements/complete", {
      token: adminToken,
      body: { supplierId, amount: 250000, reason: "تسویه دوره تست" },
    });
    expect(settlement.status).toBe(201);
    expect(settlement.data.invoice.kind).toBe("settlement");
    const [payout] = await dbQuery<any>("SELECT amount FROM ledger_entry WHERE reference_id=$1", [settlement.data.invoice.reference_id]);
    expect(Number(payout.amount)).toBe(-250000);

    await dbQuery("DELETE FROM invoice_file WHERE invoice_id=$1", [issued.data.invoice.id]);
    await dbQuery("DELETE FROM invoice WHERE id=$1", [issued.data.invoice.id]);
    await dbQuery("DELETE FROM retail_order WHERE id=$1", [pending.id]);
    await dbQuery("DELETE FROM integration_endpoint WHERE name='n8n تست'");
  });
});
