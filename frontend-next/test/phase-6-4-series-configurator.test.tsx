// @vitest-environment jsdom
/**
 * فاز ۶.۴ — آزمونِ «رنگ → سری → تعدادِ سری» در صفحهٔ محصولِ عمده.
 *
 * چه چیزی را اثبات می‌کند؟
 *  ۱) رنگ از **ویژگی‌های واریانت‌های داخلِ دستورِ پخت** استخراج می‌شود، نه از
 *     حدس یا متغیرِ سراسری؛ و سری‌های هر رنگ فقط همان‌هایی هستند که تأمین‌کننده
 *     برای همان رنگ تعریف کرده است (نارنجی ۳ نوع، مشکی ۲ نوع).
 *  ۲) ترکیبِ سری فقط‌خواندنی است و از دستورِ پخت می‌آید.
 *  ۳) quantity تعدادِ **سری** است؛ «۳ سری · ۳۶ عدد» هرگز «۳ عدد» نمی‌شود.
 *  ۴) payloadِ درخواست همان قراردادِ کانونیک است:
 *     `{ productId, offerId, packageId, quantity }` — بدونِ قیمت، فروشنده،
 *     ترکیب یا موجودی از مرورگر.
 *  ۵) وقتی سرور عددی اعلام نمی‌کند (`availablePackages: null`)، UI چیزی اختراع
 *     نمی‌کند و سقفِ استپر باز می‌ماند.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ApiError } from "../shared/http/errors";
import type { ApiClient } from "../shared/http/types";
import {
  groupSeriesByColor,
  isPackageLikeUnit,
  orderComposition,
  pieceColorGroups,
  piecesForSeries,
  primaryOfferFor,
  seriesOptionsForOffer,
} from "../shared/wholesale/series";
import { mapWholesaleProductDetail } from "../shared/wholesale/catalog";
import { WholesaleProductDetailPage } from "../storefront/vip/WholesaleProductDetail";

afterEach(() => cleanup());

const META = { status: 200, requestId: "req_test" } as never;

/* ── دادهٔ ساختاریِ هم‌شکل با seed واقعی (scripts/seed-vip-series-demo.mjs) ─ */

const COLORS = [
  { slug: "orange", label: "نارنجی", hex: "#d9762f" },
  { slug: "black", label: "مشکی", hex: "#1c1c1f" },
] as const;
const SIZES = ["S", "M", "L", "XL", "2XL", "3XL"] as const;
const variantId = (color: string, size: string) => `var_${color}_${size}`;

const VARIANTS = COLORS.flatMap((color) =>
  SIZES.map((size) => ({
    id: variantId(color.slug, size),
    sku: `KV-CLASSIC-${color.slug.toUpperCase()}-${size}`,
    attributes: { color: color.label, color_hex: color.hex, size, material: "پنبه" },
    media: [],
  })),
);

const packagePayload = (id: string, name: string, color: string, pieces: Record<string, number>, available: number | null) => ({
  id,
  name,
  packageType: "SIZE_RUN",
  totalPieces: Object.values(pieces).reduce((sum, value) => sum + value, 0),
  availablePackages: available,
  items: Object.entries(pieces).map(([size, quantity]) => ({ variantId: variantId(color, size), quantity })),
});

const FULL = { S: 2, M: 2, L: 2, XL: 2, "2XL": 2, "3XL": 2 };
const HALF = { S: 1, M: 1, L: 1, XL: 1, "2XL": 1, "3XL": 1 };
const BESTSELLER = { M: 2, L: 4, XL: 4, "2XL": 2 };

