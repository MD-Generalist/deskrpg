import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  // Loopback-only second origin lets local QA use two independent login sessions.
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["ssh2"],
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
