import { describe, expect, it, vi } from "vitest";
import { redactSensitive } from "../src/common/logging/redaction";
import { AuditService } from "../src/modules/audit/audit.service";

describe("Phase 5.13-C platform data safety", () => {
  it("redacts secrets embedded in Error messages and stacks", () => {
    const error = new Error("provider failed token=provider-secret password=hunter2");
    error.stack = "Error: provider failed\nauthorization=Bearer abc.def.ghi";

    const redacted = redactSensitive(error) as unknown as { message: string; stack: string };

    expect(redacted.message).not.toContain("provider-secret");
    expect(redacted.message).not.toContain("hunter2");
    expect(redacted.stack).not.toContain("abc.def.ghi");
    expect(`${redacted.message}\n${redacted.stack}`).toContain("[REDACTED]");
  });

  it("normalizes sensitive key names before matching", () => {
    const redacted = redactSensitive({ api_key: "key-value", "set-cookie": "session=value" });

    expect(redacted).toEqual({ api_key: "[REDACTED]", "set-cookie": "[REDACTED]" });
  });

  it("redacts untrusted audit payloads at the append-only sink", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn(() => ({ values }));
    const audit = new AuditService({ insert } as never);
    const occurredAt = new Date("2026-09-25T00:00:00.000Z");

    await audit.record({
      actorId: "user-1",
      actorRole: "admin",
      action: "security.test",
      entityType: "test",
      before: { password: "before-password" },
      after: { nested: { accessToken: "after-token" }, occurredAt },
      metadata: { authorization: "Bearer audit-secret", safe: "retained" },
    });

    const persisted = values.mock.calls[0]?.[0];
    expect(persisted.before).toEqual({ password: "[REDACTED]" });
    expect(persisted.after.nested.accessToken).toBe("[REDACTED]");
    expect(persisted.after.occurredAt).toBe(occurredAt);
    expect(persisted.metadata).toEqual({ authorization: "[REDACTED]", safe: "retained" });
  });
});
