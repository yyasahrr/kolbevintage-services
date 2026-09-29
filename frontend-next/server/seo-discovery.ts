import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { makeId, rows } from "./database";

type Json = Record<string, any>;

export const SEO_PERMISSIONS = ["seo:read", "seo:manage", "seo:redirects", "seo:technical", "seo:integrations"] as const;

const POLICIES = new Set(["disabled", "enabled", "disabled_when_discounted", "enabled_when_discounted"]);

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function slugify(value: string) {
  const cleaned = value.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}-]+/gu, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (cleaned || "item").slice(0, 80);
}

export function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

export function googlePreview(title: string, description: string, url: string) {
  return {
    title: title.slice(0, 60),
    description: description.slice(0, 160),
    url,
    titleLength: title.length,
    descriptionLength: description.length,
    titleOverflow: title.length > 60,
    descriptionOverflow: description.length > 160,
  };
}

function jsonLdScript(data: unknown) {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}

export async function loadShippingOffers() {
  const rules = await rows<any>(
    `SELECT m.label, r.config FROM shipping_rule r
     JOIN shipping_method m ON m.id = r.method_id
     WHERE r.active AND m.active AND r.rule_type = 'flat_rate'
     ORDER BY m.id`,
  );
  return rules
    .map((rule) => ({
      "@type": "OfferShippingDetails",
      shippingRate: { "@type": "MonetaryAmount", value: Number(rule.config?.amount ?? 0), currency: "IRR" },
      shippingDestination: { "@type": "DefinedRegion", addressCountry: "IR" },
      name: rule.label,
    }))
    .filter((offer) => Number.isFinite(offer.shippingRate.value) && offer.shippingRate.value > 0);
}

export async function organizationJsonLd(origin: string) {
  const setting = (await rows<any>("SELECT value FROM site_setting WHERE setting_key='seo_organization' LIMIT 1"))[0]?.value ?? {};
  const data: Json = {
    "@context": "https://schema.org",
    "@type": ["Organization", "OnlineStore"],
    name: setting.name || "کلبه وینتیج",
    description: setting.description || "پوشاک کلاسیک و وینتیج با دوخت دست",
  };
  if (origin) data.url = origin;
  if (setting.telephone) data.telephone = setting.telephone;
  if (setting.logo) data.logo = setting.logo;
  return data;
}

type PublicProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  salePrice: number | null;
  slug: string;
  category: string;
  image: string | null;
  srcSet: string | null;
  index: boolean;
  follow: boolean;
  canonical: string;
  seoTitle: string;
  seoDescription: string;
  variants: Array<{ sku: string; color: string; size: string; price: number; available: number; onHand: number; image: string | null }>;
  reviews: number;
  rating: number | null;
};

