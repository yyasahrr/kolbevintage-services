import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { cmsMediaAsset, cmsMediaUsage, type KolbeDatabase } from "@kolbe/database";
import { ConflictError, NotFoundError, ValidationError } from "@kolbe/shared";
import { KOLBE_DB } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { detectMediaSignature, makeObjectKey, sha256, type PublicMediaObject, type PublicMediaStorage } from "./public-media-storage";
import { assertNoExecutableContent, CMS_MEDIA_LIMITS, makeCmsId, validateMimeType } from "./cms-validation";

export const CMS_PUBLIC_MEDIA_STORAGE = Symbol("CMS_PUBLIC_MEDIA_STORAGE");

@Injectable()
export class CmsMediaService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CMS_PUBLIC_MEDIA_STORAGE) private readonly storage: PublicMediaStorage,
  ) {}

  async upload(input: { filename: string; mimeType: string; bytes: Buffer; altText?: string | null; caption?: string | null; width?: number | null; height?: number | null; durationMs?: number | null; createdBy?: string | null }) {
    const mimeType = validateMimeType(input.mimeType);
    if (!Buffer.isBuffer(input.bytes) || input.bytes.length < 1) throw new ValidationError([{ field: "bytes", code: "MEDIA_BYTES_REQUIRED" }]);
    const max = mimeType.startsWith("video/") ? CMS_MEDIA_LIMITS.videoBytes : CMS_MEDIA_LIMITS.imageBytes;
    if (input.bytes.length > max) throw new ValidationError([{ field: "bytes", code: "MEDIA_TOO_LARGE" }]);
    const signature = detectMediaSignature(input.bytes);
    if (signature !== mimeType) throw new ValidationError([{ field: "bytes", code: "MEDIA_MAGIC_MISMATCH" }], "Media content does not match the declared MIME type");
    const filename = this.safeFilename(input.filename);
    const id = makeCmsId("media");
    const objectKey = makeObjectKey(id, filename);
    let stored: PublicMediaObject | undefined;
    try {
      stored = await this.storage.put({ objectKey, bytes: input.bytes, mimeType });
      const { asset } = await this.db.transaction(async (tx) => {
        const [created] = await tx.insert(cmsMediaAsset).values({
          id, storageProvider: this.storage.provider, objectKey: stored!.objectKey, originalFilename: filename, mimeType, byteSize: BigInt(input.bytes.length), checksumSha256: sha256(input.bytes),
          width: this.positiveOptional(input.width, "width"), height: this.positiveOptional(input.height, "height"), durationMs: this.positiveOptional(input.durationMs, "durationMs"),
          altText: this.safeOptionalText(input.altText, "altText", 300), caption: this.safeOptionalText(input.caption, "caption", 1000), createdBy: input.createdBy ?? null,
        }).returning();
        if (!created) throw new ConflictError("CMS_MEDIA_CREATE_FAILED");
        await this.audit.record({ actorId: input.createdBy ?? null, actorRole: "admin", action: "cms.media.uploaded", entityType: "cms_media_asset", entityId: id, after: { mimeType, byteSize: input.bytes.length, storageProvider: this.storage.provider } }, tx);
        return { asset: created };
      });
      return { asset, publicUrl: stored.publicUrl };
    } catch (error) {
      if (stored) await this.storage.remove(stored.objectKey).catch(() => undefined);
      throw error;
    }
  }

  async get(assetId: string) {
    const [asset] = await this.db.select().from(cmsMediaAsset).where(eq(cmsMediaAsset.id, assetId)).limit(1);
    if (!asset) throw new NotFoundError("CMS media asset", assetId);
    return asset;
  }

  async getPublic(assetId: string): Promise<{ asset: typeof cmsMediaAsset.$inferSelect; bytes: Buffer }> {
    const asset = await this.get(assetId);
    if (asset.archivedAt) throw new NotFoundError("CMS public media asset", assetId);
    return { asset, bytes: await this.storage.read(asset.objectKey) };
  }

  async list(options: { includeArchived?: boolean; limit?: number } = {}) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    return this.db.select().from(cmsMediaAsset).where(options.includeArchived ? undefined : isNull(cmsMediaAsset.archivedAt)).orderBy(desc(cmsMediaAsset.createdAt)).limit(limit);
  }

  async archive(assetId: string, actorId: string | null) {
    return this.db.transaction(async (tx) => {
      const [asset] = await tx.select().from(cmsMediaAsset).where(eq(cmsMediaAsset.id, assetId)).for("update").limit(1);
      if (!asset) throw new NotFoundError("CMS media asset", assetId);
      if (asset.archivedAt) return asset;
      const [updated] = await tx.update(cmsMediaAsset).set({ archivedAt: new Date() }).where(eq(cmsMediaAsset.id, assetId)).returning();
      await this.audit.record({ actorId, actorRole: "admin", action: "cms.media.archived", entityType: "cms_media_asset", entityId: assetId, before: { archivedAt: null }, after: { archivedAt: updated?.archivedAt ?? null, storageRetained: true } }, tx);
      return updated;
    });
  }

  /** A conservative garbage collector: bytes are deleted only after archive and no historical usage. */
  async purgeArchived(assetId: string, actorId: string | null) {
    const asset = await this.get(assetId);
    if (!asset.archivedAt) throw new ConflictError("CMS_MEDIA_NOT_ARCHIVED", "Archive media before purging it");
    const [usage] = await this.db.select({ id: cmsMediaUsage.id }).from(cmsMediaUsage).where(eq(cmsMediaUsage.mediaAssetId, assetId)).limit(1);
    if (usage) throw new ConflictError("CMS_MEDIA_HAS_HISTORICAL_USAGE", "Historical revisions still reference this media");
    await this.storage.remove(asset.objectKey);
    await this.db.delete(cmsMediaAsset).where(eq(cmsMediaAsset.id, assetId));
    await this.audit.record({ actorId, actorRole: "admin", action: "cms.media.purged", entityType: "cms_media_asset", entityId: assetId, before: { objectKey: asset.objectKey }, after: { deleted: true } });
    return { id: assetId, deleted: true };
  }

  async usages(assetId: string) {
    await this.get(assetId);
    return this.db.select().from(cmsMediaUsage).where(eq(cmsMediaUsage.mediaAssetId, assetId)).orderBy(desc(cmsMediaUsage.createdAt));
  }

  private safeFilename(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || value.length > 255 || /[\u0000-\u001f\\/]/.test(value)) throw new ValidationError([{ field: "filename", code: "FILENAME_INVALID" }]);
    const filename = value.normalize("NFKC").trim();
    if (!/\.[A-Za-z0-9]{1,8}$/.test(filename)) throw new ValidationError([{ field: "filename", code: "FILENAME_EXTENSION_REQUIRED" }]);
    return filename;
  }

  private safeOptionalText(value: unknown, field: string, max: number): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || value.length > max) throw new ValidationError([{ field, code: "TEXT_INVALID" }]);
    const normalized = value.normalize("NFKC").trim();
    assertNoExecutableContent(normalized, field);
    return normalized;
  }

  private positiveOptional(value: unknown, field: string): number | null {
    if (value === undefined || value === null) return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) throw new ValidationError([{ field, code: "POSITIVE_INTEGER_REQUIRED" }]);
    return number;
  }
}
