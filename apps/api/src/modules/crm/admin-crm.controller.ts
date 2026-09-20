import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { AdminPermissionGuard, RequireAdminPermission } from "../admin/admin-rbac.guard";
import { CrmContactService } from "./crm-contact.service";
import { CrmTagService } from "./crm-tag.service";
import { CrmActivityService } from "./crm-activity.service";
import { CrmTaskService } from "./crm-task.service";
import { Customer360Service } from "./customer-360.service";
import { CrmOperationsService } from "./crm-operations.service";

@Controller("admin/crm")
@Roles("admin")
@UseGuards(AdminPermissionGuard)
export class AdminCrmController {
  constructor(
    @Inject(CrmContactService) private readonly contactService: CrmContactService,
    @Inject(CrmTagService) private readonly tagService: CrmTagService,
    @Inject(CrmActivityService) private readonly activityService: CrmActivityService,
    @Inject(CrmTaskService) private readonly taskService: CrmTaskService,
    @Inject(Customer360Service) private readonly customer360Service: Customer360Service,
    @Inject(CrmOperationsService) private readonly operationsService: CrmOperationsService,
  ) {}

  // ── Operations & Pipeline ─────────────────────────────────
  @Get("pipeline")
  @RequireAdminPermission("crm:customer:view")
  async getPipeline(@Query("assignedAdminId") assignedAdminId?: string) {
    const pipeline = await this.operationsService.getPipelineMetrics(assignedAdminId);
    return toApiJson(pipeline);
  }

  @Get("dedup-check")
  @RequireAdminPermission("crm:customer:view")
  async checkDuplicates(
    @Query("phone") phone?: string,
    @Query("email") email?: string,
    @Query("name") name?: string,
    @Query("excludeContactId") excludeContactId?: string,
  ) {
    const result = await this.operationsService.checkDuplicates({
      phone,
      email,
      name,
      excludeContactId,
    });
    return toApiJson(result);
  }

