import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Inject,
} from "@nestjs/common";
import { eq } from "drizzle-orm";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { supplierMember, type SupportCategory, type SupportPriority, type SupportRelationType } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { SupportCaseService } from "./support-case.service";
import { SupportConversationService } from "./support-conversation.service";
import { SupportSlaService } from "./support-sla.service";
import { SupportUnauthorizedAccessError } from "./support.errors";

export interface CreateSupplierCaseDto {
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

export interface AddSupplierMessageDto {
  body: string;
  idempotencyKey?: string;
  attachmentIds?: string[];
}

@Controller("supplier/support/cases")
@Roles("supplier")
export class SupplierSupportController {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(SupportCaseService) private readonly caseService: SupportCaseService,
    @Inject(SupportConversationService) private readonly convService: SupportConversationService,
    @Inject(SupportSlaService) private readonly slaService: SupportSlaService,
  ) {}

  private async getSupplierId(userId: string): Promise<string> {
    const [mem] = await this.db
      .select({ supplierId: supplierMember.supplierId })
      .from(supplierMember)
      .where(eq(supplierMember.userId, userId))
      .limit(1);

    if (!mem) {
      throw new SupportUnauthorizedAccessError("No supplier profile found for this user account");
    }
    return mem.supplierId;
  }

  @Post()
  async createCase(
    @CurrentUser() claims: Claims,
    @Body() dto: CreateSupplierCaseDto,
  ) {
    const supplierId = await this.getSupplierId(claims.sub);

    const created = await this.caseService.createCase({
      requesterType: "SUPPLIER",
      requesterUserId: claims.sub,
      supplierId,
      category: dto.category,
      subject: dto.subject,
      priority: dto.priority ?? "NORMAL",
      source: "SUPPLIER_PORTAL",
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
    const supplierId = await this.getSupplierId(claims.sub);

    const list = await this.caseService.listCases({
      requesterType: "SUPPLIER",
      limit: limit ? Number.parseInt(limit, 10) : 20,
      offset: offset ? Number.parseInt(offset, 10) : 0,
    });

    const myCases = list.cases.filter((c) => c.supplierId === supplierId);

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
    const supplierId = await this.getSupplierId(claims.sub);

    await this.convService.verifyParticipantAccess(id, {
      userId: claims.sub,
      role: "supplier",
      supplierId,
    });

    const c = await this.caseService.getCaseById(id);
    const messages = await this.convService.listMessages(id, "supplier");
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
    @Body() dto: AddSupplierMessageDto,
  ) {
    const supplierId = await this.getSupplierId(claims.sub);

    await this.convService.verifyParticipantAccess(id, {
      userId: claims.sub,
      role: "supplier",
      supplierId,
    });

    const msg = await this.convService.addMessage({
      caseId: id,
      author: {
        type: "SUPPLIER",
        id: claims.sub,
        displayName: "Supplier Representative",
      },
      body: dto.body,
      visibility: "PUBLIC",
      idempotencyKey: dto.idempotencyKey,
      attachmentIds: dto.attachmentIds,
    });

    return toApiJson(msg);
  }
}
