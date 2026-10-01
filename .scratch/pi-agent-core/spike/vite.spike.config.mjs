// Same CJS library settings as the `main` section of electron.vite.config.js,
// pointed at the spike entry. Build with:
//   pnpm exec vite build -c .scratch/pi-agent-core/spike/vite.spike.config.mjs
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const runtimeExternals = ["electron", /^electron\//, ...builtinModules, ...builtinModules.map((m) => `node:${m}`)];
const preserveModules = (process.env.VITE_PRESERVE_MODULES ?? "true") === "true";

export default defineConfig({
  build: {
    target: "node22",
    ssr: true,
    lib: {
      entry: resolve(import.meta.dirname, "pi-spike.ts"),
      formats: ["cjs"],
    },
    outDir: resolve(import.meta.dirname, "out"),
    emptyOutDir: true,
    minify: false,
    rolldownOptions: {
      external: runtimeExternals,
      output: {
        exports: "named",
        preserveModules,
        preserveModulesRoot: import.meta.dirname,
      },
    },
  },
  ssr: { noExternal: true },
});
