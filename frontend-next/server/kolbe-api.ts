import { createHash, createHmac, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import type { PoolClient } from "pg";
import { database, makeId, passwordRecord, rows, transaction } from "./database";
import { handlePerfectCorpRequest, isPerfectCorpError } from "./perfect-corp";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-max-age": "600",
};

type Claims = { sub: string; role: string; exp: number };
type Json = Record<string, any>;

const HERO_VIDEO_SETTING_KEY = "storefront-hero-video";
const HERO_VIDEO_URL = "/store/kolbe/site/hero-video";
const BANNER_VIDEO_SETTING_KEY = "storefront-banner-video";
const BANNER_VIDEO_URL = "/store/kolbe/site/banner-video";

function embeddedHeroVideo(settings: any): string | null {
  const value = settings?.heroStudio?.heroVideo;
  return typeof value === "string" && /^data:video\//i.test(value) ? value : null;
}

function embeddedBannerVideo(settings: any): string | null {
  const value = settings?.builder?.banner?.media;
  return settings?.builder?.banner?.mediaType === "video" && typeof value === "string" && /^data:video\//i.test(value) ? value : null;
}

function withoutEmbeddedHeroVideo(settings: any) {
  if (!embeddedHeroVideo(settings)) return settings;
  return {
    ...settings,
    heroStudio: { ...settings.heroStudio, heroVideo: HERO_VIDEO_URL },
  };
}


function withoutEmbeddedVideos(settings: any) {
  const heroSafe = withoutEmbeddedHeroVideo(settings);
  if (!embeddedBannerVideo(settings)) return heroSafe;
  return {
    ...heroSafe,
    builder: {
      ...heroSafe.builder,
      banner: { ...heroSafe.builder?.banner, media: BANNER_VIDEO_URL },
    },
  };
}

function parseVideoDataUrl(dataUrl: string) {
  // Avoid a capturing regexp over multi-megabyte Base64 strings. V8 may
  // overflow its regexp stack before decoding a perfectly valid video.
  if (!dataUrl.toLowerCase().startsWith("data:video/")) return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const metadata = dataUrl.slice(5, comma);
  const separator = metadata.indexOf(";");
  const declaredMime = (separator < 0 ? metadata : metadata.slice(0, separator)).toLowerCase();
  if (!metadata.toLowerCase().includes(";base64") || !declaredMime.startsWith("video/")) return null;
  const mime = declaredMime === "video/quicktime" ? "video/mp4" : declaredMime;
  return { mime, bytes: Buffer.from(dataUrl.slice(comma + 1), "base64") };
}

function videoStream(bytes: Uint8Array, start = 0, end = bytes.length - 1) {
  const chunkSize = 64 * 1024;
  let offset = start;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset > end) {
        controller.close();
        return;
      }
      const nextOffset = Math.min(offset + chunkSize, end + 1);
      // Buffer is a Uint8Array subclass in Node. Copying each small chunk to a
      // plain Uint8Array prevents undici from recursively normalising Buffer
      // views for large videos (which otherwise can overflow the call stack).
      controller.enqueue(Uint8Array.from(bytes.subarray(offset, nextOffset)));
      offset = nextOffset;
    },
  });
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const sessionSecret = () => process.env.KOLBE_SESSION_SECRET ?? process.env.JWT_SECRET ?? "kolbe-dev-secret-change-me";

function issueToken(userId: string, role: string) {
  const payload: Claims = { sub: userId, role, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function claimsFrom(req: NextRequest): Claims | null {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claims;
    return claims.exp * 1000 > Date.now() ? claims : null;
  } catch {
    return null;
  }
}

function requireRole(req: NextRequest, role: string) {
  const claims = claimsFrom(req);
  if (!claims || claims.role !== role) throw new HttpError(401, "UNAUTHORIZED");
  return claims;
}

function response(data: unknown, status = 200) {
  return Response.json(data, { status, headers: CORS_HEADERS });
}

async function jsonBody(req: NextRequest): Promise<Json> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function passwordMatches(password: string, salt: string, stored: string) {
  const candidate = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "hex");
  const target = Buffer.from(stored, "hex");
  return candidate.length === target.length && timingSafeEqual(candidate, target);
}

async function supplierContext(userId: string) {
  return (await rows<any>(
    `SELECT s.id AS "supplierId", s.display_name AS "displayName", s.legal_name AS "legalName"
     FROM supplier_member m JOIN supplier s ON s.id=m.supplier_id
     WHERE m.user_id=$1 AND s.status='approved' LIMIT 1`,
    [userId],
  ))[0] ?? null;
}

async function activeAccount(userId: string) {
  return (await rows<any>(
    `SELECT * FROM wholesale_account WHERE user_id=$1 AND status='approved'
     AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC LIMIT 1`,
    [userId],
  ))[0] ?? null;
}

async function catalog(where = "", values: unknown[] = []) {
  const products = await rows<any>(
    `SELECT * FROM supplier_product ${where} ORDER BY updated_at DESC`, values,
  );
  if (!products.length) return [];
  const variants = await rows<any>(
    `SELECT v.*, i.on_hand, i.reserved FROM supplier_variant v
     LEFT JOIN supplier_inventory i ON i.variant_id=v.id WHERE v.product_id=ANY($1::text[])`,
    [products.map((product) => product.id)],
  );
  const byProduct = new Map<string, any[]>();
  for (const variant of variants) {
    const item = {
      id: variant.id, sku: variant.sku, color: variant.color, color_hex: variant.color_hex,
      size: variant.size, inventory: { on_hand: variant.on_hand ?? 0, reserved: variant.reserved ?? 0 },
    };
    byProduct.set(variant.product_id, [...(byProduct.get(variant.product_id) ?? []), item]);
  }
  return products.map((product) => ({
    id: product.id, supplier_id: product.supplier_id, name: product.name, sku: product.sku,
    category: product.category, description: product.description, wholesale_price: Number(product.wholesale_price),
    image_url: product.image_url, status: product.status, updated_at: product.updated_at,
    product_variants: byProduct.get(product.id) ?? [],
  }));
}

