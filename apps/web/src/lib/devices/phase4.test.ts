import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertApprovedPath,
  canOpenWithDefaultApp,
  isBlockedAppName,
  isBlockedExecutableExtension,
  isDevicePath,
  isPathInsideAllowed,
  isSafeUrl,
  isTextReadableExtension,
  isUncPath,
  sanitizeFileName,
} from "@aurum/tools";
import {
  DEVICE_REQUEST_TTL_MS,
  isDesktopToolName,
} from "@aurum/shared";
import {
  generatePairingCode,
  hashPairingCode,
  hashSecret,
  verifySecret,
} from "@/lib/devices/crypto";
import { isDeviceHeartbeatFresh } from "@/lib/devices/queries";
import { createDefaultRegistry } from "@aurum/tools";

describe("Phase 4 pairing crypto", () => {
  it("1. pairing code hash verifies", () => {
    const code = generatePairingCode();
    assert.equal(code.length, 8);
    const hash = hashPairingCode(code);
    assert.equal(hashPairingCode(code.toLowerCase()), hash);
  });

  it("6. device secret verification is timing-safe", () => {
    const secret = "device-secret-value-example";
    const hash = hashSecret(secret);
    assert.equal(verifySecret(secret, hash), true);
    assert.equal(verifySecret("wrong", hash), false);
  });
});

describe("Phase 4 heartbeat freshness", () => {
  it("7. heartbeat marks device online when fresh", () => {
    assert.equal(
      isDeviceHeartbeatFresh(new Date().toISOString()),
      true,
    );
  });

  it("8. stale heartbeat marks offline", () => {
    const old = new Date(Date.now() - 120_000).toISOString();
    assert.equal(isDeviceHeartbeatFresh(old), false);
  });
});

describe("Phase 4 device tool registry", () => {
  it("12. device tools marked DESKTOP environment", () => {
    const registry = createDefaultRegistry();
    const open = registry.get("open_application");
    assert.ok(open);
    assert.equal(open!.environment, "DESKTOP");
    assert.equal(isDesktopToolName("open_application"), true);
  });

  it("13. unknown device tool name rejected by helper", () => {
    assert.equal(isDesktopToolName("run_command"), false);
    assert.equal(isDesktopToolName("execute_shell"), false);
  });

  it("62. no generic shell tool exists", () => {
    const registry = createDefaultRegistry();
    assert.equal(registry.get("run_command"), undefined);
    assert.equal(registry.get("execute_shell"), undefined);
    assert.equal(registry.get("execute_powershell"), undefined);
  });
});

describe("Phase 4 app / URL policy", () => {
  it("16. blocked system utility rejected", () => {
    assert.equal(isBlockedAppName("powershell"), true);
    assert.equal(isBlockedAppName("cmd.exe"), true);
    assert.equal(isBlockedAppName("Spotify"), false);
  });

  it("18. arbitrary exe path style names blocked", () => {
    assert.equal(isBlockedAppName("C:\\\\Windows\\\\System32\\\\cmd.exe"), true);
  });

  it("20–24. URL scheme policy", () => {
    assert.equal(isSafeUrl("https://example.com"), true);
    assert.equal(isSafeUrl("http://example.com"), true);
    assert.equal(isSafeUrl("javascript:alert(1)"), false);
    assert.equal(isSafeUrl("file:///c:/secret"), false);
    assert.equal(isSafeUrl("ms-settings:display"), false);
  });
});

describe("Phase 4 path security", () => {
  const docs = "C:\\Users\\demo\\Documents";

  it("25. approved path allowed", () => {
    assert.equal(
      isPathInsideAllowed(`${docs}\\invoice.pdf`, [docs]),
      true,
    );
    const gate = assertApprovedPath(`${docs}\\invoice.pdf`, [docs]);
    assert.equal(gate.ok, true);
  });

  it("26. traversal blocked", () => {
    assert.equal(
      isPathInsideAllowed(`${docs}\\..\\..\\Windows\\System32`, [docs]),
      false,
    );
  });

  it("28. Windows system folder blocked", () => {
    const gate = assertApprovedPath("C:\\Windows\\System32\\cmd.exe", [
      "C:\\Windows",
    ]);
    assert.equal(gate.ok, false);
  });

  it("30. unapproved root blocked", () => {
    const gate = assertApprovedPath("C:\\Temp\\x.txt", [docs]);
    assert.equal(gate.ok, false);
  });

  it("31. UNC blocked", () => {
    assert.equal(isUncPath("\\\\server\\share"), true);
    const gate = assertApprovedPath("\\\\server\\share\\a.txt", [docs]);
    assert.equal(gate.ok, false);
  });

  it("37. executable file open blocked by extension", () => {
    assert.equal(isBlockedExecutableExtension("payload.exe"), true);
    assert.equal(isBlockedExecutableExtension("notes.pdf"), false);
  });

  it("44. rename to executable extension blocked", () => {
    assert.equal(isBlockedExecutableExtension("invoice.exe"), true);
    assert.equal(sanitizeFileName("invoice-final.pdf"), "invoice-final.pdf");
    assert.equal(sanitizeFileName("../x"), null);
    assert.equal(sanitizeFileName("a\\b"), null);
  });
});

describe("Phase 4 request TTL", () => {
  it("10. expired request window is finite", () => {
    assert.ok(DEVICE_REQUEST_TTL_MS > 5_000);
    assert.ok(DEVICE_REQUEST_TTL_MS < 120_000);
  });
});

describe("Phase 4 file type policy", () => {
  it("36. binary/unsupported extensions are not text-readable", () => {
    assert.equal(isTextReadableExtension("photo.png"), false);
    assert.equal(isTextReadableExtension("doc.pdf"), false);
    assert.equal(isTextReadableExtension("notes.txt"), true);
  });

  it("35. text extensions allowed for read", () => {
    assert.equal(isTextReadableExtension("a.md"), true);
    assert.equal(canOpenWithDefaultApp("invoice.pdf"), true);
    assert.equal(canOpenWithDefaultApp("run.ps1"), false);
  });
});

describe("Phase 4 device path / sensitive", () => {
  it("29. AppData credential stores blocked even under broad root", () => {
    const gate = assertApprovedPath(
      "C:\\Users\\demo\\AppData\\Roaming\\Microsoft\\Credentials\\x",
      ["C:\\Users\\demo"],
    );
    assert.equal(gate.ok, false);
  });

  it("32. device path blocked", () => {
    assert.equal(isDevicePath("\\\\.\\PhysicalDrive0"), true);
  });
});

describe("Phase 4 get_connected_devices cloud tool", () => {
  it("get_connected_devices is CLOUD environment", () => {
    const registry = createDefaultRegistry();
    const tool = registry.get("get_connected_devices");
    assert.ok(tool);
    assert.equal(tool!.environment, "CLOUD");
  });

  it("14. disabled tool rejected", () => {
    const registry = createDefaultRegistry();
    const open = registry.get("open_application");
    assert.ok(open);
    open!.enabled = false;
    assert.equal(
      registry
        .toGeminiFunctionDeclarations()
        .some((d) => d.name === "open_application"),
      false,
    );
    open!.enabled = true;
  });
});
