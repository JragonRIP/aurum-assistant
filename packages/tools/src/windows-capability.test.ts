/**
 * Capability / trusted-ref / process-protection regression tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDefaultRegistry } from "./create-registry";
import { evaluatePermission } from "./permission";

const FORBIDDEN = [
  "shell",
  "powershell",
  "cmd",
  "terminal",
  "execute_command",
  "run_command",
  "run_script",
  "exec",
  "bash",
  "run_executable",
  "eval",
];

describe("Windows capability broker registry", () => {
  it("registers core capability tools without shell surfaces", () => {
    const r = createDefaultRegistry();
    for (const id of [
      "get_clipboard_text",
      "set_clipboard_text",
      "capture_screenshot",
      "list_monitors",
      "move_window_to_monitor",
      "list_processes",
      "terminate_process",
      "press_shortcut",
      "find_newest_file",
      "focus_application",
      "close_application",
    ]) {
      assert.ok(r.get(id), `missing tool ${id}`);
    }
    for (const id of FORBIDDEN) {
      assert.equal(r.get(id), undefined, `forbidden tool registered: ${id}`);
    }
    for (const tool of r.list()) {
      const schema = tool.inputSchema as { shape?: Record<string, unknown> };
      if (schema.shape) {
        assert.equal(
          "command" in schema.shape ||
            "script" in schema.shape ||
            "powershell" in schema.shape ||
            "argv" in schema.shape,
          false,
          `${tool.id} must not accept command/script fields`,
        );
      }
    }
  });

  it("enforces confirmation on destructive capability tools", () => {
    const r = createDefaultRegistry();
    assert.equal(r.get("terminate_process")?.permission, "CONFIRM");
    assert.equal(r.get("close_application")?.permission, "SAFE_WRITE");
    assert.equal(r.get("set_clipboard_text")?.permission, "SAFE_WRITE");
    assert.equal(r.get("capture_screenshot")?.permission, "SAFE_WRITE");
    assert.equal(r.get("press_shortcut")?.permission, "SAFE_WRITE");
    assert.equal(r.get("list_processes")?.permission, "READ");

    const term = evaluatePermission(r.get("terminate_process")!.permission);
    assert.equal(term.allowed, true);
    if (term.allowed) assert.equal(term.mode, "confirm");
    const clip = evaluatePermission(r.get("set_clipboard_text")!.permission);
    assert.equal(clip.allowed, true);
    if (clip.allowed) assert.equal(clip.mode, "execute");
  });

  it("keeps press_shortcut constrained to an enum", () => {
    const r = createDefaultRegistry();
    const tool = r.get("press_shortcut")!;
    assert.equal(tool.inputSchema.safeParse({ action: "copy" }).success, true);
    assert.equal(
      tool.inputSchema.safeParse({ action: "ctrl+shift+esc" }).success,
      false,
    );
    assert.equal(
      tool.inputSchema.safeParse({ action: "arbitrary" }).success,
      false,
    );
  });

  it("requires trusted refs for window/process mutations", () => {
    const r = createDefaultRegistry();
    assert.equal(
      r.get("move_window_to_monitor")!.inputSchema.safeParse({
        windowReference: "not-a-uuid",
        monitorReference: "also-bad",
      }).success,
      false,
    );
    assert.equal(
      r.get("terminate_process")!.inputSchema.safeParse({
        processReference: "1234",
      }).success,
      false,
    );
  });
});
