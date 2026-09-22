import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: __dirname,
  // 동적 파일 접근이 프로젝트 전체를 추적해도 개발 파일은 싣지 않는다.
  outputFileTracingExcludes: {
    "**/*": [
      "**/*.test.*",
      "**/*.spec.*",
      "**/__tests__/**",
      "./scripts/**",
      "./e2e/**",
      "./playwright*.config.*",
      "./tsconfig.tsbuildinfo",
      "./src/test-setup/**",
      "./.artifacts/**",
      "./test-results/**",
      "./docs/**",
      "./public/**",
      "./.superpowers/**",
      "./.claude/**",
      "./.codex/**",
      "./.agents/**",
      "./.gemini/**",
      "./.dryforge/**",
      "./AGENTS.md",
      "./CLAUDE.md",
      "./GEMINI.md",
    ],
  },
  devIndicators: false,
  // This repository is independent from any npm project above its root.
  turbopack: {
    root: __dirname,
  },
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
