import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_PLAYBACK_MUTATION_ATTEMPTS,
  PLAYBACK_VERIFY_DELAYS_MS,
  pollUntilTrackChanges,
  runVerifiedPlayPauseMutation,
  runVerifiedSkipMutation,
  sanitizeTrackIdentity,
  snapshotFromPlayback,
  trackIdChanged,
  type PlaybackSnapshot,
} from "./playback-mutation";
import { buildFallbackFromToolResults, buildToolExecutionId } from "../../agent/agent-runner";
import type { ToolResult } from "@aurum/tools";

function snap(
  trackId: string | null,
  extras?: Partial<PlaybackSnapshot>,
): PlaybackSnapshot {
  return {
    trackId,
    trackName: trackId ? `Track ${trackId}` : null,
    artists: trackId ? ["Artist"] : [],
    progressMs: 1000,
    isPlaying: true,
    deviceId: "dev-1",
    ...extras,
  };
}

describe("playback mutation helpers", () => {
  it("detects track id changes", () => {
    assert.equal(trackIdChanged(snap("a"), snap("b")), true);
    assert.equal(trackIdChanged(snap("a"), snap("a")), false);
    assert.equal(trackIdChanged(null, snap("a")), true);
    assert.equal(trackIdChanged(snap("a"), null), true);
    assert.equal(trackIdChanged(null, null), false);
  });

  it("sanitizes track identities for logs", () => {
    assert.equal(sanitizeTrackIdentity(null), null);
    assert.equal(sanitizeTrackIdentity("abcdefghijklmnop"), "abcd…mnop");
  });

  it("builds snapshots from adapter playback", () => {
    const s = snapshotFromPlayback({
      isPlaying: true,
      progressMs: 50,
      device: { id: "d1" },
      track: { id: "t1", name: "Song", artists: ["A"] },
    });
    assert.equal(s?.trackId, "t1");
    assert.equal(s?.deviceId, "d1");
  });
});

describe("pollUntilTrackChanges", () => {
  it("confirms when track changes on a later poll", async () => {
    const before = snap("A");
    let calls = 0;
    const states = [snap("A"), snap("A"), snap("B")];
    const { confirmed, after } = await pollUntilTrackChanges({
      before,
      delaysMs: [0, 0, 0],
      sleep: async () => {},
      getState: async () => states[Math.min(calls++, states.length - 1)]!,
    });
    assert.equal(confirmed, true);
    assert.equal(after?.trackId, "B");
  });

  it("returns unconfirmed when track never changes", async () => {
    const before = snap("A");
    const { confirmed, after } = await pollUntilTrackChanges({
      before,
      delaysMs: [0, 0],
      sleep: async () => {},
      getState: async () => snap("A"),
    });
    assert.equal(confirmed, false);
    assert.equal(after?.trackId, "A");
  });
});

