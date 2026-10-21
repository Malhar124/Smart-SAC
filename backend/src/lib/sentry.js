import * as Sentry from "@sentry/node";
import { env } from "../config/env.js";

// Error tracking is opt-in: nothing is sent unless SENTRY_DSN is set
export const sentryEnabled = Boolean(env.SENTRY_DSN);

if (sentryEnabled) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.isProduction ? 0.1 : 0,
    sendDefaultPii: false,
  });
}

export const captureException = (error, context) => {
  if (sentryEnabled) Sentry.captureException(error, context ? { extra: context } : undefined);
};
