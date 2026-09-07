import type { NextRequest } from "next/server";
import { handleKolbeRequest } from "@server/kolbe-api";

/**
 * نام مستعار سازگار برای مسیرهای مدیریت قدیمی.
 */

type Ctx = { params: Promise<{ path?: string[] }> };

async function handler(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { path = [] } = await ctx.params;
  return handleKolbeRequest(req, ["admin", ...path]);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const dynamic = "force-dynamic";
