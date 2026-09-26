import type { ReactNode } from "react";
import { formatMoney, type FormatMoneyOptions, type MoneyString } from "../money";
import type { Intent } from "./primitives";

export function Money({ value, options, className = "" }: { value: MoneyString; options?: FormatMoneyOptions; className?: string }) {
  return <bdi className={`kolbe-money kolbe-numeric kolbe-ltr ${className}`.trim()} dir="ltr">{formatMoney(value, options)}</bdi>;
}

export function StatusBadge({ children, intent = "neutral", className = "" }: { children: ReactNode; intent?: Intent; className?: string }) {
  return <span className={`kolbe-status ${className}`.trim()} data-intent={intent}>{children}</span>;
}

export type DataColumn<Row> = { key: string; header: ReactNode; cell: (row: Row) => ReactNode; className?: string; mobileLabel?: string };
export function DataTable<Row>({ rows, columns, rowKey, caption, empty }: { rows: readonly Row[]; columns: readonly DataColumn<Row>[]; rowKey: (row: Row) => string; caption: string; empty?: ReactNode }) {
  if (rows.length === 0) return <>{empty ?? null}</>;
  return <div className="kolbe-table-scroll"><table className="kolbe-data-table"><caption className="kolbe-visually-hidden">{caption}</caption><thead><tr>{columns.map((column) => <th key={column.key} scope="col" className={column.className}>{column.header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={rowKey(row)}>{columns.map((column) => <td key={column.key} className={column.className}>{column.cell(row)}</td>)}</tr>)}</tbody></table></div>;
}

export function ResponsiveTable<Row>(props: Parameters<typeof DataTable<Row>>[0]) {
  if (props.rows.length === 0) return <>{props.empty ?? null}</>;
  return <div className="kolbe-responsive-table"><DataTable {...props} /><div className="kolbe-responsive-table__cards">{props.rows.map((row) => <article key={props.rowKey(row)}>{props.columns.map((column) => <div key={column.key}><dt>{column.mobileLabel ?? column.header}</dt><dd>{column.cell(row)}</dd></div>)}</article>)}</div></div>;
}

export type TimelineItem = { id: string; title: ReactNode; description?: ReactNode; time?: ReactNode; intent?: Intent };
export function Timeline({ items, label = "تاریخچه" }: { items: readonly TimelineItem[]; label?: string }) {
  return <ol className="kolbe-timeline" aria-label={label}>{items.map((item) => <li key={item.id} data-intent={item.intent ?? "neutral"}><div><h3>{item.title}</h3>{item.description ? <p>{item.description}</p> : null}</div>{item.time ? <time>{item.time}</time> : null}</li>)}</ol>;
}

export function DescriptionList({ items, className = "" }: { items: readonly { term: ReactNode; detail: ReactNode; ltr?: boolean }[]; className?: string }) {
  return <dl className={`kolbe-description-list ${className}`.trim()}>{items.map((item, index) => <div key={index}><dt>{item.term}</dt><dd className={item.ltr ? "kolbe-ltr" : undefined}>{item.detail}</dd></div>)}</dl>;
}
