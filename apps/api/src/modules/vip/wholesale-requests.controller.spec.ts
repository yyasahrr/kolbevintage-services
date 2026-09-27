import { describe, expect, it, vi } from "vitest";
import { WholesaleRequestsController } from "./wholesale-requests.controller";

describe("WholesaleRequestsController buyer ownership boundary", () => {
  it("passes the session subject to buyer list and detail reads", async () => {
    const service = {
      listBuyerWholesaleRequests: vi.fn().mockResolvedValue({ requests: [], total: 0 }),
      getBuyerWholesaleRequest: vi.fn().mockResolvedValue({ id: "wr-1", status: "pending", version: 0 }),
    };
    const controller = new WholesaleRequestsController(service as any);
    const claims = { sub: "buyer-a", role: "vip" } as any;
    await controller.listBuyerRequests(claims, "10", "0");
    await controller.getBuyerRequest(claims, "wr-1");
    expect(service.listBuyerWholesaleRequests).toHaveBeenCalledWith("buyer-a", 10, 0);
    expect(service.getBuyerWholesaleRequest).toHaveBeenCalledWith("wr-1", "buyer-a");
  });

  it("scopes revision reads for buyers while preserving the supplier path", async () => {
    const service = { listBuyerRequestRevisions: vi.fn().mockResolvedValue([]), listSupplierRequestRevisions: vi.fn().mockResolvedValue([]), listRevisions: vi.fn().mockResolvedValue([]) };
    const controller = new WholesaleRequestsController(service as any);
    await controller.listRevisions({ sub: "buyer-a", role: "vip" } as any, "wr-1");
    expect(service.listBuyerRequestRevisions).toHaveBeenCalledWith("wr-1", "buyer-a");
    expect(service.listRevisions).not.toHaveBeenCalled();
    await controller.listRevisions({ sub: "supplier-a", role: "supplier" } as any, "wr-1");
    expect(service.listSupplierRequestRevisions).toHaveBeenCalledWith("wr-1", "supplier-a");
    expect(service.listRevisions).not.toHaveBeenCalled();
  });
});
