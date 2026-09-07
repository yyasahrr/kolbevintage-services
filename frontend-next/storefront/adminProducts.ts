import { products, type Product } from "./data/catalog";
import type { ProductTypeId } from "./productSchemas";

export type ProductStatus = "draft" | "review" | "published";
export type AdminVariant = { id:string; colour:string; hex:string; size:string; sku:string; barcode:string; price:number; stock:number; warehouse:string };
export type ProductVersion = { id:string; at:string; status:ProductStatus; summary:string; snapshot?:string };

/** هاتاسپات مکمل — نقطه روی عکس «با این ست کنید» که به یک محصول مکمل لینک میشود */
export type AdminLookHotspot = { id:string; x:number; y:number; label:string; color:string; visible:boolean; productId:string };
export type AdminProductLook = { image:string; hotspots:AdminLookHotspot[] };
export type ProductMediaKind = "image" | "video";
export type ProductMediaRole = "primary" | "gallery" | "detail" | "size";
export type ProductMediaItem = {
  id: string;
  kind: ProductMediaKind;
  src: string;
  poster?: string;
  alt: string;
  role: ProductMediaRole;
  variantColour?: string;
};
export type AdminProductRecord = Product & {
  admin: {
    status: ProductStatus;
    collections: string[];
    tags: string[];
    variants: AdminVariant[];
    customSpecs: Array<{ id:string; label:string; value:string }>;
    versions: ProductVersion[];
    mainImage: number;
    specTemplate: "clothing" | "shoe" | "hat" | "accessory";
    productTypeId?: ProductTypeId;
    attributeValues?: Record<string, string>;
    media?: ProductMediaItem[];
    /** ست پیشنهادی اختصاصی این محصول — عکس محصول روی تن مدل + هاتاسپات مکملها */
    look?: AdminProductLook;
  };
};

export const ADMIN_PRODUCTS_KEY = "kv_admin_products_v2";
export const ADMIN_PRODUCT_TRASH_KEY = "kv_admin_product_trash";

function legacyAttributes(product: Product, type: ProductTypeId): Record<string, string> {
  if (type !== "clothing") return {};
  return {
    composition: product.specs.fibre ?? "",
    fabric: product.specs.fabricType || product.specs.fabric || "",
    fabricWeight: product.specs.weight ?? "",
    stretch: product.specs.stretch ?? "",
    fit: product.specs.styleFor ?? "",
    cut: product.specs.cut ?? "",
    collar: product.specs.collar ?? "",
    sleeve: product.specs.sleeve ?? "",
    closure: product.specs.closure ?? "",
    season: product.specs.season ?? product.season ?? "",
    country: product.specs.country ?? "",
    care: product.specs.care ?? "",
  };
}

function buildLegacyMedia(product: Product): ProductMediaItem[] {
  const imageMedia = product.images.map((src, index) => ({
    id: `image-${product.id}-${index}`,
    kind: "image" as const,
    src,
    alt: `${product.name} — تصویر ${index + 1}`,
    role: (index === 0 ? "primary" : "gallery") as ProductMediaRole,
  }));
  return product.video?.url ? [...imageMedia, {
    id: `video-${product.id}`,
    kind: "video" as const,
    src: product.video.url,
    poster: product.video.poster,
    alt: product.video.title || `ویدئوی ${product.name}`,
    role: "gallery" as const,
  }] : imageMedia;
}

export function normalizeAdminProduct(record: AdminProductRecord): AdminProductRecord {
  const legacyType = record.admin?.specTemplate ?? "clothing";
  const productTypeId = record.admin?.productTypeId ?? legacyType;
  const media = record.admin?.media?.length ? record.admin.media : buildLegacyMedia(record);
  const images = media.filter((item) => item.kind === "image").map((item) => item.src);
  const videoItem = media.find((item) => item.kind === "video");
  const primaryIndex = Math.max(0, media.filter((item) => item.kind === "image").findIndex((item) => item.role === "primary"));
  return {
    ...record,
    images: images.length ? images : record.images,
    video: videoItem ? { url: videoItem.src, poster: videoItem.poster ?? images[0] ?? "", title: videoItem.alt } : record.video,
    admin: {
      ...record.admin,
      mainImage: primaryIndex,
      productTypeId,
      attributeValues: record.admin?.attributeValues ?? legacyAttributes(record, productTypeId),
      media,
      customSpecs: record.admin?.customSpecs ?? [],
      look: record.admin?.look ?? { image: "", hotspots: [] },
    },
  };
}

export function toAdminProduct(product: Product): AdminProductRecord {
  const variants = product.colours.flatMap((colour) => product.sizes.map((size, index) => ({
    id: `${colour.name}-${size.label}`,
    colour: colour.name,
    hex: colour.hex,
    size: size.label,
    sku: `${product.specs.code}-${colour.name.slice(0,2)}-${size.label}`.replace(/\s/g,""),
    barcode: `626${String(product.createdAt).slice(-6)}${String(index).padStart(2,"0")}`,
    price: product.price,
    stock: size.inStock ? 8 : 0,
    warehouse: "انبار مرکزی",
  })));
  const base = { ...product, admin: { status:"published" as const, collections:[], tags:product.badges, variants, customSpecs:[], versions:[{id:`v-${product.createdAt}`,at:new Intl.DateTimeFormat("fa-IR-u-ca-persian").format(new Date(product.createdAt)),status:"published" as const,summary:"نسخه اولیه کاتالوگ"}], mainImage:0, specTemplate:"clothing" as const, productTypeId:"clothing" as const, attributeValues:legacyAttributes(product,"clothing"), media:buildLegacyMedia(product), look:{ image:"", hotspots:[] } } };
  return normalizeAdminProduct(base);
}

export function createAdminProduct(): AdminProductRecord {
  const base = toAdminProduct(products[0]); const now=Date.now();
  return { ...base, id:`admin-${now}`, name:"", latin:"", subtitle:"", price:0, images:[], video:undefined, colours:[], sizes:[], badges:[], rating:0, reviewCount:0, reviews:[], description:"", relatedIds:[], complementaryIds:[], createdAt:now, sold:0, specs:{...base.specs,code:`KV-${String(now).slice(-6)}`,productType:"",fabric:""}, sizeChart:[], admin:{status:"draft",collections:[],tags:[],variants:[],customSpecs:[],versions:[],mainImage:0,specTemplate:"clothing",productTypeId:"clothing",attributeValues:{},media:[],look:{image:"",hotspots:[]}} };
}

export function loadAdminProducts(): AdminProductRecord[] {
  try { const raw=localStorage.getItem(ADMIN_PRODUCTS_KEY); return raw ? (JSON.parse(raw) as AdminProductRecord[]).map(normalizeAdminProduct) : products.map(toAdminProduct); } catch { return products.map(toAdminProduct); }
}

export function saveAdminProducts(items: AdminProductRecord[]) {
  const normalized = items.map(normalizeAdminProduct);
  localStorage.setItem(ADMIN_PRODUCTS_KEY,JSON.stringify(normalized));
  const published = normalized.filter((item) => item.admin.status === "published");
  products.splice(0, products.length, ...published);
}

export function loadProductTrash(): AdminProductRecord[] {
  try { return JSON.parse(localStorage.getItem(ADMIN_PRODUCT_TRASH_KEY) ?? "[]") as AdminProductRecord[]; } catch { return []; }
}

export function saveProductTrash(items: AdminProductRecord[]) {
  localStorage.setItem(ADMIN_PRODUCT_TRASH_KEY, JSON.stringify(items));
}
