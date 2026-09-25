import { NextRequest } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { err } from "@/lib/apiResponse";
import { getAppUrl } from "@/lib/appUrl";
import { maskPosterName, categoryLabel } from "@/lib/publicSwap";
import { buildCalendar, IcsEvent } from "@/lib/ics";

// GET /api/swaps/:id/agreement/calendar
// Participants only (owner or proposer), agreement accepted or completed.
// Returns an all-day .ics for the shift date(s). Undated vacation agreements
// have nothing sane to export → 404 (the UI hides the button for them).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const { id } = await params;

  const agreement = await prisma.swapAgreement.findFirst({
    where: {
      swapId: id,
      status: { in: ["accepted", "completed"] },
      OR: [{ userAId: user.userId }, { userBId: user.userId }],
    },
    orderBy: { createdAt: "desc" },
    include: {
      userA: { select: { firstName: true, lastName: true } },
      userB: { select: { firstName: true, lastName: true } },
      swap: {
        select: {
          category: true, date: true, fromDate: true, toDate: true,
          depot: { select: { name: true, code: true } }, depotId: true,
        },
      },
    },
  });

  // Uniform 404 for missing / not-a-participant / wrong-status — no oracle.
  if (!agreement) return err("Not found", 404);

  const swap = agreement.swap;
  // Structured dates only (never parse free-text details). Work → date;
  // daysoff → both from/to (two VEVENTs); vacation/undated → nothing.
  const dates: { d: Date; suffix: string }[] = [];
  if (swap.category === "work" && swap.date) {
    dates.push({ d: swap.date, suffix: "" });
  } else if (swap.category === "daysoff") {
    if (swap.fromDate) dates.push({ d: swap.fromDate, suffix: "-from" });
    if (swap.toDate) dates.push({ d: swap.toDate, suffix: "-to" });
  }
  if (dates.length === 0) return err("Not found", 404);

  const isUserA = agreement.userAId === user.userId;
  const other = isUserA ? agreement.userB : agreement.userA;
  const otherMasked = other ? maskPosterName(`${other.firstName} ${other.lastName}`) : "your swap partner";
  const depotName = swap.depot?.name ?? "your depot";
  const base = getAppUrl();
  const link = base ? `${base}/depot/${swap.depot?.code ?? swap.depotId}/swaps/${id}` : "";
  const stamp = new Date();

  const events: IcsEvent[] = dates.map(({ d, suffix }) => ({
    uid: `agreement-${agreement.id}${suffix}@wmnyshiftswap.com`,
    date: d,
    summary: `Shift swap with ${otherMasked}`,
    description: `${categoryLabel(swap.category)} at ${depotName}. Details: ${link}`,
    url: link,
    stamp,
  }));

  const body = buildCalendar(events);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="shift-swap.ics"',
      "Cache-Control": "no-store",
    },
  });
}
