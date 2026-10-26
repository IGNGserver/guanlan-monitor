import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WEB_PWA_REVISION } from "./pwa-build.mjs";
import { ICON_VERSION } from "./scripts/pwa-icons.mjs";

const releaseVersion = readFileSync(join(process.cwd(), "..", "..", "VERSION"), "utf8").trim();
const releaseChannel = process.env.DSC_RELEASE_CHANNEL === "stable" ? "stable" : "test";
const staticExport = process.env.DSC_STATIC_EXPORT === "true";

/** @type {import("next").NextConfig} */
const nextConfig = {
  // Docker serves a public export with nginx. Keep the standalone output for
  // existing next start / visual-test consumers outside the delivery image.
  output: staticExport ? "export" : "standalone",
  outputFileTracingRoot: join(process.cwd(), "..", ".."),
  // The workspace renders plain <img> assets only; Next image optimization
  // (and its ~16 MB sharp/libvips native payload) is never exercised.
  images: { unoptimized: true },
  // Drop build-only tooling and unused native image deps that Next traces into
  // the standalone runtime. This config is .mjs precisely so the runtime does
  // not need TypeScript to read it.
  outputFileTracingExcludes: {
    "*": [
      "**/node_modules/typescript/**",
      "**/node_modules/sass/**",
      "**/node_modules/caniuse-lite/**",
      "**/node_modules/sharp/**",
      "**/node_modules/@img/**"
    ]
  },
  typedRoutes: true,
  transpilePackages: ["@dsc/console-ui", "@dsc/shared"],
  // Export has no Next server: the delivery image owns these same headers.
  ...(!staticExport && { async headers() {
    return [
      {
        source: "/manifest.json",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          { key: "Cache-Control", value: "no-store, no-cache, max-age=0, must-revalidate" }
        ]
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Content-Type", value: "application/manifest+json" }, { key: "Cache-Control", value: "no-store, no-cache, max-age=0, must-revalidate" }]
      },
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://raw.githubusercontent.com; worker-src 'self'` },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" }
        ]
      },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-store, no-cache, max-age=0, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/" }] },
      { source: "/icons/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/pwa-assets.json", headers: [{ key: "Cache-Control", value: "no-store, no-cache, max-age=0, must-revalidate" }] }
    ];
  } }),
  env: {
    NEXT_PUBLIC_DSC_PWA_REVISION: WEB_PWA_REVISION,
    NEXT_PUBLIC_DSC_ICON_VERSION: ICON_VERSION,
    NEXT_PUBLIC_DSC_VERSION: releaseVersion,
    NEXT_PUBLIC_DSC_RELEASE_CHANNEL: releaseChannel
  }
};

export default nextConfig;
