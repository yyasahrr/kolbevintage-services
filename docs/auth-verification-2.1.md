# Phase 2.1 — Auth Verification & Hardening Checkpoint

**Branch:** `arena/01a0ad1f-kolbevintage-services`  
**HEAD:** `fc8c8c3` (plus verification commits)  
**Date:** 2026-09-17

This document is the audit required by Phase 2.1. It verifies that Phase 2 actually achieved a safe auth migration before moving to Catalog.

---

## 1. Authentication Ownership Audit

Search commands used:
```bash
grep -R "login\|issueToken\|verifyToken\|SessionVerifier\|SESSION_COOKIE\|Authorization\|Bearer\|localStorage\|Supabase" apps/api/src frontend-next/server frontend-next/storefront/lib --include="*.ts" --include="*.tsx"
```

### Every auth entry point

| Path | File | Owner | Legacy or Migrated | Used by | Removal Plan |
|---|---|---|---|---|---|
| `POST /store/kolbe/auth/register` | `frontend-next/server/kolbe-api.ts:handleAuth` | legacy (still serves) | Legacy, but DB schema is canonical (migration) | Storefront customer registration | Keep until NestJS `/api/v1/auth/register` is cut over via Nginx; then delete handler, keep DB |
| `POST /store/kolbe/auth/login` | `kolbe-api.ts:handleAuth` | legacy + NestJS dual | Both issue same HMAC token with `tv` | Storefront, VIP, Admin demo | Dual-read period: keep Bearer+cookie, after frontend fully cookie-only, remove Bearer support in legacy, then Nginx cut-over |
| `POST /store/kolbe/auth/logout` | `kolbe-api.ts` + `apps/api/src/modules/auth/auth.controller.ts` | migrated (NestJS owns) | Migrated, legacy wrapper remains | All portals | Legacy wrapper increments `token_version` same as NestJS; can be removed after `/api/v1/auth` cut-over |
| `GET /store/kolbe/auth/me` | `kolbe-api.ts` | legacy | Legacy, but checks `assertTokenVersion` | Storefront session check | Migrate to `GET /api/v1/auth/me` (already exists) |
| `POST /store/kolbe/supplier/auth/login` | `kolbe-api.ts:handleSupplier` | legacy + NestJS | Dual | Supplier portal | Same as above, supplier login now also in NestJS `POST /api/v1/auth/supplier/login` |
| `POST /api/v1/auth/register` | `apps/api/src/modules/auth/auth.controller.ts` | NestJS (owner: auth) | Migrated | Future storefront (via Nginx) | Keep — canonical |
| `POST /api/v1/auth/login` | `auth.controller.ts` | NestJS | Migrated | Future, already via Nginx `/api/v1/auth/` | Keep |
| `POST /api/v1/auth/logout` | `auth.controller.ts` | NestJS | Migrated | Future | Keep |
| `GET /api/v1/auth/me` | `auth.controller.ts` | NestJS | Migrated | Future | Keep |
| `POST /api/v1/auth/totp/enroll|verify|disable` | `auth.controller.ts` + `totp.service.ts` | NestJS | Migrated | Admin/Customer 2FA | Keep |
| `POST /api/v1/auth/supplier/login` | `auth.controller.ts` | NestJS | Migrated | Supplier portal future | Keep |
| Token generation | `issueToken()` in kolbe-api.ts + `SessionVerifier.issue()` in NestJS | Both (same algorithm HMAC-SHA256, secret `KOLBE_SESSION_SECRET`, payload `sub,role,exp,tv`) | Dual | All | Parity test ensures interchangeability; after cut-over, legacy `issueToken` can be deleted |
| Session creation | `user_session` insert (sha256 hash) + `login_attempt` | NestJS owns tables, legacy also writes (same schema) | Migrated | Audit, revocation | Legacy writes can be removed after cut-over; table owned by auth |
| Cookie setting | `sessionCookie()`, `clearedSessionCookie()` in both | Both | Migrated | Browser | Single cookie `kolbe_session` |
| Authorization header | `claimsFrom()` (Bearer) + `extractToken()` | Both dual-read | Transitional | API clients, tests | Plan to become cookie-only for browser, keep Bearer for service-to-service if needed |
| localStorage auth | `kv_customer`, `kv_vip`, `kv_admin`, `kv_supplier` | Removed | Removed | Previously storefront | Deleted, regression test in `auth-cutover.test.ts` fails if reintroduced |
| Supabase refs | `isSupabaseConfigured` → `isBackendConfigured` | Removed | Removed | AdminPortal, WholesaleAdmin | Renamed, no Supabase strings remain |

