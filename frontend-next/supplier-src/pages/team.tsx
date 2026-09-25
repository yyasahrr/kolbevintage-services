'use client'

/**
 * تیم و دسترسی‌ها (فاز ۶.۲).
 *
 * آنچه حذف شد: `RoleManager` قدیمی نقش‌ها را در localStorage می‌ساخت — یعنی
 * مرورگر مرجعِ مجوز بود. این رفتار کاملاً برداشته شده است.
 *
 * وضعیتِ واقعیِ بک‌اند (بررسی‌شده در این فاز):
 *   - `apps/api/src/modules/supplier-team/` فقط یک Module خالی است؛ هیچ کنترلری
 *     برای اعضای تیمِ تأمین‌کننده وجود ندارد.
 *   - `GET /api/v1/suppliers/:id/members` ادمین-اونلی است.
 *   - مرجعِ مجوزهای واقعیِ یک عضو، همان چیزی است که سرور در `/auth/me` و
 *     `supplier/production/capabilities` برمی‌گرداند.
 *
 * بنابراین این صفحه **هیچ دادهٔ محلی نمی‌سازد**: نقش و capabilityها از نشستِ
 * سرور نمایش داده می‌شوند و نبودِ قراردادِ مدیریتِ تیم صریحاً اعلام می‌شود
 * (به‌جای وانمود کردن به وجودش یا ساختنش در مرورگر).
 */

import { Lock, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import { canUseProduction, type CapabilitySet } from '@shared/permissions/capabilities'
import { useSupplierPortal } from '../context'
import { Notice, SectionHeading, Status } from '../ui'

export function TeamPage() {
  const portal = useSupplierPortal()
  const session = portal.sessionState
  const capabilities: CapabilitySet = session.capabilities
  const productionCodes = session.productionCapabilities

  if (session.status !== 'authenticated') {
    return <Notice tone="warn" title="نشست فعالی وجود ندارد">برای دیدن دسترسی‌ها باید وارد شوید.</Notice>
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumbs">حساب کاربری / تیم</p>
          <h1>تیم و دسترسی‌ها</h1>
          <p>نقش و مجوزها فقط از سرور خوانده می‌شوند؛ مرورگر هیچ مجوزی نمی‌سازد.</p>
        </div>
        <button type="button" className="button secondary" onClick={() => portal.touchData()}><RefreshCw size={15} />به‌روزرسانی</button>
      </div>

      <Notice tone="warn" title="مدیریت اعضای تیم هنوز قراردادِ سمت تأمین‌کننده ندارد">
        بک‌اند در حال حاضر تنها `GET /api/v1/suppliers/:id/members` را با مجوزِ ادمین ارائه می‌کند و ماژول
        `supplier-team` فاقد کنترلر است. افزودن/حذف عضو از این پورتال بدون اختراعِ API امکان‌پذیر نیست؛
        این شکاف در گزارشِ فاز ۶.۲ ثبت شده است.
      </Notice>

      <div className="compliance-grid">
        <section className="surface">
          <SectionHeading eyebrow="نشست فعلی" title="هویتِ شما" description="مقادیر زیر مستقیماً از `GET /auth/me` آمده‌اند." />
          <dl className="detail-meta">
            <div><span>نام</span><b>{session.user.name ?? '—'}</b></div>
            <div><span>ایمیل</span><b className="ltr-inline">{session.user.email ?? '—'}</b></div>
            <div><span>نقش (از سرور)</span><Status tone="info">{session.user.role}</Status></div>
            <div><span>تأمین‌کننده</span><b>{session.supplier?.displayName ?? session.supplier?.legalName ?? '—'}</b></div>
            <div><span>شناسهٔ تأمین‌کننده</span><b className="ltr-inline">{session.supplier?.supplierId ?? '—'}</b></div>
            <div><span>2FA</span><b>{session.user.totpEnabled ? 'فعال' : 'غیرفعال'}</b></div>
          </dl>
        </section>

        <section className="surface">
          <SectionHeading eyebrow="capability" title="قابلیت‌های اعلام‌شدهٔ سرور" description="این فهرست از `GET /supplier/production/capabilities` آمده است." />
          {session.capabilitiesError ? (
            <Notice tone="danger" title="خواندن capabilityها ناموفق بود">{session.capabilitiesError.message}</Notice>
          ) : productionCodes.length === 0 ? (
            <div className="empty-state">
              <span className="empty-mark"><Users size={20} /></span>
              <b>capability تولیدی اعلام نشده است</b>
              <span>بدون capability صریح، بخشِ تولید در دسترس نیست — «تأمین‌کننده» مترادفِ «تولیدکننده» نیست.</span>
            </div>
          ) : (
            <ul className="sp-chips">
              {productionCodes.map(code => <li key={code} className="chip ltr-inline">{code}</li>)}
            </ul>
          )}
        </section>

        <section className="surface">
          <SectionHeading eyebrow="دروازهٔ دسترسی" title="چه چیزی برای شما فعال است" description="این فقط UX است؛ مرجعِ نهایی هر عملیات، مجوزِ سمت سرور است." />
          <ul className="notice-list">
            <GateRow
              icon={<ShieldCheck size={16} />}
              label="بخش تولید و کنترل کیفیت"
              allowed={canUseProduction(capabilities)}
              detail={canUseProduction(capabilities) ? 'capability تولید در نشست شما ثبت شده است.' : 'نیازمند capability تولید اعلام‌شده از سرور.'}
            />
            <GateRow
              icon={<Lock size={16} />}
              label="مالی و برداشت"
              allowed={session.supplier !== null}
              detail="سرور نقشِ owner/finance را بررسی می‌کند؛ در غیر این صورت ۴۰۳ برمی‌گردد."
            />
          </ul>
        </section>
      </div>
    </>
  )
}

function GateRow({ icon, label, allowed, detail }: { icon: React.ReactNode; label: string; allowed: boolean; detail: string }) {
  return (
    <li>
      {icon}
      <div><b>{label}</b><span>{detail}</span></div>
      <Status tone={allowed ? 'success' : 'danger'}>{allowed ? 'فعال' : 'غیرفعال'}</Status>
    </li>
  )
}
