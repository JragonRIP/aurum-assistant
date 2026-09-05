import { ToolRegistry } from "./registry";
import {
  createCompleteTaskTool,
  createCreateNoteTool,
  createCreateTaskTool,
  createGetCurrentTimeTool,
  createGetTasksTool,
  createSearchNotesTool,
  createUpdateTaskTool,
} from "./definitions";
import { registerDesktopTools } from "./desktop-tools";
import { registerSpotifyTools } from "./spotify-tools";
import { registerWindowsSystemTools } from "./windows-system-tools";

/** Production registry — cloud + desktop + connected-app tools */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(createGetCurrentTimeTool());
  registry.register(createCreateTaskTool());
  registry.register(createGetTasksTool());
  registry.register(createUpdateTaskTool());
  registry.register(createCompleteTaskTool());
  registry.register(createCreateNoteTool());
  registry.register(createSearchNotesTool());
  registerDesktopTools(registry);
  registerWindowsSystemTools(registry);
  registerSpotifyTools(registry);
  return registry;
}

export { createGetCurrentTimeTool } from "./definitions";
export { registerDesktopTools } from "./desktop-tools";
export { registerWindowsSystemTools } from "./windows-system-tools";
export { registerSpotifyTools } from "./spotify-tools";
export { clampVolumePercent, applyRelativeVolume } from "./volume";