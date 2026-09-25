import { NextRequest } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { rateLimit } from "@/lib/rateLimit";
import { checkSwapAccess } from "@/lib/accessScope";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  if (!await rateLimit(`save:${user.userId}`, 60, 60_000)) {
    return err("Slow down — max 60 saves per minute", 429);
  }

  const { id: swapId } = await params;

  const swap = await prisma.swap.findUnique({ where: { id: swapId } });
  if (!swap) return err("Swap not found", 404);
  if (swap.userId === user.userId) return err("Cannot save your own swap", 400);

  // Without this, saving was the way around depot scoping: GET /api/swaps/[id]
  // rejects a foreign-depot id, but saving it and then reading
  // GET /api/swaps/saved returned the whole swap row — including the poster's
  // contact details — to someone in another depot, or to a blocked user.
  const denied = await checkSwapAccess(user.userId, swap);
  if (denied) return err(denied.message, denied.status);

  await prisma.savedSwap.upsert({
    where: { userId_swapId: { userId: user.userId, swapId } },
    create: { userId: user.userId, swapId },
    update: {},
  });

  return ok({ saved: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  if (!await rateLimit(`save:${user.userId}`, 60, 60_000)) {
    return err("Slow down — max 60 saves per minute", 429);
  }

  const { id: swapId } = await params;

  await prisma.savedSwap.deleteMany({ where: { userId: user.userId, swapId } });
  return ok({ saved: false });
}
