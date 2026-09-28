/**
 * Phase 4.7.5 — Compliance public contract.
 *
 * Other modules (finance, catalog, invoicing, future checkout) depend on these
 * types and on `ComplianceService` / `SupplierComplianceService` /
 * `ProductComplianceService` — never on compliance tables.
 *
 * Everything here is a TECHNICAL contract. Nothing in this file asserts that
 * Kolbe is legally compliant; legal sufficiency is decided by counsel
 * (see docs/compliance/legal-launch-checklist.md).
 */

export type LegalPolicyScope = "RETAIL" | "WHOLESALE_VIP" | "SUPPLIER" | "PUBLIC";
export type LegalPolicyType =
  | "TERMS_OF_SERVICE"
  | "PRIVACY_POLICY"
  | "RETAIL_RETURN_POLICY"
  | "WHOLESALE_TERMS"
  | "SUPPLIER_AGREEMENT"
  | "MARKETING_NOTICE"
  | "COOKIE_NOTICE";

export type ComplianceActor = { userId: string | null; role: "customer" | "vip" | "supplier" | "admin" | "finance" | "system" };

export type RequestMetadata = { ip?: string | null; userAgent?: string | null; requestId?: string | null };

/** One published policy version inside a requirement bundle / transaction snapshot. */
export type PolicyBundleEntry = {
  documentId: string;
  policyType: LegalPolicyType;
  scope: LegalPolicyScope;
  version: number;
  contentHash: string;
  acceptanceRequired: boolean;
  reacceptanceRequired: boolean;
};

export type MissingPolicy = PolicyBundleEntry & { reason: "NEVER_ACCEPTED" | "REACCEPTANCE_REQUIRED" };

export type AcceptanceStatus = {
  scope: LegalPolicyScope;
  satisfied: boolean;
  required: PolicyBundleEntry[];
  missing: MissingPolicy[];
};

/** Subject of an acceptance: an authenticated user, or a guest identified by contact. */
export type AcceptanceSubject = { userId?: string | null; contact?: string | null; supplierId?: string | null };

export type TransactionSnapshotInput = {
  scope: "RETAIL" | "WHOLESALE" | "SUPPLIER";
  wholesaleOrderId?: string | null;
  retailOrderRef?: string | null;
  supplierId?: string | null;
  userId?: string | null;
  subjectHash: string;
  policyBundle: PolicyBundleEntry[];
  disclosure?: Record<string, unknown> | null;
  commercialSnapshot?: unknown;
};

/** Server-priced retail facts supplied by the checkout owner (never trusted from the browser). */
export type RetailCheckoutFacts = {
  orderRef: string;
  currency: string;
  lines: Array<{ ref: string; name: string; quantity: number; unitPrice: string; lineTotal: string }>;
  shipping: { method: string; label: string; price: string } | null;
  totals: { items: string; shipping: string; grand: string };
  paymentMethod: string;
};

export type RetailCheckoutGateInput = {
  subject: { userId?: string | null; phone?: string | null; email?: string | null };
  acceptedPolicyDocumentIds: string[];
  facts: RetailCheckoutFacts;
  requestMetadata?: RequestMetadata | null;
};

export type SettlementEligibilityReason =
  | "SUPPLIER_COMPLIANCE_PROFILE_MISSING"
  | "SUPPLIER_COMPLIANCE_NOT_APPROVED"
  | "SUPPLIER_CONTRACT_NOT_ACCEPTED"
  | "SUPPLIER_CONTRACT_OUTDATED"
  | "SUPPLIER_VERIFICATION_INCOMPLETE"
  | "SUPPLIER_BANK_NOT_VERIFIED"
  | "SUPPLIER_COMPLIANCE_HOLD_ACTIVE";

/** Read-only eligibility contract for Phase 4.8. No balance, no payout, no money movement. */
export type SettlementEligibility = {
  supplierId: string;
  eligible: boolean;
  reasons: SettlementEligibilityReason[];
  checkedAt: string;
  /** Business-policy switches in force when evaluated (so the answer is explainable). */
  policy: { bankVerificationRequired: boolean };
};

export type ProductPublicationGateMode = "off" | "external" | "strict";

export type ProductPublicationDecision = {
  allowed: boolean;
  mode: ProductPublicationGateMode;
  complianceStatus: "unknown" | "pending_review" | "verified" | "rejected" | "restricted" | "missing";
  reasonCode: "PRODUCT_COMPLIANCE_BLOCKED" | "PRODUCT_COMPLIANCE_VERIFICATION_REQUIRED" | null;
};

/** Business policy: which supplier-team roles may bind the supplier to the Supplier Agreement. */
export const SUPPLIER_CONTRACT_SIGNING_ROLES: readonly string[] = ["owner"];
/** Business policy: roles that may manage KYB profile, documents and bank destinations. */
export const SUPPLIER_COMPLIANCE_MANAGER_ROLES: readonly string[] = ["owner", "finance"];
/** Business policy: roles that may read the supplier's compliance state. */
export const SUPPLIER_COMPLIANCE_VIEWER_ROLES: readonly string[] = ["owner", "finance", "sales", "warehouse"];

export function productPublicationGateMode(): ProductPublicationGateMode {
  const raw = (process.env.KOLBE_PRODUCT_COMPLIANCE_GATE || "external").trim().toLowerCase();
  return raw === "off" || raw === "strict" ? raw : "external";
}

export function settlementRequiresBankVerification(): boolean {
  return (process.env.KOLBE_SETTLEMENT_REQUIRES_BANK_VERIFICATION ?? "1") !== "0";
}