**Conclusion:** Auth ownership is now in NestJS (`auth` module owns `account_user`, `login_attempt`, `user_session`). Legacy handler still serves traffic (strangler) but uses same DB schema and same token format, so migration is safe.

---

## 2. LocalStorage Authentication Removal

Search:
```bash
grep -R "localStorage|sessionStorage|TOKEN_KEYS|auth_token|access_token|refresh_token|kv_customer|kv_admin|kv_supplier|kv_vip" frontend-next --include="*.ts" --include="*.tsx" | grep -v test | grep -v ".next"
```

### Classification

| Key / Pattern | Classification | Status |
|---|---|---|
| `kv_customer`, `kv_vip`, `kv_admin`, `kv_supplier` exact `"kv_..."` | **Authentication** | **Removed** — no file contains exact token key anymore (verified by `auth-cutover.test.ts`) |
| `localStorage.setItem("kv_customer_identity")` | Business cache — customer name/phone PII, not token | Kept but documented as PII, should move to cookie/session later (P2) |
| `kv_admin_products_v2`, `kv_admin_product_trash`, `kv_admin_orders`, `kv_admin_customers`, `kv_admin_articles`, `kv_admin_wholesale_requests`, `kv_admin_warehouses`, `kv_admin_returns`, `kv_admin_system`, `kv_admin_roles`, `kv_admin_2fa`, `kv_admin_integrations`, `kv_admin_crm_v2`, `kv_admin_crm_v1`, `kv_crm_focus_customer` | Business cache / UI mock — admin panel stores mock orders, customers, etc. in localStorage (legacy) | Kept, not auth, but should be migrated to DB in Phase 3-4 (P2) |
| `kv_cart`, `kv_wish`, `kv_compare`, `kv_vip_plans_v1`, `kv_page_*`, `kv_supplier_holidays`, `kv_supplier_roles`, `kv_supplier_campaigns`, `kv_supplier_notif_prefs`, `KOLBE_WHOLESALE_CATALOG_KEY`, `WHOLESALE_MEMBERSHIP_KEY`, `STOREFRONT_THEME_KEY`, `kv_wholesale_draft`, `kv_wholesale_orders` | Harmless UI state / business draft | Kept |
| `TOKEN_KEYS`, `loadToken`, `saveToken`, `clearToken` | Authentication | **Removed** from `storefront/lib/api.ts` — now `credentials:include` only |
| `auth_token`, `access_token`, `refresh_token` | Authentication | **Not found** in codebase (except in comments explaining removal) |

### Regression test

`frontend-next/test/auth-cutover.test.ts`:
- Checks `storefront/lib/api.ts` has no `localStorage.setItem/getItem/removeItem`, no `TOKEN_KEYS`, no exact `"kv_customer"` etc.
- Scans `storefront/`, `supplier-src/`, `server/` for exact token keys and `localStorage.*(kv_customer|vip|admin|supplier)`
- Checks `api.ts` uses `credentials:include` and no `Authorization: Bearer` from localStorage
- Build will fail if reintroduced because test fails (vitest runs in CI)

Additional hardening: `frontend-next/test/session-hardening.test.ts` verifies token hashes stored, not raw.

---

## 3. Bearer Token Migration Review

Current: dual-read (Bearer + HttpOnly cookie) in both legacy and NestJS.

