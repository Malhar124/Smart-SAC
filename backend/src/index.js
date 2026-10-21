// Must be the first imports: ES module imports are evaluated in order, and later modules read
// process.env (validated by config/env.js) at load time. Sentry starts before anything can throw.
import "dotenv/config";
import "./lib/sentry.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import connectDB, { disconnectDB } from "./db/index.js";
import { app } from "./app.js";
import { closeAllStreams } from "./lib/events.js";
import { startJobs, stopJobs } from "./jobs/index.js";

let server;

const shutdown = async (signal) => {
  logger.info({ signal }, "shutting down");
  stopJobs();
  closeAllStreams();
  server?.close(async () => {
    await disconnectDB();
    process.exit(0);
  });
  // Don't hang forever on a stuck connection
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "unhandled promise rejection"));

connectDB()
  .then(() => {
    server = app.listen(env.PORT, () => {
      logger.info({ port: env.PORT, env: env.NODE_ENV }, `API listening on http://localhost:${env.PORT} (docs at /api/docs)`);
      startJobs();
    });
  })
  .catch((err) => {
    logger.fatal({ err }, "PostgreSQL connection failed, server not started");
    process.exit(1);
  });
