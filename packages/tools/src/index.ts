export type {
  AurumTool,
  AnyAurumTool,
  ToolContext,
  ToolExecutionContext,
  ToolResult,
  ToolError,
  ToolErrorCode,
  ToolDataAccess,
  TaskRecord,
  NoteRecord,
  ToolRunRecord,
  ToolRunStatus,
  ApprovalRecord,
  TaskDataAccess,
  NoteDataAccess,
  ToolRunDataAccess,
  ApprovalDataAccess,
  LegacyToolResult,
} from "./types";
export {
  MAX_TOOL_ROUNDS,
  MAX_TOOL_CALLS_PER_REQUEST,
} from "./types";
export { ToolRegistry } from "./registry";
export { evaluatePermission } from "./permission";
export type { PermissionDecision } from "./permission";
export {
  executeToolCall,
  executeTool,
  toModelToolResult,
  createInMemoryDataAccess,
  resolveToolActivityLabel,
} from "./executor";
export type { ToolExecutorEvent, ToolExecutorHooks } from "./executor";
export { zodToJsonSchema } from "./zod-json";
export { createDefaultRegistry } from "./create-registry";
export {
  normalizePath,
  isUncPath,
  isPathInsideAllowed,
} from "./path-security";
export {
  assertApprovedPath,
  isBlockedAppName,
  isBlockedExecutableExtension,
  isBlockedSensitiveLocation,
  isDevicePath,
  isSafeUrl,
  canOpenWithDefaultApp,
  sanitizeFileName,
  isTextReadableExtension,
  BLOCKED_EXECUTABLE_EXTENSIONS,
  BLOCKED_APP_NAMES,
  MAX_READ_FILE_BYTES,
  MAX_SEARCH_RESULTS,
  MAX_LIST_ENTRIES,
  MAX_SEARCH_DEPTH,
} from "./device-security";
export { registerDesktopTools } from "./desktop-tools";
export { registerWindowsSystemTools } from "./windows-system-tools";
export { clampVolumePercent, applyRelativeVolume } from "./volume";
export {
  registerSpotifyTools,
  createSpotifyGetPlaybackStateTool,
  createSpotifyGetDevicesTool,
  createSpotifySearchTrackTool,
  createSpotifyPlayTrackTool,
  createSpotifyPauseTool,
  createSpotifyResumeTool,
  createSpotifyNextTool,
  createSpotifyPreviousTool,
  createSpotifySetVolumeTool,
} from "./spotify-tools";
export {
  createGetCurrentTimeTool,
  getCurrentTimeInputSchema,
  createCreateTaskTool,
  createGetTasksTool,
  createUpdateTaskTool,
  createCompleteTaskTool,
  createCreateNoteTool,
  createSearchNotesTool,
  createConfirmEchoTool,
  createTaskInputSchema,
  getTasksInputSchema,
  updateTaskInputSchema,
  completeTaskInputSchema,
  createNoteInputSchema,
  searchNotesInputSchema,
} from "./definitions";
