/**
 * Phase 6.4 — idempotent seed for the apparel **series** buying flow.
 *
 * Why this exists: the series configurator needs a product that is genuinely
 * sold as a series, not as a single variant. The demo catalogue's `prod_classic`
 * is exactly that weak sample — one variant (`NL-CLASSIC-M`), one PIECE offer,
 * no packages — so the redesigned product detail could only be reviewed against
 * a hand-written fixture, which is the browser-owned truth the cutover removes.
 *
 * This script extends the existing demo product instead of inventing a parallel
 * catalogue, and it leaves the PIECE offer in place so the PIECE path stays
 * covered by the same product. The shape mirrors how a supplier really declares
 * apparel wholesale:
 *
 *   prod_classic (پیراهن کلاسیک نیم‌آستین)
 *     ├── +12 variants: { orange, black } × { S, M, L, XL, 2XL, 3XL }
 *     ├── +one product-level offer: MOQ 1 SERIES, priced per SERIES
 *     │     (the demo's original PIECE offer is untouched)
 *     └── five packages — supplier-named, supplier-composed:
 *           orange → سری کامل (12) | نیم‌سری (6) | سری پرفروش (12)
 *           black  → سری کامل (12) | سری پرفروش (12)
 *
 * Package names and recipes live in the database, never in the frontend, so the
 * UI is verified against real server truth. The two colours deliberately do
 * **not** expose the same series set, so the UI can never assume they do.
 * Inventory rows are what turn `availablePackages` into a server-computed
 * number rather than a browser guess.
 *
 * Safe to re-run: every row is keyed by a stable id derived from a namespace and
 * every write is an upsert. Nothing here is a client-side fixture.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/seed-vip-series-demo.mjs
 */
import { createHash } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = new Client({ connectionString });
await db.connect();

const stableId = (namespace, prefix) => `${prefix}_${createHash("sha256").update(namespace).digest("hex").slice(0, 24)}`;

/** Idempotent single-row upsert keyed on the primary key. */
async function ensure(table, columns, values) {
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(",");
  const updates = columns
    .filter((column) => column !== "id")
    .map((column) => `${column} = EXCLUDED.${column}`)
    .join(", ");
  await db.query(
    `INSERT INTO ${table} (${columns.join(",")}) VALUES (${placeholders})
     ON CONFLICT (id) DO ${updates ? `UPDATE SET ${updates}` : "NOTHING"}`,
    values,
  );
}

const PRODUCT_ID = process.env.KOLBE_SERIES_PRODUCT_ID ?? "prod_classic";
const ON_HAND = 120;

const COLORS = [
  { slug: "orange", label: "نارنجی", hex: "#d9762f" },
  { slug: "black", label: "مشکی", hex: "#1c1c1f" },
];
const SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];

/** Supplier-declared recipes. Names are the supplier's own, never hard-coded in the UI. */
const PACKAGES = [
  { color: "orange", name: "سری کامل", pieces: { S: 2, M: 2, L: 2, XL: 2, "2XL": 2, "3XL": 2 } },
  { color: "orange", name: "نیم‌سری", pieces: { S: 1, M: 1, L: 1, XL: 1, "2XL": 1, "3XL": 1 } },
  { color: "orange", name: "سری پرفروش", pieces: { M: 2, L: 4, XL: 4, "2XL": 2 } },
  { color: "black", name: "سری کامل", pieces: { S: 2, M: 2, L: 2, XL: 2, "2XL": 2, "3XL": 2 } },
  { color: "black", name: "سری پرفروش", pieces: { M: 2, L: 4, XL: 4, "2XL": 2 } },
];

const PRICE_PER_SERIES = "8900000";
const TIERS = [
  { min: 1, max: 4, price: "8900000" },
  { min: 5, max: 9, price: "8600000" },
  { min: 10, max: null, price: "8200000" },
];

/* ── Product: extend the existing demo product, never fork the catalogue ──── */

await db.query(
  `INSERT INTO product (id, name, slug, description, owner_type, status)
   VALUES ($1,$2,$3,$4,'SUPPLIER','published')
   ON CONFLICT (id) DO UPDATE SET status = 'published'`,
  [PRODUCT_ID, "پیراهن کلاسیک نیم‌آستین", "classic-short-sleeve", "تولید کارخانه، کیفیت صادراتی"],
);

/**
 * Seller: reuse whoever already sells this product so ownership stays coherent.
 * The demo catalogue's offers belong to the supplier's seller; inventing a
 * second seller would put the series offer on a party that does not stock it.
 */
const sellerRow = await db.query(
  `SELECT o.seller_id AS "sellerId" FROM seller_offer o
   WHERE o.product_id = $1 AND o.status = 'published' ORDER BY o.id LIMIT 1`,
  [PRODUCT_ID],
);
let sellerId = sellerRow.rows[0]?.sellerId ?? null;
if (!sellerId) {
  const kolbe = await db.query(`SELECT id FROM seller WHERE type = 'KOLBE' ORDER BY created_at LIMIT 1`);
  sellerId = kolbe.rows[0]?.id ?? null;
}
if (!sellerId) {
  sellerId = stableId("seller:kolbe-series", "sel");
  await ensure("seller", ["id", "type", "display_name", "status"], [sellerId, "KOLBE", "Kolbe Vintage", "active"]);
}

