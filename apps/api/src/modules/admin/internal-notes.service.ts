import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import {
  adminInternalNote,
  accountUser,
  ADMIN_NOTE_TARGET_TYPES,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";

export interface CreateNoteInput {
  targetType: (typeof ADMIN_NOTE_TARGET_TYPES)[number];
  targetId: string;
  noteText: string;
  isPinned?: boolean;
  metadata?: Record<string, any>;
}

@Injectable()
export class InternalNotesService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  private makeId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  }

  async createNote(input: CreateNoteInput, authorId: string) {
    const id = this.makeId("ain");
    const [note] = await this.db
      .insert(adminInternalNote)
      .values({
        id,
        targetType: input.targetType,
        targetId: input.targetId,
        authorId,
        noteText: input.noteText,
        isPinned: input.isPinned ?? false,
        isArchived: false,
        metadata: input.metadata || {},
      })
      .returning();

    await this.auditService.record({
      actorId: authorId,
      actorRole: "admin",
      action: "internal_note_created",
      entityType: "admin_internal_note",
      entityId: id,
      metadata: { targetType: input.targetType, targetId: input.targetId },
    });

    return note;
  }

  async getNotesForTarget(
    targetType: (typeof ADMIN_NOTE_TARGET_TYPES)[number],
    targetId: string,
    includeArchived = false,
  ) {
    const conditions = [
      eq(adminInternalNote.targetType, targetType),
      eq(adminInternalNote.targetId, targetId),
    ];

    if (!includeArchived) {
      conditions.push(eq(adminInternalNote.isArchived, false));
    }

    return await this.db
      .select({
        id: adminInternalNote.id,
        targetType: adminInternalNote.targetType,
        targetId: adminInternalNote.targetId,
        authorId: adminInternalNote.authorId,
        authorName: accountUser.displayName,
        authorPhone: accountUser.phone,
        noteText: adminInternalNote.noteText,
        isPinned: adminInternalNote.isPinned,
        isArchived: adminInternalNote.isArchived,
        metadata: adminInternalNote.metadata,
        createdAt: adminInternalNote.createdAt,
        updatedAt: adminInternalNote.updatedAt,
      })
      .from(adminInternalNote)
      .innerJoin(accountUser, eq(accountUser.id, adminInternalNote.authorId))
      .where(and(...conditions))
      .orderBy(desc(adminInternalNote.isPinned), desc(adminInternalNote.createdAt));
  }

  async setPin(noteId: string, isPinned: boolean, actorId: string) {
    const [updated] = await this.db
      .update(adminInternalNote)
      .set({ isPinned })
      .where(eq(adminInternalNote.id, noteId))
      .returning();

    await this.auditService.record({
      actorId,
      actorRole: "admin",
      action: isPinned ? "internal_note_pinned" : "internal_note_unpinned",
      entityType: "admin_internal_note",
      entityId: noteId,
    });

    return updated;
  }

  async archiveNote(noteId: string, actorId: string) {
    const [archived] = await this.db
      .update(adminInternalNote)
      .set({ isArchived: true })
      .where(eq(adminInternalNote.id, noteId))
      .returning();

    await this.auditService.record({
      actorId,
      actorRole: "admin",
      action: "internal_note_archived",
      entityType: "admin_internal_note",
      entityId: noteId,
    });

    return archived;
  }
}
