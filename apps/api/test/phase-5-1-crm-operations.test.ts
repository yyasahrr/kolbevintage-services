/**
 * Phase 5.1 — Checkpoint D: CRM Pipeline, Search & Customer Operations Test Suite
 *
 * Verifies:
 * 1. Pipeline Stage Aggregations (factual counts, assigned/unassigned, conversion rate).
 * 2. Parameterized deterministic search & deduplication signals.
 * 3. Cross-entity duplicate detection (crm_contact and account_user).
 * 4. Granular CRM Admin Permissions via AdminPermissionGuard.
 * 5. Controlled CSV export with formula injection protection and UTF-8 BOM.
 */

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  accountUser,
  adminRole,
  adminRolePermission,
  adminUserRole,
} from "@kolbe/database";
import { CrmContactService } from "../src/modules/crm/crm-contact.service";
import { CrmOperationsService } from "../src/modules/crm/crm-operations.service";
import {
  bootHarness,
  makeId,
  seedTwoSuppliers,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";

const TEST_DB = "kolbe_phase_5_1_crm_operations_test";

let h: Harness;
let ctx: SupplierContext;
let contactService: CrmContactService;
let operationsService: CrmOperationsService;

let adminExporterId: string;
let adminViewerOnlyId: string;

const cookie = (userId: string, role = "admin") => `kolbe_session=${h.issueToken(userId, role)}`;
const api = () => request(h.app.getHttpServer());

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 50 });
  contactService = h.app.get(CrmContactService);
  operationsService = h.app.get(CrmOperationsService);

  // Setup admin users
  adminExporterId = makeId("adm_exporter");
  await h.db.insert(accountUser).values({
    id: adminExporterId,
    email: "crm_exporter@kolbe.test",
    displayName: "کارشناس خروجی CRM",
    passwordHash: "h",
    salt: "s",
    role: "admin",
    status: "active",
  });

  adminViewerOnlyId = makeId("adm_viewer_only");
  await h.db.insert(accountUser).values({
    id: adminViewerOnlyId,
    email: "crm_viewer_only@kolbe.test",
    displayName: "مشاهده‌گر عادی CRM",
    passwordHash: "h",
    salt: "s",
    role: "admin",
    status: "active",
  });

  // Assign crm:customer:view AND crm:export to adminExporterId
  const exporterRoleId = makeId("role_exp");
  await h.db.insert(adminRole).values({
    id: exporterRoleId,
    name: "crm_exporter_role",
    displayName: "نقش خروجی CRM",
  });

  await h.db.insert(adminRolePermission).values([
    {
      id: makeId("arp_v"),
      roleId: exporterRoleId,
      action: "crm:customer:view",
      assignedBy: ctx.userAdmin,
    },
    {
      id: makeId("arp_e"),
      roleId: exporterRoleId,
      action: "crm:export",
      assignedBy: ctx.userAdmin,
    },
  ]);

  await h.db.insert(adminUserRole).values({
    id: makeId("aur_exp"),
    userId: adminExporterId,
    roleId: exporterRoleId,
    assignedBy: ctx.userAdmin,
  });

  // Assign ONLY crm:customer:view to adminViewerOnlyId
  const viewerRoleId = makeId("role_vwr");
  await h.db.insert(adminRole).values({
    id: viewerRoleId,
    name: "crm_viewer_only_role",
    displayName: "نقش فقط مشاهده CRM",
  });

  await h.db.insert(adminRolePermission).values({
    id: makeId("arp_v2"),
    roleId: viewerRoleId,
    action: "crm:customer:view",
    assignedBy: ctx.userAdmin,
  });

  await h.db.insert(adminUserRole).values({
    id: makeId("aur_vwr"),
    userId: adminViewerOnlyId,
    roleId: viewerRoleId,
    assignedBy: ctx.userAdmin,
  });
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe("Phase 5.1 — Checkpoint D: CRM Pipeline Metrics", () => {
  it("computes pipeline stage aggregations without synthetic data", async () => {
    // Seed contacts in different stages
    await contactService.createContact({ name: "لید ۱", stage: "LEAD" }, ctx.userAdmin);
    await contactService.createContact({ name: "لید ۲", stage: "LEAD", assignedAdminId: ctx.userAdmin }, ctx.userAdmin);
    await contactService.createContact({ name: "مشتری در مذاکره", stage: "NEGOTIATION", assignedAdminId: ctx.userAdmin }, ctx.userAdmin);
    await contactService.createContact({ name: "مشتری فعال ۱", stage: "ACTIVE_CUSTOMER", assignedAdminId: ctx.userAdmin }, ctx.userAdmin);
    await contactService.createContact({ name: "مشتری وفادار", stage: "LOYAL" }, ctx.userAdmin);

    const metrics = await operationsService.getPipelineMetrics();

    expect(metrics.stages).toHaveLength(6);

    const leadStage = metrics.stages.find((s) => s.stage === "LEAD");
    expect(leadStage).toBeDefined();
    expect(leadStage!.count).toBeGreaterThanOrEqual(2);
    expect(leadStage!.assignedCount).toBeGreaterThanOrEqual(1);
    expect(leadStage!.unassignedCount).toBeGreaterThanOrEqual(1);

    const activeStage = metrics.stages.find((s) => s.stage === "ACTIVE_CUSTOMER");
    expect(activeStage).toBeDefined();
    expect(activeStage!.count).toBeGreaterThanOrEqual(1);

    expect(metrics.summary.totalContacts).toBeGreaterThanOrEqual(5);
    expect(metrics.summary.activeCustomerCount).toBeGreaterThanOrEqual(2);
    expect(metrics.summary.conversionRatePct).toBeGreaterThan(0);
  });

  it("filters pipeline metrics by assigned admin", async () => {
    const metrics = await operationsService.getPipelineMetrics(ctx.userAdmin);
    expect(metrics.summary.totalUnassigned).toBe(0);
    expect(metrics.summary.totalAssigned).toBe(metrics.summary.totalContacts);
  });
});

