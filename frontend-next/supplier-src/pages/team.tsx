'use client'

/**
 * تیم و دسترسی‌ها (فاز ۶.۲ — بند C).
 *
 * مرجعِ داده: `GET /api/v1/supplier/team`، `GET /api/v1/supplier/team/roles`،
 * `POST|PATCH|DELETE /api/v1/supplier/team/members[/:id]`.
 *
 * ── چه چیزی عمداً در مرورگر نیست ─────────────────────────────────────────────
 *  • هیچ نقش/مجوزی در localStorage ساخته نمی‌شود. `RoleManager` قدیمی که نقش را
 *    در مرورگر تولید می‌کرد در همین فاز حذف شده و بازنگشته است.
 *  • `supplierId` هرگز فرستاده نمی‌شود؛ سرور آن را از نشست می‌گیرد.
 *  • پنهان‌کردنِ فرمِ مدیریت برای نقش‌های غیرمالک **فقط UX است**؛ اجبارِ واقعی
 *    سمتِ سرور است (`TEAM_MANAGEMENT_OWNER_ONLY` با ۴۰۳). اگر سرور اجازه بدهد
 *    و UI پنهان کرده باشد، رفتار امن است؛ برعکسش هرگز.
 *
 * ── دو محدودیتِ دامنه‌ای که صادقانه نمایش داده می‌شود ────────────────────────
 *  • «دعوت‌نامهٔ ایمیلی» وجود ندارد: اسکیما نه جدولِ invitation دارد نه ستونِ
 *    ایمیل/وضعیتِ دعوت. عملیاتِ واقعی «افزودنِ حسابِ کاربریِ موجود» است.
 *  • ستونِ `status` در `supplier_member` نیست؛ پس «غیرفعال‌سازی» همان «حذفِ
 *    عضویت» است و وضعیتِ فعال بودن از `account_user.status` خوانده می‌شود.
 */

