import type { HTMLAttributes, ReactNode } from "react";

export function GlassNav({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <nav {...props} className={`kolbe-glass-nav ${className}`.trim()} />;
}

export function CommandBar({ primary, secondary, className = "" }: { primary: ReactNode; secondary?: ReactNode; className?: string }) {
  return <div className={`kolbe-command-bar ${className}`.trim()} role="toolbar"><div>{primary}</div>{secondary ? <div>{secondary}</div> : null}</div>;
}

export function FilterBar({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`kolbe-filter-bar ${className}`.trim()} aria-label="فیلترها">{children}</section>;
}

export type TabItem<T extends string> = { value: T; label: ReactNode; disabled?: boolean };
export function Tabs<T extends string>({ value, onChange, items, label = "بخش‌ها" }: { value: T; onChange: (value: T) => void; items: readonly TabItem<T>[]; label?: string }) {
  return <div className="kolbe-tabs" role="tablist" aria-label={label}>{items.map((item) => <button key={item.value} type="button" role="tab" aria-selected={value === item.value} disabled={item.disabled} onClick={() => onChange(item.value)}>{item.label}</button>)}</div>;
}

export function SegmentedControl<T extends string>(props: { value: T; onChange: (value: T) => void; items: readonly TabItem<T>[]; label: string }) {
  return <div className="kolbe-segmented" role="radiogroup" aria-label={props.label}>{props.items.map((item) => <button key={item.value} type="button" role="radio" aria-checked={props.value === item.value} disabled={item.disabled} onClick={() => props.onChange(item.value)}>{item.label}</button>)}</div>;
}
