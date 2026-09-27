import { ArrowLeft, LockKeyhole } from "lucide-react";
import type { FormEventHandler, ReactNode } from "react";
import { InlineNotice, LoadingState } from "../components";
import type { AuthErrorPresentation } from "./errors";

export function AuthShell({ children, story, tone = "commerce" }: { children: ReactNode; story?: ReactNode; tone?: "commerce" | "partner" | "control" }) {
  return <main className="kolbe-auth" data-tone={tone} dir="rtl"><section className="kolbe-auth__story" aria-label="کلبه وینتیج"><AuthBrand />{story}</section><section className="kolbe-auth__entry">{children}</section></main>;
}
export function AuthBrand({ suffix }: { suffix?: string }) {
  return <div className="kolbe-auth__brand"><span className="kolbe-auth__monogram" aria-hidden="true">K</span><span><strong>کلبه وینتیج</strong><small>KOLBE VINTAGE{suffix ? ` · ${suffix}` : ""}</small></span></div>;
}
export function AuthStory({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="kolbe-auth__story-copy"><p className="kolbe-auth__eyebrow">{eyebrow}</p><h2>{title}</h2><p>{description}</p></div>;
}
export function AuthPanel({ children, labelledBy }: { children: ReactNode; labelledBy?: string }) { return <section className="kolbe-auth__panel" aria-labelledby={labelledBy}>{children}</section>; }
export function AuthHeader({ eyebrow, title, description, id = "kolbe-auth-title" }: { eyebrow: string; title: string; description: string; id?: string }) {
  return <header className="kolbe-auth__header"><p className="kolbe-auth__eyebrow">{eyebrow}</p><h1 id={id}>{title}</h1><p>{description}</p></header>;
}
export function AuthForm({ children, onSubmit }: { children: ReactNode; onSubmit: FormEventHandler<HTMLFormElement> }) { return <form className="kolbe-auth__form" onSubmit={onSubmit} noValidate>{children}</form>; }
export function AuthError({ error }: { error: AuthErrorPresentation | null }) { return error ? <InlineNotice intent="danger" title={error.title}>{error.message}</InlineNotice> : null; }
export function AuthStatus({ label = "در حال بررسی نشست امن" }: { label?: string }) {
  return <AuthShell tone="control" story={<AuthStory eyebrow="SESSION CHECK" title="در حال بازخوانی هویت" description="هویت و سطح دسترسی مستقیماً از نشست سرور بررسی می‌شود." />}><AuthPanel><LoadingState label={label} /></AuthPanel></AuthShell>;
}
export function AuthBackLink({ href, children }: { href: string; children: ReactNode }) { return <a className="kolbe-auth__back" href={href}><ArrowLeft aria-hidden="true" />{children}</a>; }
export function AuthFooter({ children }: { children: ReactNode }) { return <footer className="kolbe-auth__footer"><LockKeyhole aria-hidden="true" />{children}</footer>; }
