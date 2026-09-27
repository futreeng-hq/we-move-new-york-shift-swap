import { NextRequest, NextResponse } from "next/server";
import { requireUser, checkActive, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { rateLimit } from "@/lib/rateLimit";
import { ok, err } from "@/lib/apiResponse";
import { parseBody, BODY_1KB } from "@/lib/parseBody";

// GET /api/swaps/:id/review — the caller's own review on this swap (404 if none).
// Lets the UI decide whether to show the rating stars.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }
  const { id } = await params;
  const review = await prisma.review.findFirst({
    where: { swapId: id, reviewerId: user.userId },
    select: { id: true, rating: true, createdAt: true },
  });
  if (!review) return err("No review found", 404);
  return ok(review);
}

// POST /api/swaps/:id/review  { rating: 1–5 }
// Trust v2: only participants of this swap's COMPLETED agreement may review,
// one review per user per swap (reviews_swap_id_reviewer_id_key enforces),
// and the review always targets the other party of the agreement.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const { id } = await params;

  if (!await rateLimit(`review:${user.userId}`, 10, 3_600_000)) {
    return err("Rate limit: max 10 reviews per hour", 429);
  }

  const dbUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { email: true, suspendedUntil: true } });
  if (!dbUser) return err("User not found", 404);
  const activeErr = checkActive(dbUser);
  if (activeErr) return err(activeErr, 403);

  const body = await parseBody(req, BODY_1KB);
  if (body instanceof NextResponse) return body;
  const { rating } = body as { rating?: number };
  if (!Number.isInteger(rating) || rating! < 1 || rating! > 5) {
    return err("Rating must be an integer from 1 to 5", 400);
  }

  const agreement = await prisma.swapAgreement.findFirst({
    where: {
      swapId: id,
      status: "completed",
      OR: [{ userAId: user.userId }, { userBId: user.userId }],
    },
    orderBy: { createdAt: "desc" },
    select: { userAId: true, userBId: true },
  });
  if (!agreement) return err("Reviews open after the swap is confirmed completed", 403);

  const reviewedId = agreement.userAId === user.userId ? agreement.userBId : agreement.userAId;

  try {
    const review = await prisma.review.create({
      data: { swapId: id, reviewerId: user.userId, reviewedId, rating: rating! },
    });
    return ok(review, 201);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return err("You already reviewed this swap", 409);
    }
    throw e;
  }
}
