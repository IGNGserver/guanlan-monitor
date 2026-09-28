import { readFileSync } from "node:fs";
import { join } from "node:path";

const releaseVersion = readFileSync(join(process.cwd(), "..", "..", "VERSION"), "utf8").trim();
const releaseChannel = process.env.DSC_RELEASE_CHANNEL === "stable" ? "stable" : "test";

/** @type {import("next").NextConfig} */
const nextConfig = {
  // Produce a self-contained server under .next/standalone so the deploy image
  // only ships the traced runtime instead of the whole workspace node_modules.
  output: "standalone",
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
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" }
        ]
      }
    ];
  },
  env: {
    NEXT_PUBLIC_DSC_VERSION: releaseVersion,
    NEXT_PUBLIC_DSC_RELEASE_CHANNEL: releaseChannel
  }
};

export default nextConfig;
