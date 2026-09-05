import { z } from "zod";
import type { AurumTool, ToolResult } from "./types";
import type { ToolRegistry } from "./registry";

const emptySchema = z.object({});

const openAppSchema = z.object({
  app: z
    .string()
    .min(1)
    .max(120)
    .describe("User-facing application name, e.g. Spotify. Never an exe path."),
});

const openUrlSchema = z.object({
  url: z.string().url().max(2000).describe("http(s) URL only"),
});

const pathSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(500)
    .describe("Absolute path under an approved folder, or relative file reference"),
  root_id: z.string().uuid().optional(),
});

const listDirSchema = z.object({
  path: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(200).optional(),
});

const searchSchema = z.object({
  query: z.string().min(1).max(120),
  extension: z.string().max(20).optional(),
  root_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(40).optional(),
});

const readFileSchema = z.object({
  path: z.string().min(1).max(500),
});

const createFolderSchema = z.object({
  parent_path: z.string().min(1).max(500),
  name: z.string().min(1).max(120),
});

const copyMoveSchema = z.object({
  source: z.string().min(1).max(500),
  destination: z.string().min(1).max(500),
});

const renameSchema = z.object({
  path: z.string().min(1).max(500),
  new_name: z.string().min(1).max(120),
});

type DeviceDispatch = (
  tool: string,
  input: Record<string, unknown>,
  executionId: string,
) => Promise<ToolResult>;

function deviceTool<T extends z.ZodTypeAny>(
  def: Omit<AurumTool<T>, "handler" | "environment"> & {
    inputSchema: T;
  },
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

/** Cloud-side tool: lists devices from ctx without device round-trip */
export function createGetConnectedDevicesTool(): AurumTool<typeof emptySchema> {
  return {
    id: "get_connected_devices",
    name: "Get connected devices",
    description:
      "List the user's Aurum devices and online status. Prefer this before desktop actions.",
    inputSchema: emptySchema,
    permission: "READ",
    environment: "CLOUD",
    activityLabel: "Listing devices",
    async handler(_input, ctx): Promise<ToolResult> {
      const list = (ctx as { listDevices?: () => Promise<unknown> }).listDevices;
      if (!list) {
        return {
          success: true,
          data: { devices: [] },
          message: "No device listing available.",
          activityLabel: "Devices listed",
        };
      }
      const devices = await list();
      return {
        success: true,
        data: { devices },
        message: "Device list loaded.",
        activityLabel: "Devices listed",
      };
    },
  };
}

export function createGetRunningAppsTool() {
  return deviceTool({
    id: "get_running_apps",
    name: "Get running apps",
    description: "List sanitized names of apps running on the Windows device.",
    inputSchema: emptySchema,
    permission: "READ",
    activityLabel: "Listing apps",
  });
}

export function createOpenApplicationTool() {
  return deviceTool({
    id: "open_application",
    name: "Open application",
    description:
      "Open a known installed Windows app by friendly name (e.g. Spotify). Never pass executable paths.",
    inputSchema: openAppSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Opening application",
  });
}

export function createOpenUrlTool() {
  return deviceTool({
    id: "open_url",
    name: "Open URL",
    description: "Open an http(s) URL in the default browser on Windows.",
    inputSchema: openUrlSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Opening URL",
  });
}

export function createListDirectoryTool() {
  return deviceTool({
    id: "list_directory",
    name: "List directory",
    description:
      "List files in an approved folder on the Windows device. Paths must be under approved roots.",
    inputSchema: listDirSchema,
    permission: "READ",
    activityLabel: "Listing folder",
  });
}

export function createSearchFilesTool() {
  return deviceTool({
    id: "search_files",
    name: "Search files",
    description:
      "Search for files by name inside approved Windows folders only. Do not search the whole disk.",
    inputSchema: searchSchema,
    permission: "READ",
    activityLabel: "Searching files",
    // metadata set by desktop result
  });
}

export function createReadFileTool() {
  return deviceTool({
    id: "read_file",
    name: "Read file",
    description:
      "Read a small text file from an approved folder. Binary files are unsupported.",
    inputSchema: readFileSchema,
    permission: "READ",
    activityLabel: "Reading file",
  });
}

export function createOpenFileTool() {
  return deviceTool({
    id: "open_file",
    name: "Open file",
    description:
      "Open an approved non-executable file with the Windows default app.",
    inputSchema: pathSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Opening file",
  });
}

export function createOpenFolderTool() {
  return deviceTool({
    id: "open_folder",
    name: "Open folder",
    description: "Open an approved folder in File Explorer.",
    inputSchema: pathSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Opening folder",
  });
}

export function createCreateFolderTool() {
  return deviceTool({
    id: "create_folder",
    name: "Create folder",
    description: "Create a folder inside an approved Windows root.",
    inputSchema: createFolderSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Creating folder",
  });
}

export function createCopyFileTool() {
  return deviceTool({
    id: "copy_file",
    name: "Copy file",
    description:
      "Copy a non-executable file between approved locations. Does not overwrite.",
    inputSchema: copyMoveSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Copying file",
  });
}

export function createMoveFileTool() {
  return deviceTool({
    id: "move_file",
    name: "Move file",
    description:
      "Move a non-executable file between approved locations. Does not overwrite.",
    inputSchema: copyMoveSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Moving file",
  });
}

export function createRenameFileTool() {
  return deviceTool({
    id: "rename_file",
    name: "Rename file",
    description:
      "Rename a non-executable file in an approved folder. Cannot change to an executable extension.",
    inputSchema: renameSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Renaming file",
  });
}

export function registerDesktopTools(registry: ToolRegistry): void {
  registry.register(createGetConnectedDevicesTool());
  registry.register(createGetRunningAppsTool());
  registry.register(createOpenApplicationTool());
  registry.register(createOpenUrlTool());
  registry.register(createListDirectoryTool());
  registry.register(createSearchFilesTool());
  registry.register(createReadFileTool());
  registry.register(createOpenFileTool());
  registry.register(createOpenFolderTool());
  registry.register(createCreateFolderTool());
  registry.register(createCopyFileTool());
  registry.register(createMoveFileTool());
  registry.register(createRenameFileTool());
}
