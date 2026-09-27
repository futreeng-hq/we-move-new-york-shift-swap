import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { redisHealth } from "@/lib/rateLimit";

// Liveness/readiness probe. Public and unauthenticated by design — the GitHub
// Actions uptime monitor (.github/workflows/uptime.yml) polls it every 5
// minutes with no credentials, and a probe that can fail on auth is a probe
// that reports the wrong thing.
//
// Deliberately leaks nothing: no env values, no connection strings, no row
// counts. Only up/down, latency, and the deploy's commit SHA (public repo).
//
// ⚠️  Which checks are fatal determines what pages the team. Redis being fatal
// means an Upstash blip returns 503, and the uptime workflow opens a GitHub
// issue. That is intended — Redis down means isRefreshTokenBlocked() fails
// closed and users get signed out — but it is a paging decision, not just a
// code change.

export const dynamic = "force-dynamic";

interface Check {
  state: "ok" | "unreachable" | "not_configured";
  latencyMs?: number;
}

async function checkDatabase(): Promise<Check> {
  const started = Date.now();
  try {
    // Counting a real table, not `SELECT 1`. A connectable but half-migrated
    // database — the exact state a failed `migrate deploy` leaves behind —
    // answers SELECT 1 happily while every route 500s, so the probe reported
    // healthy through an outage.
    await prisma.depot.count();
    return { state: "ok", latencyMs: Date.now() - started };
  } catch {
    return { state: "unreachable", latencyMs: Date.now() - started };
  }
}

export async function GET(_req: NextRequest) {
  const started = Date.now();

  // Probe concurrently — serialising them reports a misleading total latency
  // and takes twice as long to time out when both are sick.
  const [database, redis] = await Promise.all([checkDatabase(), redisHealth()]);

  // Postgres is unconditionally fatal. Redis is fatal only when it is meant to
  // be there: "not_configured" is the normal state in dev and must not 503.
  const degraded = database.state !== "ok" || redis.state === "unreachable";

  const body = {
    status: degraded ? "degraded" : "ok",
    checks: { database, redis },
    uptimeSeconds: Math.round(process.uptime()),
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "unknown",
    totalLatencyMs: Date.now() - started,
    timestamp: new Date().toISOString(),
  };

  return Response.json(body, {
    status: degraded ? 503 : 200,
    // Never let a CDN or browser serve a stale health verdict.
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
