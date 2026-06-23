import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  async rewrites() {
    const target = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://127.0.0.1:4000";
    return [
      {
        source: "/api/:path*",
        destination: `${target}/api/:path*`
      },
      {
        source: "/socket.io",
        destination: `${target}/socket.io`
      },
      {
        source: "/socket.io/:path*",
        destination: `${target}/socket.io/:path*`
      }
    ];
  }
};

export default nextConfig;
