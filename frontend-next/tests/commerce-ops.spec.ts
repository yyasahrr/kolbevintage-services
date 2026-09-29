import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentTotp, signAutomationBody } from "@server/operations-center";
import { loadShippingOffers } from "@server/seo-discovery";
import { ADMIN, call, cleanupRetailOrders, cleanupUser, dbQuery, login, unique } from "./helpers";

const orders: string[] = [];
const emails: string[] = [];
let admin = "";

beforeAll(async () => {
  admin = await login(ADMIN.email, ADMIN.password);
});

afterAll(async () => {
  await cleanupRetailOrders(orders);
  for (const email of emails) await cleanupUser(email);
  await dbQuery("DELETE FROM shipping_rule WHERE id LIKE 'srule_%' OR method_id='courier'");
  await dbQuery("DELETE FROM shipping_method WHERE id='courier'");
});

describe("shipping engine", () => {
  it("quotes from weight bands and ignores the client amount", async () => {
    const id = unique("weighted");
    await dbQuery(
      "INSERT INTO retail_product (id, name, price, active, owner_type, retail_enabled, weight_grams) VALUES ($1,'کالای وزنی',200000,true,'kolbe',true,720)",
      [id],
    );
    const rule = await call("POST", "admin/shipping/rules", {
      token: admin,
      body: {
        methodId: "post",
        ruleType: "weight_based",
        priority: 30,
        config: { bands: [{ minGrams: 0, maxGrams: 500, amount: 80000 }, { minGrams: 500, maxGrams: 1000, amount: 110000 }, { minGrams: 1000, maxGrams: 2000, amount: 160000 }] },
      },
    });
    expect(rule.status).toBe(201);
    const order = await call("POST", "retail/orders", {
      body: {
        customer: { name: "وزن", phone: "09120000999" },
        lines: [{ id, qty: 2, price: 1 }],
        shipping: { id: "post", price: 1 },
        payMethod: "gateway",
        totals: { shipping: 1, total: 1 },
      },
    });
    expect(order.status).toBe(201);
    orders.push(order.data.orderCode);
    const stored = (await dbQuery<any>("SELECT shipping_price, shipping_weight_grams, shipping_snapshot FROM retail_order WHERE order_code=$1", [order.data.orderCode]))[0];
    expect(Number(stored.shipping_weight_grams)).toBe(1440);
    expect(Number(stored.shipping_price)).toBe(160000);
    expect(stored.shipping_snapshot.ignoredClientAmount ?? stored.shipping_snapshot.amount).toBeTruthy();
    await dbQuery("DELETE FROM shipping_rule WHERE id=$1", [rule.data.id]);
    await dbQuery("DELETE FROM retail_product WHERE id=$1", [id]);
  });

  it("does not invent a missing weight for a weight-only method", async () => {
    await dbQuery("INSERT INTO shipping_method (id, label, requires_weight) VALUES ('courier','پیک',true) ON CONFLICT (id) DO UPDATE SET requires_weight=true");
    const quote = await call("POST", "shipping/quote", { body: { method: "courier", lines: [{ id: "belt-leather", qty: 1 }], orderValue: 1000 } });
    expect(quote.status).toBe(422);
    expect(quote.data.error).toBe("WEIGHT_REQUIRED");
  });
});

describe("automation outbox", () => {
  it("keeps a failed webhook for retry and signs a successful delivery", async () => {
    await dbQuery("UPDATE automation_outbox SET next_retry_at=now() + interval '1 day' WHERE status IN ('pending','failed')");
    const secret = "n8n-secret-83";
    const received: string[] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const timestamp = String(req.headers["x-kolbe-timestamp"]);
        const signature = String(req.headers["x-kolbe-signature"]);
        received.push(signature === signAutomationBody(secret, timestamp, body) ? "signed" : "bad");
        res.writeHead(200);
        res.end("ok");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const dead = await call("POST", "admin/integrations", { token: admin, body: { name: "قطع", url: "http://127.0.0.1:9/hook", secret, events: ["order.created"], kind: "n8n" } });
    const live = await call("POST", "admin/integrations", { token: admin, body: { name: "زنده", url: `http://127.0.0.1:${port}/hook`, secret, events: ["order.created"], kind: "n8n" } });
    expect(dead.status).toBe(201);
    const order = await call("POST", "retail/orders", { body: { customer: { name: "صف", phone: "09120000888" }, lines: [{ id: "belt-leather", qty: 1 }], shipping: { id: "post" } } });
    orders.push(order.data.orderCode);
    const drained = await call("POST", "admin/automation/drain", { token: admin, body: {} });
    expect(drained.status).toBe(200);
    expect(received).toContain("signed");
    const failed = await dbQuery<any>("SELECT status, attempts, envelope FROM automation_outbox WHERE endpoint_id=$1", [dead.data.id]);
    expect(failed.length).toBe(1);
    expect(failed[0].status).toBe("failed");
    expect(Number(failed[0].attempts)).toBeGreaterThan(0);
    expect(failed[0].envelope.eventType).toBe("order.created");
    const stored = await dbQuery<any>("SELECT envelope FROM automation_outbox WHERE endpoint_id=$1", [live.data.id]);
    expect(stored[0].envelope.schemaVersion).toBe(1);
    expect(stored[0].envelope.eventId).toBeTruthy();
    server.close();
    await dbQuery("DELETE FROM integration_endpoint WHERE id = ANY($1::text[])", [[dead.data.id, live.data.id]]);
  });
});

