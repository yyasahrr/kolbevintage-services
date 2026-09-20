import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  accountUser,
  crmAssignmentHistory,
  crmContact,
  crmContactIdentityLink,
  crmContactTag,
  crmStageHistory,
  crmTag,
  CRM_STAGES,
  CRM_STAGE_SOURCES,
  type CrmStage,
  type CrmStageSource,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import {
  CrmContactDuplicateLinkError,
  CrmContactNotFoundError,
  CrmStageInvalidError,
} from "./crm.errors";

export interface CreateContactInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  stage?: CrmStage;
  assignedAdminId?: string | null;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateContactInput {
  name?: string;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ListContactsFilter {
  stage?: CrmStage;
  search?: string;
  assignedAdminId?: string;
  tagId?: string;
  isLinked?: boolean;
  limit?: number;
  offset?: number;
}

@Injectable()
export class CrmContactService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  private makeId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  }

  normalizePhone(phone?: string | null): string | null {
    if (!phone) return null;
    const clean = phone.trim().replace(/[\s-]/g, "");
    if (!clean) return null;
    return clean;
  }

  normalizeEmail(email?: string | null): string | null {
    if (!email) return null;
    const clean = email.trim().toLowerCase();
    if (!clean) return null;
    return clean;
  }

  async createContact(input: CreateContactInput, actorId: string) {
    const contactId = this.makeId("crm_cnt");
    const stage: CrmStage = input.stage ?? "LEAD";

    if (!CRM_STAGES.includes(stage)) {
      throw new CrmStageInvalidError(stage);
    }

    const normalizedPhone = this.normalizePhone(input.phone);
    const normalizedEmail = this.normalizeEmail(input.email);

    const now = new Date();
    const assignedAdminId = input.assignedAdminId || null;
    const assignedAt = assignedAdminId ? now : null;

    const metadata: Record<string, unknown> = {
      ...(input.metadata || {}),
      ...(input.source ? { source: input.source } : {}),
    };

    const [created] = await this.db
      .insert(crmContact)
      .values({
        id: contactId,
        name: input.name.trim(),
        phone: normalizedPhone,
        email: normalizedEmail,
        city: input.city?.trim() || null,
        stage,
        assignedAdminId,
        assignedAt,
        metadata,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Record initial stage history with a valid CRM_STAGE_SOURCE
    await this.db.insert(crmStageHistory).values({
      id: this.makeId("csh"),
      contactId,
      fromStage: null,
      toStage: stage,
      actorId,
      reason: "Initial contact creation",
      source: "manual",
      createdAt: now,
    });

    // Record initial assignment history if assigned
    if (assignedAdminId) {
      await this.db.insert(crmAssignmentHistory).values({
        id: this.makeId("cah"),
        contactId,
        fromAdminId: null,
        toAdminId: assignedAdminId,
        assignedBy: actorId,
        reason: "Initial assignment upon contact creation",
        createdAt: now,
      });
    }

    await this.auditService.record({
      actorId,
      actorRole: "admin",
      action: "crm_contact_created",
      entityType: "crm_contact",
      entityId: contactId,
      metadata: { name: created.name, stage, assignedAdminId },
    });

    return created;
  }

  async getContact(contactId: string) {
    const [contact] = await this.db
      .select()
      .from(crmContact)
      .where(eq(crmContact.id, contactId))
      .limit(1);

    if (!contact) {
      throw new CrmContactNotFoundError(contactId);
    }

    // Get linked user identity if any
    const [link] = await this.db
      .select({
        id: crmContactIdentityLink.id,
        userId: crmContactIdentityLink.userId,
        linkType: crmContactIdentityLink.linkType,
        linkedBy: crmContactIdentityLink.linkedBy,
        linkedAt: crmContactIdentityLink.linkedAt,
        userPhone: accountUser.phone,
        userEmail: accountUser.email,
        userName: accountUser.displayName,
      })
      .from(crmContactIdentityLink)
      .leftJoin(accountUser, eq(accountUser.id, crmContactIdentityLink.userId))
      .where(eq(crmContactIdentityLink.contactId, contactId))
      .limit(1);

    // Get assigned admin if any
    let assignedAdmin: { id: string; displayName: string | null; email: string } | null = null;
    if (contact.assignedAdminId) {
      const [admin] = await this.db
        .select({
          id: accountUser.id,
          displayName: accountUser.displayName,
          email: accountUser.email,
        })
        .from(accountUser)
        .where(eq(accountUser.id, contact.assignedAdminId))
        .limit(1);
      if (admin) assignedAdmin = admin;
    }

    // Get tags
    const tags = await this.db
      .select({
        id: crmTag.id,
        key: crmTag.key,
        label: crmTag.label,
        color: crmTag.color,
      })
      .from(crmContactTag)
      .innerJoin(crmTag, eq(crmTag.id, crmContactTag.tagId))
      .where(eq(crmContactTag.contactId, contactId));

    return {
      ...contact,
      identityLink: link || null,
      assignedAdmin,
      tags,
    };
  }

  async updateContact(contactId: string, patch: UpdateContactInput, actorId: string) {
    const existing = await this.getContact(contactId);

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (patch.name !== undefined) updateData.name = patch.name.trim();
    if (patch.phone !== undefined) updateData.phone = this.normalizePhone(patch.phone);
    if (patch.email !== undefined) updateData.email = this.normalizeEmail(patch.email);
    if (patch.city !== undefined) updateData.city = patch.city?.trim() || null;
    if (patch.metadata !== undefined) {
      updateData.metadata = {
        ...((existing.metadata as Record<string, unknown>) || {}),
        ...patch.metadata,
      };
    }

    const [updated] = await this.db
      .update(crmContact)
      .set(updateData)
      .where(eq(crmContact.id, contactId))
      .returning();

    await this.auditService.record({
      actorId,
      actorRole: "admin",
      action: "crm_contact_updated",
      entityType: "crm_contact",
      entityId: contactId,
      metadata: { patch },
    });

    return updated;
  }

  async linkIdentity(
    contactId: string,
    userId: string,
    actorId: string,
    linkType: "account_user" | "wholesale_account" = "account_user",
  ) {
    // 1. Check contact exists
    const contact = await this.getContact(contactId);

    // 2. Check if user already linked to ANY contact
    const [existingUserLink] = await this.db
      .select()
      .from(crmContactIdentityLink)
      .where(eq(crmContactIdentityLink.userId, userId))
      .limit(1);

    if (existingUserLink) {
      if (existingUserLink.contactId === contactId) {
        // Already linked to this contact, idempotent return
        return existingUserLink;
      }
      throw new CrmContactDuplicateLinkError(
        `User account '${userId}' is already linked to CRM contact '${existingUserLink.contactId}'`,
      );
    }

    // 3. Verify user exists in accountUser table
    const [user] = await this.db
      .select({
        id: accountUser.id,
        phone: accountUser.phone,
        email: accountUser.email,
        displayName: accountUser.displayName,
      })
      .from(accountUser)
      .where(eq(accountUser.id, userId))
      .limit(1);

    if (!user) {
      throw new CrmContactDuplicateLinkError(`User account '${userId}' does not exist`);
    }

    // 4. Create link
    const linkId = this.makeId("cil");
    const [link] = await this.db
      .insert(crmContactIdentityLink)
      .values({
        id: linkId,
        contactId,
        userId,
        linkType,
        linkedBy: actorId,
        metadata: {
          userName: user.displayName,
          userPhone: user.phone,
          userEmail: user.email,
        },
      })
      .returning();

    // If contact's phone/email is empty, backfill from accountUser
    const backfill: Record<string, unknown> = {};
    if (!contact.phone && user.phone) backfill.phone = user.phone;
    if (!contact.email && user.email) backfill.email = user.email;
    if (Object.keys(backfill).length > 0) {
      await this.db
        .update(crmContact)
        .set(backfill)
        .where(eq(crmContact.id, contactId));
    }

    await this.auditService.record({
      actorId,
      actorRole: "admin",
      action: "crm_contact_identity_linked",
      entityType: "crm_contact",
      entityId: contactId,
      metadata: { userId, linkType },
    });

    return link;
  }

  async changeStage(
    contactId: string,
    toStage: CrmStage,
    actorId: string,
    reason?: string,
    source: CrmStageSource = "manual",
  ) {
    if (!CRM_STAGES.includes(toStage)) {
      throw new CrmStageInvalidError(toStage);
    }

    if (!CRM_STAGE_SOURCES.includes(source)) {
      source = "manual";
    }

    const contact = await this.getContact(contactId);
    const fromStage = contact.stage as CrmStage;

    if (fromStage === toStage) {
      return contact;
    }

    const now = new Date();
    const [updated] = await this.db
      .update(crmContact)
      .set({
        stage: toStage,
        updatedAt: now,
      })
      .where(eq(crmContact.id, contactId))
      .returning();

    // Add immutable history entry
    await this.db.insert(crmStageHistory).values({
      id: this.makeId("csh"),
      contactId,
      fromStage,
      toStage,
      actorId,
      reason: reason || null,
      source,
      createdAt: now,
    });

    await this.auditService.record({
      actorId,
      actorRole: "admin",
      action: "crm_contact_stage_changed",
      entityType: "crm_contact",
      entityId: contactId,
      metadata: { fromStage, toStage, reason, source },
    });

    return updated;
  }

  async assignAdmin(
    contactId: string,
    toAdminId: string | null,
    actorId: string,
    reason?: string,
  ) {
    const contact = await this.getContact(contactId);
    const fromAdminId = contact.assignedAdminId;

    if (fromAdminId === toAdminId) {
      return contact;
    }

    if (toAdminId) {
      const [admin] = await this.db
        .select({ id: accountUser.id, status: accountUser.status })
        .from(accountUser)
        .where(eq(accountUser.id, toAdminId))
        .limit(1);

      if (!admin || admin.status !== "active") {
        throw new Error(`Admin user '${toAdminId}' is not active or does not exist`);
      }
    }

    const now = new Date();
    const [updated] = await this.db
      .update(crmContact)
      .set({
        assignedAdminId: toAdminId,
        assignedAt: toAdminId ? now : null,
        updatedAt: now,
      })
      .where(eq(crmContact.id, contactId))
      .returning();

    await this.db.insert(crmAssignmentHistory).values({
      id: this.makeId("cah"),
      contactId,
      fromAdminId,
      toAdminId,
      assignedBy: actorId,
      reason: reason || null,
      createdAt: now,
    });

    await this.auditService.record({
      actorId,
      actorRole: "admin",
      action: "crm_contact_assigned",
      entityType: "crm_contact",
      entityId: contactId,
      metadata: { fromAdminId, toAdminId, reason },
    });

    return updated;
  }

  async getStageHistory(contactId: string) {
    await this.getContact(contactId);

    return await this.db
      .select({
        id: crmStageHistory.id,
        contactId: crmStageHistory.contactId,
        fromStage: crmStageHistory.fromStage,
        toStage: crmStageHistory.toStage,
        actorId: crmStageHistory.actorId,
        actorName: accountUser.displayName,
        reason: crmStageHistory.reason,
        source: crmStageHistory.source,
        createdAt: crmStageHistory.createdAt,
      })
      .from(crmStageHistory)
      .leftJoin(accountUser, eq(accountUser.id, crmStageHistory.actorId))
      .where(eq(crmStageHistory.contactId, contactId))
      .orderBy(desc(crmStageHistory.createdAt));
  }

  async getAssignmentHistory(contactId: string) {
    await this.getContact(contactId);

    return await this.db
      .select({
        id: crmAssignmentHistory.id,
        contactId: crmAssignmentHistory.contactId,
        fromAdminId: crmAssignmentHistory.fromAdminId,
        toAdminId: crmAssignmentHistory.toAdminId,
        assignedBy: crmAssignmentHistory.assignedBy,
        reason: crmAssignmentHistory.reason,
        createdAt: crmAssignmentHistory.createdAt,
      })
      .from(crmAssignmentHistory)
      .where(eq(crmAssignmentHistory.contactId, contactId))
      .orderBy(desc(crmAssignmentHistory.createdAt));
  }

  async listContacts(filter: ListContactsFilter = {}) {
    const limit = Math.min(filter.limit ?? 50, 100);
    const offset = filter.offset ?? 0;

    const conditions = [];

    if (filter.stage) {
      conditions.push(eq(crmContact.stage, filter.stage));
    }

    if (filter.assignedAdminId) {
      conditions.push(eq(crmContact.assignedAdminId, filter.assignedAdminId));
    }

    if (filter.search) {
      const q = `%${filter.search.trim()}%`;
      conditions.push(
        or(
          ilike(crmContact.name, q),
          ilike(crmContact.phone, q),
          ilike(crmContact.email, q),
          ilike(crmContact.city, q),
        ),
      );
    }

    if (filter.tagId) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${crmContactTag}
          WHERE ${crmContactTag.contactId} = ${crmContact.id}
          AND ${crmContactTag.tagId} = ${filter.tagId}
        )`,
      );
    }

    if (filter.isLinked !== undefined) {
      if (filter.isLinked) {
        conditions.push(
          sql`EXISTS (
            SELECT 1 FROM ${crmContactIdentityLink}
            WHERE ${crmContactIdentityLink.contactId} = ${crmContact.id}
          )`,
        );
      } else {
        conditions.push(
          sql`NOT EXISTS (
            SELECT 1 FROM ${crmContactIdentityLink}
            WHERE ${crmContactIdentityLink.contactId} = ${crmContact.id}
          )`,
        );
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(crmContact)
      .where(whereClause);

    const total = countResult?.count ?? 0;

    const assignedAdmin = alias(accountUser, "assigned_admin");

    const rows = await this.db
      .select({
        id: crmContact.id,
        name: crmContact.name,
        phone: crmContact.phone,
        email: crmContact.email,
        city: crmContact.city,
        stage: crmContact.stage,
        assignedAdminId: crmContact.assignedAdminId,
        assignedAt: crmContact.assignedAt,
        metadata: crmContact.metadata,
        createdAt: crmContact.createdAt,
        updatedAt: crmContact.updatedAt,
        assignedAdminName: assignedAdmin.displayName,
      })
      .from(crmContact)
      .leftJoin(assignedAdmin, eq(assignedAdmin.id, crmContact.assignedAdminId))
      .where(whereClause)
      .orderBy(desc(crmContact.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      items: rows,
      total,
      limit,
      offset,
    };
  }
}
