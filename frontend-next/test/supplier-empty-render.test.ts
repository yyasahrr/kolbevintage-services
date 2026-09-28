/**
 * رگرسیون کرش پنل ساپلایر روی دادهٔ خالی — لایهٔ رندر.
 *
 * ── چه چیزی خراب بود ────────────────────────────────────────────────────────
 * بعد از بارگذاری موفق APIها، کد پنل آرایه‌های دمو را با `splice()` جایگزین
 * می‌کرد. یک تأمین‌کنندهٔ معتبر می‌تواند صفر محصول / صفر سفارش / صفر RFQ
 * داشته باشد؛ آن‌وقت رابط کاربری اندیس ۰ را می‌خواند:
 *
 *   Cannot read properties of undefined (reading 'image')
 *
 * این تست همان حالت را با `splice(0, length)` شبیه‌سازی می‌کند (دقیقاً همان
 * کاری که `App.tsx` بعد از دریافت آرایهٔ خالی از API انجام می‌دهد) و سپس
 * هر صفحه را رندر می‌کند. اگر جایی دوباره `products[0]` / `orderRows[0]` /
 * `rfqs[0]` خوانده شود، این تست با TypeError شکست می‌خورد.
 *
 * رندر با `react-dom/server` انجام می‌شود (بدون jsdom) چون فقط رندر اولیه
 * مهم است: کرشِ `products[0].image` در همان رندر اول رخ می‌داد.
 */

import { renderToString } from "react-dom/server";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dashboard, Orders, OrderInspector, Products, RFQInbox } from "../supplier-src/App";
import { orderRows, products, rfqs } from "../supplier-src/data";

/**
 * supplier-src با runtime کلاسیک JSX نوشته شده و `React` را ایمپورت نمی‌کند
 * (Next.js در مرورگر آن را گلوبال تزریق می‌کند). برای رندر سمت سرور در Node
 * باید خودمان آن را گلوبال کنیم، وگرنه همه‌جا `React is not defined` می‌گیریم.
 */
const globalScope = globalThis as unknown as { React: typeof React };
globalScope.React = React;

/**
 * شبیه‌سازی دقیقِ همگام‌سازی API با پاسخِ خالی.
 *
 * `App.tsx` بعد از دریافت موفق داده از API این کار را می‌کند:
 *   products.splice(0, products.length, ...remoteProducts)
 * با `remoteProducts === []` آرایه خالی می‌ماند و UI باید با همین حالت کار کند.
 */
function simulateEmptyBackend() {
  products.splice(0, products.length);
  orderRows.splice(0, orderRows.length);
  rfqs.splice(0, rfqs.length);
}

const noop = () => {};