export async function loadPublicProduct(slug: string): Promise<PublicProduct | null> {
  const retail = (await rows<any>(
    `SELECT * FROM retail_product WHERE (slug=$1 OR id=$1) AND active=true AND owner_type='kolbe' AND retail_enabled=true LIMIT 1`,
    [slug],
  ))[0];
  const owned = (await rows<any>(
    `SELECT * FROM supplier_product WHERE (slug=$1 OR id=$1) AND owner_type='kolbe' AND retail_enabled=true AND status='approved' LIMIT 1`,
    [slug],
  ))[0];
  const blocked = (await rows<any>(
    "SELECT id FROM supplier_product WHERE owner_type='supplier' AND (id=$1 OR slug=$1) LIMIT 1",
    [retail?.id ?? slug],
  ))[0];
  if (blocked && (!retail || blocked.id === retail.id)) return null;
  const product = owned;
  const source = retail ?? product;
  if (!source) return null;
  const doc = (await rows<any>(
    `SELECT * FROM seo_document WHERE entity_id=$1 OR slug=$2 ORDER BY updated_at DESC LIMIT 1`,
    [source.id, source.slug || slug],
  ))[0];
  const template = (await rows<any>("SELECT * FROM seo_template WHERE entity_type='product' AND active=true ORDER BY updated_at DESC LIMIT 1"))[0];
  const vars = {
    "product.name": source.name,
    "product.description": source.description || "",
    "product.price": String(source.sale_price ?? source.retail_cash_price ?? source.price ?? source.wholesale_price ?? ""),
    "store.name": "کلبه وینتیج",
    "category.name": source.category || "",
  };
  const seoTitle = doc?.seo_title || (template ? renderTemplate(template.title_template, vars) : `${source.name} | کلبه وینتیج`);
  const seoDescription = doc?.meta_description || (template ? renderTemplate(template.description_template, vars) : String(source.description || source.name));
  const variants = await rows<any>(
      `SELECT v.sku, v.color, v.size, v.cost, v.color_hex,
              COALESCE(b.on_hand, i.on_hand, 0)::int AS on_hand,
              COALESCE(b.reserved, i.reserved, 0)::int AS reserved
       FROM supplier_variant v
       LEFT JOIN supplier_inventory i ON i.variant_id=v.id
       LEFT JOIN (
         SELECT variant_id, SUM(on_hand)::int AS on_hand, SUM(reserved)::int AS reserved
         FROM inventory_balance GROUP BY variant_id
       ) b ON b.variant_id=v.id
       WHERE v.product_id=$1`,
    [source.id],
  );
  const media = await rows<any>("SELECT * FROM media_asset WHERE entity_id=$1 AND role='original' ORDER BY created_at", [source.id]);
  const webp = media[0] ? (await rows<any>("SELECT id, width FROM media_asset WHERE parent_id=$1 AND role='webp' LIMIT 1", [media[0].id]))[0] : null;
  const review = (await rows<any>("SELECT COUNT(*)::int AS count, AVG(rating)::float AS rating FROM product_review WHERE product_id=$1 AND status='approved'", [source.id]))[0];
  const price = Number(source.sale_price ?? source.retail_cash_price ?? source.price ?? source.wholesale_price ?? 0);
  return {
    id: source.id,
    name: source.name,
    description: source.description || "",
    price: Number(source.price ?? source.retail_cash_price ?? source.wholesale_price ?? 0),
    salePrice: source.sale_price == null ? null : Number(source.sale_price),
    slug: source.slug || source.id,
    category: source.category || "فروشگاه",
    image: media[0]?.id ? `/store/kolbe/media/${media[0].id}` : source.image_url || null,
    srcSet: webp?.id ? `/store/kolbe/media/${webp.id} ${webp.width || 800}w` : null,
    index: doc ? doc.robots_index !== false : true,
    follow: doc ? doc.robots_follow !== false : true,
    canonical: doc?.canonical || `/product/${source.slug || source.id}`,
    seoTitle,
    seoDescription,
    variants: variants.map((variant) => ({
      sku: variant.sku,
      color: variant.color,
      size: variant.size,
      price: Number(variant.cost || price),
      onHand: Number(variant.on_hand),
      available: Number(variant.on_hand) - Number(variant.reserved),
      image: media.find((item) => item.variant_color === variant.color)?.id
        ? `/store/kolbe/media/${media.find((item) => item.variant_color === variant.color).id}`
        : null,
    })),
    reviews: Number(review?.count ?? 0),
    rating: review?.count ? Number(review.rating) : null,
  };
}

export function selectVariant(product: PublicProduct, color?: string | null, size?: string | null) {
  if (!product.variants.length) return null;
  return product.variants.find((variant) => (!color || variant.color === color) && (!size || variant.size === size)) ?? null;
}

