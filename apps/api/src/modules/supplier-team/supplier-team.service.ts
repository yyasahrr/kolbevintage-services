/**
 * سرویسِ دامنهٔ «تیمِ تأمین‌کننده» — فاز ۶.۲ (بند C).
 *
 * ── قاعدهٔ بنیادین: supplierId هرگز از مرورگر نمی‌آید ─────────────────────────
 * همان قاعدهٔ A6 که `session.guard.ts` مستند کرده است. هویت از
 * `Claims.sub` خوانده می‌شود و زنجیرهٔ
 *     Claims.sub → supplier_member → supplier
 * تنها مرجعِ «این کاربر به کدام تأمین‌کننده تعلق دارد» است. هیچ متدی
 * `supplierId` را از بدنه یا query نمی‌پذیرد؛ بنابراین خواندن یا تغییرِ تیمِ یک
 * تأمین‌کنندهٔ دیگر از راهِ این سرویس **غیرممکن** است، نه فقط پنهان.
 *
 * ── چرا `404` برای عضوِ بیگانه، نه `403` ─────────────────────────────────────
 * وقتی شناسهٔ عضو متعلقِ تأمین‌کنندهٔ دیگری است، پاسخِ `403` وجودِ آن عضو را
 * افشا می‌کند. پس همان `404 TEAM_MEMBER_NOT_FOUND` برمی‌گردد که برای عضوِ
 * واقعاً ناموجود — یعنی مرزِ tenant هم نشت نمی‌کند و هم رفتارِ یکنواخت دارد.
 */

import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { accountUser, supplierMember } from "@kolbe/database";
import { DomainError } from "@kolbe/shared";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import {
  TEAM_MEMBER_ROLES,
  TEAM_MEMBER_ROLE_LABELS,
  TEAM_ROLE_PERMISSIONS,
  canManageTeam,
  canViewTeam,
  isTeamMemberRole,
  type TeamMemberView,
  type TeamRoleView,
} from "./supplier-team.contract";

/** سقفِ تعدادِ عضو برای جلوگیری از بدنهٔ بی‌قاعده؛ تیمِ واقعی بسیار کوچک‌تر است. */
const MAX_TEAM_SIZE = 50;

type MemberRow = {
  id: string;
  supplierId: string;
  userId: string;
  title: string;
  role: string;
  createdAt: Date | null;
};

type MemberWithUser = MemberRow & {
  email: string;
  displayName: string | null;
  userStatus: string;
};

