import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  UseGuards,
  Inject,
} from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { AdminPermissionGuard, RequireAdminPermission } from "../admin/admin-rbac.guard";
import { SupportCaseService } from "./support-case.service";
import { SupportConversationService } from "./support-conversation.service";
import { SupportSlaService, type CreateSlaPolicyInput } from "./support-sla.service";
import { SupportOperationsService } from "./support-operations.service";
import { SupportActionService, type RecordCaseActionInput, type CompleteCaseActionInput } from "./support-action.service";
import type {
  SupportCategory,
  SupportPriority,
  SupportCaseStatus,
  SupportRequesterType,
  SupportTeam,
  SupportVisibility,
  SupportEscalationSource,
  SupportRelationType,
} from "@kolbe/database";

export interface AdminCreateCaseDto {
  requesterType: SupportRequesterType;
  requesterUserId?: string;
  wholesaleAccountId?: string;
  supplierId?: string;
  category: SupportCategory;
  subject: string;
  priority?: SupportPriority;
  initialMessage?: string;
  relations?: Array<{
    relationType: SupportRelationType;
    targetId: string;
    itemId?: string | null;
    quantity?: number | null;
    metadata?: Record<string, unknown>;
  }>;
}

export interface AdminChangeStatusDto {
  toStatus: SupportCaseStatus;
  reason?: string;
}

export interface AdminChangePriorityDto {
  priority: SupportPriority;
  reason?: string;
}

export interface AdminAssignCaseDto {
  adminId: string;
  teamKey?: SupportTeam;
  reason?: string;
}

export interface AdminEscalateDto {
  newPriority: SupportPriority;
  toTeamKey?: SupportTeam;
  reason: string;
  source?: SupportEscalationSource;
}

export interface AdminReplyMessageDto {
  body: string;
  visibility?: SupportVisibility;
  idempotencyKey?: string;
  attachmentIds?: string[];
}

export interface AdminCreateInternalNoteDto {
  body: string;
  isPinned?: boolean;
}

export interface AdminTogglePinDto {
  isPinned: boolean;
}

export interface AdminRecordActionDto {
  actionType: any;
  targetDomain: string;
  targetId: string;
  payload?: Record<string, unknown>;
}

@Controller("admin/support")
@Roles("admin")
@UseGuards(AdminPermissionGuard)
export class AdminSupportController {
  constructor(
    @Inject(SupportCaseService) private readonly caseService: SupportCaseService,
    @Inject(SupportConversationService) private readonly convService: SupportConversationService,
    @Inject(SupportSlaService) private readonly slaService: SupportSlaService,
    @Inject(SupportOperationsService) private readonly opsService: SupportOperationsService,
    @Inject(SupportActionService) private readonly actionService: SupportActionService,
  ) {}

  // ── Cases ──────────────────────────────────────────────────
  @Get("cases")
  @RequireAdminPermission("support:case:view")
  async listCases(
    @Query("requesterType") requesterType?: SupportRequesterType,
    @Query("status") status?: SupportCaseStatus,
    @Query("category") category?: SupportCategory,
    @Query("priority") priority?: SupportPriority,
    @Query("assignedAdminId") assignedAdminId?: string,
    @Query("assignedTeamKey") assignedTeamKey?: string,
    @Query("search") search?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const list = await this.caseService.listCases({
      requesterType,
      status,
      category,
      priority,
      assignedAdminId,
      assignedTeamKey,
      search,
      limit: limit ? Number.parseInt(limit, 10) : 50,
      offset: offset ? Number.parseInt(offset, 10) : 0,
    });

    return toApiJson(list);
  }

  @Post("cases")
  @RequireAdminPermission("support:case:reply")
  async createCase(
    @CurrentUser() claims: Claims,
    @Body() dto: AdminCreateCaseDto,
  ) {
    const created = await this.caseService.createCase({
      requesterType: dto.requesterType,
      requesterUserId: dto.requesterUserId,
      wholesaleAccountId: dto.wholesaleAccountId,
      supplierId: dto.supplierId,
      category: dto.category,
      subject: dto.subject,
      priority: dto.priority ?? "NORMAL",
      source: "ADMIN_MANUAL",
      initialMessage: dto.initialMessage,
      relations: dto.relations,
    });

    await this.slaService.applySlaToCase(created.id);

    return toApiJson(created);
  }

