import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CORE_HREF,
  PRIMARY_RAIL,
  commandEscapeAction,
  coreStatusLine,
  countUnavailableServices,
  dedupeRecents,
  formatGreeting,
  isCorePath,
  isProperDisplayName,
  presenceShouldAnimate,
  resolveTrustedNavigation,
  sanitizeEntityHref,
  taskHref,
} from "@aurum/shared";

const TASK_ID = "11111111-1111-4111-8111-111111111111";

describe("phase 3.6 ambient OS contracts", () => {
  it("1. / resolves to Core", () => {
    assert.equal(CORE_HREF, "/");
    assert.equal(isCorePath("/"), true);
  });

  it("2. /assistant is treated as Core", () => {
    assert.equal(isCorePath("/assistant"), true);
  });

  it("3. no duplicate Home/Core rail items", () => {
    assert.equal(
      PRIMARY_RAIL.filter((item) => item.label === "Home").length,
      0,
    );
    assert.equal(PRIMARY_RAIL.filter((item) => item.id === "core").length, 1);
  });

  it("9–11. trusted task navigation; arbitrary URLs rejected", () => {
    assert.equal(
      resolveTrustedNavigation({
        destination: "task",
        entityId: TASK_ID,
      }),
      `/tasks/${TASK_ID}`,
    );
    assert.equal(taskHref(TASK_ID), `/tasks/${TASK_ID}`);
    assert.equal(sanitizeEntityHref("https://evil.example"), null);
    assert.equal(
      resolveTrustedNavigation({ url: "https://evil.example/x" }),
      null,
    );
  });

  it("16–18. empty today / calendar / health stay honest", () => {
    assert.equal(
      coreStatusLine({ aiOnline: true, unavailableCount: 3 }),
      "Core online · 3 services unavailable",
    );
    assert.equal(
      countUnavailableServices({
        memory: "NOT CONFIGURED",
        desktop: "NOT CONNECTED",
        calendar: "NOT CONNECTED",
      }),
      3,
    );
  });

  it("19. missing profile name does not fabricate a handle", () => {
    assert.equal(isProperDisplayName("user_alpha"), false);
    assert.equal(
      formatGreeting({
        displayName: "user_alpha",
        now: new Date("2026-09-04T09:00:00"),
      }),
      "Good morning.",
    );
  });

  it("20. reduced-motion disables Core animation", () => {
    assert.equal(presenceShouldAnimate(true), false);
  });

  it("8. Esc still maps to stop-or-cancel", () => {
    assert.equal(commandEscapeAction({ streaming: true }), "stop");
  });

  it("14. recents keep a single object for repeated task updates", () => {
    const recents = dedupeRecents(
      [
        {
          entityType: "task",
          entityId: TASK_ID,
          href: `/tasks/${TASK_ID}`,
          detail: "Call Mike",
          label: "TASK UPDATED",
          state: "success",
          createdAt: "2026-09-04T18:00:00.000Z",
        },
        {
          entityType: "task",
          entityId: TASK_ID,
          href: `/tasks/${TASK_ID}`,
          detail: "Call Mike",
          label: "TASK UPDATED",
          state: "success",
          createdAt: "2026-09-04T17:00:00.000Z",
        },
      ],
      5,
    );
    assert.equal(recents.length, 1);
  });
});
