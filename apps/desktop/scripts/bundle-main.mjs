/**
 * Bundle Electron main + preload with workspace packages inlined.
 *
 * tsc leaves `require("@aurum/shared")` as an external lookup. Packaged
 * app-dist does not ship workspace packages, so the main process must
 * bundle @aurum/* into the distributable.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import esbuild from "esbuild";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MAIN_EXTERNALS = [
  "electron",
  "electron-updater",
  "koffi",
  "loudness",
];

const WORKSPACE_REQUIRE_RE = /require\(["'](@aurum\/[^"']+)["']\)/g;

function assertNoWorkspaceRequires(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const found = new Set();
  for (const match of src.matchAll(WORKSPACE_REQUIRE_RE)) {
    found.add(match[1]);
  }
  // Also catch ESM-style leftovers
  const importRe = /from\s+["'](@aurum\/[^"']+)["']/g;
  for (const match of src.matchAll(importRe)) {
    found.add(match[1]);
  }
  if (found.size > 0) {
    throw new Error(
      `${path.relative(root, filePath)} still references workspace packages: ${[
        ...found,
      ].join(", ")}`,
    );
  }
}

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

async function main() {
  // Ensure esbuild resolves workspace packages from the monorepo root.
  require.resolve("@aurum/shared");

  resetDir(path.join(root, "dist", "main"));
  resetDir(path.join(root, "dist", "preload"));

  await esbuild.build({
    entryPoints: [path.join(root, "src", "main", "index.ts")],
    outfile: path.join(root, "dist", "main", "index.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: MAIN_EXTERNALS,
    sourcemap: false,
    logLevel: "info",
  });

  await esbuild.build({
    entryPoints: [path.join(root, "src", "preload", "index.ts")],
    outfile: path.join(root, "dist", "preload", "index.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["electron"],
    sourcemap: false,
    logLevel: "info",
  });

  assertNoWorkspaceRequires(path.join(root, "dist", "main", "index.js"));
  assertNoWorkspaceRequires(path.join(root, "dist", "preload", "index.js"));

  console.log("Bundled Electron main + preload (workspace packages inlined)");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
