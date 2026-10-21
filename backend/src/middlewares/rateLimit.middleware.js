import { ApiError } from "../utils/ApiError.js";
import { env } from "../config/env.js";

// Minimal in-memory fixed-window limiter, keyed by client IP + route.
// Good enough for a single backend instance; use a shared store (e.g. Redis) if you scale out.
export const rateLimit = ({ windowMs, max }) => {
    // Tests sign in many times from one address; limiting them would only test the limiter
    if (env.isTest) return (req, res, next) => next();
    const hits = new Map();

    setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of hits) {
            if (entry.resetAt <= now) hits.delete(key);
        }
    }, windowMs).unref();

    return (req, res, next) => {
        const key = `${req.ip}:${req.baseUrl}${req.path}`;
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

// Shared limits for login / OTP / password-reset style endpoints
export const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
