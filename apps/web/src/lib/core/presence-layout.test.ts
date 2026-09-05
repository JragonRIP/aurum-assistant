import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  commandEscapeAction,
  coreLayoutMode,
  derivePresencePresentation,
  derivePresenceState,
  isAurumCommandHotkey,
  MINI_PRESENCE_ALLOWED,
  presenceShowsError,
  presenceStatusLabel,
  trustedActivityCaption,
} from "@aurum/shared";
import { presenceMotionProfile } from "@aurum/ui";
import {
  resolveClientDoneOutcome,
  resolveClientStreamError,
} from "../agent/generation-outcome";
import { tokenizeForReveal } from "../conversations/streaming-text";

const ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
);

const coreSource = readFileSync(
  join(ROOT, "apps/web/src/components/core/AurumCore.tsx"),
  "utf8",
);
const presenceSource = readFileSync(
  join(ROOT, "packages/ui/src/Presence.tsx"),
  "utf8",
);
const css = readFileSync(join(ROOT, "packages/ui/src/styles.css"), "utf8");

function presenceMounts(source: string): number {
  return (source.match(/<AurumPresence\b/g) ?? []).length;
}

describe("persistent Core layout", () => {
  it("1. large Core remains rendered during IDLE", () => {
    assert.equal(coreLayoutMode({ workspace: "home" }), "idle");
    assert.match(coreSource, /size="xl"/);
    assert.equal(presenceMounts(coreSource), 1);
  });

  it("2. large Core remains rendered during THINKING", () => {
    assert.equal(
      coreLayoutMode({ workspace: "session", streaming: true }),
      "active",
    );
    assert.equal(
      derivePresenceState({ aiConfigured: true, streaming: true }),
      "THINKING",
    );
    assert.equal(presenceMounts(coreSource), 1);
    assert.match(coreSource, /size="xl"/);
  });

  it("3. large Core remains rendered during ACTING", () => {
    assert.equal(
      derivePresenceState({
        aiConfigured: true,
        streaming: true,
        acting: true,
      }),
      "ACTING",
    );
    assert.equal(coreLayoutMode({ workspace: "session" }), "active");
    assert.equal(presenceMounts(coreSource), 1);
  });

  it("4. large Core remains rendered while responding", () => {
    assert.equal(
      derivePresencePresentation({
        state: "THINKING",
        streaming: true,
        hasResponseText: true,
        acting: false,
      }),
      "responding",
    );
    assert.equal(presenceStatusLabel({ presentation: "responding" }), "RESPONDING");
    assert.equal(presenceMounts(coreSource), 1);
    assert.match(coreSource, /size="xl"/);
  });

  it("5. large Core remains rendered during WAITING_FOR_APPROVAL", () => {
    assert.equal(
      derivePresenceState({
        aiConfigured: true,
        awaitingApproval: true,
      }),
      "WAITING_FOR_APPROVAL",
    );
    assert.equal(presenceMounts(coreSource), 1);
  });

  it("6. large Core remains rendered during ERROR", () => {
    assert.equal(
      derivePresenceState({ aiConfigured: true, error: true }),
      "ERROR",
    );
    assert.equal(presenceMounts(coreSource), 1);
  });

  it("7. large Core remains rendered during OFFLINE", () => {
    assert.equal(derivePresenceState({ aiConfigured: false }), "OFFLINE");
    assert.equal(presenceMounts(coreSource), 1);
  });

  it("8. mini top-right Core is no longer duplicated", () => {
    assert.equal(MINI_PRESENCE_ALLOWED, false);
    assert.equal(presenceMounts(coreSource), 1);
    assert.equal(/size="sm"/.test(coreSource), false);
    assert.equal(/data-size="sm"/.test(coreSource), false);
  });

  it("9. ERROR maps to red visual treatment", () => {
    assert.equal(presenceMotionProfile("ERROR", false).error, true);
    assert.match(css, /data-state="ERROR"[\s\S]*#a45a52/);
    assert.match(presenceSource, /ember/);
  });

  it("10. OFFLINE maps to dormant/dim treatment", () => {
    assert.equal(presenceMotionProfile("OFFLINE", false).offline, true);
    assert.equal(presenceMotionProfile("OFFLINE", false).rotate, false);
    assert.match(css, /data-state="OFFLINE"[\s\S]*animation:\s*none/);
    assert.match(css, /data-state="OFFLINE"[\s\S]*#3e3e44/);
  });

  it("11. IDLE maps to gold", () => {
    assert.equal(derivePresencePresentation({ state: "IDLE" }), "idle");
    assert.match(css, /\.acv-stroke-gold\s*\{\s*stroke:\s*#c4a574/);
  });

  it("12. THINKING maps to active gold", () => {
    assert.equal(
      derivePresencePresentation({ state: "THINKING", streaming: true }),
      "thinking",
    );
    assert.equal(presenceStatusLabel({ presentation: "thinking" }), "THINKING");
    assert.match(css, /data-presentation="thinking"[\s\S]*#d4b888/);
  });

  it("13. ACTING maps to execution animation", () => {
    assert.equal(presenceMotionProfile("ACTING", false).acting, true);
    assert.equal(presenceStatusLabel({ presentation: "acting" }), "WORKING");
    assert.equal(
      presenceStatusLabel({
        presentation: "acting",
        toolLabel: "Creating task",
      }),
      "CREATING TASK",
    );
    assert.equal(trustedActivityCaption("create_task"), null);
    assert.match(css, /data-state="ACTING"[\s\S]*acv-acting/);
  });

  it("14. committed-tool + final-response degradation does not falsely show full ERROR", () => {
    const handling = resolveClientStreamError({
      errorMessage: "wrap-up failed",
      actionsCommitted: true,
    });
    assert.equal(handling.errorMessage, null);
    assert.equal(handling.showFullError, false);
    assert.equal(
      derivePresenceState({
        aiConfigured: true,
        error: presenceShowsError({ error: handling.errorMessage }),
      }),
      "IDLE",
    );
    const done = resolveClientDoneOutcome({
      actionsCommitted: true,
      finalResponseStatus: "failed",
      usedFallbackResponse: false,
      allowFullRetry: false,
    });
    assert.equal(done.errorMessage, null);
    assert.equal(
      derivePresenceState({
        aiConfigured: true,
        error: presenceShowsError({ error: done.errorMessage }),
      }),
      "IDLE",
    );
  });

  it("15. genuine generation failure does show ERROR", () => {
    const handling = resolveClientStreamError({
      errorMessage: "Provider unavailable",
      actionsCommitted: false,
    });
    assert.equal(handling.showFullError, true);
    assert.equal(
      derivePresenceState({
        aiConfigured: true,
        error: presenceShowsError({ error: handling.errorMessage }),
      }),
      "ERROR",
    );
  });

  it("16. offline provider state shows OFFLINE, not disconnected services", () => {
    assert.equal(derivePresenceState({ aiConfigured: false }), "OFFLINE");
    assert.equal(derivePresenceState({ aiConfigured: true }), "IDLE");
    assert.equal(
      derivePresencePresentation({ state: "OFFLINE" }),
      "offline",
    );
  });

  it("17. reduced-motion behavior remains correct", () => {
    const thinking = presenceMotionProfile("THINKING", true, "thinking");
    assert.equal(thinking.rotate, false);
    assert.equal(thinking.thinking, false);
    const responding = presenceMotionProfile("THINKING", true, "responding");
    assert.equal(responding.responding, false);
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
  });

  it("18. Ctrl+Space still works", () => {
    assert.equal(
      isAurumCommandHotkey({ ctrlKey: true, metaKey: false, key: " " }),
      true,
    );
  });

  it("19. Esc still stops generation", () => {
    assert.equal(commandEscapeAction({ streaming: true }), "stop");
  });

  it("20. streaming remains progressive", () => {
    assert.deepEqual(tokenizeForReveal("Hello world"), ["Hello", " world"]);
  });

  it("21. tool ActionStatus remains correct", () => {
    assert.match(coreSource, /<ActionStatus/);
    assert.match(coreSource, /LiveActions/);
  });

  it("22. task surfaces remain correct", () => {
    assert.match(coreSource, /<TaskSurface/);
    assert.match(coreSource, /ContextualSurface/);
  });

  it("responding is a presentation substate, not SPEAKING", () => {
    assert.equal(
      derivePresenceState({ aiConfigured: true, streaming: true }),
      "THINKING",
    );
    assert.equal(
      derivePresencePresentation({
        state: "THINKING",
        streaming: true,
        hasResponseText: true,
      }),
      "responding",
    );
    const motion = presenceMotionProfile("THINKING", false, "responding");
    assert.equal(motion.responding, true);
    assert.equal(motion.acting, false);
  });
});
