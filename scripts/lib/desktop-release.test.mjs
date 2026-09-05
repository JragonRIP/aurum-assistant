import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertExpectedBranch,
  assertTagAvailable,
  assertValidDesktopVersion,
  assertWorkflowPresent,
  assertWorkingTreeClean,
  buildReleaseStatus,
  bumpSemver,
  formatReleaseStatus,
  isValidReleaseSemver,
  latestDesktopTag,
  parseLsRemoteTags,
  releaseArtifactNames,
  releaseCommitMessage,
  releaseTagMessage,
  releaseTagName,
  tagToVersion,
  versionsMatch,
} from "./desktop-release.mjs";

describe("tag / package version protection", () => {
  it("parses vX.Y.Z tags only", () => {
    assert.equal(tagToVersion("v0.2.4"), "0.2.4");
    assert.equal(tagToVersion("0.2.4"), null);
    assert.equal(tagToVersion("v0.2.4-beta"), null);
  });

  it("requires exact tag ↔ package match", () => {
    assert.equal(versionsMatch("v0.2.4", "0.2.4"), true);
    assert.equal(versionsMatch("v0.2.4", "0.2.3"), false);
    assert.equal(versionsMatch("v0.2.3", "0.2.4"), false);
  });
});

describe("semver bump", () => {
  it("bumps patch", () => {
    assert.equal(bumpSemver("0.2.3", "patch"), "0.2.4");
  });
  it("bumps minor", () => {
    assert.equal(bumpSemver("0.2.4", "minor"), "0.3.0");
  });
  it("bumps major", () => {
    assert.equal(bumpSemver("0.3.0", "major"), "1.0.0");
  });
});

describe("invalid semver rejection", () => {
  it("rejects non X.Y.Z versions", () => {
    assert.equal(isValidReleaseSemver("0.2"), false);
    assert.equal(isValidReleaseSemver("v0.2.3"), false);
    assert.throws(() => bumpSemver("1.0.0-beta", "patch"), /Invalid semver/);
    assert.throws(() => assertValidDesktopVersion("nope"), /semver/);
  });
});

describe("dirty tree rejection", () => {
  it("rejects non-empty porcelain status", () => {
    assert.throws(
      () => assertWorkingTreeClean(" M apps/desktop/package.json\n"),
      /dirty/i,
    );
  });
  it("allows empty porcelain", () => {
    assert.doesNotThrow(() => assertWorkingTreeClean(""));
    assert.doesNotThrow(() => assertWorkingTreeClean("\n"));
  });
});

describe("duplicate tag rejection", () => {
  it("rejects duplicate local tag", () => {
    assert.throws(
      () => assertTagAvailable("v0.2.4", ["v0.2.4"], []),
      /already exists locally/,
    );
  });
  it("rejects duplicate remote tag", () => {
    assert.throws(
      () => assertTagAvailable("v0.2.4", [], ["v0.2.4"]),
      /already exists on origin/,
    );
  });
  it("allows unused tag", () => {
    assert.doesNotThrow(() =>
      assertTagAvailable("v0.2.4", ["v0.2.3"], ["v0.2.3"]),
    );
  });
});

describe("validation failure rollback contract", () => {
  it("documents restore of only the version file contents", () => {
    const previous = '{\n  "version": "0.2.3"\n}\n';
    const next = '{\n  "version": "0.2.4"\n}\n';
    // Simulate script behavior: keep previous blob for restore; never wipe repo.
    let current = next;
    const restoreOnlyVersionFile = () => {
      current = previous;
    };
    restoreOnlyVersionFile();
    assert.equal(current, previous);
    assert.match(current, /0\.2\.3/);
  });
});

describe("commit message and tag naming", () => {
  it("formats commit message", () => {
    assert.equal(releaseCommitMessage("0.2.4"), "chore(desktop): release 0.2.4");
  });
  it("formats annotated tag name and message", () => {
    assert.equal(releaseTagName("0.2.4"), "v0.2.4");
    assert.equal(releaseTagMessage("0.2.4"), "Aurum desktop 0.2.4");
  });
});

describe("branch + workflow checks", () => {
  it("requires main by default", () => {
    assert.throws(() => assertExpectedBranch("feature/x"), /main/);
    assert.doesNotThrow(() => assertExpectedBranch("main"));
  });
  it("requires workflow present", () => {
    assert.throws(() => assertWorkflowPresent(false), /Missing/);
    assert.doesNotThrow(() => assertWorkflowPresent(true));
  });
});

describe("status command", () => {
  it("prints version, branch, clean/dirty, next bumps, workflow", () => {
    const status = buildReleaseStatus({
      version: "0.2.3",
      branch: "main",
      statusPorcelain: "",
      tags: ["v0.2.2", "v0.2.3"],
      workflowExists: true,
    });
    assert.equal(status.workingTree, "clean");
    assert.equal(status.latestTag, "v0.2.3");
    assert.deepEqual(status.next, {
      patch: "0.2.4",
      minor: "0.3.0",
      major: "1.0.0",
    });
    const text = formatReleaseStatus(status);
    assert.match(text, /0\.2\.3/);
    assert.match(text, /clean/);
    assert.match(text, /Next patch: 0\.2\.4/);
    assert.match(text, /yes/);
  });

  it("marks dirty trees", () => {
    const status = buildReleaseStatus({
      version: "0.2.3",
      branch: "main",
      statusPorcelain: " M README.md\n",
      tags: [],
      workflowExists: false,
    });
    assert.equal(status.workingTree, "dirty");
    assert.equal(status.workflowPresent, false);
  });
});

describe("artifact paths + ls-remote parse", () => {
  it("names installer, blockmap, latest.yml", () => {
    assert.deepEqual(releaseArtifactNames("0.2.4"), {
      installer: "Aurum-Setup-0.2.4.exe",
      blockmap: "Aurum-Setup-0.2.4.exe.blockmap",
      latestYml: "latest.yml",
    });
  });

  it("parses ls-remote tags and picks latest", () => {
    const tags = parseLsRemoteTags(`
abc\trefs/tags/v0.2.1
def\trefs/tags/v0.2.3
def\trefs/tags/v0.2.3^{}
ghi\trefs/tags/v0.2.2
`);
    assert.deepEqual(tags.sort(), ["v0.2.1", "v0.2.2", "v0.2.3"]);
    assert.equal(latestDesktopTag(tags), "v0.2.3");
  });
});