async function purchaseOrders(supplierId?: string, wholesaleOrderId?: string) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (supplierId) { values.push(supplierId); conditions.push(`supplier_id=$${values.length}`); }
  if (wholesaleOrderId) { values.push(wholesaleOrderId); conditions.push(`wholesale_order_id=$${values.length}`); }
  const orders = await rows<any>(
    `SELECT * FROM purchase_order ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY created_at DESC`, values,
  );
  const items = orders.length ? await rows<any>(
    `SELECT * FROM purchase_order_item WHERE purchase_order_id=ANY($1::text[])`, [orders.map((order) => order.id)],
  ) : [];
  return orders.map((order) => ({
    id: order.id, order_code: order.order_code, status: order.status, supplier_id: order.supplier_id,
    wholesale_order_id: order.wholesale_order_id, due_date: order.due_date, total_amount: Number(order.total_amount),
    tracking_code: order.tracking_code, shipped_at: order.shipped_at, delivered_at: order.delivered_at,
    created_at: order.created_at,
    purchase_order_items: items.filter((item) => item.purchase_order_id === order.id).map((item) => ({
      id: item.id, product_name: item.product_name, sku: item.sku, variant_id: item.variant_id,
      quantity: item.quantity, unit_price: Number(item.unit_price),
    })),
  }));
}

async function wholesaleOrders(accountId?: string) {
  const orders = await rows<any>(
    `SELECT * FROM wholesale_order ${accountId ? "WHERE account_id=$1" : ""} ORDER BY created_at DESC`,
    accountId ? [accountId] : [],
  );
  const items = orders.length ? await rows<any>(
    `SELECT * FROM wholesale_order_item WHERE order_id=ANY($1::text[])`, [orders.map((order) => order.id)],
  ) : [];
  return orders.map((order) => ({
    id: order.id, order_code: order.order_code, status: order.status, total_amount: Number(order.total_amount),
    total_units: order.total_units, created_at: order.created_at, account_id: order.account_id,
    wholesale_order_items: items.filter((item) => item.order_id === order.id).map((item) => ({
      id: item.id, product_id: item.product_id, variant_id: item.variant_id, product_name: item.product_name,
      sku: item.sku, quantity: item.quantity, unit_price: Number(item.unit_price),
    })),
  }));
}

async function updatePurchaseOrder(client: PoolClient, id: string, status: string, trackingCode?: string) {
  const current = (await client.query<any>("SELECT * FROM purchase_order WHERE id=$1 FOR UPDATE", [id])).rows[0];
  if (!current) throw new HttpError(404, "ORDER_NOT_FOUND");
  const transitions: Record<string, string[]> = {
    pending: ["confirmed", "cancelled"], confirmed: ["preparing", "cancelled"],
    preparing: ["shipped", "cancelled"], shipped: ["delivered"], delivered: [], cancelled: [],
  };
  if (!transitions[current.status]?.includes(status)) throw new HttpError(409, "INVALID_STATUS_TRANSITION");
  if (status === "shipped" && !trackingCode?.trim()) throw new HttpError(409, "TRACKING_CODE_REQUIRED");
  await client.query(
    `UPDATE purchase_order SET status=$2, tracking_code=CASE WHEN $2='shipped' THEN $3 ELSE tracking_code END,
     shipped_at=CASE WHEN $2='shipped' THEN now() ELSE shipped_at END,
     delivered_at=CASE WHEN $2='delivered' THEN now() ELSE delivered_at END, updated_at=now() WHERE id=$1`,
    [id, status, trackingCode?.trim() ?? null],
  );
  if (status === "delivered") {
    const items = (await client.query<any>("SELECT * FROM purchase_order_item WHERE purchase_order_id=$1", [id])).rows;
    for (const item of items) {
      if (item.variant_id) await client.query(
        `UPDATE supplier_inventory SET on_hand=GREATEST(0,on_hand-$2), reserved=GREATEST(0,reserved-$2), updated_at=now() WHERE variant_id=$1`,
        [item.variant_id, item.quantity],
      );
    }
    if (current.wholesale_order_id) {
      const open = await client.query(
        `SELECT 1 FROM purchase_order WHERE wholesale_order_id=$1 AND id<>$2 AND status NOT IN ('delivered','cancelled') LIMIT 1`,
        [current.wholesale_order_id, id],
      );
      if (!open.rowCount) await client.query("UPDATE wholesale_order SET status='fulfilled',updated_at=now() WHERE id=$1", [current.wholesale_order_id]);
    }
  }
}

function logShape(log: any) {
  return {
    id: log.id, level: log.level, source: log.source, eventType: log.event_type, message: log.message,
    errorName: log.error_name, stack: log.stack, fingerprint: log.fingerprint, status: log.status,
    httpMethod: log.http_method, path: log.path, httpStatus: log.http_status, durationMs: log.duration_ms,
    requestId: log.request_id, actorId: log.actor_id, actorRole: log.actor_role, ip: log.ip,
    userAgent: log.user_agent, environment: log.environment, release: log.release, metadata: log.metadata,
    firstSeenAt: log.first_seen_at, lastSeenAt: log.last_seen_at, occurrenceCount: log.occurrence_count,
    resolvedAt: log.resolved_at, resolvedBy: log.resolved_by, resolutionNote: log.resolution_note,
    createdAt: log.created_at,
  };
}

