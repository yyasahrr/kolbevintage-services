/**
 * انتخاب‌گرهای «سری» برای جزئیاتِ محصولِ عمده (فاز ۶.۴).
 *
 * مدلِ UX (تأییدشده با مالک محصول):
 *
 *   رنگ  →  سری/بستهٔ تعریف‌شدهٔ تأمین‌کننده  →  تعدادِ سری
 *
 * نه:
 *
 *   واریانت  →  سایز  →  تعداد
 *
 * ── مرزِ حقیقت ─────────────────────────────────────────────────────────────
 * این ماژول **هیچ حقیقتِ تجاری تولید نمی‌کند**. تنها کاری که می‌کند اتصالِ
 * (join) داده‌هایی است که سرور فرستاده است:
 *
 *  - نام، نوع و ترکیبِ بسته از `wholesale_package` / `wholesale_package_item`
 *    می‌آید (`offer.packages[].items`). هیچ نامی — «سری کامل»، «نیم‌سری» و … —
 *    در اینجا ساخته یا حدس زده نمی‌شود.
 *  - رنگ از ویژگی‌های واقعیِ واریانت‌هایِ همان بسته استخراج می‌شود
 *    (`variants[].attributes.color`)، نه از فهرستِ ثابت.
 *  - تعدادِ قطعات از `package.totalPieces` سرور است و `piecesForSeries` فقط
 *    همان فرمولِ مستندِ `total_pieces = n × pieces_per_package` را برای **فهمِ
 *    خریدار** بازتاب می‌دهد؛ برای پول نیست، به سرور فرستاده نمی‌شود و هیچ
 *    محاسبهٔ تجاری‌ای نیست.
 *  - موجودی (`availablePackages`) عددِ مشورتیِ سرور است؛ اگر سرور آن را نفرستد
 *    اینجا `null` می‌ماند و UI به‌جای حدس، «نامشخص» نشان می‌دهد.
 */

import type { WholesaleOffer, WholesalePackage, WholesaleProductDetail, WholesaleVariant } from "./catalog";

export type SeriesCompositionRow = {
  variantId: string;
  sku: string;
  size: string;
  /** تعدادِ این سایز در **یک** سری — از دستورِ پختِ سرور. */
  quantity: number;
};

export type SeriesOption = {
  id: string;
  /** نامِ اعلام‌شدهٔ تأمین‌کننده (مثلاً «سری کامل»). هرگز در کلاینت ساخته نمی‌شود. */
  name: string;
  packageType: string;
  /** مجموعِ قطعاتِ یک سری — از سرور. */
  totalPieces: number;
  /** موجودیِ مشورتی بر حسبِ **تعداد سری**؛ `null` یعنی سرور عددی اعلام نکرده. */
  availablePackages: number | null;
  /** بسته‌ای که بیش از یک رنگ را در بر می‌گیرد (ترکیبِ رنگ). */
  mixedColor: boolean;
  composition: SeriesCompositionRow[];
};

export type SeriesColorGroup = {
  key: string;
  label: string;
  colorHex: string | null;
  mixed: boolean;
  options: SeriesOption[];
};

export type PieceColorGroup = {
  key: string;
  label: string;
  colorHex: string | null;
  sizes: Array<{ variantId: string; sku: string; size: string }>;
};

/**
 * نردبانِ شناخته‌شدهٔ سایزهای پوشاک — فقط برای **ترتیبِ نمایش**.
 *
 * این فهرست حقیقتِ تجاری نیست و چیزی را فیلتر نمی‌کند: اگر حتی یک سایز از
 * دستورِ پخت ناشناخته باشد، ترتیبِ اعلام‌شدهٔ سرور دست‌نخورده می‌ماند.
 */
const APPAREL_SIZE_LADDER = ["XS", "S", "M", "L", "XL", "2XL", "XXL", "3XL", "XXXL", "4XL", "5XL", "6XL"];

const normalizeSize = (value: string): string => value.trim().toUpperCase().replace(/\s+/g, "");

function ladderIndex(size: string): number | null {
  const index = APPAREL_SIZE_LADDER.indexOf(normalizeSize(size));
  return index === -1 ? null : index;
}

/** ترتیبِ پایدارِ سایزها؛ ناشناخته یعنی اعتماد به ترتیبِ سرور. */
export function orderComposition(rows: SeriesCompositionRow[]): SeriesCompositionRow[] {
  const indices = rows.map((row) => ladderIndex(row.size));
  if (indices.some((index) => index === null)) return rows;
  return rows
    .map((row, position) => ({ row, order: indices[position] as number }))
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.row);
}

function indexVariants(detail: WholesaleProductDetail): Map<string, WholesaleVariant> {
  const byId = new Map<string, WholesaleVariant>();
  for (const variant of detail.variants) byId.set(variant.id, variant);
  return byId;
}

/** رنگ‌های متمایزی که دستورِ پختِ این بسته لمس می‌کند. */
function packageColors(pkg: WholesalePackage, variantsById: Map<string, WholesaleVariant>): { labels: string[]; hexes: string[] } {
  const labels: string[] = [];
  const hexes: string[] = [];
  for (const item of pkg.items) {
    const variant = variantsById.get(item.variantId);
    if (!variant) continue;
    const label = variant.color.trim();
    if (label.length > 0 && !labels.includes(label)) labels.push(label);
    const hex = variant.colorHex.trim();
    if (hex.length > 0 && !hexes.includes(hex)) hexes.push(hex);
  }
  return { labels, hexes };
}