| Endpoint | Current auth method | Should keep Bearer? | Should become cookie-only? | Notes |
|---|---|---|---|---|
| `POST /api/v1/auth/login` | Public, sets cookie, returns token in body (transitional) | No — public, but after login should be cookie-only | Yes, after frontend fully cookie-only, stop returning token in body (P1) | Currently returns token for parity; should be removed in Phase 3 |
| `POST /api/v1/auth/register` | Same as login | No | Yes | Same |
| `POST /api/v1/auth/logout` | Bearer or cookie | Keep Bearer for service clients | Browser should be cookie-only | Guard already supports both |
| `GET /api/v1/auth/me` | Bearer or cookie | Keep for API clients | Browser cookie-only | Keep dual for now |
| `POST /api/v1/auth/totp/*` | Bearer or cookie (requires auth) | Keep for API | Browser cookie-only | Keep dual |
| `GET /api/v1/audit/logs` | Bearer or cookie, role admin | Keep Bearer for service | Browser cookie-only | Already in e2e test |
| `GET /store/kolbe/admin/*` | Bearer or cookie, role admin | No — should be cookie-only for browser admin | Yes | Legacy, will be removed after Nginx cut-over |
| `GET /store/kolbe/supplier/*` | Bearer or cookie, role supplier + supplierContext | No | Yes | Legacy |
| `GET /store/kolbe/wholesale/*` | Bearer or cookie, role customer/vip + active account | No | Yes | Legacy |
| `POST /store/kolbe/retail/orders` | Optional auth (guest allowed), Bearer or cookie | Keep optional | Cookie-only when logged in | Already checks `assertTokenVersion` if claims present |
| `POST /store/kolbe/logs/client` | Bearer or cookie, any role | No | Yes | Requires auth to prevent log poisoning (D21) |
| `try-on/*` | Bearer or cookie, customer/vip | No | Yes | Requires auth + quota |

**Migration plan:**
- Phase 2 (done): dual-read, cookie is primary, Bearer kept for parity
- Phase 2.1 (now): document, keep dual, add tests that both work
- Phase 3: frontend fully uses `credentials:include`, no token in JS; NestJS stops returning token in body for browser routes, keeps Bearer only for service-to-service (if needed) with separate guard
- Phase 4: remove Bearer from browser-facing routes, keep cookie-only; service routes use API keys

---

## 4. Cookie Security Review

### Production required settings

| Setting | Required | Actual (legacy) | Actual (NestJS) | Status |
|---|---|---|---|---|
| `HttpOnly=true` | Yes | Yes (`sessionCookie()` includes) | Yes (`SessionVerifier.cookie()`) | ✓ |
| `Secure=true` | Yes in prod | Yes when `NODE_ENV=production` (`; Secure`) | Yes when `isProduction` | ✓ |
| `SameSite=Lax or Strict` | Yes | `Lax` | `Lax` | ✓ (Lax chosen to allow top-level navigation, Strict would break some flows) |
| `Path=/` | Yes | Yes | Yes | ✓ |
| `Domain` | Should NOT be set (host-only) | Not set | Not set | ✓ Secure |
| Expiration | 14 days | `SESSION_TTL_SECONDS = 14d`, `Max-Age` | Same | ✓ |
| Clearing | `Max-Age=0` on logout | `clearedSessionCookie()` | `clearCookie()` | ✓ |
| Duplicate cookies | Should not set duplicate | Only one `kolbe_session` | Only one | ✓ |
| `token_version` revocation | Should invalidate old cookies | Yes, `assertTokenVersion` checks DB | Yes, guard checks DB | ✓ |

### Tests

- `session-security.test.ts`: HttpOnly + SameSite=Lax + Path=/ + Max-Age, dual-read, forged cookie rejected, logout clears, expired rejected, CORS
- `auth-cutover.test.ts`: cookie attributes, Max-Age, HttpOnly, SameSite
- `session-hardening.test.ts`: token hash stored not raw, revoked, stolen old cookie rejected, token_version mismatch, cookie clearing, hash verification

**Gap:** No `__Host-` prefix (would require Secure + Path=/ + no Domain, which we already have, but prefix would add defense). P2.

---

## 5. Session Security Review

Table `user_session`:

