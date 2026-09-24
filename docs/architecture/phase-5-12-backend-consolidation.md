# Phase 5.12-A — Backend Consolidation Route and Writer Inventory

This is the Checkpoint A index. The detailed human-readable ownership map is
in [phase-5-12-backend-consolidation-legacy-cutover.md](phase-5-12-backend-consolidation-legacy-cutover.md),
and the executable-data companion is
[phase-5-12-route-inventory.json](phase-5-12-route-inventory.json).

Checkpoint A performed the first safe writer cutover. Checkpoint B moved all
20 legacy business reads behind authenticated Nest projections while retaining
their compatibility paths and response shapes. Writers without an exact
canonical command contract remain classified rather than rushed into invented
endpoints. Phase 5.12-C has not started.

## Checkpoint B read convergence

- Auth and customer profile reads use canonical Auth.
- Supplier session, products, orders, RFQs and support reads derive the tenant
  from canonical membership.
- VIP account, catalog and order reads derive the account from the session.
- Admin business lists are protected by the existing Admin role boundary.
- Storefront settings and video reads cross the public Nest projection while
  retaining the legacy streaming contract.
- Nest outage returns `503 CANONICAL_API_UNAVAILABLE`; no migrated read uses a
  Next SQL fallback.

The route inventory now has zero `LEGACY_READ` entries and retains all 11
`LEGACY_WRITE` entries for later Phase 5.12 work.

## Local worktree classification

| Existing local change | Decision | Result |
|---|---|---|
| Initial route/owner document | KEEP + COMPLETE | Retained as the detailed route map and paired with machine-readable inventory |
| Initial early write dispatcher | FIX + COMPLETE | Body consumption, auth forwarding, cookies, bearer identity, internal token, status parity and upstream failure semantics corrected |
| Guessed CMS import mapping | REMOVE-AS-INVALID | CMS import reads legacy settings; it is not an equivalent settings writer |
| Guessed wholesale raw proxy | REMOVE-AS-INVALID | Existing compatibility translator and VIP precheck are required for parity |

## Checkpoint A migrated writers

- Auth register/login/logout and TOTP commands now reach Nest Auth before any
  Next database initialization.
- Supplier login reaches Nest Auth.
- Supplier support case creation reaches Nest Support.
- Supplier order transitions reach Nest Orders state-machine endpoints.
- Admin wholesale cancellation reaches Nest Orders.
- Retail checkout and canonical wholesale order creation retain their existing
  Nest adapters.

No compatibility route falls back to its SQL implementation when the selected
Nest owner is unavailable. Unavailable Nest returns a truthful 503.

## Explicit remaining writer debt

Supplier application/submission/quote, VIP application/decision, SiteBuilder
settings, supplier approval, catalog moderation, unsafe bulk pricing, RFQ
creation, combined admin ticket status/reply, and operational log state still
have no proven parity-safe canonical command at this checkpoint.
They remain visible as `LEGACY_WRITE` or `REMOVE_LATER` in the inventory and
must be handled by later Phase 5.12 work. Checkpoint A makes no claim that the
read cutover is complete.
