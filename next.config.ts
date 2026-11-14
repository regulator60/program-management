import type { NextConfig } from "next";

// Set PAGES_BASE_PATH (e.g. "/program-management") only when building the static GitHub Pages demo.
const basePath = process.env.PAGES_BASE_PATH || "";

const nextConfig: NextConfig = {
  basePath: basePath || undefined,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
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
