import { AlertCircle, Ban, Inbox, LoaderCircle, RotateCcw } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { Button, type Intent } from "./primitives";

export function Skeleton({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`kolbe-skeleton ${className}`.trim()} aria-hidden="true" />;
}

export function LoadingState({ label = "در حال بارگذاری", children }: { label?: string; children?: ReactNode }) {
  return <div className="kolbe-state" role="status" aria-live="polite"><LoaderCircle className="kolbe-state__icon kolbe-state__spinner" aria-hidden="true" /><p>{label}</p>{children}</div>;
}

type StateProps = { title: string; description?: ReactNode; action?: ReactNode; className?: string };
export function EmptyState({ title, description, action, className = "" }: StateProps) {
  return <section className={`kolbe-state ${className}`.trim()}><Inbox className="kolbe-state__icon" aria-hidden="true" /><h2>{title}</h2>{description ? <p>{description}</p> : null}{action}</section>;
}

export function ErrorState({ title, description, action, onRetry, className = "" }: StateProps & { onRetry?: () => void }) {
  return <section className={`kolbe-state kolbe-state--error ${className}`.trim()} role="alert"><AlertCircle className="kolbe-state__icon" aria-hidden="true" /><h2>{title}</h2>{description ? <p>{description}</p> : null}{action ?? (onRetry ? <Button variant="secondary" onClick={onRetry}><RotateCcw aria-hidden="true" /> تلاش دوباره</Button> : null)}</section>;
}

export function ForbiddenState({ title = "دسترسی مجاز نیست", description, action, className = "" }: Partial<StateProps>) {
  return <section className={`kolbe-state kolbe-state--forbidden ${className}`.trim()}><Ban className="kolbe-state__icon" aria-hidden="true" /><h2>{title}</h2>{description ? <p>{description}</p> : null}{action}</section>;
}

export function InlineNotice({ intent = "neutral", title, children, className = "" }: { intent?: Intent; title?: string; children: ReactNode; className?: string }) {
  return <div className={`kolbe-notice ${className}`.trim()} data-intent={intent} role={intent === "danger" ? "alert" : "status"}>{title ? <strong>{title}</strong> : null}<div>{children}</div></div>;
}

export type ToastMessage = { id: string; intent?: Intent; title: string; description?: string };
export function ToastRegion({ messages, onDismiss, label = "اعلان‌ها" }: { messages: readonly ToastMessage[]; onDismiss?: (id: string) => void; label?: string }) {
  return <aside className="kolbe-toast-region" aria-label={label} aria-live="polite">{messages.map((message) => <div className="kolbe-toast" data-intent={message.intent ?? "neutral"} key={message.id}><div><strong>{message.title}</strong>{message.description ? <p>{message.description}</p> : null}</div>{onDismiss ? <button type="button" aria-label={`بستن ${message.title}`} onClick={() => onDismiss(message.id)}>×</button> : null}</div>)}</aside>;
}
