/**
 * Stage packaged app contents into app-dist/ (not gitignored).
 * electron-builder excludes gitignored paths like dist/, so we copy explicitly.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const stage = path.join(root, "app-dist");

if (!fs.existsSync(path.join(dist, "main", "index.js"))) {
  console.error("Missing dist/main/index.js — run build first");
  process.exit(1);
}
if (!fs.existsSync(path.join(dist, "renderer", "index.html"))) {
  console.error("Missing dist/renderer/index.html — run build first");
  process.exit(1);
}
if (!fs.existsSync(path.join(dist, "preload", "index.js"))) {
  console.error("Missing dist/preload/index.js — run build first");
  process.exit(1);
}

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.cpSync(dist, path.join(stage, "dist"), { recursive: true });

// Drop source maps from the shipped package
for (const file of fs.readdirSync(path.join(stage, "dist"), {
  recursive: true,
})) {
  const full = path.join(stage, "dist", String(file));
  if (full.endsWith(".map") && fs.statSync(full).isFile()) {
    fs.unlinkSync(full);
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const stagedPkg = {
  name: "aurum",
  version: pkg.version,
  description: pkg.description,
  author: pkg.author ?? "Aurum",
  private: true,
  main: "dist/main/index.js",
  repository: pkg.repository ?? {
    type: "git",
    url: "https://github.com/JragonRIP/aurum-assistant.git",
  },
  dependencies: {
    zod: pkg.dependencies.zod,
    "electron-updater": pkg.dependencies["electron-updater"],
  },
};
fs.writeFileSync(
  path.join(stage, "package.json"),
  JSON.stringify(stagedPkg, null, 2) + "\n",
);

console.log("Staged packaged app at app-dist/");
