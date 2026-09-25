/**
 * فاز ۶.۲ — نرمال‌سازیِ پاسخ‌های سرور به قراردادهای تایپ‌شدهٔ پورتال.
 *
 * ── چرا این لایه لازم شد (یک نقصِ واقعی که در همین فاز پیدا شد) ──────────────
 * دو مسیرِ مختلف، دو سبکِ نام‌گذاری برمی‌گردانند:
 *
 *   GET /api/v1/compat/supplier/orders → SQL خام: `order_code`, `total_amount`,
 *                                        `purchase_order_items[].product_name`
 *   GET /api/v1/supplier/orders        → ردیف‌های Drizzle: `orderCode`, `totalAmount`
 *
 * بدونِ نرمال‌سازی، صفحه یا کدِ سفارش را نشان نمی‌داد یا مبلغ را. این تست هر دو
 * شکل را پوشش می‌دهد و تضمین می‌کند پول در هیچ‌کدام به float تبدیل نمی‌شود.
 */

import { describe, expect, it } from "vitest";
import {
  asMoney,
  asNumber,
  asString,
  normalizeChildOrder,
  normalizeHistoryEntry,
  normalizeInventoryRecord,
  normalizeList,
  normalizeProductionJob,
  normalizeSupplierProduct,
  normalizeSupplierRfq,
  normalizeSupportCase,
  normalizeWithdrawal,
} from "../shared/supplier/normalize";

describe("نرمال‌سازیِ سفارش — هر دو سبکِ نام‌گذاریِ سرور", () => {
  it("شکلِ snake_case (مسیرِ compat) را به قرارداد تبدیل می‌کند", () => {
    const order = normalizeChildOrder({
      id: "po_1",
      order_code: "KV-82941",
      status: "pending",
      seller_id: "sel_1",
      total_amount: 9450000,
      currency: "IRR",
      due_date: "2026-09-30T00:00:00.000Z",
      tracking_code: null,
      version: 3,
      created_at: "2026-09-20T08:00:00.000Z",
      purchase_order_items: [
        { id: "it_1", product_name: "پیراهن آکسفورد", sku: "KH-OXF-241", quantity: 30, unit_price: 315000 },
      ],
    });
    expect(order).not.toBeNull();
    expect(order?.orderCode).toBe("KV-82941");
    expect(order?.sellerId).toBe("sel_1");
    expect(order?.totalAmount).toBe("9450000");
    expect(order?.items).toHaveLength(1);
    expect(order?.items?.[0]?.productName).toBe("پیراهن آکسفورد");
    expect(order?.items?.[0]?.unitPrice).toBe("315000");
  });

  it("شکلِ camelCase (ردیف‌های Drizzle از مسیرِ canonical) را هم می‌خواند", () => {
    const order = normalizeChildOrder({
      id: "po_2",
      orderCode: "KV-82999",
      status: "confirmed",
      sellerId: "sel_2",
      totalAmount: "6750000",
      dueDate: null,
      trackingCode: "TRK-1",
      version: 1,
      purchaseOrderItems: [{ productName: "شلوار لینن", quantity: 24, unitPrice: "281250" }],
    });
    expect(order?.orderCode).toBe("KV-82999");
    expect(order?.totalAmount).toBe("6750000");
    expect(order?.trackingCode).toBe("TRK-1");
    expect(order?.items?.[0]?.productName).toBe("شلوار لینن");
    expect(order?.items?.[0]?.unitPrice).toBe("281250");
  });

  it("مبلغ هرگز به float تبدیل نمی‌شود؛ دقتِ bigint حفظ می‌شود", () => {
    // عددی بزرگ‌تر از دقتِ float: اگر Number() استفاده می‌شد، مقدار خراب می‌شد.
    const big = 9007199254740993n;
    expect(normalizeChildOrder({ id: "po_3", total_amount: big })?.totalAmount).toBe("9007199254740993");
    expect(asMoney(big)).toBe("9007199254740993");
  });

  it("مبلغِ غایب null است، نه صفرِ ساختگی", () => {
    expect(normalizeChildOrder({ id: "po_4" })?.totalAmount).toBeNull();
    expect(normalizeChildOrder({ id: "po_5", total_amount: null })?.totalAmount).toBeNull();
  });

  it("رکوردِ بدون شناسه، null می‌دهد (نه رکوردِ نصفه‌نیمه)", () => {
    expect(normalizeChildOrder({ order_code: "KV-1" })).toBeNull();
    expect(normalizeChildOrder(null)).toBeNull();
    expect(normalizeChildOrder("text")).toBeNull();
    expect(normalizeChildOrder([])).toBeNull();
  });
});

