import { describe, expect, it } from "vitest";
import { parseAuthMeResponse, anonymousSession } from "../shared/session/auth-client";

/**
 * Phase 6.3-B — the VIP membership context on the shared session comes only from
 * the server `/auth/me` body. The parser must never invent membership and must
 * reject malformed status values (so the browser can't be coerced into "active").
 */
const baseUser = { id: "u1", email: "vip@kolbe.test", role: "customer", name: "VIP", phone: null, totpEnabled: false, supplier: null };

describe("Phase 6.3-B — VIP session context parsing", () => {
  it("parses an active VIP context from /auth/me", () => {
    const res = parseAuthMeResponse({
      ...baseUser,
      vip: { status: "active", accountId: "acc1", memberName: "کاربر VIP", storeName: "فروشگاه", planName: "وی‌آی‌پی", expiresAt: "2027-01-01T00:00:00.000Z" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.vip?.status).toBe("active");
    expect(res.value.vip?.accountId).toBe("acc1");
  });

  it("parses a pending membership", () => {
    const res = parseAuthMeResponse({ ...baseUser, vip: { status: "pending", accountId: "acc2", memberName: null, storeName: null, planName: null, expiresAt: null } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.vip?.status).toBe("pending");
  });

  it("treats a missing/invalid vip body as null (never fabricates membership)", () => {
    const missing = parseAuthMeResponse({ ...baseUser });
    expect(missing.ok).toBe(true);
    if (missing.ok) expect(missing.value.vip).toBeNull();

    const bogus = parseAuthMeResponse({ ...baseUser, vip: { status: "super-user", accountId: "x" } });
    expect(bogus.ok).toBe(true);
    if (bogus.ok) expect(bogus.value.vip).toBeNull();
  });

  it("anonymous session carries no VIP context", () => {
    expect(anonymousSession().vip).toBeNull();
  });
});
