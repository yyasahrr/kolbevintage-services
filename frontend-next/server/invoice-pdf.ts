import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

function unwrap(mod: unknown): any {
  let current = mod;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current || typeof current !== "object" || !("default" in current)) return current;
    const next = (current as { default?: unknown }).default;
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}

const pdfkit = unwrap(require("pdfkit"));
const PDFDocument = (typeof pdfkit === "function" ? pdfkit : pdfkit.default) as new (options: Record<string, unknown>) => PdfDoc;
const reshaper = unwrap(require("arabic-persian-reshaper"));
const PersianShaper = (reshaper.PersianShaper ?? reshaper) as { convertArabic: (value: string) => string };
const bidiExport = unwrap(require("bidi-js"));
const bidiFactory = (typeof bidiExport === "function" ? bidiExport : bidiExport.default) as () => {
  getEmbeddingLevels: (value: string) => unknown;
  getReorderedString: (value: string, levels: unknown) => string;
};
const bidi = bidiFactory();

type PdfDoc = {
  registerFont: (name: string, src: Buffer) => void;
  font: (name: string) => PdfDoc;
  fontSize: (size: number) => PdfDoc;
  fillColor: (color: string) => PdfDoc;
  text: (value: string, x?: number, y?: number, options?: Record<string, unknown>) => PdfDoc;
  moveDown: (n?: number) => PdfDoc;
  rect: (x: number, y: number, w: number, h: number) => { fill: (color: string) => void; stroke: (color: string) => void };
  moveTo: (x: number, y: number) => { lineTo: (x: number, y: number) => { stroke: (color: string) => void } };
  y: number;
  page: { width: number; height: number };
  end: () => void;
  on: (event: string, cb: (chunk: Buffer) => void) => void;
};

const FONT = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts", "DejaVuSans.ttf"));

