CREATE EXTENSION IF NOT EXISTS "pg_trgm";
--> statement-breakpoint
DO $$
BEGIN
  -- pg_trgm extracts no trigrams from Persian text under a C CTYPE
  -- (iswalnum rejects non-ASCII), which silently kills typo-tolerant
  -- recall while substring search keeps working. Warn loudly so the
  -- deployment fixes its locale instead of shipping half a search.
  IF similarity('کتری', 'کتری') = 0 THEN
    RAISE WARNING 'kolbe search: database LC_CTYPE cannot tokenize Persian (similarity self-test = 0); recreate the database with a Unicode CTYPE (e.g. C.utf8) or trigram recall stays disabled';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX "product_name_trgm" ON "product" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "product_slug_trgm" ON "product" USING gin ("slug" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "brand_name_trgm" ON "brand" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "category_name_trgm" ON "category" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "product_status_owner_channel" ON "product" USING btree ("status","owner_type");
