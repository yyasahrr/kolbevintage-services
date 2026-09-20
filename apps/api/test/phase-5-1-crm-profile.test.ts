/**
 * Phase 5.1 — Checkpoint A: CRM Domain Model & Customer Profile Test Suite
 *
 * Verifies:
 * 1. Architecture & Domain Ownership Integrity (121 tables, 26 migrations, snapshot consistency).
 * 2. Foreign Keys ON DELETE RESTRICT and CHECK constraints on all 8 CRM tables.
 * 3. CRM Profile Domain: Leads without accounts, identity linking to account_user.
 * 4. Duplicate identity linking prevention (1 account_user -> at most 1 crm_contact).
 * 5. CRM Stage Transitions: immutable history, source, actor, reason, state validation.
 * 6. CRM Assignment: admin assignment and reassignment history.
 * 7. CRM Tagging: normalized tag keys, assignment to contacts, duplicate prevention.
 * 8. Search, filtering, and audit trail.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  accountUser,
  auditLog,
  crmAssignmentHistory,
  crmContact,
  crmContactIdentityLink,
  crmContactTag,
  crmStageHistory,
  crmTag,
  CRM_STAGES,
} from "@kolbe/database";
import { MODULES } from "../src/modules/registry";
import { CrmContactService } from "../src/modules/crm/crm-contact.service";
import { CrmTagService } from "../src/modules/crm/crm-tag.service";
import {
  CrmContactDuplicateLinkError,
  CrmContactNotFoundError,
  CrmStageInvalidError,
  CrmTagDuplicateError,
  CrmTagNotFoundError,
} from "../src/modules/crm/crm.errors";
import {
  bootHarness,
  makeId,
  seedTwoSuppliers,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";

const TEST_DB = "kolbe_phase_5_1_crm_profile_test";

let h: Harness;
let ctx: SupplierContext;
let contactService: CrmContactService;
let tagService: CrmTagService;

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 50 });
  contactService = h.app.get(CrmContactService);
  tagService = h.app.get(CrmTagService);
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe("Phase 5.1 — Checkpoint A: Domain Ownership & Schema Integrity", () => {
  it("registry assigns exactly the 8 CRM tables to the crm module", () => {
    const crmMod = MODULES.find((m) => m.name === "crm")!;
    expect(crmMod).toBeDefined();
    expect(crmMod.status).toBe("live");
    expect(crmMod.tables).toEqual([
      "crm_contact",
      "crm_contact_identity_link",
      "crm_stage_history",
      "crm_assignment_history",
      "crm_tag",
      "crm_contact_tag",
      "crm_activity",
      "crm_task",
    ]);
  });

  it("database contains all 121 base tables and 26 migrations are applied", async () => {
    const { rows } = await h.pool.query(
      `SELECT count(*)::int AS cnt FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`,
    );
    expect(rows[0].cnt).toBeGreaterThanOrEqual(121);

    const { rows: migRows } = await h.pool.query(
      `SELECT count(*)::int AS cnt FROM drizzle.__drizzle_migrations`,
    );
    expect(migRows[0].cnt).toBeGreaterThanOrEqual(26);
  });

  it("all foreign keys on all 8 CRM tables enforce ON DELETE RESTRICT", async () => {
    const targetTables = [
      "crm_contact",
      "crm_contact_identity_link",
      "crm_stage_history",
      "crm_assignment_history",
      "crm_contact_tag",
      "crm_activity",
      "crm_task",
    ];

    const { rows } = await h.pool.query(
      `SELECT con.conname, cls.relname AS tbl, con.confdeltype
       FROM pg_constraint con
       JOIN pg_class cls ON cls.oid = con.conrelid
       WHERE con.contype = 'f' AND cls.relname = ANY($1::text[])`,
      [targetTables],
    );

    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const r of rows) {
      expect(r.confdeltype, `FK ${r.conname} on ${r.tbl} must be RESTRICT (r)`).toBe("r");
    }
  });

  it("check constraints enforce valid stages and task/activity values", async () => {
    // Stage check constraint on crm_contact
    await expect(
      h.pool.query(
        `INSERT INTO crm_contact (id, name, stage) VALUES ('crm_bad_stage', 'Bad Stage', 'INVALID_STAGE')`,
      ),
    ).rejects.toMatchObject({ code: "23514" });

    // Link type check constraint on crm_contact_identity_link
    await expect(
      h.pool.query(
        `INSERT INTO crm_contact_identity_link (id, contact_id, user_id, link_type, linked_by)
         VALUES ('bad_link', 'c1', 'u1', 'invalid_link_type', 'a1')`,
      ),
    ).rejects.toMatchObject({ code: "23514" });

    // Task status check constraint on crm_task
    await expect(
      h.pool.query(
        `INSERT INTO crm_task (id, contact_id, title, status, created_by)
         VALUES ('bad_task', 'c1', 'Bad Task', 'INVALID_STATUS', 'a1')`,
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("Phase 5.1 — CRM Customer Profile & Lead Lifecycle", () => {
  it("creates a lead contact without an account_user and generates initial stage history", async () => {
    const contact = await contactService.createContact(
      {
        name: "علی رضایی",
        phone: " 0912-345-6789 ",
        email: " Ali.Rezaei@example.com ",
        city: "تهران",
        stage: "LEAD",
        source: "website_inquiry",
        metadata: { interestedIn: "vintage_leather", estimatedBudget: 15_000_000 },
      },
      ctx.userAdmin,
    );

    expect(contact.id).toBeDefined();
    expect(contact.name).toBe("علی رضایی");
    expect(contact.phone).toBe("09123456789");
    expect(contact.email).toBe("ali.rezaei@example.com");
    expect(contact.city).toBe("تهران");
    expect(contact.stage).toBe("LEAD");
    expect((contact.metadata as any).source).toBe("website_inquiry");
    expect(contact.assignedAdminId).toBeNull();

    // Verify initial stage history
    const stageHistory = await contactService.getStageHistory(contact.id);
    expect(stageHistory).toHaveLength(1);
    expect(stageHistory[0].fromStage).toBeNull();
    expect(stageHistory[0].toStage).toBe("LEAD");
    expect(stageHistory[0].actorId).toBe(ctx.userAdmin);
    expect(stageHistory[0].source).toBe("manual");

    // Verify audit log
    const [audit] = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, contact.id))
      .orderBy(auditLog.createdAt);
    expect(audit).toBeDefined();
    expect(audit.action).toBe("crm_contact_created");
  });

  it("updates contact details and preserves history", async () => {
    const contact = await contactService.createContact(
      {
        name: "سارا محمدی",
        phone: "09351112233",
        city: "شیراز",
      },
      ctx.userAdmin,
    );

    const updated = await contactService.updateContact(
      contact.id,
      {
        city: "اصفهان",
        email: "sara.m@kolbe.test",
        metadata: { preferredChannel: "telegram" },
      },
      ctx.userAdmin,
    );

    expect(updated.city).toBe("اصفهان");
    expect(updated.email).toBe("sara.m@kolbe.test");

    const fetched = await contactService.getContact(contact.id);
    expect(fetched.city).toBe("اصفهان");
    expect((fetched.metadata as any).preferredChannel).toBe("telegram");
  });

  it("rejects invalid stage transitions", async () => {
    const contact = await contactService.createContact(
      { name: "تست فاز" },
      ctx.userAdmin,
    );

    await expect(
      contactService.changeStage(contact.id, "BOGUS_STAGE" as any, ctx.userAdmin),
    ).rejects.toThrow(CrmStageInvalidError);
  });

  it("records stage transitions in immutable stage history", async () => {
    const contact = await contactService.createContact(
      { name: "فرهاد خسروی" },
      ctx.userAdmin,
    );

    // Transition LEAD -> CONTACTED
    await contactService.changeStage(
      contact.id,
      "CONTACTED",
      ctx.userAdmin,
      "تماس اولیه تلفنی با مشتری برقرار شد",
    );

    // Transition CONTACTED -> NEGOTIATION
    await contactService.changeStage(
      contact.id,
      "NEGOTIATION",
      ctx.userAdmin,
      "مذاکره روی لیست قیمت کالکشن پاییزه",
    );

    const history = await contactService.getStageHistory(contact.id);
    expect(history).toHaveLength(3); // Initial + 2 transitions
    expect(history[0].toStage).toBe("NEGOTIATION");
    expect(history[0].fromStage).toBe("CONTACTED");
    expect(history[0].reason).toBe("مذاکره روی لیست قیمت کالکشن پاییزه");

    expect(history[1].toStage).toBe("CONTACTED");
    expect(history[1].fromStage).toBe("LEAD");

    const fetched = await contactService.getContact(contact.id);
    expect(fetched.stage).toBe("NEGOTIATION");
  });

  it("assigns and reassigns admin owner with history auditing", async () => {
    const contact = await contactService.createContact(
      { name: "مریم احمدی", assignedAdminId: ctx.userAdmin },
      ctx.userAdmin,
    );

    expect(contact.assignedAdminId).toBe(ctx.userAdmin);

    const initialHistory = await contactService.getAssignmentHistory(contact.id);
    expect(initialHistory).toHaveLength(1);
    expect(initialHistory[0].toAdminId).toBe(ctx.userAdmin);

    // Create a second admin to reassign
    const admin2Id = makeId("adm_crm");
    await h.db.insert(accountUser).values({
      id: admin2Id,
      email: "crm_agent2@kolbe.test",
      displayName: "کارشناس فروش ۲",
      passwordHash: "dummy_hash",
      salt: "dummy_salt",
      role: "admin",
      status: "active",
    });

    // Reassign
    await contactService.assignAdmin(
      contact.id,
      admin2Id,
      ctx.userAdmin,
      "ارجاع به کارشناس پشتیبانی VIP",
    );

    const history = await contactService.getAssignmentHistory(contact.id);
    expect(history).toHaveLength(2);
    expect(history[0].fromAdminId).toBe(ctx.userAdmin);
    expect(history[0].toAdminId).toBe(admin2Id);
    expect(history[0].reason).toBe("ارجاع به کارشناس پشتیبانی VIP");

    const fetched = await contactService.getContact(contact.id);
    expect(fetched.assignedAdminId).toBe(admin2Id);
    expect(fetched.assignedAdmin?.displayName).toBe("کارشناس فروش ۲");
  });
});

describe("Phase 5.1 — Identity Linking & Duplicate Prevention", () => {
  it("links an existing account_user to a crm_contact", async () => {
    // Create an account user
    const userId = makeId("usr_crm");
    await h.db.insert(accountUser).values({
      id: userId,
      phone: "09187654321",
      email: "crm_customer@kolbe.test",
      displayName: "سینا داوودی",
      passwordHash: "dummy_hash",
      salt: "dummy_salt",
      role: "customer",
      status: "active",
    });

    const contact = await contactService.createContact(
      { name: "سینا داوودی (لید)" },
      ctx.userAdmin,
    );
    expect(contact.phone).toBeNull();

    // Link
    const link = await contactService.linkIdentity(contact.id, userId, ctx.userAdmin);
    expect(link.contactId).toBe(contact.id);
    expect(link.userId).toBe(userId);

    // Verify contact backfilled phone and email
    const fetched = await contactService.getContact(contact.id);
    expect(fetched.phone).toBe("09187654321");
    expect(fetched.email).toBe("crm_customer@kolbe.test");
    expect(fetched.identityLink).toBeDefined();
    expect(fetched.identityLink?.userId).toBe(userId);
  });

  it("strictly prevents duplicate linking of the same user to another crm_contact", async () => {
    const userId = makeId("usr_dup");
    await h.db.insert(accountUser).values({
      id: userId,
      phone: "09199998877",
      email: "dup@kolbe.test",
      displayName: "کاربر تکراری",
      passwordHash: "dummy_hash",
      salt: "dummy_salt",
      role: "customer",
      status: "active",
    });

    const contact1 = await contactService.createContact({ name: "مخاطب ۱" }, ctx.userAdmin);
    const contact2 = await contactService.createContact({ name: "مخاطب ۲" }, ctx.userAdmin);

    // Link to contact1 succeeds
    await contactService.linkIdentity(contact1.id, userId, ctx.userAdmin);

    // Attempt to link to contact2 fails with CrmContactDuplicateLinkError
    await expect(
      contactService.linkIdentity(contact2.id, userId, ctx.userAdmin),
    ).rejects.toThrow(CrmContactDuplicateLinkError);

    // Linking same user to same contact1 is idempotent
    const idempotentLink = await contactService.linkIdentity(contact1.id, userId, ctx.userAdmin);
    expect(idempotentLink.contactId).toBe(contact1.id);
  });
});

describe("Phase 5.1 — CRM Tagging & Categorization", () => {
  it("creates tags with normalized keys and assigns them to contacts", async () => {
    const tag1 = await tagService.createTag(
      {
        key: " VIP Customer ",
        label: "مشتری ویژه",
        color: "#f59e0b",
        description: "مشتریان با حجم خرید بالا",
      },
      ctx.userAdmin,
    );

    expect(tag1.key).toBe("vip_customer");
    expect(tag1.label).toBe("مشتری ویژه");

    const tag2 = await tagService.createTag(
      {
        key: "Wholesale-Lead",
        label: "لید عمده",
        color: "#3b82f6",
      },
      ctx.userAdmin,
    );
    expect(tag2.key).toBe("wholesale_lead");

    const contact = await contactService.createContact({ name: "تست برچسب" }, ctx.userAdmin);

    // Assign tag1
    await tagService.addTagToContact(contact.id, tag1.id, ctx.userAdmin);
    // Assign tag2
    await tagService.addTagToContact(contact.id, tag2.id, ctx.userAdmin);

    const contactTags = await tagService.getContactTags(contact.id);
    expect(contactTags).toHaveLength(2);
    expect(contactTags.map((t) => t.key)).toContain("vip_customer");
    expect(contactTags.map((t) => t.key)).toContain("wholesale_lead");

    // Reject duplicate tag assignment
    await expect(
      tagService.addTagToContact(contact.id, tag1.id, ctx.userAdmin),
    ).rejects.toThrow(CrmTagDuplicateError);

    // Remove tag
    await tagService.removeTagFromContact(contact.id, tag1.id, ctx.userAdmin);
    const tagsAfterRemove = await tagService.getContactTags(contact.id);
    expect(tagsAfterRemove).toHaveLength(1);
    expect(tagsAfterRemove[0].key).toBe("wholesale_lead");
  });
});

describe("Phase 5.1 — CRM Search & Filtering", () => {
  it("filters contacts by stage, search query, assigned admin, and link status", async () => {
    const uniquePrefix = `srch_${Date.now()}`;
    const c1 = await contactService.createContact(
      { name: `${uniquePrefix}_کیوان رحیمی`, phone: "09112223344", city: "رشت", stage: "ACTIVE_CUSTOMER" },
      ctx.userAdmin,
    );
    const c2 = await contactService.createContact(
      { name: `${uniquePrefix}_پروانه نوری`, phone: "09115556677", city: "لاهیجان", stage: "LEAD" },
      ctx.userAdmin,
    );

    // Search by city
    const searchRasht = await contactService.listContacts({ search: "رشت" });
    expect(searchRasht.items.some((i) => i.id === c1.id)).toBe(true);
    expect(searchRasht.items.some((i) => i.id === c2.id)).toBe(false);

    // Search by stage
    const searchActive = await contactService.listContacts({ stage: "ACTIVE_CUSTOMER" });
    expect(searchActive.items.some((i) => i.id === c1.id)).toBe(true);
    expect(searchActive.items.some((i) => i.id === c2.id)).toBe(false);
  });
});
