/**
 * Phase 3.6 — Reservation Expiration Foundation
 *
 * Current: inventory_reservation.expires_at exists
 *
 * Foundation implemented in InventoryService:
 * - findExpiredReservations(limit): SELECT WHERE status='active' AND expires_at < now()
 * - releaseExpiredReservations(limit, actorId): for each expired, UPDATE product_variant_inventory reserved--, INSERT ledger RELEASE, UPDATE reservation expired
 * - Safe release: continues on error, idempotent, ledger RELEASE with reason including expires_at
 *
 * Do NOT create full worker system yet — prepare service boundary for future BullMQ worker
 * Future BullMQ worker will call handleExpiredReservations every minute
 */

export const EXPIRATION_FOUNDATION = {
  query: "SELECT * FROM inventory_reservation WHERE status='active' AND expires_at < now() LIMIT $1",
  release: "UPDATE product_variant_inventory SET reserved=GREATEST(0,reserved-quantity) + INSERT inventory_ledger RELEASE + UPDATE reservation expired",
  worker: "BullMQ — future Phase 4",
  safe: true,
  ledger: "RELEASE",
};
