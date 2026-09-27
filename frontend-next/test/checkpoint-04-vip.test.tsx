import { cleanup, render, screen, waitFor } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ApiClient } from "../shared/http/types";
import { WholesaleCatalogList } from "../storefront/pages/WholesaleCatalog";
import { canonicalVipPath } from "../storefront/pages/VIPPortal";

afterEach(() => cleanup());
const ROOT = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("Checkpoint 04 VIP information architecture", () => {
  it("exposes the canonical commerce and account navigation without unsupported areas", () => {
    const shell = read("storefront/vip/VipCommerceShell.tsx");
    for (const label of ["فروشگاه عمده", "سفارش‌ها", "فاکتورها", "پشتیبانی", "عضویت VIP", "آدرس‌های ارسال"]) expect(shell).toContain(label);
    expect(shell).not.toContain("اعضای تیم");
    expect(shell).not.toContain("مرجوعی");
    expect(shell).not.toMatch(/اعلان|unread|>۲</);
  });

  it("maps compatibility routes toward canonical buyer surfaces", () => {
    expect(canonicalVipPath("/wholesale-dashboard")).toBe("/vip");
    expect(canonicalVipPath("/vip/store")).toBe("/vip");
    expect(canonicalVipPath("/vip/reorder")).toBe("/vip/orders");
    expect(canonicalVipPath("/vip/catalog/p1")).toBe("/vip/catalog/p1");
  });

  it("removes browser-owned and fixture-owned wholesale truth from active VIP runtime", () => {
    const runtime = stripComments([read("storefront/pages/VIPPortal.tsx"), read("storefront/vip/VipCommerceShell.tsx"), read("storefront/vip/VipRoutePages.tsx")].join("\n"));
    for (const forbidden of ["kv_wholesale_draft", "sampleOrders", "loadTickets", "saveTickets", "Date.now", "data/catalog", "Math.round", "0.68", "localStorage", "تهران"]) expect(runtime).not.toContain(forbidden);
  });

  it("uses pathname navigation for canonical VIP routes", () => {
    const router = read("storefront/router.tsx");
    expect(router).toContain('window.history.pushState(null, "", target)');
    expect(router).toContain('target.startsWith("/vip")');
  });
});

describe("Checkpoint 04 canonical catalog presentation", () => {
  it("shows the Kolbe badge only for canonical KOLBE sellerType", async () => {
    const client = { requestResult: async () => ({ ok: true, data: { items: [
      { id: "k", name: "کالای کلبه", ownerType: "KOLBE", priceFrom: "1000", availability: 2 },
      { id: "s", name: "کالای تأمین‌کننده", ownerType: "SUPPLIER", priceFrom: "900", availability: 4 },
      { id: "u", name: "کالای نامشخص", ownerType: "UNKNOWN", priceFrom: "800", availability: 1 },
    ], nextCursor: null, hasMore: false }, meta: { status: 200 } }) } as unknown as ApiClient;
    const { container } = render(<WholesaleCatalogList client={client} onOpen={() => {}} />);
    await waitFor(() => expect(screen.getByText("کالای کلبه")).toBeTruthy());
    expect(container.querySelectorAll(".kolbe-wholesale-card__badge")).toHaveLength(1);
    expect(container.querySelector(".kolbe-wholesale-card__badge")?.textContent).toBe("کلبه");
  });

  it("keeps mobile, theme, RTL-safe logical layout and reduced-motion foundations", () => {
    const css = read("shared/design/components.css");
    expect(css).toContain("@media (max-width: 340px)");
    expect(css).toContain("inset-inline-start");
    expect(css).toContain("var(--kolbe-color-background)");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).not.toContain("grid-template-columns: 238px");
  });
});
