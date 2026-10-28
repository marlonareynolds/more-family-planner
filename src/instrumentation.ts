import type { Instrumentation } from "next";

/** Runs once per server instance: switches on error tracking when SENTRY_DSN is set. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initErrorTracking } = await import("@/server/ops/error-report");
    initErrorTracking();
  }
}

/** Errors Next.js catches itself (pages, server components), as opposed to the API's own 500s. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(err, { ...request, headers: {} }, context);
};