| Check | Expected | Actual | Test |
|---|---|---|---|
| Token hashes stored, not raw | Yes | `token_hash = sha256(token)` hex 64 chars | `session-hardening.test.ts` verifies hash != token and equals sha256 |
| Revoked sessions cannot auth | Yes | `revoked_at` set on logout, `token_version` incremented, `assertTokenVersion` rejects old tv | `auth-cutover.test.ts` logout revokes, `session-hardening` stolen cookie rejected |
| Expired sessions cannot auth | Yes | `exp` in JWT-like payload checked via `verifyToken`, `expires_at` in DB for cleanup (not yet enforced in guard) | Expired token test, but DB `expires_at` not checked in guard — **P1**: add guard check for `expires_at` and periodic cleanup |
| Logout invalidates sessions | Yes | `UPDATE user_session SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL` + `token_version+1` | `auth-cutover` and `session-hardening` |
| `token_version` invalidates old | Yes | `assertTokenVersion` compares `claims.tv` vs `account_user.token_version` | `auth-cutover` tv mismatch test |

**Additional hardening done in 2.1:**
- Added explicit test for revoked session in DB
- Added test for hash storage
- Added test for stolen old cookie

**Remaining:**
- `user_session.expires_at` not enforced in `SessionGuard` — should be (P1)
- No periodic cleanup job for expired sessions — P2, needs worker (Phase 6)
- No device/session listing for user — P2

---

## 6. RBAC Enforcement Audit

### Protected endpoints audit (actual code, not just decorators)

**Admin (role admin):**
- `admin/site-settings PUT` → `requireRole(req,"admin")` + `assertTokenVersion` ✓
- `admin/accounts GET`, `admin/accounts/:id/status POST` → same ✓
- `admin/supplier-applications GET/POST`, `admin/suppliers GET`, `admin/catalog GET`, `admin/catalog/:id/status POST`, `admin/catalog/bulk-price POST`, `admin/purchase-orders GET`, `admin/purchase-orders/:id/status POST`, `admin/orders GET`, `admin/orders/:id/approve|/cancel POST`, `admin/rfqs GET/POST`, `admin/tickets GET/POST`, `admin/logs GET/POST` → all `requireRole(admin)` ✓
- **Gap found:** `admin/supplier-applications/:id` creates supplier user with `passwordRecord` but does not set `token_version=0, failed_login_attempts=0` explicitly (relies on DB default) — OK but should be explicit (P3)

**Supplier (role supplier):**
- `supplier/session`, `products`, `orders`, `orders/:id/status`, `rfqs`, `rfqs/:id/quote`, `tickets` → `requireRole(supplier)` + `supplierContext(userId)` from DB, not client-supplied ✓
- `supplierContext` query: `SELECT s.id ... FROM supplier_member m JOIN supplier s ON s.id=m.supplier_id WHERE m.user_id=$1 AND s.status='approved'` — no client supplierId ✓
- Order status change checks `SELECT 1 FROM purchase_order WHERE id=$1 AND supplier_id=$2` — ownership check ✓
- **Gap:** No check for `supplier.status='approved'` in `supplierContext`? Actually we have `s.status='approved'` ✓
- **Gap:** `supplier/products POST` does not check supplier status again (but `supplierContext` already did) ✓

**VIP / Wholesale:**
- `wholesale/apply` → `claimsFrom` + `assertTokenVersion`, requires customer/vip, creates pending account (not auto-approved) ✓ D2 fixed
- `wholesale/account` → requires customer/vip ✓
- `wholesale/products`, `wholesale/orders` → requires active account `isAccountActive` + `activeAccount` query ✓
- **Gap:** `wholesale/orders POST` checks `paymentMethod` allowed via `assertPaymentMethodAllowed` ✓ D23 fixed

**Customer:**
- `me` → `requireRole(customer)` (but should allow any authenticated? Actually `me` is customer profile, but `auth/me` allows any role) — minor inconsistency P3
- `retail/orders POST` → optional auth, if present checks `assertTokenVersion`, else guest — OK

**Frontend hides UI but backend enforces:**
- Checked `Admin.tsx`, `WholesaleAdmin.tsx` — they hide UI based on role, but backend enforces via `requireRole` — no bypass found in audit
- Supplier isolation: frontend `supplier-src/App.tsx` does not send supplierId, backend uses session — OK

