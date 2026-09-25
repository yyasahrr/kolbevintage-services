'use client'

/**
 * پوستهٔ پورتال تأمین‌کننده (فاز ۶.۲).
 *
 * ساختار:
 *   SupplierPortalProvider  → یک نمونهٔ مشترک از کلاینت/نشست برای کلِ پورتال
 *   AuthShell               → ورود/ثبت (هویت فقط از سرور)
 *   Portal                  → ناوبری + صفحاتِ داده‌محور
 *
 * این فایل هیچ داده‌ای نمی‌سازد؛ فقط مسیریابی، ناوبری، تم و بازیابیِ نشست.
 */

import {
  Bell, ChevronDown, CircleHelp, LogOut, Menu, Moon, Search, Sun, X,
} from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { canUseProduction } from '@shared/permissions/capabilities'
import { SupplierPortalProvider, useSupplierPortal } from './context'
import { AuthShell } from './auth'
import { NAV_GROUPS, PAGE_TITLES, type SupplierPage } from './navigation'
import { AnalyticsPage } from './pages/analytics'
import { CompliancePage } from './pages/compliance'
import { DashboardPage } from './pages/dashboard'
import { FinancePage, WithdrawalsPage } from './pages/finance'
import { InventoryPage } from './pages/inventory'
import { OrdersPage } from './pages/orders'
import { CapacityPage, ProductionPage } from './pages/production'
import { ProductEditorPage, ProductsPage } from './pages/products'
import { RfqsPage } from './pages/rfqs'
import { SettingsPage } from './pages/settings'
import { SupportPage } from './pages/support'
import { TeamPage } from './pages/team'
import { LoadingRows, Notice } from './ui'

const THEME_KEY = 'kolbe-supplier-theme'

export default function App() {
  return (
    <SupplierPortalProvider>
      <PortalRoot />
    </SupplierPortalProvider>
  )
}

