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
  const EnumWindowsProc = koffi.proto(
    "bool __stdcall EnumWindowsProc(void *hwnd, intptr lParam)",
  );
  const EnumWindows = u32.func("EnumWindows", "bool", [
    koffi.pointer(EnumWindowsProc),
    "intptr",
  ]);

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
