-- Phase 3.9.1 — explicit commercial separation for supplier submissions
-- Catalog attributes (name, brand, category, attributes, variants, media) vs commercial (sku, wholesalePrice, MOQ, etc.)
-- Previously commercial fields were overloaded inside generic attributes JSON — now explicit.

ALTER TABLE "supplier_product_submission" ADD COLUMN "commercial" jsonb DEFAULT '{}'::jsonb NOT NULL;
