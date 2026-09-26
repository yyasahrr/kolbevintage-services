# Kolbe Design Engineering Standard

**Status:** ACTIVE · supersedes the Hard Design Freeze for design decisions
**Scope:** Storefront, Retail, VIP/Wholesale, Supplier, Admin, CMS
**Enforced by:** `frontend-next/truth-registry.ts` (`designChangePolicy`) + `frontend-next/test/phase-6-0-truth-registry.test.ts`

---

## 1. Why this document exists

Phase 6.0–6.2 ran under a **Hard Design Freeze**: while backend truth was being
moved out of the browser, page composition and navigation had to stay stable so
every diff was provably about *data ownership*. That migration has completed for
the migrated surfaces, so the freeze is retired.

It is **not** replaced by "anything may change". Ungoverned design freedom
produces visual churn, generic dashboard aesthetics, and one-off colours, radii
and durations invented per screen. This standard replaces a prohibition with a
**classification protocol** and a **style lock**.

**Design freedom is not architecture freedom.** Under every policy below, these
remain authoritative and non-negotiable:

| Authority | Meaning in practice |
|---|---|
| Backend truth | No frontend-invented business state, no fake calculations, no silent degradation |
| Domain ownership | A surface reads the module that owns the data; no cross-module invention |
| Business invariants | Money is a decimal string at the boundary; identity is server-derived; the backend owns idempotency |
| Kolbe brand identity | The Heritage palette and semantic token roles are the source of style truth |
| RTL | Persian is the primary language; RTL is not an afterthought |
| Accessibility | Mandatory, not a polish step |

---

## 2. The classification protocol

Every significant surface must be classified **before** it is modified. The
classification is recorded in `frontend-next/truth-registry.ts` as
`designChangePolicy`, one of:

### `PRESERVE`
The current structure already serves the workflow. Allowed: wiring to real
backend capability, state coverage (loading/empty/error/permission), correctness
fixes, small usability fixes, accessibility fixes. **Not allowed:** changing the
information architecture, navigation model, or visual language.

### `EXTEND`
Keep the existing visual and interaction language; **add** the missing
backend-supported capabilities. The screen's mental model survives; it gains
sections, columns, actions or states.

### `RESTRUCTURE`
The current information architecture or interaction model **prevents a complete,
usable workflow**. Structural redesign is allowed while retaining Kolbe identity.
A `RESTRUCTURE` decision **must** carry a written `designChangeRationale` in the
registry, and the registry test rejects a rationale shorter than 120 characters
or one attached to a surface whose business truth is still unresolved
(`LOCAL_STORAGE`, `STATIC_FIXTURE`, `HARDCODED_RUNTIME`, `UNKNOWN`) — you do not
redesign a screen whose data is still fake.

### Rules that apply to all three

- **Do not redesign unrelated screens.** A classification is scoped to one
  registry entry.
- **Do not create visual churn.** If a screen is not blocking a workflow, it is
  `PRESERVE`.
- **Existing good UI is not redesigned merely because redesign is now allowed.**
- **Subtraction before restyling.** When a screen feels wrong, first remove
  duplication and decorative weight; only then restructure.

---

## 3. Brand contract (style lock)

The style lock is **derived from existing Kolbe source**, not invented.

### 3.1 Semantic colour roles

Source of truth: `frontend-next/storefront/designSystem.ts` → `ThemeTokens`,
active theme `heritage` ("میراث کلبه").

| Role | Light | Dark | Use |
|---|---|---|---|
| `background` | `#f7f5f0` | `#10161d` | Page canvas |
| `surface` | `#fffdfa` | `#18222c` | Cards, panels, dialogs |
| `surfaceMuted` | `#efede7` | `#202d38` | Nested/recessed areas, table header |
| `text` | `#071c31` | `#f5f0e8` | Primary copy |
| `muted` | `#66727d` | `#acb8c2` | Secondary copy, hints |
| `primary` | `#0b2a46` | `#d9bd91` | Primary action, active nav |
| `primaryText` | `#ffffff` | `#17130e` | Label on primary |
| `accent` | `#c9654d` | `#e07a61` | Emphasis, links, active marker |
| `border` | `#d8d3ca` | `#354552` | Hairlines and outlines |
| `focus` | `#547a98` | `#e2c89e` | Focus ring |

**Rules**

- Never hardcode a hex in a component. Use the semantic role.
- Never use `primary` and `accent` in the same visual gesture — one primary
  action per region.
- Dark mode is a **role swap, not an inversion**: the Heritage dark primary is a
  warm sand (`#d9bd91`) on a deep navy canvas. Do not "just invert".
- Status colours (success/warning/danger/info) must be paired with a non-colour
  cue (icon, label, or text) — colour is never the only signal.

### 3.2 Typography

Persian-first. Source of truth: `app/globals.css`, `public/supplier-portal/portal.css`.

