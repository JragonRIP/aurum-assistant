import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  containsSecretMaterial,
  gateMemoryCandidate,
  normalizeCanonicalKey,
  parseResponseDetailValue,
  rankMemoryScore,
  type MemoryCandidate,
  type MemoryItem,
} from "./types";
import { extractExplicitMemoryCandidates } from "./extract";
import {
  assertSafeVaultRelativePath,
  preferenceVaultMarkdown,
  upsertManagedSection as upsertVaultSection,
  vaultRelativePath,
} from "./vault";

describe("memory gate", () => {
  it("rejects secrets", () => {
    assert.equal(containsSecretMaterial("my api_key is sk-abc"), true);
    const c: MemoryCandidate = {
      action: "CREATE",
      type: "FACT",
      importance: "USEFUL",
      title: "Key",
      content: "API key abc123",
      confidence: 0.99,
    };
    assert.equal(gateMemoryCandidate(c, { explicit: true }), "secret_material");
  });

  it("rejects low-confidence inference", () => {
    const c: MemoryCandidate = {
      action: "CREATE",
      type: "FACT",
      importance: "USEFUL",
      title: "Maybe",
      content: "Possibly likes blue",
      confidence: 0.5,
    };
    assert.equal(gateMemoryCandidate(c), "low_confidence");
  });

  it("accepts explicit high-confidence preference", () => {
    const c: MemoryCandidate = {
      action: "UPDATE",
      type: "PREFERENCE",
      importance: "IMPORTANT",
      canonicalKey: "preference:response_detail",
      title: "Response detail",
      content: "User prefers concise answers by default.",
      confidence: 0.98,
    };
    assert.equal(gateMemoryCandidate(c, { explicit: true }), null);
  });
});

describe("extraction", () => {
  it("extracts concise preference", () => {
    const c = extractExplicitMemoryCandidates(
      "From now on keep answers short.",
    );
    assert.ok(c.some((x) => x.canonicalKey === "preference:response_detail"));
  });

  it("extracts remember-that", () => {
    const c = extractExplicitMemoryCandidates(
      "Remember that my target budget is $300k.",
    );
    assert.ok(c.some((x) => x.action === "CREATE"));
  });

  it("ignores weather questions", () => {
    const c = extractExplicitMemoryCandidates("What's the weather?");
    assert.equal(c.length, 0);
  });

  it("flags secret remember attempts", () => {
    const c = extractExplicitMemoryCandidates(
      "Remember my API key is abc123",
    );
    assert.ok(c.some((x) => x.action === "IGNORE"));
  });
});

describe("response detail parsing", () => {
  it("parses concise/detailed", () => {
    assert.equal(parseResponseDetailValue("prefer concise answers"), "concise");
    assert.equal(parseResponseDetailValue("give detailed replies"), "detailed");
  });
});

describe("canonical keys", () => {
  it("normalizes", () => {
    assert.equal(
      normalizeCanonicalKey("Preference: Response Detail"),
      "preference:_response_detail",
    );
  });
});

describe("ranking", () => {
  it("prefers relevant important memories", () => {
    const base = {
      user_id: "00000000-0000-0000-0000-000000000001",
      status: "ACTIVE" as const,
      confidence: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const a: MemoryItem = {
      ...base,
      id: "00000000-0000-0000-0000-000000000011",
      title: "Response detail",
      content: "concise",
      memory_type: "PREFERENCE",
      importance_level: "IMPORTANT",
      canonical_key: "preference:response_detail",
    };
    const b: MemoryItem = {
      ...base,
      id: "00000000-0000-0000-0000-000000000012",
      title: "Spotify",
      content: "likes rock",
      memory_type: "INTEREST",
      importance_level: "USEFUL",
      canonical_key: null,
    };
    const qa = rankMemoryScore({ item: a, query: "how should I answer briefly" });
    const qb = rankMemoryScore({ item: b, query: "how should I answer briefly" });
    assert.ok(qa > qb);
  });
});

describe("vault markdown", () => {
  it("builds safe relative paths and blocks traversal", () => {
    assert.equal(
      vaultRelativePath("preferences"),
      "00 - Aurum/Preferences.md",
    );
    assert.throws(() => assertSafeVaultRelativePath("../etc/passwd.md"));
    assert.throws(() => assertSafeVaultRelativePath("evil.exe"));
  });

  it("preserves user content outside managed sections", () => {
    const existing = `# Preferences\n\nMy note\n\n<!-- AURUM:START preferences -->\nold\n<!-- AURUM:END preferences -->\n`;
    const next = upsertVaultSection(existing, "preferences", "- concise");
    assert.match(next, /My note/);
    assert.match(next, /- concise/);
    assert.doesNotMatch(next, /\bold\b/);
  });

  it("renders preference vault markdown", () => {
    const md = preferenceVaultMarkdown([
      {
        id: "00000000-0000-0000-0000-000000000011",
        user_id: "00000000-0000-0000-0000-000000000001",
        title: "Response detail",
        content: "User prefers concise answers by default.",
        memory_type: "PREFERENCE",
        importance_level: "IMPORTANT",
        status: "ACTIVE",
        confidence: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
    assert.match(md, /# Preferences/);
    assert.match(md, /AURUM:START preferences/);
    assert.match(md, /concise/);
  });
});

