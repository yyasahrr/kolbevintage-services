/**
 * تست‌های پایهٔ صفحه‌بندی (فاز ۶.۱-D).
 *
 * محور: حفظِ متادیتای canonical سرور. وقتی سرور چیزی دربارهٔ «ادامه دارد؟»
 * نمی‌گوید، مدل باید **ندانستن** را اعلام کند — نه اینکه فرض کند همهٔ داده‌ها
 * رسیده است (رفتاری که در صفحه‌های فعلی به «بارگذاریِ همه» انجامیده بود).
 */

import { describe, expect, it } from "vitest";
import {
  PaginationContractError,
  PAGINATION_MODES,
  hasMore,
  isCompletePage,
  itemsOf,
  nextRequestQuery,
  normalizePage,
  pageSummary,
} from "../shared/pagination";
import { ApiError } from "../shared/http";
import { stateFromResult } from "../shared/ui/async-state";

describe("Phase 6.1-D pagination foundation", () => {
  it("supports exactly the registered pagination modes", () => {
    expect(PAGINATION_MODES).toEqual(["NONE", "OFFSET", "KEYSET", "CURSOR"]);
  });

  it("reads canonical offset metadata (operational logs contract)", () => {
    const page = normalizePage<{ id: string }>(
      { logs: [{ id: "1" }], pagination: { page: 2, limit: 20, total: 95, pageCount: 5, capped: false } },
      "OFFSET",
    );
    expect(page.mode).toBe("OFFSET");
    if (page.mode !== "OFFSET") return;
    expect(itemsOf(page)).toHaveLength(1);
    expect(page.total).toBe(95);
    expect(page.pageCount).toBe(5);
    expect(page.hasMore).toBe(true);
    expect(isCompletePage(page)).toBe(false);
    expect(nextRequestQuery(page)).toEqual({ page: 3, limit: 20 });
  });

  it("detects the last offset page from canonical metadata", () => {
    const page = normalizePage<{ id: string }>({ items: [{ id: "1" }], pagination: { page: 5, limit: 20, total: 95 } }, "OFFSET");
    if (page.mode !== "OFFSET") throw new Error("حالت OFFSET نبود");
    expect(page.hasMore).toBe(false);
    expect(isCompletePage(page)).toBe(true);
    expect(nextRequestQuery(page)).toBeNull();
  });

  it("reads canonical cursor metadata (orders contract)", () => {
    const page = normalizePage<{ id: string }>({ orders: [{ id: "1" }], nextCursor: "eyJpZCI6Mn0", hasMore: true }, "CURSOR");
    if (page.mode !== "CURSOR") throw new Error("حالت CURSOR نبود");
    expect(page.nextCursor).toBe("eyJpZCI6Mn0");
    expect(page.hasMore).toBe(true);
    expect(nextRequestQuery(page)).toEqual({ cursor: "eyJpZCI6Mn0" });
  });

  it("reads canonical keyset metadata", () => {
    const page = normalizePage<{ id: string }>({ items: [{ id: "1" }], nextKey: "2026-01-01|ord_9", hasMore: true }, "KEYSET");
    if (page.mode !== "KEYSET") throw new Error("حالت KEYSET نبود");
    expect(page.nextKey).toBe("2026-01-01|ord_9");
    expect(nextRequestQuery(page)).toEqual({ key: "2026-01-01|ord_9" });
  });

  it("accepts a bare array and marks unpaginated contracts as complete", () => {
    const page = normalizePage<number>([1, 2, 3], "NONE");
    expect(page.mode).toBe("NONE");
    expect(itemsOf(page)).toEqual([1, 2, 3]);
    expect(isCompletePage(page)).toBe(true);
    expect(nextRequestQuery(page)).toBeNull();
  });

  it("declares unknown instead of assuming a complete dataset", () => {
    const page = normalizePage<{ id: string }>({ items: [{ id: "1" }] }, "CURSOR");
    if (page.mode !== "CURSOR") throw new Error("حالت CURSOR نبود");
    expect(page.nextCursor).toBeNull();
    expect(page.hasMore).toBeNull();
    expect(hasMore(page)).toBeNull();
    // «نمی‌دانیم ادامه دارد یا نه» با «ادامه ندارد» فرق دارد:
    expect(isCompletePage(page)).toBe(false);
  });

  it("auto-detects a single array property but refuses ambiguous payloads", () => {
    const detected = normalizePage<{ id: string }>({ products: [{ id: "1" }] }, "CURSOR");
    expect(itemsOf(detected)).toEqual([{ id: "1" }]);
    expect(() => normalizePage({ one: 1, two: "2" }, "CURSOR")).toThrow(PaginationContractError);
    expect(() => normalizePage(null, "CURSOR")).toThrow(PaginationContractError);
  });

  it("honours an explicit itemsPath for domain-specific envelopes", () => {
    const page = normalizePage<{ id: string }>({ wholesale_order_items: [{ id: "1" }], count: 1 }, "OFFSET", {
      itemsPath: "wholesale_order_items",
    });
    expect(itemsOf(page)).toEqual([{ id: "1" }]);
  });

  it("summarises only real totals and never invents one", () => {
    expect(pageSummary(normalizePage({ items: [1], pagination: { page: 1, limit: 10, total: 42 } }, "OFFSET"))).toEqual({
      shown: 1,
      total: 42,
    });
    expect(pageSummary(normalizePage({ items: [1] }, "CURSOR"))).toEqual({ shown: 1, total: null });
  });

  it("keeps pagination metadata out of the UI error path", () => {
    const failed = { ok: false as const, error: new ApiError({ kind: "NETWORK_ERROR", message: "x" }) };
    const state = stateFromResult<unknown[]>(failed, () => true);
    expect(state.status).toBe("NETWORK_ERROR");
    expect(state).not.toHaveProperty("data");
  });

  it("builds next-page queries for every mode without loading everything", () => {
    const offset = normalizePage<number>({ items: [1], pagination: { page: 1, limit: 25, total: 100 } }, "OFFSET");
    expect(nextRequestQuery(offset)).toEqual({ page: 2, limit: 25 });
    const keyset = normalizePage<number>({ items: [1], nextKey: "k1", limit: 25 }, "KEYSET");
    expect(nextRequestQuery(keyset)).toEqual({ key: "k1", limit: 25 });
  });
});
