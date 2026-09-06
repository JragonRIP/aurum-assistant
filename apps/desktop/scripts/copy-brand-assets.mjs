/**
 * Copy Windows brand assets into dist/assets for BrowserWindow / Tray at runtime.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(root, "build");
const dest = path.join(root, "dist", "assets");

const files = ["icon.ico", "icon.png", "tray-16.png", "tray-32.png"];

if (!fs.existsSync(path.join(buildDir, "icon.ico"))) {
  console.error("Missing build/icon.ico — place Aurum Console icon assets first");
  process.exit(1);
}

fs.mkdirSync(dest, { recursive: true });
for (const name of files) {
  const from = path.join(buildDir, name);
  if (!fs.existsSync(from)) {
    console.error(`Missing brand asset: ${from}`);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(dest, name));
}
console.log(`Copied brand assets → ${dest}`);
