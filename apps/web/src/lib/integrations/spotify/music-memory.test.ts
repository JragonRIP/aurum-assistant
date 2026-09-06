import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectVersionHint,
  normalizeMusicQuery,
  scoreChoiceMatch,
} from "./music-query";
import {
  isTrackAmbiguous,
  preferExplicitEquivalent,
  rankTracks,
  scoreTrack,
} from "./track-ranking";
import {
  isPlaylistAmbiguous,
  rankPlaylists,
  scorePlaylist,
} from "./playlist-resolution";
import { resolveChoiceAgainstCandidates } from "./disambiguation";
import { createDefaultRegistry } from "@aurum/tools";

describe("music query normalization", () => {
  it("strips filler and preserves residual key", () => {
    const a = normalizeMusicQuery("Play Drank in My Cup please");
    const b = normalizeMusicQuery("Drank In My Cup");
    assert.equal(a.key, b.key);
    assert.equal(a.key.includes("play"), false);
    assert.equal(a.key.includes("please"), false);
  });

  it("detects clean/explicit and temporary/persist flags", () => {
    assert.equal(detectVersionHint("play the clean version"), "clean");
    assert.equal(detectVersionHint("explicit version please"), "explicit");
    const once = normalizeMusicQuery("Play the remix this time");
    assert.equal(once.temporaryOverride, true);
    assert.equal(once.versionHint, "remix");
    const always = normalizeMusicQuery("Always play the clean version");
    assert.equal(always.persistPreference, true);
    assert.equal(always.versionHint, "clean");
  });

  it("scores short artist choices", () => {
    assert.ok(
      scoreChoiceMatch("Kirko", {
        name: "Drank in My Cup",
        artists: ["Kirko Bangz"],
      }) >= 60,
    );
  });
});

describe("explicit vs clean ranking", () => {
  const kirkoExplicit = {
    id: "e1",
    uri: "spotify:track:e1",
    name: "Drank in My Cup",
    artists: ["Kirko Bangz"],
    album: "Drank in My Cup",
    durationMs: 200000,
    explicit: true,
  };
  const kirkoClean = {
    ...kirkoExplicit,
    id: "c1",
    uri: "spotify:track:c1",
    album: "Drank in My Cup (Clean)",
    explicit: false,
  };
  const otherArtist = {
    id: "o1",
    uri: "spotify:track:o1",
    name: "Drank in My Cup",
    artists: ["Some Cover Band"],
    album: "Covers",
    durationMs: 200000,
    explicit: true,
  };
  const remix = {
    ...kirkoExplicit,
    id: "r1",
    uri: "spotify:track:r1",
    name: "Drank in My Cup (Remix)",
    album: "Remixes",
    explicit: true,
  };

  it("prefers explicit when equivalent", () => {
    const ranked = rankTracks([kirkoClean, kirkoExplicit], {
      query: "drank in my cup",
    });
    const best = preferExplicitEquivalent(ranked, false);
    assert.equal(best?.id, "e1");
  });

  it("prefers clean when requested", () => {
    const ranked = rankTracks([kirkoClean, kirkoExplicit], {
      query: "drank in my cup",
      preferClean: true,
    });
    const best = preferExplicitEquivalent(ranked, true);
    assert.equal(best?.id, "c1");
  });

  it("does not let remix win merely because explicit", () => {
    assert.ok(
      scoreTrack(kirkoExplicit, { query: "drank in my cup" }) >
        scoreTrack(remix, { query: "drank in my cup" }),
    );
  });

  it("saved preference id outranks others", () => {
    const ranked = rankTracks([otherArtist, kirkoClean, kirkoExplicit], {
      query: "drank in my cup",
      preferredId: "e1",
    });
    assert.equal(ranked[0]?.id, "e1");
    assert.equal(
      isTrackAmbiguous(ranked, {
        query: "drank in my cup",
        preferredId: "e1",
      }),
      false,
    );
  });

  it("asks when different artists are close", () => {
    const ranked = rankTracks([kirkoExplicit, otherArtist], {
      query: "drank in my cup",
    });
    assert.equal(
      isTrackAmbiguous(ranked, { query: "drank in my cup" }),
      true,
    );
  });
});

