/**
 * Python contract checks for the local voice engine (no model load).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../../../../voice-engine");

describe("voice engine python service", () => {
  it("server binds localhost and requires secret", () => {
    const src = readFileSync(join(root, "server.py"), "utf8");
    assert.match(src, /HOST = "127\.0\.0\.1"/);
    assert.match(src, /AURUM_VOICE_ENGINE_SECRET/);
    assert.match(src, /MAX_TEXT_CHARS = 2000/);
    assert.match(src, /bm_george/);
    assert.match(src, /AURUM_VOICE_ENGINE_LISTENING/);
    assert.match(src, /AURUM_VOICE_ENGINE_MODEL_READY/);
    assert.match(src, /loading_model/);
    assert.match(src, /bootstrap_phonemizer/);
    assert.match(src, /espeakng_loader/);
    assert.doesNotMatch(src, /shell=True/);
    assert.doesNotMatch(src, /subprocess/);
  });

  it("has requirements and readme", () => {
    assert.equal(existsSync(join(root, "requirements.txt")), true);
    assert.equal(existsSync(join(root, "README.md")), true);
  });
});
