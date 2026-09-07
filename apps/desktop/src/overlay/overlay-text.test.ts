import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeOverlayText } from "./overlay-text";

describe("normalizeOverlayText", () => {
  it("strips bold markers", () => {
    assert.equal(
      normalizeOverlayText("The **clock** came first."),
      "The clock came first.",
    );
    assert.equal(normalizeOverlayText("__bold__"), "bold");
  });

  it("strips headings and links", () => {
    assert.equal(normalizeOverlayText("# Heading"), "Heading");
    assert.equal(
      normalizeOverlayText("[OpenAI](https://example.com)"),
      "OpenAI",
    );
  });

  it("keeps inline code readable", () => {
    assert.equal(normalizeOverlayText("`npm run dev`"), "npm run dev");
  });

  it("retains simple lists", () => {
    const out = normalizeOverlayText("- item one\n- item two");
    assert.match(out, /item one/);
    assert.match(out, /item two/);
  });

  it("does not introduce HTML", () => {
    // Normalization is plain text only — no HTML parser / no tags invented.
    const out = normalizeOverlayText("**clock** and more");
    assert.equal(out, "clock and more");
    assert.doesNotMatch(out, /<[a-z]+/i);
  });
});
