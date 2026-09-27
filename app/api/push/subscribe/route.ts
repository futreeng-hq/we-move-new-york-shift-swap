import { NextRequest, NextResponse } from "next/server";
import { requireUser, authError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/apiResponse";
import { parseBody, BODY_2KB } from "@/lib/parseBody";

export async function GET() {
  return ok({ publicKey: process.env.VAPID_PUBLIC_KEY ?? "" });
}

export async function POST(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const body = await parseBody(req, BODY_2KB);
  if (body instanceof NextResponse) return body;
  const { endpoint, keys } = body as { endpoint: string; keys: { p256dh: string; auth: string } };
  if (!endpoint || !keys?.p256dh || !keys?.auth) return err("Invalid subscription object", 400);

  // Scope to (endpoint, userId). The previous upsert keyed on endpoint alone
  // could overwrite another user's subscription if two users somehow shared
  // an endpoint (e.g., shared-browser case). Now: if the existing record
  // belongs to a different user, delete it first (legitimate device handoff)
  // and write a fresh one for this user. Same user re-registering the same
  // endpoint just refreshes the keys.
  await prisma.$transaction(async (tx) => {
    const existing = await tx.pushSubscription.findUnique({ where: { endpoint } });
    if (existing && existing.userId !== user.userId) {
      await tx.pushSubscription.delete({ where: { endpoint } });
    }
    await tx.pushSubscription.upsert({
      where: { endpoint },
      create: { userId: user.userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      update: { p256dh: keys.p256dh, auth: keys.auth },
    });
  });

  return ok({ ok: true });
}

export async function DELETE(req: NextRequest) {
  let user;
  try { user = await requireUser(req); } catch (e) { return authError(e); }

  const delBody = await parseBody(req, BODY_2KB);
  if (delBody instanceof NextResponse) return delBody;
  const { endpoint } = delBody as { endpoint: string };
  if (!endpoint) return err("endpoint required", 400);

  await prisma.pushSubscription.deleteMany({
    where: { userId: user.userId, endpoint },
  });

  return ok({ ok: true });
}
