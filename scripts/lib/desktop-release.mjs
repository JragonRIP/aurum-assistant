/**
 * Pure helpers for Aurum desktop release automation (no git side effects).
 */

export const DEFAULT_RELEASE_BRANCH = "main";
export const DESKTOP_PACKAGE_REL = "apps/desktop/package.json";
export const DESKTOP_WORKFLOW_REL = ".github/workflows/desktop-release.yml";

/** Strip leading `v` from a Git tag (e.g. v0.2.4 → 0.2.4). */
export function tagToVersion(tag) {
  const t = String(tag).trim();
  const m = /^v(\d+\.\d+\.\d+)$/.exec(t);
  return m ? m[1] : null;
}

/** True when tag version equals package.json version exactly. */
export function versionsMatch(tag, packageVersion) {
  const fromTag = tagToVersion(tag);
  if (!fromTag) return false;
  return fromTag === String(packageVersion).trim();
}

export function isValidReleaseSemver(version) {
  return /^\d+\.\d+\.\d+$/.test(String(version).trim());
}

export function bumpSemver(version, kind) {
  const raw = String(version).trim();
  if (!isValidReleaseSemver(raw)) {
    throw new Error(`Invalid semver: ${version}`);
  }
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(raw);
  let major = Number(m[1]);
  let minor = Number(m[2]);
  let patch = Number(m[3]);
  if (kind === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (kind === "minor") {
    minor += 1;
    patch = 0;
  } else if (kind === "patch") {
    patch += 1;
  } else {
    throw new Error(`Invalid bump kind: ${kind}`);
  }
  return `${major}.${minor}.${patch}`;
}

export function releaseArtifactNames(version) {
  return {
    installer: `Aurum-Setup-${version}.exe`,
    blockmap: `Aurum-Setup-${version}.exe.blockmap`,
    latestYml: "latest.yml",
  };
}

export function releaseCommitMessage(version) {
  return `chore(desktop): release ${version}`;
}

export function releaseTagName(version) {
  return `v${version}`;
}

export function releaseTagMessage(version) {
  return `Aurum desktop ${version}`;
}

export function assertWorkingTreeClean(statusPorcelain) {
  const text = String(statusPorcelain ?? "");
  if (text.trim().length > 0) {
    throw new Error(
      "Working tree is dirty. Commit or stash your changes before releasing.\n" +
        text.trim(),
    );
  }
}

export function assertExpectedBranch(
  branch,
  expected = DEFAULT_RELEASE_BRANCH,
) {
  const current = String(branch ?? "").trim();
  const want = String(expected ?? DEFAULT_RELEASE_BRANCH).trim();
  if (!current) {
    throw new Error("Could not determine current git branch.");
  }
  if (current !== want) {
    throw new Error(
      `Release must run on branch "${want}" (current: "${current}").`,
    );
  }
}

export function assertValidDesktopVersion(version) {
  if (!isValidReleaseSemver(version)) {
    throw new Error(
      `Desktop package version must be semver X.Y.Z (got "${version}").`,
    );
  }
}

export function assertWorkflowPresent(exists) {
  if (!exists) {
    throw new Error(
      `Missing ${DESKTOP_WORKFLOW_REL}. Desktop releases require GitHub Actions.`,
    );
  }
}

/**
 * @param {string} tag e.g. v0.2.4
 * @param {string[]} localTags
 * @param {string[]} remoteTags
 */
export function assertTagAvailable(tag, localTags, remoteTags) {
  const local = new Set((localTags ?? []).map(String));
  const remote = new Set((remoteTags ?? []).map(String));
  if (local.has(tag)) {
    throw new Error(`Tag ${tag} already exists locally.`);
  }
  if (remote.has(tag)) {
    throw new Error(`Tag ${tag} already exists on origin.`);
  }
}

export function nextReleaseVersions(current) {
  assertValidDesktopVersion(current);
  return {
    patch: bumpSemver(current, "patch"),
    minor: bumpSemver(current, "minor"),
    major: bumpSemver(current, "major"),
  };
}

/** Highest vX.Y.Z from a list of tag names (or null). */
export function latestDesktopTag(tags) {
  let best = null;
  let bestParts = null;
  for (const tag of tags ?? []) {
    const v = tagToVersion(tag);
    if (!v) continue;
    const parts = v.split(".").map(Number);
    if (
      !bestParts ||
      parts[0] > bestParts[0] ||
      (parts[0] === bestParts[0] && parts[1] > bestParts[1]) ||
      (parts[0] === bestParts[0] &&
        parts[1] === bestParts[1] &&
        parts[2] > bestParts[2])
    ) {
      best = `v${v}`;
      bestParts = parts;
    }
  }
  return best;
}

/**
 * Build a status snapshot object (no I/O).
 */
export function buildReleaseStatus(input) {
  const version = String(input.version ?? "");
  const branch = String(input.branch ?? "");
  const dirty = String(input.statusPorcelain ?? "").trim().length > 0;
  const next = isValidReleaseSemver(version)
    ? nextReleaseVersions(version)
    : null;
  return {
    version,
    branch,
    workingTree: dirty ? "dirty" : "clean",
    latestTag: latestDesktopTag(input.tags ?? []),
    next,
    workflowPresent: Boolean(input.workflowExists),
  };
}

export function formatReleaseStatus(status) {
  const lines = [
    `Desktop version: ${status.version || "(invalid)"}`,
    `Branch: ${status.branch || "(unknown)"}`,
    `Working tree: ${status.workingTree}`,
    `Latest desktop tag: ${status.latestTag ?? "(none)"}`,
    `Workflow (${DESKTOP_WORKFLOW_REL}): ${
      status.workflowPresent ? "yes" : "no"
    }`,
  ];
  if (status.next) {
    lines.push(`Next patch: ${status.next.patch}`);
    lines.push(`Next minor: ${status.next.minor}`);
    lines.push(`Next major: ${status.next.major}`);
  }
  return lines.join("\n");
}

/** Parse `git ls-remote --tags` lines into tag names (without refs/tags/). */
export function parseLsRemoteTags(output) {
  const tags = [];
  for (const line of String(output).split(/\r?\n/)) {
    const m = /\trefs\/tags\/([^\s^]+)$/.exec(line.trim());
    if (!m) continue;
    // Skip peeled ^{} entries
    if (m[1].endsWith("^{}")) continue;
    tags.push(m[1]);
  }
  return tags;
}
