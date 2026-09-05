import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearTrustedDesktopRefs,
  rememberApp,
  rememberFile,
  rememberMonitor,
  rememberProcess,
  rememberWindow,
  resolveApp,
  resolveFile,
  resolveMonitor,
  resolveProcess,
  resolveWindow,
} from "./trusted-refs";
import { isProtectedProcessName } from "./windows-processes";
import { clearAuditMemory, getRecentAudit, recordAudit } from "./windows-audit";

describe("trusted desktop refs", () => {
  it("issues opaque UUIDs and resolves typed payloads", () => {
    clearTrustedDesktopRefs();
    const windowReference = rememberWindow({
      hwnd: 42,
      title: "Chrome",
      processName: "chrome",
      processId: 100,
    });
    assert.match(windowReference, /^[0-9a-f-]{36}$/i);
    assert.equal(resolveWindow(windowReference)?.hwnd, 42);
    assert.equal(resolveWindow("00000000-0000-0000-0000-000000000000"), null);

    const monitorReference = rememberMonitor({
      displayId: 1,
      index: 0,
      label: "Primary",
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1,
      primary: true,
    });
    assert.equal(resolveMonitor(monitorReference)?.label, "Primary");

    const processReference = rememberProcess({
      pid: 999,
      name: "notepad",
      memoryMb: 12,
    });
    assert.equal(resolveProcess(processReference)?.pid, 999);

    const appReference = rememberApp({
      displayName: "Spotify",
      targetPath: "C:\\Apps\\Spotify.exe",
    });
    assert.equal(resolveApp(appReference)?.displayName, "Spotify");
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        resolveApp(appReference) as object,
        "targetPath",
      ),
      true,
    );

    const fileReference = rememberFile({
      path: "C:\\Users\\test\\Downloads\\a.pdf",
      name: "a.pdf",
      kind: "file",
    });
    assert.equal(resolveFile(fileReference)?.name, "a.pdf");
  });
});

describe("process protection", () => {
  it("blocks critical Windows and Aurum processes", () => {
    assert.equal(isProtectedProcessName("lsass"), true);
    assert.equal(isProtectedProcessName("csrss.exe"), true);
    assert.equal(isProtectedProcessName("explorer"), true);
    assert.equal(isProtectedProcessName("MsMpEng"), true);
    assert.equal(isProtectedProcessName("Aurum"), true);
    assert.equal(isProtectedProcessName("notepad"), false);
    assert.equal(isProtectedProcessName("chrome"), false);
  });
});

describe("audit log sanitization", () => {
  it("redacts clipboard/text bodies", () => {
    clearAuditMemory();
    recordAudit({
      tool: "set_clipboard_text",
      permission: "SAFE_WRITE",
      success: true,
      durationMs: 5,
      argsSummary: { text: "super-secret-token-value" },
    });
    const recent = getRecentAudit(1)[0]!;
    assert.notEqual(recent.argsSummary.text, "super-secret-token-value");
    assert.match(String(recent.argsSummary.text), /redacted/i);
  });
});
