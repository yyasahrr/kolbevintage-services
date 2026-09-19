# Data Classification — Kolbe Vintage (Phase 4.7.5)

Purpose: name every class of personal, legal and financial data the platform
stores, where it lives, who may read it and how it must be protected. This is a
technical control document; legal sufficiency (E-Commerce Law arts. 58–59 — see
`docs/compliance/iran-legal-source-register.md` S-01/S-09) is for counsel.

## Classes

| Class | Examples | Storage | Read access | Controls |
|---|---|---|---|---|
| **P0 — Secret** | password hashes/salts, TOTP secrets, session secret, `KOLBE_COMPLIANCE_HASH_KEY`, provider webhook secrets | `account_user` (hash/salt/totp), environment only | never returned by any API | never logged; env validation in production; rotate on suspicion |
| **P1 — Financial destination** | supplier IBAN / card / account number | **not stored in plaintext**: `supplier_bank_verification.normalized_hash` (HMAC-SHA256, keyed) + `masked_value` (`IR18****7890`) + verification status | supplier owner/finance (masked only), admin (masked only) | see "Bank data" below |
| **P2 — Identity documents** | business licence, tax certificate, ID document, representative authorization, provenance invoices | private object storage (`local_private` dir 0700 today; `s3_private` required for production) referenced by `supplier_compliance_document.object_key` / `product_compliance_document.object_key` | owner supplier (owner/finance) and admin, via **short-lived signed URL** (≤ 15 min) | `object_key` never serialized; MIME allow-list + magic bytes; size cap; checksum verified on download; issuance and download audited; scan status tracked (`unavailable` until a scanner exists) |
| **P3 — Contact / personal** | name, phone, e-mail, delivery address (`retail_order`, `wholesale_account`, `account_user`) | owner tables | data subject, admin, the supplier fulfilling the order (address slice only) | data minimization in DTOs; guest acceptance evidence stores only `subject_hash` (HMAC of normalized phone/e-mail), never the raw contact |
| **P4 — Legal evidence** | `legal_policy_acceptance`, `supplier_contract_acceptance`, `consent_event`, `transaction_compliance_snapshot`, `supplier_compliance_review` | append-only tables (DB triggers) | data subject (own rows), admin | immutable; hashed (`evidence_hash`, `request_metadata_hash`); never deleted by a data-subject request (`NEVER_DELETED_CATEGORIES`); `legal_hold` blocks deletion workflows |
| **P5 — Financial records** | proformas, payments, allocations, ledger, refunds, `commercial_invoice(_line)`, `fiscal_document`, `fiscal_submission_event` | finance/payments/invoicing tables | buyer (own), seller (own child), admin | issued invoices immutable (trigger); retention per accountant-verified policy only |
| **P6 — Internal assessments** | `supplier_compliance_review.notes`, `supplier_compliance_profile.risk_flags`, `product_compliance_record.review_notes`, `business_legal_profile.internal_notes`, `data_subject_request.decision_reason`, hold `notes` | compliance tables | **admin only** — stripped from every supplier/buyer projection (`supplierProfileView`, `documentView`, `productRecordView`, `subjectView`) | audited on write |
| **P7 — Public disclosure** | published policy text + hashes, sanitized business identity, **verified** credentials only | `legal_policy_document` (published/retired), `business_legal_profile` public view, `business_compliance_credential` (status = verified & unexpired) | anyone | drafts never public; unverified credentials never public |

## Request metadata

IP address and user agent are **not persisted** in compliance tables. Where
evidence needs them, a single `request_metadata_hash = sha256(ip \n ua \n requestId)`
is stored (`legal_policy_acceptance`, `supplier_contract_acceptance`). The legacy
retail audit log still stores `metadata.ip` (pre-existing behaviour, flagged for
the retention review; it is not new in this phase).

## Bank data (Part 16 decision)

The repository has **no encryption primitive / KMS integration**. Storing a
reversible IBAN would therefore mean plaintext-at-rest. Decision:

* store only `normalized_hash` (HMAC with `KOLBE_COMPLIANCE_HASH_KEY`) + `masked_value`
  + verification metadata (`status`, `holder_match_status`, `verification_source`,
  `provider_reference`);
* format validation only (IBAN mod-97, card Luhn) — **not** ownership verification;
* the full destination value must be re-collected or stored in a KMS-backed
  vault before any payout (Phase 4.8). This is a documented blocker in the launch
  checklist, not a hidden assumption.

## Hashing keys

`KOLBE_COMPLIANCE_HASH_KEY` (≥ 16 chars) is mandatory in production
(`ComplianceKeyring` fails closed). Development/test fall back to the session
secret with a purpose tag. Rotating the key invalidates guest subject matching
for future acceptances (past evidence remains valid as evidence, but cannot be
re-linked to a contact) — plan rotations with counsel.

## Access rules summary

* Supplier resources are authorized against the **specific supplier's membership
  and role** (`SUPPLIER_COMPLIANCE_MANAGER_ROLES` = owner/finance for writes,
  `SUPPLIER_CONTRACT_SIGNING_ROLES` = owner for the agreement). No "first
  membership wins".
* Buyers only ever address `/legal/me/*` — the subject is always the session.
* Admin actions are audited through `AuditService` with before/after facts.
* Public endpoints (`/legal/policies`, `/legal/business-profile`,
  `/legal/requirements`, `/legal/return-policy/evaluate`) are read-only. The only
  public write, `/legal/retail/checkout-binding`, is a server-to-server call
  protected by `KOLBE_INTERNAL_API_TOKEN` (mandatory in production) and writes
  only hashed, append-only evidence.
