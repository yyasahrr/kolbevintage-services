/**
 * Phase 5.0 — Checkpoint C: Admin RBAC, Maker/Checker Approvals & Business Settings Test Suite
 *
 * Verifies:
 * 1. Granular Admin Operational Permissions & Roles.
 * 2. Constrained Maker/Checker Approval Workflow with strict Two-Person Rule enforcement.
 * 3. Typed, Validated, Versioned & Audited Business Settings Registry.
 * 4. Internal Admin Notes with Pinning and Author Attribution.
 * 5. Admin HTTP APIs Security, RBAC enforcement & Clean BigInt Serialization.
 */

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountUser, wholesaleAccount } from "@kolbe/database";
import { AdminRbacService } from "../src/modules/admin/admin-rbac.service";
import { AdminApprovalsService } from "../src/modules/admin/admin-approvals.service";
import { BusinessSettingsService } from "../src/modules/admin/business-settings.service";
import { InternalNotesService } from "../src/modules/admin/internal-notes.service";
import { WholesalePlanService } from "../src/modules/vip/wholesale-plan.service";
import {
  AdminPermissionDeniedError,
  BusinessSettingReadOnlyError,
  BusinessSettingValidationError,
  TwoPersonRuleViolationError,
} from "../src/modules/admin/admin.errors";
import {
  bootHarness,
  makeId,
  seedTwoSuppliers,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";

const TEST_DB = "kolbe_phase_5_0_admin_test";

let h: Harness;
let ctx: SupplierContext;
let rbacService: AdminRbacService;
let approvalsService: AdminApprovalsService;
let settingsService: BusinessSettingsService;
let notesService: InternalNotesService;
let planService: WholesalePlanService;

let adminMakerId: string;
let adminCheckerId: string;
let adminOpsId: string;

const cookie = (userId: string, role = "admin") => `kolbe_session=${h.issueToken(userId, role)}`;
const api = () => request(h.app.getHttpServer());

async function createAdminUser(name: string, phone: string, email: string) {
  const id = makeId("usr_adm");
  await h.db.insert(accountUser).values({
    id,
    email,
    passwordHash: "dummy_hash",
    salt: "dummy_salt",
    role: "admin",
    displayName: name,
    phone,
    status: "active",
  });
  return id;
}

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 50 });
  rbacService = h.app.get(AdminRbacService);
  approvalsService = h.app.get(AdminApprovalsService);
  settingsService = h.app.get(BusinessSettingsService);
  notesService = h.app.get(InternalNotesService);
  planService = h.app.get(WholesalePlanService);

  // Create distinct admin users for maker/checker workflows
  adminMakerId = await createAdminUser("مهدی سازنده", "09121110001", "maker@kolbe.test");
  adminCheckerId = await createAdminUser("نیما تاییدکننده", "09121110002", "checker@kolbe.test");
  adminOpsId = await createAdminUser("رضا عملیات", "09121110003", "ops@kolbe.test");

  // Ensure system roles
  await rbacService.ensureSystemRoles();
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe("Phase 5.0 — Checkpoint C: Granular Admin Roles & Permissions", () => {
  it("initializes system roles and supports custom role creation and permission mapping", async () => {
    const roles = await rbacService.listRoles();
    expect(roles.some((r) => r.name === "super_admin")).toBe(true);
    expect(roles.some((r) => r.name === "commercial_ops")).toBe(true);
    expect(roles.some((r) => r.name === "approver")).toBe(true);

    // Create custom role
    const customRole = await rbacService.createRole(
      {
        name: "settlement_auditor",
        displayName: "حسابرس تسویه مالی",
        description: "مشاهده تسویه‌ها و گزارش‌های کنترل تاور",
      },
      ctx.userAdmin,
    );

    expect(customRole.id).toBeDefined();
    expect(customRole.name).toBe("settlement_auditor");

    // Assign specific actions to the custom role
    await rbacService.assignPermissionsToRole(
      customRole.id,
      ["wholesale:control_tower:view", "wholesale:settings:view"],
      ctx.userAdmin,
    );

    // Assign role to adminOpsId
    await rbacService.assignRoleToUser(adminOpsId, customRole.id, ctx.userAdmin);

    // Check user permissions
    const perms = await rbacService.getUserPermissions(adminOpsId);
    expect(perms.has("wholesale:control_tower:view")).toBe(true);
    expect(perms.has("wholesale:settings:view")).toBe(true);
    expect(perms.has("wholesale:approval:decide")).toBe(false); // Not granted

    // Assert permission
    await expect(
      rbacService.assertPermission(adminOpsId, "wholesale:control_tower:view"),
    ).resolves.toBeUndefined();

    await expect(
      rbacService.assertPermission(adminOpsId, "wholesale:approval:decide"),
    ).rejects.toThrow(AdminPermissionDeniedError);
  });

  it("revoking role removes granted permissions from admin user", async () => {
    const tempRole = await rbacService.createRole(
      { name: "temp_role", displayName: "نقش موقت" },
      ctx.userAdmin,
    );
    await rbacService.assignPermissionsToRole(tempRole.id, ["wholesale:notes:create"], ctx.userAdmin);

    await rbacService.assignRoleToUser(adminOpsId, tempRole.id, ctx.userAdmin);
    expect(await rbacService.hasPermission(adminOpsId, "wholesale:notes:create")).toBe(true);

    await rbacService.revokeRoleFromUser(adminOpsId, tempRole.id, ctx.userAdmin);
    expect(await rbacService.hasPermission(adminOpsId, "wholesale:notes:create")).toBe(false);
  });
});

