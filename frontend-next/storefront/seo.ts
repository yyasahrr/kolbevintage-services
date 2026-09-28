import { productById } from "./data/catalog";
import { articles, styles } from "./siteData";

type Meta = { title: string; description: string; image?: string; jsonLd?: object };

const BASE = "https://kolbevintage.ir";

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setJsonLd(data: object | null) {
  let el = document.getElementById("kv-jsonld");
  if (!data) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("script");
    el.id = "kv-jsonld";
    (el as HTMLScriptElement).type = "application/ld+json";
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

export function applySeo(path: string) {
  const meta = metaFor(path);

  document.title = meta.title;
  upsertMeta("name", "description", meta.description);
  upsertMeta("property", "og:title", meta.title);
  upsertMeta("property", "og:description", meta.description);
  upsertMeta("property", "og:type", path.startsWith("/product/") ? "product" : "website");
  upsertMeta("property", "og:url", BASE + "/#" + path);
  upsertMeta("property", "og:locale", "fa_IR");
  upsertMeta("property", "og:site_name", "کلبه وینتیج");
  upsertMeta("name", "twitter:card", "summary_large_image");
  upsertMeta("name", "twitter:title", meta.title);
  upsertMeta("name", "twitter:description", meta.description);
  if (meta.image) {
    upsertMeta("property", "og:image", BASE + meta.image);
    upsertMeta("name", "twitter:image", BASE + meta.image);
  }

  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.appendChild(canonical);
  }
  canonical.href = BASE + "/#" + path;

  setJsonLd(meta.jsonLd ?? null);
}

function metaFor(path: string): Meta {
  const org = {
    "@context": "https://schema.org",
    "@type": "ClothingStore",
    name: "کلبه وینتیج",
    url: BASE,
    telephone: "+982191002233",
    address: {
      "@type": "PostalAddress",
      addressLocality: "تهران",
      addressCountry: "IR",
      streetAddress: "خیابان ولیعصر، پلاک ۱۲۴۰",
    },
  };

  if (path.startsWith("/product/")) {
    const p = productById(path.split("/")[2]);
    if (p) {
      return {
        title: `${p.name} | کلبه وینتیج`,
        description: `${p.subtitle} — ${p.description.slice(0, 120)}`,
        image: p.images[0],
        jsonLd: {
          "@context": "https://schema.org",
          "@type": "Product",
          name: p.name,
          image: p.images.map((i) => BASE + i),
          description: p.description,
          sku: p.specs.code,
          brand: { "@type": "Brand", name: "کلبه وینتیج" },
          material: p.specs.fibre,
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: p.rating,
            reviewCount: p.reviewCount,
          },
          offers: {
            "@type": "Offer",
            price: p.price,
            priceCurrency: "IRT",
            availability: p.sizes.some((s) => s.inStock)
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock",
            url: `${BASE}/#/product/${p.id}`,
          },
        },
      };
    }
  }

  if (path.startsWith("/blog/")) {
    const a = articles.find((x) => x.slug === path.split("/")[2]);
    if (a) {
      return {
        title: `${a.title} | مجله کلبه وینتیج`,
        description: a.excerpt,
        image: a.img,
        jsonLd: {
          "@context": "https://schema.org",
          "@type": "Article",
          headline: a.title,
          description: a.excerpt,
          image: BASE + a.img,
          articleSection: a.category,
          author: { "@type": "Organization", name: "کلبه وینتیج" },
          publisher: { "@type": "Organization", name: "کلبه وینتیج" },
        },
      };
    }
  }

  const map: Record<string, Meta> = {
    "/": {
      title: "کلبه وینتیج | پوشاک کلاسیک، وینتیج و دست‌دوز",
      description:
        "کلبه وینتیج — پوشاک کلاسیک با دوخت دست در پنج استایل Old Money، Vintage، Dark Academia، Minimal و Neo Classic. ارسال رایگان بالای ۳ میلیون تومان.",
      image: "/images/model-front.jpg",
      jsonLd: org,
    },
    "/shop": {
      title: "همه محصولات | کلبه وینتیج",
      description: "کت و بلیزر، پیراهن، بافت، شلوار و اکسسوری دست‌دوز کلبه وینتیج با فیلتر سایز، رنگ، قیمت و سبک.",
      image: "/images/flat.jpg",
    },
    "/collection": {
      title: "کالکشن پاییز ۱۴۰۵ | کلبه وینتیج",
      description: "پشم شورون، بافت کابلی و کشمیر — کالکشن پاییز کلبه وینتیج برای سردترین روزهای سال.",
      image: "/images/banner.jpg",
    },
    "/styles": {
      title: "خرید بر اساس استایل | کلبه وینتیج",
      description: `پنج استایل کلبه وینتیج: ${styles.map((s) => s.name).join("، ")}.`,
      image: "/images/model-teal.jpg",
    },
    "/blog": {
      title: "مجله استایل | کلبه وینتیج",
      description: "راهنمای استایل، نگهداری از لباس وینتیج، کمد کپسولی و راهنمای سایز.",
      image: "/images/detail-collar.jpg",
    },
    "/about": {
      title: "درباره ما | کلبه وینتیج",
      description: "داستان کلبه وینتیج، کارگاه دوخت و ارزش‌هایی که بر پایه آن لباس می‌دوزیم.",
      image: "/images/store.jpg",
    },
    "/contact": {
      title: "تماس با ما | کلبه وینتیج",
      description: "راه‌های ارتباطی، سوالات متداول و فرم تماس با پشتیبانی کلبه وینتیج.",
    },
    "/wholesale": {
      title: "فروش عمده و همکاری | کلبه وینتیج",
      description: "شرایط همکاری عمده، پلن‌های عضویت و ثبت درخواست همکاری با کلبه وینتیج.",
      image: "/images/store.jpg",
    },
    "/cart": { title: "سبد خرید | کلبه وینتیج", description: "سبد خرید شما در کلبه وینتیج." },
    "/checkout": { title: "تکمیل سفارش | کلبه وینتیج", description: "تکمیل و پرداخت سفارش." },
    "/wishlist": { title: "علاقه‌مندی‌ها | کلبه وینتیج", description: "محصولات مورد علاقه شما." },
    "/compare": { title: "مقایسه محصولات | کلبه وینتیج", description: "مقایسه مشخصات فنی محصولات کلبه وینتیج." },
    "/account": { title: "حساب کاربری | کلبه وینتیج", description: "سفارش‌ها، آدرس‌ها و اطلاعات حساب شما." },
    "/admin": { title: "پنل مدیریت | کلبه وینتیج", description: "مدیریت محصولات، سفارش‌ها و محتوای سایت." },
  };

  return (
    map[path] ?? {
      title: "کلبه وینتیج | پوشاک کلاسیک و وینتیج",
      description: "پوشاک کلاسیک با دوخت دست — کلبه وینتیج.",
      image: "/images/model-front.jpg",
    }
  );
}
