import { describe, expect, it } from "vitest";
import { resolveVipGate, isActiveVip } from "../shared/vip/membership";
import { anonymousSession } from "../shared/session/auth-client";
import type { AuthenticatedSession, VipSessionContext } from "../shared/session/types";
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

const vipCtx = (status: VipSessionContext["status"]): VipSessionContext => ({
  status, accountId: status === "none" ? null : "acc1", memberName: "M", storeName: "S", planName: "P", expiresAt: null,
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