describe("tracking", () => {
  it("holds a low-confidence extract for review and rejects replay", async () => {
    const secret = "track-secret";
    const endpoint = await call("POST", "admin/integrations", { token: admin, body: { name: "رهگیری", url: "http://127.0.0.1:9/track", secret, events: ["shipment.updated"] } });
    const order = await call("POST", "retail/orders", { body: { customer: { name: "مرسوله", phone: "09120000777" }, lines: [{ id: "belt-leather", qty: 1 }] } });
    orders.push(order.data.orderCode);
    const body = { orderCode: order.data.orderCode, trackingCode: "TR-1", confidence: 0.4, source: "pdf", status: "hub_in" };
    const raw = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = { "x-kolbe-timestamp": timestamp, "x-kolbe-signature": signAutomationBody(secret, timestamp, raw) };
    const first = await call("POST", "automation/tracking", { body, headers });
    expect(first.status).toBe(202);
    expect(first.data.status).toBe("review");
    const replay = await call("POST", "automation/tracking", { body, headers });
    expect(replay.status).toBe(409);
    const shipments = await dbQuery("SELECT id FROM shipment WHERE order_code=$1", [order.data.orderCode]);
    expect(shipments.length).toBe(0);
    const confirmed = { ...body, confidence: 0.95, trackingCode: "TR-2" };
    const confirmedRaw = JSON.stringify(confirmed);
    const later = String(Math.floor(Date.now() / 1000));
    const applied = await call("POST", "automation/tracking", { body: confirmed, headers: { "x-kolbe-timestamp": later, "x-kolbe-signature": signAutomationBody(secret, later, confirmedRaw) } });
    expect(applied.status).toBe(201);
    const timeline = await dbQuery<any>("SELECT source, status FROM shipment_event WHERE shipment_id=$1", [applied.data.shipmentId]);
    expect(timeline[0].source).toBe("pdf");
    await dbQuery("DELETE FROM integration_endpoint WHERE id=$1", [endpoint.data.id]);
  });
});

