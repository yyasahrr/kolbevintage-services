import { Inject, Injectable } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { CONFIG_TOKEN, type AppConfig } from "../../config/configuration";
import { ValidationError } from "@kolbe/shared";

export type CmsPreviewTarget = "PAGE_REVISION" | "CONTENT_REVISION" | "NAVIGATION_REVISION" | "ARTICLE_REVISION";
type PreviewClaims = { target: CmsPreviewTarget; id: string; exp: number };

/** Short-lived, signed and target-bound preview capability; no draft is publicly queryable without it. */
@Injectable()
export class CmsPreviewService {
  constructor(@Inject(CONFIG_TOKEN) private readonly config: AppConfig) {}

  issue(target: CmsPreviewTarget, id: string, ttlSeconds = 600): string {
    if (!/^[A-Za-z0-9_:-]{3,220}$/.test(id)) throw new ValidationError([{ field: "targetId", code: "TARGET_ID_INVALID" }]);
    const claims: PreviewClaims = { target, id, exp: Math.floor(Date.now() / 1000) + Math.min(Math.max(Math.floor(ttlSeconds), 30), 900) };
    const body = this.base64(JSON.stringify(claims));
    return `${body}.${this.signature(body)}`;
  }

  verify(token: unknown, target: CmsPreviewTarget, id: string): boolean {
    if (typeof token !== "string") return false;
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra) return false;
    const expected = this.signature(body);
    try {
      if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
      const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PreviewClaims;
      return claims.target === target && claims.id === id && Number.isInteger(claims.exp) && claims.exp >= Math.floor(Date.now() / 1000);
    } catch {
      return false;
    }
  }

  private signature(body: string): string { return createHmac("sha256", this.config.sessionSecret).update(body).digest("base64url"); }
  private base64(value: string): string { return Buffer.from(value, "utf8").toString("base64url"); }
}
