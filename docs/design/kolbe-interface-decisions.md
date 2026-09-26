# Kolbe Interface Decisions

**Status:** ACTIVE log · companion to `kolbe-design-engineering-standard.md`
**Rule:** every significant surface is classified before it is modified. The
authoritative record is `frontend-next/truth-registry.ts` (`designChangePolicy`);
this file holds the evidence and reasoning behind the classifications that
involve change.

---

## Current wave classifications (Phase 6.3-C / 6.7 Supplier Product L5–L6)

### `supplier-products-intake` → **RESTRUCTURE**

**Audit evidence.** The staged product editor is an eight-step wizard
(`frontend-next/supplier-src/pages/product-editor/`, steps verified in a real
browser: اطلاعاتِ پایه · رسانه · واریانت‌ها · موجودی · پیشنهادِ تجاری و MOQ ·
سری/بسته‌ها · پله‌های قیمت · بازبینی و ارسال). It reaches L4: the category
`attributes_schema` drives real inputs, a colour×size matrix produces real
variants with real SKUs, media upload returns real server URLs, and the review
step shows the real MOQ unit, package composition and decimal-string money.

**Why PRESERVE/EXTEND is not enough.** Three structural problems block the
operator task:

1. **Accumulated state is invisible.** Only one section is mounted at a time, so
   an operator editing pricing tiers cannot see the variants the tiers apply to.
   For a transactional editor with cross-section dependencies (package items
   reference variant SKUs; tiers reference package quantities) this is a
   workflow blocker, not a preference.
2. **Validation arrives only at submit time.** The domain validator
   (`catalog.logic.ts`) reports ~24 distinct codes
   (`OVERLAPPING_PRICING_TIER`, `PACKAGE_TOTAL_MISMATCH`,
   `SIZE_RUN_NEEDS_MULTIPLE_SIZES`, …). None of them is surfaced next to the
   responsible section before submit.
3. **Density fails narrow viewports.** The variant matrix, package builder and
   tier editor have no usable small-screen form.

**Retained.** Kolbe identity, Vazirmatn, the eight domain sections (they are the
domain's shape, not an arbitrary IA choice), and the draft/review/submit mental
model. **Not** rebuilt: the browser-independent core (`product-graph.ts`) and
the backend graph.

### `vip-wholesale-catalog` → **RESTRUCTURE**

**Audit evidence (measured, not impressionistic).** Across the two VIP surfaces:

| File | `moq` | `package` | `tier` | `seller` |
|---|---|---|---|---|
| `storefront/pages/VIPPortal.tsx` | 1 | 0 | 0 | 0 |
| `storefront/pages/Wholesale.tsx` | 0 | 0 | 0 | 3 |

Package type and pricing tiers are **never** mentioned; MOQ appears once in
total; seller identity is absent from the VIP portal. Meanwhile the backend
exposes all of it: `GET /catalog/browse?channel=wholesale` and
`GET /catalog/products/:id?channel=wholesale` return variants, offers, media,
MOQ + MOQ unit, package type, package composition and pricing tiers.

**Consequence.** A VIP buyer cannot distinguish a SERIES offer from a per-piece
offer, cannot see the quantity break that changes the unit price, and cannot see
whose goods they are buying. That is a workflow the backend supports and the UI
silently omits — the exact failure this project forbids.

**Retained.** Canonical cursor pagination, decimal-string money, and the
entitlement boundary (membership ≠ capability). The card/preview information
architecture is what changes.

### `admin-supplier-product-moderation` → **EXTEND**

**Audit evidence.** The page already reads the canonical submission graph
(`reviews.list()` / `reviews.get()` only), exposes exactly the three real
backend actions, requires an explicitly chosen canonical product for
approve-as-existing, and re-reads from the server after any action. Its
information architecture is sound.

**Why not RESTRUCTURE.** Nothing about the structure prevents the workflow. The
gaps are coverage, not composition: full `uiStates` handling, explicit
stale-state `CONFLICT` recovery, and UI replay protection on the destructive
approve/reject actions (with backend idempotency remaining authoritative).

### `shared-theme` → **EXTEND**

The semantic token architecture (Heritage light/dark roles, Persian-first
Vazirmatn) is retained as the single source of style truth. Extended with
governed tokens for density, motion and reduced-motion plus the numeric/LTR
isolation role, so screens stop inventing one-off colours, radii and durations.

### `supplier-auth-application` → **PRESERVE**

Shell, session lifecycle and application flow already serve the workflow. Only
wiring and state correctness change.

### `vip-membership` → **PRESERVE**

The server-authoritative VIP session and the membership-vs-entitlement
separation are the security boundary for 6.3-C. Preserved deliberately:
restructuring the thing that enforces entitlements while exposing the catalog
would be the wrong order of operations.

---

## Explicit non-goals for this wave

- No redesign of Storefront marketing surfaces (they are `PRESERVE` and are not
  blocking a workflow).
- No Style Builder work — it lives outside the current remote tree and is
  deliberately untouched.
- No motion work before L5 is green.
