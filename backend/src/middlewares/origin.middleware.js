import { ApiError } from "../utils/ApiError.js";
import { env } from "../config/env.js";

const READ_ONLY = new Set(["GET", "HEAD", "OPTIONS"]);

const sameHost = (origin, req) => {
  try {
    return new URL(origin).host === req.get("host");
  } catch {
    return false;
  }
};

/**
 * Cross-site request forgery guard. Browsers attach session cookies (SameSite=None in production) to
 * a form another site submits to this API, and send an Origin header with it. Writes are accepted only
 * from the web app's origins (CORS_ORIGIN) or the API's own host (the app behind the same proxy).
 * Requests without an Origin header aren't from another site's page (curl, tests, server-to-server).
 */
export const requireTrustedOrigin = (req, res, next) => {
  if (READ_ONLY.has(req.method)) return next();
  const origin = req.get("origin");
  if (!origin || env.corsOrigins.includes(origin) || sameHost(origin, req)) return next();
  next(new ApiError(403, "This request came from a site Smart SAC doesn't recognise, so it was refused."));
};
