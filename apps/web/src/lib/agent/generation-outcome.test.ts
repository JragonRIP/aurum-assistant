import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Part } from "@google/genai";
import type { ToolResult } from "@aurum/tools";
import {
  SKIP_THOUGHT_SIGNATURE,
  buildFallbackFromToolResults,
  finalizeModelPartsForReplay,
  mergeModelParts,
  partThoughtSignature,
} from "./agent-runner";
import {
  COMMITTED_ACTION_RESPONSE_WARNING,
  buildStreamOutcome,
  resolveClientDoneOutcome,
  resolveClientStreamError,
} from "./generation-outcome";

describe("thoughtSignature replay (Gemini 3)", () => {
  it("preserves thoughtSignature when merging later functionCall chunks", () => {
    let parts: Part[] = [];
    parts = mergeModelParts(parts, [
      {
        functionCall: { id: "c1", name: "create_task", args: { title: "Call Mike" } },
        thoughtSignature: "sig-real",
      },
    ]);
    parts = mergeModelParts(parts, [
      {
        functionCall: { id: "c1", name: "create_task", args: { title: "Call Mike" } },
      },
    ]);
    assert.equal(partThoughtSignature(parts[0]!), "sig-real");
  });

  it("attaches orphan thoughtSignature parts onto the first functionCall", () => {
    let parts: Part[] = [];
    parts = mergeModelParts(parts, [{ thoughtSignature: "sig-orphan" } as Part]);
    parts = mergeModelParts(parts, [
      {
        functionCall: { id: "c1", name: "create_task", args: {} },
      },
    ]);
    const finalized = finalizeModelPartsForReplay(parts);
    assert.equal(partThoughtSignature(finalized[0]!), "sig-orphan");
  });

  it("injects skip signature when stream dropped thoughtSignature", () => {
    const finalized = finalizeModelPartsForReplay([
      {
        functionCall: { id: "c1", name: "create_task", args: { title: "x" } },
      },
    ]);
    assert.equal(partThoughtSignature(finalized[0]!), SKIP_THOUGHT_SIGNATURE);
  });
});

describe("buildFallbackFromToolResults", () => {
  it("uses trusted ToolResult messages for success", () => {
    const text = buildFallbackFromToolResults([
      {
        success: true,
        message: "Task created successfully: Call Mike (2026-09-05).",
        activityLabel: "Task created",
      },
    ] as unknown as ToolResult[]);
    assert.match(text, /Call Mike/);
  });

  it("reports partial success across tools", () => {
    const text = buildFallbackFromToolResults([
      {
        success: true,
        message: "Task created.",
      },
      {
        success: false,
        error: { code: "EXECUTION_FAILED", message: "Note not saved." },
      },
    ] as unknown as ToolResult[]);
    assert.match(text, /Task created/);
    assert.match(text, /Note not saved/);
  });
});

