import { describe, expect, it, vi } from "vitest";
import { MAX_MONEY } from "@kolbe/shared";
import { AdminSettlementController } from "../src/modules/settlement/admin-settlement.controller";

describe("Phase 5.13-B financial input boundary", () => {
  const settlement = {
    placeHold: vi.fn(),
    createCommissionPolicy: vi.fn(),
    upsertShippingEconomics: vi.fn(),
  };
  const controller = new AdminSettlementController(settlement as any);
  const claims = { sub: "admin_1", role: "admin" } as any;

  async function expectInvalid(work: () => Promise<unknown>) {
    await expect(work()).rejects.toMatchObject({ status: 400, code: "INVALID_AMOUNT" });
  }

  it.each(["1.5", "-1", "+1", "1e3", "x", `${MAX_MONEY + 1n}`])(
    "rejects malformed or out-of-range hold money before the settlement service: %s",
    async (amount) => {
      await expectInvalid(() => controller.placeHold(claims, "idem_1", {
        supplierId: "sup_1",
        scope: "SUPPLIER",
        reason: "MANUAL_FINANCE_HOLD",
        amount,
      }));
      expect(settlement.placeHold).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed policy and shipping money instead of leaking a BigInt conversion error", async () => {
    await expectInvalid(() => controller.createCommissionPolicy({
      policyVersion: 1,
      name: "bad",
      basis: "MERCHANDISE_ENTITLED_NET",
      rateBps: 0,
      fixedAmount: "not-money",
    }));
    await expectInvalid(() => controller.upsertShippingEconomics({
      childOrderId: "child_1",
      shippingChargeToBuyer: "0.1",
      shippingEconomicRecipient: "KOLBE",
      shippingCostBearer: "KOLBE",
    }));
    expect(settlement.createCommissionPolicy).not.toHaveBeenCalled();
    expect(settlement.upsertShippingEconomics).not.toHaveBeenCalled();
  });
});
