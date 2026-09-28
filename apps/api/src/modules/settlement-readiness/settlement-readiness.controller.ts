import { Controller, Get, Inject, Param } from "@nestjs/common";
import { Roles } from "../../common/guards/session.guard";
import { toApiJson } from "../../common/api-json";
import { SettlementReadinessService } from "./settlement-readiness.service";

/**
 * Phase 4.7.6 — admin/finance-only READ endpoints. No supplier or buyer surface exists on purpose:
 * the payload is an operator diagnostic labelled "NOT A SETTLEMENT BALANCE", not an earnings view.
 */
@Controller("admin/settlement-readiness")
export class SettlementReadinessController {
  constructor(@Inject(SettlementReadinessService) private readonly readiness: SettlementReadinessService) {}

  @Get("orders/:orderId")
  @Roles("admin", "finance")
  async order(@Param("orderId") orderId: string) {
    return toApiJson(await this.readiness.computeForOrder(orderId));
  }

  @Get("children/:childOrderId")
  @Roles("admin", "finance")
  async child(@Param("childOrderId") childOrderId: string) {
    return toApiJson(await this.readiness.computeForChild(childOrderId));
  }
}
