import { products, type Product } from "./data/catalog";

export type ProductStatus = "draft" | "review" | "published";
export type AdminVariant = { id:string; colour:string; hex:string; size:string; sku:string; barcode:string; price:number; stock:number; warehouse:string };
export type ProductVersion = { id:string; at:string; status:ProductStatus; summary:string; snapshot?:string };
export type AdminProductRecord = Product & {
  admin: {
    status: ProductStatus;
    collections: string[];
    tags: string[];
    variants: AdminVariant[];
    customSpecs: Array<{ id:string; label:string; value:string }>;
    versions: ProductVersion[];
    mainImage: number;
  };
};

export const ADMIN_PRODUCTS_KEY = "kv_admin_products_v2";
export const ADMIN_PRODUCT_TRASH_KEY = "kv_admin_product_trash";

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
  return { ...product, admin: { status:"published", collections:[], tags:product.badges, variants, customSpecs:[], versions:[{id:`v-${product.createdAt}`,at:new Intl.DateTimeFormat("fa-IR").format(new Date(product.createdAt)),status:"published",summary:"نسخه اولیه کاتالوگ"}], mainImage:0 } };
}

export function createAdminProduct(): AdminProductRecord {
  const base = toAdminProduct(products[0]); const now=Date.now();
  return { ...base, id:`admin-${now}`, name:"", latin:"", subtitle:"", price:0, images:[], video:undefined, colours:[], sizes:[], badges:[], rating:0, reviewCount:0, reviews:[], description:"", relatedIds:[], complementaryIds:[], createdAt:now, sold:0, specs:{...base.specs,code:`KV-${String(now).slice(-6)}`,productType:"",fabric:""}, sizeChart:[], admin:{status:"draft",collections:[],tags:[],variants:[],customSpecs:[],versions:[],mainImage:0} };
}

export function loadAdminProducts(): AdminProductRecord[] {
  try { const raw=localStorage.getItem(ADMIN_PRODUCTS_KEY); return raw ? JSON.parse(raw) as AdminProductRecord[] : products.map(toAdminProduct); } catch { return products.map(toAdminProduct); }
}

export function saveAdminProducts(items: AdminProductRecord[]) {
  localStorage.setItem(ADMIN_PRODUCTS_KEY,JSON.stringify(items));
  const published = items.filter((item) => item.admin.status === "published");
  products.splice(0, products.length, ...published);
}

export function loadProductTrash(): AdminProductRecord[] {
  try { return JSON.parse(localStorage.getItem(ADMIN_PRODUCT_TRASH_KEY) ?? "[]") as AdminProductRecord[]; } catch { return []; }
}

export function saveProductTrash(items: AdminProductRecord[]) {
  localStorage.setItem(ADMIN_PRODUCT_TRASH_KEY, JSON.stringify(items));
}
