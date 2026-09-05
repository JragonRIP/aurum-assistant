/**
 * Path security: ensure a candidate path stays within an allowed directory.
 * Blocks .. traversal, UNC paths, and escaping the allowlist root.
 * (Desktop file tools use this in a later phase — kept here for shared security.)
 */
export function normalizePath(input: string): string {
  const replaced = input.replace(/\//g, "\\");
  return replaced.replace(/\\+/g, "\\");
}

export function isUncPath(path: string): boolean {
  return path.startsWith("\\\\") || /^[\\/]{2}/.test(path);
}

export function isPathInsideAllowed(
  candidatePath: string,
  allowedDirectories: string[],
): boolean {
  if (!candidatePath || allowedDirectories.length === 0) {
    return false;
  }

  const normalized = normalizePath(candidatePath.trim());

  if (isUncPath(normalized)) {
    return false;
  }

  const collapsed = collapseDotSegments(normalized);
  const lower = collapsed.toLowerCase();

  return allowedDirectories.some((allowed) => {
    const root = collapseDotSegments(normalizePath(allowed)).toLowerCase();
    const rootWithSep = root.endsWith("\\") ? root : `${root}\\`;
    return lower === root || lower.startsWith(rootWithSep);
  });
}

function collapseDotSegments(path: string): string {
  const parts = path.split("\\");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" && stack.length === 0) {
      continue;
    }
    if (part === "." || part === "") {
      continue;
    }
    if (part === "..") {
      if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }
    stack.push(part);
  }
  if (/^[a-zA-Z]:$/.test(parts[0] ?? "")) {
    return (
      `${parts[0]}\\${stack.slice(1).join("\\")}`.replace(/\\$/, "") ||
      parts[0]!
    );
  }
  if (/^[a-zA-Z]:$/.test(stack[0] ?? "")) {
    const drive = stack[0]!;
    const rest = stack.slice(1).join("\\");
    return rest ? `${drive}\\${rest}` : drive;
  }
  return stack.join("\\");
}