**Critical missing guards:** None found for admin/supplier/wholesale after Phase 2. Previously `try-on/*` had no auth (D20) — now fixed with `requireAnyRole(customer,vip)` + quota. `logs/client` now requires auth (D21) — fixed.

---

## 7. Supplier Isolation Security Test

Implemented in `frontend-next/test/supplier-isolation.test.ts`:

| Test | Result |
|---|---|
| Supplier A only sees own products | ✓ — `catalog WHERE supplier_id=$1` |
| Supplier B newly created via admin approval sees only own supplier_id | ✓ — `supplierId` from `supplier_member` |
| Supplier B cannot list Supplier A orders (empty) | ✓ |
| Supplier B cannot update fake order id (404/403) | ✓ — ownership check `supplier_id=$2` |
| Body injection of `supplier_id` ignored | ✓ — `supplierContext` from session, not body |

**Identity always from session:** `supplierContext(userId)` uses `user_id` from JWT, never client param.

**Remaining gap:** No test for `supplierId` override via URL query param (e.g., `/supplier/products?supplierId=...`) — currently no such param, but should add regression that query param is ignored (P1).

---

## 8. Password Security Review

| Check | Status | Evidence |
|---|---|---|
| Hashing algorithm | `scryptSync(password, salt, 64)` 64 bytes, salt 16 bytes hex random | `passwordRecord`, `passwordMatches` uses `timingSafeEqual` |
| No plaintext | No plaintext stored, only `password_hash` hex 128 chars + salt | `password-security.test.ts` verifies hash != password, hex format |
| No password logs | No `console.log(password)`, no audit log of password | Grep for password in logs — none |
| Registration security | Min 8 chars, email lowercased, duplicate 409, role only customer from public, admin/supplier only with admin role | `handleAuth` and `AuthService.register` |
| Failed login handling | Increments `failed_login_attempts`, logs to `login_attempt` success=false, IP captured | `password-security.test.ts` |
| Account lock | After 5 fails, `locked_until = now+15m`, returns 423 `ACCOUNT_LOCKED` | `auth-cutover.test.ts` lockout test |

**Missing:**
- Password reset flow — not implemented, documented as P1, requires email service (Phase 4)
- Email verification — not implemented, P1, requires email service
- Password strength meter — frontend has min 8, but no complexity check — P3
- Password history / reuse prevention — P3

---

## 9. CSRF / Origin Protection Review

Because auth uses cookies:

- `SameSite=Lax` provides baseline CSRF protection for top-level GET, but not for POST from same-site or subdomains
- `checkOrigin(req)` implemented:
  - Skips GET, HEAD, OPTIONS
  - If Origin header present and `KOLBE_ALLOWED_ORIGINS` set, checks exact match or wildcard `https://*.kolbe.ir`
  - If `KOLBE_ALLOWED_ORIGINS` empty and `NODE_ENV=production`, throws 403 `FORBIDDEN_ORIGIN` (fail-closed)
  - In dev, allows if no whitelist (for Vite compatibility)

**Tests:**
- `auth-cutover.test.ts`: POST with disallowed Origin → 403, allowed → 200, CORS per-request
- `session-hardening.test.ts`: Origin not required for same-origin (no Origin header) — passes

**Limitations documented:**
- Origin header can be missing (same-origin fetch, or non-browser clients, or some proxies strip it) — so Origin check is defense-in-depth, not complete CSRF
- SameSite=Lax does not protect against same-site POST (e.g., XSS on subdomain)
- No CSRF token (double-submit or synchronizer) — should be added in Phase 4 for state-changing routes (P1)
- `fetch` with `credentials:include` and no Origin (same-origin) is allowed — by design, but means CSRF from same-origin is still possible if XSS exists

**Recommendation:** Document that current protection is Origin + SameSite, not full CSRF token. Add CSRF token in Phase 4.

---

## 10. Rate Limit Review

