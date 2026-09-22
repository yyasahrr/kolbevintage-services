import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { product, productRating } from "@kolbe/database";
import { DomainError } from "@kolbe/shared";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";

/**
 * Phase 5.10-C — product reviews, verified purchase only.
 *
 * A review exists iff its rater owns a delivered retail order or a
 * completed wholesale order containing the product; the proving
 * order id is stored on the row (exactly one side, XOR at the DB).
 * Staff cannot file — an insider review is a fake signal. Public
 * reads show visible + flagged (a flag is a staff queue, not a
 * takedown); hidden rows leave every surface including aggregates.
 *
 * Boundary note (see the arch doc §6): this module reads the four
 * order tables for verification (READ_EXCEPTIONS, read-only) and
 * owns all product_rating writes. Catalog aggregates ratings via
 * SQL; there is deliberately NO import edge between the two —
 * the architecture-freeze guard forbids catalog any transitive
 * order-table token.
 */
@Injectable()
export class RatingsService {
  private static readonly REVIEW_TEXT_MAX = 2000;
  private static readonly LIST_LIMIT_DEFAULT = 20;
  private static readonly LIST_LIMIT_MAX = 50;

  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private assertRater(actor: { actorId: string | null; actorRole: string }) {
    if ((actor.actorRole !== "customer" && actor.actorRole !== "vip") || !actor.actorId) {
      throw new DomainError(403, "REVIEW_FORBIDDEN", "only signed-in customers can write reviews");
    }
  }

  private assertAdmin(actor: { actorId: string | null; actorRole: string }) {
    if (actor.actorRole !== "admin" || !actor.actorId) {
      throw new DomainError(403, "REVIEW_FORBIDDEN", "only admins can moderate reviews");
    }
  }

  private cleanReviewText(review: unknown): string | null {
    if (typeof review !== "string") return null;
    const cleaned = review.replace(/[<>]/g, "").trim().slice(0, RatingsService.REVIEW_TEXT_MAX);
    return cleaned === "" ? null : cleaned;
  }

  private assertRating(rating: unknown): asserts rating is number {
    if (!Number.isSafeInteger(rating) || (rating as number) < 1 || (rating as number) > 5) {
      throw new DomainError(400, "REVIEW_RATING_INVALID", "rating must be an integer 1..5");
    }
  }

  private clampLimit(limit: unknown): number {
    const parsed = typeof limit === "string" && limit !== "" ? Number(limit) : (limit as number);
    if (!Number.isSafeInteger(parsed)) return RatingsService.LIST_LIMIT_DEFAULT;
    return Math.min(Math.max(parsed, 1), RatingsService.LIST_LIMIT_MAX);
  }

