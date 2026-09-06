/**
 * Apply build/icon.ico + Windows version strings to the packaged EXE when
 * signAndEditExecutable is false (electron-builder skips rcedit in that mode).
 */
const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

function resolveRceditExe() {
  const archName = process.arch === "ia32" ? "rcedit.exe" : "rcedit-x64.exe";
  const candidates = [
    path.join(__dirname, "..", "node_modules", "rcedit", "bin", archName),
    path.join(__dirname, "..", "node_modules", "rcedit", "bin", "rcedit.exe"),
    path.join(__dirname, "..", "..", "..", "node_modules", "rcedit", "bin", archName),
    path.join(__dirname, "..", "..", "..", "node_modules", "rcedit", "bin", "rcedit.exe"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const winOpts = context.packager.platformSpecificBuildOptions ?? {};
  const baseName =
    winOpts.executableName ||
    context.packager.appInfo.productFilename ||
    "Aurum";
  const exeName = `${baseName}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(
    context.packager.projectDir,
    "build",
    "icon.ico",
  );
  const productName =
    context.packager.appInfo.productName || "Aurum Console";
  const version = context.packager.appInfo.version || "";

  if (!fs.existsSync(exePath)) {
    console.warn(`[afterPack] EXE not found: ${exePath}`);
    return;
  }
  if (!fs.existsSync(iconPath)) {
    console.warn(`[afterPack] icon.ico not found: ${iconPath}`);
    return;
  }

  const rceditExe = resolveRceditExe();
  if (!rceditExe) {
    console.warn(
      "[afterPack] rcedit binary not found — EXE icon may remain default Electron",
    );
    return;
  }

  const args = [
    exePath,
    "--set-icon",
    iconPath,
    "--set-version-string",
    "ProductName",
    productName,
    "--set-version-string",
    "FileDescription",
    productName,
    "--set-version-string",
    "CompanyName",
    "Aurum",
    "--set-version-string",
    "LegalCopyright",
    "Copyright (c) Aurum",
    "--set-version-string",
    "InternalName",
    baseName,
    "--set-version-string",
    "OriginalFilename",
    exeName,
  ];
  if (version) {
    args.push("--set-file-version", version, "--set-product-version", version);
  }

  const result = spawnSync(rceditExe, args, { encoding: "utf8" });
  if (result.status !== 0) {
    console.warn(
      `[afterPack] rcedit failed (status ${result.status}): ${result.stderr || result.stdout || "unknown"}`,
    );
    return;
  }
  console.log(`[afterPack] Applied icon + version strings to ${exeName}`);
};
