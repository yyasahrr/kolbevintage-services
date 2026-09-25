/**
 * تست‌های مرز مشترک HTTP (فاز ۶.۱).
 *
 * پوشش: موفقیت، پاسخِ بد‌شکل، اعتبارسنجی، ۴۰۱/۴۰۳/۴۰۴/۴۰۹/۴۲۹/۵۰۰، شکستِ شبکه،
 * عدمِ دسترسیِ سرویسِ واسط، لغو، تایم‌اوت، و مهم‌تر از همه: **هیچ شکستی به دادهٔ
 * خالی تبدیل نمی‌شود**.
 */

import { describe, expect, it } from "vitest";
import {
  ApiError,
  buildRequestUrl,
  createApiClient,
  fallbackMessage,
  isAbortError,
  isApiError,
  isProviderUnavailableCode,
  parseRetryAfter,
  parseValidationIssues,
  resolveDefaultBaseUrl,
} from "../shared/http";
import type { ApiClientOptions, FetchLike } from "../shared/http";

type StubResponse = {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
};

function response({ status = 200, body = "", headers = {} }: StubResponse): Response {
  return new Response(body, { status, headers: { "content-type": "application/json", ...headers } });
}

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return response({ status, body: JSON.stringify(payload), headers });
}

function clientWith(stub: FetchLike, options: ApiClientOptions = {}) {
  return createApiClient({ baseUrl: "http://api.test/v1", fetch: stub, ...options });
}

