// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("../shared/http/clients", () => ({ canonicalClient: () => ({ request }) }));

import AdminCRM from "../storefront/pages/AdminCRM";

const contact = {
  id: "contact-1", name: "مینا رضایی", phone: "09120000000", email: null,
  city: "تهران", stage: "LEAD", assignedAdminName: null,
};

beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (path: string) => path.endsWith("/contact-1")
    ? { contact }
    : { items: [contact], total: 1, limit: 20, offset: 0 });
});
afterEach(() => cleanup());

describe("admin CRM canonical contact surface", () => {
  it("loads contacts and detail from the protected CRM endpoints", async () => {
    render(<AdminCRM />);
    await screen.findByText("مینا رضایی");
    expect(request).toHaveBeenCalledWith("/admin/crm/contacts", expect.objectContaining({
      query: expect.objectContaining({ limit: 20, offset: 0 }),
    }));
    fireEvent.click(screen.getByRole("button", { name: /مینا رضایی/ }));
    await screen.findByRole("region", { name: "جزئیات مشتری" });
    expect(request).toHaveBeenCalledWith("/admin/crm/contacts/contact-1");
  });

  it("sends the server-owned stage filter and does not invent a VIP membership join", async () => {
    render(<AdminCRM />);
    await screen.findByText("مینا رضایی");
    fireEvent.change(screen.getByLabelText("مرحله"), { target: { value: "CONTACTED" } });
    await waitFor(() => expect(request).toHaveBeenCalledWith("/admin/crm/contacts", expect.objectContaining({
      query: expect.objectContaining({ stage: "CONTACTED", offset: 0 }),
    })));
    cleanup();
    render(<AdminCRM initialView="vip" />);
    expect(screen.getByText("فیلتر VIP در CRM موجود نیست")).toBeTruthy();
  });

  it("shows a recoverable error rather than sample data", async () => {
    request.mockRejectedValueOnce(new Error("دسترسی مجاز نیست"));
    render(<AdminCRM />);
    await screen.findByRole("alert");
    expect(screen.getByText("دسترسی مجاز نیست")).toBeTruthy();
    expect(screen.queryByText("مینا رضایی")).toBeNull();
  });
});
