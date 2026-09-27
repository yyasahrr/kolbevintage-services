import { Menu, Moon, Sun, UserRound } from "lucide-react";
import { useState, type ReactNode } from "react";

import { CommerceHeader, CommerceShell, Drawer } from "../../shared/components";
import { useThemePreference } from "../theme";
import { Link } from "../router";

export type VipMembershipIdentity = {
  memberName: string;
  storeName: string;
  planName: string;
  expiresAt: string | null;
};

const PRIMARY_NAV = [
  ["/vip/catalog", "فروشگاه عمده"],
  ["/vip/orders", "سفارش‌ها"],
  ["/vip/invoices", "فاکتورها"],
  ["/vip/support", "پشتیبانی"],
] as const;

const ACCOUNT_NAV = [
  ["/vip/membership", "عضویت VIP"],
  ["/vip/addresses", "آدرس‌های ارسال"],
] as const;

function NavLinks({ path, onNavigate }: { path: string; onNavigate?: () => void }) {
  return <>{PRIMARY_NAV.map(([to, label]) => <Link key={to} to={to} onClick={onNavigate} aria-current={path === to || (to === "/vip/catalog" && (path === "/vip" || path.startsWith("/vip/catalog/"))) ? "page" : undefined}>{label}</Link>)}</>;
}

export function VipCommerceShell({ path, membership, onLogout, children }: { path: string; membership: VipMembershipIdentity; onLogout: () => void; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { resolved, setPreference } = useThemePreference();
  const toggleTheme = () => setPreference(resolved === "dark" ? "light" : "dark");

  const header = <CommerceHeader
    className="vip-commerce-header"
    brand={<Link to="/vip" className="vip-commerce-brand"><span>کلبه وینتیج</span><small>WHOLESALE / VIP</small></Link>}
    navigation={<div className="vip-commerce-nav"><NavLinks path={path} /></div>}
    actions={<>
      <button type="button" className="kolbe-icon-button vip-mobile-menu" aria-label="باز کردن منوی فروشگاه عمده" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu aria-hidden="true" /></button>
      <button type="button" className="kolbe-icon-button" aria-label={resolved === "dark" ? "فعال‌کردن تم روشن" : "فعال‌کردن تم تاریک"} onClick={toggleTheme}>{resolved === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}</button>
      <details className="vip-account-menu">
        <summary aria-label="باز کردن منوی حساب"><UserRound aria-hidden="true" /><span>{membership.storeName || membership.memberName || "حساب VIP"}</span></summary>
        <div className="vip-account-menu__surface">
          <p>{membership.planName || "عضویت VIP"}</p>
          {ACCOUNT_NAV.map(([to, label]) => <Link key={to} to={to}>{label}</Link>)}
          <button type="button" onClick={onLogout}>خروج</button>
        </div>
      </details>
    </>}
  />;

  return <CommerceShell header={header} className="vip-commerce-shell">
    <a href="#vip-main" className="vip-skip-link">رفتن به محتوای اصلی</a>
    <div id="vip-main">{children}</div>
    <Drawer open={menuOpen} onOpenChange={setMenuOpen} title="فروشگاه عمده" description={membership.storeName || membership.memberName}>
      <nav className="vip-mobile-nav" aria-label="ناوبری موبایل"><NavLinks path={path} onNavigate={() => setMenuOpen(false)} /><hr />{ACCOUNT_NAV.map(([to, label]) => <Link key={to} to={to} onClick={() => setMenuOpen(false)}>{label}</Link>)}<button type="button" onClick={onLogout}>خروج از حساب</button></nav>
    </Drawer>
  </CommerceShell>;
}
