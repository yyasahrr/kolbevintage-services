'use client'

/**
 * مدلِ پیش‌نویسِ ویرایشگرِ محصول — **تنها** منبعِ حقیقتِ ویرایش.
 *
 * سه قاعدهٔ حاکم:
 *
 *  ۱) همهٔ بخش‌ها همین یک draft را ویرایش می‌کنند؛ هیچ بخش stateِ جداگانهٔ
 *     تجاریِ خودش را نگه نمی‌دارد.
 *  ۲) تنها تبدیلِ مجاز، `buildStagedProduct(draft)` است. صفحهٔ بازبینی،
 *     اعتبارسنجی و بدنهٔ درخواست هر سه از همان خروجی می‌آیند؛ پس «چیزی که
 *     کاربر می‌بیند = چیزی که ارسال می‌شود».
 *  ۳) تغییرِ SKU یک واریانت، ارجاع‌های وابسته (رسانهٔ واریانت و اقلامِ بسته) را
 *     در همان تراکنشِ ویرایش به‌روز می‌کند — نه بعداً، نه بی‌صدا.
 *
 * نگهداریِ محلیِ پیش‌نویس مجاز است اما **فقط** پیش‌نویسِ ویرایش‌نشده: هرگز
 * وضعیتِ ارسال/تأیید/انتشار، قیمتِ کانونیک یا موجودیِ کانونیک از localStorage
 * خوانده نمی‌شود.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { MoqUnit, PackageType } from '@shared/supplier/contracts'
import { buildStagedProduct, validateDraftProduct, type DraftIssue, type DraftProduct, type DraftVariant } from '@shared/supplier/product-graph'

export const DRAFT_STORAGE_KEY = 'supplier-product-editor-draft:v1'

let draftRowCounter = 0;
export function newDraftRowId(prefix: string): string {
  draftRowCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${draftRowCounter}`
}

export function emptyDraft(): DraftProduct {
  return {
    name: '',
    slug: '',
    description: '',
    categoryId: '',
    brandId: '',
    proposedBrandId: '',
    attributes: {},
    variants: [],
    media: [],
    commercial: {
      sku: '',
      wholesalePrice: '',
      retailPrice: '',
      currency: 'IRR',
      moq: 1,
      moqUnit: 'PIECE',
      packageType: undefined,
      variantSku: null,
    },
    packages: [],
    pricingTiers: [],
  }
}

/* ── اکشن‌ها ─────────────────────────────────────────────────────────────── */

export type DraftAction =
  | { type: 'patch'; patch: Partial<DraftProduct> }
  | { type: 'setAttribute'; key: string; value: string }
  | { type: 'renameAttribute'; from: string; to: string }
  | { type: 'removeAttribute'; key: string }
  | { type: 'patchCommercial'; patch: Partial<NonNullable<DraftProduct['commercial']>> }
  | { type: 'addVariant'; variant?: Partial<DraftVariant> }
  | { type: 'patchVariant'; rowId: string; patch: Partial<DraftVariant> }
  /** تغییرِ SKU + به‌روزرسانیِ همهٔ ارجاع‌های وابسته در یک گام. */
  | { type: 'renameVariantSku'; rowId: string; sku: string }
  | { type: 'removeVariant'; rowId: string }
  | { type: 'addMedia'; media?: { url?: string; variantSku?: string | null } }
  | { type: 'patchMedia'; rowId: string; patch: { url?: string; variantSku?: string | null; include?: boolean } }
  | { type: 'removeMedia'; rowId: string }
  | { type: 'moveMedia'; rowId: string; direction: -1 | 1 }
  | { type: 'addPackage'; packageType?: PackageType }
  | { type: 'patchPackage'; rowId: string; patch: { name?: string; description?: string; packageType?: PackageType; include?: boolean } }
  | { type: 'removePackage'; rowId: string }
  | { type: 'setPackageItem'; rowId: string; sku: string; quantity: number }
  | { type: 'removePackageItem'; rowId: string; sku: string }
  | { type: 'addTier' }
  | { type: 'patchTier'; rowId: string; patch: { minQuantity?: number; maxQuantity?: number | null; unitPrice?: string; moqUnit?: MoqUnit; include?: boolean } }
  | { type: 'removeTier'; rowId: string }
  | { type: 'reset'; draft?: DraftProduct }

