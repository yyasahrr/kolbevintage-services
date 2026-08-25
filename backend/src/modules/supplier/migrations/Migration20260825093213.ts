import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260825093213 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "supplier_variant" drop constraint if exists "supplier_variant_sku_unique";`);
    this.addSql(`alter table if exists "supplier_product" drop constraint if exists "supplier_product_sku_unique";`);
    this.addSql(`alter table if exists "supplier_inventory" drop constraint if exists "supplier_inventory_variantId_unique";`);
    this.addSql(`create table if not exists "supplier" ("id" text not null, "legalName" text not null, "displayName" text not null, "city" text null, "phone" text null, "category" text null, "monthlyCapacity" integer null, "capabilities" jsonb null, "status" text check ("status" in ('pending', 'reviewing', 'approved', 'rejected', 'changes_requested')) not null default 'pending', "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "supplier_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_deleted_at" ON "supplier" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "supplier_application" ("id" text not null, "userId" text null, "companyName" text not null, "representativeName" text not null, "phone" text not null, "category" text not null, "monthlyCapacity" integer null, "status" text check ("status" in ('pending', 'reviewing', 'approved', 'rejected')) not null default 'pending', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "supplier_application_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_application_deleted_at" ON "supplier_application" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "supplier_inventory" ("id" text not null, "variantId" text not null, "onHand" integer not null default 0, "reserved" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "supplier_inventory_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_supplier_inventory_variantId_unique" ON "supplier_inventory" ("variantId") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_inventory_deleted_at" ON "supplier_inventory" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "supplier_member" ("id" text not null, "supplierId" text not null, "userId" text not null, "title" text not null default 'عضو تیم', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "supplier_member_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_member_deleted_at" ON "supplier_member" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "supplier_product" ("id" text not null, "supplierId" text not null, "name" text not null, "sku" text not null, "category" text not null, "description" text not null default '', "wholesalePrice" integer not null default 0, "imageUrl" text null, "status" text check ("status" in ('draft', 'submitted', 'approved', 'changes_requested', 'rejected')) not null default 'draft', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "supplier_product_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_supplier_product_sku_unique" ON "supplier_product" ("sku") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_product_deleted_at" ON "supplier_product" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "supplier_variant" ("id" text not null, "productId" text not null, "sku" text not null, "color" text not null default 'بدون رنگ', "colorHex" text null, "size" text not null default 'تک‌سایز', "cost" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "supplier_variant_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_supplier_variant_sku_unique" ON "supplier_variant" ("sku") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_variant_deleted_at" ON "supplier_variant" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "supplier" cascade;`);

    this.addSql(`drop table if exists "supplier_application" cascade;`);

    this.addSql(`drop table if exists "supplier_inventory" cascade;`);

    this.addSql(`drop table if exists "supplier_member" cascade;`);

    this.addSql(`drop table if exists "supplier_product" cascade;`);

    this.addSql(`drop table if exists "supplier_variant" cascade;`);
  }

}