describe("runVerifiedSkipMutation", () => {
  it("first next confirms when track changes", async () => {
    let track = "A";
    let mutates = 0;
    const result = await runVerifiedSkipMutation({
      direction: "next",
      verifyDelaysMs: [0],
      sleep: async () => {},
      ensureDevice: async () => ({ ok: true, deviceId: "dev-1" }),
      getState: async () => snap(track),
      mutate: async () => {
        mutates += 1;
        track = "B";
      },
    });
    assert.equal(result.success, true);
    assert.equal(mutates, 1);
    assert.match(result.message ?? "", /Skipped/);
    assert.equal(
      (result.data as { confirmation?: string }).confirmation,
      "CONFIRMED",
    );
  });

  it("second and third user turns each mutate independently", async () => {
    const tracks = ["A", "B", "C", "D"];
    let idx = 0;
    let mutates = 0;
    const runOnce = () =>
      runVerifiedSkipMutation({
        direction: "next",
        verifyDelaysMs: [0],
        sleep: async () => {},
        ensureDevice: async () => ({ ok: true, deviceId: "dev-1" }),
        getState: async () => snap(tracks[idx]!),
        mutate: async () => {
          mutates += 1;
          idx = Math.min(idx + 1, tracks.length - 1);
        },
      });

    const r1 = await runOnce();
    const r2 = await runOnce();
    const r3 = await runOnce();
    assert.equal(r1.success && r2.success && r3.success, true);
    assert.equal(mutates, 3);
    assert.equal(idx, 3);
    assert.equal(
      (r3.data as { currentTrack?: { id?: string } }).currentTrack?.id,
      "D",
    );
  });

  it("accepted but unchanged → one controlled retry then unconfirmed", async () => {
    let mutates = 0;
    const result = await runVerifiedSkipMutation({
      direction: "next",
      verifyDelaysMs: [0],
      retryBackoffMs: 0,
      maxAttempts: MAX_PLAYBACK_MUTATION_ATTEMPTS,
      sleep: async () => {},
      ensureDevice: async () => ({ ok: true, deviceId: "dev-1" }),
      getState: async () => snap("A"),
      mutate: async () => {
        mutates += 1;
      },
    });
    assert.equal(mutates, 2);
    assert.equal(result.success, false);
    assert.equal(result.error?.code, "PLAYBACK_CHANGE_NOT_CONFIRMED");
    assert.equal(
      (result.data as { confirmation?: string }).confirmation,
      "ACCEPTED_UNCONFIRMED",
    );
  });

  it("cancels retry if track already changed before second mutate", async () => {
    let mutates = 0;
    let reads = 0;
    const result = await runVerifiedSkipMutation({
      direction: "next",
      verifyDelaysMs: [0],
      retryBackoffMs: 0,
      sleep: async () => {},
      ensureDevice: async () => ({ ok: true, deviceId: "dev-1" }),
      getState: async () => {
        reads += 1;
        // 1=before attempt1, 2=verify attempt1 (still A), 3=before-retry → already B
        if (reads >= 3) return snap("B");
        return snap("A");
      },
      mutate: async () => {
        mutates += 1;
      },
    });
    assert.equal(mutates, 1);
    assert.equal(result.success, true);
    assert.equal((result.data as { attempts?: number }).attempts, 1);
    assert.match(result.message ?? "", /Skipped/);
  });

  it("caps mutations at two attempts", async () => {
    let mutates = 0;
    await runVerifiedSkipMutation({
      direction: "previous",
      verifyDelaysMs: [0],
      retryBackoffMs: 0,
      sleep: async () => {},
      ensureDevice: async () => ({ ok: true, deviceId: "dev-1" }),
      getState: async () => snap("A"),
      mutate: async () => {
        mutates += 1;
      },
    });
    assert.equal(mutates, 2);
    assert.equal(MAX_PLAYBACK_MUTATION_ATTEMPTS, 2);
  });

  it("returns NO_DEVICE recovery failure without mutating", async () => {
    let mutates = 0;
    const result = await runVerifiedSkipMutation({
      direction: "next",
      ensureDevice: async () => ({
        ok: false,
        result: {
          success: false,
          error: {
            code: "NO_ACTIVE_DEVICE",
            message: "No active Spotify playback device.",
          },
        },
      }),
      getState: async () => null,
      mutate: async () => {
        mutates += 1;
      },
    });
    assert.equal(mutates, 0);
    assert.equal(result.error?.code, "NO_ACTIVE_DEVICE");
  });

  it("previous confirms equivalently", async () => {
    let track = "B";
    const result = await runVerifiedSkipMutation({
      direction: "previous",
      verifyDelaysMs: [0],
      sleep: async () => {},
      ensureDevice: async () => ({ ok: true, deviceId: "dev-1" }),
      getState: async () => snap(track),
      mutate: async () => {
        track = "A";
      },
    });
    assert.equal(result.success, true);
    assert.match(result.message ?? "", /previous track/i);
  });
});

