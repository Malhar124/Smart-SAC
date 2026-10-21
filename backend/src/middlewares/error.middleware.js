import { ApiError } from "../utils/ApiError.js";
import { logger } from "../lib/logger.js";
import { captureException } from "../lib/sentry.js";

export const notFoundHandler = (req, res) => {
  res.status(404).json({ success: false, message: `There's no API route for ${req.method} ${req.originalUrl}.` });
};

// Prisma's known request errors, translated into responses a person can act on
const fromPrismaError = (err) => {
  if (err?.name !== "PrismaClientKnownRequestError") return null;
  if (err.code === "P2002") {
    const fields = [].concat(err.meta?.target ?? []).join(", ");
    return new ApiError(409, fields ? `That ${fields} is already in use.` : "That already exists.");
  }
  if (err.code === "P2025") return new ApiError(404, "That record doesn't exist any more.");
  if (err.code === "P2003") return new ApiError(409, "It's still linked to other records, so it can't be changed that way.");
  return null;
};

// Express recognises error handlers by their four arguments, so `next` stays in the signature
export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    req.log?.error({ err }, "error after response started");
    return res.end();
  }

  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, message: "The request body isn't valid JSON." });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ success: false, message: "The request is too large." });
  }

  const known = err instanceof ApiError ? err : fromPrismaError(err);
  if (known && known.statusCode < 500) {
    return res.status(known.statusCode).json({ success: false, message: known.message, errors: known.errors ?? [] });
  }

  (req.log ?? logger).error({ err }, "request failed");
  captureException(err, { method: req.method, path: req.originalUrl });

  const status = known?.statusCode ?? 500;
  const message = known?.message ?? "Something went wrong on the server. Try again in a moment.";
  return res.status(status).json({ success: false, message, errors: [] });
};
