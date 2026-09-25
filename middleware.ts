import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

let redis: Redis | null = null;
function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

function decodeJwtPayload(token: string): { userId?: string; iat?: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  if (process.env.MAINTENANCE_MODE === "true") {
    const { pathname } = req.nextUrl;
    if (
      pathname === "/maintenance" ||
      pathname.startsWith("/_next/") ||
      pathname.startsWith("/icons/") ||
      pathname === "/manifest.json" ||
      pathname === "/api/health"
    ) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL("/maintenance", req.url));
  }

  // For API routes (except auth/refresh and health), enforce force-logout.
  // Access tokens are short-lived (15 min) but logout-all should take effect immediately.
  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith("/api/") &&
    pathname !== "/api/health" &&
    pathname !== "/api/auth/refresh" &&
    !pathname.startsWith("/api/auth/login") &&
    !pathname.startsWith("/api/auth/register") &&
    !pathname.startsWith("/api/auth/forgot-password") &&
    !pathname.startsWith("/api/auth/reset-password") &&
    !pathname.startsWith("/api/cron/")
  ) {
    // MUST match lib/auth.ts getTokenFromRequest exactly, including the
    // truthiness fallback. `??` would NOT fall through on an empty cookie
    // value, so a request carrying `Cookie: accessToken=` plus a Bearer
    // header would pick "" here, skip the force-logout check below, and
    // still authenticate in the route via getTokenFromRequest — defeating
    // logout-all, password reset, suspension and role demotion for the
    // token's full 15-minute life.
    const cookieToken = req.cookies.get("accessToken")?.value;
    const authHeader = req.headers.get("authorization");
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const token = cookieToken || bearerToken;
    if (token) {
      const payload = decodeJwtPayload(token);
      if (payload?.userId && payload?.iat) {
        const store = getRedis();
        if (!store) {
          if (process.env.NODE_ENV === "production") {
            return NextResponse.json({ error: "Session validation temporarily unavailable" }, { status: 503 });
          }
        } else {
          try {
            const val = await store.get(`force-logout:${payload.userId}`);
            if (val && payload.iat * 1000 < Number(val)) {
              return NextResponse.json({ error: "Session invalidated. Please sign in again." }, { status: 401 });
            }
          } catch {
            if (process.env.NODE_ENV === "production") {
              return NextResponse.json({ error: "Session validation temporarily unavailable" }, { status: 503 });
            }
          }
        }
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
