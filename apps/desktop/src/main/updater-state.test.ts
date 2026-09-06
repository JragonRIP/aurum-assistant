import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createInitialUpdaterState,
  isNewerVersion,
  parseSemver,
  updaterStatusLabel,
} from "./updater-state";
import { buildTrayUpdateMenu } from "./updater-tray";

describe("parseSemver / isNewerVersion", () => {
  it("parses versions", () => {
    assert.deepEqual(parseSemver("0.2.1"), [0, 2, 1]);
    assert.deepEqual(parseSemver("v1.0.0"), [1, 0, 0]);
    assert.equal(parseSemver("nope"), null);
  });

  it("only treats strictly newer versions as updates", () => {
    assert.equal(isNewerVersion("0.2.1", "0.2.0"), true);
    assert.equal(isNewerVersion("0.2.0", "0.2.0"), false);
    assert.equal(isNewerVersion("0.1.9", "0.2.0"), false);
    assert.equal(isNewerVersion("1.0.0", "0.9.9"), true);
  });
});

describe("updater state machine labels", () => {
  it("disabled in non-packaged / initial disabled state", () => {
    const s = createInitialUpdaterState("0.2.1", false);
    assert.equal(s.status, "disabled");
    assert.equal(s.enabled, false);
    assert.equal(updaterStatusLabel(s), "Updates unavailable in development");
  });

  it("labels update available / downloading / downloaded", () => {
    assert.match(
      updaterStatusLabel({
        status: "update_available",
        currentVersion: "0.2.0",
        latestVersion: "0.2.1",
        progressPercent: null,
        errorMessage: null,
        enabled: true,
      }),
      /0\.2\.1/,
    );
    assert.match(
      updaterStatusLabel({
        status: "downloading",
        currentVersion: "0.2.0",
        latestVersion: "0.2.1",
        progressPercent: 42,
        errorMessage: null,
        enabled: true,
      }),
      /42%/,
    );
    assert.match(
      updaterStatusLabel({
        status: "downloaded",
        currentVersion: "0.2.0",
        latestVersion: "0.2.1",
        progressPercent: 100,
        errorMessage: null,
        enabled: true,
      }),
      /Update ready/,
    );
  });

  it("error state surfaces sanitized message", () => {
    const label = updaterStatusLabel({
      status: "error",
      currentVersion: "0.2.1",
      latestVersion: null,
      progressPercent: null,
      errorMessage: "network failed",
      enabled: true,
    });
    assert.match(label, /network failed/);
  });
});

describe("updater security contracts", () => {
  it("does not expose arbitrary updater URL configuration in state", () => {
    const s = createInitialUpdaterState("0.2.1", true);
    assert.equal("feedURL" in s, false);
    assert.equal("url" in s, false);
    assert.equal("provider" in s, false);
  });
});

describe("tray update menu", () => {
  it("shows check action when idle", () => {
    const m = buildTrayUpdateMenu(
      createInitialUpdaterState("0.2.1", true),
    );
    assert.equal(m.primaryAction, "check");
    assert.equal(m.primaryLabel, "Check for Updates");
  });

  it("switches to restart when downloaded", () => {
    const m = buildTrayUpdateMenu({
      status: "downloaded",
      currentVersion: "0.2.0",
      latestVersion: "0.2.1",
      progressPercent: 100,
      errorMessage: null,
      enabled: true,
    });
    assert.equal(m.primaryAction, "install");
    assert.equal(m.primaryLabel, "Restart to Update Aurum Console");
    assert.match(m.statusLabel, /Update ready/);
  });
});