describe("Phase 5.1 — Checkpoint D: Deduplication Signals & Deterministic Search", () => {
  it("detects duplicate contacts by phone, email, and name across contacts and registered users", async () => {
    const uniquePhone = "09361112299";
    const uniqueEmail = "dup_check@kolbe.test";

    // 1. Create a contact with phone and email
    const c1 = await contactService.createContact(
      {
        name: "حمید کاشانی",
        phone: uniquePhone,
        email: uniqueEmail,
        city: "تهران",
      },
      ctx.userAdmin,
    );

    // 2. Check duplicates for identical phone
    const checkPhone = await operationsService.checkDuplicates({ phone: " 0936-111-2299 " });
    expect(checkPhone.hasDuplicate).toBe(true);
    expect(checkPhone.signals.byPhone).toBe(true);
    expect(checkPhone.signals.byEmail).toBe(false);
    expect(checkPhone.matchingContacts.some((c) => c.id === c1.id)).toBe(true);

    // 3. Check duplicates for identical email
    const checkEmail = await operationsService.checkDuplicates({ email: " DUP_CHECK@kolbe.test " });
    expect(checkEmail.hasDuplicate).toBe(true);
    expect(checkEmail.signals.byEmail).toBe(true);
    expect(checkEmail.matchingContacts.some((c) => c.id === c1.id)).toBe(true);

    // 4. Check duplicates excluding own contact ID
    const checkSelfExclude = await operationsService.checkDuplicates({
      phone: uniquePhone,
      excludeContactId: c1.id,
    });
    expect(checkSelfExclude.signals.byPhone).toBe(false);

    // 5. Cross-check registered account_user duplicates
    const registeredPhone = "09998887766";
    const regUserId = makeId("usr_reg");
    await h.db.insert(accountUser).values({
      id: regUserId,
      email: "registered_user@kolbe.test",
      displayName: "کاربر ثبت‌نامی فروشگاه",
      phone: registeredPhone,
      passwordHash: "h",
      salt: "s",
      role: "customer",
      status: "active",
    });

    const checkUserPhone = await operationsService.checkDuplicates({ phone: registeredPhone });
    expect(checkUserPhone.hasDuplicate).toBe(true);
    expect(checkUserPhone.signals.byPhone).toBe(true);
    expect(checkUserPhone.matchingUsers.some((u) => u.id === regUserId)).toBe(true);
  });
});

