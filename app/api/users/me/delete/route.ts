import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { ok, err } from "@/lib/apiResponse";
import { parseBody, BODY_1KB } from "@/lib/parseBody";
import { writeAuditLog } from "@/lib/audit";
import { blockUserAccessTokens } from "@/lib/tokenBlocklist";
import bcrypt from "bcryptjs";

// POST /api/users/me/delete
// Requires password confirmation before deleting own account (GDPR right to erasure)
export async function POST(req: NextRequest) {
  let user;
  try { user = requireUser(req); } catch { return err("Unauthorized", 401); }

  // Rate limit: deletion is destructive and password-gated, so an attacker
  // with a stolen access token shouldn't be able to brute-force the password
  // confirmation by retrying.
  if (!await rateLimit(`self-delete:${user.userId}`, 3, 15 * 60 * 1000)) {
    return err("Too many attempts — try again in 15 minutes", 429);
  }

  const body = await parseBody(req, BODY_1KB);
  if (body instanceof NextResponse) return body;
  const { password } = body as { password: string };
  if (!password) return err("Password required to confirm deletion", 400);

  const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
  if (!dbUser) return err("User not found", 404);

  const valid = await bcrypt.compare(password, dbUser.passwordHash);
  if (!valid) return err("Incorrect password", 401);

  // Anonymize — preserves swap/agreement history integrity.
  //
  // Anonymizing the User row alone is not enough: Swap carries a denormalized
  // posterName (rendered on the board and on the public /s/<id> teaser) and a
  // contact string (phone/email). Leaving those behind contradicts the
  // Privacy Policy promise that "your profile, swap listings, and personally
  // identifying information are removed within 30 days."
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.userId },
      data: {
        email: `deleted_${user.userId}@deleted.invalid`,
        passwordHash: "deleted",
        firstName: "Deleted",
        lastName: "User",
        avatarUrl: null,
        depotId: null,
        pushSubscriptions: { deleteMany: {} },
        inviteCodes: { updateMany: { where: {}, data: { isValid: false } } },
      },
    }),
    prisma.swap.updateMany({
      where: { userId: user.userId },
      data: { posterName: "Deleted User", contact: null },
    }),
  ]);

  // Cut off live sessions so the anonymized account cannot keep acting for the
  // remainder of its 15-minute access token.
  await blockUserAccessTokens(user.userId);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? undefined;
  writeAuditLog({
    adminId: user.userId,
    action: "account_delete",
    targetId: user.userId,
    targetType: "user",
    // Deliberately does NOT record the email: targetId already identifies the
    // account, and writing the address here would re-introduce the PII the
    // deletion just removed.
    detail: "Self-deleted account",
    ip,
  });

  return ok({ deleted: true });
}