/** نرمال‌سازیِ SKU: بالاحرف و بدونِ فاصله. همان چیزی که `buildStagedProduct` می‌فرستد. */
export function normalizeSku(value: string): string {
  return value.trim().toUpperCase()
}

export function draftReducer(state: DraftProduct, action: DraftAction): DraftProduct {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.patch }

    case 'setAttribute': {
      if (action.key.trim().length === 0) return state
      return { ...state, attributes: { ...state.attributes, [action.key.trim()]: action.value } }
    }
    case 'renameAttribute': {
      const from = action.from.trim()
      const to = action.to.trim()
      if (!from || !to || from === to || !(from in state.attributes)) return state
      const next: Record<string, string> = {}
      for (const [key, value] of Object.entries(state.attributes)) next[key === from ? to : key] = value
      return { ...state, attributes: next }
    }
    case 'removeAttribute': {
      const next = { ...state.attributes }
      delete next[action.key]
      return { ...state, attributes: next }
    }

    case 'patchCommercial':
      return { ...state, commercial: { ...(state.commercial ?? emptyDraft().commercial!), ...action.patch } }

    case 'addVariant':
      return {
        ...state,
        variants: [
          ...state.variants,
          {
            rowId: newDraftRowId('var'),
            sku: '',
            attributes: {},
            status: 'active',
            onHand: null,
            include: true,
            ...action.variant,
          },
        ],
      }

    case 'patchVariant':
      return {
        ...state,
        variants: state.variants.map(variant => (variant.rowId === action.rowId ? { ...variant, ...action.patch } : variant)),
      }

    case 'renameVariantSku': {
      const target = state.variants.find(variant => variant.rowId === action.rowId)
      if (!target) return state
      const next = normalizeSku(action.sku)
      const previous = normalizeSku(target.sku)
      if (next === previous) {
        return { ...state, variants: state.variants.map(v => (v.rowId === action.rowId ? { ...v, sku: next } : v)) }
      }
      // ارجاع‌های وابسته هم‌زمان به‌روز می‌شوند تا `media.variantSku = OLD-SKU`
      // یا قلمِ بستهٔ شکسته هرگز ارسال نشود.
      return {
        ...state,
        variants: state.variants.map(v => (v.rowId === action.rowId ? { ...v, sku: next } : v)),
        media: state.media.map(item => (item.variantSku && normalizeSku(item.variantSku) === previous ? { ...item, variantSku: next } : item)),
        packages: state.packages.map(pkg => ({
          ...pkg,
          items: pkg.items.map(item => (normalizeSku(item.sku) === previous ? { ...item, sku: next } : item)),
        })),
        commercial:
          state.commercial && state.commercial.variantSku && normalizeSku(state.commercial.variantSku) === previous
            ? { ...state.commercial, variantSku: next }
            : state.commercial,
      }
    }

    case 'removeVariant':
      return { ...state, variants: state.variants.filter(variant => variant.rowId !== action.rowId) }

    case 'addMedia':
      return {
        ...state,
        media: [
          ...state.media,
          { rowId: newDraftRowId('med'), url: '', type: 'image', variantSku: null, include: true, ...action.media },
        ],
      }
    case 'patchMedia':
      return { ...state, media: state.media.map(item => (item.rowId === action.rowId ? { ...item, ...action.patch } : item)) }
    case 'removeMedia':
      return { ...state, media: state.media.filter(item => item.rowId !== action.rowId) }
    case 'moveMedia': {
      const index = state.media.findIndex(item => item.rowId === action.rowId)
      const target = index + action.direction
      if (index < 0 || target < 0 || target >= state.media.length) return state
      const next = [...state.media]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved!)
      return { ...state, media: next }
    }

    case 'addPackage':
      return {
        ...state,
        packages: [
          ...state.packages,
          { rowId: newDraftRowId('pkg'), packageType: action.packageType ?? 'SIZE_RUN', name: '', description: '', items: [], include: true },
        ],
      }
    case 'patchPackage':
      return { ...state, packages: state.packages.map(pkg => (pkg.rowId === action.rowId ? { ...pkg, ...action.patch } : pkg)) }
    case 'removePackage':
      return { ...state, packages: state.packages.filter(pkg => pkg.rowId !== action.rowId) }
    case 'setPackageItem': {
      const sku = normalizeSku(action.sku)
      return {
        ...state,
        packages: state.packages.map(pkg => {
          if (pkg.rowId !== action.rowId) return pkg
          const existing = pkg.items.find(item => normalizeSku(item.sku) === sku)
          const items = existing
            ? pkg.items.map(item => (normalizeSku(item.sku) === sku ? { ...item, quantity: action.quantity } : item))
            : [...pkg.items, { sku, quantity: action.quantity }]
          return { ...pkg, items }
        }),
      }
    }
    case 'removePackageItem':
      return {
        ...state,
        packages: state.packages.map(pkg =>
          pkg.rowId === action.rowId ? { ...pkg, items: pkg.items.filter(item => normalizeSku(item.sku) !== normalizeSku(action.sku)) } : pkg,
        ),
      }

    case 'addTier': {
      const last = state.pricingTiers[state.pricingTiers.length - 1]
      const minQuantity = last ? (last.maxQuantity ?? last.minQuantity) + 1 : 1
      return {
        ...state,
        pricingTiers: [
          ...state.pricingTiers,
          { rowId: newDraftRowId('tier'), minQuantity, maxQuantity: null, unitPrice: '', moqUnit: state.commercial?.moqUnit ?? 'PIECE', include: true },
        ],
      }
    }
    case 'patchTier':
      return { ...state, pricingTiers: state.pricingTiers.map(tier => (tier.rowId === action.rowId ? { ...tier, ...action.patch } : tier)) }
    case 'removeTier':
      return { ...state, pricingTiers: state.pricingTiers.filter(tier => tier.rowId !== action.rowId) }

    case 'reset':
      return action.draft ?? emptyDraft()

    default:
      return state
  }
}

