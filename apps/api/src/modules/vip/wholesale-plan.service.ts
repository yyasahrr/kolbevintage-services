import { Inject, Injectable, Optional } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  wholesalePlan,
  wholesalePlanVersion,
  wholesalePlanFeature,
  wholesalePlanLimit,
  accountUser,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import {
  WholesalePlanNotFoundError,
  WholesalePlanVersionNotFoundError,
  WholesalePlanImmutableError,
  WholesalePlanCodeConflictError,
  WholesalePlanError,
} from "./wholesale-plan.errors";

export type CreatePlanInput = {
  code: string;
  name: string;
  description?: string;
  tierLevel?: number;
  currency?: string;
  sortOrder?: number;
};

export type FeatureInput = {
  key: string;
  type?: "boolean" | "limit" | "config";
  isEnabled?: boolean;
  configValue?: Record<string, any>;
  description?: string;
};

export type LimitInput = {
  key: string;
  value: bigint | number | string;
  period?: "order" | "day" | "month" | "year" | "lifetime";
  isEnforced?: boolean;
};

export type CreateVersionInput = {
  name?: string;
  description?: string;
  billingPeriod?: "monthly" | "quarterly" | "semi_annual" | "annual" | "custom";
  durationDays?: number;
  baseFee?: bigint | number | string;
  depositRequirement?: bigint | number | string;
  changeSummary?: string;
  features?: FeatureInput[];
  limits?: LimitInput[];
};

