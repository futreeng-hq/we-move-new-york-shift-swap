import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { notifyUser, notifyMany } from "@/lib/notifyUser";
import { nyToday } from "@/lib/nyDate";
import { pingHeartbeat } from "@/lib/heartbeat";

// Cron work is unbounded in row count. Without an explicit ceiling the
// function is killed at the platform default mid-loop: partial work, no
// heartbeat ping, and no error recorded anywhere.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return err("Unauthorized", 401);

  try {
  // "Today" in America/New_York as a UTC midnight Date. Swap dates are stored
  // as @db.Date (midnight UTC); a swap dated Apr 30 is "past" only once NY's
  // local date has rolled over to May 1. Single source of truth in lib/nyDate.
  const today = nyToday();

  // Fetch work swaps (have a `date`) that are past, so we can notify owners
  const toExpire = await prisma.swap.findMany({
    where: {
      status: { in: ["open", "pending"] },
      date: { lt: today, not: null },
    },
    select: { id: true, userId: true, depotId: true, details: true },
  });

  // Mark work swaps as expired: open/pending swaps whose date is in the past
  const result = await prisma.swap.updateMany({
    where: {
      status: { in: ["open", "pending"] },
      date: { lt: today, not: null },
    },
    data: { status: "expired" },
  });

  // A13: daysoff swaps expire on the LATER of fromDate/toDate — a swap
  // offering "my Tue for your Sat" is still tradeable after Tue passes as
  // long as Sat hasn't. Expire only when every concrete date is behind us.
  const result2 = await prisma.swap.updateMany({
    where: {
      status: { in: ["open", "pending"] },
      date: null,
      fromDate: { lt: today, not: null },
      OR: [
        { toDate: null },
        { toDate: { lt: today } },
      ],
    },
    data: { status: "expired" },
  });

  // A13: vacation swaps carry no dates at all — without a bound they'd sit
  // open forever. Auto-expire at createdAt + 60 days.
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400_000);
  const result3 = await prisma.swap.updateMany({
    where: {
      status: { in: ["open", "pending"] },
      date: null,
      fromDate: null,
      toDate: null,
      createdAt: { lt: sixtyDaysAgo },
    },
    data: { status: "expired" },
  });

  // A8: an expired swap can't be accepted anymore — decline its pending
  // proposals so they don't linger in proposers' views, and tell them.
  const orphanedProposals = await prisma.swapAgreement.findMany({
    where: { status: "pending", swap: { status: "expired" } },
    select: { id: true, userAId: true },
  });
  if (orphanedProposals.length > 0) {
    await prisma.swapAgreement.updateMany({
      where: { id: { in: orphanedProposals.map((p) => p.id) }, status: "pending" },
      data: { status: "declined" },
    });
    await notifyMany([...new Set(orphanedProposals.map((p) => p.userAId))], {
      category: "agreement",
      title: "Swap expired before a decision",
      body: "A swap you proposed on expired — no effect on your reputation. Check the board for fresh swaps.",
      url: "/depots",
    });
  }

  // Notify each owner — awaited so serverless doesn't kill before DB write
  for (const swap of toExpire) {
    await notifyUser(swap.userId, {
      category: "swap_updates",
      title: "Your swap expired",
      body: `"${swap.details.substring(0, 60)}" — repost it to keep looking`,
      url: `/depot/${swap.depotId}/my`,
    });
  }

  await pingHeartbeat("expire-swaps");
    return ok({ expired: result.count + result2.count + result3.count, proposalsDeclined: orphanedProposals.length });
  } catch (e) {
    // Every handler swallowed its error into a 500, so nothing ever threw,
    // onRequestError never fired, and no Sentry event was created. The only
    // signal was heartbeat silence — and HEARTBEAT_URL_BASE is commented out
    // in .env.example, so a cron failing daily was invisible.
    Sentry.captureException(e, { tags: { cron: "expire-swaps" } });
    return err(`Cron failed: ${e instanceof Error ? e.message : "unknown error"}`, 500);
  }
}
