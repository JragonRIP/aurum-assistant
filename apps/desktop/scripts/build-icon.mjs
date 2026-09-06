/**
 * Resize apps/desktop/build/icon.png → multi-size PNGs + icon.ico.
 * Requires sharp + png-to-ico (dev one-shot; not a package dependency).
 *
 * Usage (from a dir with those deps, or after: npm i -D sharp png-to-ico):
 *   node apps/desktop/scripts/build-icon.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "build",
);
const src = path.join(root, "icon.png");

if (!fs.existsSync(src)) {
  console.error(`Missing master PNG: ${src}`);
  process.exit(1);
}

async function loadDeps() {
  const require = createRequire(import.meta.url);
  const candidates = [
    path.join(process.env.TEMP || "/tmp", "aurum-icon-build"),
    root,
    path.resolve(root, "../.."),
    path.resolve(root, "../../.."),
  ];
  for (const base of candidates) {
    try {
      const sharp = require(path.join(base, "node_modules", "sharp"));
      const pngToIco = require(path.join(base, "node_modules", "png-to-ico"));
      return { sharp, pngToIco: pngToIco.default ?? pngToIco };
    } catch {
      /* try next */
    }
  }
  throw new Error(
    "Install sharp and png-to-ico (e.g. in %TEMP%/aurum-icon-build) then re-run.",
  );
}

const { sharp, pngToIco } = await loadDeps();
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const buffers = [];

for (const size of sizes) {
  const out = path.join(root, `icon-${size}.png`);
  const buf = await sharp(src)
    .resize(size, size, { fit: "cover", kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  fs.writeFileSync(out, buf);
  if (icoSizes.includes(size)) buffers.push(buf);
  console.log(`wrote ${path.basename(out)} (${buf.length} bytes)`);
}

fs.copyFileSync(path.join(root, "icon-16.png"), path.join(root, "tray-16.png"));
fs.copyFileSync(path.join(root, "icon-32.png"), path.join(root, "tray-32.png"));

const ico = await pngToIco(buffers);
fs.writeFileSync(path.join(root, "icon.ico"), ico);
console.log(`wrote icon.ico (${ico.length} bytes)`);