  @Get("cases/:id")
  @RequireAdminPermission("support:case:view")
  async getCase(@Param("id") id: string) {
    const c = await this.caseService.getCaseById(id);
    const messages = await this.convService.listMessages(id, "admin");
    const internalNotes = await this.convService.listInternalNotes(id, "admin");
    const statusHistory = await this.caseService.getCaseStatusHistory(id);
    const priorityHistory = await this.caseService.getCasePriorityHistory(id);
    const assignmentHistory = await this.caseService.getCaseAssignmentHistory(id);
    const relations = await this.caseService.getCaseRelations(id);
    const sla = await this.slaService.evaluateCaseSla(id);
    const actions = await this.actionService.listActionsForCase(id);

    return toApiJson({
      case: c,
      messages,
      internalNotes,
      statusHistory,
      priorityHistory,
      assignmentHistory,
      relations,
      sla,
      actions,
    });
  }

  @Post("cases/:id/status")
  @RequireAdminPermission("support:case:resolve")
  async transitionStatus(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Body() dto: AdminChangeStatusDto,
  ) {
    const updated = await this.caseService.transitionStatus(
      id,
      dto.toStatus,
      { type: "ADMIN", id: claims.sub },
      dto.reason,
      "PORTAL",
    );

    if (dto.toStatus === "RESOLVED") {
      await this.slaService.recordResolution(id);
    }

    return toApiJson(updated);
  }

  @Post("compat/tickets/:id")
  @HttpCode(200)
  @RequireAdminPermission("support:case:reply")
  async legacyCombined(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: any) {
    return this.caseService.applyLegacyAdminCommand(id, body, claims.sub);
  }

  @Post("cases/:id/priority")
  @RequireAdminPermission("support:case:priority")
  async changePriority(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Body() dto: AdminChangePriorityDto,
  ) {
    const updated = await this.caseService.changePriority(
      id,
      dto.priority,
      claims.sub,
      dto.reason,
    );

    return toApiJson(updated);
  }

  @Post("cases/:id/assign")
  @RequireAdminPermission("support:case:assign")
  async assignCase(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Body() dto: AdminAssignCaseDto,
  ) {
    const updated = await this.caseService.assignCase(
      id,
      dto.adminId,
      dto.teamKey ?? null,
      claims.sub,
      dto.reason,
    );

    return toApiJson(updated);
  }

  @Post("cases/:id/escalate")
  @RequireAdminPermission("support:case:priority")
  async escalateCase(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Body() dto: AdminEscalateDto,
  ) {
    const result = await this.slaService.escalateCase(id, {
      newPriority: dto.newPriority,
      toTeamKey: dto.toTeamKey,
      reason: dto.reason,
      source: dto.source ?? "MANUAL_ADMIN",
      actorAdminId: claims.sub,
    });

    return toApiJson(result);
  }

  @Post("cases/:id/messages")
  @RequireAdminPermission("support:case:reply")
  async replyMessage(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Body() dto: AdminReplyMessageDto,
  ) {
    const msg = await this.convService.addMessage({
      caseId: id,
      author: {
        type: "ADMIN",
        id: claims.sub,
        displayName: "Support Agent",
      },
      body: dto.body,
      visibility: dto.visibility ?? "PUBLIC",
      idempotencyKey: dto.idempotencyKey,
      attachmentIds: dto.attachmentIds,
    });

    // Record agent first response
    await this.slaService.recordFirstResponse(id);

    return toApiJson(msg);
  }

  // ── Internal Notes ────────────────────────────────────────
  @Get("cases/:id/internal-notes")
  @RequireAdminPermission("support:case:view")
  async listInternalNotes(@Param("id") id: string) {
    const notes = await this.convService.listInternalNotes(id, "admin");
    return toApiJson(notes);
  }

