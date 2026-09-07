/**
 * Push-to-talk hotkey state machine runner (main process).
 * Uses GetAsyncKeyState via koffi — no shell.
 */
import koffi from "koffi";
import {
  VOICE_MAX_RECORD_MS,
  VOICE_PTT_HOLD_MS,
  initialVoicePttState,
  reduceVoicePtt,
  type VoicePttEffect,
  type VoicePttState,
} from "@aurum/shared";

const VK_SPACE = 0x20;
const VK_CONTROL = 0x11;

let user32: ReturnType<typeof koffi.load> | null = null;
let getAsyncKeyState: ((vKey: number) => number) | null = null;

function ensureKeyState() {
  if (getAsyncKeyState) return;
  if (process.platform !== "win32") {
    getAsyncKeyState = () => 0;
    return;
  }
  user32 = koffi.load("user32.dll");
  getAsyncKeyState = user32.func("GetAsyncKeyState", "int16", ["int"]);
}

export function isKeyDown(vKey: number): boolean {
  ensureKeyState();
  const state = getAsyncKeyState?.(vKey) ?? 0;
  return (state & 0x8000) !== 0;
}

export type VoiceHotkeyCallbacks = {
  onEnsureOverlayVisible: () => void;
  onTapToggle: () => void;
  onStartListening: () => void;
  onStopAndSubmit: () => void;
  onCancelCapture: () => void;
};

/**
 * Owns one PTT session at a time. globalShortcut only signals press;
 * this polls Space/Ctrl until release.
 */
export class VoiceHotkeyController {
  private state: VoicePttState = initialVoicePttState();
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(private readonly cbs: VoiceHotkeyCallbacks) {}

  /** Called when Ctrl+Space accelerator fires. */
  onAccelerator(): void {
    if (this.busy || this.state.phase !== "idle") {
      return;
    }
    this.busy = true;
    const { state, effects } = reduceVoicePtt(this.state, {
      type: "press",
      at: Date.now(),
    });
    this.state = state;
    this.apply(effects);
    this.startPolling();
  }

  cancel(): void {
    const { state, effects } = reduceVoicePtt(this.state, {
      type: "cancel",
      at: Date.now(),
    });
    this.state = state;
    this.stopPolling();
    this.busy = false;
    this.apply(effects);
  }

  dispose(): void {
    this.cancel();
  }

  getPhase(): string {
    return this.state.phase;
  }

  private startPolling(): void {
    this.stopPolling();
    this.timer = setInterval(() => {
      const at = Date.now();
      const spaceDown = isKeyDown(VK_SPACE);
      const ctrlDown = isKeyDown(VK_CONTROL);
      const { state, effects } = reduceVoicePtt(
        this.state,
        { type: "tick", at, spaceDown, ctrlDown },
        VOICE_PTT_HOLD_MS,
        VOICE_MAX_RECORD_MS,
      );
      this.state = state;
      this.apply(effects);
      if (this.state.phase === "idle") {
        this.stopPolling();
        this.busy = false;
      }
    }, 40);
  }

  private stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private apply(effects: VoicePttEffect[]): void {
    for (const e of effects) {
      switch (e.type) {
        case "ensure_overlay_visible":
          this.cbs.onEnsureOverlayVisible();
          break;
        case "tap_toggle":
          this.cbs.onTapToggle();
          break;
        case "start_listening":
          this.cbs.onStartListening();
          break;
        case "stop_and_submit":
          this.cbs.onStopAndSubmit();
          break;
        case "cancel_capture":
          this.cbs.onCancelCapture();
          break;
        default:
          break;
      }
    }
  }
}
