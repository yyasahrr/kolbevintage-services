import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok } from "../../../../lib/http";

export const GET = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  ok(res, { status: "kolbe-api-ok", time: new Date().toISOString() });
});
