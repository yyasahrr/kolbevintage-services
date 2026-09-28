/**
 * کلاینت کاتالوگ عمومی فروشگاه.
 *
 * قاعدهٔ صادقانه (پاسخ ۸۷ و ۷۳ کاربر): نمایش به‌ترتیب اولویت —
 *  ۱) دادهٔ کاتالوگ واقعی از API (`/store/kolbe/catalog/products`).
 *  ۲) در نبود دادهٔ واقعی، در **محیط توسعه** فهرست نمایشی محلی به‌عنوان fallback صریح
 *     با برچسب «دادهٔ نمایشی» (تا صفحه هرگز سفید یا خطا نباشد).
 *  ۳) در محیط تولید بدون دادهٔ واقعی → حالت «خالی» صادقانه، بدون دادهٔ ساختگی.
 *
 * دو قاعدهٔ سخت که در همین فایل تضمین می‌شود:
 *  • **هیچ قیمتی ساخته نمی‌شود.** اگر API قیمت خرده نداشته باشد
 *    (`retail_price: null`)، کارت «قیمت به‌زودی» نشان می‌دهد.
 *  • **هیچ تصویر جعلی جای عکس واقعی نمی‌نشیند.** کالای بدون تصویر، کادر
 *    «تصویر به‌زودی» می‌گیرد؛ عکس یک کالای دیگر قرض گرفته نمی‌شود.
 */
import { useCallback, useEffect, useState } from "react";
import { apiOrNull } from "./api";
import { products as demoProducts, type Product } from "../data/catalog";

export type CatalogAvailability = {
  id: string;
  sku: string | null;
  color: string | null;
  size: string | null;
  available: number;
};

/**
 * شکل خام پاسخ API — عمداً snake_case، چون قرارداد بقیهٔ endpointهای همین ریپو
 * (`available_total`, `color_hex`, …) snake_case است و قرارداد عمومی هم نباید
 * بی‌دلیل از آن جدا شود. نرمال‌سازی به camelCase در همین فایل انجام می‌شود.
 */
export type CatalogProductRaw = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  updated_at: string | null;
  variants: CatalogAvailability[];
  available_total: number;
  retail_price: number | null;
  price_source?: string;
};

export type CatalogState = "loading" | "ready" | "empty" | "error";
export type CatalogSource = "api" | "demo" | "none";

export type CatalogItem = Product & {
  /** قیمت رسمی خرده موجود نیست → UI «قیمت به‌زودی» نشان می‌دهد. */
  pricePending?: boolean;
  /** تصویر رسمی محصول موجود نیست → UI کادر «تصویر به‌زودی» می‌دهد. */
  imagePending?: boolean;
  /** منبع نمایش: کالای واقعی API یا فهرست نمایشی توسعه. */
  origin: CatalogSource;
};

type ApiResponse = { products?: CatalogProductRaw[] };

export function isDemoFallbackAllowed() {
  return process.env.NODE_ENV !== "production";
}

function demoItems(): CatalogItem[] {
  return demoProducts.map((item) => ({ ...item, origin: "demo" as CatalogSource }));
}

/** پاسخ API → شکل مورد انتظار کارت محصول، بدون ساختن هیچ دادهٔ نمایشی. */
export function mapApiProduct(raw: CatalogProductRaw): CatalogItem {
  const updatedAt = raw.updated_at ?? null;
  const availableTotal = Number(raw.available_total ?? 0);
  const retailPrice = typeof raw.retail_price === "number" ? raw.retail_price : null;
  const colours = Array.from(
    new Map(
      raw.variants
        .filter((variant) => variant.color)
        .map((variant) => [String(variant.color), { name: String(variant.color), hex: "#b9a58b", img: "", angle: 0 }]),
    ).values(),
  );
  const sizes = raw.variants
    .filter((variant) => variant.size)
    .map((variant) => ({ label: String(variant.size), inStock: variant.available > 0 }));

  return {
    id: raw.id,
    name: raw.name,
    latin: "",
    subtitle: raw.description ?? "کالای تأمین‌کننده",
    price: retailPrice ?? 0,
    pricePending: retailPrice === null,
    imagePending: true,
    images: [],
    colours,
    sizes,
    style: "classic",
    category: raw.category ?? "other",
    categoryLabel: "دسته‌بندی نشده",
    season: "",
    fabricGroup: "",
    badges: availableTotal > 0 ? ["موجود"] : ["ناموجود"],
    rating: 0,
    reviewCount: 0,
    reviews: [],
    description: raw.description ?? "",
    specs: {} as Product["specs"],
    sizeChart: [],
    sizeAdvice: "",
    relatedIds: [],
    complementaryIds: [],
    createdAt: updatedAt ? new Date(updatedAt).getTime() : Date.now(),
    sold: 0,
    origin: "api",
  };
}

