/**
 * Fail if electron-builder release artifacts are missing.
 * Usage: node scripts/verify-desktop-release-artifacts.mjs [version]
 * Version defaults to apps/desktop/package.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { releaseArtifactNames } from "./lib/desktop-release.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = path.join(root, "apps", "desktop", "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const version = process.argv[2] || pkg.version;
const releaseDir = path.join(root, "apps", "desktop", "release");
const names = releaseArtifactNames(version);

const missing = [];
for (const name of [names.installer, names.blockmap, names.latestYml]) {
  const full = path.join(releaseDir, name);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    missing.push(name);
  }
}

if (missing.length) {
  console.error(`Missing release artifacts for ${version} in ${releaseDir}:`);
  for (const name of missing) console.error(`  - ${name}`);
  process.exit(1);
}

console.log(`OK: release artifacts present for ${version}`);
for (const name of [names.installer, names.blockmap, names.latestYml]) {
  const full = path.join(releaseDir, name);
  console.log(`  ${name} (${fs.statSync(full).size} bytes)`);
}