export type InvoiceSnapshot = {
  invoice: { number: string; date: string; dueDate: string; kind: string; status: string };
  seller: { name: string; address: string; taxId: string };
  customer: { name: string; phone: string; address: string; email?: string };
  supplier: { name: string; phone?: string; city?: string };
  order: { reference: string };
  payment: { method: string; reference: string };
  subtotal: number;
  discount: number;
  tax: number;
  shipping: number;
  total: number;
  paid: number;
  remaining: number;
  items: Array<{ name: string; sku: string; variant: string; quantity: number; unitPrice: number; discount: number; total: number }>;
  templateVersion: number;
  terms?: string;
  footer?: string;
  layout?: { show?: string[]; signature?: string; stamp?: string; logoText?: string };
};

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function toJalali(input: Date) {
  const date = new Date(input);
  const gy = date.getUTCFullYear();
  const gm = date.getUTCMonth() + 1;
  const gd = date.getUTCDate();
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + gdm[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return `${jy}/${String(jm).padStart(2, "0")}/${String(jd).padStart(2, "0")}`;
}

export function faNum(value: number | string) {
  return String(value).replace(/\d/g, (digit) => FA_DIGITS[Number(digit)] ?? digit);
}

function visual(value: string) {
  const shaped = PersianShaper.convertArabic(value);
  return bidi.getReorderedString(shaped, bidi.getEmbeddingLevels(shaped));
}

function money(value: number) {
  return faNum(new Intl.NumberFormat("en-US").format(Math.round(value))) + " تومان";
}

export function renderInvoicePdf(snapshot: InvoiceSnapshot, title: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 42, compress: false });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont("fa", FONT);
    doc.font("fa");
    const width = doc.page.width - 84;
    const line = (text: string, size = 11, color = "#172033") => {
      doc.fontSize(size).fillColor(color).text(visual(text), 42, doc.y, { width, align: "right" });
    };
    doc.rect(0, 0, doc.page.width, 78).fill("#011c3a");
    doc.fillColor("#ffffff").fontSize(18).text(visual(title || "فاکتور"), 42, 28, { width, align: "right" });
    doc.fillColor("#d7e0ea").fontSize(9).text(snapshot.invoice.number, 42, 52, { width, align: "left" });
    const show = snapshot.layout?.show?.length ? snapshot.layout.show : ["seller", "buyer", "supplier", "items", "totals", "payment", "terms", "footer", "signature", "stamp"];
    const visible = (section: string) => show.includes(section);
    doc.y = 96;
    if (snapshot.layout?.logoText) line(snapshot.layout.logoText, 9, "#64748b");
    line(`شماره: ${snapshot.invoice.number}    تاریخ: ${faNum(snapshot.invoice.date)}    سررسید: ${faNum(snapshot.invoice.dueDate || "—")}`, 10, "#334155");
    line(`وضعیت: ${snapshot.invoice.status}    نسخه قالب: ${faNum(snapshot.templateVersion)}`, 10, "#334155");
    doc.moveDown(0.6);
    if (visible("seller")) {
      line(`فروشنده: ${snapshot.seller.name}`, 12);
      line(`${snapshot.seller.address}    شناسه: ${snapshot.seller.taxId || "—"}`, 9, "#475569");
    }
    if (visible("buyer")) {
      line(`خریدار: ${snapshot.customer.name}    ${snapshot.customer.phone}`, 12);
      line(snapshot.customer.address || "—", 9, "#475569");
    }
    if (visible("supplier") && snapshot.supplier.name) line(`تأمین‌کننده: ${snapshot.supplier.name}${snapshot.supplier.city ? " · " + snapshot.supplier.city : ""}`, 10);
    if (visible("payment")) line(`مرجع سفارش: ${snapshot.order.reference || "—"}    پرداخت: ${snapshot.payment.method || "—"} ${snapshot.payment.reference || ""}`, 10);
    doc.moveDown(0.8);
    const headY = doc.y;
    doc.rect(42, headY, width, 22).fill("#f3f6f8");
    doc.fillColor("#011c3a").fontSize(9).text(visual("شرح / SKU"), 48, headY + 6, { width: width - 12, align: "right" });
    doc.y = headY + 28;
    const items = visible("items") ? snapshot.items : [];
    for (const item of items) {
      line(`${item.name}  ${item.variant || ""}  ${item.sku}`, 10);
      line(`${faNum(item.quantity)} × ${money(item.unitPrice)} = ${money(item.total)}`, 9, "#475569");
    }
    if (visible("items") && !items.length) line("قلمی برای این سند ثبت نشده است.", 10, "#64748b");
    doc.moveDown(0.6);
    doc.moveTo(42, doc.y).lineTo(42 + width, doc.y).stroke("#e2e8f0");
    doc.moveDown(0.4);
    if (visible("totals")) for (const [label, value] of [
      ["جمع جزء", snapshot.subtotal],
      ["تخفیف", snapshot.discount],
      ["مالیات", snapshot.tax],
      ["ارسال", snapshot.shipping],
      ["مبلغ نهایی", snapshot.total],
      ["پرداخت‌شده", snapshot.paid],
      ["مانده", snapshot.remaining],
    ] as const) {
      line(`${label}: ${money(value)}`, label === "مبلغ نهایی" ? 13 : 10, label === "مبلغ نهایی" ? "#011c3a" : "#172033");
    }
    if (visible("terms") && snapshot.terms) {
      doc.moveDown(0.8);
      line(snapshot.terms, 8, "#64748b");
    }
    if (visible("signature") && snapshot.layout?.signature) line(`امضا: ${snapshot.layout.signature}`, 10);
    if (visible("stamp") && snapshot.layout?.stamp) line(`مهر: ${snapshot.layout.stamp}`, 10);
    if (visible("footer") && snapshot.footer) line(snapshot.footer, 8, "#64748b");
    line("این سند از اسنپ‌شاب زمان صدور تولید شده و با تغییر بعدی اطلاعات مشتری یا قیمت عوض نمی‌شود.", 8, "#94a3b8");
    doc.end();
  });
}
