import { Inject, Injectable } from "@nestjs/common";
import { randomBytes, scryptSync } from "node:crypto";
import { accountUser, seller, supplier, supplierApplication, supplierMember } from "@kolbe/database";
import { and, eq } from "drizzle-orm";
import { DomainError } from "@kolbe/shared";
import { KOLBE_DB, type KolbeDatabase } from "../database/database.module";
import { AuditService } from "../modules/audit/audit.service";

@Injectable()
export class SupplierApprovalOrchestrator {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase, private readonly audit: AuditService) {}

  async decide(applicationId: string, input: { status: unknown; loginEmail?: unknown; loginPassword?: unknown }, actorId: string) {
    const status = String(input.status ?? "");
    if (!["approved", "rejected", "reviewing"].includes(status)) throw new DomainError(422, "INVALID_SUPPLIER_APPLICATION_TRANSITION", "وضعیت بررسی نامعتبر است");
    return this.db.transaction(async (tx) => {
      const [application] = await tx.select().from(supplierApplication).where(eq(supplierApplication.id, applicationId)).limit(1);
      if (!application) throw new DomainError(404, "APPLICATION_NOT_FOUND", "درخواست یافت نشد");
      if (application.status === status) {
        const [existingSupplier] = await tx.select().from(supplier).where(and(eq(supplier.legalName, application.companyName), eq(supplier.phone, application.phone))).limit(1);
        return { status, supplier_id: existingSupplier?.id ?? null, replayed: true };
      }
      if (application.status !== "pending" && application.status !== "reviewing") throw new DomainError(409, "INVALID_SUPPLIER_APPLICATION_TRANSITION", "این درخواست قبلاً نهایی شده است");
      if (status !== "approved") {
        await tx.update(supplierApplication).set({ status, updatedAt: new Date() }).where(eq(supplierApplication.id, applicationId));
        await this.audit.record({ actorId, actorRole: "admin", action: "supplier_application.reviewed", entityType: "supplier_application", entityId: applicationId, before: { status: application.status }, after: { status } }, tx);
        return { status };
      }

      let [supplierRow] = await tx.select().from(supplier).where(and(eq(supplier.legalName, application.companyName), eq(supplier.phone, application.phone))).limit(1);
      if (!supplierRow) {
        [supplierRow] = await tx.insert(supplier).values({ id: `sup_${globalThis.crypto.randomUUID().replaceAll("-", "")}`, legalName: application.companyName, displayName: application.companyName, phone: application.phone, category: application.category, monthlyCapacity: application.monthlyCapacity, status: "approved" }).returning();
        await tx.insert(seller).values({ id: `seller_${supplierRow.id}`, type: "SUPPLIER", supplierId: supplierRow.id, displayName: supplierRow.displayName, status: "active" }).onConflictDoNothing();
      }
      let userId: string | null = null;
      const email = String(input.loginEmail ?? "").trim().toLowerCase();
      const password = String(input.loginPassword ?? "");
      if (email || password) {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 8 || password.length > 128) throw new DomainError(422, "INVALID_SUPPLIER_CREDENTIALS", "اطلاعات ورود تأمین‌کننده نامعتبر است");
        let [user] = await tx.select().from(accountUser).where(eq(accountUser.email, email)).limit(1);
        if (!user) {
          const salt = randomBytes(16).toString("hex");
          [user] = await tx.insert(accountUser).values({ id: `usr_${randomBytes(16).toString("hex")}`, email, salt, passwordHash: scryptSync(password, salt, 64).toString("hex"), role: "supplier", displayName: application.companyName, phone: application.phone, status: "active" }).returning();
        } else if (user.role !== "supplier") throw new DomainError(409, "SUPPLIER_EMAIL_ROLE_CONFLICT", "ایمیل متعلق به نقش دیگری است");
        userId = user.id;
        const [member] = await tx.select().from(supplierMember).where(eq(supplierMember.userId, user.id)).limit(1);
        if (member && member.supplierId !== supplierRow.id) throw new DomainError(409, "SUPPLIER_MEMBERSHIP_CONFLICT", "کاربر عضو تأمین‌کننده دیگری است");
        if (!member) await tx.insert(supplierMember).values({ id: `smem_${globalThis.crypto.randomUUID().replaceAll("-", "")}`, supplierId: supplierRow.id, userId: user.id, title: "مدیر تأمین", role: "owner" });
      }
      await tx.update(supplierApplication).set({ status: "approved", updatedAt: new Date() }).where(eq(supplierApplication.id, applicationId));
      await this.audit.record({ actorId, actorRole: "admin", action: "supplier_application.approved", entityType: "supplier_application", entityId: applicationId, before: { status: application.status }, after: { status: "approved", supplier_id: supplierRow.id, login_created: userId !== null } }, tx);
      return { status: "approved", supplier_id: supplierRow.id };
    });
  }
}
