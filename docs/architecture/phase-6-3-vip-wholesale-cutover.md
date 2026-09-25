# Phase 6.3 — VIP/Wholesale Canonical Cutover (Audit → Plan)

Checkpoint **6.3-A** (audit) output. Evidence gathered against the running stack
(Postgres 17.10 on `:55432`, API `:4000`, Next `:3000`) and the tree at the Phase 6.2 tip
(`e7a420a`). Every route/schema claim below was read from the repository, not assumed.

## 1. Registered scope (4 features)

`frontend-next/truth-registry.ts` registers exactly the four in-scope features
(`vip-support-team` is explicitly deferred to Phase 6.5 and is **not** migrated here):

| Feature | Registry canonicalApiContracts | Status vs. backend |
|---|---|---|
| `vip-membership` | `/store/kolbe/wholesale/account`, `/store/kolbe/wholesale/apply` | account read exists (compat); apply exists |
| `vip-wholesale-catalog` | `GET /api/v1/compat/wholesale/products` (CURSOR) | exists |
| `vip-wholesale-orders` | `POST /api/v1/wholesale/orders`; `GET /api/v1/compat/wholesale/orders` (KEYSET) | exist |
| `vip-rfq-offers` | `GET /api/v1/vip/requests` (CURSOR); `GET /api/v1/vip/requests/:id/offers` | **MISSING — must be added (see §4)** |

## 2. Backend API map (verified controllers)

- `apps/api/src/modules/vip/vip.controller.ts` — `@Controller("vip")`: `GET plans`,
  `POST subscribe`, `POST compat/applications`, `POST compat/accounts/:id/status`,
  `POST requests` (create), `POST subscriptions/:id/activate`. **No `GET requests` list.**
