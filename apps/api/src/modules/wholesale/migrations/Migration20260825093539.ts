import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260825093539 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "wholesale_order" drop constraint if exists "wholesale_order_orderCode_unique";`);
    this.addSql(`alter table if exists "rfq" drop constraint if exists "rfq_referenceCode_unique";`);
    this.addSql(`create table if not exists "quote" ("id" text not null, "rfqId" text not null, "supplierId" text not null, "unitPrice" integer not null default 0, "leadTimeDays" integer not null default 0, "notes" text null, "status" text check ("status" in ('submitted', 'accepted', 'rejected')) not null default 'submitted', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "quote_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_quote_deleted_at" ON "quote" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "rfq" ("id" text not null, "supplierId" text not null, "referenceCode" text not null, "title" text not null, "customerName" text not null, "quantity" integer not null default 0, "requestedDeliveryDate" timestamptz null, "specifications" jsonb null, "status" text check ("status" in ('open', 'quoted', 'closed')) not null default 'open', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "rfq_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_rfq_referenceCode_unique" ON "rfq" ("referenceCode") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_rfq_deleted_at" ON "rfq" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "support_ticket" ("id" text not null, "supplierId" text null, "subject" text not null, "category" text not null default 'عمومی', "message" text not null, "priority" text check ("priority" in ('low', 'normal', 'high')) not null default 'normal', "status" text check ("status" in ('open', 'answered', 'closed')) not null default 'open', "adminReply" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "support_ticket_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_support_ticket_deleted_at" ON "support_ticket" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "wholesale_account" ("id" text not null, "userId" text not null, "memberName" text not null, "storeName" text not null, "phone" text not null, "city" text not null, "planName" text not null default 'وی‌آی‌پی', "status" text check ("status" in ('pending', 'approved', 'rejected', 'changes_requested')) not null default 'pending', "activatedAt" timestamptz null, "expiresAt" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "wholesale_account_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wholesale_account_deleted_at" ON "wholesale_account" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "wholesale_order" ("id" text not null, "orderCode" text not null, "accountId" text not null, "status" text check ("status" in ('pending', 'approved', 'fulfilled', 'cancelled')) not null default 'pending', "totalAmount" integer not null default 0, "totalUnits" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "wholesale_order_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_wholesale_order_orderCode_unique" ON "wholesale_order" ("orderCode") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wholesale_order_deleted_at" ON "wholesale_order" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "wholesale_order_item" ("id" text not null, "orderId" text not null, "productId" text not null, "variantId" text not null, "productName" text not null, "sku" text not null, "quantity" integer not null default 1, "unitPrice" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "wholesale_order_item_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wholesale_order_item_deleted_at" ON "wholesale_order_item" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "quote" cascade;`);

    this.addSql(`drop table if exists "rfq" cascade;`);

    this.addSql(`drop table if exists "support_ticket" cascade;`);

    this.addSql(`drop table if exists "wholesale_account" cascade;`);

    this.addSql(`drop table if exists "wholesale_order" cascade;`);

    this.addSql(`drop table if exists "wholesale_order_item" cascade;`);
  }

}
