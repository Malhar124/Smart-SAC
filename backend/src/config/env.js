import { z } from "zod";

// Every setting the server reads, validated once at startup so a missing secret fails loudly
// instead of surfacing later as a confusing 500.
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  ACCESS_TOKEN_SECRET: z.string().min(1, "ACCESS_TOKEN_SECRET is required"),
  ACCESS_TOKEN_EXPIRY: z.string().default("15m"),
  REFRESH_TOKEN_SECRET: z.string().min(1, "REFRESH_TOKEN_SECRET is required"),
  REFRESH_TOKEN_EXPIRY: z.string().default("10d"),

  // Cookie policy. Defaults suit a frontend on another site in production (Secure, SameSite=None) and
  // plain http://localhost in development. A same-origin deployment behind one proxy can use lax.
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).optional(),

  ADMIN_EMAILS: z.string().default(""),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  EMAIL_USER: z.string().optional(),
  EMAIL_PASS: z.string().optional(),
  SPORTS_HEAD_EMAIL: z.string().optional(),

  // The SAC's local time zone: room slots, opening hours and busy-time charts use it
  APP_TIMEZONE: z.string().default("Asia/Kolkata"),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
  SENTRY_DSN: z.string().optional(),
});

const MIN_SECRET_LENGTH = 32;

const parsed = schema
  .superRefine((cfg, ctx) => {
    // Short secrets make tokens guessable: refuse them in production, warn about them elsewhere
    if (cfg.NODE_ENV !== "production") return;
    for (const key of ["ACCESS_TOKEN_SECRET", "REFRESH_TOKEN_SECRET"]) {
      if (cfg[key].length < MIN_SECRET_LENGTH) {
        ctx.addIssue({ code: "custom", path: [key], message: `must be at least ${MIN_SECRET_LENGTH} characters in production` });
      }
    }
  })
  .safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  // The logger depends on this module, so report with console and stop
  console.error(`Invalid environment configuration:\n${problems}\nSee backend/.env.example.`);
  if (process.env.NODE_ENV === "test") throw new Error("Invalid test environment");
  process.exit(1);
}

if (parsed.data.NODE_ENV === "development") {
  for (const key of ["ACCESS_TOKEN_SECRET", "REFRESH_TOKEN_SECRET"]) {
    if (parsed.data[key].length < MIN_SECRET_LENGTH) {
      console.warn(`Warning: ${key} is shorter than ${MIN_SECRET_LENGTH} characters. Generate one with: openssl rand -hex 32`);
    }
  }
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean),
  isProduction: parsed.data.NODE_ENV === "production",
  isTest: parsed.data.NODE_ENV === "test",
};