describe("execution identity across user turns", () => {
  it("new generationId yields distinct execution ids for the same tool", () => {
    const a = buildToolExecutionId({
      generationId: "11111111-1111-1111-1111-111111111111",
      toolName: "spotify_next",
      round: 0,
      index: 1,
    });
    const b = buildToolExecutionId({
      generationId: "22222222-2222-2222-2222-222222222222",
      toolName: "spotify_next",
      round: 0,
      index: 1,
    });
    assert.notEqual(a, b);
  });

  it("same generation + call id stays idempotent (duplicate within turn)", () => {
    const a = buildToolExecutionId({
      generationId: "11111111-1111-1111-1111-111111111111",
      toolCallId: "call-1",
      toolName: "spotify_next",
      round: 0,
      index: 1,
    });
    const b = buildToolExecutionId({
      generationId: "11111111-1111-1111-1111-111111111111",
      toolCallId: "call-1",
      toolName: "spotify_next",
      round: 1,
      index: 2,
    });
    assert.equal(a, b);
  });

  it("never collapses to bare gen: prefix when generationId missing", () => {
    const a = buildToolExecutionId({
      toolName: "spotify_next",
      round: 0,
      index: 1,
    });
    const b = buildToolExecutionId({
      toolName: "spotify_next",
      round: 0,
      index: 1,
    });
    assert.equal(a.startsWith("gen:"), false);
    assert.notEqual(a, b);
  });
});

describe("fallback copy for skip confirmation", () => {
  it("confirmed skip → Skipped", () => {
    const text = buildFallbackFromToolResults([
      {
        success: true,
        message: "Skipped.",
        data: { confirmation: "CONFIRMED", confirmed: true },
      },
    ]);
    assert.equal(text, "Skipped.");
  });

  it("unconfirmed skip does not produce Skipped", () => {
    const text = buildFallbackFromToolResults([
      {
        success: false,
        error: {
          code: "PLAYBACK_CHANGE_NOT_CONFIRMED",
          message: "Spotify didn't confirm the track change.",
        },
        data: { confirmation: "ACCEPTED_UNCONFIRMED", confirmed: false },
      },
    ]);
    assert.match(text, /didn't confirm/i);
    assert.doesNotMatch(text, /^Skipped\.?$/i);
  });

  it("rate limit is not success", () => {
    const text = buildFallbackFromToolResults([
      {
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Spotify rate limit reached. Try again shortly.",
        },
        data: { confirmation: "RATE_LIMITED" },
      },
    ]);
    assert.match(text, /rate limit/i);
  });
});

describe("pause/resume verification", () => {
  it("confirms pause when isPlaying becomes false", async () => {
    let playing = true;
    const result = await runVerifiedPlayPauseMutation({
      action: "pause",
      verifyDelaysMs: [0],
      sleep: async () => {},
      ensureDevice: async () => ({ ok: true, deviceId: "dev-1" }),
      getState: async () =>
        snap("A", { isPlaying: playing }),
      mutate: async () => {
        playing = false;
      },
    });
    assert.equal(result.success, true);
    assert.match(result.message ?? "", /Paused/);
  });

  it("unconfirmed pause does not claim success", async () => {
    const result = await runVerifiedPlayPauseMutation({
      action: "pause",
      verifyDelaysMs: [0],
      sleep: async () => {},
      ensureDevice: async () => ({ ok: true, deviceId: "dev-1" }),
      getState: async () => snap("A", { isPlaying: true }),
      mutate: async () => {},
    });
    assert.equal(result.success, false);
    assert.equal(result.error?.code, "PLAYBACK_CHANGE_NOT_CONFIRMED");
  });
});

describe("verify delay schedule", () => {
  it("uses the recommended poll schedule", () => {
    assert.deepEqual([...PLAYBACK_VERIFY_DELAYS_MS], [250, 500, 900, 1400, 2000]);
  });
});

// Type-only: ensure ToolResult shape used above compiles
void (null as unknown as ToolResult);
