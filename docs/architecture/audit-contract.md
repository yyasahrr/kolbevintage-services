# Audit boundary freeze

Normative Phase 3.10 target; implementation remains unchanged.

```text
Domain command (one transaction)
    -> owning service mutation
    -> AuditService.record(entry, same executor)
    -> commit
```

AuditService owns `audit_log` and is the sole table writer. Inventory, Orders, Payments, Suppliers and Admin never insert, update or delete audit rows themselves. Admin invokes owner commands; it has no audit or business table ownership.

The existing `apps/api/src/modules/audit/audit.service.ts` already accepts an executor. It also defaults to the root database, which is insufficient for a multi-write business transaction. Every sensitive domain mutation MUST explicitly pass the transaction executor. Audit failure MUST abort that mutation. No try/catch-and-continue, asynchronous fire-and-forget or second database transaction is allowed for success evidence.

## Record contract

Record actor ID/role or trusted system identity, action, entity type/ID, before/after state, reason, command/event correlation, request trace ID and safe metadata. Use `Claims.sub` from verified authentication, not client actor fields. A wholesale request ID and an HTTP trace request ID are distinct: store the former in entity metadata and the latter in `request_id`.

No passwords, TOTP secrets, session tokens, provider secrets or full request bodies. Redact personal/address fields to the minimum needed for the action. Domain events and status history are not substitutes for Audit; financial ledger is a separate future owner.

`audit_log_append_only` in migration 0001 rejects update/delete. Corrections append a record referencing the original. Read access remains admin-authorized, bounded and paginated. Replayed idempotent commands do not append duplicate successful mutation audit rows. Failed auth/security attempts may use independent audit transactions because no successful business mutation is being committed.

## Current deviations and closure

| Current code | State | Required future closure |
| --- | --- | --- |
| InventoryService.recordAudit | Direct insert on root DB, catch ignores errors | 4.1: replace with AuditService on same executor and test rollback |
| Next.js `appendAudit(client, ...)` | Transactional legacy adapter but direct SQL owner bypass | 4.3/4.5: move affected commands into owner services; preserve historical audit rows |
| Catalog approval, Offers mutations, VIP activation, Suppliers creation | No consistent transaction-bound AuditService success record | Add as each dependent boundary is hardened; mandatory before Orders exposes those transitions |
| AuditService default executor | Legal API for standalone records, not proof of atomic command auditing | Require explicit transaction in sensitive callers; future API tightening after caller audit |

Required tests: successful mutation has one record; audit write failure rolls back all domain effects; duplicate command does not duplicate audit; rejected transition has no success record; update/delete trigger remains effective; actor/tenant isolation and redaction.
