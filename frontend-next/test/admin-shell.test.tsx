// @vitest-environment jsdom
/**
 * شِل پنل مدیریت — دو تصمیم کاربر در این فایل سنجیده می‌شود:
 *  • پاسخ ۷۷: سایدبار قابل جمع‌شدن به آیکون، با حفظ دسترسی‌پذیری و ماندگاری انتخاب.
 *  • پاسخ ۴۷: جدول‌ها روی موبایل به کارت تبدیل می‌شوند؛ یعنی هر سلول برچسب ستونِ
 *    خودش را دارد (`data-label`) و جدول نشانگر `data-kv-responsive` می‌گیرد.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";

const adminUser = {
  id: "acc_admin_test",
  name: "مدیر آزمایشی",
  email: "admin@kolbe.ir",
  role: "admin",
};

vi.mock("../storefront/lib/clientLogger", () => ({
  initializeClientLogging: () => {},
  reportApiIssue: () => {},
  logClient: () => {},
}));

vi.mock("../storefront/lib/wholesaleApi", () => ({
  restoreAdminSession: async () => true,
  signInAdmin: async () => adminUser,
  signOutAdmin: async () => undefined,
}));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = Observer;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = Observer;
  Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } })),
  );
});

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = "#/admin";
});

afterEach(() => cleanup());

async function renderAdmin() {
  const AdminPortal = (await import("../storefront/pages/AdminPortal")).default;
  const { container } = render(createElement(AdminPortal));
  // انتظار برای پایان «در حال بررسی نشست امن…»
  await waitFor(() => {
    expect(container.querySelector("aside")).toBeTruthy();
  }, { timeout: 8000 });
  return container;
}

describe("شِل پنل مدیریت", () => {
  it("سایدبار دکمهٔ جمع‌شدن دارد و وضعیت را روی عنصر aside منعکس می‌کند", async () => {
    const container = await renderAdmin();
    const aside = container.querySelector("aside")!;
    expect(aside.getAttribute("data-collapsed")).toBe("false");

    const toggle = screen.getByRole("button", { name: "جمع کردن منو به آیکون‌ها" });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(container.querySelector("aside")!.getAttribute("data-collapsed")).toBe("true");
    });
    expect(window.localStorage.getItem("kolbe-admin-sidebar-collapsed-v1")).toBe("1");
  });

  it("انتخاب جمع‌شدن بین بازدیدها می‌ماند", async () => {
    const container = await renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: "جمع کردن منو به آیکون‌ها" }));
    await waitFor(() => expect(container.querySelector("aside")!.getAttribute("data-collapsed")).toBe("true"));
    cleanup();

    const second = await renderAdmin();
    expect(second.querySelector("aside")!.getAttribute("data-collapsed")).toBe("true");
    expect(screen.getByRole("button", { name: "باز کردن منوی کنار" })).toBeTruthy();
  });

  it("هر آیتم منو در حالت جمع‌شده نام قابل‌دسترسی دارد", async () => {
    const container = await renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: "جمع کردن منو به آیکون‌ها" }));
    await waitFor(() => expect(container.querySelector("aside")!.getAttribute("data-collapsed")).toBe("true"));

    // در حالت آیکونی، متن پنهان می‌شود ولی نام دسترسی‌پذیری می‌ماند.
    expect(screen.getByRole("button", { name: "داشبورد" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "سفارش‌ها" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "مشتریان ویژه" })).toBeTruthy();
  });

  it("جدول‌های پنل برچسب ستون می‌گیرند تا در موبایل کارت شوند", async () => {
    const container = await renderAdmin();

    // داشبورد پیش‌فرض است؛ به بخش گزارش‌ها می‌رویم که جدول دارد.
    fireEvent.click(screen.getByRole("button", { name: "گزارش‌ها" }));

    await waitFor(() => {
      expect(container.querySelector('table[data-kv-responsive="true"]')).toBeTruthy();
    }, { timeout: 8000 });

    const row = container.querySelector('table[data-kv-responsive="true"] tbody tr')!;
    const labelled = Array.from(row.querySelectorAll("td")).filter((cell) => cell.hasAttribute("data-label"));
    expect(labelled.length).toBeGreaterThan(0);
    expect(labelled[0].getAttribute("data-label")).toBeTruthy();
  });
});
