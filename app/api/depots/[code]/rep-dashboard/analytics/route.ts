import { NextRequest } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";

// GET /api/depots/:code/rep-dashboard/analytics
// Returns 30-day daily counts of swaps posted and agreements completed
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
  if (!dbUser) return err("User not found", 404);
  if (dbUser.role !== "depotRep" && dbUser.role !== "admin") return err("Forbidden", 403);

  const { code } = await params;
  const depot = await prisma.depot.findUnique({ where: { code } });
  if (!depot) return err("Depot not found", 404);
  if (dbUser.role === "depotRep" && dbUser.depotId !== depot.id) return err("You can only view your own depot", 403);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
  thirtyDaysAgo.setHours(0, 0, 0, 0);

  const [recentSwaps, recentAgreements] = await Promise.all([
    prisma.swap.findMany({
      where: { depotId: depot.id, createdAt: { gte: thirtyDaysAgo } },
      select: { createdAt: true },
    }),
    prisma.swapAgreement.findMany({
      where: { swap: { depotId: depot.id }, status: "completed", completedAt: { gte: thirtyDaysAgo } },
      select: { completedAt: true },
    }),
  ]);

  // Build 30-day array
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    return d.toISOString().split("T")[0];
  });

  const postedMap: Record<string, number> = {};
  const agreementsMap: Record<string, number> = {};

  recentSwaps.forEach(s => {
    const day = s.createdAt.toISOString().split("T")[0];
    postedMap[day] = (postedMap[day] ?? 0) + 1;
  });

  recentAgreements.forEach(a => {
    if (!a.completedAt) return;
    const day = a.completedAt.toISOString().split("T")[0];
    agreementsMap[day] = (agreementsMap[day] ?? 0) + 1;
  });

  return ok(days.map(d => ({ date: d, posted: postedMap[d] ?? 0, agreements: agreementsMap[d] ?? 0 })));
}