const DETAIL_PAYLOAD = {
  id: "prod_classic",
  name: "پیراهن کلاسیک نیم‌آستین",
  slug: "classic-short-sleeve",
  description: "تولید کارخانه، کیفیت صادراتی",
  ownerType: "SUPPLIER",
  status: "published",
  priceFrom: "8900000",
  priceCurrency: "IRR",
  availability: 780,
  media: [{ url: "/images/model-front.jpg", type: "image" }, { url: "/images/flat.jpg", type: "image" }],
  variants: VARIANTS,
  offers: [
    // پیشنهادِ تک‌فروشیِ قدیمیِ دمو — باید نادیده گرفته شود ولی حذف نشود.
    {
      id: "offer_classic",
      variantId: "var_orange_M",
      sellerId: "seller_sup_nilgoon",
      sku: "NL-CLASSIC-M",
      status: "published",
      price: "890000",
      retailPrice: null,
      currency: "IRR",
      moq: 1,
      moqUnit: "PIECE",
      pricingUnit: "PIECE",
      packageType: null,
      packages: [],
      pricingTiers: [],
    },
    // پیشنهادِ سری: سطحِ محصول، MOQ یک سری، قیمت برای هر سری.
    {
      id: "offer_series",
      variantId: null,
      sellerId: "seller_sup_nilgoon",
      sku: "KV-CLASSIC-SERIES",
      status: "published",
      price: "8900000",
      retailPrice: null,
      currency: "IRR",
      moq: 1,
      moqUnit: "SERIES",
      pricingUnit: "SERIES",
      packageType: "SIZE_RUN",
      packages: [
        packagePayload("wpkg_full_orange", "سری کامل", "orange", FULL, 60),
        packagePayload("wpkg_half_orange", "نیم‌سری", "orange", HALF, 120),
        packagePayload("wpkg_best_orange", "سری پرفروش", "orange", BESTSELLER, 30),
        packagePayload("wpkg_full_black", "سری کامل", "black", FULL, 60),
        packagePayload("wpkg_best_black", "سری پرفروش", "black", BESTSELLER, 30),
      ],
      pricingTiers: [
        { minQuantity: 1, maxQuantity: 4, unitPrice: "8900000", currency: "IRR", moqUnit: "SERIES", pricingUnit: "SERIES" },
        { minQuantity: 5, maxQuantity: 9, unitPrice: "8600000", currency: "IRR", moqUnit: "SERIES", pricingUnit: "SERIES" },
        { minQuantity: 10, maxQuantity: null, unitPrice: "8200000", currency: "IRR", moqUnit: "SERIES", pricingUnit: "SERIES" },
      ],
    },
  ],
};

const DETAIL = mapWholesaleProductDetail(DETAIL_PAYLOAD)!;

function clientReturning(payload: unknown, sink?: { body?: unknown }): ApiClient {
  return {
    requestResult: async (_path: string, init?: { method?: string; body?: unknown }) => {
      // POSTِ درخواست باید با موجودیتِ ساخته‌شده پاسخ بگیرد؛ اگر detail به آن
      // داده شود، صفحه از ابتدا بالا نمی‌آید و آزمون علتِ واقعی را پنهان می‌کند.
      if (init?.method === "POST") {
        if (sink) sink.body = init.body;
        return { ok: true, data: { id: "vreq_1" }, meta: META };
      }
      return { ok: true, data: payload, meta: META };
    },
  } as unknown as ApiClient;
}

function clientFailing(kind: "NETWORK_ERROR" | "FORBIDDEN"): ApiClient {
  return {
    requestResult: async () => ({
      ok: false,
      meta: META,
      error: new ApiError({ kind, message: `${kind} happened`, status: kind === "NETWORK_ERROR" ? 0 : 403 }),
    }),
  } as unknown as ApiClient;
}

/* ── ۱) انتخاب‌گرهای سری (بدونِ رندر) ────────────────────────────────────── */

