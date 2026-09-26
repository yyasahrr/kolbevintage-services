import { Controller, Get, Post, Body, Param, Query, UseGuards, Inject, HttpCode } from "@nestjs/common";
import { CatalogService } from "./catalog.service";
import { Public, CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { DomainError } from "@kolbe/shared";
import { AdminPermissionGuard, RequireAdminPermission } from "../admin/admin-rbac.guard";

@Controller("catalog")
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Public()
  @Get("products")
  async listProducts(
    @Query("q") q?: string,
    @Query("channel") channel?: "retail" | "wholesale",
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    if (q) return this.catalog.searchProducts(q, channel || "wholesale", { limit, cursor });
    if (channel === "retail") return this.catalog.listRetailProducts();
    if (channel === "wholesale") return this.catalog.listWholesaleProducts();
    return this.catalog.listProducts();
  }

  @Public()
  @Get("retail/products")
  async listRetailProducts() {
    return this.catalog.listRetailProducts();
  }

  @Public()
  @Get("wholesale/products")
  async listWholesaleProducts() {
    return this.catalog.listWholesaleProducts();
  }

  @Public()
  @Get("browse")
  async browse(
    @Query("channel") channel?: "retail" | "wholesale",
    @Query("category") category?: string,
    @Query("brand") brand?: string,
    @Query("minPrice") minPrice?: string,
    @Query("maxPrice") maxPrice?: string,
    @Query("inStock") inStock?: string,
    @Query("sort") sort?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.catalog.browseProducts({ channel, category, brand, minPrice, maxPrice, inStock, sort, limit, cursor });
  }

  @Public()
  @Get("categories")
  async listCategories() {
    return this.catalog.listCategories();
  }

  @Public()
  @Get("brands")
  async listBrands() {
    return this.catalog.listBrands();
  }

  @Public()
  @Get("products/:id")
  async getProduct(@Param("id") id: string, @Query("channel") channel?: "retail" | "wholesale") {
    return this.catalog.getProductDetail(id, channel === "retail" ? "retail" : "wholesale");
  }

  @Public()
  @Get("products/:id/retail-check")
  async retailIsolationCheck(@Param("id") id: string) {
    return this.catalog.assertRetailIsolation(id);
  }

  @Post("products")
  @Roles("admin")
  @UseGuards(AdminPermissionGuard)
  @RequireAdminPermission("retail:catalog:manage")
  async createProduct(
    @CurrentUser() claims: Claims,
    @Body() body: { name: string; slug: string; description?: string; brandId?: string; categoryId?: string; ownerType: "KOLBE" | "SUPPLIER"; isKolbeExclusive: boolean },
  ) {
    return this.catalog.createProduct({
      ...body,
      createdBy: claims.sub,
      role: claims.role as any,
    });
  }

  @Post("brands")
  @Roles("admin", "supplier")
  async createBrand(
    @CurrentUser() claims: Claims,
    @Body() body: { name: string; slug: string; logoUrl?: string },
  ) {
    return this.catalog.createBrand({
      ...body,
      creatorId: claims.sub,
      role: claims.role,
    });
  }

  @Post("categories")
  @Roles("admin")
  @UseGuards(AdminPermissionGuard)
  @RequireAdminPermission("retail:catalog:manage")
  async createCategory(@Body() body: { slug: string; name: string; parentId?: string; attributesSchema?: Record<string, any> }) {
    return this.catalog.createCategory(body);
  }

  @Post("brands/:id/approve")
  @Roles("admin")
  @UseGuards(AdminPermissionGuard)
  @RequireAdminPermission("retail:catalog:manage")
  async approveBrand(@Param("id") id: string) {
    return this.catalog.approveBrand(id);
  }

  @Post("products/:id/status")
  @Roles("admin")
  @UseGuards(AdminPermissionGuard)
  @RequireAdminPermission("retail:catalog:manage")
  async transitionProduct(@Param("id") id: string, @CurrentUser() claims: Claims, @Body() body: { status: "draft" | "pending_review" | "approved" | "published" | "suspended" | "archived" }) {
    return this.catalog.transitionProductStatus(id, body.status, claims.role as any);
  }

  @Post("supplier-submissions")
  @Roles("supplier")
  async submitSupplierProduct(
    @CurrentUser() claims: Claims,
    @Body() body: {
      name: string; slug: string; description?: string; brandId?: string; proposedBrandId?: string;
      categoryId?: string; attributes?: Record<string, unknown>; variants?: unknown[]; media?: unknown[]; commercial?: Record<string, unknown>;
    },
  ) {
    return this.catalog.createSupplierSubmission({ ...body, createdBy: claims.sub });
  }

  @Post("compat/supplier-submissions")
  @Roles("supplier")
  async submitLegacySupplierProduct(@CurrentUser() claims: Claims, @Body() body: any) {
    const name = String(body.name ?? "").trim();
    const sku = String(body.sku ?? "").trim().toUpperCase();
    const category = String(body.category ?? "").trim();
    const price = String(body.wholesalePrice ?? "0");
    const stock = Number(body.stock ?? 0);
    if (!name || !sku || !category || !/^\d+$/.test(price) || !Number.isSafeInteger(stock) || stock < 0 || stock > 1_000_000) throw new DomainError(422, "INVALID_INPUT", "اطلاعات محصول نامعتبر است");
    const idPart = globalThis.crypto.randomUUID().slice(0, 8);
    const size = String(body.size ?? "تک‌سایز").trim();
    const color = String(body.color ?? "بدون رنگ").trim();
    const imageUrl = body.imageUrl ? String(body.imageUrl).slice(0, 2048) : "";
    if (imageUrl && !/^(?:https?:\/\/|\/)/i.test(imageUrl) && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageUrl)) {
      throw new DomainError(422, "INVALID_MEDIA_URL", "نشانی تصویر نامعتبر است");
    }
    const media = imageUrl ? [{ url: imageUrl, type: "image" }] : [];
    const result = await this.catalog.createSupplierSubmission({
      name, slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${idPart}`,
      description: String(body.description ?? "").trim(), categoryId: undefined,
      // `sku` یک فیلدِ **تجاری** است و طبقِ `assertSubmissionSeparation` نباید داخلِ
      // attributes بیاید؛ پیش‌تر اینجا بود و همین باعث می‌شد کلِ مسیرِ سازگار با
      // `COMMERCIAL_IN_ATTRIBUTES` بشکند (یعنی ثبتِ محصول از UI قدیمی ممکن نبود).
      // SKU همچنان در `commercial.sku` و در SKU واریانت حفظ می‌شود.
      attributes: { category, proposedStock: stock },
      // موجودیِ پیشنهادیِ مسیرِ قدیمی به تنها مقصدِ کانونیکالش نگاشت می‌شود
      // (`product_variant_inventory`)؛ وگرنه عددی بدونِ معنا در attributes می‌ماند.
      variants: [{ sku: `${sku}-${size}`.toUpperCase(), attributes: { size, color, color_hex: body.colorHex ?? null }, inventory: { onHand: stock } }],
      media, commercial: { sku, wholesalePrice: price, moq: 1 }, createdBy: claims.sub,
    });
    return { product: { id: result.submission.id, name: result.submission.proposedName, sku, status: result.submission.status } };
  }

  @Post("compat/products/:id/status")
  @HttpCode(200)
  @Roles("admin")
  @UseGuards(AdminPermissionGuard)
  @RequireAdminPermission("retail:catalog:manage")
  async moderateLegacyProduct(@Param("id") id: string, @CurrentUser() claims: Claims, @Body() body: any) {
    const map: Record<string, "draft" | "pending_review" | "approved" | "published" | "suspended" | "archived"> = {
      draft: "draft", submitted: "pending_review", approved: "approved", published: "published",
      rejected: "suspended", suspended: "suspended", archived: "archived",
    };
    const next = map[String(body.status ?? "")];
    if (!next) throw new DomainError(422, "INVALID_CATALOG_STATUS", "وضعیت کاتالوگ نامعتبر است");
    const updated = await this.catalog.transitionProductStatus(id, next, claims.role);
    return { status: String(body.status), canonicalStatus: updated.status };
  }

  /**
   * بازبینیِ ادمین — ادمین باید **پیش از** تأیید بتواند کلِ گرافِ پیشنهادشده را
   * ببیند (واریانت‌ها، رسانه، بخشِ تجاری با واحدِ MOQ، بسته‌ها، پله‌های قیمت).
   * پیش‌تر هیچ GET ای وجود نداشت.
   */
  @Get("supplier-submissions")
  @Roles("admin")
  @UseGuards(AdminPermissionGuard)
  @RequireAdminPermission("retail:catalog:manage")
  async listSupplierSubmissions(@Query("supplierId") supplierId?: string, @Query("status") status?: string) {
    return this.catalog.listSupplierSubmissions({ supplierId, status });
  }

  @Get("supplier-submissions/:id")
  @Roles("admin")
  @UseGuards(AdminPermissionGuard)
  @RequireAdminPermission("retail:catalog:manage")
  async getSupplierSubmission(@Param("id") id: string) {
    return this.catalog.getSupplierSubmission(id);
  }

  @Post("supplier-submissions/:id/approve-new")
  @Roles("admin")
  @UseGuards(AdminPermissionGuard)
  @RequireAdminPermission("retail:catalog:manage")
  async approveSubmissionAsNew(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: { note?: string }) {
    return this.catalog.approveSubmissionAsNew(id, claims.sub, body.note);
  }

  @Post("supplier-submissions/:id/approve-existing")
  @Roles("admin")
  @UseGuards(AdminPermissionGuard)
  @RequireAdminPermission("retail:catalog:manage")
  async approveSubmissionAsExisting(
    @CurrentUser() claims: Claims, @Param("id") id: string,
    @Body() body: { productId: string; note?: string },
  ) {
    return this.catalog.approveSubmissionAsExisting(id, body.productId, claims.sub, body.note);
  }

  @Post("supplier-submissions/:id/reject")
  @Roles("admin")
  @UseGuards(AdminPermissionGuard)
  @RequireAdminPermission("retail:catalog:manage")
  async rejectSubmission(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: { note: string }) {
    return this.catalog.rejectSubmission(id, claims.sub, body.note);
  }
}
