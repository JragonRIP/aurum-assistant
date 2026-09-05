import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEVICE_POLL_DELAYS_MS,
  DEVICE_RECOVERY_FAILURE_MESSAGE,
  ensureSpotifyPlaybackDevice,
  selectPlaybackDevice,
  type RecoverableDevice,
} from "./device-recovery";

function device(
  partial: Partial<RecoverableDevice> & Pick<RecoverableDevice, "id" | "name">,
): RecoverableDevice {
  return {
    type: "Computer",
    isActive: false,
    isRestricted: false,
    ...partial,
  };
}

describe("selectPlaybackDevice", () => {
  it("prefers active device", () => {
    const selected = selectPlaybackDevice([
      device({ id: "a", name: "Phone", type: "Smartphone", isActive: false }),
      device({ id: "b", name: "PC", type: "Computer", isActive: true }),
    ]);
    assert.equal(selected?.id, "b");
  });

  it("prefers computer when none active", () => {
    const selected = selectPlaybackDevice([
      device({ id: "a", name: "Phone", type: "Smartphone" }),
      device({ id: "b", name: "PC", type: "Computer" }),
    ]);
    assert.equal(selected?.id, "b");
  });

  it("skips restricted devices", () => {
    const selected = selectPlaybackDevice([
      device({ id: "a", name: "TV", isRestricted: true, isActive: true }),
      device({ id: "b", name: "PC", type: "Computer" }),
    ]);
    assert.equal(selected?.id, "b");
  });
});

describe("ensureSpotifyPlaybackDevice", () => {
  it("device already available → immediate playback path (no open)", async () => {
    let opens = 0;
    let transfers = 0;
    const result = await ensureSpotifyPlaybackDevice({
      getDevices: async () => [
        device({ id: "pc", name: "Aurum-PC", isActive: true }),
      ],
      openSpotifyDesktop: async () => {
        opens += 1;
        return { ok: true };
      },
      transferPlayback: async () => {
        transfers += 1;
      },
      pollDelaysMs: [0],
      sleepFn: async () => undefined,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.deviceId, "pc");
      assert.equal(result.openedSpotify, false);
      assert.equal(result.transferred, false);
    }
    assert.equal(opens, 0);
    assert.equal(transfers, 0);
  });

  it("no device → Spotify opened, then device appears → success", async () => {
    let calls = 0;
    let opens = 0;
    const activities: string[] = [];
    const result = await ensureSpotifyPlaybackDevice({
      getDevices: async () => {
        calls += 1;
        if (calls < 3) return [];
        return [device({ id: "pc", name: "Desktop", type: "Computer" })];
      },
      openSpotifyDesktop: async () => {
        opens += 1;
        return { ok: true };
      },
      transferPlayback: async () => undefined,
      onActivity: (l) => activities.push(l),
      pollDelaysMs: [0, 1, 1, 1],
      sleepFn: async () => undefined,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.deviceId, "pc");
      assert.equal(result.openedSpotify, true);
      assert.equal(result.transferred, true);
    }
    assert.equal(opens, 1);
    assert.ok(activities.some((a) => /Opening Spotify/i.test(a)));
  });

  it("inactive device → transfer then ready", async () => {
    let transferredTo: string | null = null;
    const result = await ensureSpotifyPlaybackDevice({
      getDevices: async () => [
        device({ id: "pc", name: "PC", type: "Computer", isActive: false }),
      ],
      transferPlayback: async (id, play) => {
        transferredTo = id;
        assert.equal(play, false);
      },
      pollDelaysMs: [0],
      sleepFn: async () => undefined,
    });
    assert.equal(result.ok, true);
    assert.equal(transferredTo, "pc");
    if (result.ok) assert.equal(result.transferred, true);
  });

  it("device never appears → one clean terminal failure", async () => {
    let opens = 0;
    const result = await ensureSpotifyPlaybackDevice({
      getDevices: async () => [],
      openSpotifyDesktop: async () => {
        opens += 1;
        return { ok: true };
      },
      transferPlayback: async () => undefined,
      pollDelaysMs: [0, 1, 1],
      sleepFn: async () => undefined,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, DEVICE_RECOVERY_FAILURE_MESSAGE);
      assert.equal(result.openedSpotify, true);
      assert.equal(result.cancelled, false);
    }
    assert.equal(opens, 1);
  });

  it("cancellation during polling", async () => {
    const result = await ensureSpotifyPlaybackDevice({
      getDevices: async () => [],
      transferPlayback: async () => undefined,
      signal: AbortSignal.abort(),
      pollDelaysMs: [0, 10],
      sleepFn: async (_ms, signal) => {
        if (signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.cancelled, true);
      assert.equal(result.message, "Cancelled.");
    }
  });

  it("opens Spotify at most once (duplicate open prevention)", async () => {
    let opens = 0;
    await ensureSpotifyPlaybackDevice({
      getDevices: async () => [],
      openSpotifyDesktop: async () => {
        opens += 1;
        return { ok: true };
      },
      transferPlayback: async () => undefined,
      pollDelaysMs: [0, 1, 1, 1, 1],
      sleepFn: async () => undefined,
    });
    assert.equal(opens, 1);
  });

  it("preserves polling schedule contract (~10–15s window)", () => {
    const total = (DEVICE_POLL_DELAYS_MS as readonly number[]).reduce(
      (a, b) => a + b,
      0,
    );
    assert.ok(total >= 10_000);
    assert.ok(total <= 16_000);
    assert.equal(DEVICE_POLL_DELAYS_MS[0], 0);
  });
});

describe("playback intent preservation (recovery contract)", () => {
  it("recovery returns deviceId only — caller resumes original play mutation", async () => {
    const originalPlaylistUri = "spotify:playlist:trusted-ref-only";
    let playedUri: string | null = null;
    let playCount = 0;

    const recovery = await ensureSpotifyPlaybackDevice({
      getDevices: async () => [
        device({ id: "pc", name: "PC", isActive: true }),
      ],
      transferPlayback: async () => undefined,
      pollDelaysMs: [0],
      sleepFn: async () => undefined,
    });
    assert.equal(recovery.ok, true);
    if (!recovery.ok) return;

    // Simulated single final mutation after recovery
    playCount += 1;
    playedUri = originalPlaylistUri;
    assert.equal(playCount, 1);
    assert.equal(playedUri, originalPlaylistUri);
    assert.equal(recovery.deviceId, "pc");
  });
});
