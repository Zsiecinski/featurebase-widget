// Optional Sentry integration. Auto-enabled when SENTRY_DSN env var is set.
// Falls back to console-only logging otherwise. We deliberately don't make
// @sentry/node a required dependency — it's heavy and most deploys won't use
// it. The optional import pattern below means the same code runs whether
// Sentry is installed or not.

let sentryInitialized = false;
let Sentry = null;

export async function initSentry() {
  if (sentryInitialized) return;
  if (!process.env.SENTRY_DSN) return;

  try {
    Sentry = await import('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'production',
      release: process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
      // Conservative defaults — most installs won't need traces or replays.
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0,
      // Don't capture request bodies — they may contain Featurebase API
      // keys or other secrets in error payloads.
      beforeSend(event) {
        if (event.request?.data) delete event.request.data;
        return event;
      },
    });
    sentryInitialized = true;
    console.log('[observability] Sentry enabled');
  } catch (err) {
    // @sentry/node not installed — log once and keep going. Don't crash.
    console.warn(
      `[observability] SENTRY_DSN set but @sentry/node not installed (${err.message}). Add it as a dep to enable error reporting.`,
    );
  }
}

// Report an error to Sentry if available, always log to console.
export function reportError(err, context = {}) {
  console.error('[loop]', err.message || err, context);
  if (sentryInitialized && Sentry) {
    Sentry.captureException(err, { extra: context });
  }
}

// Express error middleware. Mount last in the app.
export function errorHandler(err, req, res, _next) {
  reportError(err, {
    path: req.path,
    method: req.method,
    workspaceId: req.body?.workspace_id || req.body?.context?.workspace_id,
  });
  // Don't leak stack traces to the client.
  if (!res.headersSent) {
    res.status(500).json({ error: 'internal server error' });
  }
}
