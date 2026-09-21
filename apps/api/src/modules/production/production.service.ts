import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, sql } from "drizzle-orm";
import {
  productionArtifact,
  productionCapacityReservation,
  productionChangeDecision,
  productionChangeRequest,
  productionCommand,
  productionEvent,
  productionJob,
  productionJobHistory,
  productionJobMilestone,
  productionLot,
  productionLotTrace,
  productionMilestoneDefinition,
  productionRecall,
  productionRecallApproval,
  approvalRequest,
  productionRecallScope,
  productionSample,
  productionSampleReview,
  productionSampleRevision,
  qualityChecklist,
  qualityChecklistItem,
  qualityDefect,
  qualityInspection,
  qualityInspectionItem,
  qualityRelease,
  qualityRework,
  supplierCapability,
  supplierCapacityPeriod,
  supplierClosure,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { AdminApprovalsService } from "../admin/admin-approvals.service";
import { OrdersService, type ProductionEligibilityContext } from "../orders/orders.service";
import { SuppliersService } from "../suppliers/suppliers.service";
import {
  assertArtifactMetadata,
  assertChangeBoundary,
  assertInspectionArithmetic,
  assertOneOf,
  assertProductionPermission,
  assertRecallScope,
  assertTransition,
  availableCapacity,
  CHANGE_TRANSITIONS,
  DEFECT_TRANSITIONS,
  id,
  INSPECTION_TRANSITIONS,
  JOB_TRANSITIONS,
  LOT_TRANSITIONS,
  MILESTONE_TRANSITIONS,
  pageInput,
  pageResult,
  ProductionDomainError,
  RECALL_TRANSITIONS,
  RELEASE_TRANSITIONS,
  requireSafeInteger,
  requireText,
  requestHash,
  REWORK_TRANSITIONS,
  SAMPLE_TRANSITIONS,
  optionalText,
  PRODUCTION_ALLOWED_DEFECT_SEVERITIES,
  PRODUCTION_ALLOWED_DEFECT_STATUSES,
  PRODUCTION_ALLOWED_INSPECTION_STATUSES,
  PRODUCTION_ALLOWED_LOT_STATUSES,
  PRODUCTION_ALLOWED_MEASUREMENT_TYPES,
  PRODUCTION_ALLOWED_MILESTONE_STATUSES,
  PRODUCTION_ALLOWED_RELEASE_STATUSES,
  PRODUCTION_ALLOWED_REWORK_STATUSES,
  PRODUCTION_ALLOWED_SAMPLE_REVIEW_DECISIONS,
  PRODUCTION_ALLOWED_SAMPLE_STATUSES,
} from "./production.logic";
import type { ProductionShippingHandoff } from "./production.contract";
import {
  PRODUCTION_ARTIFACT_TYPES,
  PRODUCTION_CHANGE_DECISIONS,
  PRODUCTION_CHANGE_OWNER_DOMAINS,
  PRODUCTION_CHANGE_STATUSES,
  PRODUCTION_CHANGE_TYPES,
  PRODUCTION_EVENT_TYPES,
  PRODUCTION_JOB_STATUSES,
  PRODUCTION_MILESTONE_STATUSES,
  PRODUCTION_MILESTONE_DEFINITION_STATUSES,
  PRODUCTION_SAMPLE_REVIEW_DECISIONS,
  PRODUCTION_SAMPLE_STATUSES,
  PRODUCTION_SAMPLE_TYPES,
  PRODUCTION_RECALL_STATUSES,
  PRODUCTION_RECALL_SCOPE_TYPES,
  PRODUCTION_RECALL_SEVERITIES,
  QUALITY_CHECKLIST_STATUSES,
  QUALITY_DEFECT_SEVERITIES,
  QUALITY_DEFECT_STATUSES,
  QUALITY_INSPECTION_DECISIONS,
  QUALITY_INSPECTION_STATUSES,
  QUALITY_MEASUREMENT_TYPES,
  QUALITY_RELEASE_STATUSES,
  QUALITY_REWORK_STATUSES,
  PRODUCTION_LOT_STATUSES,
  SUPPLIER_CAPACITY_PERIOD_STATUSES,
  SUPPLIER_CAPABILITY_STATUSES,
  SUPPLIER_CLOSURE_STATUSES,
  PRODUCTION_CAPACITY_RESERVATION_STATUSES,
} from "@kolbe/database";

type Tx = Parameters<Parameters<KolbeDatabase["transaction"]>[0]>[0];
type DbOrTx = KolbeDatabase | Tx;

type ProductionActor = { userId: string; role: "supplier" | "admin" };
type Member = { supplierId: string; role: "owner" | "sales" | "warehouse" | "finance"; sellerId?: string | null };

function jsonSafe(value: unknown, depth = 0): unknown {
  if (depth > 4) throw new ProductionDomainError("JSON_TOO_DEEP", "Payload nesting is too deep");
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    if (typeof value === "string" && value.length > 5000) throw new ProductionDomainError("JSON_TOO_LARGE", "Text payload is too large");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new ProductionDomainError("JSON_NUMBER_INVALID", "Operational JSON numbers must be safe integers");
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw new ProductionDomainError("JSON_TOO_LARGE", "Array payload is too large");
    return value.map((item) => jsonSafe(item, depth + 1));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 100) throw new ProductionDomainError("JSON_TOO_LARGE", "Object payload is too large");
    const result: Record<string, unknown> = {};
    for (const [key, item] of entries) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new ProductionDomainError("INVALID_PAYLOAD_KEY", "Unsafe payload key");
      result[key] = jsonSafe(item, depth + 1);
    }
    return result;
  }
  throw new ProductionDomainError("JSON_VALUE_INVALID", "Unsupported operational JSON value");
}