import { Check, Lock, RefreshCw, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { SupplierTeamMember, SupplierTeamRoleInfo } from '@shared/supplier/contracts'
import type { Tone } from '@shared/supplier/present'
import { dataOrNull } from '@shared/ui/async-state'
import { canUseProduction, type CapabilitySet } from '@shared/permissions/capabilities'
import { useSupplierPortal } from '../context'
import { usePortalDataVersion, useSupplierMutation, useSupplierResource } from '../hooks'
import { DataTable, Field, Notice, SectionHeading, StateView, Status, SubmitBar } from '../ui'

export function TeamPage() {
  const portal = useSupplierPortal()
  const version = usePortalDataVersion()
  const session = portal.sessionState

  const team = useSupplierResource(() => portal.api.team.list(), [version], {
    isEmpty: data => (data.members ?? []).length === 0,
  })
  const roles = useSupplierResource(() => portal.api.team.roles(), [version], {
    isEmpty: data => (data.roles ?? []).length === 0,
  })
  const mutation = useSupplierMutation()

  const members = useMemo(() => dataOrNull(team.state)?.members ?? [], [team.state])
  const self = dataOrNull(team.state)?.self ?? null
  const roleInfo = useMemo(() => dataOrNull(roles.state)?.roles ?? [], [roles.state])

  /**
   * آیا کاربرِ جاری مدیرِ تیم است؟
   * این فقط برای UX است (نمایش/پنهان‌کردنِ فرم)؛ مرجعِ نهایی سرور است.
   */
  const isManager = roleInfo.find(role => role.code === self?.role)?.canManageTeam ?? false

  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumbs">حساب کاربری / تیم</p>
          <h1>تیم و دسترسی‌ها</h1>
          <p>اعضا، نقش‌ها و مجوزها از سرور خوانده می‌شوند؛ مرورگر هیچ مجوزی نمی‌سازد.</p>
        </div>
        <button type="button" className="button secondary" onClick={team.reload}><RefreshCw size={15} />به‌روزرسانی</button>
      </div>

      <StateView state={team.state} emptyLabel="عضوی در تیم ثبت نشده است" onRetry={team.reload}>
        <section className="surface table-surface">
          <SectionHeading
            eyebrow="اعضا"
            title="اعضای تیم"
            description="این فهرست دقیقاً همان اعضای ثبت‌شده در سرور برای تأمین‌کنندهٔ شماست."
          />
          <DataTable
            columns={[
              { key: 'name', header: 'نام', primary: true, render: row => <span>{row.displayName ?? '—'}</span> },
              { key: 'email', header: 'ایمیل', primary: true, render: row => <span className="ltr-inline">{row.email}</span> },
              { key: 'role', header: 'نقش', primary: true, render: row => <Status tone={roleTone(row.role)}>{roleLabel(roleInfo, row.role)}</Status> },
              { key: 'title', header: 'عنوان', render: row => row.title },
              { key: 'status', header: 'وضعیت حساب', render: row => <Status tone={row.userStatus === 'active' ? 'success' : 'danger'}>{userStatusLabel(row.userStatus)}</Status> },
              { key: 'self', header: '', render: row => (row.isSelf ? <Status tone="info">شما</Status> : null) },
            ]}
            rows={members as SupplierTeamMember[]}
            rowKey={row => row.id}
            busy={team.busy}
          />
        </section>
      </StateView>

      {isManager ? (
        <AddMemberForm
          roleInfo={roleInfo}
          busy={mutation.busy}
          error={mutation.error}
          message={mutation.message}
          onSubmit={async input => {
            const result = await mutation.run(() => portal.api.team.addMember(input, crypto.randomUUID()))
            if (result.ok) team.reload()
            return result.ok
          }}
        />
      ) : (
        <Notice tone="warn" title="مدیریتِ تیم فقط برای مالک">
          نقشِ جاریِ شما «{self ? roleLabel(roleInfo, self.role) : '—'}» است. افزودن، تغییرِ نقش و حذفِ عضو تنها با نقشِ
          مالک ممکن است؛ این محدودیت سمتِ سرور اعمال می‌شود، نه فقط در این رابط.
        </Notice>
      )}

      {isManager ? (
        <MemberManagement
          members={members as SupplierTeamMember[]}
          roleInfo={roleInfo}
          busy={mutation.busy}
          onUpdate={async (member, input) => {
            const result = await mutation.run(() => portal.api.team.updateMember(member.id, input))
            if (result.ok) team.reload()
          }}
          onRemove={async member => {
            const result = await mutation.run(() => portal.api.team.removeMember(member.id))
            if (result.ok) team.reload()
          }}
        />
      ) : null}

      <section className="surface">
        <SectionHeading
          eyebrow="سیاستِ نقش"
          title="دسترسیِ هر نقش"
          description="این جدول از `GET /supplier/team/roles` می‌آید؛ هیچ سیاستی در مرورگر تعریف نمی‌شود."
        />
        <StateView state={roles.state} emptyLabel="سیاستی از سرور نرسید">
          <ul className="notice-list">
            {(roleInfo as SupplierTeamRoleInfo[]).map(role => (
              <li key={role.code}>
                <ShieldCheck size={16} />
                <div>
                  <b>{role.label}</b>
                  <span>
                    {role.permissions.length > 0
                      ? role.permissions.map(permission => permissionLabel(permission)).join('، ')
                      : 'بدون دسترسیِ ثبت‌شده'}
                  </span>
                </div>
                <Status tone={role.canManageTeam ? 'success' : 'neutral'}>
                  {role.canManageTeam ? 'مدیرِ تیم' : 'بدون مدیریت'}
                </Status>
              </li>
            ))}
          </ul>
        </StateView>
      </section>

      <SessionCapabilities />
    </>
  )
}

/* ── افزودنِ عضو ──────────────────────────────────────────────────────────── */