function PortalRoot() {
  const portal = useSupplierPortal()
  const [restoring, setRestoring] = useState(true)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void portal.session
      .restoreResult()
      .then(result => {
        if (cancelled) return
        if (result.ok) {
          portal.setSessionState(result.data)
        } else if (result.error.kind !== 'UNAUTHORIZED' && result.error.kind !== 'FORBIDDEN') {
          // خطای واقعیِ بازیابیِ نشست به کاربر گفته می‌شود؛ وانمود به «خروج» نمی‌کنیم.
          setRestoreError(result.error.message)
        }
      })
      .finally(() => {
        if (!cancelled) setRestoring(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (restoring) {
    return (
      <div className="portal-boot" role="status" aria-live="polite">
        <LoadingRows count={3} label="در حال بازیابی نشست…" />
      </div>
    )
  }

  const authenticated = portal.sessionState.status === 'authenticated' || portal.demoMode

  if (!authenticated) {
    return (
      <>
        {restoreError ? <div className="portal-boot"><Notice tone="danger" title="بازیابی نشست ناموفق بود">{restoreError}</Notice></div> : null}
        <AuthShell onAuthenticated={() => setRestoreError(null)} />
      </>
    )
  }

  return <Portal />
}

function Portal() {
  const portal = useSupplierPortal()
  const [page, setPage] = useState<SupplierPage>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  const productionEnabled = canUseProduction(portal.sessionState.capabilities)

  const go = useCallback((target: SupplierPage) => {
    setPage(target)
    setSidebarOpen(false)
    setNoticeOpen(false)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('page', target)
      window.history.replaceState({}, '', url.toString())
    }
  }, [])

  // تم: فقط ترجیحِ نمایشی؛ در localStorage نگه داشته می‌شود و business نیست.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_KEY)
      if (stored === 'dark' || stored === 'light') setTheme(stored)
      else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) setTheme('dark')
    } catch {
      /* دسترسی نداشتن به localStorage نباید پورتال را بشکند */
    }
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.supplierTheme = theme
    root.style.colorScheme = theme
    try {
      window.localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSidebarOpen(false)
        setNoticeOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const logout = async () => {
    // خروج همیشه وضعیتِ نمایشی را پاک می‌کند، حتی اگر سرور خطا بدهد.
    try {
      await portal.session.logout()
    } finally {
      portal.setSessionState({ ...portal.sessionState, status: 'anonymous', user: null, supplier: null } as never)
      portal.setDemoMode(false)
    }
  }

  const meta = PAGE_TITLES[page]

  return (
    <div className="app-shell" data-supplier-theme={theme}>
      <Sidebar page={page} onNavigate={go} open={sidebarOpen} onClose={() => setSidebarOpen(false)} productionEnabled={productionEnabled} onLogout={logout} />
      <div className="content-shell">
        <Topbar
          title={meta.title}
          onMenu={() => setSidebarOpen(true)}
          noticeOpen={noticeOpen}
          onNotices={() => setNoticeOpen(open => !open)}
          theme={theme}
          onToggleTheme={() => setTheme(current => (current === 'dark' ? 'light' : 'dark'))}
        />
        <div className="page-content">
          {portal.demoMode ? (
            <Notice tone="warn" title="حالت نمایشی فعال است">
              در این حالت هیچ دادهٔ واقعی خوانده یا نوشته نمی‌شود؛ این حالت فقط برای مرورِ رابط است و در محیطِ
              تولید بدون فلگِ صریح فعال نمی‌شود.
            </Notice>
          ) : null}
          <PageBody page={page} onNavigate={go} />
        </div>
      </div>
    </div>
  )
}

function PageBody({ page, onNavigate }: { page: SupplierPage; onNavigate: (page: SupplierPage) => void }) {
  switch (page) {
    case 'dashboard':
      return <DashboardPage onNavigate={onNavigate} />
    case 'products':
      return <ProductsPage onNavigate={onNavigate} />
    case 'product-editor':
      return <ProductEditorPage onDone={() => onNavigate('products')} />
    case 'rfqs':
      return <RfqsPage />
    case 'orders':
      return <OrdersPage />
    case 'inventory':
      return <InventoryPage />
    case 'finance':
      return <FinancePage />
    case 'withdrawals':
      return <WithdrawalsPage />
    case 'team':
      return <TeamPage />
    case 'compliance':
      return <CompliancePage />
    case 'support':
      return <SupportPage />
    case 'analytics':
      return <AnalyticsPage />
    case 'production':
      return <ProductionPage />
    case 'capacity':
      return <CapacityPage />
    case 'settings':
      return <SettingsPage onNavigate={onNavigate} />
    default:
      return <DashboardPage onNavigate={onNavigate} />
  }
}

function Sidebar({
  page, onNavigate, open, onClose, productionEnabled, onLogout,
}: {
  page: SupplierPage; onNavigate: (page: SupplierPage) => void; open: boolean; onClose: () => void
  productionEnabled: boolean; onLogout: () => void
}) {
  const portal = useSupplierPortal()
  const session = portal.sessionState
  const displayName = session.status === 'authenticated' ? (session.supplier?.displayName ?? session.supplier?.legalName ?? 'تأمین‌کننده') : 'حالت نمایشی'

  return (
    <>
      {open ? <div className="sidebar-scrim" onClick={onClose} aria-hidden="true" /> : null}
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="ناوبری اصلی">
        <div className="brand">
          <div className="brand-seal">K</div>
          <div><strong>KOLBE</strong><span>Vintage · Supplier</span></div>
          <button type="button" className="close-sidebar icon-button" aria-label="بستن منو" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="supplier-switch">
          <div className="mini-avatar">{displayName.slice(0, 1)}</div>
          <div>
            <b>{displayName}</b>
            <span>{portal.demoMode ? 'حالت نمایشی' : 'تأمین‌کنندهٔ تأییدشده'}</span>
          </div>
        </div>

        <nav>
          {NAV_GROUPS.map((group, index) => (
            <div className="nav-group" key={group.label ?? index}>
              {group.label ? <p>{group.label}</p> : null}
              {group.links.map(link => {
                const hidden = Boolean(link.capability) && !productionEnabled
                if (hidden) return null
                const Icon = link.icon
                return (
                  <button
                    type="button"
                    key={link.page}
                    className={page === link.page ? 'nav-link active' : 'nav-link'}
                    onClick={() => onNavigate(link.page)}
                    aria-current={page === link.page ? 'page' : undefined}
                  >
                    <Icon size={17} />
                    <span>{link.label}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button type="button" className="nav-link" onClick={() => onNavigate('settings')}>
            <CircleHelp size={17} /><span>تنظیمات</span>
          </button>
          <button type="button" className="nav-link" onClick={onLogout}>
            <LogOut size={17} /><span>خروج</span>
          </button>
        </div>
      </aside>
    </>
  )
}

function Topbar({
  title, onMenu, noticeOpen, onNotices, theme, onToggleTheme,
}: {
  title: string; onMenu: () => void; noticeOpen: boolean; onNotices: () => void
  theme: 'light' | 'dark'; onToggleTheme: () => void
}) {
  const portal = useSupplierPortal()
  const session = portal.sessionState
  const name = session.status === 'authenticated' ? (session.user.name ?? session.user.email ?? 'کاربر') : 'نمایشی'

  return (
    <header className="topbar">
      <button type="button" className="mobile-menu icon-button" aria-label="باز کردن منو" onClick={onMenu}><Menu size={20} /></button>
      <button type="button" className="global-search" aria-label="جست‌وجو">
        <Search size={17} />
        <span>{title}</span>
      </button>
      <div className="top-actions">
        <button
          type="button"
          className="icon-button"
          aria-label={theme === 'dark' ? 'حالت روشن' : 'حالت تیره'}
          onClick={onToggleTheme}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <div className="notification-wrap">
          <button type="button" className={`icon-button notification ${noticeOpen ? 'selected' : ''}`} aria-label="اعلان‌ها" aria-expanded={noticeOpen} onClick={onNotices}>
            <Bell size={19} />
          </button>
          {noticeOpen ? (
            <div className="notification-panel" role="dialog" aria-label="اعلان‌ها">
              <div className="panel-title"><b>اعلان‌ها</b></div>
              <p className="muted-line">اعلان‌های زنده در این فاز متصل نشده‌اند؛ فهرست از سرور خوانده خواهد شد.</p>
            </div>
          ) : null}
        </div>
        <div className="top-avatar" title={name}>{name.slice(0, 1)}</div>
      </div>
    </header>
  )
}

export function PortalShell({ children }: { children: ReactNode }) {
  return <div className="content-shell">{children}</div>
}

export function ThemeIndicator({ theme }: { theme: 'light' | 'dark' }) {
  return <span className="theme-indicator">{theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />} <ChevronDown size={13} /></span>
}
