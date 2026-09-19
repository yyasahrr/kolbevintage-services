/**
 * Phase 4.8 — Settlement Ledger Tests (Checkpoints A)
 * Real PostgreSQL, canonical SettlementService, balanced double-entry subledger.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  bootHarness,
  makeId,
  seedTwoSuppliers,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";
import { SettlementService } from "../src/modules/settlement/settlement.service";
import { SettlementDomainError } from "../src/modules/settlement/settlement.errors";

const TEST_DB = "kolbe_phase_4_8_ledger_test";

let h: Harness;
let ctx: SupplierContext;
let settlement: SettlementService;

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 200 });
  settlement = h.app.get(SettlementService);
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe("Phase 4.8 — Balanced Settlement Subledger (Part 61 Ledger Tests)", () => {
  it("Supplier account unique by supplier/type/currency; Kolbe cannot get external Supplier account", async () => {
    // 1. حساب تأمین‌کننده A
    const acc1 = await settlement.getOrCreateAccount(h.db, {
      accountType: "SUPPLIER_PENDING_PAYABLE",
      supplierId: ctx.supA,
      sellerId: ctx.sellerA,
      currency: "IRR",
    });

    const acc2 = await settlement.getOrCreateAccount(h.db, {
      accountType: "SUPPLIER_PENDING_PAYABLE",
      supplierId: ctx.supA,
      sellerId: ctx.sellerA,
      currency: "IRR",
    });

    expect(acc1.id).toBe(acc2.id);
    expect(acc1.accountType).toBe("SUPPLIER_PENDING_PAYABLE");
    expect(acc1.currency).toBe("IRR");

    // 2. تلاش برای ایجاد حساب پرداختنی تأمین‌کننده برای کلبه (اول‌شخص) باید رد شود
    await expect(
      settlement.getOrCreateAccount(h.db, {
        accountType: "SUPPLIER_PENDING_PAYABLE",
        supplierId: null,
        sellerId: "seller_kolbe",
        currency: "IRR",
      }),
    ).rejects.toThrowError(SettlementDomainError);

    try {
      await settlement.getOrCreateAccount(h.db, {
        accountType: "SUPPLIER_PENDING_PAYABLE",
        supplierId: null,
        sellerId: "seller_kolbe",
        currency: "IRR",
      });
    } catch (err: any) {
      expect(err.code).toBe("KOLBE_EXCLUDED_FROM_SUPPLIER_PAYABLE");
    }
  });

  it("Currency mismatch rejected (IRR only, no FX)", async () => {
    await expect(
      settlement.getOrCreateAccount(h.db, {
        accountType: "PLATFORM_COLLECTION_CLEARING",
        currency: "USD",
      }),
    ).rejects.toThrowError("تنها ارز مجاز IRR است");

    const clearingAcc = await settlement.getOrCreateAccount(h.db, {
      accountType: "PLATFORM_COLLECTION_CLEARING",
      currency: "IRR",
    });

    await expect(
      settlement.postJournalInTx(h.db, {
        journalType: "FUNDS_HELD",
        sourceEventType: "ChildPaymentCovered",
        sourceEventId: makeId("evt_curr"),
        currency: "EUR",
        totalAmount: 1000n,
        postings: [
          { accountId: clearingAcc.id, direction: "DEBIT", amount: 1000n, currency: "EUR" },
          { accountId: clearingAcc.id, direction: "CREDIT", amount: 1000n, currency: "EUR" },
        ],
      }),
    ).rejects.toThrowError("تنها ارز مجاز IRR است");
  });

  it("Balanced journal required: equal debits and credits succeeds", async () => {
    const clearingAcc = await settlement.getOrCreateAccount(h.db, {
      accountType: "PLATFORM_COLLECTION_CLEARING",
      currency: "IRR",
    });
    const pendingAcc = await settlement.getOrCreateAccount(h.db, {
      accountType: "SUPPLIER_PENDING_PAYABLE",
      supplierId: ctx.supA,
      currency: "IRR",
    });

    const sourceEventId = makeId("evt_bal");
    const result = await settlement.postJournalInTx(h.db, {
      journalType: "ENTITLEMENT",
      sourceEventType: "ChildQuantityDelivered",
      sourceEventId,
      supplierId: ctx.supA,
      currency: "IRR",
      totalAmount: 5_000_000n,
      postings: [
        { accountId: clearingAcc.id, direction: "DEBIT", amount: 5_000_000n },
        { accountId: pendingAcc.id, direction: "CREDIT", amount: 5_000_000n },
      ],
    });

    expect(result.replayed).toBe(false);
    expect(result.journal.id).toBeDefined();
    expect(result.postings).toHaveLength(2);
    expect(result.journal.totalAmount).toBe(5_000_000n);
  });

  it("Unbalanced journal rejected: sum(debits) != sum(credits) fails validation and DB trigger", async () => {
    const clearingAcc = await settlement.getOrCreateAccount(h.db, {
      accountType: "PLATFORM_COLLECTION_CLEARING",
      currency: "IRR",
    });
    const pendingAcc = await settlement.getOrCreateAccount(h.db, {
      accountType: "SUPPLIER_PENDING_PAYABLE",
      supplierId: ctx.supA,
      currency: "IRR",
    });

    // 1. رد در لایه سرویس
    await expect(
      settlement.postJournalInTx(h.db, {
        journalType: "ENTITLEMENT",
        sourceEventType: "ChildQuantityDelivered",
        sourceEventId: makeId("evt_unbal"),
        supplierId: ctx.supA,
        currency: "IRR",
        totalAmount: 5_000_000n,
        postings: [
          { accountId: clearingAcc.id, direction: "DEBIT", amount: 5_000_000n },
          { accountId: pendingAcc.id, direction: "CREDIT", amount: 4_000_000n }, // 1M mismatch!
        ],
      }),
    ).rejects.toThrowError("سند تسویه متوازن نیست");

    // 2. رد در لایه PostgreSQL توسط trigger تأخیری (DEFERRED constraint trigger)
    const client = await h.pool.connect();
    try {
      await client.query("BEGIN");
      const jId = makeId("sjn_raw");
      await client.query(
        `INSERT INTO settlement_journal (id, journal_type, source_event_type, source_event_id, currency, total_amount)
         VALUES ($1, 'ENTITLEMENT', 'ChildQuantityDelivered', $2, 'IRR', 1000)`,
        [jId, makeId("evt_raw")],
      );
      // درج فقط یک ردیف بدهکار (ناهمتراز)
      await client.query(
        `INSERT INTO settlement_posting (id, journal_id, account_id, direction, amount, currency)
         VALUES ($1, $2, $3, 'DEBIT', 1000, 'IRR')`,
        [makeId("spst_raw"), jId, clearingAcc.id],
      );
      // هنگام COMMIT تریگر خطا می‌دهد
      await expect(client.query("COMMIT")).rejects.toThrow(/unbalanced/);
    } finally {
      client.release();
    }
  });

  it("Source event idempotency: same (sourceEventType, sourceEventId) replayed returns existing without duplicating", async () => {
    const clearingAcc = await settlement.getOrCreateAccount(h.db, {
      accountType: "PLATFORM_COLLECTION_CLEARING",
      currency: "IRR",
    });
    const pendingAcc = await settlement.getOrCreateAccount(h.db, {
      accountType: "SUPPLIER_PENDING_PAYABLE",
      supplierId: ctx.supB,
      currency: "IRR",
    });

    const sourceEventId = makeId("evt_idem");
    const first = await settlement.postJournalInTx(h.db, {
      journalType: "ENTITLEMENT",
      sourceEventType: "ChildQuantityDelivered",
      sourceEventId,
      supplierId: ctx.supB,
      currency: "IRR",
      totalAmount: 2_000_000n,
      postings: [
        { accountId: clearingAcc.id, direction: "DEBIT", amount: 2_000_000n },
        { accountId: pendingAcc.id, direction: "CREDIT", amount: 2_000_000n },
      ],
    });

    expect(first.replayed).toBe(false);

    // ارسال مجدد همان رویداد
    const second = await settlement.postJournalInTx(h.db, {
      journalType: "ENTITLEMENT",
      sourceEventType: "ChildQuantityDelivered",
      sourceEventId,
      supplierId: ctx.supB,
      currency: "IRR",
      totalAmount: 2_000_000n,
      postings: [
        { accountId: clearingAcc.id, direction: "DEBIT", amount: 2_000_000n },
        { accountId: pendingAcc.id, direction: "CREDIT", amount: 2_000_000n },
      ],
    });

    expect(second.replayed).toBe(true);
    expect(second.journal.id).toBe(first.journal.id);

    // بررسی تعداد سطرهای سند در دیتابیس (هیچ سطر تکراری اضافه نشده است)
    const checkPostings = await h.db.execute(
      sql`SELECT count(*)::int as count FROM settlement_posting WHERE journal_id = ${first.journal.id}`,
    );
    expect((checkPostings as any).rows[0].count).toBe(2);
  });

  it("Immutability triggers: settlement_journal and settlement_posting forbid UPDATE and DELETE", async () => {
    const clearingAcc = await settlement.getOrCreateAccount(h.db, {
      accountType: "PLATFORM_COLLECTION_CLEARING",
      currency: "IRR",
    });
    const pendingAcc = await settlement.getOrCreateAccount(h.db, {
      accountType: "SUPPLIER_PENDING_PAYABLE",
      supplierId: ctx.supA,
      currency: "IRR",
    });

    const { journal, postings } = await settlement.postJournalInTx(h.db, {
      journalType: "ENTITLEMENT",
      sourceEventType: "ChildQuantityDelivered",
      sourceEventId: makeId("evt_immut"),
      supplierId: ctx.supA,
      currency: "IRR",
      totalAmount: 1_000_000n,
      postings: [
        { accountId: clearingAcc.id, direction: "DEBIT", amount: 1_000_000n },
        { accountId: pendingAcc.id, direction: "CREDIT", amount: 1_000_000n },
      ],
    });

    // تلاش برای UPDATE روی settlement_journal
    await expect(
      h.pool.query(`UPDATE settlement_journal SET total_amount = 2000000 WHERE id = '${journal.id}'`),
    ).rejects.toThrow(/immutable settlement evidence/);

    // تلاش برای DELETE روی settlement_journal
    await expect(
      h.pool.query(`DELETE FROM settlement_journal WHERE id = '${journal.id}'`),
    ).rejects.toThrow(/immutable settlement evidence/);

    // تلاش برای UPDATE روی settlement_posting
    await expect(
      h.pool.query(`UPDATE settlement_posting SET amount = 2000000 WHERE id = '${postings[0].id}'`),
    ).rejects.toThrow(/immutable settlement evidence/);

    // تلاش برای DELETE روی settlement_posting
    await expect(
      h.pool.query(`DELETE FROM settlement_posting WHERE id = '${postings[0].id}'`),
    ).rejects.toThrow(/immutable settlement evidence/);
  });

  it("Derived balances equal postings; no mutable balance column exists", async () => {
    // 1. بررسی عدم وجود ستون balance در اسکیمای پایگاه داده
    const cols = await h.db.execute(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'settlement_account' AND column_name = 'balance'`,
    );
    expect((cols as any).rows).toHaveLength(0);

    const supCols = await h.db.execute(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'supplier' AND column_name = 'balance'`,
    );
    expect((supCols as any).rows).toHaveLength(0);

    // 2. مانده مشتق‌شده دقیقاً برابر حاصل جمع سطور است
    const summary = await settlement.getSupplierSummary(ctx.supB);
    expect(summary.supplierId).toBe(ctx.supB);
    expect(typeof summary.pendingEarnings).toBe("string");
    expect(typeof summary.availableForSettlement).toBe("string");
    expect(typeof summary.amountOnHold).toBe("string");
    expect(typeof summary.settlementPending).toBe("string");
    expect(typeof summary.settledAmount).toBe("string");
    expect(typeof summary.recoveryAmount).toBe("string");

    // برای supplierB یک سند 2M ثبت کرده بودیم:
    expect(summary.pendingEarnings).toBe("2000000");
  });

  it("Integer-only amounts: zero and negative posting amounts are rejected", async () => {
    const clearingAcc = await settlement.getOrCreateAccount(h.db, {
      accountType: "PLATFORM_COLLECTION_CLEARING",
      currency: "IRR",
    });

    await expect(
      settlement.postJournalInTx(h.db, {
        journalType: "ENTITLEMENT",
        sourceEventType: "ChildQuantityDelivered",
        sourceEventId: makeId("evt_zero"),
        currency: "IRR",
        totalAmount: 0n,
        postings: [],
      }),
    ).rejects.toThrowError("مبلغ سند باید بزرگتر از صفر باشد");

    await expect(
      settlement.postJournalInTx(h.db, {
        journalType: "ENTITLEMENT",
        sourceEventType: "ChildQuantityDelivered",
        sourceEventId: makeId("evt_neg"),
        currency: "IRR",
        totalAmount: 1000n,
        postings: [
          { accountId: clearingAcc.id, direction: "DEBIT", amount: -1000n },
          { accountId: clearingAcc.id, direction: "CREDIT", amount: 1000n },
        ],
      }),
    ).rejects.toThrowError("مبلغ هر ردیف سند باید بزرگتر از صفر باشد");
  });
});
