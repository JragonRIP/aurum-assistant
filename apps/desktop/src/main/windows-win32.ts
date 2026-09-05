/**
 * Constrained Win32 helpers via koffi (user32 / kernel32 only).
 * No PowerShell. No model-supplied command strings.
 */
import koffi from "koffi";

const VK_MEDIA_NEXT = 0xb0;
const VK_MEDIA_PREV = 0xb1;
const VK_MEDIA_STOP = 0xb2;
const VK_MEDIA_PLAY_PAUSE = 0xb3;

let user32: ReturnType<typeof koffi.load> | null = null;
let kernel32: ReturnType<typeof koffi.load> | null = null;

function getUser32() {
  if (!user32) user32 = koffi.load("user32.dll");
  return user32;
}

function getKernel32() {
  if (!kernel32) kernel32 = koffi.load("kernel32.dll");
  return kernel32;
}

export function tapMediaKey(
  which: "next" | "previous" | "stop" | "play_pause",
): void {
  if (process.platform !== "win32") {
    throw new Error("Windows only");
  }
  const vk =
    which === "next"
      ? VK_MEDIA_NEXT
      : which === "previous"
        ? VK_MEDIA_PREV
        : which === "stop"
          ? VK_MEDIA_STOP
          : VK_MEDIA_PLAY_PAUSE;
  const u32 = getUser32();
  const keybd_event = u32.func(
    "keybd_event",
    "void",
    ["uint8", "uint8", "uint32", "uintptr"],
  );
  keybd_event(vk, 0, 0, 0);
  keybd_event(vk, 0, 2, 0);
}

export function showWindow(hwnd: number, cmdShow: number): void {
  const u32 = getUser32();
  const ShowWindow = u32.func("ShowWindow", "bool", ["void *", "int"]);
  ShowWindow(hwnd, cmdShow);
}

export function setForegroundWindow(hwnd: number): void {
  const u32 = getUser32();
  const SetForegroundWindow = u32.func("SetForegroundWindow", "bool", [
    "void *",
  ]);
  SetForegroundWindow(hwnd);
}

export function postCloseWindow(hwnd: number): void {
  const u32 = getUser32();
  const PostMessageW = u32.func("PostMessageW", "bool", [
    "void *",
    "uint32",
    "void *",
    "void *",
  ]);
  PostMessageW(hwnd, 0x0010 /*WM_CLOSE*/, null, null);
}

export function setWindowPos(
  hwnd: number,
  x: number,
  y: number,
  cx: number,
  cy: number,
  flags: number,
): void {
  const u32 = getUser32();
  const SetWindowPos = u32.func("SetWindowPos", "bool", [
    "void *",
    "void *",
    "int",
    "int",
    "int",
    "int",
    "uint32",
  ]);
  SetWindowPos(hwnd, null, x, y, cx, cy, flags);
}

export type EnumeratedWindow = {
  hwnd: number;
  title: string;
  processId: number;
};

let enumWindowsProcType: ReturnType<typeof koffi.proto> | null = null;
let enumWindowsFn: ((cb: unknown, lParam: number) => boolean) | null = null;

function getEnumWindows() {
  if (!enumWindowsProcType) {
    enumWindowsProcType = koffi.proto(
      "bool __stdcall EnumWindowsProc(void *hwnd, intptr lParam)",
    );
  }
  if (!enumWindowsFn) {
    const u32 = getUser32();
    enumWindowsFn = u32.func("EnumWindows", "bool", [
      koffi.pointer(enumWindowsProcType),
      "intptr",
    ]) as (cb: unknown, lParam: number) => boolean;
  }
  return { EnumWindowsProc: enumWindowsProcType, EnumWindows: enumWindowsFn };
}

export function enumerateOpenWindows(limit = 40): EnumeratedWindow[] {
  if (process.platform !== "win32") return [];
  const u32 = getUser32();
  const GetWindowTextLengthW = u32.func("GetWindowTextLengthW", "int", [
    "void *",
  ]);
  const GetWindowTextW = u32.func("GetWindowTextW", "int", [
    "void *",
    "void *",
    "int",
  ]);
  const IsWindowVisible = u32.func("IsWindowVisible", "bool", ["void *"]);
  const GetWindowThreadProcessId = u32.func(
    "GetWindowThreadProcessId",
    "uint32",
    ["void *", "_Out_ uint32 *"],
  );

  const results: EnumeratedWindow[] = [];
  const { EnumWindowsProc, EnumWindows } = getEnumWindows();

  const cb = koffi.register((hwnd: object) => {
    if (results.length >= limit) return false;
    if (!IsWindowVisible(hwnd)) return true;
    const len = GetWindowTextLengthW(hwnd);
    if (len <= 0) return true;
    const buf = Buffer.alloc((len + 1) * 2);
    GetWindowTextW(hwnd, buf, len + 1);
    const title = buf.toString("utf16le").replace(/\0+$/, "").trim();
    if (!title) return true;
    const pidOut = [0];
    GetWindowThreadProcessId(hwnd, pidOut);
    const hwndNum = Number(BigInt(koffi.address(hwnd)));
    results.push({
      hwnd: hwndNum,
      title,
      processId: pidOut[0] ?? 0,
    });
    return true;
  }, koffi.pointer(EnumWindowsProc));

  try {
    EnumWindows(cb, 0);
  } finally {
    koffi.unregister(cb);
  }
  return results;
}

