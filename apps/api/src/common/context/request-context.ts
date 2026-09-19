import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface RequestContextData {
  requestId: string;
  correlationId: string;
  actorId?: string | null;
  actorRole?: string | null;
  tenantId?: string | null;
  ip?: string | null;
  startTime?: number;
  [key: string]: unknown;
}

const storage = new AsyncLocalStorage<RequestContextData>();

/**
 * Phase 4.9 Checkpoint C — Request Context Propagation.
 *
 * Provides cross-cutting trace context (requestId, correlationId, actor, tenant)
 * across modules and async operations without passing parameter bags through every
 * service signature.
 */
export class RequestContext {
  /**
   * Runs `fn` within an established request context.
   */
  static run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn);
  }

  /**
   * Retrieves the current asynchronous request context, if any.
   */
  static current(): RequestContextData | undefined {
    return storage.getStore();
  }

  /**
   * Gets the active Request ID or generates a fallback UUID.
   */
  static getRequestId(): string {
    return storage.getStore()?.requestId ?? randomUUID();
  }

  /**
   * Gets the active Correlation ID or generates a fallback UUID.
   */
  static getCorrelationId(): string {
    return storage.getStore()?.correlationId ?? randomUUID();
  }

  /**
   * Gets the authenticated Actor ID, if any.
   */
  static getActorId(): string | null {
    return storage.getStore()?.actorId ?? null;
  }

  /**
   * Updates actor context once authentication/claims have been verified.
   */
  static setActor(actorId: string, actorRole: string): void {
    const store = storage.getStore();
    if (store) {
      store.actorId = actorId;
      store.actorRole = actorRole;
    }
  }

  /**
   * Updates tenant or supplier context.
   */
  static setTenant(tenantId: string): void {
    const store = storage.getStore();
    if (store) {
      store.tenantId = tenantId;
    }
  }
}
