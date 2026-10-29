import { ApiError } from "../utils/ApiError.js";
import { env } from "../config/env.js";
import { MINUTE } from "../config/policy.js";

// Minimal in-memory fixed-window limiter, keyed by client IP + route (+ `keyBy` when given).
// Good enough for a single backend instance; use a shared store (e.g. Redis) if you scale out.
export const rateLimit = ({ windowMs, max, keyBy = () => "" }) => {
    const hits = new Map();

    setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of hits) {
            if (entry.resetAt <= now) hits.delete(key);
        }
    }, windowMs).unref();

    return (req, res, next) => {
        const key = `${req.ip}:${req.baseUrl}${req.path}:${keyBy(req)}`;
        const now = Date.now();
        const entry = hits.get(key);

        if (!entry || entry.resetAt <= now) {
            hits.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        entry.count += 1;
        if (entry.count > max) {
            res.set("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
            return next(new ApiError(429, "Too many attempts. Wait a few minutes and try again."));
        }
        next();
    };
};

/**
 * Login / code / password-reset limits. Counted per address *and* email, because campus Wi-Fi puts
 * many students behind one address; the looser per-address cap stops one machine trying many accounts.
 */
export const createAuthLimiters = () => [
    rateLimit({ windowMs: 15 * MINUTE, max: 300 }),
    rateLimit({ windowMs: 15 * MINUTE, max: 10, keyBy: (req) => String(req.body?.email ?? "").toLowerCase() }),
];

// Tests sign in many times from one address; limiting them would only test the limiter
export const authLimiter = env.isTest ? (req, res, next) => next() : createAuthLimiters();
