// Settings for the test run. TEST_DATABASE_URL points at a database the suite may wipe freely.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://smartsac:smartsac@localhost:5432/smart_sac_test?schema=public";

export const testEnv = {
  NODE_ENV: "test",
  DATABASE_URL: TEST_DATABASE_URL,
  ACCESS_TOKEN_SECRET: "test-access-secret-that-is-long-enough",
  REFRESH_TOKEN_SECRET: "test-refresh-secret-that-is-long-enough",
  ACCESS_TOKEN_EXPIRY: "15m",
  REFRESH_TOKEN_EXPIRY: "1d",
  ADMIN_EMAILS: "desk@iiita.ac.in",
  APP_TIMEZONE: "Asia/Kolkata",
  CORS_ORIGIN: "http://localhost:5173",
  // No SMTP in tests: codes fall back to the (silent) log and are read from the database
  SMTP_HOST: "",
  EMAIL_USER: "",
  EMAIL_PASS: "",
  SPORTS_HEAD_EMAIL: "",
};