- **UI / body / operational software:** `Vazirmatn, ui-sans-serif, system-ui, sans-serif`
- **Storefront display only:** `Playfair Display, serif` (marketing/display
  surfaces). Never used in Supplier or Admin operational UI.
- Tabular/identifier content (SKU, UUID, order codes, money) uses a
  monospace or `font-variant-numeric: tabular-nums` treatment with LTR isolation.

**Type roles** — operational software uses a compact scale; marketing surfaces
may use a display scale. Do not mix them.

| Role | Operational (Supplier/Admin) | Storefront display |
|---|---|---|
| Page title | 18–20px / 600 | display scale |
| Section title | 14–15px / 600 | — |
| Body | 13px / 400 | 15–16px |
| Caption / hint | 11–11.5px / 400, `muted` | — |

Persian copy is longer than English at equal meaning. **Never set a fixed pixel
width on a control that carries a Persian label.**

### 3.3 Spacing rhythm

Source of truth: `public/supplier-portal/portal.css` (layered over platform tokens).

| Token | Value | Use |
|---|---|---|
| `--sp-space-1` | 4px | Inline icon-to-label gap, tight pairs |
| `--sp-space-2` | 8px | Default intra-component gap |
| `--sp-space-3` | 12px | Component padding, field gaps |
| `--sp-space-4` | 16px | Section padding |
| `--sp-space-6` | 24px | Between sections |

Each token falls back to `--kolbe-space-*`, so a platform-level change
propagates. **Do not introduce arbitrary one-off values** (`gap: 6px`,
`padding: 13px`) — if the rhythm does not fit, the rhythm is wrong, not the
screen.

### 3.4 Shape language

| Token | Value | Use |
|---|---|---|
| `--sp-radius-control` | `0.625rem` (10px) | Inputs, buttons, selects, chips |
| `--sp-radius-surface` | `1rem` (16px) | Cards, panels, dialogs |
| pill | `999px` | Only for genuine status chips and toggles |

**Rules**

- Two radii only. A third radius is a defect.
- Do **not** wrap every subsection in a rounded card. Use spacing, alignment and
  grouping to express hierarchy; use a border or surface only when the region is
  genuinely separable.
- **Card-inside-card-inside-card is banned.** At most one nesting level.

### 3.5 Information density

Kolbe's Supplier and Admin software is **dense operational software**, not a
dashboard template.

- Prefer tables over card grids for collections with ≥3 attributes per row.
- Tables get internal scroll containers; the **page** never scrolls horizontally.
- KPI tiles are allowed only when the number is real and server-derived.
  **No fake KPIs, no decorative pills, no invented metrics.**
- Every section must not receive identical visual weight. Establish one clear
  primary action per screen.

---

## 4. App-shell and per-portal rules

### Storefront (public / retail)
- Display typography allowed. Editorial hierarchy. Conversion-oriented content
  order. Motion may be expressive here.
- Still bound by: real data only, RTL, accessibility, token use.

### Supplier portal
- **Operational.** Vazirmatn only. Dense tables. Clear step architecture for
  transactional editors. Server validation mapped to the responsible section.
- Never a landing page. No hero, no marketing gradient, no scroll theatre.

### Admin
- **Operational, highest density.** Bulk tables, filters, bulk actions.
- Destructive/irreversible actions require explicit confirmation and must state
  the concrete consequence in Persian.
- Admin must be able to inspect **all** submitted information before approving.
  An approve action that hides part of the graph is a correctness defect.

### VIP / Wholesale
- Buyer-facing but operational. Must expose **commercial truth**: seller,
  variant selection, MOQ **with its real unit**, package type, package
  composition, pricing tiers.
- **Never flatten SERIES into PIECE.** A buyer must be able to tell a series
  offer from a per-piece offer.
- Membership ≠ entitlement. Viewing the catalog grants no RFQ/order capability.

---

## 5. RTL, localisation and numeric isolation

- `dir="rtl"` is the default for all Persian surfaces.
- Use **logical CSS properties** (`margin-inline-start`, `padding-inline`,
  `border-inline-start`, `inset-inline`) — never physical `left`/`right` for
  content that must mirror.
- **LTR islands** for content that must not mirror: SKU, UUID, order codes,
  identifiers, Latin brand names, and money values. Isolate with `dir="ltr"` on
  the element plus `unicode-bidi: isolate` where needed.
- Money is displayed from the **decimal string** returned by the API. Format
  with a Persian thousands separator (`٬`) and Latin or Persian digits
  consistently — but never re-derive the value with JS number arithmetic.
- Long Persian copy must wrap. Test with a realistic worst case (≥60 characters)
  and confirm no truncation, no overflow, no clipped focus ring.

---

## 6. State contract

Every surface declares its `uiStates` in the registry. The standard set:

`LOADING` · `READY_WITH_DATA` · `READY_EMPTY` · `VALIDATION_ERROR` ·
`UNAUTHORIZED` · `FORBIDDEN` · `NOT_FOUND` · `CONFLICT` · `RATE_LIMITED` ·
`SERVER_ERROR` · `NETWORK_ERROR` · `PROVIDER_UNAVAILABLE`