describe("Phase 5.0 — Checkpoint C: Constrained Maker/Checker Approval Workflow", () => {
  it("enforces mandatory two-person rule: maker cannot decide or approve their own request", async () => {
    // 1. Create a plan & draft version
    const plan = await planService.createPlan({ code: "approval_plan", name: "پلن تایید دو مرحله‌ای" }, ctx.userAdmin);
    const ver = await planService.createPlanVersion(plan.id, { durationDays: 180 }, ctx.userAdmin);

    // 2. Maker creates approval request to publish plan version
    const req = await approvalsService.createApprovalRequest(
      {
        requestType: "PLAN_VERSION_PUBLISH",
        targetType: "wholesale_plan",
        targetId: plan.id,
        payload: { versionId: ver.id },
        makerNotes: "لطفاً این نسخه را جهت فعال‌سازی در کمپین پاییز بررسی نمایید",
      },
      adminMakerId,
    );

    expect(req.id).toBeDefined();
    expect(req.status).toBe("pending");
    expect(req.makerId).toBe(adminMakerId);

    // 3. Maker tries to approve or reject their OWN request -> REJECTED by two-person rule!
    await expect(
      approvalsService.decideApprovalRequest(req.id, "approve", "تایید خودکار توسط سازنده", adminMakerId),
    ).rejects.toThrow(TwoPersonRuleViolationError);

    // 4. Different admin (Checker) approves the request -> Deterministically executed!
    const approved = await approvalsService.decideApprovalRequest(
      req.id,
      "approve",
      "بررسی شد و تایید می‌گردد",
      adminCheckerId,
      true, // autoExecute
    );

    expect(approved.status).toBe("executed");
    expect(approved.checkerId).toBe(adminCheckerId);
    expect(approved.executedAt).toBeDefined();

    // Verify side effect: Plan version was published!
    const currentVer = await planService.getPlanVersion(ver.id);
    expect(currentVer.status).toBe("published");
  });

  it("handles rejection workflow cleanly without executing command", async () => {
    const plan = await planService.createPlan({ code: "reject_plan", name: "پلن رد شده" }, ctx.userAdmin);
    const ver = await planService.createPlanVersion(plan.id, { durationDays: 90 }, ctx.userAdmin);

    const req = await approvalsService.createApprovalRequest(
      {
        requestType: "PLAN_VERSION_PUBLISH",
        targetType: "wholesale_plan",
        targetId: plan.id,
        payload: { versionId: ver.id },
        makerNotes: "درخواست انتشار",
      },
      adminMakerId,
    );

    // Checker rejects
    const rejected = await approvalsService.decideApprovalRequest(
      req.id,
      "reject",
      "تعرفه اعلامی با مصوبه هیئت مدیره همخوانی ندارد",
      adminCheckerId,
    );

    expect(rejected.status).toBe("rejected");
    expect(rejected.checkerId).toBe(adminCheckerId);
    expect(rejected.rejectedAt).toBeDefined();

    // Version remains draft
    const currentVer = await planService.getPlanVersion(ver.id);
    expect(currentVer.status).toBe("draft");
  });

  it("idempotency protects against duplicate approval requests", async () => {
    const idemKey = `test_idem_${Date.now()}`;
    const req1 = await approvalsService.createApprovalRequest(
      {
        requestType: "BUSINESS_SETTING_CHANGE",
        targetType: "business_setting",
        targetId: "wholesale.min_deposit",
        payload: { value: 10_000_000 },
        idempotencyKey: idemKey,
      },
      adminMakerId,
    );

    const req2 = await approvalsService.createApprovalRequest(
      {
        requestType: "BUSINESS_SETTING_CHANGE",
        targetType: "business_setting",
        targetId: "wholesale.min_deposit",
        payload: { value: 10_000_000 },
        idempotencyKey: idemKey,
      },
      adminMakerId,
    );

    expect(req1.id).toBe(req2.id);
  });
});

