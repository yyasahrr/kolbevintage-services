import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { RecoveryService } from "./recovery.service";
import { CONFIG_TOKEN, type AppConfig } from "../../config/configuration";

/**
 * Phase 4.9 Checkpoint B — Periodic Background Recovery Worker.
 *
 * Runs scheduled domain recovery passes on a configurable interval.
 * In multi-instance deployments, `JobLockService` advisory locks ensure
 * only one instance runs any routine at a time.
 *
 * Gracefully shuts down on SIGINT/SIGTERM without interrupting in-flight runs.
 */
@Injectable()
export class RecoveryScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer: NodeJS.Timeout | null = null;
  private isExecuting = false;
  private readonly logger = new Logger(RecoveryScheduler.name);

  constructor(
    @Inject(RecoveryService) private readonly recoveryService: RecoveryService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    const enabled =
      process.env.ENABLE_RECOVERY_SCHEDULER === "true" ||
      this.config.recovery?.schedulerEnabled === true;

    if (!enabled) {
      this.logger.log(
        "RecoveryScheduler is disabled (set ENABLE_RECOVERY_SCHEDULER=true to enable automatic background passes).",
      );
      return;
    }

    const intervalMs =
      this.config.recovery?.intervalMs ??
      Number(process.env.RECOVERY_INTERVAL_MS || 60000);

    this.logger.log(
      `Starting RecoveryScheduler with interval ${intervalMs}ms...`,
    );

    this.timer = setInterval(async () => {
      if (this.isExecuting) {
        this.logger.debug(
          "Previous recovery cycle still in-flight; skipping scheduler tick.",
        );
        return;
      }

      this.isExecuting = true;
      try {
        await this.recoveryService.runAll();
      } catch (err: any) {
        this.logger.error(
          `Background recovery cycle encountered an error: ${err?.message || err}`,
        );
      } finally {
        this.isExecuting = false;
      }
    }, intervalMs);
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log("RecoveryScheduler timer stopped gracefully.");
    }
  }

  /** Inspection helper for testing and health monitoring */
  isRunning(): boolean {
    return this.timer !== null;
  }
}
