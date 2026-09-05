/**
 * Constrained keyboard shortcuts via Win32 keybd_event.
 * No arbitrary keystroke strings. No macros.
 */
import koffi from "koffi";
import type { DeviceToolResult } from "./windows-tools";

const VK_CONTROL = 0x11;
const VK_C = 0x43;
const VK_V = 0x56;
const VK_X = 0x58;
const VK_Z = 0x5a;
const VK_Y = 0x59;
const VK_A = 0x41;
const VK_S = 0x53;
const VK_F = 0x46;
const VK_ESCAPE = 0x1b;
const VK_RETURN = 0x0d;
const VK_TAB = 0x09;
const VK_LEFT = 0x25;
const VK_UP = 0x26;
const VK_RIGHT = 0x27;
const VK_DOWN = 0x28;
const VK_BACK = 0x08;
const VK_DELETE = 0x2e;
const VK_HOME = 0x24;
const VK_END = 0x23;
const VK_PRIOR = 0x21;
const VK_NEXT = 0x22;

export type ShortcutAction =
  | "copy"
  | "paste"
  | "cut"
  | "undo"
  | "redo"
  | "select_all"
  | "save"
  | "find"
  | "escape"
  | "enter"
  | "tab"
  | "arrow_left"
  | "arrow_right"
  | "arrow_up"
  | "arrow_down"
  | "backspace"
  | "delete"
  | "home"
  | "end"
  | "page_up"
  | "page_down";

const SHORTCUT_SEQ: Record<ShortcutAction, number[]> = {
  copy: [VK_CONTROL, VK_C],
  paste: [VK_CONTROL, VK_V],
  cut: [VK_CONTROL, VK_X],
  undo: [VK_CONTROL, VK_Z],
  redo: [VK_CONTROL, VK_Y],
  select_all: [VK_CONTROL, VK_A],
  save: [VK_CONTROL, VK_S],
  find: [VK_CONTROL, VK_F],
  escape: [VK_ESCAPE],
  enter: [VK_RETURN],
  tab: [VK_TAB],
  arrow_left: [VK_LEFT],
  arrow_right: [VK_RIGHT],
  arrow_up: [VK_UP],
  arrow_down: [VK_DOWN],
  backspace: [VK_BACK],
  delete: [VK_DELETE],
  home: [VK_HOME],
  end: [VK_END],
  page_up: [VK_PRIOR],
  page_down: [VK_NEXT],
};

let user32: ReturnType<typeof koffi.load> | null = null;

function getUser32() {
  if (!user32) user32 = koffi.load("user32.dll");
  return user32;
}

function tapKey(vk: number, up: boolean): void {
  const keybd_event = getUser32().func(
    "keybd_event",
    "void",
    ["uint8", "uint8", "uint32", "uintptr"],
  );
  keybd_event(vk, 0, up ? 2 : 0, 0);
}

export function pressShortcut(action: ShortcutAction): DeviceToolResult {
  if (process.platform !== "win32") {
    return {
      success: false,
      error: { code: "UNSUPPORTED", message: "Windows only." },
    };
  }
  const seq = SHORTCUT_SEQ[action];
  if (!seq) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Unknown shortcut." },
    };
  }
  try {
    for (const vk of seq) tapKey(vk, false);
    for (let i = seq.length - 1; i >= 0; i--) tapKey(seq[i]!, true);
    return {
      success: true,
      data: { action, activityLabel: `Shortcut · ${action}` },
      message: `Sent ${action.replace(/_/g, " ")}.`,
    };
  } catch {
    return {
      success: false,
      error: { code: "EXECUTION_FAILED", message: "Could not send shortcut." },
    };
  }
}

/** UI Automation inspect/invoke — deferred (no unsafe generic bridge). */
export function uiAutomationUnsupported(op: string): DeviceToolResult {
  return {
    success: false,
    error: {
      code: "CAPABILITY_UNSUPPORTED",
      message: `UI Automation “${op}” isn't available in this build. Use keyboard shortcuts or window tools.`,
    },
  };
}
