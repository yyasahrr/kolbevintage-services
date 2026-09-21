import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Inject,
} from "@nestjs/common";
import { eq, and } from "drizzle-orm";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { wholesaleAccount, type SupportCategory, type SupportPriority, type SupportRelationType } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { SupportCaseService } from "./support-case.service";
import { SupportConversationService } from "./support-conversation.service";
import { SupportSlaService } from "./support-sla.service";
import { SupportUnauthorizedAccessError } from "./support.errors";

export interface CreateVipCaseDto {
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

export interface AddVipMessageDto {
  body: string;
  idempotencyKey?: string;
  attachmentIds?: string[];
}

@Controller("vip/support/cases")
@Roles("vip")
export class VipSupportController {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(SupportCaseService) private readonly caseService: SupportCaseService,
    @Inject(SupportConversationService) private readonly convService: SupportConversationService,
    @Inject(SupportSlaService) private readonly slaService: SupportSlaService,
  ) {}

  private async getWholesaleAccountId(userId: string): Promise<string> {
    const [acc] = await this.db
      .select({ id: wholesaleAccount.id })
      .from(wholesaleAccount)
      .where(eq(wholesaleAccount.userId, userId))
      .limit(1);

    if (!acc) {
      throw new SupportUnauthorizedAccessError("No wholesale account found for this VIP member");
    }
    return acc.id;
  }

  @Post()
  async createCase(
    @CurrentUser() claims: Claims,
    @Body() dto: CreateVipCaseDto,
  ) {
    const accountId = await this.getWholesaleAccountId(claims.sub);

    const created = await this.caseService.createCase({
      requesterType: "VIP_BUYER",
      requesterUserId: claims.sub,
      wholesaleAccountId: accountId,
      category: dto.category,
      subject: dto.subject,
      priority: dto.priority ?? "NORMAL",
      source: "VIP_PORTAL",
      initialMessage: dto.initialMessage,
      relations: dto.relations,
    });

    await this.slaService.applySlaToCase(created.id);

    return toApiJson(created);
  }

  @Get()
  async listCases(
    @CurrentUser() claims: Claims,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const accountId = await this.getWholesaleAccountId(claims.sub);

    const list = await this.caseService.listCases({
      requesterType: "VIP_BUYER",
      limit: limit ? Number.parseInt(limit, 10) : 20,
      offset: offset ? Number.parseInt(offset, 10) : 0,
    });

    const myCases = list.cases.filter(
      (c) => c.wholesaleAccountId === accountId || c.requesterUserId === claims.sub,
    );

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
    const accountId = await this.getWholesaleAccountId(claims.sub);

    await this.convService.verifyParticipantAccess(id, {
      userId: claims.sub,
      role: "vip",
      wholesaleAccountId: accountId,
    });

    const c = await this.caseService.getCaseById(id);
    const messages = await this.convService.listMessages(id, "vip");
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
    @Body() dto: AddVipMessageDto,
  ) {
    const accountId = await this.getWholesaleAccountId(claims.sub);

    await this.convService.verifyParticipantAccess(id, {
      userId: claims.sub,
      role: "vip",
      wholesaleAccountId: accountId,
    });

    const msg = await this.convService.addMessage({
      caseId: id,
      author: {
        type: "VIP_BUYER",
        id: claims.sub,
        displayName: "VIP Buyer",
      },
      body: dto.body,
      visibility: "PUBLIC",
      idempotencyKey: dto.idempotencyKey,
      attachmentIds: dto.attachmentIds,
    });

    return toApiJson(msg);
  }
}
