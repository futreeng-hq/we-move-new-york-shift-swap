import { NextRequest } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimitByIp, clientIp } from "@/lib/rateLimit";
import { calcScore } from "@/lib/reputation";
import { ok, err } from "@/lib/apiResponse";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const ip = clientIp(req);
  if (!await rateLimitByIp(ip, "rep:ip", 60, 60_000)) return err("Rate limit exceeded", 429);

  const { id } = await params;

  // Scope reputation lookups to same depot — prevents enumeration of users across depots
  const [caller, target] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.userId }, select: { depotId: true } }),
    prisma.user.findUnique({ where: { id }, select: { depotId: true } }),
  ]);
  if (!caller || !target) return err("User not found", 404);
  if (caller.depotId !== target.depotId) return err("Not found", 404);

  const [rep, reviews] = await Promise.all([
    prisma.reputation.findUnique({ where: { userId: id } }),
    prisma.review.findMany({ where: { reviewedId: id }, select: { rating: true } }),
  ]);

  const score = calcScore({
    completed: rep?.completed ?? 0,
    cancelled: rep?.cancelled ?? 0,
    noShow: rep?.noShow ?? 0,
    reviews: reviews.map((r) => r.rating),
  });

  return ok(score);
}
