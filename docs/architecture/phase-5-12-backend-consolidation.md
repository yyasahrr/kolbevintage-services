# Phase 5.12-A — Backend Consolidation Route and Writer Inventory

This is the Checkpoint A index. The detailed human-readable ownership map is
in [phase-5-12-backend-consolidation-legacy-cutover.md](phase-5-12-backend-consolidation-legacy-cutover.md),
and the executable-data companion is
[phase-5-12-route-inventory.json](phase-5-12-route-inventory.json).

Checkpoint A performs the first safe writer cutover only. Existing reads and
writers without an exact canonical command contract are classified rather
than rushed into invented endpoints. Phase 5.12-B has not started.

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
