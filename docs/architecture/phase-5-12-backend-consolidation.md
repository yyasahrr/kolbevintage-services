# Phase 5.12-A — Backend Consolidation Route and Writer Inventory

This is the Checkpoint A index. The detailed human-readable ownership map is
in [phase-5-12-backend-consolidation-legacy-cutover.md](phase-5-12-backend-consolidation-legacy-cutover.md),
and the executable-data companion is
[phase-5-12-route-inventory.json](phase-5-12-route-inventory.json).

Checkpoint A performed the first safe writer cutover. Checkpoint B moved all
20 legacy business reads behind authenticated Nest projections while retaining
their compatibility paths and response shapes. Checkpoint C converges the 11
remaining business commands and the Admin operational-log edge on named Nest
owners. The inventory now contains no legacy read, legacy write, missing seam,
or remove-later entry.

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

The route inventory has zero `LEGACY_READ`, `LEGACY_WRITE`,
`MISSING_CANONICAL_SEAM`, and `REMOVE_LATER` entries.

## Checkpoint C writer convergence

- Suppliers owns application creation and the transactional approval workflow;
  approval creates the supplier and initial membership once, while rejection
  creates neither.
- Catalog owns supplier submissions and moderation. Supplier identity comes
  from the authenticated membership and moderation uses an explicit legacy
  status mapping.
- Offers owns quote submission, RFQ creation, and integer basis-point bulk
  pricing. Money remains integer IRR and bulk changes are transactional.
- VIP owns customer applications and account decisions; Auth alone changes the
  user role and token version.
- CMS accepts only the known storefront presentation keys and preserves the
  existing dedicated hero/banner video storage contract.
- Support owns the atomic combined status/reply command.
- Analytics exposes the bounded, Admin-only operational-log projection and
  audited resolve command.
- Every migrated compatibility command dispatches before Next database setup.
  An unavailable canonical API returns `503 CANONICAL_API_UNAVAILABLE` without
  a SQL fallback.

The anonymous `POST logs/client` route remains a constrained infrastructure
telemetry ingest, and `try-on/*` remains an external-provider transport edge.
Neither is a business authority. Their bounded infrastructure persistence is
intentionally retained until the Phase 6 compatibility-edge removal.

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

## Remaining Next database access

Next retains database plumbing needed by compatibility reads plus the explicit
infrastructure/provider edges above. No active Phase 5.12 business read or
command uses Next SQL authority, and the compatibility file contains no direct
business-table mutation. Superseded read-only SQL branches remain unreachable
behind the pre-database cutover dispatcher and are scheduled for physical
deletion with the compatibility surface in Phase 6.