describe("انتخاب‌گرهای سری — رنگ و ترکیب از حقیقتِ سرور", () => {
  const offer = primaryOfferFor(DETAIL)!;

  it("پیشنهادِ بسته‌ای را به پیشنهادِ تکی ترجیح می‌دهد (بدونِ حذفِ پیشنهادِ تکی)", () => {
    expect(DETAIL.offers.length).toBe(2);
    expect(offer.id).toBe("offer_series");
    expect(isPackageLikeUnit(offer.moqUnit)).toBe(true);
  });

  it("رنگ‌ها را از دستورِ پختِ هر بسته می‌سازد، نه از یک فهرستِ ثابت", () => {
    const groups = groupSeriesByColor(DETAIL, offer);
    expect(groups.map((group) => group.label)).toEqual(["نارنجی", "مشکی"]);
    expect(groups[0]!.colorHex).toBe("#d9762f");
    // نارنجی سه نوع سری دارد، مشکی دو نوع — مجموعهٔ سری‌ها برای هر رنگ متفاوت است.
    expect(groups[0]!.options.map((option) => option.name)).toEqual(["سری کامل", "نیم‌سری", "سری پرفروش"]);
    expect(groups[1]!.options.map((option) => option.name)).toEqual(["سری کامل", "سری پرفروش"]);
  });

  it("ترکیبِ سری را روی نردبانِ سایز مرتب می‌کند و تعداد را از دستورِ پخت می‌گیرد", () => {
    const full = seriesOptionsForOffer(DETAIL, offer).find((option) => option.id === "wpkg_full_orange")!;
    expect(full.composition.map((row) => `${row.size}×${row.quantity}`)).toEqual([
      "S×2", "M×2", "L×2", "XL×2", "2XL×2", "3XL×2",
    ]);
    expect(full.totalPieces).toBe(12);
  });

  it("بسته‌ای که دو رنگ را در بر می‌گیرد با نامِ هر دو رنگ گزارش می‌شود، نه منسوب به یکی", () => {
    const mixed = mapWholesaleProductDetail({
      ...DETAIL_PAYLOAD,
      offers: [
        {
          ...DETAIL_PAYLOAD.offers[1],
          packages: [
            {
              id: "wpkg_mixed",
              name: "سری مختلط",
              packageType: "MIXED",
              totalPieces: 2,
              availablePackages: null,
              items: [
                { variantId: variantId("orange", "M"), quantity: 1 },
                { variantId: variantId("black", "M"), quantity: 1 },
              ],
            },
          ],
        },
      ],
    })!;
    const groups = groupSeriesByColor(mixed, mixed.offers[0]!);
    expect(groups).toHaveLength(1);
    // رنگِ مختلط با نامِ همان رنگ‌ها گزارش می‌شود — نه با یک برچسبِ مبهم،
    // و نه با انتسابِ نادرست به یکی از آن‌ها.
    expect(groups[0]!.label).toBe("نارنجی + مشکی");
    expect(groups[0]!.colorHex).toBeNull();
  });

  it("تعدادِ قطعات فقط آینهٔ «تعدادِ سری × قطعاتِ هر سری» است", () => {
    const full = seriesOptionsForOffer(DETAIL, offer).find((option) => option.id === "wpkg_full_orange")!;
    expect(piecesForSeries(full, 1)).toBe(12);
    expect(piecesForSeries(full, 5)).toBe(60);
    expect(piecesForSeries(full, 5)).toBe(full.totalPieces * 5);
  });

  it("ترتیبِ نردبانِ سایز را حتی وقتی سرور ترتیبِ دیگری می‌دهد اعمال می‌کند", () => {
    const ordered = orderComposition([
      { variantId: "v1", sku: "A-3XL", size: "3XL", color: null, quantity: 1 },
      { variantId: "v2", sku: "A-S", size: "S", color: null, quantity: 2 },
      { variantId: "v3", sku: "A-XL", size: "XL", color: null, quantity: 3 },
      { variantId: "v4", sku: "A-M", size: "M", color: null, quantity: 4 },
    ]);
    expect(ordered.map((row) => row.size)).toEqual(["S", "M", "XL", "3XL"]);
  });

  it("مسیرِ PIECE همچنان روی «رنگ → سایز» کار می‌کند", () => {
    const groups = pieceColorGroups(DETAIL);
    expect(groups.map((group) => group.label)).toEqual(["نارنجی", "مشکی"]);
    expect(groups[0]!.sizes.map((size) => size.size)).toEqual(["S", "M", "L", "XL", "2XL", "3XL"]);
  });
});

