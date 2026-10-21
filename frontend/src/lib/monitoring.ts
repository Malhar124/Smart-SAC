import { SENTRY_DSN } from "@/lib/config";

// Error reporting is opt-in: nothing leaves the browser unless VITE_SENTRY_DSN is set, and the
// Sentry SDK isn't even downloaded otherwise.
export const monitoringEnabled = Boolean(SENTRY_DSN);

type SentryModule = typeof import("@sentry/react");
let sentry: SentryModule | null = null;
const pending: { error: unknown; context?: Record<string, unknown> }[] = [];

export const initMonitoring = async () => {
  if (!monitoringEnabled) return;
  sentry = await import("@sentry/react");
  sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
  // Errors that happened while the SDK was loading
  for (const { error, context } of pending.splice(0)) sentry.captureException(error, context ? { extra: context } : undefined);
};

/** Report an unexpected error. In development without Sentry it goes to the console instead. */
export const reportError = (error: unknown, context?: Record<string, unknown>) => {
  if (sentry) sentry.captureException(error, context ? { extra: context } : undefined);
  else if (monitoringEnabled) pending.push({ error, context });
  else if (import.meta.env.DEV) console.error(error, context ?? "");
};
