/**
 * Typed clipboard adapter — Electron clipboard API only.
 * Contents treated as sensitive; callers must truncate before model-facing results.
 */
import { clipboard, nativeImage } from "electron";
import type { DeviceToolResult } from "./windows-tools";

const MAX_MODEL_CHARS = 8_000;

export function getClipboardText(): DeviceToolResult {
  try {
    const text = clipboard.readText();
    const truncated = text.length > MAX_MODEL_CHARS;
    const safe = truncated ? text.slice(0, MAX_MODEL_CHARS) : text;
    return {
      success: true,
      data: {
        text: safe,
        length: text.length,
        truncated,
        hasImage: !clipboard.readImage().isEmpty(),
        activityLabel: "Read clipboard",
      },
      message: truncated
        ? `Clipboard text (${text.length} chars, truncated for safety).`
        : text
          ? `Clipboard has ${text.length} characters.`
          : "Clipboard text is empty.",
    };
  } catch {
    return {
      success: false,
      error: { code: "EXECUTION_FAILED", message: "Could not read clipboard." },
    };
  }
}

export function setClipboardText(text: string): DeviceToolResult {
  if (typeof text !== "string") {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Text required." },
    };
  }
  if (text.length > 200_000) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Clipboard text too large (max 200k).",
      },
    };
  }
  try {
    clipboard.writeText(text);
    return {
      success: true,
      data: {
        length: text.length,
        activityLabel: "Set clipboard",
      },
      message: "Clipboard updated.",
    };
  } catch {
    return {
      success: false,
      error: { code: "EXECUTION_FAILED", message: "Could not set clipboard." },
    };
  }
}

export function clearClipboard(): DeviceToolResult {
  try {
    clipboard.clear();
    return {
      success: true,
      data: { activityLabel: "Cleared clipboard" },
      message: "Clipboard cleared.",
    };
  } catch {
    return {
      success: false,
      error: { code: "EXECUTION_FAILED", message: "Could not clear clipboard." },
    };
  }
}

export function writeClipboardImageFromPath(filePath: string): DeviceToolResult {
  try {
    const img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Not a readable image file.",
        },
      };
    }
    clipboard.writeImage(img);
    return {
      success: true,
      data: { activityLabel: "Copied image to clipboard" },
      message: "Image copied to clipboard.",
    };
  } catch {
    return {
      success: false,
      error: {
        code: "EXECUTION_FAILED",
        message: "Could not copy image to clipboard.",
      },
    };
  }
}
