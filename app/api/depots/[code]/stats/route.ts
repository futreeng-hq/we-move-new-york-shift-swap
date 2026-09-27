import { NextRequest } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try { await requireUser(req); } catch (e) { return authError(e); }
  const { code } = await params;
  const depot = await prisma.depot.findUnique({ where: { code } });
  if (!depot) return err("Not found", 404);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  const [completed, active] = await Promise.all([
    prisma.swap.count({ where: { depotId: depot.id, status: "filled", updatedAt: { gte: monthStart } } }),
    prisma.swap.count({ where: { depotId: depot.id, status: { in: ["open", "pending"] } } }),
  ]);
  return ok({ completed, active });
}