export async function loadCatalog(signal?: AbortSignal): Promise<{ items: CatalogItem[]; source: CatalogSource }> {
  const data = await apiOrNull<ApiResponse>("/store/kolbe/catalog/products", { signal });
  const raw = Array.isArray(data?.products) ? data.products : [];
  if (raw.length === 0) {
    return isDemoFallbackAllowed() ? { items: demoItems(), source: "demo" } : { items: [], source: "none" };
  }
  return { items: raw.map(mapApiProduct), source: "api" };
}

export function useCatalog() {
  const [state, setState] = useState<CatalogState>("loading");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [source, setSource] = useState<CatalogSource>("none");
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => {
    setState("loading");
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    loadCatalog(controller.signal)
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setSource(result.source);
        setState(result.items.length === 0 ? "empty" : "ready");
      })
      .catch((error) => {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
        // خطای شبکه/سرور: در توسعه با فهرست نمایشی ادامه می‌دهیم تا صفحه سفید نشود.
        if (isDemoFallbackAllowed()) {
          setItems(demoItems());
          setSource("demo");
          setState("ready");
        } else {
          setItems([]);
          setSource("none");
          setState("error");
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [nonce]);

  return { state, items, source, retry };
}

/**
 * وضعیت مشترک کاتالوگ برای صفحه‌ها: بارگذاری اسکلتونی، خالی، خطا با تلاش دوباره،
 * و نشانگر «دادهٔ نمایشی» — همه با متن فارسی و بدون دادهٔ ساختگی.
 */
export function CatalogNotice({
  state,
  source,
  onRetry,
  className = "",
}: {
  state: CatalogState;
  source: CatalogSource;
  onRetry?: () => void;
  className?: string;
}) {
  if (state === "loading") {
    return (
      <p className={`kv-label text-[var(--kv-text-muted)] ${className}`} role="status">
        در حال دریافت کالاها…
      </p>
    );
  }
  if (state === "error") {
    return (
      <div className={`flex flex-wrap items-center gap-3 rounded-[var(--kv-radius-control)] border border-[var(--kv-border)] bg-[var(--kv-surface)] px-4 py-3 text-[12px] ${className}`} role="alert">
        <span>دریافت کالاها از سرور ممکن نشد.</span>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="rounded-[var(--kv-radius-control)] border border-[var(--kv-border-strong)] px-3 py-1.5 text-[11.5px]">
            تلاش دوباره
          </button>
        ) : null}
      </div>
    );
  }
  if (state === "empty") {
    return (
      <div className={`rounded-[var(--kv-radius-control)] border border-[var(--kv-border)] bg-[var(--kv-surface)] px-4 py-6 text-[12.5px] text-[var(--kv-text-muted)] ${className}`}>
        هنوز کالایی برای نمایش منتشر نشده است. به‌زودی کالکشن تازه بارگذاری می‌شود.
      </div>
    );
  }
  if (source === "demo") {
    return (
      <p className={`kv-label text-[var(--kv-text-muted)] ${className}`}>
        دادهٔ نمایشی محیط توسعه — کالاهای واقعی از سرور خوانده نشد.
      </p>
    );
  }
  return null;
}

export default useCatalog;
