import type { NextRequest } from "next/server";

/**
 * لایه بک‌اند Next.js — فوروارد درخواستها به موتور Medusa (Node/TypeScript).
 *
 * دقیقاً معادل کاری که پروکسی vite انجام میداد:
 * - هدر Origin/Referer حذف میشود تا Medusa درخواست را same-server ببیند
 * - هدرهای ACAO به پاسخ اضافه میشود
 * - preflight مستقیماً پاسخ داده میشود
 * - اگر بک‌اند پایین باشد خطای ۵۰۲ با کد NETWORK برگردانده میشود
 */

const MEDUSA_URL = process.env.MEDUSA_URL ?? process.env.NEXT_PUBLIC_MEDUSA_URL ?? "http://127.0.0.1:9000";

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization, x-publishable-api-key",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-max-age": "600",
};

const HOP_BY_HOP = new Set([
  "origin",
  "referer",
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "content-length",
  "accept-encoding",
]);

const RESPONSE_SKIP = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

export function corsHeaders(): Record<string, string> {
  return { ...CORS_HEADERS };
}

export async function proxyToMedusa(
  req: NextRequest,
  prefix: string,
  path: string[],
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const search = new URL(req.url).search;
  const target = `${MEDUSA_URL}${prefix}${path.length ? "/" + path.join("/") : ""}${search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? await req.arrayBuffer() : undefined;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
    });

    const resHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (RESPONSE_SKIP.has(k) || k.startsWith("access-control-")) return;
      resHeaders.set(key, value);
    });
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      if (key !== "access-control-max-age") resHeaders.set(key, value);
    }

    return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
  } catch {
    return Response.json(
      { error: "NETWORK", message: "بک‌اند کلبه در دسترس نیست؛ لطفاً چند لحظه بعد دوباره تلاش کنید." },
      { status: 502, headers: CORS_HEADERS },
    );
  }
}

export { MEDUSA_URL };
