import { NextRequest } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calcScore } from "@/lib/reputation";
import { ok, err } from "@/lib/apiResponse";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let token;
  try { token = await requireUser(req); } catch (e) { return authError(e); }

  const admin = await prisma.user.findUnique({ where: { id: token.userId } });
  if (!admin || !["admin", "subAdmin"].includes(admin.role)) return err("Forbidden", 403);

  const { id } = await params;

  const u = await prisma.user.findUnique({
    where: { id },
    include: { depot: { select: { name: true, code: true, borough: true } } },
  });
  if (!u) return err("User not found", 404);

  const [rep, reviews, swapCount, messageCount] = await Promise.all([
    prisma.reputation.findUnique({ where: { userId: id } }),
    prisma.review.findMany({ where: { reviewedId: id }, select: { rating: true } }),
    prisma.swap.count({ where: { userId: id } }),
    prisma.message.count({ where: { fromUserId: id } }),
  ]);

  const reputation = calcScore({
    completed: rep?.completed ?? 0,
    cancelled: rep?.cancelled ?? 0,
    noShow: rep?.noShow ?? 0,
    reviews: reviews.map(r => r.rating),
  });

  const isSubAdmin = admin.role === "subAdmin";

  return ok({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: isSubAdmin ? null : u.email,
    role: u.role,
    createdAt: u.createdAt,
    depot: u.depot,
    flexibleMode: u.flexibleMode,
    reputation,
    swapCount,
    messageCount,
  });
}
