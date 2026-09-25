# Phase 6.0 — Frontend Truth Registry + API Contract Map

**Status:** Complete

**Branch:** `arena/01a0c5f5-kolbevintage-services`

**Start SHA:** `4a2c7afb5b590d98568f6491e7a81fdb0ea36ecd`

**Implementation ending SHA:** `06c0a2fdb34e43c5f169753621fce489138d4b3c`

**GitHub Actions:** `36119399910` — SUCCESS

## Delivered artifacts

- `frontend-next/truth-registry.ts`: typed, browser-independent registry and API contract map.
- `frontend-next/test/phase-6-0-truth-registry.test.ts`: 13 machine-checkable invariants.
- `frontend-next/vitest.phase-6-0.config.ts`: database-independent focused registry test configuration.
- `docs/architecture/phase-6-frontend-truth-cutover.md`: Phase 6 authority, preservation and cutover rules.
- `docs/architecture/phase-6-0-frontend-truth-inventory.md`: deterministic source/persistence/compatibility inventory.

## Registry results

| Metric | Result |
|---|---:|
| Registered frontend features | 49 |
| Canonical API contract mapping | 49/49 (100%) |
| UNKNOWN classifications | 0 |
| Pure localStorage business-truth features | 7 |
| Pure static-fixture business-truth features | 4 |
| Pure hardcoded-runtime business-truth features | 8 |
| Static/mock/hardcoded business-truth total | 12 |
| Compatibility routes remaining | 47 |
| Feature deletions | 0 |
| Visual changes | 0 |
| Backend schema changes | 0 |

### Portal breakdown

| Portal | Features |
|---|---:|
| ADMIN | 16 |
| CMS_EDITOR | 1 |
| PUBLIC_STOREFRONT | 9 |
| RETAIL_CUSTOMER | 5 |
| SHARED | 3 |
| SUPPLIER | 10 |
| VIP_WHOLESALE | 5 |

### Truth-source breakdown

| Classification | Features |
|---|---:|
| CANONICAL_API | 1 |
| COMPAT_PROXY | 7 |
| LOCAL_STORAGE | 7 |
| STATIC_FIXTURE | 4 |
| HARDCODED_RUNTIME | 8 |
| MIXED | 17 |
| PRESENTATION_DEFAULT | 2 |
| BROWSER_EPHEMERAL | 3 |
| DEPRECATED | 0 |
| UNKNOWN | 0 |

## Verification

Linux CI passed typecheck, builds, infrastructure verification, live schema equivalence and all workspace tests:

| Workspace | Files | Tests |
|---|---:|---:|
| `@kolbe/shared` | 2 | 23 |
| `@kolbe/database` | 26 | 147 |
| `@kolbe/api` | 131 | 1,399 |
| `kolbe-next` | 21 | 214 |
| **Repository** | **180** | **1,783** |

The focused registry suite passed 13/13. Local typecheck, package builds, production Next build and infrastructure verification passed. Preflight and migration verification on the available local PostgreSQL port 54329 confirmed **47 migrations, 199 tables, 461 foreign keys and 589 CHECK constraints**. No migration was added.

The full local Next run passed 20 files and 209 tests plus the 13 new registry tests; only the existing schema-authority suite could not connect to its hardcoded Windows port 55432. Linux CI ran and passed all 21 Next files and 214 tests, so this is an environment limitation rather than an application failure.

## Phase 6.1 prerequisites

| Prerequisite | Ready | Evidence |
|---|---|---|
| All meaningful frontend features classified | YES | 49 entries; UNKNOWN = 0; every current page module represented. |
| Canonical owner assigned | YES | Every business entry uses a real registered backend domain. |
| Canonical HTTP contract identified | YES | 49/49 entries have method/path/actor/pagination/error expectations. |
| Compatibility callers known | YES | 47-route inventory and all current helper/call-site families recorded. |
| Session actors mapped | YES | Retail, VIP, Supplier and Admin login/restore/logout and server identity rules documented. |
| Permission boundary mapped | YES | Admin mutations have granular permission expectations. |
| Money and quantity boundary mapped | YES | Monetary entries require decimal strings and prohibit float authority. |
| UI error/loading contract ready | YES | Standard state vocabulary is attached to every feature. |
| Visual freeze enforceable | YES | `visualFreeze=true` for all 49 entries; redesign count is zero. |
| Parity targets present | YES | Every entry references a current test file or explicit planned test ID. |

Phase 6.1 may begin in its own checkpoint. It must implement the shared boundary without wiring portal features early.

## Newly discovered frontend/backend contract gaps

No canonical backend ownership or schema blocker was found. Seven frontend consumption gaps remain assigned to later checkpoints:

1. Four duplicated API/session helpers need one typed shared boundary.
2. Several response/view models still represent authoritative money as `number`.
3. Local tables often assume an unpaginated complete dataset.
4. Some compatibility clients convert network/server failures into empty arrays.
5. Admin and Supplier controls need server permission/capability-driven states.
6. SMS provider credentials currently have a browser-storage UI and must move to server configuration; no real provider is claimed.
7. Compatibility removal requires portal E2E and visual parity in Phase 6.7.

None blocks Phase 6.1. Phase 6.0 made no runtime behavior, visual, feature, schema or backend ownership change.
