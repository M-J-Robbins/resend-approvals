import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    // Real database round trips (and Neon cold starts) are slower than unit tests.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Suites share one database; run files one after another.
    fileParallelism: false,
  },
});
