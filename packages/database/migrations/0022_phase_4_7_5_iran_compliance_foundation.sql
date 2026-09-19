-- Phase 4.7.5 — Iran Legal, Compliance, Privacy & Tax-Readiness Foundation
-- Forward-only. 0020/0021 are NOT modified. All FKs ON DELETE RESTRICT. No data rewrite.
--
-- Ownership: `compliance` module (legal/consent/business/supplier/product compliance,
-- privacy) and `invoicing` module (commercial invoice, fiscal document, tax config).
--
-- Legal-evidence guarantees enforced at DB level (not only in TypeScript):
--   T1 legal_policy_document: content/identity columns immutable once published;
--      published rows can only move to `retired`; published/retired rows cannot be deleted.
--   T2 append-only evidence: legal_policy_acceptance, consent_event,
--      supplier_contract_acceptance, supplier_compliance_review,
--      transaction_compliance_snapshot, commercial_invoice_line, fiscal_submission_event.
--   T3 holds (supplier_compliance_hold, legal_hold): only active -> released; never deleted.
--   T4 commercial_invoice: once issued, only `issued -> voided` (void metadata) is allowed;
--      an issued/voided invoice is never deleted.
-- Nothing here creates wallet / settlement / payout structures (Phase 4.8).

CREATE TABLE "business_compliance_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"credential_type" text NOT NULL,
	"issuer" text NOT NULL,
	"public_reference" text,
	"verification_url" text,
	"issued_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'unverified' NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"verification_source" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_compliance_credential_type_allowed" CHECK ("credential_type" IN ('ENAMAD', 'BUSINESS_LICENSE', 'TAX_REGISTRATION', 'INDUSTRY_LICENSE', 'OTHER')),
	CONSTRAINT "business_compliance_credential_status_allowed" CHECK ("status" IN ('unverified', 'verified', 'expired', 'revoked')),
	CONSTRAINT "business_compliance_credential_verified_consistency" CHECK (("status" <> 'verified') OR ("verified_at" IS NOT NULL AND "verified_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "business_legal_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_key" text NOT NULL,
	"legal_name" text,
	"trade_name" text,
	"entity_type" text,
	"registration_identifier" text,
	"tax_identifier" text,
	"business_address" jsonb,
	"support_email" text,
	"support_phone" text,
	"complaint_contact" text,
	"internal_notes" text,
	"last_reviewed_at" timestamp with time zone,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_legal_profile_profile_key_unique" UNIQUE("profile_key"),
	CONSTRAINT "business_legal_profile_entity_type_allowed" CHECK ("entity_type" IS NULL OR "entity_type" IN ('individual', 'company', 'cooperative', 'other'))
);
--> statement-breakpoint
CREATE TABLE "commercial_invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_number" text NOT NULL,
	"scope" text NOT NULL,
	"wholesale_order_id" text,
	"child_order_id" text,
	"retail_order_ref" text,
	"seller_id" text,
	"seller_snapshot" jsonb NOT NULL,
	"buyer_snapshot" jsonb NOT NULL,
	"currency" text DEFAULT 'IRR' NOT NULL,
	"subtotal" bigint DEFAULT 0 NOT NULL,
	"shipping_total" bigint DEFAULT 0 NOT NULL,
	"tax_total" bigint DEFAULT 0 NOT NULL,
	"tax_status" text DEFAULT 'not_assessed' NOT NULL,
	"tax_basis_reference" text,
	"grand_total" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"issued_at" timestamp with time zone,
	"issued_by" text,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"document_hash" text,
	"source_snapshot_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_invoice_invoice_number_unique" UNIQUE("invoice_number"),
	CONSTRAINT "commercial_invoice_scope_allowed" CHECK ("scope" IN ('retail', 'wholesale')),
	CONSTRAINT "commercial_invoice_status_allowed" CHECK ("status" IN ('draft', 'issued', 'voided')),
	CONSTRAINT "commercial_invoice_tax_status_allowed" CHECK ("tax_status" IN ('not_assessed', 'exempt', 'assessed')),
	CONSTRAINT "commercial_invoice_currency_allowed" CHECK ("currency" IN ('IRR')),
	CONSTRAINT "commercial_invoice_subtotal_range" CHECK ("subtotal" >= 0 AND "subtotal" <= 1000000000000000),
	CONSTRAINT "commercial_invoice_shipping_total_range" CHECK ("shipping_total" >= 0 AND "shipping_total" <= 1000000000000000),
	CONSTRAINT "commercial_invoice_tax_total_range" CHECK ("tax_total" >= 0 AND "tax_total" <= 1000000000000000),
	CONSTRAINT "commercial_invoice_grand_total_range" CHECK ("grand_total" >= 0 AND "grand_total" <= 1000000000000000),
	CONSTRAINT "commercial_invoice_grand_total_matches" CHECK ("grand_total" = "subtotal" + "shipping_total" + "tax_total"),
	CONSTRAINT "commercial_invoice_issued_consistency" CHECK (("status" = 'draft') OR ("issued_at" IS NOT NULL AND "document_hash" IS NOT NULL)),
	CONSTRAINT "commercial_invoice_reference_present" CHECK ("wholesale_order_id" IS NOT NULL OR "retail_order_ref" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "commercial_invoice_line" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"line_no" integer NOT NULL,
	"order_item_ref" text,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" bigint NOT NULL,
	"line_total" bigint NOT NULL,
	"currency" text DEFAULT 'IRR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_invoice_line_quantity_positive" CHECK ("quantity" > 0),
	CONSTRAINT "commercial_invoice_line_unit_price_range" CHECK ("unit_price" >= 0 AND "unit_price" <= 1000000000000000),
	CONSTRAINT "commercial_invoice_line_line_total_range" CHECK ("line_total" >= 0 AND "line_total" <= 1000000000000000),
	CONSTRAINT "commercial_invoice_line_total_matches" CHECK ("line_total" = "unit_price" * "quantity"),
	CONSTRAINT "commercial_invoice_line_currency_allowed" CHECK ("currency" IN ('IRR'))
);
--> statement-breakpoint
CREATE TABLE "consent_event" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"event_type" text NOT NULL,
	"source" text NOT NULL,
	"notice_document_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"evidence_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_event_purpose_allowed" CHECK ("purpose" IN ('MARKETING_EMAIL', 'MARKETING_SMS', 'MARKETING_PUSH', 'PERSONALIZATION')),
	CONSTRAINT "consent_event_type_allowed" CHECK ("event_type" IN ('granted', 'withdrawn')),
	CONSTRAINT "consent_event_source_allowed" CHECK ("source" IN ('portal', 'checkout', 'account_settings', 'admin', 'api'))
);
--> statement-breakpoint
CREATE TABLE "data_retention_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"data_category" text NOT NULL,
	"scope" text DEFAULT 'platform' NOT NULL,
	"retention_days" integer,
	"retention_basis" text NOT NULL,
	"action" text DEFAULT 'review' NOT NULL,
	"legal_source_reference" text,
	"verification_status" text DEFAULT 'NEEDS_LEGAL_VERIFICATION' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_retention_policy_action_allowed" CHECK ("action" IN ('review', 'anonymize', 'delete', 'retain')),
	CONSTRAINT "data_retention_policy_status_allowed" CHECK ("status" IN ('draft', 'active', 'retired')),
	CONSTRAINT "data_retention_policy_verification_allowed" CHECK ("verification_status" IN ('NEEDS_LEGAL_VERIFICATION', 'VERIFIED')),
	CONSTRAINT "data_retention_policy_days_positive" CHECK ("retention_days" IS NULL OR "retention_days" > 0),
	CONSTRAINT "data_retention_policy_destructive_requires_verification" CHECK (("action" NOT IN ('delete', 'anonymize')) OR ("status" <> 'active') OR ("verification_status" = 'VERIFIED' AND "retention_days" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "data_subject_request" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"request_type" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"subject_note" text,
	"decision_reason" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"retained_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_subject_request_type_allowed" CHECK ("request_type" IN ('access', 'correction', 'deletion', 'restriction')),
	CONSTRAINT "data_subject_request_status_allowed" CHECK ("status" IN ('submitted', 'identity_verification_required', 'under_review', 'approved', 'rejected', 'processing', 'completed')),
	CONSTRAINT "data_subject_request_decision_consistency" CHECK (("status" NOT IN ('approved', 'rejected', 'processing', 'completed')) OR ("decided_by" IS NOT NULL AND "decided_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "fiscal_document" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"payload_hash" text,
	"provider_reference" text,
	"last_error" text,
	"prepared_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_document_status_allowed" CHECK ("status" IN ('draft', 'ready', 'submission_pending', 'submitted', 'accepted', 'rejected', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "fiscal_submission_event" (
	"id" text PRIMARY KEY NOT NULL,
	"fiscal_document_id" text NOT NULL,
	"event_type" text NOT NULL,
	"provider" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"outcome" text NOT NULL,
	"provider_reference" text,
	"safe_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_submission_event_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "fiscal_submission_event_type_allowed" CHECK ("event_type" IN ('prepare', 'validate', 'submit', 'status_query', 'cancel')),
	CONSTRAINT "fiscal_submission_event_outcome_allowed" CHECK ("outcome" IN ('ok', 'rejected', 'failed', 'replayed'))
);
--> statement-breakpoint
CREATE TABLE "legal_hold" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"released_by" text,
	"released_at" timestamp with time zone,
	"release_notes" text,
	CONSTRAINT "legal_hold_scope_type_allowed" CHECK ("scope_type" IN ('user', 'supplier', 'wholesale_order', 'retail_order', 'payment', 'product', 'other')),
	CONSTRAINT "legal_hold_status_allowed" CHECK ("status" IN ('active', 'released')),
	CONSTRAINT "legal_hold_release_consistency" CHECK (("status" = 'active' AND "released_at" IS NULL AND "released_by" IS NULL) OR ("status" = 'released' AND "released_at" IS NOT NULL AND "released_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "legal_policy_acceptance" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_document_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"user_id" text,
	"subject_hash" text NOT NULL,
	"supplier_id" text,
	"order_ref" text,
	"context" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"evidence_hash" text NOT NULL,
	"request_metadata_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_policy_acceptance_subject_type_allowed" CHECK ("subject_type" IN ('user', 'guest', 'supplier_member')),
	CONSTRAINT "legal_policy_acceptance_context_allowed" CHECK ("context" IN ('registration', 'portal', 'checkout', 'wholesale_confirm', 'supplier_onboarding', 'api')),
	CONSTRAINT "legal_policy_acceptance_hash_format" CHECK (length("evidence_hash") = 64),
	CONSTRAINT "legal_policy_acceptance_user_subject" CHECK (("subject_type" <> 'user') OR ("user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "legal_policy_document" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_type" text NOT NULL,
	"scope" text NOT NULL,
	"locale" text DEFAULT 'fa-IR' NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"content_text" text NOT NULL,
	"content_hash" text NOT NULL,
	"content_location" text,
	"rule_parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"acceptance_required" boolean DEFAULT false NOT NULL,
	"reacceptance_required" boolean DEFAULT true NOT NULL,
	"effective_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_by" text,
	"published_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_policy_document_type_allowed" CHECK ("policy_type" IN ('TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'RETAIL_RETURN_POLICY', 'WHOLESALE_TERMS', 'SUPPLIER_AGREEMENT', 'MARKETING_NOTICE', 'COOKIE_NOTICE')),
	CONSTRAINT "legal_policy_document_scope_allowed" CHECK ("scope" IN ('RETAIL', 'WHOLESALE_VIP', 'SUPPLIER', 'PUBLIC')),
	CONSTRAINT "legal_policy_document_status_allowed" CHECK ("status" IN ('draft', 'published', 'retired')),
	CONSTRAINT "legal_policy_document_version_positive" CHECK ("version" > 0),
	CONSTRAINT "legal_policy_document_hash_format" CHECK (length("content_hash") = 64),
	CONSTRAINT "legal_policy_document_published_consistency" CHECK (("status" <> 'published') OR ("published_at" IS NOT NULL AND "effective_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "product_compliance_document" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text NOT NULL,
	"document_type" text NOT NULL,
	"storage_provider" text DEFAULT 'local_private' NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum_sha256" text NOT NULL,
	"original_filename" text,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"scan_status" text DEFAULT 'unavailable' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_compliance_document_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "product_compliance_document_type_allowed" CHECK ("document_type" IN ('business_license', 'tax_certificate', 'registration_certificate', 'representative_authorization', 'identity_document', 'bank_document', 'purchase_invoice', 'import_document', 'conformity_certificate', 'authenticity_proof', 'other')),
	CONSTRAINT "product_compliance_document_storage_allowed" CHECK ("storage_provider" IN ('local_private', 's3_private')),
	CONSTRAINT "product_compliance_document_review_status_allowed" CHECK ("review_status" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "product_compliance_document_scan_status_allowed" CHECK ("scan_status" IN ('pending', 'clean', 'rejected', 'unavailable')),
	CONSTRAINT "product_compliance_document_size_positive" CHECK ("size_bytes" > 0),
	CONSTRAINT "product_compliance_document_checksum_format" CHECK (length("checksum_sha256") = 64)
);
--> statement-breakpoint
CREATE TABLE "product_compliance_record" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"seller_id" text,
	"origin_type" text DEFAULT 'unknown' NOT NULL,
	"origin_country" text,
	"condition_class" text DEFAULT 'unknown' NOT NULL,
	"manufacturer_or_importer" text,
	"regulatory_identifiers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_register_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"declared_by" text,
	"declared_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_compliance_record_product_id_unique" UNIQUE("product_id"),
	CONSTRAINT "product_compliance_record_origin_allowed" CHECK ("origin_type" IN ('domestic', 'imported', 'mixed', 'unknown')),
	CONSTRAINT "product_compliance_record_condition_allowed" CHECK ("condition_class" IN ('new', 'used', 'vintage', 'refurbished', 'unknown')),
	CONSTRAINT "product_compliance_record_status_allowed" CHECK ("status" IN ('unknown', 'pending_review', 'verified', 'rejected', 'restricted')),
	CONSTRAINT "product_compliance_record_country_format" CHECK ("origin_country" IS NULL OR length("origin_country") = 2),
	CONSTRAINT "product_compliance_record_verified_consistency" CHECK (("status" NOT IN ('verified', 'rejected', 'restricted')) OR ("reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "supplier_bank_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"destination_kind" text NOT NULL,
	"masked_value" text NOT NULL,
	"normalized_hash" text NOT NULL,
	"holder_name_declared" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"holder_match_status" text DEFAULT 'unknown' NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"submitted_by" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"verification_source" text,
	"provider_reference" text,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_bank_verification_kind_allowed" CHECK ("destination_kind" IN ('iban', 'card', 'account')),
	CONSTRAINT "supplier_bank_verification_status_allowed" CHECK ("status" IN ('unverified', 'pending', 'verified', 'rejected')),
	CONSTRAINT "supplier_bank_verification_holder_match_allowed" CHECK ("holder_match_status" IN ('unknown', 'matched', 'mismatched')),
	CONSTRAINT "supplier_bank_verification_hash_format" CHECK (length("normalized_hash") = 64),
	CONSTRAINT "supplier_bank_verification_verified_consistency" CHECK (("status" <> 'verified') OR ("verified_at" IS NOT NULL AND "verified_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "supplier_compliance_document" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"document_type" text NOT NULL,
	"storage_provider" text DEFAULT 'local_private' NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum_sha256" text NOT NULL,
	"original_filename" text,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"scan_status" text DEFAULT 'unavailable' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_compliance_document_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "supplier_compliance_document_type_allowed" CHECK ("document_type" IN ('business_license', 'tax_certificate', 'registration_certificate', 'representative_authorization', 'identity_document', 'bank_document', 'purchase_invoice', 'import_document', 'conformity_certificate', 'authenticity_proof', 'other')),
	CONSTRAINT "supplier_compliance_document_storage_allowed" CHECK ("storage_provider" IN ('local_private', 's3_private')),
	CONSTRAINT "supplier_compliance_document_review_status_allowed" CHECK ("review_status" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "supplier_compliance_document_scan_status_allowed" CHECK ("scan_status" IN ('pending', 'clean', 'rejected', 'unavailable')),
	CONSTRAINT "supplier_compliance_document_size_positive" CHECK ("size_bytes" > 0),
	CONSTRAINT "supplier_compliance_document_checksum_format" CHECK (length("checksum_sha256") = 64)
);
--> statement-breakpoint
CREATE TABLE "supplier_compliance_hold" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"reason_code" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by" text,
	"released_at" timestamp with time zone,
	"release_notes" text,
	CONSTRAINT "supplier_compliance_hold_reason_allowed" CHECK ("reason_code" IN ('kyb_incomplete', 'document_rejected', 'fraud_suspected', 'legal_request', 'manual_review', 'other')),
	CONSTRAINT "supplier_compliance_hold_status_allowed" CHECK ("status" IN ('active', 'released')),
	CONSTRAINT "supplier_compliance_hold_release_consistency" CHECK (("status" = 'active' AND "released_at" IS NULL AND "released_by" IS NULL) OR ("status" = 'released' AND "released_at" IS NOT NULL AND "released_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "supplier_compliance_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"entity_type" text,
	"legal_name" text,
	"registration_identifier" text,
	"tax_identifier" text,
	"representative_name" text,
	"representative_authority_status" text DEFAULT 'unverified' NOT NULL,
	"risk_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_compliance_profile_supplier_id_unique" UNIQUE("supplier_id"),
	CONSTRAINT "supplier_compliance_profile_status_allowed" CHECK ("status" IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'suspended', 'expired')),
	CONSTRAINT "supplier_compliance_profile_rep_status_allowed" CHECK ("representative_authority_status" IN ('unverified', 'declared', 'verified')),
	CONSTRAINT "supplier_compliance_profile_entity_type_allowed" CHECK ("entity_type" IS NULL OR "entity_type" IN ('individual', 'company', 'cooperative', 'other')),
	CONSTRAINT "supplier_compliance_profile_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_compliance_review" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"profile_version" integer NOT NULL,
	"decision" text NOT NULL,
	"notes" text,
	"reviewed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_compliance_review_decision_allowed" CHECK ("decision" IN ('under_review', 'needs_information', 'approved', 'rejected', 'suspended', 'reinstated', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "supplier_contract_acceptance" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"policy_document_id" text NOT NULL,
	"accepted_by_user_id" text NOT NULL,
	"member_role" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"evidence_hash" text NOT NULL,
	"request_metadata_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_contract_acceptance_hash_format" CHECK (length("evidence_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "tax_configuration" (
	"id" text PRIMARY KEY NOT NULL,
	"config_key" text NOT NULL,
	"config_value" jsonb NOT NULL,
	"source_reference" text,
	"effective_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	"review_status" text DEFAULT 'NEEDS_TAX_ACCOUNTANT_REVIEW' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_configuration_review_status_allowed" CHECK ("review_status" IN ('NEEDS_TAX_ACCOUNTANT_REVIEW', 'VERIFIED')),
	CONSTRAINT "tax_configuration_status_allowed" CHECK ("status" IN ('draft', 'active', 'retired')),
	CONSTRAINT "tax_configuration_version_positive" CHECK ("version" > 0),
	CONSTRAINT "tax_configuration_active_requires_review" CHECK (("status" <> 'active') OR ("review_status" = 'VERIFIED'))
);
--> statement-breakpoint
CREATE TABLE "transaction_compliance_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"wholesale_order_id" text,
	"retail_order_ref" text,
	"supplier_id" text,
	"user_id" text,
	"subject_hash" text NOT NULL,
	"policy_bundle" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policy_bundle_hash" text NOT NULL,
	"disclosure" jsonb,
	"disclosure_hash" text,
	"commercial_snapshot_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_compliance_snapshot_scope_allowed" CHECK ("scope" IN ('RETAIL', 'WHOLESALE', 'SUPPLIER')),
	CONSTRAINT "transaction_compliance_snapshot_hash_format" CHECK (length("policy_bundle_hash") = 64),
	CONSTRAINT "transaction_compliance_snapshot_reference_present" CHECK ("wholesale_order_id" IS NOT NULL OR "retail_order_ref" IS NOT NULL OR "supplier_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "business_compliance_credential" ADD CONSTRAINT "business_compliance_credential_verified_by_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "business_compliance_credential" ADD CONSTRAINT "business_compliance_credential_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "business_legal_profile" ADD CONSTRAINT "business_legal_profile_updated_by_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commercial_invoice" ADD CONSTRAINT "commercial_invoice_wholesale_order_fk" FOREIGN KEY ("wholesale_order_id") REFERENCES "public"."wholesale_order"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commercial_invoice" ADD CONSTRAINT "commercial_invoice_child_order_fk" FOREIGN KEY ("child_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commercial_invoice" ADD CONSTRAINT "commercial_invoice_seller_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commercial_invoice" ADD CONSTRAINT "commercial_invoice_issued_by_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commercial_invoice_line" ADD CONSTRAINT "commercial_invoice_line_invoice_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."commercial_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "consent_event" ADD CONSTRAINT "consent_event_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "consent_event" ADD CONSTRAINT "consent_event_notice_fk" FOREIGN KEY ("notice_document_id") REFERENCES "public"."legal_policy_document"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_retention_policy" ADD CONSTRAINT "data_retention_policy_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_subject_request" ADD CONSTRAINT "data_subject_request_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_subject_request" ADD CONSTRAINT "data_subject_request_decided_by_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_document" ADD CONSTRAINT "fiscal_document_invoice_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."commercial_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_submission_event" ADD CONSTRAINT "fiscal_submission_event_document_fk" FOREIGN KEY ("fiscal_document_id") REFERENCES "public"."fiscal_document"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "legal_hold" ADD CONSTRAINT "legal_hold_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "legal_hold" ADD CONSTRAINT "legal_hold_released_by_fk" FOREIGN KEY ("released_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "legal_policy_acceptance" ADD CONSTRAINT "legal_policy_acceptance_document_fk" FOREIGN KEY ("policy_document_id") REFERENCES "public"."legal_policy_document"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "legal_policy_acceptance" ADD CONSTRAINT "legal_policy_acceptance_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "legal_policy_acceptance" ADD CONSTRAINT "legal_policy_acceptance_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "legal_policy_document" ADD CONSTRAINT "legal_policy_document_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "legal_policy_document" ADD CONSTRAINT "legal_policy_document_published_by_fk" FOREIGN KEY ("published_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_compliance_document" ADD CONSTRAINT "product_compliance_document_record_fk" FOREIGN KEY ("record_id") REFERENCES "public"."product_compliance_record"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_compliance_document" ADD CONSTRAINT "product_compliance_document_uploader_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_compliance_document" ADD CONSTRAINT "product_compliance_document_reviewer_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_compliance_record" ADD CONSTRAINT "product_compliance_record_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_compliance_record" ADD CONSTRAINT "product_compliance_record_seller_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_compliance_record" ADD CONSTRAINT "product_compliance_record_declared_by_fk" FOREIGN KEY ("declared_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_compliance_record" ADD CONSTRAINT "product_compliance_record_reviewed_by_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_bank_verification" ADD CONSTRAINT "supplier_bank_verification_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_bank_verification" ADD CONSTRAINT "supplier_bank_verification_submitted_by_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_bank_verification" ADD CONSTRAINT "supplier_bank_verification_verified_by_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_compliance_document" ADD CONSTRAINT "supplier_compliance_document_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_compliance_document" ADD CONSTRAINT "supplier_compliance_document_uploader_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_compliance_document" ADD CONSTRAINT "supplier_compliance_document_reviewer_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_compliance_hold" ADD CONSTRAINT "supplier_compliance_hold_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_compliance_hold" ADD CONSTRAINT "supplier_compliance_hold_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_compliance_hold" ADD CONSTRAINT "supplier_compliance_hold_released_by_fk" FOREIGN KEY ("released_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_compliance_profile" ADD CONSTRAINT "supplier_compliance_profile_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_compliance_profile" ADD CONSTRAINT "supplier_compliance_profile_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_compliance_review" ADD CONSTRAINT "supplier_compliance_review_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_compliance_review" ADD CONSTRAINT "supplier_compliance_review_profile_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."supplier_compliance_profile"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_compliance_review" ADD CONSTRAINT "supplier_compliance_review_reviewer_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_contract_acceptance" ADD CONSTRAINT "supplier_contract_acceptance_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_contract_acceptance" ADD CONSTRAINT "supplier_contract_acceptance_document_fk" FOREIGN KEY ("policy_document_id") REFERENCES "public"."legal_policy_document"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_contract_acceptance" ADD CONSTRAINT "supplier_contract_acceptance_user_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tax_configuration" ADD CONSTRAINT "tax_configuration_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transaction_compliance_snapshot" ADD CONSTRAINT "transaction_compliance_snapshot_wholesale_order_fk" FOREIGN KEY ("wholesale_order_id") REFERENCES "public"."wholesale_order"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transaction_compliance_snapshot" ADD CONSTRAINT "transaction_compliance_snapshot_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transaction_compliance_snapshot" ADD CONSTRAINT "transaction_compliance_snapshot_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_invoice_child_issued_unique" ON "commercial_invoice" USING btree ("child_order_id") WHERE "child_order_id" IS NOT NULL AND "status" = 'issued';
--> statement-breakpoint
CREATE INDEX "commercial_invoice_wholesale_order" ON "commercial_invoice" USING btree ("wholesale_order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_invoice_line_no_unique" ON "commercial_invoice_line" USING btree ("invoice_id","line_no");
--> statement-breakpoint
CREATE INDEX "consent_event_user_purpose" ON "consent_event" USING btree ("user_id","purpose","occurred_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "data_retention_policy_category_scope_active" ON "data_retention_policy" USING btree ("data_category","scope") WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX "data_subject_request_user" ON "data_subject_request" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX "data_subject_request_status" ON "data_subject_request" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_document_provider_reference_unique" ON "fiscal_document" USING btree ("provider","provider_reference") WHERE "provider_reference" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_document_invoice_open_unique" ON "fiscal_document" USING btree ("invoice_id") WHERE "status" NOT IN ('rejected', 'cancelled');
--> statement-breakpoint
CREATE INDEX "fiscal_submission_event_document" ON "fiscal_submission_event" USING btree ("fiscal_document_id","created_at");
--> statement-breakpoint
CREATE INDEX "legal_hold_scope" ON "legal_hold" USING btree ("scope_type","scope_id","status");
--> statement-breakpoint
CREATE INDEX "legal_policy_acceptance_subject" ON "legal_policy_acceptance" USING btree ("subject_hash","policy_document_id");
--> statement-breakpoint
CREATE INDEX "legal_policy_acceptance_user" ON "legal_policy_acceptance" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "legal_policy_document_type_scope_locale_version_unique" ON "legal_policy_document" USING btree ("policy_type","scope","locale","version");
--> statement-breakpoint
CREATE UNIQUE INDEX "legal_policy_document_single_published" ON "legal_policy_document" USING btree ("policy_type","scope","locale") WHERE "status" = 'published';
--> statement-breakpoint
CREATE INDEX "legal_policy_document_scope_status" ON "legal_policy_document" USING btree ("scope","status");
--> statement-breakpoint
CREATE INDEX "product_compliance_document_record" ON "product_compliance_document" USING btree ("record_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_bank_verification_current_unique" ON "supplier_bank_verification" USING btree ("supplier_id") WHERE "is_current" = true;
--> statement-breakpoint
CREATE INDEX "supplier_compliance_document_supplier" ON "supplier_compliance_document" USING btree ("supplier_id","uploaded_at");
--> statement-breakpoint
CREATE INDEX "supplier_compliance_hold_supplier_status" ON "supplier_compliance_hold" USING btree ("supplier_id","status");
--> statement-breakpoint
CREATE INDEX "supplier_compliance_review_supplier" ON "supplier_compliance_review" USING btree ("supplier_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_contract_acceptance_unique" ON "supplier_contract_acceptance" USING btree ("supplier_id","policy_document_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tax_configuration_key_version_unique" ON "tax_configuration" USING btree ("config_key","version");
--> statement-breakpoint
CREATE UNIQUE INDEX "tax_configuration_key_active_unique" ON "tax_configuration" USING btree ("config_key") WHERE "status" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_compliance_snapshot_wholesale_unique" ON "transaction_compliance_snapshot" USING btree ("wholesale_order_id") WHERE "wholesale_order_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_compliance_snapshot_retail_unique" ON "transaction_compliance_snapshot" USING btree ("retail_order_ref") WHERE "retail_order_ref" IS NOT NULL;
--> statement-breakpoint

-- ── T2. Generic append-only guard for legal evidence tables ────────────────
CREATE OR REPLACE FUNCTION kolbe_compliance_append_only() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only legal evidence: % forbidden', TG_TABLE_NAME, TG_OP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER legal_policy_acceptance_append_only
  BEFORE UPDATE OR DELETE ON "legal_policy_acceptance"
  FOR EACH ROW EXECUTE FUNCTION kolbe_compliance_append_only();
--> statement-breakpoint
CREATE TRIGGER consent_event_append_only
  BEFORE UPDATE OR DELETE ON "consent_event"
  FOR EACH ROW EXECUTE FUNCTION kolbe_compliance_append_only();
--> statement-breakpoint
CREATE TRIGGER supplier_contract_acceptance_append_only
  BEFORE UPDATE OR DELETE ON "supplier_contract_acceptance"
  FOR EACH ROW EXECUTE FUNCTION kolbe_compliance_append_only();
--> statement-breakpoint
CREATE TRIGGER supplier_compliance_review_append_only
  BEFORE UPDATE OR DELETE ON "supplier_compliance_review"
  FOR EACH ROW EXECUTE FUNCTION kolbe_compliance_append_only();
--> statement-breakpoint
CREATE TRIGGER transaction_compliance_snapshot_append_only
  BEFORE UPDATE OR DELETE ON "transaction_compliance_snapshot"
  FOR EACH ROW EXECUTE FUNCTION kolbe_compliance_append_only();
--> statement-breakpoint
CREATE TRIGGER commercial_invoice_line_append_only
  BEFORE UPDATE OR DELETE ON "commercial_invoice_line"
  FOR EACH ROW EXECUTE FUNCTION kolbe_compliance_append_only();
--> statement-breakpoint
CREATE TRIGGER fiscal_submission_event_append_only
  BEFORE UPDATE OR DELETE ON "fiscal_submission_event"
  FOR EACH ROW EXECUTE FUNCTION kolbe_compliance_append_only();
--> statement-breakpoint

-- ── T1. Published legal text is immutable; a change is a NEW version ───────
CREATE OR REPLACE FUNCTION kolbe_legal_policy_document_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'legal_policy_document % is % and cannot be deleted', OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  -- published or retired: identity + content frozen
  IF NEW.policy_type IS DISTINCT FROM OLD.policy_type
     OR NEW.scope IS DISTINCT FROM OLD.scope
     OR NEW.locale IS DISTINCT FROM OLD.locale
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.summary IS DISTINCT FROM OLD.summary
     OR NEW.content_text IS DISTINCT FROM OLD.content_text
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.content_location IS DISTINCT FROM OLD.content_location
     OR NEW.rule_parameters IS DISTINCT FROM OLD.rule_parameters
     OR NEW.acceptance_required IS DISTINCT FROM OLD.acceptance_required
     OR NEW.reacceptance_required IS DISTINCT FROM OLD.reacceptance_required
     OR NEW.effective_at IS DISTINCT FROM OLD.effective_at
     OR NEW.published_at IS DISTINCT FROM OLD.published_at
     OR NEW.published_by IS DISTINCT FROM OLD.published_by
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'legal_policy_document % is %: published legal text is immutable, publish a new version', OLD.id, OLD.status;
  END IF;
  IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN
    RAISE EXCEPTION 'legal_policy_document % is retired and cannot be re-published', OLD.id;
  END IF;
  IF OLD.status = 'published' AND NEW.status NOT IN ('published', 'retired') THEN
    RAISE EXCEPTION 'legal_policy_document % can only move from published to retired', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER legal_policy_document_immutable_when_published
  BEFORE UPDATE OR DELETE ON "legal_policy_document"
  FOR EACH ROW EXECUTE FUNCTION kolbe_legal_policy_document_guard();
--> statement-breakpoint

-- ── T3. Holds: immutable history, release-only transition ──────────────────
CREATE OR REPLACE FUNCTION kolbe_hold_release_only_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% % cannot be deleted (immutable hold history)', TG_TABLE_NAME, OLD.id;
  END IF;
  IF OLD.status = 'released' THEN
    RAISE EXCEPTION '% % is already released and immutable', TG_TABLE_NAME, OLD.id;
  END IF;
  IF NEW.status <> 'released' THEN
    RAISE EXCEPTION '% % : only the transition active -> released is allowed', TG_TABLE_NAME, OLD.id;
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION '% % : creation facts are immutable', TG_TABLE_NAME, OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER supplier_compliance_hold_release_only
  BEFORE UPDATE OR DELETE ON "supplier_compliance_hold"
  FOR EACH ROW EXECUTE FUNCTION kolbe_hold_release_only_guard();
--> statement-breakpoint
CREATE TRIGGER legal_hold_release_only
  BEFORE UPDATE OR DELETE ON "legal_hold"
  FOR EACH ROW EXECUTE FUNCTION kolbe_hold_release_only_guard();
--> statement-breakpoint

-- ── T4. Issued commercial invoices are immutable (void is a new state, not an edit) ──
CREATE OR REPLACE FUNCTION kolbe_commercial_invoice_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'commercial_invoice % is % and cannot be deleted', OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'voided' THEN
    RAISE EXCEPTION 'commercial_invoice % is voided and immutable', OLD.id;
  END IF;
  -- issued: only status -> voided with void metadata; everything else frozen
  IF NEW.status <> 'voided'
     OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
     OR NEW.scope IS DISTINCT FROM OLD.scope
     OR NEW.wholesale_order_id IS DISTINCT FROM OLD.wholesale_order_id
     OR NEW.child_order_id IS DISTINCT FROM OLD.child_order_id
     OR NEW.retail_order_ref IS DISTINCT FROM OLD.retail_order_ref
     OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
     OR NEW.seller_snapshot IS DISTINCT FROM OLD.seller_snapshot
     OR NEW.buyer_snapshot IS DISTINCT FROM OLD.buyer_snapshot
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
     OR NEW.shipping_total IS DISTINCT FROM OLD.shipping_total
     OR NEW.tax_total IS DISTINCT FROM OLD.tax_total
     OR NEW.tax_status IS DISTINCT FROM OLD.tax_status
     OR NEW.tax_basis_reference IS DISTINCT FROM OLD.tax_basis_reference
     OR NEW.grand_total IS DISTINCT FROM OLD.grand_total
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.issued_by IS DISTINCT FROM OLD.issued_by
     OR NEW.document_hash IS DISTINCT FROM OLD.document_hash
     OR NEW.source_snapshot_hash IS DISTINCT FROM OLD.source_snapshot_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'commercial_invoice % is issued and immutable (only void is allowed)', OLD.id;
  END IF;
  IF NEW.voided_at IS NULL OR NEW.void_reason IS NULL THEN
    RAISE EXCEPTION 'commercial_invoice % void requires voided_at and void_reason', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER commercial_invoice_immutable_when_issued
  BEFORE UPDATE OR DELETE ON "commercial_invoice"
  FOR EACH ROW EXECUTE FUNCTION kolbe_commercial_invoice_guard();