export type PowerStatusNative = {
  onBattery: boolean;
  percent: number | null;
};

export function getNativePowerStatus(): PowerStatusNative {
  if (process.platform !== "win32") {
    return { onBattery: false, percent: null };
  }
  const SYSTEM_POWER_STATUS = koffi.struct("SYSTEM_POWER_STATUS", {
    ACLineStatus: "uint8",
    BatteryFlag: "uint8",
    BatteryLifePercent: "uint8",
    SystemStatusFlag: "uint8",
    BatteryLifeTime: "uint32",
    BatteryFullLifeTime: "uint32",
  });
  const k32 = getKernel32();
  const GetSystemPowerStatus = k32.func("GetSystemPowerStatus", "bool", [
    "_Out_ SYSTEM_POWER_STATUS *",
  ]);
  const status = {};
  const ok = GetSystemPowerStatus(status);
  if (!ok) return { onBattery: false, percent: null };
  const s = status as {
    ACLineStatus: number;
    BatteryLifePercent: number;
  };
  const onBattery = s.ACLineStatus === 0;
  const pct = s.BatteryLifePercent;
  return {
    onBattery,
    percent: pct <= 100 ? pct : null,
  };
}

export function isWindow(hwnd: number): boolean {
  if (process.platform !== "win32") return false;
  const IsWindow = getUser32().func("IsWindow", "bool", ["void *"]);
  return Boolean(IsWindow(hwnd));
}

export type WindowRect = { x: number; y: number; width: number; height: number };

export function getWindowRect(hwnd: number): WindowRect | null {
  if (process.platform !== "win32") return null;
  const RECT = koffi.struct("RECT", {
    left: "long",
    top: "long",
    right: "long",
    bottom: "long",
  });
  const GetWindowRect = getUser32().func("GetWindowRect", "bool", [
    "void *",
    "_Out_ RECT *",
  ]);
  const rect = {};
  if (!GetWindowRect(hwnd, rect)) return null;
  const r = rect as { left: number; top: number; right: number; bottom: number };
  return {
    x: r.left,
    y: r.top,
    width: Math.max(0, r.right - r.left),
    height: Math.max(0, r.bottom - r.top),
  };
}

/** SWP flags */
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_SHOWWINDOW = 0x0040;

export function moveResizeWindow(
  hwnd: number,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  setWindowPos(
    hwnd,
    Math.trunc(x),
    Math.trunc(y),
    Math.trunc(width),
    Math.trunc(height),
    SWP_NOZORDER | SWP_SHOWWINDOW,
  );
}

export function bringWindowToFront(hwnd: number): void {
  showWindow(hwnd, 9 /* SW_RESTORE */);
  setForegroundWindow(hwnd);
}

export type DisplayBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function snapWindow(
  hwnd: number,
  side: "left" | "right",
  display: DisplayBounds,
): void {
  const half = Math.floor(display.width / 2);
  const x = side === "left" ? display.x : display.x + half;
  moveResizeWindow(hwnd, x, display.y, half, display.height);
}

export function centerWindow(hwnd: number, display: DisplayBounds): void {
  const rect = getWindowRect(hwnd);
  const w = rect?.width && rect.width > 100 ? rect.width : Math.floor(display.width * 0.6);
  const h =
    rect?.height && rect.height > 100 ? rect.height : Math.floor(display.height * 0.6);
  const x = display.x + Math.floor((display.width - w) / 2);
  const y = display.y + Math.floor((display.height - h) / 2);
  moveResizeWindow(hwnd, x, y, w, h);
}

export function moveWindowToDisplay(
  hwnd: number,
  display: DisplayBounds,
  maximize = false,
): void {
  // Place near top-left of target with a comfortable size, then optionally maximize
  const w = Math.min(1200, Math.floor(display.width * 0.7));
  const h = Math.min(800, Math.floor(display.height * 0.7));
  const x = display.x + Math.floor((display.width - w) / 2);
  const y = display.y + Math.floor((display.height - h) / 2);
  showWindow(hwnd, 9 /* restore */);
  moveResizeWindow(hwnd, x, y, w, h);
  if (maximize) {
    showWindow(hwnd, 3 /* SW_MAXIMIZE */);
  }
  setForegroundWindow(hwnd);
}

void SWP_NOSIZE;
void SWP_NOMOVE;
