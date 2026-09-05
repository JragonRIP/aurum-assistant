/**
 * Windows capability broker tools — typed DESKTOP operations.
 * No shell / PowerShell / arbitrary command strings.
 */
import { z } from "zod";
import type { AurumTool, ToolResult } from "./types";
import type { ToolRegistry } from "./registry";

const emptySchema = z.object({});

const textSchema = z.object({
  text: z.string().max(200_000).describe("Clipboard text to set"),
});

const windowRefSchema = z.object({
  windowReference: z
    .string()
    .uuid()
    .describe("Trusted window reference from get_open_windows / focus_application"),
});

const monitorRefSchema = z.object({
  monitorReference: z
    .string()
    .uuid()
    .describe("Trusted monitor reference from list_monitors / get_display_info"),
});

const optionalMonitorSchema = z.object({
  windowReference: z.string().uuid(),
  monitorReference: z.string().uuid().optional(),
});

const moveToMonitorSchema = z.object({
  windowReference: z.string().uuid(),
  monitorReference: z.string().uuid(),
  maximize: z.boolean().optional(),
});

const appNameSchema = z.object({
  app: z
    .string()
    .min(1)
    .max(120)
    .describe("Friendly application name, e.g. Spotify. Never an executable path."),
});

const appRefSchema = z.object({
  appReference: z
    .string()
    .uuid()
    .describe("Trusted app reference from list_known_applications"),
});

const listAppsSchema = z.object({
  query: z.string().max(80).optional(),
  limit: z.number().int().min(1).max(60).optional(),
});

const findFilesSchema = z.object({
  extension: z.string().max(20).optional(),
  limit: z.number().int().min(1).max(40).optional(),
});

const findByDateSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Local calendar day YYYY-MM-DD"),
  extension: z.string().max(20).optional(),
  limit: z.number().int().min(1).max(40).optional(),
});

const pathSchema = z.object({
  path: z.string().min(1).max(500),
});

const fileRefSchema = z.object({
  fileReference: z
    .string()
    .uuid()
    .describe("Trusted file reference from find_* / get_file_metadata"),
});

const openFileWithAppSchema = z.object({
  path: z.string().min(1).max(500).optional(),
  fileReference: z.string().uuid().optional(),
  app: z.string().max(120).optional(),
});

const processRefSchema = z.object({
  processReference: z
    .string()
    .uuid()
    .describe("Trusted process reference from list_processes"),
});

const listProcessesSchema = z.object({
  limit: z.number().int().min(1).max(80).optional(),
});

const shortcutSchema = z.object({
  action: z.enum([
    "copy",
    "paste",
    "cut",
    "undo",
    "redo",
    "select_all",
    "save",
    "find",
    "escape",
    "enter",
    "tab",
    "arrow_left",
    "arrow_right",
    "arrow_up",
    "arrow_down",
    "backspace",
    "delete",
    "home",
    "end",
    "page_up",
    "page_down",
  ]),
});

const notificationSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().max(500).optional(),
});

const searchSchema = z.object({
  query: z.string().min(1).max(300),
});

const routineSchema = z.object({
  routine: z
    .enum(["work_mode", "focus_mode"])
    .describe("Named workspace routine composed of typed steps (no scripts)"),
});

const copyImageSchema = z.object({
  path: z.string().max(500).optional(),
  fileReference: z.string().uuid().optional(),
  screenshotReference: z.string().uuid().optional(),
});

const elementRefSchema = z.object({
  elementReference: z.string().uuid(),
});

const setUiTextSchema = z.object({
  elementReference: z.string().uuid(),
  value: z.string().max(2000),
});

type DeviceDispatch = (
  tool: string,
  input: Record<string, unknown>,
  executionId: string,
) => Promise<ToolResult>;

function deviceTool<T extends z.ZodTypeAny>(
  def: Omit<AurumTool<T>, "handler" | "environment"> & { inputSchema: T },
): AurumTool<T> {
  return {
    ...def,
    environment: "DESKTOP",
    async handler(input, ctx): Promise<ToolResult> {
      const dispatch = ctx.dispatchDeviceTool as DeviceDispatch | undefined;
      if (!dispatch) {
        return {
          success: false,
          error: {
            code: "DEVICE_OFFLINE",
            message: "Your Windows device isn't connected.",
          },
          activityLabel: def.activityLabel,
        };
      }
      const executionId =
        ctx.currentExecutionId ??
        `${ctx.generationId ?? "gen"}:${def.id}:${Date.now()}`;
      return dispatch(def.id, input as Record<string, unknown>, executionId);
    },
  };
}

