import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Hidden features are still tested: every test sees them switched on, and tests/domain/flags.test.ts checks the switch.
    env: { MORE_SHOW: "all" },
  },
});
