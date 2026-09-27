import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { nyToday } from "@/lib/nyDate";
import { pingHeartbeat } from "@/lib/heartbeat";

// GET /api/cron/cleanup-swaps
// Two-phase data retention. Phase A soft-archives retired swaps so they drop
// off the board but keep their messages, agreements (the printable dispatcher
// proof), reviews, and reports reachable. Phase B hard-deletes only true
// garbage: long-archived swaps whose shift is well past, with no open report.
// Cron work is unbounded in row count. Without an explicit ceiling the
// function is killed at the platform default mid-loop: partial work, no
// heartbeat ping, and no error recorded anywhere.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return err("Unauthorized", 401);

  try {
    const now = new Date();

    // ── Phase A — archive ────────────────────────────────────────────────
    // Filled/expired swaps that have been settled for 7+ days. Replaces the
    // old destructive deleteMany. Idempotent via the archivedAt: null guard.
    const archiveCutoff = new Date(now);
    archiveCutoff.setDate(archiveCutoff.getDate() - 7);
    const archived = await prisma.swap.updateMany({
      where: {
        status: { in: ["expired", "filled"] },
        updatedAt: { lt: archiveCutoff },
        archivedAt: null,
      },
      data: { archivedAt: now },
    });

    // ── Phase B — hard delete (true garbage only) ────────────────────────
    // Candidates: archived more than 90 days ago. Everything else is decided
    // per-swap in JS because "effective shift date" is the max of nullable
    // date columns, which SQL can't express cleanly.
    const deleteCutoff = new Date(now);
    deleteCutoff.setDate(deleteCutoff.getDate() - 90);
    const today = nyToday();

    const candidates = await prisma.swap.findMany({
      where: { archivedAt: { not: null, lt: deleteCutoff } },
      select: {
        id: true,
        date: true,
        fromDate: true,
        toDate: true,
        createdAt: true,
        reports: { where: { status: "pending" }, select: { id: true }, take: 1 },
        agreements: { where: { status: "completed" }, select: { id: true }, take: 1 },
      },
    });

    const HALF_YEAR_MS = 180 * 24 * 60 * 60 * 1000;
    const deletableIds = candidates
      .filter((s) => {
        // Effective shift date = latest of any concrete date; undated vacation
        // swaps fall back to createdAt + 180d so they don't linger forever.
        const times = [s.date, s.fromDate, s.toDate]
          .filter((d): d is Date => d != null)
          .map((d) => d.getTime());
        const effective =
          times.length > 0
            ? new Date(Math.max(...times))
            : new Date(s.createdAt.getTime() + HALF_YEAR_MS);
        const shiftPast = effective < today;

        // Never delete a swap with an open report — the case is still active.
        const hasPendingReport = s.reports.length > 0;
        // Redundant with shiftPast (an agreement's shift date is the swap's own
        // date), but kept explicit: never delete a swap whose completed
        // agreement is still upcoming.
        const hasUpcomingCompletedAgreement = s.agreements.length > 0 && effective >= today;

        return shiftPast && !hasPendingReport && !hasUpcomingCompletedAgreement;
      })
      .map((s) => s.id);

    let deleted = 0;
    if (deletableIds.length > 0) {
      const res = await prisma.swap.deleteMany({ where: { id: { in: deletableIds } } });
      deleted = res.count;
    }

    await pingHeartbeat("cleanup-swaps");
    return ok({ archived: archived.count, deleted });
  } catch (e) {
    // Every handler swallowed its error into a 500, so nothing ever threw,
    // onRequestError never fired, and no Sentry event was created. The only
    // signal was heartbeat silence — and HEARTBEAT_URL_BASE is commented out
    // in .env.example, so a cron failing daily was invisible.
    Sentry.captureException(e, { tags: { cron: "cleanup-swaps" } });
    return err(`Cron failed: ${e instanceof Error ? e.message : "unknown error"}`, 500);
  }
}
