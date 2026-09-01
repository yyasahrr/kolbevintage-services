export type WholesaleMembership = {
  customerId?: string;
  planId: string;
  planName: string;
  memberName: string;
  storeName: string;
  phone: string;
  city: string;
  activatedAt: string;
  expiresAt: string;
  status: "active";
  vip: boolean;
};

export const WHOLESALE_MEMBERSHIP_KEY = "kv_wholesale_membership";

export function loadWholesaleMembership(): WholesaleMembership | null {
  try {
    const raw = localStorage.getItem(WHOLESALE_MEMBERSHIP_KEY);
    return raw ? (JSON.parse(raw) as WholesaleMembership) : null;
  } catch {
    return null;
  }
}

export function saveWholesaleMembership(membership: WholesaleMembership) {
  localStorage.setItem(WHOLESALE_MEMBERSHIP_KEY, JSON.stringify(membership));
}
