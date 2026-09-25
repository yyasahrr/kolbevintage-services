'use client'

/**
 * هوک‌های دادهٔ پورتال تأمین‌کننده (فاز ۶.۲).
 *
 * دو قاعدهٔ اصلی:
 *
 *  ۱) خروجی همیشه `AsyncState` است؛ هیچ شکستی به «دادهٔ خالی» تبدیل نمی‌شود.
 *  ۲) نتیجهٔ دیررسیدهٔ یک فراخوانیِ قدیمی هرگز روی نتیجهٔ تازه نمی‌نشیند
 *     (epoch) و در unmount هم state تنظیم نمی‌شود.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiResult } from '@shared/http/types'
import { type AsyncState, LOADING, stateFromResult } from '@shared/ui/async-state'
import { useSupplierPortal } from './context'

export type Resource<T> = {
  state: AsyncState<T>
  /** خواندنِ دوباره (برای دکمهٔ «تلاش دوباره» و بعد از هر تغییرِ موفق). */
  reload: () => void
  busy: boolean
}

export function useSupplierResource<T>(
  loader: () => Promise<ApiResult<T>>,
  deps: unknown[] = [],
  options: { enabled?: boolean; isEmpty?: (data: T) => boolean } = {},
): Resource<T> {
  const enabled = options.enabled !== false
  const [state, setState] = useState<AsyncState<T>>(enabled ? LOADING : LOADING)
  const [busy, setBusy] = useState(enabled)
  const [epoch, setEpoch] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const emptyRef = useRef(options.isEmpty)
  emptyRef.current = options.isEmpty

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setBusy(true)
    if (state.status !== 'READY_WITH_DATA') setState(LOADING)
    void loaderRef
      .current()
      .then(result => {
        if (cancelled) return
        setState(stateFromResult(result, emptyRef.current))
      })
      .catch(error => {
        if (cancelled) return
        setState(stateFromResult({ ok: false, error: asApiError(error), meta: emptyMeta() }))
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, epoch, ...deps])

  const reload = useCallback(() => setEpoch(value => value + 1), [])
  return { state, reload, busy }
}

/** نتیجهٔ یک عملیاتِ تغییردهنده: پیام، خطا و درگیریِ دکمه. */
export type Mutation = {
  run: <T>(action: () => Promise<ApiResult<T>>) => Promise<ApiResult<T>>
  busy: boolean
  error: string | null
  message: string | null
  reset: () => void
}

export function useSupplierMutation(options: { onSuccess?: () => void } = {}): Mutation {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = useCallback(
    async <T,>(action: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> => {
      setBusy(true)
      setError(null)
      setMessage(null)
      try {
        const result = await action()
        if (!mounted.current) return result
        if (result.ok) {
          setMessage('عملیات با موفقیت ثبت شد.')
          options.onSuccess?.()
        } else {
          // پیامِ سرور عیناً نشان داده می‌شود؛ اگر پیامی نبود، وضعیتِ خطا نام‌برده می‌شود.
          setError(result.error.message || 'عملیات انجام نشد.')
        }
        return result
      } catch (caught) {
        const apiError = asApiError(caught)
        if (mounted.current) setError(apiError.message || 'عملیات انجام نشد.')
        return { ok: false, error: apiError, meta: emptyMeta() }
      } finally {
        if (mounted.current) setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options.onSuccess],
  )

  return { run, busy, error, message, reset: () => { setError(null); setMessage(null) } }
}

/* ── ابزارهای کمکی ───────────────────────────────────────────────────────── */

import { ApiError } from '@shared/http/errors'
import type { ApiResponseMeta } from '@shared/http/types'

function emptyMeta(): ApiResponseMeta {
  return { status: 0, url: '', method: 'GET', requestId: null, headers: new Headers() }
}

function asApiError(value: unknown): ApiError {
  if (value instanceof ApiError) return value
  return new ApiError({
    kind: 'UNKNOWN',
    message: value instanceof Error ? value.message : 'خطای ناشناخته رخ داد.',
    transport: 'protocol',
    cause: value,
  })
}

/**
 * شمارشگرِ نسخهٔ دادهٔ پورتال: بعد از هر تغییرِ موفق، فهرست‌های وابسته دوباره
 * خوانده می‌شوند — بدون اینکه صفحه مجبور شود وضعیتِ سرور را در حافظهٔ مرورگر
 * «حدس» بزند.
 */
export function usePortalDataVersion(): number {
  return useSupplierPortal().dataVersion
}
