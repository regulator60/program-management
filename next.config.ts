import type { NextConfig } from "next";

// Set PAGES_BASE_PATH (e.g. "/program-management") only when building the static GitHub Pages demo.
const basePath = process.env.PAGES_BASE_PATH || "";

const nextConfig: NextConfig = {
  basePath: basePath || undefined,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    // Set by scripts/desktop-runner.mjs so the sidebar shows which commit is running.
    NEXT_PUBLIC_BUILD_SHA: (process.env.GIT_SHA ?? "").slice(0, 7),
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
