import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "../..");
const assertScript = path.join(
  desktopRoot,
  "scripts",
  "assert-no-workspace-requires.mjs",
);

describe("packaged workspace import guard", () => {
  it("fails when staged JS still requires @aurum/shared", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aurum-pack-"));
    const js = path.join(dir, "dist", "main");
    fs.mkdirSync(js, { recursive: true });
    fs.writeFileSync(
      path.join(js, "bad.js"),
      'const x = require("@aurum/shared");\n',
      "utf8",
    );
    const result = spawnSync(process.execPath, [assertScript, dir], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /@aurum\/shared/);
  });

  it("passes when no workspace requires are present", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aurum-pack-"));
    const js = path.join(dir, "dist", "main");
    fs.mkdirSync(js, { recursive: true });
    fs.writeFileSync(
      path.join(js, "ok.js"),
      'const path = require("node:path");\n',
      "utf8",
    );
    const result = spawnSync(process.execPath, [assertScript, dir], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0);
  });

  it("bundle-main script exists and documents inlining", () => {
    const src = fs.readFileSync(
      path.join(desktopRoot, "scripts", "bundle-main.mjs"),
      "utf8",
    );
    assert.match(src, /@aurum\/shared/);
    assert.match(src, /esbuild/);
    assert.match(src, /assertNoWorkspaceRequires/);
  });
});
