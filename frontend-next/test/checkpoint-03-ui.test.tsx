import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { AuthError, AuthForm, AuthHeader, AuthPanel, AuthShell, AuthStory } from "../shared/auth";
import { Button, PasswordField, TextField } from "../shared/components";

function AuthHarness() {
  const [password, setPassword] = useState("secret");
  return <AuthShell story={<AuthStory eyebrow="PORTAL" title="داستان کلبه" description="شرح" />}><AuthPanel><AuthHeader eyebrow="ورود" title="ورود آزمایشی" description="شرح فرم"/><AuthForm onSubmit={(event) => event.preventDefault()}><TextField label="ایمیل"/><PasswordField label="رمز عبور" value={password} onChange={setPassword}/><AuthError error={{ kind: "UNAUTHORIZED", title: "ورود ناموفق", message: "اطلاعات درست نیست", retryAfterSeconds: null }}/><Button type="submit">ورود</Button></AuthForm></AuthPanel></AuthShell>;
}

describe("Checkpoint 03 shared auth UI", () => {
  it("renders one meaningful heading, labelled fields and alert semantics", () => {
    render(<AuthHarness/>);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByLabelText("ایمیل").isConnected).toBe(true);
    expect(screen.getByLabelText("رمز عبور").isConnected).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("اطلاعات درست نیست");
  });

  it("uses the shared password visibility control", () => {
    render(<AuthHarness/>);
    const input = screen.getByLabelText("رمز عبور");
    fireEvent.click(screen.getByRole("button", { name: "نمایش رمز عبور" }));
    expect(input.getAttribute("type")).toBe("text");
  });

  it("keeps portal auth source on shared PasswordField", () => {
    for (const file of ["storefront/pages/Static.tsx", "storefront/pages/VIPPortal.tsx", "storefront/pages/AdminPortal.tsx", "supplier-src/auth.tsx"]) {
      const source = readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");
      expect(source).toContain("PasswordField");
      expect(source).not.toMatch(/<input[^>]+type=["']password["']/);
    }
  });

  it("uses semantic theme tokens, RTL logical properties, mobile layout and reduced motion", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "../shared/design/components.css"), "utf8");
    expect(css).toContain(".kolbe-auth");
    expect(css).toContain("var(--kolbe-color-background)");
    expect(css).toContain("inset-inline-end");
    expect(css).toContain("@media (max-width: 340px)");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});
