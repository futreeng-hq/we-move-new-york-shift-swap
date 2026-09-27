import { NextRequest } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { writeAuditLog } from "@/lib/audit";
import { clientIp } from "@/lib/rateLimit";

export async function GET(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
  if (!dbUser || dbUser.role !== "admin") return err("Forbidden", 403);

  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      admin: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  writeAuditLog({
    adminId: user.userId,
    action: "audit_log_export",
    targetType: "audit_log",
    detail: `Exported ${logs.length} audit log entries`,
    ip: clientIp(req) ?? undefined,
  });

  return ok(logs);
}
