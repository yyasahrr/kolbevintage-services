import { corsHeaders } from "@server/kolbe-api";
import { database } from "@server/database";

/** سلامت اپ یکپارچه Next.js و دیتابیس مستقل آن. */
export async function GET() {
  let databaseStatus: "up" | "down" = "down";
  let detail: string | null = null;
  try {
    const db = await database();
    await db.query("SELECT 1");
    databaseStatus = "up";
    detail = "query ok";
  } catch (err) {
    detail = err instanceof Error ? err.message : "unreachable";
  }

  return Response.json(
    {
      ok: true,
      service: "kolbe-vintage",
      runtime: "nextjs",
      database: { engine: "postgresql", status: databaseStatus, detail },
    },
    { headers: corsHeaders() },
  );
}

export const dynamic = "force-dynamic";
