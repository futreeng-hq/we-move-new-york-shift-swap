import { NextRequest } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";

export async function GET(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
  if (!dbUser || !["admin", "subAdmin"].includes(dbUser.role)) return err("Forbidden", 403);

  const [totalUsers, totalSwaps, openSwaps, pendingReports, totalDepots, completedAgreements] = await Promise.all([
    prisma.user.count(),
    prisma.swap.count(),
    prisma.swap.count({ where: { status: "open" } }),
    prisma.report.count({ where: { status: "pending" } }),
    prisma.depot.count(),
    prisma.swapAgreement.count({ where: { status: "completed" } }),
  ]);

  return ok({ totalUsers, totalSwaps, openSwaps, pendingReports, totalDepots, completedAgreements });
}