export function seriesOptionFromPackage(
  pkg: WholesalePackage,
  variantsById: Map<string, WholesaleVariant>,
): SeriesOption {
  const composition = orderComposition(
    pkg.items.map((item) => {
      const variant = variantsById.get(item.variantId);
      return {
        variantId: item.variantId,
        sku: variant?.sku ?? "",
        size: variant?.size ?? "",
        quantity: item.quantity,
      };
    }),
  );
  const { labels } = packageColors(pkg, variantsById);
  // رنگ در خودِ آپشن نگه داشته نمی‌شود: متعلق به **گروه** است و در
  // `groupSeriesByColor` محاسبه می‌شود تا دو بستهٔ هم‌رنگ یک رنگِ واحد بسازند.
  return {
    id: pkg.id,
    name: pkg.name,
    packageType: pkg.packageType,
    totalPieces: pkg.totalPieces,
    availablePackages: pkg.availablePackages,
    mixedColor: labels.length > 1,
    composition,
  };
}

/**
 * سری‌های یک پیشنهاد، گروه‌بندی‌شده بر اساسِ رنگِ واقعیِ دستورِ پخت.
 *
 * ⚠️ فرضِ «همهٔ رنگ‌ها بسته‌های یکسان دارند» اینجا وجود ندارد: هر رنگ فقط
 * بسته‌های خودش را نشان می‌دهد و تعداد/نامِ بسته‌ها می‌تواند متفاوت باشد.
 */
export function groupSeriesByColor(detail: WholesaleProductDetail, offer: WholesaleOffer): SeriesColorGroup[] {
  const variantsById = indexVariants(detail);
  const groups = new Map<string, SeriesColorGroup>();
  const order: string[] = [];

  for (const pkg of offer.packages) {
    const option = seriesOptionFromPackage(pkg, variantsById);
    const { labels, hexes } = packageColors(pkg, variantsById);
    const mixed = labels.length > 1;
    const unknown = labels.length === 0;
    const key = mixed ? `mixed:${labels.join("|")}` : unknown ? "unknown" : `color:${labels[0]}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: mixed ? labels.join(" + ") : unknown ? "رنگ نامشخص" : labels[0]!,
        colorHex: mixed || unknown ? null : (hexes[0] ?? null),
        mixed,
        options: [],
      };
      groups.set(key, group);
      order.push(key);
    }
    group.options.push(option);
  }

  return order.map((key) => groups.get(key)!);
}

/** همهٔ سری‌های یک پیشنهاد، بدون گروه‌بندی (برای حالت‌های خلاصه/تک‌رنگ). */
export function seriesOptionsForOffer(detail: WholesaleProductDetail, offer: WholesaleOffer): SeriesOption[] {
  const variantsById = indexVariants(detail);
  return offer.packages.map((pkg) => seriesOptionFromPackage(pkg, variantsById));
}

/* ── حالتِ PIECE: رنگ → سایز (بدون سری) ─────────────────────────────────── */

/**
 * برای پیشنهادهای `PIECE` هیچ بسته‌ای وجود ندارد و مدلِ درست همان مدلِ
 * خرده‌فروشی است: رنگ → سایز. واریانت اینجا primary selector است چون
 * پیشنهاد واقعاً تک‌واریانتی است — نه چون کلاینت تصمیم گرفته است.
 */
export function pieceColorGroups(detail: WholesaleProductDetail): PieceColorGroup[] {
  const groups = new Map<string, PieceColorGroup>();
  const order: string[] = [];
  for (const variant of detail.variants) {
    const label = variant.color.trim();
    const key = label.length > 0 ? `color:${label}` : "unknown";
    let group = groups.get(key);
    if (!group) {
      group = { key, label: label.length > 0 ? label : "رنگ نامشخص", colorHex: variant.colorHex.trim() || null, sizes: [] };
      groups.set(key, group);
      order.push(key);
    }
    group.sizes.push({ variantId: variant.id, sku: variant.sku, size: variant.size });
  }
  return order.map((key) => {
    const group = groups.get(key)!;
    const laddered = group.sizes.map((entry, position) => ({ entry, order: ladderIndex(entry.size) ?? Number.MAX_SAFE_INTEGER, position }));
    const allKnown = laddered.every((row) => row.order !== Number.MAX_SAFE_INTEGER);
    return {
      ...group,
      sizes: (allKnown ? [...laddered].sort((a, b) => a.order - b.order) : laddered).map((row) => row.entry),
    };
  });
}

/* ── ریاضیِ **نمایشی** ───────────────────────────────────────────────────── */

/**
 * بازتابِ فرمولِ مستندِ `total_pieces = series_count × pieces_per_package`
 * (docs/architecture/quantity-and-package-model.md).
 *
 * این عدد فقط به یک پرسشِ انسانی جواب می‌دهد: «چند لباس می‌گیرم؟» دو ورودیِ آن
 * هر دو حقیقتِ سرور است (`package.totalPieces`) یا انتخابِ خامِ خریدار
 * (تعدادِ سری). برای پول نیست، به سرور فرستاده نمی‌شود و در هیچ تصمیمِ
 * تجاری‌ای شرکت ندارد — قیمت و موجودی همچنان مرجعِ سرورند.
 */
export function piecesForSeries(option: SeriesOption, seriesCount: number): number {
  if (!Number.isSafeInteger(seriesCount) || seriesCount <= 0) return 0;
  return option.totalPieces * seriesCount;
}

/** کمینه/بیشینهٔ استپر بر حسبِ **سری**، با MOQ و موجودیِ مشورتیِ سرور. */
export function seriesStepperBounds(option: SeriesOption, moq: number): { min: number; max: number | null } {
  const min = Number.isSafeInteger(moq) && moq > 0 ? moq : 1;
  const max = option.availablePackages === null ? null : Math.max(min, option.availablePackages);
  return { min, max };
}
