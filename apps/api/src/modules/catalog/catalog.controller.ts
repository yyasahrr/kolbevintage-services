import { Controller, Get, Post, Body, Param, Query, UseGuards, Inject } from "@nestjs/common";
import { CatalogService } from "./catalog.service";
import { Public, CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";

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
  async createCategory(@Body() body: { slug: string; name: string; parentId?: string; attributesSchema?: Record<string, any> }) {
    return this.catalog.createCategory(body);
  }

  @Post("brands/:id/approve")
  @Roles("admin")
  async approveBrand(@Param("id") id: string) {
    return this.catalog.approveBrand(id);
  }

  @Post("products/:id/status")
  @Roles("admin")
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

  @Post("supplier-submissions/:id/approve-new")
  @Roles("admin")
  async approveSubmissionAsNew(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: { note?: string }) {
    return this.catalog.approveSubmissionAsNew(id, claims.sub, body.note);
  }

  @Post("supplier-submissions/:id/approve-existing")
  @Roles("admin")
  async approveSubmissionAsExisting(
    @CurrentUser() claims: Claims, @Param("id") id: string,
    @Body() body: { productId: string; note?: string },
  ) {
    return this.catalog.approveSubmissionAsExisting(id, body.productId, claims.sub, body.note);
  }

  @Post("supplier-submissions/:id/reject")
  @Roles("admin")
  async rejectSubmission(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: { note: string }) {
    return this.catalog.rejectSubmission(id, claims.sub, body.note);
  }
}