async function handleAuth(req: NextRequest, path: string) {
  const body = await jsonBody(req);
  if (path === "auth/register") {
    if (!body.email || !body.password || String(body.password).length < 8) throw new HttpError(422, "INVALID_INPUT");
    const { salt, passwordHash } = passwordRecord(String(body.password));
    try {
      const [user] = await rows<any>(
        `INSERT INTO account_user (id,email,password_hash,salt,role,display_name,phone)
         VALUES ($1,$2,$3,$4,'customer',$5,$6) RETURNING id,email,role,display_name,phone`,
        [makeId("usr"), String(body.email).trim().toLowerCase(), passwordHash, salt, body.name?.trim() || null, body.phone?.trim() || null],
      );
      return response({ user: { id: user.id, email: user.email, role: user.role, name: user.display_name, phone: user.phone } }, 201);
    } catch (error: any) {
      if (error?.code === "23505") throw new HttpError(409, "EMAIL_EXISTS");
      throw error;
    }
  }
  if (path === "auth/login") {
    if (!body.email || !body.password) throw new HttpError(422, "INVALID_INPUT");
    const user = (await rows<any>("SELECT * FROM account_user WHERE email=$1 LIMIT 1", [String(body.email).trim().toLowerCase()]))[0];
    if (!user || user.status !== "active" || !passwordMatches(String(body.password), user.salt, user.password_hash)) {
      throw new HttpError(401, "INVALID_CREDENTIALS");
    }
    if (body.role && body.role !== user.role) throw new HttpError(403, "ROLE_MISMATCH");
    return response({
      token: issueToken(user.id, user.role),
      user: { id: user.id, email: user.email, role: user.role, name: user.display_name, phone: user.phone },
    });
  }
  throw new HttpError(404, "NOT_FOUND");
}

async function handleSupplier(req: NextRequest, path: string) {
  const method = req.method;
  if (path === "supplier/apply" && method === "POST") {
    const body = await jsonBody(req);
    if (!body.companyName?.trim() || !body.representativeName?.trim() || !body.phone?.trim() || !body.category?.trim()) {
      throw new HttpError(422, "INVALID_INPUT");
    }
    const id = makeId("sapp");
    await rows(
      `INSERT INTO supplier_application (id,company_name,representative_name,phone,category,monthly_capacity)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [id, body.companyName.trim(), body.representativeName.trim(), body.phone.trim(), body.category.trim(), body.monthlyCapacity ?? null],
    );
    return response({ id }, 201);
  }
  if (path === "supplier/auth/login" && method === "POST") {
    const body = await jsonBody(req);
    const user = (await rows<any>("SELECT * FROM account_user WHERE email=$1 AND role='supplier' LIMIT 1", [String(body.email ?? "").trim().toLowerCase()]))[0];
    if (!user || !passwordMatches(String(body.password ?? ""), user.salt, user.password_hash)) throw new HttpError(401, "INVALID_CREDENTIALS");
    const context = await supplierContext(user.id);
    if (!context) throw new HttpError(403, "SUPPLIER_ACCESS_INACTIVE");
    return response({ token: issueToken(user.id, user.role), supplier: context });
  }

  const claims = requireRole(req, "supplier");
  const context = await supplierContext(claims.sub);
  if (!context) throw new HttpError(403, "SUPPLIER_ACCESS_INACTIVE");
  if (path === "supplier/session" && method === "GET") return response({ supplier: context });
  if (path === "supplier/products" && method === "GET") return response({ products: await catalog("WHERE supplier_id=$1", [context.supplierId]) });
  if (path === "supplier/products" && method === "POST") {
    const body = await jsonBody(req);
    if (!body.name?.trim() || !body.sku?.trim() || !body.category?.trim()) throw new HttpError(422, "INVALID_INPUT");
    try {
      const product = await transaction(async (client) => {
        const id = makeId("prd");
        const sku = body.sku.trim().toUpperCase();
        const result = await client.query<any>(
          `INSERT INTO supplier_product (id,supplier_id,name,sku,category,description,wholesale_price,image_url,status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'submitted') RETURNING *`,
          [id, context.supplierId, body.name.trim(), sku, body.category.trim(), body.description?.trim() || "", Number(body.wholesalePrice ?? 0), body.imageUrl?.trim() || null],
        );
        const variantId = makeId("var");
        const size = body.size?.trim() || "تک‌سایز";
        await client.query(
          `INSERT INTO supplier_variant (id,product_id,sku,color,color_hex,size,cost) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [variantId, id, `${sku}-${size}`.toUpperCase(), body.color?.trim() || "بدون رنگ", body.colorHex ?? null, size, Number(body.wholesalePrice ?? 0)],
        );
        await client.query("INSERT INTO supplier_inventory (id,variant_id,on_hand,reserved) VALUES ($1,$2,$3,0)", [makeId("inv"), variantId, Math.max(0, Number(body.stock ?? 0))]);
        return result.rows[0];
      });
      return response({ product: { id: product.id, name: product.name, sku: product.sku, status: product.status } }, 201);
    } catch (error: any) {
      if (error?.code === "23505") throw new HttpError(409, "DUPLICATE_SKU");
      throw error;
    }
  }
  if (path === "supplier/orders" && method === "GET") return response({ orders: await purchaseOrders(context.supplierId) });
  const orderStatus = path.match(/^supplier\/orders\/([^/]+)\/status$/);
  if (orderStatus && method === "POST") {
    const body = await jsonBody(req);
    const owns = (await rows("SELECT 1 FROM purchase_order WHERE id=$1 AND supplier_id=$2", [orderStatus[1], context.supplierId])).length > 0;
    if (!owns) throw new HttpError(404, "ORDER_NOT_FOUND");
    await transaction((client) => updatePurchaseOrder(client, orderStatus[1], body.status, body.trackingCode));
    return response({ status: body.status });
  }
  if (path === "supplier/rfqs" && method === "GET") {
    const rfqs = await rows<any>("SELECT * FROM rfq WHERE supplier_id=$1 ORDER BY created_at DESC", [context.supplierId]);
    return response({ rfqs });
  }
  const quoteMatch = path.match(/^supplier\/rfqs\/([^/]+)\/quote$/);
  if (quoteMatch && method === "POST") {
    const body = await jsonBody(req);
    if (!body.unitPrice) throw new HttpError(422, "INVALID_INPUT");
    const rfq = (await rows<any>("SELECT * FROM rfq WHERE id=$1 AND supplier_id=$2", [quoteMatch[1], context.supplierId]))[0];
    if (!rfq) throw new HttpError(404, "RFQ_NOT_FOUND");
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO quote (id,rfq_id,supplier_id,unit_price,lead_time_days,notes) VALUES ($1,$2,$3,$4,$5,$6)`,
        [makeId("quo"), rfq.id, context.supplierId, Number(body.unitPrice), Number(body.leadTimeDays ?? 0), body.notes?.trim() || null],
      );
      await client.query("UPDATE rfq SET status='quoted',updated_at=now() WHERE id=$1", [rfq.id]);
    });
    return response({ status: "quoted" }, 201);
  }
  if (path === "supplier/tickets" && method === "GET") {
    return response({ tickets: await rows("SELECT * FROM support_ticket WHERE supplier_id=$1 ORDER BY created_at DESC", [context.supplierId]) });
  }
  if (path === "supplier/tickets" && method === "POST") {
    const body = await jsonBody(req);
    if (!body.subject?.trim() || !body.message?.trim()) throw new HttpError(422, "INVALID_INPUT");
    const id = makeId("tic");
    await rows(
      `INSERT INTO support_ticket (id,supplier_id,subject,category,message,priority) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [id, context.supplierId, body.subject.trim(), body.category?.trim() || "عمومی", body.message.trim(), ["low", "normal", "high"].includes(body.priority) ? body.priority : "normal"],
    );
    return response({ id }, 201);
  }
  throw new HttpError(404, "NOT_FOUND");
}

