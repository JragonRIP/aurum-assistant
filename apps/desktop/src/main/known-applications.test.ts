import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  KNOWN_APPLICATIONS,
  resolveKnownApplication,
} from "./known-applications";

describe("known applications", () => {
  it("resolves Spotify by alias even when title would be a track name", () => {
    const app = resolveKnownApplication("spotify");
    assert.ok(app);
    assert.equal(app?.id, "spotify");
    assert.ok(app?.executables.includes("spotify.exe"));
  });

  it("resolves common desktop apps", () => {
    assert.equal(resolveKnownApplication("chrome")?.id, "chrome");
    assert.equal(resolveKnownApplication("file explorer")?.id, "explorer");
    assert.equal(resolveKnownApplication("calculator")?.id, "calculator");
  });

  it("has a stable known-app registry", () => {
    assert.ok(KNOWN_APPLICATIONS.length >= 5);
  });
});
