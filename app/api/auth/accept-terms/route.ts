import { NextRequest, NextResponse } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { CURRENT_TERMS_VERSION } from "@/lib/termsVersion";
import { parseBody, BODY_1KB } from "@/lib/parseBody";

export { CURRENT_TERMS_VERSION };

export async function POST(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const body = await parseBody(req, BODY_1KB);
  if (body instanceof NextResponse) return body;
  const { version } = body as { version: string };
  if (version !== CURRENT_TERMS_VERSION) return err("Terms version mismatch", 400);

  await prisma.user.update({
    where: { id: user.userId },
    data: { termsAcceptedAt: new Date(), termsVersion: CURRENT_TERMS_VERSION },
  });

  return ok({ accepted: true, version: CURRENT_TERMS_VERSION, at: new Date().toISOString() });
}
