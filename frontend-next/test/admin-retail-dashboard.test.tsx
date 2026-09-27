// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("../shared/http/clients", () => ({ canonicalClient: () => ({ request }) }));

import AdminRetailDashboard from "../storefront/pages/AdminRetailDashboard";

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({
    range: { preset: "LAST_30_DAYS" },
    sales: { ordersCount: "4", unitsOrdered: "9", orderedGmv: "1250000", paidOrdersCount: "3" },
    operations: { awaitingPayment: 1, fulfillmentBacklog: 2, shipmentBacklog: 1,
      returnsByStatus: {}, refundsByStatus: {}, flaggedReviews: 0, inventory: { tracked: 7, stockout: 1 } },
    exceptions: { payments: [{ id: "p1", orderCode: "R-42", status: "failed", failureReason: "درگاه پاسخ نداد" }], shipments: [] },
    generatedAt: "2026-09-27T12:00:00.000Z",
  });
});
afterEach(() => cleanup());

describe("admin retail dashboard canonical read", () => {
  it("renders server-derived sales and queues from the protected endpoint", async () => {
    render(<AdminRetailDashboard />);
    await screen.findByText("درگاه پاسخ نداد");
    expect(request).toHaveBeenCalledWith("/admin/retail/dashboard", expect.objectContaining({
      query: { preset: "LAST_30_DAYS" },
    }));
    expect(screen.getByText("R-42", { exact: false })).toBeTruthy();
    expect(screen.getByText("۱٬۲۵۰٬۰۰۰ ریال")).toBeTruthy();
  });

  it("shows a recoverable failure without synthetic metrics", async () => {
    request.mockRejectedValueOnce(new Error("مجوز مشاهده ندارید"));
    render(<AdminRetailDashboard />);
    await screen.findByRole("alert");
    expect(screen.getByText("مجوز مشاهده ندارید")).toBeTruthy();
    expect(screen.queryByText("ارزش سفارش")).toBeNull();
  });
});
