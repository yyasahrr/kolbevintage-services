import { Inject, Injectable } from "@nestjs/common";
import { and, eq, lt, sql } from "drizzle-orm";
import {
  productVariantInventory,
  inventoryReservation,
  inventoryLedger,
  supplierMember,
  seller,
  commandIdempotency,
  wholesaleRequest,
  wholesaleAccount,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { NotFoundError } from "@kolbe/shared";
import { createHash, randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import {
  calculateAvailable,
  assertSupplierOwnsInventory,
  assertInventoryCanReserve,
  assertInventoryMutationAllowed,
  assertReservationMutationAllowed,
  transitionReservation,
  calculatePackageAvailability,
  CatalogDomainError,
} from "./inventory.logic";

/**
 * Phase 4.1.1 — Inventory Authority with Transaction Executor Support
 *
 * Goals:
 * - All mutations in single DB transaction
 * - Row locking: SELECT FOR UPDATE stable (seller_id, variant_id), reservations before balances
 * - Persistent idempotency scoped by seller
 * - Audit same transaction via AuditService
 * - Support optional external executor for future Orders flow:
 *   BEGIN (Orders) -> Orders mutation -> Inventory mutation (using same tx) -> Audit -> COMMIT
 * - Standalone still works (creates own transaction if no executor)
 */

export type Requester = {
  userId: string;
  role: string;
  sellerId?: string | null;
  principalType?: "system" | "user";
  initiatedByUserId?: string | null;
  operation?: string;
};

type Tx = Parameters<Parameters<KolbeDatabase["transaction"]>[0]>[0];
export type DbOrTx = KolbeDatabase | Tx;

function hashRequest(input: unknown): string {
  const canonical = JSON.stringify(input, Object.keys(input as object).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

function idempotencyId(): string {
  return `cid_${randomUUID().replaceAll("-", "")}`;
}
function reservationId(): string {
  return `ires_${randomUUID().replaceAll("-", "")}`;
}
function inventoryId(): string {
  return `pvi_${randomUUID().replaceAll("-", "")}`;
}
function ledgerId(): string {
  return `iled_${randomUUID().replaceAll("-", "")}`;
}

@Injectable()
export class InventoryService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  // ── Transaction Executor Helper ──────────────────────────────────────────
  private async withExecutor<T>(
    executor: DbOrTx | undefined,
    work: (tx: DbOrTx) => Promise<T>,
  ): Promise<T> {
    if (executor) {
      // Use supplied executor directly — do NOT open/commit new transaction
      // This is the Orders future flow: Orders owns BEGIN/COMMIT, Inventory uses same tx
      return work(executor);
    }
    // Standalone: own transaction
    return this.db.transaction(async (tx) => work(tx as any));
  }

  // ── Supplier Identity Resolution ─────────────────────────────────────────
  async resolveSellerIdFromUserId(userId: string, executor?: DbOrTx): Promise<string | null> {
    const db = (executor as any) || this.db;
    const [member] = await db
      .select({ supplierId: supplierMember.supplierId })
      .from(supplierMember)
      .where(eq(supplierMember.userId, userId))
      .limit(1);
    if (!member) return null;
    const [sellerRow] = await db
      .select({ id: seller.id })
      .from(seller)
      .where(eq(seller.supplierId, member.supplierId))
      .limit(1);
    return sellerRow?.id || null;
  }

  // ── Idempotency Helpers ──────────────────────────────────────────────────
  private async claimIdempotency(
    tx: DbOrTx,
    scopeType: string,
    scopeId: string,
    commandType: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<{ isReplay: boolean; existing?: typeof commandIdempotency.$inferSelect }> {
    if (!idempotencyKey) return { isReplay: false };

    const [existing] = await (tx as any)
      .select()
      .from(commandIdempotency)
      .where(
        and(
          eq(commandIdempotency.scopeType, scopeType),
          eq(commandIdempotency.scopeId, scopeId),
          eq(commandIdempotency.commandType, commandType),
          eq(commandIdempotency.idempotencyKey, idempotencyKey),
        ),
      )
      .for("update")
      .limit(1);

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new CatalogDomainError(
          "IDEMPOTENCY_KEY_REUSED",
          `کلید عدم‌تکرار با payload متفاوت استفاده شده — ${idempotencyKey}`,
        );
      }
      if (existing.state === "pending") {
        throw new CatalogDomainError("COMMAND_IN_PROGRESS", `دستور در حال اجراست — ${idempotencyKey}`);
      }
      if (existing.state === "completed") {
        return { isReplay: true, existing };
      }
    }

    try {
      await (tx as any).insert(commandIdempotency).values({
        id: idempotencyId(),
        scopeType,
        scopeId,
        commandType,
        idempotencyKey,
        requestHash,
        state: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
    } catch (e: any) {
      if (e?.code === "23505") {
        throw new CatalogDomainError("COMMAND_IN_PROGRESS", `دستور هم‌زمان با همین کلید — ${idempotencyKey}`);
      }
      throw e;
    }

    return { isReplay: false };
  }

  private async completeIdempotency(
    tx: DbOrTx,
    scopeType: string,
    scopeId: string,
    commandType: string,
    idempotencyKey: string,
    resultResourceId: string,
    resultPayload: unknown,
  ): Promise<void> {
    if (!idempotencyKey) return;
    await (tx as any)
      .update(commandIdempotency)
      .set({
        state: "completed",
        resultResourceId,
        resultPayload: resultPayload as any,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(commandIdempotency.scopeType, scopeType),
          eq(commandIdempotency.scopeId, scopeId),
          eq(commandIdempotency.commandType, commandType),
          eq(commandIdempotency.idempotencyKey, idempotencyKey),
        ),
      );
  }

  private async failIdempotency(
    tx: DbOrTx,
    scopeType: string,
    scopeId: string,
    commandType: string,
    idempotencyKey: string,
  ): Promise<void> {
    if (!idempotencyKey) return;
    try {
      await (tx as any)
        .update(commandIdempotency)
        .set({ state: "failed", updatedAt: new Date(), completedAt: new Date() })
        .where(
          and(
            eq(commandIdempotency.scopeType, scopeType),
            eq(commandIdempotency.scopeId, scopeId),
            eq(commandIdempotency.commandType, commandType),
            eq(commandIdempotency.idempotencyKey, idempotencyKey),
          ),
        );
    } catch {}
  }

  // ── Variant Inventory ────────────────────────────────────────────────────
  async upsertVariantInventory(input: {
    variantId: string;
    sellerId: string;
    onHandDelta: number;
    reason?: string;
    actorId?: string;
    requester: Requester;
    idempotencyKey?: string;
    executor?: DbOrTx;
  }) {
    assertInventoryMutationAllowed(input.requester.role, input.requester.sellerId || null, input.sellerId);

    if (!Number.isSafeInteger(input.onHandDelta)) {
      throw new CatalogDomainError("INVALID_QUANTITY", "تعداد باید عدد صحیح امن باشد");
    }
    if (input.onHandDelta === 0) {
      throw new CatalogDomainError("INVALID_QUANTITY", "تغییر موجودی نمی‌تواند صفر باشد");
    }

    const requestHash = hashRequest({
      variantId: input.variantId,
      sellerId: input.sellerId,
      onHandDelta: input.onHandDelta,
      reason: input.reason,
    });

    const scopeType = "seller";
    const scopeId = input.sellerId;
    const commandType = "inventory.adjust";
    const idempotencyKey = input.idempotencyKey || "";

    return this.withExecutor(input.executor, async (tx) => {
      try {
        const claim = await this.claimIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey, requestHash);
        if (claim.isReplay && claim.existing) {
          const payload = claim.existing.resultPayload as any;
          if (payload) return { ...payload, replayed: true };
          const [inv] = await (tx as any)
            .select()
            .from(productVariantInventory)
            .where(and(eq(productVariantInventory.variantId, input.variantId), eq(productVariantInventory.sellerId, input.sellerId)))
            .limit(1);
          if (inv) return { ...inv, available: calculateAvailable(inv as any), replayed: true };
        }

        const [existing] = await (tx as any)
          .select()
          .from(productVariantInventory)
          .where(and(eq(productVariantInventory.variantId, input.variantId), eq(productVariantInventory.sellerId, input.sellerId)))
          .for("update")
          .limit(1);

        const actorId = input.actorId || input.requester.userId;
        const ledgerActorId = actorId === "system" ? null : actorId;
        const auditActorId = actorId === "system" ? null : actorId;
        const reason = input.reason || (input.onHandDelta < 0 ? "external sale" : "restock");

        let resultInventory: any;

        if (!existing) {
          if (input.onHandDelta < 0) throw new NotFoundError("موجودی یافت نشد");
          const id = inventoryId();
          const [created] = await (tx as any)
            .insert(productVariantInventory)
            .values({
              id,
              variantId: input.variantId,
              sellerId: input.sellerId,
              onHand: input.onHandDelta,
              reserved: 0,
              status: "active",
            })
            .returning();

          await (tx as any).insert(inventoryLedger).values({
            id: ledgerId(),
            variantId: input.variantId,
            sellerId: input.sellerId,
            changeType: "INCREASE",
            quantityDelta: input.onHandDelta,
            beforeOnHand: 0,
            afterOnHand: input.onHandDelta,
            beforeReserved: 0,
            afterReserved: 0,
            reason,
            actorId: ledgerActorId,
          });

          await this.auditService.record(
            {
              actorId: auditActorId,
              actorRole: input.requester.role,
              action: "inventory.increased",
              entityType: "product_variant_inventory",
              entityId: id,
              before: { onHand: 0, reserved: 0 },
              after: { onHand: input.onHandDelta, reserved: 0 },
              metadata: { variantId: input.variantId, sellerId: input.sellerId, reason, quantityDelta: input.onHandDelta },
            },
            tx as any,
          );

          resultInventory = created;
        } else {
          const before = { onHand: existing.onHand, reserved: existing.reserved };
          const afterOnHand = existing.onHand + input.onHandDelta;

          if (afterOnHand < 0) {
            throw new CatalogDomainError(
              "INSUFFICIENT_ON_HAND",
              `موجودی کافی نیست — در دسترس ${existing.onHand}، کاهش ${-input.onHandDelta}`,
            );
          }
          if (afterOnHand < existing.reserved) {
            throw new CatalogDomainError(
              "SHORTAGE_BELOW_RESERVED",
              `کاهش موجودی زیر رزرو فعال مجاز نیست — on_hand ${afterOnHand} < reserved ${existing.reserved}`,
            );
          }

          const [updated] = await (tx as any)
            .update(productVariantInventory)
            .set({ onHand: afterOnHand, updatedAt: new Date() })
            .where(eq(productVariantInventory.id, existing.id))
            .returning();

          const changeType = input.onHandDelta >= 0 ? "INCREASE" : "DECREASE";
          await (tx as any).insert(inventoryLedger).values({
            id: ledgerId(),
            variantId: input.variantId,
            sellerId: input.sellerId,
            changeType,
            quantityDelta: input.onHandDelta,
            beforeOnHand: before.onHand,
            afterOnHand,
            beforeReserved: before.reserved,
            afterReserved: before.reserved,
            reason,
            actorId: ledgerActorId,
          });

          await this.auditService.record(
            {
              actorId: auditActorId,
              actorRole: input.requester.role,
              action: changeType === "INCREASE" ? "inventory.increased" : "inventory.decreased",
              entityType: "product_variant_inventory",
              entityId: existing.id,
              before,
              after: { onHand: afterOnHand, reserved: before.reserved },
              metadata: { variantId: input.variantId, sellerId: input.sellerId, reason, quantityDelta: input.onHandDelta },
            },
            tx as any,
          );

          resultInventory = updated;
        }

        await this.completeIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey, resultInventory.id, resultInventory);
        return resultInventory;
      } catch (e) {
        if (idempotencyKey) {
          await this.failIdempotency(tx as any, scopeType, scopeId, commandType, idempotencyKey);
        }
        throw e;
      }
    });
  }

  async getVariantInventory(variantId: string, sellerId: string, requester: Requester, executor?: DbOrTx) {
    if (requester.role === "supplier") {
      assertSupplierOwnsInventory(requester.sellerId || "", sellerId, requester.role);
    }
    const db = (executor as any) || this.db;
    const [inv] = await db
      .select()
      .from(productVariantInventory)
      .where(and(eq(productVariantInventory.variantId, variantId), eq(productVariantInventory.sellerId, sellerId)))
      .limit(1);
    if (!inv) throw new NotFoundError("موجودی یافت نشد");
    return { ...inv, available: calculateAvailable(inv as any) };
  }

  async listInventoriesForSeller(sellerId: string, requester: Requester, executor?: DbOrTx) {
    assertSupplierOwnsInventory(requester.sellerId || "", sellerId, requester.role);
    if (requester.role === "supplier") {
      assertInventoryMutationAllowed(requester.role, requester.sellerId || null, sellerId);
    }
    const db = (executor as any) || this.db;
    const rows = await db.select().from(productVariantInventory).where(eq(productVariantInventory.sellerId, sellerId)).limit(100);
    return rows.map((r: any) => ({ ...r, available: calculateAvailable(r as any) }));
  }

  // ── Reservation ──────────────────────────────────────────────────────────
  async createReservation(input: {
    variantId: string;
    sellerId: string;
    quantity: number;
    requestId?: string | null;
    expiresInMinutes?: number;
    requester: Requester;
    reason?: string;
    idempotencyKey?: string;
    allocationId?: string;
    executor?: DbOrTx;
  }) {
    assertInventoryMutationAllowed(input.requester.role, input.requester.sellerId || null, input.sellerId);

    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
      throw new CatalogDomainError("INVALID_RESERVE_QUANTITY", "تعداد رزرو باید عدد صحیح مثبت باشد");
    }

    const requestHash = hashRequest({
      variantId: input.variantId,
      sellerId: input.sellerId,
      quantity: input.quantity,
      requestId: input.requestId,
      allocationId: input.allocationId,
    });

    const scopeType = "seller";
    const scopeId = input.sellerId;
    const commandType = "inventory.reserve";
    const idempotencyKey = input.idempotencyKey || "";

    return this.withExecutor(input.executor, async (tx) => {
      try {
        const claim = await this.claimIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey, requestHash);
        if (claim.isReplay && claim.existing) {
          const payload = claim.existing.resultPayload as any;
          if (payload) return { ...payload, replayed: true };
          if (claim.existing.resultResourceId) {
            const [res] = await (tx as any)
              .select()
              .from(inventoryReservation)
              .where(eq(inventoryReservation.id, claim.existing.resultResourceId))
              .limit(1);
            if (res) return { ...res, replayed: true };
          }
        }

        const [inventory] = await (tx as any)
          .select()
          .from(productVariantInventory)
          .where(and(eq(productVariantInventory.variantId, input.variantId), eq(productVariantInventory.sellerId, input.sellerId)))
          .for("update")
          .limit(1);

        if (!inventory) throw new NotFoundError("موجودی یافت نشد");
        assertInventoryCanReserve(inventory as any, input.quantity);

        const id = reservationId();
        const expiresAt = input.expiresInMinutes ? new Date(Date.now() + input.expiresInMinutes * 60 * 1000) : null;

        const [reservation] = await (tx as any)
          .insert(inventoryReservation)
          .values({
            id,
            variantId: input.variantId,
            sellerId: input.sellerId,
            quantity: input.quantity,
            status: "active",
            expiresAt,
            requestId: input.requestId || null,
            createdBy: input.requester.userId === "system" ? null : input.requester.userId,
            idempotencyKey: idempotencyKey || null,
            allocationId: input.allocationId || null,
          })
          .returning();

        const before = { onHand: inventory.onHand, reserved: inventory.reserved };
        const afterReserved = inventory.reserved + input.quantity;

        if (afterReserved > inventory.onHand) {
          throw new CatalogDomainError(
            "RESERVED_EXCEEDS_ON_HAND",
            `رزرو بیش از موجودی — on_hand ${inventory.onHand}, reserved would be ${afterReserved}`,
          );
        }

        await (tx as any)
          .update(productVariantInventory)
          .set({ reserved: afterReserved, updatedAt: new Date() })
          .where(eq(productVariantInventory.id, inventory.id));

        await (tx as any).insert(inventoryLedger).values({
          id: ledgerId(),
          variantId: input.variantId,
          sellerId: input.sellerId,
          changeType: "RESERVE",
          quantityDelta: input.quantity,
          beforeOnHand: before.onHand,
          afterOnHand: before.onHand,
          beforeReserved: before.reserved,
          afterReserved,
          reason: input.reason || `reservation ${id} for request ${input.requestId || ""}`,
          actorId: input.requester.userId === "system" ? null : input.requester.userId,
        });

        await this.auditService.record(
          {
            actorId: input.requester.userId === "system" ? null : input.requester.userId,
            actorRole: input.requester.role,
            action: "inventory.reserved",
            entityType: "inventory_reservation",
            entityId: id,
            before: { status: "pending", quantity: input.quantity },
            after: { status: "active", quantity: input.quantity },
            metadata: {
              variantId: input.variantId,
              sellerId: input.sellerId,
              reason: input.reason,
              requestId: input.requestId,
              expiresAt,
              allocationId: input.allocationId,
              idempotencyKey,
            },
            requestId: input.requestId || null,
          },
          tx as any,
        );

        await this.completeIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey, id, reservation);
        return reservation;
      } catch (e) {
        if (idempotencyKey) {
          await this.failIdempotency(tx as any, scopeType, scopeId, commandType, idempotencyKey);
        }
        throw e;
      }
    });
  }

  async releaseReservation(input: {
    reservationId: string;
    requester: Requester;
    reason?: string;
    idempotencyKey?: string;
    executor?: DbOrTx;
  }) {
    const requestHash = hashRequest({ reservationId: input.reservationId, reason: input.reason });
    const idempotencyKey = input.idempotencyKey || "";

    return this.withExecutor(input.executor, async (tx) => {
      const [reservation] = await (tx as any)
        .select()
        .from(inventoryReservation)
        .where(eq(inventoryReservation.id, input.reservationId))
        .for("update")
        .limit(1);

      if (!reservation) throw new NotFoundError("رزرو یافت نشد");
      assertReservationMutationAllowed(input.requester.role, input.requester.sellerId || null, reservation.sellerId);

      if (input.requester.role === "vip") {
        if (!reservation.requestId) {
          throw new CatalogDomainError(
            "VIP_RELEASE_REQUIRES_REQUEST_ID",
            "آزادسازی توسط VIP فقط برای رزروهای متصل به درخواست عمده مجاز است",
          );
        }
        const [req] = await (tx as any)
          .select()
          .from(wholesaleRequest)
          .where(eq(wholesaleRequest.id, reservation.requestId))
          .limit(1);
        if (!req) throw new CatalogDomainError("WHOLESALE_REQUEST_NOT_FOUND", "درخواست عمده یافت نشد");
        const [account] = await (tx as any)
          .select()
          .from(wholesaleAccount)
          .where(eq(wholesaleAccount.id, req.vipAccountId))
          .limit(1);
        if (!account) throw new CatalogDomainError("WHOLESALE_ACCOUNT_NOT_FOUND", "حساب VIP یافت نشد");
        if (account.userId !== input.requester.userId) {
          throw new CatalogDomainError("VIP_OWNERSHIP_VIOLATION", "شما مالک این درخواست عمده نیستید");
        }
      }

      const scopeType = "seller";
      const scopeId = reservation.sellerId;
      const commandType = "inventory.release";

      try {
        const claim = await this.claimIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey, requestHash);
        if (claim.isReplay && claim.existing) {
          const payload = claim.existing.resultPayload as any;
          if (payload) return { ...payload, replayed: true };
          if (["released", "expired", "cancelled"].includes(reservation.status)) {
            return { ...reservation, replayed: true };
          }
        }

        if (["released", "expired", "cancelled"].includes(reservation.status)) {
          if (idempotencyKey) {
            await this.completeIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey, reservation.id, reservation);
          }
          return { ...reservation, replayed: true };
        }

        if (reservation.status === "confirmed") {
          throw new CatalogDomainError("RESERVATION_ALREADY_CONFIRMED", "رزرو قبلاً تأیید شده — آزادسازی مجاز نیست");
        }

        let newStatus: string = "released";
        if (reservation.expiresAt) {
          const [{ now }] = await (tx as any).execute(sql`SELECT NOW() as now`);
          const dbNow = new Date((now as any) as string);
          if (new Date(reservation.expiresAt).getTime() < dbNow.getTime() && reservation.status === "active") {
            newStatus = "expired";
            try {
              transitionReservation(reservation.status as any, "expired", "system");
            } catch {
              newStatus = "released";
            }
          } else {
            transitionReservation(reservation.status as any, "released", input.requester.role as any);
          }
        } else {
          transitionReservation(reservation.status as any, "released", input.requester.role as any);
        }

        const [inventory] = await (tx as any)
          .select()
          .from(productVariantInventory)
          .where(and(eq(productVariantInventory.variantId, reservation.variantId), eq(productVariantInventory.sellerId, reservation.sellerId)))
          .for("update")
          .limit(1);

        if (!inventory) throw new NotFoundError("موجودی یافت نشد");

        const before = { onHand: inventory.onHand, reserved: inventory.reserved };
        const afterReserved = inventory.reserved - reservation.quantity;

        if (afterReserved < 0) {
          throw new CatalogDomainError(
            "RESERVED_UNDERFLOW",
            `آزادسازی بیش از رزرو — reserved ${inventory.reserved}, release ${reservation.quantity}`,
          );
        }

        await (tx as any)
          .update(productVariantInventory)
          .set({ reserved: afterReserved, updatedAt: new Date() })
          .where(eq(productVariantInventory.id, inventory.id));

        await (tx as any).insert(inventoryLedger).values({
          id: ledgerId(),
          variantId: reservation.variantId,
          sellerId: reservation.sellerId,
          changeType: "RELEASE",
          quantityDelta: -reservation.quantity,
          beforeOnHand: before.onHand,
          afterOnHand: before.onHand,
          beforeReserved: before.reserved,
          afterReserved,
          reason: input.reason || `release reservation ${input.reservationId} by ${input.requester.role} ${input.requester.userId}`,
          actorId: input.requester.userId === "system" ? null : input.requester.userId,
        });

        const [released] = await (tx as any)
          .update(inventoryReservation)
          .set({ status: newStatus, updatedAt: new Date() })
          .where(eq(inventoryReservation.id, input.reservationId))
          .returning();

        await this.auditService.record(
          {
            actorId: input.requester.userId === "system" ? null : input.requester.userId,
            actorRole: input.requester.role,
            action: newStatus === "expired" ? "inventory.reservation_expired" : "inventory.released",
            entityType: "inventory_reservation",
            entityId: reservation.id,
            before: { status: reservation.status, quantity: reservation.quantity },
            after: { status: newStatus, quantity: reservation.quantity },
            metadata: { variantId: reservation.variantId, sellerId: reservation.sellerId, reason: input.reason, requestId: reservation.requestId },
            requestId: reservation.requestId || null,
          },
          tx as any,
        );

        await this.completeIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey, released.id, released);
        return released;
      } catch (e) {
        if (idempotencyKey) {
          await this.failIdempotency(tx as any, scopeType, scopeId, commandType, idempotencyKey);
        }
        throw e;
      }
    });
  }

  async confirmReservation(input: {
    reservationId: string;
    requester: Requester;
    reason?: string;
    idempotencyKey?: string;
    executor?: DbOrTx;
  }) {
    const requestHash = hashRequest({ reservationId: input.reservationId, reason: input.reason });
    const idempotencyKey = input.idempotencyKey || "";

    return this.withExecutor(input.executor, async (tx) => {
      const [reservation] = await (tx as any)
        .select()
        .from(inventoryReservation)
        .where(eq(inventoryReservation.id, input.reservationId))
        .for("update")
        .limit(1);

      if (!reservation) throw new NotFoundError("رزرو یافت نشد");
      assertReservationMutationAllowed(input.requester.role, input.requester.sellerId || null, reservation.sellerId);

      const scopeType = "seller";
      const scopeId = reservation.sellerId;
      const commandType = "inventory.confirm";

      try {
        const claim = await this.claimIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey, requestHash);
        if (claim.isReplay && claim.existing) {
          const payload = claim.existing.resultPayload as any;
          if (payload) return { ...payload, replayed: true };
          if (reservation.status === "confirmed") return { ...reservation, replayed: true };
        }

        if (reservation.status === "confirmed") {
          if (idempotencyKey) {
            await this.completeIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey, reservation.id, reservation);
          }
          return { ...reservation, replayed: true };
        }

        if (["released", "expired", "cancelled"].includes(reservation.status)) {
          throw new CatalogDomainError(
            "RESERVATION_TERMINAL",
            `رزرو در وضعیت پایانی ${reservation.status} است — تأیید مجاز نیست`,
          );
        }

        if (reservation.expiresAt) {
          const [{ now }] = await (tx as any).execute(sql`SELECT NOW() as now`);
          const dbNow = new Date((now as any) as string);
          if (new Date(reservation.expiresAt).getTime() < dbNow.getTime()) {
            throw new CatalogDomainError("RESERVATION_EXPIRED", "رزرو منقضی شده — تأیید مجاز نیست");
          }
        }

        transitionReservation(reservation.status as any, "confirmed", input.requester.role as any);

        const [inventory] = await (tx as any)
          .select()
          .from(productVariantInventory)
          .where(and(eq(productVariantInventory.variantId, reservation.variantId), eq(productVariantInventory.sellerId, reservation.sellerId)))
          .for("update")
          .limit(1);

        if (!inventory) throw new NotFoundError("موجودی یافت نشد");

        const before = { onHand: inventory.onHand, reserved: inventory.reserved };
        const afterOnHand = inventory.onHand - reservation.quantity;
        const afterReserved = inventory.reserved - reservation.quantity;

        if (afterOnHand < 0) {
          throw new CatalogDomainError(
            "ON_HAND_UNDERFLOW",
            `تأیید بیش از موجودی — on_hand ${inventory.onHand}, confirm ${reservation.quantity}`,
          );
        }
        if (afterReserved < 0) {
          throw new CatalogDomainError(
            "RESERVED_UNDERFLOW",
            `تأیید بیش از رزرو — reserved ${inventory.reserved}, confirm ${reservation.quantity}`,
          );
        }

        await (tx as any)
          .update(productVariantInventory)
          .set({ onHand: afterOnHand, reserved: afterReserved, updatedAt: new Date() })
          .where(eq(productVariantInventory.id, inventory.id));

        await (tx as any).insert(inventoryLedger).values({
          id: ledgerId(),
          variantId: reservation.variantId,
          sellerId: reservation.sellerId,
          changeType: "DECREASE",
          quantityDelta: -reservation.quantity,
          beforeOnHand: before.onHand,
          afterOnHand,
          beforeReserved: before.reserved,
          afterReserved,
          reason: input.reason || `confirm reservation ${input.reservationId} -> order by ${input.requester.userId}`,
          actorId: input.requester.userId === "system" ? null : input.requester.userId,
        });

        const [confirmed] = await (tx as any)
          .update(inventoryReservation)
          .set({ status: "confirmed", updatedAt: new Date() })
          .where(eq(inventoryReservation.id, input.reservationId))
          .returning();

        await this.auditService.record(
          {
            actorId: input.requester.userId === "system" ? null : input.requester.userId,
            actorRole: input.requester.role,
            action: "inventory.confirmed",
            entityType: "inventory_reservation",
            entityId: reservation.id,
            before: { status: reservation.status, quantity: reservation.quantity },
            after: { status: "confirmed", quantity: reservation.quantity },
            metadata: { variantId: reservation.variantId, sellerId: reservation.sellerId, reason: input.reason, requestId: reservation.requestId },
            requestId: reservation.requestId || null,
          },
          tx as any,
        );

        await this.completeIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey, confirmed.id, confirmed);
        return confirmed;
      } catch (e) {
        if (idempotencyKey) {
          await this.failIdempotency(tx as any, scopeType, scopeId, commandType, idempotencyKey);
        }
        throw e;
      }
    });
  }

  // ── Expiration ─────────────────────────────────────────────────────────────
  async findExpiredReservations(limit = 100, executor?: DbOrTx) {
    const db = (executor as any) || this.db;
    return db
      .select()
      .from(inventoryReservation)
      .where(and(eq(inventoryReservation.status, "active"), lt(inventoryReservation.expiresAt, sql`NOW()`)))
      .limit(limit);
  }

  async releaseExpiredReservations(limit = 100, actorId: string | null = null, executor?: DbOrTx) {
    // If external executor provided (e.g., Orders orchestrating expiry), use it for whole batch
    // Otherwise, use existing worker-safe pattern: claim with SKIP LOCKED in tx, then per-reservation tx
    if (executor) {
      // Use supplied executor directly — caller owns transaction
      const result = await (executor as any).execute(
        sql`SELECT * FROM inventory_reservation WHERE status = 'active' AND expires_at < NOW() ORDER BY expires_at ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED`,
      );
      const claimed = result.rows as (typeof inventoryReservation.$inferSelect)[];
      const results = [];
      for (const res of claimed) {
        const [reservation] = await (executor as any)
          .select()
          .from(inventoryReservation)
          .where(eq(inventoryReservation.id, res.id))
          .for("update")
          .limit(1);
        if (!reservation || reservation.status !== "active") continue;

        const [{ now }] = await (executor as any).execute(sql`SELECT NOW() as now`);
        const dbNow = new Date((now as any) as string);
        if (reservation.expiresAt && new Date(reservation.expiresAt).getTime() >= dbNow.getTime()) continue;

        const [inventory] = await (executor as any)
          .select()
          .from(productVariantInventory)
          .where(and(eq(productVariantInventory.variantId, reservation.variantId), eq(productVariantInventory.sellerId, reservation.sellerId)))
          .for("update")
          .limit(1);
        if (!inventory) continue;

        const before = { onHand: inventory.onHand, reserved: inventory.reserved };
        const afterReserved = inventory.reserved - reservation.quantity;
        if (afterReserved < 0) {
          const [updated] = await (executor as any)
            .update(inventoryReservation)
            .set({ status: "expired", updatedAt: new Date() })
            .where(eq(inventoryReservation.id, reservation.id))
            .returning();
          results.push(updated);
          continue;
        }

        await (executor as any)
          .update(productVariantInventory)
          .set({ reserved: afterReserved, updatedAt: new Date() })
          .where(eq(productVariantInventory.id, inventory.id));

        await (executor as any).insert(inventoryLedger).values({
          id: ledgerId(),
          variantId: reservation.variantId,
          sellerId: reservation.sellerId,
          changeType: "RELEASE",
          quantityDelta: -reservation.quantity,
          beforeOnHand: before.onHand,
          afterOnHand: before.onHand,
          beforeReserved: before.reserved,
          afterReserved,
          reason: `expired release reservation ${reservation.id}`,
          actorId: actorId === "system" ? null : actorId,
        });

        const [released] = await (executor as any)
          .update(inventoryReservation)
          .set({ status: "expired", updatedAt: new Date() })
          .where(eq(inventoryReservation.id, reservation.id))
          .returning();

        await this.auditService.record(
          {
            actorId: actorId === "system" ? null : actorId,
            actorRole: "system",
            action: "inventory.reservation_expired",
            entityType: "inventory_reservation",
            entityId: reservation.id,
            before: { status: reservation.status, quantity: reservation.quantity },
            after: { status: "expired", quantity: reservation.quantity },
            metadata: { variantId: reservation.variantId, sellerId: reservation.sellerId, expiresAt: reservation.expiresAt },
            requestId: reservation.requestId || null,
          },
          executor as any,
        );

        results.push(released);
      }
      return results;
    }

    // Standalone worker path (no external executor)
    const claimed = await this.db.transaction(async (tx) => {
      const result = await (tx as any).execute(
        sql`SELECT * FROM inventory_reservation WHERE status = 'active' AND expires_at < NOW() ORDER BY expires_at ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED`,
      );
      return result.rows as (typeof inventoryReservation.$inferSelect)[];
    });

    const results = [];
    for (const res of claimed) {
      try {
        const released = await this.db.transaction(async (tx) => {
          const [reservation] = await (tx as any)
            .select()
            .from(inventoryReservation)
            .where(eq(inventoryReservation.id, res.id))
            .for("update")
            .limit(1);
          if (!reservation) return null;
          if (reservation.status !== "active") return reservation;

          const [{ now }] = await (tx as any).execute(sql`SELECT NOW() as now`);
          const dbNow = new Date((now as any) as string);
          if (reservation.expiresAt && new Date(reservation.expiresAt).getTime() >= dbNow.getTime()) return null;

          const [inventory] = await (tx as any)
            .select()
            .from(productVariantInventory)
            .where(and(eq(productVariantInventory.variantId, reservation.variantId), eq(productVariantInventory.sellerId, reservation.sellerId)))
            .for("update")
            .limit(1);
          if (!inventory) return null;

          const before = { onHand: inventory.onHand, reserved: inventory.reserved };
          const afterReserved = inventory.reserved - reservation.quantity;
          if (afterReserved < 0) {
            const [updated] = await (tx as any)
              .update(inventoryReservation)
              .set({ status: "expired", updatedAt: new Date() })
              .where(eq(inventoryReservation.id, reservation.id))
              .returning();
            return updated;
          }

          await (tx as any)
            .update(productVariantInventory)
            .set({ reserved: afterReserved, updatedAt: new Date() })
            .where(eq(productVariantInventory.id, inventory.id));

          await (tx as any).insert(inventoryLedger).values({
            id: ledgerId(),
            variantId: reservation.variantId,
            sellerId: reservation.sellerId,
            changeType: "RELEASE",
            quantityDelta: -reservation.quantity,
            beforeOnHand: before.onHand,
            afterOnHand: before.onHand,
            beforeReserved: before.reserved,
            afterReserved,
            reason: `expired release reservation ${reservation.id} (expires_at ${reservation.expiresAt?.toISOString()})`,
            actorId: actorId === "system" ? null : actorId,
          });

          const [released] = await (tx as any)
            .update(inventoryReservation)
            .set({ status: "expired", updatedAt: new Date() })
            .where(eq(inventoryReservation.id, reservation.id))
            .returning();

          await this.auditService.record(
            {
              actorId: actorId === "system" ? null : actorId,
              actorRole: "system",
              action: "inventory.reservation_expired",
              entityType: "inventory_reservation",
              entityId: reservation.id,
              before: { status: reservation.status, quantity: reservation.quantity },
              after: { status: "expired", quantity: reservation.quantity },
              metadata: { variantId: reservation.variantId, sellerId: reservation.sellerId, expiresAt: reservation.expiresAt, reason: `expired release` },
              requestId: reservation.requestId || null,
            },
            tx as any,
          );

          return released;
        });

        if (released) results.push(released);
      } catch {
        continue;
      }
    }

    return results;
  }

  // ── Package Availability and Reservation ───────────────────────────────────
  async checkPackageAvailability(packageId: string, sellerId: string, requester: Requester, executor?: DbOrTx) {
    if (requester.role === "supplier") {
      assertSupplierOwnsInventory(requester.sellerId || "", sellerId, requester.role);
    }
    const db = (executor as any) || this.db;
    const { wholesalePackage, wholesalePackageItem } = await import("@kolbe/database");
    const [pkg] = await db.select().from(wholesalePackage).where(eq(wholesalePackage.id, packageId)).limit(1);
    if (!pkg) throw new NotFoundError("بسته یافت نشد");

    const items = await db.select().from(wholesalePackageItem).where(eq(wholesalePackageItem.packageId, packageId));

    const availabilityChecks = [];
    for (const item of items) {
      const [inv] = await db
        .select()
        .from(productVariantInventory)
        .where(and(eq(productVariantInventory.variantId, item.variantId), eq(productVariantInventory.sellerId, sellerId)))
        .limit(1);
      availabilityChecks.push({
        variantId: item.variantId,
        requiredQty: item.quantity,
        available: inv ? calculateAvailable(inv as any) : 0,
        inventory: inv || null,
      });
    }

    const packageAvailable = calculatePackageAvailability(
      availabilityChecks.map((c) => ({ variantId: c.variantId, requiredQty: c.requiredQty, available: c.available })),
    );
    return { package: pkg, items: availabilityChecks, packageAvailable };
  }

  async reservePackage(input: {
    packageId: string;
    sellerId: string;
    quantity: number;
    requestId?: string | null;
    expiresInMinutes?: number;
    requester: Requester;
    reason?: string;
    idempotencyKey?: string;
    allocationId?: string;
    executor?: DbOrTx;
  }) {
    assertInventoryMutationAllowed(input.requester.role, input.requester.sellerId || null, input.sellerId);

    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
      throw new CatalogDomainError("INVALID_PACKAGE_QUANTITY", "تعداد بسته باید عدد صحیح مثبت باشد");
    }

    const requestHash = hashRequest({
      packageId: input.packageId,
      sellerId: input.sellerId,
      quantity: input.quantity,
      requestId: input.requestId,
      allocationId: input.allocationId,
    });

    const scopeType = "seller";
    const scopeId = input.sellerId;
    const commandType = "inventory.reserve_package";
    const idempotencyKey = input.idempotencyKey || "";

    return this.withExecutor(input.executor, async (tx) => {
      try {
        const claim = await this.claimIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey, requestHash);
        if (claim.isReplay && claim.existing) {
          const payload = claim.existing.resultPayload as any;
          if (payload) return { ...payload, replayed: true };
        }

        const { wholesalePackage, wholesalePackageItem } = await import("@kolbe/database");
        const [pkg] = await (tx as any)
          .select()
          .from(wholesalePackage)
          .where(eq(wholesalePackage.id, input.packageId))
          .for("update")
          .limit(1);
        if (!pkg) throw new NotFoundError("بسته یافت نشد");

        const { sellerOffer } = await import("@kolbe/database");
        const [offer] = await (tx as any)
          .select()
          .from(sellerOffer)
          .where(eq(sellerOffer.id, pkg.offerId))
          .for("update")
          .limit(1);
        if (!offer) throw new NotFoundError("پیشنهاد بسته یافت نشد");
        if (offer.sellerId !== input.sellerId) {
          throw new CatalogDomainError("PACKAGE_SELLER_MISMATCH", "بسته متعلق به فروشنده دیگری است");
        }

        const items = await (tx as any).select().from(wholesalePackageItem).where(eq(wholesalePackageItem.packageId, input.packageId));
        if (items.length === 0) throw new CatalogDomainError("PACKAGE_EMPTY", "بسته خالی است");

        const aggregated = new Map<string, number>();
        for (const item of items) {
          const current = aggregated.get(item.variantId) || 0;
          aggregated.set(item.variantId, current + item.quantity * input.quantity);
        }

        const variantIds = Array.from(aggregated.keys()).sort();
        const inventoryMap = new Map<string, typeof productVariantInventory.$inferSelect>();
        for (const variantId of variantIds) {
          const [inv] = await (tx as any)
            .select()
            .from(productVariantInventory)
            .where(and(eq(productVariantInventory.variantId, variantId), eq(productVariantInventory.sellerId, input.sellerId)))
            .for("update")
            .limit(1);
          if (!inv) throw new NotFoundError(`موجودی برای واریانت ${variantId} یافت نشد`);
          if (inv.status !== "active") throw new CatalogDomainError("INVENTORY_NOT_ACTIVE", `موجودی واریانت ${variantId} فعال نیست`);
          inventoryMap.set(variantId, inv);
        }

        for (const [variantId, requiredQty] of aggregated.entries()) {
          const inv = inventoryMap.get(variantId)!;
          const available = calculateAvailable(inv as any);
          if (available < requiredQty) {
            throw new CatalogDomainError(
              "INSUFFICIENT_PACKAGE_INVENTORY",
              `موجودی واریانت ${variantId} کافی نیست — در دسترس ${available}، مورد نیاز ${requiredQty}`,
            );
          }
        }

        const createdReservations: any[] = [];
        const expiresAt = input.expiresInMinutes ? new Date(Date.now() + input.expiresInMinutes * 60 * 1000) : null;

        for (const [variantId, requiredQty] of aggregated.entries()) {
          const inv = inventoryMap.get(variantId)!;
          const before = { onHand: inv.onHand, reserved: inv.reserved };
          const afterReserved = inv.reserved + requiredQty;

          if (afterReserved > inv.onHand) {
            throw new CatalogDomainError("RESERVED_EXCEEDS_ON_HAND", `رزرو بسته بیش از موجودی واریانت ${variantId}`);
          }

          const resId = reservationId();
          const [reservation] = await (tx as any)
            .insert(inventoryReservation)
            .values({
              id: resId,
              variantId,
              sellerId: input.sellerId,
              quantity: requiredQty,
              status: "active",
              expiresAt,
              requestId: input.requestId || null,
              createdBy: input.requester.userId === "system" ? null : input.requester.userId,
              idempotencyKey: idempotencyKey ? `${idempotencyKey}:${variantId}` : null,
              allocationId: input.allocationId || null,
            })
            .returning();

          await (tx as any)
            .update(productVariantInventory)
            .set({ reserved: afterReserved, updatedAt: new Date() })
            .where(eq(productVariantInventory.id, inv.id));

          await (tx as any).insert(inventoryLedger).values({
            id: ledgerId(),
            variantId,
            sellerId: input.sellerId,
            changeType: "RESERVE",
            quantityDelta: requiredQty,
            beforeOnHand: before.onHand,
            afterOnHand: before.onHand,
            beforeReserved: before.reserved,
            afterReserved,
            reason: input.reason || `package ${input.packageId} x${input.quantity} for request ${input.requestId || ""}`,
            actorId: input.requester.userId === "system" ? null : input.requester.userId,
          });

          await this.auditService.record(
            {
              actorId: input.requester.userId === "system" ? null : input.requester.userId,
              actorRole: input.requester.role,
              action: "inventory.reserved",
              entityType: "inventory_reservation",
              entityId: resId,
              before: { status: "pending", quantity: requiredQty },
              after: { status: "active", quantity: requiredQty },
              metadata: {
                variantId,
                sellerId: input.sellerId,
                packageId: input.packageId,
                requestId: input.requestId,
                allocationId: input.allocationId,
                quantity: requiredQty,
              },
              requestId: input.requestId || null,
            },
            tx as any,
          );

          inventoryMap.set(variantId, { ...inv, reserved: afterReserved } as any);
          createdReservations.push(reservation);
        }

        const result = { package: pkg, reservations: createdReservations, packageQuantity: input.quantity };
        await this.completeIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey, pkg.id, result);
        return result;
      } catch (e) {
        if (idempotencyKey) {
          await this.failIdempotency(tx as any, scopeType, scopeId, commandType, idempotencyKey);
        }
        throw e;
      }
    });
  }


  /**
   * Phase 4.3 — Batch order allocation reservation (canonical engine)
   * Uses frozen accepted recipe, NOT current mutable package recipe
   * Aggregates by (seller_id, variant_id) before locking, deterministic lock order
   * Only reserves (reserved += qty), on_hand NOT decreased
   * Each allocation creates one reservation with order_id, order_item_id, request_id, allocation_id traceability
   * Idempotent via order-level idempotency key
   */
  async reserveOrderAllocations(input: {
    orderId: string;
    allocations: Array<{
      orderItemId: string;
      sourceRequestId: string;
      sellerId: string;
      variantId: string;
      quantity: number;
      allocationId: string;
    }>;
    requester: Requester;
    idempotencyKey: string;
    expiresAt?: Date | null;
    executor: DbOrTx;
  }) {
    if (!input.allocations || input.allocations.length === 0) {
      throw new CatalogDomainError("INVALID_ALLOCATIONS", "allocations must not be empty");
    }

    for (const alloc of input.allocations) {
      if (!alloc.variantId) throw new CatalogDomainError("ALLOCATION_VARIANT_REQUIRED", "variantId required");
      if (!alloc.sellerId) throw new CatalogDomainError("ALLOCATION_SELLER_REQUIRED", "sellerId required");
      if (!Number.isSafeInteger(alloc.quantity) || alloc.quantity <= 0) {
        throw new CatalogDomainError("INVALID_ALLOCATION_QUANTITY", "allocation quantity must be positive safe integer");
      }
      if (!alloc.orderItemId) throw new CatalogDomainError("ALLOCATION_ORDER_ITEM_REQUIRED", "orderItemId required");
      if (!alloc.sourceRequestId) throw new CatalogDomainError("ALLOCATION_REQUEST_REQUIRED", "sourceRequestId required");
      if (!alloc.allocationId) throw new CatalogDomainError("ALLOCATION_ID_REQUIRED", "allocationId required");
    }

    const existingReservations = await (input.executor as any)
      .select()
      .from(inventoryReservation)
      .where(eq(inventoryReservation.orderId, input.orderId))
      .limit(100);

    if (existingReservations.length > 0) {
      if (existingReservations.length === input.allocations.length) {
        return { reservations: existingReservations, replayed: true };
      }
      const existingAllocIds = new Set(existingReservations.map((r: any) => r.allocationId));
      const allExist = input.allocations.every((a) => existingAllocIds.has(a.allocationId));
      if (allExist) {
        return { reservations: existingReservations, replayed: true };
      }
    }

    const aggregated = new Map<string, { sellerId: string; variantId: string; totalQty: number }>();
    for (const alloc of input.allocations) {
      const key = `${alloc.sellerId}::${alloc.variantId}`;
      const existing = aggregated.get(key);
      if (existing) {
        existing.totalQty += alloc.quantity;
      } else {
        aggregated.set(key, { sellerId: alloc.sellerId, variantId: alloc.variantId, totalQty: alloc.quantity });
      }
    }

    const sortedKeys = Array.from(aggregated.keys()).sort();
    const inventoryMap = new Map<string, typeof productVariantInventory.$inferSelect>();

    for (const key of sortedKeys) {
      const { sellerId, variantId } = aggregated.get(key)!;
      const [inv] = await (input.executor as any)
        .select()
        .from(productVariantInventory)
        .where(and(eq(productVariantInventory.variantId, variantId), eq(productVariantInventory.sellerId, sellerId)))
        .for("update")
        .limit(1);
      if (!inv) {
        throw new CatalogDomainError("INVENTORY_NOT_FOUND", `موجودی برای واریانت ${variantId} فروشنده ${sellerId} یافت نشد`);
      }
      if (inv.status !== "active") {
        throw new CatalogDomainError("INVENTORY_NOT_ACTIVE", `موجودی واریانت ${variantId} فعال نیست`);
      }
      inventoryMap.set(key, inv);
    }

    for (const key of sortedKeys) {
      const { totalQty } = aggregated.get(key)!;
      const inv = inventoryMap.get(key)!;
      const available = calculateAvailable(inv as any);
      if (available < totalQty) {
        throw new CatalogDomainError(
          "INVENTORY_SHORTAGE",
          `موجودی کافی نیست — واریانت ${inv.variantId} فروشنده ${inv.sellerId} در دسترس ${available} مورد نیاز ${totalQty}`,
        );
      }
    }

    const createdReservations: any[] = [];
    const expiresAt = input.expiresAt || null;
    const reservedIncrements = new Map<string, number>();

    for (const alloc of input.allocations) {
      const key = `${alloc.sellerId}::${alloc.variantId}`;
      const inv = inventoryMap.get(key)!;
      const before = { onHand: inv.onHand, reserved: inv.reserved + (reservedIncrements.get(key) || 0) };
      const afterReserved = before.reserved + alloc.quantity;

      if (afterReserved > before.onHand) {
        throw new CatalogDomainError("RESERVED_EXCEEDS_ON_HAND", `رزرو بیش از موجودی واریانت ${alloc.variantId}`);
      }

      const resId = `ires_${randomUUID().replaceAll("-", "")}`;
      const [reservation] = await (input.executor as any)
        .insert(inventoryReservation)
        .values({
          id: resId,
          variantId: alloc.variantId,
          sellerId: alloc.sellerId,
          quantity: alloc.quantity,
          status: "active",
          expiresAt,
          requestId: alloc.sourceRequestId,
          orderId: input.orderId,
          orderItemId: alloc.orderItemId,
          allocationId: alloc.allocationId,
          createdBy: input.requester.userId === "system" ? null : input.requester.userId,
          idempotencyKey: `${input.idempotencyKey}:${alloc.allocationId}`,
        })
        .returning();

      reservedIncrements.set(key, (reservedIncrements.get(key) || 0) + alloc.quantity);
      createdReservations.push(reservation);
    }

    for (const key of sortedKeys) {
      const { sellerId, variantId, totalQty } = aggregated.get(key)!;
      const inv = inventoryMap.get(key)!;
      const before = { onHand: inv.onHand, reserved: inv.reserved };
      const afterReserved = inv.reserved + totalQty;

      await (input.executor as any)
        .update(productVariantInventory)
        .set({ reserved: afterReserved, updatedAt: new Date() })
        .where(eq(productVariantInventory.id, inv.id));

      const __ledgerActor = (input.requester as any).principalType === "system" ? ((input.requester as any).initiatedByUserId || input.requester.userId) : input.requester.userId;
      await (input.executor as any).insert(inventoryLedger).values({
        id: ledgerId(),
        variantId,
        sellerId,
        changeType: "RESERVE",
        quantityDelta: totalQty,
        beforeOnHand: before.onHand,
        afterOnHand: before.onHand,
        beforeReserved: before.reserved,
        afterReserved,
        reason: `order ${input.orderId} reserve ${totalQty} for ${variantId}`,
        actorId: __ledgerActor === "system" ? null : __ledgerActor,
      });
    }

    for (const reservation of createdReservations) {
      const auditActorId = (input.requester as any).principalType === "system" ? ((input.requester as any).initiatedByUserId || input.requester.userId) : input.requester.userId;
      await this.auditService.record(
        {
          actorId: auditActorId === "system" ? null : auditActorId,
          actorRole: input.requester.role === "system" ? "system" : input.requester.role,
          action: "inventory.reserved",
          entityType: "inventory_reservation",
          entityId: reservation.id,
          before: { status: "pending", quantity: reservation.quantity },
          after: { status: "active", quantity: reservation.quantity },
          metadata: {
            variantId: reservation.variantId,
            sellerId: reservation.sellerId,
            orderId: reservation.orderId,
            orderItemId: reservation.orderItemId,
            requestId: reservation.requestId,
            allocationId: reservation.allocationId,
            principalType: (input.requester as any).principalType,
            initiatedByUserId: (input.requester as any).initiatedByUserId,
            operation: (input.requester as any).operation,
          },
          requestId: reservation.requestId || null,
        },
        input.executor as any,
      );
    }

    const uniqueSellers = Array.from(new Set(input.allocations.map((a) => a.sellerId))).sort();
    for (const sellerId of uniqueSellers) {
      const reqHash = hashRequest({ orderId: input.orderId, sellerId, allocations: input.allocations.filter((a) => a.sellerId === sellerId) });
      const idemKey = `${input.idempotencyKey}:${sellerId}`;
      try {
        await (input.executor as any).insert(commandIdempotency).values({
          id: idempotencyId(),
          scopeType: "seller",
          scopeId: sellerId,
          commandType: "inventory.reserve",
          idempotencyKey: idemKey,
          requestHash: reqHash,
          state: "completed",
          resultResourceId: input.orderId,
          resultPayload: { orderId: input.orderId, sellerId, count: input.allocations.filter((a) => a.sellerId === sellerId).length } as any,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: new Date(),
        });
      } catch (e: any) {
        if (e?.code === "23505") {
          // Verify hash matches existing
          const [existing] = await (input.executor as any)
            .select()
            .from(commandIdempotency)
            .where(
              and(
                eq(commandIdempotency.scopeType, "seller"),
                eq(commandIdempotency.scopeId, sellerId),
                eq(commandIdempotency.commandType, "inventory.reserve"),
                eq(commandIdempotency.idempotencyKey, idemKey),
              ),
            )
            .limit(1);
          if (existing && existing.requestHash !== reqHash) {
            throw new CatalogDomainError("IDEMPOTENCY_KEY_REUSED", `inventory idempotency conflict for seller ${sellerId}`);
          }
          // Same hash → safe replay, continue
          continue;
        }
        throw e;
      }
    }

    return { reservations: createdReservations, replayed: false };
  }

  // ── Phase 4.4 — Child order confirm/release (isolated) ───────────────────
  async confirmChildOrderAllocations(input: {
    orderId: string;
    childOrderId: string;
    sellerId: string;
    orderItemIds?: string[];
    requester: Requester;
    idempotencyKey: string;
    executor: DbOrTx;
  }) {
    if (!input.childOrderId) throw new CatalogDomainError("CHILD_ORDER_ID_REQUIRED", "childOrderId required");
    if (!input.sellerId) throw new CatalogDomainError("SELLER_ID_REQUIRED", "sellerId required");
    if (!input.idempotencyKey) throw new CatalogDomainError("IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey required");

    const requestHash = hashRequest({
      orderId: input.orderId,
      childOrderId: input.childOrderId,
      sellerId: input.sellerId,
      orderItemIds: input.orderItemIds?.slice().sort() || [],
    });

    const scopeType = "seller";
    const scopeId = input.sellerId;
    const commandType = "inventory.confirm_child";
    const idempotencyKey = input.idempotencyKey;
    const tx = input.executor as any;

    const claim = await this.claimIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey, requestHash);
    if (claim.isReplay && claim.existing) {
      const payload = claim.existing.resultPayload as any;
      if (payload) return { ...payload, replayed: true };
      const existing = await tx
        .select()
        .from(inventoryReservation)
        .where(and(eq(inventoryReservation.childOrderId, input.childOrderId), eq(inventoryReservation.sellerId, input.sellerId)));
      const allConfirmed = existing.every((r: any) => r.status === "confirmed");
      if (allConfirmed && existing.length > 0) {
        return { reservations: existing, consumed: existing.length, replayed: true };
      }
    }

    try {
      const reservations = await tx
        .select()
        .from(inventoryReservation)
        .where(and(eq(inventoryReservation.childOrderId, input.childOrderId), eq(inventoryReservation.sellerId, input.sellerId)))
        .orderBy(inventoryReservation.variantId)
        .for("update");

      if (reservations.length === 0) {
        await this.completeIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey, input.childOrderId, {
          childOrderId: input.childOrderId,
          consumed: 0,
          reservations: [],
        });
        return { reservations: [], consumed: 0, replayed: false };
      }

      let filtered = reservations;
      if (input.orderItemIds && input.orderItemIds.length > 0) {
        const idSet = new Set(input.orderItemIds);
        filtered = reservations.filter((r: any) => idSet.has(r.orderItemId));
      }

      const allConfirmed = filtered.every((r: any) => r.status === "confirmed");
      if (allConfirmed) {
        await this.completeIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey, input.childOrderId, {
          childOrderId: input.childOrderId,
          consumed: filtered.length,
          reservations: filtered,
        });
        return { reservations: filtered, consumed: filtered.length, replayed: true };
      }

      for (const r of filtered) {
        if (r.status !== "active") {
          if (r.status === "confirmed") continue;
          throw new CatalogDomainError(
            "RESERVATION_NOT_ACTIVE",
            `Reservation ${r.id} status ${r.status} not active for confirm`,
          );
        }
      }

      const agg = new Map<string, { sellerId: string; variantId: string; totalQty: number }>();
      for (const r of filtered) {
        if (r.status !== "active") continue;
        const key = `${r.sellerId}::${r.variantId}`;
        const ex = agg.get(key);
        if (ex) ex.totalQty += r.quantity;
        else agg.set(key, { sellerId: r.sellerId, variantId: r.variantId, totalQty: r.quantity });
      }

      const sortedKeys = Array.from(agg.keys()).sort();
      const inventoryMap = new Map<string, any>();
      for (const key of sortedKeys) {
        const { sellerId, variantId } = agg.get(key)!;
        const [inv] = await tx
          .select()
          .from(productVariantInventory)
          .where(and(eq(productVariantInventory.variantId, variantId), eq(productVariantInventory.sellerId, sellerId)))
          .for("update")
          .limit(1);
        if (!inv) throw new NotFoundError(`موجودی برای واریانت ${variantId} یافت نشد`);
        inventoryMap.set(key, inv);
      }

      for (const key of sortedKeys) {
        const { totalQty } = agg.get(key)!;
        const inv = inventoryMap.get(key)!;
        if (inv.onHand < totalQty) {
          throw new CatalogDomainError("ON_HAND_UNDERFLOW", `on_hand ${inv.onHand} < confirm ${totalQty}`);
        }
        if (inv.reserved < totalQty) {
          throw new CatalogDomainError("RESERVED_UNDERFLOW", `reserved ${inv.reserved} < confirm ${totalQty}`);
        }
      }

      const confirmedReservations: any[] = [];
      for (const key of sortedKeys) {
        const { sellerId, variantId, totalQty } = agg.get(key)!;
        const inv = inventoryMap.get(key)!;
        const before = { onHand: inv.onHand, reserved: inv.reserved };
        const afterOnHand = inv.onHand - totalQty;
        const afterReserved = inv.reserved - totalQty;

        await tx
          .update(productVariantInventory)
          .set({ onHand: afterOnHand, reserved: afterReserved, updatedAt: new Date() })
          .where(eq(productVariantInventory.id, inv.id));

        await tx.insert(inventoryLedger).values({
          id: ledgerId(),
          variantId,
          sellerId,
          changeType: "DECREASE",
          quantityDelta: -totalQty,
          beforeOnHand: before.onHand,
          afterOnHand,
          beforeReserved: before.reserved,
          afterReserved,
          reason: `confirm child ${input.childOrderId} order ${input.orderId}`,
          actorId: input.requester.userId === "system" ? null : input.requester.userId,
        });

        inventoryMap.set(key, { ...inv, onHand: afterOnHand, reserved: afterReserved });
      }

      for (const r of filtered) {
        if (r.status !== "active") continue;
        const [updated] = await tx
          .update(inventoryReservation)
          .set({ status: "confirmed", updatedAt: new Date() })
          .where(eq(inventoryReservation.id, r.id))
          .returning();
        confirmedReservations.push(updated);

        await this.auditService.record(
          {
            actorId: input.requester.userId === "system" ? null : input.requester.userId,
            actorRole: input.requester.role,
            action: "inventory.confirmed",
            entityType: "inventory_reservation",
            entityId: r.id,
            before: { status: r.status, quantity: r.quantity },
            after: { status: "confirmed", quantity: r.quantity },
            metadata: {
              childOrderId: input.childOrderId,
              orderId: input.orderId,
              sellerId: input.sellerId,
              variantId: r.variantId,
            },
            requestId: r.requestId || null,
          },
          tx,
        );
      }

      const result = {
        childOrderId: input.childOrderId,
        orderId: input.orderId,
        consumed: confirmedReservations.length,
        reservations: confirmedReservations,
      };
      await this.completeIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey, input.childOrderId, result);
      return { ...result, replayed: false };
    } catch (e) {
      await this.failIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey);
      throw e;
    }
  }

  async releaseChildOrderAllocations(input: {
    orderId: string;
    childOrderId: string;
    sellerId: string;
    requester: Requester;
    idempotencyKey: string;
    executor: DbOrTx;
    reason?: string;
  }) {
    if (!input.childOrderId) throw new CatalogDomainError("CHILD_ORDER_ID_REQUIRED", "childOrderId required");
    if (!input.sellerId) throw new CatalogDomainError("SELLER_ID_REQUIRED", "sellerId required");
    if (!input.idempotencyKey) throw new CatalogDomainError("IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey required");

    const requestHash = hashRequest({
      orderId: input.orderId,
      childOrderId: input.childOrderId,
      sellerId: input.sellerId,
      reason: input.reason,
    });

    const scopeType = "seller";
    const scopeId = input.sellerId;
    const commandType = "inventory.release_child";
    const idempotencyKey = input.idempotencyKey;
    const tx = input.executor as any;

    const claim = await this.claimIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey, requestHash);
    if (claim.isReplay && claim.existing) {
      const payload = claim.existing.resultPayload as any;
      if (payload) return { ...payload, replayed: true };
      const existing = await tx
        .select()
        .from(inventoryReservation)
        .where(and(eq(inventoryReservation.childOrderId, input.childOrderId), eq(inventoryReservation.sellerId, input.sellerId)));
      const allReleased = existing.every((r: any) => ["released", "expired", "cancelled"].includes(r.status));
      if (allReleased) {
        return { reservations: existing, released: existing.length, replayed: true };
      }
    }

    try {
      const reservations = await tx
        .select()
        .from(inventoryReservation)
        .where(and(eq(inventoryReservation.childOrderId, input.childOrderId), eq(inventoryReservation.sellerId, input.sellerId)))
        .orderBy(inventoryReservation.variantId)
        .for("update");

      if (reservations.length === 0) {
        await this.completeIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey, input.childOrderId, {
          childOrderId: input.childOrderId,
          released: 0,
          reservations: [],
        });
        return { reservations: [], released: 0, replayed: false };
      }

      const activeReservations = reservations.filter((r: any) => r.status === "active");
      const nonActiveConfirmed = reservations.filter((r: any) => r.status === "confirmed");

      if (nonActiveConfirmed.length > 0) {
        throw new CatalogDomainError(
          "RESERVATION_ALREADY_CONFIRMED",
          `Cannot release confirmed reservations for child ${input.childOrderId} — dispatch already occurred`,
        );
      }

      if (activeReservations.length === 0) {
        await this.completeIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey, input.childOrderId, {
          childOrderId: input.childOrderId,
          released: reservations.length,
          reservations,
        });
        return { reservations, released: reservations.length, replayed: true };
      }

      const agg = new Map<string, { sellerId: string; variantId: string; totalQty: number }>();
      for (const r of activeReservations) {
        const key = `${r.sellerId}::${r.variantId}`;
        const ex = agg.get(key);
        if (ex) ex.totalQty += r.quantity;
        else agg.set(key, { sellerId: r.sellerId, variantId: r.variantId, totalQty: r.quantity });
      }

      const sortedKeys = Array.from(agg.keys()).sort();
      const inventoryMap = new Map<string, any>();
      for (const key of sortedKeys) {
        const { sellerId, variantId } = agg.get(key)!;
        const [inv] = await tx
          .select()
          .from(productVariantInventory)
          .where(and(eq(productVariantInventory.variantId, variantId), eq(productVariantInventory.sellerId, sellerId)))
          .for("update")
          .limit(1);
        if (!inv) throw new NotFoundError(`موجودی برای واریانت ${variantId} یافت نشد`);
        inventoryMap.set(key, inv);
      }

      const releasedReservations: any[] = [];

      for (const key of sortedKeys) {
        const { sellerId, variantId, totalQty } = agg.get(key)!;
        const inv = inventoryMap.get(key)!;
        const before = { onHand: inv.onHand, reserved: inv.reserved };
        const afterReserved = inv.reserved - totalQty;
        if (afterReserved < 0) {
          throw new CatalogDomainError("RESERVED_UNDERFLOW", `release would underflow reserved ${inv.reserved} < ${totalQty}`);
        }

        await tx
          .update(productVariantInventory)
          .set({ reserved: afterReserved, updatedAt: new Date() })
          .where(eq(productVariantInventory.id, inv.id));

        await tx.insert(inventoryLedger).values({
          id: ledgerId(),
          variantId,
          sellerId,
          changeType: "RELEASE",
          quantityDelta: -totalQty,
          beforeOnHand: before.onHand,
          afterOnHand: before.onHand,
          beforeReserved: before.reserved,
          afterReserved,
          reason: input.reason || `release child ${input.childOrderId} order ${input.orderId}`,
          actorId: input.requester.userId === "system" ? null : input.requester.userId,
        });

        inventoryMap.set(key, { ...inv, reserved: afterReserved });
      }

      for (const r of activeReservations) {
        const [updated] = await tx
          .update(inventoryReservation)
          .set({ status: "released", updatedAt: new Date() })
          .where(eq(inventoryReservation.id, r.id))
          .returning();
        releasedReservations.push(updated);

        await this.auditService.record(
          {
            actorId: input.requester.userId === "system" ? null : input.requester.userId,
            actorRole: input.requester.role,
            action: "inventory.released",
            entityType: "inventory_reservation",
            entityId: r.id,
            before: { status: r.status, quantity: r.quantity },
            after: { status: "released", quantity: r.quantity },
            metadata: {
              childOrderId: input.childOrderId,
              orderId: input.orderId,
              sellerId: input.sellerId,
              variantId: r.variantId,
              reason: input.reason,
            },
            requestId: r.requestId || null,
          },
          tx,
        );
      }

      const result = {
        childOrderId: input.childOrderId,
        orderId: input.orderId,
        released: releasedReservations.length,
        reservations: releasedReservations,
      };
      await this.completeIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey, input.childOrderId, result);
      return { ...result, replayed: false };
    } catch (e) {
      await this.failIdempotency(tx, scopeType, scopeId, commandType, idempotencyKey);
      throw e;
    }
  }
}

