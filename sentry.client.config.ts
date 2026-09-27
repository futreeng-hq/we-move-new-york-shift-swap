import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentryScrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.2,
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0.05,
  // Never attach IPs, cookies or request bodies automatically. Stated
  // explicitly rather than relying on the SDK default, which has changed
  // between major versions.
  sendDefaultPii: false,
  integrations: [
    Sentry.replayIntegration({
      maskAllInputs: true,
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
  enabled: process.env.NODE_ENV === "production",
  beforeSend(event) {
    return scrubEvent(event as unknown as Record<string, unknown>) as unknown as typeof event;
  },
});
