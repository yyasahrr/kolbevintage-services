import type { HTMLAttributes, ReactNode } from "react";

type ShellProps = HTMLAttributes<HTMLDivElement> & { header?: ReactNode; navigation?: ReactNode; aside?: ReactNode; footer?: ReactNode; children: ReactNode; density?: "comfortable" | "compact" };

export function AppShell({ header, navigation, aside, footer, children, density = "comfortable", className = "", ...props }: ShellProps) {
  return <div {...props} className={`kolbe-app-shell ${className}`.trim()} data-density={density}>{header}{navigation}<div className="kolbe-app-shell__body">{aside}<main className="kolbe-app-shell__main" id="main-content">{children}</main></div>{footer}</div>;
}

export function CommerceShell(props: ShellProps) { return <AppShell {...props} className={`kolbe-shell-commerce ${props.className ?? ""}`.trim()} />; }
export function AccountShell(props: ShellProps) { return <AppShell {...props} className={`kolbe-shell-account ${props.className ?? ""}`.trim()} />; }
export function SupplierShell(props: ShellProps) { return <AppShell {...props} density="compact" className={`kolbe-shell-operational ${props.className ?? ""}`.trim()} />; }
export function AdminShell(props: ShellProps) { return <AppShell {...props} density="compact" className={`kolbe-shell-operational kolbe-shell-admin ${props.className ?? ""}`.trim()} />; }

export function CommerceHeader({ brand, navigation, actions, className = "" }: { brand: ReactNode; navigation?: ReactNode; actions?: ReactNode; className?: string }) {
  return <header className={`kolbe-commerce-header ${className}`.trim()}><div className="kolbe-commerce-header__inner"><div className="kolbe-commerce-header__brand">{brand}</div>{navigation ? <nav aria-label="ناوبری اصلی">{navigation}</nav> : null}{actions ? <div className="kolbe-commerce-header__actions">{actions}</div> : null}</div></header>;
}
