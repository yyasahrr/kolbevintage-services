import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { Roles, SessionGuard } from "../../common/guards/session.guard";
import { AuditService } from "./audit.service";

/**
 * خواندن تاریخ حسابرسی — فقط نقش مدیر.
 *
 * قاعدهٔ A17: «Admin operations must be auditable». این endpoint سطح خواندن
 * همان قاعده است و در فاز ۷ توسط پنل مدیریت (Vite) مصرف می‌شود.
 */
@ApiTags("audit")
@ApiBearerAuth()
@Controller("audit")
@UseGuards(SessionGuard)
@Roles("admin")
export class AuditController {
  // تزریق صریح تا وابستگی به متادیتای دکوراتور نداشته باشیم (توضیح در session.guard.ts).
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get("logs")
  @ApiOperation({ summary: "آخرین رکوردهای حسابرسی عملیات مدیر" })
  @ApiQuery({ name: "entityType", required: false })
  @ApiQuery({ name: "entityId", required: false })
  @ApiQuery({ name: "actorId", required: false })
  @ApiQuery({ name: "action", required: false })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async logs(
    @Query("entityType") entityType?: string,
    @Query("entityId") entityId?: string,
    @Query("actorId") actorId?: string,
    @Query("action") action?: string,
    @Query("limit") limit?: string,
  ) {
    const take = Number(limit) || 50;
    const logs =
      entityType && entityId
        ? await this.audit.listForEntity(entityType, entityId, take)
        : await this.audit.list({ entityType, actorId, action }, take);
    return { logs };
  }
}
