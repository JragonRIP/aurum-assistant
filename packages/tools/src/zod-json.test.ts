import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { zodToJsonSchema } from "./zod-json";

describe("zodToJsonSchema", () => {
  it("maps object fields and required keys", () => {
    const schema = z.object({
      title: z.string(),
      priority: z.enum(["LOW", "NORMAL"]).optional(),
    });
    const json = zodToJsonSchema(schema);
    assert.equal(json.type, "OBJECT");
    assert.ok((json.properties as Record<string, unknown>).title);
    assert.deepEqual(json.required, ["title"]);
  });
});
