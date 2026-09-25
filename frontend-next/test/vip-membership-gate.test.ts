import { describe, expect, it } from "vitest";
import { resolveVipGate, resolveVipCapabilities, isActiveVip, canUseRfq } from "../shared/vip/membership";
import { anonymousSession } from "../shared/session/auth-client";
import type { AuthenticatedSession, VipSessionContext, VipEntitlements } from "../shared/session/types";
import { createCapabilitySet } from "../shared/permissions/capabilities";

const authed = (vip: VipSessionContext | null): AuthenticatedSession => ({
  status: "authenticated",
  user: { id: "u1", email: "x@kolbe.test", role: "customer", name: "X", phone: null, totpEnabled: false },
  supplier: null,
  vip,
  capabilities: createCapabilitySet(),
  fetchedAt: new Date().toISOString(),
  source: "server",
});

const vipCtx = (status: VipSessionContext["status"], entitlements?: Partial<VipEntitlements>): VipSessionContext => ({
  status,
  accountId: status === "none" ? null : "acc1",
  memberName: "M", storeName: "S", planName: "P", expiresAt: null,
  entitlements: {
    catalog: status === "active",
    rfq: status === "active",
    orders: status === "active",
    ...entitlements,
  },
});

describe("Phase 6.3-B — resolveVipGate (server-authoritative membership)", () => {
  it("anonymous / missing session → 'anonymous'", () => {
    expect(resolveVipGate(null).state).toBe("anonymous");
    expect(resolveVipGate(undefined).state).toBe("anonymous");
    expect(resolveVipGate(anonymousSession()).state).toBe("anonymous");
  });

  it("authenticated with no/none VIP context → 'ineligible' (never active from absence)", () => {
    expect(resolveVipGate(authed(null)).state).toBe("ineligible");
    expect(resolveVipGate(authed(vipCtx("none"))).state).toBe("ineligible");
    expect(isActiveVip(authed(vipCtx("none")))).toBe(false);
  });

  it("pending membership → 'pending' with account id", () => {
    const gate = resolveVipGate(authed(vipCtx("pending")));
    expect(gate.state).toBe("pending");
    if (gate.state === "pending") expect(gate.accountId).toBe("acc1");
  });

  it("approved membership → 'active' with member/store/plan", () => {
    const gate = resolveVipGate(authed(vipCtx("active")));
    expect(gate.state).toBe("active");
    if (gate.state === "active") {
      expect(gate.accountId).toBe("acc1");
      expect(gate.storeName).toBe("S");
    }
    expect(isActiveVip(authed(vipCtx("active")))).toBe(true);
  });
});

describe("Phase 6.3-B — membership ≠ capability (entitlements are server-derived)", () => {
  it("approved account WITHOUT an active subscription: catalog yes, RFQ NO", () => {
    // Server says: active membership, catalog granted, but rfq entitlement false.
    const session = authed(vipCtx("active", { catalog: true, rfq: false, orders: true }));
    expect(resolveVipGate(session).state).toBe("active"); // membership is active…
    const caps = resolveVipCapabilities(session);
    expect(caps.catalog).toBe(true);
    expect(caps.rfq).toBe(false); // …but RFQ is NOT granted by membership alone
    expect(canUseRfq(session)).toBe(false);
  });

  it("anonymous / ineligible / pending sessions grant no capabilities", () => {
    expect(resolveVipCapabilities(null)).toEqual({ catalog: false, rfq: false, orders: false });
    expect(resolveVipCapabilities(anonymousSession())).toEqual({ catalog: false, rfq: false, orders: false });
    expect(resolveVipCapabilities(authed(vipCtx("none")))).toEqual({ catalog: false, rfq: false, orders: false });
    expect(resolveVipCapabilities(authed(vipCtx("pending")))).toEqual({ catalog: false, rfq: false, orders: false });
  });

  it("fully entitled VIP has catalog + rfq + orders", () => {
    const caps = resolveVipCapabilities(authed(vipCtx("active")));
    expect(caps).toEqual({ catalog: true, rfq: true, orders: true });
    expect(canUseRfq(authed(vipCtx("active")))).toBe(true);
  });
});
