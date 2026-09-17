import type { NextRequest } from "next/server";
import { handleKolbeRequest } from "@server/kolbe-api";
import { database } from "@server/database";

export type CallResult = { status: number; data: any; headers: Headers };

/** Call the unified handler directly — no network layer, real PostgreSQL. */
export async function call(
  method: string,
  path: string,
  opts: { body?: unknown; token?: string | null; idem?: string; cookie?: string } = {},
): Promise<CallResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem) headers["idempotency-key"] = opts.idem;
  if (opts.cookie) headers.cookie = opts.cookie;
  const req = new Request(`http://localhost:3000/store/kolbe/${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  }) as unknown as NextRequest;
  const res = await handleKolbeRequest(req, path.split("/"));
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

export async function login(email: string, password: string): Promise<string> {
  const r = await call("POST", "auth/login", { body: { email, password } });
  if (r.status !== 200) throw new Error(`login failed (${r.status}): ${JSON.stringify(r.data)}`);
  return r.data.token as string;
}

export const ADMIN = { email: "admin@kolbe.ir", password: "KolbeAdmin1404!" };
export const VIP = { email: "vip@boutique.ir", password: "VipPass1404!" };
export const SUPPLIER = { email: "nilgoon@kolbe.ir", password: "SupplierPass1404!" };

export function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function dbQuery<T = Record<string, any>>(sql: string, values: unknown[] = []): Promise<T[]> {
  const db = await database();
  return (await db.query<T & Record<string, unknown>>(sql, values)).rows as T[];
}

/** Remove rows created by a spec so shared dev/CI DB state stays clean. */
export async function cleanupRetailOrders(orderCodes: string[]) {
  if (!orderCodes.length) return;
  await dbQuery("DELETE FROM retail_order WHERE order_code = ANY($1::text[])", [orderCodes]);
}

export async function cleanupUser(email: string) {
  const users = await dbQuery<{ id: string }>("SELECT id FROM account_user WHERE email=$1", [email]);
  for (const u of users) {
    const accounts = await dbQuery<{ id: string }>("SELECT id FROM wholesale_account WHERE user_id=$1", [u.id]);
    for (const a of accounts) {
      const orders = await dbQuery<{ id: string }>("SELECT id FROM wholesale_order WHERE account_id=$1", [a.id]);
      if (orders.length) {
        await dbQuery("DELETE FROM wholesale_order_item WHERE order_id = ANY($1::text[])", [orders.map((o) => o.id)]);
        await dbQuery("DELETE FROM wholesale_order WHERE id = ANY($1::text[])", [orders.map((o) => o.id)]);
      }
      await dbQuery("DELETE FROM wholesale_account WHERE id=$1", [a.id]);
    }
    await dbQuery("DELETE FROM account_user WHERE id=$1", [u.id]);
  }
}

export async function seedInventoryState() {
  const rows = await dbQuery<{ variant_id: string; on_hand: number; reserved: number }>("SELECT variant_id,on_hand,reserved FROM supplier_inventory");
  return new Map(rows.map((r) => [r.variant_id, r]));
}

export async function restoreInventory(state: Map<string, { on_hand: number; reserved: number }>) {
  for (const [variantId, values] of state) {
    await dbQuery("UPDATE supplier_inventory SET on_hand=$2, reserved=$3 WHERE variant_id=$1", [
      variantId,
      values.on_hand,
      values.reserved,
    ]);
  }
}

/** Ensure schema+seed ran before asserting on tables. */
export async function ensureInitialized() {
  await database();
}
