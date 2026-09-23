import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { accountUser } from "@kolbe/database";
import { DomainError } from "@kolbe/shared";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";

/**
 * Phase 5.11-C — TOTP enrollment reads for the high-risk-action gate.
 *
 * The gate is enrollment-based (per the 5.11-C work order): a staff actor
 * whose account has completed TOTP enrollment (`totp_enabled`) may drive
 * high-risk retail actions; an unenrolled staff actor is refused with the
 * existing auth-domain `TOTP_REQUIRED` (401). The secret itself is never
 * read here — only the boolean flag.
 *
 * No enrollment, crypto, or recovery logic lives here: enrollment stays
 * in AuthService (`totp/enroll` → `totp/verify`), login keeps enforcing
 * the code, and this service only answers "is this actor enrolled?".
 */
@Injectable()
export class AdminTotpService {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase) {}

  async isEnrolled(actorId: string | null | undefined): Promise<boolean> {
    if (!actorId) return false;
    const [row] = await this.db
      .select({ totpEnabled: accountUser.totpEnabled })
      .from(accountUser)
      .where(eq(accountUser.id, actorId))
      .limit(1);
    return row?.totpEnabled === true;
  }

  async assertEnrolled(actorId: string | null | undefined): Promise<void> {
    if (!(await this.isEnrolled(actorId))) {
      throw new DomainError(401, "TOTP_REQUIRED", "this high-risk action requires TOTP enrollment");
    }
  }
}
