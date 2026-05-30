// Simple in-memory rate limiter keyed by Intercom workspace_id. Protects
// against one bad/abusive tenant burning through everyone's Featurebase API
// quota. In-memory means it resets on each Railway deploy — fine for this
// use case (the goal is bounding burst, not absolute fairness).
//
// Default: 120 requests per workspace per minute. Each Loop install generates
// at most ~10 req/min during heavy use; 120 leaves headroom + flags clearly
// abnormal usage.

const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE) || 120;
const WINDOW_MS = 60_000;

// Map<workspaceId, { count, windowStart }>
const buckets = new Map();

// Periodic cleanup of stale buckets so we don't leak memory across uninstalls.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.windowStart > WINDOW_MS * 2) buckets.delete(k);
  }
}, WINDOW_MS).unref();

export function workspaceRateLimit(req, res, next) {
  const workspaceId =
    req.body?.workspace_id || req.body?.context?.workspace_id;
  if (!workspaceId) return next();

  const now = Date.now();
  let bucket = buckets.get(workspaceId);
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
    buckets.set(workspaceId, bucket);
  }
  bucket.count += 1;

  if (bucket.count > RATE_LIMIT_PER_MINUTE) {
    res.set('Retry-After', String(Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000)));
    return res.status(429).json({
      error: 'rate limit exceeded',
      workspace_id: workspaceId,
      limit: RATE_LIMIT_PER_MINUTE,
      window_seconds: 60,
    });
  }
  next();
}
