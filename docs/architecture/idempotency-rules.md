# Idempotency rules

Phase 3.10 target contract; no command table or middleware is implemented here.

## Required commands

Create wholesale request, accept/revise request, create/convert order, reserve inventory/package, release/consume/expire allocation, confirm payment (future), fulfill/dispatch/deliver order and admin overrides require idempotency. Reads do not.

External requests use `Idempotency-Key`, pattern `[A-Za-z0-9._:-]{8,128}`. Internal commands derive a stable operation key from parent command ID, operation and allocation generation. A webhook uses `(provider, provider_account, provider_event_id)`, not a new random key on every retry. Request trace ID is not the idempotency key.

## Scope and replay

Key uniqueness is `(authenticated tenant/buyer or seller scope, command_type, key)`. Verify authentication and resource access before replay, including revoked access. Never return another buyer's order because the text key matches.

Canonicalize validated semantic inputs and hash them: resource IDs, quantities, version, selected terms and currency where relevant; exclude trace IDs and volatile headers. Store the hash with the key. Same key and hash returns original successful result (`200`, `replayed: true`; initial creation `201`). Same key with different hash returns `409 IDEMPOTENCY_KEY_REUSED`. It must not re-price from the current catalog on replay.

Concurrent matching commands serialize on a database unique key/row lock; bounded wait then `409 COMMAND_IN_PROGRESS` with retry guidance is acceptable. Database uniqueness is required: SELECT-before-INSERT alone races. A business uniqueness constraint (one order conversion per request version, one active allocation generation per component) also prevents duplicates submitted with different keys.

## Future storage strategy

A neutral database command-deduplication facility owns future `command_idempotency`: id, scope, command_type, key, request_hash, state, result_resource_id, safe response/version, created_at, completed_at, response_expires_at. Unique scope/type/key; index response expiry for pruning. The initiating domain uses this infrastructure and its own business unique constraints; no domain reads another domain's idempotency rows directly.

For local commands, claim, mutation, audit and completed result commit in the SAME transaction. An uncommitted claim vanishes on rollback. Validation failures before any mutation are not cached; retry is safe. A crash after commit but before HTTP response replays the committed result. A connection loss with uncertain commit must query/retry the same key, never invent a replacement key.

Future external side effects require durable intent/outbox and provider keys; a SQL transaction cannot roll back an external charge. No outbox/payment integration is implemented by this phase. Record incoming provider events before applying their one-time business effect in the future owning module.

## Expiration and retention

Retain full safe response payloads for at least 30 days as the initial engineering policy. After response pruning, retain scope/key/hash/resource mapping for the lifetime of the referenced request/order/reservation; expired payloads do not free the key for reuse. Reconstruct a safe original result from immutable snapshots, or return an explicit already-completed resource reference; never execute again just because a cache expired.

Provider-event and financial command identities are never pruned by the ordinary response TTL. Final legal retention is separate policy work. Reservation expiry is independent of idempotency retention: a replay must report the same allocation identity and its current terminal state where documented, not reserve again. A deliberate new allocation uses a new generation and explicit command.

## Baseline gap and tests

Legacy wholesale/retail idempotency keys are nullable/global order columns with SELECT-before-INSERT; they do not bind payload or buyer and can race into a uniqueness error. Inventory and VIP request commands have no durable key. Retain historical keys during cutover and expose a compatibility policy; no clearing or reuse of old keys.

Required tests: simultaneous duplicate creates, different payload same key, same key different tenant, revoked access before replay, timeout after commit, audit failure rollback, response pruning without duplicate side effect, two keys for one accepted request, webhook duplicate delivery, and concurrent terminal inventory actions.
