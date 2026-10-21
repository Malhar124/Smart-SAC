import { testEnv } from "./test-env.js";

// Runs before each test file's imports, so config/env.js validates these values
Object.assign(process.env, testEnv);
