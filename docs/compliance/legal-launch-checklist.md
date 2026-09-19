# Legal Launch Checklist — Kolbe Vintage (Phase 4.7.5)

> Status ladder per item (lowest → highest):
> `TECHNICALLY IMPLEMENTED` → `CONFIGURED` → `OFFICIAL SOURCE VERIFIED` → `LEGAL COUNSEL APPROVED` → `TAX ACCOUNTANT APPROVED` → `EXTERNAL PROVIDER APPROVED` → `PRODUCTION VERIFIED`.
> Only the first rung can be reached by engineering.
> **As of Phase 4.7.5 no item is beyond TECHNICALLY IMPLEMENTED unless stated.**
> This document does not assert legal compliance.

| # | Item | Current rung | What is still needed to climb | Owner |
|---|---|---|---|---|
| 1 | Versioned Terms of Service (RETAIL) | TECHNICALLY IMPLEMENTED | counsel-written text → publish v1 (`POST /admin/compliance/policies`, `/publish`) | counsel + admin |
| 2 | Versioned Privacy Policy (RETAIL, WHOLESALE_VIP, SUPPLIER, PUBLIC) | TECHNICALLY IMPLEMENTED | counsel text per scope; confirm arts. 58–59 obligations (S-01) and PDP bill status (S-09) | counsel |
| 3 | Retail return / withdrawal policy with `rule_parameters.returnWindowDays` | TECHNICALLY IMPLEMENTED | counsel confirms window (S-01 art. 37 ≥ 7 working days) and exceptions (S-10); admin publishes; until then `RETURN_WINDOW_NOT_CONFIGURED` | counsel |
| 4 | Wholesale Terms (WHOLESALE_VIP) — gates order confirmation | TECHNICALLY IMPLEMENTED | counsel text; B2B scope confirmation (S-14) | counsel |
| 5 | Supplier Agreement (SUPPLIER) — owner-bound acceptance, settlement precondition | TECHNICALLY IMPLEMENTED | counsel text; signing-role policy review (`SUPPLIER_CONTRACT_SIGNING_ROLES`) | counsel + ops |
| 6 | Marketing / cookie notices + explicit consent events | TECHNICALLY IMPLEMENTED | notice texts; UI wiring of consent toggles; confirm art. 55 opt-in vs opt-out reading | counsel + product |
| 7 | Business legal identity (`business_legal_profile`) | TECHNICALLY IMPLEMENTED (empty) | admin enters real legal name, entity type, registration & tax ids, address, support & complaint contacts — **never placeholders**; `disclosureGaps` must be empty | admin/legal |
| 8 | eNAMAD credential | TECHNICALLY IMPLEMENTED (registry only) | obtain real eNAMAD (S-08) → create credential → admin verifies with `verificationSource` | ops |
| 9 | Business / industry licences, tax registration credentials | TECHNICALLY IMPLEMENTED (registry only) | obtain real documents (S-12) → verify | ops/legal |
| 10 | Retail pre-contract disclosure bundle + immutable snapshot | TECHNICALLY IMPLEMENTED | set `KOLBE_RETAIL_LEGAL_GATE=enforce` on the Next server and `KOLBE_INTERNAL_API_TOKEN` on both sides; optionally `KOLBE_RETAIL_DISCLOSURE_STRICT=1`; counsel reviews art. 33/34 field coverage; **tax line is NOT itemized** until item 15 | eng + counsel |
| 11 | Wholesale confirmation legal snapshot | TECHNICALLY IMPLEMENTED (active) | none technically; counsel review of what a snapshot must contain | counsel |
| 12 | Supplier KYB (profile, documents, review, holds) | TECHNICALLY IMPLEMENTED | document list per entity type from counsel; reviewer SOP; `s3_private` storage adapter + `KOLBE_PRIVATE_STORAGE_DIR` / bucket policy; malware scanning (scan_status stays `unavailable`) | legal + ops + eng |
| 13 | Supplier bank destination | TECHNICALLY IMPLEMENTED (hash + mask only) | KMS/vault or provider-side tokenization before any payout (Phase 4.8); ownership verification source; `KOLBE_SETTLEMENT_REQUIRES_BANK_VERIFICATION` stays `1` | eng + finance |
| 14 | Product provenance & publication gate | TECHNICALLY IMPLEMENTED (`external` mode) | counsel decides mandatory fields for imported/second-hand goods (S-02, S-11); decide `strict` vs `external`; reviewer SOP | legal + ops |
| 15 | Tax configuration (`VAT_RATE_PERCENT`) | TECHNICALLY IMPLEMENTED (absent) | accountant supplies rate/exemptions with source (S-07) → `verify` → `activate`; until then invoices are `not_assessed` | tax accountant |
| 16 | Commercial invoices (wholesale child orders) | TECHNICALLY IMPLEMENTED | accountant review of layout/fields (S-02 art. 3, S-05); retail invoice issuance is **not implemented** (retail orders live in the legacy Next handler) | tax accountant + eng |
| 17 | Fiscal document / سامانه مؤدیان submission | TECHNICALLY IMPLEMENTED (port + fake only) | decide obligation & type (S-03/S-05/S-06); contract a trusted provider or direct integration; implement a real adapter; `TAX_INVOICE_PROVIDER_MODE` must never be `fake` in production (refused) | tax accountant + eng + provider |
| 18 | Data-subject request workflow | TECHNICALLY IMPLEMENTED | SOP for identity verification and response times (counsel); owner services to add their export slices | counsel + eng |
| 19 | Retention policies | TECHNICALLY IMPLEMENTED (drafts, dry-run only) | durations with sources (S-15) → `verify` → `activate`; destructive execution is **not implemented** by design | counsel + accountant |
| 20 | Legal holds | TECHNICALLY IMPLEMENTED | SOP; who may place/release | legal |
| 21 | Audit of privileged actions | TECHNICALLY IMPLEMENTED | retention of `audit_log` decided under item 19 | eng |
| 22 | Hashing key management | TECHNICALLY IMPLEMENTED | set `KOLBE_COMPLIANCE_HASH_KEY` (≥ 16 chars) in production; rotation plan | ops |