/* ── ۲) آداپتور: null یعنی «سرور عددی اعلام نکرده»، نه صفر ────────────────── */

describe("قراردادِ availablePackages", () => {
  it("null را به صفر تبدیل نمی‌کند و عدد را همان‌طور منتقل می‌کند", () => {
    const mapped = mapWholesaleProductDetail(DETAIL_PAYLOAD)!;
    const offer = mapped.offers.find((entry) => entry.id === "offer_series")!;
    expect(offer.packages.map((entry) => entry.availablePackages)).toEqual([60, 120, 30, 60, 30]);

    const undisclosed = mapWholesaleProductDetail({
      ...DETAIL_PAYLOAD,
      offers: [{ ...DETAIL_PAYLOAD.offers[1], packages: [packagePayload("wpkg_x", "سری ناشناخته", "orange", FULL, null)] }],
    })!;
    expect(undisclosed.offers[0]!.packages[0]!.availablePackages).toBeNull();
  });
});

/* ── ۳) UI: جریانِ خرید ─────────────────────────────────────────────────── */

describe("پیکربندِ سری — جریانِ خریدار", () => {
  it("فقط سری‌های رنگِ انتخاب‌شده را نشان می‌دهد", async () => {
    render(<WholesaleProductDetailPage client={clientReturning(DETAIL_PAYLOAD)} productId="prod_classic" onBack={() => {}} canRequest />);

    await waitFor(() => expect(screen.getByText("سری کامل")).toBeTruthy());
    // نارنجی: سه نوع سری (نامِ «نیم‌سری» دو بار نیست؛ یک کارت است).
    expect(screen.getByText("نیم‌سری")).toBeTruthy();

    // انتخابِ رنگِ مشکی ⇒ فقط دو نوع سریِ مشکی
    const blackSwatch = screen.getByText("مشکی");
    blackSwatch.click();

    await waitFor(() => expect(screen.queryByText("نیم‌سری")).toBeNull());
    expect(screen.getAllByText("سری کامل")).toHaveLength(1);
    expect(screen.getAllByText("سری پرفروش")).toHaveLength(1);
  });

  it("ترکیبِ سری را فقط‌خواندنی نشان می‌دهد و هیچ ورودیِ سایز ندارد", async () => {
    render(<WholesaleProductDetailPage client={clientReturning(DETAIL_PAYLOAD)} productId="prod_classic" onBack={() => {}} canRequest />);
    await waitFor(() => expect(screen.getByText("ترکیبِ سری")).toBeTruthy());

    // ترکیبِ «سری کامل»: هر سایز دو عدد
    for (const size of SIZES) expect(screen.getAllByText(size).length).toBeGreaterThan(0);
    expect(screen.getAllByText("×۲").length).toBe(SIZES.length);

    // خریدار نمی‌تواند سایز انتخاب کند: هیچ فیلدی با نامِ سایز در سطحِ اصلی نیست.
    expect(screen.queryByLabelText(/تعداد.*S/)).toBeNull();
  });

  it("«۳ سری · ۳۶ عدد» می‌نویسد و هرگز آن را به «۳ عدد» تقلیل نمی‌دهد", async () => {
    render(<WholesaleProductDetailPage client={clientReturning(DETAIL_PAYLOAD)} productId="prod_classic" onBack={() => {}} canRequest />);
    await waitFor(() => expect(screen.getByRole("button", { name: "افزایشِ تعدادِ سری" })).toBeTruthy());

    // دو کلیک در یک تیکِ مشترک یک به‌روزرسانی می‌سازند؛ بینِ تعامل‌ها باید
    // رندرِ بعدی را صبر کرد (وگرنه آزمون رفتارِ واقعی را آزمایش نمی‌کند).
    fireEvent.click(screen.getByRole("button", { name: "افزایشِ تعدادِ سری" }));
    await waitFor(() => expect(screen.getAllByText(/۲ سری · ۲۴ عدد/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "افزایشِ تعدادِ سری" }));

    await waitFor(() => expect(screen.getAllByText(/۳ سری · ۳۶ عدد/).length).toBeGreaterThan(0));
    expect(screen.queryByText("۳ عدد")).toBeNull();
  });

  it("درخواست را دقیقاً با { productId, offerId, packageId, quantity } می‌فرستد", async () => {
    const sink: { body?: unknown } = {};
    render(
      <WholesaleProductDetailPage
        client={clientReturning(DETAIL_PAYLOAD, sink)}
        productId="prod_classic"
        onBack={() => {}}
        canRequest
      />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "افزایشِ تعدادِ سری" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "افزایشِ تعدادِ سری" }));
    await waitFor(() => expect(screen.getAllByText(/۲ سری · ۲۴ عدد/).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: "ثبت درخواست عمده" }));

    await waitFor(() => expect(sink.body).toBeDefined());
    expect(sink.body).toEqual({
      productId: "prod_classic",
      offerId: "offer_series",
      packageId: "wpkg_full_orange",
      quantity: 2,
    });
  });

  it("سقفِ موجودیِ اعلام‌شدهٔ سرور را رعایت می‌کند", async () => {
    render(<WholesaleProductDetailPage client={clientReturning(DETAIL_PAYLOAD)} productId="prod_classic" onBack={() => {}} canRequest />);
    await waitFor(() => expect(screen.getByText("سری پرفروش")).toBeTruthy());

    // «سری پرفروشِ نارنجی» ۳۰ سریِ آماده دارد (کمترین نسبتِ موجودی به دستورِ
    // پخت)؛ چون فقط سری‌های رنگِ انتخاب‌شده رندر می‌شوند، یک بار دیده می‌شود.
    expect(screen.getAllByText("۳۰ سری آماده")).toHaveLength(1);

    fireEvent.click(screen.getByText("سری پرفروش"));
    const input = screen.getByLabelText("تعدادِ سری") as HTMLInputElement;
    expect(input.max).toBe("30");
  });

  it("وقتی سرور موجودی اعلام نمی‌کند، سقفی اختراع نمی‌کند", async () => {
    const payload = {
      ...DETAIL_PAYLOAD,
      offers: [{ ...DETAIL_PAYLOAD.offers[1], packages: [packagePayload("wpkg_x", "سری تازه", "orange", FULL, null)] }],
    };
    render(<WholesaleProductDetailPage client={clientReturning(payload)} productId="prod_classic" onBack={() => {}} canRequest />);
    await waitFor(() => expect(screen.getByText("موجودی اعلام نشده")).toBeTruthy());

    const input = screen.getByLabelText("تعدادِ سری") as HTMLInputElement;
    expect(input.max).toBe("");
    expect(screen.getByRole("button", { name: "افزایشِ تعدادِ سری" })).toBeTruthy();
  });

  it("خطا را خطا نشان می‌دهد و آن را «کاتالوگ خالی» جا نمی‌زند", async () => {
    render(<WholesaleProductDetailPage client={clientFailing("NETWORK_ERROR")} productId="prod_classic" onBack={() => {}} canRequest />);
    await waitFor(() => expect(screen.getByText(/اتصال به سرور برقرار نشد/)).toBeTruthy());
    expect(screen.queryByText("ترکیبِ سری")).toBeNull();
    expect(screen.getByRole("button", { name: "تلاشِ دوباره" })).toBeTruthy();
  });

  it("در حالتِ بارگذاری، اسکلتونِ هم‌شکل با طرح می‌سازد و چیزی جعل نمی‌کند", async () => {
    let resolve: ((value: unknown) => void) | null = null;
    const pending: ApiClient = {
      requestResult: () =>
        new Promise((inner) => {
          resolve = inner;
        }),
    } as unknown as ApiClient;

    render(<WholesaleProductDetailPage client={pending} productId="prod_classic" onBack={() => {}} canRequest />);
    expect(screen.getByText(/در حالِ خواندنِ جزئیاتِ محصول/)).toBeTruthy();
    expect(screen.queryByText("ترکیبِ سری")).toBeNull();
    resolve?.({ ok: true, data: DETAIL_PAYLOAD, meta: META });
  });
});
