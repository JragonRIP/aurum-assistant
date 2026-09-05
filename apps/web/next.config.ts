import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.AURUM_NEXT_DIST_DIR || ".next",
  transpilePackages: [
    "@aurum/shared",
    "@aurum/ui",
    "@aurum/database",
    "@aurum/ai",
    "@aurum/tools",
  ],
};

export default nextConfig;
