import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { resolve } from "./resolver";

export type KolbeServices = ReturnType<typeof resolve>;

export function ok(res: MedusaResponse, data: unknown, status = 200) {
  res.status(status).json(data as any);
}

export function fail(res: MedusaResponse, error: unknown, status = 400) {
  const code = error instanceof Error ? error.message : String(error ?? "UNKNOWN_ERROR");
  res.status(status).json({ error: code });
}

/** سرویسهای دامنه کلبه برای این درخواست. */
export function svc(req: MedusaRequest): KolbeServices {
  return resolve((req as any).scope);
}

const BEARER = /^Bearer\s+(.+)$/i;

/** نقش درخواست از توکن Bearer؛ در نبود/نامعتبربودن null. */
export function authClaims(req: MedusaRequest): { sub: string; role: string } | null {
  const header = req.headers.get?.("authorization") ?? (req.headers as any).authorization;
  const match = typeof header === "string" ? header.match(BEARER) : null;
  if (!match) return null;
  return svc(req).account.verifyToken(match[1]);
}

export function requireRole(req: MedusaRequest, role: string): { sub: string; role: string } {
  const claims = authClaims(req);
  if (!claims || claims.role !== role) {
    const error = new Error("UNAUTHORIZED");
    (error as any).statusCode = 401;
    throw error;
  }
  return claims;
}

/** wrapper: اجرای هندلر با مدیریت خطای یکسان. */
export function handler(fn: (req: MedusaRequest, res: MedusaResponse) => Promise<void>) {
  return async (req: MedusaRequest, res: MedusaResponse) => {
    try {
      await fn(req, res);
    } catch (error: any) {
      const status = typeof error?.statusCode === "number" ? error.statusCode : 400;
      fail(res, error, status);
    }
  };
}
