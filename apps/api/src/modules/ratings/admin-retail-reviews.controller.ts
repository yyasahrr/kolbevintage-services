import { Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { AdminPermissionGuard, RequireAdminPermission } from "../admin/admin-rbac.guard";
import { RatingsService } from "./ratings.service";

/**
 * Phase 5.11-A — retail review moderation over admin HTTP.
 *
 * Thin forwarding shell over the 5.10 RatingsService seams: the
 * cross-product queue (`listReviewsForModeration`) plus hide/show
 * (`setReviewVisibility`, idempotent and audit-logged on change).
 * The 5.10 `catalog/reviews/:id/hide|show` routes stay untouched;
 * this surface adds the granular `retail:review:*` gates.
 */
@Controller("admin/retail")
@Roles("admin")
@UseGuards(AdminPermissionGuard)
export class AdminRetailReviewsController {
  constructor(@Inject(RatingsService) private readonly ratings: RatingsService) {}

  private actor(claims: Claims) {
    return { actorId: claims.sub, actorRole: claims.role };
  }

  @RequireAdminPermission("retail:review:view")
  @Get("reviews")
  async listReviews(
    @CurrentUser() claims: Claims,
    @Query("status") status?: string,
    @Query("productId") productId?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    const result = await this.ratings.listReviewsForModeration(this.actor(claims), { status, productId, limit, cursor });
    return toApiJson({ reviews: result.reviews, nextCursor: result.nextCursor, hasMore: result.nextCursor !== null });
  }

  @RequireAdminPermission("retail:review:moderate")
  @Post("reviews/:id/hide")
  @HttpCode(200)
  async hideReview(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return toApiJson(await this.ratings.setReviewVisibility(this.actor(claims), id, false));
  }

  @RequireAdminPermission("retail:review:moderate")
  @Post("reviews/:id/show")
  @HttpCode(200)
  async showReview(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return toApiJson(await this.ratings.setReviewVisibility(this.actor(claims), id, true));
  }
}
