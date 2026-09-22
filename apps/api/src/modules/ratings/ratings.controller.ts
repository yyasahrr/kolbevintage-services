import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import { RatingsService } from "./ratings.service";
import { CurrentUser, Public, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";

/**
 * Phase 5.10-C — review HTTP. The paths live under `catalog/` but the
 * controller lives in ratings/ (see the arch doc §6: catalog must
 * never transitively touch order tables, so the import edge runs
 * nowhere — review routes are served here, aggregates are read by
 * catalog SQL). Full paths are distinct from the catalog
 * controller's, so Nest registers both without collision.
 */
@Controller("catalog")
export class RatingsController {
  constructor(@Inject(RatingsService) private readonly ratings: RatingsService) {}

  @Public()
  @Get("products/:id/reviews")
  async listReviews(@Param("id") id: string, @Query("limit") limit?: string, @Query("cursor") cursor?: string) {
    return this.ratings.listReviews(id, { limit, cursor });
  }

  @Public()
  @Get("products/:id/reviews/summary")
  async getSummary(@Param("id") id: string) {
    return this.ratings.getSummary(id);
  }

  @Post("products/:id/reviews")
  @Roles("customer", "vip")
  async fileReview(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: { rating: unknown; review?: unknown }) {
    return this.ratings.fileReview({ actorId: claims.sub, actorRole: claims.role }, id, body ?? {});
  }

  @Patch("reviews/:id")
  @Roles("customer", "vip")
  async updateReview(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: { rating: unknown; review?: unknown }) {
    return this.ratings.updateReview({ actorId: claims.sub, actorRole: claims.role }, id, body ?? {});
  }

  @Post("reviews/:id/flag")
  @Roles("customer", "vip")
  async flagReview(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return this.ratings.flagReview({ actorId: claims.sub, actorRole: claims.role }, id);
  }

  @Post("reviews/:id/hide")
  @Roles("admin")
  async hideReview(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return this.ratings.setReviewVisibility({ actorId: claims.sub, actorRole: claims.role }, id, false);
  }

  @Post("reviews/:id/show")
  @Roles("admin")
  async showReview(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return this.ratings.setReviewVisibility({ actorId: claims.sub, actorRole: claims.role }, id, true);
  }
}
