import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Tests puros para módulos sin side effects: el adapter de Meta, el merge
 * manual-vs-API de daily, etc. NO corre tests contra DB o navegador — esos
 * casos los cubrimos via smoke test (pgTAP) o validación manual.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Next.js inyecta `server-only` virtual; en vitest (node puro) hay que
      // mapearlo a un módulo vacío para que `import "server-only"` no falle.
      "server-only": path.resolve(__dirname, "./src/lib/test-shims/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Carpetas con fixtures JSON dentro de src no son tests — solo asegurar
    // que el glob `*.test.ts` las ignora (lo hace por sí solo, pero
    // documentamos).
  },
});
