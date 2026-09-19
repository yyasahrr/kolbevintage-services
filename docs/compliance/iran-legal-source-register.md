# Iran Legal Source Register — Kolbe Vintage (Phase 4.7.5)

> **Status: TECHNICAL RESEARCH REGISTER — NOT LEGAL ADVICE.**
> This register lists the legal/regulatory sources that shaped the Phase 4.7.5
> compliance *foundation*. It was compiled by engineers from primary texts where
> they could be located and from secondary summaries otherwise. **Nothing here has
> been reviewed by Iranian legal counsel or a tax accountant.** Every entry carries
> a `verification_status`; anything not marked `PRIMARY_TEXT_CHECKED` must be
> treated as unverified. No statutory number (duration, threshold, rate) is
> hard-coded anywhere in the codebase because of this register — such values live
> in configurable, versioned records that ship **empty** (see "How the register is
> used" below).

Last research pass: 2026-09-19 (engineering). Persian calendar equivalents are
given where the source uses them.

## Legend

| Field | Meaning |
|---|---|
| `source_id` | Stable id referenced from code comments, `rule_parameters.sourceReference`, `tax_configuration.source_reference`, `data_retention_policy.legal_source_reference`, `product_compliance_record.source_register_refs`. |
| `kind` | `LEGAL_FACT` (statute/regulation text), `REGULATOR_GUIDANCE`, `BUSINESS_POLICY` (Kolbe's own choice), `INTERPRETATION` (engineering reading — needs counsel). |
| `verification_status` | `PRIMARY_TEXT_CHECKED` (an online copy of the enacted text was read; the *official gazette/portal* copy itself was **not** obtained) · `SECONDARY_ONLY` (only summaries seen) · `NEEDS_EXTERNAL_VERIFICATION` (unknown / must be confirmed by counsel or accountant). |
| `confidence` | engineering confidence that the summary is accurate: high / medium / low. |
| `impact` | which Phase 4.7.5 component the source shaped. |

Official portals that counsel should use to confirm each entry (not fetched during
this pass): سامانه ملی قوانین و مقررات (`dotic.ir`), مرکز پژوهش‌های مجلس (`rc.majlis.ir`),
سازمان امور مالیاتی (`intamedia.ir`), مرکز توسعه تجارت الکترونیکی (`ecommerce.gov.ir`,
`enamad.ir`).

---

## S-01 — قانون تجارت الکترونیکی (E-Commerce Law), enacted 1382/10/17 (Jan 2004)

* `kind`: LEGAL_FACT · `verification_status`: PRIMARY_TEXT_CHECKED (mirror copy of the
  enacted text; official portal copy not obtained) · `confidence`: high for the
  articles quoted below, medium for anything else.
* `jurisdiction`: national · `official_url`: NEEDS_EXTERNAL_VERIFICATION (mirror used:
  nezamat.ir/post-34221; secondary confirmation: ekhtebar.ir).
* Articles that shaped the foundation (paraphrased; the code never quotes them as
  compliance claims):
  * **Art. 33** — pre-contract information duty: goods/service characteristics;
    supplier identity, trade name and address; contact channel; *all* costs borne by
    the customer (price, taxes, shipping, contact costs); offer validity period;
    contract terms (payment, delivery, termination, after-sales).
    → `ComplianceService.buildRetailDisclosure()` (server-derived disclosure bundle,
    `disclosureGaps` list), `business_legal_profile` public view.
  * **Art. 34** — separate confirmation containing the complaint address,
    warranty/after-sales info, withdrawal terms per arts. 37/38, service-contract
    termination terms. → `complaint_contact` field; `RETAIL_RETURN_POLICY` type.
  * **Art. 35** — information must be on a durable medium, clear, timely.
    → immutable `transaction_compliance_snapshot` + content hashes (technical
    durability; legal sufficiency = INTERPRETATION, needs counsel).
  * **Art. 37** — in every distance transaction the consumer has **at least seven
    working days** to withdraw without penalty or reason; only return shipping may be
    charged. **Art. 38** — the period starts at delivery (goods) / conclusion
    (services), never before arts. 33/34 information is provided; refund must be
    prompt; exceptions are set by the regulation under **art. 79** (see S-10).
    → `RETAIL_RETURN_POLICY.rule_parameters.returnWindowDays` is **configurable and
    ships unset**; `evaluateReturnEligibility()` answers `RETURN_WINDOW_NOT_CONFIGURED`
    until a counsel-approved value is published. The code does **not** hard-code 7.
  * **Art. 42** — consumer-protection chapter does not apply to some categories
    (financial services, real estate, vending machines, public phones, auctions).
    → INTERPRETATION: wholesale/B2B scope handled separately (S-14).
  * **Art. 43** — silence is not consent. **Art. 55** — consumers must be able to decide
    about receiving advertising by post/e-mail.
    → append-only `consent_event` with explicit `granted`/`withdrawn`; Terms acceptance
    never implies marketing consent (`phase-4-7-5-policy-consent.test.ts`).
  * **Art. 46** — contractual terms contrary to the chapter / unfair terms are void.
    → policy text is counsel's job; the platform only versions and evidences it.
  * **Arts. 58–59** — sensitive personal data needs explicit consent; processing must
    have specified purposes, be minimal, accurate; subject may access/correct and may
    request erasure "subject to the relevant rules".
    → `data_subject_request` (access/correction/deletion/restriction), data
    minimization in DTOs, `docs/security/data-classification.md`.
  * **Arts. 6–16** — data messages / secure electronic records have evidentiary value.
    → INTERPRETATION: hashed, append-only acceptance evidence is *designed* to be
    usable as such; whether it qualifies as a "secure record" is for counsel.

## S-02 — قانون حمایت از حقوق مصرف‌کنندگان (Consumer Protection Law), 1388 (2009)

* `kind`: LEGAL_FACT · `verification_status`: SECONDARY_ONLY (law-firm/legal-portal
  mirrors of the text; official copy not obtained) · `confidence`: medium.
* Relevant duties as summarized by mirrors: **Art. 3** — suppliers must provide a
  warranty document (duration/type) together with a sales invoice showing price and
  date; provide type/quality/quantity/usage/production–expiry information; **Art. 5**
  — clear price display; **Art. 7** — false/misleading advertising prohibited;
  **Art. 18** — damages for defective goods.
* Impact: `commercial_invoice` (price + date + seller identity per line), condition
  class (`vintage`/`used`) disclosure fields in `product_compliance_record`.
  The exact invoice content list for consumer sales is NEEDS_EXTERNAL_VERIFICATION
  (the art. 3 note delegates a list of goods/values to a ministry regulation).

## S-03 — قانون پایانه‌های فروشگاهی و سامانه مؤدیان (Store Terminals & Taxpayers System Law), 1398/07/21 (Oct 2019)

* `kind`: LEGAL_FACT · `verification_status`: SECONDARY_ONLY (PDF mirrors and tax
  advisers' summaries; `intamedia.ir` official text not fetched) · `confidence`: medium.
* Summary seen: retailers dealing directly with final consumers must join the
  taxpayers system **and** use a store terminal (art. 2); other taxpayers must issue
  all invoices through the system; a per-period sales ceiling exists (art. 6);
  art. 14 مکرر sets a sales threshold above which natural persons become obliged
  (see S-06). Trusted service companies (شرکت‌های معتمد) may act for taxpayers.
* Impact: the `TaxInvoiceProvider` port (`prepare/validate/submit/queryStatus`),
  `fiscal_document` states, `fiscal_submission_event` history. **No real integration,
  schema, or credential is implemented.** Whether Kolbe is an obliged person, from
  which date, and with which invoice type is NEEDS_TAX_ACCOUNTANT_VERIFICATION.

## S-04 — قانون تسهیل تکالیف مؤدیان (Facilitation of Taxpayers' Obligations), 1402 (2023)

* `kind`: LEGAL_FACT · `verification_status`: SECONDARY_ONLY · `confidence`: low.
* Summary seen: transitional reliefs, e.g. card-reader / payment-gateway receipts
  counting as electronic invoices for certain taxpayers until the end of 1404.
* Impact: none hard-coded. Recorded so the accountant can decide whether a
  transitional regime applies to retail gateway payments. NEEDS_TAX_ACCOUNTANT_VERIFICATION.

## S-05 — دستورالعمل صدور صورتحساب الکترونیکی (INTA e-invoice issuance instruction)

* `kind`: REGULATOR_GUIDANCE · `verification_status`: SECONDARY_ONLY · `confidence`: medium.
* Summary seen: three invoice *types* (type 1 with buyer identity, type 2 without,
  type 3 for terminals) and several *patterns*; corrective / return / cancellation
  invoices reference the original tax id; submission window (summaries mention one
  week) after issuance.
* Impact: `fiscal_document` is a separate artifact from `commercial_invoice`;
  invoice void is a new state (never an edit) so a future "cancellation invoice" can
  reference the original. Field-level mapping is NOT implemented — it belongs to a
  real provider adapter. NEEDS_EXTERNAL_VERIFICATION.

## S-06 — INTA notices on mandatory type 1/2 e-invoices (e.g., notice no. 24 / 37, effective 1403/04/01)

* `kind`: REGULATOR_GUIDANCE · `verification_status`: SECONDARY_ONLY · `confidence`: low.
* Impact: none hard-coded; supports the `tax_configuration` design (source reference,
  effective date, version, `NEEDS_TAX_ACCOUNTANT_REVIEW`). Thresholds are NOT seeded.

## S-07 — قانون مالیات بر ارزش افزوده (VAT Law), 1400 (2021)

* `kind`: LEGAL_FACT · `verification_status`: NEEDS_EXTERNAL_VERIFICATION (not read in
  this pass) · `confidence`: n/a.
* Impact: `tax_configuration.VAT_RATE_PERCENT` is the *only* key the invoicing code
  understands, and it ships **absent**; invoices carry `tax_status = not_assessed` and
  `tax_total = 0` until an accountant publishes a VERIFIED, active rate with a source.
  Exemptions (e.g., for second-hand goods, if any) are unknown → not modelled.

## S-08 — نماد اعتماد الکترونیکی (eNAMAD) — regulations of مرکز توسعه تجارت الکترونیکی

* `kind`: REGULATOR_GUIDANCE · `verification_status`: SECONDARY_ONLY (`enamad.ir`
  regulation text not fetched) · `confidence`: medium for the requirement list, low
  for legal weight.
* Summary seen: identity verification of the business owner (age ≥ 18, domain
  ownership), contact details displayed, prices displayed, complaint handling through
  the eNAMAD system, refund possibility, validity of one year with renewal; in
  practice a payment gateway requires an active eNAMAD (Shaparak rule — S-13).
  eNAMAD itself is not described as a statutory obligation by the summaries seen.
* Impact: `business_compliance_credential` type `ENAMAD` with `unverified` default,
  admin-only verification with a source, public view shows a credential **only** when
  `verified` and unexpired. **No eNAMAD number is seeded; the UI never says
  "eNAMAD verified" without a verified credential row.**

## S-09 — لایحه حفاظت از داده‌های شخصی (Personal Data Protection Bill)

* `kind`: LEGAL_FACT (pending) · `verification_status`: NEEDS_EXTERNAL_VERIFICATION ·
  `confidence`: medium that it was *not* enacted as of the sources seen.
* Summary seen: approved by the cabinet in Tir 1403 (July 2024) and slated for the
  Majlis; enactment status as of 2026-09 unknown to engineering.
* Impact: privacy features are designed around S-01 arts. 58–59 today and are
  configurable (retention durations unset, DSAR workflow generic) so that an enacted
  law can be mapped without schema rewrites.

## S-10 — آیین‌نامهٔ اجرایی مادهٔ ۷۹ قانون تجارت الکترونیکی (withdrawal-right exceptions)

* `kind`: LEGAL_FACT · `verification_status`: NEEDS_EXTERNAL_VERIFICATION (not located).
* Impact: `RETAIL_RETURN_POLICY.rule_parameters.exclusions` is free-form and empty;
  counsel must supply the exception list (e.g., made-to-order or hygiene goods, if
  applicable to vintage apparel).

## S-11 — Import / provenance registration rules (سامانه جامع تجارت، شناسهٔ کالا)

* `kind`: LEGAL_FACT · `verification_status`: NEEDS_EXTERNAL_VERIFICATION.
* Impact: `product_compliance_record.regulatory_identifiers` is an open JSON object
  (no mandatory keys), `origin_type`/`origin_country` are declarative; supplier can
  never self-verify (`phase-4-7-5-product-compliance.test.ts`).

## S-12 — Business licensing for online retail (پروانهٔ کسب / مجوز کسب‌وکار اینترنتی)

* `kind`: LEGAL_FACT · `verification_status`: NEEDS_EXTERNAL_VERIFICATION.
* Impact: credential types `BUSINESS_LICENSE`, `INDUSTRY_LICENSE`; supplier KYB
  document types `business_license`, `registration_certificate`. Which licence Kolbe
  and each supplier need is a counsel question.

## S-13 — Payment-gateway / Shaparak merchant requirements

* `kind`: REGULATOR_GUIDANCE · `verification_status`: NEEDS_EXTERNAL_VERIFICATION.
* Impact: none in code (no real gateway exists — Phase 4.7/4.7.1 fake provider only).
  Listed because eNAMAD + merchant KYC will gate a real gateway later.

## S-14 — Scope of "consumer" (B2C) vs wholesale (B2B)

* `kind`: INTERPRETATION · `verification_status`: NEEDS_EXTERNAL_VERIFICATION.
* Engineering reading: S-01 art. 2 defines the consumer as a person acting for
  purposes other than trade/profession, so VIP wholesale buyers are presumptively
  **not** consumers under that chapter and are bound by `WHOLESALE_TERMS` instead.
  → strict scope separation (`RETAIL` vs `WHOLESALE_VIP`), tests prove that retail
  acceptances never satisfy wholesale gates and vice versa. Counsel must confirm the
  boundary and whether S-02 still applies to small traders.

## S-15 — Record-keeping durations (قانون تجارت مادهٔ ۱۳ دفاتر تجاری؛ قانون مالیات‌های مستقیم مادهٔ ۹۵ و آیین‌نامهٔ آن)

* `kind`: LEGAL_FACT · `verification_status`: NEEDS_EXTERNAL_VERIFICATION (engineering
  recollection of a ten-year commercial-books duty; not re-read in this pass).
* Impact: `data_retention_policy.retention_days` is nullable and **unset**; destructive
  actions cannot be activated unless `verification_status = VERIFIED` with a source
  (DB CHECK `data_retention_policy_destructive_requires_verification`). Financial and
  legal evidence categories are never deleted by a data-subject request
  (`NEVER_DELETED_CATEGORIES`).

---

## How the register is used (and what it is not)

| Concern | Where it lives | Default shipped | Who unblocks |
|---|---|---|---|
| Withdrawal window | `legal_policy_document(RETAIL_RETURN_POLICY).rule_parameters.returnWindowDays` | unset | legal counsel |
| Marketing consent | `consent_event` (append-only) | none granted | product + counsel (notice text) |
| Pre-contract disclosure fields | `buildRetailDisclosure()` + `business_legal_profile` | empty profile → `disclosureGaps` | admin data entry + counsel |
| VAT rate | `tax_configuration.VAT_RATE_PERCENT` | absent → `not_assessed` | tax accountant |
| E-invoice submission | `TaxInvoiceProvider` port | `disabled` in production, `fake` elsewhere | real provider + accountant |
| eNAMAD / licences | `business_compliance_credential` | none | admin with real credential |
| Retention durations | `data_retention_policy` | drafts only, dry-run only | counsel |
| Supplier agreement | `legal_policy_document(SUPPLIER_AGREEMENT)` | none published | counsel |

Separation kept throughout the code:

* **Documented legal fact** — only in this register, never as a hard-coded number.
* **Business policy** — explicit constants with comments (`SUPPLIER_CONTRACT_SIGNING_ROLES`,
  `INVOICEABLE_ORDER_STATUSES`, requirement bundle = "published + acceptance_required").
* **Configurable rule** — versioned DB records (`rule_parameters`, `tax_configuration`,
  `data_retention_policy`, env switches listed in the launch checklist).
* **Legal interpretation** — marked `INTERPRETATION` above; each needs counsel sign-off.

**This register does not make Kolbe compliant.** See
`docs/compliance/legal-launch-checklist.md` for the per-item status ladder
(TECHNICALLY IMPLEMENTED → … → PRODUCTION VERIFIED).
