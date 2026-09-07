/**
 * Content validation for controlled downloads.
 * Never trust extension alone — sniff magic bytes + Content-Type.
 */
import { BLOCKED_EXECUTABLE_EXTENSIONS } from "@aurum/tools";

export const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_INLINE_DISPATCH_BYTES = 1_500_000;

export type DetectedContentKind =
  | "image"
  | "pdf"
  | "text"
  | "archive"
  | "audio"
  | "video"
  | "unknown"
  | "dangerous";

const IMAGE_MAGICS: Array<{ kind: string; bytes: number[] }> = [
  { kind: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { kind: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { kind: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { kind: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF....WEBP
];

export function sniffMime(buf: Buffer, declared?: string | null): string | null {
  for (const row of IMAGE_MAGICS) {
    if (buf.length >= row.bytes.length && row.bytes.every((b, i) => buf[i] === b)) {
      if (row.kind === "image/webp") {
        if (buf.length >= 12 && buf.toString("ascii", 8, 12) === "WEBP") {
          return "image/webp";
        }
        continue;
      }
      return row.kind;
    }
  }
  if (buf.length >= 5 && buf.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) {
    return "application/zip";
  }
  // PE executable
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) {
    return "application/x-msdownload";
  }
  // Shebang scripts
  if (buf.length >= 2 && buf[0] === 0x23 && buf[1] === 0x21) {
    return "application/x-script";
  }
  const decl = (declared ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (decl) return decl;
  return null;
}

export function classifyContent(
  mime: string | null,
  fileName?: string | null,
): DetectedContentKind {
  const ext = extensionOf(fileName);
  if (ext && BLOCKED_EXECUTABLE_EXTENSIONS.has(ext)) return "dangerous";
  if (!mime) return "unknown";
  if (
    mime === "application/x-msdownload" ||
    mime === "application/x-msdos-program" ||
    mime === "application/x-executable" ||
    mime === "application/x-script" ||
    mime.includes("javascript") ||
    mime.includes("powershell")
  ) {
    return "dangerous";
  }
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/") || mime === "application/json") return "text";
  if (
    mime === "application/zip" ||
    mime === "application/x-zip-compressed" ||
    mime === "application/gzip" ||
    mime === "application/x-tar"
  ) {
    return "archive";
  }
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "unknown";
}

export function extensionOf(name?: string | null): string | null {
  if (!name) return null;
  const base = name.split(/[/\\]/).pop() ?? name;
  const m = /\.([a-z0-9]{1,8})$/i.exec(base);
  return m ? `.${m[1]!.toLowerCase()}` : null;
}

export function extensionForMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "application/pdf":
      return ".pdf";
    case "application/zip":
      return ".zip";
    case "text/plain":
      return ".txt";
    default:
      return ".bin";
  }
}

export function isAllowedDownload(kind: DetectedContentKind): boolean {
  return (
    kind === "image" ||
    kind === "pdf" ||
    kind === "text" ||
    kind === "archive" ||
    kind === "audio" ||
    kind === "video"
  );
}
