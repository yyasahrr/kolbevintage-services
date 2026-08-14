# Kolbe Vintage Wholesale Dashboard — Design & Build Notes

Reference notes distilled from skill guides + repo audit. Internal working document.

## Repo audit (2026-08-14)

- Stack: React 19.2 + Vite 7 + TypeScript 5.9 (strict) + Tailwind CSS 4 (`@tailwindcss/vite`)
- Extras: `clsx`, `tailwind-merge`, `cn()` util, Inter font, `vite-plugin-singlefile` (single-HTML build)
- Existing content: an unrelated MR MARVIS storefront demo (single product page). **No router, no auth, no admin area, no chart libs, no design system beyond demo components, no tests.**
- → Greenfield build of the wholesale ops dashboard inside this Vite app.

## Distilled guidance (from skill packs)

### frontend-design (anthropics)
- One signature element; everything else quiet and disciplined.
- Typography carries personality; structure encodes meaning (numbering only for true sequences — order lifecycle IS a sequence).
- Avoid the three AI-default looks (cream+serif+terracotta, near-black+acid-green, broadsheet hairlines).
- Ground the design in the subject: escrow, ledgers, consignment notes, vintage textile trade.

### web-interface-guidelines (vercel) — key rules
- `:focus-visible` rings everywhere; never bare `outline-none`. Icon buttons need `aria-label`.
- Semantic HTML first (`<table>`, `<button>`, `<label>`). Headings hierarchical; skip link.
- `prefers-reduced-motion` honored; animate transform/opacity only; no `transition: all`.
- `tabular-nums` for number columns; `Intl.*` for dates/numbers; `…` not `...`.
- URL reflects state (filters/tabs/pagination in query params). Deep-link stateful UI.
- Dark mode: `color-scheme: dark` on `<html>`; native selects need explicit bg/color.
- Long content: `truncate`/`line-clamp`; flex children `min-w-0`; empty states required.
- Mobile: `touch-action: manipulation`, `overscroll-behavior: contain` in drawers, 44px targets.

### react-best-practices (vercel) — rules we will apply
- No inline component definitions inside components.
- Memoize expensive derived aggregates; build `Map`/`Set` indexes once (`js-index-maps`, `js-set-map-lookups`).
- Primitive deps in effects; derive state during render, not effects.
- `React.lazy` for secondary routes; direct imports (no barrels).
- Combine filter/map passes; early exits; `toSorted()` for immutable sorts.

### playwright-cli (microsoft)
- `playwright-cli open|goto|snapshot|click|fill|resize|console|screenshot` for interactive verification; plus Playwright spec files for repeatable e2e tests.

## Core domain rules (from the brief — non-negotiable)

- VIP Customer ↔ Kolbe Vintage ↔ Supplier. Customer NEVER sees supplier.
- Customer Order ≠ Fulfillment Request ≠ Settlement. 1 Order → N FRs → N Settlements.
- Settlement computed per FulfillmentRequest on fulfilled items only:
  `Supplier Payable = Fulfilled Amount − KV Commission − Refunds − Damage Adj − Other Adj`
- Escrow lifecycle: Held → (Frozen | Inspection) → Ready → Partially Released → Released/Refunded.
- 72h inspection after delivery; expiry ⇒ settlement-eligible; dispute freezes escrow.
- Status vocabularies fixed (Order / Fulfillment / Escrow / Settlement) — single source in `domain/status.ts`.

## Open questions

100-question checklist answered by the user (see conversation). Critical: UI language, currency, storefront demo fate, chart approach, brand accent, page depth.