@Injectable()
export class SupplierTeamService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    private readonly audit: AuditService,
  ) {}

  /**
   * تنها مرجعِ عضویتِ کاربرِ احراز هویت‌شده.
   *
   * اگر کاربر عضو هیچ تأمین‌کننده‌ای نباشد، `403` — چون هویتِ `supplier` دارد
   * ولی عضویتی ندارد؛ این یک خطایِ دسترسی است، نه «یافت نشد».
   */
  async resolveMembership(userId: string): Promise<MemberRow> {
    const [member] = await this.db
      .select()
      .from(supplierMember)
      .where(eq(supplierMember.userId, userId))
      .limit(1);
    if (!member) {
      throw new DomainError(403, "SUPPLIER_MEMBERSHIP_REQUIRED", "عضویتِ تأمین‌کننده یافت نشد");
    }
    return member as MemberRow;
  }

  /** فهرستِ اعضای تیمِ **همان** تأمین‌کننده‌ای که کاربرِ احراز هویت‌شده عضو آن است. */
  async listMembers(actorUserId: string): Promise<{ members: TeamMemberView[]; self: TeamMemberView | null }> {
    const actor = await this.resolveMembership(actorUserId);
    if (!canViewTeam(actor.role)) {
      throw new DomainError(403, "ROLE_NOT_ALLOWED", `نقش ${actor.role} اجازهٔ دیدنِ تیم را ندارد`);
    }
    const rows = await this.db
      .select({
        id: supplierMember.id,
        supplierId: supplierMember.supplierId,
        userId: supplierMember.userId,
        title: supplierMember.title,
        role: supplierMember.role,
        createdAt: supplierMember.createdAt,
        email: accountUser.email,
        displayName: accountUser.displayName,
        userStatus: accountUser.status,
      })
      .from(supplierMember)
      .innerJoin(accountUser, eq(accountUser.id, supplierMember.userId))
      // فیلترِ tenant: فقط اعضای همین تأمین‌کننده. هیچ ورودیِ مرورگری اینجا دخیل نیست.
      .where(eq(supplierMember.supplierId, actor.supplierId));

    const members = rows.map((row) => toView(row, actorUserId));
    return { members, self: members.find((member) => member.isSelf) ?? null };
  }

  /** نقش‌های مجاز + دسترسی‌های هر نقش — سیاست از سرور می‌آید، نه از مرورگر. */
  roles(): { roles: TeamRoleView[] } {
    return {
      roles: TEAM_MEMBER_ROLES.map((code) => ({
        code,
        label: TEAM_MEMBER_ROLE_LABELS[code] ?? code,
        permissions: TEAM_ROLE_PERMISSIONS[code] ?? [],
        canManageTeam: canManageTeam(code),
      })),
    };
  }

  /**
   * افزودنِ یک **حسابِ کاربریِ موجود** به تیم.
   *
   * توجه: اسکیما جدولِ invitation و ستونِ ایمیل/وضعیتِ دعوت ندارد، پس «دعوتِ
   * ایمیلی» در این دامنه تعریف نشده است. آنچه پشتیبانی می‌شود عضوکردنِ حسابِ
   * موجود است و این متد دقیقاً همان را انجام می‌دهد.
   */
  async addMember(
    actorUserId: string,
    input: { email?: unknown; role?: unknown; title?: unknown },
    idempotencyKey?: string,
  ): Promise<{ member: TeamMemberView }> {
    const actor = await this.requireManager(actorUserId);

    const email = String(input.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      throw new DomainError(422, "INVALID_EMAIL", "ایمیلِ حسابِ کاربری نامعتبر است");
    }
    const role = input.role;
    if (!isTeamMemberRole(role)) {
      throw new DomainError(422, "INVALID_MEMBER_ROLE", `نقش باید یکی از ${TEAM_MEMBER_ROLES.join("، ")} باشد`);
    }
    const title = normalizeTitle(input.title);

    const [user] = await this.db.select().from(accountUser).where(eq(accountUser.email, email)).limit(1);
    if (!user) throw new DomainError(404, "USER_NOT_FOUND", "حسابِ کاربری با این ایمیل یافت نشد");
    // وضعیتِ «فعال بودن» از `account_user.status` می‌آید — منبعِ حقیقتِ دامنه.
    if (user.status !== "active") {
      throw new DomainError(422, "USER_NOT_ACTIVE", "فقط حسابِ کاربریِ فعال را می‌توان به تیم افزود");
    }

    const [existing] = await this.db.select().from(supplierMember).where(eq(supplierMember.userId, user.id)).limit(1);
    if (existing) {
      // `user_id` یکتا است؛ پس یا عضوِ همین تیم است (تکراری) یا عضوِ تیمِ دیگری
      // (غیرقابلِ انتقال). هر دو `409` — نه `403`، چون نباید وجودِ عضویت در
      // تأمین‌کنندهٔ دیگر را با وضعیتِ متفاوت افشا کرد.
      const sameSupplier = existing.supplierId === actor.supplierId;
      throw new DomainError(
        409,
        sameSupplier ? "MEMBER_ALREADY_EXISTS" : "MEMBER_BELONGS_TO_ANOTHER_SUPPLIER",
        sameSupplier ? "این کاربر پیش‌تر عضو تیم است" : "این کاربر به تأمین‌کنندهٔ دیگری تعلق دارد",
      );
    }

    const teamSize = await this.countMembers(actor.supplierId);
    if (teamSize >= MAX_TEAM_SIZE) {
      throw new DomainError(409, "TEAM_SIZE_LIMIT", `تیم نمی‌تواند بیش از ${MAX_TEAM_SIZE} عضو داشته باشد`);
    }

    const id = memberId(idempotencyKey);
    const [created] = await this.db
      .insert(supplierMember)
      .values({ id, supplierId: actor.supplierId, userId: user.id, role, title })
      .onConflictDoNothing()
      .returning();

    const member =
      (created as MemberRow | undefined) ??
      ((await this.db.select().from(supplierMember).where(eq(supplierMember.id, id)).limit(1))[0] as
        | MemberRow
        | undefined);
    if (!member) {
      // کلیدِ idempotency تکراری با نقشِ متفاوت ⇒ تضادِ صریح، نه جایگزینیِ بی‌صدا.
      throw new DomainError(409, "IDEMPOTENCY_CONFLICT", "درخواستِ هم‌زمان یا کلیدِ تکراری");
    }

    await this.audit.record({
      actorId: actorUserId,
      actorRole: actor.role,
      action: "supplier_team.member_added",
      entityType: "supplier_member",
      entityId: member.id,
      after: { supplierId: actor.supplierId, userId: member.userId, role: member.role, title: member.title },
    });

    return {
      member: toView({ ...member, email: user.email, displayName: user.displayName, userStatus: user.status }, actorUserId),
    };
  }

  /** تغییرِ نقش/عنوانِ یک عضوِ **همین** تیم. */
  async updateMember(
    actorUserId: string,
    memberId: string,
    input: { role?: unknown; title?: unknown },
  ): Promise<{ member: TeamMemberView }> {
    const actor = await this.requireManager(actorUserId);
    const target = await this.requireTeamMember(actor.supplierId, memberId);

    const role = input.role === undefined ? target.role : input.role;
    if (!isTeamMemberRole(role)) {
      throw new DomainError(422, "INVALID_MEMBER_ROLE", `نقش باید یکی از ${TEAM_MEMBER_ROLES.join("، ")} باشد`);
    }
    const title = input.title === undefined ? target.title : normalizeTitle(input.title);

    // محافظت در برابرِ «تیم بدونِ مالک»: اگر این ردیف آخرین `owner` است،
    // پایین‌آوردنِ نقشش تیم را بی‌سرپرست می‌کند و راهِ بازگشتی هم نمی‌ماند.
    if (target.role === "owner" && role !== "owner") {
      await this.assertNotLastOwner(actor.supplierId, memberId);
    }

    const [updated] = await this.db
      .update(supplierMember)
      .set({ role, title, updatedAt: new Date() })
      .where(and(eq(supplierMember.id, memberId), eq(supplierMember.supplierId, actor.supplierId)))
      .returning();
    if (!updated) {
      throw new DomainError(404, "TEAM_MEMBER_NOT_FOUND", "عضو در این تیم یافت نشد");
    }

    await this.audit.record({
      actorId: actorUserId,
      actorRole: actor.role,
      action: "supplier_team.member_updated",
      entityType: "supplier_member",
      entityId: memberId,
      before: { role: target.role, title: target.title },
      after: { role: updated.role, title: updated.title },
    });

    return { member: await this.viewOf(updated as MemberRow, actorUserId) };
  }

  /**
   * حذفِ عضویت.
   *
   * اسکیما ستونِ `status` ندارد، پس «غیرفعال‌سازی» در این دامنه همان «حذفِ
   * عضویت» است. حذفِ ردیف، دسترسی را فوراً و کامل قطع می‌کند — که برای مرزِ
   * امنیتی نتیجهٔ قوی‌تری از یک پرچمِ نرم دارد.
   */
  async removeMember(actorUserId: string, memberId: string): Promise<{ removedId: string }> {
    const actor = await this.requireManager(actorUserId);
    const target = await this.requireTeamMember(actor.supplierId, memberId);

    if (target.role === "owner") {
      await this.assertNotLastOwner(actor.supplierId, memberId);
    }

    const [removed] = await this.db
      .delete(supplierMember)
      .where(and(eq(supplierMember.id, memberId), eq(supplierMember.supplierId, actor.supplierId)))
      .returning();
    if (!removed) {
      throw new DomainError(404, "TEAM_MEMBER_NOT_FOUND", "عضو در این تیم یافت نشد");
    }

    await this.audit.record({
      actorId: actorUserId,
      actorRole: actor.role,
      action: "supplier_team.member_removed",
      entityType: "supplier_member",
      entityId: memberId,
      before: { supplierId: actor.supplierId, userId: target.userId, role: target.role, title: target.title },
    });

    return { removedId: memberId };
  }

  // ── محافظ‌های داخلی ─────────────────────────────────────────────────────────

  private async requireManager(actorUserId: string): Promise<MemberRow> {
    const actor = await this.resolveMembership(actorUserId);
    if (!canManageTeam(actor.role)) {
      // نقشِ غیرمالک هرگز نمی‌تواند عضویت را تغییر دهد؛ این همان سدِ
      // «خود-ارتقایی» است، چون تغییرِ نقش تنها راهِ گرفتنِ دسترسیِ بیشتر است.
      throw new DomainError(403, "TEAM_MANAGEMENT_OWNER_ONLY", "فقط مالک می‌تواند تیم را مدیریت کند");
    }
    return actor;
  }

  /**
   * عضوِ هدف باید عضوِ **همین** تأمین‌کننده باشد.
   * اگر نباشد `404` — تا وجودش برای تأمین‌کنندهٔ دیگر افشا نشود.
   */
  private async requireTeamMember(supplierId: string, memberId: string): Promise<MemberRow> {
    const id = String(memberId ?? "").trim();
    if (!id) throw new DomainError(404, "TEAM_MEMBER_NOT_FOUND", "شناسهٔ عضو نامعتبر است");
    const [member] = await this.db
      .select()
      .from(supplierMember)
      .where(and(eq(supplierMember.id, id), eq(supplierMember.supplierId, supplierId)))
      .limit(1);
    if (!member) {
      throw new DomainError(404, "TEAM_MEMBER_NOT_FOUND", "عضو در این تیم یافت نشد");
    }
    return member as MemberRow;
  }

  private async assertNotLastOwner(supplierId: string, memberId: string): Promise<void> {
    const owners = await this.db
      .select({ id: supplierMember.id })
      .from(supplierMember)
      .where(and(eq(supplierMember.supplierId, supplierId), eq(supplierMember.role, "owner")));
    const others = owners.filter((owner) => owner.id !== memberId);
    if (others.length === 0) {
      throw new DomainError(409, "LAST_OWNER_PROTECTED", "نمی‌توان تنها مالکِ تیم را تغییر نقش داد یا حذف کرد");
    }
  }

  private async countMembers(supplierId: string): Promise<number> {
    const rows = await this.db.select({ id: supplierMember.id }).from(supplierMember).where(eq(supplierMember.supplierId, supplierId));
    return rows.length;
  }

  private async viewOf(member: MemberRow, actorUserId: string): Promise<TeamMemberView> {
    const [user] = await this.db.select().from(accountUser).where(eq(accountUser.id, member.userId)).limit(1);
    return toView(
      { ...member, email: user?.email ?? "", displayName: user?.displayName ?? null, userStatus: user?.status ?? "unknown" },
      actorUserId,
    );
  }
}

