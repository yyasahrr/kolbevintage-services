import type { PoolClient } from "pg";
import { makeId, rows, transaction } from "./database";

export class OpsError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Json = Record<string, any>;

export const REJECTION_REASONS = [
  { code: "images_unsuitable", label: "تصاویر محصول مناسب نیست." },
  { code: "image_quality", label: "کیفیت تصاویر کافی نیست." },
  { code: "incomplete_info", label: "اطلاعات محصول ناقص است." },
  { code: "description_needs_edit", label: "توضیحات محصول نیاز به اصلاح دارد." },
  { code: "pricing_policy", label: "قیمت‌گذاری با ضوابط بازارچه منطبق نیست." },
  { code: "wholesale_price", label: "قیمت عمده مناسب نیست." },
  { code: "size_specs", label: "مشخصات سایز ناقص است." },
  { code: "color_specs", label: "مشخصات رنگ ناقص است." },
  { code: "wrong_category", label: "دسته‌بندی محصول اشتباه است." },
  { code: "sku_variants", label: "SKU / Variantها نیاز به اصلاح دارند." },
  { code: "wholesale_terms", label: "شرایط فروش عمده کامل نیست." },
  { code: "moq", label: "حداقل سفارش مناسب تعریف نشده." },
  { code: "brand_docs", label: "مدارک یا اطلاعات برند ناقص است." },
  { code: "other", label: "سایر موارد." },
] as const;

const REVIEW_STATUSES = new Set(["draft", "submitted", "approved", "changes_requested", "rejected"]);
const PAYMENT_STATUSES = new Set(["unpaid", "pending", "partial", "paid", "refunded"]);
const FULFILLMENT_STATUSES = new Set(["pending", "preparing", "ready", "shipped", "delivered", "cancelled", "issue"]);

/** Whitelisted, deterministic ORDER BY clauses. Never interpolate raw user input. */
const ORDER_SORTS: Record<string, string> = {
  newest: "o.created_at DESC, o.id DESC",
  oldest: "o.created_at ASC, o.id ASC",
  status: `CASE o.status WHEN 'pending' THEN 1 WHEN 'approved' THEN 2 WHEN 'fulfilled' THEN 3 WHEN 'cancelled' THEN 4 ELSE 9 END ASC, o.created_at DESC, o.id DESC`,
  amount: "o.total_amount DESC, o.created_at DESC, o.id DESC",
  buyer: "a.store_name ASC, a.member_name ASC, o.id ASC",
  supplier: "supplier_names ASC, o.created_at DESC, o.id DESC",
  payment: `CASE o.payment_status WHEN 'unpaid' THEN 1 WHEN 'pending' THEN 2 WHEN 'partial' THEN 3 WHEN 'paid' THEN 4 WHEN 'refunded' THEN 5 ELSE 9 END ASC, o.created_at DESC, o.id DESC`,
  fulfillment: `CASE o.fulfillment_status WHEN 'issue' THEN 1 WHEN 'pending' THEN 2 WHEN 'preparing' THEN 3 WHEN 'ready' THEN 4 WHEN 'shipped' THEN 5 WHEN 'delivered' THEN 6 WHEN 'cancelled' THEN 7 ELSE 9 END ASC, o.created_at DESC, o.id DESC`,
  updated: "o.updated_at DESC, o.id DESC",
  shipped: "o.shipped_at DESC NULLS LAST, o.created_at DESC, o.id DESC",
  priority: "o.operational_priority DESC, o.updated_at DESC, o.id DESC",
};

export function orderSortSql(sort: string | null | undefined) {
  const key = (sort ?? "newest").trim() || "newest";
  const sql = ORDER_SORTS[key];
  if (!sql) throw new OpsError(422, "INVALID_SORT");
  return sql;
}