@Injectable()
export class WholesalePlanService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Optional() @Inject(AuditService) private readonly auditService?: AuditService,
  ) {}

  private makeId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  async createPlan(input: CreatePlanInput, actorId?: string) {
    const existing = await this.db
      .select({ id: wholesalePlan.id })
      .from(wholesalePlan)
      .where(eq(wholesalePlan.code, input.code))
      .limit(1);

    if (existing.length > 0) {
      throw new WholesalePlanCodeConflictError(input.code);
    }

    const id = this.makeId("wplan");
    const [created] = await this.db
      .insert(wholesalePlan)
      .values({
        id,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        tierLevel: input.tierLevel ?? 1,
        status: "draft",
        currency: (input.currency as any) || "IRR",
        sortOrder: input.sortOrder ?? 0,
      })
      .returning();

    if (this.auditService && actorId) {
      await this.auditService.record({
        action: "wholesale_plan.created",
        entityType: "wholesale_plan",
        entityId: id,
        actorId,
        metadata: { code: input.code, name: input.name },
      });
    }

    return created;
  }

  async createPlanVersion(planId: string, input: CreateVersionInput, actorId?: string) {
    const [plan] = await this.db
      .select()
      .from(wholesalePlan)
      .where(eq(wholesalePlan.id, planId))
      .limit(1);

    if (!plan) {
      throw new WholesalePlanNotFoundError(planId);
    }

    return await this.db.transaction(async (tx) => {
      // Find highest version number
      const existingVersions = await tx
        .select({ versionNumber: wholesalePlanVersion.versionNumber })
        .from(wholesalePlanVersion)
        .where(eq(wholesalePlanVersion.planId, planId))
        .orderBy(desc(wholesalePlanVersion.versionNumber))
        .limit(1);

      const nextVersionNumber = (existingVersions[0]?.versionNumber ?? 0) + 1;
      const versionId = this.makeId("wpver");

      const baseFee = BigInt(input.baseFee ?? 0);
      const depositRequirement = BigInt(input.depositRequirement ?? 0);

      const [version] = await tx
        .insert(wholesalePlanVersion)
        .values({
          id: versionId,
          planId,
          versionNumber: nextVersionNumber,
          name: input.name ?? `${plan.name} v${nextVersionNumber}`,
          description: input.description ?? plan.description,
          billingPeriod: (input.billingPeriod as any) || "annual",
          durationDays: input.durationDays ?? 365,
          baseFee,
          depositRequirement,
          status: "draft",
          changeSummary: input.changeSummary ?? null,
        })
        .returning();

      // Add features
      const features: any[] = [];
      if (input.features && input.features.length > 0) {
        for (const f of input.features) {
          const featId = this.makeId("wpfeat");
          const [feat] = await tx
            .insert(wholesalePlanFeature)
            .values({
              id: featId,
              planVersionId: versionId,
              featureKey: f.key,
              featureType: (f.type as any) || "boolean",
              isEnabled: f.isEnabled ?? true,
              configValue: f.configValue ?? {},
              description: f.description ?? null,
            })
            .returning();
          features.push(feat);
        }
      }

      // Add limits
      const limits: any[] = [];
      if (input.limits && input.limits.length > 0) {
        for (const l of input.limits) {
          const limitId = this.makeId("wplim");
          const [lim] = await tx
            .insert(wholesalePlanLimit)
            .values({
              id: limitId,
              planVersionId: versionId,
              limitKey: l.key,
              limitValue: BigInt(l.value),
              period: (l.period as any) || "order",
              isEnforced: l.isEnforced ?? true,
            })
            .returning();
          limits.push(lim);
        }
      }

      if (this.auditService && actorId) {
        await this.auditService.record({
          action: "wholesale_plan_version.created",
          entityType: "wholesale_plan_version",
          entityId: versionId,
          actorId,
          metadata: { planId, versionNumber: nextVersionNumber },
        });
      }

      return {
        ...version,
        features,
        limits,
      };
    });
  }

  async addFeature(versionId: string, feature: FeatureInput) {
    const [version] = await this.db
      .select()
      .from(wholesalePlanVersion)
      .where(eq(wholesalePlanVersion.id, versionId))
      .limit(1);

    if (!version) {
      throw new WholesalePlanVersionNotFoundError(versionId);
    }
    if (version.status !== "draft") {
      throw new WholesalePlanImmutableError(versionId, version.status);
    }

    const featId = this.makeId("wpfeat");
    const [created] = await this.db
      .insert(wholesalePlanFeature)
      .values({
        id: featId,
        planVersionId: versionId,
        featureKey: feature.key,
        featureType: (feature.type as any) || "boolean",
        isEnabled: feature.isEnabled ?? true,
        configValue: feature.configValue ?? {},
        description: feature.description ?? null,
      })
      .returning();

    return created;
  }

  async addLimit(versionId: string, limit: LimitInput) {
    const [version] = await this.db
      .select()
      .from(wholesalePlanVersion)
      .where(eq(wholesalePlanVersion.id, versionId))
      .limit(1);

    if (!version) {
      throw new WholesalePlanVersionNotFoundError(versionId);
    }
    if (version.status !== "draft") {
      throw new WholesalePlanImmutableError(versionId, version.status);
    }

    const limitId = this.makeId("wplim");
    const [created] = await this.db
      .insert(wholesalePlanLimit)
      .values({
        id: limitId,
        planVersionId: versionId,
        limitKey: limit.key,
        limitValue: BigInt(limit.value),
        period: (limit.period as any) || "order",
        isEnforced: limit.isEnforced ?? true,
      })
      .returning();

    return created;
  }

  async publishPlanVersion(planId: string, versionId: string, actorId: string) {
    return await this.db.transaction(async (tx) => {
      const [version] = await tx
        .select()
        .from(wholesalePlanVersion)
        .where(and(eq(wholesalePlanVersion.id, versionId), eq(wholesalePlanVersion.planId, planId)))
        .limit(1);

      if (!version) {
        throw new WholesalePlanVersionNotFoundError(versionId);
      }
      if (version.status !== "draft") {
        throw new WholesalePlanImmutableError(versionId, version.status);
      }

      // Mark all previously published versions for this plan as superseded
      await tx
        .update(wholesalePlanVersion)
        .set({
          status: "superseded",
          effectiveTo: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(wholesalePlanVersion.planId, planId),
            eq(wholesalePlanVersion.status, "published"),
          ),
        );

      // Publish this version
      const now = new Date();
      const [published] = await tx
        .update(wholesalePlanVersion)
        .set({
          status: "published",
          publishedBy: actorId,
          publishedAt: now,
          effectiveFrom: now,
          updatedAt: now,
        })
        .where(eq(wholesalePlanVersion.id, versionId))
        .returning();

      // Update plan identity to active and point to current published version
      await tx
        .update(wholesalePlan)
        .set({
          status: "active",
          currentPublishedVersionId: versionId,
          updatedAt: now,
        })
        .where(eq(wholesalePlan.id, planId));

      if (this.auditService) {
        await this.auditService.record({
          action: "wholesale_plan_version.published",
          entityType: "wholesale_plan_version",
          entityId: versionId,
          actorId,
          metadata: { planId, versionNumber: version.versionNumber },
        });
      }

      return published;
    });
  }

  async createNewVersionFromPublished(planId: string, changeSummary: string, actorId: string) {
    const plan = await this.getPlan(planId);
    if (!plan.currentPublishedVersion) {
      throw new WholesalePlanError(
        "NO_PUBLISHED_VERSION",
        `Cannot fork from plan '${planId}' because it has no published version`,
      );
    }

    const current = plan.currentPublishedVersion;
    return await this.createPlanVersion(
      planId,
      {
        name: `${plan.name} v${current.versionNumber + 1}`,
        description: current.description ?? undefined,
        billingPeriod: current.billingPeriod as any,
        durationDays: current.durationDays,
        baseFee: current.baseFee,
        depositRequirement: current.depositRequirement,
        changeSummary,
        features: (current.features || []).map((f: any) => ({
          key: f.featureKey,
          type: f.featureType,
          isEnabled: f.isEnabled,
          configValue: f.configValue,
          description: f.description,
        })),
        limits: (current.limits || []).map((l: any) => ({
          key: l.limitKey,
          value: l.limitValue,
          period: l.period,
          isEnforced: l.isEnforced,
        })),
      },
      actorId,
    );
  }

  async getPlan(planId: string) {
    const [plan] = await this.db
      .select()
      .from(wholesalePlan)
      .where(eq(wholesalePlan.id, planId))
      .limit(1);

    if (!plan) {
      throw new WholesalePlanNotFoundError(planId);
    }

    let currentPublishedVersion: any = null;
    if (plan.currentPublishedVersionId) {
      currentPublishedVersion = await this.getPlanVersion(plan.currentPublishedVersionId);
    }

    return {
      ...plan,
      currentPublishedVersion,
    };
  }

  async getPlanByCode(code: string) {
    const [plan] = await this.db
      .select()
      .from(wholesalePlan)
      .where(eq(wholesalePlan.code, code))
      .limit(1);

    if (!plan) {
      throw new WholesalePlanNotFoundError(code);
    }

    let currentPublishedVersion: any = null;
    if (plan.currentPublishedVersionId) {
      currentPublishedVersion = await this.getPlanVersion(plan.currentPublishedVersionId);
    }

    return {
      ...plan,
      currentPublishedVersion,
    };
  }

  async getPlanVersion(versionId: string) {
    const [version] = await this.db
      .select()
      .from(wholesalePlanVersion)
      .where(eq(wholesalePlanVersion.id, versionId))
      .limit(1);

    if (!version) {
      throw new WholesalePlanVersionNotFoundError(versionId);
    }

    const features = await this.db
      .select()
      .from(wholesalePlanFeature)
      .where(eq(wholesalePlanFeature.planVersionId, versionId));

    const limits = await this.db
      .select()
      .from(wholesalePlanLimit)
      .where(eq(wholesalePlanLimit.planVersionId, versionId));

    return {
      ...version,
      features,
      limits,
    };
  }

  async listPlans(opts?: { status?: string }) {
    let query = this.db.select().from(wholesalePlan);
    if (opts?.status) {
      query = query.where(eq(wholesalePlan.status, opts.status)) as any;
    }
    const plans = await query.orderBy(wholesalePlan.sortOrder, wholesalePlan.createdAt);

    const result = [];
    for (const p of plans) {
      let currentPublishedVersion = null;
      if (p.currentPublishedVersionId) {
        currentPublishedVersion = await this.getPlanVersion(p.currentPublishedVersionId);
      }
      result.push({
        ...p,
        currentPublishedVersion,
      });
    }
    return result;
  }

  async listVersions(planId: string) {
    const versions = await this.db
      .select()
      .from(wholesalePlanVersion)
      .where(eq(wholesalePlanVersion.planId, planId))
      .orderBy(desc(wholesalePlanVersion.versionNumber));

    const result = [];
    for (const v of versions) {
      const features = await this.db
        .select()
        .from(wholesalePlanFeature)
        .where(eq(wholesalePlanFeature.planVersionId, v.id));

      const limits = await this.db
        .select()
        .from(wholesalePlanLimit)
        .where(eq(wholesalePlanLimit.planVersionId, v.id));

      result.push({
        ...v,
        features,
        limits,
      });
    }
    return result;
  }
}
