import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const releaseVersion = readFileSync(join(process.cwd(), "..", "..", "VERSION"), "utf8").trim();

const nextConfig: NextConfig = {
  typedRoutes: true,
  env: {
    NEXT_PUBLIC_DSC_VERSION: releaseVersion
  }
};

export default nextConfig;
