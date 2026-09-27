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
  // Defence in depth against the middleware-bypass class of Next.js bug
  // (CVE-2025-29927 and anything like it): a client that can set this internal
  // header convinces the framework a request has already passed middleware.
  // 16.3.5 is patched, but an inbound request should never carry it, so refuse
  // outright rather than relying on the framework staying patched.
  if (req.headers.has("x-middleware-subrequest")) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

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

  // Force-logout enforcement for PAGE routes only.
  //
  // API routes are handled by requireUser() in lib/auth.ts, which is the
  // authoritative layer: it sits against the data, it cannot be skipped by a
  // middleware bypass, and it covers authenticated work this matcher does not
  // reach. Doing it in both places would mean two Redis round-trips on every
  // API request for no extra safety, so this branch deliberately excludes
  // /api/ — see lib/auth.ts requireUser for the reasoning.
  //
  // Page routes have no requireUser, so the check still belongs here for them:
  // it is what stops a revoked session from rendering an authenticated page
  // shell (app/s/[id]/page.tsx reads the access token directly, for one).
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/api/")) {
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
