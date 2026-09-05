import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname, "src/overlay"),
  base: "./",
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@aurum\/ui$/,
        replacement: path.resolve(__dirname, "../../packages/ui/src/index.ts"),
      },
      {
        find: /^@aurum\/shared$/,
        replacement: path.resolve(
          __dirname,
          "../../packages/shared/src/index.ts",
        ),
      },
    ],
  },
  build: {
    outDir: path.resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    assetsDir: "assets",
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
