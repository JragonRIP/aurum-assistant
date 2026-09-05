/**
 * Run the desktop companion against a local Aurum web server.
 * Sets AURUM_WEB_URL only if the shell has not already set it.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL = "http://127.0.0.1:3000";

if (!process.env.AURUM_WEB_URL?.trim()) {
  process.env.AURUM_WEB_URL = LOCAL;
}

console.info(`[aurum:desktop] AURUM_WEB_URL=${process.env.AURUM_WEB_URL}`);

const child = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "dev"],
  {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: false,
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
