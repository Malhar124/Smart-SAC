import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./db/index.js";
import { buildOpenApiDocument } from "./lib/openapi.js";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware.js";
import { requireTrustedOrigin } from "./middlewares/origin.middleware.js";
import userRouter from "./routes/user.routes.js";
import adminRouter from "./routes/admin.routes.js";
import eventsRouter from "./routes/events.routes.js";

const app = express();

app.disable("x-powered-by");
// Behind nginx (docker-compose) the client IP comes from X-Forwarded-For; the rate limiter needs it
if (env.TRUST_PROXY) app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    // The events stream stays open for hours and the health check runs every few seconds
    autoLogging: { ignore: (req) => req.url === "/api/v1/events" || req.url === "/api/health" },
    customLogLevel: (req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
    serializers: {
      req: (req) => ({ method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  })
);
app.use(cors({ origin: env.corsOrigins, credentials: true }));
// JSON bodies only: an HTML form on another site can post url-encoded bodies without a CORS preflight
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use("/api", requireTrustedOrigin);

app.get("/api/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "ok", uptimeSeconds: Math.round(process.uptime()) });
  } catch {
    res.status(503).json({ status: "degraded", database: "unreachable" });
  }
});

app.use("/api/v1/users", userRouter);
app.use("/api/v1/admin", adminRouter);
app.use("/api/v1", eventsRouter);

// API documentation, generated from the same Zod schemas that validate requests
const openApiDocument = buildOpenApiDocument();
app.get("/api/openapi.json", (req, res) => res.json(openApiDocument));
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument, { customSiteTitle: "Smart SAC API" }));

app.use("/api", notFoundHandler);
app.use(errorHandler);

export { app, openApiDocument };
