import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// The integration tests attach to Freelens dev over CDP and drive one app, so
// they are not part of vitest.config.ts and run only via
// `pnpm test:integration`.
export default defineConfig(({ mode }) => ({
  test: {
    name: "integration",
    environment: "node",
    include: ["integration/__tests__/**/*.tests.ts"],
    // The model endpoint of the prompts, from the environment or a local
    // `.env`, which is git-ignored. Without them the prompts are skipped.
    env: loadEnv(mode, process.cwd(), "LLM_API_"),
    // One app, one session at a time: the sessions install the extension and
    // change its preferences.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
}));