/* ── Variants: colour × size, carrying the colour attributes the UI groups on ─ */

const variantId = (colorSlug, size) => stableId(`variant:${PRODUCT_ID}:${colorSlug}:${size}`, "var");
for (const color of COLORS) {
  for (const size of SIZES) {
    await db.query(
      `INSERT INTO product_variant (id, product_id, sku, attributes, status)
       VALUES ($1,$2,$3,$4::jsonb,'active')
       ON CONFLICT (id) DO UPDATE SET sku = EXCLUDED.sku, status = 'active', attributes = EXCLUDED.attributes`,
      [
        variantId(color.slug, size),
        PRODUCT_ID,
        `KV-CLASSIC-${color.slug.toUpperCase()}-${size}`,
        JSON.stringify({ color: color.label, color_hex: color.hex, size, material: "پنبه" }),
      ],
    );
  }
}

/* ── Inventory: one row per (variant, seller) — the source of availability ── */

for (const color of COLORS) {
  for (const size of SIZES) {
    await db.query(
      `INSERT INTO product_variant_inventory (id, variant_id, seller_id, on_hand, reserved, status)
       VALUES ($1,$2,$3,$4,0,'active')
       ON CONFLICT (id) DO NOTHING`,
      [stableId(`inventory:${PRODUCT_ID}:${color.slug}:${size}`, "pvi"), variantId(color.slug, size), sellerId, ON_HAND],
    );
  }
}

/* ── Offer: product-level, sold per SERIES (the demo's PIECE offer is kept) ─ */

const offerId = stableId(`offer:${PRODUCT_ID}:series`, "offer");
await db.query(
  `INSERT INTO seller_offer (id, product_id, seller_id, variant_id, sku, status, wholesale_price, currency, moq, moq_unit, pricing_unit, package_type)
   VALUES ($1,$2,$3,NULL,$4,'published',$5,'IRR',1,'SERIES','SERIES','SIZE_RUN')
   ON CONFLICT (id) DO UPDATE SET status = 'published', wholesale_price = EXCLUDED.wholesale_price,
     moq = EXCLUDED.moq, moq_unit = EXCLUDED.moq_unit, pricing_unit = EXCLUDED.pricing_unit,
     package_type = EXCLUDED.package_type`,
  [offerId, PRODUCT_ID, sellerId, "KV-CLASSIC-SERIES", PRICE_PER_SERIES],
);

/* ── Packages + composition: the supplier's recipes ──────────────────────── */

const seeded = [];
for (const definition of PACKAGES) {
  const id = stableId(`package:${offerId}:${definition.color}:${definition.name}`, "wpkg");
  const totalPieces = Object.values(definition.pieces).reduce((sum, value) => sum + value, 0);
  await ensure(
    "wholesale_package",
    ["id", "offer_id", "package_type", "name", "description", "total_pieces"],
    [
      id,
      offerId,
      "SIZE_RUN",
      definition.name,
      `${definition.name} — رنگ ${COLORS.find((color) => color.slug === definition.color).label}`,
      totalPieces,
    ],
  );
  for (const [size, quantity] of Object.entries(definition.pieces)) {
    await db.query(
      `INSERT INTO wholesale_package_item (id, package_id, variant_id, quantity)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (package_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
      [stableId(`package-item:${id}:${size}`, "wpki"), id, variantId(definition.color, size), quantity],
    );
  }
  seeded.push({ color: definition.color, name: definition.name, totalPieces });
}

/* ── Pricing tiers, in SERIES ────────────────────────────────────────────── */

for (const tier of TIERS) {
  await db.query(
    `INSERT INTO wholesale_pricing_tier (id, offer_id, min_quantity, max_quantity, unit_price, currency, moq_unit, pricing_unit)
     VALUES ($1,$2,$3,$4,$5,'IRR','SERIES','SERIES')
     ON CONFLICT (id) DO UPDATE SET unit_price = EXCLUDED.unit_price, min_quantity = EXCLUDED.min_quantity,
       max_quantity = EXCLUDED.max_quantity, moq_unit = EXCLUDED.moq_unit, pricing_unit = EXCLUDED.pricing_unit`,
    [stableId(`tier:${offerId}:${tier.min}`, "wpt"), offerId, tier.min, tier.max, tier.price],
  );
}

/* ── Real media rows so the gallery is exercised with actual assets ───────── */

const MEDIA = [
  "/images/model-front.jpg",
  "/images/flat.jpg",
  "/images/detail-collar.jpg",
  "/images/detail-hem.jpg",
];
for (const [index, url] of MEDIA.entries()) {
  await db.query(
    `INSERT INTO product_media (id, product_id, url, type, position)
     VALUES ($1,$2,$3,'image',$4)
     ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url, position = EXCLUDED.position`,
    [stableId(`media:${PRODUCT_ID}:${url}`, "pmd"), PRODUCT_ID, url, index],
  );
}

console.log(
  JSON.stringify(
    {
      productId: PRODUCT_ID,
      seriesOfferId: offerId,
      sellerId,
      addedVariants: COLORS.length * SIZES.length,
      packages: seeded.map((entry) => `${entry.color}/${entry.name} (${entry.totalPieces})`),
      pricePerSeries: PRICE_PER_SERIES,
      media: MEDIA.length,
      productPath: `/vip/catalog/${PRODUCT_ID}`,
    },
    null,
    2,
  ),
);

await db.end();