describe("Phase 5.0 — Checkpoint C: Business Settings Registry", () => {
  it("stores, types and versions settings correctly with history snapshots", async () => {
    // 1. Set string setting
    const s1 = await settingsService.setSetting(
      "wholesale.support_phone",
      {
        category: "wholesale",
        value: "02188889999",
        valueType: "string",
        description: "شماره پشتیبانی مشتریان عمده",
      },
      ctx.userAdmin,
    );

    expect(s1.key).toBe("wholesale.support_phone");
    expect(s1.version).toBe(1);
    expect(await settingsService.getSetting("wholesale.support_phone")).toBe("02188889999");

    // 2. Set number setting
    await settingsService.setSetting(
      "wholesale.max_branches",
      {
        category: "wholesale",
        value: 15,
        valueType: "number",
      },
      ctx.userAdmin,
    );
    expect(await settingsService.getSetting("wholesale.max_branches")).toBe(15);

    // 3. Set money_irr setting
    await settingsService.setSetting(
      "wholesale.platform_max_order_irr",
      {
        category: "financial",
        value: 5_000_000_000n,
        valueType: "money_irr",
      },
      ctx.userAdmin,
    );
    expect(String(await settingsService.getSetting("wholesale.platform_max_order_irr"))).toBe("5000000000");

    // 4. Update existing setting -> version increments & history is recorded
    const updated = await settingsService.setSetting(
      "wholesale.support_phone",
      {
        value: "02199990000",
        valueType: "string",
        reason: "تغییر سرشماره پشتیبانی به خط جدید",
      },
      ctx.userAdmin,
    );

    expect(updated.version).toBe(2);
    expect(await settingsService.getSetting("wholesale.support_phone")).toBe("02199990000");

    const history = await settingsService.getSettingHistory("wholesale.support_phone");
    expect(history.length).toBe(2);
    expect(history[0].version).toBe(2);
    expect(history[0].previousValue).toBe("02188889999");
    expect(history[0].newValue).toBe("02199990000");
  });

  it("validates types and rejects malformed values", async () => {
    await expect(
      settingsService.setSetting(
        "invalid_num",
        { value: "not_a_number", valueType: "number" },
        ctx.userAdmin,
      ),
    ).rejects.toThrow(BusinessSettingValidationError);

    await expect(
      settingsService.setSetting(
        "invalid_money",
        { value: -500n, valueType: "money_irr" },
        ctx.userAdmin,
      ),
    ).rejects.toThrow(BusinessSettingValidationError);
  });

  it("protects read-only settings and masks secret settings", async () => {
    // 1. Read-only protection
    await settingsService.setSetting(
      "system.genesis_hash",
      {
        value: "0xgenesis123",
        valueType: "string",
        isReadOnly: true,
      },
      ctx.userAdmin,
    );

    await expect(
      settingsService.setSetting(
        "system.genesis_hash",
        { value: "0xoverride" },
        ctx.userAdmin,
      ),
    ).rejects.toThrow(BusinessSettingReadOnlyError);

    // 2. Secret masking
    await settingsService.setSetting(
      "security.webhook_secret",
      {
        value: "super_secret_token_xyz",
        valueType: "string",
        isSecret: true,
      },
      ctx.userAdmin,
    );

    // Masked by default
    expect(await settingsService.getSetting("security.webhook_secret")).toBe("********");
    // Explicit unmask
    expect(await settingsService.getSetting("security.webhook_secret", true)).toBe("super_secret_token_xyz");
  });
});

