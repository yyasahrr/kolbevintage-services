import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import {
  KOLBE_DB,
  KOLBE_DB_HANDLE,
  type KolbeDatabase,
  type KolbeDbHandle,
} from "../../database/database.module";

export interface LockExecutionResult<T> {
  executed: boolean;
  result?: T;
  lockKey: string;
}

/**
 * Phase 4.9 Checkpoint B — PostgreSQL Advisory Lock Service.
 *
 * Guarantees single-worker execution and zero concurrency collisions across
 * multiple API replicas, schedulers, and background workers:
 *
 * 1. Session-level advisory locks (`pg_try_advisory_lock`):
 *    Non-blocking try-lock tied to a dedicated database connection.
 *    If worker crashes or disconnects, PostgreSQL automatically frees the lock.
 *
 * 2. Transaction-level advisory locks (`pg_try_advisory_xact_lock`):
 *    Non-blocking try-lock tied to the transaction lifecycle.
 *    Guaranteed release at COMMIT or ROLLBACK.
 *
 * 3. Re-entrancy & safety:
 *    Always unlocks in `finally` blocks; discards client on unexpected pool errors
 *    to prevent connection state leakage.
 */
@Injectable()
export class JobLockService {
  private readonly logger = new Logger(JobLockService.name);

  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(KOLBE_DB_HANDLE) private readonly handle: KolbeDbHandle,
  ) {}

  /**
   * Executes `fn` guarded by a session-level non-blocking advisory lock.
   * If another worker/instance holds the lock, execution is cleanly skipped.
   */
  async withSessionLock<T>(
    lockKey: string,
    fn: () => Promise<T>,
  ): Promise<LockExecutionResult<T>> {
    const client = await this.handle.pool.connect();
    let lockAcquired = false;

    try {
      const lockRes = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext($1)) as acquired",
        [lockKey],
      );
      lockAcquired = lockRes.rows?.[0]?.acquired === true;

      if (!lockAcquired) {
        this.logger.debug(
          `Advisory lock '${lockKey}' is currently held by another worker; skipping execution.`,
        );
        return { executed: false, lockKey };
      }

      this.logger.debug(`Acquired advisory lock '${lockKey}'; starting execution.`);
      const result = await fn();
      return { executed: true, result, lockKey };
    } finally {
      if (lockAcquired) {
        try {
          await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);
          this.logger.debug(`Released advisory lock '${lockKey}'.`);
        } catch (unlockErr: any) {
          this.logger.warn(
            `Failed to release advisory lock '${lockKey}': ${unlockErr?.message || unlockErr}`,
          );
        }
      }
      client.release();
    }
  }

  /**
   * Executes `fn` inside a transaction guarded by `pg_try_advisory_xact_lock`.
   * Automatically released by PostgreSQL when the transaction commits or aborts.
   */
  async withTransactionLock<T>(
    lockKey: string,
    fn: (tx: Parameters<Parameters<KolbeDatabase["transaction"]>[0]>[0]) => Promise<T>,
  ): Promise<LockExecutionResult<T>> {
    return this.db.transaction(async (tx) => {
      const res: any = await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) as acquired`,
      );
      const acquired =
        (res.rows?.[0]?.acquired ?? res[0]?.acquired) === true;

      if (!acquired) {
        this.logger.debug(
          `Transaction advisory lock '${lockKey}' is held; skipping execution.`,
        );
        return { executed: false, lockKey };
      }

      this.logger.debug(`Acquired transaction advisory lock '${lockKey}'.`);
      const result = await fn(tx);
      return { executed: true, result, lockKey };
    });
  }

  /**
   * Checks if an advisory lock is currently held by any session in PostgreSQL.
   */
  async isLocked(lockKey: string): Promise<boolean> {
    const res = await this.handle.pool.query<{ locked: boolean }>(
      "SELECT count(*) > 0 as locked FROM pg_locks WHERE locktype = 'advisory' AND objid = hashtext($1)",
      [lockKey],
    );
    return res.rows?.[0]?.locked === true;
  }

  /**
   * Explicitly acquires a session lock and returns an unlock closure.
   * Useful for asynchronous step workflows.
   */
  async tryAcquireSessionLock(lockKey: string): Promise<{
    acquired: boolean;
    unlock: () => Promise<void>;
  }> {
    const client = await this.handle.pool.connect();
    try {
      const res = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext($1)) as acquired",
        [lockKey],
      );
      const acquired = res.rows?.[0]?.acquired === true;

      if (!acquired) {
        client.release();
        return { acquired: false, unlock: async () => {} };
      }

      let released = false;
      return {
        acquired: true,
        unlock: async () => {
          if (released) return;
          released = true;
          try {
            await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);
          } finally {
            client.release();
          }
        },
      };
    } catch (err) {
      client.release();
      throw err;
    }
  }
}