describe("customer 360 and reviews", () => {
  it("requires verification for email changes and computes a real purchase review", async () => {
    const email = `${unique("buyer")}@kolbe.test`;
    emails.push(email);
    const registered = await call("POST", "auth/register", { body: { email, password: "BuyerPass1404", name: "نگار", phone: "09125550101" } });
    expect(registered.status).toBe(201);
    const token = await login(email, "BuyerPass1404");
    const blocked = await call("POST", "account/profile", { token, body: { email: "changed@kolbe.test" } });
    expect(blocked.status).toBe(422);
    expect(blocked.data.error).toBe("VERIFICATION_REQUIRED");
    const nextEmail = `${unique("changed")}@kolbe.test`;
    emails.push(nextEmail);
    const challenge = await call("POST", "account/profile/email", { token, body: { email: nextEmail } });
    expect(challenge.data.code).toMatch(/^\d{6}$/);
    const confirmed = await call("POST", "account/profile/email/confirm", { token, body: { code: challenge.data.code } });
    expect(confirmed.status).toBe(200);
    const order = await call("POST", "retail/orders", { body: { customer: { name: "نگار", phone: "09125550101", email: nextEmail }, lines: [{ id: "belt-leather", qty: 1 }], payMethod: "cod" } });
    orders.push(order.data.orderCode);
    const review = await call("POST", "reviews", { token, body: { productId: "belt-leather", rating: 5, title: "خوب", comment: "خرید واقعی" } });
    expect(review.status).toBe(201);
    expect(review.data.verifiedPurchase).toBe(true);
    const tamper = await call("POST", `admin/reviews/${review.data.id}/moderate`, { token: admin, body: { status: "approved", rating: 1 } });
    expect(tamper.status).toBe(422);
    const approved = await call("POST", `admin/reviews/${review.data.id}/moderate`, { token: admin, body: { status: "approved" } });
    expect(approved.status).toBe(200);
    const stored = (await dbQuery<any>("SELECT rating FROM product_review WHERE id=$1", [review.data.id]))[0];
    expect(Number(stored.rating)).toBe(5);
    const profile = await call("GET", `admin/people/${registered.data.user.id}`, { token: admin });
    expect(profile.data.reviews.length).toBeGreaterThan(0);
    expect(profile.data.labels.some((label: { code: string }) => label.code === "new_customer" || label.code === "repeat_buyer")).toBe(true);
  });

  it("revokes sessions and accepts an authenticator code", async () => {
    const email = `${unique("secure")}@kolbe.test`;
    emails.push(email);
    await call("POST", "auth/register", { body: { email, password: "SecurePass1404", name: "آرش" } });
    const token = await login(email, "SecurePass1404");
    const revoked = await call("POST", "account/security/sessions/revoke", { token, body: {} });
    expect(revoked.status).toBe(200);
    expect((await call("GET", "account/profile", { token })).status).toBe(401);
    const fresh = await login(email, "SecurePass1404");
    const setup = await call("POST", "account/security/totp", { token: fresh, body: {} });
    const code = currentTotp(setup.data.secret);
    expect((await call("POST", "account/security/totp/confirm", { token: fresh, body: { code } })).status).toBe(200);
    expect((await call("POST", "auth/login", { body: { email, password: "SecurePass1404" } })).data.error).toBe("TOTP_REQUIRED");
    const second = await call("POST", "auth/login/totp", { body: { email, password: "SecurePass1404", code: currentTotp(setup.data.secret) } });
    expect(second.status).toBe(200);
    expect(second.data.token).toBeTruthy();
  });
});

describe("recommendations", () => {
  it("prices from the engine and drops warehouse-unavailable products", async () => {
    const ready = unique("ready");
    const gone = unique("gone");
    try {
    await dbQuery("INSERT INTO retail_product (id, name, price, active, owner_type, retail_enabled) VALUES ($1,'آماده',123000,true,'kolbe',true), ($2,'ناموجود',99000,true,'kolbe',true)", [ready, gone]);
    await dbQuery("INSERT INTO supplier_product (id, supplier_id, name, sku, category, wholesale_price, status, owner_type, retail_enabled, wholesale_enabled) VALUES ($1,'sup_kolbe','ناموجود',$2,'پوشاک',1,'approved','kolbe',true,false)", [gone, gone.toUpperCase()]);
    await dbQuery("INSERT INTO supplier_variant (id, product_id, sku) VALUES ($1,$2,$3)", [`var_${gone}`, gone, `SKU-${gone}`]);
    await dbQuery("INSERT INTO inventory_balance (variant_id, warehouse_id, on_hand, reserved) VALUES ($1,'wh_teh',0,0)", [`var_${gone}`]);
    const slot = await call("POST", "admin/recommendations/slots", { token: admin, body: { code: "checkout.last_minute", strategy: "manual", config: { productIds: [ready, gone] } } });
    expect(slot.status).toBe(200);
    const result = await call("GET", "recommendations?slot=checkout.last_minute");
    expect(result.data.products.map((item: { id: string }) => item.id)).toContain(ready);
    expect(result.data.products.map((item: { id: string }) => item.id)).not.toContain(gone);
    expect(result.data.products.find((item: { id: string }) => item.id === ready).price).toBe(123000);
    expect(result.data.priceSource).toBe("pricing_engine");
    const look = await call("GET", "recommendations?slot=product.complete_the_look&productId=belt-leather");
    expect(look.data.strategy).toBe("rule");
    expect(look.data.products.map((item: { id: string }) => item.id)).not.toContain("belt-leather");
    const offers = await loadShippingOffers();
    expect(offers.find((offer) => offer.name === "پست عادی")?.shippingRate.value).toBe(59000);
    } finally {
      await call("POST", "admin/recommendations/slots", { token: admin, body: { code: "checkout.last_minute", strategy: "popular", config: {} } });
      await dbQuery("DELETE FROM inventory_balance WHERE variant_id=$1", [`var_${gone}`]);
      await dbQuery("DELETE FROM supplier_variant WHERE id=$1", [`var_${gone}`]);
      await dbQuery("DELETE FROM supplier_product WHERE id=$1", [gone]);
      await dbQuery("DELETE FROM retail_product WHERE id = ANY($1::text[])", [[ready, gone]]);
    }
  });
});