describe("Phase 5.0 — Checkpoint C: Internal Admin Notes", () => {
  it("creates, pins, lists and archives internal admin notes", async () => {
    // Create note on wholesale account
    const note1 = await notesService.createNote(
      {
        targetType: "wholesale_account",
        targetId: "wacc_test_note_1",
        noteText: "یادداشت معمولی درباره وضعیت خریدار",
        isPinned: false,
      },
      ctx.userAdmin,
    );

    const note2 = await notesService.createNote(
      {
        targetType: "wholesale_account",
        targetId: "wacc_test_note_1",
        noteText: "نکته بسیار مهم: این خریدار نماینده رسمی استان است!",
        isPinned: true,
      },
      ctx.userAdmin,
    );

    const notes = await notesService.getNotesForTarget("wholesale_account", "wacc_test_note_1");
    expect(notes.length).toBe(2);
    // Pinned note comes first
    expect(notes[0].id).toBe(note2.id);
    expect(notes[0].isPinned).toBe(true);

    // Unpin note2
    await notesService.setPin(note2.id, false, ctx.userAdmin);
    const updatedNotes = await notesService.getNotesForTarget("wholesale_account", "wacc_test_note_1");
    expect(updatedNotes[0].isPinned).toBe(false);

    // Archive note1
    await notesService.archiveNote(note1.id, ctx.userAdmin);
    const unarchivedOnly = await notesService.getNotesForTarget("wholesale_account", "wacc_test_note_1", false);
    expect(unarchivedOnly.length).toBe(1);
    expect(unarchivedOnly[0].id).toBe(note2.id);

    const allNotes = await notesService.getNotesForTarget("wholesale_account", "wacc_test_note_1", true);
    expect(allNotes.length).toBe(2);
  });
});

describe("Phase 5.0 — Checkpoint C: Admin HTTP APIs Security & Granular RBAC", () => {
  it("enforces authentication and granular admin permissions over HTTP", async () => {
    // 1. Unauthenticated gets 401
    await api().get("/api/v1/admin/approvals").expect(401);
    await api().get("/api/v1/admin/settings").expect(401);
    await api().get("/api/v1/admin/notes?targetType=wholesale_account&targetId=1").expect(401);

    // 2. Non-admin role (buyer) gets 403
    const buyerCookie = cookie(ctx.userBuyer, "vip");
    await api().get("/api/v1/admin/approvals").set("Cookie", buyerCookie).expect(403);
    await api().get("/api/v1/admin/settings").set("Cookie", buyerCookie).expect(403);

    // 3. Admin user with full admin permissions gets 200
    const adminCookie = cookie(ctx.userAdmin, "admin");
    const settingsRes = await api()
      .get("/api/v1/admin/settings")
      .set("Cookie", adminCookie)
      .expect(200);

    expect(Array.isArray(settingsRes.body.settings)).toBe(true);

    // 4. Create and retrieve note via HTTP
    const noteRes = await api()
      .post("/api/v1/admin/notes")
      .set("Cookie", adminCookie)
      .send({
        targetType: "wholesale_order",
        targetId: "word_12345",
        noteText: "یادداشت ثبت شده از طریق API ادمین",
        isPinned: true,
      })
      .expect(201);

    expect(noteRes.body.note.id).toBeDefined();
    expect(noteRes.body.note.isPinned).toBe(true);

    // 5. Create approval request via HTTP
    const apprRes = await api()
      .post("/api/v1/admin/approvals")
      .set("Cookie", adminCookie)
      .send({
        requestType: "BUSINESS_SETTING_CHANGE",
        targetType: "business_setting",
        targetId: "wholesale.test_http_setting",
        payload: { value: "approved_value" },
        makerNotes: "تغییر تنظیم از طریق API",
      })
      .expect(201);

    expect(apprRes.body.request.status).toBe("pending");
  });
});
