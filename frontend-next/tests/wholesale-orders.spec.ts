import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VIP, call, dbQuery, ensureInitialized, login, restoreInventory, seedInventoryState, unique } from "./helpers";

/**
 * Server-authoritative wholesale pricing + stock reservation + idempotency.
 * Uses the seeded supplier catalogue (3 approved products, one variant each).
 */
let vipToken = "";
let inventorySnapshot: Awaited<ReturnType<typeof seedInventoryState>> = new Map();
const createdCodes: string[] = [];

async function cleanupWholesaleOrders() {
  for (const code of createdCodes.splice(0)) {
    const orders = await dbQuery<{ id: string }>("SELECT id FROM wholesale_order WHERE order_code=$1", [code]);
    for (const o of orders) {
      await dbQuery("DELETE FROM wholesale_order_item WHERE order_id=$1", [o.id]);
      await dbQuery("DELETE FROM purchase_order_item WHERE purchase_order_id IN (SELECT id FROM purchase_order WHERE wholesale_order_id=$1)", [o.id]);
      await dbQuery("DELETE FROM purchase_order WHERE wholesale_order_id=$1", [o.id]);
      await dbQuery("DELETE FROM wholesale_order WHERE id=$1", [o.id]);
    }
  }
}

beforeAll(async () => {
  await ensureInitialized();
  inventorySnapshot = await seedInventoryState();
  vipToken = await login(VIP.email, VIP.password);
});
afterAll(async () => {
  await cleanupWholesaleOrders();
  await restoreInventory(inventorySnapshot);
});

describe("wholesale orders (server-authoritative)", () => {
  it("rejects orders below the minimum units", async () => {
    const [variant] = await dbQuery<any>("SELECT variant_id FROM supplier_inventory LIMIT 1");
    const r = await call("POST", "wholesale/orders", {
      token: vipToken,
      body: { lines: [{ variantId: variant.variant_id, quantity: 2, unitPrice: 1 }] },
    });
    expect(r.status).toBe(422);
    expect(r.data.error).toBe("BELOW_MIN_UNITS");
  });

  it("prices from the DB, never from the client, and reserves stock in one transaction", async () => {
    const products = (await call("GET", "wholesale/products", { token: vipToken })).data.products;
    const variantId = products[0].product_variants[0].id;
    const dbPrice = Number(products[0].wholesale_price);

    const before = await dbQuery<any>("SELECT on_hand, reserved FROM supplier_inventory WHERE variant_id=$1", [variantId]);
    const qty = 12;
    const r = await call("POST", "wholesale/orders", {
      token: vipToken,
      body: { lines: [{ variantId, quantity: qty, unitPrice: 1 }] }, // unitPrice:1 must be ignored
    });
    expect(r.status).toBe(201);
    createdCodes.push(r.data.orderCode);
    const order = (await dbQuery<any>("SELECT * FROM wholesale_order WHERE order_code=$1", [r.data.orderCode]))[0];
    expect(Number(order.total_amount)).toBe(qty * dbPrice); // authoritative

    const after = await dbQuery<any>("SELECT on_hand, reserved FROM supplier_inventory WHERE variant_id=$1", [variantId]);
    expect(after[0].reserved - before[0].reserved).toBe(qty); // stock locked
  });

  it("refuses to oversell available stock (409 INSUFFICIENT_STOCK)", async () => {
    const [variant] = await dbQuery<any>(
      "SELECT variant_id, on_hand FROM supplier_inventory WHERE on_hand > 0 ORDER BY on_hand DESC LIMIT 1",
    );
    const r = await call("POST", "wholesale/orders", {
      token: vipToken,
      body: { lines: [{ variantId: variant.variant_id, quantity: variant.on_hand + 50 }] },
    });
    expect(r.status).toBe(409);
    expect(r.data.error).toBe("INSUFFICIENT_STOCK");
  });

  it("replays a wholesale order on the same Idempotency-Key without double-reserving", async () => {
    const products = (await call("GET", "wholesale/products", { token: vipToken })).data.products;
    const variantId = products[0].product_variants[0].id;
    const key = unique("wholesale-idem");

    const before = (await dbQuery<any>("SELECT reserved FROM supplier_inventory WHERE variant_id=$1", [variantId]))[0].reserved;
    const first = await call("POST", "wholesale/orders", {
      token: vipToken,
      idem: key,
      body: { lines: [{ variantId, quantity: 12 }] },
    });
    expect(first.status).toBe(201);
    createdCodes.push(first.data.orderCode);
    const mid = (await dbQuery<any>("SELECT reserved FROM supplier_inventory WHERE variant_id=$1", [variantId]))[0].reserved;
    expect(mid - before).toBe(12);

    const replay = await call("POST", "wholesale/orders", {
      token: vipToken,
      idem: key,
      body: { lines: [{ variantId, quantity: 12 }] },
    });
    expect(replay.status).toBe(200);
    expect(replay.data.replay).toBe(true);
    expect(replay.data.orderCode).toBe(first.data.orderCode);
    const after = (await dbQuery<any>("SELECT reserved FROM supplier_inventory WHERE variant_id=$1", [variantId]))[0].reserved;
    expect(after).toBe(mid); // reservation NOT doubled
  });
});
