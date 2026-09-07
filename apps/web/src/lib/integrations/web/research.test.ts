import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDefaultRegistry } from "@aurum/tools";
import { isBlockedHostname, assertPublicHttpUrl } from "./ssrf";
import {
  classifyContent,
  sniffMime,
  isAllowedDownload,
} from "./content-validate";
import { parseDuckDuckGoHtml, runWebAction } from "./research";

describe("web research parsing", () => {
  it("parses DuckDuckGo HTML result anchors", () => {
    const html = `
      <div class="result">
        <a rel="nofollow" class="result__a" href="https://example.com/lambo">Lamborghini news</a>
        <a class="result__snippet">The latest flagship model details.</a>
      </div>
      <div class="result">
        <a class="result__a" href="https://cars.example.org/revuelto">Revuelto</a>
      </div>
    `;
    const hits = parseDuckDuckGoHtml(html);
    assert.ok(hits.length >= 1);
    assert.equal(hits[0]?.domain, "example.com");
    assert.match(hits[0]?.title ?? "", /Lamborghini/i);
  });

  it("rejects empty search query", async () => {
    const result = await runWebAction({ action: "search", input: { query: "  " } });
    assert.equal(result.success, false);
    assert.equal(result.error?.code, "VALIDATION_ERROR");
  });

  it("rejects non-http page reads", async () => {
    const result = await runWebAction({
      action: "read_page",
      input: { url: "file:///etc/passwd" },
    });
    assert.equal(result.success, false);
    assert.equal(result.error?.code, "INVALID_URL");
  });

  it("rejects private-network page reads", async () => {
    const result = await runWebAction({
      action: "read_page",
      input: { url: "http://127.0.0.1/secret" },
    });
    assert.equal(result.success, false);
    assert.equal(result.error?.code, "INVALID_URL");
  });

  it("marks fetched page payloads as untrusted data", async () => {
    const result = await runWebAction({
      action: "read_page",
      input: { url: "https://example.invalid/prompt-injection" },
    });
    if (result.success && result.data && typeof result.data === "object") {
      const data = result.data as { untrustedContent?: string; text?: string };
      assert.match(data.untrustedContent ?? "", /untrusted/i);
      assert.ok(typeof data.text === "string");
    } else {
      assert.equal(result.success, false);
    }
    const r = createDefaultRegistry();
    assert.equal(r.get("terminate_process")?.permission, "CONFIRM");
    assert.equal(r.get("web_read_page")?.permission, "READ");
  });
});

describe("ssrf guards", () => {
  it("blocks localhost and RFC1918", () => {
    assert.equal(isBlockedHostname("localhost"), true);
    assert.equal(isBlockedHostname("127.0.0.1"), true);
    assert.equal(isBlockedHostname("10.0.0.5"), true);
    assert.equal(isBlockedHostname("192.168.1.1"), true);
    assert.equal(isBlockedHostname("169.254.169.254"), true);
    assert.equal(isBlockedHostname("example.com"), false);
  });

  it("rejects private URLs via assertPublicHttpUrl", () => {
    assert.throws(() => assertPublicHttpUrl("http://192.168.0.1/x"));
    assert.throws(() => assertPublicHttpUrl("file:///etc/passwd"));
  });
});

describe("download content validation", () => {
  it("sniffs jpeg/png and blocks PE executables", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    assert.equal(sniffMime(jpeg), "image/jpeg");
    assert.equal(classifyContent("image/jpeg"), "image");
    assert.equal(isAllowedDownload("image"), true);

    const pe = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
    assert.equal(sniffMime(pe), "application/x-msdownload");
    assert.equal(classifyContent("application/x-msdownload"), "dangerous");
    assert.equal(isAllowedDownload("dangerous"), false);
  });

  it("blocks dangerous extensions", () => {
    assert.equal(classifyContent("image/jpeg", "photo.exe"), "dangerous");
  });
});

describe("web tools registry", () => {
  it("registers background research tools as READ cloud tools", () => {
    const r = createDefaultRegistry();
    assert.equal(r.get("web_search")?.permission, "READ");
    assert.equal(r.get("web_search")?.environment, "CLOUD");
    assert.equal(r.get("web_read_page")?.permission, "READ");
    assert.equal(r.get("web_image_search")?.permission, "READ");
    assert.equal(r.get("web_download_file")?.permission, "SAFE_WRITE");
    assert.equal(r.get("list_approved_folders")?.permission, "READ");
  });

  it("keeps open_search as browser-open SAFE_WRITE", () => {
    const r = createDefaultRegistry();
    assert.equal(r.get("open_search")?.permission, "SAFE_WRITE");
  });

  it("registers memory tools as READ/SAFE_WRITE without shell", () => {
    const r = createDefaultRegistry();
    assert.equal(r.get("memory_search")?.permission, "READ");
    assert.equal(r.get("memory_remember")?.permission, "SAFE_WRITE");
    assert.equal(r.get("memory_forget")?.permission, "SAFE_WRITE");
    assert.equal(r.get("run_command"), undefined);
  });

  it("registers Spotify playlist + queue tools with expected permissions", () => {
    const r = createDefaultRegistry();
    assert.equal(r.get("spotify_create_playlist")?.permission, "SAFE_WRITE");
    assert.equal(r.get("spotify_add_tracks_to_playlist")?.permission, "SAFE_WRITE");
    assert.equal(r.get("spotify_remove_tracks_from_playlist")?.permission, "CONFIRM");
    assert.equal(r.get("spotify_get_queue")?.permission, "READ");
    assert.equal(r.get("spotify_clear_queue")?.permission, "SAFE_WRITE");
    assert.equal(r.get("spotify_set_playlist_cover")?.permission, "SAFE_WRITE");
  });
});