| Endpoint | Protected? | Implementation | Status |
|---|---|---|---|
| `POST /api/v1/auth/login` | Yes | Nginx `limit_req_zone $binary_remote_addr zone=kolbe_login:10m rate=5r/m` + `burst=5` + legacy `failed_login_attempts` lockout 15m | ✓ In prod, but in-memory lockout is per-instance |
| `POST /api/v1/auth/register` | No explicit rate limit | Only Nginx `kolbe_api` 300r/m | P1 — should have stricter limit |
| `POST /api/v1/auth/logout` | No | Only 300r/m | OK — logout is cheap |
| `POST /api/v1/auth/totp/enroll|verify|disable` | No | Only 300r/m, no brute-force protection | **P0** — TOTP verify should have rate limit (e.g., 5/min) + lockout |
| `POST /store/kolbe/logs/client` | Yes | In-memory `consumeRateLimit(userId, 60/hour)` | ✓ But in-memory — **P1 debt**: should be Redis |
| `try-on/files`, `try-on/tasks` | Yes | In-memory `consumeTryOnUploadQuota`/`TaskQuota` per userId | ✓ But in-memory — **P1 debt** |
| `POST /store/kolbe/auth/login` | Yes | Same as NestJS + DB lockout | ✓ |

**Technical debt:**
- In-memory rate limit (`rate-limit.ts`, `try-on-guard.ts`) — does not work across multiple instances, resets on restart. Should be Redis + BullMQ (already in stack) — P1, Phase 4
- No Redis yet for login — Nginx limit_req is per Nginx instance, not shared — P1
- TOTP brute force — no limit, attacker can try 1M codes — **P0**, should add 5 attempts then lock

---

## 11. TOTP Review

| Check | Status | Evidence |
|---|---|---|
| Secret storage | Plain text in `account_user.totp_secret` | **P0 debt**: should be encrypted at rest (e.g., AES-GCM with KMS) — currently plain for simplicity, documented for Phase 6 |
| Enrollment flow | `POST /auth/totp/enroll` → generates 20-byte random base32, stores secret (not yet enabled), returns secret + otpauthUrl (once) | `auth-cutover.test.ts` TOTP test |
| Verification flow | `POST /auth/totp/verify` → verifies code ±1 window, sets `totp_enabled=true`, `totp_enrolled_at=now()` | Same test |
| Disable flow | `POST /auth/totp/disable` → requires code if enabled, clears secret + enabled + enrolled_at | Same test |
| Secrets not returned after enrollment | Only returned on enroll, not on verify/disable/me | Checked — `me` does not return secret, only `totpEnabled` boolean |
| QR URL exposure | Controlled — requires auth, returns once, contains secret in URL (standard otpauth) | OK, but should be over HTTPS only (Secure cookie ensures) |
| Brute force protection | **Missing** — no rate limit on verify/disable | **P0** — add rate limit + lockout |
| Backup/recovery | No backup codes, no recovery flow | **P1** — need backup codes or admin reset, Phase 4 |

**Additional:** Login now checks TOTP if `totp_enabled` → requires `totpCode`, returns `TOTP_REQUIRED` or `INVALID_TOTP`.

---

## 12. Frontend Integration Review

| Client | Uses `credentials:include`? | Evidence | Remaining assumptions |
|---|---|---|---|
| Storefront `storefront/lib/api.ts` | Yes | `credentials:"include"` in fetch | None — no local token |
| Supplier portal `supplier-src/api.ts` | Yes | `credentials:'include'` | None |
| Wholesale `wholesaleApi.ts`, `wholesaleVipApi.ts` | Yes (via `api()`) | Uses `api()` which has include | None |
| Admin portal `AdminPortal.tsx`, `WholesaleAdmin.tsx` | Yes (via `api()`) | Uses `api()` | Previously had `isSupabaseConfigured` alias — fixed to `isBackendConfigured` |
| `clientLogger.ts` | Uses `same-origin` | For logs, requires auth | OK — logs only sent when session exists |

**Local roles/permissions assumptions:**
- No `localStorage` role checks found that bypass backend — all role checks are backend enforced
- Frontend does have some UI role hiding (e.g., Admin pages) but backend enforces
- No fake authentication state — `isBackendConfigured` is static true, not auth