function AddMemberForm({
  roleInfo,
  busy,
  error,
  message,
  onSubmit,
}: {
  roleInfo: readonly SupplierTeamRoleInfo[]
  busy: boolean
  error: string | null
  message: string | null
  onSubmit: (input: { email: string; role: string; title?: string }) => Promise<boolean>
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('sales')
  const [title, setTitle] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  // نقشِ «مالک» عمداً در فهرستِ افزودن نیست: اعطایِ مالکیت از راهِ فرمِ افزودن،
  // ارتقای دسترسی است و باید آگاهانه و از راهِ «تغییرِ نقش» انجام شود.
  const assignable = roleInfo.filter(item => item.code !== 'owner')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLocalError(null)
    const normalized = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized)) {
      setLocalError('ایمیلِ حسابِ کاربری را کامل وارد کنید.')
      return
    }
    const ok = await onSubmit({ email: normalized, role, title: title.trim() || undefined })
    if (ok) {
      setEmail('')
      setTitle('')
    }
  }

  return (
    <form className="surface form-surface" onSubmit={submit} noValidate>
      <SectionHeading
        eyebrow="افزودنِ عضو"
        title="افزودنِ حسابِ کاربری به تیم"
        description="حساب باید از پیش در کلبه ثبت شده و فعال باشد. این دامنه «دعوت‌نامهٔ ایمیلی» ندارد؛ عضویت مستقیم ثبت می‌شود."
      />
      <div className="sp-grid">
        <Field label="ایمیلِ حسابِ کاربری" required>
          <input
            type="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            className="ltr-inline"
            dir="ltr"
            required
            autoComplete="off"
          />
        </Field>
        <Field label="نقش" required>
          <select value={role} onChange={event => setRole(event.target.value)}>
            {assignable.map(item => (
              <option key={item.code} value={item.code}>{item.label}</option>
            ))}
          </select>
        </Field>
        <Field label="عنوان" hint="اختیاری — مثلاً «کارشناس فروش»">
          <input value={title} onChange={event => setTitle(event.target.value)} />
        </Field>
      </div>
      <SubmitBar busy={busy} error={localError ?? error}>
        <button type="submit" className="button primary" disabled={busy}><UserPlus size={16} />افزودن به تیم</button>
      </SubmitBar>
      {message ? <Notice tone="info" title="ثبت شد">{message}</Notice> : null}
    </form>
  )
}

/* ── تغییرِ نقش و حذف ─────────────────────────────────────────────────────── */

