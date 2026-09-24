import { Controller, Get, Inject, Query } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { AllowStaleCustomerVipRead, CurrentUser, Public, Roles } from "../common/guards/session.guard";
import type { Claims } from "../common/session";
import { toApiJson } from "../common/api-json";
import { KOLBE_DB, type KolbeDatabase } from "./database.module";
import { DomainError } from "@kolbe/shared";

type Row = Record<string, any>;

abstract class ReadProjection {
  constructor(@Inject(KOLBE_DB) protected readonly db: KolbeDatabase) {}

  protected async rows<T extends Row = Row>(query: any): Promise<T[]> {
    const result = await this.db.execute<T>(query) as any;
    return (result.rows ?? result) as T[];
  }

  protected async supplier(userId: string): Promise<Row> {
    const [row] = await this.rows(sql`
      SELECT s.id AS "supplierId", s.display_name AS "displayName", s.legal_name AS "legalName",
             s.status, m.role AS "memberRole"
      FROM supplier_member m JOIN supplier s ON s.id = m.supplier_id
      WHERE m.user_id = ${userId} AND s.status = 'approved'
      ORDER BY m.created_at ASC LIMIT 1`);
    if (!row) throw new DomainError(403, "SUPPLIER_ACCESS_INACTIVE", "Supplier access is inactive");
    return row;
  }

  protected async account(userId: string, activeOnly = false): Promise<Row | null> {
    const [row] = await this.rows(sql`
      SELECT * FROM wholesale_account
      WHERE user_id = ${userId}
        AND (${activeOnly} = false OR (status = 'approved' AND (expires_at IS NULL OR expires_at > now())))
      ORDER BY created_at DESC LIMIT 1`);
    return row ?? null;
  }

  protected async catalog(publishedOnly = false): Promise<Row[]> {
    const products = await this.rows(sql`
      SELECT p.*, so.wholesale_price, so.seller_id, s.supplier_id, sp.display_name AS supplier_name
      FROM product p
      LEFT JOIN seller_offer so ON so.product_id = p.id AND so.status = 'active'
      LEFT JOIN seller s ON s.id = so.seller_id
      LEFT JOIN supplier sp ON sp.id = s.supplier_id
      WHERE (${publishedOnly} = false OR p.status = 'published')
      ORDER BY p.updated_at DESC, p.id DESC`);
    const variants = await this.rows(sql`
      SELECT v.*, i.on_hand, i.reserved FROM product_variant v
      LEFT JOIN product_variant_inventory i ON i.variant_id = v.id
      ORDER BY v.created_at ASC, v.id ASC`);
    return products.map((product) => ({
      id: product.id, supplier_id: product.supplier_id ?? null, seller_id: product.seller_id ?? null,
      name: product.name, sku: product.sku, slug: product.slug, category: product.category_id,
      description: product.description, wholesale_price: Number(product.wholesale_price ?? 0),
      image_url: null, status: product.status, updated_at: product.updated_at,
      supplier_name: product.supplier_name ?? "—",
      product_variants: variants.filter((variant) => variant.product_id === product.id).map((variant) => {
        const attributes = variant.attributes ?? {};
        return { id: variant.id, sku: variant.sku, color: attributes.color ?? null,
          color_hex: attributes.color_hex ?? null, size: attributes.size ?? null, attributes,
          inventory: { on_hand: variant.on_hand ?? 0, reserved: variant.reserved ?? 0 } };
      }),
      stock: variants.filter((variant) => variant.product_id === product.id)
        .reduce((sum, variant) => sum + Number(variant.on_hand ?? 0), 0),
    }));
  }

  protected async purchaseOrders(supplierId?: string): Promise<Row[]> {
    const orders = await this.rows(sql`
      SELECT * FROM purchase_order
      WHERE (${supplierId ?? null}::text IS NULL OR supplier_id = ${supplierId ?? null})
      ORDER BY created_at DESC, id DESC`);
    const items = await this.rows(sql`SELECT * FROM purchase_order_item ORDER BY created_at ASC, id ASC`);
    return orders.map((order) => ({ ...order, total_amount: Number(order.total_amount),
      purchase_order_items: items.filter((item) => item.purchase_order_id === order.id).map((item) => ({
        ...item, unit_price: Number(item.unit_price),
      })) }));
  }

