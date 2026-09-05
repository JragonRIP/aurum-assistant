import type { PermissionLevel } from "@aurum/shared";

export type PermissionDecision =
  | { allowed: true; mode: "execute" }
  | { allowed: true; mode: "confirm" }
  | { allowed: false; reason: string; code: "PERMISSION_DENIED" };

/**
 * Permission gate. The model cannot change permission levels —
 * levels are fixed on ToolDefinition registration.
 */
export function evaluatePermission(
  permission: PermissionLevel,
): PermissionDecision {
  switch (permission) {
    case "READ":
    case "SAFE_WRITE":
      return { allowed: true, mode: "execute" };
    case "CONFIRM":
      return { allowed: true, mode: "confirm" };
    case "RESTRICTED":
      return {
        allowed: false,
        reason: "This action is restricted and is not available.",
        code: "PERMISSION_DENIED",
      };
    default: {
      const _exhaustive: never = permission;
      return {
        allowed: false,
        reason: `Unknown permission: ${_exhaustive}`,
        code: "PERMISSION_DENIED",
      };
    }
  }
}
