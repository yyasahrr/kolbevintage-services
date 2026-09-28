import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { cmsNavigation, cmsNavigationRevision, type KolbeDatabase } from "@kolbe/database";
import { ConflictError, NotFoundError, ValidationError } from "@kolbe/shared";
import { KOLBE_DB } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { assertNoExecutableContent, makeCmsId, validateNavigationItems, validateRevisionStatusTransition, type CmsNavigationItem } from "./cms-validation";

function navigationKey(value: unknown): string {
  if (typeof value !== "string" || !/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}._:-]{0,119}$/u.test(value.normalize("NFKC").trim())) throw new ValidationError([{ field: "navigationKey", code: "NAVIGATION_KEY_INVALID" }]);
  return value.normalize("NFKC").trim();
}

@Injectable()
export class CmsNavigationService {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase, @Inject(AuditService) private readonly audit: AuditService) {}

  async createNavigation(input: { navigationKey: string; label: string; items?: unknown; createdBy?: string | null }) {
    const key = navigationKey(input.navigationKey);
    const label = this.label(input.label);
    const items = validateNavigationItems(input.items ?? []);
    const id = makeCmsId("navigation");
    try {
      return await this.db.transaction(async (tx) => {
        const [navigation] = await tx.insert(cmsNavigation).values({ id, navigationKey: key, label, status: "ACTIVE", createdBy: input.createdBy ?? null }).returning();
        if (!navigation) throw new ConflictError("CMS_NAVIGATION_CREATE_FAILED");
        const revision = await this.insertRevision(tx, { navigationId: id, items, createdBy: input.createdBy ?? null });
        await this.audit.record({ actorId: input.createdBy ?? null, actorRole: "admin", action: "cms.navigation.created", entityType: "cms_navigation", entityId: id, after: { navigationKey: key, revisionId: revision.id } }, tx);
        return { navigation, revision };
      });
    } catch (error) {
      if ((error as { code?: string })?.code === "23505") throw new ConflictError("CMS_NAVIGATION_KEY_CONFLICT", "Navigation key already exists");
      throw error;
    }
  }

  async rollback(navigationId: string, sourceRevisionId: string, actorId: string | null) {
    const [source] = await this.db.select().from(cmsNavigationRevision).where(and(eq(cmsNavigationRevision.id, sourceRevisionId), eq(cmsNavigationRevision.navigationId, navigationId))).limit(1);
    if (!source) throw new NotFoundError("CMS source navigation revision", sourceRevisionId);
    return this.createRevision({ navigationId, items: source.items, createdBy: actorId, sourceRevisionId });
  }

  async createRevision(input: { navigationId: string; items: unknown; createdBy?: string | null; sourceRevisionId?: string }) {
    const [navigation] = await this.db.select().from(cmsNavigation).where(eq(cmsNavigation.id, input.navigationId)).limit(1);
    if (!navigation) throw new NotFoundError("CMS navigation", input.navigationId);
    if (navigation.status === "ARCHIVED") throw new ConflictError("CMS_NAVIGATION_ARCHIVED");
    const items = validateNavigationItems(input.items);
    return this.db.transaction(async (tx) => {
      const revision = await this.insertRevision(tx, { navigationId: input.navigationId, items, createdBy: input.createdBy ?? null, sourceRevisionId: input.sourceRevisionId });
      await this.audit.record({ actorId: input.createdBy ?? null, actorRole: "admin", action: "cms.navigation.revision_created", entityType: "cms_navigation_revision", entityId: revision.id, after: { navigationId: input.navigationId, version: revision.version } }, tx);
      return revision;
    });
  }

  async insertRevision(tx: any, input: { navigationId: string; items: CmsNavigationItem[]; createdBy: string | null; sourceRevisionId?: string }) {
    const [last] = await tx.select({ version: cmsNavigationRevision.version }).from(cmsNavigationRevision).where(eq(cmsNavigationRevision.navigationId, input.navigationId)).orderBy(desc(cmsNavigationRevision.version)).limit(1);
    const [revision] = await tx.insert(cmsNavigationRevision).values({ id: makeCmsId("navigation_rev"), navigationId: input.navigationId, version: (last?.version ?? 0) + 1, items: input.items, status: "DRAFT", createdBy: input.createdBy, sourceRevisionId: input.sourceRevisionId ?? null }).returning();
    if (!revision) throw new ConflictError("CMS_NAVIGATION_REVISION_CREATE_FAILED");
    return revision;
  }

  async transitionRevision(id: string, status: string, actorId: string | null) {
    return this.db.transaction(async (tx) => {
      const [revision] = await tx.select().from(cmsNavigationRevision).where(eq(cmsNavigationRevision.id, id)).for("update").limit(1);
      if (!revision) throw new NotFoundError("CMS navigation revision", id);
      validateRevisionStatusTransition(revision.status, status);
      const [updated] = await tx.update(cmsNavigationRevision).set({ status: status as typeof revision.status, archivedAt: status === "ARCHIVED" ? new Date() : revision.archivedAt }).where(eq(cmsNavigationRevision.id, id)).returning();
      await this.audit.record({ actorId, actorRole: "admin", action: `cms.navigation.revision.${status.toLowerCase()}`, entityType: "cms_navigation_revision", entityId: id, before: { status: revision.status }, after: { status } }, tx);
      return updated;
    });
  }

  async archiveNavigation(id: string, actorId: string | null) {
    return this.db.transaction(async (tx) => {
      const [navigation] = await tx.select().from(cmsNavigation).where(eq(cmsNavigation.id, id)).for("update").limit(1);
      if (!navigation) throw new NotFoundError("CMS navigation", id);
      if (navigation.status === "ARCHIVED") return navigation;
      const [updated] = await tx.update(cmsNavigation).set({ status: "ARCHIVED" }).where(eq(cmsNavigation.id, id)).returning();
      await this.audit.record({ actorId, actorRole: "admin", action: "cms.navigation.archived", entityType: "cms_navigation", entityId: id, before: { status: navigation.status }, after: { status: "ARCHIVED" } }, tx);
      return updated;
    });
  }

  async getRevisionById(id: string) {
    const [revision] = await this.db.select().from(cmsNavigationRevision).where(eq(cmsNavigationRevision.id, id)).limit(1);
    if (!revision) throw new NotFoundError("CMS navigation revision", id);
    return revision;
  }

  async getByKey(key: string) {
    const [navigation] = await this.db.select().from(cmsNavigation).where(eq(cmsNavigation.navigationKey, navigationKey(key))).limit(1);
    if (!navigation) throw new NotFoundError("CMS navigation", key);
    return navigation;
  }

  async getPublished(key: string) {
    const navigation = await this.getByKey(key);
    if (navigation.status !== "ACTIVE" || !navigation.currentPublishedRevisionId) return null;
    const [revision] = await this.db.select().from(cmsNavigationRevision).where(and(eq(cmsNavigationRevision.id, navigation.currentPublishedRevisionId), eq(cmsNavigationRevision.status, "PUBLISHED"))).limit(1);
    return revision ? { navigation, revision } : null;
  }

  private label(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || value.length > 200) throw new ValidationError([{ field: "label", code: "LABEL_INVALID" }]);
    const label = value.normalize("NFKC").trim();
    assertNoExecutableContent(label, "label");
    return label;
  }
}
