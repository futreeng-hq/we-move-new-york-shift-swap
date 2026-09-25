import { NextRequest, NextResponse } from "next/server";
import { requireUser, checkActive } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { calcScore } from "@/lib/reputation";
import { notifyUser } from "@/lib/notifyUser";
import { ok, err } from "@/lib/apiResponse";
import { parseBody, BODY_16KB } from "@/lib/parseBody";
import { nyToday, oneYearOut, parseDateOnly, validateSwapDate } from "@/lib/nyDate";

async function getSwapWithRep(id: string) {
  const swap = await prisma.swap.findUnique({
    where: { id },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });
  if (!swap) return null;

  const rep = await prisma.reputation.findUnique({ where: { userId: swap.userId } });
  const reviews = await prisma.review.findMany({
    where: { reviewedId: swap.userId },
    select: { rating: true },
  });
  const repScore = calcScore({
    completed: rep?.completed ?? 0,
    cancelled: rep?.cancelled ?? 0,
    noShow: rep?.noShow ?? 0,
    reviews: reviews.map((r) => r.rating),
  });

  return { ...swap, reputation: repScore };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = requireUser(req); } catch { return err("Unauthorized", 401); }
  const { id } = await params;

  const swap = await getSwapWithRep(id);
  if (!swap) return err("Swap not found", 404);

  // Depot scoping
  const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
  if (swap.depotId !== dbUser?.depotId) return err("Not authorized", 403);

  // If either party has blocked the other, treat the swap as not found.
  // Owners can always see their own swap.
  if (swap.userId !== user.userId) {
    const block = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: user.userId, blockedId: swap.userId },
          { blockerId: swap.userId, blockedId: user.userId },
        ],
      },
      select: { id: true },
    });
    if (block) return err("Swap not found", 404);
  }

  // Archived swaps are off the board but must stay reachable to participants so
  // they can still print the agreement / dispatcher proof. Restrict them to the
  // owner and anyone with an agreement or message on the swap; other depot
  // members get a 404, matching the board's "it's gone" behavior.
  if (swap.archivedAt && swap.userId !== user.userId) {
    const [agr, msg] = await Promise.all([
      prisma.swapAgreement.findFirst({
        where: { swapId: id, OR: [{ userAId: user.userId }, { userBId: user.userId }] },
        select: { id: true },
      }),
      prisma.message.findFirst({
        where: { swapId: id, OR: [{ fromUserId: user.userId }, { toUserId: user.userId }] },
        select: { id: true },
      }),
    ]);
    if (!agr && !msg) return err("Swap not found", 404);
  }

  return ok(swap);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = requireUser(req); } catch { return err("Unauthorized", 401); }
  const { id } = await params;

  // Rate limit edits same as posts (per-user) to prevent spam-edit churn
  if (!await rateLimit(`edit:${user.userId}`, 10, 3_600_000)) {
    return err("Rate limit: max 10 edits per hour", 429);
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { email: true, suspendedUntil: true },
  });
  if (!dbUser) return err("User not found", 404);
  const activeErr = checkActive(dbUser);
  if (activeErr) return err(activeErr, 403);

  const swap = await prisma.swap.findUnique({ where: { id } });
  if (!swap) return err("Swap not found", 404);
  if (swap.userId !== user.userId) return err("Not authorized", 403);

  // Only open swaps can be edited. Once a swap is pending/filled/expired,
  // edits would silently change the terms after another operator engaged.
  if (swap.status !== "open") {
    return err("This swap can no longer be edited — it is " + swap.status, 400);
  }

  const body = await parseBody(req, BODY_16KB);
  if (body instanceof NextResponse) return body;
  const { details, contact, date, run, route, startTime, clearTime,
    swingStart, swingEnd, fromDay, fromDate, toDay, toDate, vacationHave, vacationWant } = body as {
    details?: string; contact?: string; date?: string; run?: string; route?: string;
    startTime?: string; clearTime?: string; swingStart?: string; swingEnd?: string;
    fromDay?: string; fromDate?: string; toDay?: string; toDate?: string;
    vacationHave?: string; vacationWant?: string;
  };

  if (details && details.length > 500) return err("Details max 500 chars", 400);
  // Match POST: keep PII out of the free-text details field
  if (details) {
    if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(details)) {
      return err("Email addresses should go in the contact field, not the swap details", 400);
    }
    if (/\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/.test(details)) {
      return err("Phone numbers should go in the contact field, not the swap details", 400);
    }
  }
  if (contact) {
    if (contact.length > 30) return err("Contact must be 30 characters or fewer", 400);
    const isPhone = /^[\d\s\-()+.]{7,20}$/.test(contact.trim());
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.trim());
    if (!isPhone && !isEmail) return err("Contact must be a phone number or email address", 400);
  }
  if (run && run.length > 20) return err("Run must be 20 characters or fewer", 400);
  if (route && route.length > 20) return err("Route must be 20 characters or fewer", 400);

  // Cap remaining string fields. Same field limits as POST.
  const stringFieldLimits: Record<string, number> = {
    startTime: 10, clearTime: 10, swingStart: 10, swingEnd: 10,
    fromDay: 12, toDay: 12,
    vacationHave: 200, vacationWant: 200,
  };
  for (const [name, max] of Object.entries(stringFieldLimits)) {
    const v = (body as Record<string, unknown>)[name];
    if (typeof v === "string" && v.length > max) {
      return err(`${name} must be ${max} characters or fewer`, 400);
    }
  }

  // Re-validate on edit with the same NY calendar-date rules as POST
  // (same-day allowed, ≤ 1 year out, strict YYYY-MM-DD).
  const today = nyToday();
  const yearOut = oneYearOut(today);
  for (const [field, val] of [["date", date], ["fromDate", fromDate], ["toDate", toDate]] as [string, unknown][]) {
    const msg = validateSwapDate(field, val, today, yearOut);
    if (msg) return err(msg, 400);
  }
  if (fromDate && toDate) {
    const f = parseDateOnly(fromDate);
    const t = parseDateOnly(toDate);
    if (f && t && t < f) return err("toDate must be on or after fromDate", 400);
  }

  const updated = await prisma.swap.update({
    where: { id },
    data: {
      ...(details && { details }),
      contact: contact ?? null,
      date: date ? new Date(date) : null,
      run: run ?? null,
      route: route ?? null,
      startTime: startTime ?? null,
      clearTime: clearTime ?? null,
      swingStart: swingStart ?? null,
      swingEnd: swingEnd ?? null,
      fromDay: fromDay ?? null,
      fromDate: fromDate ? new Date(fromDate) : null,
      toDay: toDay ?? null,
      toDate: toDate ? new Date(toDate) : null,
      vacationHave: vacationHave ?? null,
      vacationWant: vacationWant ?? null,
    },
  });

  return ok(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = requireUser(req); } catch { return err("Unauthorized", 401); }
  const { id } = await params;

  // Deleting a swap with a live agreement dings reputation and notifies the
  // counterparty, so it is a write path and suspension must hold here too.
  const deleter = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { email: true, suspendedUntil: true },
  });
  if (!deleter) return err("User not found", 404);
  const deleteActiveErr = checkActive(deleter);
  if (deleteActiveErr) return err(deleteActiveErr, 403);

  const swap = await prisma.swap.findUnique({ where: { id } });
  if (!swap) return err("Swap not found", 404);
  if (swap.userId !== user.userId) return err("Not authorized", 403);

  // If there's an active agreement, the owner is bailing on a commitment —
  // ding their reputation and notify the other party.
  const activeAgreement = await prisma.swapAgreement.findFirst({
    where: { swapId: id, status: { in: ["pending", "userA_confirmed"] } },
    select: { userAId: true },
  });

  await prisma.swap.delete({ where: { id } });

  if (activeAgreement) {
    await prisma.reputation.upsert({
      where: { userId: user.userId },
      update: { cancelled: { increment: 1 } },
      create: { userId: user.userId, cancelled: 1 },
    });
    // Best-effort notification to the operator who proposed the agreement
    try {
      const depot = await prisma.depot.findUnique({
        where: { id: swap.depotId },
        select: { code: true },
      });
      const depotCode = depot?.code ?? swap.depotId;
      await notifyUser(activeAgreement.userAId, {
        category: "agreement",
      title: "Swap deleted",
        body: "The poster cancelled this swap. Check the board for other options.",
        url: `/depot/${depotCode}/swaps`,
      });
    } catch { /* notification is best-effort */ }
  }

  return ok({ message: "Deleted" });
}
