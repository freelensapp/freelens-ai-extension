import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests live next to the code they cover as *.test.ts files.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
