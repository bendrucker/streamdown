import { defineConfig } from "tsup";

export default defineConfig({
  dts: true,
  entry: ["index.tsx"],
  format: ["esm"],
  minify: true,
  outDir: "dist",
  // Opt-in so profiling builds can attribute sampled frames to source.
  sourcemap: process.env.STREAMDOWN_SOURCEMAP === "1",
  external: ["react", "react-dom"],
  treeshake: true,
  splitting: true,
  platform: "browser",
});
