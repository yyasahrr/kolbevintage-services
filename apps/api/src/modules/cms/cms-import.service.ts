import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { cmsContentDocument, siteSetting, type KolbeDatabase } from "@kolbe/database";
import { ConflictError } from "@kolbe/shared";
import { KOLBE_DB } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { CmsContentService } from "./cms-content.service";
import { validateDocumentPayload, validateDocumentType } from "./cms-validation";

export type LegacyImportResult = {
  dryRun: boolean;
  scanned: number;
  wouldCreate: number;
  created: number;
  skippedExisting: number;
  failures: Array<{ settingKey: string; error: string }>;
};

/**
 * One-way, non-destructive bridge from the legacy site_setting table.
 * It never updates or deletes a legacy row. Document keys make retries idempotent.
 */
@Injectable()
export class CmsLegacyImportService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(CmsContentService) private readonly content: CmsContentService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async importSiteSettings(options: { dryRun?: boolean; actorId?: string | null; settingKey?: string } = {}): Promise<LegacyImportResult> {
    const rows = await this.db.select().from(siteSetting).where(options.settingKey ? eq(siteSetting.settingKey, options.settingKey) : undefined);
    const result: LegacyImportResult = { dryRun: options.dryRun === true, scanned: rows.length, wouldCreate: 0, created: 0, skippedExisting: 0, failures: [] };
    for (const row of rows) {
      const documentKey = `legacy:${row.settingKey}`;
      const documentType = this.typeForKey(row.settingKey);
      const existing = await this.db.select({ id: cmsContentDocument.id }).from(cmsContentDocument).where(eq(cmsContentDocument.documentKey, documentKey)).limit(1);
      if (existing.length) {
        result.skippedExisting += 1;
        continue;
      }
      result.wouldCreate += 1;
      if (result.dryRun) continue;
      try {
        const payload = validateDocumentPayload(documentType, { legacySettingKey: row.settingKey, legacyValue: row.value });
        const created = await this.content.createDocument({ documentKey, documentType, payload, createdBy: options.actorId ?? null });
        result.created += 1;
        await this.audit.record({ actorId: options.actorId ?? null, actorRole: "admin", action: "cms.legacy_site_setting.imported", entityType: "cms_content_document", entityId: created.document.id, after: { settingKey: row.settingKey, documentKey } });
      } catch (error) {
        if ((error as { code?: string })?.code === "23505" || error instanceof ConflictError) {
          result.skippedExisting += 1;
          continue;
        }
        result.failures.push({ settingKey: row.settingKey, error: error instanceof Error ? error.message : "Import failed" });
      }
    }
    return result;
  }

  private typeForKey(key: string): ReturnType<typeof validateDocumentType> {
    const normalized = key.toLocaleLowerCase("en-US");
    if (normalized.includes("header") || normalized.includes("nav")) return "HEADER_CONFIGURATION";
    if (normalized.includes("footer")) return "FOOTER_CONFIGURATION";
    if (normalized.includes("hero")) return "HERO_CONFIGURATION";
    if (normalized.includes("popup") || normalized.includes("banner") || normalized.includes("promo") || normalized.includes("look") || normalized.includes("instagram")) return "PROMOTIONAL_CONTENT_CONFIGURATION";
    return "HOME_CONFIGURATION";
  }
}