describe("Phase 5.1 — Checkpoint D: Controlled CSV Export & Formula Injection Defense", () => {
  it("sanitizes dangerous spreadsheet formula characters in CSV export", () => {
    // Potential formula injection attacks
    const maliciousFormula1 = "=cmd|' /C calc'!A0";
    const maliciousFormula2 = "+12345";
    const maliciousFormula3 = "-2+3*[4]";
    const maliciousFormula4 = "@SUM(A1:A10)";
    const maliciousFormula5 = "%0Acalc";

    // All must be prepended with a single quote '
    expect(operationsService.sanitizeCsvCell(maliciousFormula1)).toBe(`"'=cmd|' /C calc'!A0"`);
    expect(operationsService.sanitizeCsvCell(maliciousFormula2)).toBe(`"'+12345"`);
    expect(operationsService.sanitizeCsvCell(maliciousFormula3)).toBe(`"'-2+3*[4]"`);
    expect(operationsService.sanitizeCsvCell(maliciousFormula4)).toBe(`"'@SUM(A1:A10)"`);
    expect(operationsService.sanitizeCsvCell(maliciousFormula5)).toBe(`"'%0Acalc"`);

    // Standard safe values
    expect(operationsService.sanitizeCsvCell("علی رضایی")).toBe(`"علی رضایی"`);
    expect(operationsService.sanitizeCsvCell('فروشگاه "کلبه"')).toBe(`"فروشگاه ""کلبه"""`);
    expect(operationsService.sanitizeCsvCell(null)).toBe('""');
  });

  it("exports contacts to CSV with UTF-8 BOM prefix", async () => {
    const csv = await operationsService.exportContactsCsv();
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("شناسه");
    expect(csv).toContain("نام مخاطب");
    expect(csv).toContain("شماره تلفن");
  });
});

describe("Phase 5.1 — Checkpoint D: HTTP Endpoints & Permission Enforcement", () => {
  it("restricts export endpoint to users with crm:export permission", async () => {
    // 1. Viewer-only admin lacks crm:export -> 403
    await api()
      .get("/api/v1/admin/crm/export")
      .set("Cookie", cookie(adminViewerOnlyId, "admin"))
      .expect(403);

    // 2. Exporter admin has crm:export -> 200 with text/csv
    const res = await api()
      .get("/api/v1/admin/crm/export")
      .set("Cookie", cookie(adminExporterId, "admin"))
      .expect(200);

    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment; filename=");
    expect(res.text).toContain("شناسه");
  });

  it("permits pipeline overview and deduplication check for crm:customer:view", async () => {
    // Pipeline endpoint
    const pipeRes = await api()
      .get("/api/v1/admin/crm/pipeline")
      .set("Cookie", cookie(adminViewerOnlyId, "admin"))
      .expect(200);

    expect(pipeRes.body.stages).toBeDefined();
    expect(Array.isArray(pipeRes.body.stages)).toBe(true);

    // Dedup check endpoint
    const dedupRes = await api()
      .get("/api/v1/admin/crm/dedup-check?phone=09121112233")
      .set("Cookie", cookie(adminViewerOnlyId, "admin"))
      .expect(200);

    expect(dedupRes.body.signals).toBeDefined();
    expect(typeof dedupRes.body.hasDuplicate).toBe("boolean");
  });
});