**Gap:** Some admin UI still uses `localStorage` for mock data (orders, customers) — not auth, but should be migrated to DB (P2)

---

## 13. Added Missing Regression Tests (Phase 2.1)

New tests added:

- `supplier-isolation.test.ts` (7 tests):
  - Supplier A only sees own products
  - Supplier B cannot see A orders
  - Fake order status update → 404/403
  - Body injection of supplierId ignored
  - RBAC: customer cannot access admin, supplier cannot access admin, admin cannot access wholesale without vip, anon cannot access protected

- `session-hardening.test.ts` (8 tests):
  - Expired token rejected
  - Revoked session in DB
  - tv mismatch after logout
  - Stolen old cookie rejected
  - Logout clears cookie with Max-Age=0, HttpOnly, SameSite, Path
  - Duplicate cookie handling
  - Secure cookie structure
  - Token hash stored not raw (sha256)

- `password-security.test.ts` (5 tests):
  - Hash stored not plaintext, hex format
  - Short password rejected 422
  - Failed login increments attempts
  - Successful login resets attempts to 0
  - Lockout after 5 fails → locked_until + 423

Total frontend tests: **19 files, 160 tests** (was 16/140 in Phase 2).  
Full suite: **shared 21 + database 36 + api 17 + frontend 160 = 234 tests**.

---

## 14. Required Output

### Auth Migration Status

| Area | Status | Evidence |
|---|---|---|
| Cookie auth | ✅ Done | `kolbe_session` HttpOnly, Secure in prod, SameSite=Lax, Path=/, Max-Age 14d, dual-read with Bearer, tests in `session-security` + `auth-cutover` + `session-hardening` |
| Session storage | ✅ Done | `user_session` with sha256 hash, `login_attempt` audit, `token_version` revocation, logout clears, tests |
| RBAC | ✅ Done | `requireRole`/`requireAnyRole` async with `assertTokenVersion`, all admin/supplier/wholesale endpoints protected, supplier isolation via `supplierContext` from session, tests in `supplier-isolation` |
| Supplier isolation | ✅ Done | Supplier A cannot read B products/orders, supplierId from session not client, ownership check on order status, tests |
| Admin protection | ✅ Done | All `/admin/*` require admin role + token_version, audit logs, tests for customer/supplier denial |
| Customer auth | ✅ Done | Register/login/logout/me, lockout 5 fails 15m, TOTP optional, cookie-only frontend, tests |
| Legacy removal | ⚠️ Partial | LS token keys `kv_customer|vip|admin|supplier` exact removed, `TOKEN_KEYS` removed, Supabase refs removed, `previewMode.ts` removed; but legacy handler `kolbe-api.ts` still serves traffic (strangler) — removal planned after Nginx cut-over fully to NestJS (Phase 3) |
| CSRF | ⚠️ Partial | Origin check D35 + SameSite=Lax, tests for Origin rejection; but no CSRF token, Origin can be missing — documented as defense-in-depth, not complete — P1 for Phase 4 |
| Rate limiting | ⚠️ Partial | Nginx `limit_req` for login 5r/m + api 300r/m, in-memory for logs (60/h) + try-on quota, DB lockout; but in-memory not shared, TOTP no limit — P0 for TOTP, P1 for Redis |
| TOTP | ✅ Done (enrollment) + P0 debt | Enroll/verify/disable flows work, secret stored plain (should be encrypted), no brute-force limit, no backup codes — P0 rate limit, P1 backup |

### Remaining Auth Debt

