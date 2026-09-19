import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Roles, SessionGuard } from "../../common/guards/session.guard";
import { RateLimit } from "../../common/rate-limit/rate-limit.decorator";
import { toApiJson } from "../../common/api-json";
import { RecoveryService } from "./recovery.service";
import { JobLockService } from "./job-lock.service";
import { RecoveryScheduler } from "./recovery.scheduler";

@Controller("admin/recovery")
@UseGuards(SessionGuard)
export class RecoveryController {
  constructor(
    @Inject(RecoveryService) private readonly recoveryService: RecoveryService,
    @Inject(JobLockService) private readonly jobLockService: JobLockService,
    @Inject(RecoveryScheduler) private readonly scheduler: RecoveryScheduler,
  ) {}

  @Post("run")
  @Roles("admin")
  @RateLimit({
    limit: 10,
    windowSeconds: 60,
    scope: "user",
    keyPrefix: "recovery:run",
  })
  async triggerRecovery(
    @Body()
    body?: {
      routine?: "all" | "inventory" | "shipping" | "payments" | "settlement";
    },
  ) {
    const routine = body?.routine ?? "all";
    let results: unknown;

    switch (routine) {
      case "inventory":
        results = await this.recoveryService.runInventoryHoldCleanup();
        break;
      case "shipping":
        results = await this.recoveryService.runShippingRecovery();
        break;
      case "payments":
        results = await this.recoveryService.runPaymentsRecovery();
        break;
      case "settlement":
        results = await this.recoveryService.runSettlementRecovery();
        break;
      case "all":
      default:
        results = await this.recoveryService.runAll();
        break;
    }

    return toApiJson({
      status: "COMPLETED",
      routine,
      results,
    });
  }

  @Get("status")
  @Roles("admin")
  async getStatus() {
    const [invLock, shipLock, payLock, settLock] = await Promise.all([
      this.jobLockService.isLocked("job:recovery:inventory_holds"),
      this.jobLockService.isLocked("job:recovery:shipping_events"),
      this.jobLockService.isLocked("job:recovery:payments"),
      this.jobLockService.isLocked("job:recovery:settlement"),
    ]);

    return toApiJson({
      schedulerRunning: this.scheduler.isRunning(),
      locks: {
        inventoryHolds: invLock,
        shippingEvents: shipLock,
        payments: payLock,
        settlement: settLock,
      },
    });
  }
}
