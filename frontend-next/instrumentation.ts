/**
 * Next.js server bootstrap hook — runs once at start (not during build).
 * Hard-fails a production boot that is missing the session signing secret:
 * without it, tokens would be minted/verified with the public dev fallback.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;
  if (!process.env.KOLBE_SESSION_SECRET && !process.env.JWT_SECRET) {
    throw new Error("KOLBE_SESSION_SECRET (or JWT_SECRET) must be set in production");
  }
}
