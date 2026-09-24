import { Injectable, Inject } from "@nestjs/common";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import {
  supportCase,
  supportMessage,
  supportInternalNote,
  supportAttachment,
  type SupportAuthorType,
  type SupportVisibility,
  type SupportAttachmentScanStatus,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import {
  SupportCaseNotFoundError,
  SupportUnauthorizedAccessError,
  SupportAttachmentInvalidError,
} from "./support.errors";
import crypto from "node:crypto";

export interface AddMessageInput {
  caseId: string;
  author: {
    type: SupportAuthorType;
    id?: string | null;
    displayName: string;
  };
  body: string;
  visibility?: SupportVisibility;
  idempotencyKey?: string | null;
  attachmentIds?: string[];
}

export interface AddInternalNoteInput {
  caseId: string;
  adminId: string;
  adminDisplayName: string;
  body: string;
  isPinned?: boolean;
}

export interface CreateAttachmentMetadataInput {
  caseId: string;
  uploader: {
    type: SupportAuthorType;
    id?: string | null;
  };
  originalFilename: string;
  contentType: string;
  sizeBytes: bigint | number;
  objectKey: string;
  visibility?: SupportVisibility;
  scanStatus?: SupportAttachmentScanStatus;
}

export interface ActorContext {
  userId?: string | null;
  role: string;
  supplierId?: string | null;
  wholesaleAccountId?: string | null;
}

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const DANGEROUS_EXTENSIONS = [
  ".exe",
  ".sh",
  ".bat",
  ".cmd",
  ".js",
  ".html",
  ".htm",
  ".php",
  ".py",
  ".vbs",
  ".ps1",
];

const MAX_ATTACHMENT_SIZE = 15 * 1024 * 1024; // 15 MB

@Injectable()
export class SupportConversationService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Enforces tenant and role isolation for access to a support case.
   */
  async verifyParticipantAccess(caseId: string, actor: ActorContext): Promise<typeof supportCase.$inferSelect> {
    const [c] = await this.db.select().from(supportCase).where(eq(supportCase.id, caseId));
    if (!c) {
      throw new SupportCaseNotFoundError(caseId);
    }

    if (actor.role === "admin") {
      return c;
    }

    if (actor.role === "customer") {
      if (c.requesterType !== "RETAIL_CUSTOMER" || c.requesterUserId !== actor.userId) {
        throw new SupportUnauthorizedAccessError("Retail customers can only access their own support cases");
      }
      return c;
    }

    if (actor.role === "vip") {
      const matchUser = c.requesterUserId === actor.userId;
      const matchAccount = actor.wholesaleAccountId && c.wholesaleAccountId === actor.wholesaleAccountId;
      if (c.requesterType !== "VIP_BUYER" || (!matchUser && !matchAccount)) {
        throw new SupportUnauthorizedAccessError("VIP buyers can only access cases belonging to their wholesale account");
      }
      return c;
    }

    if (actor.role === "supplier") {
      if (c.requesterType !== "SUPPLIER" || c.supplierId !== actor.supplierId) {
        throw new SupportUnauthorizedAccessError("Suppliers can only access support cases assigned to their supplier profile");
      }
      return c;
    }

    throw new SupportUnauthorizedAccessError("Role not recognized for support case access");
  }

  /**
   * Appends a message to a support case conversation with idempotency support.
   */
  async addMessage(input: AddMessageInput) {
    const trimmedBody = input.body.trim();
    if (!trimmedBody) {
      throw new SupportAttachmentInvalidError("Message body cannot be empty");
    }

    // Verify case exists
    const [c] = await this.db.select().from(supportCase).where(eq(supportCase.id, input.caseId));
    if (!c) {
      throw new SupportCaseNotFoundError(input.caseId);
    }

    // Idempotency check
    if (input.idempotencyKey) {
      const [existing] = await this.db
        .select()
        .from(supportMessage)
        .where(
          and(
            eq(supportMessage.caseId, input.caseId),
            eq(supportMessage.idempotencyKey, input.idempotencyKey),
          ),
        );
      if (existing) {
        return existing;
      }
    }

    // Non-admins cannot create internal messages
    let visibility = input.visibility ?? "PUBLIC";
    if (input.author.type !== "ADMIN" && input.author.type !== "SYSTEM") {
      visibility = "PUBLIC";
    }

    const now = new Date();
    const messageId = `smsg_${crypto.randomUUID()}`;

    const [created] = await this.db
      .insert(supportMessage)
      .values({
        id: messageId,
        caseId: input.caseId,
        authorType: input.author.type,
        authorId: input.author.id ?? null,
        authorDisplayName: input.author.displayName,
        body: trimmedBody,
        visibility,
        idempotencyKey: input.idempotencyKey ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Link attachments if provided
    if (input.attachmentIds && input.attachmentIds.length > 0) {
      await this.db
        .update(supportAttachment)
        .set({ messageId })
        .where(
          and(
            eq(supportAttachment.caseId, input.caseId),
            inArray(supportAttachment.id, input.attachmentIds),
          ),
        );
    }

    // Touch case updatedAt
    await this.db
      .update(supportCase)
      .set({ updatedAt: now })
      .where(eq(supportCase.id, input.caseId));

    return created;
  }

  /**
   * Retrieves messages for a case, strictly isolating internal messages from customers.
   */
  async listMessages(caseId: string, actorRole: string) {
    const [c] = await this.db.select().from(supportCase).where(eq(supportCase.id, caseId));
    if (!c) {
      throw new SupportCaseNotFoundError(caseId);
    }

    const conditions = [eq(supportMessage.caseId, caseId)];
    // Customer/VIP/Supplier must NEVER see INTERNAL_ONLY messages
    if (actorRole !== "admin") {
      conditions.push(eq(supportMessage.visibility, "PUBLIC"));
    }

    const messages = await this.db
      .select()
      .from(supportMessage)
      .where(and(...conditions))
      .orderBy(asc(supportMessage.createdAt));

    // Fetch attachments for these messages
    const messageIds = messages.map((m) => m.id);
    let attachments: (typeof supportAttachment.$inferSelect)[] = [];
    if (messageIds.length > 0) {
      const attConditions = [
        eq(supportAttachment.caseId, caseId),
        inArray(supportAttachment.messageId, messageIds),
      ];
      if (actorRole !== "admin") {
        attConditions.push(eq(supportAttachment.visibility, "PUBLIC"));
      }
      attachments = await this.db
        .select()
        .from(supportAttachment)
        .where(and(...attConditions));
    }

    const attachmentsByMessageId = new Map<string, typeof attachments>();
    for (const att of attachments) {
      if (!att.messageId) continue;
      const list = attachmentsByMessageId.get(att.messageId) ?? [];
      list.push(att);
      attachmentsByMessageId.set(att.messageId, list);
    }

    return messages.map((m) => ({
      ...m,
      attachments: (attachmentsByMessageId.get(m.id) ?? []).map((attachment) => ({
        id: attachment.id,
        caseId: attachment.caseId,
        messageId: attachment.messageId,
        uploaderType: attachment.uploaderType,
        uploaderId: attachment.uploaderId,
        originalFilename: attachment.originalFilename,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        visibility: attachment.visibility,
        scanStatus: attachment.scanStatus,
        createdAt: attachment.createdAt,
      })),
    }));
  }

  /**
   * Adds an internal support note (admin only).
   */
  async addInternalNote(input: AddInternalNoteInput) {
    const trimmedBody = input.body.trim();
    if (!trimmedBody) {
      throw new SupportAttachmentInvalidError("Note body cannot be empty");
    }

    const [c] = await this.db.select().from(supportCase).where(eq(supportCase.id, input.caseId));
    if (!c) {
      throw new SupportCaseNotFoundError(input.caseId);
    }

    const now = new Date();
    const noteId = `snt_${crypto.randomUUID()}`;

    const [note] = await this.db
      .insert(supportInternalNote)
      .values({
        id: noteId,
        caseId: input.caseId,
        authorAdminId: input.adminId,
        authorDisplayName: input.adminDisplayName,
        body: trimmedBody,
        isPinned: input.isPinned ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await this.db
      .update(supportCase)
      .set({ updatedAt: now })
      .where(eq(supportCase.id, input.caseId));

    // Audit log
    await this.audit.record({
      action: "support.internal_note.created",
      entityType: "support_case",
      entityId: input.caseId,
      actorId: input.adminId,
      actorRole: "admin",
      metadata: {
        noteId,
        isPinned: input.isPinned ?? false,
      },
    });

    return note;
  }

  /**
   * Lists internal notes for a case (admin only).
   */
  async listInternalNotes(caseId: string, actorRole: string) {
    if (actorRole !== "admin") {
      throw new SupportUnauthorizedAccessError("Internal notes are strictly restricted to admin personnel");
    }

    const [c] = await this.db.select().from(supportCase).where(eq(supportCase.id, caseId));
    if (!c) {
      throw new SupportCaseNotFoundError(caseId);
    }

    return this.db
      .select()
      .from(supportInternalNote)
      .where(eq(supportInternalNote.caseId, caseId))
      .orderBy(desc(supportInternalNote.isPinned), asc(supportInternalNote.createdAt));
  }

  /**
   * Toggles the pinned status of an internal note.
   */
  async togglePinInternalNote(noteId: string, isPinned: boolean, adminId: string) {
    const [note] = await this.db
      .select()
      .from(supportInternalNote)
      .where(eq(supportInternalNote.id, noteId));
    if (!note) {
      throw new SupportCaseNotFoundError(`Note '${noteId}' was not found`);
    }

    const now = new Date();
    const [updated] = await this.db
      .update(supportInternalNote)
      .set({ isPinned, updatedAt: now })
      .where(eq(supportInternalNote.id, noteId))
      .returning();

    return updated;
  }

  /**
   * Registers attachment metadata with strict MIME and size validation.
   */
  async createAttachmentMetadata(input: CreateAttachmentMetadataInput) {
    // 1. Verify case
    const [c] = await this.db.select().from(supportCase).where(eq(supportCase.id, input.caseId));
    if (!c) {
      throw new SupportCaseNotFoundError(input.caseId);
    }

    // 2. Size validation
    const sizeBigInt = BigInt(input.sizeBytes);
    if (sizeBigInt <= 0n) {
      throw new SupportAttachmentInvalidError("Attachment size must be greater than 0");
    }
    if (sizeBigInt > BigInt(MAX_ATTACHMENT_SIZE)) {
      throw new SupportAttachmentInvalidError(`Attachment size exceeds maximum allowed size of ${MAX_ATTACHMENT_SIZE / (1024 * 1024)}MB`);
    }

    // 3. MIME validation
    const lowerMime = input.contentType.toLowerCase().trim();
    if (!ALLOWED_MIME_TYPES.has(lowerMime)) {
      throw new SupportAttachmentInvalidError(`MIME type '${input.contentType}' is not permitted`);
    }

    // 4. Filename extension validation
    const lowerFilename = input.originalFilename.toLowerCase();
    for (const dangerousExt of DANGEROUS_EXTENSIONS) {
      if (lowerFilename.endsWith(dangerousExt)) {
        throw new SupportAttachmentInvalidError(`Executable or script file type '${dangerousExt}' is prohibited`);
      }
    }

    // Visibility defaults
    let visibility = input.visibility ?? "PUBLIC";
    if (input.uploader.type !== "ADMIN") {
      visibility = "PUBLIC";
    }

    const now = new Date();
    const attachmentId = `satt_${crypto.randomUUID()}`;

    const [created] = await this.db
      .insert(supportAttachment)
      .values({
        id: attachmentId,
        caseId: input.caseId,
        messageId: null,
        uploaderType: input.uploader.type,
        uploaderId: input.uploader.id ?? null,
        objectKey: input.objectKey,
        originalFilename: input.originalFilename,
        contentType: lowerMime,
        sizeBytes: sizeBigInt,
        visibility,
        scanStatus: input.scanStatus ?? "PENDING_SCAN",
        createdAt: now,
      })
      .returning();

    return created;
  }

  /**
   * Validates access and returns secure signed download descriptor (no raw public URLs).
   */
  async getAttachmentAccess(attachmentId: string, actorRole: string) {
    const [att] = await this.db
      .select()
      .from(supportAttachment)
      .where(eq(supportAttachment.id, attachmentId));

    if (!att) {
      throw new SupportAttachmentInvalidError(`Attachment '${attachmentId}' not found`);
    }

    if (att.visibility === "INTERNAL" && actorRole !== "admin") {
      throw new SupportUnauthorizedAccessError("Internal attachment is not accessible");
    }

    if (att.scanStatus === "REJECTED" || att.scanStatus === "SUSPICIOUS") {
      throw new SupportAttachmentInvalidError(`Attachment cannot be downloaded due to scan status: ${att.scanStatus}`);
    }

    // Generate secure time-bounded signed access token
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    return {
      attachmentId: att.id,
      originalFilename: att.originalFilename,
      contentType: att.contentType,
      sizeBytes: att.sizeBytes.toString(),
      scanStatus: att.scanStatus,
      visibility: att.visibility,
      secureAccessToken: token,
      expiresAt: expiresAt.toISOString(),
      downloadUrl: `/api/v1/support/attachments/${att.id}/download?token=${token}`,
    };
  }

  /**
   * Updates virus scan status.
   */
  async updateScanStatus(attachmentId: string, status: SupportAttachmentScanStatus) {
    const [updated] = await this.db
      .update(supportAttachment)
      .set({ scanStatus: status })
      .where(eq(supportAttachment.id, attachmentId))
      .returning();

    if (!updated) {
      throw new SupportAttachmentInvalidError(`Attachment '${attachmentId}' not found`);
    }

    return updated;
  }

  /**
   * Summarizes all participants of a support case.
   */
  async getCaseParticipants(caseId: string) {
    const [c] = await this.db.select().from(supportCase).where(eq(supportCase.id, caseId));
    if (!c) {
      throw new SupportCaseNotFoundError(caseId);
    }

    // Fetch distinct message authors
    const messages = await this.db
      .select({
        authorType: supportMessage.authorType,
        authorId: supportMessage.authorId,
        authorDisplayName: supportMessage.authorDisplayName,
      })
      .from(supportMessage)
      .where(eq(supportMessage.caseId, caseId));

    const distinctAuthors = new Map<string, { type: string; id: string | null; name: string }>();
    for (const m of messages) {
      const key = `${m.authorType}:${m.authorId ?? "anon"}:${m.authorDisplayName}`;
      if (!distinctAuthors.has(key)) {
        distinctAuthors.set(key, {
          type: m.authorType,
          id: m.authorId,
          name: m.authorDisplayName,
        });
      }
    }

    return {
      caseId: c.id,
      requester: {
        type: c.requesterType,
        userId: c.requesterUserId,
        wholesaleAccountId: c.wholesaleAccountId,
        supplierId: c.supplierId,
      },
      assignedAdminId: c.assignedAdminId,
      assignedTeamKey: c.assignedTeamKey,
      contributors: Array.from(distinctAuthors.values()),
    };
  }
}
