import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyVolumeDelta,
  clampVolumePercent,
  looksLikeShellLeak,
  sanitizeDeviceErrorMessage,
  sanitizeWindowsToolError,
  WindowsAudioError,
} from "./windows-audio";

const here = dirname(fileURLToPath(import.meta.url));

describe("Windows volume math", () => {
  it("get/set absolute clamp 0–100", () => {
    assert.equal(clampVolumePercent(-5), 0);
    assert.equal(clampVolumePercent(0), 0);
    assert.equal(clampVolumePercent(30), 30);
    assert.equal(clampVolumePercent(100), 100);
    assert.equal(clampVolumePercent(140), 100);
  });

  it("relative volume up/down with clamp", () => {
    assert.equal(applyVolumeDelta(30, 10), 40);
    assert.equal(applyVolumeDelta(30, -10), 20);
    assert.equal(applyVolumeDelta(5, -10), 0);
    assert.equal(applyVolumeDelta(95, 20), 100);
  });
});

describe("Windows error sanitization", () => {
  it("native adapter failure is safe", () => {
    const s = sanitizeWindowsToolError(new WindowsAudioError());
    assert.equal(s.code, "AUDIO_CONTROL_FAILED");
    assert.equal(s.message, "Windows volume couldn't be changed.");
  });

  it("raw command never reaches ToolResult / assistant fallback", () => {
    const leaked =
      "Command failed: powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command Add-Type ...";
    assert.equal(looksLikeShellLeak(leaked), true);
    const s = sanitizeWindowsToolError(new Error(leaked));
    assert.equal(looksLikeShellLeak(s.message), false);
    assert.equal(looksLikeShellLeak(sanitizeDeviceErrorMessage(leaked)), false);
  });
});

describe("no PowerShell for audio", () => {
  it("windows-audio.ts does not invoke PowerShell", () => {
    const src = readFileSync(join(here, "windows-audio.ts"), "utf8");
    assert.equal(/powershell\.exe/i.test(src), false);
    assert.equal(/-ExecutionPolicy/i.test(src), false);
    assert.equal(/Add-Type/i.test(src), false);
    assert.equal(/execFile\s*\(\s*["']powershell/i.test(src), false);
    assert.match(src, /loudness/);
  });

  it("windows-system.ts volume path does not use runPs/powershell", () => {
    const src = readFileSync(join(here, "windows-system.ts"), "utf8");
    assert.equal(/powershell\.exe/i.test(src), false);
    assert.equal(/function runPs/i.test(src), false);
    assert.match(src, /getMasterAudioState|setMasterVolumePercent/);
  });
});
