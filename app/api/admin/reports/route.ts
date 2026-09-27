import { NextRequest, NextResponse } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { parseBody, BODY_1KB } from "@/lib/parseBody";
import { writeAuditLog } from "@/lib/audit";

export async function GET(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
  if (!dbUser || !["admin", "subAdmin"].includes(dbUser.role)) return err("Forbidden", 403);

  const reports = await prisma.report.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "desc" },
    include: {
      swap: {
        select: {
          id: true, details: true, category: true, posterName: true,
          depot: { select: { name: true, code: true } },
        },
      },
      reporter: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  return ok(reports);
}

export async function PATCH(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
  if (!dbUser || !["admin", "subAdmin"].includes(dbUser.role)) return err("Forbidden", 403);

  const body = await parseBody(req, BODY_1KB);
  if (body instanceof NextResponse) return body;
  const { reportId, action } = body as { reportId: string; action: string };
  if (!reportId || !["dismiss", "remove"].includes(action)) return err("Invalid request", 400);

  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) return err("Report not found", 404);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? undefined;

  if (action === "remove") {
    // Hard delete cascades to messages, agreements, reviews and reports — the
    // most destructive action in the app, and irreversible. Restricted to full
    // admins: a subAdmin cannot see user emails but could previously erase a
    // whole swap's evidence trail.
    if (dbUser.role !== "admin") {
      return err("Only a full admin can remove a reported swap", 403);
    }
    await prisma.swap.delete({ where: { id: report.swapId } });
  } else {
    await prisma.report.update({ where: { id: reportId }, data: { status: "dismissed" } });
  }

  // Both branches are moderation decisions and must leave a trail; neither was
  // logged before, while far less consequential role changes were.
  writeAuditLog({
    adminId: user.userId,
    action: action === "remove" ? "report_remove_swap" : "report_dismiss",
    targetId: report.swapId,
    targetType: "swap",
    detail: `report ${reportId} → ${action}`,
    ip,
  });

  return ok({ ok: true });
}
