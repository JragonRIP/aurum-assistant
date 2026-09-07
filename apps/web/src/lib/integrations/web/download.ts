/**
 * Controlled download: resolve trusted web refs → validate → save to approved folder.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolResult } from "@aurum/tools";
import { sanitizeFileName } from "@aurum/tools";
import {
  classifyContent,
  extensionForMime,
  isAllowedDownload,
  MAX_DOWNLOAD_BYTES,
  MAX_INLINE_DISPATCH_BYTES,
  sniffMime,
} from "./content-validate";
import { safeFetch, SafeFetchError } from "./safe-fetch";
import {
  createIntegrationReference,
  resolveIntegrationReference,
} from "../spotify/references";
import { getOnlineWindowsDevice } from "@/lib/devices/queries";

export async function resolveWebSourceUrl(opts: {
  supabase: SupabaseClient;
  userId: string;
  sourceRef: unknown;
}): Promise<{ url: string; kind: string; label: string } | null> {
  for (const kind of ["web_image", "web_page", "web_file"] as const) {
    const row = await resolveIntegrationReference({
      supabase: opts.supabase,
      userId: opts.userId,
      referenceId: opts.sourceRef,
      provider: "web",
      kind,
    });
    if (row) {
      return {
        url: row.provider_uri,
        kind: row.kind,
        label: row.label,
      };
    }
  }
  return null;
}

export async function downloadAndValidate(opts: {
  url: string;
  signal?: AbortSignal;
}): Promise<{
  finalUrl: string;
  mime: string;
  kind: ReturnType<typeof classifyContent>;
  body: Buffer;
}> {
  const fetched = await safeFetch(opts.url, {
    signal: opts.signal,
    maxBytes: MAX_DOWNLOAD_BYTES,
    accept: "image/*,application/pdf,text/*,application/zip,*/*;q=0.5",
  });
  const declared = fetched.headers.get("content-type");
  const mime = sniffMime(fetched.body, declared) ?? "application/octet-stream";
  const kind = classifyContent(mime);
  if (!isAllowedDownload(kind) || kind === "dangerous") {
    throw new SafeFetchError("File type not allowed", "UNSUPPORTED_TYPE");
  }
  // Reject PE disguised as image (sniff already catches MZ as dangerous)
  if (kind === "image" && !mime.startsWith("image/")) {
    throw new SafeFetchError("MIME mismatch", "UNSUPPORTED_TYPE");
  }
  return { finalUrl: fetched.url, mime, kind, body: fetched.body };
}