describe("GenerationOutcome / client reconciliation", () => {
  it("1. tool succeeds + final response succeeds → allow idle, no warning", () => {
    const outcome = buildStreamOutcome({
      actionsCommitted: true,
      finalResponseStatus: "completed",
      usedFallbackResponse: false,
    });
    assert.equal(outcome.allowFullRetry, false);
    assert.equal(outcome.warning, undefined);
    const client = resolveClientDoneOutcome(outcome);
    assert.equal(client.showFullError, false);
    assert.equal(client.responseWarning, null);
  });

  it("2. tool succeeds + Gemini continuation fails → soft warning, no full error", () => {
    const outcome = buildStreamOutcome({
      actionsCommitted: true,
      finalResponseStatus: "failed",
      usedFallbackResponse: true,
    });
    assert.equal(outcome.allowFullRetry, false);
    assert.equal(outcome.warning, COMMITTED_ACTION_RESPONSE_WARNING);
    const client = resolveClientDoneOutcome(outcome);
    assert.equal(client.showFullError, false);
    assert.equal(client.errorMessage, null);
    assert.equal(client.allowFullRetry, false);
    assert.equal(client.responseWarning, COMMITTED_ACTION_RESPONSE_WARNING);
  });

  it("3. tool succeeds + provider 503 after execution → late error does not erase success", () => {
    const handling = resolveClientStreamError({
      errorMessage: "Aurum could not complete that request. Please try again.",
      actionsCommitted: true,
      allowFullRetry: true,
    });
    assert.equal(handling.showFullError, false);
    assert.equal(handling.preserveCommittedActions, true);
    assert.equal(handling.allowFullRetry, false);
  });

  it("4. successful action is not changed to failure by late error + sawToolSucceeded", () => {
    const handling = resolveClientStreamError({
      errorMessage: "BAD REQUEST",
      sawToolSucceeded: true,
    });
    assert.equal(handling.preserveCommittedActions, true);
    assert.equal(handling.errorMessage, null);
  });

  it("5. full-request Retry is not offered after committed write", () => {
    const outcome = buildStreamOutcome({
      actionsCommitted: true,
      finalResponseStatus: "failed",
      usedFallbackResponse: true,
    });
    assert.equal(outcome.allowFullRetry, false);
  });

  it("6. response-only retry is omitted (allowFullRetry false; no write repeat path)", () => {
    // Phase 3: we omit Retry entirely after committed writes rather than
    // implementing a separate response-only retry that could re-run tools.
    const client = resolveClientDoneOutcome(
      buildStreamOutcome({
        actionsCommitted: true,
        finalResponseStatus: "failed",
        usedFallbackResponse: true,
      }),
    );
    assert.equal(client.allowFullRetry, false);
  });

  it("7. TaskSurface survival is implied by preserveCommittedActions", () => {
    const handling = resolveClientStreamError({
      errorMessage: "stream closed",
      sawToolSucceeded: true,
    });
    assert.equal(handling.preserveCommittedActions, true);
  });

  it("8. one successful tool → actionsCommitted true (idempotency contract)", () => {
    const outcome = buildStreamOutcome({
      actionsCommitted: true,
      finalResponseStatus: "completed",
      usedFallbackResponse: false,
    });
    assert.equal(outcome.actionsCommitted, true);
  });

  it("9. two tools: one succeeds, one fails → fallback shows both", () => {
    const text = buildFallbackFromToolResults([
      {
        success: true,
        message: "Task created.",
      },
      {
        success: false,
        error: { code: "X", message: "Note not saved." },
      },
    ] as unknown as ToolResult[]);
    assert.ok(text.includes("Task created"));
    assert.ok(text.includes("Note not saved"));
    const outcome = buildStreamOutcome({
      actionsCommitted: true,
      finalResponseStatus: "failed",
      usedFallbackResponse: true,
    });
    assert.equal(outcome.actionsCommitted, true);
    assert.equal(outcome.allowFullRetry, false);
  });

  it("10. two tools succeed + final AI continuation fails", () => {
    const outcome = buildStreamOutcome({
      actionsCommitted: true,
      finalResponseStatus: "failed",
      usedFallbackResponse: true,
    });
    assert.equal(outcome.allowFullRetry, false);
    assert.equal(outcome.warning, COMMITTED_ACTION_RESPONSE_WARNING);
  });

  it("11. tool fails before any write → normal full error + retry allowed", () => {
    const outcome = buildStreamOutcome({
      actionsCommitted: false,
      finalResponseStatus: "failed",
      usedFallbackResponse: false,
    });
    assert.equal(outcome.allowFullRetry, true);
    const handling = resolveClientStreamError({
      errorMessage: "Aurum could not complete that request. Please try again.",
      actionsCommitted: false,
      allowFullRetry: true,
    });
    assert.equal(handling.showFullError, true);
    assert.equal(handling.allowFullRetry, true);
    assert.equal(handling.preserveCommittedActions, false);
  });

  it("12. cancellation after committed write preserves success (no full retry)", () => {
    const outcome = buildStreamOutcome({
      actionsCommitted: true,
      finalResponseStatus: "cancelled",
      usedFallbackResponse: false,
      cancelled: true,
    });
    assert.equal(outcome.allowFullRetry, false);
    assert.equal(outcome.actionsCommitted, true);
  });
});
