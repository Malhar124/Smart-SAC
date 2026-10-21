import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.js"],
    setupFiles: ["./tests/setup-env.js"],
    // Every file shares one test database, so run them one after another
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
