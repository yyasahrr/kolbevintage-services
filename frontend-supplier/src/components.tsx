import type { ReactNode } from 'react'
import { ArrowLeft, ChevronLeft, MoreHorizontal } from 'lucide-react'

export function Status({ children }: { children: ReactNode }) {
  const value = String(children)
  const tone = value.includes('فعال') || value.includes('تأیید') || value.includes('آماده') || value.includes('ارسال شد') ? 'green' : value.includes('اصلاح') || value.includes('نیازمند') || value.includes('جدید') ? 'amber' : value.includes('بررسی') ? 'blue' : 'gray'
  return <span className={`status ${tone}`}><i />{children}</span>
}

export function SectionHeading({ eyebrow, title, action, children }: { eyebrow?: string; title: string; action?: ReactNode; children?: ReactNode }) {
  return <div className="section-heading">
    <div>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h2>{title}</h2>
      {children ? <div className="heading-copy">{children}</div> : null}
    </div>
    {action}
  </div>
}

export function TextButton({ children, onClick, className = '' }: { children: ReactNode; onClick?: () => void; className?: string }) {
  return <button className={`text-button ${className}`} onClick={onClick}>{children}<ArrowLeft size={15} strokeWidth={1.8} /></button>
}

export function EmptyState({ title, copy, description, action }: { title: string; copy?: string; description?: string; action?: string }) {
  return <div className="empty-state"><div className="empty-mark">+</div><h3>{title}</h3><p>{copy ?? description}</p>{action ? <button className="button secondary">{action}</button> : null}</div>
}

export function PageCrumbs({ parent, current }: { parent: string; current: string }) {
  return <div className="crumbs"><span>{parent}</span><ChevronLeft size={14}/><b>{current}</b></div>
}

export function RowMenu() { return <button aria-label="گزینه‌های بیشتر" className="icon-button"><MoreHorizontal size={18}/></button> }
