/* Phase 5.7 Checkpoint B — maker/checker execution for publish/pause and order
 * attribution binding on the redemption ledger. Additive only: earlier
 * migrations remain immutable.
 *
 * 1. `approval_request`: the maker/checker type catalog gains PROMOTION_PUBLISH
 *    and PROMOTION_PAUSE. Execution itself stays domain-owned (Promotions
 *    performs its own transitions after asserting the approval row), following
 *    the PRODUCTION_RECALL precedent — the shared row enforces maker/checker
 *    separation, never domain logic.
 * 2. `promotion_coupon_redemption`: every redemption binds to the evaluation
 *    that produced it (`evaluation_version` + `terms_hash`), making the ledger
 *    the order attribution record (PromotionAttributionSnapshot). Nullable
 *    only for rows predating this migration; new writes require both at the
 *    API layer. No backfill: inventing attribution for old rows would be
 *    dishonest. No FK to order tables: orders own their tables; the loose
 *    `order_reference` remains the join key.
 */

ALTER TABLE approval_request DROP CONSTRAINT IF EXISTS approval_request_type_allowed;
--> statement-breakpoint
ALTER TABLE approval_request
  ADD CONSTRAINT approval_request_type_allowed CHECK (request_type IN (
    'MEMBERSHIP_OVERRIDE', 'MEMBERSHIP_PLAN_CHANGE', 'PLAN_VERSION_PUBLISH',
    'BUSINESS_SETTING_CHANGE', 'MEMBERSHIP_MANUAL_ACTIVATE', 'MEMBERSHIP_TERMINATE',
    'PRODUCTION_RECALL', 'PROMOTION_PUBLISH', 'PROMOTION_PAUSE'
  ));
--> statement-breakpoint
ALTER TABLE promotion_coupon_redemption ADD COLUMN evaluation_version text;
--> statement-breakpoint
ALTER TABLE promotion_coupon_redemption ADD COLUMN terms_hash text;
--> statement-breakpoint
ALTER TABLE promotion_coupon_redemption
  ADD CONSTRAINT promotion_coupon_redemption_terms_hash_format CHECK ("terms_hash" IS NULL OR "terms_hash" ~ '^[0-9a-f]{64}$');
