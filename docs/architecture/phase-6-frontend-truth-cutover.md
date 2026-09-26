# Phase 6 Frontend Truth Cutover

## Starting point and scope

Phase 6 starts at `4a2c7afb5b590d98568f6491e7a81fdb0ea36ecd`, after the complete Phase 5.13 backend gate. Canonical business authority is in Nest-owned domains backed by PostgreSQL. Phase 6 changes how the existing browser surfaces obtain and mutate that truth. It does not reopen backend ownership or redesign the product.

The machine-readable source of this plan is `frontend-next/truth-registry.ts`. Every registered feature identifies its surface, current source, canonical owner and HTTP contract, compatibility route, cutover checkpoint, preservation decision, UI states and parity evidence.

## Visual and feature freeze

Every registry entry has `visualFreeze: true`. Colors, typography, spacing, component style, page composition, navigation, RTL behavior, responsive behavior, visible capabilities and user journeys remain unchanged. Loading, empty, error, permission, retry, pagination and provider-unavailable states may be corrected using the existing visual language.

No valid capability is deleted because its current implementation is fake or incomplete. Such entries use `REPLACE_WITH_CORRECT_IMPLEMENTATION`. `DELETE_PROVEN_DUPLICATE` requires explicit duplicate evidence; Phase 6.0 contains zero deletion decisions.

## Frontend truth hierarchy

1. A canonical Nest response and server-derived session are authoritative for identity, roles, permissions, tenants, money, stock, orders and operational state.
2. The Next compatibility transport may translate the frozen frontend contract while a portal is being cut over. It cannot fall back to browser or SQL business authority.
3. Browser state may hold drafts and presentation preferences. It cannot establish a user ID, supplier ID, VIP account, Admin permission, price, discount, stock, settlement or workflow state.
4. CMS owns published/editorial content. Presentation defaults remain safe fallbacks. Editor caches are drafts only.
5. Catalog, Pricing and Promotions remain distinct from CMS and SiteBuilder even when one screen displays all of them.

## Compatibility and shared-client strategy

The current route inventory remains 47 routes: 42 Nest proxies, zero legacy reads, zero legacy writes, zero missing canonical seams, two deprecated routes and three static/mock routes. Phase 6.0 removes none of them. Each compatibility-dependent feature records both its current route and canonical target.

Phase 6.1 will provide one shared fetch/session/error/permission boundary for Retail, VIP, Supplier and Admin clients. It will use credentials-bearing requests, typed error normalization and server-derived actors. Existing duplicated helpers remain unchanged in Phase 6.0.

Compatibility routes can be removed only after direct-client parity, session parity, error-state parity and portal E2E coverage pass. Deprecated routes remain terminal and cannot become future authority.

## Portal cutover order

| Checkpoint | Scope | Gate |
|---|---|---|
| 6.1 | Shared auth, API, errors and permissions | One session/client boundary; server role and tenant restoration; normalized UI errors. |
| 6.2 | Supplier | Products, RFQs, orders, inventory, finance, support, team, compliance and capability-gated production use canonical data. |
| 6.3 | VIP/Wholesale | Membership, catalog, requests, offers and orders preserve the KOLBE + Supplier wholesale model. |
| 6.4 | Admin/CMS | Every mutation is permission-bound; Admin navigation does not imply authority; SiteBuilder remains CMS-only. |
| 6.5 | CRM, Support and Notifications | Cases, customer operations, outbox and templates replace browser-owned records. |
| 6.6 | Retail/Customer | Catalog, search, checkout, account and after-sales use canonical contracts while preserving storefront journeys. |
| 6.7 | Removal and parity | Remove proven obsolete fixtures/storage/transport only after full E2E and visual parity. |

## Session and permission rules

| Actor | Login | Restore | Logout | Authority |
|---|---|---|---|---|
| Retail customer | `POST /api/v1/auth/login` | `GET /api/v1/auth/me` | `POST /api/v1/auth/logout` | HttpOnly session supplies user and role. |
| VIP | Customer login plus VIP account lookup | `GET /api/v1/compat/wholesale/account` | Auth logout | Server supplies active account and status. |
| Supplier | `POST /api/v1/auth/supplier/login` | `GET /api/v1/compat/supplier/session` | Auth logout | Server supplies supplier and membership. |
| Admin | Admin-compatible login | Auth/Admin session endpoint | Auth logout | Server supplies role plus granular permission set. |

The shared client maps 401 to unauthorized/expired/revoked session behavior and 403 to a permission state. It does not infer role or tenant from localStorage, request bodies or route parameters.