async function handleWholesale(req: NextRequest, path: string) {
  if (path === "wholesale/apply" && req.method === "POST") {
    const claims = claimsFrom(req);
    if (!claims || !["customer", "vip"].includes(claims.role)) throw new HttpError(401, "UNAUTHORIZED");
    const body = await jsonBody(req);
    if (!body.storeName?.trim() || !body.phone?.trim() || !body.city?.trim()) throw new HttpError(422, "INVALID_INPUT");
    if (!body.paymentReference?.trim() || !body.planName?.trim()) throw new HttpError(422, "PAYMENT_REQUIRED");
    const existing = (await rows<any>("SELECT * FROM wholesale_account WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [claims.sub]))[0];
    const account = existing ? (await rows<any>(
      `UPDATE wholesale_account SET member_name=$2,store_name=$3,phone=$4,city=$5,plan_name=$6,status='approved',activated_at=now(),expires_at=now()+interval '1 year',updated_at=now() WHERE id=$1 RETURNING *`,
      [existing.id, body.memberName?.trim() || body.storeName.trim(), body.storeName.trim(), body.phone.trim(), body.city.trim(), body.planName.trim()],
    ))[0] : (await rows<any>(
      `INSERT INTO wholesale_account (id,user_id,member_name,store_name,phone,city,plan_name,status,activated_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'approved',now(),now()+interval '1 year') RETURNING *`,
      [makeId("wacc"), claims.sub, body.memberName?.trim() || body.storeName.trim(), body.storeName.trim(), body.phone.trim(), body.city.trim(), body.planName.trim()],
    ))[0];
    await rows("UPDATE account_user SET role='vip',updated_at=now() WHERE id=$1", [claims.sub]);
    return response({ status: "approved", account, paymentReference: body.paymentReference }, 201);
  }
  const claims = claimsFrom(req);
  if (!claims || !["customer", "vip"].includes(claims.role)) throw new HttpError(401, "UNAUTHORIZED");
  const account = await activeAccount(claims.sub);
  if (!account) throw new HttpError(403, "VIP_ACCOUNT_INACTIVE");
  if (path === "wholesale/account" && req.method === "GET") return response({ account });
  if (path === "wholesale/products" && req.method === "GET") return response({ products: await catalog("WHERE status='approved'") });
  if (path === "wholesale/orders" && req.method === "GET") return response({ orders: await wholesaleOrders(account.id) });
  if (path === "wholesale/orders" && req.method === "POST") {
    const body = await jsonBody(req);
    if (!Array.isArray(body.lines) || !body.lines.length) throw new HttpError(422, "EMPTY_ORDER");
    const result = await transaction(async (client) => {
      const resolved: any[] = [];
      let totalUnits = 0;
      let totalAmount = 0;
      for (const line of body.lines) {
        const quantity = Math.floor(Number(line.quantity));
        if (quantity <= 0) throw new HttpError(422, "INVALID_QUANTITY");
        const item = (await client.query<any>(
          `SELECT v.id AS variant_id,v.sku,p.id AS product_id,p.name,p.wholesale_price,i.on_hand,i.reserved
           FROM supplier_variant v JOIN supplier_product p ON p.id=v.product_id
           JOIN supplier_inventory i ON i.variant_id=v.id WHERE v.id=$1 AND p.status='approved' FOR UPDATE OF i`,
          [line.variantId],
        )).rows[0];
        if (!item) throw new HttpError(404, "VARIANT_NOT_FOUND");
        if (item.on_hand - item.reserved < quantity) throw new HttpError(409, "INSUFFICIENT_STOCK");
        resolved.push({ ...item, quantity });
        totalUnits += quantity;
        totalAmount += quantity * Number(item.wholesale_price);
      }
      if (totalUnits < 12) throw new HttpError(422, "BELOW_MIN_UNITS");
      const orderId = makeId("word");
      const orderCode = `KV-${new Date().getFullYear()}-${randomUUID().slice(0, 5).toUpperCase()}`;
      await client.query(
        `INSERT INTO wholesale_order (id,order_code,account_id,total_amount,total_units) VALUES ($1,$2,$3,$4,$5)`,
        [orderId, orderCode, account.id, totalAmount, totalUnits],
      );
      for (const item of resolved) {
        await client.query("UPDATE supplier_inventory SET reserved=reserved+$2,updated_at=now() WHERE variant_id=$1", [item.variant_id, item.quantity]);
        await client.query(
          `INSERT INTO wholesale_order_item (id,order_id,product_id,variant_id,product_name,sku,quantity,unit_price)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [makeId("woi"), orderId, item.product_id, item.variant_id, item.name, item.sku, item.quantity, item.wholesale_price],
        );
      }
      return { orderCode };
    });
    return response(result, 201);
  }
  throw new HttpError(404, "NOT_FOUND");
}

async function handleAdmin(req: NextRequest, path: string) {
  const claims = requireRole(req, "admin");
  const method = req.method;
  if (path === "admin/site-settings" && method === "PUT") {
    const body = await jsonBody(req);
    if (!body.settings || typeof body.settings !== "object" || Array.isArray(body.settings)) throw new HttpError(422, "INVALID_SETTINGS");
    const video = embeddedHeroVideo(body.settings);
    const bannerVideo = embeddedBannerVideo(body.settings);
    const settings = withoutEmbeddedVideos(body.settings);
    await transaction(async (client) => {
      if (video) {
        await client.query(
          `INSERT INTO site_setting (setting_key,value,updated_by) VALUES ($1,$2,$3)
           ON CONFLICT (setting_key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`,
          [HERO_VIDEO_SETTING_KEY, { dataUrl: video }, claims.sub],
        );
      }
      if (bannerVideo) {
        await client.query(
          `INSERT INTO site_setting (setting_key,value,updated_by) VALUES ($1,$2,$3)
           ON CONFLICT (setting_key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`,
          [BANNER_VIDEO_SETTING_KEY, { dataUrl: bannerVideo }, claims.sub],
        );
      }
      await client.query(
        `INSERT INTO site_setting (setting_key,value,updated_by) VALUES ('storefront',$1,$2)
         ON CONFLICT (setting_key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`,
        [settings, claims.sub],
      );
    });
    return response({ saved: true, updatedAt: new Date().toISOString() });
  }
  if (path === "admin/accounts" && method === "GET") return response({ accounts: await rows("SELECT * FROM wholesale_account ORDER BY created_at DESC") });
  const accountStatus = path.match(/^admin\/accounts\/([^/]+)\/status$/);
  if (accountStatus && method === "POST") {
    const body = await jsonBody(req);
    const account = (await rows<any>("SELECT * FROM wholesale_account WHERE id=$1", [accountStatus[1]]))[0];
    if (!account || !body.status) throw new HttpError(account ? 422 : 404, account ? "INVALID_INPUT" : "ACCOUNT_NOT_FOUND");
    await transaction(async (client) => {
      await client.query(
        `UPDATE wholesale_account SET status=$2,activated_at=CASE WHEN $2='approved' THEN now() ELSE activated_at END,
         expires_at=CASE WHEN $2='approved' THEN $3 ELSE expires_at END,updated_at=now() WHERE id=$1`,
        [account.id, body.status, body.expiresAt ?? null],
      );
      if (body.status === "approved") await client.query("UPDATE account_user SET role='vip',updated_at=now() WHERE id=$1", [account.user_id]);
    });
    return response({ status: body.status });
  }
  if (path === "admin/supplier-applications" && method === "GET") return response({ applications: await rows("SELECT * FROM supplier_application ORDER BY created_at DESC") });
  const applicationStatus = path.match(/^admin\/supplier-applications\/([^/]+)$/);
  if (applicationStatus && method === "POST") {
    const body = await jsonBody(req);
    const application = (await rows<any>("SELECT * FROM supplier_application WHERE id=$1", [applicationStatus[1]]))[0];
    if (!application || !body.status) throw new HttpError(application ? 422 : 404, application ? "INVALID_INPUT" : "APPLICATION_NOT_FOUND");
    if (body.status !== "approved") {
      await rows("UPDATE supplier_application SET status=$2,updated_at=now() WHERE id=$1 RETURNING id", [application.id, body.status]);
      return response({ status: body.status });
    }
    const supplierId = makeId("sup");
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO supplier (id,legal_name,display_name,phone,category,monthly_capacity,status) VALUES ($1,$2,$2,$3,$4,$5,'approved')`,
        [supplierId, application.company_name, application.phone, application.category, application.monthly_capacity],
      );
      await client.query("UPDATE supplier_application SET status='approved',updated_at=now() WHERE id=$1", [application.id]);
      if (body.loginEmail && String(body.loginPassword ?? "").length >= 8) {
        const credentials = passwordRecord(String(body.loginPassword));
        const userId = makeId("usr");
        await client.query(
          `INSERT INTO account_user (id,email,password_hash,salt,role,display_name,phone) VALUES ($1,$2,$3,$4,'supplier',$5,$6)`,
          [userId, String(body.loginEmail).trim().toLowerCase(), credentials.passwordHash, credentials.salt, application.company_name, application.phone],
        );
        await client.query("INSERT INTO supplier_member (id,supplier_id,user_id,title) VALUES ($1,$2,$3,$4)", [makeId("smem"), supplierId, userId, "مدیر تأمین"]);
      }
    });
    return response({ status: "approved", supplier_id: supplierId });
  }
  if (path === "admin/suppliers" && method === "GET") return response({ suppliers: await rows("SELECT * FROM supplier ORDER BY created_at DESC") });
  if (path === "admin/catalog" && method === "GET") {
    const products = await catalog();
    const suppliers = await rows<any>("SELECT id,display_name FROM supplier");
    const names = new Map(suppliers.map((supplier) => [supplier.id, supplier.display_name]));
    return response({ products: products.map((product) => ({
      ...product, supplier_name: names.get(product.supplier_id) ?? "—",
      stock: product.product_variants.reduce((sum: number, variant: any) => sum + Number(variant.inventory?.on_hand ?? 0), 0),
    })) });
  }
  const catalogStatus = path.match(/^admin\/catalog\/([^/]+)\/status$/);
  if (catalogStatus && method === "POST") {
    const body = await jsonBody(req);
    if (!body.status) throw new HttpError(422, "INVALID_INPUT");
    await rows("UPDATE supplier_product SET status=$2,updated_at=now() WHERE id=$1 RETURNING id", [catalogStatus[1], body.status]);
    return response({ status: body.status });
  }
  if (path === "admin/catalog/bulk-price" && method === "POST") {
    const body = await jsonBody(req);
    if (!Array.isArray(body.ids) || !body.ids.length || !Number.isFinite(Number(body.value))) throw new HttpError(422, "INVALID_INPUT");
    const result = await database().then((db) => db.query(
      `UPDATE supplier_product SET wholesale_price=GREATEST(0,ROUND(CASE WHEN $2='amount' THEN wholesale_price+$3 ELSE wholesale_price*(1+$3/100.0) END)),updated_at=now()
       WHERE id=ANY($1::text[])`, [body.ids, body.mode, Number(body.value)],
    ));
    return response({ updated: result.rowCount ?? 0 });
  }
  if (path === "admin/purchase-orders" && method === "GET") return response({ orders: await purchaseOrders() });
  const poStatus = path.match(/^admin\/purchase-orders\/([^/]+)\/status$/);
  if (poStatus && method === "POST") {
    const body = await jsonBody(req);
    await transaction((client) => updatePurchaseOrder(client, poStatus[1], body.status, body.trackingCode));
    return response({ status: body.status });
  }
  if (path === "admin/orders" && method === "GET") {
    const [orders, accounts, suppliers, pos] = await Promise.all([wholesaleOrders(), rows<any>("SELECT * FROM wholesale_account"), rows<any>("SELECT * FROM supplier"), purchaseOrders()]);
    const accountMap = new Map(accounts.map((account) => [account.id, account]));
    const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    return response({ orders: orders.map((order) => ({
      ...order, store_name: accountMap.get(order.account_id)?.store_name ?? "—",
      purchase_orders: pos.filter((po) => po.wholesale_order_id === order.id).map((po) => ({
        id: po.id, order_code: po.order_code, status: po.status,
        supplier_name: supplierMap.get(po.supplier_id)?.display_name ?? "—", tracking_code: po.tracking_code,
      })),
    })) });
  }
  const approveOrder = path.match(/^admin\/orders\/([^/]+)\/approve$/);
  if (approveOrder && method === "POST") {
    const body = await jsonBody(req);
    const result = await transaction(async (client) => {
      const order = (await client.query<any>("SELECT * FROM wholesale_order WHERE id=$1 FOR UPDATE", [approveOrder[1]])).rows[0];
      if (!order || order.status !== "pending") throw new HttpError(409, "ORDER_NOT_PENDING");
      const items = (await client.query<any>(
        `SELECT wi.*,p.supplier_id FROM wholesale_order_item wi JOIN supplier_product p ON p.id=wi.product_id WHERE wi.order_id=$1`, [order.id],
      )).rows;
      const groups = new Map<string, any[]>();
      for (const item of items) groups.set(item.supplier_id, [...(groups.get(item.supplier_id) ?? []), item]);
      let count = 0;
      for (const [supplierId, group] of groups) {
        count += 1;
        const poId = makeId("po");
        await client.query(
          `INSERT INTO purchase_order (id,order_code,supplier_id,wholesale_order_id,due_date,total_amount)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [poId, `PO-${new Date().getFullYear()}-${randomUUID().slice(0, 5).toUpperCase()}-${count}`, supplierId, order.id, body.dueDate ?? null, group.reduce((sum, item) => sum + item.quantity * Number(item.unit_price), 0)],
        );
        for (const item of group) await client.query(
          `INSERT INTO purchase_order_item (id,purchase_order_id,product_name,sku,variant_id,quantity,unit_price,total_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [makeId("poi"), poId, item.product_name, item.sku, item.variant_id, item.quantity, item.unit_price, item.quantity * Number(item.unit_price)],
        );
      }
      await client.query("UPDATE wholesale_order SET status='approved',updated_at=now() WHERE id=$1", [order.id]);
      return { order_id: order.id, purchase_orders: count };
    });
    return response(result);
  }
  const cancelOrder = path.match(/^admin\/orders\/([^/]+)\/cancel$/);
  if (cancelOrder && method === "POST") {
    await transaction(async (client) => {
      const order = (await client.query<any>("SELECT * FROM wholesale_order WHERE id=$1 FOR UPDATE", [cancelOrder[1]])).rows[0];
      if (!order) throw new HttpError(404, "ORDER_NOT_FOUND");
      if (order.status === "fulfilled") throw new HttpError(409, "ORDER_ALREADY_FULFILLED");
      const items = (await client.query<any>("SELECT * FROM wholesale_order_item WHERE order_id=$1", [order.id])).rows;
      for (const item of items) await client.query("UPDATE supplier_inventory SET reserved=GREATEST(0,reserved-$2),updated_at=now() WHERE variant_id=$1", [item.variant_id, item.quantity]);
      await client.query("UPDATE purchase_order SET status='cancelled',updated_at=now() WHERE wholesale_order_id=$1 AND status IN ('pending','confirmed','preparing')", [order.id]);
      await client.query("UPDATE wholesale_order SET status='cancelled',updated_at=now() WHERE id=$1", [order.id]);
    });
    return response({ status: "cancelled" });
  }
  if (path === "admin/rfqs" && method === "GET") return response({ rfqs: await rows("SELECT * FROM rfq ORDER BY created_at DESC") });
  if (path === "admin/rfqs" && method === "POST") {
    const body = await jsonBody(req);
    if (!body.supplierId || !body.title?.trim()) throw new HttpError(422, "INVALID_INPUT");
    const id = makeId("rfq");
    const referenceCode = `RFQ-${new Date().getFullYear()}-${randomUUID().slice(0, 5).toUpperCase()}`;
    await rows(
      `INSERT INTO rfq (id,supplier_id,reference_code,title,customer_name,quantity,requested_delivery_date,specifications)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [id, body.supplierId, referenceCode, body.title.trim(), body.customerName?.trim() || "کلبه وینتیج", Number(body.quantity ?? 0), body.requestedDeliveryDate ?? null, body.specifications ?? {}],
    );
    return response({ id, reference_code: referenceCode }, 201);
  }
  if (path === "admin/tickets" && method === "GET") return response({ tickets: await rows("SELECT * FROM support_ticket ORDER BY created_at DESC") });
  const ticketStatus = path.match(/^admin\/tickets\/([^/]+)$/);
  if (ticketStatus && method === "POST") {
    const body = await jsonBody(req);
    if (!body.status) throw new HttpError(422, "INVALID_INPUT");
    await rows(
      `UPDATE support_ticket SET status=$2,admin_reply=COALESCE($3,admin_reply),updated_at=now() WHERE id=$1 RETURNING id`,
      [ticketStatus[1], body.status, body.adminReply?.trim() || null],
    );
    return response({ status: body.status });
  }
  if (path === "admin/logs" && method === "GET") {
    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit")) || 50));
    const values: unknown[] = [];
    const filters: string[] = [];
    for (const [key, column] of [["level", "level"], ["source", "source"], ["status", "status"]] as const) {
      const value = url.searchParams.get(key);
      if (value && value !== "all") { values.push(value); filters.push(`${column}=$${values.length}`); }
    }
    const query = url.searchParams.get("q")?.trim();
    if (query) { values.push(`%${query}%`); filters.push(`(message ILIKE $${values.length} OR event_type ILIKE $${values.length} OR path ILIKE $${values.length})`); }
    const range = url.searchParams.get("range") ?? "24h";
    if (range !== "all") {
      const interval = range === "30d" ? "30 days" : range === "7d" ? "7 days" : "24 hours";
      filters.push(`last_seen_at >= now() - interval '${interval}'`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const total = Number((await rows<any>(`SELECT count(*) AS count FROM system_log ${where}`, values))[0]?.count ?? 0);
    values.push(limit, (page - 1) * limit);
    const logs = await rows<any>(`SELECT * FROM system_log ${where} ORDER BY last_seen_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    const summary = (await rows<any>(
      `SELECT
       coalesce(sum(occurrence_count) FILTER (WHERE status='open' AND level IN ('error','critical')),0) AS open_errors,
       coalesce(sum(occurrence_count) FILTER (WHERE status='open' AND level='critical'),0) AS critical_open,
       coalesce(sum(occurrence_count) FILTER (WHERE last_seen_at>=now()-interval '24 hours' AND level IN ('error','critical')),0) AS errors_24h,
       coalesce(sum(occurrence_count) FILTER (WHERE last_seen_at>=now()-interval '24 hours' AND source='frontend'),0) AS frontend_24h,
       coalesce(sum(occurrence_count) FILTER (WHERE last_seen_at>=now()-interval '24 hours' AND level='warning'),0) AS warnings_24h,
       coalesce(sum(occurrence_count) FILTER (WHERE last_seen_at>=now()-interval '24 hours' AND event_type='api.slow'),0) AS slow_24h
       FROM system_log`,
    ))[0];
    return response({
      logs: logs.map(logShape),
      pagination: { page, limit, total, pageCount: Math.max(1, Math.ceil(total / limit)), capped: false },
      summary: { openErrors: Number(summary.open_errors), criticalOpen: Number(summary.critical_open), errors24h: Number(summary.errors_24h), frontend24h: Number(summary.frontend_24h), warnings24h: Number(summary.warnings_24h), slow24h: Number(summary.slow_24h) },
    });
  }
  const logStatus = path.match(/^admin\/logs\/([^/]+)$/);
  if (logStatus && method === "POST") {
    const body = await jsonBody(req);
    const [log] = await rows<any>(
      `UPDATE system_log SET status=$2,resolved_at=CASE WHEN $2='open' THEN NULL ELSE now() END,
       resolved_by=CASE WHEN $2='open' THEN NULL ELSE $3 END,resolution_note=$4,updated_at=now() WHERE id=$1 RETURNING *`,
      [logStatus[1], body.status, claims.sub, body.note?.trim() || null],
    );
    if (!log) throw new HttpError(404, "LOG_NOT_FOUND");
    return response({ log: logShape(log) });
  }
  throw new HttpError(404, "NOT_FOUND");
}

async function handleRequest(req: NextRequest, pathParts: string[]) {
  const path = pathParts.join("/");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (path.startsWith("try-on/")) {
    const result = await handlePerfectCorpRequest(req, path);
    return result instanceof Response ? result : response(result);
  }
  await database();
  if (path === "health") return response({ ok: true, service: "kolbe-api", database: "postgresql" });
  if ((path === "site/hero-video" || path === "site/banner-video") && req.method === "GET") {
    const isBanner = path === "site/banner-video";
    const settingKey = isBanner ? BANNER_VIDEO_SETTING_KEY : HERO_VIDEO_SETTING_KEY;
    const stored = (await rows<any>("SELECT value FROM site_setting WHERE setting_key=$1 LIMIT 1", [settingKey]))[0];
    let dataUrl = stored?.value?.dataUrl as string | undefined;
    if (!dataUrl) {
      const legacy = (await rows<any>("SELECT value FROM site_setting WHERE setting_key='storefront' LIMIT 1"))[0];
      dataUrl = (isBanner ? embeddedBannerVideo(legacy?.value) : embeddedHeroVideo(legacy?.value)) ?? undefined;
    }
    const video = dataUrl ? parseVideoDataUrl(dataUrl) : null;
    if (!video) throw new HttpError(404, "HERO_VIDEO_NOT_FOUND");

    const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
    const commonHeaders = {
      ...CORS_HEADERS,
      "content-type": video.mime,
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=3600",
    };
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = Math.min(range[2] ? Number(range[2]) : video.bytes.length - 1, video.bytes.length - 1);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end) {
        return new Response(null, { status: 416, headers: { ...commonHeaders, "content-range": `bytes */${video.bytes.length}` } });
      }
      const chunkLength = end - start + 1;
      return new Response(videoStream(video.bytes, start, end), {
        status: 206,
        headers: {
          ...commonHeaders,
          "content-length": String(chunkLength),
          "content-range": `bytes ${start}-${end}/${video.bytes.length}`,
        },
      });
    }
    return new Response(videoStream(video.bytes), {
      headers: { ...commonHeaders, "content-length": String(video.bytes.length) },
    });
  }
  if (path === "site/settings" && req.method === "GET") {
    const setting = (await rows<any>("SELECT value,updated_at FROM site_setting WHERE setting_key='storefront' LIMIT 1"))[0];
    const video = embeddedHeroVideo(setting?.value);
    const bannerVideo = embeddedBannerVideo(setting?.value);
    const settings = withoutEmbeddedVideos(setting?.value ?? null);
    if (video) {
      // مهاجرت یک‌باره داده قدیمی: ویدیو را از JSON عمومی و حجیم تنظیمات جدا می‌کند.
      await transaction(async (client) => {
        await client.query(
          `INSERT INTO site_setting (setting_key,value) VALUES ($1,$2)
           ON CONFLICT (setting_key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
          [HERO_VIDEO_SETTING_KEY, { dataUrl: video }],
        );
        await client.query("UPDATE site_setting SET value=$1,updated_at=now() WHERE setting_key='storefront'", [settings]);
      });
    }
    if (bannerVideo) {
      await transaction(async (client) => {
        await client.query(
          `INSERT INTO site_setting (setting_key,value) VALUES ($1,$2)
           ON CONFLICT (setting_key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
          [BANNER_VIDEO_SETTING_KEY, { dataUrl: bannerVideo }],
        );
        await client.query("UPDATE site_setting SET value=$1,updated_at=now() WHERE setting_key='storefront'", [settings]);
      });
    }
    return response({ settings, updatedAt: setting?.updated_at ?? null });
  }
  if (path.startsWith("auth/")) return handleAuth(req, path);
  if (path === "me" && req.method === "GET") {
    const claims = requireRole(req, "customer");
    const user = (await rows<any>("SELECT id,email,display_name,phone FROM account_user WHERE id=$1", [claims.sub]))[0];
    if (!user) throw new HttpError(401, "UNAUTHORIZED");
    return response({ id: user.id, name: user.display_name ?? user.email.split("@")[0], phone: user.phone ?? "—", email: user.email });
  }
  if (path === "retail/orders" && req.method === "POST") {
    const body = await jsonBody(req);
    if (!Array.isArray(body.lines) || !body.lines.length) throw new HttpError(422, "EMPTY_CART");
    if (!body.customer?.name?.trim() || !body.customer?.phone?.trim()) throw new HttpError(422, "CUSTOMER_INFO_REQUIRED");
    const orderCode = `RT-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
    await rows(
      `INSERT INTO retail_order (id,order_code,customer_name,phone,email,lines,address,shipping_method,shipping_price,pay_method,total_amount,payment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [makeId("rord"), orderCode, body.customer.name.trim(), body.customer.phone.trim(), body.customer.email?.trim() || null, body.lines, body.address ?? {}, body.shipping?.id ?? "post", Number(body.totals?.shipping ?? 0), body.payMethod ?? "gateway", Number(body.totals?.total ?? 0), body.payMethod === "cod" ? "pending_cod" : "pending_gateway"],
    );
    return response({ orderCode }, 201);
  }
  if (path === "logs/client" && req.method === "POST") {
    const body = await jsonBody(req);
    const message = String(body.message ?? "خطای بدون پیام").slice(0, 2000);
    const fingerprint = createHash("sha256").update([body.type, body.name, body.url, message].join("|")).digest("hex").slice(0, 32);
    await rows(
      `INSERT INTO system_log (id,level,source,event_type,message,error_name,stack,fingerprint,http_method,path,http_status,environment,release,metadata,first_seen_at,last_seen_at)
       VALUES ($1,$2,'frontend',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),now())
       ON CONFLICT (fingerprint) WHERE status='open' DO UPDATE SET last_seen_at=now(),occurrence_count=system_log.occurrence_count+1,updated_at=now() RETURNING id`,
      [makeId("log"), body.status && body.status < 500 ? "warning" : "error", body.type ?? "frontend.error", message, body.name ?? null, body.stack ?? null, fingerprint, body.method ?? null, body.url ?? null, body.status ?? null, process.env.NODE_ENV ?? "development", body.release ?? null, { line: body.line, column: body.column, componentStack: body.componentStack }],
    );
    return response({ accepted: true }, 202);
  }
  if (path.startsWith("supplier/")) return handleSupplier(req, path);
  if (path.startsWith("wholesale/")) return handleWholesale(req, path);
  if (path.startsWith("admin/")) return handleAdmin(req, path);
  throw new HttpError(404, "NOT_FOUND");
}

export async function handleKolbeRequest(req: NextRequest, pathParts: string[]) {
  try {
    return await handleRequest(req, pathParts);
  } catch (error: any) {
    const status = error instanceof HttpError || isPerfectCorpError(error) ? error.status : 500;
    const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
    if (status >= 500) console.error("Kolbe API error", error);
    return response({ error: code, message: status >= 500 ? "خطای داخلی سرور" : code }, status);
  }
}

export function corsHeaders() {
  return { ...CORS_HEADERS };
}
