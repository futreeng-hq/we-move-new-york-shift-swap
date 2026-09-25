import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";
import { isUserForcedLogout } from "@/lib/tokenBlocklist";
import { err } from "@/lib/apiResponse";

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

// Lazy getters — checked at call time, not module load, so builds don't fail
// when env vars are absent (they will fail loudly at runtime instead).
const getAccessSecret = () => requireEnv("JWT_SECRET");
const getRefreshSecret = () => requireEnv("JWT_REFRESH_SECRET");
const getResetSecret = () => requireEnv("JWT_RESET_SECRET");

export interface TokenPayload {
  userId: string;
  email: string;
  iat?: number;
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, getAccessSecret(), { expiresIn: "15m" });
}

export function signRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, getRefreshSecret(), { expiresIn: "7d" });
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, getAccessSecret()) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, getRefreshSecret()) as TokenPayload;
}

export function getTokenFromRequest(req: NextRequest): string | null {
  // Prefer HttpOnly cookie (XSS-safe); fall back to Authorization header
  const cookie = req.cookies.get("accessToken")?.value;
  if (cookie) return cookie;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

/** Signature verification only — says nothing about revocation. */
export function getUserFromRequest(req: NextRequest): TokenPayload | null {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  try {
    return verifyAccessToken(token);
  } catch {
    return null;
  }
}

/**
 * Thrown by requireUser. `kind` lets a route answer 401 vs 503 without every
 * call site re-deriving it — pass the caught value to authError().
 */
export class AuthFailure extends Error {
  constructor(readonly kind: "unauthorized" | "revoked" | "unavailable") {
    super(kind);
    this.name = "AuthFailure";
  }
}

/**
 * Authenticate a request: verify the signature AND confirm the token has not
 * been revoked.
 *
 * The revocation check lives here, not only in middleware, because middleware
 * is one layer and the wrong one to depend on alone: it had a token-extraction
 * bug that silently skipped the check (see git history), it does not run for
 * authenticated work outside the matcher, and a Next.js middleware-bypass CVE
 * would hand an attacker every route at once. This is the layer that sits
 * against the data.
 *
 * Middleware still performs the check for page routes, which have no
 * requireUser, so a request pays exactly one Redis round-trip either way.
 *
 * Async as a consequence. Every call site must await it.
 */
export async function requireUser(req: NextRequest): Promise<TokenPayload> {
  const user = getUserFromRequest(req);
  if (!user) throw new AuthFailure("unauthorized");

  // A token with no iat cannot be compared against the force-logout marker, so
  // it cannot be proven un-revoked. All tokens this app signs carry one.
  if (typeof user.iat !== "number") throw new AuthFailure("unauthorized");

  let revoked: boolean;
  try {
    revoked = await isUserForcedLogout(user.userId, user.iat * 1000);
  } catch {
    // isUserForcedLogout already fails closed internally; this is belt-and-braces.
    throw new AuthFailure("unavailable");
  }

  if (revoked) {
    // isUserForcedLogout returns true both for a genuinely revoked token and,
    // in production, when Redis is absent or unreachable — it cannot prove the
    // token is still good. Distinguish them so an Upstash outage reads as
    // "try again" rather than telling every operator they were signed out.
    const redisConfigured =
      Boolean(process.env.UPSTASH_REDIS_REST_URL) && Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);
    throw new AuthFailure(redisConfigured ? "revoked" : "unavailable");
  }

  return user;
}

/** Maps a caught requireUser failure to the right response. */
export function authError(e: unknown): Response {
  if (e instanceof AuthFailure) {
    if (e.kind === "revoked") return err("Session invalidated. Please sign in again.", 401);
    if (e.kind === "unavailable") return err("Session validation temporarily unavailable", 503);
  }
  return err("Unauthorized", 401);
}

/**
 * Returns an error message if the account is deleted or suspended, null otherwise.
 * Call this after fetching the user from DB on any write route.
 */
export function checkActive(user: { email: string; suspendedUntil: Date | null }): string | null {
  if (user.email.endsWith("@deleted.invalid")) return "Account not found";
  if (user.suspendedUntil && user.suspendedUntil > new Date()) {
    const mins = Math.ceil((user.suspendedUntil.getTime() - Date.now()) / 60_000);
    return `Account suspended. Try again in ${mins} minute${mins !== 1 ? "s" : ""}.`;
  }
  return null;
}

// Separate secret for password-reset tokens — compromise of ACCESS_SECRET
// cannot be used to forge reset tokens and vice versa.
export function signResetToken(userId: string): string {
  return jwt.sign({ userId, type: "reset" }, getResetSecret(), { expiresIn: "1h" });
}

export function verifyResetToken(token: string): { userId: string } {
  const payload = jwt.verify(token, getResetSecret()) as { userId: string; type: string };
  if (payload.type !== "reset") throw new Error("Invalid token type");
  return { userId: payload.userId };
}
