import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireUser, checkActive, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit, rateLimitByIp, clientIp } from "@/lib/rateLimit";
import { ok, err } from "@/lib/apiResponse";
import { parseBody, BODY_2KB } from "@/lib/parseBody";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/escapeHtml";
import { checkSwapAccess } from "@/lib/accessScope";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  // Rate limit reports — prevent flooding the admin queue with bogus reports.
  // Per-IP cap protects against many compromised accounts on the same network.
  const ip = clientIp(req);
  if (!await rateLimitByIp(ip, "report:ip", 30, 3_600_000)) return err("Rate limit exceeded — too many reports from this network", 429);
  if (!await rateLimit(`report:${user.userId}`, 10, 3_600_000)) return err("Rate limit: max 10 reports per hour", 429);

  const { id } = await params;
  const body = await parseBody(req, BODY_2KB);
  if (body instanceof NextResponse) return body;
  const { reason } = body as { reason?: string };
  if (reason && reason.length > 500) return err("Reason must be 500 characters or fewer", 400);

  const reporter = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { email: true, suspendedUntil: true },
  });
  if (!reporter) return err("User not found", 404);
  const activeErr = checkActive(reporter);
  if (activeErr) return err(activeErr, 403);

  const swap = await prisma.swap.findUnique({ where: { id } });
  if (!swap) return err("Swap not found", 404);

  // Reporting fired an email containing the swap's details to the abuse
  // mailbox with no depot or block check, so a blocked user could keep
  // generating reports against the person who blocked them, and any user could
  // report swaps in depots they cannot see.
  const denied = await checkSwapAccess(user.userId, swap);
  if (denied) return err(denied.message, denied.status);

  const existing = await prisma.report.findFirst({
    where: { swapId: id, reporterId: user.userId },
  });
  if (existing) return err("Already reported", 409);

  await prisma.report.create({
    data: { swapId: id, reporterId: user.userId, reason: reason ?? null },
  });

  // Alert admins about the new report. Best-effort: the Resend call is
  // fire-and-forget and any failure is swallowed to Sentry, so it can never
  // delay or fail the reporter's 201 below.
  const alertTo = process.env.REPORTS_ALERT_EMAIL || process.env.EMAIL_FROM;
  if (alertTo) {
    const reporter = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { firstName: true, lastName: true, depotId: true },
    });

    const reporterName = reporter ? `${reporter.firstName} ${reporter.lastName}`.trim() : "Unknown user";
    const depot = reporter?.depotId ?? "—";
    const reasonText = reason?.trim() ? reason.trim() : "(no reason given)";
    const detailsSnippet = swap.details.slice(0, 200);
    const reportedAt = new Date().toUTCString();
    const reportsUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/admin?tab=reports`;

    const subject = `New report on We Move NY (swap ${id})`;
    const html = `
      <h2>New abuse report</h2>
      <p><strong>Time:</strong> ${escapeHtml(reportedAt)}</p>
      <p><strong>Reporter:</strong> ${escapeHtml(reporterName)} (id: ${escapeHtml(user.userId)})</p>
      <p><strong>Depot:</strong> ${escapeHtml(depot)}</p>
      <p><strong>Swap:</strong> ${escapeHtml(id)}</p>
      <p><strong>Reason:</strong> ${escapeHtml(reasonText)}</p>
      <p><strong>Swap details (excerpt):</strong> ${escapeHtml(detailsSnippet)}</p>
      <p><a href="${reportsUrl}">Open the admin reports dashboard</a></p>
    `;
    const text = [
      "New abuse report on We Move NY",
      `Time: ${reportedAt}`,
      `Reporter: ${reporterName} (id: ${user.userId})`,
      `Depot: ${depot}`,
      `Swap: ${id}`,
      `Reason: ${reasonText}`,
      `Swap details (excerpt): ${detailsSnippet}`,
      `Admin dashboard: ${reportsUrl}`,
    ].join("\n");

    sendEmail(alertTo, subject, html, text).catch((e) => {
      Sentry.captureException(e, { level: "warning", tags: { source: "report-alert" } });
    });
  }

  return ok({ message: "Reported. Thank you." }, 201);
}
