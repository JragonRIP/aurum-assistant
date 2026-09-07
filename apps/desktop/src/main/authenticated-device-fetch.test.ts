import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  authenticatedDeviceFetch,
  deviceAuthHeader,
} from "./authenticated-device-fetch";
import type { DeviceCredential } from "./credentials";

const cred: DeviceCredential = {
  deviceId: "11111111-2222-3333-4444-555555555555",
  deviceSecret: "secret-value",
  deviceName: "Test",
  webUrl: "https://aurum-assistant.vercel.app",
};

describe("authenticatedDeviceFetch", () => {
  it("builds canonical Bearer deviceId.deviceSecret", () => {
    assert.equal(
      deviceAuthHeader(cred),
      "Bearer 11111111-2222-3333-4444-555555555555.secret-value",
    );
  });

  it("attaches Authorization for JSON requests", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    try {
      await authenticatedDeviceFetch(cred, "/api/devices/voice/synthesize", {
        method: "POST",
        body: JSON.stringify({ text: "hi" }),
      });
      assert.equal(calls.length, 1);
      const headers = new Headers(calls[0]!.init.headers);
      assert.equal(headers.get("Authorization"), deviceAuthHeader(cred));
      assert.equal(headers.get("Content-Type"), "application/json");
      assert.match(calls[0]!.url, /\/api\/devices\/voice\/synthesize$/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("preserves Authorization for FormData and does not set Content-Type", async () => {
    const calls: Array<{ init: RequestInit }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ init: init ?? {} });
      return new Response(JSON.stringify({ transcript: "hello" }), {
        status: 200,
      });
    }) as typeof fetch;

    try {
      const form = new FormData();
      form.append("audio", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }), "ptt.webm");
      await authenticatedDeviceFetch(cred, "/api/devices/voice/transcribe", {
        method: "POST",
        body: form,
      });
      const headers = new Headers(calls[0]!.init.headers);
      assert.equal(headers.get("Authorization"), deviceAuthHeader(cred));
      assert.equal(headers.get("Content-Type"), null);
      assert.ok(calls[0]!.init.body instanceof FormData);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("voice bridge auth wiring", () => {
  it("voice-bridge uses authenticatedDeviceFetch for STT and TTS", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(__dirname, "voice-bridge.ts"), "utf8");
    assert.match(src, /authenticatedDeviceFetch/);
    assert.match(src, /\/api\/devices\/voice\/transcribe/);
    assert.match(src, /\/api\/devices\/voice\/synthesize/);
    assert.doesNotMatch(src, /Authorization:\s*`Bearer/);
  });

  it("overlay chat uses authenticatedDeviceFetch", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(__dirname, "overlay-chat.ts"), "utf8");
    assert.match(src, /authenticatedDeviceFetch/);
    assert.match(src, /\/api\/devices\/assistant\/chat/);
  });
});

void mock;