  protected async wholesaleOrders(accountId?: string): Promise<Row[]> {
    const orders = await this.rows(sql`
      SELECT * FROM wholesale_order
      WHERE (${accountId ?? null}::text IS NULL OR account_id = ${accountId ?? null})
      ORDER BY created_at DESC, id DESC`);
    const items = await this.rows(sql`SELECT * FROM wholesale_order_item ORDER BY created_at ASC, id ASC`);
    return orders.map((order) => ({ ...order, total_amount: Number(order.total_amount),
      wholesale_order_items: items.filter((item) => item.order_id === order.id).map((item) => ({
        ...item, unit_price: Number(item.unit_price),
      })) }));
  }
}

@Controller("compat/storefront")
@Public()
export class StorefrontReadCutoverController extends ReadProjection {
  @Get("site")
  async site() {
    const settings = await this.rows(sql`
      SELECT setting_key, value, updated_at FROM site_setting
      WHERE setting_key IN ('storefront', 'storefront-hero-video', 'storefront-banner-video')`);
    const byKey = new Map(settings.map((row) => [row.setting_key, row]));
    return { settings: byKey.get("storefront")?.value ?? null,
      updatedAt: byKey.get("storefront")?.updated_at ?? null,
      heroVideo: byKey.get("storefront-hero-video")?.value ?? null,
      bannerVideo: byKey.get("storefront-banner-video")?.value ?? null };
  }
}

@Controller("compat/account")
export class AccountReadCutoverController extends ReadProjection {
  @Get("me")
  async me(@CurrentUser() claims: Claims) {
    const [user] = await this.rows(sql`
      SELECT id,email,role,display_name,phone,status,totp_enabled
      FROM account_user WHERE id = ${claims.sub} LIMIT 1`);
    if (!user) throw new DomainError(401, "UNAUTHORIZED", "User is unavailable");
    return { user: { id: user.id, email: user.email, role: user.role, name: user.display_name,
      phone: user.phone, status: user.status, totpEnabled: Boolean(user.totp_enabled) } };
  }
}

@Controller("compat/supplier")
@Roles("supplier")
export class SupplierReadCutoverController extends ReadProjection {
  @Get("session")
  async session(@CurrentUser() claims: Claims) { return { supplier: await this.supplier(claims.sub) }; }

  @Get("products")
  async products(@CurrentUser() claims: Claims, @Query("limit") limit?: string, @Query("offset") offset?: string) {
    const supplier = await this.supplier(claims.sub);
    const take = Math.min(100, Math.max(1, Number(limit) || 50));
    const skip = Math.max(0, Number(offset) || 0);
    const products = await this.rows(sql`
      SELECT * FROM supplier_product_submission WHERE supplier_id = ${supplier.supplierId}
      ORDER BY created_at DESC, id DESC LIMIT ${take} OFFSET ${skip}`);
    return { products: products.map((item) => ({ id: item.id, name: item.proposed_name,
      sku: item.attributes?.sku ?? "", category: item.attributes?.category ?? "",
      description: item.proposed_description, wholesale_price: item.attributes?.wholesalePrice ?? 0,
      status: item.status, product_variants: item.variants ?? [] })) };
  }

  @Get("orders")
  async orders(@CurrentUser() claims: Claims) {
    const supplier = await this.supplier(claims.sub);
    return toApiJson({ orders: await this.purchaseOrders(supplier.supplierId) });
  }

  @Get("rfqs")
  async rfqs(@CurrentUser() claims: Claims, @Query("limit") limit?: string, @Query("offset") offset?: string) {
    const supplier = await this.supplier(claims.sub);
    const take = Math.min(100, Math.max(1, Number(limit) || 50));
    const skip = Math.max(0, Number(offset) || 0);
    return toApiJson({ rfqs: await this.rows(sql`SELECT * FROM rfq WHERE supplier_id = ${supplier.supplierId}
      ORDER BY created_at DESC, id DESC LIMIT ${take} OFFSET ${skip}`) });
  }

