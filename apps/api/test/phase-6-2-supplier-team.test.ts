/**
 * فاز ۶.۲ (بند C) — قراردادِ «تیمِ تأمین‌کننده».
 *
 * این تست‌ها روی **دیتابیسِ واقعیِ مهاجرت‌شده** اجرا می‌شوند (نه mock)، چون
 * ادعاهای اصلی دقیقاً همان‌هایی هستند که اسکیما و قیدهای آن تضمین می‌کنند:
 * یکتاییِ `user_id`، قیدِ CHECK روی `role`، و FKها.
 *
 * آنچه پوشش داده می‌شود:
 *   - جداسازیِ tenant (خواندن و تغییرِ تیمِ تأمین‌کنندهٔ دیگر)
 *   - جلوگیری از خود-ارتقاییِ نقش
 *   - محافظت از «تنها مالک»
 *   - اعتبارسنجیِ نقش و وضعیتِ حساب
 *   - idempotency در افزودن
 *   - سیاستِ نقش که از سرور می‌آید
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { SupplierTeamService } from "../src/modules/supplier-team/supplier-team.service";
import {
  SUPPLIER_TEAM_MANAGER_ROLES,
  SUPPLIER_TEAM_VIEWER_ROLES,
  canManageTeam,
  canViewTeam,
  isTeamMemberRole,
} from "../src/modules/supplier-team/supplier-team.contract";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, urlFor } from "../../../packages/database/test/helpers";

const DB = "kolbe_phase_6_2_supplier_team_test";

const SUPPLIER_A = "p62_team_supplier_a";
const SUPPLIER_B = "p62_team_supplier_b";

const OWNER_A = "p62_team_owner_a";
const SALES_A = "p62_team_sales_a";
const OWNER_B = "p62_team_owner_b";
/** حسابِ غیرفعال — `ACCOUNT_STATUSES` فقط active/suspended/locked را می‌پذیرد. */
const PENDING_USER = "p62_team_suspended";
const OUTSIDER = "p62_team_outsider";

let pool: Pool;
let team: SupplierTeamService;
const auditEntries: any[] = [];
const audit = { record: async (entry: any) => { auditEntries.push(entry); return "p62-team-audit"; } };

async function seed() {
  await pool.query(
    `INSERT INTO account_user (id, email, password_hash, salt, role, status)
     VALUES ($1, $2, 'hash', 'salt', 'supplier', 'active'),
            ($3, $4, 'hash', 'salt', 'supplier', 'active'),
            ($5, $6, 'hash', 'salt', 'supplier', 'active'),
            ($7, $8, 'hash', 'salt', 'supplier', 'suspended'),
            ($9, $10, 'hash', 'salt', 'supplier', 'active')`,
    [
      OWNER_A, `${OWNER_A}@test.invalid`,
      SALES_A, `${SALES_A}@test.invalid`,
      OWNER_B, `${OWNER_B}@test.invalid`,
      PENDING_USER, `${PENDING_USER}@test.invalid`,
      OUTSIDER, `${OUTSIDER}@test.invalid`,
    ],
  );
  await pool.query(
    `INSERT INTO supplier (id, legal_name, display_name, status)
     VALUES ($1, 'A', 'A', 'approved'), ($2, 'B', 'B', 'approved')`,
    [SUPPLIER_A, SUPPLIER_B],
  );
  await pool.query(
    `INSERT INTO supplier_member (id, supplier_id, user_id, role, title)
     VALUES ('p62_mem_owner_a', $1, $2, 'owner', 'مدیر'),
            ('p62_mem_sales_a', $1, $3, 'sales', 'کارشناس فروش'),
            ('p62_mem_owner_b', $4, $5, 'owner', 'مدیر B')`,
    [SUPPLIER_A, OWNER_A, SALES_A, SUPPLIER_B, OWNER_B],
  );
}

