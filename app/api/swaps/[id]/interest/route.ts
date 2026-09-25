import { NextRequest, NextResponse } from "next/server";
import { requireUser, checkActive, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { ok, err } from "@/lib/apiResponse";
import { notifyUserWithEmailFallback } from "@/lib/notifyUser";
import { parseBody, BODY_4KB } from "@/lib/parseBody";
import { escapeHtml } from "@/lib/escapeHtml";
import { getAppUrl } from "@/lib/appUrl";
import { checkSwapAccess } from "@/lib/accessScope";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }
  const { id } = await params;

  if (!await rateLimit(`msg:${user.userId}`, 5, 60_000)) {
    return err("Slow down! Max 5 messages per minute", 429);
  }

  const dbUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { email: true, suspendedUntil: true } });
  if (!dbUser) return err("User not found", 404);
  const activeErr = checkActive(dbUser);
  if (activeErr) return err(activeErr, 403);

  const body = await parseBody(req, BODY_4KB);
  if (body instanceof NextResponse) return body;
  const { text } = body as { text: string };
  if (!text?.trim()) return err("Message text required", 400);
  if (text.trim().length > 2000) return err("Message too long — max 2000 characters", 400);

  const swap = await prisma.swap.findUnique({ where: { id } });
  if (!swap) return err("Swap not found", 404);
  if (swap.userId === user.userId) return err("Cannot message yourself", 400);
  if (swap.status !== "open") return err("Swap is not open", 400);

  // Depot scoping was missing here while the direct-message route enforces it
  // explicitly "to prevent cross-depot harassment" — so this was the way
  // around that control. checkSwapAccess covers the depot and the block in one
  // neutral 404.
  const denied = await checkSwapAccess(user.userId, swap);
  if (denied) return err(denied.message, denied.status);

  const [message, sender, depot] = await Promise.all([
    prisma.message.create({
      data: { swapId: id, fromUserId: user.userId, toUserId: swap.userId, text: text.trim() },
    }),
    prisma.user.findUnique({ where: { id: user.userId }, select: { firstName: true, lastName: true } }),
    prisma.depot.findUnique({ where: { id: swap.depotId }, select: { code: true } }),
  ]);

  const senderName = sender ? `${sender.firstName} ${sender.lastName}` : "Someone";
  const depotCode = depot?.code ?? swap.depotId;
  const appUrl = getAppUrl();
  if (!appUrl) return err("Server configuration error — contact support", 500);

  const emailHtml = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#010028;color:#fff;border-radius:16px">
  <h2 style="font-size:18px;font-weight:800;margin-bottom:8px">New interest in your swap</h2>
  <p style="color:rgba(255,255,255,.6);font-size:14px;line-height:1.6;margin-bottom:24px">${escapeHtml(senderName)} is interested in your swap — log in to respond.</p>
  <a href="${appUrl}/depot/${depotCode}/swaps/${id}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:#D1AD38;color:#010028;font-weight:700;font-size:15px;text-decoration:none">View Swap</a>
</div>`;

  // Notify swap owner — awaited so the fetch completes before the serverless function exits
  await notifyUserWithEmailFallback(
    swap.userId,
    {
      category: "message",
      title: "New interest in your swap",
      body: `${senderName} is interested — "${text.trim().replace(/[\n\r\t]/g, " ").substring(0, 60)}"`,
      url: `/depot/${depotCode}/swaps/${id}`,
    },
    "New interest in your swap",
    emailHtml
  );

  return ok(message, 201);
}
