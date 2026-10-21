import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules", "coverage"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_|^(req|res|next)$", caughtErrors: "none" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
    },
  },
  {
    // The seed script and config talk to a person at a terminal
    files: ["src/seed.js", "src/config/env.js"],
    rules: { "no-console": "off" },
  },
];