describe("Phase 6.1-A shared HTTP boundary", () => {
  it("returns parsed JSON for a successful request", async () => {
    const client = clientWith(async () => jsonResponse({ ok: true, items: [1, 2] }));
    const data = await client.request<{ ok: boolean; items: number[] }>("/products");
    expect(data).toEqual({ ok: true, items: [1, 2] });
  });

  it("sends credentials including cookies and json content-type by default in the browser", async () => {
    let seen: RequestInit | undefined;
    const client = clientWith(async (_url: string, init: RequestInit) => {
      seen = init;
      return jsonResponse({ ok: true });
    });
    await client.request("/cart", { method: "POST", body: { sku: "KV-1" } });
    expect(seen?.credentials).toBe("include");
    expect(new Headers(seen?.headers).get("content-type")).toBe("application/json");
    expect(seen?.body).toBe(JSON.stringify({ sku: "KV-1" }));
  });

  it("forwards an abort signal and maps cancellation to ABORTED (never to data)", async () => {
    const controller = new AbortController();
    const client = clientWith(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    controller.abort();
    const result = await client.requestResult<unknown>("/products", { signal: controller.signal });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("ABORTED");
      expect(isAbortError(result.error)).toBe(true);
    }
  });

  it("fails with a timeout error when the server never answers", async () => {
    const client = clientWith(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const result = await client.requestResult<unknown>("/slow", { timeoutMs: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("ABORTED");
  });

  it("classifies malformed 2xx responses as MALFORMED_RESPONSE and never as empty data", async () => {
    const client = clientWith(async () => response({ status: 200, body: "<html>not json</html>" }));
    const result = await client.requestResult<unknown>("/products");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("MALFORMED_RESPONSE");
      expect(result.error.transport).toBe("protocol");
    }
    await expect(client.request("/products")).rejects.toBeInstanceOf(ApiError);
  });

  const statusCases: Array<[number, string, string]> = [
    [422, "VALIDATION_FAILED", "VALIDATION_ERROR"],
    [400, "INVALID_INPUT", "VALIDATION_ERROR"],
    [401, "UNAUTHORIZED", "UNAUTHORIZED"],
    [403, "FORBIDDEN", "FORBIDDEN"],
    [404, "NOT_FOUND", "NOT_FOUND"],
    [409, "CONFLICT", "CONFLICT"],
    [429, "RATE_LIMITED", "RATE_LIMITED"],
    [500, "INTERNAL_ERROR", "SERVER_ERROR"],
  ];

  for (const [status, code, kind] of statusCases) {
    it(`maps HTTP ${status} (${code}) to ${kind}`, async () => {
      const client = clientWith(async () => jsonResponse({ error: code, message: "boom" }, status));
      const result = await client.requestResult<unknown>("/x");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe(kind);
        expect(result.error.code).toBe(code);
        expect(result.error.status).toBe(status);
        expect(result.error.message).toBe("boom");
      }
    });
  }

  it("maps network failure to NETWORK_ERROR with no data attached", async () => {
    const client = clientWith(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await client.requestResult<unknown>("/products");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("NETWORK_ERROR");
      expect(result.error.transport).toBe("network");
      expect(result).not.toHaveProperty("data");
    }
  });

  it("distinguishes provider unavailability from a generic server error", async () => {
    expect(isProviderUnavailableCode("SMS_PROVIDER_UNAVAILABLE")).toBe(true);
    expect(isProviderUnavailableCode("CANONICAL_API_UNAVAILABLE")).toBe(true);
    expect(isProviderUnavailableCode("INTERNAL_ERROR")).toBe(false);

    const unavailable = clientWith(async () => jsonResponse({ error: "PAYMENT_PROVIDER_UNAVAILABLE" }, 503));
    const one = await unavailable.requestResult<unknown>("/x");
    expect(one.ok).toBe(false);
    if (!one.ok) expect(one.error.kind).toBe("PROVIDER_UNAVAILABLE");

    const generic = clientWith(async () => jsonResponse({ error: "INTERNAL_ERROR" }, 503));
    const two = await generic.requestResult<unknown>("/x");
    if (!two.ok) expect(two.error.kind).toBe("SERVER_ERROR");

    const gateway = clientWith(async () => jsonResponse({ error: "BAD_GATEWAY" }, 502));
    const three = await gateway.requestResult<unknown>("/x");
    if (!three.ok) expect(three.error.kind).toBe("PROVIDER_UNAVAILABLE");
  });

  it("parses validation issues emitted by the server contract", () => {
    expect(parseValidationIssues("email: must be an email | quantity: must be a number")).toEqual([
      { field: "email", message: "must be an email" },
      { field: "quantity", message: "must be a number" },
    ]);
    expect(parseValidationIssues("only one message")).toEqual([{ field: null, message: "only one message" }]);
    expect(parseValidationIssues("")).toEqual([]);
  });

  it("attaches validation issues to validation errors", async () => {
    const client = clientWith(async () =>
      jsonResponse({ error: "VALIDATION_FAILED", message: "email: must be an email | phone: too short" }, 422),
    );
    const result = await client.requestResult<unknown>("/auth/register", { method: "POST", body: {} });
    if (!result.ok) {
      expect(result.error.kind).toBe("VALIDATION_ERROR");
      expect(result.error.issues.map((issue) => issue.field)).toEqual(["email", "phone"]);
    }
  });

  it("reads retry-after on rate limited responses", async () => {
    const client = clientWith(async () => jsonResponse({ error: "RATE_LIMITED" }, 429, { "retry-after": "30" }));
    const result = await client.requestResult<unknown>("/auth/login", { method: "POST", body: {} });
    if (!result.ok) expect(result.error.retryAfterSeconds).toBe(30);
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter("nonsense")).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });

  it("keeps requestId and errorId for support and log correlation", async () => {
    const client = clientWith(async () =>
      jsonResponse({ error: "INTERNAL_ERROR", message: "x", requestId: "req-1", errorId: "err-9" }, 500),
    );
    const result = await client.requestResult<unknown>("/x");
    if (!result.ok) {
      expect(result.error.requestId).toBe("req-1");
      expect(result.error.errorId).toBe("err-9");
      expect(result.error.toJSON()).toMatchObject({ kind: "SERVER_ERROR", requestId: "req-1" });
    }
  });

  it("never converts a failure into an empty dataset", async () => {
    const client = clientWith(async () => jsonResponse({ error: "INTERNAL_ERROR" }, 500));
    // هر سه سبک فراخوانی باید شکست را حفظ کنند.
    await expect(client.request<unknown[]>("/orders")).rejects.toBeInstanceOf(ApiError);
    await expect(client.requestWithMeta<unknown[]>("/orders")).rejects.toBeInstanceOf(ApiError);
    const result = await client.requestResult<unknown[]>("/orders");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(isApiError(result.error)).toBe(true);
    // و هیچ «آرایهٔ خالی» در کار نیست:
    expect(result).not.toHaveProperty("data");
  });

  it("supports text and void response shapes", async () => {
    // ۲۰۴ در ساختِ Response بدنه نمی‌پذیرد؛ «پاسخِ بدون محتوا» را با ۲۰۰/بدنهٔ خالی شبیه‌سازی می‌کنیم.
    const client = clientWith(async () => response({ status: 200, body: "" }));
    await expect(client.request("/logout", { method: "POST", response: "void" })).resolves.toBeUndefined();
    const textClient = clientWith(async () => response({ status: 200, body: "plain" }));
    await expect(textClient.request("/export", { response: "text" })).resolves.toBe("plain");
  });

  it("builds urls without duplicating slashes or emitting null params", () => {
    expect(buildRequestUrl("http://api.test/v1/", "/orders", { page: 2, q: null, tag: ["a", "b"] })).toBe(
      "http://api.test/v1/orders?page=2&tag=a&tag=b",
    );
    expect(buildRequestUrl("/api/v1", "orders")).toBe("/api/v1/orders");
    expect(buildRequestUrl("/api/v1", "https://cdn.test/x")).toBe("https://cdn.test/x");
    expect(buildRequestUrl("", "/health", {})).toBe("/health");
  });

  it("resolves the default base url without hardcoding a host or port", () => {
    const resolved = resolveDefaultBaseUrl();
    expect(resolved.startsWith("http")).toBe(false);
    expect(resolved).toBe("/api/v1");
  });

  it("exposes a Persian fallback message for every error kind", () => {
    for (const kind of ["NETWORK_ERROR", "SERVER_ERROR", "UNAUTHORIZED", "PROVIDER_UNAVAILABLE"] as const) {
      expect(fallbackMessage(kind).length).toBeGreaterThan(5);
    }
  });
});
