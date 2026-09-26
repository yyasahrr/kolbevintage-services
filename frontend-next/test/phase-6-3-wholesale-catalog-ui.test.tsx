// @vitest-environment jsdom
/**
 * فاز ۶.۳‑C — آزمونِ رندرِ کاتالوگِ عمده.
 *
 * چه چیزی را اثبات می‌کند؟
 *  ۱) حقیقتِ تجاریِ سرور **دیده می‌شود**: MOQ همراه با واحدِ واقعی، ترکیبِ بسته،
 *     پله‌های قیمت و پلهٔ باز.
 *  ۲) «۲ سری» هرگز به «۲ عدد» تبدیل نمی‌شود.
 *  ۳) مبلغ به‌صورتِ رشتهٔ اعشاری و با جداکنندهٔ فارسی نمایش داده می‌شود، بدونِ
 *     هیچ محاسبهٔ اعشاری در مرورگر.
 *  ۴) خطا هرگز به «کاتالوگِ خالی» فرو نمی‌ریزد (NETWORK_ERROR ≠ READY_EMPTY).
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ApiClient } from "../shared/http/types";
import { ApiError } from "../shared/http/errors";
import { formatMoney, quantityWithUnit, moqUnitLabel, WholesaleProductDetailPage } from "../storefront/pages/WholesaleCatalog";

// `screen` کلِ document را می‌پوید؛ بدونِ cleanup رندرِ آزمونِ قبلی باقی می‌ماند
// و پرس‌وجو به گرهٔ آزمونِ قبل می‌خورد.
afterEach(() => cleanup());

const META = { status: 200, requestId: "req_test" } as never;

/** حداقلِ قراردادِ `ApiClient` که این صفحات مصرف می‌کنند. */
function clientReturning(payload: unknown): ApiClient {
  return {
    requestResult: async () => ({ ok: true, data: payload, meta: META }),
  } as unknown as ApiClient;
}

function clientFailing(kind: "NETWORK_ERROR" | "FORBIDDEN" | "RATE_LIMITED"): ApiClient {
  return {
    requestResult: async () => ({
      ok: false,
      meta: META,
      error: new ApiError({ kind, message: `${kind} happened`, status: kind === "NETWORK_ERROR" ? 0 : 403 }),
    }),
  } as unknown as ApiClient;
}

const DETAIL = {
  id: "prod_1",
  name: "پیراهن لینن E2E",
  slug: "linen-e2e",
  description: "پیراهن لینن با دوخت صادراتی",
  ownerType: "SUPPLIER",
  status: "published",
  priceFrom: "1250000",
  priceCurrency: "IRR",
  availability: 135,
  media: [],
  variants: [
    { id: "var_s", sku: "LINE-BLACK-S", attributes: { color: "مشکی", size: "S", material: "لینن" } },
    { id: "var_m", sku: "LINE-BLACK-M", attributes: { color: "مشکی", size: "M", material: "لینن" } },
    { id: "var_l", sku: "LINE-BLACK-L", attributes: { color: "مشکی", size: "L", material: "لینن" } },
  ],
  offers: [{
    id: "offer_1",
    variantId: null,
    sellerId: "sel_1",
    sku: "LINE-SHIRT",
    status: "published",
    price: "1250000",
    retailPrice: null,
    currency: "IRR",
    moq: 2,
    moqUnit: "SERIES",
    pricingUnit: "PACKAGE",
    packageType: null,
    packages: [{
      id: "wpkg_1",
      name: "سری سایزبندی S-L",
      packageType: "SIZE_RUN",
      totalPieces: 6,
      items: [
        { variantId: "var_s", quantity: 2 },
        { variantId: "var_m", quantity: 2 },
        { variantId: "var_l", quantity: 2 },
      ],
    }],
    pricingTiers: [
      { minQuantity: 2, maxQuantity: 9, unitPrice: "1250000", currency: "IRR", moqUnit: "SERIES", pricingUnit: "PACKAGE" },
      { minQuantity: 10, maxQuantity: 49, unitPrice: "1180000", currency: "IRR", moqUnit: "SERIES", pricingUnit: "PACKAGE" },
      { minQuantity: 50, maxQuantity: null, unitPrice: "1090000", currency: "IRR", moqUnit: "SERIES", pricingUnit: "PACKAGE" },
    ],
  }],
};

