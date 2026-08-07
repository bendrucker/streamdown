import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ["shiki"],

  devIndicators: false,

  // Keeps React's Profiler and readable component names in production builds so
  // `/bench` measures optimized code without losing render attribution.
  reactProductionProfiling: true,

  // Source maps let scripts/analyze-trace.mjs attribute sampled frames to the
  // originating package instead of a minified chunk name.
  productionBrowserSourceMaps: true,
};

export default nextConfig;
