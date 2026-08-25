import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260825093211 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "account_user" drop constraint if exists "account_user_email_unique";`);
    this.addSql(`create table if not exists "account_user" ("id" text not null, "email" text not null, "passwordHash" text not null, "salt" text not null, "role" text check ("role" in ('customer', 'vip', 'admin', 'supplier')) not null default 'customer', "displayName" text null, "phone" text null, "status" text not null default 'active', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "account_user_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_account_user_email_unique" ON "account_user" ("email") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_account_user_deleted_at" ON "account_user" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "account_user" cascade;`);
  }

}
