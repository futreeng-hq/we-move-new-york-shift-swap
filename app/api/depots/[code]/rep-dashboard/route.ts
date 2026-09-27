import { NextRequest } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";

// Read-only depot overview for depot reps and admins.
// Returns swap stats, top operators by reputation, recent agreements.
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const { code } = await params;

  const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
  if (!dbUser) return err("User not found", 404);
  if (dbUser.role !== "depotRep" && dbUser.role !== "admin") return err("Forbidden", 403);

  const depot = await prisma.depot.findUnique({ where: { code } });
  if (!depot) return err("Depot not found", 404);

  if (dbUser.role === "depotRep" && dbUser.depotId !== depot.id) {
    return err("You can only view your own depot", 403);
  }

  const [swapCounts, recentAgreements, topOperators, reportCount] = await Promise.all([
    // Swap counts by status
    prisma.swap.groupBy({
      by: ["status", "category"],
      where: { depotId: depot.id },
      _count: true,
    }),

    // Recent completed agreements
    prisma.swapAgreement.findMany({
      where: { swap: { depotId: depot.id }, status: { in: ["completed", "userA_confirmed"] } },
      orderBy: { updatedAt: "desc" },
      take: 10,
      include: {
        swap: { select: { id: true, details: true, category: true, posterName: true } },
        userA: { select: { id: true, firstName: true, lastName: true } },
        userB: { select: { id: true, firstName: true, lastName: true } },
      },
    }),

    // Top operators by completed swaps
    prisma.reputation.findMany({
      where: { user: { depotId: depot.id } },
      orderBy: { completed: "desc" },
      take: 10,
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    }),

    // Open reports count
    prisma.report.count({
      where: { swap: { depotId: depot.id }, status: "pending" },
    }),
  ]);

  return ok({ depot, swapCounts, recentAgreements, topOperators, reportCount });
}
