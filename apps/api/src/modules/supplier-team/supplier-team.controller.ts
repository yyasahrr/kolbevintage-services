/**
 * قراردادِ HTTPِ «تیمِ تأمین‌کننده» — فاز ۶.۲ (بند C).
 *
 * ── چرا این شکل ──────────────────────────────────────────────────────────────
 * هم‌راستا با دیگر کنترلرهای supplier-facing موجود در مخزن
 * (`supplier/finance`, `supplier/orders`, `supplier/compliance`, …):
 *   - پیشوندِ `supplier/…` زیرِ پیشوندِ سراسری `/api/v1`
 *   - `@Roles("supplier")` + `@CurrentUser() claims` و استفادهٔ انحصاری از
 *     `claims.sub` برای هویت
 *   - خطاها `DomainError(status, code, message)` تا فیلترِ سراسری آن‌ها را به
 *     قراردادِ پایدارِ `{ error, message }` تبدیل کند
 *
 * مسیرها زیرِ منبع (`/members`) تودرتو شده‌اند چون منبعِ واقعی، «عضویت» است نه
 * «دعوت‌نامه» — اسکیما هیچ مفهومِ invitation ندارد (نگاه کنید به
 * `supplier-team.contract.ts`).
 *
 * ── امنیت ────────────────────────────────────────────────────────────────────
 * `supplierId` در **هیچ** امضایی وجود ندارد. نه در مسیر، نه در query، نه در
 * بدنه. تمامِ پرس‌وجوها با supplierIdای اجرا می‌شوند که از
 * `claims.sub → supplier_member` استخراج شده است. بنابراین:
 *   - خواندنِ تیمِ تأمین‌کنندهٔ دیگر ممکن نیست
 *   - تغییرِ تیمِ تأمین‌کنندهٔ دیگر ممکن نیست
 *   - ارتقای دسترسیِ خود ممکن نیست (فقط `owner` می‌تواند تغییر دهد)
 * پنهان‌کردنِ دکمه در فرانت‌اند صرفاً UX است؛ اجبار اینجا و در دیتابیس است.
 */

import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post } from "@nestjs/common";
import { toApiJson } from "../../common/api-json";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { SupplierTeamService } from "./supplier-team.service";

@Controller("supplier/team")
export class SupplierTeamController {
  constructor(@Inject(SupplierTeamService) private readonly team: SupplierTeamService) {}

  /** اعضای تیمِ همان تأمین‌کننده‌ای که کاربرِ واردشده عضو آن است. */
  @Get()
  @Roles("supplier")
  async list(@CurrentUser() claims: Claims) {
    return toApiJson(await this.team.listMembers(claims.sub));
  }

  /** نقش‌های مجاز + دسترسی‌های هر نقش (سیاست از سرور، نه از مرورگر). */
  @Get("roles")
  @Roles("supplier")
  async roles(@CurrentUser() claims: Claims) {
    // خواندنِ نقش‌ها هم نیازمندِ عضویت است تا بیرونِ دامنهٔ تأمین‌کننده نشت نکند.
    await this.team.resolveMembership(claims.sub);
    return toApiJson(this.team.roles());
  }

  /** افزودنِ یک حسابِ کاربریِ موجود به تیم — فقط `owner`. */
  @Post("members")
  @HttpCode(201)
  @Roles("supplier")
  async add(
    @CurrentUser() claims: Claims,
    @Body() body: { email?: unknown; role?: unknown; title?: unknown },
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return toApiJson(await this.team.addMember(claims.sub, body ?? {}, idempotencyKey));
  }

  /** تغییرِ نقش/عنوانِ یک عضوِ همین تیم — فقط `owner`. */
  @Patch("members/:memberId")
  @Roles("supplier")
  async update(
    @CurrentUser() claims: Claims,
    @Param("memberId") memberId: string,
    @Body() body: { role?: unknown; title?: unknown },
  ) {
    return toApiJson(await this.team.updateMember(claims.sub, memberId, body ?? {}));
  }

  /** حذفِ عضویت — فقط `owner`. آخرین `owner` محافظت می‌شود. */
  @Delete("members/:memberId")
  @HttpCode(200)
  @Roles("supplier")
  async remove(@CurrentUser() claims: Claims, @Param("memberId") memberId: string) {
    return toApiJson(await this.team.removeMember(claims.sub, memberId));
  }
}
