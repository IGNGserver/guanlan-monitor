import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Split the renderer into stable vendor chunks.
 *
 * The console no longer ships Carbon or d3: charts are drawn with SVG in
 * `@dsc/console-ui/src/m3e` + `workspace/charts.tsx`. What remains worth
 * splitting is React itself, so an application-only change never invalidates the
 * React chunk.
 *
 * `base: "./"` makes Vite emit relative chunk imports, so this keeps working from
 * the `file://` URL the packaged renderer loads from.
 */
function manualChunks(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;
  if (/[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "vendor-react";
  return "vendor";
}

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      output: { manualChunks }
    }
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: false
  }
});