@Injectable()
export class ProductionService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AdminApprovalsService) private readonly approvals: AdminApprovalsService,
  ) {}

  private async withTx<T>(executor: DbOrTx | undefined, work: (tx: any) => Promise<T>): Promise<T> {
    if (executor) return work(executor as any);
    return this.db.transaction(async (tx) => work(tx as any));
  }

  private async membersForActor(actor: ProductionActor, executor?: DbOrTx): Promise<Member[]> {
    if (actor.role === "admin") return [];
    return (await this.suppliers.getUserMemberships(actor.userId, executor)).map((member: any) => ({
      supplierId: member.supplierId,
      role: member.role,
      sellerId: member.sellerId,
    }));
  }

  private async assertSupplierMember(actor: ProductionActor, supplierId: string, action: string, executor?: DbOrTx): Promise<Member | null> {
    if (actor.role === "admin") return null;
    const member = (await this.membersForActor(actor, executor)).find((candidate) => candidate.supplierId === supplierId);
    if (!member) throw new ProductionDomainError("SUPPLIER_OWNERSHIP_VIOLATION", "Production resource is outside the authenticated supplier", 403);
    assertProductionPermission(member.role, action);
    return member;
  }

  private async resolveSupplierForActor(actor: ProductionActor, requestedSupplierId?: string | null, executor?: DbOrTx): Promise<string> {
    if (actor.role === "admin") {
      if (!requestedSupplierId) throw new ProductionDomainError("SUPPLIER_ID_REQUIRED", "Admin must provide a supplier scope");
      return requestedSupplierId;
    }
    const members = await this.membersForActor(actor, executor);
    if (members.length !== 1) throw new ProductionDomainError("SUPPLIER_CONTEXT_AMBIGUOUS", "Authenticated supplier context is ambiguous; use a job-scoped operation", 409);
    return members[0].supplierId;
  }

  private async jobForAccess(tx: any, actor: ProductionActor, jobId: string, action: string, lock = false): Promise<any> {
    let query = tx.select().from(productionJob).where(eq(productionJob.id, jobId)).limit(1);
    if (lock) query = query.for("update");
    const [job] = await query;
    if (!job) throw new ProductionDomainError("PRODUCTION_JOB_NOT_FOUND", "Production job not found", 404);
    await this.assertSupplierMember(actor, job.supplierId, action, tx);
    return job;
  }

  private async claimCommand(tx: any, scopeType: string, scopeId: string, commandType: string, key: string, payload: unknown) {
    if (!key || key.trim().length < 8 || key.length > 200) throw new ProductionDomainError("IDEMPOTENCY_KEY_REQUIRED", "A bounded Idempotency-Key is required");
    const hash = requestHash(payload);
    const [inserted] = await tx
      .insert(productionCommand)
      .values({ id: id("pcmd"), scopeType, scopeId, commandType, idempotencyKey: key, requestHash: hash, state: "pending" })
      .onConflictDoNothing()
      .returning();
    if (inserted) return { replayed: false, command: inserted };
    const [existing] = await tx
      .select()
      .from(productionCommand)
      .where(and(eq(productionCommand.scopeType, scopeType), eq(productionCommand.scopeId, scopeId), eq(productionCommand.commandType, commandType), eq(productionCommand.idempotencyKey, key)))
      .for("update")
      .limit(1);
    if (!existing) throw new ProductionDomainError("IDEMPOTENCY_CLAIM_RACE", "Idempotency claim was not found; retry", 409);
    if (existing.requestHash !== hash) throw new ProductionDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key was reused with a different payload", 409);
    if (existing.state === "pending") throw new ProductionDomainError("COMMAND_IN_PROGRESS", "The same production command is already in progress", 409);
    if (existing.state === "completed") return { replayed: true, command: existing };
    await tx.update(productionCommand).set({ state: "pending", updatedAt: new Date() }).where(eq(productionCommand.id, existing.id));
    return { replayed: false, command: existing };
  }

  private async completeCommand(tx: any, commandId: string, resourceId: string, payload: unknown): Promise<void> {
    await tx.update(productionCommand).set({ state: "completed", resultResourceId: resourceId, resultPayload: jsonSafe(payload) as any, completedAt: new Date(), updatedAt: new Date() }).where(eq(productionCommand.id, commandId));
  }

  private async appendHistory(tx: any, input: { jobId: string; eventType: string; fromStatus?: string | null; toStatus?: string | null; milestoneId?: string | null; metadata?: unknown; actorId?: string | null }): Promise<any> {
    const [history] = await tx.insert(productionJobHistory).values({
      id: id("pjh"),
      jobId: input.jobId,
      eventType: input.eventType,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      milestoneId: input.milestoneId ?? null,
      metadata: jsonSafe(input.metadata ?? {}) as any,
      actorId: input.actorId ?? null,
    }).returning();
    return history;
  }

  private async emit(tx: any, input: { eventType: string; entityType: string; entityId: string; jobId?: string | null; supplierId: string; recipientScope?: string | null; recipientId?: string | null; payload?: unknown }): Promise<void> {
    if (!(PRODUCTION_EVENT_TYPES as readonly string[]).includes(input.eventType)) throw new ProductionDomainError("EVENT_TYPE_INVALID", "Production event type is not allowed");
    await tx.insert(productionEvent).values({
      id: id("pevt"),
      eventType: input.eventType,
      sourceEntityType: input.entityType,
      sourceEntityId: input.entityId,
      jobId: input.jobId ?? null,
      supplierId: input.supplierId,
      recipientScope: input.recipientScope ?? null,
      recipientId: input.recipientId ?? null,
      payload: jsonSafe(input.payload ?? {}) as any,
    }).onConflictDoNothing();
  }

  private async recordAudit(tx: any, actor: ProductionActor | null, action: string, entityType: string, entityId: string, metadata?: unknown): Promise<void> {
    await this.audit.record({ actorId: actor?.userId ?? null, actorRole: actor?.role ?? "system", action, entityType, entityId, metadata: jsonSafe(metadata ?? {}) as any }, tx);
  }

  private parseDate(value: unknown, field: string): Date | null {
    if (value === undefined || value === null || value === "") return null;
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new ProductionDomainError("INVALID_DATE", `${field} is not a valid date`);
    return date;
  }

  // ── Jobs, milestones and order linkage ───────────────────────────────────

  async createMilestoneDefinition(actor: ProductionActor, input: { milestoneKey: unknown; label: unknown; sequence: unknown; required?: boolean; defaultDurationDays?: unknown }) {
    if (actor.role !== "admin") throw new ProductionDomainError("ROLE_NOT_ALLOWED", "Only Admin can configure milestone definitions", 403);
    const milestoneKey = requireText(input.milestoneKey, "milestoneKey", 100);
    const label = requireText(input.label, "label", 200);
    const sequence = requireSafeInteger(input.sequence, "sequence", 1);
    const defaultDurationDays = input.defaultDurationDays === undefined || input.defaultDurationDays === null ? null : requireSafeInteger(input.defaultDurationDays, "defaultDurationDays", 0);
    const [created] = await this.db.insert(productionMilestoneDefinition).values({ id: id("pmdef"), milestoneKey, label, sequence, required: input.required !== false, defaultDurationDays, status: "active", createdBy: actor.userId }).returning();
    await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "production.milestone_definition_created", entityType: "production_milestone_definition", entityId: created.id, metadata: { milestoneKey, sequence } });
    return created;
  }

  async listMilestoneDefinitions(actor: ProductionActor) {
    if (actor.role !== "admin") {
      const members = await this.membersForActor(actor);
      if (members.length === 0) return [];
    }
    return this.db.select().from(productionMilestoneDefinition).where(eq(productionMilestoneDefinition.status, "active")).orderBy(asc(productionMilestoneDefinition.sequence));
  }

  async createJob(actor: ProductionActor, input: { purchaseOrderId: string; requiresSampleApproval?: boolean; requiresQualityRelease?: boolean; idempotencyKey: string }, executor?: DbOrTx) {
    return this.withTx(executor, async (tx) => {
      const context = await this.orders.getProductionEligibility({ childOrderId: input.purchaseOrderId, executor: tx, lock: true });
      if (!context.child.supplierId) throw new ProductionDomainError("SUPPLIER_CHILD_REQUIRED", "Production can only extend a supplier child order", 422);
      const member = await this.assertSupplierMember(actor, context.child.supplierId, "create_job", tx);
      if (actor.role === "supplier" && !member) throw new ProductionDomainError("SUPPLIER_OWNERSHIP_VIOLATION", "Supplier membership is required", 403);
      if (!["confirmed", "preparing"].includes(context.child.status)) throw new ProductionDomainError("ORDER_NOT_PRODUCTION_ELIGIBLE", `Child order status ${context.child.status} cannot start production`, 422);
      const claim = await this.claimCommand(tx, "purchase_order", context.child.id, "production.job_create", input.idempotencyKey, { purchaseOrderId: context.child.id, requiresSampleApproval: input.requiresSampleApproval !== false, requiresQualityRelease: input.requiresQualityRelease !== false });
      if (claim.replayed) return { job: await this.getJobById(tx, claim.command.resultResourceId), replayed: true };
      const [job] = await tx.insert(productionJob).values({
        id: id("pjob"),
        purchaseOrderId: context.child.id,
        supplierId: context.child.supplierId,
        sellerId: context.child.sellerId,
        purchaseOrderVersion: context.child.version,
        status: "draft",
        targetUnits: context.targetUnits,
        actualUnits: 0,
        requiresSampleApproval: input.requiresSampleApproval !== false,
        requiresQualityRelease: input.requiresQualityRelease !== false,
        createdBy: actor.userId,
      }).returning();
      const definitions = await tx.select().from(productionMilestoneDefinition)
        .where(eq(productionMilestoneDefinition.status, "active"))
        .orderBy(asc(productionMilestoneDefinition.sequence));
      for (const definition of definitions) {
        await tx.insert(productionJobMilestone).values({ id: id("pms"), jobId: job.id, definitionId: definition.id, milestoneKey: definition.milestoneKey, labelSnapshot: definition.label, sequence: definition.sequence, required: definition.required, status: "pending" });
      }
      const history = await this.appendHistory(tx, { jobId: job.id, eventType: "created", toStatus: "draft", actorId: actor.userId, metadata: { purchaseOrderId: context.child.id, purchaseOrderVersion: context.child.version, targetUnits: context.targetUnits } });
      await this.emit(tx, { eventType: "JOB_CREATED", entityType: "production_job_history", entityId: history.id, jobId: job.id, supplierId: job.supplierId, recipientScope: "SUPPLIER", recipientId: job.supplierId, payload: { productionJobId: job.id, purchaseOrderId: job.purchaseOrderId, targetUnits: job.targetUnits } });
      await this.recordAudit(tx, actor, "production.job_created", "production_job", job.id, { purchaseOrderId: job.purchaseOrderId, targetUnits: job.targetUnits });
      await this.completeCommand(tx, claim.command.id, job.id, { jobId: job.id });
      return { job, replayed: false };
    });
  }

  private async getJobById(tx: any, jobId: string | null | undefined): Promise<any> {
    if (!jobId) throw new ProductionDomainError("PRODUCTION_JOB_NOT_FOUND", "Production command has no result job", 404);
    const [job] = await tx.select().from(productionJob).where(eq(productionJob.id, jobId)).limit(1);
    if (!job) throw new ProductionDomainError("PRODUCTION_JOB_NOT_FOUND", "Production job not found", 404);
    return job;
  }

  async getJob(actor: ProductionActor, jobId: string) {
    return this.withTx(undefined, async (tx) => {
      const job = await this.jobForAccess(tx, actor, jobId, "read");
      const milestones = await tx.select().from(productionJobMilestone).where(eq(productionJobMilestone.jobId, jobId)).orderBy(asc(productionJobMilestone.sequence));
      const samples = await tx.select().from(productionSample).where(eq(productionSample.jobId, jobId)).orderBy(desc(productionSample.createdAt));
      const lots = await tx.select().from(productionLot).where(eq(productionLot.jobId, jobId)).orderBy(desc(productionLot.createdAt));
      const changes = await tx.select().from(productionChangeRequest).where(eq(productionChangeRequest.jobId, jobId)).orderBy(desc(productionChangeRequest.createdAt));
      return { job, milestones, samples, lots, changes };
    });
  }

  async listJobs(actor: ProductionActor, input: { page?: unknown; limit?: unknown; status?: unknown; supplierId?: string | null }) {
    const { page, limit, offset } = pageInput(input.page, input.limit);
    const statuses = input.status ? [assertOneOf(input.status, PRODUCTION_JOB_STATUSES, "status")] : [];
    const supplierIds = actor.role === "admin"
      ? (input.supplierId ? [input.supplierId] : [])
      : (await this.membersForActor(actor)).map((member) => member.supplierId);
    if (actor.role === "supplier" && supplierIds.length === 0) return pageResult([], page, limit);
    const conditions = [] as any[];
    if (supplierIds.length > 0) conditions.push(inArray(productionJob.supplierId, supplierIds));
    if (statuses.length > 0) conditions.push(inArray(productionJob.status, statuses));
    const rows = await this.db.select().from(productionJob).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(productionJob.createdAt)).limit(limit).offset(offset);
    return pageResult(rows, page, limit);
  }

  async transitionJob(actor: ProductionActor, jobId: string, toStatus: string, input: { idempotencyKey: string; expectedVersion?: number; reason?: string }) {
    return this.withTx(undefined, async (tx) => {
      const job = await this.jobForAccess(tx, actor, jobId, "progress_job", true);
      assertOneOf(toStatus, PRODUCTION_JOB_STATUSES, "status");
      const claim = await this.claimCommand(tx, "production_job", job.id, `production.job_${toStatus}`, input.idempotencyKey, { jobId, toStatus, expectedVersion: input.expectedVersion ?? null, reason: input.reason ?? null });
      if (claim.replayed) return { job: await this.getJobById(tx, job.id), replayed: true };
      assertTransition(JOB_TRANSITIONS, job.status, toStatus);
      if (input.expectedVersion !== undefined && job.version !== input.expectedVersion) throw new ProductionDomainError("VERSION_CONFLICT", "Production job version changed", 409);
      if (toStatus === "planned") {
        const [reservation] = await tx.select().from(productionCapacityReservation).where(and(eq(productionCapacityReservation.jobId, job.id), inArray(productionCapacityReservation.status, ["reserved", "consumed"]))).limit(1);
        if (!reservation) throw new ProductionDomainError("CAPACITY_RESERVATION_REQUIRED", "A capacity reservation is required before planning", 422);
      }
      if (toStatus === "in_progress" && job.requiresSampleApproval) {
        const [finalSample] = await tx.select().from(productionSample).where(and(eq(productionSample.jobId, job.id), eq(productionSample.sampleType, "final"), eq(productionSample.status, "approved"))).limit(1);
        if (!finalSample) throw new ProductionDomainError("FINAL_SAMPLE_GATE_BLOCKED", "An approved final sample is required before production starts", 422);
      }
      if (toStatus === "completed" && job.actualUnits <= 0) throw new ProductionDomainError("ACTUAL_UNITS_REQUIRED", "Record actual production units before completion", 422);
      const now = new Date();
      const patch: any = { status: toStatus, version: job.version + 1, updatedAt: now };
      if (toStatus === "in_progress") patch.startedAt = now;
      if (toStatus === "completed") patch.completedAt = now;
      if (toStatus === "cancelled") { patch.cancelledAt = now; patch.cancellationReason = requireText(input.reason, "reason", 1000); }
      const [updated] = await tx.update(productionJob).set(patch).where(eq(productionJob.id, job.id)).returning();
      const history = await this.appendHistory(tx, { jobId: job.id, eventType: "status_changed", fromStatus: job.status, toStatus, actorId: actor.userId, metadata: { reason: input.reason ?? null, version: updated.version } });
      await this.emit(tx, { eventType: "JOB_STATUS_CHANGED", entityType: "production_job_history", entityId: history.id, jobId: job.id, supplierId: job.supplierId, recipientScope: "SUPPLIER", recipientId: job.supplierId, payload: { productionJobId: job.id, fromStatus: job.status, toStatus } });
      await this.recordAudit(tx, actor, "production.job_status_changed", "production_job", job.id, { fromStatus: job.status, toStatus });
      await this.completeCommand(tx, claim.command.id, job.id, { jobId: job.id, status: toStatus });
      return { job: updated, replayed: false };
    });
  }

  async recordActualUnits(actor: ProductionActor, jobId: string, units: unknown, input: { idempotencyKey: string; expectedVersion?: number }) {
    const actualUnits = requireSafeInteger(units, "actualUnits", 0);
    return this.withTx(undefined, async (tx) => {
      const job = await this.jobForAccess(tx, actor, jobId, "progress_job", true);
      if (actualUnits > job.targetUnits) throw new ProductionDomainError("ACTUAL_UNITS_OVER_TARGET", "Actual production cannot exceed the server target", 422);
      const claim = await this.claimCommand(tx, "production_job", job.id, "production.actual_units", input.idempotencyKey, { jobId, actualUnits, expectedVersion: input.expectedVersion ?? null });
      if (claim.replayed) return { job: await this.getJobById(tx, job.id), replayed: true };
      if (!["in_progress", "blocked"].includes(job.status)) throw new ProductionDomainError("JOB_NOT_RECORDABLE", `Actual units cannot be recorded from ${job.status}`, 409);
      if (input.expectedVersion !== undefined && job.version !== input.expectedVersion) throw new ProductionDomainError("VERSION_CONFLICT", "Production job version changed", 409);
      const [reservation] = await tx.select().from(productionCapacityReservation).where(and(eq(productionCapacityReservation.jobId, job.id), inArray(productionCapacityReservation.status, ["reserved", "consumed"]))).for("update").limit(1);
      if (reservation) {
        await this.lockSupplierCapacity(tx, job.supplierId);
        const [period] = await tx.select().from(supplierCapacityPeriod).where(eq(supplierCapacityPeriod.id, reservation.capacityPeriodId)).for("update").limit(1);
        if (!period) throw new ProductionDomainError("CAPACITY_PERIOD_NOT_FOUND", "Capacity period not found for reservation", 409);
        const actualDelta = actualUnits - job.actualUnits;
        if (period.actualUnits + actualDelta < 0) throw new ProductionDomainError("CAPACITY_ACTUAL_INVARIANT", "Actual production units cannot be negative", 409);
        await tx.update(supplierCapacityPeriod).set({ actualUnits: period.actualUnits + actualDelta, updatedAt: new Date() }).where(eq(supplierCapacityPeriod.id, period.id));
        if (actualUnits > 0 && reservation.status === "reserved") {
          await tx.update(productionCapacityReservation).set({ status: "consumed", consumedAt: new Date(), updatedAt: new Date() }).where(eq(productionCapacityReservation.id, reservation.id));
        }
      }
      const [updated] = await tx.update(productionJob).set({ actualUnits, version: job.version + 1, updatedAt: new Date() }).where(eq(productionJob.id, job.id)).returning();
      const history = await this.appendHistory(tx, { jobId, eventType: "actual_units_recorded", actorId: actor.userId, metadata: { actualUnits, version: updated.version, capacityReservationId: reservation?.id ?? null } });
      await this.recordAudit(tx, actor, "production.actual_units_recorded", "production_job", jobId, { actualUnits });
      await this.completeCommand(tx, claim.command.id, jobId, { jobId, actualUnits });
      return { job: updated, history, replayed: false };
    });
  }

  async transitionMilestone(actor: ProductionActor, jobId: string, milestoneId: string, toStatus: string, input: { idempotencyKey: string; reason?: string }) {
    return this.withTx(undefined, async (tx) => {
      const job = await this.jobForAccess(tx, actor, jobId, "progress_job", true);
      const [milestone] = await tx.select().from(productionJobMilestone).where(and(eq(productionJobMilestone.id, milestoneId), eq(productionJobMilestone.jobId, job.id))).for("update").limit(1);
      if (!milestone) throw new ProductionDomainError("MILESTONE_NOT_FOUND", "Milestone not found", 404);
      assertOneOf(toStatus, PRODUCTION_MILESTONE_STATUSES, "status");
      if (toStatus === "skipped" && actor.role !== "admin") throw new ProductionDomainError("ROLE_NOT_ALLOWED", "Only Admin can skip a milestone", 403);
      if (toStatus === "skipped" && !input.reason) throw new ProductionDomainError("REASON_REQUIRED", "A skip reason is required");
      const claim = await this.claimCommand(tx, "production_milestone", milestone.id, "production.milestone_transition", input.idempotencyKey, { jobId, milestoneId, toStatus, reason: input.reason ?? null });
      if (claim.replayed) return { milestone: await this.getMilestone(tx, milestone.id), replayed: true };
      assertTransition(MILESTONE_TRANSITIONS, milestone.status, toStatus, "INVALID_MILESTONE_TRANSITION");
      const now = new Date();
      const patch: any = { status: toStatus, version: milestone.version + 1, updatedAt: now, updatedBy: actor.userId };
      if (toStatus === "in_progress") patch.startedAt = now;
      if (toStatus === "completed") patch.completedAt = now;
      if (toStatus === "skipped") { patch.skippedAt = now; patch.reason = requireText(input.reason, "reason", 1000); }
      const [updated] = await tx.update(productionJobMilestone).set(patch).where(eq(productionJobMilestone.id, milestone.id)).returning();
      const history = await this.appendHistory(tx, { jobId: job.id, eventType: "milestone_changed", milestoneId: milestone.id, actorId: actor.userId, metadata: { fromStatus: milestone.status, toStatus, reason: input.reason ?? null } });
      await this.emit(tx, { eventType: "MILESTONE_CHANGED", entityType: "production_job_history", entityId: history.id, jobId: job.id, supplierId: job.supplierId, recipientScope: "SUPPLIER", recipientId: job.supplierId, payload: { milestoneId: milestone.id, milestoneKey: milestone.milestoneKey, fromStatus: milestone.status, toStatus } });
      await this.completeCommand(tx, claim.command.id, milestone.id, { milestoneId: milestone.id, status: toStatus });
      return { milestone: updated, replayed: false };
    });
  }

  private async getMilestone(tx: any, milestoneId: string): Promise<any> {
    const [row] = await tx.select().from(productionJobMilestone).where(eq(productionJobMilestone.id, milestoneId)).limit(1);
    if (!row) throw new ProductionDomainError("MILESTONE_NOT_FOUND", "Milestone not found", 404);
    return row;
  }

  // ── Supplier capabilities, capacity periods, closures and reservations ──

  async createCapability(actor: ProductionActor, input: { supplierId?: string | null; capabilityCode: unknown; label: unknown; declaredUnitsPerPeriod?: unknown; metadata?: unknown }) {
    const supplierId = await this.resolveSupplierForActor(actor, input.supplierId);
    await this.assertSupplierMember(actor, supplierId, "manage_capacity");
    const capabilityCode = requireText(input.capabilityCode, "capabilityCode", 80);
    const label = requireText(input.label, "label", 200);
    const declaredUnitsPerPeriod = input.declaredUnitsPerPeriod === undefined || input.declaredUnitsPerPeriod === null ? null : requireSafeInteger(input.declaredUnitsPerPeriod, "declaredUnitsPerPeriod", 0);
    const [created] = await this.db.insert(supplierCapability).values({ id: id("scap"), supplierId, capabilityCode, label, status: "active", declaredUnitsPerPeriod, metadata: jsonSafe(input.metadata ?? {}) as any, createdBy: actor.userId }).onConflictDoNothing().returning();
    if (!created) throw new ProductionDomainError("CAPABILITY_ALREADY_EXISTS", "Capability code already exists for this supplier", 409);
    await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "production.capability_created", entityType: "supplier_capability", entityId: created.id, metadata: { supplierId, capabilityCode } });
    return created;
  }

  async listCapabilities(actor: ProductionActor, input: { supplierId?: string | null }) {
    const supplierId = await this.resolveSupplierForActor(actor, input.supplierId);
    await this.assertSupplierMember(actor, supplierId, "read");
    return this.db.select().from(supplierCapability).where(eq(supplierCapability.supplierId, supplierId)).orderBy(asc(supplierCapability.capabilityCode));
  }

  async createCapacityPeriod(actor: ProductionActor, input: { supplierId?: string | null; startsAt: unknown; endsAt: unknown; declaredUnits: unknown }) {
    const supplierId = await this.resolveSupplierForActor(actor, input.supplierId);
    await this.assertSupplierMember(actor, supplierId, "manage_capacity");
    const startsAt = this.parseDate(input.startsAt, "startsAt");
    const endsAt = this.parseDate(input.endsAt, "endsAt");
    if (!startsAt || !endsAt || endsAt <= startsAt) throw new ProductionDomainError("CAPACITY_WINDOW_INVALID", "Capacity period must have a positive time window");
    const declaredUnits = requireSafeInteger(input.declaredUnits, "declaredUnits", 1);
    return this.db.transaction(async (tx: any) => {
      await this.lockSupplierCapacity(tx, supplierId);
      const overlaps = await tx.select().from(supplierCapacityPeriod).where(and(eq(supplierCapacityPeriod.supplierId, supplierId), lt(supplierCapacityPeriod.startsAt, endsAt), gt(supplierCapacityPeriod.endsAt, startsAt))).for("update");
      if (overlaps.length > 0) throw new ProductionDomainError("CAPACITY_PERIOD_OVERLAP", "Capacity periods for a supplier cannot overlap", 409);
      const [period] = await tx.insert(supplierCapacityPeriod).values({ id: id("scapd"), supplierId, startsAt, endsAt, declaredUnits, reservedUnits: 0, unavailableUnits: 0, actualUnits: 0, status: "open", version: 0, createdBy: actor.userId }).returning();
      await this.recordAudit(tx, actor, "production.capacity_period_created", "supplier_capacity_period", period.id, { supplierId, declaredUnits, startsAt, endsAt });
      return period;
    });
  }

  async listCapacityPeriods(actor: ProductionActor, input: { supplierId?: string | null; page?: unknown; limit?: unknown }) {
    const supplierId = await this.resolveSupplierForActor(actor, input.supplierId);
    await this.assertSupplierMember(actor, supplierId, "read");
    const { page, limit, offset } = pageInput(input.page, input.limit);
    const rows = await this.db.select().from(supplierCapacityPeriod).where(eq(supplierCapacityPeriod.supplierId, supplierId)).orderBy(desc(supplierCapacityPeriod.startsAt)).limit(limit).offset(offset);
    return pageResult(rows.map((row: any) => ({ ...row, availableUnits: availableCapacity(row.declaredUnits, row.reservedUnits, row.unavailableUnits) })), page, limit);
  }

  async createClosure(actor: ProductionActor, input: { supplierId?: string | null; capacityPeriodId: string; startsAt: unknown; endsAt: unknown; unavailableUnits: unknown; reason: unknown }) {
    const supplierId = await this.resolveSupplierForActor(actor, input.supplierId);
    await this.assertSupplierMember(actor, supplierId, "manage_capacity");
    const startsAt = this.parseDate(input.startsAt, "startsAt");
    const endsAt = this.parseDate(input.endsAt, "endsAt");
    if (!startsAt || !endsAt || endsAt <= startsAt) throw new ProductionDomainError("CLOSURE_WINDOW_INVALID", "Closure must have a positive time window");
    const unavailableUnits = requireSafeInteger(input.unavailableUnits, "unavailableUnits", 1);
    const reason = requireText(input.reason, "reason", 1000);
    return this.db.transaction(async (tx: any) => {
      await this.lockSupplierCapacity(tx, supplierId);
      const [period] = await tx.select().from(supplierCapacityPeriod).where(and(eq(supplierCapacityPeriod.id, input.capacityPeriodId), eq(supplierCapacityPeriod.supplierId, supplierId))).for("update").limit(1);
      if (!period) throw new ProductionDomainError("CAPACITY_PERIOD_NOT_FOUND", "Capacity period not found", 404);
      if (period.status !== "open" || startsAt < new Date(period.startsAt) || endsAt > new Date(period.endsAt)) throw new ProductionDomainError("CAPACITY_PERIOD_CLOSED", "Closure must fit inside an open capacity period", 422);
      const overlap = await tx.select().from(supplierClosure).where(and(eq(supplierClosure.supplierId, supplierId), eq(supplierClosure.capacityPeriodId, period.id), inArray(supplierClosure.status, ["scheduled", "active"]), lt(supplierClosure.startsAt, endsAt), gt(supplierClosure.endsAt, startsAt))).for("update");
      if (overlap.length > 0) throw new ProductionDomainError("CLOSURE_OVERLAP", "Capacity closure overlaps an existing closure", 409);
      availableCapacity(period.declaredUnits, period.reservedUnits, period.unavailableUnits + unavailableUnits);
      const [closure] = await tx.insert(supplierClosure).values({ id: id("scl"), supplierId, capacityPeriodId: period.id, startsAt, endsAt, unavailableUnits, reason, status: "scheduled", createdBy: actor.userId }).returning();
      await tx.update(supplierCapacityPeriod).set({ unavailableUnits: period.unavailableUnits + unavailableUnits, version: period.version + 1, updatedAt: new Date() }).where(eq(supplierCapacityPeriod.id, period.id));
      await this.recordAudit(tx, actor, "production.capacity_closure_created", "supplier_closure", closure.id, { periodId: period.id, unavailableUnits });
      return closure;
    });
  }

  async cancelClosure(actor: ProductionActor, closureId: string, input: { idempotencyKey: string; reason: unknown }) {
    const reason = requireText(input.reason, "reason", 1000);
    return this.db.transaction(async (tx: any) => {
      const [closure] = await tx.select().from(supplierClosure).where(eq(supplierClosure.id, closureId)).for("update").limit(1);
      if (!closure) throw new ProductionDomainError("CLOSURE_NOT_FOUND", "Closure not found", 404);
      await this.assertSupplierMember(actor, closure.supplierId, "manage_capacity", tx);
      if (closure.status === "cancelled") return { closure, replayed: true };
      if (!(["scheduled", "active"] as string[]).includes(closure.status)) throw new ProductionDomainError("INVALID_CLOSURE_TRANSITION", `Cannot cancel closure from ${closure.status}`, 409);
      const claim = await this.claimCommand(tx, "supplier_closure", closure.id, "production.closure_cancel", input.idempotencyKey, { closureId, reason });
      if (claim.replayed) return { closure, replayed: true };
      const [period] = await tx.select().from(supplierCapacityPeriod).where(eq(supplierCapacityPeriod.id, closure.capacityPeriodId!)).for("update").limit(1);
      if (!period) throw new ProductionDomainError("CAPACITY_PERIOD_NOT_FOUND", "Capacity period not found", 404);
      if (period.reservedUnits + period.unavailableUnits - closure.unavailableUnits > period.declaredUnits) throw new ProductionDomainError("CAPACITY_INVARIANT", "Closure cancellation would violate capacity invariant", 409);
      const [updated] = await tx.update(supplierClosure).set({ status: "cancelled", updatedAt: new Date() }).where(eq(supplierClosure.id, closure.id)).returning();
      await tx.update(supplierCapacityPeriod).set({ unavailableUnits: period.unavailableUnits - closure.unavailableUnits, version: period.version + 1, updatedAt: new Date() }).where(eq(supplierCapacityPeriod.id, period.id));
      await this.recordAudit(tx, actor, "production.capacity_closure_cancelled", "supplier_closure", closure.id, { reason });
      await this.completeCommand(tx, claim.command.id, closure.id, { closureId, status: "cancelled" });
      return { closure: updated, replayed: false };
    });
  }

  private async lockSupplierCapacity(tx: any, supplierId: string): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${supplierId}, 5606))`);
  }

  private async reserveCapacityTx(tx: any, actor: ProductionActor, job: any, periodId: string, idempotencyKey: string) {
    await this.lockSupplierCapacity(tx, job.supplierId);
    const [existing] = await tx.select().from(productionCapacityReservation).where(eq(productionCapacityReservation.jobId, job.id)).for("update").limit(1);
    if (existing && ["reserved", "consumed"].includes(existing.status)) return existing;
    const [period] = await tx.select().from(supplierCapacityPeriod).where(eq(supplierCapacityPeriod.id, periodId)).for("update").limit(1);
    if (!period || period.supplierId !== job.supplierId) throw new ProductionDomainError("CAPACITY_PERIOD_NOT_FOUND", "Capacity period is not owned by the production supplier", 404);
    if (period.status !== "open") throw new ProductionDomainError("CAPACITY_PERIOD_CLOSED", "Capacity period is closed", 409);
    const startsAt = job.plannedStartAt ? new Date(job.plannedStartAt) : new Date(period.startsAt);
    const endsAt = job.plannedEndAt ? new Date(job.plannedEndAt) : new Date(period.endsAt);
    if (startsAt < new Date(period.startsAt) || endsAt > new Date(period.endsAt)) throw new ProductionDomainError("CAPACITY_WINDOW_INVALID", "Production window does not fit the capacity period", 422);
    const closures = await tx.select().from(supplierClosure).where(and(eq(supplierClosure.supplierId, job.supplierId), inArray(supplierClosure.status, ["scheduled", "active"]), lt(supplierClosure.startsAt, endsAt), gt(supplierClosure.endsAt, startsAt))).for("update");
    const closureUnits = closures.reduce((sum: number, closure: any) => sum + closure.unavailableUnits, 0);
    const available = availableCapacity(period.declaredUnits, period.reservedUnits, period.unavailableUnits);
    if (available < job.targetUnits || closureUnits > 0) throw new ProductionDomainError(closureUnits > 0 ? "CAPACITY_CLOSURE_CONFLICT" : "CAPACITY_INSUFFICIENT", "Capacity is not available for this production job", 409);
    const [reservation] = await tx.insert(productionCapacityReservation).values({ id: id("pcap"), supplierId: job.supplierId, capacityPeriodId: period.id, jobId: job.id, units: job.targetUnits, status: "reserved", idempotencyKey, createdBy: actor.userId }).returning();
    await tx.update(supplierCapacityPeriod).set({ reservedUnits: period.reservedUnits + job.targetUnits, version: period.version + 1, updatedAt: new Date() }).where(eq(supplierCapacityPeriod.id, period.id));
    const history = await this.appendHistory(tx, { jobId: job.id, eventType: "capacity_reserved", actorId: actor.userId, metadata: { reservationId: reservation.id, periodId: period.id, units: job.targetUnits } });
    await this.emit(tx, { eventType: "CAPACITY_RESERVED", entityType: "production_job_history", entityId: history.id, jobId: job.id, supplierId: job.supplierId, recipientScope: "SUPPLIER", recipientId: job.supplierId, payload: { reservationId: reservation.id, capacityPeriodId: period.id, units: job.targetUnits } });
    return reservation;
  }

  async planJob(actor: ProductionActor, jobId: string, input: { capacityPeriodId: string; idempotencyKey: string; plannedStartAt?: unknown; plannedEndAt?: unknown; expectedVersion?: number }) {
    return this.db.transaction(async (tx: any) => {
      const job = await this.jobForAccess(tx, actor, jobId, "progress_job", true);
      const plannedStartAt = this.parseDate(input.plannedStartAt, "plannedStartAt");
      const plannedEndAt = this.parseDate(input.plannedEndAt, "plannedEndAt");
      const claim = await this.claimCommand(tx, "production_job", job.id, "production.job_plan", input.idempotencyKey, { jobId, capacityPeriodId: input.capacityPeriodId, plannedStartAt: plannedStartAt?.toISOString() ?? null, plannedEndAt: plannedEndAt?.toISOString() ?? null, expectedVersion: input.expectedVersion ?? null });
      if (claim.replayed) return { job: await this.getJobById(tx, job.id), replayed: true };
      assertTransition(JOB_TRANSITIONS, job.status, "planned");
      if (input.expectedVersion !== undefined && job.version !== input.expectedVersion) throw new ProductionDomainError("VERSION_CONFLICT", "Production job version changed", 409);
      const [period] = await tx.select().from(supplierCapacityPeriod).where(and(eq(supplierCapacityPeriod.id, input.capacityPeriodId), eq(supplierCapacityPeriod.supplierId, job.supplierId))).limit(1);
      if (!period) throw new ProductionDomainError("CAPACITY_PERIOD_NOT_FOUND", "Capacity period not found", 404);
      const [jobWithWindow] = await tx.update(productionJob).set({ plannedStartAt: plannedStartAt ?? period.startsAt, plannedEndAt: plannedEndAt ?? period.endsAt, version: job.version + 1, updatedAt: new Date() }).where(eq(productionJob.id, job.id)).returning();
      const reservation = await this.reserveCapacityTx(tx, actor, jobWithWindow, input.capacityPeriodId, input.idempotencyKey);
      const [planned] = await tx.update(productionJob).set({ status: "planned", version: jobWithWindow.version + 1, updatedAt: new Date() }).where(eq(productionJob.id, job.id)).returning();
      const history = await this.appendHistory(tx, { jobId: job.id, eventType: "status_changed", fromStatus: job.status, toStatus: "planned", actorId: actor.userId, metadata: { capacityReservationId: reservation.id } });
      await this.emit(tx, { eventType: "JOB_STATUS_CHANGED", entityType: "production_job_history", entityId: history.id, jobId: job.id, supplierId: job.supplierId, recipientScope: "SUPPLIER", recipientId: job.supplierId, payload: { productionJobId: job.id, fromStatus: job.status, toStatus: "planned", capacityReservationId: reservation.id } });
      await this.completeCommand(tx, claim.command.id, job.id, { jobId: job.id, status: "planned", reservationId: reservation.id });
      return { job: planned, reservation, replayed: false };
    });
  }

  // ── Samples, immutable revisions and private artifact metadata ───────────

  async listSamples(actor: ProductionActor, jobId: string) {
    return this.withTx(undefined, async (tx) => {
      await this.jobForAccess(tx, actor, jobId, "read");
      const samples = await tx.select().from(productionSample).where(eq(productionSample.jobId, jobId)).orderBy(desc(productionSample.createdAt));
      const result = [] as any[];
      for (const sample of samples) {
        const revisions = await tx.select().from(productionSampleRevision).where(eq(productionSampleRevision.sampleId, sample.id)).orderBy(desc(productionSampleRevision.revisionNumber));
        result.push({ ...sample, revisions });
      }
      return result;
    });
  }

  async createSample(actor: ProductionActor, jobId: string, input: { sampleType: unknown; title: unknown; finalReviewRequired?: boolean; idempotencyKey: string }) {
    const sampleType = assertOneOf(input.sampleType, PRODUCTION_SAMPLE_TYPES, "sampleType");
    const title = requireText(input.title, "title", 300);
    return this.db.transaction(async (tx: any) => {
      const job = await this.jobForAccess(tx, actor, jobId, "submit_sample", true);
      const claim = await this.claimCommand(tx, "production_job", job.id, "production.sample_create", input.idempotencyKey, { jobId, sampleType, title, finalReviewRequired: input.finalReviewRequired === true });
      if (claim.replayed) {
        const [sample] = await tx.select().from(productionSample).where(eq(productionSample.id, claim.command.resultResourceId!)).limit(1);
        return { sample, replayed: true };
      }
      const [sample] = await tx.insert(productionSample).values({ id: id("psmp"), jobId, sampleType, title, status: "draft", finalReviewRequired: input.finalReviewRequired === true || sampleType === "final", createdBy: actor.userId }).returning();
      await this.recordAudit(tx, actor, "production.sample_created", "production_sample", sample.id, { jobId, sampleType });
      await this.completeCommand(tx, claim.command.id, sample.id, { sampleId: sample.id });
      return { sample, replayed: false };
    });
  }

  async submitSampleRevision(actor: ProductionActor, jobId: string, sampleId: string, input: { specificationSnapshot?: unknown; notes?: unknown; idempotencyKey: string }) {
    const snapshot = jsonSafe(input.specificationSnapshot ?? {});
    const notes = optionalText(input.notes, "notes", 5000);
    return this.db.transaction(async (tx: any) => {
      const job = await this.jobForAccess(tx, actor, jobId, "submit_sample", true);
      const [sample] = await tx.select().from(productionSample).where(and(eq(productionSample.id, sampleId), eq(productionSample.jobId, job.id))).for("update").limit(1);
      if (!sample) throw new ProductionDomainError("SAMPLE_NOT_FOUND", "Sample not found", 404);
      const claim = await this.claimCommand(tx, "production_sample", sample.id, "production.sample_submit_revision", input.idempotencyKey, { jobId, sampleId, specificationSnapshot: snapshot, notes });
      if (claim.replayed) return { revision: await this.getSampleRevision(tx, claim.command.resultResourceId), replayed: true };
      assertTransition(SAMPLE_TRANSITIONS, sample.status, "submitted", "INVALID_SAMPLE_TRANSITION");
      const revisions = await tx.select({ revisionNumber: productionSampleRevision.revisionNumber }).from(productionSampleRevision).where(eq(productionSampleRevision.sampleId, sample.id)).orderBy(desc(productionSampleRevision.revisionNumber)).limit(1);
      const revisionNumber = (revisions[0]?.revisionNumber ?? 0) + 1;
      const [revision] = await tx.insert(productionSampleRevision).values({ id: id("psrev"), sampleId: sample.id, revisionNumber, specificationSnapshot: snapshot as any, notes, submittedBy: actor.userId, status: "submitted" }).returning();
      await tx.update(productionSample).set({ status: "submitted", updatedAt: new Date() }).where(eq(productionSample.id, sample.id));
      await this.emit(tx, { eventType: "SAMPLE_SUBMITTED", entityType: "production_sample_revision", entityId: revision.id, jobId: job.id, supplierId: job.supplierId, recipientScope: "ADMIN_USER", payload: { sampleId: sample.id, revisionId: revision.id, revisionNumber } });
      await this.recordAudit(tx, actor, "production.sample_revision_submitted", "production_sample_revision", revision.id, { sampleId: sample.id, revisionNumber });
      await this.completeCommand(tx, claim.command.id, revision.id, { revisionId: revision.id, sampleId: sample.id });
      return { revision, replayed: false };
    });
  }

  private async getSampleRevision(tx: any, revisionId: string | null | undefined): Promise<any> {
    if (!revisionId) throw new ProductionDomainError("SAMPLE_REVISION_NOT_FOUND", "Sample command has no revision result", 404);
    const [revision] = await tx.select().from(productionSampleRevision).where(eq(productionSampleRevision.id, revisionId)).limit(1);
    if (!revision) throw new ProductionDomainError("SAMPLE_REVISION_NOT_FOUND", "Sample revision not found", 404);
    return revision;
  }

  async reviewSample(actor: ProductionActor, jobId: string, sampleRevisionId: string, input: { decision: unknown; notes?: unknown; idempotencyKey: string }) {
    if (actor.role !== "admin") throw new ProductionDomainError("ROLE_NOT_ALLOWED", "Only Admin can issue a sample review gate", 403);
    const decision = assertOneOf(input.decision, PRODUCTION_SAMPLE_REVIEW_DECISIONS, "decision");
    const notes = optionalText(input.notes, "notes", 5000);
    if (decision !== "approved" && !notes) throw new ProductionDomainError("REVIEW_REASON_REQUIRED", "A reason is required for a non-approval review");
    return this.db.transaction(async (tx: any) => {
      const [revision] = await tx.select().from(productionSampleRevision).where(eq(productionSampleRevision.id, sampleRevisionId)).for("update").limit(1);
      if (!revision) throw new ProductionDomainError("SAMPLE_REVISION_NOT_FOUND", "Sample revision not found", 404);
      const [sample] = await tx.select().from(productionSample).where(eq(productionSample.id, revision.sampleId)).for("update").limit(1);
      if (!sample || sample.jobId !== jobId) throw new ProductionDomainError("SAMPLE_NOT_FOUND", "Sample is outside this production job", 404);
      const job = await this.jobForAccess(tx, actor, jobId, "read", true);
      const claim = await this.claimCommand(tx, "production_sample_revision", revision.id, "production.sample_review", input.idempotencyKey, { jobId, sampleRevisionId, decision, notes });
      if (claim.replayed) return { revision: await this.getSampleRevision(tx, revision.id), replayed: true };
      const reviewTarget = decision === "approved" ? "approved" : decision;
      if (sample.status === "submitted") {
        await tx.update(productionSample).set({ status: "under_review", updatedAt: new Date() }).where(eq(productionSample.id, sample.id));
        await tx.update(productionSampleRevision).set({ status: "under_review" }).where(eq(productionSampleRevision.id, revision.id));
      }
      assertTransition(SAMPLE_TRANSITIONS, sample.status === "submitted" ? "under_review" : sample.status, reviewTarget, "INVALID_SAMPLE_REVIEW_TRANSITION");
      const now = new Date();
      const [updatedRevision] = await tx.update(productionSampleRevision).set({ status: decision, approvedAt: decision === "approved" ? now : null }).where(eq(productionSampleRevision.id, revision.id)).returning();
      const [updatedSample] = await tx.update(productionSample).set({ status: decision, updatedAt: now }).where(eq(productionSample.id, sample.id)).returning();
      const [review] = await tx.insert(productionSampleReview).values({ id: id("psrevw"), sampleRevisionId: revision.id, decision, notes, reviewedBy: actor.userId }).returning();
      await this.emit(tx, { eventType: "SAMPLE_REVIEWED", entityType: "production_sample_review", entityId: review.id, jobId, supplierId: job.supplierId, recipientScope: "SUPPLIER", recipientId: job.supplierId, payload: { sampleId: sample.id, revisionId: revision.id, decision } });
      await this.recordAudit(tx, actor, "production.sample_reviewed", "production_sample_review", review.id, { jobId, revisionId: revision.id, decision });
      await this.completeCommand(tx, claim.command.id, revision.id, { revisionId: revision.id, sampleId: sample.id, decision });
      return { sample: updatedSample, revision: updatedRevision, review, replayed: false };
    });
  }

  async registerArtifact(actor: ProductionActor, jobId: string, input: Record<string, unknown> & { sampleRevisionId?: string | null; idempotencyKey: string }) {
    const metadata = assertArtifactMetadata(input);
    return this.db.transaction(async (tx: any) => {
      const job = await this.jobForAccess(tx, actor, jobId, "submit_sample", true);
      if (input.sampleRevisionId) {
        const revision = await this.getSampleRevision(tx, input.sampleRevisionId);
        const [sample] = await tx.select().from(productionSample).where(eq(productionSample.id, revision.sampleId)).limit(1);
        if (!sample || sample.jobId !== job.id) throw new ProductionDomainError("ARTIFACT_SCOPE_VIOLATION", "Artifact revision is outside this job", 403);
      }
      const claim = await this.claimCommand(tx, "production_job", job.id, "production.artifact_register", input.idempotencyKey, { jobId, ...metadata, sampleRevisionId: input.sampleRevisionId ?? null });
      if (claim.replayed) {
        const [artifact] = await tx.select().from(productionArtifact).where(eq(productionArtifact.id, claim.command.resultResourceId!)).limit(1);
        return { artifact, replayed: true };
      }
      const [artifact] = await tx.insert(productionArtifact).values({ id: id("part"), jobId, sampleRevisionId: input.sampleRevisionId ?? null, artifactType: metadata.artifactType, storageProvider: "metadata_only", objectKey: metadata.objectKey, originalFilename: metadata.originalFilename, mimeType: metadata.mimeType, byteSize: metadata.byteSize, checksumSha256: metadata.checksumSha256, private: true, createdBy: actor.userId }).returning();
      await this.recordAudit(tx, actor, "production.artifact_registered", "production_artifact", artifact.id, { jobId, artifactType: metadata.artifactType, mimeType: metadata.mimeType, byteSize: metadata.byteSize });
      await this.completeCommand(tx, claim.command.id, artifact.id, { artifactId: artifact.id });
      return { artifact, replayed: false };
    });
  }

  // ── Controlled change requests ──────────────────────────────────────────

  async createChangeRequest(actor: ProductionActor, jobId: string, input: { changeType: unknown; ownerDomain: unknown; requestedFields?: unknown; reason: unknown; supportCaseReference?: unknown; idempotencyKey: string }) {
    const boundary = assertChangeBoundary({ changeType: input.changeType, ownerDomain: input.ownerDomain });
    const reason = requireText(input.reason, "reason", 2000);
    const requestedFields = jsonSafe(input.requestedFields ?? {});
    const supportCaseReference = optionalText(input.supportCaseReference, "supportCaseReference", 200);
    return this.db.transaction(async (tx: any) => {
      const job = await this.jobForAccess(tx, actor, jobId, "change_request", true);
      const claim = await this.claimCommand(tx, "production_job", job.id, "production.change_request", input.idempotencyKey, { jobId, ...boundary, requestedFields, reason, supportCaseReference });
      if (claim.replayed) {
        const [change] = await tx.select().from(productionChangeRequest).where(eq(productionChangeRequest.id, claim.command.resultResourceId!)).limit(1);
        return { change, replayed: true };
      }
      const [change] = await tx.insert(productionChangeRequest).values({ id: id("pchg"), jobId, changeType: boundary.changeType, status: "submitted", ownerDomain: boundary.ownerDomain, requestedFields: requestedFields as any, reason, commercialImpact: boundary.commercialImpact, deliveryImpact: boundary.deliveryImpact, supportCaseReference, requestedBy: actor.userId }).returning();
      await this.emit(tx, { eventType: "CHANGE_REQUEST_SUBMITTED", entityType: "production_change_request", entityId: change.id, jobId, supplierId: job.supplierId, recipientScope: "ADMIN_USER", payload: { changeRequestId: change.id, changeType: change.changeType, ownerDomain: change.ownerDomain, commercialImpact: change.commercialImpact, deliveryImpact: change.deliveryImpact, supportCaseReference } });
      await this.recordAudit(tx, actor, "production.change_request_submitted", "production_change_request", change.id, { jobId, changeType: change.changeType, ownerDomain: change.ownerDomain });
      await this.completeCommand(tx, claim.command.id, change.id, { changeRequestId: change.id });
      return { change, replayed: false };
    });
  }

  async decideChangeRequest(actor: ProductionActor, changeId: string, input: { decision: unknown; decisionReference?: unknown; notes?: unknown; idempotencyKey: string }) {
    if (actor.role !== "admin") throw new ProductionDomainError("ROLE_NOT_ALLOWED", "Only Admin can record an owner-domain change decision", 403);
    const decision = assertOneOf(input.decision, PRODUCTION_CHANGE_DECISIONS, "decision");
    const decisionReference = optionalText(input.decisionReference, "decisionReference", 300);
    const notes = optionalText(input.notes, "notes", 3000);
    return this.db.transaction(async (tx: any) => {
      const [change] = await tx.select().from(productionChangeRequest).where(eq(productionChangeRequest.id, changeId)).for("update").limit(1);
      if (!change) throw new ProductionDomainError("CHANGE_REQUEST_NOT_FOUND", "Change request not found", 404);
      const [job] = await tx.select().from(productionJob).where(eq(productionJob.id, change.jobId)).limit(1);
      if (!job) throw new ProductionDomainError("PRODUCTION_JOB_NOT_FOUND", "Production job not found", 404);
      assertTransition(CHANGE_TRANSITIONS, change.status, decision === "needs_information" ? "under_review" : decision, "INVALID_CHANGE_TRANSITION");
      if (decision === "approved" && (change.commercialImpact || change.deliveryImpact) && !decisionReference) throw new ProductionDomainError("OWNER_DECISION_REFERENCE_REQUIRED", "Commercial or delivery changes require the owning service decision reference", 422);
      const claim = await this.claimCommand(tx, "production_change_request", change.id, "production.change_decision", input.idempotencyKey, { changeId, decision, decisionReference, notes });
      if (claim.replayed) return { change, replayed: true };
      const nextStatus = decision === "needs_information" ? "under_review" : decision;
      const [decisionRow] = await tx.insert(productionChangeDecision).values({ id: id("pdec"), changeRequestId: change.id, decision, decisionReference, notes, decidedBy: actor.userId }).returning();
      const [updated] = await tx.update(productionChangeRequest).set({ status: nextStatus, ownerDecisionReference: decisionReference, updatedAt: new Date() }).where(eq(productionChangeRequest.id, change.id)).returning();
      await this.recordAudit(tx, actor, "production.change_request_decided", "production_change_request", change.id, { decision, decisionReference, ownerDomain: change.ownerDomain });
      await this.completeCommand(tx, claim.command.id, change.id, { changeRequestId: change.id, status: nextStatus });
      return { change: updated, decision: decisionRow, replayed: false };
    });
  }

  // ── Versioned checklists, inspections, defects, rework and lots ─────────

  async createChecklist(actor: ProductionActor, input: { checklistKey: unknown; name: unknown; items: Array<{ itemKey: unknown; label: unknown; sequence: unknown; measurementType: unknown; required?: boolean; minInteger?: unknown; maxInteger?: unknown; unit?: unknown }> }) {
    if (actor.role !== "admin") throw new ProductionDomainError("ROLE_NOT_ALLOWED", "Only Admin can configure QC checklists", 403);
    const checklistKey = requireText(input.checklistKey, "checklistKey", 100);
    const name = requireText(input.name, "name", 200);
    if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 100) throw new ProductionDomainError("CHECKLIST_ITEMS_REQUIRED", "A checklist needs between 1 and 100 items");
    const seen = new Set<string>();
    const items = input.items.map((item) => {
      const itemKey = requireText(item.itemKey, "itemKey", 100);
      if (seen.has(itemKey)) throw new ProductionDomainError("CHECKLIST_ITEM_DUPLICATE", "Checklist item keys must be unique");
      seen.add(itemKey);
      const measurementType = assertOneOf(item.measurementType, QUALITY_MEASUREMENT_TYPES, "measurementType");
      const sequence = requireSafeInteger(item.sequence, "sequence", 1);
      const minInteger = item.minInteger === undefined || item.minInteger === null ? null : requireSafeInteger(item.minInteger, "minInteger", -2147483648, 2147483647);
      const maxInteger = item.maxInteger === undefined || item.maxInteger === null ? null : requireSafeInteger(item.maxInteger, "maxInteger", -2147483648, 2147483647);
      if (minInteger !== null && maxInteger !== null && maxInteger < minInteger) throw new ProductionDomainError("CHECKLIST_BOUNDS_INVALID", "Checklist integer bounds are not ordered");
      return { itemKey, label: requireText(item.label, "label", 300), sequence, measurementType, required: item.required !== false, minInteger, maxInteger, unit: optionalText(item.unit, "unit", 50) };
    });
    return this.db.transaction(async (tx: any) => {
      const [previous] = await tx.select().from(qualityChecklist).where(eq(qualityChecklist.checklistKey, checklistKey)).orderBy(desc(qualityChecklist.version)).limit(1);
      const version = (previous?.version ?? 0) + 1;
      const [checklist] = await tx.insert(qualityChecklist).values({ id: id("qchk"), checklistKey, version, name, status: "draft", createdBy: actor.userId }).returning();
      for (const item of items) await tx.insert(qualityChecklistItem).values({ id: id("qchi"), checklistId: checklist.id, ...item });
      await this.recordAudit(tx, actor, "production.quality_checklist_created", "quality_checklist", checklist.id, { checklistKey, version, itemCount: items.length });
      return { checklist, items: await tx.select().from(qualityChecklistItem).where(eq(qualityChecklistItem.checklistId, checklist.id)) };
    });
  }

  async publishChecklist(actor: ProductionActor, checklistId: string, input: { idempotencyKey: string }) {
    if (actor.role !== "admin") throw new ProductionDomainError("ROLE_NOT_ALLOWED", "Only Admin can publish QC checklists", 403);
    return this.db.transaction(async (tx: any) => {
      const [checklist] = await tx.select().from(qualityChecklist).where(eq(qualityChecklist.id, checklistId)).for("update").limit(1);
      if (!checklist) throw new ProductionDomainError("CHECKLIST_NOT_FOUND", "Checklist not found", 404);
      const claim = await this.claimCommand(tx, "quality_checklist", checklist.id, "production.checklist_publish", input.idempotencyKey, { checklistId });
      if (claim.replayed) return { checklist, replayed: true };
      if (checklist.status !== "draft") throw new ProductionDomainError("CHECKLIST_NOT_PUBLISHABLE", `Checklist is ${checklist.status}`, 409);
      const items = await tx.select().from(qualityChecklistItem).where(eq(qualityChecklistItem.checklistId, checklist.id));
      if (items.length === 0) throw new ProductionDomainError("CHECKLIST_ITEMS_REQUIRED", "Checklist has no items", 422);
      const [published] = await tx.update(qualityChecklist).set({ status: "published", publishedAt: new Date(), updatedAt: new Date() }).where(eq(qualityChecklist.id, checklist.id)).returning();
      await this.recordAudit(tx, actor, "production.quality_checklist_published", "quality_checklist", checklist.id, { version: checklist.version });
      await this.completeCommand(tx, claim.command.id, checklist.id, { checklistId, version: checklist.version });
      return { checklist: published, replayed: false };
    });
  }

  async listChecklists(actor: ProductionActor, input: { status?: unknown; page?: unknown; limit?: unknown }) {
    if (actor.role !== "admin") {
      const members = await this.membersForActor(actor);
      if (members.length === 0) return pageResult([], 1, 25);
    }
    const { page, limit, offset } = pageInput(input.page, input.limit);
    const conditions = input.status ? [eq(qualityChecklist.status, assertOneOf(input.status, QUALITY_CHECKLIST_STATUSES, "status"))] : [];
    const rows = await this.db.select().from(qualityChecklist).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(qualityChecklist.createdAt)).limit(limit).offset(offset);
    return pageResult(rows, page, limit);
  }

  async createLot(actor: ProductionActor, jobId: string, input: { lotCode: unknown; plannedUnits: unknown; idempotencyKey: string }) {
    const lotCode = requireText(input.lotCode, "lotCode", 100);
    const plannedUnits = requireSafeInteger(input.plannedUnits, "plannedUnits", 1);
    return this.db.transaction(async (tx: any) => {
      const job = await this.jobForAccess(tx, actor, jobId, "manage_lot", true);
      if (!["in_progress", "completed", "blocked"].includes(job.status)) throw new ProductionDomainError("LOT_JOB_NOT_ACTIVE", `Lots cannot be created from job status ${job.status}`, 409);
      if (plannedUnits > job.targetUnits) throw new ProductionDomainError("LOT_UNITS_OVER_TARGET", "Lot planned units cannot exceed job target", 422);
      const claim = await this.claimCommand(tx, "production_job", job.id, "production.lot_create", input.idempotencyKey, { jobId, lotCode, plannedUnits });
      if (claim.replayed) {
        const [lot] = await tx.select().from(productionLot).where(eq(productionLot.id, claim.command.resultResourceId!)).limit(1);
        return { lot, replayed: true };
      }
      const [lot] = await tx.insert(productionLot).values({ id: id("plot"), jobId, purchaseOrderId: job.purchaseOrderId, lotCode, status: "open", plannedUnits, createdBy: actor.userId }).returning();
      await this.emit(tx, { eventType: "LOT_CREATED", entityType: "production_lot", entityId: lot.id, jobId, supplierId: job.supplierId, recipientScope: "SUPPLIER", recipientId: job.supplierId, payload: { lotId: lot.id, lotCode, plannedUnits } });
      await this.recordAudit(tx, actor, "production.lot_created", "production_lot", lot.id, { jobId, lotCode, plannedUnits });
      await this.completeCommand(tx, claim.command.id, lot.id, { lotId: lot.id });
      return { lot, replayed: false };
    });
  }

  async transitionLot(actor: ProductionActor, jobId: string, lotId: string, toStatus: string, input: { idempotencyKey: string; reason?: string }) {
    return this.db.transaction(async (tx: any) => {
      const job = await this.jobForAccess(tx, actor, jobId, "manage_lot", true);
      const [lot] = await tx.select().from(productionLot).where(and(eq(productionLot.id, lotId), eq(productionLot.jobId, job.id))).for("update").limit(1);
      if (!lot) throw new ProductionDomainError("LOT_NOT_FOUND", "Lot not found", 404);
      assertOneOf(toStatus, PRODUCTION_LOT_STATUSES, "status");
      const claim = await this.claimCommand(tx, "production_lot", lot.id, "production.lot_transition", input.idempotencyKey, { jobId, lotId, toStatus, reason: input.reason ?? null });
      if (claim.replayed) return { lot, replayed: true };
      assertTransition(LOT_TRANSITIONS, lot.status, toStatus, "INVALID_LOT_TRANSITION");
      if (toStatus === "completed" && lot.producedUnits <= 0) throw new ProductionDomainError("LOT_OUTPUT_REQUIRED", "Record lot output before completion", 422);
      if (toStatus === "released" && lot.status !== "completed") throw new ProductionDomainError("LOT_RELEASE_GATE_BLOCKED", "Only a completed lot can be released", 422);
      const [updated] = await tx.update(productionLot).set({ status: toStatus, updatedAt: new Date() }).where(eq(productionLot.id, lot.id)).returning();
      await this.recordAudit(tx, actor, "production.lot_status_changed", "production_lot", lot.id, { fromStatus: lot.status, toStatus, reason: input.reason ?? null });
      await this.completeCommand(tx, claim.command.id, lot.id, { lotId: lot.id, status: toStatus });
      return { lot: updated, replayed: false };
    });
  }

  async recordLotOutput(actor: ProductionActor, jobId: string, lotId: string, input: { producedUnits: unknown; acceptedUnits: unknown; rejectedUnits: unknown; reworkUnits: unknown; idempotencyKey: string }) {
    const producedUnits = requireSafeInteger(input.producedUnits, "producedUnits", 0);
    const acceptedUnits = requireSafeInteger(input.acceptedUnits, "acceptedUnits", 0);
    const rejectedUnits = requireSafeInteger(input.rejectedUnits, "rejectedUnits", 0);
    const reworkUnits = requireSafeInteger(input.reworkUnits, "reworkUnits", 0);
    if (acceptedUnits + rejectedUnits > producedUnits || reworkUnits > producedUnits) throw new ProductionDomainError("LOT_ARITHMETIC_INVARIANT", "Lot accepted/rejected/rework quantities exceed produced units", 422);
    return this.db.transaction(async (tx: any) => {
      const job = await this.jobForAccess(tx, actor, jobId, "manage_lot", true);
      const [lot] = await tx.select().from(productionLot).where(and(eq(productionLot.id, lotId), eq(productionLot.jobId, job.id))).for("update").limit(1);
      if (!lot) throw new ProductionDomainError("LOT_NOT_FOUND", "Lot not found", 404);
      if (["released", "recall_hold"].includes(lot.status)) throw new ProductionDomainError("LOT_IMMUTABLE", `Lot is ${lot.status}`, 409);
      if (producedUnits > lot.plannedUnits) throw new ProductionDomainError("LOT_OUTPUT_OVER_PLAN", "Lot output cannot exceed planned units", 422);
      const claim = await this.claimCommand(tx, "production_lot", lot.id, "production.lot_output", input.idempotencyKey, { jobId, lotId, producedUnits, acceptedUnits, rejectedUnits, reworkUnits });
      if (claim.replayed) return { lot, replayed: true };
      const [updated] = await tx.update(productionLot).set({ producedUnits, acceptedUnits, rejectedUnits, reworkUnits, updatedAt: new Date() }).where(eq(productionLot.id, lot.id)).returning();
      await this.recordAudit(tx, actor, "production.lot_output_recorded", "production_lot", lot.id, { producedUnits, acceptedUnits, rejectedUnits, reworkUnits });
      await this.completeCommand(tx, claim.command.id, lot.id, { lotId: lot.id, producedUnits });
      return { lot: updated, replayed: false };
    });
  }

  async addLotTrace(actor: ProductionActor, jobId: string, lotId: string, input: { traceType: unknown; purchaseOrderItemId?: string | null; variantId?: string | null; sourceLotId?: string | null; quantity: unknown; metadata?: unknown; idempotencyKey: string }) {
    const traceType = assertOneOf(input.traceType, ["purchase_order_item", "variant", "source_lot"], "traceType");
    const quantity = requireSafeInteger(input.quantity, "quantity", 1);
    return this.db.transaction(async (tx: any) => {
      const job = await this.jobForAccess(tx, actor, jobId, "manage_lot", true);
      const [lot] = await tx.select().from(productionLot).where(and(eq(productionLot.id, lotId), eq(productionLot.jobId, job.id))).for("update").limit(1);
      if (!lot) throw new ProductionDomainError("LOT_NOT_FOUND", "Lot not found", 404);
      if (traceType === "purchase_order_item") {
        if (!input.purchaseOrderItemId) throw new ProductionDomainError("TRACE_TARGET_REQUIRED", "Purchase order item is required");
        const context = await this.orders.getProductionEligibility({ childOrderId: job.purchaseOrderId, executor: tx });
        if (!context.items.some((item) => item.id === input.purchaseOrderItemId)) throw new ProductionDomainError("TRACE_SCOPE_VIOLATION", "Purchase order item is outside the canonical child order", 403);
      }
      if (traceType === "variant") {
        if (!input.variantId) throw new ProductionDomainError("TRACE_TARGET_REQUIRED", "Variant is required");
        const context = await this.orders.getProductionEligibility({ childOrderId: job.purchaseOrderId, executor: tx });
        if (!context.items.some((item) => item.variantId === input.variantId)) throw new ProductionDomainError("TRACE_SCOPE_VIOLATION", "Variant is outside the canonical child order", 403);
      }
      if (traceType === "source_lot") {
        if (!input.sourceLotId) throw new ProductionDomainError("TRACE_TARGET_REQUIRED", "Source lot is required");
        const [source] = await tx.select().from(productionLot).where(and(eq(productionLot.id, input.sourceLotId), eq(productionLot.jobId, job.id))).limit(1);
        if (!source) throw new ProductionDomainError("TRACE_SCOPE_VIOLATION", "Source lot is outside this production job", 403);
      }
      const claim = await this.claimCommand(tx, "production_lot", lot.id, "production.lot_trace", input.idempotencyKey, { jobId, lotId, traceType, purchaseOrderItemId: input.purchaseOrderItemId ?? null, variantId: input.variantId ?? null, sourceLotId: input.sourceLotId ?? null, quantity });
      if (claim.replayed) {
        const [trace] = await tx.select().from(productionLotTrace).where(eq(productionLotTrace.id, claim.command.resultResourceId!)).limit(1);
        return { trace, replayed: true };
      }
      const [trace] = await tx.insert(productionLotTrace).values({ id: id("ptrace"), lotId, traceType, purchaseOrderItemId: input.purchaseOrderItemId ?? null, variantId: input.variantId ?? null, sourceLotId: input.sourceLotId ?? null, quantity, metadata: jsonSafe(input.metadata ?? {}) as any, createdBy: actor.userId }).returning();
      await this.recordAudit(tx, actor, "production.lot_trace_added", "production_lot_trace", trace.id, { lotId, traceType, quantity });
      await this.completeCommand(tx, claim.command.id, trace.id, { traceId: trace.id });
      return { trace, replayed: false };
    });
  }

  async createInspection(actor: ProductionActor, jobId: string, input: { lotId: string; checklistId: string; sampleSize: unknown; idempotencyKey: string }) {
    const sampleSize = requireSafeInteger(input.sampleSize, "sampleSize", 1);
    return this.db.transaction(async (tx: any) => {
      const job = await this.jobForAccess(tx, actor, jobId, "submit_qc", true);
      const [lot] = await tx.select().from(productionLot).where(and(eq(productionLot.id, input.lotId), eq(productionLot.jobId, job.id))).for("update").limit(1);
      if (!lot) throw new ProductionDomainError("LOT_NOT_FOUND", "Lot not found", 404);
      if (["released", "recall_hold"].includes(lot.status)) throw new ProductionDomainError("LOT_NOT_INSPECTABLE", `Lot is ${lot.status}`, 409);
      if (sampleSize > lot.plannedUnits) throw new ProductionDomainError("QC_SAMPLE_OVER_PLAN", "QC sample size cannot exceed lot plan", 422);
      const [checklist] = await tx.select().from(qualityChecklist).where(and(eq(qualityChecklist.id, input.checklistId), eq(qualityChecklist.status, "published"))).limit(1);
      if (!checklist) throw new ProductionDomainError("CHECKLIST_NOT_FOUND", "Published checklist not found", 404);
      const claim = await this.claimCommand(tx, "production_lot", lot.id, "production.inspection_create", input.idempotencyKey, { jobId, lotId: lot.id, checklistId: checklist.id, sampleSize });
      if (claim.replayed) {
        const [inspection] = await tx.select().from(qualityInspection).where(eq(qualityInspection.id, claim.command.resultResourceId!)).limit(1);
        return { inspection, replayed: true };
      }
      const [inspection] = await tx.insert(qualityInspection).values({ id: id("qins"), jobId, lotId: lot.id, checklistId: checklist.id, checklistVersion: checklist.version, status: "in_progress", sampleSize, acceptedUnits: 0, defectUnits: 0, reworkUnits: 0, rejectedUnits: 0, defectRateBps: 0, passRateBps: 0, createdBy: actor.userId }).returning();
      await this.recordAudit(tx, actor, "production.inspection_created", "quality_inspection", inspection.id, { jobId, lotId: lot.id, checklistId: checklist.id, checklistVersion: checklist.version });
      await this.completeCommand(tx, claim.command.id, inspection.id, { inspectionId: inspection.id });
      return { inspection, replayed: false };
    });
  }

  async submitInspection(actor: ProductionActor, jobId: string, inspectionId: string, input: { acceptedUnits: unknown; defectUnits: unknown; reworkUnits: unknown; rejectedUnits: unknown; decision: unknown; items: Array<{ checklistItemId: string; observedInteger?: unknown; observedBoolean?: unknown; observedText?: unknown; passed?: boolean; note?: unknown }>; idempotencyKey: string }) {
    const acceptedUnits = requireSafeInteger(input.acceptedUnits, "acceptedUnits", 0);
    const defectUnits = requireSafeInteger(input.defectUnits, "defectUnits", 0);
    const reworkUnits = requireSafeInteger(input.reworkUnits, "reworkUnits", 0);
    const rejectedUnits = requireSafeInteger(input.rejectedUnits, "rejectedUnits", 0);
    const decision = assertOneOf(input.decision, QUALITY_INSPECTION_DECISIONS, "decision");
    return this.db.transaction(async (tx: any) => {
      const job = await this.jobForAccess(tx, actor, jobId, "submit_qc", true);
      const [inspection] = await tx.select().from(qualityInspection).where(and(eq(qualityInspection.id, inspectionId), eq(qualityInspection.jobId, job.id))).for("update").limit(1);
      if (!inspection) throw new ProductionDomainError("INSPECTION_NOT_FOUND", "Inspection not found", 404);
      assertTransition(INSPECTION_TRANSITIONS, inspection.status, "submitted", "INVALID_INSPECTION_TRANSITION");
      assertInspectionArithmetic({ sampleSize: inspection.sampleSize, acceptedUnits, defectUnits, reworkUnits, rejectedUnits });
      const checklistItems = await tx.select().from(qualityChecklistItem).where(eq(qualityChecklistItem.checklistId, inspection.checklistId)).orderBy(asc(qualityChecklistItem.sequence));
      if (!Array.isArray(input.items) || input.items.length !== checklistItems.length) throw new ProductionDomainError("QC_ITEMS_INCOMPLETE", "Every versioned checklist item must have one submitted result", 422);
      const provided = new Set<string>();
      for (const result of input.items) {
        if (provided.has(result.checklistItemId)) throw new ProductionDomainError("QC_ITEM_DUPLICATE", "Checklist item submitted more than once");
        provided.add(result.checklistItemId);
        const item = checklistItems.find((candidate: any) => candidate.id === result.checklistItemId);
        if (!item) throw new ProductionDomainError("QC_ITEM_NOT_IN_CHECKLIST", "Inspection item is not part of the snapshotted checklist", 422);
        if (item.required && typeof result.passed !== "boolean") throw new ProductionDomainError("QC_RESULT_REQUIRED", `Result required for ${item.itemKey}`);
        if (item.measurementType === "integer" && result.observedInteger !== undefined) {
          const observed = requireSafeInteger(result.observedInteger, "observedInteger", -2147483648, 2147483647);
          if (item.minInteger !== null && observed < item.minInteger || item.maxInteger !== null && observed > item.maxInteger) throw new ProductionDomainError("QC_MEASUREMENT_OUT_OF_BOUNDS", `Measurement out of bounds for ${item.itemKey}`, 422);
        }
      }
      const claim = await this.claimCommand(tx, "quality_inspection", inspection.id, "production.inspection_submit", input.idempotencyKey, { jobId, inspectionId, acceptedUnits, defectUnits, reworkUnits, rejectedUnits, decision, items: input.items });
      if (claim.replayed) {
        const [existing] = await tx.select().from(qualityInspection).where(eq(qualityInspection.id, inspection.id)).limit(1);
        return { inspection: existing, replayed: true };
      }
      for (const result of input.items) {
        const item = checklistItems.find((candidate: any) => candidate.id === result.checklistItemId)!;
        await tx.insert(qualityInspectionItem).values({ id: id("qini"), inspectionId: inspection.id, checklistItemId: item.id, itemKeySnapshot: item.itemKey, measurementTypeSnapshot: item.measurementType, observedInteger: result.observedInteger === undefined ? null : requireSafeInteger(result.observedInteger, "observedInteger", -2147483648, 2147483647), observedBoolean: result.observedBoolean === undefined ? null : Boolean(result.observedBoolean), observedText: result.observedText === undefined ? null : optionalText(result.observedText, "observedText", 1000), passed: result.passed ?? null, note: optionalText(result.note, "note", 1000) });
      }
      const rates = this.calculateRates(inspection.sampleSize, acceptedUnits, defectUnits);
      const [updated] = await tx.update(qualityInspection).set({ status: decision === "accepted" ? "accepted" : decision === "rework_required" ? "rework_required" : "rejected", acceptedUnits, defectUnits, reworkUnits, rejectedUnits, defectRateBps: rates.defectRateBps, passRateBps: rates.passRateBps, decision, submittedBy: actor.userId, submittedAt: new Date(), updatedAt: new Date() }).where(eq(qualityInspection.id, inspection.id)).returning();
      await this.emit(tx, { eventType: "INSPECTION_SUBMITTED", entityType: "quality_inspection", entityId: inspection.id, jobId, supplierId: job.supplierId, recipientScope: "ADMIN_USER", payload: { inspectionId: inspection.id, lotId: inspection.lotId, decision, defectRateBps: rates.defectRateBps, passRateBps: rates.passRateBps } });
      await this.recordAudit(tx, actor, "production.inspection_submitted", "quality_inspection", inspection.id, { decision, sampleSize: inspection.sampleSize, acceptedUnits, defectUnits, reworkUnits, rejectedUnits, defectRateBps: rates.defectRateBps, passRateBps: rates.passRateBps });
      await this.completeCommand(tx, claim.command.id, inspection.id, { inspectionId: inspection.id, status: updated.status });
      return { inspection: updated, replayed: false };
    });
  }

  private calculateRates(sampleSize: number, acceptedUnits: number, defectUnits: number): { defectRateBps: number; passRateBps: number } {
    const defectRateBps = Number((BigInt(defectUnits) * 10000n) / BigInt(sampleSize));
    const passRateBps = Number((BigInt(acceptedUnits) * 10000n) / BigInt(sampleSize));
    if (defectRateBps + passRateBps > 10000) throw new ProductionDomainError("QC_RATE_OUT_OF_BOUNDS", "QC rates exceed 10000 basis points", 422);
    return { defectRateBps, passRateBps };
  }

  async recordDefect(actor: ProductionActor, jobId: string, input: { lotId: string; inspectionId?: string | null; defectCode: unknown; description: unknown; severity: unknown; quantity: unknown; idempotencyKey: string }) {
    const defectCode = requireText(input.defectCode, "defectCode", 100);
    const description = requireText(input.description, "description", 2000);
    const severity = assertOneOf(input.severity, QUALITY_DEFECT_SEVERITIES, "severity");
    const quantity = requireSafeInteger(input.quantity, "quantity", 1);
    return this.db.transaction(async (tx: any) => {
      const job = await this.jobForAccess(tx, actor, jobId, "submit_qc", true);
      const [lot] = await tx.select().from(productionLot).where(and(eq(productionLot.id, input.lotId), eq(productionLot.jobId, job.id))).for("update").limit(1);
      if (!lot) throw new ProductionDomainError("LOT_NOT_FOUND", "Lot not found", 404);
      if (["released", "recall_hold"].includes(lot.status)) throw new ProductionDomainError("LOT_NOT_MUTABLE", `Lot is ${lot.status}`, 409);
      if (input.inspectionId) {
        const [inspection] = await tx.select().from(qualityInspection).where(and(eq(qualityInspection.id, input.inspectionId), eq(qualityInspection.lotId, lot.id))).limit(1);
        if (!inspection) throw new ProductionDomainError("INSPECTION_NOT_FOUND", "Inspection is outside this lot", 404);
      }
      const claim = await this.claimCommand(tx, "production_lot", lot.id, "production.defect_record", input.idempotencyKey, { jobId, lotId: lot.id, inspectionId: input.inspectionId ?? null, defectCode, description, severity, quantity });
      if (claim.replayed) {
        const [defect] = await tx.select().from(qualityDefect).where(eq(qualityDefect.id, claim.command.resultResourceId!)).limit(1);
        return { defect, replayed: true };
      }
      const [defect] = await tx.insert(qualityDefect).values({ id: id("qdef"), jobId, lotId: lot.id, inspectionId: input.inspectionId ?? null, defectCode, description, severity, quantity, status: "open", detectedBy: actor.userId }).returning();
      await this.emit(tx, { eventType: "DEFECT_RECORDED", entityType: "quality_defect", entityId: defect.id, jobId, supplierId: job.supplierId, recipientScope: "ADMIN_USER", payload: { defectId: defect.id, lotId: lot.id, severity, quantity } });
      await this.recordAudit(tx, actor, "production.defect_recorded", "quality_defect", defect.id, { jobId, lotId: lot.id, severity, quantity });
      await this.completeCommand(tx, claim.command.id, defect.id, { defectId: defect.id });
      return { defect, replayed: false };
    });
  }

  async transitionDefect(actor: ProductionActor, jobId: string, defectId: string, toStatus: string, input: { idempotencyKey: string; dispositionNote?: unknown }) {
    const dispositionNote = optionalText(input.dispositionNote, "dispositionNote", 2000);
    return this.db.transaction(async (tx: any) => {
      const job = await this.jobForAccess(tx, actor, jobId, "submit_qc", true);
      const [defect] = await tx.select().from(qualityDefect).where(and(eq(qualityDefect.id, defectId), eq(qualityDefect.jobId, job.id))).for("update").limit(1);
      if (!defect) throw new ProductionDomainError("DEFECT_NOT_FOUND", "Defect not found", 404);
      assertOneOf(toStatus, QUALITY_DEFECT_STATUSES, "status");
      const claim = await this.claimCommand(tx, "quality_defect", defect.id, "production.defect_transition", input.idempotencyKey, { jobId, defectId, toStatus, dispositionNote });
      if (claim.replayed) return { defect, replayed: true };
      assertTransition(DEFECT_TRANSITIONS, defect.status, toStatus, "INVALID_DEFECT_TRANSITION");
      if (["accepted", "waived", "closed"].includes(toStatus) && !dispositionNote) throw new ProductionDomainError("DISPOSITION_NOTE_REQUIRED", "A disposition note is required", 422);
      const [updated] = await tx.update(qualityDefect).set({ status: toStatus, dispositionNote, updatedAt: new Date() }).where(eq(qualityDefect.id, defect.id)).returning();
      await this.recordAudit(tx, actor, "production.defect_status_changed", "quality_defect", defect.id, { fromStatus: defect.status, toStatus, dispositionNote });
      await this.completeCommand(tx, claim.command.id, defect.id, { defectId: defect.id, status: toStatus });
      return { defect: updated, replayed: false };
    });
  }

  async createRework(actor: ProductionActor, jobId: string, input: { lotId: string; defectId: string; quantity: unknown; instructions: unknown; idempotencyKey: string }) {
    const quantity = requireSafeInteger(input.quantity, "quantity", 1);
    const instructions = requireText(input.instructions, "instructions", 2000);
    return this.db.transaction(async (tx: any) => {
      const job = await this.jobForAccess(tx, actor, jobId, "submit_qc", true);
      const [defect] = await tx.select().from(qualityDefect).where(and(eq(qualityDefect.id, input.defectId), eq(qualityDefect.jobId, job.id), eq(qualityDefect.lotId, input.lotId))).for("update").limit(1);
      if (!defect) throw new ProductionDomainError("DEFECT_NOT_FOUND", "Defect not found for this lot/job", 404);
      if (!["open", "acknowledged", "rework"].includes(defect.status)) throw new ProductionDomainError("DEFECT_NOT_REWORKABLE", `Defect is ${defect.status}`, 409);
      if (quantity > defect.quantity) throw new ProductionDomainError("REWORK_QUANTITY_OVER_DEFECT", "Rework quantity cannot exceed defect quantity", 422);
      const claim = await this.claimCommand(tx, "quality_defect", defect.id, "production.rework_create", input.idempotencyKey, { jobId, lotId: input.lotId, defectId: input.defectId, quantity, instructions });
      if (claim.replayed) {
        const [rework] = await tx.select().from(qualityRework).where(eq(qualityRework.id, claim.command.resultResourceId!)).limit(1);
        return { rework, replayed: true };
      }
      const [rework] = await tx.insert(qualityRework).values({ id: id("qrew"), jobId, lotId: input.lotId, defectId: input.defectId, quantity, instructions, status: "requested", requestedBy: actor.userId }).returning();
      if (defect.status === "open" || defect.status === "acknowledged") await tx.update(qualityDefect).set({ status: "rework", updatedAt: new Date() }).where(eq(qualityDefect.id, defect.id));
      await this.recordAudit(tx, actor, "production.rework_requested", "quality_rework", rework.id, { defectId: defect.id, quantity });
      await this.completeCommand(tx, claim.command.id, rework.id, { reworkId: rework.id });
      return { rework, replayed: false };
    });
  }

  async transitionRework(actor: ProductionActor, jobId: string, reworkId: string, toStatus: string, input: { idempotencyKey: string }) {
    return this.db.transaction(async (tx: any) => {
      const job = await this.jobForAccess(tx, actor, jobId, "submit_qc", true);
      const [rework] = await tx.select().from(qualityRework).where(and(eq(qualityRework.id, reworkId), eq(qualityRework.jobId, job.id))).for("update").limit(1);
      if (!rework) throw new ProductionDomainError("REWORK_NOT_FOUND", "Rework not found", 404);
      assertOneOf(toStatus, QUALITY_REWORK_STATUSES, "status");
      const claim = await this.claimCommand(tx, "quality_rework", rework.id, "production.rework_transition", input.idempotencyKey, { jobId, reworkId, toStatus });
      if (claim.replayed) return { rework, replayed: true };
      assertTransition(REWORK_TRANSITIONS, rework.status, toStatus, "INVALID_REWORK_TRANSITION");
      const [updated] = await tx.update(qualityRework).set({ status: toStatus, completedBy: toStatus === "completed" ? actor.userId : rework.completedBy, completedAt: toStatus === "completed" ? new Date() : rework.completedAt, updatedAt: new Date() }).where(eq(qualityRework.id, rework.id)).returning();
      await this.recordAudit(tx, actor, "production.rework_status_changed", "quality_rework", rework.id, { fromStatus: rework.status, toStatus });
      await this.completeCommand(tx, claim.command.id, rework.id, { reworkId: rework.id, status: toStatus });
      return { rework: updated, replayed: false };
    });
  }

  private async releaseReadiness(tx: any, job: any, lot: any): Promise<{ ready: boolean; reasons: string[]; inspectionId: string | null; finalSampleApproved: boolean }> {
    const reasons: string[] = [];
    if (job.status !== "completed") reasons.push("JOB_NOT_COMPLETED");
    if (lot.status !== "completed") reasons.push("LOT_NOT_COMPLETED");
    if (lot.producedUnits <= 0) reasons.push("LOT_HAS_NO_OUTPUT");
    const inspections = await tx.select().from(qualityInspection).where(and(eq(qualityInspection.jobId, job.id), eq(qualityInspection.lotId, lot.id))).orderBy(desc(qualityInspection.createdAt));
    const acceptedInspection = inspections.find((inspection: any) => inspection.status === "accepted");
    if (!acceptedInspection) reasons.push("ACCEPTED_INSPECTION_REQUIRED");
    const [openCritical] = await tx.select({ id: qualityDefect.id }).from(qualityDefect).where(and(eq(qualityDefect.jobId, job.id), eq(qualityDefect.lotId, lot.id), inArray(qualityDefect.severity, ["major", "critical"]), inArray(qualityDefect.status, ["open", "acknowledged", "rework"]))).limit(1);
    if (openCritical) reasons.push("OPEN_MAJOR_OR_CRITICAL_DEFECT");
    const [unfinishedRework] = await tx.select({ id: qualityRework.id }).from(qualityRework).where(and(eq(qualityRework.jobId, job.id), inArray(qualityRework.status, ["requested", "in_progress", "failed"]))).limit(1);
    if (unfinishedRework) reasons.push("INCOMPLETE_REWORK");
    let finalSampleApproved = true;
    if (job.requiresSampleApproval) {
      const [sample] = await tx.select().from(productionSample).where(and(eq(productionSample.jobId, job.id), eq(productionSample.sampleType, "final"))).limit(1);
      finalSampleApproved = sample?.status === "approved";
      if (!finalSampleApproved) reasons.push("FINAL_SAMPLE_NOT_APPROVED");
    }
    const [pendingChange] = await tx.select({ id: productionChangeRequest.id }).from(productionChangeRequest).where(and(eq(productionChangeRequest.jobId, job.id), inArray(productionChangeRequest.status, ["submitted", "under_review"]), inArray(productionChangeRequest.changeType, ["commercial", "delivery"]))).limit(1);
    if (pendingChange) reasons.push("PENDING_COMMERCIAL_OR_DELIVERY_CHANGE");
    return { ready: reasons.length === 0, reasons, inspectionId: acceptedInspection?.id ?? null, finalSampleApproved };
  }

  async getReleaseReadiness(actor: ProductionActor, jobId: string, lotId: string) {
    return this.db.transaction(async (tx: any) => {
      const job = await this.jobForAccess(tx, actor, jobId, "read");
      const [lot] = await tx.select().from(productionLot).where(and(eq(productionLot.id, lotId), eq(productionLot.jobId, job.id))).limit(1);
      if (!lot) throw new ProductionDomainError("LOT_NOT_FOUND", "Lot not found", 404);
      return { productionJobId: job.id, lotId: lot.id, ...(await this.releaseReadiness(tx, job, lot)), shippingHandoff: { eligible: false, reason: "QUALITY_RELEASE_NOT_APPROVED", purchaseOrderId: job.purchaseOrderId, productionJobId: job.id, lotIds: [lot.id] } };
    });
  }

  async requestQualityRelease(actor: ProductionActor, jobId: string, input: { lotId: string; idempotencyKey: string }) {
    return this.db.transaction(async (tx: any) => {
      const job = await this.jobForAccess(tx, actor, jobId, "request_release", true);
      const [lot] = await tx.select().from(productionLot).where(and(eq(productionLot.id, input.lotId), eq(productionLot.jobId, job.id))).for("update").limit(1);
      if (!lot) throw new ProductionDomainError("LOT_NOT_FOUND", "Lot not found", 404);
      const claim = await this.claimCommand(tx, "production_lot", lot.id, "production.quality_release_request", input.idempotencyKey, { jobId, lotId: lot.id });
      const readiness = await this.releaseReadiness(tx, job, lot);
      if (claim.replayed) {
        const [release] = await tx.select().from(qualityRelease).where(eq(qualityRelease.id, claim.command.resultResourceId!)).limit(1);
        return { release, readiness, replayed: true };
      }
      const [existing] = await tx.select().from(qualityRelease).where(and(eq(qualityRelease.jobId, job.id), eq(qualityRelease.lotId, lot.id))).for("update").limit(1);
      let release: any;
      if (existing) {
        if (!["rejected", "pending"].includes(existing.status)) throw new ProductionDomainError("QUALITY_RELEASE_ALREADY_DECIDED", `Release is ${existing.status}`, 409);
        [release] = await tx.update(qualityRelease).set({ status: readiness.ready ? "ready" : "pending", readinessSnapshot: readiness as any, requestedBy: actor.userId, updatedAt: new Date() }).where(eq(qualityRelease.id, existing.id)).returning();
      } else {
        [release] = await tx.insert(qualityRelease).values({ id: id("qrel"), jobId: job.id, lotId: lot.id, status: readiness.ready ? "ready" : "pending", readinessSnapshot: readiness as any, requestedBy: actor.userId }).returning();
      }
      await this.recordAudit(tx, actor, "production.quality_release_requested", "quality_release", release.id, { jobId, lotId: lot.id, ready: readiness.ready, reasons: readiness.reasons });
      await this.completeCommand(tx, claim.command.id, release.id, { releaseId: release.id, ready: readiness.ready });
      return { release, readiness, replayed: false };
    });
  }

  async approveQualityRelease(actor: ProductionActor, releaseId: string, input: { decision: "approve" | "reject"; note?: unknown; idempotencyKey: string }) {
    if (actor.role !== "admin") throw new ProductionDomainError("ROLE_NOT_ALLOWED", "Only Admin can approve a quality release", 403);
    const note = optionalText(input.note, "note", 3000);
    return this.db.transaction(async (tx: any) => {
      const [release] = await tx.select().from(qualityRelease).where(eq(qualityRelease.id, releaseId)).for("update").limit(1);
      if (!release) throw new ProductionDomainError("QUALITY_RELEASE_NOT_FOUND", "Quality release not found", 404);
      const [job] = await tx.select().from(productionJob).where(eq(productionJob.id, release.jobId)).for("update").limit(1);
      const [lot] = await tx.select().from(productionLot).where(eq(productionLot.id, release.lotId)).for("update").limit(1);
      if (!job || !lot) throw new ProductionDomainError("QUALITY_RELEASE_SCOPE_INVALID", "Quality release scope is invalid", 409);
      const readiness = await this.releaseReadiness(tx, job, lot);
      const toStatus = input.decision === "approve" ? "approved" : "rejected";
      const claim = await this.claimCommand(tx, "quality_release", release.id, "production.quality_release_decision", input.idempotencyKey, { releaseId, decision: input.decision, note });
      if (claim.replayed) return { release, readiness, replayed: true };
      assertTransition(RELEASE_TRANSITIONS, release.status, toStatus, "INVALID_RELEASE_TRANSITION");
      if (input.decision === "approve" && !readiness.ready) throw new ProductionDomainError("QUALITY_RELEASE_GATE_BLOCKED", `Quality release is not ready: ${readiness.reasons.join(", ")}`, 422);
      const [updated] = await tx.update(qualityRelease).set({ status: toStatus, readinessSnapshot: readiness as any, decidedBy: actor.userId, decisionNote: note, approvedAt: input.decision === "approve" ? new Date() : null, updatedAt: new Date() }).where(eq(qualityRelease.id, release.id)).returning();
      if (input.decision === "approve") {
        const [releasedLot] = await tx.update(productionLot).set({ status: "released", updatedAt: new Date() }).where(eq(productionLot.id, lot.id)).returning();
        await this.emit(tx, { eventType: "QUALITY_RELEASE_APPROVED", entityType: "quality_release", entityId: release.id, jobId: job.id, supplierId: job.supplierId, recipientScope: "SUPPLIER", recipientId: job.supplierId, payload: { qualityReleaseId: release.id, lotId: lot.id, purchaseOrderId: job.purchaseOrderId, shippingHandoff: { eligible: true, purchaseOrderId: job.purchaseOrderId, productionJobId: job.id, lotIds: [lot.id], qualityReleaseId: release.id } } });
        await this.recordAudit(tx, actor, "production.quality_release_approved", "quality_release", release.id, { lotId: lot.id, shippingHandoff: true });
        await this.completeCommand(tx, claim.command.id, release.id, { releaseId: release.id, status: "approved", releasedLotId: releasedLot.id });
      } else {
        await this.recordAudit(tx, actor, "production.quality_release_rejected", "quality_release", release.id, { note });
        await this.completeCommand(tx, claim.command.id, release.id, { releaseId: release.id, status: "rejected" });
      }
      return { release: updated, readiness, replayed: false };
    });
  }

  async getShippingHandoff(actor: ProductionActor, qualityReleaseId: string): Promise<ProductionShippingHandoff> {
    return this.withTx(undefined, async (tx) => {
      const [release] = await tx.select().from(qualityRelease).where(eq(qualityRelease.id, qualityReleaseId)).limit(1);
      if (!release || release.status !== "approved") throw new ProductionDomainError("SHIPPING_HANDOFF_NOT_READY", "Quality release is not approved", 422);
      const job = await this.jobForAccess(tx, actor, release.jobId, "read");
      return {
        domain: "shipping",
        eligible: true,
        purchaseOrderId: job.purchaseOrderId,
        productionJobId: job.id,
        lotIds: [release.lotId],
        qualityReleaseId: release.id,
        source: "quality_release",
      };
    });
  }

  async listIntegrationEvents(actor: ProductionActor, jobId: string, input: { page?: unknown; limit?: unknown }) {
    const { page, limit, offset } = pageInput(input.page, input.limit);
    return this.withTx(undefined, async (tx) => {
      const job = await this.jobForAccess(tx, actor, jobId, "read");
      const rows = await tx.select().from(productionEvent).where(eq(productionEvent.jobId, job.id)).orderBy(desc(productionEvent.createdAt)).limit(limit).offset(offset);
      return pageResult(rows, page, limit);
    });
  }

  // ── Recall proposal, maker-checker approval and lifecycle ────────────────

  async createRecall(actor: ProductionActor, input: { jobId?: string | null; severity: unknown; scopeType: unknown; reason: unknown; scopes: Array<{ lotId?: string | null; purchaseOrderItemId?: string | null; variantId?: string | null; quantity?: unknown }>; idempotencyKey: string }) {
    const scope = assertRecallScope({ severity: input.severity, scopeType: input.scopeType });
    const reason = requireText(input.reason, "reason", 3000);
    if (!Array.isArray(input.scopes) || input.scopes.length === 0) throw new ProductionDomainError("RECALL_SCOPE_REQUIRED", "Recall must contain at least one explicit scope target");
    return this.db.transaction(async (tx: any) => {
      let supplierId: string;
      let job: any = null;
      if (input.jobId) {
        job = await this.jobForAccess(tx, actor, input.jobId, "recall_propose", true);
        supplierId = job.supplierId;
      } else {
        supplierId = await this.resolveSupplierForActor(actor, undefined, tx);
        await this.assertSupplierMember(actor, supplierId, "recall_propose", tx);
      }
      const claim = await this.claimCommand(tx, "supplier", supplierId, "production.recall_create", input.idempotencyKey, { jobId: input.jobId ?? null, ...scope, reason, scopes: input.scopes });
      if (claim.replayed) {
        const [recall] = await tx.select().from(productionRecall).where(eq(productionRecall.id, claim.command.resultResourceId!)).limit(1);
        return { recall, replayed: true };
      }
      const [recall] = await tx.insert(productionRecall).values({ id: id("prcl"), supplierId, jobId: input.jobId ?? null, severity: scope.severity, scopeType: scope.scopeType, status: "draft", reason, makerId: actor.userId }).returning();
      for (const target of input.scopes) {
        const lotId = target.lotId ?? null;
        const purchaseOrderItemId = target.purchaseOrderItemId ?? null;
        const variantId = target.variantId ?? null;
        if (!lotId && !purchaseOrderItemId && !variantId) throw new ProductionDomainError("RECALL_SCOPE_TARGET_REQUIRED", "Each recall scope row needs a lot, order item, or variant");
        if (lotId) {
          const [lot] = await tx.select().from(productionLot).where(eq(productionLot.id, lotId)).limit(1);
          if (!lot) throw new ProductionDomainError("RECALL_SCOPE_VIOLATION", "Recall lot was not found", 404);
          const [lotJob] = await tx.select().from(productionJob).where(eq(productionJob.id, lot.jobId)).limit(1);
          if (!lotJob || lotJob.supplierId !== supplierId || (job && lotJob.id !== job.id)) throw new ProductionDomainError("RECALL_SCOPE_VIOLATION", "Recall lot is outside the supplier production scope", 403);
        }
        if (purchaseOrderItemId || variantId) {
          const context = job ? await this.orders.getProductionEligibility({ childOrderId: job.purchaseOrderId, executor: tx }) : null;
          if (context) {
            const matches = context.items.some((item) => item.id === purchaseOrderItemId || (variantId !== null && item.variantId === variantId));
            if (!matches) throw new ProductionDomainError("RECALL_SCOPE_VIOLATION", "Recall target is outside the canonical child order", 403);
          } else if (!await this.orders.isProductionTargetInSupplierScope({ supplierId, purchaseOrderItemId, variantId, executor: tx })) {
            throw new ProductionDomainError("RECALL_SCOPE_VIOLATION", "Recall target is outside the supplier purchase-order scope", 403);
          }
        }
        const quantity = target.quantity === undefined || target.quantity === null ? null : requireSafeInteger(target.quantity, "quantity", 0);
        await tx.insert(productionRecallScope).values({ id: id("prcs"), recallId: recall.id, lotId, purchaseOrderItemId, variantId, quantity });
      }
      await this.recordAudit(tx, actor, "production.recall_created", "production_recall", recall.id, { supplierId, severity: scope.severity, scopeType: scope.scopeType, highImpact: scope.highImpact });
      await this.completeCommand(tx, claim.command.id, recall.id, { recallId: recall.id });
      return { recall, replayed: false };
    });
  }

  async submitRecall(actor: ProductionActor, recallId: string, input: { idempotencyKey: string }) {
    return this.db.transaction(async (tx: any) => {
      const [recall] = await tx.select().from(productionRecall).where(eq(productionRecall.id, recallId)).for("update").limit(1);
      if (!recall) throw new ProductionDomainError("RECALL_NOT_FOUND", "Recall not found", 404);
      await this.assertSupplierMember(actor, recall.supplierId, "recall_propose", tx);
      const claim = await this.claimCommand(tx, "production_recall", recall.id, "production.recall_submit", input.idempotencyKey, { recallId });
      if (!claim.replayed) {
        assertTransition(RECALL_TRANSITIONS, recall.status, "pending_approval", "INVALID_RECALL_TRANSITION");
        await tx.update(productionRecall).set({ status: "pending_approval", updatedAt: new Date() }).where(eq(productionRecall.id, recall.id));
        await this.emit(tx, { eventType: "RECALL_SUBMITTED", entityType: "production_recall", entityId: recall.id, jobId: recall.jobId, supplierId: recall.supplierId, recipientScope: "ADMIN_USER", payload: { recallId: recall.id, severity: recall.severity, scopeType: recall.scopeType, highImpact: recall.severity === "critical" || recall.severity === "global" || recall.scopeType === "global" } });
        await this.recordAudit(tx, actor, "production.recall_submitted", "production_recall", recall.id, { status: "pending_approval" });
      }

      let current = claim.replayed ? recall : (await tx.select().from(productionRecall).where(eq(productionRecall.id, recall.id)).limit(1))[0];
      let approval: any = null;
      if (current.approvalRequestId) {
        approval = (await tx.select().from(approvalRequest).where(eq(approvalRequest.id, current.approvalRequestId)).limit(1))[0] ?? null;
      } else {
        approval = await this.approvals.createApprovalRequest({ requestType: "PRODUCTION_RECALL" as any, targetType: "production_recall", targetId: current.id, payload: { recallId: current.id, supplierId: current.supplierId, severity: current.severity, scopeType: current.scopeType }, makerNotes: current.reason, idempotencyKey: `production-recall:${current.id}` }, actor.userId);
        const [linked] = await tx.update(productionRecall).set({ approvalRequestId: approval.id, updatedAt: new Date() }).where(eq(productionRecall.id, current.id)).returning();
        current = linked ?? current;
      }
      if (!claim.replayed) await this.completeCommand(tx, claim.command.id, current.id, { recallId: current.id, status: "pending_approval", approvalRequestId: approval?.id ?? null });
      return { recall: current, approvalRequest: approval, replayed: claim.replayed };
    });
  }

  async approveRecall(actor: ProductionActor, recallId: string, input: { decision: "approve" | "reject"; notes?: unknown; idempotencyKey: string }) {
    if (actor.role !== "admin") throw new ProductionDomainError("ROLE_NOT_ALLOWED", "Only Admin can approve or reject a recall", 403);
    const notes = optionalText(input.notes, "notes", 3000);
    return this.db.transaction(async (tx: any) => {
      const [locked] = await tx.select().from(productionRecall).where(eq(productionRecall.id, recallId)).for("update").limit(1);
      if (!locked) throw new ProductionDomainError("RECALL_NOT_FOUND", "Recall not found", 404);
      if (!locked.approvalRequestId) throw new ProductionDomainError("RECALL_APPROVAL_REQUIRED", "Recall has no Admin approval request", 409);
      const claim = await this.claimCommand(tx, "production_recall", locked.id, "production.recall_approval", input.idempotencyKey, { recallId, decision: input.decision, notes });
      const [approvalRow] = await tx.select().from(approvalRequest).where(eq(approvalRequest.id, locked.approvalRequestId)).limit(1);
      if (!approvalRow) throw new ProductionDomainError("RECALL_APPROVAL_REQUIRED", "Recall approval request was not found", 409);
      if (claim.replayed) return { recall: locked, approval: approvalRow, replayed: true };

      const targetStatus = input.decision === "approve" ? "approved" : "rejected";
      assertTransition(RECALL_TRANSITIONS, locked.status, targetStatus, "INVALID_RECALL_TRANSITION");
      let approval = approvalRow;
      const approvalMatchesDecision = (input.decision === "approve" && ["approved", "executed"].includes(approval.status)) || (input.decision === "reject" && approval.status === "rejected");
      if (!approvalMatchesDecision) {
        if (approval.status !== "pending") throw new ProductionDomainError("RECALL_APPROVAL_STATE_CONFLICT", `Approval request is ${approval.status}`, 409);
        approval = await this.approvals.decideApprovalRequest(locked.approvalRequestId, input.decision, notes ?? undefined, actor.userId, false);
      }

      const now = new Date();
      const [updated] = await tx.update(productionRecall).set({ status: input.decision === "approve" ? "active" : "rejected", checkerId: actor.userId, activatedAt: input.decision === "approve" ? now : null, updatedAt: now }).where(eq(productionRecall.id, locked.id)).returning();
      await tx.insert(productionRecallApproval).values({ id: id("prap"), recallId: locked.id, approvalRequestId: locked.approvalRequestId, decision: input.decision === "approve" ? "approved" : "rejected", makerId: locked.makerId, checkerId: actor.userId, notes });
      if (input.decision === "approve") {
        const scopes = await tx.select().from(productionRecallScope).where(eq(productionRecallScope.recallId, locked.id));
        for (const target of scopes) if (target.lotId) {
          const [lot] = await tx.select().from(productionLot).where(eq(productionLot.id, target.lotId)).for("update").limit(1);
          if (lot && ["open", "in_progress", "completed", "released"].includes(lot.status)) await tx.update(productionLot).set({ status: "recall_hold", updatedAt: now }).where(eq(productionLot.id, lot.id));
        }
        await this.emit(tx, { eventType: "RECALL_ACTIVATED", entityType: "production_recall", entityId: locked.id, jobId: locked.jobId, supplierId: locked.supplierId, recipientScope: "SUPPLIER", recipientId: locked.supplierId, payload: { recallId: locked.id, status: "active", highImpact: locked.severity === "critical" || locked.severity === "global" || locked.scopeType === "global" } });
      }
      await this.recordAudit(tx, actor, input.decision === "approve" ? "production.recall_activated" : "production.recall_rejected", "production_recall", locked.id, { approvalRequestId: locked.approvalRequestId, decision: input.decision });
      await this.completeCommand(tx, claim.command.id, locked.id, { recallId: locked.id, status: input.decision === "approve" ? "active" : "rejected" });
      return { recall: updated, approval, replayed: false };
    });
  }

  async transitionRecall(actor: ProductionActor, recallId: string, toStatus: string, input: { idempotencyKey: string; reason?: unknown }) {
    if (actor.role !== "admin") throw new ProductionDomainError("ROLE_NOT_ALLOWED", "Only Admin can contain or close recalls", 403);
    const reason = optionalText(input.reason, "reason", 2000);
    return this.db.transaction(async (tx: any) => {
      const [recall] = await tx.select().from(productionRecall).where(eq(productionRecall.id, recallId)).for("update").limit(1);
      if (!recall) throw new ProductionDomainError("RECALL_NOT_FOUND", "Recall not found", 404);
      assertOneOf(toStatus, PRODUCTION_RECALL_STATUSES, "status");
      const claim = await this.claimCommand(tx, "production_recall", recall.id, "production.recall_transition", input.idempotencyKey, { recallId, toStatus, reason });
      if (claim.replayed) return { recall, replayed: true };
      assertTransition(RECALL_TRANSITIONS, recall.status, toStatus, "INVALID_RECALL_TRANSITION");
      if (["contained", "closed"].includes(toStatus) && !reason) throw new ProductionDomainError("RECALL_REASON_REQUIRED", "A reason is required");
      const now = new Date();
      const patch: any = { status: toStatus, updatedAt: now };
      if (toStatus === "contained") patch.containedAt = now;
      if (toStatus === "closed") patch.closedAt = now;
      const [updated] = await tx.update(productionRecall).set(patch).where(eq(productionRecall.id, recall.id)).returning();
      await this.recordAudit(tx, actor, "production.recall_status_changed", "production_recall", recall.id, { fromStatus: recall.status, toStatus, reason });
      await this.completeCommand(tx, claim.command.id, recall.id, { recallId: recall.id, status: toStatus });
      return { recall: updated, replayed: false };
    });
  }

  async listRecalls(actor: ProductionActor, input: { supplierId?: string | null; page?: unknown; limit?: unknown }) {
    const supplierId = await this.resolveSupplierForActor(actor, input.supplierId);
    await this.assertSupplierMember(actor, supplierId, "read");
    const { page, limit, offset } = pageInput(input.page, input.limit);
    const rows = await this.db.select().from(productionRecall).where(eq(productionRecall.supplierId, supplierId)).orderBy(desc(productionRecall.createdAt)).limit(limit).offset(offset);
    return pageResult(rows, page, limit);
  }
}