  private decodeCursor(cursor: unknown): { key: string; id: string } | null {
    if (cursor === undefined || cursor === null) return null;
    try {
      if (typeof cursor !== "string" || cursor === "") throw new Error("empty");
      const [key, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (typeof key !== "string" || !/^\d{1,25}$/.test(key) || typeof id !== "string" || id === "") {
        throw new Error("shape");
      }
      return { key, id };
    } catch {
      throw new DomainError(400, "REVIEW_CURSOR_INVALID", "review cursor is malformed");
    }
  }

  private encodeCursor(key: string, id: string): string {
    return Buffer.from(JSON.stringify([key, id])).toString("base64url");
  }

  /**
   * Newest proving order for (rater, product): delivered retail
   * first, then completed wholesale. The id is the audit proof;
   * null means "never bought" — the filing is refused and nothing
   * is persisted, so a later delivery unblocks a clean retry.
   */
  async findPurchaseProof(
    raterId: string,
    productId: string,
  ): Promise<{ retailOrderId: string } | { wholesaleOrderId: string } | null> {
    const retail = await this.db.execute(sql`
      SELECT o."id" FROM "retail_order" AS o
      JOIN "retail_order_item" AS i ON i."order_id" = o."id" AND i."product_id" = ${productId}
      WHERE o."customer_id" = ${raterId} AND o."order_status" = 'delivered'
      ORDER BY o."created_at" DESC, o."id" DESC LIMIT 1
    `);
    const retailRows = ((retail as any).rows ?? []) as Array<{ id: string }>;
    if (retailRows.length) return { retailOrderId: retailRows[0].id };
    const wholesale = await this.db.execute(sql`
      SELECT o."id" FROM "wholesale_order" AS o
      JOIN "wholesale_order_item" AS i ON i."order_id" = o."id" AND i."product_id" = ${productId}
      WHERE o."buyer_user_id" = ${raterId} AND o."status" = 'completed'
      ORDER BY o."created_at" DESC, o."id" DESC LIMIT 1
    `);
    const wholesaleRows = ((wholesale as any).rows ?? []) as Array<{ id: string }>;
    if (wholesaleRows.length) return { wholesaleOrderId: wholesaleRows[0].id };
    return null;
  }

  async fileReview(
    actor: { actorId: string | null; actorRole: string },
    productId: string,
    input: { rating: unknown; review?: unknown },
  ): Promise<Record<string, unknown>> {
    this.assertRater(actor);
    this.assertRating(input.rating);
    const [prod] = await this.db.select({ id: product.id }).from(product).where(eq(product.id, productId)).limit(1);
    if (!prod) throw new DomainError(404, "PRODUCT_NOT_FOUND", "محصول یافت نشد");
    const proof = await this.findPurchaseProof(actor.actorId!, productId);
    if (!proof) {
      throw new DomainError(403, "REVIEW_NOT_VERIFIED", "only verified buyers can review this product");
    }
    const id = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      await this.db.insert(productRating).values({
        id,
        productId,
        raterId: actor.actorId!,
        rating: input.rating as number,
        review: this.cleanReviewText(input.review),
        status: "visible",
        verifiedRetailOrderId: "retailOrderId" in proof ? proof.retailOrderId : null,
        verifiedWholesaleOrderId: "wholesaleOrderId" in proof ? proof.wholesaleOrderId : null,
      });
    } catch (error: any) {
      if (error?.cause?.code === "23505" && String(error?.cause?.constraint ?? "").includes("product_rating_product_rater_unique")) {
        throw new DomainError(409, "REVIEW_ALREADY_EXISTS", "you have already reviewed this product");
      }
      throw error;
    }
    return this.presentReview(id);
  }

  async updateReview(
    actor: { actorId: string | null; actorRole: string },
    reviewId: string,
    input: { rating: unknown; review?: unknown },
  ): Promise<Record<string, unknown>> {
    this.assertRater(actor);
    this.assertRating(input.rating);
    const [row] = await this.db.select().from(productRating).where(eq(productRating.id, reviewId)).limit(1);
    // Strangers see the same 404 as missing ids: review ids are not
    // enumerable across raters.
    if (!row || row.raterId !== actor.actorId) {
      throw new DomainError(404, "REVIEW_NOT_FOUND", "نظر یافت نشد");
    }
    await this.db
      .update(productRating)
      .set({ rating: input.rating as number, review: this.cleanReviewText(input.review), updatedAt: new Date() })
      .where(eq(productRating.id, reviewId));
    return this.presentReview(reviewId);
  }

  async flagReview(
    actor: { actorId: string | null; actorRole: string },
    reviewId: string,
  ): Promise<Record<string, unknown>> {
    this.assertRater(actor);
    const [row] = await this.db.select().from(productRating).where(eq(productRating.id, reviewId)).limit(1);
    if (!row) throw new DomainError(404, "REVIEW_NOT_FOUND", "نظر یافت نشد");
    if (row.raterId === actor.actorId) {
      throw new DomainError(409, "REVIEW_FLAG_OWN", "you cannot flag your own review");
    }
    // Flagging hidden content is a no-op success: the queue state is
    // already past flagged. Flagging is idempotent by construction.
    if (row.status === "visible") {
      await this.db.update(productRating).set({ status: "flagged", updatedAt: new Date() }).where(eq(productRating.id, reviewId));
    }
    return this.presentReview(reviewId);
  }

