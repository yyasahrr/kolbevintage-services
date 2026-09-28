/**
 * Phase 5.7-B — CMS campaign-reference resolution.
 *
 * CMS content (festival heroes, countdowns, banners) references a promotion by
 * its stable `code` and resolves the live display state at serve time through
 * this seam. The seam is deliberately narrow:
 *
 * - CMS passes codes in, display state comes out. No discount math, no
 *   eligibility inputs, and no per-actor data cross this boundary in either
 *   direction (see `PromotionDisplayState`: fixed key set, enforced by test).
 * - Resolution is total: unknown or malformed codes resolve to
 *   `{ found: false }`, never throw into a render path.
 * - Batch resolution is capped (20 codes) so a content document cannot fan out
 *   unbounded reads.
 *
 * Consuming this from public page/document reads (and from SiteBuilder) is a
 * Phase 6 concern; Checkpoint B delivers the tested seam, not the cutover.
 */

import { Inject, Injectable } from "@nestjs/common";
import { PromotionService } from "../promotions/promotion.service";
import type { PromotionDisplayState } from "../promotions/promotions.contract";

export type PromotionReferenceResolution =
  | { code: string; found: true; display: PromotionDisplayState }
  | { code: string; found: false; display: null };

const MAX_BATCH_CODES = 20;

@Injectable()
export class CmsPromotionReferenceService {
  constructor(
    @Inject(PromotionService) private readonly promotions: PromotionService,
  ) {}

  async resolveReference(code: unknown): Promise<PromotionReferenceResolution> {
    const echo = typeof code === "string" ? code : "";
    try {
      const display = await this.promotions.getPromotionDisplayState(code);
      if (!display) return { code: echo, found: false, display: null };
      return { code: display.code, found: true, display };
    } catch {
      // Render paths must never break on a bad campaign reference: content
      // authors see `found: false` (and the admin preview surfaces why).
      return { code: echo, found: false, display: null };
    }
  }

  async resolveReferences(codes: unknown): Promise<PromotionReferenceResolution[]> {
    if (!Array.isArray(codes)) return [];
    const unique = [...new Set(codes.filter((code): code is string => typeof code === "string"))];
    const batch = unique.slice(0, MAX_BATCH_CODES);
    const resolved: PromotionReferenceResolution[] = [];
    for (const code of batch) {
      resolved.push(await this.resolveReference(code));
    }
    return resolved;
  }
}
