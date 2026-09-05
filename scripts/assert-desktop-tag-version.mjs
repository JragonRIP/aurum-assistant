/**
 * Fail CI if the Git tag does not match apps/desktop/package.json version.
 * Usage: node scripts/assert-desktop-tag-version.mjs v0.2.4
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tagToVersion, versionsMatch } from "./lib/desktop-release.mjs";

const tag = process.argv[2] || process.env.GITHUB_REF_NAME || "";
if (!tag) {
  console.error("Usage: node scripts/assert-desktop-tag-version.mjs vX.Y.Z");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = path.join(root, "apps", "desktop", "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const packageVersion = pkg.version;

if (!tagToVersion(tag)) {
  console.error(
    `Invalid desktop release tag "${tag}". Expected vX.Y.Z (e.g. v0.2.4).`,
  );
  process.exit(1);
}

if (!versionsMatch(tag, packageVersion)) {
  console.error(
    `Version mismatch: tag ${tag} ≠ apps/desktop/package.json "${packageVersion}".`,
  );
  console.error("Bump package.json to match the tag (or retag) before releasing.");
  process.exit(1);
}

console.log(`OK: tag ${tag} matches desktop package version ${packageVersion}`);
