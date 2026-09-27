import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "../shared/http/types";
import { buyerApi, type BuyerAddress, type BuyerRequest } from "../shared/vip/buyer";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), "utf8");

describe("Checkpoint 05 canonical buyer workflows", () => {
  it("sends accepted request version, address snapshot and a stable caller-owned idempotency key", async () => {
    const calls: Array<{ path: string; init: any }> = [];
    const client = { request: async (path: string, init: any) => { calls.push({ path, init }); return { order: { orderCode: "W-1" }, replayed: false }; } } as unknown as ApiClient;
    const request = { id: "wr-1", productId: "p", offerId: "o", quantity: 12, status: "accepted", version: 4, createdAt: "", updatedAt: "" } satisfies BuyerRequest;
    const address = { id: "a-1", label: "انبار", recipientName: "خریدار", recipientPhone: "09120000000", province: "تهران", city: "تهران", addressLine: "خیابان", postalCode: "1234567890", isDefault: true, version: 2, createdAt: "", updatedAt: "" } satisfies BuyerAddress;
    await buyerApi(client).createOrder([request], address, address, "transfer", "idem-fixed");
    expect(calls[0].path).toBe("/wholesale/orders");
    expect(calls[0].init.headers["Idempotency-Key"]).toBe("idem-fixed");
    expect(calls[0].init.body.requests).toEqual([{ requestId: "wr-1", expectedVersion: 4 }]);
    expect(calls[0].init.body.shippingAddress).toMatchObject({ name: "خریدار", city: "تهران", addressLine: "خیابان" });
  });

  it("keeps commercial money typed as strings and uses only canonical endpoints", () => {
    const adapter = read("shared/vip/buyer.ts");
    expect(adapter).toContain("grandTotal: string");
    expect(adapter).not.toMatch(/parseFloat|localStorage|sessionStorage/);
    for (const route of ["/wholesale/orders", "/customer/addresses", "/vip/support/cases", "/wholesale/requests", "/vip/plans"]) expect(adapter).toContain(route);
  });

  it("ships real pages without deferred fixture copy", () => {
    const runtime = ["VipOrdersPage.tsx", "VipInvoicesPage.tsx", "VipAddressesPage.tsx", "VipSupportPage.tsx", "VipRequestsPage.tsx"].map((name) => read(`storefront/vip/${name}`)).join("\n");
    expect(runtime).not.toMatch(/sample|fixture|localStorage|در Checkpoint 05/);
    const boundary = read("storefront/vip/VipPageParts.tsx");
    for (const state of ["LoadingState", "EmptyState", "ErrorState"]) expect(boundary + runtime).toContain(state);
  });

  it("guards RFQ reads and revisions by the session buyer on the API", () => {
    const controller = fs.readFileSync(path.resolve(ROOT, "../apps/api/src/modules/vip/wholesale-requests.controller.ts"), "utf8");
    const service = fs.readFileSync(path.resolve(ROOT, "../apps/api/src/modules/vip/vip.service.ts"), "utf8");
    expect(controller).toContain("listBuyerRequestRevisions(id, claims.sub)");
    expect(controller).toContain("getBuyerWholesaleRequest(id, claims.sub)");
    expect(service).toContain("account.userId !== userId");
  });
});