describe("نرمال‌سازیِ محصولات و RFQ", () => {
  it("قیمتِ عمدهٔ محصول از `wholesale_price` به رشتهٔ ده‌دهی می‌رسد", () => {
    const product = normalizeSupplierProduct({
      id: "p_1",
      name: "پیراهن آکسفورد",
      sku: "KH-OXF-241",
      category: "پیراهن مردانه",
      wholesale_price: 1890000,
      status: "approved",
      product_variants: [{ id: "v1" }, { id: "v2" }],
      updated_at: "2026-09-20T08:00:00.000Z",
    });
    expect(product?.wholesalePrice).toBe("1890000");
    expect(product?.productVariants).toHaveLength(2);
    expect(product?.updatedAt).toBe("2026-09-20T08:00:00.000Z");
  });

  it("قیمتِ غایب به «0» می‌رسد اما هرگز به عدد تبدیل نمی‌شود", () => {
    const product = normalizeSupplierProduct({ id: "p_2" });
    expect(product?.wholesalePrice).toBe("0");
    expect(typeof product?.wholesalePrice).toBe("string");
  });

  it("RFQ فیلدهای snake_case و مشخصات را نگه می‌دارد", () => {
    const rfq = normalizeSupplierRfq({
      id: "rfq_1",
      reference_code: "RFQ-2048",
      title: "پیراهن اختصاصی",
      customer_name: "گروه هتل‌های هلیا",
      quantity: 600,
      requested_delivery_date: "2026-10-01T00:00:00.000Z",
      status: "open",
      specifications: { fabric: "Oxford Cotton 150gr" },
    });
    expect(rfq?.referenceCode).toBe("RFQ-2048");
    expect(rfq?.customerName).toBe("گروه هتل‌های هلیا");
    expect(rfq?.quantity).toBe(600);
    expect(rfq?.specifications?.fabric).toBe("Oxford Cotton 150gr");
  });

  it("مشخصاتِ غیرِشیء به null تبدیل می‌شود (نه کرش)", () => {
    expect(normalizeSupplierRfq({ id: "rfq_2", specifications: "نه شیء" })?.specifications).toBeNull();
  });
});

describe("نرمال‌سازیِ مالی، پشتیبانی و تولید", () => {
  it("گردشِ مالی مبالغ را رشته نگه می‌دارد", () => {
    const entry = normalizeHistoryEntry({
      id: "h_1",
      type: "SETTLEMENT",
      amount: 32400000,
      balance_after: "48600000",
      reference_id: "ST-1103",
      created_at: "2026-09-18T00:00:00.000Z",
    });
    expect(entry?.amount).toBe("32400000");
    expect(entry?.balanceAfter).toBe("48600000");
    expect(entry?.referenceId).toBe("ST-1103");
  });

  it("برداشت: مبلغ رشته و وضعیت پیش‌فرض `requested`", () => {
    const withdrawal = normalizeWithdrawal({ id: "w_1", amount: 1250000 });
    expect(withdrawal?.amount).toBe("1250000");
    expect(withdrawal?.status).toBe("requested");
  });

  it("پروندهٔ پشتیبانی فیلدهای لازم را می‌گیرد", () => {
    const supportCase = normalizeSupportCase({
      id: "c_1",
      subject: "مشکل تسویه",
      category: "settlement",
      status: "OPEN",
      priority: "HIGH",
      supplier_id: "sup_1",
      created_at: "2026-09-19T00:00:00.000Z",
    });
    expect(supportCase?.supplierId).toBe("sup_1");
    expect(supportCase?.priority).toBe("HIGH");
  });

  it("شغلِ تولید: واحدها عدد می‌مانند و پرچم‌ها بولین می‌شوند", () => {
    const job = normalizeProductionJob({
      id: "job_1",
      child_order_id: "po_1",
      status: "in_progress",
      actual_units: "120",
      expected_units: 200,
      requires_sample_approval: true,
      requires_quality_release: 1,
      version: 2,
    });
    expect(job?.childOrderId).toBe("po_1");
    expect(job?.actualUnits).toBe(120);
    expect(job?.expectedUnits).toBe(200);
    expect(job?.requiresSampleApproval).toBe(true);
    // `1` بولین نیست: فقط `true` صریح پذیرفته می‌شود تا پرچمِ جعلی ساخته نشود.
    expect(job?.requiresQualityRelease).toBe(false);
  });

  it("موجودی: فیلدهای عددی دست‌نخورده می‌مانند (محاسبه با سرور است)", () => {
    const record = normalizeInventoryRecord({ id: "inv_1", variant_id: "v1", on_hand: 40, reserved: 12, available: 28 });
    expect(record?.onHand).toBe(40);
    expect(record?.reserved).toBe(12);
    expect(record?.available).toBe(28);
  });
});

describe("نرمال‌سازیِ فهرست — هیچ رکوردِ نامعتبری «خالیِ موفق» نمی‌سازد", () => {
  it("رکوردهای نامعتبر حذف می‌شوند و بقیه می‌مانند", () => {
    const list = normalizeList([{ id: "a" }, null, "x", { noId: true }, { id: "b" }], normalizeChildOrder);
    expect(list.map(item => item?.id)).toEqual(["a", "b"]);
  });

  it("آرایهٔ خالی، فهرستِ خالی می‌دهد (تصمیمِ «خالی» با لایهٔ وضعیت است)", () => {
    expect(normalizeList([], normalizeChildOrder)).toEqual([]);
    expect(normalizeList(null, normalizeChildOrder)).toEqual([]);
  });
});

describe("ابزارهای تبدیل — بدون محاسبهٔ تجاری", () => {
  it("asString فقط رشته‌سازی وفادار است", () => {
    expect(asString(123)).toBe("123");
    expect(asString(null)).toBeNull();
    expect(asString(undefined)).toBeNull();
    expect(asString({})).toBeNull();
  });

  it("asMoney هیچ گردکردنی انجام نمی‌دهد", () => {
    expect(asMoney("1250000.00")).toBe("1250000.00");
    expect(asMoney(1250000)).toBe("1250000");
    expect(asMoney("")).toBeNull();
  });

  it("asNumber فقط مقدارِ عددیِ معتبر را می‌پذیرد", () => {
    expect(asNumber("42")).toBe(42);
    expect(asNumber("abc")).toBeNull();
    expect(asNumber(Number.NaN)).toBeNull();
    expect(asNumber(null)).toBeNull();
  });
});
