import { NextRequest } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { blockUserAccessTokens } from "@/lib/tokenBlocklist";

export async function POST(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const [, revoked] = await Promise.all([
    // Bump updatedAt to invalidate all refresh tokens at next rotation
    prisma.user.update({ where: { id: user.userId }, data: { updatedAt: new Date() } }),
    // Mark all current access and refresh tokens as invalid in Redis.
    blockUserAccessTokens(user.userId),
  ]);

  if (!revoked) return err("Session revocation is temporarily unavailable", 503);

  return ok({ success: true });
}
