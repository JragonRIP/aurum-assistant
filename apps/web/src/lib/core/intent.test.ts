import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BOTTOM_RAIL,
  CORE_HREF,
  MAIN_NAV,
  NAV_SECTIONS,
  PRIMARY_RAIL,
  RAIL_ITEMS,
  commandEscapeAction,
  coreStatusLine,
  countUnavailableServices,
  derivePresenceState,
  firstNameFromDisplayName,
  formatGreeting,
  inferContextualSurface,
  isAurumCommandHotkey,
  isCorePath,
  isProperDisplayName,
  operationalLine,
  parseRailExpanded,
  presenceShouldAnimate,
  railHasDuplicateHomeAndCore,
  resolveNavigationIntent,
  resolveTrustedNavigation,
  serializeRailExpanded,
} from "@aurum/shared";

describe("inferContextualSurface", () => {
  it("routes schedule questions to the schedule surface", () => {
    assert.equal(
      inferContextualSurface("What's on my schedule?"),
      "schedule",
    );
  });

  it("routes task requests to the task surface", () => {
    assert.equal(inferContextualSurface("Show me my tasks."), "task");
    assert.equal(
      inferContextualSurface("Create a task to call him tomorrow."),
      "task",
    );
    assert.equal(inferContextualSurface("What do I have tomorrow?"), "task");
  });

  it("routes a named client lookup without treating generic questions as clients", () => {
    assert.equal(inferContextualSurface("Show me Darnell"), "client");
    assert.equal(inferContextualSurface("help me write a letter"), "response");
  });

  it("routes business questions to business intelligence", () => {
    assert.equal(
      inferContextualSurface("How is the business doing?"),
      "business",
    );
  });
});

