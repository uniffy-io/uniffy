import { defineConfig } from "vitest/config";

// Mirrors the tsconfig paths: vitest resolves imports itself, not through Metro.
const dir = (path: string) => new URL(path, import.meta.url).pathname;

export default defineConfig({
  resolve: {
    alias: {
      "@app": dir("./src/app"),
      "@features": dir("./src/features"),
      "@shared": dir("./src/shared"),
      "@core": dir("./src/core"),
      "@theme": dir("./src/theme"),
      "@uniffy/proto": dir("../proto/gen/typescript"),
      "@": dir("./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
