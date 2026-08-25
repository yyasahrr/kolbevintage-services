import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../../lib/http";

/**
 * بررسی درخواست تأمینکننده.
 * approve: ساخت تأمینکننده + (در صورت ارسال email/password) ساخت حساب ورود پنل ساپلایر.
 */
export const POST = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  requireRole(req, "admin");
  const id = (req as any).params?.id;
  const body = req.body as { status?: "approved" | "rejected" | "reviewing"; loginEmail?: string; loginPassword?: string };
  if (!id || !body?.status) return ok(res, { error: "INVALID_INPUT" }, 422);
  const service = svc(req);

  if (body.status === "approved") {
    const supplier = await service.supplier.approveApplication(id);
    if (body.loginEmail?.includes("@") && (body.loginPassword?.length ?? 0) >= 8) {
      const user = await service.account.registerAccount({
        email: body.loginEmail, password: body.loginPassword!, role: "supplier",
        displayName: supplier.displayName, phone: supplier.phone ?? null,
      });
      await service.supplier.addSupplierMember(supplier.id, user.id);
    }
    return ok(res, { status: "approved", supplier_id: supplier.id });
  }

  await service.supplier.updateSupplierApplications({ id, status: body.status });
  ok(res, { status: body.status });
});
