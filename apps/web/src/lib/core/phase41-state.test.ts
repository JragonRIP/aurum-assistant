import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isConnectivityActivityCaption,
  trustedActivityCaption,
} from "@aurum/shared";
import { resolveToolActivityLabel } from "@aurum/tools";

describe("Phase 4.1 desktop activity captions", () => {
  it("1–3. open_application label is Opening {app}, not CONNECTING", () => {
    const label = resolveToolActivityLabel(
      "open_application",
      "Opening application",
      { app: "Spotify" },
    );
    assert.equal(label, "Opening Spotify");
    assert.equal(isConnectivityActivityCaption(label), false);
    assert.equal(
      trustedActivityCaption("CHECKING DEVICES"),
      "LISTING DEVICES",
    );
  });

  it("4. real connecting caption remains connectivity", () => {
    assert.equal(isConnectivityActivityCaption("CONNECTING"), true);
    assert.equal(isConnectivityActivityCaption("PAIRING"), true);
    assert.equal(isConnectivityActivityCaption("OPENING SPOTIFY"), false);
  });

  it("RESPONDING is not treated as tool activity caption", () => {
    assert.equal(trustedActivityCaption("RESPONDING"), null);
  });
});

describe("Phase 4.1 tool activity label map", () => {
  it("maps spotify tools to human captions", () => {
    assert.equal(
      resolveToolActivityLabel("spotify_pause", "Pausing", {}),
      "Pausing Spotify",
    );
    assert.equal(
      resolveToolActivityLabel("spotify_search_track", "Searching", {
        query: "Tha Mobb",
      }),
      "Finding Tha Mobb",
    );
  });
});
