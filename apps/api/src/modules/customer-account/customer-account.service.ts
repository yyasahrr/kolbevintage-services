import { Inject, Injectable } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";

export type CustomerProfileView = {
  id: string;
  email: string;
  displayName: string | null;
  phone: string | null;
  role: string;
  status: string;
};

/**
 * Phase 5.9-A — profile façade. Identity and credentials stay inside the
 * auth module; this service delegates reads/writes to AuthService (the
 * single writer of `account_user`) and records self-service changes.
 */
@Injectable()
export class CustomerAccountService {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async getProfile(userId: string): Promise<CustomerProfileView> {
    return this.auth.getCustomerProfile(userId);
  }

  async updateProfile(
    userId: string,
    input: { displayName?: unknown; phone?: unknown },
  ): Promise<CustomerProfileView> {
    const before = await this.auth.getCustomerProfile(userId);
    const after = await this.auth.updateCustomerProfile(userId, {
      displayName: input.displayName,
      phone: input.phone,
    });
    if (before.displayName !== after.displayName || before.phone !== after.phone) {
      await this.audit.record({
        actorId: userId,
        actorRole: after.role,
        action: "customer_profile.updated",
        entityType: "account_user",
        entityId: userId,
        before: { display_name: before.displayName, phone: before.phone },
        after: { display_name: after.displayName, phone: after.phone },
      });
    }
    return after;
  }
}