  @Get("export")
  @RequireAdminPermission("crm:export")
  async exportCsv(
    @Query("stage") stage: any,
    @Query("search") search: string | undefined,
    @Query("assignedAdminId") assignedAdminId: string | undefined,
    @Res() res: Response,
  ) {
    const csv = await this.operationsService.exportContactsCsv({
      stage,
      search,
      assignedAdminId,
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="crm_contacts_${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return res.status(200).send(csv);
  }

  // ── Customer 360 ──────────────────────────────────────────
  @Get("contacts/:id/360")
  @RequireAdminPermission("crm:customer:view")
  async getCustomer360(@Param("id") id: string) {
    const data = await this.customer360Service.getCustomer360(id);
    return toApiJson(data);
  }

  // ── Contacts ──────────────────────────────────────────────
  @Get("contacts")
  @RequireAdminPermission("crm:customer:view")
  async listContacts(
    @Query("stage") stage?: any,
    @Query("search") search?: string,
    @Query("assignedAdminId") assignedAdminId?: string,
    @Query("tagId") tagId?: string,
    @Query("isLinked") isLinked?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const result = await this.contactService.listContacts({
      stage,
      search,
      assignedAdminId,
      tagId,
      isLinked: isLinked !== undefined ? isLinked === "true" : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return toApiJson(result);
  }

  @Post("contacts")
  @RequireAdminPermission("crm:customer:manage")
  async createContact(@Body() body: any, @CurrentUser() user: Claims) {
    const contact = await this.contactService.createContact(body, user.sub);
    return toApiJson({ contact });
  }

  @Get("contacts/:id")
  @RequireAdminPermission("crm:customer:view")
  async getContact(@Param("id") id: string) {
    const contact = await this.contactService.getContact(id);
    return toApiJson({ contact });
  }

  @Patch("contacts/:id")
  @RequireAdminPermission("crm:customer:manage")
  async updateContact(
    @Param("id") id: string,
    @Body() body: any,
    @CurrentUser() user: Claims,
  ) {
    const contact = await this.contactService.updateContact(id, body, user.sub);
    return toApiJson({ contact });
  }

  @Post("contacts/:id/link")
  @RequireAdminPermission("crm:customer:manage")
  async linkIdentity(
    @Param("id") id: string,
    @Body() body: { userId: string; linkType?: any },
    @CurrentUser() user: Claims,
  ) {
    const link = await this.contactService.linkIdentity(
      id,
      body.userId,
      user.sub,
      body.linkType,
    );
    return toApiJson({ link });
  }

  @Post("contacts/:id/stage")
  @RequireAdminPermission("crm:stage:manage")
  async changeStage(
    @Param("id") id: string,
    @Body() body: { stage: any; reason?: string; source?: any },
    @CurrentUser() user: Claims,
  ) {
    const contact = await this.contactService.changeStage(
      id,
      body.stage,
      user.sub,
      body.reason,
      body.source,
    );
    return toApiJson({ contact });
  }

  @Post("contacts/:id/assign")
  @RequireAdminPermission("crm:assign:manage")
  async assignAdmin(
    @Param("id") id: string,
    @Body() body: { adminId: string | null; reason?: string },
    @CurrentUser() user: Claims,
  ) {
    const contact = await this.contactService.assignAdmin(
      id,
      body.adminId,
      user.sub,
      body.reason,
    );
    return toApiJson({ contact });
  }

  @Get("contacts/:id/stage-history")
  @RequireAdminPermission("crm:customer:view")
  async getStageHistory(@Param("id") id: string) {
    const history = await this.contactService.getStageHistory(id);
    return toApiJson({ history });
  }

  @Get("contacts/:id/assignment-history")
  @RequireAdminPermission("crm:customer:view")
  async getAssignmentHistory(@Param("id") id: string) {
    const history = await this.contactService.getAssignmentHistory(id);
    return toApiJson({ history });
  }

  // ── Tags ──────────────────────────────────────────────────
  @Get("tags")
  @RequireAdminPermission("crm:tag:manage")
  async listTags() {
    const tags = await this.tagService.listTags();
    return toApiJson({ tags });
  }

  @Post("tags")
  @RequireAdminPermission("crm:tag:manage")
  async createTag(@Body() body: any, @CurrentUser() user: Claims) {
    const tag = await this.tagService.createTag(body, user.sub);
    return toApiJson({ tag });
  }

  @Post("contacts/:id/tags")
  @RequireAdminPermission("crm:tag:manage")
  async addTagToContact(
    @Param("id") id: string,
    @Body() body: { tagId: string },
    @CurrentUser() user: Claims,
  ) {
    const result = await this.tagService.addTagToContact(id, body.tagId, user.sub);
    return toApiJson({ assignment: result });
  }

  @Delete("contacts/:id/tags/:tagId")
  @RequireAdminPermission("crm:tag:manage")
  async removeTagFromContact(
    @Param("id") id: string,
    @Param("tagId") tagId: string,
    @CurrentUser() user: Claims,
  ) {
    await this.tagService.removeTagFromContact(id, tagId, user.sub);
    return toApiJson({ success: true });
  }

  // ── Activities ────────────────────────────────────────────
  @Post("contacts/:id/activities")
  @RequireAdminPermission("crm:activity:create")
  async recordActivity(
    @Param("id") id: string,
    @Body() body: any,
    @CurrentUser() user: Claims,
  ) {
    const activity = await this.activityService.recordActivity(
      {
        contactId: id,
        activityType: body.activityType,
        body: body.body,
        source: body.source,
        visibility: body.visibility,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
        metadata: body.metadata,
      },
      user.sub,
    );
    return toApiJson({ activity });
  }

  @Get("contacts/:id/activities")
  @RequireAdminPermission("crm:customer:view")
  async listActivities(
    @Param("id") id: string,
    @Query("activityType") activityType?: any,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const result = await this.activityService.listActivities(id, {
      activityType,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return toApiJson(result);
  }

  // ── Tasks ─────────────────────────────────────────────────
  @Post("tasks")
  @RequireAdminPermission("crm:task:manage")
  async createTask(@Body() body: any, @CurrentUser() user: Claims) {
    const task = await this.taskService.createTask(
      {
        contactId: body.contactId,
        title: body.title,
        description: body.description,
        assigneeId: body.assigneeId,
        priority: body.priority,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        metadata: body.metadata,
      },
      user.sub,
    );
    return toApiJson({ task });
  }

  @Get("tasks")
  @RequireAdminPermission("crm:task:manage")
  async listTasks(
    @Query("contactId") contactId?: string,
    @Query("assigneeId") assigneeId?: string,
    @Query("status") status?: any,
    @Query("priority") priority?: any,
    @Query("queue") queue?: any,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
    @CurrentUser() user?: Claims,
  ) {
    const result = await this.taskService.listTasks({
      contactId,
      assigneeId,
      status,
      priority,
      queue,
      actorId: user?.sub,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return toApiJson(result);
  }

  @Get("tasks/:id")
  @RequireAdminPermission("crm:task:manage")
  async getTask(@Param("id") id: string) {
    const task = await this.taskService.getTask(id);
    return toApiJson({ task });
  }

  @Patch("tasks/:id/start")
  @RequireAdminPermission("crm:task:manage")
  async startTask(@Param("id") id: string, @CurrentUser() user: Claims) {
    const task = await this.taskService.startTask(id, user.sub);
    return toApiJson({ task });
  }

  @Patch("tasks/:id/complete")
  @RequireAdminPermission("crm:task:manage")
  async completeTask(@Param("id") id: string, @CurrentUser() user: Claims) {
    const task = await this.taskService.completeTask(id, user.sub);
    return toApiJson({ task });
  }

  @Patch("tasks/:id/cancel")
  @RequireAdminPermission("crm:task:manage")
  async cancelTask(
    @Param("id") id: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: Claims,
  ) {
    const task = await this.taskService.cancelTask(id, user.sub, body?.reason);
    return toApiJson({ task });
  }

  @Patch("tasks/:id/reopen")
  @RequireAdminPermission("crm:task:manage")
  async reopenTask(@Param("id") id: string, @CurrentUser() user: Claims) {
    const task = await this.taskService.reopenTask(id, user.sub);
    return toApiJson({ task });
  }

  @Patch("tasks/:id/reassign")
  @RequireAdminPermission("crm:assign:manage")
  async reassignTask(
    @Param("id") id: string,
    @Body() body: { assigneeId: string | null },
    @CurrentUser() user: Claims,
  ) {
    const task = await this.taskService.reassignTask(id, body.assigneeId, user.sub);
    return toApiJson({ task });
  }
}