## Production configuration still required (Part 48)

| Variable | Where | Required value / note |
|---|---|---|
| `KOLBE_COMPLIANCE_HASH_KEY` | Nest API | ≥ 16 chars; mandatory in production (startup fails closed) |
| `KOLBE_INTERNAL_API_TOKEN` | Nest API **and** Next server | shared secret for `/legal/retail/checkout-binding`; mandatory in production (503 otherwise) |
| `KOLBE_RETAIL_LEGAL_GATE` | Next server | `enforce` at launch (`off` = legacy, evidence-less checkout) |
| `KOLBE_RETAIL_DISCLOSURE_STRICT` | Nest API | `1` to refuse checkout while `disclosureGaps` (other than tax) exist |
| `KOLBE_PRODUCT_COMPLIANCE_GATE` | Nest API | `external` (default) / `strict` / `off` — decided with legal |
| `KOLBE_SETTLEMENT_REQUIRES_BANK_VERIFICATION` | Nest API | keep `1` |
| `KOLBE_PRIVATE_STORAGE_DIR` | Nest API | private, non-web-served path (interim); replace by `s3_private` adapter |
| `KOLBE_COMPLIANCE_MAX_DOCUMENT_BYTES` | Nest API | default 5 MiB |
| `KOLBE_COMPLIANCE_DOCUMENT_URL_TTL_SECONDS` | Nest API | default 300, max 900 |
| `TAX_INVOICE_PROVIDER_MODE` | Nest API | `disabled` until a real provider adapter exists; `fake` is refused in production |

## Explicit non-claims (repeat of the phase report)

* Legal counsel review: **NO**. Tax accountant review: **NO**. eNAMAD verified: **NO**.
* Real tax API (سامانه مؤدیان) integration: **NO**. Tax invoice submitted or accepted by any authority: **NO**.
* Real payment provider / carrier: **NO** (fake adapters only, refused in production).
* Wallet, settlement, payout, withdrawal: **NO** (Phase 4.8 not started; only a read-only eligibility contract exists).
