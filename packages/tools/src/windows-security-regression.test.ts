import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDefaultRegistry } from "./create-registry";

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
];

describe("Windows / tool registry security regression", () => {
  it("does not register generic shell tools for Gemini", () => {
    const r = createDefaultRegistry();
    for (const id of FORBIDDEN) {
      assert.equal(r.get(id), undefined, `forbidden tool registered: ${id}`);
    }
    for (const tool of r.list()) {
      assert.equal(
        FORBIDDEN.includes(tool.id),
        false,
        `forbidden tool id present: ${tool.id}`,
      );
      const schema = tool.inputSchema as {
        shape?: Record<string, unknown>;
      };
      if (schema.shape) {
        assert.equal(
          "command" in schema.shape ||
            "script" in schema.shape ||
            "powershell" in schema.shape,
          false,
          `${tool.id} must not accept command/script fields`,
        );
      }
    }
  });

  it("keeps Windows volume tools typed", () => {
    const r = createDefaultRegistry();
    const setVol = r.get("set_system_volume");
    assert.ok(setVol);
    assert.equal(setVol!.permission, "SAFE_WRITE");
    const ok = setVol!.inputSchema.safeParse({ percent: 30 });
    assert.equal(ok.success, true);
  });

  it("power controls retain existing permission classifications", () => {
    const r = createDefaultRegistry();
    assert.equal(r.get("lock_pc")?.permission, "SAFE_WRITE");
    assert.equal(r.get("sleep_pc")?.permission, "CONFIRM");
    assert.equal(r.get("restart_pc")?.permission, "CONFIRM");
    assert.equal(r.get("shutdown_pc")?.permission, "CONFIRM");
  });
});