describe("greeting and identity", () => {
  it("does not invent a name", () => {
    assert.equal(firstNameFromDisplayName(null), null);
    assert.equal(
      formatGreeting({ displayName: null, now: new Date("2026-09-04T15:00:00") }),
      "Good afternoon.",
    );
    assert.equal(
      formatGreeting({
        displayName: "James Rago",
        now: new Date("2026-09-04T15:00:00"),
      }),
      "Good afternoon, James.",
    );
  });

  it("does not show email or username handles", () => {
    assert.equal(isProperDisplayName("jrago"), false);
    assert.equal(isProperDisplayName("james.rago"), false);
    assert.equal(isProperDisplayName("james@example.com"), false);
    assert.equal(isProperDisplayName("JRAGO"), false);
    assert.equal(
      formatGreeting({
        displayName: "jrago",
        now: new Date("2026-09-04T15:00:00"),
      }),
      "Good afternoon.",
    );
    assert.equal(isProperDisplayName("James"), true);
  });

  it("is honest about Core availability", () => {
    assert.equal(operationalLine(true), "Aurum Core is online.");
    assert.equal(operationalLine(false), "Aurum Core is offline.");
    assert.equal(
      coreStatusLine({ aiOnline: true, unavailableCount: 2 }),
      "Core online · 2 services unavailable",
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
});

describe("derivePresenceState", () => {
  it("maps chat states without fabricating voice", () => {
    assert.equal(derivePresenceState({ aiConfigured: false }), "OFFLINE");
    assert.equal(
      derivePresenceState({ aiConfigured: true, streaming: true }),
      "THINKING",
    );
    assert.equal(
      derivePresenceState({ aiConfigured: true, error: true }),
      "ERROR",
    );
    assert.equal(derivePresenceState({ aiConfigured: true }), "IDLE");
    assert.equal(
      derivePresenceState({ aiConfigured: true, awaitingApproval: true }),
      "WAITING_FOR_APPROVAL",
    );
  });

  it("disables Core animation when reduced motion is preferred", () => {
    assert.equal(presenceShouldAnimate(true), false);
    assert.equal(presenceShouldAnimate(false), true);
  });
});

describe("navigation architecture", () => {
  it("makes Core the canonical home at /", () => {
    assert.equal(CORE_HREF, "/");
    assert.equal(isCorePath("/"), true);
    assert.equal(isCorePath("/core"), true);
    assert.equal(isCorePath("/assistant"), true);
    assert.equal(isCorePath("/tasks"), false);
    assert.equal(PRIMARY_RAIL[0]?.id, "core");
    assert.equal(PRIMARY_RAIL[0]?.href, "/");
    assert.equal(PRIMARY_RAIL[0]?.label, "Core");
  });

  it("does not duplicate Home and Core", () => {
    assert.equal(railHasDuplicateHomeAndCore(RAIL_ITEMS), false);
    assert.equal(
      RAIL_ITEMS.some((item) => item.label === "Home"),
      false,
    );
    assert.equal(
      RAIL_ITEMS.filter((item) => item.id === "core").length,
      1,
    );
  });

  it("collapsed rail renders primary destinations only", () => {
    const ids = PRIMARY_RAIL.map((item) => item.id);
    assert.deepEqual(ids, [
      "core",
      "search",
      "tasks",
      "calendar",
      "business",
      "files",
    ]);
    assert.equal(ids.includes("today"), false);
    assert.equal(ids.includes("clients"), false);
    assert.equal(ids.includes("leads"), false);
    assert.equal(ids.includes("devices"), false);
    assert.equal(ids.includes("memory"), false);
    assert.equal(ids.includes("automations"), false);
  });

  it("expanded rail keeps the same restrained destinations", () => {
    const bottom = BOTTOM_RAIL.map((item) => item.id);
    assert.deepEqual(bottom, ["activity", "settings", "account"]);
    assert.equal(RAIL_ITEMS.some((item) => item.href === "/assistant"), false);
  });

  it("persists rail expanded preference", () => {
    assert.equal(parseRailExpanded("1"), true);
    assert.equal(parseRailExpanded("0"), false);
    assert.equal(parseRailExpanded(null), false);
    assert.equal(serializeRailExpanded(true), "1");
  });

  it("keeps secondary destinations for deep links without putting them on the rail", () => {
    const ids = MAIN_NAV.map((item) => item.id);
    assert.ok(ids.includes("clients"));
    assert.ok(ids.includes("leads"));
    assert.ok(ids.includes("devices"));
    assert.ok(NAV_SECTIONS.some((s) => s.id === "business"));
    assert.ok(NAV_SECTIONS.some((s) => s.id === "system"));
    assert.equal(
      PRIMARY_RAIL.some((item) => item.id === "clients"),
      false,
    );
  });
});

describe("command interface contracts", () => {
  it("treats Ctrl+Space as the Aurum command hotkey", () => {
    assert.equal(
      isAurumCommandHotkey({ ctrlKey: true, metaKey: false, key: " " }),
      true,
    );
    assert.equal(
      isAurumCommandHotkey({ ctrlKey: false, metaKey: true, key: " " }),
      true,
    );
    assert.equal(
      isAurumCommandHotkey({ ctrlKey: true, metaKey: false, key: "k" }),
      false,
    );
  });

  it("Esc stops a stream and otherwise cancels", () => {
    assert.equal(commandEscapeAction({ streaming: true }), "stop");
    assert.equal(commandEscapeAction({ streaming: false }), "cancel");
  });
});

describe("trusted navigation", () => {
  const TASK_ID = "11111111-1111-4111-8111-111111111111";

  it("resolves trusted task and workspace intents", () => {
    assert.equal(resolveNavigationIntent({ destination: "core" }), "/");
    assert.equal(resolveNavigationIntent({ destination: "tasks" }), "/tasks");
    assert.equal(resolveNavigationIntent({ destination: "today" }), "/today");
    assert.equal(
      resolveNavigationIntent({ destination: "task", entityId: TASK_ID }),
      `/tasks/${TASK_ID}`,
    );
  });

  it("rejects arbitrary model URLs", () => {
    assert.equal(
      resolveTrustedNavigation({ url: "https://evil.example/x" }),
      null,
    );
    assert.equal(resolveTrustedNavigation({ href: "/tasks/nope" }), null);
    assert.equal(resolveTrustedNavigation("/files/secret"), null);
    assert.equal(
      resolveTrustedNavigation({
        destination: "task",
        entityId: TASK_ID,
      }),
      `/tasks/${TASK_ID}`,
    );
  });
});
