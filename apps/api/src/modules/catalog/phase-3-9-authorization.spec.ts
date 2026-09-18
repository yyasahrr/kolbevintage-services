import { describe, expect, it } from "vitest";
import { ROLES_KEY } from "../../common/guards/session.guard";
import { CatalogController } from "./catalog.controller";
import { OffersController } from "../offers/offers.controller";
import { VipController } from "../vip/vip.controller";
import { assertOfferAllowedForProduct, validateWholesalePackage } from "./catalog.logic";
import { isVipSubscriptionActive } from "../vip/vip.logic";

function roles(controller: object, method: string): string[] {
  return Reflect.getMetadata(ROLES_KEY, (controller as any)[method]) ?? [];
}

describe("Phase 3.9 mutation authorization", () => {
  it("customer/vip cannot create canonical products or categories", () => {
    expect(roles(CatalogController.prototype, "createProduct")).toEqual(["admin"]);
    expect(roles(CatalogController.prototype, "createCategory")).toEqual(["admin"]);
    expect(roles(CatalogController.prototype, "approveBrand")).toEqual(["admin"]);
    expect(roles(CatalogController.prototype, "transitionProduct")).toEqual(["admin"]);
  });

  it("only suppliers submit and only admins review supplier products", () => {
    expect(roles(CatalogController.prototype, "submitSupplierProduct")).toEqual(["supplier"]);
    expect(roles(CatalogController.prototype, "approveSubmissionAsNew")).toEqual(["admin"]);
    expect(roles(CatalogController.prototype, "approveSubmissionAsExisting")).toEqual(["admin"]);
    expect(roles(CatalogController.prototype, "rejectSubmission")).toEqual(["admin"]);
  });

  it("customer/vip cannot masquerade as KOLBE offer actors", () => {
    expect(roles(OffersController.prototype, "createOffer")).toEqual(["admin", "supplier"]);
    expect(roles(OffersController.prototype, "createPackage")).toEqual(["admin", "supplier"]);
    expect(roles(OffersController.prototype, "createPricingTier")).toEqual(["admin", "supplier"]);
  });

  it("VIP self-service cannot activate membership", () => {
    expect(roles(VipController.prototype, "subscribe")).toEqual(["customer", "vip"]);
    expect(roles(VipController.prototype, "activate")).toEqual(["admin"]);
    expect(isVipSubscriptionActive({ id: "x", userId: "u", planId: "p", status: "pending" })).toBe(false);
  });

  it("zero MOQ and package quantities are rejected in domain logic", () => {
    expect(() => assertOfferAllowedForProduct({ productId: "p", sellerType: "KOLBE", productIsKolbeExclusive: false, wholesalePrice: 1n, moq: 0, moqUnit: "PIECE" })).toThrow("مثبت");
    expect(() => validateWholesalePackage({ offerId: "o", packageType: "CUSTOM_BUNDLE", name: "x", totalPieces: 0, items: [] })).toThrow("مثبت");
  });
});
