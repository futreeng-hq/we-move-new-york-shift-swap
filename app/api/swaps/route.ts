import { NextRequest, NextResponse } from "next/server";
import { requireUser, checkActive, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit, rateLimitByIp, clientIp } from "@/lib/rateLimit";
import { ok, err } from "@/lib/apiResponse";
import { SwapCategory, SwapStatus } from "@prisma/client";
import { calcScore } from "@/lib/reputation";
import { notifyMany } from "@/lib/notifyUser";
import { touchLastActive } from "@/lib/touchLastActive";
import { parseBody, BODY_16KB } from "@/lib/parseBody";
import { nyToday, oneYearOut, parseDateOnly, validateSwapDate } from "@/lib/nyDate";
import { getPrefsMany } from "@/lib/notificationPrefs";

export async function GET(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
  if (!dbUser?.depotId) return err("Set your depot first", 400);
  touchLastActive(user.userId);

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");
  const sort = searchParams.get("sort") ?? "newest";
  const cursor = searchParams.get("cursor") ?? undefined;
  const limitParam = parseInt(searchParams.get("limit") ?? "20", 10);
  const limit = Math.min(Math.max(limitParam, 1), 50);

  // Build where clause. Archived swaps are retired from the board — they stay
  // reachable to participants via the detail/print routes, not list views.
  const andClauses: Record<string, unknown>[] = [{ depotId: dbUser.depotId }, { archivedAt: null }];

  // Hide swaps from operators the current user has blocked, and from operators
  // who have blocked the current user. Symmetric, same as the messaging filter.
  const blocks = await prisma.block.findMany({
    where: {
      OR: [
        { blockerId: user.userId },
        { blockedId: user.userId },
      ],
    },
    select: { blockerId: true, blockedId: true },
  });
  if (blocks.length > 0) {
    const hiddenUserIds = new Set<string>();
    for (const b of blocks) {
      hiddenUserIds.add(b.blockerId === user.userId ? b.blockedId : b.blockerId);
    }
    andClauses.push({ userId: { notIn: [...hiddenUserIds] } });
  }

  if (category && ["work", "daysoff", "vacation"].includes(category)) {
    andClauses.push({ category: category as SwapCategory });
  }
  if (status && ["open", "pending", "filled", "expired"].includes(status)) {
    andClauses.push({ status: status as SwapStatus });
  }
  if (search) {
    andClauses.push({ OR: [
      { posterName: { contains: search, mode: "insensitive" } },
      { details: { contains: search, mode: "insensitive" } },
      { route: { contains: search, mode: "insensitive" } },
      { run: { contains: search, mode: "insensitive" } },
    ]});
  }
  if (dateFrom || dateTo) {
    const dateCond: { gte?: Date; lte?: Date } = {};
    if (dateFrom) dateCond.gte = new Date(dateFrom);
    if (dateTo) dateCond.lte = new Date(dateTo);
    andClauses.push({ date: dateCond });
  }

  // A10: id as final tiebreaker on every sort — swaps sharing a createdAt
  // (bulk seeds) or date otherwise paginate nondeterministically, so cursor
  // pages could skip or repeat rows.
  const orderBy =
    sort === "oldest" ? [{ createdAt: "asc" as const }, { id: "asc" as const }]
    : sort === "date" ? [{ date: "asc" as const }, { id: "asc" as const }]
    : [{ createdAt: "desc" as const }, { id: "asc" as const }];

  const swaps = await prisma.swap.findMany({
    where: { AND: andClauses },
    orderBy,
    take: limit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { user: { select: { id: true, firstName: true, lastName: true, lastActiveAt: true } } },
  });

  // Batch-fetch reputation + saved status for current user
  const userIds = [...new Set(swaps.map(s => s.userId))];
  const [reps, reviews, savedSwaps] = await Promise.all([
    prisma.reputation.findMany({ where: { userId: { in: userIds } } }),
    prisma.review.findMany({ where: { reviewedId: { in: userIds } }, select: { reviewedId: true, rating: true } }),
    prisma.savedSwap.findMany({ where: { userId: user.userId, swapId: { in: swaps.map(s => s.id) } }, select: { swapId: true } }),
  ]);

  const savedSet = new Set(savedSwaps.map(s => s.swapId));
  const repMap = Object.fromEntries(reps.map(r => [r.userId, r]));
  const reviewMap: Record<string, number[]> = {};
  reviews.forEach(r => { (reviewMap[r.reviewedId] ??= []).push(r.rating); });

  // Mask poster last name in list responses — show "First L." to limit bulk identity extraction
  const maskLastName = (name: string) => {
    const parts = name.trim().split(" ");
    return parts.length < 2 ? name : `${parts[0]} ${parts[parts.length - 1][0]}.`;
  };

  const swapsWithRep = swaps.map(s => ({
    ...s,
    posterName: s.userId === user.userId ? s.posterName : maskLastName(s.posterName),
    saved: savedSet.has(s.id),
    posterLastActive: s.user?.lastActiveAt ?? null,
    reputation: calcScore({
      completed: repMap[s.userId]?.completed ?? 0,
      cancelled: repMap[s.userId]?.cancelled ?? 0,
      noShow: repMap[s.userId]?.noShow ?? 0,
      reviews: reviewMap[s.userId] ?? [],
    }),
  }));

  const nextCursor = swaps.length < limit ? null : swaps[swaps.length - 1].id;
  return ok({ swaps: swapsWithRep, nextCursor });
}

