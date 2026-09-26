'use client'

/**
 * بخش‌های ویرایشگرِ محصولِ تأمین‌کننده.
 *
 * قاعدهٔ معماری (§31): این فایل فقط state را ارکستره و نمایش می‌دهد. منطقِ
 * گراف (ساخت، اعتبارسنجی، ماتریس، تفسیرِ طرحِ ویژگی‌ها) همگی در
 * `shared/supplier/product-graph.ts` است تا مستقل از مرورگر قابلِ آزمون بماند.
 *
 * هیچ fetch مستقیمی اینجا نیست؛ همه‌چیز از `portal.api` (مرزِ مشترک) می‌آید.
 */

import { AlertTriangle, ArrowDown, ArrowUp, Image as ImageIcon, Plus, Trash2, Upload, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { SupplierBrand, SupplierCategoryNode } from '@shared/supplier/contracts'
import {
  MOQ_UNIT_LABELS_FA,
  PACKAGE_TYPE_LABELS_FA,
  buildVariantMatrix,
  matrixCellSku,
  orphanedAttributes,
  previewPackageTotalPieces,
  interpretAttributeSchema,
  type DraftVariant,
} from '@shared/supplier/product-graph'
import type { DraftIssue, DraftProduct } from '@shared/supplier/product-graph'
import { MOQ_UNITS, PACKAGE_TYPES } from '@shared/supplier/contracts'
import type { PackageType } from '@shared/supplier/contracts'
import { Field, Notice } from '../../ui'
import { newDraftRowId, normalizeSku, type DraftAction, type VariantDependencyWarning } from './draft'

export type SectionErrors = {
  /** خطاهای مرتبط با هر بخش، از همان کدهای دامنهٔ سرور. */
  issues: DraftIssue[]
  broken: VariantDependencyWarning[]
}

function issueMessages(issues: DraftIssue[], codes: DraftIssue['code'][]): string[] {
  return issues.filter(issue => codes.includes(issue.code)).map(issue => issue.message)
}

function SectionErrorList({ issues, codes }: { issues: DraftIssue[]; codes: DraftIssue['code'][] }) {
  const messages = issueMessages(issues, codes)
  if (messages.length === 0) return null
  return (
    <Notice tone="danger" title="نیازمند اصلاح">
      <ul className="spe-error-list">
        {messages.map((message, index) => (
          <li key={`${message}-${index}`}>{message}</li>
        ))}
      </ul>
    </Notice>
  )
}

/* ── ۱. اطلاعاتِ پایه ─────────────────────────────────────────────────────── */

function flattenCategories(nodes: SupplierCategoryNode[], depth = 0, out: Array<{ id: string; name: string; depth: number; attributesSchema: Record<string, unknown> }> = []) {
  for (const node of nodes) {
    out.push({ id: node.id, name: node.name, depth, attributesSchema: node.attributesSchema ?? {} })
    if (node.children?.length) flattenCategories(node.children, depth + 1, out)
  }
  return out
}

export function BasicInformationSection({
  draft,
  dispatch,
  categories,
  brands,
  issues,
}: {
  draft: DraftProduct
  dispatch: React.Dispatch<DraftAction>
  categories: SupplierCategoryNode[]
  brands: SupplierBrand[]
  issues: DraftIssue[]
}) {
  const flat = useMemo(() => flattenCategories(categories), [categories])
  const selected = flat.find(node => node.id === draft.categoryId) ?? null
  const specs = useMemo(() => interpretAttributeSchema(selected?.attributesSchema), [selected])
  const orphans = useMemo(() => orphanedAttributes(draft.attributes, selected?.attributesSchema), [draft.attributes, selected])

  return (
    <section className="surface spe-section" aria-labelledby="spe-basic">
      <h2 id="spe-basic" className="spe-section-title">اطلاعاتِ پایه</h2>
      <SectionErrorList issues={issues} codes={['NAME_REQUIRED', 'SLUG_REQUIRED', 'COMMERCIAL_IN_ATTRIBUTES']} />

      <div className="sp-grid">
        <Field label="نام محصول" required error={issueMessages(issues, ['NAME_REQUIRED'])[0] ?? null}>
          <input
            value={draft.name}
            onChange={event => dispatch({ type: 'patch', patch: { name: event.target.value } })}
            aria-required="true"
            maxLength={200}
          />
        </Field>

        <Field label="شناسهٔ یکتا (slug)" hint="برای نشانیِ عمومی؛ حروف لاتین و خطِ تیره" error={issueMessages(issues, ['SLUG_REQUIRED'])[0] ?? null}>
          <input
            value={draft.slug}
            onChange={event => dispatch({ type: 'patch', patch: { slug: event.target.value } })}
            className="ltr-inline"
            dir="ltr"
            maxLength={200}
          />
        </Field>

        <Field label="دستهٔ کانونیک" hint="از دسته‌بندیِ سرور؛ هیچ فهرستِ سخت‌کدشده‌ای نیست">
          <select value={draft.categoryId} onChange={event => dispatch({ type: 'patch', patch: { categoryId: event.target.value } })}>
            <option value="">انتخاب کنید</option>
            {flat.map(node => (
              <option key={node.id} value={node.id}>
                {'\u00A0\u00A0'.repeat(node.depth)}
                {node.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="برند" hint="فقط برندهای تأییدشدهٔ سرور">
          <select value={draft.brandId} onChange={event => dispatch({ type: 'patch', patch: { brandId: event.target.value } })}>
            <option value="">بدون برند</option>
            {brands.map(brand => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="توضیحات">
        <textarea value={draft.description ?? ''} onChange={event => dispatch({ type: 'patch', patch: { description: event.target.value } })} rows={4} />
      </Field>

      <div className="spe-attributes">
        <h3 className="spe-subtitle">ویژگی‌های محصول</h3>
        {selected ? (
          <p className="spe-hint">
            این ورودی‌ها از <code>attributes_schema</code> دستهٔ «{selected.name}» ساخته شده‌اند.
          </p>
        ) : (
          <p className="spe-hint">برای دیدنِ ویژگی‌های پیشنهادیِ هر دسته، ابتدا دسته را انتخاب کنید.</p>
        )}

        {specs.length > 0 ? (
          <div className="sp-grid">
            {specs.map(spec => (
              <Field key={spec.key} label={spec.label} required={spec.required} hint={`کلید: ${spec.key}`}>
                {spec.input === 'select' && spec.options ? (
                  <select
                    value={draft.attributes[spec.key] ?? ''}
                    onChange={event => dispatch({ type: 'setAttribute', key: spec.key, value: event.target.value })}
                  >
                    <option value="">انتخاب کنید</option>
                    {spec.options.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={spec.input === 'number' ? 'number' : 'text'}
                    value={draft.attributes[spec.key] ?? ''}
                    className={spec.input === 'number' ? 'ltr-inline' : undefined}
                    dir={spec.input === 'number' ? 'ltr' : undefined}
                    onChange={event => dispatch({ type: 'setAttribute', key: spec.key, value: event.target.value })}
                  />
                )}
              </Field>
            ))}
          </div>
        ) : null}

        {orphans.length > 0 ? (
          <Notice tone="warn" title="ویژگی‌هایی که در طرحِ این دسته نیستند">
            <p>
              با تغییرِ دسته، این مقادیر <b>حذف نشده‌اند</b>. اگر لازم نیستند خودتان پاکشان کنید.
            </p>
            <ul className="spe-error-list">
              {orphans.map(key => (
                <li key={key}>
                  <span className="ltr-inline">{key}</span>
                  <button type="button" className="button secondary spe-mini" onClick={() => dispatch({ type: 'removeAttribute', key })}>
                    <X size={13} />
                    حذف
                  </button>
                </li>
              ))}
            </ul>
          </Notice>
        ) : null}

        <CustomAttributeRow onAdd={(key, value) => dispatch({ type: 'setAttribute', key, value })} />

        {Object.keys(draft.attributes).length > 0 ? (
          <ul className="spe-chip-list" aria-label="ویژگی‌های ثبت‌شده">
            {Object.entries(draft.attributes).map(([key, value]) => (
              <li key={key} className="chip">
                <span className="ltr-inline">{key}</span>
                <b>{value || '—'}</b>
                <button type="button" aria-label={`حذفِ ویژگی ${key}`} onClick={() => dispatch({ type: 'removeAttribute', key })}>
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  )
}

function CustomAttributeRow({ onAdd }: { onAdd: (key: string, value: string) => void }) {
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const submit = () => {
    if (key.trim().length === 0) return
    onAdd(key.trim(), value)
    setKey('')
    setValue('')
  }
  return (
    <div className="spe-attr-add">
      <Field label="کلیدِ ویژگیِ دلخواه" hint="برای دامنه‌هایی که طرحِ دسته پوشش نمی‌دهد">
        <input value={key} onChange={event => setKey(event.target.value)} className="ltr-inline" dir="ltr" placeholder="material" />
      </Field>
      <Field label="مقدار">
        <input value={value} onChange={event => setValue(event.target.value)} placeholder="لینن" />
      </Field>
      <button type="button" className="button secondary" onClick={submit} disabled={key.trim().length === 0}>
        <Plus size={14} />
        افزودن
      </button>
    </div>
  )
}

/* ── ۲. رسانه ─────────────────────────────────────────────────────────────── */

export function MediaSection({
  draft,
  dispatch,
  issues,
  onUpload,
  uploading,
  uploadError,
}: {
  draft: DraftProduct
  dispatch: React.Dispatch<DraftAction>
  issues: DraftIssue[]
  onUpload: (file: File, rowId: string) => Promise<void>
  uploading: boolean
  uploadError: string | null
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  /**
   * ردیفِ هدفِ آپلود در یک **ref** نگه داشته می‌شود، نه state.
   *
   * پیش‌تر `pick` مقدار را با `setState` می‌گذاشت و بلافاصله `input.click()` را
   * صدا می‌زد. چون به‌روزرسانیِ state ناهم‌گام است، وقتی `onChange` اجرا می‌شد
   * هنوز `null` بود و شرطِ `if (!file || !targetRowId) return` **هر فایل را
   * بی‌صدا دور می‌ریخت** — یعنی مسیرِ اصلیِ بارگذاری هرگز کار نمی‌کرد. ref هم
   * در همان tick نوشته می‌شود و هم خوانده.
   */
  const pendingRowId = useRef<string | null>(null)
  const variantSkus = draft.variants.filter(v => v.include).map(v => v.sku).filter(Boolean)

  const pick = (rowId: string) => {
    pendingRowId.current = rowId
    fileRef.current?.click()
  }

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    const rowId = pendingRowId.current
    pendingRowId.current = null
    if (!file || !rowId) return
    await onUpload(file, rowId)
  }

  return (
    <section className="surface spe-section" aria-labelledby="spe-media">
      <h2 id="spe-media" className="spe-section-title">رسانه</h2>
      <SectionErrorList issues={issues} codes={['INVALID_MEDIA_URL', 'MEDIA_VARIANT_NOT_FOUND']} />

      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4" onChange={onFile} className="spe-visually-hidden" tabIndex={-1} aria-hidden="true" />

      <div className="spe-actions">
        <button
          type="button"
          className="button primary"
          disabled={uploading}
          onClick={() => {
            const rowId = newDraftRowId('med')
            // همان rowId که هدفِ آپلود است؛ وگرنه نشانیِ برگشتی گم می‌شود.
            dispatch({ type: 'addMedia', media: { rowId, url: '' } })
            // ردیفِ تازه آخرین است؛ همان را هدفِ آپلود قرار می‌دهیم.
            setTimeout(() => pick(rowId), 0)
          }}
        >
          <Upload size={15} />
          {uploading ? 'در حال بارگذاری…' : 'بارگذاریِ تصویر'}
        </button>
        <button type="button" className="button secondary" onClick={() => dispatch({ type: 'addMedia' })}>
          <Plus size={15} />
          افزودن با نشانی
        </button>
      </div>

      {uploadError ? <Notice tone="danger" title="بارگذاری ناموفق">{uploadError}</Notice> : null}

      <p className="spe-hint">
        فایل‌ها از راهِ سرور ذخیره می‌شوند؛ هیچ اعتبارنامه‌ای به مرورگر نمی‌رسد. ترتیبِ فهرست همان{' '}
        <code>position</code> کانونیک است.
      </p>

      {draft.media.length === 0 ? (
        <p className="spe-empty">هنوز رسانه‌ای اضافه نشده است.</p>
      ) : (
        <ul className="spe-media-list">
          {draft.media.map((item, index) => (
            <li key={item.rowId} className="spe-media-item">
              <div className="spe-media-thumb" aria-hidden="true">
                {item.url ? <img src={item.url} alt="" /> : <ImageIcon size={18} />}
              </div>
              <div className="spe-media-fields">
                <label className="spe-mini-label">
                  نشانی
                  <input
                    value={item.url}
                    dir="ltr"
                    className="ltr-inline"
                    onChange={event => dispatch({ type: 'patchMedia', rowId: item.rowId, patch: { url: event.target.value } })}
                  />
                </label>
                <label className="spe-mini-label">
                  وابسته به واریانت
                  <select
                    value={item.variantSku ?? ''}
                    onChange={event => dispatch({ type: 'patchMedia', rowId: item.rowId, patch: { variantSku: event.target.value || null } })}
                  >
                    <option value="">رسانهٔ سطحِ محصول</option>
                    {variantSkus.map(sku => (
                      <option key={sku} value={sku}>
                        {sku}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="spe-media-actions">
                <button type="button" className="button secondary spe-mini" onClick={() => pick(item.rowId)} disabled={uploading}>
                  <Upload size={13} />
                  جایگزینی
                </button>
                <button
                  type="button"
                  className="button secondary spe-mini"
                  aria-label="انتقال به بالا"
                  disabled={index === 0}
                  onClick={() => dispatch({ type: 'moveMedia', rowId: item.rowId, direction: -1 })}
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  className="button secondary spe-mini"
                  aria-label="انتقال به پایین"
                  disabled={index === draft.media.length - 1}
                  onClick={() => dispatch({ type: 'moveMedia', rowId: item.rowId, direction: 1 })}
                >
                  <ArrowDown size={13} />
                </button>
                <button type="button" className="button secondary spe-mini" aria-label="حذفِ رسانه" onClick={() => dispatch({ type: 'removeMedia', rowId: item.rowId })}>
                  <Trash2 size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ── ۳. واریانت‌ها ────────────────────────────────────────────────────────── */

export function VariantsSection({
  draft,
  dispatch,
  issues,
}: {
  draft: DraftProduct
  dispatch: React.Dispatch<DraftAction>
  issues: DraftIssue[]
}) {
  const [matrixRowKey, setMatrixRowKey] = useState('color')
  const [matrixColKey, setMatrixColKey] = useState('size')
  const [bulk, setBulk] = useState({ row: '', col: '', prefix: '' })

  const matrix = useMemo(() => buildVariantMatrix(draft.variants, matrixRowKey, matrixColKey), [draft.variants, matrixRowKey, matrixColKey])
  const hasMatrix = matrix.rows.length > 0 && matrix.columns.length > 0
  const duplicateMessages = issueMessages(issues, ['DUPLICATE_VARIANT_SKU'])
  const duplicateSkus = useMemo(() => {
    const seen = new Set<string>()
    const dupes = new Set<string>()
    for (const variant of draft.variants.filter(v => v.include)) {
      const sku = normalizeSku(variant.sku)
      if (!sku) continue
      if (seen.has(sku)) dupes.add(sku)
      seen.add(sku)
    }
    return dupes
  }, [draft.variants])

  /** افزودنِ صریحِ یک خانهٔ ماتریس؛ هرگز ترکیبِ پنهان ساخته نمی‌شود. */
  const addCell = (row: string, col: string) => {
    const sku = matrixCellSku(bulk.prefix || draft.commercial?.sku || 'VAR', row, col)
    dispatch({
      type: 'addVariant',
      variant: { sku, attributes: { [matrixRowKey]: row, [matrixColKey]: col }, onHand: null },
    })
  }

  return (
    <section className="surface spe-section" aria-labelledby="spe-variants">
      <h2 id="spe-variants" className="spe-section-title">واریانت‌ها</h2>
      <SectionErrorList issues={issues} codes={['DUPLICATE_VARIANT_SKU', 'VARIANT_SKU_REQUIRED']} />

      <div className="spe-actions">
        <button type="button" className="button primary" onClick={() => dispatch({ type: 'addVariant' })}>
          <Plus size={15} />
          افزودنِ واریانت
        </button>
        <span className="spe-hint">{draft.variants.filter(v => v.include).length.toLocaleString('fa-IR')} واریانتِ فعال</span>
      </div>

      {hasMatrix ? (
        <div className="spe-matrix-wrap">
          <div className="spe-matrix-controls">
            <label className="spe-mini-label">
              ردیف
              <select value={matrixRowKey} onChange={event => setMatrixRowKey(event.target.value)}>
                {/* کلیدِ فعلی همیشه در فهرست هست، وگرنه select خالی و بی‌اثر می‌شود. */}
                {[...new Set([matrixRowKey, ...draft.variants.flatMap(v => Object.keys(v.attributes))])].map(key => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </label>
            <label className="spe-mini-label">
              ستون
              <select value={matrixColKey} onChange={event => setMatrixColKey(event.target.value)}>
                {[...new Set([matrixColKey, ...draft.variants.flatMap(v => Object.keys(v.attributes))])].map(key => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </label>
            <label className="spe-mini-label">
              پیشوندِ SKU
              <input value={bulk.prefix} onChange={event => setBulk(current => ({ ...current, prefix: event.target.value }))} className="ltr-inline" dir="ltr" placeholder="LINEN" />
            </label>
          </div>

          <table className="sp-table spe-matrix">
            <caption className="spe-visually-hidden">ماتریسِ واریانت‌ها؛ برای افزودنِ هر ترکیب باید صریحاً آن را انتخاب کنید</caption>
            <thead>
              <tr>
                <th scope="col">{matrixRowKey}</th>
                {matrix.columns.map(col => (
                  <th key={col} scope="col">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row, rowIndex) => (
                <tr key={row}>
                  <th scope="row">{row}</th>
                  {matrix.columns.map((col, colIndex) => {
                    const cell = matrix.cells[rowIndex]![colIndex]!
                    const sku = matrixCellSku(bulk.prefix || draft.commercial?.sku || 'VAR', row, col)
                    return (
                      <td key={col}>
                        {cell.selected ? (
                          <button
                            type="button"
                            className="button secondary spe-mini spe-cell-on"
                            aria-pressed="true"
                            aria-label={`حذفِ ${row} / ${col}`}
                            onClick={() => cell.variant && dispatch({ type: 'removeVariant', rowId: cell.variant.rowId })}
                          >
                            ✓ {sku}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="button secondary spe-mini spe-cell-off"
                            aria-pressed="false"
                            aria-label={`افزودنِ ${row} / ${col}`}
                            onClick={() => addCell(row, col)}
                          >
                            + {col}
                          </button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="spe-hint">
            ماتریس فقط واریانت‌های موجود را نشان می‌دهد؛ هیچ ترکیبی خودکار ساخته نمی‌شود. محصولاتِ غیرِ
            رنگ×سایز را می‌توانید دستی اضافه کنید.
          </p>
        </div>
      ) : null}

      {/*
        افزودنِ خانهٔ تازه همیشه در دسترس می‌ماند. پیش‌تر این بخش
        `hasMatrix ? table : adder` بود، یعنی با اولین واریانت، ابزارِ افزودن
        ناپدید می‌شد و کاربر تنها می‌توانست **یک** خانه بسازد.
      */}
      <NewMatrixRow bulk={bulk} setBulk={setBulk} onAdd={addCell} />

      <VariantList draft={draft} dispatch={dispatch} duplicateSkus={duplicateSkus} issues={issues} />
      {duplicateMessages.length > 0 ? <Notice tone="danger" title="SKU تکراری">{duplicateMessages.join('، ')}</Notice> : null}
    </section>
  )
}

function NewMatrixRow({
  bulk,
  setBulk,
  onAdd,
}: {
  bulk: { row: string; col: string; prefix: string }
  setBulk: React.Dispatch<React.SetStateAction<{ row: string; col: string; prefix: string }>>
  onAdd: (row: string, col: string) => void
}) {
  const [rows, setRows] = useState('')
  const [cols, setCols] = useState('')
  const rowValues = rows.split(',').map(value => value.trim()).filter(Boolean)
  const colValues = cols.split(',').map(value => value.trim()).filter(Boolean)

  return (
    <div className="spe-bulk">
      <p className="spe-hint">
        برای شروعِ ماتریس، مقادیرِ ردیف و ستون را با ویرگول وارد کنید (مثلاً <span className="ltr-inline">Black, Cream</span> و{' '}
        <span className="ltr-inline">S, M, L</span>). سپس <b>هر خانه را خودتان انتخاب می‌کنید</b>.
      </p>
      <div className="sp-grid">
        <Field label="پیشوندِ SKU" hint="بخشِ لاتینِ SKU">
          <input value={bulk.prefix} onChange={event => setBulk(current => ({ ...current, prefix: event.target.value }))} className="ltr-inline" dir="ltr" placeholder="LINEN" />
        </Field>
        <Field label="مقادیرِ ردیف (با ویرگول)">
          <input value={rows} onChange={event => setRows(event.target.value)} placeholder="Black, Cream" />
        </Field>
        <Field label="مقادیرِ ستون (با ویرگول)">
          <input value={cols} onChange={event => setCols(event.target.value)} placeholder="S, M, L" />
        </Field>
      </div>
      {rowValues.length > 0 && colValues.length > 0 ? (
        <div className="spe-bulk-grid">
          {rowValues.map(row => (
            <div key={row} className="spe-bulk-row">
              <b>{row}</b>
              {colValues.map(col => (
                <button key={col} type="button" className="button secondary spe-mini" onClick={() => onAdd(row, col)}>
                  + {col}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function VariantList({
  draft,
  dispatch,
  duplicateSkus,
  issues,
}: {
  draft: DraftProduct
  dispatch: React.Dispatch<DraftAction>
  duplicateSkus: Set<string>
  issues: DraftIssue[]
}) {
  if (draft.variants.length === 0) return <p className="spe-empty">هنوز واریانتی اضافه نشده است.</p>

  const attributeKeys = [...new Set(draft.variants.flatMap(variant => Object.keys(variant.attributes)))]

  return (
    <div className="spe-variant-list">
      {draft.variants.map((variant, index) => {
        const sku = normalizeSku(variant.sku)
        const isDuplicate = sku.length > 0 && duplicateSkus.has(sku)
        return (
          <article key={variant.rowId} className={`spe-variant-card${variant.include ? '' : ' spe-off'}`}>
            <header className="spe-variant-head">
              <label className="spe-toggle">
                <input
                  type="checkbox"
                  checked={variant.include}
                  onChange={event => dispatch({ type: 'patchVariant', rowId: variant.rowId, patch: { include: event.target.checked } })}
                />
                فعال
              </label>
              <span className="spe-variant-index">{(index + 1).toLocaleString('fa-IR')}</span>
              <button type="button" className="button secondary spe-mini" aria-label="حذفِ واریانت" onClick={() => dispatch({ type: 'removeVariant', rowId: variant.rowId })}>
                <Trash2 size={13} />
              </button>
            </header>

            <Field
              label="SKU"
              required
              error={isDuplicate ? 'این SKU تکراری است' : issueMessages(issues, ['VARIANT_SKU_REQUIRED']).length > 0 && !sku ? 'SKU الزامی است' : null}
            >
              <input
                value={variant.sku}
                dir="ltr"
                className="ltr-inline"
                aria-invalid={isDuplicate || undefined}
                onChange={event => dispatch({ type: 'renameVariantSku', rowId: variant.rowId, sku: event.target.value })}
              />
            </Field>

            <div className="sp-grid">
              {attributeKeys.map(key => (
                <Field key={key} label={key}>
                  <input
                    value={variant.attributes[key] ?? ''}
                    onChange={event =>
                      dispatch({
                        type: 'patchVariant',
                        rowId: variant.rowId,
                        patch: { attributes: { ...variant.attributes, [key]: event.target.value } },
                      })
                    }
                  />
                </Field>
              ))}
              <NewVariantAttribute variant={variant} dispatch={dispatch} />
              <Field label="وضعیت">
                <select
                  value={variant.status ?? 'active'}
                  onChange={event => dispatch({ type: 'patchVariant', rowId: variant.rowId, patch: { status: event.target.value as DraftVariant['status'] } })}
                >
                  <option value="active">فعال</option>
                  <option value="draft">پیش‌نویس</option>
                  <option value="archived">بایگانی</option>
                </select>
              </Field>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function NewVariantAttribute({ variant, dispatch }: { variant: DraftVariant; dispatch: React.Dispatch<DraftAction> }) {
  const [key, setKey] = useState('')
  return (
    <Field label="ویژگیِ تازه" hint="کلیدِ دلخواه، مثلاً material">
      <div className="spe-inline-add">
        <input value={key} onChange={event => setKey(event.target.value)} className="ltr-inline" dir="ltr" placeholder="material" />
        <button
          type="button"
          className="button secondary spe-mini"
          disabled={key.trim().length === 0}
          onClick={() => {
            dispatch({ type: 'patchVariant', rowId: variant.rowId, patch: { attributes: { ...variant.attributes, [key.trim()]: '' } } })
            setKey('')
          }}
        >
          <Plus size={13} />
        </button>
      </div>
    </Field>
  )
}

/* ── ۴. موجودی ────────────────────────────────────────────────────────────── */

export function InventorySection({ draft, dispatch, issues }: { draft: DraftProduct; dispatch: React.Dispatch<DraftAction>; issues: DraftIssue[] }) {
  const active = draft.variants.filter(variant => variant.include)
  return (
    <section className="surface spe-section" aria-labelledby="spe-inventory">
      <h2 id="spe-inventory" className="spe-section-title">موجودیِ پیشنهادی</h2>
      <SectionErrorList issues={issues} codes={['INVALID_INVENTORY_ON_HAND']} />
      <p className="spe-hint">
        خالی‌گذاشتن یعنی «اعلام نشده» و با «صفرِ صریح» فرق دارد؛ اگر عددی وارد نکنید، ردیفِ موجودی ساخته
        نمی‌شود. مرجعِ نهایی سرور است.
      </p>
      {active.length === 0 ? (
        <p className="spe-empty">ابتدا واریانت اضافه کنید.</p>
      ) : (
        <table className="sp-table">
          <caption className="spe-visually-hidden">موجودیِ پیشنهادی به تفکیکِ واریانت</caption>
          <thead>
            <tr>
              <th scope="col">واریانت</th>
              <th scope="col">ویژگی‌ها</th>
              <th scope="col">موجودی</th>
            </tr>
          </thead>
          <tbody>
            {active.map(variant => {
              const invalid = variant.onHand != null && (!Number.isInteger(variant.onHand) || variant.onHand < 0)
              return (
                <tr key={variant.rowId}>
                  <th scope="row" className="ltr-inline">
                    {variant.sku || '—'}
                  </th>
                  <td>
                    {Object.entries(variant.attributes)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(' · ') || '—'}
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      dir="ltr"
                      className="ltr-inline spe-narrow"
                      aria-label={`موجودیِ ${variant.sku}`}
                      aria-invalid={invalid || undefined}
                      value={variant.onHand ?? ''}
                      placeholder="اعلام نشده"
                      onChange={event =>
                        dispatch({
                          type: 'patchVariant',
                          rowId: variant.rowId,
                          patch: { onHand: event.target.value === '' ? null : Math.trunc(Number(event.target.value)) },
                        })
                      }
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}

/* ── ۵. پیشنهادِ تجاری و MOQ ──────────────────────────────────────────────── */

export function CommercialSection({
  draft,
  dispatch,
  issues,
}: {
  draft: DraftProduct
  dispatch: React.Dispatch<DraftAction>
  issues: DraftIssue[]
}) {
  const commercial = draft.commercial
  const codes: DraftIssue['code'][] = ['INVALID_WHOLESALE_PRICE', 'INVALID_RETAIL_PRICE', 'INVALID_MOQ', 'INVALID_MOQ_UNIT', 'INVALID_PACKAGE_TYPE']
  const variantSkus = draft.variants.filter(v => v.include).map(v => v.sku).filter(Boolean)

  return (
    <section className="surface spe-section" aria-labelledby="spe-commercial">
      <h2 id="spe-commercial" className="spe-section-title">پیشنهادِ تجاری و MOQ</h2>
      <SectionErrorList issues={issues} codes={codes} />
      <p className="spe-hint">
        پول همیشه <b>رشتهٔ ده‌دهی</b> است و هرگز در مرورگر محاسبه نمی‌شود. واحدِ MOQ دقیقاً همان مقدارِ
        کانونیک است که تأیید می‌شود.
      </p>
      <div className="sp-grid">
        <Field label="SKU تجاری" required hint="شناسهٔ سطحِ پیشنهاد">
          <input
            value={commercial?.sku ?? ''}
            dir="ltr"
            className="ltr-inline"
            onChange={event => dispatch({ type: 'patchCommercial', patch: { sku: event.target.value } })}
          />
        </Field>
        <Field label="قیمت عمده" required hint="فقط رقم؛ به‌صورت رشته ارسال می‌شود">
          <input
            value={commercial?.wholesalePrice ?? ''}
            inputMode="numeric"
            dir="ltr"
            className="ltr-inline"
            aria-invalid={issueMessages(issues, ['INVALID_WHOLESALE_PRICE']).length > 0 || undefined}
            onChange={event => dispatch({ type: 'patchCommercial', patch: { wholesalePrice: event.target.value } })}
          />
        </Field>
        <Field label="قیمت خرده" hint="اختیاری">
          <input
            value={commercial?.retailPrice ?? ''}
            inputMode="numeric"
            dir="ltr"
            className="ltr-inline"
            onChange={event => dispatch({ type: 'patchCommercial', patch: { retailPrice: event.target.value } })}
          />
        </Field>
        <Field label="واحدِ پول">
          <input value={commercial?.currency ?? ''} dir="ltr" className="ltr-inline" onChange={event => dispatch({ type: 'patchCommercial', patch: { currency: event.target.value } })} />
        </Field>
        <Field label="حداقل تعداد سفارش (MOQ)" required>
          <input
            type="number"
            min={1}
            step={1}
            dir="ltr"
            className="ltr-inline"
            value={commercial?.moq ?? 1}
            onChange={event => dispatch({ type: 'patchCommercial', patch: { moq: Math.trunc(Number(event.target.value)) } })}
          />
        </Field>
        <Field label="واحدِ MOQ" required hint="مقادیرِ کانونیکِ سرور">
          <select
            value={commercial?.moqUnit ?? 'PIECE'}
            onChange={event => dispatch({ type: 'patchCommercial', patch: { moqUnit: event.target.value as (typeof MOQ_UNITS)[number] } })}
          >
            {MOQ_UNITS.map(unit => (
              <option key={unit} value={unit}>
                {MOQ_UNIT_LABELS_FA[unit]} ({unit})
              </option>
            ))}
          </select>
        </Field>
        <Field label="نوعِ بسته" hint="اختیاری در این بخش؛ ترکیب در بخشِ سری ساخته می‌شود">
          <select
            value={commercial?.packageType ?? ''}
            onChange={event => dispatch({ type: 'patchCommercial', patch: { packageType: (event.target.value || undefined) as PackageType | undefined } })}
          >
            <option value="">بدون نوعِ بسته</option>
            {PACKAGE_TYPES.map(type => (
              <option key={type} value={type}>
                {PACKAGE_TYPE_LABELS_FA[type]} ({type})
              </option>
            ))}
          </select>
        </Field>
        <Field label="مقید به واریانت" hint="اختیاری؛ پیش‌فرض همان SKU تجاری">
          <select
            value={commercial?.variantSku ?? ''}
            onChange={event => dispatch({ type: 'patchCommercial', patch: { variantSku: event.target.value || null } })}
          >
            <option value="">پیش‌فرض</option>
            {variantSkus.map(sku => (
              <option key={sku} value={sku}>
                {sku}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {commercial?.moqUnit === 'SERIES' && (draft.packages ?? []).length === 0 ? (
        <Notice tone="warn" title="واحدِ MOQ «سری» است">
          برای اینکه «سری» معنای درستی داشته باشد، در بخشِ سری/بسته حداقل یک بستهٔ معتبر تعریف کنید.
          اعتبارسنجیِ نهایی با سرور است.
        </Notice>
      ) : null}
    </section>
  )
}

/* ── ۶. سری / بسته‌ها ─────────────────────────────────────────────────────── */

export function PackagesSection({
  draft,
  dispatch,
  issues,
  broken,
}: {
  draft: DraftProduct
  dispatch: React.Dispatch<DraftAction>
  issues: DraftIssue[]
  broken: VariantDependencyWarning[]
}) {
  const codes: DraftIssue['code'][] = [
    'INVALID_PACKAGE_NAME',
    'INVALID_PACKAGE_VARIANT',
    'INVALID_PACKAGE_QUANTITY',
    'SIZE_RUN_NEEDS_MULTIPLE_SIZES',
    'FIXED_QUANTITY_SINGLE_VARIANT',
  ]
  const activeVariants = draft.variants.filter(variant => variant.include && variant.sku.trim().length > 0)

  return (
    <section className="surface spe-section" aria-labelledby="spe-packages">
      <h2 id="spe-packages" className="spe-section-title">سری / بسته‌ها</h2>
      <SectionErrorList issues={issues} codes={codes} />
      {broken.length > 0 ? (
        <Notice tone="danger" title="ارجاعِ شکستهٔ بسته">
          <ul className="spe-error-list">
            {broken.map(item => (
              <li key={item.sku}>
                <span className="ltr-inline">{item.sku}</span> — در بستهٔ {item.packages.join('، ') || '—'} ارجاع شده ولی واریانتِ فعال نیست.
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <div className="spe-actions">
        <button type="button" className="button primary" onClick={() => dispatch({ type: 'addPackage' })}>
          <Plus size={15} />
          افزودنِ بسته
        </button>
        <span className="spe-hint">مجموعِ قطعات در UI فقط <b>پیش‌نمایش</b> است؛ مرجعِ معتبر سرور است.</span>
      </div>

      {draft.packages.length === 0 ? (
        <p className="spe-empty">بسته‌ای تعریف نشده است.</p>
      ) : (
        draft.packages.map(pkg => {
          const total = previewPackageTotalPieces(pkg.items)
          return (
            <article key={pkg.rowId} className="spe-package">
              <header className="spe-variant-head">
                <label className="spe-toggle">
                  <input type="checkbox" checked={pkg.include} onChange={event => dispatch({ type: 'patchPackage', rowId: pkg.rowId, patch: { include: event.target.checked } })} />
                  فعال
                </label>
                <span className="spe-package-total" aria-live="polite">
                  مجموع: {total.toLocaleString('fa-IR')} قطعه
                </span>
                <button type="button" className="button secondary spe-mini" aria-label="حذفِ بسته" onClick={() => dispatch({ type: 'removePackage', rowId: pkg.rowId })}>
                  <Trash2 size={13} />
                </button>
              </header>

              <div className="sp-grid">
                <Field label="نامِ بسته" required>
                  <input value={pkg.name} onChange={event => dispatch({ type: 'patchPackage', rowId: pkg.rowId, patch: { name: event.target.value } })} placeholder="سری سایزبندی S تا L" />
                </Field>
                <Field label="نوعِ بسته" required>
                  <select
                    value={pkg.packageType}
                    onChange={event => dispatch({ type: 'patchPackage', rowId: pkg.rowId, patch: { packageType: event.target.value as PackageType } })}
                  >
                    {PACKAGE_TYPES.map(type => (
                      <option key={type} value={type}>
                        {PACKAGE_TYPE_LABELS_FA[type]} ({type})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="توضیحِ بسته">
                  <input value={pkg.description ?? ''} onChange={event => dispatch({ type: 'patchPackage', rowId: pkg.rowId, patch: { description: event.target.value } })} />
                </Field>
              </div>

              {pkg.packageType === 'COLOR_MIX' ? (
                <p className="spe-hint">
                  برای «ترکیبِ رنگ»، رنگ از <b>ویژگیِ واریانت</b> خوانده می‌شود، نه از تجزیهٔ SKU.
                </p>
              ) : null}

              <table className="sp-table">
                <caption className="spe-visually-hidden">ترکیبِ بستهٔ {pkg.name || 'بدونِ نام'}</caption>
                <thead>
                  <tr>
                    <th scope="col">واریانت</th>
                    {pkg.packageType === 'COLOR_MIX' ? <th scope="col">رنگ</th> : null}
                    {pkg.packageType === 'SIZE_RUN' ? <th scope="col">سایز</th> : null}
                    <th scope="col">تعداد</th>
                    <th scope="col">حذف</th>
                  </tr>
                </thead>
                <tbody>
                  {pkg.items.map(item => {
                    const source = activeVariants.find(variant => normalizeSku(variant.sku) === normalizeSku(item.sku))
                    return (
                      <tr key={item.sku}>
                        <th scope="row" className="ltr-inline">
                          {item.sku}
                        </th>
                        {pkg.packageType === 'COLOR_MIX' ? <td>{source?.attributes.color ?? '—'}</td> : null}
                        {pkg.packageType === 'SIZE_RUN' ? <td>{source?.attributes.size ?? '—'}</td> : null}
                        <td>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            dir="ltr"
                            className="ltr-inline spe-narrow"
                            aria-label={`تعدادِ ${item.sku} در بسته`}
                            value={item.quantity}
                            onChange={event => dispatch({ type: 'setPackageItem', rowId: pkg.rowId, sku: item.sku, quantity: Math.trunc(Number(event.target.value)) })}
                          />
                        </td>
                        <td>
                          <button type="button" className="button secondary spe-mini" aria-label={`حذفِ ${item.sku} از بسته`} onClick={() => dispatch({ type: 'removePackageItem', rowId: pkg.rowId, sku: item.sku })}>
                            <X size={13} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {pkg.items.length === 0 ? (
                    <tr>
                      <td colSpan={pkg.packageType === 'SIZE_RUN' || pkg.packageType === 'COLOR_MIX' ? 4 : 3} className="spe-empty">
                        قلمی انتخاب نشده است.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>

              <Field label="افزودنِ واریانت به بسته" hint="فقط واریانت‌های همین محصول">
                <select
                  value=""
                  onChange={event => {
                    if (!event.target.value) return
                    dispatch({ type: 'setPackageItem', rowId: pkg.rowId, sku: event.target.value, quantity: 1 })
                  }}
                >
                  <option value="">انتخاب کنید</option>
                  {activeVariants.map(variant => (
                    <option key={variant.rowId} value={variant.sku}>
                      {variant.sku}
                      {Object.values(variant.attributes).length > 0 ? ` — ${Object.values(variant.attributes).join(' / ')}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            </article>
          )
        })
      )}
    </section>
  )
}

/* ── ۷. پله‌های قیمت ──────────────────────────────────────────────────────── */

export function PricingTiersSection({ draft, dispatch, issues }: { draft: DraftProduct; dispatch: React.Dispatch<DraftAction>; issues: DraftIssue[] }) {
  const codes: DraftIssue['code'][] = ['INVALID_PRICING_RANGE', 'INVALID_TIER_PRICE', 'OVERLAPPING_PRICING_TIER', 'INVALID_MOQ_UNIT']
  return (
    <section className="surface spe-section" aria-labelledby="spe-tiers">
      <h2 id="spe-tiers" className="spe-section-title">پله‌های قیمت</h2>
      <SectionErrorList issues={issues} codes={codes} />
      <p className="spe-hint">
        پلهٔ آخر می‌تواند بدونِ سقف بماند (مثلاً «۵۰ به بالا»). قیمت‌ها رشتهٔ ده‌دهی‌اند.
      </p>
      <div className="spe-actions">
        <button type="button" className="button primary" onClick={() => dispatch({ type: 'addTier' })}>
          <Plus size={15} />
          افزودنِ پله
        </button>
      </div>
      {draft.pricingTiers.length === 0 ? (
        <p className="spe-empty">پله‌ای تعریف نشده است.</p>
      ) : (
        <table className="sp-table">
          <caption className="spe-visually-hidden">پله‌های قیمت‌گذاری</caption>
          <thead>
            <tr>
              <th scope="col">از</th>
              <th scope="col">تا</th>
              <th scope="col">قیمتِ واحد</th>
              <th scope="col">واحد</th>
              <th scope="col">حذف</th>
            </tr>
          </thead>
          <tbody>
            {draft.pricingTiers.map(tier => (
              <tr key={tier.rowId}>
                <td>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    dir="ltr"
                    className="ltr-inline spe-narrow"
                    aria-label="حداقلِ تعداد"
                    value={tier.minQuantity}
                    onChange={event => dispatch({ type: 'patchTier', rowId: tier.rowId, patch: { minQuantity: Math.trunc(Number(event.target.value)) } })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    dir="ltr"
                    className="ltr-inline spe-narrow"
                    aria-label="حداکثرِ تعداد؛ خالی یعنی بدونِ سقف"
                    placeholder="بدونِ سقف"
                    value={tier.maxQuantity ?? ''}
                    onChange={event =>
                      dispatch({ type: 'patchTier', rowId: tier.rowId, patch: { maxQuantity: event.target.value === '' ? null : Math.trunc(Number(event.target.value)) } })
                    }
                  />
                </td>
                <td>
                  <input
                    inputMode="numeric"
                    dir="ltr"
                    className="ltr-inline spe-narrow"
                    aria-label="قیمتِ واحد"
                    value={tier.unitPrice}
                    onChange={event => dispatch({ type: 'patchTier', rowId: tier.rowId, patch: { unitPrice: event.target.value } })}
                  />
                </td>
                <td>
                  <select
                    value={tier.moqUnit ?? draft.commercial?.moqUnit ?? 'PIECE'}
                    aria-label="واحدِ پله"
                    onChange={event => dispatch({ type: 'patchTier', rowId: tier.rowId, patch: { moqUnit: event.target.value as (typeof MOQ_UNITS)[number] } })}
                  >
                    {MOQ_UNITS.map(unit => (
                      <option key={unit} value={unit}>
                        {MOQ_UNIT_LABELS_FA[unit]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button type="button" className="button secondary spe-mini" aria-label="حذفِ پله" onClick={() => dispatch({ type: 'removeTier', rowId: tier.rowId })}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/* ── ۸. بازبینی ───────────────────────────────────────────────────────────── */

export function ReviewSection({
  staged,
  issues,
  broken,
  categoryName,
  brandName,
}: {
  staged: ReturnType<typeof import('@shared/supplier/product-graph').buildStagedProduct>
  issues: DraftIssue[]
  broken: VariantDependencyWarning[]
  categoryName: string
  brandName: string
}) {
  const commercial = staged.commercial
  return (
    <section className="surface spe-section" aria-labelledby="spe-review">
      <h2 id="spe-review" className="spe-section-title">بازبینیِ نهایی</h2>
      <Notice tone="info" title="این دقیقاً همان چیزی است که ارسال می‌شود">
        این صفحه از همان خروجیِ <code>buildStagedProduct(draft)</code> ساخته می‌شود که بدنهٔ درخواست است؛
        هیچ تبدیلِ پنهانی در کار نیست.
      </Notice>

      {issues.length > 0 ? (
        <Notice tone="danger" title={`${issues.length.toLocaleString('fa-IR')} مورد نیازمند اصلاح`}>
          <ul className="spe-error-list">
            {issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>
                <b>{issue.code}</b> — {issue.message}
              </li>
            ))}
          </ul>
        </Notice>
      ) : (
        <Notice tone="success" title="اعتبارسنجیِ محلی پاک است">
          اعتبارسنجیِ نهایی همچنان با سرور است.
        </Notice>
      )}
      {broken.length > 0 ? <Notice tone="danger" title="ارجاعِ شکستهٔ واریانت">{broken.map(item => item.sku).join('، ')}</Notice> : null}

      <dl className="spe-review-grid">
        <dt>نام</dt>
        <dd>{staged.name || '—'}</dd>
        <dt>شناسهٔ یکتا</dt>
        <dd className="ltr-inline">{staged.slug || '—'}</dd>
        <dt>دسته</dt>
        <dd>{categoryName || '—'}</dd>
        <dt>برند</dt>
        <dd>{brandName || '—'}</dd>
        <dt>توضیحات</dt>
        <dd>{staged.description || '—'}</dd>
        <dt>ویژگی‌های محصول</dt>
        <dd>
          {staged.attributes && Object.keys(staged.attributes).length > 0 ? (
            <ul className="spe-chip-list">
              {Object.entries(staged.attributes).map(([key, value]) => (
                <li key={key} className="chip">
                  <span className="ltr-inline">{key}</span> <b>{String(value)}</b>
                </li>
              ))}
            </ul>
          ) : (
            '—'
          )}
        </dd>
        <dt>رسانه</dt>
        <dd>
          {staged.media.length === 0
            ? '—'
            : staged.media.map(item => (
                <div key={`${item.url}-${item.variantSku ?? 'p'}`} className="spe-review-media">
                  <img src={item.url} alt="" />
                  <span className="ltr-inline">{item.url}</span>
                  {item.variantSku ? <span className="chip">واریانت: {item.variantSku}</span> : <span className="chip">سطحِ محصول</span>}
                </div>
              ))}
        </dd>
        <dt>واریانت‌ها</dt>
        <dd>
          {staged.variants.length === 0 ? (
            '—'
          ) : (
            <table className="sp-table">
              <thead>
                <tr>
                  <th scope="col">SKU</th>
                  <th scope="col">ویژگی‌ها</th>
                  <th scope="col">وضعیت</th>
                  <th scope="col">موجودی</th>
                  <th scope="col">رسانه</th>
                </tr>
              </thead>
              <tbody>
                {staged.variants.map(variant => (
                  <tr key={variant.sku}>
                    <th scope="row" className="ltr-inline">
                      {variant.sku}
                    </th>
                    <td>
                      {Object.entries(variant.attributes)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(' · ') || '—'}
                    </td>
                    <td>{variant.status ?? 'active'}</td>
                    <td>{variant.inventory ? variant.inventory.onHand.toLocaleString('fa-IR') : 'اعلام نشده'}</td>
                    <td>{variant.media?.length ? variant.media.length.toLocaleString('fa-IR') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </dd>
        <dt>پیشنهادِ تجاری</dt>
        <dd>
          {commercial ? (
            <>
              <span className="chip">
                قیمتِ عمده: <b className="ltr-inline">{commercial.wholesalePrice}</b>
              </span>{' '}
              <span className="chip">
                قیمتِ خرده: <b className="ltr-inline">{commercial.retailPrice ?? '—'}</b>
              </span>{' '}
              <span className="chip">واحدِ پول: {commercial.currency ?? 'IRR'}</span>{' '}
              <span className="chip">
                MOQ: <b>{commercial.moq.toLocaleString('fa-IR')}</b> {MOQ_UNIT_LABELS_FA[commercial.moqUnit]}
              </span>{' '}
              <span className="chip">{commercial.packageType ? PACKAGE_TYPE_LABELS_FA[commercial.packageType] : 'بدونِ نوعِ بسته'}</span>
            </>
          ) : (
            '—'
          )}
        </dd>
        <dt>بسته‌ها / سری‌ها</dt>
        <dd>
          {commercial?.packages?.length ? (
            commercial.packages.map(pkg => (
              <div key={pkg.name} className="spe-review-package">
                <b>{pkg.name}</b> — {PACKAGE_TYPE_LABELS_FA[pkg.packageType]}
                <ul>
                  {pkg.items.map(item => (
                    <li key={item.sku}>
                      <span className="ltr-inline">{item.sku}</span> × {item.quantity.toLocaleString('fa-IR')}
                    </li>
                  ))}
                </ul>
                <span className="chip">مجموع: {previewPackageTotalPieces(pkg.items).toLocaleString('fa-IR')} قطعه (پیش‌نمایش)</span>
              </div>
            ))
          ) : (
            '—'
          )}
        </dd>
        <dt>پله‌های قیمت</dt>
        <dd>
          {commercial?.pricingTiers?.length ? (
            <ul className="spe-tier-list">
              {commercial.pricingTiers.map(tier => (
                <li key={`${tier.minQuantity}-${tier.maxQuantity ?? 'open'}`}>
                  <span className="ltr-inline">
                    {tier.minQuantity}–{tier.maxQuantity ?? '∞'}
                  </span>{' '}
                  {tier.moqUnit ? MOQ_UNIT_LABELS_FA[tier.moqUnit] : ''} → <b className="ltr-inline">{tier.unitPrice}</b>
                </li>
              ))}
            </ul>
          ) : (
            '—'
          )}
        </dd>
      </dl>
    </section>
  )
}

/* ── خلاصهٔ کناری ─────────────────────────────────────────────────────────── */

export function SummaryRail({
  draft,
  issues,
  broken,
  activeStep,
  steps,
  onGo,
}: {
  draft: DraftProduct
  issues: DraftIssue[]
  broken: VariantDependencyWarning[]
  activeStep: string
  steps: Array<{ id: string; label: string }>
  onGo: (id: string) => void
}) {
  const commercial = draft.commercial
  const activeVariants = draft.variants.filter(variant => variant.include)
  return (
    <aside className="surface spe-rail" aria-label="خلاصهٔ پیشنهاد">
      <nav aria-label="بخش‌های ویرایشگر">
        <ol className="spe-steps">
          {steps.map((step, index) => (
            <li key={step.id}>
              <button type="button" className={step.id === activeStep ? 'spe-step is-active' : 'spe-step'} aria-current={step.id === activeStep ? 'step' : undefined} onClick={() => onGo(step.id)}>
                <span aria-hidden="true">{(index + 1).toLocaleString('fa-IR')}</span>
                {step.label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <dl className="spe-summary">
        <dt>نام</dt>
        <dd>{draft.name.trim() || '—'}</dd>
        <dt>واریانت</dt>
        <dd>{activeVariants.length.toLocaleString('fa-IR')}</dd>
        <dt>رسانه</dt>
        <dd>{draft.media.filter(item => item.include && item.url).length.toLocaleString('fa-IR')}</dd>
        <dt>قیمتِ عمده</dt>
        <dd className="ltr-inline">{commercial?.wholesalePrice || '—'}</dd>
        <dt>MOQ</dt>
        <dd>
          {commercial ? `${commercial.moq.toLocaleString('fa-IR')} ${MOQ_UNIT_LABELS_FA[commercial.moqUnit]}` : '—'}
        </dd>
        <dt>بسته</dt>
        <dd>{draft.packages.filter(pkg => pkg.include).length.toLocaleString('fa-IR')}</dd>
        <dt>پلهٔ قیمت</dt>
        <dd>{draft.pricingTiers.filter(tier => tier.include).length.toLocaleString('fa-IR')}</dd>
      </dl>

      {issues.length > 0 || broken.length > 0 ? (
        <p className="spe-rail-alert" role="status">
          <AlertTriangle size={15} aria-hidden="true" />
          {(issues.length + broken.length).toLocaleString('fa-IR')} مورد نیازمند اصلاح
        </p>
      ) : (
        <p className="spe-rail-ok" role="status">
          آمادهٔ بازبینی
        </p>
      )}
    </aside>
  )
}
