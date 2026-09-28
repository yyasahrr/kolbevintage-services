# ADR-004: Strangler migration to a NestJS modular monolith

## Status

Accepted — 2026-09-17. **Partially supersedes [ADR-003](./ADR-003-standalone-next-postgres.md).**

## Context

ADR-003 (2026-09-03) declared that the whole platform runs from one Next.js application whose
route handlers (`/store/kolbe/*`, `/admin/kolbe/*`) execute domain logic and connect directly to
PostgreSQL. That decision was correct for its moment: it removed Supabase quickly and gave the
product a working backend in one step.

The subsequent audit ([`architecture-audit-and-migration-blueprint.md`](../architecture-audit-and-migration-blueprint.md))
established the limits of that design:

- One 840-line handler owns every domain, every table and every authorization decision.
- No module boundaries, so no rule like "a module may not mutate another module's tables" can be
  enforced, and no domain can be tested in isolation.
- No migrations, no dependency-injection seams, no OpenAPI contract, no queue, no object storage.
- The target platform (§1 of the master rules) requires first-class payments, ledger, wallet,
  settlement and payout domains with transactional invariants — this cannot be bolted onto a
  single procedure with inline SQL.

The master architecture (PROMPT 0) mandates a **NestJS modular monolith** as the backend and
forbids microservices.

## Decision

1. **The backend target is a NestJS modular monolith** at `apps/api`, served under `/api/v1`,
   with the 37 modules and ownership rules in
   [`master-architecture-rules.md §3`](../architecture/master-architecture-rules.md).
2. **We migrate by strangling, not by rewriting.** The existing Next.js application keeps serving
   100% of live traffic. Nginx routes domain by domain from the legacy handler to `apps/api`.
3. **The legacy handler is frozen for new features.** It may only receive P0 hot-fixes,
   parity-preserving bug fixes, and the minimum refactors needed to share identity/data with
   `apps/api` (for example the shared `HttpError` contract and the `kolbe_session` cookie).
4. **Two front-ends are extracted rather than rewritten**: the supplier portal and the admin
   portal become static Vite applications that consume `/api/v1`. Their existing components and CSS
   move with them.
5. **The storefront stays on Next.js**, moving from client-only hash routing towards server
   rendering for catalogue and SEO surfaces.

## Consequences

**Positive**

- The live product is never taken down for a migration step; each step is independently revertible
  by flipping a single Nginx route back.
- Every rule in the master charter becomes mechanically enforceable as its module lands.
- Domains with hard transactional requirements (payments, ledger) get a clean implementation
  instead of being retrofitted into the legacy handler.

**Negative / accepted costs**

- **Dual maintenance for the duration.** Two implementations of some endpoints exist while a
  module is being cut over. Mitigated by: parity tests against the same database fixture, and by
  flipping a domain only when its parity checklist is complete.
- **Two HTTP surfaces** (`/store/kolbe/*` and `/api/v1/*`) until the last domain flips.
- **Two identity mechanisms** during the transition: the legacy HMAC bearer token and the
  `kolbe_session` HttpOnly cookie. The legacy verifier is shared, so a token is valid on both
  surfaces; the bearer path is deleted when the last legacy route is retired.
- The repository carries infrastructure (Docker, Nginx, Redis, S3) that the current traffic does
  not yet need. This is deliberate: it is cheaper to have it ready than to retrofit it under load.

## Compliance with ADR-003

ADR-003's *decision paragraph* ("the whole platform runs from one Next.js application") is
superseded. Its *consequences* remain accurate for the phase-0 system and are preserved in the
blueprint's current-state map. No code that followed ADR-003 needs to be reverted: the legacy
handler becomes the strangler's source of truth until each module reaches parity.

## Rollback

Per domain: revert the Nginx location block to the legacy upstream. Data changes are additive
forward-only migrations, so a rollback never requires a destructive down-migration.

## References

- Master rules: [`docs/architecture/master-architecture-rules.md`](../architecture/master-architecture-rules.md)
- Audit & blueprint (current): [`docs/architecture/prompt-1-audit-and-migration-blueprint.md`](../architecture/prompt-1-audit-and-migration-blueprint.md)
- Audit & blueprint (superseded, kept for history): [`docs/architecture-audit-and-migration-blueprint.md`](../architecture-audit-and-migration-blueprint.md)
- Superseded: [`ADR-003`](./ADR-003-standalone-next-postgres.md)