export async function runWebDownloadFile(opts: {
  supabase: SupabaseClient;
  userId: string;
  sourceRef: string;
  destinationFolderRef?: string;
  destinationPath?: string;
  fileName?: string;
  signal?: AbortSignal;
  dispatchDeviceTool?: (
    tool: string,
    input: Record<string, unknown>,
    executionId: string,
  ) => Promise<ToolResult>;
  executionId: string;
}): Promise<ToolResult> {
  const source = await resolveWebSourceUrl({
    supabase: opts.supabase,
    userId: opts.userId,
    sourceRef: opts.sourceRef,
  });
  if (!source) {
    return {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "That download source is missing or expired.",
      },
      activityLabel: "Download failed",
    };
  }

  const device = await getOnlineWindowsDevice(opts.supabase, opts.userId);
  if (!device) {
    return {
      success: false,
      error: {
        code: "DEVICE_OFFLINE",
        message: "Your Windows device isn't connected.",
      },
      activityLabel: "Download failed",
    };
  }

  // Resolve destination folder from approved roots
  let destDir: string | null = null;
  if (opts.destinationFolderRef) {
    const { data: root } = await opts.supabase
      .from("device_approved_roots")
      .select("id, canonical_path, label")
      .eq("user_id", opts.userId)
      .eq("device_id", device.id)
      .eq("id", opts.destinationFolderRef)
      .maybeSingle();
    if (!root?.canonical_path) {
      return {
        success: false,
        error: {
          code: "NOT_APPROVED_PATH",
          message:
            "That folder isn't approved. Approve a folder in Devices settings first.",
        },
        activityLabel: "Download failed",
      };
    }
    destDir = root.canonical_path;
  } else if (opts.destinationPath) {
    // Path must still be validated on device against approved roots
    destDir = opts.destinationPath;
  } else {
    const { data: roots } = await opts.supabase
      .from("device_approved_roots")
      .select("id, canonical_path, label")
      .eq("user_id", opts.userId)
      .eq("device_id", device.id)
      .order("created_at", { ascending: true })
      .limit(5);
    if (!roots?.length) {
      return {
        success: false,
        error: {
          code: "NOT_APPROVED_PATH",
          message:
            "I can download once you approve a folder in Devices settings.",
        },
        activityLabel: "Need approved folder",
      };
    }
    if (roots.length === 1) {
      destDir = roots[0]!.canonical_path;
    } else {
      return {
        success: false,
        error: {
          code: "AMBIGUOUS_MATCH",
          message: "Which approved folder should I save to?",
        },
        data: {
          folders: roots.map((r) => ({
            folderReference: r.id,
            label: r.label,
            path: r.canonical_path,
          })),
        },
        activityLabel: "Choose folder",
      };
    }
  }

  let downloaded: Awaited<ReturnType<typeof downloadAndValidate>>;
  try {
    downloaded = await downloadAndValidate({
      url: source.url,
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof SafeFetchError) {
      const code =
        err.code === "TOO_LARGE"
          ? "EXECUTION_FAILED"
          : err.code === "SSRF_BLOCKED" || err.code === "INVALID_URL"
            ? "INVALID_URL"
            : err.code === "UNSUPPORTED_TYPE"
              ? "UNSUPPORTED_FILE_TYPE"
              : "PROVIDER_UNAVAILABLE";
      return {
        success: false,
        error: {
          code,
          message:
            err.code === "TOO_LARGE"
              ? "That file is too large to download."
              : err.code === "SSRF_BLOCKED"
                ? "That download target isn't allowed."
                : err.code === "UNSUPPORTED_TYPE"
                  ? "That file type isn't safe to download."
                  : "Download failed.",
        },
        activityLabel: "Download failed",
      };
    }
    return {
      success: false,
      error: { code: "PROVIDER_UNAVAILABLE", message: "Download failed." },
      activityLabel: "Download failed",
    };
  }

  const safeBase =
    sanitizeFileName(opts.fileName || source.label || "download") || "download";
  const ext = extensionForMime(downloaded.mime);
  const fileName = safeBase.toLowerCase().endsWith(ext)
    ? safeBase
    : `${safeBase.replace(/\.[a-z0-9]{1,8}$/i, "")}${ext}`;

  if (!opts.dispatchDeviceTool) {
    return {
      success: false,
      error: {
        code: "UNSUPPORTED",
        message: "Device download is not available.",
      },
      activityLabel: "Download failed",
    };
  }

  if (downloaded.body.length > MAX_INLINE_DISPATCH_BYTES) {
    return {
      success: false,
      error: {
        code: "EXECUTION_FAILED",
        message: "That file is too large to transfer to your device securely.",
      },
      activityLabel: "Download failed",
    };
  }

  const deviceResult = await opts.dispatchDeviceTool(
    "save_downloaded_file",
    {
      directory: destDir,
      fileName,
      contentBase64: downloaded.body.toString("base64"),
      mimeType: downloaded.mime,
      overwrite: false,
    },
    opts.executionId,
  );

  if (!deviceResult.success) {
    return deviceResult;
  }

  const savedPath =
    typeof deviceResult.data === "object" &&
    deviceResult.data &&
    "path" in deviceResult.data
      ? String((deviceResult.data as { path?: string }).path ?? "")
      : "";

  let fileRefId: string | null = null;
  if (savedPath) {
    try {
      const ref = await createIntegrationReference({
        supabase: opts.supabase,
        userId: opts.userId,
        provider: "web",
        kind: "web_file",
        providerId: savedPath,
        providerUri: savedPath,
        label: fileName,
        subtitle: downloaded.mime,
        payload: {
          mime: downloaded.mime,
          kind: downloaded.kind,
          sourceUrl: downloaded.finalUrl,
          bytes: downloaded.body.length,
        },
      });
      fileRefId = ref.id;
    } catch {
      /* ref is best-effort */
    }
  }

  return {
    success: true,
    data: {
      path: savedPath || null,
      fileName,
      mime: downloaded.mime,
      bytes: downloaded.body.length,
      fileReference: fileRefId,
      sourceKind: source.kind,
      licenseNote:
        "Online images may be copyrighted. Do not assume reuse rights without evidence.",
    },
    message: savedPath
      ? `Saved ${fileName}.`
      : `Saved ${fileName} to your approved folder.`,
    activityLabel: "Downloaded file",
  };
}
