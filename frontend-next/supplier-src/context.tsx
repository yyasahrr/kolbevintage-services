'use client'

/**
 * کانتکستِ مرزِ تأمین‌کننده برای پورتال (فاز ۶.۲).
 *
 * تنها یک نمونه از `ApiClient` و `SupplierSessionClient` در کلِ پورتال ساخته
 * می‌شود؛ صفحه‌ها هرگز کلاینتِ تازه‌ای نمی‌سازند (وگرنه دوباره به همان
 * پراکندگیِ فاز ۶.۰ برمی‌گردیم).
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { createSupplierBoundary, type SupplierBoundary } from '@shared/supplier'
import { anonymousSession } from '@shared/session'
import { toSupplierSession } from '@shared/supplier/session'
import type { SupplierSession } from '@shared/supplier/session'

export type SupplierPortalContext = SupplierBoundary & {
  sessionState: SupplierSession
  setSessionState: (next: SupplierSession) => void
  /**
   * حالتِ نمایشی یک «پرچمِ رابط» است، نه یک نشست. آگاهانه بیرون از
   * `SupplierSession` نگه داشته می‌شود تا تایپِ نشست هرگز ادعای هویتِ محلی نکند.
   */
  demoMode: boolean
  setDemoMode: (next: boolean) => void
  /** نسخهٔ داده: با هر تغییرِ موفقِ سرور زیاد می‌شود تا فهرست‌ها دوباره خوانده شوند. */
  dataVersion: number
  touchData: () => void
}

const Ctx = createContext<SupplierPortalContext | null>(null)

export function SupplierPortalProvider({ children, boundary }: { children: ReactNode; boundary?: SupplierBoundary }) {
  const [sessionState, setSessionState] = useState<SupplierSession>(() => toSupplierSession(anonymousSession()))
  const [demoMode, setDemoMode] = useState(false)
  const [dataVersion, setDataVersion] = useState(0)
  const boundaryRef = useRef<SupplierBoundary | null>(boundary ?? null)
  if (!boundaryRef.current) boundaryRef.current = createSupplierBoundary()
  const value = useMemo<SupplierPortalContext>(
    () => ({
      ...boundaryRef.current!,
      sessionState,
      setSessionState,
      demoMode,
      setDemoMode,
      dataVersion,
      touchData: () => setDataVersion(version => version + 1),
    }),
    [sessionState, demoMode, dataVersion],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSupplierPortal(): SupplierPortalContext {
  const value = useContext(Ctx)
  if (!value) throw new Error('SupplierPortalProvider is missing')
  return value
}

/** آیا پورتال در حالتِ نمایشی است؟ (پرچمِ رابط، نه هویت) */
export function useDemoMode(): boolean {
  return useSupplierPortal().demoMode
}

export function useRefreshPortal() {
  const portal = useSupplierPortal()
  return useCallback(() => portal.touchData(), [portal])
}
