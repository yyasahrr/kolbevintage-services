import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { OperationalLogService } from "./operational-log.service";

@Controller("analytics/operational-logs")
@Roles("admin")
export class OperationalLogController {
  constructor(@Inject(OperationalLogService) private readonly logs: OperationalLogService) {}
  @Get() list(@Query() query: Record<string, string | undefined>) { return this.logs.list(query); }
  @Patch(":id")
  @Post(":id")
  @HttpCode(200)
  resolve(@Param("id") id: string, @Body() body: any, @CurrentUser() claims: Claims) { return this.logs.resolve(id, body, claims.sub); }
}
