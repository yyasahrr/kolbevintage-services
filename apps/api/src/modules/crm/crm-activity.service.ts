import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, or, sql } from "drizzle-orm";
import {
  accountUser,
  adminInternalNote,
  crmActivity,
  crmContact,
  crmContactIdentityLink,
  wholesaleAccount,
  CRM_ACTIVITY_SOURCES,
  CRM_ACTIVITY_TYPES,
  type CrmActivitySource,
  type CrmActivityType,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { CrmContactNotFoundError } from "./crm.errors";

export interface RecordActivityInput {
  contactId: string;
  activityType: CrmActivityType;
  body: string;
  source?: CrmActivitySource;
  visibility?: string;
  occurredAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface ListActivitiesFilter {
  activityType?: CrmActivityType;
  limit?: number;
  offset?: number;
}

@Injectable()
export class CrmActivityService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  private makeId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  }

  async recordActivity(input: RecordActivityInput, actorId: string, actorType = "admin") {
    // 1. Check contact exists
    const [contact] = await this.db
      .select({ id: crmContact.id, metadata: crmContact.metadata })
      .from(crmContact)
      .where(eq(crmContact.id, input.contactId))
      .limit(1);

    if (!contact) {
      throw new CrmContactNotFoundError(input.contactId);
    }

    if (!CRM_ACTIVITY_TYPES.includes(input.activityType)) {
      throw new Error(`Invalid CRM activity type: '${input.activityType}'`);
    }

    const source: CrmActivitySource = input.source || "MANUAL_ACTIVITY";
    if (!CRM_ACTIVITY_SOURCES.includes(source)) {
      throw new Error(`Invalid CRM activity source: '${source}'`);
    }

    const id = this.makeId("act");
    const occurredAt = input.occurredAt || new Date();
    const now = new Date();

    const [created] = await this.db
      .insert(crmActivity)
      .values({
        id,
        contactId: input.contactId,
        activityType: input.activityType,
        body: input.body.trim(),
        actorId,
        actorType,
        source,
        visibility: input.visibility || "internal",
        occurredAt,
        metadata: input.metadata || {},
        createdAt: now,
      })
      .returning();

    // Update contact metadata with last activity info
    const existingMeta = (contact.metadata as Record<string, unknown>) || {};
    await this.db
      .update(crmContact)
      .set({
        metadata: {
          ...existingMeta,
          lastActivityAt: occurredAt.toISOString(),
          lastActivityType: input.activityType,
        },
        updatedAt: now,
      })
      .where(eq(crmContact.id, input.contactId));

    await this.auditService.record({
      actorId,
      actorRole: "admin",
      action: "crm_activity_recorded",
      entityType: "crm_activity",
      entityId: id,
      metadata: { contactId: input.contactId, activityType: input.activityType, source },
    });

    return created;
  }

  async listActivities(contactId: string, filter: ListActivitiesFilter = {}) {
    const limit = Math.min(filter.limit ?? 50, 100);
    const offset = filter.offset ?? 0;

    const conditions = [eq(crmActivity.contactId, contactId)];
    if (filter.activityType) {
      conditions.push(eq(crmActivity.activityType, filter.activityType));
    }

    const rows = await this.db
      .select({
        id: crmActivity.id,
        contactId: crmActivity.contactId,
        activityType: crmActivity.activityType,
        body: crmActivity.body,
        actorId: crmActivity.actorId,
        actorType: crmActivity.actorType,
        source: crmActivity.source,
        visibility: crmActivity.visibility,
        occurredAt: crmActivity.occurredAt,
        metadata: crmActivity.metadata,
        createdAt: crmActivity.createdAt,
        actorName: accountUser.displayName,
        actorEmail: accountUser.email,
      })
      .from(crmActivity)
      .leftJoin(accountUser, eq(accountUser.id, crmActivity.actorId))
      .where(and(...conditions))
      .orderBy(desc(crmActivity.occurredAt))
      .limit(limit)
      .offset(offset);

    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(crmActivity)
      .where(and(...conditions));

    return {
      items: rows,
      total: countResult?.count ?? 0,
      limit,
      offset,
    };
  }

  /**
   * Unified timeline combining CRM activities with Phase 5.0 admin internal notes (for wholesale entities).
   */
  async getCombinedTimeline(contactId: string, limit = 50) {
    // 1. Get CRM activities
    const activities = await this.listActivities(contactId, { limit });

    // 2. Check if contact has linked user account
    const [link] = await this.db
      .select({ userId: crmContactIdentityLink.userId, linkType: crmContactIdentityLink.linkType })
      .from(crmContactIdentityLink)
      .where(eq(crmContactIdentityLink.contactId, contactId))
      .limit(1);

    let internalNotes: Array<{
      id: string;
      targetType: string;
      targetId: string;
      noteText: string;
      authorId: string;
      authorName: string | null;
      createdAt: Date;
    }> = [];

    if (link?.userId) {
      // Find wholesale account for this user if any
      const [wsAcc] = await this.db
        .select({ id: wholesaleAccount.id })
        .from(wholesaleAccount)
        .where(eq(wholesaleAccount.userId, link.userId))
        .limit(1);

      if (wsAcc) {
        internalNotes = await this.db
          .select({
            id: adminInternalNote.id,
            targetType: adminInternalNote.targetType,
            targetId: adminInternalNote.targetId,
            noteText: adminInternalNote.noteText,
            authorId: adminInternalNote.authorId,
            authorName: accountUser.displayName,
            createdAt: adminInternalNote.createdAt,
          })
          .from(adminInternalNote)
          .leftJoin(accountUser, eq(accountUser.id, adminInternalNote.authorId))
          .where(
            and(
              eq(adminInternalNote.targetType, "wholesale_account"),
              eq(adminInternalNote.targetId, wsAcc.id),
            ),
          )
          .orderBy(desc(adminInternalNote.createdAt))
          .limit(limit);
      }
    }

    // 3. Transform into unified timeline items
    const timelineItems = [
      ...activities.items.map((act) => ({
        id: act.id,
        kind: "activity" as const,
        type: act.activityType,
        title: act.activityType,
        body: act.body,
        source: act.source,
        timestamp: act.occurredAt,
        actorId: act.actorId,
        actorName: act.actorName,
        metadata: (act.metadata as Record<string, unknown>) || {},
      })),
      ...internalNotes.map((note) => ({
        id: note.id,
        kind: "internal_note" as const,
        type: "NOTE" as const,
        title: `یادداشت تجاری (${note.targetType})`,
        body: note.noteText,
        source: "admin_internal_note",
        timestamp: note.createdAt,
        actorId: note.authorId,
        actorName: note.authorName,
        metadata: { targetType: note.targetType, targetId: note.targetId } as Record<string, unknown>,
      })),
    ];

    // Sort descending by timestamp
    timelineItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return timelineItems.slice(0, limit);
  }
}