  @Get("tickets")
  async tickets(@CurrentUser() claims: Claims) {
    const supplier = await this.supplier(claims.sub);
    const tickets = await this.rows(sql`SELECT * FROM support_case WHERE supplier_id = ${supplier.supplierId}
      ORDER BY created_at DESC, id DESC LIMIT 100`);
    return toApiJson({ tickets });
  }
}

@Controller("compat/wholesale")
@Roles("customer", "vip")
@AllowStaleCustomerVipRead()
export class WholesaleReadCutoverController extends ReadProjection {
  @Get("account")
  async getAccount(@CurrentUser() claims: Claims) {
    const account = await this.account(claims.sub);
    return { account, isActive: Boolean(account && account.status === "approved" &&
      (!account.expires_at || new Date(account.expires_at).getTime() > Date.now())) };
  }

  @Get("products")
  async products(@CurrentUser() claims: Claims) {
    if (!await this.account(claims.sub, true)) throw new DomainError(403, "VIP_ACCOUNT_INACTIVE", "VIP account is inactive");
    return toApiJson({ products: await this.catalog(true) });
  }

  @Get("orders")
  async orders(@CurrentUser() claims: Claims) {
    const account = await this.account(claims.sub, true);
    if (!account) throw new DomainError(403, "VIP_ACCOUNT_INACTIVE", "VIP account is inactive");
    return toApiJson({ orders: await this.wholesaleOrders(account.id) });
  }
}

@Controller("compat/admin")
@Roles("admin")
export class AdminReadCutoverController extends ReadProjection {
  @Get("accounts")
  async accounts() { return toApiJson({ accounts: await this.rows(sql`SELECT * FROM wholesale_account ORDER BY created_at DESC, id DESC LIMIT 200`) }); }
  @Get("supplier-applications")
  async applications() { return toApiJson({ applications: await this.rows(sql`SELECT * FROM supplier_application ORDER BY created_at DESC, id DESC LIMIT 200`) }); }
  @Get("suppliers")
  async suppliers() { return toApiJson({ suppliers: await this.rows(sql`SELECT * FROM supplier ORDER BY created_at DESC, id DESC LIMIT 200`) }); }
  @Get("catalog")
  async adminCatalog() { return toApiJson({ products: await this.catalog(false) }); }
  @Get("purchase-orders")
  async adminPurchaseOrders() { return toApiJson({ orders: await this.purchaseOrders() }); }
  @Get("orders")
  async adminOrders() {
    const [orders, accounts, suppliers, purchaseOrders] = await Promise.all([
      this.wholesaleOrders(),
      this.rows(sql`SELECT * FROM wholesale_account`),
      this.rows(sql`SELECT * FROM supplier`),
      this.purchaseOrders(),
    ]);
    const accountMap = new Map(accounts.map((account) => [account.id, account]));
    const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    return toApiJson({ orders: orders.map((order) => ({ ...order,
      store_name: accountMap.get(order.account_id)?.store_name ?? "—",
      purchase_orders: purchaseOrders.filter((po) => po.wholesale_order_id === order.id).map((po) => ({
        id: po.id, order_code: po.order_code, status: po.status,
        supplier_name: supplierMap.get(po.supplier_id)?.display_name ?? "—", tracking_code: po.tracking_code,
      })),
    })) });
  }
  @Get("rfqs")
  async adminRfqs() { return toApiJson({ rfqs: await this.rows(sql`SELECT * FROM rfq ORDER BY created_at DESC, id DESC LIMIT 200`) }); }
  @Get("tickets")
  async adminTickets() { return toApiJson({ tickets: await this.rows(sql`SELECT * FROM support_case ORDER BY created_at DESC, id DESC LIMIT 200`) }); }
  @Get("audit-logs")
  async auditLogs(@Query("limit") limit?: string, @Query("entityType") entityType?: string, @Query("entityId") entityId?: string) {
    const take = Math.min(200, Math.max(1, Number(limit) || 50));
    return toApiJson({ logs: await this.rows(sql`SELECT * FROM audit_log
      WHERE (${entityType ?? null}::text IS NULL OR entity_type = ${entityType ?? null})
        AND (${entityId ?? null}::text IS NULL OR entity_id = ${entityId ?? null})
      ORDER BY created_at DESC, id DESC LIMIT ${take}`) });
  }
}