describe("رندر پنل ساپلایر با دادهٔ خالی — نباید کرش کند", () => {
  beforeEach(() => {
    simulateEmptyBackend();
  });

  afterEach(() => {
    // آرایه‌های دمو را به حالت اولیه برگردان تا روی بقیهٔ تست‌ها اثر نگذارد
    simulateEmptyBackend();
  });

  it("داشبورد با صفر محصول و صفر سفارش رندر می‌شود", () => {
    expect(() => renderToString(React.createElement(Dashboard, { onNavigate: noop }))).not.toThrow();
  });

  it("داشبورد به‌جای کارت محصولِ سخت‌کدشده، حالت خالی فارسی نشان می‌دهد", () => {
    const html = renderToString(React.createElement(Dashboard, { onNavigate: noop }));
    expect(html).toContain("هنوز محصولی ثبت نشده است");
    // تصویر محصولِ سخت‌کدشدهٔ دمو نباید رندر شود
    expect(html).not.toContain("پیراهن آکسفورد");
  });

  it("داشبورد برای سفارش‌های خالی هم حالت خالی نشان می‌دهد", () => {
    const html = renderToString(React.createElement(Dashboard, { onNavigate: noop }));
    expect(html).toContain("سفارش آماده‌ای وجود ندارد");
  });

  it("صفحهٔ محصولات با صفر محصول رندر می‌شود", () => {
    expect(() =>
      renderToString(React.createElement(Products, { onNavigate: noop, query: "", setQuery: noop })),
    ).not.toThrow();
  });

  it("صفحهٔ محصولات CTAٔ ایجاد اولین محصول را نشان می‌دهد", () => {
    const html = renderToString(React.createElement(Products, { onNavigate: noop, query: "", setQuery: noop }));
    expect(html).toContain("هنوز محصولی ثبت نشده است");
    expect(html).toContain("ایجاد اولین محصول");
  });

  it("صفحهٔ سفارشات با صفر سفارش رندر می‌شود", () => {
    expect(() => renderToString(React.createElement(Orders))).not.toThrow();
  });

  it("صفحهٔ سفارشات به‌جای OrderInspector برای سفارشِ غیرواقعی، حالت خالی نشان می‌دهد", () => {
    const html = renderToString(React.createElement(Orders));
    expect(html).toContain("سفارش آماده‌ای در انتظار شما نیست");
    // نباید یک OrderInspector برای سفارش پیش‌فرض/ساخته‌شده رندر شود
    expect(html).not.toContain("جزئیات سفارش");
  });

  it("OrderInspector با شناسهٔ ناموجود null برمی‌گرداند (نه کرش)", () => {
    const html = renderToString(React.createElement(OrderInspector, { id: "KV-00000" }));
    expect(html).toBe("");
  });

  it("صفحهٔ RFQ با صفر درخواست رندر می‌شود", () => {
    expect(() => renderToString(React.createElement(RFQInbox, { onNavigate: noop }))).not.toThrow();
  });

  it("صفحهٔ RFQ حالت خالی نشان می‌دهد و RFQDetail با undefined رندر نمی‌شود", () => {
    const html = renderToString(React.createElement(RFQInbox, { onNavigate: noop }));
    expect(html).toContain("درخواست تولید جدیدی وجود ندارد");
    // RFQDetail با rfq===undefined کرش می‌کرد؛ نباید اصلاً رندر شود
    expect(html).not.toContain("فرصت برآورد");
  });
});

describe("حفظ حالت نمایشی (demo) — حذف نشدن ویژگی", () => {
  it("با دادهٔ موجود، داشبورد همچنان محصول را نشان می‌دهد", async () => {
    const { products: demoProducts, orderRows: demoOrders, rfqs: demoRfqs } = await import("../supplier-src/data");
    demoProducts.splice(0, 0, {
      id: "PR-2001",
      name: "پیراهن لینن نمونه",
      sku: "NG-LIN-001",
      image: "/placeholder-product.svg",
      category: "پیراهن مردانه",
      series: 4,
      stock: 40,
      price: "۱٬۰۰۰٬۰۰۰",
      status: "فعال",
      updated: "امروز",
    });
    demoOrders.splice(0, 0, {
      id: "KV-90001",
      customer: "بوتیک نمونه",
      product: "پیراهن لینن نمونه",
      pack: "فول‌سری",
      quantity: "۵ سری",
      pieces: "۴۰ تکه",
      value: "۸٬۰۰۰٬۰۰۰ تومان",
      date: "امروز",
      due: "فردا",
      status: "نیازمند تأیید",
    });
    demoRfqs.splice(0, 0, {
      id: "RFQ-9001",
      title: "پیراهن نمونه",
      customer: "مشتری نمونه",
      quantity: "۱۰۰ تکه",
      deadline: "فردا",
      fabric: "Cotton",
      status: "نیازمند قیمت‌گذاری",
      avatar: "ن",
    });

    const dashboard = renderToString(React.createElement(Dashboard, { onNavigate: noop }));
    expect(dashboard).toContain("پیراهن لینن نمونه");

    const orders = renderToString(React.createElement(Orders));
    expect(orders).toContain("KV-90001");

    const rfqInbox = renderToString(React.createElement(RFQInbox, { onNavigate: noop }));
    expect(rfqInbox).toContain("RFQ-9001");
  });
});
