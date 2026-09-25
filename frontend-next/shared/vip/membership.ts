/**
 * Phase 6.3-B — VIP/wholesale membership adapter (browser-independent).
 *
 * Derives the UX gating decision purely from the server-authoritative `Session`
 * (`GET /auth/me` → `vip`). The browser never infers membership from cache; this
 * module is the single place that turns the server VIP context into a gate the
 * VIP portal can render against. No network, no localStorage — pure and testable.
 */
import type { Session, VipEntitlements } from "../session/types";

const NO_ENTITLEMENTS: VipEntitlements = { catalog: false, rfq: false, orders: false };

export type VipGate =
  /** Not signed in → send to sign-in. */
  | { state: "anonymous" }
  /** Signed in but no wholesale membership → eligibility / application experience. */
  | { state: "ineligible" }
  /** Application submitted, awaiting approval. */
  | { state: "pending"; accountId: string | null }
  /** Approved member → full portal (per-capability access via `entitlements`). */
  | {
      state: "active";
      accountId: string | null;
      memberName: string | null;
      storeName: string | null;
      planName: string | null;
      expiresAt: string | null;
      entitlements: VipEntitlements;
    };

/**
 * Map a server session to the VIP gate. `null`/anonymous session → `anonymous`;
 * missing or `none` VIP context → `ineligible` (never "active" from absence).
 */
export function resolveVipGate(session: Session | null | undefined): VipGate {
  if (!session || session.status !== "authenticated") return { state: "anonymous" };
  const vip = session.vip;
  if (!vip || vip.status === "none") return { state: "ineligible" };
  if (vip.status === "pending") return { state: "pending", accountId: vip.accountId };
  return {
    state: "active",
    accountId: vip.accountId,
    memberName: vip.memberName,
    storeName: vip.storeName,
    planName: vip.planName,
    expiresAt: vip.expiresAt,
    entitlements: vip.entitlements ?? NO_ENTITLEMENTS,
  };
}

/**
 * Phase 6.3-B — capability entitlements, taken ONLY from the server-derived VIP
 * context. Membership (`status==="active"`) never implies a capability: an
 * approved account without an active subscription has `catalog` but NOT `rfq`.
 * Anonymous / ineligible / pending / missing context → all capabilities false.
 */
export function resolveVipCapabilities(session: Session | null | undefined): VipEntitlements {
  if (!session || session.status !== "authenticated") return NO_ENTITLEMENTS;
  return session.vip?.entitlements ?? NO_ENTITLEMENTS;
}

/** True only when the server confirms an approved (active) membership. */
export function isActiveVip(session: Session | null | undefined): boolean {
  return resolveVipGate(session).state === "active";
}

/** True only when the server grants the RFQ entitlement (membership + subscription). */
export function canUseRfq(session: Session | null | undefined): boolean {
  return resolveVipCapabilities(session).rfq === true;
}
