import { prisma } from "@/lib/prisma";

/**
 * Shared depot and block scoping for swap-attached actions.
 *
 * These checks existed only on `GET /api/swaps/[id]`, so several sibling
 * routes that take the same `[id]` — save, interest, agreement, messages,
 * report — could be driven against a swap in another depot, or by a user the
 * poster had blocked. Centralizing them here keeps the policy in one place
 * instead of five near-copies that drift apart.
 */

/** True when either user has blocked the other (blocks are symmetric in effect). */
export async function isBlockedBetween(userA: string, userB: string): Promise<boolean> {
  if (userA === userB) return false;
  const block = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: userA, blockedId: userB },
        { blockerId: userB, blockedId: userA },
      ],
    },
    select: { id: true },
  });
  return block !== null;
}

/**
 * Whether `callerId` may act on `swap` at all.
 *
 * Returns null when access is allowed, otherwise `{ message, status }` ready to
 * hand to `err()`. The swap owner always passes. Everyone else must be in the
 * swap's depot and not blocked either way; both failures return the same
 * neutral 404 so the response does not reveal that the swap exists.
 */
export async function checkSwapAccess(
  callerId: string,
  swap: { userId: string; depotId: string },
): Promise<{ message: string; status: number } | null> {
  if (swap.userId === callerId) return null;

  const caller = await prisma.user.findUnique({
    where: { id: callerId },
    select: { depotId: true },
  });
  if (!caller || caller.depotId !== swap.depotId) {
    return { message: "Swap not found", status: 404 };
  }

  if (await isBlockedBetween(callerId, swap.userId)) {
    return { message: "Swap not found", status: 404 };
  }

  return null;
}
