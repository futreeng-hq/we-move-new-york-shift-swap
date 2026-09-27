import { NextRequest } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok } from "@/lib/apiResponse";

export async function GET(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  // "My Swaps" is an active-list view — exclude archived swaps. Archived swaps
  // remain in the history view (/api/users/me/history), the dedicated place to
  // find retired swaps.
  const swaps = await prisma.swap.findMany({
    where: { userId: user.userId, archivedAt: null },
    orderBy: { createdAt: "desc" },
  });

  return ok(swaps);
}
