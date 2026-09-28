import { Inject, Injectable, forwardRef } from "@nestjs/common";
import { sql, eq, and, desc, inArray } from "drizzle-orm";
import { randomUUID, createHash } from "node:crypto";
import { basisPoints } from "@kolbe/shared";
import {
  settlementAccount,
  settlementJournal,
  settlementPosting,
  commissionPolicy,
  commissionSnapshot,
  shippingEconomicsPolicy,
  settlementHoldPolicy,
  settlementHold,
  settlementBatch,
  settlementBatchItem,
  withdrawalRequest,
  payout,
  payoutProviderEvent,
  settlementReconciliationRun,
  settlementAdjustment,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { SuppliersService } from "../suppliers/suppliers.service";
import { SupplierComplianceService } from "../compliance/supplier-compliance.service";
import { OrdersService } from "../orders/orders.service";
import { PaymentsService } from "../payments/payments.service";
import { ShippingService } from "../shipping/shipping.service";
import { InvoicingService } from "../invoicing/invoicing.service";
import { PayoutProviderRegistry } from "./payout-provider.registry";
import { PayoutTransferResult } from "./payout-provider.interface";
import {
  SettlementAccountSummary,
  SettlementPostingInput,
  CreateJournalInput,
  SettlementHistoryItem,
  CreateCommissionPolicyInput,
  CommissionPolicyView,
  CommissionPolicySnapshot,
  UpsertShippingEconomicsInput,
  ShippingEconomicsView,
  CreateHoldPolicyInput,
  SettlementHoldPolicyView,
  PlaceHoldInput,
  ReleaseHoldInput,
  SettlementHoldView,
  BatchReleaseInput,
  SettlementBatchView,
  ProcessEarningsResult,
  WithdrawalRequestView,
  PayoutView,
} from "./settlement.contract";
import { SettlementDomainError } from "./settlement.errors";

type DbOrTx = KolbeDatabase | Parameters<Parameters<KolbeDatabase["transaction"]>[0]>[0];

function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

@Injectable()
export class SettlementService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
    @Inject(forwardRef(() => SupplierComplianceService))
    private readonly supplierCompliance: SupplierComplianceService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(ShippingService) private readonly shipping: ShippingService,
    @Inject(InvoicingService) private readonly invoicing: InvoicingService,
    @Inject(PayoutProviderRegistry) private readonly payoutRegistry: PayoutProviderRegistry,
  ) {}

  private async withExecutor<T>(executor: DbOrTx | undefined, work: (tx: DbOrTx) => Promise<T>): Promise<T> {
    if (executor) return work(executor);
    return this.db.transaction(async (tx) => work(tx as any));
  }

  async getDbNow(tx?: DbOrTx): Promise<Date> {
    const executor = tx || this.db;
    const result = await (executor as any).execute(sql`SELECT NOW() as now`);
    const nowVal = (result as any).rows?.[0]?.now || (result as any)[0]?.now;
    return new Date(nowVal);
  }

  /**
   * تأیید اینکه طرف حساب تأمین‌کننده کلبه (first-party) نیست.
   * کلبه هرگز مشمول حساب پرداختنی تأمین‌کننده خارجی، کمیسیون، یا تسویه نمی‌شود.
   */
  async assertKolbeExcluded(supplierId: string | null | undefined, sellerId?: string | null): Promise<void> {
    if (!supplierId) {
      throw new SettlementDomainError(
        "KOLBE_EXCLUDED_FROM_SUPPLIER_PAYABLE",
        "کلبه تأمین‌کننده خارجی نیست و مشمول تسویه‌حساب تأمین‌کننده نمی‌شود",
        400,
      );
    }
    if (sellerId && (sellerId === "seller_kolbe" || sellerId.includes("kolbe"))) {
      throw new SettlementDomainError(
        "KOLBE_EXCLUDED_FROM_SUPPLIER_PAYABLE",
        "فروشنده کلبه اول‌شخص است و مشمول تسویه‌حساب تأمین‌کننده خارجی نمی‌شود",
        400,
      );
    }
  }

  /**
   * دریافت یا ایجاد حساب دفتر معین تسویه‌حساب.
   * حساب‌های اختصاصی تأمین‌کننده الزاماً باید دارای supplier_id باشند و برای کلبه ایجاد نمی‌شوند.
   */
  async getOrCreateAccount(
    executor: DbOrTx,
    input: {
      accountType: string;
      supplierId?: string | null;
      sellerId?: string | null;
      childOrderId?: string | null;
      currency?: string;
    },
  ): Promise<typeof settlementAccount.$inferSelect> {
    const tx = executor as any;
    const currency = input.currency || "IRR";

    if (currency !== "IRR") {
      throw new SettlementDomainError("SETTLEMENT_CURRENCY_MISMATCH", "تنها ارز مجاز IRR است");
    }

    const supplierAccounts = new Set([
      "SUPPLIER_PENDING_PAYABLE",
      "SUPPLIER_AVAILABLE_PAYABLE",
      "SUPPLIER_HOLD",
      "SUPPLIER_RECOVERY",
      "PAYOUT_CLEARING",
    ]);

    if (supplierAccounts.has(input.accountType)) {
      if (!input.supplierId) {
        throw new SettlementDomainError(
          "KOLBE_EXCLUDED_FROM_SUPPLIER_PAYABLE",
          "حساب پرداختنی تأمین‌کننده نیازمند شناسه تأمین‌کننده خارجی معتبر است",
        );
      }
      await this.assertKolbeExcluded(input.supplierId, input.sellerId);
    }

    if (input.supplierId) {
      const [existing] = await tx
        .select()
        .from(settlementAccount)
        .where(
          and(
            eq(settlementAccount.supplierId, input.supplierId),
            eq(settlementAccount.accountType, input.accountType),
            eq(settlementAccount.currency, currency),
          ),
        )
        .limit(1);

      if (existing) return existing;
    } else if (input.childOrderId) {
      const [existing] = await tx
        .select()
        .from(settlementAccount)
        .where(
          and(
            eq(settlementAccount.childOrderId, input.childOrderId),
            eq(settlementAccount.accountType, input.accountType),
            eq(settlementAccount.currency, currency),
          ),
        )
        .limit(1);

      if (existing) return existing;
    } else {
      const [existing] = await tx
        .select()
        .from(settlementAccount)
        .where(
          and(
            sql`"supplier_id" IS NULL`,
            sql`"child_order_id" IS NULL`,
            eq(settlementAccount.accountType, input.accountType),
            eq(settlementAccount.currency, currency),
          ),
        )
        .limit(1);

      if (existing) return existing;
    }

    const id = `sacc_${randomUUID().replace(/-/g, "")}`;
    const [created] = await tx
      .insert(settlementAccount)
      .values({
        id,
        accountType: input.accountType,
        supplierId: input.supplierId ?? null,
        sellerId: input.sellerId ?? null,
        childOrderId: input.childOrderId ?? null,
        currency,
        status: "active",
      })
      .onConflictDoNothing()
      .returning();

    if (created) return created;

    if (input.supplierId) {
      const [existing] = await tx
        .select()
        .from(settlementAccount)
        .where(
          and(
            eq(settlementAccount.supplierId, input.supplierId),
            eq(settlementAccount.accountType, input.accountType),
            eq(settlementAccount.currency, currency),
          ),
        )
        .limit(1);

      if (existing) return existing;
    } else if (input.childOrderId) {
      const [existing] = await tx
        .select()
        .from(settlementAccount)
        .where(
          and(
            eq(settlementAccount.childOrderId, input.childOrderId),
            eq(settlementAccount.accountType, input.accountType),
            eq(settlementAccount.currency, currency),
          ),
        )
        .limit(1);

      if (existing) return existing;
    } else {
      const [existing] = await tx
        .select()
        .from(settlementAccount)
        .where(
          and(
            sql`"supplier_id" IS NULL`,
            sql`"child_order_id" IS NULL`,
            eq(settlementAccount.accountType, input.accountType),
            eq(settlementAccount.currency, currency),
          ),
        )
        .limit(1);

      if (existing) return existing;
    }

    throw new SettlementDomainError("SETTLEMENT_ACCOUNT_NOT_FOUND", "خطا در ایجاد یا بازیابی حساب تسویه");
  }

  /**
   * ثبت سند حسابداری دوطرفه متوازن در دفتر معین تسویه.
   * 1. مجموع بدهکار = مجموع بستانکار = totalAmount
   * 2. مبالغ همگی صحیح و بزرگتر از صفر (> 0)
   * 3. رویداد مبدأ کاملاً قطعی و غیرتکراری (idempotent بر اساس sourceEventType + sourceEventId)
   * 4. سند و سطرهای آن فقط-افزودنی (append-only) هستند.
   */
  async postJournalInTx(
    executor: DbOrTx,
    input: CreateJournalInput,
  ): Promise<{
    journal: typeof settlementJournal.$inferSelect;
    postings: (typeof settlementPosting.$inferSelect)[];
    replayed: boolean;
  }> {
    const tx = executor as any;
    const currency = input.currency || "IRR";

    if (currency !== "IRR") {
      throw new SettlementDomainError("SETTLEMENT_CURRENCY_MISMATCH", "تنها ارز مجاز IRR است");
    }

    if (input.totalAmount <= 0n) {
      throw new SettlementDomainError("SETTLEMENT_POSTING_INVALID", "مبلغ سند باید بزرگتر از صفر باشد");
    }

    const [existingJournal] = await tx
      .select()
      .from(settlementJournal)
      .where(
        and(
          eq(settlementJournal.sourceEventType, input.sourceEventType),
          eq(settlementJournal.sourceEventId, input.sourceEventId),
        ),
      )
      .limit(1);

    if (existingJournal) {
      const existingPostings = await tx
        .select()
        .from(settlementPosting)
        .where(eq(settlementPosting.journalId, existingJournal.id));
      return { journal: existingJournal, postings: existingPostings, replayed: true };
    }

    let sumDebits = 0n;
    let sumCredits = 0n;

    for (const p of input.postings) {
      if (p.amount <= 0n) {
        throw new SettlementDomainError("SETTLEMENT_POSTING_INVALID", "مبلغ هر ردیف سند باید بزرگتر از صفر باشد");
      }
      if (p.direction === "DEBIT") {
        sumDebits += p.amount;
      } else if (p.direction === "CREDIT") {
        sumCredits += p.amount;
      } else {
        throw new SettlementDomainError("SETTLEMENT_POSTING_INVALID", "جهت سند باید DEBIT یا CREDIT باشد");
      }
    }

    if (sumDebits !== sumCredits || sumDebits !== input.totalAmount) {
      throw new SettlementDomainError(
        "SETTLEMENT_JOURNAL_UNBALANCED",
        `سند تسویه متوازن نیست: بدهکار (${sumDebits}) != بستانکار (${sumCredits}) یا != کل (${input.totalAmount})`,
      );
    }

    const journalId = `sjn_${randomUUID().replace(/-/g, "")}`;
    const [journal] = await tx
      .insert(settlementJournal)
      .values({
        id: journalId,
        journalType: input.journalType,
        sourceEventType: input.sourceEventType,
        sourceEventId: input.sourceEventId,
        childOrderId: input.childOrderId ?? null,
        orderItemId: input.orderItemId ?? null,
        supplierId: input.supplierId ?? null,
        currency,
        totalAmount: input.totalAmount,
        snapshotData: input.snapshotData ?? {},
        postedBy: input.postedBy ?? null,
        reason: input.reason ?? null,
        effectiveAt: input.effectiveAt ?? new Date(),
      })
      .returning();

    const postingValues = input.postings.map((p) => ({
      id: `spst_${randomUUID().replace(/-/g, "")}`,
      journalId,
      accountId: p.accountId,
      direction: p.direction,
      amount: p.amount,
      currency,
    }));

    const postings = await tx.insert(settlementPosting).values(postingValues).returning();

    return { journal, postings, replayed: false };
  }

  /**
   * محاسبه ماندهٔ مشتق‌شده از سطور دفتر معین (Derived Balance).
   */
  async getAccountBalance(executor: DbOrTx, accountId: string): Promise<bigint> {
    const tx = executor as any;
    const result = await tx.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END), 0) AS balance
      FROM settlement_posting
      WHERE account_id = ${accountId}
    `);
    const raw = (result as any).rows?.[0]?.balance ?? (result as any)[0]?.balance;
    return BigInt(raw ?? "0");
  }

  /**
   * محاسبه ماندهٔ بازیافت و انتقال منفی (Recovery / Negative Carry-forward).
   * حساب بازیافت ماهیت بدهکار دارد: مبلغ بدهی = مجموع بدهکار منهای بستانکار.
   */
  async getRecoveryBalance(executor: DbOrTx, accountId: string): Promise<bigint> {
    const tx = executor as any;
    const result = await tx.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END), 0) AS balance
      FROM settlement_posting
      WHERE account_id = ${accountId}
    `);
    const raw = (result as any).rows?.[0]?.balance ?? (result as any)[0]?.balance;
    const bal = BigInt(raw ?? "0");
    return bal > 0n ? bal : 0n;
  }

  /**
   * محاسبه خلاصه وضعیت حساب مالی تأمین‌کننده از روی سطرهای دفتر معین.
   */
  async getSupplierSummary(supplierId: string, executor?: DbOrTx): Promise<SettlementAccountSummary> {
    await this.assertKolbeExcluded(supplierId);

    return this.withExecutor(executor, async (tx: any) => {
      const accounts = await tx
        .select()
        .from(settlementAccount)
        .where(
          and(
            eq(settlementAccount.supplierId, supplierId),
            eq(settlementAccount.currency, "IRR"),
          ),
        );

      const accountMap = new Map<string, string>();
      for (const a of accounts) {
        accountMap.set(a.accountType, a.id);
      }

      const pendingAccountId = accountMap.get("SUPPLIER_PENDING_PAYABLE");
      const availableAccountId = accountMap.get("SUPPLIER_AVAILABLE_PAYABLE");
      const holdAccountId = accountMap.get("SUPPLIER_HOLD");
      const payoutClearingAccountId = accountMap.get("PAYOUT_CLEARING");
      const recoveryAccountId = accountMap.get("SUPPLIER_RECOVERY");

      const pendingBal = pendingAccountId ? await this.getAccountBalance(tx, pendingAccountId) : 0n;
      const availableBal = availableAccountId ? await this.getAccountBalance(tx, availableAccountId) : 0n;
      const holdBal = holdAccountId ? await this.getAccountBalance(tx, holdAccountId) : 0n;
      const payoutPendingBal = payoutClearingAccountId ? await this.getAccountBalance(tx, payoutClearingAccountId) : 0n;
      const recoveryBal = recoveryAccountId ? await this.getRecoveryBalance(tx, recoveryAccountId) : 0n;

      const settledRes = await tx.execute(sql`
        SELECT COALESCE(SUM(amount), 0) as settled
        FROM payout
        WHERE supplier_id = ${supplierId} AND status = 'succeeded'
      `);
      const settledRaw = (settledRes as any).rows?.[0]?.settled ?? (settledRes as any)[0]?.settled;
      const settledAmount = BigInt(settledRaw ?? "0");

      const netAvailable = availableBal > recoveryBal ? availableBal - recoveryBal : 0n;

      return {
        supplierId,
        currency: "IRR",
        pendingEarnings: (pendingBal > 0n ? pendingBal : 0n).toString(),
        availableForSettlement: netAvailable.toString(),
        amountOnHold: (holdBal > 0n ? holdBal : 0n).toString(),
        settlementPending: (payoutPendingBal > 0n ? payoutPendingBal : 0n).toString(),
        settledAmount: settledAmount.toString(),
        recoveryAmount: (recoveryBal > 0n ? recoveryBal : 0n).toString(),
      };
    });
  }

  /**
   * نمایش تاریخچه تراکنش‌های مالی تأمین‌کننده به زبان کسب‌وکار.
   */
  async listSupplierHistory(
    supplierId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<SettlementHistoryItem[]> {
    await this.assertKolbeExcluded(supplierId);

    const limit = Math.min(options.limit ?? 50, 100);
    const offset = options.offset ?? 0;

    const rows = await this.db
      .select()
      .from(settlementJournal)
      .where(eq(settlementJournal.supplierId, supplierId))
      .orderBy(desc(settlementJournal.effectiveAt), desc(settlementJournal.createdAt))
      .limit(limit)
      .offset(offset);

    const mapUserFacingType = (journalType: string): string => {
      switch (journalType) {
        case "ENTITLEMENT":
          return "earning_pending";
        case "AVAILABILITY":
          return "earning_available";
        case "COMMISSION":
          return "platform_fee";
        case "HOLD_PLACED":
          return "hold_placed";
        case "HOLD_RELEASED":
          return "hold_released";
        case "REFUND_ADJUSTMENT":
          return "refund_adjustment";
        case "POST_SETTLEMENT_ADJUSTMENT":
          return "recovery";
        case "WITHDRAWAL_RESERVED":
          return "withdrawal_reserved";
        case "PAYOUT_SETTLED":
          return "payout_succeeded";
        case "PAYOUT_REVERSED":
          return "payout_failed_released";
        case "MANUAL_ADJUSTMENT":
          return "manual_adjustment";
        case "RECOVERY_OFFSET":
          return "recovery_offset";
        default:
          return journalType.toLowerCase();
      }
    };

    return rows.map((r) => ({
      id: r.id,
      journalType: r.journalType,
      sourceEventType: r.sourceEventType,
      sourceEventId: r.sourceEventId,
      childOrderId: r.childOrderId,
      orderItemId: r.orderItemId,
      supplierId: r.supplierId,
      currency: r.currency,
      totalAmount: r.totalAmount.toString(),
      userFacingEventType: mapUserFacingType(r.journalType),
      reason: r.reason,
      effectiveAt: r.effectiveAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ───────────────────────── Checkpoint B: Commission Policies & Snapshots ─────────────────────────

  async createCommissionPolicy(
    input: CreateCommissionPolicyInput,
    tx?: DbOrTx,
  ): Promise<CommissionPolicyView> {
    return this.withExecutor(tx, async (db) => {
      const id = `cpol_${randomUUID().replace(/-/g, "")}`;
      const [row] = await (db as any)
        .insert(commissionPolicy)
        .values({
          id,
          policyVersion: input.policyVersion,
          name: input.name,
          basis: input.basis,
          rateBps: input.rateBps,
          fixedAmount: input.fixedAmount ?? 0n,
          roundingMode: input.roundingMode ?? "HALF_UP",
          status: input.status ?? "active",
          effectiveAt: input.effectiveAt ?? new Date(),
        })
        .returning();

      return {
        id: row.id,
        policyVersion: row.policyVersion,
        name: row.name,
        basis: row.basis,
        rateBps: row.rateBps,
        fixedAmount: row.fixedAmount.toString(),
        roundingMode: row.roundingMode,
        status: row.status,
        effectiveAt: row.effectiveAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async getActiveCommissionPolicy(tx?: DbOrTx): Promise<typeof commissionPolicy.$inferSelect> {
    return this.withExecutor(tx, async (db) => {
      const [row] = await (db as any)
        .select()
        .from(commissionPolicy)
        .where(eq(commissionPolicy.status, "active"))
        .orderBy(desc(commissionPolicy.policyVersion))
        .limit(1);

      if (row) return row;

      return {
        id: "cpol_default_zero",
        policyVersion: 1,
        name: "Default Zero Commission",
        basis: "MERCHANDISE_ENTITLED_NET",
        rateBps: 0,
        fixedAmount: 0n,
        roundingMode: "HALF_UP",
        status: "active",
        effectiveAt: new Date(0),
        createdAt: new Date(0),
      };
    });
  }

  async getOrSnapshotCommissionPolicy(
    childOrderId: string,
    tx: DbOrTx,
  ): Promise<CommissionPolicySnapshot> {
    const db = tx as any;
    const [existing] = await db
      .select()
      .from(commissionSnapshot)
      .where(eq(commissionSnapshot.childOrderId, childOrderId))
      .limit(1);

    if (existing) {
      return {
        policyId: existing.policyId,
        policyVersion: existing.policyVersion,
        basis: existing.basis,
        rateBps: existing.rateBps,
        fixedAmount: existing.fixedAmount,
        roundingMode: existing.roundingMode as "HALF_UP" | "DOWN",
      };
    }

    const activePolicy = await this.getActiveCommissionPolicy(tx);

    if (activePolicy.id === "cpol_default_zero") {
      const [persisted] = await db
        .insert(commissionPolicy)
        .values(activePolicy)
        .onConflictDoNothing()
        .returning();
      if (persisted) activePolicy.id = persisted.id;
    }

    const snapshotId = `cpos_${randomUUID().replace(/-/g, "")}`;
    const [snap] = await db
      .insert(commissionSnapshot)
      .values({
        id: snapshotId,
        childOrderId,
        policyId: activePolicy.id,
        policyVersion: activePolicy.policyVersion,
        basis: activePolicy.basis,
        rateBps: activePolicy.rateBps,
        fixedAmount: activePolicy.fixedAmount,
        roundingMode: activePolicy.roundingMode,
      })
      .onConflictDoNothing()
      .returning();

    if (!snap) {
      const [conflictSnap] = await db
        .select()
        .from(commissionSnapshot)
        .where(eq(commissionSnapshot.childOrderId, childOrderId))
        .limit(1);
      return {
        policyId: conflictSnap.policyId,
        policyVersion: conflictSnap.policyVersion,
        basis: conflictSnap.basis,
        rateBps: conflictSnap.rateBps,
        fixedAmount: conflictSnap.fixedAmount,
        roundingMode: conflictSnap.roundingMode as "HALF_UP" | "DOWN",
      };
    }

    return {
      policyId: snap.policyId,
      policyVersion: snap.policyVersion,
      basis: snap.basis,
      rateBps: snap.rateBps,
      fixedAmount: snap.fixedAmount,
      roundingMode: snap.roundingMode as "HALF_UP" | "DOWN",
    };
  }

  // ───────────────────────── Checkpoint B: Shipping Economics ─────────────────────────

  async upsertShippingEconomics(
    input: UpsertShippingEconomicsInput,
    tx?: DbOrTx,
  ): Promise<ShippingEconomicsView> {
    return this.withExecutor(tx, async (db) => {
      const id = `seco_${randomUUID().replace(/-/g, "")}`;
      const [row] = await (db as any)
        .insert(shippingEconomicsPolicy)
        .values({
          id,
          childOrderId: input.childOrderId,
          shippingChargeToBuyer: input.shippingChargeToBuyer ?? 0n,
          shippingEconomicRecipient: input.shippingEconomicRecipient,
          shippingCostBearer: input.shippingCostBearer,
          shippingProvider: input.shippingProvider ?? null,
          currency: input.currency ?? "IRR",
          status: input.status ?? "finalized",
        })
        .onConflictDoUpdate({
          target: shippingEconomicsPolicy.childOrderId,
          set: {
            shippingChargeToBuyer: input.shippingChargeToBuyer ?? 0n,
            shippingEconomicRecipient: input.shippingEconomicRecipient,
            shippingCostBearer: input.shippingCostBearer,
            shippingProvider: input.shippingProvider ?? null,
            status: input.status ?? "finalized",
          },
        })
        .returning();

      return {
        id: row.id,
        childOrderId: row.childOrderId,
        shippingChargeToBuyer: row.shippingChargeToBuyer.toString(),
        shippingEconomicRecipient: row.shippingEconomicRecipient,
        shippingCostBearer: row.shippingCostBearer,
        shippingProvider: row.shippingProvider,
        currency: row.currency,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async getShippingEconomics(childOrderId: string, tx?: DbOrTx): Promise<typeof shippingEconomicsPolicy.$inferSelect | null> {
    return this.withExecutor(tx, async (db) => {
      const [row] = await (db as any)
        .select()
        .from(shippingEconomicsPolicy)
        .where(eq(shippingEconomicsPolicy.childOrderId, childOrderId))
        .limit(1);
      return row ?? null;
    });
  }

  // ───────────────────────── Checkpoint B: Hold Policy & Financial Holds ─────────────────────────

  async createHoldPolicy(
    input: CreateHoldPolicyInput,
    tx?: DbOrTx,
  ): Promise<SettlementHoldPolicyView> {
    return this.withExecutor(tx, async (db) => {
      const id = `hpol_${randomUUID().replace(/-/g, "")}`;
      const [row] = await (db as any)
        .insert(settlementHoldPolicy)
        .values({
          id,
          policyVersion: input.policyVersion,
          name: input.name,
          holdDurationDays: input.holdDurationDays,
          status: input.status ?? "active",
          effectiveAt: input.effectiveAt ?? new Date(),
        })
        .returning();

      return {
        id: row.id,
        policyVersion: row.policyVersion,
        name: row.name,
        holdDurationDays: row.holdDurationDays,
        status: row.status,
        effectiveAt: row.effectiveAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async getActiveHoldPolicy(tx?: DbOrTx): Promise<typeof settlementHoldPolicy.$inferSelect> {
    return this.withExecutor(tx, async (db) => {
      const [row] = await (db as any)
        .select()
        .from(settlementHoldPolicy)
        .where(eq(settlementHoldPolicy.status, "active"))
        .orderBy(desc(settlementHoldPolicy.policyVersion))
        .limit(1);

      if (row) return row;

      return {
        id: "hpol_default_seven",
        policyVersion: 1,
        name: "Default 7 Days",
        holdDurationDays: 7,
        status: "active",
        effectiveAt: new Date(0),
        createdAt: new Date(0),
      };
    });
  }

  private mapSettlementHoldView(row: typeof settlementHold.$inferSelect): SettlementHoldView {
    return {
      id: row.id,
      supplierId: row.supplierId,
      childOrderId: row.scope === "CHILD_ORDER" ? row.scopeId : null,
      scope: row.scope,
      reason: row.reason,
      status: row.status,
      amount: row.amount ? row.amount.toString() : null,
      currency: row.currency,
      placedBy: row.placedBy ?? "",
      releasedBy: row.releasedBy,
      notes: row.notes,
      idempotencyKey: row.notes?.startsWith("idem:") ? row.notes.split(" | ")[0].replace("idem:", "") : row.id,
      createdAt: row.createdAt.toISOString(),
      releasedAt: row.releasedAt ? row.releasedAt.toISOString() : null,
    };
  }

  async placeHold(
    input: PlaceHoldInput,
    executor?: DbOrTx,
  ): Promise<SettlementHoldView> {
    await this.assertKolbeExcluded(input.supplierId);

    return this.withExecutor(executor, async (tx: any) => {
      const holdNote = `idem:${input.idempotencyKey}${input.notes ? ` | ${input.notes}` : ""}`;

      const [existing] = await tx
        .select()
        .from(settlementHold)
        .where(
          and(
            eq(settlementHold.supplierId, input.supplierId),
            sql`"notes" LIKE ${`idem:${input.idempotencyKey}%`}`,
          ),
        )
        .limit(1);

      if (existing) {
        return this.mapSettlementHoldView(existing);
      }

      const holdId = `shld_${randomUUID().replace(/-/g, "")}`;
      const amount = input.amount && input.amount > 0n ? input.amount : null;
      const scopeId = input.childOrderId ?? null;

      if (amount) {
        const availableAccount = await this.getOrCreateAccount(tx, {
          accountType: "SUPPLIER_AVAILABLE_PAYABLE",
          supplierId: input.supplierId,
        });
        const holdAccount = await this.getOrCreateAccount(tx, {
          accountType: "SUPPLIER_HOLD",
          supplierId: input.supplierId,
        });

        await tx.execute(sql`SELECT id FROM settlement_account WHERE id = ${availableAccount.id} FOR UPDATE`);
        const availableBalance = await this.getAccountBalance(tx, availableAccount.id);

        if (availableBalance < amount) {
          throw new SettlementDomainError(
            "INSUFFICIENT_AVAILABLE",
            `مانده قابل تسویه (${availableBalance}) کمتر از مبلغ مسدودی (${amount}) است`,
            400,
          );
        }

        const [holdRow] = await tx
          .insert(settlementHold)
          .values({
            id: holdId,
            supplierId: input.supplierId,
            scope: input.scope,
            scopeId,
            reason: input.reason,
            amount,
            currency: "IRR",
            status: "active",
            placedBy: input.placedBy,
            notes: holdNote,
          })
          .returning();

        await this.postJournalInTx(tx, {
          journalType: "HOLD_PLACED",
          sourceEventType: "FinancialHoldPlaced",
          sourceEventId: input.idempotencyKey,
          supplierId: input.supplierId,
          childOrderId: input.childOrderId ?? null,
          totalAmount: amount,
          reason: input.notes ?? `Financial hold placed: ${input.reason}`,
          postedBy: input.placedBy,
          postings: [
            { accountId: availableAccount.id, direction: "DEBIT", amount },
            { accountId: holdAccount.id, direction: "CREDIT", amount },
          ],
        });

        return this.mapSettlementHoldView(holdRow);
      } else {
        const [holdRow] = await tx
          .insert(settlementHold)
          .values({
            id: holdId,
            supplierId: input.supplierId,
            scope: input.scope,
            scopeId,
            reason: input.reason,
            amount: null,
            currency: "IRR",
            status: "active",
            placedBy: input.placedBy,
            notes: holdNote,
          })
          .returning();

        return this.mapSettlementHoldView(holdRow);
      }
    });
  }

  async releaseHold(
    input: ReleaseHoldInput,
    executor?: DbOrTx,
  ): Promise<SettlementHoldView> {
    return this.withExecutor(executor, async (tx: any) => {
      const [hold] = await tx
        .select()
        .from(settlementHold)
        .where(eq(settlementHold.id, input.holdId))
        .limit(1);

      if (!hold) {
        throw new SettlementDomainError("SETTLEMENT_HOLD_NOT_FOUND", "مسدودی مالی یافت نشد", 404);
      }

      if (hold.status === "released") {
        return this.mapSettlementHoldView(hold);
      }

      const now = await this.getDbNow(tx);

      if (hold.amount && hold.amount > 0n) {
        const availableAccount = await this.getOrCreateAccount(tx, {
          accountType: "SUPPLIER_AVAILABLE_PAYABLE",
          supplierId: hold.supplierId,
        });
        const holdAccount = await this.getOrCreateAccount(tx, {
          accountType: "SUPPLIER_HOLD",
          supplierId: hold.supplierId,
        });

        const sourceEventId = input.idempotencyKey || `rel_${hold.id}`;

        await this.postJournalInTx(tx, {
          journalType: "HOLD_RELEASED",
          sourceEventType: "FinancialHoldReleased",
          sourceEventId,
          supplierId: hold.supplierId,
          childOrderId: hold.childOrderId ?? null,
          totalAmount: hold.amount,
          reason: input.notes ?? `Financial hold released: ${hold.reason}`,
          postedBy: input.releasedBy,
          postings: [
            { accountId: holdAccount.id, direction: "DEBIT", amount: hold.amount },
            { accountId: availableAccount.id, direction: "CREDIT", amount: hold.amount },
          ],
        });
      }

      const [updated] = await tx
        .update(settlementHold)
        .set({
          status: "released",
          releasedBy: input.releasedBy,
          releasedAt: now,
          notes: input.notes ? (hold.notes ? `${hold.notes} | ${input.notes}` : input.notes) : hold.notes,
        })
        .where(eq(settlementHold.id, hold.id))
        .returning();

      return this.mapSettlementHoldView(updated);
    });
  }

  async listHoldsForSupplier(supplierId: string, status?: "active" | "released"): Promise<SettlementHoldView[]> {
    await this.assertKolbeExcluded(supplierId);

    const conditions = [eq(settlementHold.supplierId, supplierId)];
    if (status) conditions.push(eq(settlementHold.status, status));

    const rows = await this.db
      .select()
      .from(settlementHold)
      .where(and(...conditions))
      .orderBy(desc(settlementHold.createdAt));

    return rows.map((r) => this.mapSettlementHoldView(r));
  }

  // ───────────────────────── Checkpoint B: Earnings Event Processing ─────────────────────────

  async processChildEarnings(
    childOrderId: string,
    options: { trigger?: string; forcedAsOf?: Date } = {},
    executor?: DbOrTx,
  ): Promise<ProcessEarningsResult> {
    return this.withExecutor(executor, async (tx: any) => {
      const ctx = await this.orders.getChildOrderEconomicContext(childOrderId);
      if (!ctx.child.supplierId || ctx.child.sellerId === "seller_kolbe" || ctx.child.sellerId.includes("kolbe")) {
        return { childOrderId, candidate: false, reason: "KOLBE_FIRST_PARTY", postedJournals: [] };
      }
      if (ctx.child.status === "cancelled") {
        return { childOrderId, candidate: false, reason: "CHILD_CANCELLED", postedJournals: [] };
      }

      const supplierId = ctx.child.supplierId;
      const orderId = ctx.child.wholesaleOrderId!;

      const facts = await this.payments.getChildSettlementFacts({ orderId, childOrderId });
      const activeProforma = facts.proformas.find((p) => p.id === facts.activeProformaId);
      const childPayable = activeProforma ? BigInt(activeProforma.totalAmount) : 0n;
      const allocatedVerified = facts.allocations.reduce((sum, a) => sum + BigInt(a.amount), 0n);
      const isCovered = childPayable > 0n && allocatedVerified >= childPayable;

      if (!isCovered) {
        return {
          childOrderId,
          candidate: true,
          cashCovered: false,
          reason: "PAYMENT_NOT_COLLECTED",
          postedJournals: [],
        };
      }

      const deliveredByItem = await this.shipping.getAllocatedQuantitiesForChild(childOrderId, tx, ["delivered"]);
      const shipments = await this.shipping.listShipmentsForChild(childOrderId);
      const deliveredShipments = shipments.filter((s: any) => String(s.status) === "delivered");

      if (deliveredShipments.length === 0) {
        return {
          childOrderId,
          candidate: true,
          cashCovered: true,
          reason: "NO_DELIVERED_SHIPMENTS",
          postedJournals: [],
        };
      }

      const clearingAccount = await this.getOrCreateAccount(tx, { accountType: "PLATFORM_COLLECTION_CLEARING" });
      const supplierPendingAccount = await this.getOrCreateAccount(tx, { accountType: "SUPPLIER_PENDING_PAYABLE", supplierId });
      const platformFeeAccount = await this.getOrCreateAccount(tx, { accountType: "PLATFORM_FEE" });

      const postedJournals: string[] = [];
      let totalEntitledDelta = 0n;
      let totalCommissionDelta = 0n;

      const commissionSnap = await this.getOrSnapshotCommissionPolicy(childOrderId, tx);

      for (const orderItem of ctx.items) {
        if (!orderItem.wholesaleOrderItemId) continue;
        const line = facts.lines.find((l) => l.wholesaleOrderItemId === orderItem.wholesaleOrderItemId);
        if (!line) continue;

        const orderedUnits = line.quantity;
        const unitPrice = BigInt(line.unitPrice);
        const orderedPieces = orderItem.pieceQuantity > 0 ? orderItem.pieceQuantity : orderedUnits;
        const piecesPerUnit = orderedUnits > 0 && orderedPieces % orderedUnits === 0 ? orderedPieces / orderedUnits : 1;

        const deliveredPiecesRaw = deliveredByItem.get(orderItem.wholesaleOrderItemId) ?? 0;
        const deliveredPieces = Math.min(deliveredPiecesRaw, orderedPieces);
        const deliveredUnits = piecesPerUnit > 0 ? Math.floor(deliveredPieces / piecesPerUnit) : 0;

        let refundedUndelivered = 0;
        let refundedDelivered = 0;
        for (const refund of facts.refunds) {
          if (!["completed"].includes(refund.status)) continue;
          for (const rl of refund.lines) {
            if (rl.wholesaleOrderItemId !== orderItem.wholesaleOrderItemId) continue;
            if (refund.fulfillmentExceptionId) refundedUndelivered += rl.quantity;
            else refundedDelivered += rl.quantity;
          }
        }

        const entitledUnits = Math.max(0, Math.min(deliveredUnits, orderedUnits - refundedUndelivered) - refundedDelivered);
        const entitledValue = unitPrice * BigInt(entitledUnits);

        const prevJournals = await tx
          .select()
          .from(settlementJournal)
          .where(
            and(
              eq(settlementJournal.childOrderId, childOrderId),
              eq(settlementJournal.orderItemId, orderItem.wholesaleOrderItemId),
              eq(settlementJournal.journalType, "ENTITLEMENT"),
            ),
          );

        const previouslyEntitled = prevJournals.reduce((s: bigint, j: any) => s + BigInt(j.totalAmount), 0n);
        const delta = entitledValue - previouslyEntitled;

        if (delta > 0n) {
          totalEntitledDelta += delta;
          const sourceEventId = sha256Hex(`ChildQuantityDelivered:${childOrderId}:${orderItem.wholesaleOrderItemId}:${entitledUnits}:${previouslyEntitled}`);

          const entResult = await this.postJournalInTx(tx, {
            journalType: "ENTITLEMENT",
            sourceEventType: "ChildQuantityDelivered",
            sourceEventId,
            childOrderId,
            orderItemId: orderItem.wholesaleOrderItemId,
            supplierId,
            totalAmount: delta,
            snapshotData: {
              unitPrice: unitPrice.toString(),
              orderedUnits,
              deliveredUnits,
              entitledUnits,
              previouslyEntitled: previouslyEntitled.toString(),
              delta: delta.toString(),
            },
            effectiveAt: options.forcedAsOf ?? new Date(),
            reason: `Supplier earnings entitlement for item ${orderItem.wholesaleOrderItemId}`,
            postings: [
              { accountId: clearingAccount.id, direction: "DEBIT", amount: delta },
              { accountId: supplierPendingAccount.id, direction: "CREDIT", amount: delta },
            ],
          });

          postedJournals.push(entResult.journal.id);

          const commissionAmount = basisPoints(
            delta,
            BigInt(commissionSnap.rateBps),
            commissionSnap.roundingMode === "DOWN" ? "down" : "half-up",
          );

          if (commissionAmount > 0n) {
            totalCommissionDelta += commissionAmount;
            const commSourceEventId = sha256Hex(`Commission:${childOrderId}:${orderItem.wholesaleOrderItemId}:${sourceEventId}`);

            const commResult = await this.postJournalInTx(tx, {
              journalType: "COMMISSION",
              sourceEventType: "ChildQuantityDelivered",
              sourceEventId: commSourceEventId,
              childOrderId,
              orderItemId: orderItem.wholesaleOrderItemId,
              supplierId,
              totalAmount: commissionAmount,
              snapshotData: {
                basisDelta: delta.toString(),
                rateBps: commissionSnap.rateBps,
                commissionAmount: commissionAmount.toString(),
                policyId: commissionSnap.policyId,
              },
              effectiveAt: options.forcedAsOf ?? new Date(),
              reason: `Marketplace commission on item ${orderItem.wholesaleOrderItemId}`,
              postings: [
                { accountId: supplierPendingAccount.id, direction: "DEBIT", amount: commissionAmount },
                { accountId: platformFeeAccount.id, direction: "CREDIT", amount: commissionAmount },
              ],
            });

            postedJournals.push(commResult.journal.id);
          }
        }
      }

      let shippingEntitled = 0n;
      const shippingPolicyRow = await this.getShippingEconomics(childOrderId, tx);
      if (shippingPolicyRow && shippingPolicyRow.shippingEconomicRecipient === "SUPPLIER") {
        const shippingAmount = BigInt(shippingPolicyRow.shippingChargeToBuyer);
        if (shippingAmount > 0n) {
          const [prevShip] = await tx
            .select()
            .from(settlementJournal)
            .where(
              and(
                eq(settlementJournal.childOrderId, childOrderId),
                sql`"order_item_id" IS NULL`,
                eq(settlementJournal.journalType, "ENTITLEMENT"),
                sql`"reason" ILIKE '%shipping%'`,
              ),
            )
            .limit(1);

          if (!prevShip) {
            shippingEntitled = shippingAmount;
            const shipSourceEventId = sha256Hex(`ShippingChargeFinalized:${childOrderId}:${shippingAmount}`);
            const shipResult = await this.postJournalInTx(tx, {
              journalType: "ENTITLEMENT",
              sourceEventType: "ChildQuantityDelivered",
              sourceEventId: shipSourceEventId,
              childOrderId,
              supplierId,
              totalAmount: shippingAmount,
              effectiveAt: options.forcedAsOf ?? new Date(),
              reason: `Supplier shipping economics credit for child ${childOrderId}`,
              postings: [
                { accountId: clearingAccount.id, direction: "DEBIT", amount: shippingAmount },
                { accountId: supplierPendingAccount.id, direction: "CREDIT", amount: shippingAmount },
              ],
            });
            postedJournals.push(shipResult.journal.id);
          }
        }
      }

      return {
        childOrderId,
        candidate: true,
        cashCovered: true,
        entitledAmount: totalEntitledDelta.toString(),
        commissionAmount: totalCommissionDelta.toString(),
        shippingAmount: shippingEntitled.toString(),
        postedJournals,
      };
    });
  }

  // ───────────────────────── Checkpoint B: Refund Recovery & Negative Carry-Forward ─────────────────────────

  async processChildRefund(
    childOrderId: string,
    refundId: string,
    options: { forcedAsOf?: Date } = {},
    executor?: DbOrTx,
  ): Promise<{ refundId: string; recoveredAmount: string; negativeCarryForward: string; postedJournals: string[] }> {
    return this.withExecutor(executor, async (tx: any) => {
      const ctx = await this.orders.getChildOrderEconomicContext(childOrderId);
      if (!ctx.child.supplierId || ctx.child.sellerId === "seller_kolbe" || ctx.child.sellerId.includes("kolbe")) {
        return { refundId, recoveredAmount: "0", negativeCarryForward: "0", postedJournals: [] };
      }

      const supplierId = ctx.child.supplierId;
      const orderId = ctx.child.wholesaleOrderId!;
      const facts = await this.payments.getChildSettlementFacts({ orderId, childOrderId });
      const refund = facts.refunds.find((r) => r.id === refundId);
      if (!refund || refund.status !== "completed") {
        return { refundId, recoveredAmount: "0", negativeCarryForward: "0", postedJournals: [] };
      }

      const refundAmount = BigInt(refund.amount);
      if (refundAmount <= 0n) {
        return { refundId, recoveredAmount: "0", negativeCarryForward: "0", postedJournals: [] };
      }

      const refundClearing = await this.getOrCreateAccount(tx, { accountType: "REFUND_CLEARING" });
      const supplierPending = await this.getOrCreateAccount(tx, { accountType: "SUPPLIER_PENDING_PAYABLE", supplierId });
      const supplierAvailable = await this.getOrCreateAccount(tx, { accountType: "SUPPLIER_AVAILABLE_PAYABLE", supplierId });
      const supplierRecovery = await this.getOrCreateAccount(tx, { accountType: "SUPPLIER_RECOVERY", supplierId });

      await tx.execute(sql`SELECT id FROM settlement_account WHERE id IN (${supplierPending.id}, ${supplierAvailable.id}, ${supplierRecovery.id}) FOR UPDATE`);

      const pendingBal = await this.getAccountBalance(tx, supplierPending.id);
      const availableBal = await this.getAccountBalance(tx, supplierAvailable.id);

      let remainingToRecover = refundAmount;
      const postedJournals: string[] = [];

      // 1. Recover from pending earnings if available
      if (pendingBal > 0n && remainingToRecover > 0n) {
        const fromPending = remainingToRecover > pendingBal ? pendingBal : remainingToRecover;
        remainingToRecover -= fromPending;

        const sourceEventId = sha256Hex(`ChildQuantityRefunded:pending:${refundId}:${fromPending}`);
        const j = await this.postJournalInTx(tx, {
          journalType: "REFUND_ADJUSTMENT",
          sourceEventType: "ChildQuantityRefunded",
          sourceEventId,
          childOrderId,
          supplierId,
          totalAmount: fromPending,
          effectiveAt: options.forcedAsOf ?? new Date(),
          reason: `Refund adjustment from pending earnings for refund ${refundId}`,
          postings: [
            { accountId: supplierPending.id, direction: "DEBIT", amount: fromPending },
            { accountId: refundClearing.id, direction: "CREDIT", amount: fromPending },
          ],
        });
        postedJournals.push(j.journal.id);
      }

      // 2. Recover from available earnings if available
      if (availableBal > 0n && remainingToRecover > 0n) {
        const fromAvailable = remainingToRecover > availableBal ? availableBal : remainingToRecover;
        remainingToRecover -= fromAvailable;

        const sourceEventId = sha256Hex(`ChildQuantityRefunded:available:${refundId}:${fromAvailable}`);
        const j = await this.postJournalInTx(tx, {
          journalType: "REFUND_ADJUSTMENT",
          sourceEventType: "ChildQuantityRefunded",
          sourceEventId,
          childOrderId,
          supplierId,
          totalAmount: fromAvailable,
          effectiveAt: options.forcedAsOf ?? new Date(),
          reason: `Refund adjustment from available earnings for refund ${refundId}`,
          postings: [
            { accountId: supplierAvailable.id, direction: "DEBIT", amount: fromAvailable },
            { accountId: refundClearing.id, direction: "CREDIT", amount: fromAvailable },
          ],
        });
        postedJournals.push(j.journal.id);
      }

      // 3. Post-settlement refund: excess goes to recovery (negative carry-forward)
      let negativeCarryForward = 0n;
      if (remainingToRecover > 0n) {
        negativeCarryForward = remainingToRecover;
        const sourceEventId = sha256Hex(`ChildQuantityRefunded:post_settlement:${refundId}:${remainingToRecover}`);
        const j = await this.postJournalInTx(tx, {
          journalType: "POST_SETTLEMENT_ADJUSTMENT",
          sourceEventType: "ChildQuantityRefunded",
          sourceEventId,
          childOrderId,
          supplierId,
          totalAmount: remainingToRecover,
          effectiveAt: options.forcedAsOf ?? new Date(),
          reason: `Post-settlement refund carry-forward for refund ${refundId}`,
          postings: [
            { accountId: supplierRecovery.id, direction: "DEBIT", amount: remainingToRecover },
            { accountId: refundClearing.id, direction: "CREDIT", amount: remainingToRecover },
          ],
        });
        postedJournals.push(j.journal.id);
      }

      return {
        refundId,
        recoveredAmount: (refundAmount - remainingToRecover).toString(),
        negativeCarryForward: negativeCarryForward.toString(),
        postedJournals,
      };
    });
  }

  // ───────────────────────── Checkpoint B: Settlement Batch Evaluation & Release ─────────────────────────

  async evaluateAndReleaseSettlementBatch(
    input: BatchReleaseInput,
    executor?: DbOrTx,
  ): Promise<SettlementBatchView> {
    return this.withExecutor(executor, async (tx: any) => {
      const [existing] = await tx
        .select()
        .from(settlementBatch)
        .where(eq(settlementBatch.idempotencyKey, input.idempotencyKey))
        .limit(1);

      if (existing) {
        return {
          id: existing.id,
          batchCode: existing.batchCode,
          status: existing.status,
          totalReleasedAmount: existing.totalReleasedAmount.toString(),
          totalItemsCount: existing.totalItemsCount,
          currency: existing.currency,
          executedBy: existing.executedBy,
          idempotencyKey: existing.idempotencyKey,
          createdAt: existing.createdAt.toISOString(),
          completedAt: existing.completedAt ? existing.completedAt.toISOString() : null,
        };
      }

      const asOf = input.asOfDate ?? (await this.getDbNow(tx));
      const holdPolicy = await this.getActiveHoldPolicy(tx);
      const holdDays = holdPolicy.holdDurationDays;
      const cutoffDate = new Date(asOf.getTime() - holdDays * 86400 * 1000);

      let supplierIds: string[] = [];
      if (input.supplierId) {
        await this.assertKolbeExcluded(input.supplierId);
        supplierIds = [input.supplierId];
      } else {
        const rows = await tx
          .selectDistinct({ supplierId: settlementJournal.supplierId })
          .from(settlementJournal)
          .where(
            and(
              eq(settlementJournal.journalType, "ENTITLEMENT"),
              sql`"settlement_journal"."supplier_id" IS NOT NULL`,
              sql`"settlement_journal"."effective_at" <= ${cutoffDate}`,
            ),
          );
        supplierIds = rows.map((r: any) => r.supplierId).filter(Boolean);
      }

      const batchId = `sbat_${randomUUID().replace(/-/g, "")}`;
      const batchCode = `KV-SBAT-${randomUUID().replace(/-/g, "").substring(0, 12).toUpperCase()}`;

      let totalReleased = 0n;
      let itemsCount = 0;
      const itemsToInsert: any[] = [];

      for (const supId of supplierIds) {
        const activeHolds = await tx
          .select()
          .from(settlementHold)
          .where(and(eq(settlementHold.supplierId, supId), eq(settlementHold.status, "active")))
          .limit(1);

        if (activeHolds.length > 0) {
          continue;
        }

        const pendingAcc = await this.getOrCreateAccount(tx, { accountType: "SUPPLIER_PENDING_PAYABLE", supplierId: supId });
        const availAcc = await this.getOrCreateAccount(tx, { accountType: "SUPPLIER_AVAILABLE_PAYABLE", supplierId: supId });
        const recAcc = await this.getOrCreateAccount(tx, { accountType: "SUPPLIER_RECOVERY", supplierId: supId });

        await tx.execute(sql`SELECT id FROM settlement_account WHERE id IN (${pendingAcc.id}, ${availAcc.id}, ${recAcc.id}) FOR UPDATE`);

        const matureJournals = await tx
          .select()
          .from(settlementJournal)
          .where(
            and(
              eq(settlementJournal.supplierId, supId),
              eq(settlementJournal.journalType, "ENTITLEMENT"),
              sql`"settlement_journal"."effective_at" <= ${cutoffDate}`,
            ),
          );

        const pendingBal = await this.getAccountBalance(tx, pendingAcc.id);
        if (pendingBal <= 0n) continue;

        const matureSum = matureJournals.reduce((s: bigint, j: any) => s + BigInt(j.totalAmount), 0n);
        const releaseAmount = matureSum > pendingBal ? pendingBal : matureSum;

        if (releaseAmount <= 0n) continue;

        totalReleased += releaseAmount;
        itemsCount++;

        if (!input.dryRun) {
          const sourceEventId = sha256Hex(`SettlementBatchRelease:${batchId}:${supId}:${releaseAmount}`);
          const availJournal = await this.postJournalInTx(tx, {
            journalType: "AVAILABILITY",
            sourceEventType: "SettlementBatchRelease",
            sourceEventId,
            supplierId: supId,
            totalAmount: releaseAmount,
            effectiveAt: asOf,
            reason: `Settlement batch release: pending earnings matured after ${holdDays} days hold`,
            postedBy: input.executedBy,
            postings: [
              { accountId: pendingAcc.id, direction: "DEBIT", amount: releaseAmount },
              { accountId: availAcc.id, direction: "CREDIT", amount: releaseAmount },
            ],
          });

          const recoveryBal = await this.getRecoveryBalance(tx, recAcc.id);
          if (recoveryBal > 0n) {
            const offsetAmount = releaseAmount > recoveryBal ? recoveryBal : releaseAmount;
            const offsetSourceEventId = sha256Hex(`RecoveryOffset:${batchId}:${supId}:${offsetAmount}`);
            await this.postJournalInTx(tx, {
              journalType: "RECOVERY_OFFSET",
              sourceEventType: "SettlementBatchRelease",
              sourceEventId: offsetSourceEventId,
              supplierId: supId,
              totalAmount: offsetAmount,
              effectiveAt: asOf,
              reason: `Recovery offset from newly available earnings for supplier ${supId}`,
              postedBy: input.executedBy,
              postings: [
                { accountId: availAcc.id, direction: "DEBIT", amount: offsetAmount },
                { accountId: recAcc.id, direction: "CREDIT", amount: offsetAmount },
              ],
            });
          }

          itemsToInsert.push({
            id: `sbit_${randomUUID().replace(/-/g, "")}`,
            batchId,
            supplierId: supId,
            childOrderId: matureJournals[0]?.childOrderId ?? null,
            amount: releaseAmount,
            status: "released",
            journalId: availJournal.journal.id,
          });
        }
      }

      if (input.dryRun) {
        return {
          id: `dry_${batchId}`,
          batchCode: `DRY-${batchCode}`,
          status: "draft",
          totalReleasedAmount: totalReleased.toString(),
          totalItemsCount: itemsCount,
          currency: "IRR",
          executedBy: input.executedBy,
          idempotencyKey: input.idempotencyKey,
          createdAt: asOf.toISOString(),
          completedAt: null,
        };
      }

      const [batch] = await tx
        .insert(settlementBatch)
        .values({
          id: batchId,
          batchCode,
          status: "completed",
          totalReleasedAmount: totalReleased,
          totalItemsCount: itemsCount,
          currency: "IRR",
          executedBy: input.executedBy,
          idempotencyKey: input.idempotencyKey,
          completedAt: asOf,
        })
        .returning();

      if (itemsToInsert.length > 0) {
        await tx.insert(settlementBatchItem).values(itemsToInsert);
      }

      return {
        id: batch.id,
        batchCode: batch.batchCode,
        status: batch.status,
        totalReleasedAmount: batch.totalReleasedAmount.toString(),
        totalItemsCount: batch.totalItemsCount,
        currency: batch.currency,
        executedBy: batch.executedBy,
        idempotencyKey: batch.idempotencyKey,
        createdAt: batch.createdAt.toISOString(),
        completedAt: batch.completedAt ? batch.completedAt.toISOString() : null,
      };
    });
  }

  // ───────────────────────── Checkpoint C: Withdrawal Requests & Ledger Reservation ─────────────────────────

  private mapWithdrawalRequestView(row: typeof withdrawalRequest.$inferSelect): WithdrawalRequestView {
    return {
      id: row.id,
      supplierId: row.supplierId,
      requestedByUserId: row.requestedByUserId,
      amount: row.amount.toString(),
      currency: row.currency,
      bankDestinationId: row.bankDestinationId,
      bankDestinationSnapshot: (row.bankDestinationSnapshot as any) ?? {},
      status: row.status,
      approvedByUserId: row.approvedByUserId,
      approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
      rejectionReason: row.rejectionReason,
      rejectedByUserId: row.rejectedByUserId,
      rejectedAt: row.rejectedAt ? row.rejectedAt.toISOString() : null,
      idempotencyKey: row.idempotencyKey,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async createWithdrawalRequest(
    input: {
      supplierId: string;
      amount: bigint;
      requestedByUserId: string;
      idempotencyKey: string;
    },
    executor?: DbOrTx,
  ): Promise<WithdrawalRequestView> {
    await this.assertKolbeExcluded(input.supplierId);

    if (input.amount <= 0n) {
      throw new SettlementDomainError("WITHDRAWAL_AMOUNT_INVALID", "مبلغ برداشت باید بزرگتر از صفر باشد", 400);
    }

    return this.withExecutor(executor, async (tx: any) => {
      // 1. Idempotency check
      const [existing] = await tx
        .select()
        .from(withdrawalRequest)
        .where(
          and(
            eq(withdrawalRequest.supplierId, input.supplierId),
            eq(withdrawalRequest.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

      if (existing) {
        return this.mapWithdrawalRequestView(existing);
      }

      // 2. Compliance eligibility check
      const eligibility = await this.supplierCompliance.getSupplierSettlementEligibility(input.supplierId);
      if (!eligibility.eligible) {
        if (eligibility.reasons.includes("SUPPLIER_BANK_NOT_VERIFIED")) {
          throw new SettlementDomainError(
            "BANK_DESTINATION_NOT_VERIFIED",
            "حساب بانکی تامین‌کننده تایید نشده است و امکان ثبت درخواست برداشت وجود ندارد",
            400,
          );
        }
        throw new SettlementDomainError(
          "SUPPLIER_COMPLIANCE_BLOCKED",
          `تأمین‌کننده مجاز به تسویه نیست: ${eligibility.reasons.join(", ")}`,
          400,
        );
      }

      // 3. Bank destination snapshot from compliance
      const bankDestination = await this.supplierCompliance.getCurrentBankDestination(
        { role: "admin" } as any,
        input.supplierId,
      );

      if (!bankDestination || bankDestination.status !== "verified") {
        throw new SettlementDomainError(
          "BANK_DESTINATION_NOT_VERIFIED",
          "حساب بانکی تاییدشده برای تامین‌کننده یافت نشد",
          400,
        );
      }

      // 4. Lock available payable account and check derived balance
      const availableAccount = await this.getOrCreateAccount(tx, {
        accountType: "SUPPLIER_AVAILABLE_PAYABLE",
        supplierId: input.supplierId,
      });
      const payoutClearingAccount = await this.getOrCreateAccount(tx, {
        accountType: "PAYOUT_CLEARING",
        supplierId: input.supplierId,
      });

      await tx.execute(sql`SELECT id FROM settlement_account WHERE id = ${availableAccount.id} FOR UPDATE`);
      const availableBal = await this.getAccountBalance(tx, availableAccount.id);

      const recoveryAccount = await this.getOrCreateAccount(tx, {
        accountType: "SUPPLIER_RECOVERY",
        supplierId: input.supplierId,
      });
      const recoveryBal = await this.getRecoveryBalance(tx, recoveryAccount.id);
      const netAvailable = availableBal > recoveryBal ? availableBal - recoveryBal : 0n;

      if (netAvailable < input.amount) {
        throw new SettlementDomainError(
          "INSUFFICIENT_AVAILABLE",
          `مانده قابل تسویه (${netAvailable}) کمتر از مبلغ درخواستی (${input.amount}) است`,
          400,
        );
      }

      // 5. Post WITHDRAWAL_RESERVED journal
      const withdrawalId = `wreq_${randomUUID().replace(/-/g, "")}`;
      const reservationSourceEventId = sha256Hex(`WithdrawalAccepted:${withdrawalId}:${input.idempotencyKey}`);

      const resJournal = await this.postJournalInTx(tx, {
        journalType: "WITHDRAWAL_RESERVED",
        sourceEventType: "WithdrawalAccepted",
        sourceEventId: reservationSourceEventId,
        supplierId: input.supplierId,
        totalAmount: input.amount,
        postedBy: input.requestedByUserId,
        reason: `Withdrawal request reservation ${withdrawalId}`,
        postings: [
          { accountId: availableAccount.id, direction: "DEBIT", amount: input.amount },
          { accountId: payoutClearingAccount.id, direction: "CREDIT", amount: input.amount },
        ],
      });

      // 6. Insert withdrawal request
      const [row] = await tx
        .insert(withdrawalRequest)
        .values({
          id: withdrawalId,
          supplierId: input.supplierId,
          requestedByUserId: input.requestedByUserId,
          amount: input.amount,
          currency: "IRR",
          bankDestinationId: bankDestination.id,
        bankDestinationSnapshot: {
          id: bankDestination.id,
          destinationKind: bankDestination.destinationKind,
          maskedValue: bankDestination.maskedValue,
          holderNameDeclared: bankDestination.holderNameDeclared,
          verifiedAt: bankDestination.verifiedAt,
        },
          status: "approved",
          approvedByUserId: input.requestedByUserId,
          approvedAt: new Date(),
          reservationJournalId: resJournal.journal.id,
          idempotencyKey: input.idempotencyKey,
        })
        .returning();

      return this.mapWithdrawalRequestView(row);
    });
  }

  async listWithdrawalRequests(
    options: { supplierId?: string; status?: string; limit?: number; offset?: number } = {},
  ): Promise<WithdrawalRequestView[]> {
    if (options.supplierId) {
      await this.assertKolbeExcluded(options.supplierId);
    }

    const conditions = [];
    if (options.supplierId) conditions.push(eq(withdrawalRequest.supplierId, options.supplierId));
    if (options.status) conditions.push(eq(withdrawalRequest.status, options.status));

    const limit = Math.min(options.limit ?? 50, 100);
    const offset = options.offset ?? 0;

    const rows = await this.db
      .select()
      .from(withdrawalRequest)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(withdrawalRequest.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map((r) => this.mapWithdrawalRequestView(r));
  }

  async getWithdrawalRequestById(id: string): Promise<WithdrawalRequestView> {
    const [row] = await this.db
      .select()
      .from(withdrawalRequest)
      .where(eq(withdrawalRequest.id, id))
      .limit(1);

    if (!row) {
      throw new SettlementDomainError("WITHDRAWAL_NOT_FOUND", "درخواست برداشت یافت نشد", 404);
    }

    return this.mapWithdrawalRequestView(row);
  }

  async rejectWithdrawalRequest(
    input: { withdrawalId: string; rejectedByUserId: string; reason: string },
    executor?: DbOrTx,
  ): Promise<WithdrawalRequestView> {
    return this.withExecutor(executor, async (tx: any) => {
      const [w] = await tx
        .select()
        .from(withdrawalRequest)
        .where(eq(withdrawalRequest.id, input.withdrawalId))
        .for("update")
        .limit(1);

      if (!w) {
        throw new SettlementDomainError("WITHDRAWAL_NOT_FOUND", "درخواست برداشت یافت نشد", 404);
      }

      if (w.status === "rejected") {
        return this.mapWithdrawalRequestView(w);
      }

      if (w.status === "converted_to_payout") {
        throw new SettlementDomainError("WITHDRAWAL_INVALID_TRANSITION", "درخواست تبدیل به تسویه شده و قابل رد نیست", 409);
      }

      const now = await this.getDbNow(tx);

      // Reverse reservation journal if one was created
      if (w.reservationJournalId) {
        const availableAccount = await this.getOrCreateAccount(tx, {
          accountType: "SUPPLIER_AVAILABLE_PAYABLE",
          supplierId: w.supplierId,
        });
        const payoutClearingAccount = await this.getOrCreateAccount(tx, {
          accountType: "PAYOUT_CLEARING",
          supplierId: w.supplierId,
        });

        const revSourceEventId = sha256Hex(`WithdrawalRejected:${w.id}`);
        await this.postJournalInTx(tx, {
          journalType: "PAYOUT_REVERSED",
          sourceEventType: "WithdrawalAccepted",
          sourceEventId: revSourceEventId,
          supplierId: w.supplierId,
          totalAmount: w.amount,
          postedBy: input.rejectedByUserId,
          reason: `Withdrawal request rejected: ${input.reason}`,
          effectiveAt: now,
          postings: [
            { accountId: payoutClearingAccount.id, direction: "DEBIT", amount: w.amount },
            { accountId: availableAccount.id, direction: "CREDIT", amount: w.amount },
          ],
        });
      }

      const [updated] = await tx
        .update(withdrawalRequest)
        .set({
          status: "rejected",
          rejectedByUserId: input.rejectedByUserId,
          rejectedAt: now,
          rejectionReason: input.reason,
          updatedAt: now,
        })
        .where(eq(withdrawalRequest.id, w.id))
        .returning();

      return this.mapWithdrawalRequestView(updated);
    });
  }

  // ───────────────────────── Checkpoint C: Payouts & Provider Execution (TxA -> Outside -> TxB) ─────────────────────────

  private mapPayoutView(row: typeof payout.$inferSelect): PayoutView {
    return {
      id: row.id,
      withdrawalRequestId: row.withdrawalRequestId,
      supplierId: row.supplierId,
      amount: row.amount.toString(),
      currency: row.currency,
      provider: row.provider,
      providerReference: row.providerReference,
      status: row.status,
      bankDestinationSnapshot: (row.bankDestinationSnapshot as any) ?? {},
      initiatedBy: row.initiatedBy,
      externalEvidence: (row.externalEvidence as any) ?? null,
      errorMessage: row.errorMessage,
      reconciliationNotes: row.reconciliationNotes,
      createdAt: row.createdAt.toISOString(),
      processingAt: row.processingAt ? row.processingAt.toISOString() : null,
      succeededAt: row.succeededAt ? row.succeededAt.toISOString() : null,
      failedAt: row.failedAt ? row.failedAt.toISOString() : null,
    };
  }

  async executePayout(
    input: {
      withdrawalRequestId: string;
      provider: "fake" | "manual";
      manualEvidence?: any;
      initiatedBy: string;
      idempotencyKey: string;
    },
  ): Promise<PayoutView> {
    const provider = this.payoutRegistry.get(input.provider);

    // ── TxA: create payout in 'processing' status ──
    const { payoutRow, withdrawal } = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(payout)
        .where(eq(payout.withdrawalRequestId, input.withdrawalRequestId))
        .limit(1);

      if (existing) {
        if (["succeeded", "failed"].includes(existing.status)) {
          return { payoutRow: existing, withdrawal: null };
        }
        const [w] = await tx
          .select()
          .from(withdrawalRequest)
          .where(eq(withdrawalRequest.id, input.withdrawalRequestId))
          .limit(1);
        return { payoutRow: existing, withdrawal: w };
      }

      const [w] = await tx
        .select()
        .from(withdrawalRequest)
        .where(eq(withdrawalRequest.id, input.withdrawalRequestId))
        .for("update")
        .limit(1);

      if (!w) {
        throw new SettlementDomainError("WITHDRAWAL_NOT_FOUND", "درخواست برداشت یافت نشد", 404);
      }

      if (w.status !== "approved") {
        throw new SettlementDomainError(
          "WITHDRAWAL_INVALID_TRANSITION",
          `درخواست برداشت با وضعیت ${w.status} قابل تبدیل به تسویه نیست`,
          409,
        );
      }

      const payoutId = `pout_${randomUUID().replace(/-/g, "")}`;
      const providerReference = `PO-REF-${w.id}`;

      const [created] = await tx
        .insert(payout)
        .values({
          id: payoutId,
          withdrawalRequestId: w.id,
          supplierId: w.supplierId,
          amount: w.amount,
          currency: w.currency,
          provider: input.provider,
          providerReference,
          status: "processing",
          bankDestinationSnapshot: w.bankDestinationSnapshot,
          initiatedBy: input.initiatedBy,
          externalEvidence: input.manualEvidence ?? null,
          processingAt: new Date(),
        })
        .returning();

      await tx
        .update(withdrawalRequest)
        .set({ status: "converted_to_payout", updatedAt: new Date() })
        .where(eq(withdrawalRequest.id, w.id));

      return { payoutRow: created, withdrawal: w };
    });

    if (!withdrawal || ["succeeded", "failed"].includes(payoutRow.status)) {
      return this.mapPayoutView(payoutRow);
    }

    // ── Provider call OUTSIDE DB transaction / locks ──
    let result: PayoutTransferResult;
    try {
      result = await provider.transfer({
        payoutId: payoutRow.id,
        withdrawalRequestId: withdrawal.id,
        supplierId: withdrawal.supplierId,
        amount: withdrawal.amount,
        currency: withdrawal.currency,
        bankDestinationSnapshot: withdrawal.bankDestinationSnapshot as Record<string, unknown>,
        idempotencyKey: input.idempotencyKey,
        manualEvidence: input.manualEvidence,
      });
    } catch (error: any) {
      if (error instanceof SettlementDomainError) throw error;
      result = {
        success: false,
        providerReference: payoutRow.providerReference ?? "",
        externalEventId: `ev_err_${randomUUID().replace(/-/g, "")}`,
        status: "failed",
        errorMessage: error.message || "Provider call failed",
      };
    }

    // ── TxB: record result, post settled or reversed journal ──
    const finalPayout = await this.db.transaction(async (tx) => {
      const [p] = await tx
        .select()
        .from(payout)
        .where(eq(payout.id, payoutRow.id))
        .for("update")
        .limit(1);

      if (["succeeded", "failed"].includes(p.status)) {
        return p;
      }

      const eventId = `pevt_${randomUUID().replace(/-/g, "")}`;
      const eventType = result.status === "succeeded" ? "PAYOUT_COMPLETED" : "PAYOUT_FAILED";
      const payloadHash = sha256Hex(JSON.stringify(result.rawPayload ?? result));

      await tx
        .insert(payoutProviderEvent)
        .values({
          id: eventId,
          provider: input.provider,
          externalEventId: result.externalEventId,
          eventType,
          payoutId: p.id,
          status: "processed",
          payload: (result.rawPayload as any) ?? {},
          payloadHash,
          errorMessage: result.errorMessage ?? null,
          processedAt: new Date(),
        })
        .onConflictDoNothing();

      const payoutClearingAcc = await this.getOrCreateAccount(tx, {
        accountType: "PAYOUT_CLEARING",
        supplierId: p.supplierId,
      });
      const platformClearingAcc = await this.getOrCreateAccount(tx, {
        accountType: "PLATFORM_COLLECTION_CLEARING",
      });
      const supplierAvailAcc = await this.getOrCreateAccount(tx, {
        accountType: "SUPPLIER_AVAILABLE_PAYABLE",
        supplierId: p.supplierId,
      });

      const now = await this.getDbNow(tx);

      if (result.status === "succeeded") {
        const sourceEventId = sha256Hex(`PayoutProviderResult:success:${p.id}:${result.providerReference}`);
        const j = await this.postJournalInTx(tx, {
          journalType: "PAYOUT_SETTLED",
          sourceEventType: "PayoutProviderResult",
          sourceEventId,
          supplierId: p.supplierId,
          totalAmount: p.amount,
          effectiveAt: now,
          postedBy: input.initiatedBy,
          reason: `Payout settled via ${input.provider} provider (ref: ${result.providerReference})`,
          postings: [
            { accountId: payoutClearingAcc.id, direction: "DEBIT", amount: p.amount },
            { accountId: platformClearingAcc.id, direction: "CREDIT", amount: p.amount },
          ],
        });

        const [updated] = await tx
          .update(payout)
          .set({
            status: "succeeded",
            succeededAt: now,
            successJournalId: j.journal.id,
            providerReference: result.providerReference,
            updatedAt: now,
          })
          .where(eq(payout.id, p.id))
          .returning();

        return updated;
      } else if (result.status === "failed") {
        const sourceEventId = sha256Hex(`PayoutProviderResult:failed:${p.id}:${result.errorMessage ?? "failed"}`);
        const j = await this.postJournalInTx(tx, {
          journalType: "PAYOUT_REVERSED",
          sourceEventType: "PayoutProviderResult",
          sourceEventId,
          supplierId: p.supplierId,
          totalAmount: p.amount,
          effectiveAt: now,
          postedBy: input.initiatedBy,
          reason: `Payout failed: ${result.errorMessage}; funds returned to available balance`,
          postings: [
            { accountId: payoutClearingAcc.id, direction: "DEBIT", amount: p.amount },
            { accountId: supplierAvailAcc.id, direction: "CREDIT", amount: p.amount },
          ],
        });

        const [updated] = await tx
          .update(payout)
          .set({
            status: "failed",
            failedAt: now,
            failureReversalJournalId: j.journal.id,
            errorMessage: result.errorMessage ?? "Transfer failed",
            updatedAt: now,
          })
          .where(eq(payout.id, p.id))
          .returning();

        return updated;
      } else {
        // Status remains 'processing' or 'provider_pending'
        const [updated] = await tx
          .update(payout)
          .set({
            status: "provider_pending",
            updatedAt: now,
          })
          .where(eq(payout.id, p.id))
          .returning();

        return updated;
      }
    });

    return this.mapPayoutView(finalPayout);
  }

  async getPayoutById(id: string): Promise<PayoutView> {
    const [row] = await this.db
      .select()
      .from(payout)
      .where(eq(payout.id, id))
      .limit(1);

    if (!row) {
      throw new SettlementDomainError("PAYOUT_NOT_FOUND", "تسویه یافت نشد", 404);
    }

    return this.mapPayoutView(row);
  }

  async listPayouts(
    options: { supplierId?: string; status?: string; limit?: number; offset?: number } = {},
  ): Promise<PayoutView[]> {
    if (options.supplierId) {
      await this.assertKolbeExcluded(options.supplierId);
    }

    const conditions = [];
    if (options.supplierId) conditions.push(eq(payout.supplierId, options.supplierId));
    if (options.status) conditions.push(eq(payout.status, options.status));

    const limit = Math.min(options.limit ?? 50, 100);
    const offset = options.offset ?? 0;

    const rows = await this.db
      .select()
      .from(payout)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(payout.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map((r) => this.mapPayoutView(r));
  }

  // ───────────────────────── Checkpoint C: Reconciliation & Crash Recovery ─────────────────────────

  async reconcileProcessingPayouts(
    options: { maxAgeMinutes?: number; triggeredBy?: string } = {},
  ): Promise<{ runId: string; scannedCount: number; resolvedCount: number }> {
    const maxAgeMinutes = options.maxAgeMinutes ?? 15;
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

    const pendingPayouts = await this.db
      .select()
      .from(payout)
      .where(
        and(
          inArray(payout.status, ["processing", "provider_pending"]),
          sql`"payout"."created_at" <= ${cutoff}`,
        ),
      );

    let resolvedCount = 0;
    const runId = `srec_${randomUUID().replace(/-/g, "")}`;

    for (const p of pendingPayouts) {
      try {
        const provider = this.payoutRegistry.get(p.provider);
        if (provider.queryStatus) {
          const statusResult = await provider.queryStatus(p.id, p.providerReference ?? undefined);
          if (["succeeded", "failed"].includes(statusResult.status)) {
            // Run TxB to resolve
            await this.db.transaction(async (tx) => {
              const [locked] = await tx
                .select()
                .from(payout)
                .where(eq(payout.id, p.id))
                .for("update")
                .limit(1);

              if (["succeeded", "failed"].includes(locked.status)) return;

              const payoutClearingAcc = await this.getOrCreateAccount(tx, {
                accountType: "PAYOUT_CLEARING",
                supplierId: locked.supplierId,
              });
              const platformClearingAcc = await this.getOrCreateAccount(tx, {
                accountType: "PLATFORM_COLLECTION_CLEARING",
              });
              const supplierAvailAcc = await this.getOrCreateAccount(tx, {
                accountType: "SUPPLIER_AVAILABLE_PAYABLE",
                supplierId: locked.supplierId,
              });

              const now = await this.getDbNow(tx);

              if (statusResult.status === "succeeded") {
                const sourceEventId = sha256Hex(`PayoutProviderResult:success:${locked.id}:${statusResult.providerReference}`);
                const j = await this.postJournalInTx(tx, {
                  journalType: "PAYOUT_SETTLED",
                  sourceEventType: "PayoutProviderResult",
                  sourceEventId,
                  supplierId: locked.supplierId,
                  totalAmount: locked.amount,
                  effectiveAt: now,
                  reason: `Payout reconciled as succeeded via ${locked.provider}`,
                  postings: [
                    { accountId: payoutClearingAcc.id, direction: "DEBIT", amount: locked.amount },
                    { accountId: platformClearingAcc.id, direction: "CREDIT", amount: locked.amount },
                  ],
                });

                await tx
                  .update(payout)
                  .set({
                    status: "succeeded",
                    succeededAt: now,
                    successJournalId: j.journal.id,
                    providerReference: statusResult.providerReference,
                    reconciliationNotes: `Reconciled from queryStatus in run ${runId}`,
                    updatedAt: now,
                  })
                  .where(eq(payout.id, locked.id));
              } else {
                const sourceEventId = sha256Hex(`PayoutProviderResult:failed:${locked.id}:${statusResult.errorMessage ?? "reconciled_fail"}`);
                const j = await this.postJournalInTx(tx, {
                  journalType: "PAYOUT_REVERSED",
                  sourceEventType: "PayoutProviderResult",
                  sourceEventId,
                  supplierId: locked.supplierId,
                  totalAmount: locked.amount,
                  effectiveAt: now,
                  reason: `Payout reconciled as failed via ${locked.provider}`,
                  postings: [
                    { accountId: payoutClearingAcc.id, direction: "DEBIT", amount: locked.amount },
                    { accountId: supplierAvailAcc.id, direction: "CREDIT", amount: locked.amount },
                  ],
                });

                await tx
                  .update(payout)
                  .set({
                    status: "failed",
                    failedAt: now,
                    failureReversalJournalId: j.journal.id,
                    errorMessage: statusResult.errorMessage ?? "Failed at provider",
                    reconciliationNotes: `Reconciled from queryStatus in run ${runId}`,
                    updatedAt: now,
                  })
                  .where(eq(payout.id, locked.id));
              }

              resolvedCount++;
            });
          }
        }
      } catch (err: any) {
        // Skip on error
      }
    }

    await this.db.insert(settlementReconciliationRun).values({
      id: runId,
      runType: "PAYOUT_STATUS",
      status: "completed",
      triggeredBy: options.triggeredBy ?? "user_system",
      targetId: null,
      details: {
        scannedCount: pendingPayouts.length,
        resolvedCount,
        maxAgeMinutes,
      },
      completedAt: new Date(),
    });

    return { runId, scannedCount: pendingPayouts.length, resolvedCount };
  }

  async reconcileSettlementProjection(
    supplierId?: string,
    triggeredBy?: string,
  ): Promise<{ runId: string; status: string; discrepancyCount: number; summary: Record<string, unknown> }> {
    const runId = `srec_${randomUUID().replace(/-/g, "")}`;

    const summary = await this.db.transaction(async (tx) => {
      let conditions = [];
      if (supplierId) {
        await this.assertKolbeExcluded(supplierId);
        conditions.push(eq(settlementJournal.supplierId, supplierId));
      }

      const journals = await tx
        .select()
        .from(settlementJournal)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      const postings = await tx
        .select()
        .from(settlementPosting);

      let totalDebits = 0n;
      let totalCredits = 0n;
      for (const p of postings) {
        if (p.direction === "DEBIT") totalDebits += p.amount;
        if (p.direction === "CREDIT") totalCredits += p.amount;
      }

      const isBalanced = totalDebits === totalCredits;

      return {
        journalsCount: journals.length,
        postingsCount: postings.length,
        totalDebits: totalDebits.toString(),
        totalCredits: totalCredits.toString(),
        balanced: isBalanced,
      };
    });

    const status = summary.balanced ? "completed" : "mismatch_detected";
    const discrepancyCount = summary.balanced ? 0 : 1;

    await this.db.insert(settlementReconciliationRun).values({
      id: runId,
      runType: "SETTLEMENT_PROJECTION",
      status,
      triggeredBy: triggeredBy ?? "user_system",
      targetId: supplierId ?? null,
      details: summary,
      completedAt: new Date(),
    });

    return { runId, status, discrepancyCount, summary };
  }
}
