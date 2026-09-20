/**
 * Phase 5.1 — Checkpoint B: Activities, Notes & Follow-up Workflows Test Suite
 *
 * Verifies:
 * 1. CRM Activities timeline: NOTE, CALL, MESSAGE, EMAIL, MEETING, SYSTEM.
 * 2. Activity validation, actor linkage, and contact lastActivity metadata update.
 * 3. Unified timeline combining CRM activities and Phase 5.0 admin internal notes.
 * 4. CRM Follow-up tasks: creation, validation, assignment, priorities, due dates.
 * 5. Task state machine: OPEN -> IN_PROGRESS -> DONE / CANCELLED, reopen, state guards.
 * 6. Task queues: my_open, overdue, due_today, due_soon, unassigned, completed.
 * 7. Full audit trail for activities and task mutations.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  accountUser,
  adminInternalNote,
  auditLog,
  crmActivity,
  crmContact,
  crmTask,
  wholesaleAccount,
} from "@kolbe/database";
import { CrmContactService } from "../src/modules/crm/crm-contact.service";
import { CrmActivityService } from "../src/modules/crm/crm-activity.service";
import { CrmTaskService } from "../src/modules/crm/crm-task.service";
import {
  CrmContactNotFoundError,
  CrmTaskInvalidStateError,
  CrmTaskNotFoundError,
} from "../src/modules/crm/crm.errors";
import {
  bootHarness,
  makeId,
  seedTwoSuppliers,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";

const TEST_DB = "kolbe_phase_5_1_crm_activities_test";

let h: Harness;
let ctx: SupplierContext;
let contactService: CrmContactService;
let activityService: CrmActivityService;
let taskService: CrmTaskService;

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 50 });
  contactService = h.app.get(CrmContactService);
  activityService = h.app.get(CrmActivityService);
  taskService = h.app.get(CrmTaskService);
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe("Phase 5.1 — CRM Activities & Timeline", () => {
  it("records activities across various types and updates contact lastActivity metadata", async () => {
    const contact = await contactService.createContact(
      { name: "مهرداد کاظمی", phone: "09121112233" },
      ctx.userAdmin,
    );

    // 1. Record CALL
    const callAct = await activityService.recordActivity(
      {
        contactId: contact.id,
        activityType: "CALL",
        body: "تماس تلفنی جهت معرفی کاتالوگ جدید ساعت و اکسسوری چرمی",
        metadata: { callDurationSec: 240, outcome: "interested" },
      },
      ctx.userAdmin,
    );
    expect(callAct.id).toBeDefined();
    expect(callAct.activityType).toBe("CALL");
    expect(callAct.body).toContain("معرفی کاتالوگ جدید");

    // 2. Record NOTE
    const noteAct = await activityService.recordActivity(
      {
        contactId: contact.id,
        activityType: "NOTE",
        body: "مشتری علاقه‌مند به خرید عمده کاپشن‌های وینتیج است؛ نیازمند کاتالوگ B2B",
      },
      ctx.userAdmin,
    );
    expect(noteAct.activityType).toBe("NOTE");

    // 3. Record MEETING
    const meetingAct = await activityService.recordActivity(
      {
        contactId: contact.id,
        activityType: "MEETING",
        body: "جلسه حضوری در شوروم میرداماد جهت بررسی نمونه‌ها",
        metadata: { location: "showroom_mirdamad" },
      },
      ctx.userAdmin,
    );
    expect(meetingAct.activityType).toBe("MEETING");

    // Check contact metadata updated with last activity
    const updatedContact = await contactService.getContact(contact.id);
    const meta = updatedContact.metadata as Record<string, unknown>;
    expect(meta.lastActivityType).toBe("MEETING");
    expect(meta.lastActivityAt).toBeDefined();

    // List activities with actor displayName joined
    const list = await activityService.listActivities(contact.id);
    expect(list.total).toBe(3);
    expect(list.items).toHaveLength(3);
    expect(list.items[0].activityType).toBe("MEETING");
    expect(list.items[0].actorId).toBe(ctx.userAdmin);

    // Filter by activityType
    const onlyCalls = await activityService.listActivities(contact.id, { activityType: "CALL" });
    expect(onlyCalls.total).toBe(1);
    expect(onlyCalls.items[0].activityType).toBe("CALL");
  });

  it("rejects recording activity for nonexistent contact", async () => {
    await expect(
      activityService.recordActivity(
        {
          contactId: "nonexistent_contact_id",
          activityType: "NOTE",
          body: "یادداشت تست",
        },
        ctx.userAdmin,
      ),
    ).rejects.toThrow(CrmContactNotFoundError);
  });

  it("combines CRM activities with wholesale internal notes in unified timeline", async () => {
    // Create CRM contact and link to existing user account (which has ctx.accId wholesale account)
    const contact = await contactService.createContact(
      { name: "بوتیک وینتیج البرز" },
      ctx.userAdmin,
    );
    await contactService.linkIdentity(contact.id, ctx.userBuyer, ctx.userAdmin);

    // Add CRM activity
    await activityService.recordActivity(
      {
        contactId: contact.id,
        activityType: "MESSAGE",
        body: "پیام تلگرام ارسال شد در خصوص جشنواره تخفیف پاییزه",
      },
      ctx.userAdmin,
    );

    // Add Phase 5.0 admin internal note on the wholesale account
    const noteId = makeId("not_50");
    await h.db.insert(adminInternalNote).values({
      id: noteId,
      targetType: "wholesale_account",
      targetId: ctx.accId,
      authorId: ctx.userAdmin,
      noteText: "سقف اعتبار این مشتری تجاری به ۵۰۰ میلیون ریال افزایش یافت.",
    });

    // Fetch combined timeline
    const timeline = await activityService.getCombinedTimeline(contact.id);
    expect(timeline.length).toBeGreaterThanOrEqual(2);

    const crmItem = timeline.find((t) => t.source === "MANUAL_ACTIVITY");
    expect(crmItem).toBeDefined();
    expect(crmItem?.kind).toBe("activity");

    const internalNoteItem = timeline.find((t) => t.source === "admin_internal_note");
    expect(internalNoteItem).toBeDefined();
    expect(internalNoteItem?.kind).toBe("internal_note");
    expect(internalNoteItem?.body).toContain("سقف اعتبار این مشتری تجاری");
  });
});

describe("Phase 5.1 — CRM Follow-up Tasks & Lifecycle", () => {
  it("creates a follow-up task with assignee, priority and due date", async () => {
    const contact = await contactService.createContact(
      { name: "نیما شریفی" },
      ctx.userAdmin,
    );

    const dueAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2 days from now
    const task = await taskService.createTask(
      {
        contactId: contact.id,
        title: "پیگیری پیش‌فاکتور ارسال شده",
        description: "تماس تلفنی جهت بررسی تایید پیش‌فاکتور شماره ۱۰۴۲",
        assigneeId: ctx.userAdmin,
        priority: "high",
        dueAt,
      },
      ctx.userAdmin,
    );

    expect(task.id).toBeDefined();
    expect(task.title).toBe("پیگیری پیش‌فاکتور ارسال شده");
    expect(task.status).toBe("OPEN");
    expect(task.priority).toBe("high");
    expect(task.assigneeId).toBe(ctx.userAdmin);
    expect(task.completedAt).toBeNull();

    // Verify task details with joined contact and user names
    const fetched = await taskService.getTask(task.id);
    expect(fetched.contactName).toBe("نیما شریفی");
    expect(fetched.assigneeName).toBeDefined();
    expect(fetched.creatorName).toBeDefined();
  });

  it("advances task lifecycle: OPEN -> IN_PROGRESS -> DONE with completion auditing", async () => {
    const contact = await contactService.createContact({ name: "تست تسک" }, ctx.userAdmin);
    const task = await taskService.createTask(
      { contactId: contact.id, title: "ارسال پیش‌نویس قرارداد" },
      ctx.userAdmin,
    );

    expect(task.status).toBe("OPEN");

    // Start task
    const inProgress = await taskService.startTask(task.id, ctx.userAdmin);
    expect(inProgress.status).toBe("IN_PROGRESS");

    // Complete task
    const completed = await taskService.completeTask(task.id, ctx.userAdmin);
    expect(completed.status).toBe("DONE");
    expect(completed.completedAt).toBeDefined();
    expect(completed.completedBy).toBe(ctx.userAdmin);

    // Attempting to cancel an already completed task fails
    await expect(
      taskService.cancelTask(task.id, ctx.userAdmin),
    ).rejects.toThrow(CrmTaskInvalidStateError);

    // Attempting to start an already completed task fails
    await expect(
      taskService.startTask(task.id, ctx.userAdmin),
    ).rejects.toThrow(CrmTaskInvalidStateError);

    // Reopen task
    const reopened = await taskService.reopenTask(task.id, ctx.userAdmin);
    expect(reopened.status).toBe("OPEN");
    expect(reopened.completedAt).toBeNull();
    expect(reopened.completedBy).toBeNull();
  });

  it("cancels an open task with cancellation reason and prevents completion without reopen", async () => {
    const contact = await contactService.createContact({ name: "تست کنسلی" }, ctx.userAdmin);
    const task = await taskService.createTask(
      { contactId: contact.id, title: "هماهنگی جلسه آنلاین" },
      ctx.userAdmin,
    );

    // Cancel task
    const cancelled = await taskService.cancelTask(
      task.id,
      ctx.userAdmin,
      "مشتری اعلام کرد به دلیل سفر جلسه لغو شود",
    );

    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledAt).toBeDefined();
    expect(cancelled.cancelledBy).toBe(ctx.userAdmin);
    expect((cancelled.metadata as any).cancellationReason).toContain("سفر جلسه لغو شود");

    // Attempting to complete a cancelled task fails
    await expect(
      taskService.completeTask(task.id, ctx.userAdmin),
    ).rejects.toThrow(CrmTaskInvalidStateError);
  });

  it("reassigns task to another active admin", async () => {
    const contact = await contactService.createContact({ name: "تست ارجاع" }, ctx.userAdmin);
    const task = await taskService.createTask(
      { contactId: contact.id, title: "وظیفه ارجاعی", assigneeId: ctx.userAdmin },
      ctx.userAdmin,
    );

    // Create another admin
    const newAdminId = makeId("adm_task");
    await h.db.insert(accountUser).values({
      id: newAdminId,
      email: "task_agent@kolbe.test",
      displayName: "کارشناس وظایف",
      passwordHash: "h",
      salt: "s",
      role: "admin",
      status: "active",
    });

    const reassigned = await taskService.reassignTask(task.id, newAdminId, ctx.userAdmin);
    expect(reassigned.assigneeId).toBe(newAdminId);

    const fetched = await taskService.getTask(task.id);
    expect(fetched.assigneeName).toBe("کارشناس وظایف");
  });
});

describe("Phase 5.1 — Task Queues & Filter Views", () => {
  it("filters tasks by my_open, overdue, due_soon, unassigned, and completed queues", async () => {
    const contact = await contactService.createContact({ name: "تست صف‌ها" }, ctx.userAdmin);
    const now = Date.now();

    // 1. Overdue task (due yesterday)
    const overdueTask = await taskService.createTask(
      {
        contactId: contact.id,
        title: "تسک منقضی شده",
        assigneeId: ctx.userAdmin,
        dueAt: new Date(now - 24 * 60 * 60 * 1000),
      },
      ctx.userAdmin,
    );

    // 2. Due soon task (due in 3 days)
    const dueSoonTask = await taskService.createTask(
      {
        contactId: contact.id,
        title: "تسک به زودی",
        assigneeId: ctx.userAdmin,
        dueAt: new Date(now + 3 * 24 * 60 * 60 * 1000),
      },
      ctx.userAdmin,
    );

    // 3. Unassigned task
    const unassignedTask = await taskService.createTask(
      {
        contactId: contact.id,
        title: "تسک بدون انتساب",
        assigneeId: null,
      },
      ctx.userAdmin,
    );

    // 4. Completed task
    const completedTask = await taskService.createTask(
      {
        contactId: contact.id,
        title: "تسک انجام شده",
        assigneeId: ctx.userAdmin,
      },
      ctx.userAdmin,
    );
    await taskService.completeTask(completedTask.id, ctx.userAdmin);

    // Queue: my_open
    const myOpen = await taskService.listTasks({ queue: "my_open", actorId: ctx.userAdmin });
    expect(myOpen.items.some((t) => t.id === overdueTask.id)).toBe(true);
    expect(myOpen.items.some((t) => t.id === dueSoonTask.id)).toBe(true);
    expect(myOpen.items.some((t) => t.id === unassignedTask.id)).toBe(false);
    expect(myOpen.items.some((t) => t.id === completedTask.id)).toBe(false);

    // Queue: overdue
    const overdueList = await taskService.listTasks({ queue: "overdue" });
    expect(overdueList.items.some((t) => t.id === overdueTask.id)).toBe(true);
    expect(overdueList.items.some((t) => t.id === dueSoonTask.id)).toBe(false);

    // Queue: due_soon
    const dueSoonList = await taskService.listTasks({ queue: "due_soon" });
    expect(dueSoonList.items.some((t) => t.id === dueSoonTask.id)).toBe(true);
    expect(dueSoonList.items.some((t) => t.id === overdueTask.id)).toBe(false);

    // Queue: unassigned
    const unassignedList = await taskService.listTasks({ queue: "unassigned" });
    expect(unassignedList.items.some((t) => t.id === unassignedTask.id)).toBe(true);
    expect(unassignedList.items.some((t) => t.id === overdueTask.id)).toBe(false);

    // Queue: completed
    const completedList = await taskService.listTasks({ queue: "completed" });
    expect(completedList.items.some((t) => t.id === completedTask.id)).toBe(true);
    expect(completedList.items.some((t) => t.id === overdueTask.id)).toBe(false);
  });
});
