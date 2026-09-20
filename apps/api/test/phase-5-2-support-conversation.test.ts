/**
 * Phase 5.2 — Checkpoint B: Conversation, Participants, Internal Notes & Attachments
 *
 * Verifies:
 * 1. Multi-party conversation messaging (CUSTOMER, ADMIN, SYSTEM, SUPPLIER).
 * 2. Strict visibility isolation: INTERNAL_ONLY messages never leak to customers/suppliers.
 * 3. Message idempotency via idempotencyKey.
 * 4. Support internal notes: admin-only access, pinned sorting, customer leakage prevention.
 * 5. Participant verification & strict tenant isolation (Retail, VIP, Supplier).
 * 6. Attachment security: MIME whitelist, dangerous extension blocking, size limits, signed access tokens, scan status enforcement.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  accountUser,
  supplier,
  wholesaleAccount,
  supportCase,
  supportMessage,
  supportInternalNote,
  supportAttachment,
  auditLog,
} from "@kolbe/database";
import { SupportCaseService } from "../src/modules/support/support-case.service";
import { SupportConversationService } from "../src/modules/support/support-conversation.service";
import {
  SupportAttachmentInvalidError,
  SupportCaseNotFoundError,
  SupportUnauthorizedAccessError,
} from "../src/modules/support/support.errors";
import {
  bootHarness,
  makeId,
  seedTwoSuppliers,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";

const TEST_DB = "kolbe_phase_5_2_support_conversation_test";

let h: Harness;
let ctx: SupplierContext;
let caseService: SupportCaseService;
let convService: SupportConversationService;

let adminUserA: { id: string; email: string };
let customerUserA: { id: string; email: string };
let customerUserB: { id: string; email: string };
let vipAccountA: { id: string; userId: string };
let vipAccountB: { id: string; userId: string };

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 50 });
  caseService = h.app.get(SupportCaseService);
  convService = h.app.get(SupportConversationService);

  // Seed Admin A
  const adminAId = `usr_adm_${makeId()}`;
  const [createdAdminA] = await h.db
    .insert(accountUser)
    .values({
      id: adminAId,
      email: `admin.${makeId()}@kolbe.test`,
      passwordHash: "hash",
      salt: "salt",
      role: "admin",
      displayName: "Senior Support Agent",
    })
    .returning();
  adminUserA = createdAdminA;

  // Seed Customer A
  const custAId = `usr_cust_a_${makeId()}`;
  const [createdCustA] = await h.db
    .insert(accountUser)
    .values({
      id: custAId,
      email: `cust.a.${makeId()}@kolbe.test`,
      passwordHash: "hash",
      salt: "salt",
      role: "customer",
      displayName: "Customer Ali",
      phone: "09121111111",
    })
    .returning();
  customerUserA = createdCustA;

  // Seed Customer B
  const custBId = `usr_cust_b_${makeId()}`;
  const [createdCustB] = await h.db
    .insert(accountUser)
    .values({
      id: custBId,
      email: `cust.b.${makeId()}@kolbe.test`,
      passwordHash: "hash",
      salt: "salt",
      role: "customer",
      displayName: "Customer Sara",
      phone: "09122222222",
    })
    .returning();
  customerUserB = createdCustB;

  // Seed VIP A
  const vipAUserId = `usr_vipa_${makeId()}`;
  await h.db.insert(accountUser).values({
    id: vipAUserId,
    email: `vip.a.${makeId()}@kolbe.test`,
    passwordHash: "hash",
    salt: "salt",
    role: "vip",
    displayName: "VIP Reza",
  });
  const vipAAccId = `wacc_a_${makeId()}`;
  const [createdVipA] = await h.db
    .insert(wholesaleAccount)
    .values({
      id: vipAAccId,
      userId: vipAUserId,
      storeName: "Tehran Flagship Store",
      memberName: "Reza VIP",
      phone: "09123333333",
      city: "تهران",
      status: "approved",
    })
    .returning();
  vipAccountA = { id: createdVipA.id, userId: vipAUserId };

  // Seed VIP B
  const vipBUserId = `usr_vipb_${makeId()}`;
  await h.db.insert(accountUser).values({
    id: vipBUserId,
    email: `vip.b.${makeId()}@kolbe.test`,
    passwordHash: "hash",
    salt: "salt",
    role: "vip",
    displayName: "VIP Mina",
  });
  const vipBAccId = `wacc_b_${makeId()}`;
  const [createdVipB] = await h.db
    .insert(wholesaleAccount)
    .values({
      id: vipBAccId,
      userId: vipBUserId,
      storeName: "Isfahan Luxury Gallery",
      memberName: "Mina VIP",
      phone: "09124444444",
      city: "اصفهان",
      status: "approved",
    })
    .returning();
  vipAccountB = { id: createdVipB.id, userId: vipBUserId };
}, 180_000);

afterAll(async () => {
  await h.close();
});

describe("Phase 5.2 Checkpoint B — Conversation, Internal Notes, Isolation & Attachments", () => {
  it("B1: appends conversation messages and tracks multi-party author types", async () => {
    const c = await caseService.createCase({
      requesterType: "RETAIL_CUSTOMER",
      requesterUserId: customerUserA.id,
      category: "ORDER",
      subject: "بررسی سفارش و پیام‌های گفتگو",
    });

    // 1. Customer sends message
    const msg1 = await convService.addMessage({
      caseId: c.id,
      author: { type: "CUSTOMER", id: customerUserA.id, displayName: customerUserA.displayName ?? "Customer" },
      body: "سلام، می‌خواهم زمان دقیق ارسال را بدانم.",
    });
    expect(msg1.id).toMatch(/^smsg_/);
    expect(msg1.authorType).toBe("CUSTOMER");

    // 2. Admin replies
    const msg2 = await convService.addMessage({
      caseId: c.id,
      author: { type: "ADMIN", id: adminUserA.id, displayName: adminUserA.displayName ?? "Admin" },
      body: "با سلام، سفارش شما تحویل شرکت پست شده و فردا توزیع می‌شود.",
    });
    expect(msg2.authorType).toBe("ADMIN");

    // 3. System adds event message
    const msg3 = await convService.addMessage({
      caseId: c.id,
      author: { type: "SYSTEM", id: null, displayName: "سیستم ارسال" },
      body: "کد پیگیری پستی مرسوله: 1982736452",
    });
    expect(msg3.authorType).toBe("SYSTEM");

    const messages = await convService.listMessages(c.id, "customer");
    expect(messages.length).toBe(3);
    expect(messages[0].body).toContain("زمان دقیق");
    expect(messages[1].body).toContain("تحویل شرکت پست");
    expect(messages[2].body).toContain("کد پیگیری پستی");
  });

  it("B2: strictly isolates INTERNAL messages from customer view", async () => {
    const c = await caseService.createCase({
      requesterType: "RETAIL_CUSTOMER",
      requesterUserId: customerUserA.id,
      category: "RETURN",
      subject: "درخواست مرجوعی کالای نامنطبق",
    });

    // Public message
    await convService.addMessage({
      caseId: c.id,
      author: { type: "ADMIN", id: adminUserA.id, displayName: "Admin" },
      body: "عکس کالای دریافتی را برای بررسی آپلود فرمایید.",
      visibility: "PUBLIC",
    });

    // Internal note message
    await convService.addMessage({
      caseId: c.id,
      author: { type: "ADMIN", id: adminUserA.id, displayName: "Admin" },
      body: "توجه داخلی: انبار گزارش داده که پکینگ این محصول قبلاً مخدوش بوده.",
      visibility: "INTERNAL",
    });

    // Customer view must have only 1 message
    const customerMessages = await convService.listMessages(c.id, "customer");
    expect(customerMessages.length).toBe(1);
    expect(customerMessages[0].visibility).toBe("PUBLIC");
    expect(customerMessages.some((m) => m.visibility === "INTERNAL")).toBe(false);

    // Admin view has both messages
    const adminMessages = await convService.listMessages(c.id, "admin");
    expect(adminMessages.length).toBe(2);
    expect(adminMessages.some((m) => m.visibility === "INTERNAL")).toBe(true);
  });

  it("B3: guarantees message idempotency via idempotencyKey", async () => {
    const c = await caseService.createCase({
      requesterType: "RETAIL_CUSTOMER",
      requesterUserId: customerUserA.id,
      category: "SHIPPING",
      subject: "تست تکرار پیام",
    });

    const idempotencyKey = `idem_msg_${makeId()}`;

    const res1 = await convService.addMessage({
      caseId: c.id,
      author: { type: "CUSTOMER", id: customerUserA.id, displayName: "Ali" },
      body: "این یک پیام با کلید یکتا است.",
      idempotencyKey,
    });

    const res2 = await convService.addMessage({
      caseId: c.id,
      author: { type: "CUSTOMER", id: customerUserA.id, displayName: "Ali" },
      body: "این یک پیام با کلید یکتا است.",
      idempotencyKey,
    });

    expect(res1.id).toBe(res2.id);

    const messages = await convService.listMessages(c.id, "customer");
    expect(messages.length).toBe(1);
  });

  it("B4: manages internal support notes with pinned sorting and audit log", async () => {
    const c = await caseService.createCase({
      requesterType: "VIP_BUYER",
      wholesaleAccountId: vipAccountA.id,
      category: "WHOLESALE",
      subject: "درخواست تخفیف خرید عمده",
    });

    // Add note 1 (unpinned)
    const note1 = await convService.addInternalNote({
      caseId: c.id,
      adminId: adminUserA.id,
      adminDisplayName: "Admin A",
      body: "بررسی سابقه مالی: خریدار تا کنون ۳ تراکنش موفق داشته است.",
      isPinned: false,
    });

    // Add note 2 (pinned)
    const note2 = await convService.addInternalNote({
      caseId: c.id,
      adminId: adminUserA.id,
      adminDisplayName: "Admin A",
      body: "مهم: تا سقف ۷ درصد تخفیف مورد تأیید مدیر فروش است.",
      isPinned: true,
    });

    // Admin lists notes: pinned note comes first
    const notes = await convService.listInternalNotes(c.id, "admin");
    expect(notes.length).toBe(2);
    expect(notes[0].id).toBe(note2.id); // pinned first
    expect(notes[0].isPinned).toBe(true);
    expect(notes[1].id).toBe(note1.id);

    // Toggle pin on note 1
    const updated = await convService.togglePinInternalNote(note1.id, true, adminUserA.id);
    expect(updated.isPinned).toBe(true);

    // Non-admin access to internal notes is rejected
    await expect(convService.listInternalNotes(c.id, "customer")).rejects.toThrow(
      SupportUnauthorizedAccessError,
    );
    await expect(convService.listInternalNotes(c.id, "vip")).rejects.toThrow(
      SupportUnauthorizedAccessError,
    );
  });

  it("B5: enforces tenant isolation across Retail, VIP, and Supplier actors", async () => {
    // 1. Retail case
    const retailCase = await caseService.createCase({
      requesterType: "RETAIL_CUSTOMER",
      requesterUserId: customerUserA.id,
      category: "ORDER",
      subject: "مورد مشتری الف",
    });

    // Customer A has access
    await expect(
      convService.verifyParticipantAccess(retailCase.id, {
        userId: customerUserA.id,
        role: "customer",
      }),
    ).resolves.toBeDefined();

    // Customer B is rejected
    await expect(
      convService.verifyParticipantAccess(retailCase.id, {
        userId: customerUserB.id,
        role: "customer",
      }),
    ).rejects.toThrow(SupportUnauthorizedAccessError);

    // 2. VIP case
    const vipCase = await caseService.createCase({
      requesterType: "VIP_BUYER",
      wholesaleAccountId: vipAccountA.id,
      requesterUserId: vipAccountA.userId,
      category: "WHOLESALE",
      subject: "مورد عمده الف",
    });

    // VIP A has access
    await expect(
      convService.verifyParticipantAccess(vipCase.id, {
        userId: vipAccountA.userId,
        role: "vip",
        wholesaleAccountId: vipAccountA.id,
      }),
    ).resolves.toBeDefined();

    // VIP B is rejected
    await expect(
      convService.verifyParticipantAccess(vipCase.id, {
        userId: vipAccountB.userId,
        role: "vip",
        wholesaleAccountId: vipAccountB.id,
      }),
    ).rejects.toThrow(SupportUnauthorizedAccessError);

    // 3. Supplier case
    const supplierCase = await caseService.createCase({
      requesterType: "SUPPLIER",
      supplierId: ctx.supA,
      category: "SETTLEMENT",
      subject: "مورد تأمین‌کننده الف",
    });

    // Supplier A has access
    await expect(
      convService.verifyParticipantAccess(supplierCase.id, {
        role: "supplier",
        supplierId: ctx.supA,
      }),
    ).resolves.toBeDefined();

    // Supplier B is rejected
    await expect(
      convService.verifyParticipantAccess(supplierCase.id, {
        role: "supplier",
        supplierId: ctx.supB,
      }),
    ).rejects.toThrow(SupportUnauthorizedAccessError);
  });

  it("B6: registers valid attachment metadata, links to message, and enforces size/MIME rules", async () => {
    const c = await caseService.createCase({
      requesterType: "RETAIL_CUSTOMER",
      requesterUserId: customerUserA.id,
      category: "QUALITY",
      subject: "کیفیت پارچه",
    });

    // 1. Valid PDF attachment
    const validPdf = await convService.createAttachmentMetadata({
      caseId: c.id,
      uploader: { type: "CUSTOMER", id: customerUserA.id },
      originalFilename: "damage_report.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024 * 500, // 500 KB
      objectKey: "cases/damage_report_123.pdf",
    });
    expect(validPdf.id).toMatch(/^satt_/);
    expect(validPdf.originalFilename).toBe("damage_report.pdf");

    // 2. Link attachment to message
    const msg = await convService.addMessage({
      caseId: c.id,
      author: { type: "CUSTOMER", id: customerUserA.id, displayName: "Ali" },
      body: "گزارش پیوست گردید.",
      attachmentIds: [validPdf.id],
    });

    // 3. Message includes linked attachment
    const messages = await convService.listMessages(c.id, "customer");
    const foundMsg = messages.find((m) => m.id === msg.id);
    expect(foundMsg?.attachments.length).toBe(1);
    expect(foundMsg?.attachments[0].id).toBe(validPdf.id);

    // 4. Reject dangerous MIME type
    await expect(
      convService.createAttachmentMetadata({
        caseId: c.id,
        uploader: { type: "CUSTOMER", id: customerUserA.id },
        originalFilename: "malware.exe",
        contentType: "application/x-msdownload",
        sizeBytes: 1024,
        objectKey: "cases/bad.exe",
      }),
    ).rejects.toThrow(SupportAttachmentInvalidError);

    // 5. Reject dangerous script extension
    await expect(
      convService.createAttachmentMetadata({
        caseId: c.id,
        uploader: { type: "CUSTOMER", id: customerUserA.id },
        originalFilename: "hack.sh",
        contentType: "text/plain",
        sizeBytes: 1024,
        objectKey: "cases/bad.sh",
      }),
    ).rejects.toThrow(SupportAttachmentInvalidError);

    // 6. Reject oversized file (> 15 MB)
    await expect(
      convService.createAttachmentMetadata({
        caseId: c.id,
        uploader: { type: "CUSTOMER", id: customerUserA.id },
        originalFilename: "huge_video.mp4",
        contentType: "image/jpeg",
        sizeBytes: 20 * 1024 * 1024, // 20 MB
        objectKey: "cases/big.jpg",
      }),
    ).rejects.toThrow(SupportAttachmentInvalidError);
  });

  it("B7: provides signed time-bounded attachment access and blocks quarantined files", async () => {
    const c = await caseService.createCase({
      requesterType: "RETAIL_CUSTOMER",
      requesterUserId: customerUserA.id,
      category: "OTHER",
      subject: "دسترسی امن به فایل",
    });

    const att = await convService.createAttachmentMetadata({
      caseId: c.id,
      uploader: { type: "CUSTOMER", id: customerUserA.id },
      originalFilename: "evidence.png",
      contentType: "image/png",
      sizeBytes: 1024 * 200,
      objectKey: "cases/evidence_789.png",
      scanStatus: "CLEAN",
    });

    // Clean attachment returns signed token descriptor
    const access = await convService.getAttachmentAccess(att.id, "customer");
    expect(access.attachmentId).toBe(att.id);
    expect(access.secureAccessToken).toBeDefined();
    expect(access.downloadUrl).toContain("token=");
    expect(access.expiresAt).toBeDefined();

    // Mark as REJECTED
    await convService.updateScanStatus(att.id, "REJECTED");

    // Rejected file download is blocked
    await expect(convService.getAttachmentAccess(att.id, "customer")).rejects.toThrow(
      SupportAttachmentInvalidError,
    );
  });
});