describe("کاتالوگ عمده — نمایشِ حقیقتِ تجاری", () => {
  it("MOQ را با واحدِ واقعی نشان می‌دهد و هرگز «سری» را به «عدد» تبدیل نمی‌کند", async () => {
    render(<WholesaleProductDetailPage client={clientReturning(DETAIL)} productId="prod_1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("۲ سری")).toBeTruthy());
    // «۲ عدد» نباید جایی به‌عنوانِ حداقلِ سفارش ظاهر شود.
    expect(screen.queryByText("۲ عدد")).toBeNull();
  });

  it("ترکیبِ بسته را با نام، نوع و مجموعِ قطعات نشان می‌دهد", async () => {
    render(<WholesaleProductDetailPage client={clientReturning(DETAIL)} productId="prod_1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("سری سایزبندی S-L")).toBeTruthy());
    // «سری سایزبندی» هم به‌عنوانِ نوعِ بسته و هم به‌عنوانِ نامِ بسته دیده می‌شود.
    expect(screen.getAllByText(/سری سایزبندی/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/مجموع: ۶ قطعه/)).toBeTruthy();
    // هر سه واریانتِ داخلِ بسته با SKU واقعی دیده می‌شوند (هم در جدولِ واریانت و
    // هم در ترکیبِ بسته، پس getAllByText).
    for (const sku of ["LINE-BLACK-S", "LINE-BLACK-M", "LINE-BLACK-L"]) {
      expect(screen.getAllByText(sku).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("هر سه پلهٔ قیمت را نشان می‌دهد و پلهٔ آخر را صادقانه «به بالا» می‌خواند", async () => {
    render(<WholesaleProductDetailPage client={clientReturning(DETAIL)} productId="prod_1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("به بالا")).toBeTruthy());
    // ۱٬۲۵۰٬۰۰۰ هم قیمتِ عمده است و هم پلهٔ اول.
    expect(screen.getAllByText("۱٬۲۵۰٬۰۰۰").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("۱٬۱۸۰٬۰۰۰").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("۱٬۰۹۰٬۰۰۰").length).toBeGreaterThanOrEqual(1);
  });

  it("موجودی را از سرور نشان می‌دهد و عددی نمی‌سازد", async () => {
    render(<WholesaleProductDetailPage client={clientReturning(DETAIL)} productId="prod_1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("۱۳۵")).toBeTruthy());
  });

  it("شناسه‌ها را در جزیرهٔ LTR نگه می‌دارد", async () => {
    const { container } = render(<WholesaleProductDetailPage client={clientReturning(DETAIL)} productId="prod_1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getAllByText("LINE-BLACK-S").length).toBeGreaterThan(0));
    for (const skuNode of screen.getAllByText("LINE-BLACK-S")) {
      expect(skuNode.getAttribute("dir")).toBe("ltr");
    }
    expect(container.querySelectorAll('[dir="ltr"]').length).toBeGreaterThan(0);
  });

  it("خطای شبکه را به «کاتالوگ خالی» تبدیل نمی‌کند", async () => {
    render(<WholesaleProductDetailPage client={clientFailing("NETWORK_ERROR")} productId="prod_1" onBack={() => {}} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("اتصال به سرور برقرار نشد");
    // هیچ ادعای «خالی بودن» نباید همراه با خطا رندر شود.
    expect(screen.queryByText(/خالی است/)).toBeNull();
  });

  it("خطای دسترسی را از خطای فنی جدا می‌کند", async () => {
    render(<WholesaleProductDetailPage client={clientFailing("FORBIDDEN")} productId="prod_1" onBack={() => {}} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("اجازهٔ دسترسی");
  });
});

describe("هلپرهای نمایشِ پول و واحد", () => {
  it("مبلغ را بدونِ تبدیل به number قالب می‌زند", () => {
    expect(formatMoney("1250000")).toBe("۱٬۲۵۰٬۰۰۰");
    expect(formatMoney("0")).toBe("۰");
    // رشته‌ای که عددِ خالص نیست دست‌نخورده می‌ماند (ساختِ عددِ جعلی ممنوع).
    expect(formatMoney("نامشخص")).toBe("نامشخص");
  });

  it("واحدِ ناشناخته را به «عدد» ترجمه نمی‌کند", () => {
    expect(moqUnitLabel("SERIES")).toBe("سری");
    expect(moqUnitLabel("PALLET")).toBe("PALLET");
    expect(quantityWithUnit(2, "SERIES")).toBe("۲ سری");
  });
});