/** نرمال‌سازیِ عنوان؛ همان سقفِ طولیِ ستونِ متنی و بدونِ کاراکترِ قالب‌شکن. */
function normalizeTitle(value: unknown): string {
  const raw = String(value ?? "").trim().replace(/[<>]/g, "");
  return (raw || "عضو تیم").slice(0, 120);
}

/**
 * شناسهٔ عضو.
 *
 * اگر `Idempotency-Key` معتبر باشد، شناسه از همان کلید مشتق می‌شود تا ارسالِ
 * دوبارهٔ همان درخواست، ردیفِ دوم نسازد (همان الگوی `apply()` در
 * `suppliers.service.ts`). در غیرِ این صورت شناسهٔ یکتای سمتِ سرور ساخته
 * می‌شود — **هرگز** در مرورگر.
 */
function memberId(idempotencyKey?: string): string {
  const key = String(idempotencyKey ?? "").trim();
  if (key && /^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    return `smem_${Buffer.from(key).toString("hex").slice(0, 32)}`;
  }
  return `smem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function toView(row: MemberWithUser, actorUserId: string): TeamMemberView {
  return {
    id: row.id,
    userId: row.userId,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    title: row.title,
    userStatus: row.userStatus,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    isSelf: row.userId === actorUserId,
  };
}
