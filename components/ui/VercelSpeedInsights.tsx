"use client";

import { SpeedInsights } from "@vercel/speed-insights/next";
import { redactSensitiveUrl } from "@/lib/sensitiveUrl";

/**
 * Speed Insights was rendered bare, with no beforeSend, while its sibling
 * <Analytics /> had one. Both beacons carry the page URL, so the reset and
 * verify credential segments have to be stripped from this one too.
 *
 * beforeSend must be a function and app/layout.tsx is a server component, so
 * the hook cannot be passed as a prop from there — hence this client wrapper,
 * mirroring components/ui/VercelAnalytics.tsx.
 */
export default function VercelSpeedInsights() {
  return <SpeedInsights beforeSend={(event) => ({ ...event, url: redactSensitiveUrl(event.url) })} />;
}
