import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_AURUM_WEB_URL } from "./config-url";
import {
  AURUM_AUTOSTART_FLAG,
  UPDATER_IPC_CHANNELS,
  isAutostartLaunch,
  mainWindowEntryUrl,
  resolveHotkeyAction,
  resolveSecondInstanceAction,
  resolveStartupWindowAction,
  resolveTrayOpenAurumAction,
  resolveTrayShowOverlayAction,
} from "./launch-behavior";

describe("manual launch opens main window", () => {
  it("normal argv → show-main", () => {
    assert.equal(
      resolveStartupWindowAction({ argv: ["Aurum.exe"] }),
      "show-main",
    );
  });
});

describe("Ctrl+Space opens overlay", () => {
  it("hotkey action is overlay-only", () => {
    assert.equal(resolveHotkeyAction(), "show-overlay");
  });
});

describe("normal launch does not open overlay", () => {
  it("startup never resolves to overlay", () => {
    const action = resolveStartupWindowAction({ argv: ["Aurum.exe"] });
    assert.notEqual(action as string, "show-overlay");
    assert.equal(action, "show-main");
  });

  it("autostart is tray-only, still not overlay", () => {
    assert.equal(
      resolveStartupWindowAction({
        argv: ["Aurum.exe", AURUM_AUTOSTART_FLAG],
      }),
      "tray-only",
    );
  });
});

describe("second-instance normal launch restores main window", () => {
  it("always show-main", () => {
    assert.equal(resolveSecondInstanceAction(), "show-main");
  });
});

describe("tray Open Aurum / Show Overlay", () => {
  it("Open Aurum → main", () => {
    assert.equal(resolveTrayOpenAurumAction(), "show-main");
  });
  it("Show Overlay → overlay", () => {
    assert.equal(resolveTrayShowOverlayAction(), "show-overlay");
  });
});

describe("updater IPC remains functional", () => {
  it("exposes only narrow updater channels", () => {
    assert.deepEqual([...UPDATER_IPC_CHANNELS], [
      "aurum:updater-get-state",
      "aurum:updater-check",
      "aurum:updater-install",
    ]);
    assert.equal(
      UPDATER_IPC_CHANNELS.some((c) => c.includes("url") || c.includes("feed")),
      false,
    );
  });
});

describe("production URL used in packaged build", () => {
  it("main window entry uses production origin by default", () => {
    assert.equal(
      mainWindowEntryUrl(DEFAULT_AURUM_WEB_URL),
      `${DEFAULT_AURUM_WEB_URL}/core`,
    );
  });
});

describe("single-instance / autostart detection", () => {
  it("detects autostart flag and wasOpenedAtLogin", () => {
    assert.equal(isAutostartLaunch(["Aurum.exe"]), false);
    assert.equal(
      isAutostartLaunch(["Aurum.exe", AURUM_AUTOSTART_FLAG]),
      true,
    );
    assert.equal(isAutostartLaunch(["Aurum.exe"], true), true);
  });
});