describe("فاز ۶.۲ — تیمِ تأمین‌کننده: قراردادِ امنِ سمتِ سرور", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    pool = new Pool({ connectionString: urlFor(DB) });
    await seed();
    team = new SupplierTeamService(drizzle(pool) as any, audit as any);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await dropDatabase(DB);
  });

  it("فهرستِ تیم فقط اعضای همان تأمین‌کننده را برمی‌گرداند (جداسازیِ tenant)", async () => {
    const a = await team.listMembers(OWNER_A);
    expect(a.members.map((member) => member.userId).sort()).toEqual([OWNER_A, SALES_A].sort());
    expect(a.members.some((member) => member.userId === OWNER_B)).toBe(false);
    expect(a.self?.userId).toBe(OWNER_A);
    expect(a.self?.isSelf).toBe(true);

    const b = await team.listMembers(OWNER_B);
    expect(b.members.map((member) => member.userId)).toEqual([OWNER_B]);
  });

  it("کاربرِ بدونِ عضویت، ۴۰۳ می‌گیرد نه فهرستِ خالی", async () => {
    await expect(team.listMembers(OUTSIDER)).rejects.toMatchObject({ status: 403, code: "SUPPLIER_MEMBERSHIP_REQUIRED" });
  });

  it("تغییرِ عضوِ تأمین‌کنندهٔ دیگر ۴۰۴ می‌دهد (نه ۴۰۳ — تا وجودش افشا نشود)", async () => {
    await expect(team.updateMember(OWNER_A, "p62_mem_owner_b", { role: "sales" })).rejects.toMatchObject({
      status: 404,
      code: "TEAM_MEMBER_NOT_FOUND",
    });
    await expect(team.removeMember(OWNER_A, "p62_mem_owner_b")).rejects.toMatchObject({
      status: 404,
      code: "TEAM_MEMBER_NOT_FOUND",
    });
    // و واقعاً هم تغییری رخ نداده است.
    const b = await team.listMembers(OWNER_B);
    expect(b.members[0]?.role).toBe("owner");
  });

  it("نقشِ غیرمالک نمی‌تواند عضویت را تغییر دهد (سدِ خود-ارتقایی)", async () => {
    await expect(team.updateMember(SALES_A, "p62_mem_sales_a", { role: "owner" })).rejects.toMatchObject({
      status: 403,
      code: "TEAM_MANAGEMENT_OWNER_ONLY",
    });
    await expect(team.addMember(SALES_A, { email: `${OUTSIDER}@test.invalid`, role: "sales" })).rejects.toMatchObject({
      status: 403,
      code: "TEAM_MANAGEMENT_OWNER_ONLY",
    });
    const still = await team.listMembers(OWNER_A);
    expect(still.members.find((member) => member.userId === SALES_A)?.role).toBe("sales");
  });

  it("نقشِ نامعتبر با ۴۲۲ رد می‌شود (قیدِ CHECK دیتابیس هم همین را می‌گوید)", async () => {
    await expect(team.updateMember(OWNER_A, "p62_mem_sales_a", { role: "superadmin" })).rejects.toMatchObject({
      status: 422,
      code: "INVALID_MEMBER_ROLE",
    });
    expect(isTeamMemberRole("superadmin")).toBe(false);
    expect(isTeamMemberRole("owner")).toBe(true);
  });

  it("مالک می‌تواند نقشِ عضوِ تیمِ خودش را تغییر دهد و رویدادِ audit ثبت شود", async () => {
    const before = auditEntries.length;
    const result = await team.updateMember(OWNER_A, "p62_mem_sales_a", { role: "warehouse", title: "انباردار" });
    expect(result.member.role).toBe("warehouse");
    expect(result.member.title).toBe("انباردار");
    expect(auditEntries.length).toBeGreaterThan(before);
    expect(auditEntries.at(-1)).toMatchObject({ action: "supplier_team.member_updated", actorId: OWNER_A });
    // بازگرداندنِ وضعیت برای تست‌های بعدی
    await team.updateMember(OWNER_A, "p62_mem_sales_a", { role: "sales", title: "کارشناس فروش" });
  });

  it("افزودنِ حسابِ موجود کار می‌کند؛ حسابِ غیرفعال و تکراری رد می‌شوند", async () => {
    const added = await team.addMember(OWNER_A, { email: `${OUTSIDER}@test.invalid`, role: "finance", title: "مالی" }, "p62-team-idem-0001");
    expect(added.member?.role).toBe("finance");
    expect(added.member?.userId).toBe(OUTSIDER);
    expect(added.member?.userStatus).toBe("active");

    await expect(team.addMember(OWNER_A, { email: `${OUTSIDER}@test.invalid`, role: "sales" })).rejects.toMatchObject({
      status: 409,
      code: "MEMBER_ALREADY_EXISTS",
    });
    await expect(team.addMember(OWNER_A, { email: `${PENDING_USER}@test.invalid`, role: "sales" })).rejects.toMatchObject({
      status: 422,
      code: "USER_NOT_ACTIVE",
    });
    await expect(team.addMember(OWNER_A, { email: "not-an-email", role: "sales" })).rejects.toMatchObject({
      status: 422,
      code: "INVALID_EMAIL",
    });
    await expect(team.addMember(OWNER_A, { email: "nobody@test.invalid", role: "sales" })).rejects.toMatchObject({
      status: 404,
      code: "USER_NOT_FOUND",
    });
  });

  it("کاربری که عضوِ تأمین‌کنندهٔ دیگری است قابلِ انتقال نیست (user_id یکتا)", async () => {
    await expect(team.addMember(OWNER_A, { email: `${OWNER_B}@test.invalid`, role: "sales" })).rejects.toMatchObject({
      status: 409,
      code: "MEMBER_BELONGS_TO_ANOTHER_SUPPLIER",
    });
  });

  it("کلیدِ Idempotency یکسان، عضوِ دوم نمی‌سازد", async () => {
    // OUTSIDER را برمی‌داریم و با همان کلیدِ قبلی دوباره اضافه می‌کنیم.
    const outsiderMember = (await team.listMembers(OWNER_A)).members.find((member) => member.userId === OUTSIDER);
    await team.removeMember(OWNER_A, outsiderMember!.id);
    const again = await team.addMember(OWNER_A, { email: `${OUTSIDER}@test.invalid`, role: "finance" }, "p62-team-idem-0001");
    expect(again.member?.id).toBe(outsiderMember!.id);
    const rows = await pool.query(`SELECT COUNT(*)::int AS n FROM supplier_member WHERE user_id = $1`, [OUTSIDER]);
    expect(rows.rows[0]?.n).toBe(1);
  });

  it("تنها مالکِ تیم نه قابلِ تغییرِ نقش است نه قابلِ حذف", async () => {
    await expect(team.updateMember(OWNER_A, "p62_mem_owner_a", { role: "sales" })).rejects.toMatchObject({
      status: 409,
      code: "LAST_OWNER_PROTECTED",
    });
    await expect(team.removeMember(OWNER_A, "p62_mem_owner_a")).rejects.toMatchObject({
      status: 409,
      code: "LAST_OWNER_PROTECTED",
    });
  });

  it("مالک می‌تواند عضوِ غیرمالک را حذف کند و دسترسی فوراً قطع می‌شود", async () => {
    const outsiderMember = (await team.listMembers(OWNER_A)).members.find((member) => member.userId === OUTSIDER);
    const removed = await team.removeMember(OWNER_A, outsiderMember!.id);
    expect(removed.removedId).toBe(outsiderMember!.id);
    // آن کاربر دیگر عضویتی ندارد ⇒ حتی خواندنِ تیم هم ۴۰۳ می‌گیرد.
    await expect(team.listMembers(OUTSIDER)).rejects.toMatchObject({ status: 403, code: "SUPPLIER_MEMBERSHIP_REQUIRED" });
  });

  it("سیاستِ نقش از سرور می‌آید و فقط مالک مدیرِ تیم است", async () => {
    const { roles } = team.roles();
    expect(roles.map((role) => role.code)).toEqual(["owner", "sales", "warehouse", "finance"]);
    expect(roles.filter((role) => role.canManageTeam).map((role) => role.code)).toEqual(["owner"]);
    expect(SUPPLIER_TEAM_MANAGER_ROLES).toEqual(["owner"]);
    expect(SUPPLIER_TEAM_VIEWER_ROLES).toEqual(["owner", "finance", "sales", "warehouse"]);
    expect(canManageTeam("owner")).toBe(true);
    expect(canManageTeam("finance")).toBe(false);
    expect(canManageTeam(undefined)).toBe(false);
    expect(canViewTeam("warehouse")).toBe(true);
    expect(canViewTeam("hacker")).toBe(false);
    // هیچ دسترسیِ نامعلومی به نقش‌ها نسبت داده نمی‌شود.
    for (const role of roles) expect(Array.isArray(role.permissions)).toBe(true);
  });
});
