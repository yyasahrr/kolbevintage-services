/* Phase 5.6 additive extensions to existing owner-domain state checks. Earlier migrations remain immutable. */

ALTER TABLE "admin_role_permission" DROP CONSTRAINT IF EXISTS "admin_role_permission_action_allowed";
--> statement-breakpoint
ALTER TABLE "admin_role_permission" ADD CONSTRAINT "admin_role_permission_action_allowed" CHECK ("action" IN ('wholesale:plan:view', 'wholesale:plan:manage', 'wholesale:membership:view', 'wholesale:membership:manage', 'wholesale:membership:override', 'wholesale:approval:view', 'wholesale:approval:create', 'wholesale:approval:decide', 'wholesale:settings:view', 'wholesale:settings:manage', 'wholesale:notes:view', 'wholesale:notes:create', 'wholesale:control_tower:view', 'crm:customer:view', 'crm:customer:manage', 'crm:stage:manage', 'crm:assign:manage', 'crm:activity:create', 'crm:task:manage', 'crm:tag:manage', 'crm:export', 'crm:sensitive:view', 'support:case:view', 'support:case:reply', 'support:case:assign', 'support:case:priority', 'support:case:resolve', 'support:internal_note:create', 'support:attachment:view', 'support:sla:manage', 'support:report:view', 'support:sensitive:view', 'notification:template:view', 'notification:template:manage', 'notification:outbox:view', 'notification:outbox:retry', 'notification:provider:view', 'notification:preference:manage', 'notification:report:view', 'cms:content:view', 'cms:content:create', 'cms:content:edit', 'cms:content:publish', 'cms:content:archive', 'cms:navigation:manage', 'cms:media:manage', 'cms:seo:manage', 'cms:blog:manage', 'analytics:dashboard:view', 'analytics:report:view', 'analytics:report:manage', 'analytics:export', 'analytics:reconciliation:view', 'production:jobs:view', 'production:config:view', 'production:config:manage', 'production:quality:review', 'production:release:decide', 'production:recall:approve'));
--> statement-breakpoint
ALTER TABLE "notification_event" DROP CONSTRAINT IF EXISTS "notification_event_key_allowed";
--> statement-breakpoint
ALTER TABLE "notification_event" ADD CONSTRAINT "notification_event_key_allowed" CHECK ("event_key" IN ('AUTH_SECURITY_ALERT', 'ORDER_CREATED', 'ORDER_CONFIRMED', 'ORDER_CANCELLED', 'ORDER_FULFILLMENT_UPDATED', 'SHIPMENT_CREATED', 'SHIPMENT_SHIPPED', 'SHIPMENT_DELIVERED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'PAYMENT_FAILED', 'REFUND_REQUESTED', 'REFUND_COMPLETED', 'VIP_MEMBERSHIP_ACTIVATED', 'VIP_MEMBERSHIP_EXPIRING', 'VIP_MEMBERSHIP_SUSPENDED', 'SUPPLIER_ORDER_CREATED', 'SUPPLIER_ORDER_ACTION_REQUIRED', 'SUPPORT_CASE_CREATED', 'SUPPORT_CASE_REPLIED', 'SUPPORT_CASE_STATUS_CHANGED', 'SETTLEMENT_AVAILABLE', 'WITHDRAWAL_REQUESTED', 'WITHDRAWAL_APPROVED', 'PAYOUT_SUBMITTED', 'PAYOUT_RECONCILIATION_REQUIRED', 'COMPLIANCE_ACTION_REQUIRED', 'SUPPLIER_PRODUCTION_JOB_CREATED', 'SUPPLIER_PRODUCTION_ACTION_REQUIRED', 'SUPPLIER_PRODUCTION_QUALITY_UPDATED', 'SUPPLIER_PRODUCTION_RECALL_ACTION_REQUIRED'));
--> statement-breakpoint
ALTER TABLE "notification_template" DROP CONSTRAINT IF EXISTS "notification_template_event_key_allowed";
--> statement-breakpoint
ALTER TABLE "notification_template" ADD CONSTRAINT "notification_template_event_key_allowed" CHECK ("event_key" IN ('AUTH_SECURITY_ALERT', 'ORDER_CREATED', 'ORDER_CONFIRMED', 'ORDER_CANCELLED', 'ORDER_FULFILLMENT_UPDATED', 'SHIPMENT_CREATED', 'SHIPMENT_SHIPPED', 'SHIPMENT_DELIVERED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'PAYMENT_FAILED', 'REFUND_REQUESTED', 'REFUND_COMPLETED', 'VIP_MEMBERSHIP_ACTIVATED', 'VIP_MEMBERSHIP_EXPIRING', 'VIP_MEMBERSHIP_SUSPENDED', 'SUPPLIER_ORDER_CREATED', 'SUPPLIER_ORDER_ACTION_REQUIRED', 'SUPPORT_CASE_CREATED', 'SUPPORT_CASE_REPLIED', 'SUPPORT_CASE_STATUS_CHANGED', 'SETTLEMENT_AVAILABLE', 'WITHDRAWAL_REQUESTED', 'WITHDRAWAL_APPROVED', 'PAYOUT_SUBMITTED', 'PAYOUT_RECONCILIATION_REQUIRED', 'COMPLIANCE_ACTION_REQUIRED', 'SUPPLIER_PRODUCTION_JOB_CREATED', 'SUPPLIER_PRODUCTION_ACTION_REQUIRED', 'SUPPLIER_PRODUCTION_QUALITY_UPDATED', 'SUPPLIER_PRODUCTION_RECALL_ACTION_REQUIRED'));
--> statement-breakpoint

/*
 * Phase 5.6 — Supplier Production / Samples / QC
 *
 * Production is an operational extension of purchase_order. It does not own
 * commercial terms, inventory, shipping, settlement, support, notifications,
 * compliance, or catalog identity.
 */

ALTER TABLE approval_request DROP CONSTRAINT IF EXISTS approval_request_type_allowed;
ALTER TABLE approval_request
  ADD CONSTRAINT approval_request_type_allowed CHECK (request_type IN (
    'MEMBERSHIP_OVERRIDE', 'MEMBERSHIP_PLAN_CHANGE', 'PLAN_VERSION_PUBLISH',
    'BUSINESS_SETTING_CHANGE', 'MEMBERSHIP_MANUAL_ACTIVATE', 'MEMBERSHIP_TERMINATE',
    'PRODUCTION_RECALL'
  ));

CREATE TABLE production_job (
  id text PRIMARY KEY,
  purchase_order_id text NOT NULL,
  supplier_id text NOT NULL,
  seller_id text NOT NULL,
  purchase_order_version integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  target_units integer NOT NULL,
  actual_units integer NOT NULL DEFAULT 0,
  requires_sample_approval boolean NOT NULL DEFAULT true,
  requires_quality_release boolean NOT NULL DEFAULT true,
  planned_start_at timestamptz,
  planned_end_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  version integer NOT NULL DEFAULT 0,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_job_status_allowed CHECK (status IN ('draft', 'planned', 'in_progress', 'blocked', 'completed', 'cancelled')),
  CONSTRAINT production_job_target_units_positive CHECK (target_units > 0),
  CONSTRAINT production_job_actual_units_non_negative CHECK (actual_units >= 0),
  CONSTRAINT production_job_version_non_negative CHECK (version >= 0),
  CONSTRAINT production_job_actual_units_not_over_target CHECK (actual_units <= target_units),
  CONSTRAINT production_job_planned_window_valid CHECK (planned_end_at IS NULL OR planned_start_at IS NULL OR planned_end_at > planned_start_at),
  CONSTRAINT production_job_purchase_order_fk FOREIGN KEY (purchase_order_id) REFERENCES purchase_order(id) ON DELETE RESTRICT,
  CONSTRAINT production_job_supplier_fk FOREIGN KEY (supplier_id) REFERENCES supplier(id) ON DELETE RESTRICT,
  CONSTRAINT production_job_seller_fk FOREIGN KEY (seller_id) REFERENCES seller(id) ON DELETE RESTRICT,
  CONSTRAINT production_job_created_by_fk FOREIGN KEY (created_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX production_job_purchase_order_unique ON production_job(purchase_order_id);
CREATE INDEX production_job_supplier_status_created ON production_job(supplier_id, status, created_at);
CREATE INDEX production_job_seller_status ON production_job(seller_id, status);

CREATE TABLE production_job_history (
  id text PRIMARY KEY,
  job_id text NOT NULL,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  milestone_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_job_history_event_allowed CHECK (event_type IN ('created', 'status_changed', 'milestone_changed', 'capacity_reserved', 'capacity_released', 'actual_units_recorded', 'sample_gate_checked', 'quality_gate_checked', 'handoff_ready')),
  CONSTRAINT production_job_history_job_fk FOREIGN KEY (job_id) REFERENCES production_job(id) ON DELETE RESTRICT,
  CONSTRAINT production_job_history_actor_fk FOREIGN KEY (actor_id) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE INDEX production_job_history_job_created ON production_job_history(job_id, created_at);

CREATE TABLE production_milestone_definition (
  id text PRIMARY KEY,
  milestone_key text NOT NULL,
  label text NOT NULL,
  sequence integer NOT NULL,
  required boolean NOT NULL DEFAULT true,
  default_duration_days integer,
  status text NOT NULL DEFAULT 'active',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_milestone_definition_status_allowed CHECK (status IN ('active', 'archived')),
  CONSTRAINT production_milestone_definition_sequence_positive CHECK (sequence > 0),
  CONSTRAINT production_milestone_definition_duration_non_negative CHECK (default_duration_days IS NULL OR default_duration_days >= 0),
  CONSTRAINT production_milestone_definition_created_by_fk FOREIGN KEY (created_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX production_milestone_definition_key_unique ON production_milestone_definition(milestone_key);
CREATE INDEX production_milestone_definition_status_sequence ON production_milestone_definition(status, sequence);

CREATE TABLE production_job_milestone (
  id text PRIMARY KEY,
  job_id text NOT NULL,
  definition_id text,
  milestone_key text NOT NULL,
  label_snapshot text NOT NULL,
  sequence integer NOT NULL,
  required boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending',
  started_at timestamptz,
  completed_at timestamptz,
  skipped_at timestamptz,
  reason text,
  version integer NOT NULL DEFAULT 0,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_job_milestone_status_allowed CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  CONSTRAINT production_job_milestone_sequence_positive CHECK (sequence > 0),
  CONSTRAINT production_job_milestone_version_non_negative CHECK (version >= 0),
  CONSTRAINT production_job_milestone_job_fk FOREIGN KEY (job_id) REFERENCES production_job(id) ON DELETE RESTRICT,
  CONSTRAINT production_job_milestone_definition_fk FOREIGN KEY (definition_id) REFERENCES production_milestone_definition(id) ON DELETE RESTRICT,
  CONSTRAINT production_job_milestone_updated_by_fk FOREIGN KEY (updated_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX production_job_milestone_job_key_unique ON production_job_milestone(job_id, milestone_key);
CREATE INDEX production_job_milestone_job_sequence ON production_job_milestone(job_id, sequence);

CREATE TABLE supplier_capability (
  id text PRIMARY KEY,
  supplier_id text NOT NULL,
  capability_code text NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  declared_units_per_period integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_capability_status_allowed CHECK (status IN ('active', 'suspended', 'archived')),
  CONSTRAINT supplier_capability_units_non_negative CHECK (declared_units_per_period IS NULL OR declared_units_per_period >= 0),
  CONSTRAINT supplier_capability_supplier_fk FOREIGN KEY (supplier_id) REFERENCES supplier(id) ON DELETE RESTRICT,
  CONSTRAINT supplier_capability_created_by_fk FOREIGN KEY (created_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX supplier_capability_supplier_code_unique ON supplier_capability(supplier_id, capability_code);
CREATE INDEX supplier_capability_supplier_status ON supplier_capability(supplier_id, status);

CREATE TABLE supplier_capacity_period (
  id text PRIMARY KEY,
  supplier_id text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  declared_units integer NOT NULL,
  reserved_units integer NOT NULL DEFAULT 0,
  unavailable_units integer NOT NULL DEFAULT 0,
  actual_units integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  version integer NOT NULL DEFAULT 0,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_capacity_period_status_allowed CHECK (status IN ('open', 'closed')),
  CONSTRAINT supplier_capacity_period_declared_positive CHECK (declared_units > 0),
  CONSTRAINT supplier_capacity_period_reserved_non_negative CHECK (reserved_units >= 0),
  CONSTRAINT supplier_capacity_period_unavailable_non_negative CHECK (unavailable_units >= 0),
  CONSTRAINT supplier_capacity_period_actual_non_negative CHECK (actual_units >= 0),
  CONSTRAINT supplier_capacity_period_version_non_negative CHECK (version >= 0),
  CONSTRAINT supplier_capacity_period_window_valid CHECK (ends_at > starts_at),
  CONSTRAINT supplier_capacity_period_reserved_within_available CHECK (reserved_units + unavailable_units <= declared_units),
  CONSTRAINT supplier_capacity_period_unavailable_within_declared CHECK (unavailable_units <= declared_units),
  CONSTRAINT supplier_capacity_period_supplier_fk FOREIGN KEY (supplier_id) REFERENCES supplier(id) ON DELETE RESTRICT,
  CONSTRAINT supplier_capacity_period_created_by_fk FOREIGN KEY (created_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX supplier_capacity_period_supplier_window_unique ON supplier_capacity_period(supplier_id, starts_at, ends_at);
CREATE INDEX supplier_capacity_period_supplier_status_window ON supplier_capacity_period(supplier_id, status, starts_at, ends_at);

CREATE TABLE supplier_closure (
  id text PRIMARY KEY,
  supplier_id text NOT NULL,
  capacity_period_id text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  unavailable_units integer NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_closure_status_allowed CHECK (status IN ('scheduled', 'active', 'cancelled')),
  CONSTRAINT supplier_closure_units_positive CHECK (unavailable_units > 0),
  CONSTRAINT supplier_closure_window_valid CHECK (ends_at > starts_at),
  CONSTRAINT supplier_closure_supplier_fk FOREIGN KEY (supplier_id) REFERENCES supplier(id) ON DELETE RESTRICT,
  CONSTRAINT supplier_closure_period_fk FOREIGN KEY (capacity_period_id) REFERENCES supplier_capacity_period(id) ON DELETE RESTRICT,
  CONSTRAINT supplier_closure_created_by_fk FOREIGN KEY (created_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE INDEX supplier_closure_supplier_window ON supplier_closure(supplier_id, starts_at, ends_at);

CREATE TABLE production_capacity_reservation (
  id text PRIMARY KEY,
  supplier_id text NOT NULL,
  capacity_period_id text NOT NULL,
  job_id text NOT NULL,
  units integer NOT NULL,
  status text NOT NULL DEFAULT 'reserved',
  idempotency_key text NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  consumed_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_capacity_reservation_status_allowed CHECK (status IN ('reserved', 'released', 'consumed')),
  CONSTRAINT production_capacity_reservation_units_positive CHECK (units > 0),
  CONSTRAINT production_capacity_reservation_supplier_fk FOREIGN KEY (supplier_id) REFERENCES supplier(id) ON DELETE RESTRICT,
  CONSTRAINT production_capacity_reservation_period_fk FOREIGN KEY (capacity_period_id) REFERENCES supplier_capacity_period(id) ON DELETE RESTRICT,
  CONSTRAINT production_capacity_reservation_job_fk FOREIGN KEY (job_id) REFERENCES production_job(id) ON DELETE RESTRICT,
  CONSTRAINT production_capacity_reservation_created_by_fk FOREIGN KEY (created_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX production_capacity_reservation_job_unique ON production_capacity_reservation(job_id);
CREATE UNIQUE INDEX production_capacity_reservation_idempotency_unique ON production_capacity_reservation(supplier_id, idempotency_key);
CREATE INDEX production_capacity_reservation_period_status ON production_capacity_reservation(capacity_period_id, status);

CREATE TABLE production_command (
  id text PRIMARY KEY,
  scope_type text NOT NULL,
  scope_id text NOT NULL,
  command_type text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  result_resource_id text,
  result_payload jsonb,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_command_state_allowed CHECK (state IN ('pending', 'completed', 'failed'))
);
CREATE UNIQUE INDEX production_command_scope_key_unique ON production_command(scope_type, scope_id, command_type, idempotency_key);
CREATE INDEX production_command_state_created ON production_command(state, created_at);

CREATE TABLE production_event (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  source_entity_type text NOT NULL,
  source_entity_id text NOT NULL,
  job_id text,
  supplier_id text NOT NULL,
  recipient_scope text,
  recipient_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_event_type_allowed CHECK (event_type IN ('JOB_CREATED', 'JOB_STATUS_CHANGED', 'MILESTONE_CHANGED', 'CAPACITY_RESERVED', 'CAPACITY_RELEASED', 'SAMPLE_SUBMITTED', 'SAMPLE_REVIEWED', 'CHANGE_REQUEST_SUBMITTED', 'INSPECTION_SUBMITTED', 'DEFECT_RECORDED', 'LOT_CREATED', 'QUALITY_RELEASE_APPROVED', 'RECALL_SUBMITTED', 'RECALL_ACTIVATED')),
  CONSTRAINT production_event_job_fk FOREIGN KEY (job_id) REFERENCES production_job(id) ON DELETE RESTRICT,
  CONSTRAINT production_event_supplier_fk FOREIGN KEY (supplier_id) REFERENCES supplier(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX production_event_source_unique ON production_event(source_entity_type, source_entity_id, event_type);
CREATE INDEX production_event_supplier_created ON production_event(supplier_id, created_at);
CREATE INDEX production_event_job_created ON production_event(job_id, created_at);

CREATE TABLE production_sample (
  id text PRIMARY KEY,
  job_id text NOT NULL,
  sample_type text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  final_review_required boolean NOT NULL DEFAULT false,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_sample_type_allowed CHECK (sample_type IN ('material', 'fit', 'pre_production', 'final')),
  CONSTRAINT production_sample_status_allowed CHECK (status IN ('draft', 'submitted', 'under_review', 'changes_requested', 'rejected', 'approved')),
  CONSTRAINT production_sample_job_fk FOREIGN KEY (job_id) REFERENCES production_job(id) ON DELETE RESTRICT,
  CONSTRAINT production_sample_created_by_fk FOREIGN KEY (created_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX production_sample_job_type_unique ON production_sample(job_id, sample_type);
CREATE INDEX production_sample_job_status ON production_sample(job_id, status);

CREATE TABLE production_sample_revision (
  id text PRIMARY KEY,
  sample_id text NOT NULL,
  revision_number integer NOT NULL,
  specification_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  submitted_by text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'submitted',
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_sample_revision_status_allowed CHECK (status IN ('draft', 'submitted', 'under_review', 'changes_requested', 'rejected', 'approved')),
  CONSTRAINT production_sample_revision_number_positive CHECK (revision_number > 0),
  CONSTRAINT production_sample_revision_sample_fk FOREIGN KEY (sample_id) REFERENCES production_sample(id) ON DELETE RESTRICT,
  CONSTRAINT production_sample_revision_submitted_by_fk FOREIGN KEY (submitted_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX production_sample_revision_number_unique ON production_sample_revision(sample_id, revision_number);
CREATE INDEX production_sample_revision_sample_created ON production_sample_revision(sample_id, created_at);

CREATE TABLE production_sample_review (
  id text PRIMARY KEY,
  sample_revision_id text NOT NULL,
  decision text NOT NULL,
  notes text,
  reviewed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_sample_review_decision_allowed CHECK (decision IN ('approved', 'rejected', 'changes_requested')),
  CONSTRAINT production_sample_review_revision_fk FOREIGN KEY (sample_revision_id) REFERENCES production_sample_revision(id) ON DELETE RESTRICT,
  CONSTRAINT production_sample_review_reviewed_by_fk FOREIGN KEY (reviewed_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE INDEX production_sample_review_revision_created ON production_sample_review(sample_revision_id, created_at);

CREATE TABLE production_artifact (
  id text PRIMARY KEY,
  job_id text NOT NULL,
  sample_revision_id text,
  artifact_type text NOT NULL,
  storage_provider text NOT NULL DEFAULT 'metadata_only',
  object_key text NOT NULL,
  original_filename text,
  mime_type text NOT NULL,
  byte_size integer NOT NULL,
  checksum_sha256 text NOT NULL,
  private boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_artifact_type_allowed CHECK (artifact_type IN ('image', 'pdf', 'measurement', 'specification', 'other')),
  CONSTRAINT production_artifact_provider_allowed CHECK (storage_provider IN ('metadata_only')),
  CONSTRAINT production_artifact_mime_allowed CHECK (mime_type IN ('image/jpeg', 'image/png', 'application/pdf', 'text/plain')),
  CONSTRAINT production_artifact_byte_size_positive CHECK (byte_size > 0 AND byte_size <= 5242880),
  CONSTRAINT production_artifact_private_required CHECK (private = true),
  CONSTRAINT production_artifact_checksum_shape CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT production_artifact_job_fk FOREIGN KEY (job_id) REFERENCES production_job(id) ON DELETE RESTRICT,
  CONSTRAINT production_artifact_revision_fk FOREIGN KEY (sample_revision_id) REFERENCES production_sample_revision(id) ON DELETE RESTRICT,
  CONSTRAINT production_artifact_created_by_fk FOREIGN KEY (created_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX production_artifact_object_key_unique ON production_artifact(object_key);
CREATE INDEX production_artifact_job_created ON production_artifact(job_id, created_at);

CREATE TABLE production_change_request (
  id text PRIMARY KEY,
  job_id text NOT NULL,
  change_type text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  owner_domain text NOT NULL,
  requested_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL,
  commercial_impact boolean NOT NULL DEFAULT false,
  delivery_impact boolean NOT NULL DEFAULT false,
  owner_decision_reference text,
  support_case_reference text,
  requested_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_change_type_allowed CHECK (change_type IN ('operational', 'commercial', 'delivery')),
  CONSTRAINT production_change_status_allowed CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'withdrawn')),
  CONSTRAINT production_change_owner_domain_allowed CHECK (owner_domain IN ('orders', 'offers', 'shipping', 'production')),
  CONSTRAINT production_change_commercial_owner_bound CHECK (commercial_impact = false OR owner_domain IN ('orders', 'offers')),
  CONSTRAINT production_change_delivery_owner_bound CHECK (delivery_impact = false OR owner_domain = 'shipping'),
  CONSTRAINT production_change_job_fk FOREIGN KEY (job_id) REFERENCES production_job(id) ON DELETE RESTRICT,
  CONSTRAINT production_change_requested_by_fk FOREIGN KEY (requested_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE INDEX production_change_job_status_created ON production_change_request(job_id, status, created_at);

CREATE TABLE production_change_decision (
  id text PRIMARY KEY,
  change_request_id text NOT NULL,
  decision text NOT NULL,
  decision_reference text,
  notes text,
  decided_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_change_decision_allowed CHECK (decision IN ('approved', 'rejected', 'needs_information')),
  CONSTRAINT production_change_decision_request_fk FOREIGN KEY (change_request_id) REFERENCES production_change_request(id) ON DELETE RESTRICT,
  CONSTRAINT production_change_decision_decided_by_fk FOREIGN KEY (decided_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE INDEX production_change_decision_request_created ON production_change_decision(change_request_id, created_at);

CREATE TABLE quality_checklist (
  id text PRIMARY KEY,
  checklist_key text NOT NULL,
  version integer NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quality_checklist_status_allowed CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT quality_checklist_version_positive CHECK (version > 0),
  CONSTRAINT quality_checklist_created_by_fk FOREIGN KEY (created_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX quality_checklist_key_version_unique ON quality_checklist(checklist_key, version);
CREATE INDEX quality_checklist_key_status ON quality_checklist(checklist_key, status);

CREATE TABLE quality_checklist_item (
  id text PRIMARY KEY,
  checklist_id text NOT NULL,
  item_key text NOT NULL,
  label text NOT NULL,
  sequence integer NOT NULL,
  measurement_type text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  min_integer integer,
  max_integer integer,
  unit text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quality_checklist_item_measurement_allowed CHECK (measurement_type IN ('integer', 'boolean', 'text')),
  CONSTRAINT quality_checklist_item_sequence_positive CHECK (sequence > 0),
  CONSTRAINT quality_checklist_item_integer_bounds_ordered CHECK (min_integer IS NULL OR max_integer IS NULL OR max_integer >= min_integer),
  CONSTRAINT quality_checklist_item_checklist_fk FOREIGN KEY (checklist_id) REFERENCES quality_checklist(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX quality_checklist_item_key_unique ON quality_checklist_item(checklist_id, item_key);
CREATE INDEX quality_checklist_item_sequence_idx ON quality_checklist_item(checklist_id, sequence);

CREATE TABLE production_lot (
  id text PRIMARY KEY,
  job_id text NOT NULL,
  purchase_order_id text NOT NULL,
  lot_code text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  planned_units integer NOT NULL,
  produced_units integer NOT NULL DEFAULT 0,
  accepted_units integer NOT NULL DEFAULT 0,
  rejected_units integer NOT NULL DEFAULT 0,
  rework_units integer NOT NULL DEFAULT 0,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_lot_status_allowed CHECK (status IN ('open', 'in_progress', 'completed', 'released', 'recall_hold')),
  CONSTRAINT production_lot_planned_units_positive CHECK (planned_units > 0),
  CONSTRAINT production_lot_produced_non_negative CHECK (produced_units >= 0),
  CONSTRAINT production_lot_accepted_non_negative CHECK (accepted_units >= 0),
  CONSTRAINT production_lot_rejected_non_negative CHECK (rejected_units >= 0),
  CONSTRAINT production_lot_rework_non_negative CHECK (rework_units >= 0),
  CONSTRAINT production_lot_accepted_rejected_within_produced CHECK (accepted_units + rejected_units <= produced_units),
  CONSTRAINT production_lot_disposition_within_produced CHECK (accepted_units + rejected_units + rework_units <= produced_units),
  CONSTRAINT production_lot_rework_within_produced CHECK (rework_units <= produced_units),
  CONSTRAINT production_lot_job_fk FOREIGN KEY (job_id) REFERENCES production_job(id) ON DELETE RESTRICT,
  CONSTRAINT production_lot_purchase_order_fk FOREIGN KEY (purchase_order_id) REFERENCES purchase_order(id) ON DELETE RESTRICT,
  CONSTRAINT production_lot_created_by_fk FOREIGN KEY (created_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX production_lot_code_unique ON production_lot(lot_code);
CREATE INDEX production_lot_job_status ON production_lot(job_id, status);

CREATE TABLE quality_inspection (
  id text PRIMARY KEY,
  job_id text NOT NULL,
  lot_id text NOT NULL,
  checklist_id text NOT NULL,
  checklist_version integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  sample_size integer NOT NULL,
  accepted_units integer NOT NULL DEFAULT 0,
  defect_units integer NOT NULL DEFAULT 0,
  rework_units integer NOT NULL DEFAULT 0,
  rejected_units integer NOT NULL DEFAULT 0,
  defect_rate_bps integer NOT NULL DEFAULT 0,
  pass_rate_bps integer NOT NULL DEFAULT 0,
  decision text,
  submitted_by text,
  submitted_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quality_inspection_status_allowed CHECK (status IN ('draft', 'in_progress', 'submitted', 'accepted', 'rejected', 'rework_required', 'cancelled')),
  CONSTRAINT quality_inspection_decision_allowed CHECK (decision IN ('accepted', 'rejected', 'rework_required')),
  CONSTRAINT quality_inspection_sample_size_positive CHECK (sample_size > 0),
  CONSTRAINT quality_inspection_accepted_non_negative CHECK (accepted_units >= 0),
  CONSTRAINT quality_inspection_defect_non_negative CHECK (defect_units >= 0),
  CONSTRAINT quality_inspection_rework_non_negative CHECK (rework_units >= 0),
  CONSTRAINT quality_inspection_rejected_non_negative CHECK (rejected_units >= 0),
  CONSTRAINT quality_inspection_arithmetic_invariant CHECK (status IN ('draft', 'in_progress') OR sample_size = accepted_units + defect_units + rework_units + rejected_units),
  CONSTRAINT quality_inspection_defect_rate_bounds CHECK (defect_rate_bps >= 0 AND defect_rate_bps <= 10000),
  CONSTRAINT quality_inspection_pass_rate_bounds CHECK (pass_rate_bps >= 0 AND pass_rate_bps <= 10000),
  CONSTRAINT quality_inspection_rates_not_over_total CHECK (defect_rate_bps + pass_rate_bps <= 10000),
  CONSTRAINT quality_inspection_job_fk FOREIGN KEY (job_id) REFERENCES production_job(id) ON DELETE RESTRICT,
  CONSTRAINT quality_inspection_lot_fk FOREIGN KEY (lot_id) REFERENCES production_lot(id) ON DELETE RESTRICT,
  CONSTRAINT quality_inspection_checklist_fk FOREIGN KEY (checklist_id) REFERENCES quality_checklist(id) ON DELETE RESTRICT,
  CONSTRAINT quality_inspection_submitted_by_fk FOREIGN KEY (submitted_by) REFERENCES account_user(id) ON DELETE RESTRICT,
  CONSTRAINT quality_inspection_created_by_fk FOREIGN KEY (created_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE INDEX quality_inspection_job_status_created ON quality_inspection(job_id, status, created_at);
CREATE INDEX quality_inspection_lot_status ON quality_inspection(lot_id, status);

CREATE TABLE quality_inspection_item (
  id text PRIMARY KEY,
  inspection_id text NOT NULL,
  checklist_item_id text NOT NULL,
  item_key_snapshot text NOT NULL,
  measurement_type_snapshot text NOT NULL,
  observed_integer integer,
  observed_boolean boolean,
  observed_text text,
  passed boolean,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quality_inspection_item_measurement_allowed CHECK (measurement_type_snapshot IN ('integer', 'boolean', 'text')),
  CONSTRAINT quality_inspection_item_inspection_fk FOREIGN KEY (inspection_id) REFERENCES quality_inspection(id) ON DELETE RESTRICT,
  CONSTRAINT quality_inspection_item_checklist_item_fk FOREIGN KEY (checklist_item_id) REFERENCES quality_checklist_item(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX quality_inspection_item_unique ON quality_inspection_item(inspection_id, checklist_item_id);
CREATE INDEX quality_inspection_item_inspection ON quality_inspection_item(inspection_id);

CREATE TABLE quality_defect (
  id text PRIMARY KEY,
  job_id text NOT NULL,
  lot_id text NOT NULL,
  inspection_id text,
  defect_code text NOT NULL,
  description text NOT NULL,
  severity text NOT NULL,
  quantity integer NOT NULL,
  status text NOT NULL DEFAULT 'open',
  disposition_note text,
  detected_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quality_defect_severity_allowed CHECK (severity IN ('minor', 'major', 'critical')),
  CONSTRAINT quality_defect_status_allowed CHECK (status IN ('open', 'acknowledged', 'rework', 'accepted', 'waived', 'closed')),
  CONSTRAINT quality_defect_quantity_positive CHECK (quantity > 0),
  CONSTRAINT quality_defect_job_fk FOREIGN KEY (job_id) REFERENCES production_job(id) ON DELETE RESTRICT,
  CONSTRAINT quality_defect_lot_fk FOREIGN KEY (lot_id) REFERENCES production_lot(id) ON DELETE RESTRICT,
  CONSTRAINT quality_defect_inspection_fk FOREIGN KEY (inspection_id) REFERENCES quality_inspection(id) ON DELETE RESTRICT,
  CONSTRAINT quality_defect_detected_by_fk FOREIGN KEY (detected_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE INDEX quality_defect_job_status_severity ON quality_defect(job_id, status, severity);
CREATE INDEX quality_defect_lot_status ON quality_defect(lot_id, status);

CREATE TABLE quality_rework (
  id text PRIMARY KEY,
  job_id text NOT NULL,
  lot_id text NOT NULL,
  defect_id text NOT NULL,
  quantity integer NOT NULL,
  instructions text NOT NULL,
  status text NOT NULL DEFAULT 'requested',
  requested_by text NOT NULL,
  completed_by text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quality_rework_status_allowed CHECK (status IN ('requested', 'in_progress', 'completed', 'failed', 'cancelled')),
  CONSTRAINT quality_rework_quantity_positive CHECK (quantity > 0),
  CONSTRAINT quality_rework_job_fk FOREIGN KEY (job_id) REFERENCES production_job(id) ON DELETE RESTRICT,
  CONSTRAINT quality_rework_lot_fk FOREIGN KEY (lot_id) REFERENCES production_lot(id) ON DELETE RESTRICT,
  CONSTRAINT quality_rework_defect_fk FOREIGN KEY (defect_id) REFERENCES quality_defect(id) ON DELETE RESTRICT,
  CONSTRAINT quality_rework_requested_by_fk FOREIGN KEY (requested_by) REFERENCES account_user(id) ON DELETE RESTRICT,
  CONSTRAINT quality_rework_completed_by_fk FOREIGN KEY (completed_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE INDEX quality_rework_job_status ON quality_rework(job_id, status);

CREATE TABLE production_lot_trace (
  id text PRIMARY KEY,
  lot_id text NOT NULL,
  trace_type text NOT NULL,
  purchase_order_item_id text,
  variant_id text,
  source_lot_id text,
  quantity integer NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_lot_trace_type_allowed CHECK (trace_type IN ('purchase_order_item', 'variant', 'source_lot')),
  CONSTRAINT production_lot_trace_quantity_positive CHECK (quantity > 0),
  CONSTRAINT production_lot_trace_target_present CHECK ((trace_type = 'purchase_order_item' AND purchase_order_item_id IS NOT NULL AND variant_id IS NULL AND source_lot_id IS NULL) OR (trace_type = 'variant' AND variant_id IS NOT NULL AND purchase_order_item_id IS NULL AND source_lot_id IS NULL) OR (trace_type = 'source_lot' AND source_lot_id IS NOT NULL AND purchase_order_item_id IS NULL AND variant_id IS NULL)),
  CONSTRAINT production_lot_trace_lot_fk FOREIGN KEY (lot_id) REFERENCES production_lot(id) ON DELETE RESTRICT,
  CONSTRAINT production_lot_trace_purchase_order_item_fk FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_item(id) ON DELETE RESTRICT,
  CONSTRAINT production_lot_trace_variant_fk FOREIGN KEY (variant_id) REFERENCES product_variant(id) ON DELETE RESTRICT,
  CONSTRAINT production_lot_trace_source_lot_fk FOREIGN KEY (source_lot_id) REFERENCES production_lot(id) ON DELETE RESTRICT,
  CONSTRAINT production_lot_trace_created_by_fk FOREIGN KEY (created_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX production_lot_trace_unique ON production_lot_trace(lot_id, trace_type, purchase_order_item_id, variant_id, source_lot_id);
CREATE INDEX production_lot_trace_po_item ON production_lot_trace(purchase_order_item_id);
CREATE INDEX production_lot_trace_variant ON production_lot_trace(variant_id);

CREATE TABLE quality_release (
  id text PRIMARY KEY,
  job_id text NOT NULL,
  lot_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  readiness_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by text NOT NULL,
  decided_by text,
  decision_note text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quality_release_status_allowed CHECK (status IN ('pending', 'ready', 'approved', 'rejected', 'revoked')),
  CONSTRAINT quality_release_job_fk FOREIGN KEY (job_id) REFERENCES production_job(id) ON DELETE RESTRICT,
  CONSTRAINT quality_release_lot_fk FOREIGN KEY (lot_id) REFERENCES production_lot(id) ON DELETE RESTRICT,
  CONSTRAINT quality_release_requested_by_fk FOREIGN KEY (requested_by) REFERENCES account_user(id) ON DELETE RESTRICT,
  CONSTRAINT quality_release_decided_by_fk FOREIGN KEY (decided_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX quality_release_job_lot_unique ON quality_release(job_id, lot_id);
CREATE INDEX quality_release_status_created ON quality_release(status, created_at);

CREATE TABLE production_recall (
  id text PRIMARY KEY,
  supplier_id text NOT NULL,
  job_id text,
  severity text NOT NULL,
  scope_type text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  reason text NOT NULL,
  approval_request_id text,
  maker_id text NOT NULL,
  checker_id text,
  activated_at timestamptz,
  contained_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_recall_severity_allowed CHECK (severity IN ('low', 'high', 'critical', 'global')),
  CONSTRAINT production_recall_scope_type_allowed CHECK (scope_type IN ('lot', 'order_item', 'variant', 'global')),
  CONSTRAINT production_recall_status_allowed CHECK (status IN ('draft', 'pending_approval', 'approved', 'active', 'contained', 'closed', 'rejected', 'cancelled')),
  CONSTRAINT production_recall_checker_distinct CHECK (checker_id IS NULL OR checker_id <> maker_id),
  CONSTRAINT production_recall_supplier_fk FOREIGN KEY (supplier_id) REFERENCES supplier(id) ON DELETE RESTRICT,
  CONSTRAINT production_recall_job_fk FOREIGN KEY (job_id) REFERENCES production_job(id) ON DELETE RESTRICT,
  CONSTRAINT production_recall_approval_request_fk FOREIGN KEY (approval_request_id) REFERENCES approval_request(id) ON DELETE RESTRICT,
  CONSTRAINT production_recall_maker_fk FOREIGN KEY (maker_id) REFERENCES account_user(id) ON DELETE RESTRICT,
  CONSTRAINT production_recall_checker_fk FOREIGN KEY (checker_id) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX production_recall_approval_request_unique ON production_recall(approval_request_id) WHERE approval_request_id IS NOT NULL;
CREATE INDEX production_recall_supplier_status_created ON production_recall(supplier_id, status, created_at);

CREATE TABLE production_recall_scope (
  id text PRIMARY KEY,
  recall_id text NOT NULL,
  lot_id text,
  purchase_order_item_id text,
  variant_id text,
  quantity integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_recall_scope_quantity_non_negative CHECK (quantity IS NULL OR quantity >= 0),
  CONSTRAINT production_recall_scope_target_exactly_one CHECK (((lot_id IS NOT NULL)::integer + (purchase_order_item_id IS NOT NULL)::integer + (variant_id IS NOT NULL)::integer) = 1),
  CONSTRAINT production_recall_scope_recall_fk FOREIGN KEY (recall_id) REFERENCES production_recall(id) ON DELETE RESTRICT,
  CONSTRAINT production_recall_scope_lot_fk FOREIGN KEY (lot_id) REFERENCES production_lot(id) ON DELETE RESTRICT,
  CONSTRAINT production_recall_scope_purchase_order_item_fk FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_item(id) ON DELETE RESTRICT,
  CONSTRAINT production_recall_scope_variant_fk FOREIGN KEY (variant_id) REFERENCES product_variant(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX production_recall_scope_target_unique ON production_recall_scope(recall_id, lot_id, purchase_order_item_id, variant_id);
CREATE INDEX production_recall_scope_recall ON production_recall_scope(recall_id);

CREATE TABLE production_recall_approval (
  id text PRIMARY KEY,
  recall_id text NOT NULL,
  approval_request_id text NOT NULL,
  decision text NOT NULL,
  maker_id text NOT NULL,
  checker_id text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_recall_approval_decision_allowed CHECK (decision IN ('approved', 'rejected')),
  CONSTRAINT production_recall_approval_distinct CHECK (maker_id <> checker_id),
  CONSTRAINT production_recall_approval_recall_fk FOREIGN KEY (recall_id) REFERENCES production_recall(id) ON DELETE RESTRICT,
  CONSTRAINT production_recall_approval_request_fk FOREIGN KEY (approval_request_id) REFERENCES approval_request(id) ON DELETE RESTRICT,
  CONSTRAINT production_recall_approval_maker_fk FOREIGN KEY (maker_id) REFERENCES account_user(id) ON DELETE RESTRICT,
  CONSTRAINT production_recall_approval_checker_fk FOREIGN KEY (checker_id) REFERENCES account_user(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX production_recall_approval_request_row_unique ON production_recall_approval(approval_request_id);
CREATE INDEX production_recall_approval_recall_created ON production_recall_approval(recall_id, created_at);

/* Approved revisions and evidence are append-only. */
CREATE OR REPLACE FUNCTION phase_5_6_reject_immutable_production_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'phase_5_6_immutable_row';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'phase_5_6_immutable_row';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER production_sample_review_append_only BEFORE UPDATE OR DELETE ON production_sample_review FOR EACH ROW EXECUTE FUNCTION phase_5_6_reject_immutable_production_row();
CREATE TRIGGER production_artifact_append_only BEFORE UPDATE OR DELETE ON production_artifact FOR EACH ROW EXECUTE FUNCTION phase_5_6_reject_immutable_production_row();
CREATE TRIGGER production_job_history_append_only BEFORE UPDATE OR DELETE ON production_job_history FOR EACH ROW EXECUTE FUNCTION phase_5_6_reject_immutable_production_row();
CREATE TRIGGER production_event_append_only BEFORE UPDATE OR DELETE ON production_event FOR EACH ROW EXECUTE FUNCTION phase_5_6_reject_immutable_production_row();
CREATE TRIGGER production_change_decision_append_only BEFORE UPDATE OR DELETE ON production_change_decision FOR EACH ROW EXECUTE FUNCTION phase_5_6_reject_immutable_production_row();
CREATE TRIGGER production_recall_approval_append_only BEFORE UPDATE OR DELETE ON production_recall_approval FOR EACH ROW EXECUTE FUNCTION phase_5_6_reject_immutable_production_row();
CREATE TRIGGER production_lot_trace_append_only BEFORE UPDATE OR DELETE ON production_lot_trace FOR EACH ROW EXECUTE FUNCTION phase_5_6_reject_immutable_production_row();
CREATE TRIGGER quality_inspection_item_append_only BEFORE UPDATE OR DELETE ON quality_inspection_item FOR EACH ROW EXECUTE FUNCTION phase_5_6_reject_immutable_production_row();

CREATE OR REPLACE FUNCTION phase_5_6_reject_approved_sample_revision_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'approved' THEN
    RAISE EXCEPTION 'phase_5_6_approved_sample_revision_immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER production_sample_revision_approved_immutable BEFORE UPDATE OR DELETE ON production_sample_revision FOR EACH ROW EXECUTE FUNCTION phase_5_6_reject_approved_sample_revision_mutation();

CREATE OR REPLACE FUNCTION phase_5_6_reject_published_checklist_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'phase_5_6_published_checklist_immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER quality_checklist_published_immutable BEFORE UPDATE OR DELETE ON quality_checklist FOR EACH ROW EXECUTE FUNCTION phase_5_6_reject_published_checklist_mutation();

CREATE OR REPLACE FUNCTION phase_5_6_reject_published_checklist_item_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM quality_checklist WHERE id = OLD.checklist_id AND status = 'published') THEN
    RAISE EXCEPTION 'phase_5_6_published_checklist_item_immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER quality_checklist_item_published_immutable BEFORE UPDATE OR DELETE ON quality_checklist_item FOR EACH ROW EXECUTE FUNCTION phase_5_6_reject_published_checklist_item_mutation();

CREATE OR REPLACE FUNCTION phase_5_6_reject_approved_sample_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'approved' THEN
    RAISE EXCEPTION 'phase_5_6_approved_sample_immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER production_sample_approved_immutable BEFORE UPDATE OR DELETE ON production_sample FOR EACH ROW EXECUTE FUNCTION phase_5_6_reject_approved_sample_mutation();

CREATE OR REPLACE FUNCTION phase_5_6_reject_submitted_inspection_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('submitted', 'accepted', 'rejected') THEN
    RAISE EXCEPTION 'phase_5_6_submitted_inspection_immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER quality_inspection_submitted_immutable BEFORE UPDATE OR DELETE ON quality_inspection FOR EACH ROW EXECUTE FUNCTION phase_5_6_reject_submitted_inspection_mutation();
