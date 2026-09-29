import type { PoolClient } from "pg";

type SeedType = {
  id: string;
  code: string;
  name: string;
  description: string;
  sortOrder: number;
  sizes: string[];
};

const TYPES: SeedType[] = [
  { id: "ptype_shoe", code: "shoe", name: "کفش", description: "کفش روزمره، رسمی و کتانی", sortOrder: 10, sizes: ["36", "37", "38", "39", "40", "41", "42", "43", "44"] },
  { id: "ptype_pants", code: "pants", name: "شلوار", description: "شلوار و شلوارک", sortOrder: 20, sizes: ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"] },
  { id: "ptype_shirt", code: "shirt", name: "پیراهن", description: "پیراهن مردانه و زنانه", sortOrder: 30, sizes: ["XS", "S", "M", "L", "XL", "2XL", "3XL"] },
  { id: "ptype_coat", code: "coat", name: "کت", description: "کت، بلیزر و رویه رسمی", sortOrder: 40, sizes: ["S", "M", "L", "XL", "2XL", "3XL"] },
  { id: "ptype_manteau", code: "manteau", name: "مانتو", description: "مانتو و رویه", sortOrder: 50, sizes: ["S", "M", "L", "XL", "2XL", "3XL"] },
  { id: "ptype_tshirt", code: "tshirt", name: "تی‌شرت", description: "تی‌شرت و پولوشرت", sortOrder: 60, sizes: ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"] },
  { id: "ptype_hoodie", code: "hoodie", name: "هودی", description: "هودی و سویشرت", sortOrder: 70, sizes: ["S", "M", "L", "XL", "2XL", "3XL"] },
  { id: "ptype_kids", code: "kidswear", name: "لباس بچگانه", description: "پوشاک کودک", sortOrder: 80, sizes: ["2", "4", "6", "8", "10", "12", "14"] },
  { id: "ptype_hat", code: "hat", name: "کلاه", description: "کلاه، کپ و فدورا", sortOrder: 90, sizes: ["S", "M", "L"] },
  { id: "ptype_belt", code: "belt", name: "کمربند", description: "کمربند چرم و پارچه", sortOrder: 100, sizes: ["85", "90", "95", "100", "105", "110"] },
];

function sizeId(code: string, label: string) {
  return `psz_${code}_${label.replace(/[^a-zA-Z0-9]+/g, "_")}`;
}

/**
 * Idempotent catalog of product types, ordered sizes and series templates.
 * Existing admin edits are never overwritten (ON CONFLICT DO NOTHING / null-only links).
 */
export async function seedProductCatalog(client: PoolClient) {
  for (const type of TYPES) {
    await client.query(
      `INSERT INTO product_type (id, code, name, description, active, sort_order)
       VALUES ($1,$2,$3,$4,true,$5) ON CONFLICT (id) DO NOTHING`,
      [type.id, type.code, type.name, type.description, type.sortOrder],
    );
    for (let index = 0; index < type.sizes.length; index += 1) {
      const label = type.sizes[index];
      await client.query(
        `INSERT INTO product_type_size (id, product_type_id, label, active, sort_order)
         VALUES ($1,$2,$3,true,$4) ON CONFLICT (id) DO NOTHING`,
        [sizeId(type.code, label), type.id, label, index],
      );
    }
  }

  const tshirt = "ptype_tshirt";
  const templateId = "stmpl_tshirt_standard";
  await client.query(
    `INSERT INTO series_template (id, product_type_id, code, name, description, active, sort_order)
     VALUES ($1,$2,'standard','سری استاندارد','S×2 · M×3 · L×3 · XL×2',true,0)
     ON CONFLICT (id) DO NOTHING`,
    [templateId, tshirt],
  );
  const lines: Array<[string, number]> = [
    ["S", 2],
    ["M", 3],
    ["L", 3],
    ["XL", 2],
  ];
  for (const [label, quantity] of lines) {
    await client.query(
      `INSERT INTO series_template_line (id, template_id, size_id, quantity)
       VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
      [`stln_tshirt_standard_${label}`, templateId, sizeId("tshirt", label), quantity],
    );
  }

  await client.query(
    `UPDATE supplier_product SET product_type_id='ptype_shirt'
     WHERE id IN ('prd_classic','prd_blouse') AND product_type_id IS NULL`,
  );
  await client.query(
    `UPDATE supplier_product SET product_type_id='ptype_pants' WHERE id='prd_skirt' AND product_type_id IS NULL`,
  );
  await client.query(
    `UPDATE supplier_variant v
     SET size_id = sz.id
     FROM supplier_product p, product_type_size sz
     WHERE v.product_id = p.id
       AND p.product_type_id = sz.product_type_id
       AND sz.label = v.size
       AND v.size_id IS NULL`,
  );
  await client.query(
    `UPDATE wholesale_order SET
       fulfillment_status = CASE status
         WHEN 'fulfilled' THEN 'delivered'
         WHEN 'cancelled' THEN 'cancelled'
         WHEN 'approved' THEN 'preparing'
         ELSE fulfillment_status
       END
     WHERE fulfillment_status = 'pending' AND status IN ('fulfilled','cancelled','approved')`,
  );
}
