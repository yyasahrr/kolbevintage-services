-- Phase 5.4 — authoritative CMS content management
-- Append-only revisions, publication pointers, safe structured documents, public media metadata,
-- Persian-safe identity, navigation, editorial articles and durable UTC schedules.

ALTER TABLE "admin_role_permission" DROP CONSTRAINT IF EXISTS "admin_role_permission_action_allowed";
--> statement-breakpoint
ALTER TABLE "admin_role_permission" ADD CONSTRAINT "admin_role_permission_action_allowed" CHECK ("action" IN ('wholesale:plan:view', 'wholesale:plan:manage', 'wholesale:membership:view', 'wholesale:membership:manage', 'wholesale:membership:override', 'wholesale:approval:view', 'wholesale:approval:create', 'wholesale:approval:decide', 'wholesale:settings:view', 'wholesale:settings:manage', 'wholesale:notes:view', 'wholesale:notes:create', 'wholesale:control_tower:view', 'crm:customer:view', 'crm:customer:manage', 'crm:stage:manage', 'crm:assign:manage', 'crm:activity:create', 'crm:task:manage', 'crm:tag:manage', 'crm:export', 'crm:sensitive:view', 'support:case:view', 'support:case:reply', 'support:case:assign', 'support:case:priority', 'support:case:resolve', 'support:internal_note:create', 'support:attachment:view', 'support:sla:manage', 'support:report:view', 'support:sensitive:view', 'notification:template:view', 'notification:template:manage', 'notification:outbox:view', 'notification:outbox:retry', 'notification:provider:view', 'notification:preference:manage', 'notification:report:view', 'cms:content:view', 'cms:content:create', 'cms:content:edit', 'cms:content:publish', 'cms:content:archive', 'cms:navigation:manage', 'cms:media:manage', 'cms:seo:manage', 'cms:blog:manage'));
--> statement-breakpoint

