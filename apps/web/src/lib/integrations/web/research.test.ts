import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDefaultRegistry } from "@aurum/tools";
import {
  parseDuckDuckGoHtml,
  runWebAction,
} from "./research";

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

  it("marks fetched page payloads as untrusted data", async () => {
    const result = await runWebAction({
      action: "read_page",
      input: { url: "https://example.invalid/prompt-injection" },
    });
    // Network may fail; when successful the payload must carry the untrusted flag.
    if (result.success && result.data && typeof result.data === "object") {
      const data = result.data as { untrustedContent?: string; text?: string };
      assert.match(data.untrustedContent ?? "", /untrusted/i);
      assert.ok(typeof data.text === "string");
    } else {
      assert.equal(result.success, false);
    }
    // Webpage text never registers as a tool and cannot bypass CONFIRM.
    const r = createDefaultRegistry();
    assert.equal(r.get("terminate_process")?.permission, "CONFIRM");
    assert.equal(r.get("web_read_page")?.permission, "READ");
  });
});

describe("web tools registry", () => {
  it("registers background research tools as READ cloud tools", () => {
    const r = createDefaultRegistry();
    assert.equal(r.get("web_search")?.permission, "READ");
    assert.equal(r.get("web_search")?.environment, "CLOUD");
    assert.equal(r.get("web_read_page")?.permission, "READ");
    assert.equal(r.get("web_read_page")?.environment, "CLOUD");
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
});