describe("playlist resolution ranking", () => {
  const owned = [
    {
      id: "p1",
      uri: "spotify:playlist:p1",
      name: "Lil Wayne Hits",
      public: false,
      ownerId: "me",
    },
    {
      id: "p2",
      uri: "spotify:playlist:p2",
      name: "Wayne Workout",
      public: true,
      ownerId: "me",
    },
    {
      id: "p3",
      uri: "spotify:playlist:p3",
      name: "Lil Wayne Hits",
      public: true,
      ownerId: "spotify",
    },
  ];

  it("exact owned title ranks highest and prefers current user", () => {
    const ranked = rankPlaylists(owned, {
      query: "lil wayne hits",
      currentUserId: "me",
    });
    assert.equal(ranked[0]?.id, "p1");
    assert.ok(
      scorePlaylist(owned[0]!, {
        query: "lil wayne hits",
        currentUserId: "me",
      }) >
        scorePlaylist(owned[2]!, {
          query: "lil wayne hits",
          currentUserId: "me",
        }),
    );
  });

  it("preference id forces non-ambiguous", () => {
    const ranked = rankPlaylists(owned, {
      query: "wayne",
      preferredId: "p1",
      currentUserId: "me",
    });
    assert.equal(ranked[0]?.id, "p1");
    assert.equal(
      isPlaylistAmbiguous(ranked, {
        query: "wayne",
        preferredId: "p1",
        currentUserId: "me",
      }),
      false,
    );
  });

  it("ambiguous when multiple wayne playlists without preference", () => {
    const close = [
      {
        id: "a",
        uri: "spotify:playlist:a",
        name: "Wayne Vibes",
        public: false,
        ownerId: "me",
      },
      {
        id: "b",
        uri: "spotify:playlist:b",
        name: "Wayne Favorites",
        public: false,
        ownerId: "me",
      },
    ];
    const ranked = rankPlaylists(close, {
      query: "wayne",
      currentUserId: "me",
    });
    assert.equal(
      isPlaylistAmbiguous(ranked, {
        query: "wayne",
        currentUserId: "me",
      }),
      true,
    );
  });
});

describe("disambiguation short answers", () => {
  const candidates = [
    {
      providerId: "e1",
      providerUri: "spotify:track:e1",
      name: "Drank in My Cup",
      artists: ["Kirko Bangz"],
      explicit: true,
    },
    {
      providerId: "o1",
      providerUri: "spotify:track:o1",
      name: "Drank in My Cup",
      artists: ["Random Artist"],
      explicit: false,
    },
  ];

  it("resolves Kirko to Kirko Bangz candidate", () => {
    const picked = resolveChoiceAgainstCandidates("Kirko", candidates);
    assert.equal(picked?.providerId, "e1");
  });

  it("rejects fabricated/unrelated choices", () => {
    assert.equal(
      resolveChoiceAgainstCandidates("Totally Unrelated Band", candidates),
      null,
    );
  });
});

describe("spotify music tools registered", () => {
  it("registers resolve + preference tools", () => {
    const registry = createDefaultRegistry();
    assert.ok(registry.get("spotify_resolve_playlist"));
    assert.ok(registry.get("spotify_resolve_disambiguation"));
    assert.ok(registry.get("spotify_list_music_preferences"));
    assert.ok(registry.get("spotify_forget_music_preference"));
    assert.ok(registry.get("spotify_remember_music_preference"));
  });
});

describe("resource type isolation", () => {
  it("playlist and track ambiguity codes are distinct", () => {
    assert.notEqual("AMBIGUOUS_PLAYLIST", "AMBIGUOUS_TRACK");
  });

  it("clarification codes are classified separately from hard failures", async () => {
    const { isClarificationErrorCode } = await import("@aurum/tools");
    assert.equal(isClarificationErrorCode("AMBIGUOUS_TRACK"), true);
    assert.equal(isClarificationErrorCode("AMBIGUOUS_PLAYLIST"), true);
    assert.equal(isClarificationErrorCode("EXECUTION_FAILED"), false);
    assert.equal(isClarificationErrorCode("NO_ACTIVE_DEVICE"), false);
  });
});

describe("override rules (conceptual)", () => {
  it("temporary override does not share key with persist phrase alone", () => {
    const base = normalizeMusicQuery("Play Drank in My Cup");
    const once = normalizeMusicQuery("Play the remix of Drank in My Cup this time");
    assert.notEqual(base.key, once.key);
    assert.equal(once.temporaryOverride, true);
  });

  it("from now on sets persistPreference", () => {
    const p = normalizeMusicQuery(
      "When I say Drank in My Cup, always use this version from now on",
    );
    assert.equal(p.persistPreference, true);
  });
});
