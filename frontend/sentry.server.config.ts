/**
 * sentry.server.config.ts
 * Sentry server-side (SSR / API routes) initialisation — resolves #293.
 *
 * #172: attaches correlationId when present on the request (via headers)
 * or falls back to a generated action ID for SSR-originated events.
 */

import * as Sentry from "@sentry/nextjs";
import {
  getCorrelationId,
  getSessionId,
} from "@/lib/correlation";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.2,
  beforeSend(event) {
    const correlationId = getCorrelationId();
    const sessionId = getSessionId();
    event.tags = {
      ...event.tags,
      correlationId,
      sessionId,
    };
    event.extra = {
      ...event.extra,
      correlationId,
      sessionId,
    };
    return event;
  },
});
