import type { NextRequest } from "next/server";
import { proxyToMedusa } from "@server/medusa-proxy";

/**
 * API بک‌اند (Store) — هر متدی روی /store/kolbe/*
 * به موتور Medusa روی پورت ۹۰۰۰ فوروارد می‌شود.
 */

type Ctx = { params: Promise<{ path?: string[] }> };

async function handler(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { path = [] } = await ctx.params;
  return proxyToMedusa(req, "/store/kolbe", path);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const dynamic = "force-dynamic";