function MemberManagement({
  members,
  roleInfo,
  busy,
  onUpdate,
  onRemove,
}: {
  members: readonly SupplierTeamMember[]
  roleInfo: readonly SupplierTeamRoleInfo[]
  busy: boolean
  onUpdate: (member: SupplierTeamMember, input: { role?: string; title?: string }) => Promise<void>
  onRemove: (member: SupplierTeamMember) => Promise<void>
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = members.find(member => member.id === selectedId) ?? null
  const [role, setRole] = useState('sales')
  const [title, setTitle] = useState('')

  const open = (member: SupplierTeamMember) => {
    setSelectedId(member.id)
    setRole(member.role)
    setTitle(member.title)
  }

  return (
    <section className="surface">
      <SectionHeading
        eyebrow="مدیریت"
        title="تغییرِ نقش یا حذفِ عضو"
        description="«غیرفعال‌سازی» در این دامنه همان حذفِ عضویت است؛ اسکیما ستونِ وضعیت برای عضویت ندارد."
      />
      {selected ? (
        <div className="form-surface">
          <dl className="detail-meta">
            <div><span>عضو</span><b>{selected.displayName ?? '—'}</b></div>
            <div><span>ایمیل</span><b className="ltr-inline">{selected.email}</b></div>
          </dl>
          <div className="sp-grid">
            <Field label="نقش" required>
              <select value={role} onChange={event => setRole(event.target.value)}>
                {roleInfo.map(item => (
                  <option key={item.code} value={item.code}>{item.label}</option>
                ))}
              </select>
            </Field>
            <Field label="عنوان">
              <input value={title} onChange={event => setTitle(event.target.value)} />
            </Field>
          </div>
          {selected.isSelf && role !== 'owner' ? (
            <Notice tone="warn" title="در حالِ پایین‌آوردنِ نقشِ خودتان هستید">
              اگر تنها مالکِ تیم باشید، سرور این تغییر را با خطایِ «تنها مالک محافظت می‌شود» رد می‌کند.
            </Notice>
          ) : null}
          <div className="sp-actions">
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => onUpdate(selected, { role, title: title.trim() || undefined })}
            >
              <Check size={16} />ثبت تغییر
            </button>
            <button type="button" className="button secondary" disabled={busy} onClick={() => onRemove(selected)}>
              <Trash2 size={16} />حذف عضویت
            </button>
            <button type="button" className="button ghost" disabled={busy} onClick={() => setSelectedId(null)}>انصراف</button>
          </div>
        </div>
      ) : (
        <ul className="notice-list">
          {members.map(member => (
            <li key={member.id}>
              <Users size={16} />
              <div>
                <b>{member.displayName ?? member.email}</b>
                <span>{roleLabel(roleInfo, member.role)} — {member.title}</span>
              </div>
              <button type="button" className="button secondary" onClick={() => open(member)}>مدیریت</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ── هویتِ جاری و capabilityها ────────────────────────────────────────────── */

function SessionCapabilities() {
  const portal = useSupplierPortal()
  const session = portal.sessionState
  const capabilities: CapabilitySet = session.capabilities
  const productionCodes = session.productionCapabilities

  if (session.status !== 'authenticated') {
    return <Notice tone="warn" title="نشست فعالی وجود ندارد">برای دیدن دسترسی‌ها باید وارد شوید.</Notice>
  }

  return (
    <div className="compliance-grid">
      <section className="surface">
        <SectionHeading eyebrow="نشست فعلی" title="هویتِ شما" description="مقادیر زیر مستقیماً از `GET /auth/me` آمده‌اند." />
        <dl className="detail-meta">
          <div><span>نام</span><b>{session.user.name ?? '—'}</b></div>
          <div><span>ایمیل</span><b className="ltr-inline">{session.user.email ?? '—'}</b></div>
          <div><span>نقش (از سرور)</span><Status tone="info">{session.user.role}</Status></div>
          <div><span>تأمین‌کننده</span><b>{session.supplier?.displayName ?? session.supplier?.legalName ?? '—'}</b></div>
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
          <li>
            <ShieldCheck size={16} />
            <div>
              <b>بخش تولید و کنترل کیفیت</b>
              <span>
                {canUseProduction(capabilities)
                  ? 'capability تولید در نشست شما ثبت شده است.'
                  : 'نیازمند capability تولید اعلام‌شده از سرور.'}
              </span>
            </div>
            <Status tone={canUseProduction(capabilities) ? 'success' : 'danger'}>
              {canUseProduction(capabilities) ? 'فعال' : 'غیرفعال'}
            </Status>
          </li>
          <li>
            <Lock size={16} />
            <div>
              <b>مالی و برداشت</b>
              <span>سرور نقشِ owner/finance را بررسی می‌کند؛ در غیر این صورت ۴۰۳ برمی‌گردد.</span>
            </div>
            <Status tone={session.supplier !== null ? 'success' : 'danger'}>
              {session.supplier !== null ? 'فعال' : 'غیرفعال'}
            </Status>
          </li>
        </ul>
      </section>
    </div>
  )
}

/* ── برچسب‌ها (فقط نمایش) ─────────────────────────────────────────────────── */

function roleLabel(roleInfo: readonly SupplierTeamRoleInfo[], code: string): string {
  return roleInfo.find(role => role.code === code)?.label ?? code
}

function roleTone(code: string): Tone {
  if (code === 'owner') return 'success'
  if (code === 'finance') return 'warning'
  if (code === 'sales') return 'info'
  return 'neutral'
}

function userStatusLabel(status: string): string {
  if (status === 'active') return 'فعال'
  if (status === 'suspended') return 'معلق'
  if (status === 'locked') return 'قفل‌شده'
  return status || 'نامشخص'
}

const PERMISSION_LABELS: Record<string, string> = {
  create_product: 'ثبت محصول',
  change_images: 'تغییر تصاویر',
  change_description: 'تغییر توضیحات',
  add_variant: 'افزودنِ تنوع',
  change_category: 'تغییر دسته‌بندی',
  change_price: 'تغییر قیمت',
}

function permissionLabel(code: string): string {
  return PERMISSION_LABELS[code] ?? code
}
