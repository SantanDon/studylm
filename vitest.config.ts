import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/vitest.setup.ts"],
    testTimeout: 30000,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "src/__tests__/integration/repositories.test.ts",
    ],
  },
});
