import * as Sentry from "@sentry/nextjs";

// Next.js instrumentation: boots Sentry per runtime and reports every unhandled server error.
// Errors thrown inside cron or webhook routes also go to Slack, so a failing job is noticed
// within minutes rather than at the next hourly staleness check.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("../sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("../sentry.edge.config");
}

export const onRequestError: typeof Sentry.captureRequestError = async (err, request, context) => {
  Sentry.captureRequestError(err, request, context);
  const path = request.path ?? "";
  if (/^\/api\/(cron|webhooks)\//.test(path)) {
    try {
      const { postSlackError } = await import("./lib/alerts/slack");
      const msg = err instanceof Error ? err.message : String(err);
      await postSlackError(`Unhandled error in ${path}`, [msg.slice(0, 300), `method: ${request.method}`, `route: ${context.routeType}`]);
    } catch {
      /* alerting must never break the request */
    }
  }
};