**Rules**

- **An error is never collapsed into an empty array.** `catch { return [] }` for
  a business read is banned. An empty state must be provably empty.
- `READY_EMPTY` and `SERVER_ERROR` must be visually distinguishable and must
  read differently aloud.
- `LOADING` must not be a full-screen spinner for a section refresh; use
  in-place skeleton or a subdued busy marker that keeps context.
- `CONFLICT` (stale state after another actor acted) must explain what changed
  and offer a re-read, not just "try again".
- Every state is announced to assistive technology (`role="status"` for
  transient, `role="alert"` for errors).

---

## 7. Form rules

Operational editors follow an explicit **state machine**, not ad-hoc flags:

`idle → dirty → validating → invalid | valid → submitting → submitted | failed`

- One primary submit action; it is disabled while `submitting` (UI replay
  protection) while **backend idempotency remains the authority**.
- Validation errors are bound to the **responsible field or section**, with a
  section-level summary when the section is off-screen.
- Server validation errors are mapped to the section that owns the field — never
  dumped into a generic banner.
- Every input has an accessible name from its `<label>` (not `placeholder`).
- Required vs optional is stated in text, not colour alone.
- Hints and errors live in the same slot so layout does not jump.
- Destructive field actions (remove variant, remove media) are reversible or
  confirmed.

---

## 8. Table, drawer and dialog rules

- **Tables:** sticky header where useful; internal horizontal scroll; row
  actions reachable by keyboard; sort/filter state reflected in the accessible
  name; empty and error states inside the table region.
- **Drawers/dialogs:** focus moves in on open, is trapped while open, returns to
  the trigger on close; `Escape` closes; the backdrop is labelled; the dialog
  announces its title.
- Dialogs are for decisions that block progress. Not for content that could be
  inline.

---

## 9. Motion

Motion is applied **after** functional behaviour, accessibility and responsive
behaviour are stable. Motion must communicate **state, causality, hierarchy or
spatial continuity**.

Allowed:
- Section transitions in a stepped editor (spatial continuity: where did I come
  from, where am I going).
- Drawer/dialog enter/exit that expresses origin.
- Brief confirmation of a completed mutation (causality).
- Selection feedback for variant/package choice (causality).

Banned:
- Scroll theatre in operational software.
- Constant card entrance animations.
- Moving primary targets.
- Decorative parallax.
- Spring motion that delays access to information.
- Any motion that stands in for business truth ("optimistic-feeling feedback"
  must never display an unconfirmed business result).

**`prefers-reduced-motion: reduce`** must disable non-essential motion entirely.
State must remain legible without motion.

---

## 10. Anti-slop checklist

Run this before declaring L6 on any surface:

- [ ] No card-inside-card-inside-card
- [ ] At most two radii in use
- [ ] No duplicate labels for the same control
- [ ] No fake KPI styling / invented numbers
- [ ] No decorative pills without semantic function
- [ ] No gradients or glows without a brand role
- [ ] No unnecessary glassmorphism
- [ ] No meaningless motion
- [ ] Exactly one competing primary action per region
- [ ] Not every section at identical visual weight
- [ ] Does not look like a generic SaaS dashboard template
- [ ] No arbitrary one-off spacing / radii / colours
- [ ] No fixed widths that fail Persian copy
- [ ] Mobile is a designed adaptation, not desktop squeezed smaller
- [ ] Every displayed number traces to a server value

**Prefer subtraction before restyling.** Kolbe must look like Kolbe.

---

## 11. Responsive matrix (mandatory)

Every L6 surface is verified at:

`320×568` · `360×800` · `390×844` · `430×932` · `768×1024` · `820×1180` ·
`1024×768` · `1280×720` · `1366×768` · `1440×900` · `1920×1080` · `2560×1440`

Pass criteria: no page-level horizontal overflow; tables scroll only inside
their intended container; touch targets ≥ 40px in the small viewports; sticky
action areas survive narrow widths or degrade to a normal flow position;
200% zoom does not clip content.

---

## 12. Accessibility (mandatory, not a polish step)

- Full keyboard completion of every workflow.
- Visible focus using the `focus` role token; never `outline: none` without a
  replacement.
- Logical tab order matching visual order in RTL.
- Accessible names on every control, derived from labels.
- Error announcements via `role="alert"` / `aria-describedby`.
- Colour never the only state cue.
- Dialog/drawer focus management and `Escape`.
- `prefers-reduced-motion` respected.
- Light and dark themes both verified.

---

## 13. Completeness model (unchanged, restated)

Design work does not change the completeness ladder:

`L0` schema · `L1` domain · `L2` API · `L3` lossless lifecycle ·
`L4` frontend capability · `L5` real browser workflow · `L6` production UX.

**A feature is not complete below L5. It is not production-ready below L6.**
A `RESTRUCTURE` that ships without L5 evidence is theatre over a fake workflow
and is rejected by the registry test.
