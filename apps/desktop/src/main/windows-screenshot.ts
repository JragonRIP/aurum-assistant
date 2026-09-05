/**
 * Screenshot capture via Electron desktopCapturer — on demand only.
 * Returns a trusted screenshot reference + path under Pictures/Aurum Captures.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { app, desktopCapturer, screen } from "electron";
import { rememberScreenshot, resolveMonitor } from "./trusted-refs";
import type { DeviceToolResult } from "./windows-tools";

async function capturesDir(): Promise<string> {
  const base = path.join(app.getPath("pictures"), "Aurum Captures");
  await fs.mkdir(base, { recursive: true });
  return base;
}

export async function capturePrimaryDisplay(): Promise<DeviceToolResult> {
  return captureDisplayByIndex(0, true);
}

export async function captureMonitor(monitorReference: unknown): Promise<DeviceToolResult> {
  const mon = resolveMonitor(monitorReference);
  if (!mon) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid or expired monitor reference. List displays again.",
      },
    };
  }
  return captureDisplayByIndex(mon.index, false);
}

async function captureDisplayByIndex(
  index: number,
  primaryOnly: boolean,
): Promise<DeviceToolResult> {
  try {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const target = primaryOnly
      ? primary
      : displays[index] ?? displays.find((d) => d.id === primary.id) ?? primary;

    const { width, height } = target.size;
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width, height },
    });

    // Prefer matching display id; fall back to first screen source
    const source =
      sources.find((s) => String(s.display_id) === String(target.id)) ??
      sources[Math.min(index, sources.length - 1)] ??
      sources[0];

    if (!source || source.thumbnail.isEmpty()) {
      return {
        success: false,
        error: {
          code: "EXECUTION_FAILED",
          message: "Could not capture the display.",
        },
      };
    }

    const png = source.thumbnail.toPNG();
    const dir = await capturesDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(dir, `screenshot-${stamp}.png`);
    await fs.writeFile(filePath, png);

    const size = source.thumbnail.getSize();
    const screenshotReference = rememberScreenshot({
      path: filePath,
      width: size.width,
      height: size.height,
      capturedAt: new Date().toISOString(),
    });

    return {
      success: true,
      data: {
        screenshotReference,
        path: filePath,
        width: size.width,
        height: size.height,
        activityLabel: "Screenshot captured",
      },
      message: `Screenshot saved (${size.width}×${size.height}).`,
    };
  } catch (err) {
    console.error("[aurum:screenshot]", err);
    return {
      success: false,
      error: {
        code: "EXECUTION_FAILED",
        message: "Screenshot capture failed.",
      },
    };
  }
}

export async function captureWindowScreenshot(
  _windowReference: unknown,
): Promise<DeviceToolResult> {
  // Window-specific capture via HWND BitBlt is not wired yet without shell.
  // Prefer full-display capture for now.
  return {
    success: false,
    error: {
      code: "CAPABILITY_UNSUPPORTED",
      message:
        "Per-window screenshots aren't available yet. Capture a display instead.",
    },
  };
}