/* ── وابستگی‌های خطرناک (برای هشدارِ UI) ──────────────────────────────────── */

export type VariantDependencyWarning = {
  variantRowId: string
  sku: string
  /** بسته‌هایی که به این واریانت ارجاع دارند. */
  packages: string[]
  /** تعدادِ رسانهٔ وابسته. */
  mediaCount: number
}

/**
 * واریانت‌های **غیرفعال/حذف‌شده‌ای** که هنوز جایی به آن‌ها ارجاع شده است.
 *
 * این‌ها همان مواردی هستند که اگر بی‌صدا رد شوند، بستهٔ شکسته ارسال می‌شود.
 * ویرایشگر باید آن‌ها را نشان دهد و کاربر را وادار به رفع کند.
 */
export function findBrokenReferences(draft: DraftProduct): VariantDependencyWarning[] {
  const activeSkus = new Set(draft.variants.filter(variant => variant.include).map(variant => normalizeSku(variant.sku)).filter(Boolean))
  const referenced = new Map<string, VariantDependencyWarning>()

  const ensure = (sku: string): VariantDependencyWarning => {
    const existing = referenced.get(sku)
    if (existing) return existing
    const created: VariantDependencyWarning = { variantRowId: '', sku, packages: [], mediaCount: 0 }
    referenced.set(sku, created)
    return created
  }

  for (const item of draft.media.filter(entry => entry.include)) {
    const sku = item.variantSku ? normalizeSku(item.variantSku) : ''
    if (sku && !activeSkus.has(sku)) ensure(sku).mediaCount += 1
  }
  for (const pkg of draft.packages.filter(entry => entry.include)) {
    for (const item of pkg.items) {
      const sku = normalizeSku(item.sku)
      if (sku && !activeSkus.has(sku)) {
        const warning = ensure(sku)
        if (!warning.packages.includes(pkg.name || pkg.rowId)) warning.packages.push(pkg.name || pkg.rowId)
      }
    }
  }
  return [...referenced.values()]
}

