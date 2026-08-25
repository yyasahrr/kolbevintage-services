import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260825093617 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "retail_order" drop constraint if exists "retail_order_orderCode_unique";`);
    this.addSql(`create table if not exists "retail_order" ("id" text not null, "orderCode" text not null, "customerName" text not null, "phone" text not null, "email" text null, "lines" jsonb not null default '[]', "address" jsonb not null default '{}', "shippingMethod" text not null default 'post', "shippingPrice" integer not null default 0, "payMethod" text not null default 'gateway', "totalAmount" integer not null default 0, "paymentStatus" text not null default 'pending_gateway', "fulfillmentStatus" text not null default 'processing', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "retail_order_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_retail_order_orderCode_unique" ON "retail_order" ("orderCode") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_retail_order_deleted_at" ON "retail_order" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "retail_order" cascade;`);
  }

}
