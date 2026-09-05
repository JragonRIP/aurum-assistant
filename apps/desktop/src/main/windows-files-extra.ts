/**
 * File discovery helpers under approved roots — no unrestricted crawling.
 */
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { shell } from "electron";
import {
  assertApprovedPath,
  getExtension,
  isBlockedExecutableExtension,
  MAX_SEARCH_DEPTH,
  MAX_SEARCH_RESULTS,
} from "./security";
import { rememberFile } from "./trusted-refs";
import type { ApprovedRoot, DeviceToolResult } from "./windows-tools";

function rootsPaths(roots: ApprovedRoot[]): string[] {
  return roots.map((r) => r.canonical_path);
}

type FoundFile = {
  path: string;
  name: string;
  size: number;
  mtimeMs: number;
  extension: string;
};

async function walkFiles(
  dir: string,
  depth: number,
  limit: number,
  pred: (name: string, full: string) => boolean,
  out: FoundFile[],
): Promise<void> {
  if (depth > MAX_SEARCH_DEPTH || out.length >= limit) return;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (out.length >= limit) return;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walkFiles(full, depth + 1, limit, pred, out);
      continue;
    }
    if (!ent.isFile()) continue;
    if (isBlockedExecutableExtension(full)) continue;
    if (!pred(ent.name, full)) continue;
    try {
      const st = await fs.stat(full);
      out.push({
        path: full,
        name: ent.name,
        size: st.size,
        mtimeMs: st.mtimeMs,
        extension: getExtension(ent.name),
      });
    } catch {
      /* skip */
    }
  }
}

async function collectUnderRoots(
  roots: ApprovedRoot[],
  pred: (name: string, full: string) => boolean,
  limit: number,
): Promise<FoundFile[]> {
  const out: FoundFile[] = [];
  for (const root of roots) {
    await walkFiles(root.canonical_path, 0, limit, pred, out);
  }
  return out;
}

function toResult(
  files: FoundFile[],
  activityLabel: string,
  message: string,
): DeviceToolResult {
  const mapped = files.slice(0, MAX_SEARCH_RESULTS).map((f) => {
    const fileReference = rememberFile({
      path: f.path,
      name: f.name,
      kind: "file",
    });
    return {
      fileReference,
      name: f.name,
      path: f.path,
      size: f.size,
      modifiedAt: new Date(f.mtimeMs).toISOString(),
      extension: f.extension,
    };
  });
  return {
    success: true,
    data: { files: mapped, activityLabel },
    message,
  };
}

export async function findNewestFile(opts: {
  roots: ApprovedRoot[];
  extension?: string;
  limit?: number;
}): Promise<DeviceToolResult> {
  if (opts.roots.length === 0) {
    return {
      success: false,
      error: {
        code: "FILE_PERMISSION_DENIED",
        message: "No approved folders. Approve a folder in Aurum Settings.",
      },
    };
  }
  const ext = normalizeExt(opts.extension);
  const files = await collectUnderRoots(
    opts.roots,
    (name) => (!ext ? true : name.toLowerCase().endsWith(ext)),
    Math.min(opts.limit ?? 200, 400),
  );
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const top = files.slice(0, Math.min(opts.limit ?? 10, 25));
  return toResult(
    top,
    "Found newest files",
    top[0]
      ? `Newest: ${top[0].name}`
      : "No matching files in approved folders.",
  );
}

export async function findLargestFile(opts: {
  roots: ApprovedRoot[];
  extension?: string;
  limit?: number;
}): Promise<DeviceToolResult> {
  if (opts.roots.length === 0) {
    return {
      success: false,
      error: {
        code: "FILE_PERMISSION_DENIED",
        message: "No approved folders.",
      },
    };
  }
  const ext = normalizeExt(opts.extension);
  const files = await collectUnderRoots(
    opts.roots,
    (name) => (!ext ? true : name.toLowerCase().endsWith(ext)),
    Math.min(opts.limit ?? 200, 400),
  );
  files.sort((a, b) => b.size - a.size);
  const top = files.slice(0, Math.min(opts.limit ?? 10, 25));
  return toResult(
    top,
    "Found largest files",
    top[0] ? `Largest: ${top[0].name}` : "No matching files.",
  );
}

export async function findFilesByDate(opts: {
  roots: ApprovedRoot[];
  /** ISO date YYYY-MM-DD — files modified on that local day */
  date: string;
  extension?: string;
  limit?: number;
}): Promise<DeviceToolResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "date must be YYYY-MM-DD.",
      },
    };
  }
  const start = new Date(`${opts.date}T00:00:00`).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  if (!Number.isFinite(start)) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Invalid date." },
    };
  }
  const ext = normalizeExt(opts.extension);
  const files = await collectUnderRoots(
    opts.roots,
    (name) => (!ext ? true : name.toLowerCase().endsWith(ext)),
    400,
  );
  const matched = files
    .filter((f) => f.mtimeMs >= start && f.mtimeMs < end)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, Math.min(opts.limit ?? 25, 40));
  return toResult(
    matched,
    "Found files by date",
    matched.length
      ? `${matched.length} file(s) from ${opts.date}.`
      : `No files from ${opts.date}.`,
  );
}

export async function getFileMetadata(
  filePath: string,
  roots: ApprovedRoot[],
): Promise<DeviceToolResult> {
  const gate = assertApprovedPath(filePath, rootsPaths(roots));
  if (!gate.ok) {
    return { success: false, error: { code: gate.code, message: gate.message } };
  }
  try {
    const st = await fs.stat(gate.canonical);
    const name = path.basename(gate.canonical);
    const fileReference = rememberFile({
      path: gate.canonical,
      name,
      kind: st.isDirectory() ? "folder" : "file",
    });
    return {
      success: true,
      data: {
        fileReference,
        path: gate.canonical,
        name,
        isDirectory: st.isDirectory(),
        size: st.size,
        modifiedAt: st.mtime.toISOString(),
        createdAt: st.birthtime.toISOString(),
        extension: st.isFile() ? getExtension(name) : null,
        activityLabel: "File metadata",
      },
    };
  } catch {
    return {
      success: false,
      error: { code: "NOT_FOUND", message: "File not found." },
    };
  }
}

export async function revealInExplorer(
  filePath: string,
  roots: ApprovedRoot[],
): Promise<DeviceToolResult> {
  const gate = assertApprovedPath(filePath, rootsPaths(roots));
  if (!gate.ok) {
    return { success: false, error: { code: gate.code, message: gate.message } };
  }
  shell.showItemInFolder(gate.canonical);
  return {
    success: true,
    data: {
      path: gate.canonical,
      activityLabel: "Revealed in Explorer",
    },
    message: "Opened in File Explorer.",
  };
}

function normalizeExt(extension?: string): string | undefined {
  if (!extension) return undefined;
  const e = extension.toLowerCase().trim();
  return e.startsWith(".") ? e : `.${e}`;
}
