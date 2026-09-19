import { Inject, Injectable, forwardRef } from "@nestjs/common";
import { sql, eq, and, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
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
import {
  SettlementAccountSummary,
  SettlementPostingInput,
  CreateJournalInput,
  SettlementHistoryItem,
} from "./settlement.contract";
import { SettlementDomainError } from "./settlement.errors";

type DbOrTx = KolbeDatabase | Parameters<Parameters<KolbeDatabase["transaction"]>[0]>[0];

@Injectable()
export class SettlementService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
    @Inject(forwardRef(() => SupplierComplianceService))
    private readonly supplierCompliance: SupplierComplianceService,
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

    // جستجوی حساب موجود
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

    // ایجاد حساب تازه
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
      .returning();

    return created;
  }

  /**
   * ثبت سند حسابداری دوطرفه متوازن در دفتر معین تسویه.
   * ناوردایی‌های DB و کد:
   * 1. مجموع بدهکار = مجموع بستانکار = totalAmount
   * 2. مبالغ همگی صحیح و بزرگتر از صفر (> 0)
   * 3. رویداد مبدأ کاملاً قطعی و غیرتکراری (idempotent بر اساس sourceEventType + sourceEventId)
   * 4. سند و سطرهای آن فقط-افزودنی (append-only) هستند و هرگز UPDATE/DELETE نمی‌شوند.
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

    // رویداد بدون مبلغ (مبلغ صفر): نیازی به سند ندارد
    if (input.totalAmount <= 0n) {
      throw new SettlementDomainError("SETTLEMENT_POSTING_INVALID", "مبلغ سند باید بزرگتر از صفر باشد");
    }

    // بررسی یکتایی رویداد مبدأ (Idempotency)
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

    // بررسی توازن دفترداری دوطرفه (Double-Entry Invariant)
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

    // ایجاد سند
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

    // ایجاد سطرهای سند
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
   * هیچ ستون ذخیره‌شده و جهش‌پذیر مانده وجود ندارد.
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
   * محاسبه خلاصه وضعیت حساب مالی تأمین‌کننده از روی سطرهای دفتر معین.
   * مقادیر مالی به‌صورت رشته‌های عددی امن برای HTTP بازگردانده می‌شوند.
   */
  async getSupplierSummary(supplierId: string, executor?: DbOrTx): Promise<SettlementAccountSummary> {
    await this.assertKolbeExcluded(supplierId);

    return this.withExecutor(executor, async (tx: any) => {
      // پیدا کردن حساب‌های تأمین‌کننده
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

      // حساب‌های کانونیکال
      const pendingAccountId = accountMap.get("SUPPLIER_PENDING_PAYABLE");
      const availableAccountId = accountMap.get("SUPPLIER_AVAILABLE_PAYABLE");
      const holdAccountId = accountMap.get("SUPPLIER_HOLD");
      const payoutClearingAccountId = accountMap.get("PAYOUT_CLEARING");
      const recoveryAccountId = accountMap.get("SUPPLIER_RECOVERY");

      const pendingBal = pendingAccountId ? await this.getAccountBalance(tx, pendingAccountId) : 0n;
      const availableBal = availableAccountId ? await this.getAccountBalance(tx, availableAccountId) : 0n;
      const holdBal = holdAccountId ? await this.getAccountBalance(tx, holdAccountId) : 0n;
      const payoutPendingBal = payoutClearingAccountId ? await this.getAccountBalance(tx, payoutClearingAccountId) : 0n;
      const recoveryBal = recoveryAccountId ? await this.getAccountBalance(tx, recoveryAccountId) : 0n;

      // مبلغ تسویه‌شده (مجموع payoutهای موفق)
      const settledRes = await tx.execute(sql`
        SELECT COALESCE(SUM(amount), 0) as settled
        FROM payout
        WHERE supplier_id = ${supplierId} AND status = 'succeeded'
      `);
      const settledRaw = (settledRes as any).rows?.[0]?.settled ?? (settledRes as any)[0]?.settled;
      const settledAmount = BigInt(settledRaw ?? "0");

      // مانده قابل تسویه نمی‌تواند منفی نمایش داده شود
      // موقعیت بازیافت منفی به طور مجزا در recoveryAmount گزارش می‌شود
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
}
