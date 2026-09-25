/**
 * فاز ۶.۲ — قراردادِ ناوبری و پیوندِ عمیقِ پورتال تأمین‌کننده.
 *
 * نقصی که این تست‌ها قفل می‌کنند: `go()` مقدارِ `?page=` را در نشانی می‌نوشت، اما
 * هیچ‌کس آن را نمی‌خواند؛ پس هر پیوندِ عمیق بی‌صدا روی داشبورد فرود می‌آمد، در حالی که
 * خودِ `navigation.ts` وعدهٔ «مسیرهای عمیقِ قابلِ اشتراک‌گذاری» را می‌داد.
 *
 * علاوه بر آن، گیتِ توانمندی نباید از طریقِ نشانی قابلِ دور زدن باشد: پنهان کردنِ
 * پیوندِ «تولید» کافی نیست، چون `?page=production` یک ورودیِ مستقل است.
 */

import { describe, expect, it } from "vitest";
import {
  CAPABILITY_GATED_PAGES,
  NAV_GROUPS,
  PAGE_TITLES,
  SUPPLIER_PAGES,
  readPageParam,
  resolveStartPage,
  type SupplierPage,
} from "../supplier-src/navigation";

const GATED: SupplierPage[] = ["production", "capacity"];
const OPEN: SupplierPage[] = ["dashboard", "products", "orders", "inventory", "team", "finance"];

describe("فهرستِ صفحات — یک منبعِ حقیقت", () => {
  it("SUPPLIER_PAGES دقیقاً کلیدهای PAGE_TITLES است (فهرستِ دومِ واگرا ممکن نیست)", () => {
    expect([...SUPPLIER_PAGES].sort()).toEqual(Object.keys(PAGE_TITLES).sort());
  });

  it("هر پیوندِ ناوبری صفحه‌ای با عنوانِ ثبت‌شده دارد", () => {
    const dangling = NAV_GROUPS.flatMap(group => group.links)
      .map(link => link.page)
      .filter(page => !(page in PAGE_TITLES));
    expect(dangling).toEqual([]);
  });

  it("صفحه‌های گیت‌شده از NAV_GROUPS مشتق می‌شوند، نه از یک فهرستِ دستی", () => {
    expect([...CAPABILITY_GATED_PAGES].sort()).toEqual([...GATED].sort());
    // اگر روزی پیوندِ گیت‌شدهٔ تازه‌ای اضافه شود، این تست وادار به به‌روزرسانیِ آگاهانه می‌کند.
    const flagged = NAV_GROUPS.flatMap(group => group.links)
      .filter(link => link.capability)
      .map(link => link.page)
      .sort();
    expect(flagged).toEqual([...GATED].sort());
  });
});

describe("readPageParam — ترجمهٔ خالصِ نشانی، بدونِ حدس", () => {
  it("شناسهٔ معتبر را برمی‌گرداند", () => {
    for (const page of OPEN) {
      expect(readPageParam(`?page=${page}`), page).toBe(page);
    }
  });

  it("مقدارِ ناشناخته null می‌دهد، نه dashboard (تصمیمِ پیش‌فرض با فراخوان است)", () => {
    expect(readPageParam("?page=nope")).toBeNull();
    expect(readPageParam("?page=__proto__")).toBeNull();
    expect(readPageParam("?page=../../admin")).toBeNull();
  });

  it("نبودِ پارامتر یا پارامترِ خالی null می‌دهد", () => {
    expect(readPageParam("")).toBeNull();
    expect(readPageParam("?")).toBeNull();
    expect(readPageParam("?page=")).toBeNull();
    expect(readPageParam("?tab=orders")).toBeNull();
  });

  it("پارامترهای دیگر و تکرارِ page رفتار را عوض نمی‌کنند", () => {
    expect(readPageParam("?id=ord_1&page=orders")).toBe("orders");
    expect(readPageParam("?page=orders&page=finance")).toBe("orders");
  });
});

describe("resolveStartPage — پیش‌فرضِ صریح و گیتِ توانمندی", () => {
  it("بدونِ پارامتر یا با مقدارِ نامعتبر به داشبورد می‌رود", () => {
    expect(resolveStartPage("", { productionEnabled: false })).toBe("dashboard");
    expect(resolveStartPage("?page=bogus", { productionEnabled: true })).toBe("dashboard");
  });

  it("صفحهٔ عادی بدونِ توجه به توانمندی باز می‌شود", () => {
    for (const page of OPEN) {
      expect(resolveStartPage(`?page=${page}`, { productionEnabled: false }), page).toBe(page);
      expect(resolveStartPage(`?page=${page}`, { productionEnabled: true }), page).toBe(page);
    }
  });

  it("صفحهٔ گیت‌شده با توانمندیِ تولید باز می‌شود", () => {
    for (const page of GATED) {
      expect(resolveStartPage(`?page=${page}`, { productionEnabled: true }), page).toBe(page);
    }
  });

  it("گیتِ توانمندی از طریقِ نشانی قابلِ دور زدن نیست", () => {
    // تأمین‌کنندهٔ عادی ≠ تولیدکننده؛ نشانی دستی نباید این مرز را بشکند.
    for (const page of GATED) {
      expect(resolveStartPage(`?page=${page}`, { productionEnabled: false }), page).toBe("dashboard");
    }
  });
});
