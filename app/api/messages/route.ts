import { NextRequest, NextResponse } from "next/server";
import { requireUser, checkActive } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { ok, err } from "@/lib/apiResponse";
import { notifyUserWithEmailFallback } from "@/lib/notifyUser";
import { parseBody, BODY_4KB } from "@/lib/parseBody";
import { checkSwapAccess } from "@/lib/accessScope";
import { escapeHtml } from "@/lib/escapeHtml";

export async function GET(req: NextRequest) {
  let user;
  try { user = requireUser(req); } catch { return err("Unauthorized", 401); }

  const unreadCount = await prisma.message.count({
    where: { toUserId: user.userId, read: false },
  });

  return ok({ unreadCount });
}

export async function POST(req: NextRequest) {
  let user;
  try { user = requireUser(req); } catch { return err("Unauthorized", 401); }

  if (!await rateLimit(`msg:${user.userId}`, 5, 60_000)) {
    return err("Slow down! Max 5 messages per minute", 429);
  }

  const dbUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { email: true, suspendedUntil: true } });
  if (!dbUser) return err("User not found", 404);
  const activeErr = checkActive(dbUser);
  if (activeErr) return err(activeErr, 403);

  const body = await parseBody(req, BODY_4KB);
  if (body instanceof NextResponse) return body;
  const { swapId, text } = body as { swapId: string; text: string };
  if (!swapId || !text?.trim()) return err("swapId and text required", 400);
  if (text.trim().length > 2000) return err("Message too long — max 2000 characters", 400);

  const swap = await prisma.swap.findUnique({ where: { id: swapId } });
  if (!swap) return err("Swap not found", 404);
  if (swap.userId === user.userId) return err("Cannot message yourself", 400);

  // Depot scoping plus the symmetric block check. The direct-message route
  // enforces the depot explicitly to prevent cross-depot harassment; sending
  // via a swap id must not be a way around it.
  const denied = await checkSwapAccess(user.userId, swap);
  if (denied) return err(denied.message, denied.status);

  const [message, sender, depot] = await Promise.all([
    prisma.message.create({
      data: { swapId, fromUserId: user.userId, toUserId: swap.userId, text: text.trim() },
    }),
    prisma.user.findUnique({ where: { id: user.userId }, select: { firstName: true, lastName: true } }),
    prisma.depot.findUnique({ where: { id: swap.depotId }, select: { code: true } }),
  ]);

  const senderName = sender ? `${sender.firstName} ${sender.lastName}` : "Someone";
  const safeSenderName = escapeHtml(senderName);
  const safeText = escapeHtml(text.trim().slice(0, 300));
  const threadUrl = depot ? `/depot/${depot.code}/messages/${user.userId}` : "/";
  await notifyUserWithEmailFallback(
    swap.userId,
    {
      category: "message",
      title: "Someone is interested in your swap",
      body: `${senderName}: ${text.trim().slice(0, 100)}`,
      url: threadUrl,
    },
    `New message from ${safeSenderName}`,
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#010028;color:#fff;border-radius:16px">
      <h2 style="font-size:18px;font-weight:800;margin-bottom:8px">New message from ${safeSenderName}</h2>
      <p style="color:rgba(255,255,255,.7);font-size:14px;line-height:1.6">${safeText}</p>
    </div>`
  );

  // Create a dedicated swap_interest notification for the poster
  try {
    await prisma.notification.create({
      data: {
        id: crypto.randomUUID(),
        userId: swap.userId,
        type: "swap_interest",
        // A7 note: record-only write (no push) — in-app records for personal
        // categories persist regardless of prefs, so this stays direct.
        title: "Someone is interested in your swap",
        body: `A new message about your swap: "${swap.details.slice(0, 60)}${swap.details.length > 60 ? "…" : ""}"`,
        url: depot ? `/depot/${depot.code}/swaps/${swapId}` : "/",
      },
    });
  } catch { /* non-fatal */ }

  return ok(message, 201);
}