- `apps/api/src/modules/vip/wholesale-requests.controller.ts` — `@Controller("wholesale/requests")`:
  `POST :id/revisions`, `POST :id/revisions/:revisionId/accept`, `POST :id/revisions/:revisionId/reject`,
  `POST :id/reject`, `POST :id/cancel`, `GET :id/revisions` — all `@Roles("supplier","admin")`
  (supplier/admin side; **not** the buyer's read path).
- `apps/api/src/modules/orders/orders.controller.ts` — `@Controller("wholesale/orders")` (buyer order create/read).
- `apps/api/src/modules/finance/wholesale-finance.controller.ts` + `modules/shipping/shipping-buyer.controller.ts`
  — both `@Controller("wholesale/orders")` (payment/shipping legs).
- `apps/api/src/modules/offers/offers.controller.ts` — `@Controller("offers")`: `GET product/:productId`,
  `POST compat/rfqs`, `POST compat/rfqs/:id/quote`, `POST compat/bulk-price`, `POST packages`, `POST pricing-tiers`.
- `apps/api/src/database/legacy-read-cutover.controller.ts` — `@Controller("compat/wholesale")`:
  `GET account` (l.171), `GET products` (l.178), `GET orders` (l.184) — the compat read seam.
- `apps/api/src/modules/vip/vip.service.ts` — request lifecycle is fully server-owned:
  `createWholesaleRequest`, `transitionRequest`, `acceptRequest`, `proposeRevision`, `acceptRevision`,
  `rejectRevision`, `rejectRequest`, `cancelRequest`, `getActiveSubscription` (l.190).

## 3. Schema (identity + requests)

- **VIP identity** = an active `vipSubscription` (`getActiveSubscription`, `assertVipAccess`)
  **plus** a `wholesaleAccount` row with `status = "approved"` for the user
  (`createWholesaleRequest`, vip.service.ts l.205–212). The request table's FK
  `wholesale_request_vip_account_fk` targets `wholesaleAccount.id`.
- `wholesale_request` (tables.ts l.1843): `id, productId, offerId, vipAccountId, variantId, packageId,
  quantity, status (default "pending"), version, accepted* , createdAt, updatedAt`;
  statuses `WHOLESALE_REQUEST_STATUSES` (state-values.ts l.149) = pending → supplier_review →
  revision_requested → … (server `transitionWholesaleRequest` enforces them).
- `wholesale_request_revision` (l.2225): supplier-proposed revisions with `proposedUnitPrice` as
  **bigint** (controller coerces `BigInt(...)` and rejects non-bigint as `INVALID_PRICE`) — the
  money type stays integer/string at the domain edge.

## 4. Missing backend read contracts (to be added in 6.3-D)

The registry lists `GET /api/v1/vip/requests` (CURSOR) and `GET /api/v1/vip/requests/:id/offers`,
but **no controller exposes them** (grep across `*.controller.ts` found none). Per the task's
"MISSING BACKEND CONTRACTS" rule, these must be added as the smallest safe canonical contract:
- `GET /vip/requests` — the **session buyer's** own requests (scoped by `wholesaleAccount.userId`),
  cursor-paginated, no cross-account leakage, 403 for non-VIP/anonymous.
- `GET /vip/requests/:id/offers` — the request's associated offer (from `offerId`) plus its
  revisions, server-derived; empty is a real `empty` state, never an error.
Both must be added with e2e/API tests (auth, empty, cross-account) before the frontend consumes them.

## 5. Legacy inventory to migrate / delete

`frontend-next/storefront/lib/wholesaleVipApi.ts` (8 exports) — classification:

| Function | Verdict |
|---|---|
| `loadWholesaleMembership` (A) | keep behaviour, move to `shared/vip`; **drop `catch → null`** (error must surface as `error`, not empty) |
| `signInWholesaleVip` / `restoreWholesaleVip` / `signOutWholesaleVip` (B) | **delete** — identity is the server session (`/auth/me`), not a bespoke VIP login + localStorage |
| `applyWholesaleVip` (C) | keep as command via `shared/vip`; idempotency key required |
| `loadWholesaleVipProducts` (D) | keep as CURSOR adapter over `GET /compat/wholesale/products` |
| `loadWholesaleCustomerOrders` (A) | keep; **drop `catch → []`** |
| `submitWholesaleCustomerOrder` (C) | keep; **drop `Date.now()` order code** (server owns the code) |

Known defects to **not** carry over: (1) money typed as JS `number`
(`wholesalePrice`, `totalAmount`, `unitPrice`) → must be decimal **string**; (2) failures swallowed to
`null`/`[]` → must surface `error` (never collapse 429/500/network into `empty`); (3) bespoke VIP
session + `kv_wholesale_membership`/`kv_wholesale_vip` localStorage as an identity/authority source →
remove; (4) client-minted order codes.

Consumers: `storefront/wholesaleMembership.ts` (localStorage read/write),
`storefront/pages/VIPPortal.tsx`, `storefront/pages/Wholesale.tsx` (483 lines — catalog + orders + RFQ),
`storefront/pages/WholesaleDashboard.tsx`.

## 6. Session gap (6.3-B)

`apps/api/src/modules/auth/auth.service.ts` `me()` returns `supplierContext` for suppliers
(Phase 5.9-A) but **no VIP/wholesale membership context**. 6.3-B must expose the wholesale
membership status + account id on the server session (analogous to `supplierContext`), so
`/vip` gating and `/auth/me` agree; frontend gating stays UX-only and every protected route
re-verifies server-side (no deep-link bypass, cross-account denied).

## 7. Plan / checkpoints

- **6.3-B** Membership: server session owns identity + membership; delete bespoke VIP sign-in and
  `kv_wholesale_membership` authority; `/vip` gates on server membership (anonymous → sign-in;
  pending → status; active → portal).
- **6.3-C** Catalog: `shared/wholesale` CURSOR adapter; server price/MOQ/tiers; seller = KOLBE+Suppliers.
- **6.3-D** RFQ/Offers: **add** the two missing read contracts + tests; buyer request create/cancel;
  server offer/revision lifecycle; decimal-string prices.
- **6.3-E** Orders: server lifecycle/payable/payment/shipping/cancel-refund; remove `Date.now` codes +
  local submitted-order history; idempotent double-submit prevention.
- Then localStorage removal + full E2E (4 identities) + visual + report + registry update.

Runtime for testing is green; implementation proceeds from this audit.
