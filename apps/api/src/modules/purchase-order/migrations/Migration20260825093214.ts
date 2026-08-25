import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260825093214 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "purchase_order" drop constraint if exists "purchase_order_orderCode_unique";`);
    this.addSql(`create table if not exists "purchase_order" ("id" text not null, "orderCode" text not null, "supplierId" text not null, "wholesaleOrderId" text null, "status" text check ("status" in ('pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled')) not null default 'pending', "dueDate" timestamptz null, "trackingCode" text null, "totalAmount" integer not null default 0, "currency" text not null default 'IRR', "notes" text null, "shippedAt" timestamptz null, "deliveredAt" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "purchase_order_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_purchase_order_orderCode_unique" ON "purchase_order" ("orderCode") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_purchase_order_deleted_at" ON "purchase_order" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "purchase_order_item" ("id" text not null, "purchaseOrderId" text not null, "productName" text not null, "sku" text null, "variantId" text null, "quantity" integer not null default 1, "unitPrice" integer not null default 0, "totalAmount" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "purchase_order_item_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_purchase_order_item_deleted_at" ON "purchase_order_item" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "purchase_order" cascade;`);

    this.addSql(`drop table if exists "purchase_order_item" cascade;`);
  }

}
