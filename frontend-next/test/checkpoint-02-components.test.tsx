import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dialog, EmptyState, ErrorState, Money, PasswordField, ProductCardRetail, ProductCardWholesale } from "../shared/components";

function PasswordHarness({ disabled = false, error }: { disabled?: boolean; error?: string }) {
  const [value, setValue] = useState("secret");
  return <PasswordField label="رمز عبور" value={value} onChange={setValue} hint="حداقل هشت نویسه" error={error} disabled={disabled} />;
}

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return <><button type="button" onClick={() => setOpen(true)}>باز کردن</button><Dialog open={open} onOpenChange={setOpen} title="پنجره آزمایشی">محتوا</Dialog></>;
}

describe("Checkpoint 02 shared interactions", () => {
  it("toggles PasswordField with stable ids, ref and accessible error linkage", () => {
    const ref = createRef<HTMLInputElement>();
    const { rerender } = render(<PasswordField ref={ref} label="رمز عبور" value="secret" onChange={() => {}} error="رمز معتبر نیست" />);
    const input = screen.getByLabelText("رمز عبور");
    const id = input.id;
    expect(ref.current).toBe(input);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain("-error");
    fireEvent.click(screen.getByRole("button", { name: "نمایش رمز عبور" }));
    expect(input.getAttribute("type")).toBe("text");
    expect(screen.getByRole("button", { name: "پنهان کردن رمز عبور" }).getAttribute("aria-pressed")).toBe("true");
    rerender(<PasswordField ref={ref} label="رمز عبور" value="secret" onChange={() => {}} error="رمز معتبر نیست" />);
    expect(screen.getByLabelText("رمز عبور").id).toBe(id);
  });
  it("keeps disabled PasswordField controls disabled", () => {
    render(<PasswordHarness disabled />);
    expect((screen.getByLabelText("رمز عبور") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "نمایش رمز عبور" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("supports native keyboard activation for the visibility button", () => {
    render(<PasswordHarness />);
    const button = screen.getByRole("button", { name: "نمایش رمز عبور" });
    button.focus();
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.click(button);
    expect(screen.getByLabelText("رمز عبور").getAttribute("type")).toBe("text");
  });
  it("opens, labels and closes a dialog with Escape", () => {
    const onOpenChange = vi.fn();
    render(<Dialog open onOpenChange={onOpenChange} title="تأیید عملیات" description="این عمل نیاز به تأیید دارد">متن</Dialog>);
    const dialog = screen.getByRole("dialog", { name: "تأیید عملیات" });
    expect(dialog.hasAttribute("open")).toBe(true);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it("moves focus into the dialog and returns it to the opener", async () => {
    render(<DialogHarness />);
    const opener = screen.getByRole("button", { name: "باز کردن" });
    opener.focus();
    fireEvent.click(opener);
    const closer = screen.getByRole("button", { name: "بستن" });
    await waitFor(() => expect(document.activeElement).toBe(closer));
    fireEvent.click(closer);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
  it("formats canonical money strings without losing precision", () => {
    render(<Money value="900719925474099312345" options={{ digits: "en" }} />);
    expect(screen.getByText("900,719,925,474,099,312,345 تومان").isConnected).toBe(true);
  });
  it("keeps retail and wholesale semantics distinct", () => {
    render(<><ProductCardRetail id="r" name="کت پشمی" image={{ src: "/coat.jpg", alt: "کت پشمی" }} price="1200000" salePrice="990000" promotionLabel="فروش ویژه" /><ProductCardWholesale id="w" name="پیراهن عمده" image={{ src: "/shirt.jpg", alt: "پیراهن عمده" }} wholesalePrice="450000" moq="12" moqUnit="عدد" packageLabel="سری شش‌تایی" availability={{ label: "موجود", intent: "success" }} sellerType="KOLBE" /></>);
    expect(screen.getByText("فروش ویژه").isConnected).toBe(true);
    expect(screen.getByText("حداقل سفارش").isConnected).toBe(true);
    expect(screen.getByText("کلبه").isConnected).toBe(true);
  });
  it("shows the Kolbe badge only for the canonical seller type", () => {
    render(<ProductCardWholesale id="w" name="پیراهن عمده" image={{ src: "/shirt.jpg", alt: "پیراهن عمده" }} wholesalePrice="450000" moq="12" moqUnit="عدد" availability={{ label: "موجود", intent: "success" }} sellerType="SUPPLIER" sellerName="تأمین‌کننده پارس" />);
    expect(screen.queryByText("کلبه")).toBeNull();
    expect(screen.getByText("تأمین‌کننده پارس").isConnected).toBe(true);
  });
  it("never represents an error as an empty state", () => {
    const retry = vi.fn();
    const { rerender } = render(<ErrorState title="دریافت اطلاعات ناموفق بود" onRetry={retry} />);
    expect(screen.getByRole("alert").isConnected).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /تلاش دوباره/ }));
    expect(retry).toHaveBeenCalledOnce();
    rerender(<EmptyState title="موردی ثبت نشده" />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
