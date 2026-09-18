import { Injectable } from "@nestjs/common";
import { InventoryService, type Requester } from "./inventory.service";

/**
 * Phase 3.8 — Inventory Cutover — Canonical Only
 *
 * Final architecture (clean):
 *   Product → Product Variant → Seller → Seller Offer → Product Variant Inventory → Reservation → Order Engine
 *
 *   InventoryService (product_variant_inventory)
 *     ↓
 *   inventory_reservation (pending→active, expires_at)
 *     ↓
 *   inventory_ledger (RESERVE/RELEASE/DECREASE)
 *     ↓
 *   Order Engine (Phase 4)
 *
 * No legacy supplier_inventory, no LegacyInventoryAdapter — InventoryService is the only authority.
 */

export type PackageReservationRequest = {
  packageId: string;
  sellerId: string;
  quantity: number; // number of packages
  requestId: string; // wholesale_request.id
  expiresInMinutes?: number;
  requester: Requester;
  reason?: string;
};

@Injectable()
export class InventoryCutoverService {
  constructor(private readonly inventory: InventoryService) {}

  /**
   * Future Order Engine should call this to check if a package can be fulfilled
   * Uses product_variant_inventory (variant-level), not supplier_inventory
   */
  async checkCanFulfillPackage(input: PackageReservationRequest) {
    const availability = await this.inventory.checkPackageAvailability(input.packageId, input.sellerId, input.requester);
    return {
      canFulfill: availability.packageAvailable >= input.quantity,
      available: availability.packageAvailable,
      requested: input.quantity,
      details: availability.items,
    };
  }

  /**
   * Future Order Engine should call this to reserve a package atomically
   * Either reserves ALL variants or rejects — no partial success
   */
  async reservePackageForOrder(input: PackageReservationRequest) {
    return this.inventory.reservePackage({
      packageId: input.packageId,
      sellerId: input.sellerId,
      quantity: input.quantity,
      requestId: input.requestId,
      expiresInMinutes: input.expiresInMinutes || 30,
      requester: input.requester,
      reason: input.reason || `order reservation for request ${input.requestId}`,
    });
  }

  /**
   * Release reservations when order cancelled/expired
   */
  async releaseReservationsForOrder(reservationIds: string[], requester: Requester, reason?: string) {
    const results = [];
    for (const id of reservationIds) {
      const released = await this.inventory.releaseReservation({ reservationId: id, requester, reason });
      results.push(released);
    }
    return results;
  }

  /**
   * Confirm reservations when order fulfilled → DECREASE ledger
   */
  async confirmReservationsForOrder(reservationIds: string[], requester: Requester, reason?: string) {
    const results = [];
    for (const id of reservationIds) {
      const confirmed = await this.inventory.confirmReservation({ reservationId: id, requester, reason });
      results.push(confirmed);
    }
    return results;
  }

  /**
   * Expiration handling — to be called by future BullMQ worker
   * Currently foundation only, no full worker system yet
   */
  async handleExpiredReservations(limit = 100) {
    return this.inventory.releaseExpiredReservations(limit, "system");
  }
}
