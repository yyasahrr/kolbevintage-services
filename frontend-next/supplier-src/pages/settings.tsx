'use client'

/**
 * تنظیمات کارخانه (فاز ۶.۲).
 *
 * حذف‌شده: کلیدِ localStorageِ تعطیلی‌های کارخانه — آن کلید «حقیقتِ کسب‌وکار در
 * مرورگر» بود (طبق truth-registry: `supplier-inventory-capacity` = LOCAL_STORAGE).
 * جایگزینِ آن، دورهٔ ظرفیت و تعطیلیِ سمت سرور است (صفحهٔ Capacity).
 *
 * آنچه اینجا می‌ماند فقط اطلاعاتِ نمایشیِ نشست است که از سرور خوانده می‌شود.
 */

import { RefreshCw, Store } from 'lucide-react'
import { formatDateTime } from '@shared/supplier/present'
import { useSupplierPortal } from '../context'
import { Notice, SectionHeading, Status } from '../ui'
import type { SupplierPage } from '../navigation'

export function SettingsPage({ onNavigate }: { onNavigate: (page: SupplierPage) => void }) {
  const portal = useSupplierPortal()
  const session = portal.sessionState

  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumbs">حساب کاربری / تنظیمات</p>
          <h1>تنظیمات کارخانه</h1>
          <p>اطلاعاتِ نشست، ظرفیت و دسترسی‌ها.</p>
        </div>
        <button type="button" className="button secondary" onClick={() => portal.touchData()}><RefreshCw size={15} />به‌روزرسانی</button>
      </div>

      <Notice tone="info" title="ذخیره‌سازی محلیِ کسب‌وکار حذف شد">
        تعطیلی‌ها و نقش‌ها دیگر در مرورگر ذخیره نمی‌شوند؛ مرجعِ آن‌ها سرور است
        (ظرفیت/تعطیلی در بخشِ تولید، نقش و مجوز در بخشِ تیم).
      </Notice>

      <div className="compliance-grid">
        <section className="surface">
          <SectionHeading eyebrow="نشست" title="اطلاعات حساب" />
          {session.status === 'authenticated' ? (
            <dl className="detail-meta">
              <div><span>نام</span><b>{session.user.name ?? '—'}</b></div>
              <div><span>ایمیل</span><b className="ltr-inline">{session.user.email ?? '—'}</b></div>
              <div><span>تلفن</span><b className="ltr-inline">{session.user.phone ?? '—'}</b></div>
              <div><span>نقش</span><Status tone="info">{session.user.role}</Status></div>
              <div><span>آخرین بازیابی نشست</span><b>{formatDateTime(session.fetchedAt)}</b></div>
            </dl>
          ) : (
            <p className="muted-line">نشست فعالی وجود ندارد.</p>
          )}
        </section>

        <section className="surface">
          <SectionHeading eyebrow="کارخانه" title="تأمین‌کننده" />
          {session.status === 'authenticated' && session.supplier ? (
            <dl className="detail-meta">
              <div><span>نام نمایشی</span><b>{session.supplier.displayName ?? '—'}</b></div>
              <div><span>نام حقوقی</span><b>{session.supplier.legalName ?? '—'}</b></div>
              <div><span>شناسه</span><b className="ltr-inline">{session.supplier.supplierId}</b></div>
              <div><span>وضعیت</span><Status tone="success">{session.supplier.status ?? '—'}</Status></div>
            </dl>
          ) : (
            <div className="empty-state">
              <span className="empty-mark"><Store size={20} /></span>
              <b>تأمین‌کننده‌ای در نشست ثبت نشده است</b>
            </div>
          )}
        </section>

        <section className="surface">
          <SectionHeading eyebrow="میان‌برها" title="مدیریت عملیاتی" />
          <ul className="notice-list">
            <li>
              <Store size={16} />
              <div><b>ظرفیت و تعطیلی</b><span>دوره‌های ظرفیت و روزهای تعطیل کارخانه</span></div>
              <button type="button" className="button secondary" onClick={() => onNavigate('production')}>باز کردن</button>
            </li>
            <li>
              <Store size={16} />
              <div><b>انطباق و حساب بانکی</b><span>اسناد، توافق‌نامه و مقصد پرداخت</span></div>
              <button type="button" className="button secondary" onClick={() => onNavigate('compliance')}>باز کردن</button>
            </li>
          </ul>
        </section>
      </div>
    </>
  )
}
