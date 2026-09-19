/**
 * Phase 4.7.1 — BigInt-safe HTTP serialization.
 *
 * Drizzle rows carry `bigint` money columns (order totals, quote amounts,
 * shipping deltas). `JSON.stringify` throws on BigInt, which surfaced as a 500
 * on the HTTP path in the cross-domain regression (supplier child lifecycle
 * and shipping responses returned raw rows). Controllers pass such responses
 * through this helper so money is emitted as decimal strings, matching the
 * finance surface. Dates are emitted as ISO-8601 strings (Express default).
 */
export function toApiJson<T>(value: T): T {
  return convert(value) as T;
}

function convert(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(convert);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = convert(v);
    }
    return out;
  }
  return value;
}
