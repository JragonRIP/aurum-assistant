/**
 * Bump apps/desktop/package.json version. Never pushes. Never needs GH_TOKEN.
 *
 * Usage:
 *   node scripts/bump-desktop-version.mjs patch|minor|major [--git]
 *
 * --git  commit the version bump and create annotated tag vX.Y.Z (no push)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bumpSemver } from "./lib/desktop-release.mjs";

const kind = process.argv[2];
const withGit = process.argv.includes("--git");

if (!["patch", "minor", "major"].includes(kind)) {
  console.error(
    "Usage: node scripts/bump-desktop-version.mjs patch|minor|major [--git]",
  );
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = path.join(root, "apps", "desktop", "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const previous = pkg.version;
const next = bumpSemver(previous, kind);
pkg.version = next;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

console.log(`Bumped @aurum/desktop ${previous} → ${next}`);

if (withGit) {
  execFileSync("git", ["add", "apps/desktop/package.json"], {
    cwd: root,
    stdio: "inherit",
  });
  execFileSync(
    "git",
    ["commit", "-m", `chore(desktop): release ${next}`],
    { cwd: root, stdio: "inherit" },
  );
  execFileSync(
    "git",
    ["tag", "-a", `v${next}`, "-m", `Aurum desktop ${next}`],
    { cwd: root, stdio: "inherit" },
  );
  console.log(`Created commit + tag v${next}`);
  console.log("Push when ready (does not push automatically):");
  console.log(`  git push origin HEAD && git push origin v${next}`);
} else {
  console.log("Next steps (no auto-push):");
  console.log(`  1. Commit apps/desktop/package.json`);
  console.log(`  2. git tag -a v${next} -m "Aurum desktop ${next}"`);
  console.log(`  3. git push origin HEAD && git push origin v${next}`);
}
