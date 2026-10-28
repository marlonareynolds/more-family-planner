import * as Sentry from "@sentry/nextjs";
import type { ErrorEvent } from "@sentry/nextjs";

/**
 * Error tracking (Sentry, EU region). Off unless SENTRY_DSN is set. Server
 * errors only: no browser script, no session replay, no performance traces.
 *
 * What leaves More is the error's type, a scrubbed message, the stack and
 * the route. Never request bodies, cookies, headers, addresses, query
 * strings or log breadcrumbs, and never the values in a failed query
 * (drizzle puts them after "params:"), since those can be a private title
 * or a child's name.
 */

/** Cut anything after a query's parameter list, and keep messages short. */
export function scrubMessage(message: string): string {
  const cut = message.search(/\bparams:/i);
  return (cut >= 0 ? `${message.slice(0, cut)}params: [removed]` : message).slice(0, 500);
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) event.request = { url: event.request.url?.split("?")[0], method: event.request.method };
  delete event.user;
  delete event.breadcrumbs;
  delete event.extra;
  if (event.message) event.message = scrubMessage(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubMessage(ex.value);
    for (const frame of ex.stacktrace?.frames ?? []) delete frame.vars;
  }
  return event;
}

export function errorTrackingEnabled(): boolean {
  return Boolean(process.env.SENTRY_DSN);
}

export function initErrorTracking(): void {
  if (!errorTrackingEnabled()) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    // Collect nothing beyond the error itself; the scrub below is a second line.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    tracesSampleRate: 0,
    beforeBreadcrumb: () => null,
    beforeSend: (event) => scrubEvent(event),
  });
}

/** An unexpected server error, with the reference the person was shown. */
export function reportError(err: unknown, reference?: string): void {
  if (!errorTrackingEnabled()) return;
  Sentry.captureException(err, reference ? { tags: { reference } } : undefined);
}
