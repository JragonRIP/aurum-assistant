import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

async function main() {
  await build({
    configFile: path.join(root, "vite.config.ts"),
  });

  // Keep legacy static overlay files out of dist if any remain
  const dest = path.join(root, "dist", "renderer");
  if (!fs.existsSync(path.join(dest, "index.html"))) {
    throw new Error("Vite overlay build did not produce index.html");
  }
  console.log("Built overlay renderer to dist/renderer");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