export function productStructuredData(product: PublicProduct, origin: string, variant: PublicProduct["variants"][number] | null, shippingDetails: unknown[] = []) {
  const url = `${origin}/product/${product.slug}`;
  const offer = (itemUrl: string, price: number, inStock: boolean) => ({
    "@type": "Offer",
    url: itemUrl,
    priceCurrency: "IRR",
    price,
    availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    shippingDetails,
  });
  const crumbs = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "خانه", item: `${origin}/` },
      { "@type": "ListItem", position: 2, name: product.category, item: `${origin}/shop` },
      { "@type": "ListItem", position: 3, name: product.name, item: url },
    ],
  };
  const graph: Json[] = [crumbs];
  if (product.variants.length) {
    graph.push({
      "@type": "ProductGroup",
      name: product.name,
      description: product.description || product.seoDescription,
      url,
      productGroupID: product.id,
      hasVariant: product.variants.map((item) => {
        const itemUrl = `${url}?color=${encodeURIComponent(item.color)}&size=${encodeURIComponent(item.size)}`;
        const node: Json = {
          "@type": "Product",
          name: `${product.name} ${item.color} ${item.size}`,
          sku: item.sku,
          color: item.color,
          size: item.size,
          image: item.image ? `${origin}${item.image}` : undefined,
          offers: offer(itemUrl, item.price, item.available > 0),
        };
        return node;
      }),
    });
  } else {
    const node: Json = {
      "@type": "Product",
      name: product.name,
      description: product.description || product.seoDescription,
      sku: product.id,
      image: product.image ? `${origin}${product.image}` : undefined,
      offers: offer(variant ? `${url}?color=${encodeURIComponent(variant.color)}&size=${encodeURIComponent(variant.size)}` : url, variant?.price ?? product.salePrice ?? product.price, variant ? variant.available > 0 : true),
    };
    graph.push(node);
  }
  if (product.reviews > 0 && product.rating) {
    graph.push({ "@type": "Product", sku: product.id, aggregateRating: { "@type": "AggregateRating", ratingValue: product.rating, reviewCount: product.reviews } });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

export function renderProductDocument(product: PublicProduct, origin: string, query: URLSearchParams, shippingDetails: unknown[] = []) {
  const color = query.get("color");
  const size = query.get("size");
  const extra = [...query.keys()].filter((key) => !["color", "size"].includes(key));
  const variant = selectVariant(product, color, size);
  const variantRequested = Boolean(color || size);
  if (variantRequested && !variant) return null;
  const facets = { color: true, size: true };
  const variantIndexable = Boolean(variant) && facets.color && facets.size && extra.length === 0;
  const index = product.index && (variant ? variantIndexable : extra.length === 0);
  const canonicalPath = variant && variantIndexable
    ? `/product/${product.slug}?color=${encodeURIComponent(variant.color)}&size=${encodeURIComponent(variant.size)}`
    : product.canonical.startsWith("http") ? product.canonical : `/product/${product.slug}`;
  const price = variant?.price ?? product.salePrice ?? product.price;
  const tracked = Boolean(variant) || product.variants.length > 0;
  const available = variant ? variant.available : product.variants.reduce((sum, item) => sum + item.available, 0);
  const onHand = variant ? variant.onHand : product.variants.reduce((sum, item) => sum + item.onHand, 0);
  const image = variant?.image || product.image;
  const title = product.seoTitle;
  const description = product.seoDescription;
  const inStock = tracked ? available > 0 : true;
  const availability = inStock ? "موجود" : "ناموجود";
  const json = productStructuredData(product, origin, variant, shippingDetails);
  const src = image ? (image.startsWith("http") ? image : `${origin}${image}`) : "";
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(origin + canonicalPath)}" />
  <meta name="robots" content="${index ? "index" : "noindex"},${product.follow ? "follow" : "nofollow"}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:type" content="product" />
  <meta property="og:url" content="${escapeHtml(origin + canonicalPath)}" />
  ${src ? `<meta property="og:image" content="${escapeHtml(src)}" />` : ""}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
</head>
<body>
  <nav aria-label="مسیر راهنما"><a href="/">خانه</a> / <a href="/shop">${escapeHtml(product.category)}</a> / <span>${escapeHtml(product.name)}</span></nav>
  <article>
    <h1>${escapeHtml(product.name)}</h1>
    ${src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(product.name)}" ${product.srcSet ? `srcset="${escapeHtml(product.srcSet)}" sizes="(max-width: 768px) 100vw, 480px"` : ""} width="800" height="1000" fetchpriority="high" loading="eager" decoding="async" />` : ""}
    <p data-price="${price}">${price.toLocaleString("fa-IR")} تومان</p>
    <p data-availability="${availability}" ${tracked ? `data-on-hand="${onHand}" data-available="${available}"` : ""}>${availability}</p>
    ${variant ? `<p data-color="${escapeHtml(variant.color)}" data-size="${escapeHtml(variant.size)}">رنگ ${escapeHtml(variant.color)} · سایز ${escapeHtml(variant.size)}</p>` : ""}
    <p>${escapeHtml(product.description)}</p>
  </article>
  <script type="application/ld+json">${jsonLdScript(json)}</script>
</body>
</html>`;
}

function xmlEscape(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export async function sitemapEntries(kind: string, origin: string) {
  const facets = (await rows<any>("SELECT value FROM site_setting WHERE setting_key='seo_facets' LIMIT 1"))[0]?.value ?? {};
  const indexableVariant = facets.color?.indexable !== false && facets.size?.indexable !== false;
  const docs = await rows<any>("SELECT * FROM seo_document");
  const noindex = new Set(docs.filter((doc) => doc.robots_index === false).map((doc) => doc.entity_id));
  const canonicalOf = new Map(docs.filter((doc) => doc.canonical).map((doc) => [doc.entity_id, doc.canonical as string]));
  const entries: Array<{ loc: string; lastmod?: string; images?: string[] }> = [];
  if (kind === "products") {
    const retail = await rows<any>("SELECT id, slug, updated_at FROM retail_product WHERE active AND owner_type='kolbe' AND retail_enabled");
    const kolbe = await rows<any>("SELECT id, slug, updated_at FROM supplier_product WHERE owner_type='kolbe' AND retail_enabled AND status='approved'");
    const seen = new Set<string>();
    for (const product of [...retail, ...kolbe]) {
      if (seen.has(product.id) || noindex.has(product.id)) continue;
      seen.add(product.id);
      const slug = product.slug || product.id;
      const canonical = canonicalOf.get(product.id);
      const loc = canonical && canonical.startsWith("http") ? canonical : `${origin}/product/${slug}`;
      if (canonical && !canonical.endsWith(`/product/${slug}`) && !canonical.endsWith(slug)) continue;
      entries.push({ loc, lastmod: product.updated_at?.toISOString?.() });
      if (indexableVariant) {
        const variants = await rows<any>("SELECT color, size FROM supplier_variant WHERE product_id=$1", [product.id]);
        for (const variant of variants) {
          entries.push({ loc: `${origin}/product/${slug}?color=${encodeURIComponent(variant.color)}&size=${encodeURIComponent(variant.size)}`, lastmod: product.updated_at?.toISOString?.() });
        }
      }
    }
  }
  if (kind === "categories") {
    const categories = await rows<any>("SELECT slug, updated_at FROM catalog_category");
    for (const category of categories) entries.push({ loc: `${origin}/shop?cat=${encodeURIComponent(category.slug)}`, lastmod: category.updated_at?.toISOString?.() });
  }
  if (kind === "pages" || kind === "blog") {
    const types = kind === "blog" ? ["blog"] : ["cms", "landing", "page"];
    for (const doc of docs.filter((item) => types.includes(item.entity_type) && item.robots_index !== false && item.slug)) {
      entries.push({ loc: `${origin}/${doc.entity_type === "blog" ? "journal" : "pages"}/${doc.slug}`, lastmod: doc.updated_at?.toISOString?.() });
    }
  }
  if (kind === "images") {
    const images = await rows<any>("SELECT id, entity_id, alt FROM media_asset WHERE role='original'");
    for (const image of images) {
      if (noindex.has(image.entity_id)) continue;
      entries.push({ loc: `${origin}/store/kolbe/media/${image.id}`, images: [`${origin}/store/kolbe/media/${image.id}`] });
    }
  }
  return entries;
}

export function renderUrlSet(entries: Array<{ loc: string; lastmod?: string; images?: string[] }>) {
  const body = entries.map((entry) => `  <url><loc>${xmlEscape(entry.loc)}</loc>${entry.lastmod ? `<lastmod>${xmlEscape(entry.lastmod)}</lastmod>` : ""}${
    (entry.images ?? []).map((image) => `<image:image><image:loc>${xmlEscape(image)}</image:loc></image:image>`).join("")
  }</url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${body}\n</urlset>\n`;
}

export function renderSitemapIndex(origin: string) {
  const kinds = ["products", "categories", "pages", "blog", "images"];
  const body = kinds.map((kind) => `  <sitemap><loc>${xmlEscape(`${origin}/sitemaps/${kind}.xml`)}</loc></sitemap>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

export async function robotsBody() {
  const stored = (await rows<any>("SELECT value FROM site_setting WHERE setting_key='seo_robots' LIMIT 1"))[0]?.value?.body;
  return stored || "User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /supplier\n";
}

export async function recordNotFound(path: string, referrer: string | null) {
  const fingerprint = createHash("sha256").update(path).digest("hex").slice(0, 24);
  await rows(
    `INSERT INTO seo_404 (id, path, referrer, hit_count, fingerprint, first_seen_at, last_seen_at)
     VALUES ($1,$2,$3,1,$4,now(),now())
     ON CONFLICT (fingerprint) DO UPDATE SET hit_count=seo_404.hit_count+1, last_seen_at=now(), referrer=COALESCE(EXCLUDED.referrer, seo_404.referrer)`,
    [makeId("s404"), path.slice(0, 300), referrer?.slice(0, 300) ?? null, fingerprint],
  );
}

export async function resolveRedirect(path: string) {
  return (await rows<any>("SELECT * FROM seo_redirect WHERE source_path=$1 AND active=true LIMIT 1", [path]))[0] ?? null;
}

export async function assertRedirectSafe(source: string, target: string, status: number) {
  if (![301, 302, 410].includes(status)) throw new Error("INVALID_REDIRECT");
  if (status !== 410 && source === target) throw new Error("REDIRECT_LOOP");
  const seen = new Set([source]);
  let cursor = target;
  for (let hop = 0; hop < 8 && status !== 410; hop += 1) {
    if (seen.has(cursor)) throw new Error("REDIRECT_LOOP");
    seen.add(cursor);
    const next = (await rows<any>("SELECT target_path, status_code FROM seo_redirect WHERE source_path=$1 AND active=true LIMIT 1", [cursor]))[0];
    if (!next || next.status_code === 410) break;
    cursor = next.target_path;
  }
}

async function issue(client: PoolClient, crawlId: string, code: string, severity: "error" | "warning" | "notice", message: string, path: string, entityId?: string) {
  const fingerprint = createHash("sha256").update(`${code}|${path}|${entityId ?? ""}`).digest("hex").slice(0, 32);
  await client.query(
    `INSERT INTO seo_issue (id, crawl_id, fingerprint, code, severity, message, path, entity_id, status, first_seen_at, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',now(),now())
     ON CONFLICT (fingerprint) DO UPDATE SET status='open', last_seen_at=now(), crawl_id=EXCLUDED.crawl_id, severity=EXCLUDED.severity, message=EXCLUDED.message`,
    [makeId("siss"), crawlId, fingerprint, code, severity, message, path, entityId ?? null],
  );
  return fingerprint;
}

export async function runSeoCrawl(actorId: string | null) {
  const previous = new Set((await rows<any>("SELECT fingerprint FROM seo_issue WHERE status='open'")).map((row) => row.fingerprint));
  const crawlId = makeId("scrawl");
  const started = Date.now();
  const seen = new Set<string>();
  const db = await import("./database");
  await db.transaction(async (client) => {
    const docs = (await client.query("SELECT * FROM seo_document")).rows as any[];
    const titles = new Map<string, number>();
    for (const doc of docs) titles.set(doc.seo_title || "", (titles.get(doc.seo_title || "") ?? 0) + 1);
    const canonicals = new Map<string, number>();
    for (const doc of docs) if (doc.canonical) canonicals.set(doc.canonical, (canonicals.get(doc.canonical) ?? 0) + 1);
    for (const doc of docs) {
      const path = `/${doc.entity_type}/${doc.slug || doc.id}`;
      if (!doc.seo_title) seen.add(await issue(client, crawlId, "missing_title", "error", "عنوان سئو خالی است", path, doc.id));
      if (doc.seo_title && (titles.get(doc.seo_title) ?? 0) > 1) seen.add(await issue(client, crawlId, "duplicate_title", "warning", "عنوان سئو تکراری است", path, doc.id));
      if (!doc.meta_description) seen.add(await issue(client, crawlId, "missing_description", "warning", "توضیح متا خالی است", path, doc.id));
      if (!doc.h1) seen.add(await issue(client, crawlId, "missing_h1", "error", "H1 ثبت نشده است", path, doc.id));
      if (Number(doc.h1_count ?? 1) > 1) seen.add(await issue(client, crawlId, "multiple_h1", "warning", "بیش از یک H1", path, doc.id));
      if (!doc.canonical) seen.add(await issue(client, crawlId, "missing_canonical", "warning", "کنونیکال ندارد", path, doc.id));
      if (doc.canonical && (canonicals.get(doc.canonical) ?? 0) > 1) seen.add(await issue(client, crawlId, "conflicting_canonical", "error", "کنونیکال تکراری است", path, doc.id));
      if (doc.canonical?.startsWith("http://")) seen.add(await issue(client, crawlId, "http_on_https", "warning", "نشانی HTTP روی سایت HTTPS", path, doc.id));
      if (doc.robots_index === false) seen.add(await issue(client, crawlId, "noindex_review", "notice", "صفحه noindex است و نباید در سایت‌مپ باشد", path, doc.id));
      if (doc.entity_type === "product") {
        const priced = (await client.query("SELECT id, price FROM retail_product WHERE id=$1 UNION ALL SELECT id, retail_cash_price FROM supplier_product WHERE id=$1", [doc.entity_id])).rows[0] as any;
        if (!priced) seen.add(await issue(client, crawlId, "missing_product_schema", "error", "داده محصول برای اسکیما پیدا نشد", path, doc.id));
        else if (priced.price == null && priced.retail_cash_price == null) seen.add(await issue(client, crawlId, "invalid_structured_data", "error", "قیمت واقعی برای Offer وجود ندارد", path, doc.id));
      }
    }
    const products = (await client.query("SELECT id, name, slug FROM retail_product WHERE active AND owner_type='kolbe' AND retail_enabled")).rows as any[];
    for (const product of products) {
      if (!docs.some((doc) => doc.entity_id === product.id)) seen.add(await issue(client, crawlId, "missing_product_schema", "warning", "محصول سند سئو و Breadcrumb اختصاصی ندارد", `/product/${product.slug || product.id}`, product.id));
    }
    const broken = (await client.query("SELECT path, hit_count FROM seo_404 ORDER BY hit_count DESC LIMIT 50")).rows as any[];
    for (const row of broken) seen.add(await issue(client, crawlId, "http_404", "error", `صفحه ۴۰۴ با ${row.hit_count} بازدید`, row.path));
    const redirects = (await client.query("SELECT source_path, target_path, status_code FROM seo_redirect WHERE active")).rows as any[];
    for (const redirect of redirects) {
      const next = redirects.find((item) => item.source_path === redirect.target_path);
      if (next) seen.add(await issue(client, crawlId, "redirect_chain", next.target_path === redirect.source_path ? "error" : "warning", "زنجیره یا حلقه ریدایرکت", redirect.source_path));
    }
    const media = (await client.query("SELECT id, entity_id, alt, byte_size, filename FROM media_asset WHERE role='original'")).rows as any[];
    for (const asset of media) {
      if (!asset.alt) seen.add(await issue(client, crawlId, "missing_alt", "warning", "متن جایگزین تصویر خالی است", `/store/kolbe/media/${asset.id}`, asset.entity_id));
      if (Number(asset.byte_size ?? 0) > 500_000) seen.add(await issue(client, crawlId, "large_image", "warning", "تصویر بزرگ‌تر از ۵۰۰ کیلوبایت است", `/store/kolbe/media/${asset.id}`, asset.entity_id));
      if (!asset.filename) seen.add(await issue(client, crawlId, "broken_image", "error", "فایل تصویر ناقص است", `/store/kolbe/media/${asset.id}`, asset.entity_id));
    }
    const linked = new Set<string>(["/", "/shop", "/journal", "/styles", "/wholesale"]);
    for (const doc of docs) for (const link of doc.links ?? []) linked.add(link);
    for (const doc of docs) {
      const path = `/${doc.entity_type}/${doc.slug || doc.id}`;
      if (!linked.has(path) && !linked.has(`/${doc.slug}`) && doc.entity_type !== "product") {
        seen.add(await issue(client, crawlId, "orphan_page", "warning", "صفحه لینک داخلی ندارد", path, doc.id));
      }
      if (doc.parent_id && !docs.some((item) => item.id === doc.parent_id)) seen.add(await issue(client, crawlId, "broken_architecture", "warning", "والد معماری سایت پیدا نشد", path, doc.id));
    }
    const vitals = (await client.query("SELECT * FROM seo_vital ORDER BY measured_at DESC LIMIT 1")).rows[0] as any;
    if (vitals) {
      if (Number(vitals.lcp_ms) > 2500 || Number(vitals.inp_ms) >= 200 || Number(vitals.cls) >= 0.1) {
        seen.add(await issue(client, crawlId, "slow_page", "warning", "سنجه حیاتی وب از آستانه داخلی بدتر است", vitals.path || "/"));
      }
    }
    await client.query("UPDATE seo_issue SET status='fixed', fixed_at=now() WHERE status='open' AND NOT (fingerprint = ANY($1::text[]))", [[...seen]]);
    await client.query(
      `INSERT INTO seo_crawl (id, actor_id, schedule, started_at, finished_at, duration_ms, new_count, fixed_count, remaining_count)
       VALUES ($1,$2,$3,now(),now(),$4,$5,$6,$7)`,
      [crawlId, actorId, "manual", Date.now() - started, [...seen].filter((item) => !previous.has(item)).length, [...previous].filter((item) => !seen.has(item)).length, seen.size],
    );
  });
  const crawl = (await rows<any>("SELECT * FROM seo_crawl WHERE id=$1", [crawlId]))[0];
  return {
    id: crawlId,
    added: Number(crawl?.new_count ?? 0),
    fixed: Number(crawl?.fixed_count ?? 0),
    remaining: Number(crawl?.remaining_count ?? 0),
    disclaimer: "امتیاز سلامت سئو یک شاخص عملیاتی داخلی است و رتبه گوگل نیست.",
  };
}

export async function seoHealth() {
  const open = await rows<any>("SELECT severity, COUNT(*)::int AS count FROM seo_issue WHERE status='open' GROUP BY severity");
  const counts = Object.fromEntries(open.map((row) => [row.severity, row.count]));
  const errors = counts.error ?? 0;
  const warnings = counts.warning ?? 0;
  const notices = counts.notice ?? 0;
  const score = Math.max(0, Math.min(100, 100 - errors * 8 - warnings * 3 - notices));
  const vitals = (await rows<any>("SELECT * FROM seo_vital ORDER BY measured_at DESC LIMIT 5"));
  return {
    score,
    kind: "operational",
    disclaimer: "این امتیاز سلامت عملیاتی داخلی است، نه ادعای رتبه یا نتیجه گوگل.",
    errors, warnings, notices,
    thresholds: { lcpMs: 2500, inpMs: 200, cls: 0.1 },
    vitals: vitals.map((row) => ({
      path: row.path,
      lcpMs: row.lcp_ms,
      inpMs: row.inp_ms,
      cls: Number(row.cls),
      lcpPass: row.lcp_ms == null ? null : Number(row.lcp_ms) <= 2500,
      inpPass: row.inp_ms == null ? null : Number(row.inp_ms) < 200,
      clsPass: row.cls == null ? null : Number(row.cls) < 0.1,
      measuredAt: row.measured_at,
    })),
  };
}

export function merchantReadiness(product: { name?: string; price?: number | null; image?: string | null; available?: number | null }) {
  const missing = [];
  if (!product.name) missing.push("title");
  if (product.price == null) missing.push("price");
  if (!product.image) missing.push("image");
  if (product.available == null) missing.push("availability");
  return { connected: false, ready: missing.length === 0, missing, note: "فیلد Merchant فقط وقتی داده واقعی وجود دارد ارسال می‌شود. اتصال از مرکز یکپارچه‌سازی و بدون رمز ثابت انجام می‌شود." };
}

export const INSTALLMENT_POLICIES = POLICIES;
