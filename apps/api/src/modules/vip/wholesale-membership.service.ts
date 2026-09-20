import { Inject, Injectable, Optional } from "@nestjs/common";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import {
  wholesaleMembership,
  wholesaleMembershipHistory,
  wholesaleAccount,
  wholesalePlan,
  wholesalePlanVersion,
  wholesalePlanFeature,
  wholesalePlanLimit,
  accountUser,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import {
  WholesaleMembershipNotFoundError,
  WholesaleMembershipConflictError,
  WholesaleMembershipStateError,
  WholesaleMembershipError,
} from "./wholesale-membership.errors";
import { WholesalePlanVersionNotFoundError } from "./wholesale-plan.errors";

export type CreatePendingMembershipInput = {
  accountId: string;
  planVersionId: string;
  metadata?: Record<string, any>;
};

export type ActivateMembershipOpts = {
  durationDays?: number;
  startedAt?: Date;
  reason?: string;
};

export type RenewMembershipOpts = {
  durationDays?: number;
  reason?: string;
};

@Injectable()
export class WholesaleMembershipService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Optional() @Inject(AuditService) private readonly auditService?: AuditService,
  ) {}

  private makeId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  async createPendingMembership(input: CreatePendingMembershipInput, actorId: string) {
    const [account] = await this.db
      .select()
      .from(wholesaleAccount)
      .where(eq(wholesaleAccount.id, input.accountId))
      .limit(1);

    if (!account) {
      throw new WholesaleMembershipError("ACCOUNT_NOT_FOUND", `Wholesale account '${input.accountId}' not found`);
    }

    const [version] = await this.db
      .select()
      .from(wholesalePlanVersion)
      .where(eq(wholesalePlanVersion.id, input.planVersionId))
      .limit(1);

    if (!version) {
      throw new WholesalePlanVersionNotFoundError(input.planVersionId);
    }
    if (version.status !== "published") {
      throw new WholesaleMembershipError(
        "PLAN_VERSION_NOT_PUBLISHED",
        `Cannot create membership for unpublished plan version in status '${version.status}'`,
      );
    }

    return await this.db.transaction(async (tx) => {
      // Check if there is already an active or pending membership
      const existing = await tx
        .select()
        .from(wholesaleMembership)
        .where(
          and(
            eq(wholesaleMembership.accountId, input.accountId),
            sql`${wholesaleMembership.status} IN ('pending', 'active')`,
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        throw new WholesaleMembershipConflictError(
          `Wholesale account '${input.accountId}' already has a membership in '${existing[0].status}' status`,
        );
      }

      const id = this.makeId("wmem");
      const [membership] = await tx
        .insert(wholesaleMembership)
        .values({
          id,
          accountId: input.accountId,
          planId: version.planId,
          planVersionId: version.id,
          status: "pending",
          currentVersion: 1,
        })
        .returning();

      // Record history
      await tx.insert(wholesaleMembershipHistory).values({
        id: this.makeId("wmh"),
        membershipId: id,
        accountId: input.accountId,
        eventType: "activated", // initial creation event
        fromStatus: null,
        toStatus: "pending",
        toPlanVersionId: version.id,
        actorId,
        metadata: input.metadata ?? {},
      });

      if (this.auditService) {
        await this.auditService.record({
          action: "wholesale_membership.created",
          entityType: "wholesale_membership",
          entityId: id,
          actorId,
          actorRole: "admin",
          metadata: { accountId: input.accountId, planVersionId: version.id },
        });
      }

      return membership;
    });
  }

  async activateMembership(membershipId: string, actorId: string, opts?: ActivateMembershipOpts) {
    return await this.db.transaction(async (tx) => {
      const [membership] = await tx
        .select()
        .from(wholesaleMembership)
        .where(eq(wholesaleMembership.id, membershipId))
        .for("update")
        .limit(1);

      if (!membership) {
        throw new WholesaleMembershipNotFoundError(membershipId);
      }
      if (membership.status !== "pending") {
        throw new WholesaleMembershipStateError(membership.status, "activate");
      }

      const [version] = await tx
        .select()
        .from(wholesalePlanVersion)
        .where(eq(wholesalePlanVersion.id, membership.planVersionId))
        .limit(1);

      const [plan] = await tx
        .select()
        .from(wholesalePlan)
        .where(eq(wholesalePlan.id, membership.planId))
        .limit(1);

      // Fetch features and limits to build frozen immutable snapshots
      const features = await tx
        .select()
        .from(wholesalePlanFeature)
        .where(eq(wholesalePlanFeature.planVersionId, version.id));

      const limits = await tx
        .select()
        .from(wholesalePlanLimit)
        .where(eq(wholesalePlanLimit.planVersionId, version.id));

      const snapshotFeatures: Record<string, any> = {};
      for (const f of features) {
        snapshotFeatures[f.featureKey] = {
          isEnabled: f.isEnabled,
          featureType: f.featureType,
          configValue: f.configValue,
          description: f.description,
        };
      }

      const snapshotLimits: Record<string, any> = {};
      for (const l of limits) {
        snapshotLimits[l.limitKey] = {
          limitValue: l.limitValue.toString(),
          period: l.period,
          isEnforced: l.isEnforced,
        };
      }

      const startedAt = opts?.startedAt ?? new Date();
      const durationDays = opts?.durationDays ?? version.durationDays;
      const expiresAt = new Date(startedAt.getTime() + durationDays * 86_400_000);

      const [activated] = await tx
        .update(wholesaleMembership)
        .set({
          status: "active",
          startedAt,
          expiresAt,
          snapshotFeatures,
          snapshotLimits,
          currentVersion: sql`${wholesaleMembership.currentVersion} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(wholesaleMembership.id, membershipId))
        .returning();

      // Synchronize wholesale_account record for backwards compatibility
      await tx
        .update(wholesaleAccount)
        .set({
          status: "approved",
          planName: plan?.name ?? "وی‌آی‌پی",
          activatedAt: startedAt,
          expiresAt,
          updatedAt: sql`now()`,
        })
        .where(eq(wholesaleAccount.id, membership.accountId));

      await tx.insert(wholesaleMembershipHistory).values({
        id: this.makeId("wmh"),
        membershipId,
        accountId: membership.accountId,
        eventType: "activated",
        fromStatus: "pending",
        toStatus: "active",
        toPlanVersionId: version.id,
        actorId,
        reason: opts?.reason ?? "Membership activated by admin",
        metadata: { durationDays, expiresAt: expiresAt.toISOString() },
      });

      if (this.auditService) {
        await this.auditService.record({
          action: "wholesale_membership.activated",
          entityType: "wholesale_membership",
          entityId: membershipId,
          actorId,
          actorRole: "admin",
          metadata: { accountId: membership.accountId, expiresAt: expiresAt.toISOString() },
        });
      }

      return activated;
    });
  }

  async renewMembership(membershipId: string, actorId: string, opts?: RenewMembershipOpts) {
    return await this.db.transaction(async (tx) => {
      const [membership] = await tx
        .select()
        .from(wholesaleMembership)
        .where(eq(wholesaleMembership.id, membershipId))
        .for("update")
        .limit(1);

      if (!membership) {
        throw new WholesaleMembershipNotFoundError(membershipId);
      }
      if (membership.status !== "active" && membership.status !== "expired") {
        throw new WholesaleMembershipStateError(membership.status, "renew");
      }

      let targetPlanVersionId = membership.planVersionId;
      let targetPlanId = membership.planId;
      let eventType: "renewed" | "upgraded" | "downgraded" = "renewed";

      // If a scheduled plan change is pending, apply it upon renewal
      if (membership.scheduledPlanVersionId) {
        targetPlanVersionId = membership.scheduledPlanVersionId;
        targetPlanId = membership.scheduledPlanId ?? membership.planId;
        eventType = "renewed";
      }

      const [version] = await tx
        .select()
        .from(wholesalePlanVersion)
        .where(eq(wholesalePlanVersion.id, targetPlanVersionId))
        .limit(1);

      const [plan] = await tx
        .select()
        .from(wholesalePlan)
        .where(eq(wholesalePlan.id, targetPlanId))
        .limit(1);

      // Re-snapshot features & limits for the target plan version
      const features = await tx
        .select()
        .from(wholesalePlanFeature)
        .where(eq(wholesalePlanFeature.planVersionId, version.id));

      const limits = await tx
        .select()
        .from(wholesalePlanLimit)
        .where(eq(wholesalePlanLimit.planVersionId, version.id));

      const snapshotFeatures: Record<string, any> = {};
      for (const f of features) {
        snapshotFeatures[f.featureKey] = {
          isEnabled: f.isEnabled,
          featureType: f.featureType,
          configValue: f.configValue,
          description: f.description,
        };
      }

      const snapshotLimits: Record<string, any> = {};
      for (const l of limits) {
        snapshotLimits[l.limitKey] = {
          limitValue: l.limitValue.toString(),
          period: l.period,
          isEnforced: l.isEnforced,
        };
      }

      const now = new Date();
      const currentExpiry = membership.expiresAt ? new Date(membership.expiresAt) : now;
      const baseDate = currentExpiry > now ? currentExpiry : now;
      const durationDays = opts?.durationDays ?? version.durationDays;
      const newExpiresAt = new Date(baseDate.getTime() + durationDays * 86_400_000);

      const [renewed] = await tx
        .update(wholesaleMembership)
        .set({
          planId: targetPlanId,
          planVersionId: targetPlanVersionId,
          status: "active",
          expiresAt: newExpiresAt,
          snapshotFeatures,
          snapshotLimits,
          scheduledPlanId: null,
          scheduledPlanVersionId: null,
          scheduledEffectiveAt: null,
          currentVersion: sql`${wholesaleMembership.currentVersion} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(wholesaleMembership.id, membershipId))
        .returning();

      await tx
        .update(wholesaleAccount)
        .set({
          status: "approved",
          planName: plan?.name ?? "وی‌آی‌پی",
          expiresAt: newExpiresAt,
          updatedAt: sql`now()`,
        })
        .where(eq(wholesaleAccount.id, membership.accountId));

      await tx.insert(wholesaleMembershipHistory).values({
        id: this.makeId("wmh"),
        membershipId,
        accountId: membership.accountId,
        eventType,
        fromStatus: membership.status,
        toStatus: "active",
        fromPlanVersionId: membership.planVersionId,
        toPlanVersionId: targetPlanVersionId,
        actorId,
        reason: opts?.reason ?? "Membership renewed",
        metadata: { durationDays, newExpiresAt: newExpiresAt.toISOString() },
      });

      if (this.auditService) {
        await this.auditService.record({
          action: "wholesale_membership.renewed",
          entityType: "wholesale_membership",
          entityId: membershipId,
          actorId,
          actorRole: "admin",
          metadata: { accountId: membership.accountId, newExpiresAt: newExpiresAt.toISOString() },
        });
      }

      return renewed;
    });
  }

  async schedulePlanChange(
    membershipId: string,
    targetPlanVersionId: string,
    actorId: string,
    opts?: { reason?: string },
  ) {
    return await this.db.transaction(async (tx) => {
      const [membership] = await tx
        .select()
        .from(wholesaleMembership)
        .where(eq(wholesaleMembership.id, membershipId))
        .for("update")
        .limit(1);

      if (!membership) {
        throw new WholesaleMembershipNotFoundError(membershipId);
      }
      if (membership.status !== "active") {
        throw new WholesaleMembershipStateError(membership.status, "schedule_plan_change");
      }

      const [targetVersion] = await tx
        .select()
        .from(wholesalePlanVersion)
        .where(eq(wholesalePlanVersion.id, targetPlanVersionId))
        .limit(1);

      if (!targetVersion) {
        throw new WholesalePlanVersionNotFoundError(targetPlanVersionId);
      }
      if (targetVersion.status !== "published") {
        throw new WholesaleMembershipError("TARGET_NOT_PUBLISHED", "Target plan version must be published");
      }

      const [updated] = await tx
        .update(wholesaleMembership)
        .set({
          scheduledPlanId: targetVersion.planId,
          scheduledPlanVersionId: targetPlanVersionId,
          scheduledEffectiveAt: membership.expiresAt,
          currentVersion: sql`${wholesaleMembership.currentVersion} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(wholesaleMembership.id, membershipId))
        .returning();

      await tx.insert(wholesaleMembershipHistory).values({
        id: this.makeId("wmh"),
        membershipId,
        accountId: membership.accountId,
        eventType: "plan_change_scheduled",
        fromStatus: membership.status,
        toStatus: membership.status,
        fromPlanVersionId: membership.planVersionId,
        toPlanVersionId: targetPlanVersionId,
        actorId,
        reason: opts?.reason ?? "Scheduled plan change for next billing cycle",
        metadata: { scheduledEffectiveAt: membership.expiresAt?.toISOString() },
      });

      return updated;
    });
  }

  async upgradeMembership(
    membershipId: string,
    targetPlanVersionId: string,
    actorId: string,
    opts?: { immediate?: boolean; reason?: string },
  ) {
    if (opts?.immediate === false) {
      return await this.schedulePlanChange(membershipId, targetPlanVersionId, actorId, opts);
    }

    return await this.db.transaction(async (tx) => {
      const [membership] = await tx
        .select()
        .from(wholesaleMembership)
        .where(eq(wholesaleMembership.id, membershipId))
        .for("update")
        .limit(1);

      if (!membership) {
        throw new WholesaleMembershipNotFoundError(membershipId);
      }
      if (membership.status !== "active") {
        throw new WholesaleMembershipStateError(membership.status, "upgrade");
      }

      const [targetVersion] = await tx
        .select()
        .from(wholesalePlanVersion)
        .where(eq(wholesalePlanVersion.id, targetPlanVersionId))
        .limit(1);

      if (!targetVersion) {
        throw new WholesalePlanVersionNotFoundError(targetPlanVersionId);
      }
      if (targetVersion.status !== "published") {
        throw new WholesaleMembershipError("TARGET_NOT_PUBLISHED", "Target plan version must be published");
      }

      const [targetPlan] = await tx
        .select()
        .from(wholesalePlan)
        .where(eq(wholesalePlan.id, targetVersion.planId))
        .limit(1);

      // Snapshot new features & limits
      const features = await tx
        .select()
        .from(wholesalePlanFeature)
        .where(eq(wholesalePlanFeature.planVersionId, targetVersion.id));

      const limits = await tx
        .select()
        .from(wholesalePlanLimit)
        .where(eq(wholesalePlanLimit.planVersionId, targetVersion.id));

      const snapshotFeatures: Record<string, any> = {};
      for (const f of features) {
        snapshotFeatures[f.featureKey] = {
          isEnabled: f.isEnabled,
          featureType: f.featureType,
          configValue: f.configValue,
          description: f.description,
        };
      }

      const snapshotLimits: Record<string, any> = {};
      for (const l of limits) {
        snapshotLimits[l.limitKey] = {
          limitValue: l.limitValue.toString(),
          period: l.period,
          isEnforced: l.isEnforced,
        };
      }

      const [upgraded] = await tx
        .update(wholesaleMembership)
        .set({
          planId: targetVersion.planId,
          planVersionId: targetPlanVersionId,
          snapshotFeatures,
          snapshotLimits,
          scheduledPlanId: null,
          scheduledPlanVersionId: null,
          scheduledEffectiveAt: null,
          currentVersion: sql`${wholesaleMembership.currentVersion} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(wholesaleMembership.id, membershipId))
        .returning();

      await tx
        .update(wholesaleAccount)
        .set({
          planName: targetPlan?.name ?? "وی‌آی‌پی",
          updatedAt: sql`now()`,
        })
        .where(eq(wholesaleAccount.id, membership.accountId));

      await tx.insert(wholesaleMembershipHistory).values({
        id: this.makeId("wmh"),
        membershipId,
        accountId: membership.accountId,
        eventType: "upgraded",
        fromStatus: "active",
        toStatus: "active",
        fromPlanVersionId: membership.planVersionId,
        toPlanVersionId: targetPlanVersionId,
        actorId,
        reason: opts?.reason ?? "Immediate plan upgrade applied",
      });

      if (this.auditService) {
        await this.auditService.record({
          action: "wholesale_membership.upgraded",
          entityType: "wholesale_membership",
          entityId: membershipId,
          actorId,
          actorRole: "admin",
          metadata: { fromVersionId: membership.planVersionId, toVersionId: targetPlanVersionId },
        });
      }

      return upgraded;
    });
  }

  async downgradeMembership(
    membershipId: string,
    targetPlanVersionId: string,
    actorId: string,
    opts?: { immediate?: boolean; reason?: string },
  ) {
    if (opts?.immediate === false) {
      return await this.schedulePlanChange(membershipId, targetPlanVersionId, actorId, opts);
    }

    return await this.db.transaction(async (tx) => {
      const [membership] = await tx
        .select()
        .from(wholesaleMembership)
        .where(eq(wholesaleMembership.id, membershipId))
        .for("update")
        .limit(1);

      if (!membership) {
        throw new WholesaleMembershipNotFoundError(membershipId);
      }
      if (membership.status !== "active") {
        throw new WholesaleMembershipStateError(membership.status, "downgrade");
      }

      const [targetVersion] = await tx
        .select()
        .from(wholesalePlanVersion)
        .where(eq(wholesalePlanVersion.id, targetPlanVersionId))
        .limit(1);

      if (!targetVersion) {
        throw new WholesalePlanVersionNotFoundError(targetPlanVersionId);
      }
      if (targetVersion.status !== "published") {
        throw new WholesaleMembershipError("TARGET_NOT_PUBLISHED", "Target plan version must be published");
      }

      const [targetPlan] = await tx
        .select()
        .from(wholesalePlan)
        .where(eq(wholesalePlan.id, targetVersion.planId))
        .limit(1);

      // Snapshot new features & limits
      const features = await tx
        .select()
        .from(wholesalePlanFeature)
        .where(eq(wholesalePlanFeature.planVersionId, targetVersion.id));

      const limits = await tx
        .select()
        .from(wholesalePlanLimit)
        .where(eq(wholesalePlanLimit.planVersionId, targetVersion.id));

      const snapshotFeatures: Record<string, any> = {};
      for (const f of features) {
        snapshotFeatures[f.featureKey] = {
          isEnabled: f.isEnabled,
          featureType: f.featureType,
          configValue: f.configValue,
          description: f.description,
        };
      }

      const snapshotLimits: Record<string, any> = {};
      for (const l of limits) {
        snapshotLimits[l.limitKey] = {
          limitValue: l.limitValue.toString(),
          period: l.period,
          isEnforced: l.isEnforced,
        };
      }

      const [downgraded] = await tx
        .update(wholesaleMembership)
        .set({
          planId: targetVersion.planId,
          planVersionId: targetPlanVersionId,
          snapshotFeatures,
          snapshotLimits,
          scheduledPlanId: null,
          scheduledPlanVersionId: null,
          scheduledEffectiveAt: null,
          currentVersion: sql`${wholesaleMembership.currentVersion} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(wholesaleMembership.id, membershipId))
        .returning();

      await tx
        .update(wholesaleAccount)
        .set({
          planName: targetPlan?.name ?? "وی‌آی‌پی",
          updatedAt: sql`now()`,
        })
        .where(eq(wholesaleAccount.id, membership.accountId));

      await tx.insert(wholesaleMembershipHistory).values({
        id: this.makeId("wmh"),
        membershipId,
        accountId: membership.accountId,
        eventType: "downgraded",
        fromStatus: "active",
        toStatus: "active",
        fromPlanVersionId: membership.planVersionId,
        toPlanVersionId: targetPlanVersionId,
        actorId,
        reason: opts?.reason ?? "Immediate plan downgrade applied",
      });

      if (this.auditService) {
        await this.auditService.record({
          action: "wholesale_membership.downgraded",
          entityType: "wholesale_membership",
          entityId: membershipId,
          actorId,
          actorRole: "admin",
          metadata: { fromVersionId: membership.planVersionId, toVersionId: targetPlanVersionId },
        });
      }

      return downgraded;
    });
  }

  async suspendMembership(membershipId: string, reason: string, actorId: string) {
    return await this.db.transaction(async (tx) => {
      const [membership] = await tx
        .select()
        .from(wholesaleMembership)
        .where(eq(wholesaleMembership.id, membershipId))
        .for("update")
        .limit(1);

      if (!membership) {
        throw new WholesaleMembershipNotFoundError(membershipId);
      }
      if (membership.status !== "active") {
        throw new WholesaleMembershipStateError(membership.status, "suspend");
      }

      const [suspended] = await tx
        .update(wholesaleMembership)
        .set({
          status: "suspended",
          suspendedAt: sql`now()`,
          suspendedReason: reason,
          currentVersion: sql`${wholesaleMembership.currentVersion} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(wholesaleMembership.id, membershipId))
        .returning();

      await tx
        .update(wholesaleAccount)
        .set({
          status: "suspended",
          updatedAt: sql`now()`,
        })
        .where(eq(wholesaleAccount.id, membership.accountId));

      await tx.insert(wholesaleMembershipHistory).values({
        id: this.makeId("wmh"),
        membershipId,
        accountId: membership.accountId,
        eventType: "suspended",
        fromStatus: "active",
        toStatus: "suspended",
        fromPlanVersionId: membership.planVersionId,
        toPlanVersionId: membership.planVersionId,
        actorId,
        reason,
      });

      if (this.auditService) {
        await this.auditService.record({
          action: "wholesale_membership.suspended",
          entityType: "wholesale_membership",
          entityId: membershipId,
          actorId,
          actorRole: "admin",
          metadata: { reason },
        });
      }

      return suspended;
    });
  }

  async resumeMembership(membershipId: string, actorId: string, opts?: { reason?: string }) {
    return await this.db.transaction(async (tx) => {
      const [membership] = await tx
        .select()
        .from(wholesaleMembership)
        .where(eq(wholesaleMembership.id, membershipId))
        .for("update")
        .limit(1);

      if (!membership) {
        throw new WholesaleMembershipNotFoundError(membershipId);
      }
      if (membership.status !== "suspended") {
        throw new WholesaleMembershipStateError(membership.status, "resume");
      }

      const now = new Date();
      // If expired while suspended, mark as expired
      if (membership.expiresAt && new Date(membership.expiresAt) < now) {
        const [expired] = await tx
          .update(wholesaleMembership)
          .set({
            status: "expired",
            currentVersion: sql`${wholesaleMembership.currentVersion} + 1`,
            updatedAt: sql`now()`,
          })
          .where(eq(wholesaleMembership.id, membershipId))
          .returning();

        await tx
          .update(wholesaleAccount)
          .set({ status: "expired", updatedAt: sql`now()` })
          .where(eq(wholesaleAccount.id, membership.accountId));

        return expired;
      }

      const [resumed] = await tx
        .update(wholesaleMembership)
        .set({
          status: "active",
          suspendedAt: null,
          suspendedReason: null,
          currentVersion: sql`${wholesaleMembership.currentVersion} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(wholesaleMembership.id, membershipId))
        .returning();

      await tx
        .update(wholesaleAccount)
        .set({ status: "approved", updatedAt: sql`now()` })
        .where(eq(wholesaleAccount.id, membership.accountId));

      await tx.insert(wholesaleMembershipHistory).values({
        id: this.makeId("wmh"),
        membershipId,
        accountId: membership.accountId,
        eventType: "resumed",
        fromStatus: "suspended",
        toStatus: "active",
        fromPlanVersionId: membership.planVersionId,
        toPlanVersionId: membership.planVersionId,
        actorId,
        reason: opts?.reason ?? "Membership resumed by admin",
      });

      if (this.auditService) {
        await this.auditService.record({
          action: "wholesale_membership.resumed",
          entityType: "wholesale_membership",
          entityId: membershipId,
          actorId,
          actorRole: "admin",
          metadata: { reason: opts?.reason },
        });
      }

      return resumed;
    });
  }

  async cancelMembership(membershipId: string, reason: string, actorId: string) {
    return await this.db.transaction(async (tx) => {
      const [membership] = await tx
        .select()
        .from(wholesaleMembership)
        .where(eq(wholesaleMembership.id, membershipId))
        .for("update")
        .limit(1);

      if (!membership) {
        throw new WholesaleMembershipNotFoundError(membershipId);
      }
      if (membership.status === "cancelled") {
        throw new WholesaleMembershipStateError(membership.status, "cancel");
      }

      const [cancelled] = await tx
        .update(wholesaleMembership)
        .set({
          status: "cancelled",
          cancelledAt: sql`now()`,
          cancelledReason: reason,
          currentVersion: sql`${wholesaleMembership.currentVersion} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(wholesaleMembership.id, membershipId))
        .returning();

      await tx
        .update(wholesaleAccount)
        .set({ status: "expired", updatedAt: sql`now()` })
        .where(eq(wholesaleAccount.id, membership.accountId));

      await tx.insert(wholesaleMembershipHistory).values({
        id: this.makeId("wmh"),
        membershipId,
        accountId: membership.accountId,
        eventType: "cancelled",
        fromStatus: membership.status,
        toStatus: "cancelled",
        fromPlanVersionId: membership.planVersionId,
        toPlanVersionId: membership.planVersionId,
        actorId,
        reason,
      });

      if (this.auditService) {
        await this.auditService.record({
          action: "wholesale_membership.cancelled",
          entityType: "wholesale_membership",
          entityId: membershipId,
          actorId,
          actorRole: "admin",
          metadata: { reason },
        });
      }

      return cancelled;
    });
  }

  async expireMembershipsSweep(actorId?: string, limit = 100) {
    return await this.db.transaction(async (tx) => {
      let sweepActorId = actorId;
      if (!sweepActorId) {
        const [admin] = await tx
          .select({ id: accountUser.id })
          .from(accountUser)
          .where(eq(accountUser.role, "admin"))
          .limit(1);
        sweepActorId = admin?.id;
      }
      if (!sweepActorId) {
        const [anyUser] = await tx
          .select({ id: accountUser.id })
          .from(accountUser)
          .limit(1);
        sweepActorId = anyUser?.id;
      }

      const now = new Date();
      const expiredList = await tx
        .select()
        .from(wholesaleMembership)
        .where(
          and(
            eq(wholesaleMembership.status, "active"),
            lt(wholesaleMembership.expiresAt, now),
          ),
        )
        .limit(limit);

      let processed = 0;
      for (const m of expiredList) {
        await tx
          .update(wholesaleMembership)
          .set({
            status: "expired",
            currentVersion: sql`${wholesaleMembership.currentVersion} + 1`,
            updatedAt: sql`now()`,
          })
          .where(eq(wholesaleMembership.id, m.id));

        await tx
          .update(wholesaleAccount)
          .set({ status: "expired", updatedAt: sql`now()` })
          .where(eq(wholesaleAccount.id, m.accountId));

        if (sweepActorId) {
          await tx.insert(wholesaleMembershipHistory).values({
            id: this.makeId("wmh"),
            membershipId: m.id,
            accountId: m.accountId,
            eventType: "expired",
            fromStatus: "active",
            toStatus: "expired",
            fromPlanVersionId: m.planVersionId,
            toPlanVersionId: m.planVersionId,
            actorId: sweepActorId,
            reason: "Periodic expiry sweep: expiresAt in past",
          });
        }

        processed++;
      }

      return processed;
    });
  }

  async getMembership(membershipId: string) {
    const [membership] = await this.db
      .select()
      .from(wholesaleMembership)
      .where(eq(wholesaleMembership.id, membershipId))
      .limit(1);

    if (!membership) {
      throw new WholesaleMembershipNotFoundError(membershipId);
    }

    const [plan] = await this.db
      .select()
      .from(wholesalePlan)
      .where(eq(wholesalePlan.id, membership.planId))
      .limit(1);

    const [version] = await this.db
      .select()
      .from(wholesalePlanVersion)
      .where(eq(wholesalePlanVersion.id, membership.planVersionId))
      .limit(1);

    const history = await this.db
      .select()
      .from(wholesaleMembershipHistory)
      .where(eq(wholesaleMembershipHistory.membershipId, membershipId))
      .orderBy(desc(wholesaleMembershipHistory.createdAt));

    return {
      ...membership,
      plan,
      version,
      history,
    };
  }

  async getActiveMembershipForAccount(accountId: string) {
    const [membership] = await this.db
      .select()
      .from(wholesaleMembership)
      .where(
        and(
          eq(wholesaleMembership.accountId, accountId),
          eq(wholesaleMembership.status, "active"),
        ),
      )
      .limit(1);

    if (!membership) return null;

    const [plan] = await this.db
      .select()
      .from(wholesalePlan)
      .where(eq(wholesalePlan.id, membership.planId))
      .limit(1);

    const [version] = await this.db
      .select()
      .from(wholesalePlanVersion)
      .where(eq(wholesalePlanVersion.id, membership.planVersionId))
      .limit(1);

    return {
      ...membership,
      plan,
      version,
    };
  }

  async listMemberships(opts?: { status?: string; accountId?: string; limit?: number }) {
    let query = this.db.select().from(wholesaleMembership);
    const conditions = [];

    if (opts?.status) {
      conditions.push(eq(wholesaleMembership.status, opts.status));
    }
    if (opts?.accountId) {
      conditions.push(eq(wholesaleMembership.accountId, opts.accountId));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    return await query
      .orderBy(desc(wholesaleMembership.createdAt))
      .limit(opts?.limit ?? 50);
  }
}