  @Post("cases/:id/internal-notes")
  @RequireAdminPermission("support:internal_note:create")
  async addInternalNote(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Body() dto: AdminCreateInternalNoteDto,
  ) {
    const note = await this.convService.addInternalNote({
      caseId: id,
      adminId: claims.sub,
      adminDisplayName: "Support Agent",
      body: dto.body,
      isPinned: dto.isPinned,
    });

    return toApiJson(note);
  }

  @Post("internal-notes/:id/pin")
  @RequireAdminPermission("support:internal_note:create")
  async togglePin(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Body() dto: AdminTogglePinDto,
  ) {
    const updated = await this.convService.togglePinInternalNote(id, dto.isPinned, claims.sub);
    return toApiJson(updated);
  }

  // ── Cross-Domain Actions ──────────────────────────────────
  @Get("cases/:id/actions")
  @RequireAdminPermission("support:case:view")
  async listActions(@Param("id") id: string) {
    const actions = await this.actionService.listActionsForCase(id);
    return toApiJson(actions);
  }

  @Post("cases/:id/actions")
  @RequireAdminPermission("support:case:resolve")
  async recordAction(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Body() dto: AdminRecordActionDto,
  ) {
    const action = await this.actionService.recordAction({
      caseId: id,
      actionType: dto.actionType,
      targetDomain: dto.targetDomain,
      targetId: dto.targetId,
      requestedByAdminId: claims.sub,
      payload: dto.payload,
    });

    return toApiJson(action);
  }

  @Post("actions/:id/complete")
  @RequireAdminPermission("support:case:resolve")
  async completeAction(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Body() dto: { status: "EXECUTED" | "REJECTED" | "IN_REVIEW"; resultingReference?: string },
  ) {
    const action = await this.actionService.completeAction(id, {
      status: dto.status,
      resultingReference: dto.resultingReference,
      adminId: claims.sub,
    });

    return toApiJson(action);
  }

  // ── Operational Queues ────────────────────────────────────
  @Get("queues/:queueType")
  @RequireAdminPermission("support:case:view")
  async getQueue(
    @CurrentUser() claims: Claims,
    @Param("queueType") queueType: string,
    @Query("teamKey") teamKey?: SupportTeam,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const pagination = {
      limit: limit ? Number.parseInt(limit, 10) : 50,
      offset: offset ? Number.parseInt(offset, 10) : 0,
    };

    switch (queueType) {
      case "unassigned":
        return toApiJson(await this.opsService.getUnassignedQueue(pagination));
      case "my":
        return toApiJson(await this.opsService.getMyQueue(claims.sub, pagination));
      case "team":
        return toApiJson(await this.opsService.getTeamQueue(teamKey ?? "RETAIL_SUPPORT", pagination));
      case "urgent":
        return toApiJson(await this.opsService.getUrgentQueue(pagination));
      case "breached":
        return toApiJson(await this.opsService.getBreachedQueue(pagination));
      default:
        return toApiJson(await this.opsService.getUnassignedQueue(pagination));
    }
  }

  // ── Control Tower Metrics ─────────────────────────────────
  @Get("metrics")
  @RequireAdminPermission("support:report:view")
  async getMetrics() {
    const metrics = await this.opsService.getControlTowerMetrics();
    return toApiJson(metrics);
  }

  // ── SLA Policies ──────────────────────────────────────────
  @Get("sla/policies")
  @RequireAdminPermission("support:sla:manage")
  async listPolicies(@Query("activeOnly") activeOnly?: string) {
    const policies = await this.slaService.listPolicies(activeOnly !== "false");
    return toApiJson(policies);
  }

  @Post("sla/policies")
  @RequireAdminPermission("support:sla:manage")
  async createPolicy(@Body() dto: CreateSlaPolicyInput) {
    const policy = await this.slaService.createPolicy(dto);
    return toApiJson(policy);
  }
}
