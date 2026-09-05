/**
 * Full Aurum desktop release: bump → validate → commit → tag → push.
 *
 * Usage:
 *   node scripts/release-desktop.mjs patch|minor|major
 *   node scripts/release-desktop.mjs status
 *
 * Never uses GH_TOKEN. Never force-pushes. Never git reset --hard.
 * Installer publishing stays on GitHub Actions after the tag push.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_RELEASE_BRANCH,
  DESKTOP_PACKAGE_REL,
  DESKTOP_WORKFLOW_REL,
  assertExpectedBranch,
  assertTagAvailable,
  assertValidDesktopVersion,
  assertWorkflowPresent,
  assertWorkingTreeClean,
  buildReleaseStatus,
  bumpSemver,
  formatReleaseStatus,
  parseLsRemoteTags,
  releaseCommitMessage,
  releaseTagMessage,
  releaseTagName,
} from "./lib/desktop-release.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = path.join(root, DESKTOP_PACKAGE_REL);
const workflowPath = path.join(root, DESKTOP_WORKFLOW_REL);
const mode = process.argv[2];

function git(args, opts = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: opts.stdio ?? ["ignore", "pipe", "pipe"],
    ...opts,
  });
}

function gitOk(args) {
  try {
    return git(args).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stderr = err && err.stderr ? String(err.stderr) : "";
    throw new Error(`git ${args.join(" ")} failed:\n${stderr || msg}`);
  }
}

function runNpm(args) {
  const result = spawnSync("npm", args, {
    cwd: root,
    encoding: "utf8",
    shell: true,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(" ")} failed (exit ${result.status})`);
  }
}

function readDesktopPackage() {
  return JSON.parse(fs.readFileSync(pkgPath, "utf8"));
}

function writeDesktopVersion(pkg, version) {
  const next = { ...pkg, version };
  fs.writeFileSync(pkgPath, JSON.stringify(next, null, 2) + "\n");
}

function restorePackageFile(previousContents) {
  fs.writeFileSync(pkgPath, previousContents);
}

function ensureOrigin() {
  let remotes;
  try {
    remotes = gitOk(["remote"]);
  } catch {
    throw new Error("Could not list git remotes.");
  }
  if (!remotes.split(/\r?\n/).includes("origin")) {
    throw new Error('Remote "origin" is not configured.');
  }
}

function localTags() {
  const out = gitOk(["tag", "-l"]);
  return out ? out.split(/\r?\n/).filter(Boolean) : [];
}

function remoteTags() {
  const out = gitOk(["ls-remote", "--tags", "origin"]);
  return parseLsRemoteTags(out);
}

function printStatus() {
  const pkg = readDesktopPackage();
  const branch = gitOk(["rev-parse", "--abbrev-ref", "HEAD"]);
  const porcelain = git(["status", "--porcelain"]);
  let tags = localTags();
  try {
    tags = [...new Set([...tags, ...remoteTags()])];
  } catch {
    // status may run offline — local tags still useful
  }
  const status = buildReleaseStatus({
    version: pkg.version,
    branch,
    statusPorcelain: porcelain,
    tags,
    workflowExists: fs.existsSync(workflowPath),
  });
  console.log(formatReleaseStatus(status));
}

function preflight(nextVersion) {
  ensureOrigin();
  const branch = gitOk(["rev-parse", "--abbrev-ref", "HEAD"]);
  assertExpectedBranch(
    branch,
    process.env.AURUM_RELEASE_BRANCH || DEFAULT_RELEASE_BRANCH,
  );
  assertWorkingTreeClean(git(["status", "--porcelain"]));
  assertWorkflowPresent(fs.existsSync(workflowPath));

  const pkg = readDesktopPackage();
  assertValidDesktopVersion(pkg.version);
  assertValidDesktopVersion(nextVersion);

  console.log("Fetching tags from origin…");
  try {
    gitOk(["fetch", "origin", "--tags", "--prune"]);
  } catch (err) {
    throw new Error(
      `Failed to fetch tags from origin.\n${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const tag = releaseTagName(nextVersion);
  assertTagAvailable(tag, localTags(), remoteTags());
}

function runNode(scriptRel, args = []) {
  const result = spawnSync(
    process.execPath,
    [path.join(root, scriptRel), ...args],
    {
      cwd: root,
      encoding: "utf8",
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `node ${scriptRel} ${args.join(" ")} failed (exit ${result.status})`,
    );
  }
}

function runValidations(nextVersion) {
  console.log("Running release helper tests…");
  runNpm(["run", "test:release-helpers"]);
  console.log("Running desktop typecheck…");
  runNpm(["run", "typecheck", "--workspace=@aurum/desktop"]);
  console.log("Running desktop tests…");
  runNpm(["run", "test", "--workspace=@aurum/desktop"]);
  console.log("Asserting tag/version match…");
  runNode("scripts/assert-desktop-tag-version.mjs", [
    releaseTagName(nextVersion),
  ]);
}

function release(kind) {
  const previousContents = fs.readFileSync(pkgPath, "utf8");
  const pkg = readDesktopPackage();
  assertValidDesktopVersion(pkg.version);
  const previous = pkg.version;
  const next = bumpSemver(previous, kind);
  const tag = releaseTagName(next);

  console.log(`Preparing desktop release ${previous} → ${next} (${kind})`);
  preflight(next);

  writeDesktopVersion(pkg, next);
  console.log(`Updated ${DESKTOP_PACKAGE_REL} → ${next}`);

  try {
    runValidations(next);
  } catch (err) {
    restorePackageFile(previousContents);
    console.error(
      "Validation failed. Restored apps/desktop/package.json only.",
    );
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const commitMsg = releaseCommitMessage(next);
  try {
    gitOk(["add", DESKTOP_PACKAGE_REL]);
    execFileSync("git", ["commit", "-m", commitMsg], {
      cwd: root,
      stdio: "inherit",
    });
  } catch (err) {
    restorePackageFile(previousContents);
    try {
      gitOk(["restore", "--staged", DESKTOP_PACKAGE_REL]);
    } catch {
      // ignore — may already be unstaged
    }
    console.error("Commit failed. Restored apps/desktop/package.json only.");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  try {
    execFileSync(
      "git",
      ["tag", "-a", tag, "-m", releaseTagMessage(next)],
      { cwd: root, stdio: "inherit" },
    );
  } catch (err) {
    console.error(
      `Commit succeeded but creating tag ${tag} failed. Tag was not pushed.`,
    );
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  try {
    execFileSync("git", ["push", "origin", "HEAD"], {
      cwd: root,
      stdio: "inherit",
    });
  } catch (err) {
    console.error(
      "Commit push failed. Tag exists only locally and was NOT pushed.",
    );
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  try {
    execFileSync("git", ["push", "origin", tag], {
      cwd: root,
      stdio: "inherit",
    });
  } catch (err) {
    console.error(
      `Commit is on origin, but tag ${tag} failed to push.`,
    );
    console.error(
      "GitHub Actions will not start until the tag exists on origin.",
    );
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log("");
  console.log(`Release triggered: ${tag}`);
  console.log("Check: GitHub → Actions → Desktop Release");
  console.log(
    "After the workflow finishes, installed Aurum can auto-update from the new GitHub Release.",
  );
}

if (mode === "status") {
  try {
    printStatus();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
} else if (mode === "patch" || mode === "minor" || mode === "major") {
  try {
    release(mode);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
} else {
  console.error(
    "Usage: node scripts/release-desktop.mjs patch|minor|major|status",
  );
  process.exit(1);
}
