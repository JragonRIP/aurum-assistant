/**
 * Pure URL resolution tests (no Electron).
 * Run: npx tsx --test apps/desktop/src/main/config-url.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_AURUM_WEB_URL,
  LOCAL_AURUM_WEB_URL,
  isLocalAurumWebUrl,
  resolveAurumWebUrl,
} from "./config-url";

describe("resolveAurumWebUrl", () => {
  it("defaults to production Vercel URL", () => {
    assert.equal(resolveAurumWebUrl(undefined), DEFAULT_AURUM_WEB_URL);
    assert.equal(resolveAurumWebUrl(null), DEFAULT_AURUM_WEB_URL);
    assert.equal(resolveAurumWebUrl(""), DEFAULT_AURUM_WEB_URL);
    assert.equal(resolveAurumWebUrl("   "), DEFAULT_AURUM_WEB_URL);
  });

  it("honors explicit env override and strips trailing slash", () => {
    assert.equal(
      resolveAurumWebUrl("http://127.0.0.1:3000/"),
      LOCAL_AURUM_WEB_URL,
    );
    assert.equal(
      resolveAurumWebUrl(
        "https://aurum-assistant-aurum-web-design.vercel.app/",
      ),
      DEFAULT_AURUM_WEB_URL,
    );
  });
});

describe("isLocalAurumWebUrl", () => {
  it("detects localhost / loopback", () => {
    assert.equal(isLocalAurumWebUrl("http://localhost:3000"), true);
    assert.equal(isLocalAurumWebUrl(LOCAL_AURUM_WEB_URL), true);
    assert.equal(isLocalAurumWebUrl(DEFAULT_AURUM_WEB_URL), false);
  });
});
