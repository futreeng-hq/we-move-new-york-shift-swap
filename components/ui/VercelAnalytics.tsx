"use client";
import { Analytics } from "@vercel/analytics/next";
import { redactSensitiveUrl } from "@/lib/sensitiveUrl";

/**
 * Vercel Analytics with the reset/verify credential stripped from the URL.
 *
 * beforeSend must be a function, and app/layout.tsx is a server component, so
 * the hook cannot be passed as a prop from there — hence this client wrapper.
 * Without it the beacon carries /reset-password/<jwt> verbatim.
 */
export default function VercelAnalytics() {
  return <Analytics beforeSend={(event) => ({ ...event, url: redactSensitiveUrl(event.url) })} />;
}
