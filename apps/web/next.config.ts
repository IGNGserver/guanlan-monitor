import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const releaseVersion = readFileSync(join(process.cwd(), "..", "..", "VERSION"), "utf8").trim();
const releaseChannel = process.env.DSC_RELEASE_CHANNEL === "stable" ? "stable" : "test";

const nextConfig: NextConfig = {
  typedRoutes: true,
  env: {
    NEXT_PUBLIC_DSC_VERSION: releaseVersion,
    NEXT_PUBLIC_DSC_RELEASE_CHANNEL: releaseChannel
  }
};

export default nextConfig;
