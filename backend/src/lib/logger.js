import pino from "pino";
import { env } from "../config/env.js";

const level = env.LOG_LEVEL ?? (env.isTest ? "silent" : env.isProduction ? "info" : "debug");

// JSON logs in production (for a log collector); readable, colored lines in development
export const logger = pino({
  level,
  redact: {
    paths: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]', "*.password", "*.token"],
    censor: "[redacted]",
  },
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" } }
      : undefined,
});