export function registerWindowsCapabilityTools(registry: ToolRegistry): void {
  // Clipboard
  registry.register(
    deviceTool({
      id: "get_clipboard_text",
      name: "Get clipboard text",
      description:
        "Read clipboard text when the user explicitly needs it. Treat as sensitive; do not call casually.",
      inputSchema: emptySchema,
      permission: "READ",
      activityLabel: "Reading clipboard",
    }),
  );
  registry.register(
    deviceTool({
      id: "set_clipboard_text",
      name: "Set clipboard text",
      description: "Put text on the Windows clipboard.",
      inputSchema: textSchema,
      permission: "SAFE_WRITE",
      activityLabel: "Setting clipboard",
    }),
  );
  registry.register(
    deviceTool({
      id: "clear_clipboard",
      name: "Clear clipboard",
      description: "Clear the Windows clipboard.",
      inputSchema: emptySchema,
      permission: "SAFE_WRITE",
      activityLabel: "Clearing clipboard",
    }),
  );
  registry.register(
    deviceTool({
      id: "copy_image_to_clipboard",
      name: "Copy image to clipboard",
      description:
        "Copy an approved image file or screenshot reference onto the clipboard.",
      inputSchema: copyImageSchema,
      permission: "SAFE_WRITE",
      activityLabel: "Copying image",
    }),
  );

  // Screenshots
  registry.register(
    deviceTool({
      id: "capture_screenshot",
      name: "Capture screenshot",
      description:
        "Capture the primary display once. Returns a trusted screenshotReference. Do not capture continuously.",
      inputSchema: emptySchema,
      permission: "SAFE_WRITE",
      activityLabel: "Capturing screenshot",
    }),
  );
  registry.register(
    deviceTool({
      id: "capture_monitor_screenshot",
      name: "Capture monitor screenshot",
      description: "Capture a specific monitor using a trusted monitorReference.",
      inputSchema: monitorRefSchema,
      permission: "SAFE_WRITE",
      activityLabel: "Capturing monitor",
    }),
  );
  registry.register(
    deviceTool({
      id: "capture_window_screenshot",
      name: "Capture window screenshot",
      description: "Capture a specific window when supported.",
      inputSchema: windowRefSchema,
      permission: "SAFE_WRITE",
      activityLabel: "Capturing window",
    }),
  );

  // Display / window layout
  registry.register(
    deviceTool({
      id: "list_monitors",
      name: "List monitors",
      description:
        "List displays with trusted monitorReference UUIDs, bounds, scale, and refresh rate.",
      inputSchema: emptySchema,
      permission: "READ",
      activityLabel: "Listing monitors",
    }),
  );
  registry.register(
    deviceTool({
      id: "get_window_bounds",
      name: "Get window bounds",
      description: "Read position/size of a window by trusted windowReference.",
      inputSchema: windowRefSchema,
      permission: "READ",
      activityLabel: "Window bounds",
    }),
  );
  registry.register(
    deviceTool({
      id: "snap_window_left",
      name: "Snap window left",
      description: "Snap a window to the left half of a monitor.",
      inputSchema: optionalMonitorSchema,
      permission: "SAFE_WRITE",
      activityLabel: "Snapping left",
    }),
  );
  registry.register(
    deviceTool({
      id: "snap_window_right",
      name: "Snap window right",
      description: "Snap a window to the right half of a monitor.",
      inputSchema: optionalMonitorSchema,
      permission: "SAFE_WRITE",
      activityLabel: "Snapping right",
    }),
  );
  registry.register(
    deviceTool({
      id: "center_window",
      name: "Center window",
      description: "Center a window on a monitor.",
      inputSchema: optionalMonitorSchema,
      permission: "SAFE_WRITE",
      activityLabel: "Centering window",
    }),
  );
  registry.register(
    deviceTool({
      id: "bring_window_to_front",
      name: "Bring window to front",
      description: "Bring a window to the foreground.",
      inputSchema: windowRefSchema,
      permission: "SAFE_WRITE",
      activityLabel: "Bringing to front",
    }),
  );
  registry.register(
    deviceTool({
      id: "move_window_to_monitor",
      name: "Move window to monitor",
      description:
        "Move a window to another monitor using trusted windowReference + monitorReference. Optionally maximize.",
      inputSchema: moveToMonitorSchema,
      permission: "SAFE_WRITE",
      activityLabel: "Moving to monitor",
    }),
  );

  // Apps
  registry.register(
    deviceTool({
      id: "list_known_applications",
      name: "List known applications",
      description:
        "List Start Menu applications as trusted appReference UUIDs. Never invent executable paths.",
      inputSchema: listAppsSchema,
      permission: "READ",
      activityLabel: "Listing applications",
    }),
  );
  registry.register(
    deviceTool({
      id: "open_known_application",
      name: "Open known application",
      description: "Open an app using a trusted appReference from list_known_applications.",
      inputSchema: appRefSchema,
      permission: "SAFE_WRITE",
      activityLabel: "Opening application",
    }),
  );
  registry.register(
    deviceTool({
      id: "focus_application",
      name: "Focus application",
      description: "Focus an open application window by friendly name.",
      inputSchema: appNameSchema,
      permission: "SAFE_WRITE",
      activityLabel: "Focusing application",
    }),
  );
  registry.register(
    deviceTool({
      id: "close_application",
      name: "Close application",
      description:
        "Close an application by friendly name. May discard unsaved work — requires confirmation.",
      inputSchema: appNameSchema,
      permission: "CONFIRM",
      activityLabel: "Closing application",
    }),
  );
  registry.register(
    deviceTool({
      id: "open_file_with_app",
      name: "Open file with app",
      description:
        "Open an approved file (path or fileReference) with the default registered application.",
      inputSchema: openFileWithAppSchema,
      permission: "SAFE_WRITE",
      activityLabel: "Opening file",
    }),
  );

  // Files
  registry.register(
    deviceTool({
      id: "find_newest_file",
      name: "Find newest file",
      description:
        "Find newest files under approved folders. Optionally filter by extension (e.g. pdf, png).",
      inputSchema: findFilesSchema,
      permission: "READ",
      activityLabel: "Finding newest file",
    }),
  );
  registry.register(
    deviceTool({
      id: "find_largest_file",
      name: "Find largest file",
      description: "Find largest files under approved folders.",
      inputSchema: findFilesSchema,
      permission: "READ",
      activityLabel: "Finding largest file",
    }),
  );
  registry.register(
    deviceTool({
      id: "find_files_by_date",
      name: "Find files by date",
      description: "Find files modified on a local calendar day under approved folders.",
      inputSchema: findByDateSchema,
      permission: "READ",
      activityLabel: "Finding files by date",
    }),
  );
  registry.register(
    deviceTool({
      id: "get_file_metadata",
      name: "Get file metadata",
      description: "Read size/dates for a file under an approved folder.",
      inputSchema: pathSchema,
      permission: "READ",
      activityLabel: "File metadata",
    }),
  );
  registry.register(
    deviceTool({
      id: "reveal_in_explorer",
      name: "Reveal in Explorer",
      description: "Show a file or folder in Windows File Explorer.",
      inputSchema: pathSchema,
      permission: "SAFE_WRITE",
      activityLabel: "Revealing in Explorer",
    }),
  );
  registry.register(
    deviceTool({
      id: "open_trusted_file",
      name: "Open trusted file",
      description: "Open a file using a trusted fileReference from a prior find/list result.",
      inputSchema: fileRefSchema,
      permission: "SAFE_WRITE",
      activityLabel: "Opening file",
    }),
  );

  // Processes
  registry.register(
    deviceTool({
      id: "list_processes",
      name: "List processes",
      description:
        "List processes with memory usage and trusted processReference UUIDs. Sorted by memory.",
      inputSchema: listProcessesSchema,
      permission: "READ",
      activityLabel: "Listing processes",
    }),
  );
  registry.register(
    deviceTool({
      id: "terminate_process",
      name: "Terminate process",
      description:
        "Terminate a normal user process by trusted processReference. Critical/system processes are blocked. Requires confirmation.",
      inputSchema: processRefSchema,
      permission: "CONFIRM",
      activityLabel: "Terminating process",
    }),
  );

  // Input
  registry.register(
    deviceTool({
      id: "press_shortcut",
      name: "Press shortcut",
      description:
        "Send a constrained keyboard shortcut (copy, paste, undo, save, arrows, etc.). Never arbitrary keystroke strings.",
      inputSchema: shortcutSchema,
      permission: "SAFE_WRITE",
      activityLabel: "Keyboard shortcut",
    }),
  );
  registry.register(
    deviceTool({
      id: "inspect_ui_elements",
      name: "Inspect UI elements",
      description:
        "Inspect accessible UI controls (when supported). May return CAPABILITY_UNSUPPORTED.",
      inputSchema: emptySchema,
      permission: "READ",
      activityLabel: "Inspecting UI",
    }),
  );
  registry.register(
    deviceTool({
      id: "invoke_ui_element",
      name: "Invoke UI element",
      description: "Invoke a trusted accessibility element (button/menu).",
      inputSchema: elementRefSchema,
      permission: "SAFE_WRITE",
      activityLabel: "Invoking UI",
    }),
  );
  registry.register(
    deviceTool({
      id: "set_ui_element_text",
      name: "Set UI element text",
      description: "Set text on a trusted accessibility element.",
      inputSchema: setUiTextSchema,
      permission: "SAFE_WRITE",
      activityLabel: "Setting UI text",
    }),
  );

  // Notifications / browser / workspace
  registry.register(
    deviceTool({
      id: "show_notification",
      name: "Show notification",
      description: "Show a Windows desktop notification from Aurum.",
      inputSchema: notificationSchema,
      permission: "SAFE_WRITE",
      activityLabel: "Showing notification",
    }),
  );
  registry.register(
    deviceTool({
      id: "open_search",
      name: "Open web search",
      description: "Open a web search for a query in the default browser.",
      inputSchema: searchSchema,
      permission: "SAFE_WRITE",
      activityLabel: "Opening search",
    }),
  );
  registry.register(
    deviceTool({
      id: "run_workspace_routine",
      name: "Run workspace routine",
      description:
        "Run a named workspace routine (work_mode / focus_mode). Composed from typed capabilities — no scripts.",
      inputSchema: routineSchema,
      permission: "SAFE_WRITE",
      activityLabel: "Workspace routine",
    }),
  );
}
