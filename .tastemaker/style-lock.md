# Kolbe Style Lock

Locked from existing Kolbe source. Do not re-derive per screen.

## Colour — semantic roles only
Source: `frontend-next/storefront/designSystem.ts` → `themeTemplates[heritage]`.
Never hardcode a hex in a component.

| role | light | dark |
|---|---|---|
| background | #f7f5f0 | #10161d |
| surface | #fffdfa | #18222c |
| surfaceMuted | #efede7 | #202d38 |
| text | #071c31 | #f5f0e8 |
| muted | #66727d | #acb8c2 |
| primary | #0b2a46 | #d9bd91 |
| primaryText | #ffffff | #17130e |
| accent | #c9654d | #e07a61 |
| border | #d8d3ca | #354552 |
| focus | #547a98 | #e2c89e |

Dark mode is a **role swap**, not an inversion. Heritage dark primary is warm
sand on deep navy.

## Typography
- UI / operational: `Vazirmatn, ui-sans-serif, system-ui, sans-serif`
- Storefront display only: `Playfair Display, serif` — never in Supplier/Admin
- SKU / UUID / codes / money: tabular numerals + LTR isolation

## Spacing (source: `public/supplier-portal/portal.css`)
`--sp-space-1` 4px · `-2` 8px · `-3` 12px · `-4` 16px · `-6` 24px
No one-off values.

## Shape
`--sp-radius-control` 0.625rem · `--sp-radius-surface` 1rem · pill 999px (chips only)
Two radii. A third is a defect. Max one card nesting level.

## Density
Dense operational software. Tables over card grids for ≥3 attributes/row.
Page never scrolls horizontally; tables scroll internally.
No fake KPIs. One primary action per region.

## Banned
card-in-card-in-card · third radius · arbitrary spacing · hardcoded hex ·
fixed px width on Persian labels · decorative gradient/glow · glassmorphism ·
scroll theatre · entrance animation on every card · moving primary targets