  async setReviewVisibility(
    actor: { actorId: string | null; actorRole: string },
    reviewId: string,
    visible: boolean,
  ): Promise<Record<string, unknown>> {
    this.assertAdmin(actor);
    const [row] = await this.db.select().from(productRating).where(eq(productRating.id, reviewId)).limit(1);
    if (!row) throw new DomainError(404, "REVIEW_NOT_FOUND", "نظر یافت نشد");
    const to = visible ? "visible" : "hidden";
    // Idempotent: re-hiding changes nothing and writes no audit row.
    if (row.status !== to) {
      await this.db.update(productRating).set({ status: to, updatedAt: new Date() }).where(eq(productRating.id, reviewId));
      await this.audit.record({
        actorId: actor.actorId!,
        actorRole: actor.actorRole,
        action: visible ? "product_review.shown" : "product_review.hidden",
        entityType: "product_rating",
        entityId: reviewId,
        before: { status: row.status },
        after: { status: to },
      });
    }
    return this.presentReview(reviewId);
  }

  async listReviews(
    productId: string,
    query: { limit?: unknown; cursor?: unknown } = {},
  ): Promise<{ reviews: Array<Record<string, unknown>>; nextCursor: string | null }> {
    const limit = this.clampLimit(query.limit);
    const cursor = this.decodeCursor(query.cursor);
    const key = sql`(EXTRACT(EPOCH FROM r."created_at") * 1000000)::bigint`;
    const keyset = cursor
      ? sql`AND (${key} < ${cursor.key} OR (${key} = ${cursor.key} AND r."id" > ${cursor.id}))`
      : sql``;
    const result = await this.db.execute(sql`
      SELECT r.*, ${key} AS "cursor_key" FROM "product_rating" AS r
      WHERE r."product_id" = ${productId} AND r."status" IN ('visible', 'flagged')
      ${keyset}
      ORDER BY ${key} DESC, r."id" ASC
      LIMIT ${limit + 1}
    `);
    const rows = ((result as any).rows ?? []) as Array<Record<string, unknown>>;
    const kept = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit
        ? this.encodeCursor(String(kept[kept.length - 1].cursor_key), kept[kept.length - 1].id as string)
        : null;
    return { reviews: kept.map((row) => this.presentRow(row)), nextCursor };
  }

  async getSummary(productId: string): Promise<{ average: number | null; count: number }> {
    const result = await this.db.execute(sql`
      SELECT COUNT(*)::int AS "count", ROUND(AVG("rating"), 2) AS "average"
      FROM "product_rating"
      WHERE "product_id" = ${productId} AND "status" IN ('visible', 'flagged')
    `);
    const row = (((result as any).rows ?? []) as Array<{ count: number; average: string | null }>)[0];
    return { average: row?.average === null || row?.average === undefined ? null : Number(row.average), count: row?.count ?? 0 };
  }

  private async presentReview(reviewId: string): Promise<Record<string, unknown>> {
    const [row] = await this.db.select().from(productRating).where(eq(productRating.id, reviewId)).limit(1);
    return this.presentRow({
      ...row,
      created_at: (row.createdAt as Date).toISOString(),
      updated_at: (row.updatedAt as Date).toISOString(),
    } as any);
  }

  private presentRow(row: Record<string, unknown>): Record<string, unknown> {
    // raterId is opaque (no PII); the channel badge is the trust proof.
    // Timestamps arrive as Dates (drizzle) or strings (raw SQL) — both
    // normalize to ISO.
    const iso = (value: unknown) => new Date(value as string | Date).toISOString();
    return {
      id: row.id,
      productId: row.product_id ?? (row as any).productId,
      raterId: row.rater_id ?? (row as any).raterId,
      rating: row.rating,
      review: row.review ?? null,
      status: row.status,
      verifiedChannel: (row.verified_retail_order_id ?? (row as any).verifiedRetailOrderId) ? "retail" : "wholesale",
      createdAt: iso(row.created_at ?? (row as any).createdAt),
      updatedAt: iso(row.updated_at ?? (row as any).updatedAt),
    };
  }
}
