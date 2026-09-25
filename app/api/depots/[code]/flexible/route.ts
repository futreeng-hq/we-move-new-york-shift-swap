import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calcScore } from "@/lib/reputation";
import { ok, err } from "@/lib/apiResponse";

// GET /api/depots/:code/flexible → list operators in this depot with flexibleMode on
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  let user;
  try { user = requireUser(req); } catch { return err("Unauthorized", 401); }

  const { code } = await params;
  const depot = await prisma.depot.findUnique({ where: { code } });
  if (!depot) return err("Depot not found", 404);

  // Membership check. Without it one account could walk every depot code and
  // harvest a city-wide roster of operators advertising that they want to
  // trade shifts — the exact bulk identity extraction the board's last-name
  // masking and the reputation route's cross-depot refusal exist to prevent.
  const caller = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { depotId: true, role: true },
  });
  if (!caller) return err("User not found", 404);
  if (caller.role !== "admin" && caller.depotId !== depot.id) {
    return err("Depot not found", 404);
  }

  // Blocked operators are hidden from each other everywhere else; this roster
  // ignored blocks entirely.
  const blocks = await prisma.block.findMany({
    where: { OR: [{ blockerId: user.userId }, { blockedId: user.userId }] },
    select: { blockerId: true, blockedId: true },
  });
  const hiddenUserIds = blocks.map((b: { blockerId: string; blockedId: string }) =>
    b.blockerId === user.userId ? b.blockedId : b.blockerId
  );

  const flexibleUsers = await prisma.user.findMany({
    where: {
      depotId: depot.id,
      flexibleMode: true,
      id: { not: user.userId, ...(hiddenUserIds.length > 0 ? { notIn: hiddenUserIds } : {}) },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      depotId: true,
      flexibleSince: true,
      reputation: true,
    },
    orderBy: { flexibleSince: "asc" },   // longest-standing flexible first
  });

  // Attach rep scores
  const results = await Promise.all(
    flexibleUsers.map(async (u) => {
      const reviews = await prisma.review.findMany({
        where: { reviewedId: u.id },
        select: { rating: true },
      });
      const rep = u.reputation;
      return {
        id: u.id,
        firstName: u.firstName,
        // Masked to "L." to match the board and saved-swaps list responses,
        // which deliberately avoid handing out full names in bulk.
        lastName: u.lastName ? `${u.lastName.trim()[0]}.` : u.lastName,
        depotId: u.depotId,
        flexibleSince: u.flexibleSince,
        reputation: calcScore({
          completed: rep?.completed ?? 0,
          cancelled: rep?.cancelled ?? 0,
          noShow: rep?.noShow ?? 0,
          reviews: reviews.map((r) => r.rating),
        }),
      };
    })
  );

  return ok(results);
}
