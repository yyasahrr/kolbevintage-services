import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  accountUser,
  crmContact,
  crmTask,
  CRM_TASK_PRIORITIES,
  CRM_TASK_STATUSES,
  type CrmTaskPriority,
  type CrmTaskStatus,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import {
  CrmContactNotFoundError,
  CrmTaskInvalidStateError,
  CrmTaskNotFoundError,
} from "./crm.errors";

export interface CreateTaskInput {
  contactId: string;
  title: string;
  description?: string;
  assigneeId?: string | null;
  priority?: CrmTaskPriority;
  dueAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export type CrmTaskQueue =
  | "my_open"
  | "overdue"
  | "due_today"
  | "due_soon"
  | "unassigned"
  | "completed";

export interface ListTasksFilter {
  contactId?: string;
  assigneeId?: string;
  status?: CrmTaskStatus;
  priority?: CrmTaskPriority;
  queue?: CrmTaskQueue;
  actorId?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class CrmTaskService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  private makeId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  }

  async createTask(input: CreateTaskInput, actorId: string) {
    // 1. Verify contact exists
    const [contact] = await this.db
      .select({ id: crmContact.id })
      .from(crmContact)
      .where(eq(crmContact.id, input.contactId))
      .limit(1);

    if (!contact) {
      throw new CrmContactNotFoundError(input.contactId);
    }

    // 2. Verify assignee if provided
    if (input.assigneeId) {
      const [assignee] = await this.db
        .select({ id: accountUser.id, status: accountUser.status })
        .from(accountUser)
        .where(eq(accountUser.id, input.assigneeId))
        .limit(1);

      if (!assignee || assignee.status !== "active") {
        throw new Error(`Assignee user '${input.assigneeId}' is not active or does not exist`);
      }
    }

    const priority: CrmTaskPriority = input.priority || "medium";
    if (!CRM_TASK_PRIORITIES.includes(priority)) {
      throw new Error(`Invalid CRM task priority: '${priority}'`);
    }

    const id = this.makeId("tsk");
    const now = new Date();

    const [created] = await this.db
      .insert(crmTask)
      .values({
        id,
        contactId: input.contactId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        assigneeId: input.assigneeId || null,
        priority,
        status: "OPEN",
        dueAt: input.dueAt || null,
        createdBy: actorId,
        metadata: input.metadata || {},
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await this.auditService.record({
      actorId,
      actorRole: "admin",
      action: "crm_task_created",
      entityType: "crm_task",
      entityId: id,
      metadata: { contactId: input.contactId, title: input.title, priority },
    });

    return created;
  }

  async getTask(taskId: string) {
    const assigneeUser = alias(accountUser, "task_assignee");
    const creatorUser = alias(accountUser, "task_creator");

    const [row] = await this.db
      .select({
        id: crmTask.id,
        contactId: crmTask.contactId,
        title: crmTask.title,
        description: crmTask.description,
        assigneeId: crmTask.assigneeId,
        priority: crmTask.priority,
        status: crmTask.status,
        dueAt: crmTask.dueAt,
        completedAt: crmTask.completedAt,
        completedBy: crmTask.completedBy,
        cancelledAt: crmTask.cancelledAt,
        cancelledBy: crmTask.cancelledBy,
        createdBy: crmTask.createdBy,
        metadata: crmTask.metadata,
        createdAt: crmTask.createdAt,
        updatedAt: crmTask.updatedAt,
        contactName: crmContact.name,
        assigneeName: assigneeUser.displayName,
        creatorName: creatorUser.displayName,
      })
      .from(crmTask)
      .innerJoin(crmContact, eq(crmContact.id, crmTask.contactId))
      .leftJoin(assigneeUser, eq(assigneeUser.id, crmTask.assigneeId))
      .leftJoin(creatorUser, eq(creatorUser.id, crmTask.createdBy))
      .where(eq(crmTask.id, taskId))
      .limit(1);

    if (!row) {
      throw new CrmTaskNotFoundError(taskId);
    }

    return row;
  }

  async startTask(taskId: string, actorId: string) {
    const task = await this.getTask(taskId);

    if (task.status === "IN_PROGRESS") {
      return task;
    }

    if (task.status === "DONE" || task.status === "CANCELLED") {
      throw new CrmTaskInvalidStateError(
        `Cannot start task '${taskId}' because it is already '${task.status}'`,
      );
    }

    const now = new Date();
    const [updated] = await this.db
      .update(crmTask)
      .set({
        status: "IN_PROGRESS",
        updatedAt: now,
      })
      .where(eq(crmTask.id, taskId))
      .returning();

    await this.auditService.record({
      actorId,
      actorRole: "admin",
      action: "crm_task_started",
      entityType: "crm_task",
      entityId: taskId,
      metadata: { fromStatus: task.status, toStatus: "IN_PROGRESS" },
    });

    return updated;
  }

  async completeTask(taskId: string, actorId: string) {
    const task = await this.getTask(taskId);

    if (task.status === "DONE") {
      return task;
    }

    if (task.status === "CANCELLED") {
      throw new CrmTaskInvalidStateError(
        `Cannot complete task '${taskId}' because it was CANCELLED. Reopen it first.`,
      );
    }

    const now = new Date();
    const [updated] = await this.db
      .update(crmTask)
      .set({
        status: "DONE",
        completedAt: now,
        completedBy: actorId,
        updatedAt: now,
      })
      .where(eq(crmTask.id, taskId))
      .returning();

    await this.auditService.record({
      actorId,
      actorRole: "admin",
      action: "crm_task_completed",
      entityType: "crm_task",
      entityId: taskId,
      metadata: { fromStatus: task.status, toStatus: "DONE" },
    });

    return updated;
  }

  async cancelTask(taskId: string, actorId: string, reason?: string) {
    const task = await this.getTask(taskId);

    if (task.status === "CANCELLED") {
      return task;
    }

    if (task.status === "DONE") {
      throw new CrmTaskInvalidStateError(
        `Cannot cancel task '${taskId}' because it is already DONE.`,
      );
    }

    const now = new Date();
    const existingMeta = (task.metadata as Record<string, unknown>) || {};
    const updatedMeta = reason
      ? { ...existingMeta, cancellationReason: reason }
      : existingMeta;

    const [updated] = await this.db
      .update(crmTask)
      .set({
        status: "CANCELLED",
        cancelledAt: now,
        cancelledBy: actorId,
        metadata: updatedMeta,
        updatedAt: now,
      })
      .where(eq(crmTask.id, taskId))
      .returning();

    await this.auditService.record({
      actorId,
      actorRole: "admin",
      action: "crm_task_cancelled",
      entityType: "crm_task",
      entityId: taskId,
      metadata: { fromStatus: task.status, toStatus: "CANCELLED", reason },
    });

    return updated;
  }

  async reopenTask(taskId: string, actorId: string) {
    const task = await this.getTask(taskId);

    if (task.status === "OPEN") {
      return task;
    }

    const now = new Date();
    const [updated] = await this.db
      .update(crmTask)
      .set({
        status: "OPEN",
        completedAt: null,
        completedBy: null,
        cancelledAt: null,
        cancelledBy: null,
        updatedAt: now,
      })
      .where(eq(crmTask.id, taskId))
      .returning();

    await this.auditService.record({
      actorId,
      actorRole: "admin",
      action: "crm_task_reopened",
      entityType: "crm_task",
      entityId: taskId,
      metadata: { fromStatus: task.status, toStatus: "OPEN" },
    });

    return updated;
  }

  async reassignTask(taskId: string, newAssigneeId: string | null, actorId: string) {
    const task = await this.getTask(taskId);

    if (newAssigneeId) {
      const [assignee] = await this.db
        .select({ id: accountUser.id, status: accountUser.status })
        .from(accountUser)
        .where(eq(accountUser.id, newAssigneeId))
        .limit(1);

      if (!assignee || assignee.status !== "active") {
        throw new Error(`Assignee user '${newAssigneeId}' is not active or does not exist`);
      }
    }

    const now = new Date();
    const [updated] = await this.db
      .update(crmTask)
      .set({
        assigneeId: newAssigneeId,
        updatedAt: now,
      })
      .where(eq(crmTask.id, taskId))
      .returning();

    await this.auditService.record({
      actorId,
      actorRole: "admin",
      action: "crm_task_reassigned",
      entityType: "crm_task",
      entityId: taskId,
      metadata: { fromAssigneeId: task.assigneeId, toAssigneeId: newAssigneeId },
    });

    return updated;
  }

  async listTasks(filter: ListTasksFilter = {}) {
    const limit = Math.min(filter.limit ?? 50, 100);
    const offset = filter.offset ?? 0;
    const now = new Date();

    const conditions = [];

    if (filter.contactId) {
      conditions.push(eq(crmTask.contactId, filter.contactId));
    }

    if (filter.assigneeId) {
      conditions.push(eq(crmTask.assigneeId, filter.assigneeId));
    }

    if (filter.status) {
      conditions.push(eq(crmTask.status, filter.status));
    }

    if (filter.priority) {
      conditions.push(eq(crmTask.priority, filter.priority));
    }

    // Handle queues
    if (filter.queue) {
      switch (filter.queue) {
        case "my_open": {
          if (!filter.actorId) {
            throw new Error("actorId is required for my_open queue");
          }
          conditions.push(eq(crmTask.assigneeId, filter.actorId));
          conditions.push(inArray(crmTask.status, ["OPEN", "IN_PROGRESS"]));
          break;
        }
        case "overdue": {
          conditions.push(inArray(crmTask.status, ["OPEN", "IN_PROGRESS"]));
          conditions.push(isNotNull(crmTask.dueAt));
          conditions.push(lt(crmTask.dueAt, now));
          break;
        }
        case "due_today": {
          const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
          conditions.push(inArray(crmTask.status, ["OPEN", "IN_PROGRESS"]));
          conditions.push(isNotNull(crmTask.dueAt));
          conditions.push(sql`${crmTask.dueAt} >= ${startOfDay} AND ${crmTask.dueAt} <= ${endOfDay}`);
          break;
        }
        case "due_soon": {
          const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          conditions.push(inArray(crmTask.status, ["OPEN", "IN_PROGRESS"]));
          conditions.push(isNotNull(crmTask.dueAt));
          conditions.push(sql`${crmTask.dueAt} >= ${now} AND ${crmTask.dueAt} <= ${in7Days}`);
          break;
        }
        case "unassigned": {
          conditions.push(isNull(crmTask.assigneeId));
          conditions.push(inArray(crmTask.status, ["OPEN", "IN_PROGRESS"]));
          break;
        }
        case "completed": {
          conditions.push(inArray(crmTask.status, ["DONE", "CANCELLED"]));
          break;
        }
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(crmTask)
      .where(whereClause);

    const total = countResult?.count ?? 0;

    const assigneeUser = alias(accountUser, "task_assignee");
    const creatorUser = alias(accountUser, "task_creator");

    const rows = await this.db
      .select({
        id: crmTask.id,
        contactId: crmTask.contactId,
        title: crmTask.title,
        description: crmTask.description,
        assigneeId: crmTask.assigneeId,
        priority: crmTask.priority,
        status: crmTask.status,
        dueAt: crmTask.dueAt,
        completedAt: crmTask.completedAt,
        completedBy: crmTask.completedBy,
        cancelledAt: crmTask.cancelledAt,
        cancelledBy: crmTask.cancelledBy,
        createdBy: crmTask.createdBy,
        metadata: crmTask.metadata,
        createdAt: crmTask.createdAt,
        updatedAt: crmTask.updatedAt,
        contactName: crmContact.name,
        assigneeName: assigneeUser.displayName,
        creatorName: creatorUser.displayName,
      })
      .from(crmTask)
      .innerJoin(crmContact, eq(crmContact.id, crmTask.contactId))
      .leftJoin(assigneeUser, eq(assigneeUser.id, crmTask.assigneeId))
      .leftJoin(creatorUser, eq(creatorUser.id, crmTask.createdBy))
      .where(whereClause)
      .orderBy(desc(crmTask.createdAt))
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
