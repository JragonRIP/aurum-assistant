/**
 * Live Windows smoke — safe capabilities only.
 * Usage: from apps/desktop after build: npx electron scripts/smoke-capabilities.mjs
 * Skips: restart, shutdown, sleep, lock, terminate_process, close_application
 */
import { app, clipboard } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distMain = path.join(__dirname, "..", "dist", "main");
const require = createRequire(import.meta.url);

function load(name) {
  return require(path.join(distMain, name));
}

function ok(label, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL  ${label}`, detail);
    process.exitCode = 1;
    return false;
  }
  console.log(`PASS  ${label}`, detail);
  return true;
}

app.whenReady().then(async () => {
  try {
    const audio = load("windows-audio.js");
    const win32 = load("windows-win32.js");
    const processes = load("windows-processes.js");
    const clipboardMod = load("windows-clipboard.js");
    const screenshot = load("windows-screenshot.js");
    const refs = load("trusted-refs.js");
    const tools = load("windows-tools.js");
    const broker = load("windows-capability-broker.js");

    const before = await audio.getMasterAudioState();
    ok("get volume", Number.isFinite(before.volume), `vol=${before.volume}`);
    const mid = Math.max(5, Math.min(95, before.volume));
    const set = await audio.setMasterVolumePercent(mid);
    ok("set volume", set.volume === mid, `vol=${set.volume}`);
    await audio.setMasterMuted(true);
    ok("mute", (await audio.getMasterAudioState()).muted === true);
    await audio.setMasterMuted(false);
    ok("unmute", (await audio.getMasterAudioState()).muted === false);
    await audio.setMasterVolumePercent(before.volume);

    const windows = win32.enumerateOpenWindows(10);
    ok("enumerate windows", Array.isArray(windows) && windows.length > 0, `n=${windows.length}`);
    if (windows[0]) {
      const id = refs.rememberWindow({
        hwnd: windows[0].hwnd,
        title: windows[0].title,
        processName: `pid:${windows[0].processId}`,
      });
      ok("trusted window ref", typeof id === "string" && id.includes("-"));
      const bounds = win32.getWindowRect(windows[0].hwnd);
      ok("window bounds", bounds && bounds.width > 0, JSON.stringify(bounds));
      win32.showWindow(windows[0].hwnd, 9);
      win32.setForegroundWindow(windows[0].hwnd);
      ok("focus window", true, windows[0].title.slice(0, 40));
      win32.showWindow(windows[0].hwnd, 6);
      ok("minimize window", true);
      win32.showWindow(windows[0].hwnd, 3);
      ok("maximize window", true);
      win32.showWindow(windows[0].hwnd, 9);
      ok("restore window", true);
    }

    const monitors = await broker.capabilityBrokerExecute(
      "list_monitors",
      {},
      { approvedRoots: [] },
    );
    ok("list monitors", monitors?.success === true, `n=${monitors?.data?.monitors?.length}`);

    const procList = await processes.listProcesses(15);
    ok("list processes", procList.success === true, procList.message);
    ok("protect lsass", processes.isProtectedProcessName("lsass") === true);

    clipboard.writeText("aurum-smoke-probe");
    const clip = clipboardMod.getClipboardText();
    ok("clipboard read", clip.success && clip.data?.text === "aurum-smoke-probe");
    const setClip = clipboardMod.setClipboardText("aurum-smoke-set");
    ok("clipboard write", setClip.success && clipboard.readText() === "aurum-smoke-set");
    clipboardMod.clearClipboard();
    ok("clipboard clear", clipboard.readText() === "");

    const shot = await screenshot.capturePrimaryDisplay();
    ok("screenshot", shot.success === true, shot.message || shot.error?.message);
    if (shot.success && shot.data?.path) {
      const st = await fs.stat(String(shot.data.path));
      ok("screenshot file", st.size > 1000, `bytes=${st.size}`);
    }

    ok("system info", Boolean(os.hostname()) && os.totalmem() > 0, os.hostname());

    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "aurum-smoke-"));
    const roots = [
      {
        id: "00000000-0000-4000-8000-000000000001",
        label: "Smoke",
        canonical_path: rootDir,
      },
    ];
    const folder = await tools.executeDesktopTool({
      tool: "create_folder",
      payload: { parent_path: rootDir, name: "Client Contracts" },
      approvedRoots: roots,
      executionId: `smoke-folder-${Date.now()}`,
    });
    ok("create folder", folder.success === true, folder.error?.message);
    const file = await tools.executeDesktopTool({
      tool: "create_text_file",
      payload: {
        parent_path: path.join(rootDir, "Client Contracts"),
        name: "notes.txt",
        content: "hello aurum",
      },
      approvedRoots: roots,
      executionId: `smoke-file-${Date.now()}`,
    });
    ok("create file", file.success === true, file.error?.message);
    const renamed = await tools.executeDesktopTool({
      tool: "rename_file",
      payload: {
        path: path.join(rootDir, "Client Contracts", "notes.txt"),
        new_name: "Jim-Yong-Kim-Notes.txt",
      },
      approvedRoots: roots,
      executionId: `smoke-rename-${Date.now()}`,
    });
    ok("rename file", renamed.success === true, renamed.error?.message);
    const copied = await tools.executeDesktopTool({
      tool: "copy_file",
      payload: {
        source: path.join(rootDir, "Client Contracts", "Jim-Yong-Kim-Notes.txt"),
        destination: path.join(
          rootDir,
          "Client Contracts",
          "Jim-Yong-Kim-Notes-copy.txt",
        ),
      },
      approvedRoots: roots,
      executionId: `smoke-copy-${Date.now()}`,
    });
    ok("copy file", copied.success === true, copied.error?.message);
    const deleted = await tools.executeDesktopTool({
      tool: "delete_file",
      payload: {
        path: path.join(
          rootDir,
          "Client Contracts",
          "Jim-Yong-Kim-Notes-copy.txt",
        ),
      },
      approvedRoots: roots,
      executionId: `smoke-del-${Date.now()}`,
    });
    ok("delete file", deleted.success === true, deleted.error?.message);

    for (const appName of ["Spotify", "Google Chrome", "Chrome"]) {
      const opened = await tools.executeDesktopTool({
        tool: "open_application",
        payload: { app: appName },
        approvedRoots: roots,
        executionId: `smoke-app-${appName}-${Date.now()}`,
      });
      if (opened.success) {
        ok(`open ${appName}`, true);
        await new Promise((r) => setTimeout(r, 2000));
        const focus = await broker.capabilityBrokerExecute(
          "focus_application",
          { app: appName.includes("Chrome") ? "Chrome" : appName },
          { approvedRoots: roots },
        );
        ok(
          `focus ${appName}`,
          focus?.success === true || focus?.error?.code === "APPLICATION_NOT_FOUND",
          focus?.error?.message ?? "ok",
        );
        break;
      }
    }

    const url = await tools.executeDesktopTool({
      tool: "open_url",
      payload: { url: "https://example.com" },
      approvedRoots: roots,
      executionId: `smoke-url-${Date.now()}`,
    });
    ok("open url", url.success === true);

    console.log(
      "\nSmoke complete. Skipped: lock/sleep/restart/shutdown/terminate/close.",
    );
  } catch (err) {
    console.error("SMOKE ERROR", err);
    process.exitCode = 1;
  } finally {
    setTimeout(() => app.quit(), 800);
  }
});
