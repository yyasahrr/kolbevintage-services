import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { crmTag, crmContactTag } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import {
  CrmTagDuplicateError,
  CrmTagNotFoundError,
} from "./crm.errors";

export interface CreateTagInput {
  key: string;
  label: string;
  color?: string;
  description?: string;
}

@Injectable()
export class CrmTagService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  private makeId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  }

  normalizeKey(key: string): string {
    return key
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
  }

  async createTag(input: CreateTagInput, actorId: string) {
    const normalizedKey = this.normalizeKey(input.key);
    const id = this.makeId("tag");

    const [created] = await this.db
      .insert(crmTag)
      .values({
        id,
        key: normalizedKey,
        label: input.label.trim(),
        color: input.color,
        description: input.description,
        createdBy: actorId,
      })
      .returning();

    await this.auditService.record({
      actorId,
      actorRole: "admin",
      action: "crm_tag_created",
      entityType: "crm_tag",
      entityId: id,
      metadata: { key: normalizedKey, label: input.label },
    });

    return created;
  }

  async listTags(includeInactive = false) {
    if (includeInactive) {
      return await this.db.select().from(crmTag);
    }
    return await this.db.select().from(crmTag).where(eq(crmTag.isActive, true));
  }

  async getTag(tagIdOrKey: string) {
    const [byKey] = await this.db
      .select()
      .from(crmTag)
      .where(eq(crmTag.key, this.normalizeKey(tagIdOrKey)))
      .limit(1);

    if (byKey) return byKey;

    const [byId] = await this.db
      .select()
      .from(crmTag)
      .where(eq(crmTag.id, tagIdOrKey))
      .limit(1);

    return byId || null;
  }

  async addTagToContact(contactId: string, tagId: string, actorId: string) {
    const tag = await this.getTag(tagId);
    if (!tag) {
      throw new CrmTagNotFoundError(tagId);
    }

    const [existing] = await this.db
      .select()
      .from(crmContactTag)
      .where(
        and(
          eq(crmContactTag.contactId, contactId),
          eq(crmContactTag.tagId, tag.id),
        ),
      )
      .limit(1);

    if (existing) {
      throw new CrmTagDuplicateError(`Tag '${tag.label}' is already assigned to this contact`);
    }

    const id = this.makeId("cct");
    const [assigned] = await this.db
      .insert(crmContactTag)
      .values({
        id,
        contactId,
        tagId: tag.id,
        assignedBy: actorId,
      })
      .returning();

    await this.auditService.record({
      actorId,
      actorRole: "admin",
      action: "crm_tag_assigned",
      entityType: "crm_contact",
      entityId: contactId,
      metadata: { tagId: tag.id, tagKey: tag.key },
    });

    return { ...assigned, tag };
  }

  async removeTagFromContact(contactId: string, tagId: string, actorId: string) {
    const tag = await this.getTag(tagId);
    if (!tag) {
      throw new CrmTagNotFoundError(tagId);
    }

    await this.db
      .delete(crmContactTag)
      .where(
        and(
          eq(crmContactTag.contactId, contactId),
          eq(crmContactTag.tagId, tag.id),
        ),
      );

    await this.auditService.record({
      actorId,
      actorRole: "admin",
      action: "crm_tag_removed",
      entityType: "crm_contact",
      entityId: contactId,
      metadata: { tagId: tag.id, tagKey: tag.key },
    });
  }

  async getContactTags(contactId: string) {
    const rows = await this.db
      .select({
        tagId: crmTag.id,
        key: crmTag.key,
        label: crmTag.label,
        color: crmTag.color,
        assignedAt: crmContactTag.createdAt,
      })
      .from(crmContactTag)
      .innerJoin(crmTag, eq(crmTag.id, crmContactTag.tagId))
      .where(eq(crmContactTag.contactId, contactId));

    return rows;
  }
}
