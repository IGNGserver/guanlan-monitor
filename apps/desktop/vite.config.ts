import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Split the renderer into stable vendor chunks.
 *
 * The renderer was one 966 kB chunk, so the engine had to parse and compile the
 * whole console — React, Carbon React, Carbon Charts and d3 — before the first
 * paint. Chunking does not reduce those bytes, but it lets the engine compile the
 * chunks in parallel and lets a change to application code leave the vendor
 * chunks (and any cache holding them) untouched.
 *
 * The split is deliberately coarse: one chunk per dependency family keeps the
 * module-init order obvious. The chart stack is separated from Carbon React
 * because it is the single largest contributor and the one most likely to change
 * on its own.
 *
 * `base: "./"` makes Vite emit relative chunk imports, so this keeps working from
 * the `file://` URL the packaged renderer loads from.
 */
function manualChunks(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;
  // The chart stack: @carbon/charts, @carbon/charts-react and their d3 deps.
  if (id.includes("@carbon/charts") || /[\\/]d3[\\/]|[\\/]d3-[a-z]/.test(id)) return "vendor-charts";
  // Carbon React, its styles/themes/icons packages, and the IBM Plex font metrics.
  if (id.includes("@carbon/") || id.includes("@ibm/") || id.includes("carbon-components")) return "vendor-carbon";
  // React itself, kept separate so an app-only change never invalidates it.
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