/* ── نگهداریِ محلیِ پیش‌نویس (فقط پیش‌نویس، نه حقیقتِ سرور) ─────────────────── */

type PersistedDraft = { version: 1; savedAt: string; draft: DraftProduct }

export function loadPersistedDraft(): DraftProduct | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedDraft
    if (parsed?.version !== 1 || !parsed.draft) return null
    // نسخهٔ ناشناخته → بی‌اعتبار؛ هرگز دادهٔ قدیمی را به‌زور نگاشت نمی‌کنیم.
    return { ...emptyDraft(), ...parsed.draft }
  } catch {
    return null
  }
}

export function persistDraft(draft: DraftProduct): void {
  if (typeof window === 'undefined') return
  try {
    const payload: PersistedDraft = { version: 1, savedAt: new Date().toISOString(), draft }
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // ذخیره‌سازی در دسترس نیست (حالتِ خصوصی/پر)؛ ویرایش در حافظه ادامه دارد.
  }
}

export function clearPersistedDraft(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function isDraftEmpty(draft: DraftProduct): boolean {
  return (
    draft.name.trim().length === 0 &&
    draft.variants.length === 0 &&
    draft.media.length === 0 &&
    draft.packages.length === 0 &&
    draft.pricingTiers.length === 0
  )
}

/* ── هوکِ ویرایشگر ───────────────────────────────────────────────────────── */

export type ProductDraftController = {
  draft: DraftProduct
  dispatch: React.Dispatch<DraftAction>
  issues: DraftIssue[]
  brokenReferences: VariantDependencyWarning[]
  /** خروجیِ `buildStagedProduct` — همان چیزی که بازبینی و ارسال هر دو می‌بینند. */
  staged: ReturnType<typeof buildStagedProduct>
  hasPersistedDraft: boolean
  restorePersisted: () => void
  discardPersisted: () => void
  markSubmitted: () => void
}

export function useProductDraft(): ProductDraftController {
  const [draft, dispatch] = useReducer(draftReducer, undefined, emptyDraft)
  const [hasPersistedDraft, setHasPersistedDraft] = useState(false)
  const hydrated = useRef(false)
  const submitted = useRef(false)

  // فقط یک بار در mount بررسی می‌کنیم که پیش‌نویسِ ذخیره‌شده‌ای هست یا نه.
  useEffect(() => {
    setHasPersistedDraft(loadPersistedDraft() != null)
    hydrated.current = true
  }, [])

  // پس از هر تغییر (و نه پیش از hydration) پیش‌نویس را ذخیره می‌کنیم.
  useEffect(() => {
    if (!hydrated.current || submitted.current) return
    if (isDraftEmpty(draft)) return
    persistDraft(draft)
    setHasPersistedDraft(true)
  }, [draft])

  const restorePersisted = useCallback(() => {
    const persisted = loadPersistedDraft()
    if (persisted) {
      submitted.current = false
      dispatch({ type: 'reset', draft: persisted })
    }
  }, [])

  const discardPersisted = useCallback(() => {
    clearPersistedDraft()
    setHasPersistedDraft(false)
    submitted.current = false
    dispatch({ type: 'reset' })
  }, [])

  const markSubmitted = useCallback(() => {
    submitted.current = true
    clearPersistedDraft()
    setHasPersistedDraft(false)
  }, [])

  const issues = useMemo(() => validateDraftProduct(draft), [draft])
  const brokenReferences = useMemo(() => findBrokenReferences(draft), [draft])
  const staged = useMemo(() => buildStagedProduct(draft), [draft])

  return { draft, dispatch, issues, brokenReferences, staged, hasPersistedDraft, restorePersisted, discardPersisted, markSubmitted }
}