| Priority | Issue | Evidence | Recommended Phase |
|---|---|---|---|
| **P0** | TOTP brute force — no rate limit on `totp/verify` and `totp/disable`, attacker can try 1M codes | `auth.controller.ts` totp endpoints have no `limit_req` or in-memory limit | Phase 2.2 — add 5/min limit + lockout, Nginx location for `/api/v1/auth/totp/` with stricter zone |
| **P0** | TOTP secret stored plaintext in `account_user.totp_secret` | `tables.ts` text column, no encryption | Phase 6 — encrypt with AES-GCM + KMS, or move to vault |
| **P1** | `user_session.expires_at` not enforced in `SessionGuard` | Guard only checks `token_version` and `status`, not `expires_at` or `revoked_at` | Phase 2.2 — add check `expires_at > now()` and `revoked_at IS NULL` in guard |
| **P1** | In-memory rate limiting — `rate-limit.ts`, `try-on-guard.ts` | Uses Map, resets on restart, not shared across instances | Phase 4 — move to Redis + BullMQ (already in stack) |
| **P1** | No CSRF token — only Origin + SameSite | `checkOrigin` can be bypassed if Origin missing | Phase 4 — add double-submit CSRF token for state-changing routes |
| **P1** | No password reset / email verification | No endpoints, documented as missing | Phase 4 — requires email service |
| **P1** | No backup codes / recovery for TOTP | Only disable with code, no admin reset | Phase 4 — add backup codes table + admin reset flow |
| **P1** | No session listing / device management for user | `user_session` exists but no API to list/revoke per device | Phase 4 — add `GET /auth/sessions` + revoke |
| **P1** | `POST /api/v1/auth/register` no rate limit | Only 300r/m, should be stricter (e.g., 10/m per IP) | Phase 2.2 — add Nginx limit for register |
| **P2** | `__Host-` cookie prefix not used | Would add extra defense (requires Secure, Path=/, no Domain) | Phase 3 — rename cookie to `__Host-kolbe_session` in prod |
| **P2** | `customerIdentity` PII in localStorage (`kv_customer_identity`) | Not token but PII, should be cookie/session | Phase 3 — move to backend profile |
| **P2** | Admin mock data in localStorage (`kv_admin_*`) | Not auth but business cache, should be DB | Phase 3-4 — migrate to DB |
| **P2** | No periodic cleanup for expired `user_session` / `login_attempt` | Table grows indefinitely | Phase 6 — add worker cron |
| **P3** | `admin/supplier-applications` creates user without explicit `token_version=0` | Relies on DB default, should be explicit | Phase 3 — explicit defaults |
| **P3** | `me` endpoint role inconsistency — `me` requires customer, `auth/me` allows any | `kolbe-api.ts` has two me endpoints | Phase 3 — unify to `auth/me` |
| **P3** | Password strength only min 8, no complexity | No uppercase/lowercase/number check | Phase 4 — add complexity if needed |

---

## Verification

```bash
npm run typecheck:all
# shared, database, api, kolbe-next — all 0 errors

npm run test:all
# @kolbe/shared 21 passed
# @kolbe/database 36 passed (5 migrations, 22 tables, 23 FK, 43 CHECK)
# @kolbe/api 17 passed (8 module-boundaries + 9 e2e)
# kolbe-next 160 passed (19 files)
# Total 234 tests

npm run build
# api build + storefront Next.js build — 4 static pages, First Load JS 102kB

npm run infra:verify
# ✔ بازبینی ایستای زیرساخت موفق — 12 env vars, 9 services, static only
```

**Exact counts:**
- Typecheck: 4 workspaces, 0 errors
- Tests: 234 total (21+36+17+160), 0 failed
- Build: api + storefront + portals — success
- Infra verify: 12 env, 9 services — success, Docker runtime skipped (N13)

---

## Conclusion

Phase 2 achieved safe auth migration:

- Cookie-only primary, Bearer kept for parity (dual-read)
- Session storage with hash, revocation via `token_version`, logout clears
- RBAC enforced on all critical endpoints, supplier isolation via session-derived `supplierId`
- LocalStorage auth removed, regression test prevents reintroduction
- Origin/CSRF defense-in-depth with SameSite=Lax, documented limitations
- TOTP enrollment works, but has P0 debt (rate limit + plaintext secret)

**Do NOT claim full auth migration complete** — P0 TOTP rate limit and plaintext secret, plus P1 session expiry enforcement and CSRF token, must be fixed in Phase 2.2 before Catalog.

**Next:** Phase 3 — Catalog, Product, Pricing & Flat-Lay Asset Workflow Migration, with auth debt P0 fixed first.