export async function POST(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const ip = clientIp(req);
  if (!await rateLimitByIp(ip, "post:ip", 30, 3_600_000)) return err("Rate limit exceeded — too many posts from this network", 429);
  if (!await rateLimit(`post:${user.userId}`, 5, 3_600_000)) return err("Rate limit: max 5 posts per hour", 429);
  if (!await rateLimit(`post30s:${user.userId}`, 2, 30_000)) return err("Please wait 30 seconds between posts", 429);

  const dbUser = await prisma.user.findUnique({
    where: { id: user.userId },
    include: { depot: { select: { code: true } } },
  });
  if (!dbUser?.depotId) return err("Set your depot first", 400);
  const activeErr = checkActive(dbUser);
  if (activeErr) return err(activeErr, 403);

  // Hard caps to prevent spam, enforced via DB queries (not Redis) so they
  // hold even if the rate limiter has issues. Admins and depotReps bypass.
  const isPrivileged = ["admin", "subAdmin", "depotRep"].includes(dbUser.role);
  if (!isPrivileged) {
    // Cap concurrent open/pending swaps. Real operators rarely have more than
    // 2-3 open at once; 4 is generous. A spammer can't accumulate a backlog.
    const activeCount = await prisma.swap.count({
      where: {
        userId: user.userId,
        status: { in: ["open", "pending"] },
      },
    });
    if (activeCount >= 4) {
      return err(
        "You have 4 active swaps already. Delete one or wait for it to fill or expire before posting another.",
        409,
      );
    }

    // Daily cap: 3 swaps in any rolling 24-hour window. Posts that have been
    // filled or cancelled DO count toward this limit so a user can't churn.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dailyCount = await prisma.swap.count({
      where: {
        userId: user.userId,
        createdAt: { gte: dayAgo },
      },
    });
    if (dailyCount >= 3) {
      return err(
        "Daily limit reached — you can post up to 3 swaps per 24 hours. Try again later.",
        429,
      );
    }

    // New-account cooldown: in the first 24 hours after registration, only
    // 1 swap per day. Brand-new accounts are the highest spam risk; this
    // gives admins time to notice if invite codes leak before bulk damage.
    const accountAgeMs = Date.now() - new Date(dbUser.createdAt).getTime();
    if (accountAgeMs < 24 * 60 * 60 * 1000 && dailyCount >= 1) {
      return err(
        "New accounts can post 1 swap in the first 24 hours. This limit lifts after a day to prevent spam.",
        429,
      );
    }
  }

  const body = await parseBody(req, BODY_16KB);
  if (body instanceof NextResponse) return body;
  const { category, details, contact, date, run, route, startTime, clearTime,
    swingStart, swingEnd, fromDay, fromDate, toDay, toDate, vacationHave, vacationWant } = body as {
    category?: string; details?: string; contact?: string; date?: string; run?: string; route?: string;
    startTime?: string; clearTime?: string; swingStart?: string; swingEnd?: string;
    fromDay?: string; fromDate?: string; toDay?: string; toDate?: string;
    vacationHave?: string; vacationWant?: string;
  };

  if (!category || !details) return err("Category and details are required", 400);
  const validCategories: string[] = ["work", "daysoff", "vacation"];
  if (!validCategories.includes(category as string)) return err("Invalid category", 400);
  if (details.length > 500) return err("Details must be 500 characters or fewer", 400);
  // Prevent embedding contact info in free-text — the contact field exists for this
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(details)) return err("Email addresses should go in the contact field, not the swap details", 400);
  if (/\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/.test(details)) return err("Phone numbers should go in the contact field, not the swap details", 400);
  if (contact) {
    if (contact.length > 30) return err("Contact must be 30 characters or fewer", 400);
    // Must look like a phone number or email address
    const isPhone = /^[\d\s\-()+.]{7,20}$/.test(contact.trim());
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.trim());
    if (!isPhone && !isEmail) return err("Contact must be a phone number or email address", 400);
  }

  // Validate date fields — calendar dates in NY, same-day allowed, ≤ 1 year out.
  // Comparisons are date-only (midnight UTC) so evening posts near the NY→UTC
  // day boundary don't wrongly reject today or tomorrow.
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
  if (run && run.length > 20) return err("Run must be 20 characters or fewer", 400);
  if (route && route.length > 20) return err("Route must be 20 characters or fewer", 400);

  // Cap remaining string fields. Body is already 16KB-capped, but per-field
  // limits prevent any single field from being filled with junk that pollutes
  // the UI when rendered. Times like "14:30" fit easily in 10 chars; day
  // labels in 12; vacation week descriptions in 200.
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

  // Normalise details for duplicate check: collapse whitespace and lowercase
  const normalisedDetails = details.trim().replace(/\s+/g, " ").toLowerCase();
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60_000);
  const recentSwaps = await prisma.swap.findMany({
    where: { userId: user.userId, category: category as SwapCategory, createdAt: { gte: thirtyMinutesAgo } },
    select: { details: true },
  });
  const isDupe = recentSwaps.some(s => s.details.trim().replace(/\s+/g, " ").toLowerCase() === normalisedDetails);
  if (isDupe) return err("Duplicate: you already posted this swap recently", 409);

  const posterName = `${dbUser.firstName} ${dbUser.lastName}`;

  const swap = await prisma.swap.create({
    data: {
      userId: user.userId,
      depotId: dbUser.depotId,
      category: category as SwapCategory,
      details,
      contact: contact ?? null,
      posterName,
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

  // A7 targeted new-post delivery (mutual-match-lite). From the depot's
  // subscribed users (minus poster and blocked pairs):
  //   mode "all"     → always pushed
  //   mode "matches" → pushed only when the post plausibly concerns them:
  //                    flexibleMode on, OR they have an open swap of the same
  //                    category (actively trading the same kind of thing)
  //   mode "digest"/"off" → no real-time push (digest is the summary layer)
  const depotUsers = await prisma.user.findMany({
    where: { depotId: dbUser.depotId, id: { not: user.userId }, pushSubscriptions: { some: {} } },
    select: { id: true, flexibleMode: true },
  });

  // Blocked pairs (either direction) never hear about each other's posts.
  const postBlocks = await prisma.block.findMany({
    where: { OR: [{ blockerId: user.userId }, { blockedId: user.userId }] },
    select: { blockerId: true, blockedId: true },
  });
  const blockedIds = new Set<string>();
  for (const b of postBlocks) {
    blockedIds.add(b.blockerId === user.userId ? b.blockedId : b.blockerId);
  }
  const candidates = depotUsers.filter(u => !blockedIds.has(u.id));

  const prefsMap = await getPrefsMany(candidates.map(u => u.id));
  const allIds: string[] = [];
  const matchCandidates: { id: string; flexibleMode: boolean }[] = [];
  for (const u of candidates) {
    const mode = prefsMap.get(u.id)?.prefs.new_post ?? "digest";
    if (mode === "all") allIds.push(u.id);
    else if (mode === "matches") matchCandidates.push(u);
  }

  // "matches": flexible-mode users match everything; otherwise an open swap
  // of the same category signals they're looking to trade the same thing.
  let matchedIds: string[] = [];
  if (matchCandidates.length > 0) {
    const flexible = matchCandidates.filter(u => u.flexibleMode).map(u => u.id);
    const rest = matchCandidates.filter(u => !u.flexibleMode).map(u => u.id);
    let sameCategoryPosters: string[] = [];
    if (rest.length > 0) {
      const open = await prisma.swap.findMany({
        where: { userId: { in: rest }, status: "open", category: swap.category },
        select: { userId: true },
        distinct: ["userId"],
      });
      sameCategoryPosters = open.map(o => o.userId);
    }
    matchedIds = [...flexible, ...sameCategoryPosters];
  }

  const recipients = [...new Set([...allIds, ...matchedIds])];
  const categoryLabel =
    swap.category === "work" ? "Work"
    : swap.category === "daysoff" ? "Days Off"
    : "Vacation";
  await notifyMany(recipients, {
    category: "new_post",
    title: `New ${categoryLabel} swap posted`,
    body: `${posterName} posted a new swap — check the board`,
    url: `/depot/${dbUser.depot!.code}/swaps/${swap.id}`,
  });

  return ok(swap, 201);
}
