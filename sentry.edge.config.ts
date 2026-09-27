import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentryScrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.2,
  // Explicit: no IPs, cookies or request bodies attached automatically.
  sendDefaultPii: false,
  enabled: process.env.NODE_ENV === "production",
  beforeSend(event) {
    return scrubEvent(event as unknown as Record<string, unknown>) as unknown as typeof event;
  },
});