CREATE TABLE "cms_page" (
  "id" text PRIMARY KEY NOT NULL,
  "stable_key" text NOT NULL,
  "page_type" text NOT NULL,
  "route_path" text NOT NULL,
  "current_published_revision_id" text,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cms_page_type_allowed" CHECK ("page_type" IN ('HOME', 'STATIC', 'LANDING', 'EDITORIAL')),
  CONSTRAINT "cms_page_status_allowed" CHECK ("status" IN ('ACTIVE', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_page_stable_key_unique" ON "cms_page" USING btree ("stable_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_page_route_path_unique" ON "cms_page" USING btree ("route_path");
--> statement-breakpoint
CREATE INDEX "cms_page_type_status_idx" ON "cms_page" USING btree ("page_type", "status");
--> statement-breakpoint
CREATE INDEX "cms_page_route_idx" ON "cms_page" USING btree ("route_path");
--> statement-breakpoint
ALTER TABLE "cms_page" ADD CONSTRAINT "cms_page_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "cms_page_revision" (
  "id" text PRIMARY KEY NOT NULL,
  "page_id" text NOT NULL,
  "version" integer NOT NULL,
  "title" text NOT NULL,
  "blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "seo_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "content_schema_version" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "publish_at" timestamp with time zone,
  "unpublish_at" timestamp with time zone,
  "created_by" text,
  "published_by" text,
  "published_at" timestamp with time zone,
  "superseded_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "source_revision_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cms_page_revision_status_allowed" CHECK ("status" IN ('DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED')),
  CONSTRAINT "cms_page_revision_version_positive" CHECK ("version" > 0),
  CONSTRAINT "cms_page_revision_schema_version_positive" CHECK ("content_schema_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "cms_page_revision" ADD CONSTRAINT "cms_page_revision_page_fk" FOREIGN KEY ("page_id") REFERENCES "public"."cms_page"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_page_revision" ADD CONSTRAINT "cms_page_revision_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_page_revision" ADD CONSTRAINT "cms_page_revision_published_by_fk" FOREIGN KEY ("published_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_page_revision" ADD CONSTRAINT "cms_page_revision_source_fk" FOREIGN KEY ("source_revision_id") REFERENCES "public"."cms_page_revision"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_page_revision_page_version_unique" ON "cms_page_revision" USING btree ("page_id", "version");
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_page_revision_one_published" ON "cms_page_revision" USING btree ("page_id") WHERE "status" = 'PUBLISHED';
--> statement-breakpoint
CREATE INDEX "cms_page_revision_page_status_idx" ON "cms_page_revision" USING btree ("page_id", "status");
--> statement-breakpoint
CREATE INDEX "cms_page_revision_publish_at_idx" ON "cms_page_revision" USING btree ("status", "publish_at");
--> statement-breakpoint

CREATE TABLE "cms_content_document" (
  "id" text PRIMARY KEY NOT NULL,
  "document_key" text NOT NULL,
  "document_type" text NOT NULL,
  "current_published_revision_id" text,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cms_content_document_type_allowed" CHECK ("document_type" IN ('HOME_CONFIGURATION', 'HEADER_CONFIGURATION', 'FOOTER_CONFIGURATION', 'HERO_CONFIGURATION', 'PROMOTIONAL_CONTENT_CONFIGURATION')),
  CONSTRAINT "cms_content_document_status_allowed" CHECK ("status" IN ('ACTIVE', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_content_document_key_unique" ON "cms_content_document" USING btree ("document_key");
--> statement-breakpoint
CREATE INDEX "cms_content_document_type_status_idx" ON "cms_content_document" USING btree ("document_type", "status");
--> statement-breakpoint
ALTER TABLE "cms_content_document" ADD CONSTRAINT "cms_content_document_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "cms_content_revision" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL,
  "version" integer NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "publish_at" timestamp with time zone,
  "created_by" text,
  "published_by" text,
  "published_at" timestamp with time zone,
  "superseded_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "source_revision_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cms_content_revision_status_allowed" CHECK ("status" IN ('DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED')),
  CONSTRAINT "cms_content_revision_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
ALTER TABLE "cms_content_revision" ADD CONSTRAINT "cms_content_revision_document_fk" FOREIGN KEY ("document_id") REFERENCES "public"."cms_content_document"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_content_revision" ADD CONSTRAINT "cms_content_revision_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_content_revision" ADD CONSTRAINT "cms_content_revision_published_by_fk" FOREIGN KEY ("published_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_content_revision" ADD CONSTRAINT "cms_content_revision_source_fk" FOREIGN KEY ("source_revision_id") REFERENCES "public"."cms_content_revision"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_content_revision_document_version_unique" ON "cms_content_revision" USING btree ("document_id", "version");
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_content_revision_one_published" ON "cms_content_revision" USING btree ("document_id") WHERE "status" = 'PUBLISHED';
--> statement-breakpoint
CREATE INDEX "cms_content_revision_document_status_idx" ON "cms_content_revision" USING btree ("document_id", "status");
--> statement-breakpoint
CREATE INDEX "cms_content_revision_publish_at_idx" ON "cms_content_revision" USING btree ("status", "publish_at");
--> statement-breakpoint

CREATE TABLE "cms_navigation" (
  "id" text PRIMARY KEY NOT NULL,
  "navigation_key" text NOT NULL,
  "label" text NOT NULL,
  "current_published_revision_id" text,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cms_navigation_status_allowed" CHECK ("status" IN ('ACTIVE', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_navigation_key_unique" ON "cms_navigation" USING btree ("navigation_key");
--> statement-breakpoint
CREATE INDEX "cms_navigation_status_idx" ON "cms_navigation" USING btree ("status");
--> statement-breakpoint
ALTER TABLE "cms_navigation" ADD CONSTRAINT "cms_navigation_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "cms_navigation_revision" (
  "id" text PRIMARY KEY NOT NULL,
  "navigation_id" text NOT NULL,
  "version" integer NOT NULL,
  "items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "created_by" text,
  "published_by" text,
  "published_at" timestamp with time zone,
  "superseded_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "source_revision_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cms_navigation_revision_status_allowed" CHECK ("status" IN ('DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED')),
  CONSTRAINT "cms_navigation_revision_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
ALTER TABLE "cms_navigation_revision" ADD CONSTRAINT "cms_navigation_revision_navigation_fk" FOREIGN KEY ("navigation_id") REFERENCES "public"."cms_navigation"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_navigation_revision" ADD CONSTRAINT "cms_navigation_revision_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_navigation_revision" ADD CONSTRAINT "cms_navigation_revision_published_by_fk" FOREIGN KEY ("published_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_navigation_revision" ADD CONSTRAINT "cms_navigation_revision_source_fk" FOREIGN KEY ("source_revision_id") REFERENCES "public"."cms_navigation_revision"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_navigation_revision_navigation_version_unique" ON "cms_navigation_revision" USING btree ("navigation_id", "version");
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_navigation_revision_one_published" ON "cms_navigation_revision" USING btree ("navigation_id") WHERE "status" = 'PUBLISHED';
--> statement-breakpoint
CREATE INDEX "cms_navigation_revision_navigation_status_idx" ON "cms_navigation_revision" USING btree ("navigation_id", "status");
--> statement-breakpoint

CREATE TABLE "cms_media_asset" (
  "id" text PRIMARY KEY NOT NULL,
  "storage_provider" text NOT NULL,
  "object_key" text NOT NULL,
  "original_filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "byte_size" bigint NOT NULL,
  "checksum_sha256" text NOT NULL,
  "width" integer,
  "height" integer,
  "duration_ms" integer,
  "alt_text" text,
  "caption" text,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "cms_media_asset_provider_allowed" CHECK ("storage_provider" IN ('LOCAL_PUBLIC')),
  CONSTRAINT "cms_media_asset_mime_allowed" CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm')),
  CONSTRAINT "cms_media_asset_size_positive" CHECK ("byte_size" > 0),
  CONSTRAINT "cms_media_asset_checksum_format" CHECK (length("checksum_sha256") = 64),
  CONSTRAINT "cms_media_asset_dimensions_positive" CHECK (("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0) AND ("duration_ms" IS NULL OR "duration_ms" > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_media_asset_object_key_unique" ON "cms_media_asset" USING btree ("object_key");
--> statement-breakpoint
CREATE INDEX "cms_media_asset_created_idx" ON "cms_media_asset" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "cms_media_asset_archived_idx" ON "cms_media_asset" USING btree ("archived_at");
--> statement-breakpoint
ALTER TABLE "cms_media_asset" ADD CONSTRAINT "cms_media_asset_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "cms_media_usage" (
  "id" text PRIMARY KEY NOT NULL,
  "media_asset_id" text NOT NULL,
  "revision_type" text NOT NULL,
  "revision_id" text NOT NULL,
  "field_path" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cms_media_usage" ADD CONSTRAINT "cms_media_usage_asset_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."cms_media_asset"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_media_usage_unique" ON "cms_media_usage" USING btree ("media_asset_id", "revision_type", "revision_id", "field_path");
--> statement-breakpoint
CREATE INDEX "cms_media_usage_revision_idx" ON "cms_media_usage" USING btree ("revision_type", "revision_id");
--> statement-breakpoint

CREATE TABLE "cms_article" (
  "id" text PRIMARY KEY NOT NULL,
  "article_key" text NOT NULL,
  "current_published_revision_id" text,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cms_article_status_allowed" CHECK ("status" IN ('ACTIVE', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_article_key_unique" ON "cms_article" USING btree ("article_key");
--> statement-breakpoint
CREATE INDEX "cms_article_status_idx" ON "cms_article" USING btree ("status");
--> statement-breakpoint
ALTER TABLE "cms_article" ADD CONSTRAINT "cms_article_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "cms_article_taxonomy" (
  "id" text PRIMARY KEY NOT NULL,
  "taxonomy_key" text NOT NULL,
  "slug" text NOT NULL,
  "label" text NOT NULL,
  "kind" text DEFAULT 'CATEGORY' NOT NULL,
  "parent_id" text,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cms_article_taxonomy_kind_allowed" CHECK ("kind" IN ('CATEGORY', 'TAG')),
  CONSTRAINT "cms_article_taxonomy_status_allowed" CHECK ("status" IN ('ACTIVE', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_article_taxonomy_key_unique" ON "cms_article_taxonomy" USING btree ("taxonomy_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_article_taxonomy_slug_unique" ON "cms_article_taxonomy" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX "cms_article_taxonomy_kind_status_idx" ON "cms_article_taxonomy" USING btree ("kind", "status");
--> statement-breakpoint
ALTER TABLE "cms_article_taxonomy" ADD CONSTRAINT "cms_article_taxonomy_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."cms_article_taxonomy"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_article_taxonomy" ADD CONSTRAINT "cms_article_taxonomy_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "cms_article_revision" (
  "id" text PRIMARY KEY NOT NULL,
  "article_id" text NOT NULL,
  "version" integer NOT NULL,
  "slug" text NOT NULL,
  "title" text NOT NULL,
  "excerpt" text DEFAULT '' NOT NULL,
  "category" text,
  "cover_media_id" text,
  "structured_body" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "author_display_name" text,
  "author_id" text,
  "read_time_minutes" integer,
  "is_pinned" boolean DEFAULT false NOT NULL,
  "is_featured" boolean DEFAULT false NOT NULL,
  "seo_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "publish_at" timestamp with time zone,
  "unpublish_at" timestamp with time zone,
  "created_by" text,
  "published_by" text,
  "published_at" timestamp with time zone,
  "superseded_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cms_article_revision_status_allowed" CHECK ("status" IN ('DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED')),
  CONSTRAINT "cms_article_revision_version_positive" CHECK ("version" > 0),
  CONSTRAINT "cms_article_revision_read_time_positive" CHECK ("read_time_minutes" IS NULL OR "read_time_minutes" > 0)
);
--> statement-breakpoint
ALTER TABLE "cms_article_revision" ADD CONSTRAINT "cms_article_revision_article_fk" FOREIGN KEY ("article_id") REFERENCES "public"."cms_article"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_article_revision" ADD CONSTRAINT "cms_article_revision_cover_media_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."cms_media_asset"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_article_revision" ADD CONSTRAINT "cms_article_revision_author_fk" FOREIGN KEY ("author_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_article_revision" ADD CONSTRAINT "cms_article_revision_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_article_revision" ADD CONSTRAINT "cms_article_revision_published_by_fk" FOREIGN KEY ("published_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_article_revision_article_version_unique" ON "cms_article_revision" USING btree ("article_id", "version");
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_article_revision_one_published" ON "cms_article_revision" USING btree ("article_id") WHERE "status" = 'PUBLISHED';
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_article_revision_published_slug_unique" ON "cms_article_revision" USING btree ("slug") WHERE "status" = 'PUBLISHED';
--> statement-breakpoint
CREATE INDEX "cms_article_revision_article_status_idx" ON "cms_article_revision" USING btree ("article_id", "status");
--> statement-breakpoint
CREATE INDEX "cms_article_revision_slug_idx" ON "cms_article_revision" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX "cms_article_revision_publish_at_idx" ON "cms_article_revision" USING btree ("status", "publish_at");
--> statement-breakpoint

CREATE TABLE "cms_article_revision_taxonomy" (
  "id" text PRIMARY KEY NOT NULL,
  "article_revision_id" text NOT NULL,
  "taxonomy_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cms_article_revision_taxonomy" ADD CONSTRAINT "cms_article_revision_taxonomy_revision_fk" FOREIGN KEY ("article_revision_id") REFERENCES "public"."cms_article_revision"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_article_revision_taxonomy" ADD CONSTRAINT "cms_article_revision_taxonomy_term_fk" FOREIGN KEY ("taxonomy_id") REFERENCES "public"."cms_article_taxonomy"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_article_revision_taxonomy_unique" ON "cms_article_revision_taxonomy" USING btree ("article_revision_id", "taxonomy_id");
--> statement-breakpoint
CREATE INDEX "cms_article_revision_taxonomy_term_idx" ON "cms_article_revision_taxonomy" USING btree ("taxonomy_id");
--> statement-breakpoint

CREATE TABLE "cms_publication_schedule" (
  "id" text PRIMARY KEY NOT NULL,
  "target_type" text NOT NULL,
  "page_revision_id" text,
  "content_revision_id" text,
  "navigation_revision_id" text,
  "article_revision_id" text,
  "publish_at" timestamp with time zone NOT NULL,
  "unpublish_at" timestamp with time zone,
  "timezone" text DEFAULT 'UTC' NOT NULL,
  "status" text DEFAULT 'SCHEDULED' NOT NULL,
  "idempotency_key" text NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "claimed_at" timestamp with time zone,
  "executed_at" timestamp with time zone,
  "last_error" text,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cms_publication_schedule_target_allowed" CHECK ("target_type" IN ('PAGE_REVISION', 'CONTENT_REVISION', 'NAVIGATION_REVISION', 'ARTICLE_REVISION')),
  CONSTRAINT "cms_publication_schedule_status_allowed" CHECK ("status" IN ('SCHEDULED', 'PROCESSING', 'EXECUTED', 'CANCELLED', 'FAILED')),
  CONSTRAINT "cms_publication_schedule_attempt_non_negative" CHECK ("attempt_count" >= 0),
  CONSTRAINT "cms_publication_schedule_unpublish_after_publish" CHECK ("unpublish_at" IS NULL OR "unpublish_at" > "publish_at"),
  CONSTRAINT "cms_publication_schedule_one_target" CHECK ((("page_revision_id" IS NOT NULL)::int + ("content_revision_id" IS NOT NULL)::int + ("navigation_revision_id" IS NOT NULL)::int + ("article_revision_id" IS NOT NULL)::int) = 1)
);
--> statement-breakpoint
ALTER TABLE "cms_publication_schedule" ADD CONSTRAINT "cms_publication_schedule_page_fk" FOREIGN KEY ("page_revision_id") REFERENCES "public"."cms_page_revision"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_publication_schedule" ADD CONSTRAINT "cms_publication_schedule_content_fk" FOREIGN KEY ("content_revision_id") REFERENCES "public"."cms_content_revision"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_publication_schedule" ADD CONSTRAINT "cms_publication_schedule_navigation_fk" FOREIGN KEY ("navigation_revision_id") REFERENCES "public"."cms_navigation_revision"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_publication_schedule" ADD CONSTRAINT "cms_publication_schedule_article_fk" FOREIGN KEY ("article_revision_id") REFERENCES "public"."cms_article_revision"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_publication_schedule" ADD CONSTRAINT "cms_publication_schedule_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_publication_schedule_idempotency_unique" ON "cms_publication_schedule" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_publication_schedule_page_target_unique" ON "cms_publication_schedule" USING btree ("page_revision_id") WHERE "page_revision_id" IS NOT NULL AND "status" IN ('SCHEDULED','PROCESSING');
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_publication_schedule_content_target_unique" ON "cms_publication_schedule" USING btree ("content_revision_id") WHERE "content_revision_id" IS NOT NULL AND "status" IN ('SCHEDULED','PROCESSING');
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_publication_schedule_navigation_target_unique" ON "cms_publication_schedule" USING btree ("navigation_revision_id") WHERE "navigation_revision_id" IS NOT NULL AND "status" IN ('SCHEDULED','PROCESSING');
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_publication_schedule_article_target_unique" ON "cms_publication_schedule" USING btree ("article_revision_id") WHERE "article_revision_id" IS NOT NULL AND "status" IN ('SCHEDULED','PROCESSING');
--> statement-breakpoint
CREATE INDEX "cms_publication_schedule_due_idx" ON "cms_publication_schedule" USING btree ("status", "publish_at");
--> statement-breakpoint

ALTER TABLE "cms_page" ADD CONSTRAINT "cms_page_current_published_revision_fk" FOREIGN KEY ("current_published_revision_id") REFERENCES "public"."cms_page_revision"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_content_document" ADD CONSTRAINT "cms_content_document_current_published_revision_fk" FOREIGN KEY ("current_published_revision_id") REFERENCES "public"."cms_content_revision"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_navigation" ADD CONSTRAINT "cms_navigation_current_published_revision_fk" FOREIGN KEY ("current_published_revision_id") REFERENCES "public"."cms_navigation_revision"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_article" ADD CONSTRAINT "cms_article_current_published_revision_fk" FOREIGN KEY ("current_published_revision_id") REFERENCES "public"."cms_article_revision"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

-- Revision rows are immutable by policy; the application only inserts a new row for rollback.
CREATE OR REPLACE FUNCTION cms_reject_revision_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    IF OLD.page_id IS DISTINCT FROM NEW.page_id OR OLD.version IS DISTINCT FROM NEW.version OR OLD.title IS DISTINCT FROM NEW.title OR OLD.blocks IS DISTINCT FROM NEW.blocks OR OLD.seo_metadata IS DISTINCT FROM NEW.seo_metadata OR OLD.content_schema_version IS DISTINCT FROM NEW.content_schema_version OR OLD.created_by IS DISTINCT FROM NEW.created_by OR OLD.created_at IS DISTINCT FROM NEW.created_at OR OLD.source_revision_id IS DISTINCT FROM NEW.source_revision_id THEN
      RAISE EXCEPTION 'CMS page revisions are immutable; create a new revision';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'CMS revisions cannot be deleted';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER cms_page_revision_immutable BEFORE UPDATE OR DELETE ON "cms_page_revision" FOR EACH ROW EXECUTE FUNCTION cms_reject_revision_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cms_reject_content_revision_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    IF OLD.document_id IS DISTINCT FROM NEW.document_id OR OLD.version IS DISTINCT FROM NEW.version OR OLD.payload IS DISTINCT FROM NEW.payload OR OLD.created_by IS DISTINCT FROM NEW.created_by OR OLD.created_at IS DISTINCT FROM NEW.created_at OR OLD.source_revision_id IS DISTINCT FROM NEW.source_revision_id THEN
      RAISE EXCEPTION 'CMS content revisions are immutable; create a new revision';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'CMS revisions cannot be deleted';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER cms_content_revision_immutable BEFORE UPDATE OR DELETE ON "cms_content_revision" FOR EACH ROW EXECUTE FUNCTION cms_reject_content_revision_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cms_reject_navigation_revision_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    IF OLD.navigation_id IS DISTINCT FROM NEW.navigation_id OR OLD.version IS DISTINCT FROM NEW.version OR OLD.items IS DISTINCT FROM NEW.items OR OLD.created_by IS DISTINCT FROM NEW.created_by OR OLD.source_revision_id IS DISTINCT FROM NEW.source_revision_id OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
      RAISE EXCEPTION 'CMS navigation revisions are immutable; create a new revision';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'CMS revisions cannot be deleted';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER cms_navigation_revision_immutable BEFORE UPDATE OR DELETE ON "cms_navigation_revision" FOR EACH ROW EXECUTE FUNCTION cms_reject_navigation_revision_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cms_reject_article_revision_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    IF OLD.article_id IS DISTINCT FROM NEW.article_id OR OLD.version IS DISTINCT FROM NEW.version OR OLD.slug IS DISTINCT FROM NEW.slug OR OLD.title IS DISTINCT FROM NEW.title OR OLD.excerpt IS DISTINCT FROM NEW.excerpt OR OLD.category IS DISTINCT FROM NEW.category OR OLD.cover_media_id IS DISTINCT FROM NEW.cover_media_id OR OLD.structured_body IS DISTINCT FROM NEW.structured_body OR OLD.author_display_name IS DISTINCT FROM NEW.author_display_name OR OLD.author_id IS DISTINCT FROM NEW.author_id OR OLD.read_time_minutes IS DISTINCT FROM NEW.read_time_minutes OR OLD.is_pinned IS DISTINCT FROM NEW.is_pinned OR OLD.is_featured IS DISTINCT FROM NEW.is_featured OR OLD.seo_metadata IS DISTINCT FROM NEW.seo_metadata OR OLD.created_by IS DISTINCT FROM NEW.created_by OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
      RAISE EXCEPTION 'CMS article revisions are immutable; create a new revision';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'CMS revisions cannot be deleted';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER cms_article_revision_immutable BEFORE UPDATE OR DELETE ON "cms_article_revision" FOR EACH ROW EXECUTE FUNCTION cms_reject_article_revision_mutation();
