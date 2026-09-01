import { MEDUSA_URL, corsHeaders } from "@server/medusa-proxy";
import { MEDUSA_PUBLISHABLE_KEY } from "@/nextEnv";

/** سلامت لایه Next.js + موتور بک‌اند Medusa */
export async function GET() {
  let backend: "up" | "down" = "down";
  let backendDetail: string | null = null;
  try {
    const res = await fetch(`${MEDUSA_URL}/store/kolbe/health`, {
      cache: "no-store",
      headers: { "x-publishable-api-key": MEDUSA_PUBLISHABLE_KEY },
      signal: AbortSignal.timeout(4000),
    });
    backend = res.ok ? "up" : "down";
    backendDetail = `HTTP ${res.status}`;
  } catch (err) {
    backendDetail = err instanceof Error ? err.message : "unreachable";
  }

  return Response.json(
    {
      ok: true,
      layer: "next",
      service: "kolbe-vintage",
      backend: { engine: "medusa", url: MEDUSA_URL, status: backend, detail: backendDetail },
    },
    { headers: corsHeaders() },
  );
}

export const dynamic = "force-dynamic";