## Money, quantity and pagination

Authoritative money crosses the API boundary as a decimal string. Formatting occurs once at the display boundary. Browser `number` values and derived totals remain drafts or presentation only; they never confirm a price, discount, refund, settlement, payout or payable amount. Integer quantities are validated against canonical inventory and order contracts.

Each registry contract declares `NONE`, `OFFSET`, `KEYSET` or `CURSOR`. Lists must render canonical pagination metadata and truthful empty states. They must not silently fetch or assume all records.

## UI-state contract

Data-driven entries select from: `LOADING`, `READY_WITH_DATA`, `READY_EMPTY`, `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `SERVER_ERROR`, `NETWORK_ERROR` and `PROVIDER_UNAVAILABLE`. The shared client will normalize transport errors; each portal will preserve its current visual style while rendering only applicable states.

## Removal and parity gates

A fixture, localStorage record or compatibility route is removable only when canonical read/write behavior, actor isolation, error mapping, pagination, empty states and existing feature visibility are covered by tests. Visual snapshots or focused browser assertions must protect layout and RTL behavior. Critical commerce paths additionally require server-state verification so an apparently successful UI cannot mask a failed mutation.

Phase 6.0 creates contracts and tests only. It performs no client rewrite, portal wiring, fixture deletion, schema change, visual change or Phase 6.1 implementation.

---

## Addendum (2026-09-26) — the Hard Design Freeze is retired

> This addendum is **additive**. The text above remains accurate as a record of
> the Phase 6.0–6.2 cutover strategy and is deliberately not rewritten.

### What changed

The Hard Design Freeze (`visualFreeze: true` on every registry entry) applied to
the **original cutover strategy**. While backend truth was being moved out of
the browser, page composition, navigation and visible capabilities had to stay
byte-stable so that every diff was provably about data ownership and nothing
else. That was the correct constraint for that migration.

That migration has completed for the migrated surfaces. The freeze is therefore
**no longer the active design rule**.

### What did NOT change

These rules are unaffected and remain fully in force:

- **Backend truth is authoritative.** No frontend-invented business state, no
  fake calculations, no silent degradation (`catch { return [] }` for a business
  read remains banned).
- **Domain ownership is authoritative.** A surface reads the module that owns
  the data.
- **Business invariants are authoritative.** Money is a decimal string at the
  boundary; identity is server-derived; the backend owns idempotency and
  concurrency.
- **The completeness ladder is unchanged.** Not complete below L5; not
  production-ready below L6.
- Historical Phase 6.0/6.1/6.2 reports remain historical evidence as written.

### What replaces it

**Controlled Design Evolution.** The registry now carries a typed policy per
surface instead of a blanket freeze:

```ts
export const DESIGN_CHANGE_POLICIES = ["PRESERVE", "EXTEND", "RESTRUCTURE"] as const;

type FrontendTruthEntry = {
  // ...
  designChangePolicy: DesignChangePolicy;   // required on every entry
  designChangeRationale?: string;           // required in practice for RESTRUCTURE
};
```

| Policy | Meaning |
|---|---|
| `PRESERVE` | structure already serves the workflow; only wiring, states, correctness and small usability/a11y fixes |
| `EXTEND` | keep the visual/interaction language; add the missing backend-supported capabilities |
| `RESTRUCTURE` | the current IA or interaction model prevents a complete, usable workflow; structural redesign allowed while retaining Kolbe identity |

`frontend-next/test/phase-6-0-truth-registry.test.ts` now enforces:

1. every entry carries a policy from the vocabulary and a non-empty `uiStates`;
2. every `RESTRUCTURE` carries a written rationale (>120 characters);
3. `visualFreeze` no longer exists on any entry;
4. every surface whose business truth is still browser-held is explicitly
   classified and has a scheduled cutover phase (design policy is not an escape
   hatch from that record);
5. **no `RESTRUCTURE` may be granted to a surface whose business truth is still
   unresolved** (`LOCAL_STORAGE`, `STATIC_FIXTURE`, `HARDCODED_RUNTIME`,
   `UNKNOWN`) — redesigning a screen whose data is fake is theatre.

Controlled structural redesign is now permitted. Ungoverned visual churn is not.

### Governance documents

- `docs/design/kolbe-design-engineering-standard.md` — the standard
- `docs/design/kolbe-interface-decisions.md` — per-surface decisions + evidence
- `.tastemaker/style-lock.md` — the locked Kolbe style, derived from existing tokens
- `.tastemaker/decisions.log` — append-only decision log