function likeTerm(value: string) {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export async function queryAdminOrders(search: URLSearchParams) {
  const sortSql = orderSortSql(search.get("sort"));
  const values: unknown[] = [];
  const filters: string[] = [];
  const status = search.get("status")?.trim();
  const payment = search.get("payment")?.trim();
  const fulfillment = search.get("fulfillment")?.trim();
  const query = search.get("q")?.trim();
  if (status && status !== "all") {
    values.push(status);
    filters.push(`o.status = $${values.length}`);
  }
  if (payment && payment !== "all") {
    if (!PAYMENT_STATUSES.has(payment)) throw new OpsError(422, "INVALID_PAYMENT_STATUS");
    values.push(payment);
    filters.push(`o.payment_status = $${values.length}`);
  }
  if (fulfillment && fulfillment !== "all") {
    if (!FULFILLMENT_STATUSES.has(fulfillment)) throw new OpsError(422, "INVALID_FULFILLMENT_STATUS");
    values.push(fulfillment);
    filters.push(`o.fulfillment_status = $${values.length}`);
  }
  if (query) {
    values.push(likeTerm(query));
    const slot = `$${values.length}`;
    filters.push(`(
      o.order_code ILIKE ${slot} OR a.store_name ILIKE ${slot} OR a.member_name ILIKE ${slot}
      OR EXISTS (
        SELECT 1 FROM wholesale_order_item wi
        LEFT JOIN supplier_product p ON p.id = wi.product_id
        LEFT JOIN supplier s ON s.id = p.supplier_id
        WHERE wi.order_id = o.id AND (
          wi.product_name ILIKE ${slot} OR wi.sku ILIKE ${slot} OR s.display_name ILIKE ${slot}
        )
      )
    )`);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const orders = await rows<any>(
    `SELECT o.*, a.store_name, a.member_name, a.phone AS buyer_phone, a.city AS buyer_city, a.plan_name,
            COALESCE((
              SELECT string_agg(DISTINCT s.display_name, '، ' ORDER BY s.display_name)
              FROM wholesale_order_item wi
              JOIN supplier_product p ON p.id = wi.product_id
              JOIN supplier s ON s.id = p.supplier_id
              WHERE wi.order_id = o.id
            ), '') AS supplier_names
     FROM wholesale_order o
     JOIN wholesale_account a ON a.id = o.account_id
     ${where}
     ORDER BY ${sortSql}`,
    values,
  );
  const ids = orders.map((order) => order.id);
  const items = ids.length
    ? await rows<any>(
        `SELECT wi.*, v.size, v.color, v.size_id, s.display_name AS supplier_name, s.id AS supplier_id
         FROM wholesale_order_item wi
         LEFT JOIN supplier_variant v ON v.id = wi.variant_id
         LEFT JOIN supplier_product p ON p.id = wi.product_id
         LEFT JOIN supplier s ON s.id = p.supplier_id
         WHERE wi.order_id = ANY($1::text[])
         ORDER BY wi.order_id, s.display_name NULLS LAST, wi.id`,
        [ids],
      )
    : [];
  const pos = ids.length
    ? await rows<any>(
        `SELECT po.*, s.display_name AS supplier_name
         FROM purchase_order po
         LEFT JOIN supplier s ON s.id = po.supplier_id
         WHERE po.wholesale_order_id = ANY($1::text[])
         ORDER BY po.created_at ASC, po.id ASC`,
        [ids],
      )
    : [];
  const poItems = pos.length
    ? await rows<any>(`SELECT * FROM purchase_order_item WHERE purchase_order_id = ANY($1::text[]) ORDER BY id`, [pos.map((po) => po.id)])
    : [];
  return orders.map((order) => ({
    id: order.id,
    order_code: order.order_code,
    status: order.status,
    payment_status: order.payment_status,
    fulfillment_status: order.fulfillment_status,
    operational_priority: order.operational_priority,
    total_amount: Number(order.total_amount),
    total_units: order.total_units,
    created_at: order.created_at,
    updated_at: order.updated_at,
    shipped_at: order.shipped_at,
    account_id: order.account_id,
    store_name: order.store_name,
    member_name: order.member_name,
    buyer_phone: order.buyer_phone,
    buyer_city: order.buyer_city,
    plan_name: order.plan_name,
    supplier_names: order.supplier_names,
    suppliers: String(order.supplier_names || "").split("، ").filter(Boolean),
    wholesale_order_items: items.filter((item) => item.order_id === order.id).map((item) => ({
      id: item.id,
      product_id: item.product_id,
      variant_id: item.variant_id,
      product_name: item.product_name,
      sku: item.sku,
      quantity: item.quantity,
      unit_price: Number(item.unit_price),
      size: item.size,
      color: item.color,
      size_id: item.size_id,
      supplier_name: item.supplier_name,
      supplier_id: item.supplier_id,
    })),
    purchase_orders: pos.filter((po) => po.wholesale_order_id === order.id).map((po) => ({
      id: po.id,
      order_code: po.order_code,
      status: po.status,
      supplier_id: po.supplier_id,
      supplier_name: po.supplier_name ?? "—",
      tracking_code: po.tracking_code,
      shipped_at: po.shipped_at,
      delivered_at: po.delivered_at,
      due_date: po.due_date,
      total_amount: Number(po.total_amount),
      items: poItems.filter((item) => item.purchase_order_id === po.id).map((item) => ({
        id: item.id,
        product_name: item.product_name,
        sku: item.sku,
        quantity: item.quantity,
        unit_price: Number(item.unit_price),
      })),
    })),
  }));
}

export async function updateOrderOperations(id: string, body: Json) {
  const payment = body.paymentStatus ?? body.payment_status;
  const fulfillment = body.fulfillmentStatus ?? body.fulfillment_status;
  const priority = body.operationalPriority ?? body.operational_priority;
  const shippedAt = body.shippedAt ?? body.shipped_at;
  if (payment === undefined && fulfillment === undefined && priority === undefined && shippedAt === undefined) {
    throw new OpsError(422, "INVALID_INPUT");
  }
  if (payment !== undefined && !PAYMENT_STATUSES.has(String(payment))) throw new OpsError(422, "INVALID_PAYMENT_STATUS");
  if (fulfillment !== undefined && !FULFILLMENT_STATUSES.has(String(fulfillment))) throw new OpsError(422, "INVALID_FULFILLMENT_STATUS");
  let priorityValue: number | undefined;
  if (priority !== undefined) {
    priorityValue = Number(priority);
    if (!Number.isInteger(priorityValue) || priorityValue < 0 || priorityValue > 100) throw new OpsError(422, "INVALID_PRIORITY");
  }
  const updated = await transaction(async (client) => {
    const current = (await client.query<any>("SELECT * FROM wholesale_order WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!current) throw new OpsError(404, "ORDER_NOT_FOUND");
    const nextFulfillment = fulfillment === undefined ? current.fulfillment_status : String(fulfillment);
    const nextShipped = shippedAt !== undefined
      ? (shippedAt ? new Date(String(shippedAt)) : null)
      : (nextFulfillment === "shipped" || nextFulfillment === "delivered") && !current.shipped_at
        ? new Date()
        : current.shipped_at;
    if (shippedAt && Number.isNaN(new Date(String(shippedAt)).getTime())) throw new OpsError(422, "INVALID_INPUT");
    const row = (await client.query<any>(
      `UPDATE wholesale_order SET
         payment_status = COALESCE($2, payment_status),
         fulfillment_status = COALESCE($3, fulfillment_status),
         operational_priority = COALESCE($4, operational_priority),
         shipped_at = $5,
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, payment ?? null, fulfillment ?? null, priorityValue ?? null, nextShipped],
    )).rows[0];
    return row;
  });
  return {
    id: updated.id,
    status: updated.status,
    payment_status: updated.payment_status,
    fulfillment_status: updated.fulfillment_status,
    operational_priority: updated.operational_priority,
    shipped_at: updated.shipped_at,
    updated_at: updated.updated_at,
  };
}

export async function syncWholesaleFulfillment(client: PoolClient, wholesaleOrderId: string) {
  const current = (await client.query<any>("SELECT fulfillment_status FROM wholesale_order WHERE id=$1 FOR UPDATE", [wholesaleOrderId])).rows[0];
  if (!current || current.fulfillment_status === "issue") return;
  const pos = (await client.query<any>("SELECT status FROM purchase_order WHERE wholesale_order_id=$1", [wholesaleOrderId])).rows
    .map((row) => row.status)
    .filter((status) => status !== "cancelled");
  if (!pos.length) return;
  let fulfillment = "pending";
  if (pos.every((status) => status === "delivered")) fulfillment = "delivered";
  else if (pos.some((status) => status === "shipped" || status === "delivered")) fulfillment = "shipped";
  else if (pos.some((status) => status === "preparing" || status === "confirmed")) fulfillment = "preparing";
  await client.query(
    `UPDATE wholesale_order SET fulfillment_status=$2,
       shipped_at = CASE WHEN $2 IN ('shipped','delivered') THEN COALESCE(shipped_at, now()) ELSE shipped_at END,
       updated_at = now()
     WHERE id=$1`,
    [wholesaleOrderId, fulfillment],
  );
}

function resolveRejection(body: Json) {
  const code = String(body.reasonCode ?? body.reason_code ?? "").trim();
  const custom = String(body.reasonText ?? body.reason_text ?? "").trim();
  const note = String(body.note ?? body.explanation ?? "").trim();
  const preset = REJECTION_REASONS.find((item) => item.code === code);
  if (!preset && !custom) throw new OpsError(422, "REJECTION_REASON_REQUIRED");
  if (preset?.code === "other" && !custom) throw new OpsError(422, "REJECTION_REASON_REQUIRED");
  const reason = preset && preset.code !== "other" ? preset.label : custom;
  if (!reason) throw new OpsError(422, "REJECTION_REASON_REQUIRED");
  return { code: preset?.code ?? "other", reason: reason.slice(0, 500), note: note.slice(0, 2000) };
}

export async function reviewSupplierProduct(id: string, body: Json, actorId: string) {
  const status = String(body.status ?? "");
  if (!REVIEW_STATUSES.has(status)) throw new OpsError(422, "INVALID_STATUS");
  const needsReason = status === "rejected" || status === "changes_requested";
  const reason = needsReason ? resolveRejection(body) : null;
  const product = await transaction(async (client) => {
    const current = (await client.query<any>("SELECT * FROM supplier_product WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!current) throw new OpsError(404, "PRODUCT_NOT_FOUND");
    const updated = (await client.query<any>(
      `UPDATE supplier_product SET
         status=$2,
         rejection_reason_code=CASE WHEN $3 THEN $4 ELSE NULL END,
         rejection_reason=CASE WHEN $3 THEN $5 ELSE NULL END,
         rejection_note=CASE WHEN $3 THEN NULLIF($6,'') ELSE NULL END,
         reviewed_at=now(),
         reviewed_by=$7,
         resubmitted_at=CASE WHEN $2 IN ('approved','rejected','changes_requested') THEN NULL ELSE resubmitted_at END,
         updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, status, needsReason, reason?.code ?? null, reason?.reason ?? null, reason?.note ?? "", actorId],
    )).rows[0];
    if (needsReason && reason) {
      const title = status === "rejected"
        ? `محصول «${current.name}» رد شد`
        : `محصول «${current.name}» برای اصلاح برگردانده شد`;
      const bodyText = reason.note ? `${reason.reason}\n${reason.note}` : reason.reason;
      await client.query(
        `INSERT INTO supplier_notification (id, supplier_id, product_id, kind, title, body, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          makeId("sntf"),
          current.supplier_id,
          current.id,
          status === "rejected" ? "product_rejected" : "product_changes_requested",
          title,
          bodyText,
          JSON.stringify({
            productId: current.id,
            productName: current.name,
            status,
            reasonCode: reason.code,
            reason: reason.reason,
            note: reason.note,
            reviewedAt: new Date().toISOString(),
          }),
        ],
      );
    }
    return updated;
  });
  return {
    id: product.id,
    status: product.status,
    rejection_reason_code: product.rejection_reason_code,
    rejection_reason: product.rejection_reason,
    rejection_note: product.rejection_note,
    reviewed_at: product.reviewed_at,
  };
}

export async function listSupplierNotifications(supplierId: string) {
  const notifications = await rows<any>(
    `SELECT * FROM supplier_notification WHERE supplier_id=$1 ORDER BY created_at DESC, id DESC LIMIT 100`,
    [supplierId],
  );
  return {
    unread: notifications.filter((item) => !item.read_at).length,
    notifications: notifications.map(shapeNotification),
  };
}

function shapeNotification(item: any) {
  return {
    id: item.id,
    product_id: item.product_id,
    kind: item.kind,
    title: item.title,
    body: item.body,
    payload: item.payload,
    read_at: item.read_at,
    created_at: item.created_at,
  };
}

export async function markNotificationRead(supplierId: string, id: string) {
  const [row] = await rows<any>(
    `UPDATE supplier_notification SET read_at=COALESCE(read_at, now()) WHERE id=$1 AND supplier_id=$2 RETURNING *`,
    [id, supplierId],
  );
  if (!row) throw new OpsError(404, "NOTIFICATION_NOT_FOUND");
  return shapeNotification(row);
}

export async function markAllNotificationsRead(supplierId: string) {
  const result = await rows(
    `UPDATE supplier_notification SET read_at=COALESCE(read_at, now()) WHERE supplier_id=$1 AND read_at IS NULL RETURNING id`,
    [supplierId],
  );
  return { updated: result.length };
}

export async function resubmitSupplierProduct(supplierId: string, id: string, body: Json) {
  return transaction(async (client) => {
    const current = (await client.query<any>(
      "SELECT * FROM supplier_product WHERE id=$1 AND supplier_id=$2 FOR UPDATE",
      [id, supplierId],
    )).rows[0];
    if (!current) throw new OpsError(404, "PRODUCT_NOT_FOUND");
    if (!["rejected", "changes_requested", "draft"].includes(current.status)) throw new OpsError(409, "PRODUCT_NOT_RESUBMITTABLE");
    const name = body.name?.trim() || current.name;
    const description = body.description !== undefined ? String(body.description) : current.description;
    const price = body.wholesalePrice !== undefined ? Number(body.wholesalePrice) : Number(current.wholesale_price);
    if (!name || !Number.isFinite(price) || price < 0) throw new OpsError(422, "INVALID_INPUT");
    const image = body.imageUrl !== undefined ? (String(body.imageUrl).trim() || null) : current.image_url;
    const updated = (await client.query<any>(
      `UPDATE supplier_product SET name=$2, description=$3, wholesale_price=$4, image_url=$5,
         status='submitted', resubmitted_at=now(), updated_at=now()
       WHERE id=$1 RETURNING id, status, resubmitted_at`,
      [id, name, description, Math.round(price), image],
    )).rows[0];
    return { id: updated.id, status: updated.status, resubmitted_at: updated.resubmitted_at };
  });
}

function cleanCode(value: unknown) {
  const code = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,40}$/.test(code)) throw new OpsError(422, "INVALID_PRODUCT_TYPE");
  return code;
}

function shapeSize(row: any) {
  return { id: row.id, label: row.label, active: row.active, sortOrder: row.sort_order };
}

function shapeTemplate(row: any, lines: any[]) {
  return {
    id: row.id,
    productTypeId: row.product_type_id,
    code: row.code,
    name: row.name,
    description: row.description,
    active: row.active,
    sortOrder: row.sort_order,
    lines: lines
      .filter((line) => line.template_id === row.id)
      .sort((a, b) => a.size_sort - b.size_sort || String(a.size_id).localeCompare(String(b.size_id)))
      .map((line) => ({
        sizeId: line.size_id,
        label: line.label,
        quantity: line.quantity,
        sortOrder: line.size_sort,
        active: line.size_active,
      })),
  };
}

export async function listProductTypes(options: { activeOnly?: boolean } = {}) {
  const types = await rows<any>(
    `SELECT * FROM product_type ${options.activeOnly ? "WHERE active" : ""} ORDER BY sort_order ASC, id ASC`,
  );
  if (!types.length) return [];
  const ids = types.map((type) => type.id);
  const sizes = await rows<any>(
    `SELECT * FROM product_type_size WHERE product_type_id = ANY($1::text[]) ${options.activeOnly ? "AND active" : ""}
     ORDER BY product_type_id, sort_order ASC, id ASC`,
    [ids],
  );
  const templates = await rows<any>(
    `SELECT * FROM series_template WHERE product_type_id = ANY($1::text[]) ${options.activeOnly ? "AND active" : ""}
     ORDER BY product_type_id, sort_order ASC, id ASC`,
    [ids],
  );
  const lines = templates.length
    ? await rows<any>(
        `SELECT l.*, sz.label, sz.sort_order AS size_sort, sz.active AS size_active
         FROM series_template_line l
         JOIN product_type_size sz ON sz.id = l.size_id
         WHERE l.template_id = ANY($1::text[])
         ORDER BY sz.sort_order ASC, sz.id ASC`,
        [templates.map((template) => template.id)],
      )
    : [];
  return types.map((type) => ({
    id: type.id,
    code: type.code,
    name: type.name,
    description: type.description,
    active: type.active,
    sortOrder: type.sort_order,
    sizes: sizes.filter((size) => size.product_type_id === type.id).map(shapeSize),
    templates: templates.filter((template) => template.product_type_id === type.id).map((template) => shapeTemplate(template, lines)),
  }));
}

export async function createProductType(body: Json) {
  const name = String(body.name ?? "").trim();
  const description = String(body.description ?? "").trim().slice(0, 500);
  if (!name || name.length > 80) throw new OpsError(422, "INVALID_PRODUCT_TYPE");
  const code = cleanCode(body.code);
  const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Math.trunc(Number(body.sortOrder)) : 0;
  const active = body.active === undefined ? true : Boolean(body.active);
  try {
    const [row] = await rows<any>(
      `INSERT INTO product_type (id, code, name, description, active, sort_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [makeId("ptype"), code, name, description, active, sortOrder],
    );
    return { id: row.id, code: row.code, name: row.name, description: row.description, active: row.active, sortOrder: row.sort_order, sizes: [], templates: [] };
  } catch (error: any) {
    if (error?.code === "23505") throw new OpsError(409, "PRODUCT_TYPE_CODE_EXISTS");
    throw error;
  }
}

export async function updateProductType(id: string, body: Json) {
  const current = (await rows<any>("SELECT * FROM product_type WHERE id=$1", [id]))[0];
  if (!current) throw new OpsError(404, "PRODUCT_TYPE_NOT_FOUND");
  const name = body.name !== undefined ? String(body.name).trim() : current.name;
  const description = body.description !== undefined ? String(body.description).trim().slice(0, 500) : current.description;
  const code = body.code !== undefined ? cleanCode(body.code) : current.code;
  const active = body.active !== undefined ? Boolean(body.active) : current.active;
  const sortOrder = body.sortOrder !== undefined ? Math.trunc(Number(body.sortOrder)) : current.sort_order;
  if (!name) throw new OpsError(422, "INVALID_PRODUCT_TYPE");
  try {
    const [row] = await rows<any>(
      `UPDATE product_type SET code=$2, name=$3, description=$4, active=$5, sort_order=$6, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, code, name, description, active, sortOrder],
    );
    return { id: row.id, code: row.code, name: row.name, active: row.active, sortOrder: row.sort_order, description: row.description };
  } catch (error: any) {
    if (error?.code === "23505") throw new OpsError(409, "PRODUCT_TYPE_CODE_EXISTS");
    throw error;
  }
}

export async function reorderProductTypes(ids: string[]) {
  if (!Array.isArray(ids) || !ids.length) throw new OpsError(422, "INVALID_INPUT");
  const existing = await rows<any>("SELECT id FROM product_type");
  const set = new Set(existing.map((row) => row.id));
  if (ids.length !== set.size || ids.some((id) => !set.has(id))) throw new OpsError(422, "INVALID_SIZE_ORDER");
  await transaction(async (client) => {
    for (let index = 0; index < ids.length; index += 1) {
      await client.query("UPDATE product_type SET sort_order=$2, updated_at=now() WHERE id=$1", [ids[index], index]);
    }
  });
  return { updated: ids.length };
}

async function rewriteSizeOrder(client: PoolClient, typeId: string, ids: string[]) {
  for (let index = 0; index < ids.length; index += 1) {
    await client.query("UPDATE product_type_size SET sort_order=$2, updated_at=now() WHERE id=$1 AND product_type_id=$3", [ids[index], index, typeId]);
  }
}

export async function addProductTypeSize(typeId: string, body: Json) {
  const label = String(body.label ?? "").trim();
  if (!label || label.length > 40) throw new OpsError(422, "INVALID_SIZE_LABEL");
  const type = (await rows("SELECT id FROM product_type WHERE id=$1", [typeId]))[0];
  if (!type) throw new OpsError(404, "PRODUCT_TYPE_NOT_FOUND");
  try {
    return await transaction(async (client) => {
      const existing = (await client.query<any>(
        "SELECT id FROM product_type_size WHERE product_type_id=$1 ORDER BY sort_order ASC, id ASC",
        [typeId],
      )).rows.map((row) => row.id);
      const index = body.position === undefined || body.position === null
        ? existing.length
        : Math.max(0, Math.min(existing.length, Math.trunc(Number(body.position))));
      const id = makeId("psz");
      await client.query(
        "INSERT INTO product_type_size (id, product_type_id, label, active, sort_order) VALUES ($1,$2,$3,true,$4)",
        [id, typeId, label, index],
      );
      existing.splice(index, 0, id);
      await rewriteSizeOrder(client, typeId, existing);
      return { id, label, active: true, sortOrder: index, productTypeId: typeId };
    });
  } catch (error: any) {
    if (error?.code === "23505") throw new OpsError(409, "DUPLICATE_SIZE");
    throw error;
  }
}

export async function updateProductTypeSize(id: string, body: Json) {
  return transaction(async (client) => {
    const current = (await client.query<any>("SELECT * FROM product_type_size WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!current) throw new OpsError(404, "SIZE_NOT_FOUND");
    const label = body.label !== undefined ? String(body.label).trim() : current.label;
    if (!label || label.length > 40) throw new OpsError(422, "INVALID_SIZE_LABEL");
    const active = body.active !== undefined ? Boolean(body.active) : current.active;
    try {
      await client.query(
        "UPDATE product_type_size SET label=$2, active=$3, updated_at=now() WHERE id=$1",
        [id, label, active],
      );
    } catch (error: any) {
      if (error?.code === "23505") throw new OpsError(409, "DUPLICATE_SIZE");
      throw error;
    }
    if (body.position !== undefined && body.position !== null) {
      const ids = (await client.query<any>(
        "SELECT id FROM product_type_size WHERE product_type_id=$1 ORDER BY sort_order ASC, id ASC",
        [current.product_type_id],
      )).rows.map((row) => row.id).filter((sizeId) => sizeId !== id);
      const index = Math.max(0, Math.min(ids.length, Math.trunc(Number(body.position))));
      ids.splice(index, 0, id);
      await rewriteSizeOrder(client, current.product_type_id, ids);
    }
    const fresh = (await client.query<any>("SELECT * FROM product_type_size WHERE id=$1", [id])).rows[0];
    return { ...shapeSize(fresh), productTypeId: fresh.product_type_id };
  });
}

export async function reorderProductTypeSizes(typeId: string, ids: string[]) {
  if (!Array.isArray(ids) || !ids.length) throw new OpsError(422, "INVALID_SIZE_ORDER");
  const existing = await rows<any>("SELECT id FROM product_type_size WHERE product_type_id=$1", [typeId]);
  const set = new Set(existing.map((row) => row.id));
  if (!existing.length || ids.length !== set.size || ids.some((id) => !set.has(id))) throw new OpsError(422, "INVALID_SIZE_ORDER");
  await transaction(async (client) => rewriteSizeOrder(client, typeId, ids));
  return { updated: ids.length };
}

function parseLines(body: Json) {
  if (!Array.isArray(body.lines) || !body.lines.length) throw new OpsError(422, "INVALID_COMPOSITION");
  const lines = body.lines.map((line: any) => ({
    sizeId: String(line.sizeId ?? line.size_id ?? ""),
    quantity: Math.trunc(Number(line.quantity)),
  }));
  if (lines.some((line: { sizeId: string; quantity: number }) => !line.sizeId || !Number.isInteger(line.quantity) || line.quantity < 0 || line.quantity > 1000)) {
    throw new OpsError(422, "INVALID_COMPOSITION");
  }
  if (!lines.some((line: { quantity: number }) => line.quantity > 0)) throw new OpsError(422, "INVALID_COMPOSITION");
  return lines as Array<{ sizeId: string; quantity: number }>;
}

async function assertSizesBelong(client: PoolClient, typeId: string, sizeIds: string[], activeOnly: boolean) {
  const sizes = (await client.query<any>(
    "SELECT id, active FROM product_type_size WHERE product_type_id=$1 AND id = ANY($2::text[])",
    [typeId, sizeIds],
  )).rows;
  if (sizes.length !== new Set(sizeIds).size) throw new OpsError(422, "SIZE_NOT_IN_TYPE");
  if (activeOnly && sizes.some((size) => !size.active)) throw new OpsError(422, "SIZE_INACTIVE");
}

export async function saveSeriesTemplate(body: Json, id?: string) {
  const lines = parseLines(body);
  return transaction(async (client) => {
    let templateId = id;
    let typeId = String(body.productTypeId ?? body.product_type_id ?? "");
    if (id) {
      const current = (await client.query<any>("SELECT * FROM series_template WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!current) throw new OpsError(404, "TEMPLATE_NOT_FOUND");
      typeId = typeId || current.product_type_id;
      if (typeId !== current.product_type_id) throw new OpsError(422, "INVALID_PRODUCT_TYPE");
      const name = body.name !== undefined ? String(body.name).trim() : current.name;
      const description = body.description !== undefined ? String(body.description).trim().slice(0, 500) : current.description;
      const active = body.active !== undefined ? Boolean(body.active) : current.active;
      const sortOrder = body.sortOrder !== undefined ? Math.trunc(Number(body.sortOrder)) : current.sort_order;
      if (!name) throw new OpsError(422, "INVALID_INPUT");
      await client.query(
        "UPDATE series_template SET name=$2, description=$3, active=$4, sort_order=$5, updated_at=now() WHERE id=$1",
        [id, name, description, active, sortOrder],
      );
    } else {
      const name = String(body.name ?? "").trim();
      const code = cleanCode(body.code);
      if (!name || !typeId) throw new OpsError(422, "INVALID_INPUT");
      const type = (await client.query("SELECT id FROM product_type WHERE id=$1", [typeId])).rows[0];
      if (!type) throw new OpsError(404, "PRODUCT_TYPE_NOT_FOUND");
      templateId = makeId("stmpl");
      try {
        await client.query(
          `INSERT INTO series_template (id, product_type_id, code, name, description, active, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [templateId, typeId, code, name, String(body.description ?? "").trim().slice(0, 500), body.active === undefined ? true : Boolean(body.active), Number(body.sortOrder ?? 0) || 0],
        );
      } catch (error: any) {
        if (error?.code === "23505") throw new OpsError(409, "PRODUCT_TYPE_CODE_EXISTS");
        throw error;
      }
    }
    await assertSizesBelong(client, typeId, [...new Set(lines.map((line) => line.sizeId))], false);
    await client.query("DELETE FROM series_template_line WHERE template_id=$1", [templateId]);
    for (const line of lines.filter((item) => item.quantity > 0)) {
      await client.query(
        "INSERT INTO series_template_line (id, template_id, size_id, quantity) VALUES ($1,$2,$3,$4)",
        [makeId("stln"), templateId, line.sizeId, line.quantity],
      );
    }
    return { id: templateId, productTypeId: typeId };
  });
}

export async function resolveComposition(client: PoolClient, typeId: string, body: Json) {
  const type = (await client.query<any>("SELECT * FROM product_type WHERE id=$1 AND active", [typeId])).rows[0];
  if (!type) throw new OpsError(422, "INVALID_PRODUCT_TYPE");
  let lines: Array<{ sizeId: string; quantity: number }>;
  let templateId: string | null = null;
  if (body.seriesTemplateId) {
    const template = (await client.query<any>(
      "SELECT * FROM series_template WHERE id=$1 AND product_type_id=$2 AND active",
      [body.seriesTemplateId, typeId],
    )).rows[0];
    if (!template) throw new OpsError(404, "TEMPLATE_NOT_FOUND");
    templateId = template.id;
    const stored = (await client.query<any>(
      "SELECT size_id, quantity FROM series_template_line WHERE template_id=$1 AND quantity > 0",
      [template.id],
    )).rows;
    lines = stored.map((line) => ({ sizeId: line.size_id, quantity: line.quantity }));
  } else {
    lines = parseLines(body);
  }
  await assertSizesBelong(client, typeId, [...new Set(lines.map((line) => line.sizeId))], true);
  const sizes = (await client.query<any>(
    "SELECT id, label, sort_order FROM product_type_size WHERE id = ANY($1::text[]) ORDER BY sort_order ASC, id ASC",
    [lines.map((line) => line.sizeId)],
  )).rows;
  const qty = new Map(lines.map((line) => [line.sizeId, line.quantity]));
  return {
    type,
    templateId,
    lines: sizes.map((size) => ({ sizeId: size.id, label: size.label, quantity: qty.get(size.id) ?? 0, sortOrder: size.sort_order }))
      .filter((line) => line.quantity > 0),
  };
}

export async function insertTypedProduct(client: PoolClient, supplierId: string, body: Json) {
  if (!body.name?.trim() || !body.sku?.trim()) throw new OpsError(422, "INVALID_INPUT");
  const seriesCount = Math.trunc(Number(body.seriesCount ?? body.stock ?? 1));
  if (!Number.isInteger(seriesCount) || seriesCount <= 0 || seriesCount > 100000) throw new OpsError(422, "INVALID_QUANTITY");
  const price = Math.round(Number(body.wholesalePrice ?? 0));
  if (!Number.isFinite(price) || price < 0) throw new OpsError(422, "INVALID_INPUT");
  const resolved = await resolveComposition(client, String(body.productTypeId), body);
  const id = makeId("prd");
  const sku = String(body.sku).trim().toUpperCase();
  const compositionText = resolved.lines.map((line) => `${line.label}×${line.quantity}`).join(" · ");
  const description = `${String(body.description ?? "").trim()}${compositionText ? `\n\nترکیب سری: ${compositionText}` : ""}`.trim();
  await client.query(
    `INSERT INTO supplier_product (id, supplier_id, name, sku, category, description, wholesale_price, image_url, status, product_type_id, series_template_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'submitted',$9,$10)`,
    [
      id,
      supplierId,
      body.name.trim(),
      sku,
      body.category?.trim() || resolved.type.name,
      description,
      price,
      body.imageUrl?.trim() || null,
      resolved.type.id,
      resolved.templateId,
    ],
  );
  for (const line of resolved.lines) {
    const variantId = makeId("var");
    const variantSku = `${sku}-${line.label}`.toUpperCase();
    await client.query(
      `INSERT INTO supplier_variant (id, product_id, sku, color, color_hex, size, size_id, cost)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [variantId, id, variantSku, body.color?.trim() || "بدون رنگ", body.colorHex ?? null, line.label, line.sizeId, price],
    );
    await client.query(
      "INSERT INTO supplier_inventory (id, variant_id, on_hand, reserved) VALUES ($1,$2,$3,0)",
      [makeId("inv"), variantId, line.quantity * seriesCount],
    );
  }
  return { id, name: body.name.trim(), sku, status: "submitted", product_type_id: resolved.type.id };
}

type HandlerResult = { status: number; data: unknown };

export function isAdminExtensionPath(path: string) {
  return path === "admin/catalog/rejection-reasons"
    || /^admin\/orders\/[^/]+\/operations$/.test(path)
    || path.startsWith("admin/product-types")
    || path.startsWith("admin/sizes/")
    || path.startsWith("admin/series-templates");
}

export async function handleAdminExtensions(input: {
  path: string;
  method: string;
  url: string;
  body: Json;
}): Promise<HandlerResult | null> {
  const { path, method, body } = input;
  const search = new URL(input.url).searchParams;
  if (path === "admin/catalog/rejection-reasons" && method === "GET") {
    return { status: 200, data: { reasons: REJECTION_REASONS } };
  }
  const operations = path.match(/^admin\/orders\/([^/]+)\/operations$/);
  if (operations && method === "POST") {
    return { status: 200, data: await updateOrderOperations(operations[1], body) };
  }
  if (path === "admin/product-types" && method === "GET") {
    return { status: 200, data: { productTypes: await listProductTypes({ activeOnly: false }) } };
  }
  if (path === "admin/product-types" && method === "POST") {
    return { status: 201, data: { productType: await createProductType(body) } };
  }
  if (path === "admin/product-types/reorder" && method === "POST") {
    return { status: 200, data: await reorderProductTypes(body.ids) };
  }
  const typeUpdate = path.match(/^admin\/product-types\/([^/]+)$/);
  if (typeUpdate && method === "POST") {
    return { status: 200, data: { productType: await updateProductType(typeUpdate[1], body) } };
  }
  const addSize = path.match(/^admin\/product-types\/([^/]+)\/sizes$/);
  if (addSize && method === "POST") {
    return { status: 201, data: { size: await addProductTypeSize(addSize[1], body) } };
  }
  const reorderSizes = path.match(/^admin\/product-types\/([^/]+)\/sizes\/reorder$/);
  if (reorderSizes && method === "POST") {
    return { status: 200, data: await reorderProductTypeSizes(reorderSizes[1], body.ids) };
  }
  const sizeUpdate = path.match(/^admin\/sizes\/([^/]+)$/);
  if (sizeUpdate && method === "POST") {
    return { status: 200, data: { size: await updateProductTypeSize(sizeUpdate[1], body) } };
  }
  if (path === "admin/series-templates" && method === "POST") {
    return { status: 201, data: { template: await saveSeriesTemplate(body) } };
  }
  const templateUpdate = path.match(/^admin\/series-templates\/([^/]+)$/);
  if (templateUpdate && method === "POST") {
    return { status: 200, data: { template: await saveSeriesTemplate(body, templateUpdate[1]) } };
  }
  if (path === "catalog/product-types" && method === "GET") {
    const activeOnly = search.get("all") !== "1";
    return { status: 200, data: { productTypes: await listProductTypes({ activeOnly }) } };
  }
  return null;
}
