import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Inject,
} from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { SupportCaseService } from "./support-case.service";
import { SupportConversationService } from "./support-conversation.service";
import { SupportSlaService } from "./support-sla.service";
import type {
  SupportCategory,
  SupportPriority,
  SupportRelationType,
} from "@kolbe/database";

export interface CreateCustomerCaseDto {
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

export interface AddCustomerMessageDto {
  body: string;
  idempotencyKey?: string;
  attachmentIds?: string[];
}

@Controller("support/cases")
@Roles("customer")
export class CustomerSupportController {
  constructor(
    @Inject(SupportCaseService) private readonly caseService: SupportCaseService,
    @Inject(SupportConversationService) private readonly convService: SupportConversationService,
    @Inject(SupportSlaService) private readonly slaService: SupportSlaService,
  ) {}

  @Post()
  async createCase(
    @CurrentUser() claims: Claims,
    @Body() dto: CreateCustomerCaseDto,
  ) {
    const created = await this.caseService.createCase({
      requesterType: "RETAIL_CUSTOMER",
      requesterUserId: claims.sub,
      category: dto.category,
      subject: dto.subject,
      priority: dto.priority ?? "NORMAL",
      source: "PORTAL",
      initialMessage: dto.initialMessage,
      relations: dto.relations,
    });

    // Auto-apply SLA target snapshot
    await this.slaService.applySlaToCase(created.id);

    return toApiJson(created);
  }

  @Get()
  async listCases(
    @CurrentUser() claims: Claims,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const list = await this.caseService.listCases({
      requesterType: "RETAIL_CUSTOMER",
      limit: limit ? Number.parseInt(limit, 10) : 20,
      offset: offset ? Number.parseInt(offset, 10) : 0,
    });

    // Strictly filter only cases owned by this customer
    const myCases = list.cases.filter((c) => c.requesterUserId === claims.sub);

    return toApiJson({
      cases: myCases,
      total: myCases.length,
    });
  }

  @Get(":id")
  async getCase(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
  ) {
    await this.convService.verifyParticipantAccess(id, {
      userId: claims.sub,
      role: "customer",
    });

    const c = await this.caseService.getCaseById(id);
    const messages = await this.convService.listMessages(id, "customer");
    const relations = await this.caseService.getCaseRelations(id);

    return toApiJson({
      case: c,
      messages,
      relations,
    });
  }

  @Post(":id/messages")
  async addMessage(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Body() dto: AddCustomerMessageDto,
  ) {
    await this.convService.verifyParticipantAccess(id, {
      userId: claims.sub,
      role: "customer",
    });

    const msg = await this.convService.addMessage({
      caseId: id,
      author: {
        type: "CUSTOMER",
        id: claims.sub,
        displayName: "Customer",
      },
      body: dto.body,
      visibility: "PUBLIC",
      idempotencyKey: dto.idempotencyKey,
      attachmentIds: dto.attachmentIds,
    });

    return toApiJson(msg);
  }
}
