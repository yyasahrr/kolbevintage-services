import { publicRobots } from "@server/commerce-discovery";

export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(await publicRobots(), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
