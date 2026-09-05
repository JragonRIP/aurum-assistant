import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const src = path.join(root, "src", "renderer");
const dest = path.join(root, "dist", "renderer");

fs.mkdirSync(dest, { recursive: true });
for (const file of fs.readdirSync(src)) {
  if (file.endsWith(".d.ts")) continue;
  fs.copyFileSync(path.join(src, file), path.join(dest, file));
}
console.log("Copied renderer assets to dist/renderer");
