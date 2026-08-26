import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260826120633 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "wholesale_account" drop constraint if exists "wholesale_account_status_check";`);

    this.addSql(`alter table if exists "wholesale_account" add constraint "wholesale_account_status_check" check("status" in ('pending', 'approved', 'suspended', 'financial_blocked', 'rejected', 'changes_requested'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "wholesale_account" drop constraint if exists "wholesale_account_status_check";`);

    this.addSql(`alter table if exists "wholesale_account" add constraint "wholesale_account_status_check" check("status" in ('pending', 'approved', 'rejected', 'changes_requested'));`);
  }

}
