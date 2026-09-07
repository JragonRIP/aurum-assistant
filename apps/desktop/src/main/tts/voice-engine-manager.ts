/**
 * Manage the local Aurum Voice Engine (Kokoro) companion process.
 * Hard-coded adapter only — not a general command runner.
 *
 * READY means the model is warm — not merely that HTTP is listening.
 *
 * Packaged installs launch ONLY the bundled engine under resources/voice-engine
 * (known python + server.py). No renderer/model-supplied executable paths.
 */
import { ChildProcess, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { appendVoiceLog } from "../voice-log";

export type VoiceEngineStatus =
  | "starting"
  | "loading_model"
  | "ready"
  | "not_installed"
  | "error"
  | "stopped";

export type VoiceEngineState = {
  status: VoiceEngineStatus;
  port: number | null;
  secret: string | null;
  detail: string | null;
  pid: number | null;
  modelLoadMs: number | null;
  warmMs: number | null;
  spawnToHealthMs: number | null;
  spawnToReadyMs: number | null;
};

const LISTENING_RE = /AURUM_VOICE_ENGINE_LISTENING\s+port=(\d+)/;
const MODEL_READY_RE =
  /AURUM_VOICE_ENGINE_MODEL_READY\s+port=(\d+)(?:\s+warm_ms=([\d.]+))?/;
/** Legacy single-line ready (pre warm-up split) — treat as model ready. */
const LEGACY_READY_RE = /AURUM_VOICE_ENGINE_READY\s+port=(\d+)/;

const BUNDLED_MARKER = "engine.json";

export type VoiceEngineLaunch = {
  root: string;
  serverPy: string;
  python: string;
  bundled: boolean;
  modelsDir: string | null;
};

function packagedResourcesRoot(): string | null {
  try {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "voice-engine");
    }
  } catch {
    /* app may be unavailable in unit tests */
  }
  return null;
}

/** Resolve known engine roots — packaged first, then monorepo/dev. */
export function listVoiceEngineRootCandidates(): string[] {
  const out: string[] = [];
  const packaged = packagedResourcesRoot();
  if (packaged) out.push(packaged);

  // Local unpackaged electron-builder output / staged resources
  try {
    out.push(path.join(process.resourcesPath, "voice-engine"));
  } catch {
    /* ignore */
  }

  try {
    out.push(path.join(app.getAppPath(), "..", "voice-engine"));
    out.push(path.join(app.getAppPath(), "resources", "voice-engine"));
  } catch {
    /* ignore */
  }

  out.push(
    path.join(process.cwd(), "apps", "voice-engine"),
    path.join(process.cwd(), "..", "voice-engine"),
    path.join(__dirname, "..", "..", "..", "voice-engine"),
    path.join(__dirname, "..", "..", "..", "..", "voice-engine"),
    // Staged beside desktop for pack:dir smoke
    path.join(process.cwd(), "resources", "voice-engine"),
    path.join(process.cwd(), "apps", "desktop", "resources", "voice-engine"),
  );
  return out;
}

function resolvePython(root: string): string | null {
  const candidates = [
    // Packaged: Windows embeddable CPython (python.exe at runtime root)
    path.join(root, "runtime", "python.exe"),
    path.join(root, "runtime", "Scripts", "python.exe"),
    path.join(root, "runtime", "bin", "python"),
    // Dev venv
    path.join(root, ".venv", "Scripts", "python.exe"),
    path.join(root, ".venv", "bin", "python"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function resolveVoiceEngineLaunch(
  candidates = listVoiceEngineRootCandidates(),
): VoiceEngineLaunch | null {
  for (const rootRaw of candidates) {
    const root = path.resolve(rootRaw);
    const serverPy = path.join(root, "server.py");
    if (!fs.existsSync(serverPy)) continue;
    const python = resolvePython(root);
    if (!python) continue;
    // Refuse anything outside the resolved engine root (path escape).
    const pythonResolved = path.resolve(python);
    const serverResolved = path.resolve(serverPy);
    if (
      !pythonResolved.startsWith(root + path.sep) &&
      pythonResolved !== root
    ) {
      continue;
    }
    if (!serverResolved.startsWith(root + path.sep)) continue;

    const bundled = fs.existsSync(path.join(root, BUNDLED_MARKER));
    const modelsDir = path.join(root, "models");
    return {
      root,
      serverPy: serverResolved,
      python: pythonResolved,
      bundled,
      modelsDir: fs.existsSync(modelsDir) ? modelsDir : null,
    };
  }
  return null;
}

function buildEngineEnv(
  launch: VoiceEngineLaunch,
  secret: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AURUM_VOICE_ENGINE_SECRET: secret,
    AURUM_VOICE_ENGINE_PORT: "0",
    PYTHONUNBUFFERED: "1",
  };

  // Prefer bundled espeak from the runtime site-packages; keep system as last resort.
  const espeakDllCandidates = [
    path.join(
      launch.root,
      "runtime",
      "Lib",
      "site-packages",
      "espeakng_loader",
      "espeak-ng.dll",
    ),
    path.join(
      launch.root,
      ".venv",
      "Lib",
      "site-packages",
      "espeakng_loader",
      "espeak-ng.dll",
    ),
  ];
  const pathParts: string[] = [];
  for (const dll of espeakDllCandidates) {
    if (fs.existsSync(dll)) {
      pathParts.push(path.dirname(dll));
      env.PHONEMIZER_ESPEAK_LIBRARY = dll;
      const data = path.join(path.dirname(dll), "espeak-ng-data");
      if (fs.existsSync(data)) env.ESPEAK_DATA_PATH = data;
      break;
    }
  }
  if (process.platform === "win32") {
    pathParts.push("C:\\Program Files\\eSpeak NG");
  }
  if (process.env.PATH) pathParts.push(process.env.PATH);
  env.PATH = pathParts.join(path.delimiter);

  if (launch.modelsDir) {
    env.HF_HOME = launch.modelsDir;
    env.HUGGINGFACE_HUB_CACHE = path.join(launch.modelsDir, "hub");
    env.TRANSFORMERS_CACHE = path.join(launch.modelsDir, "transformers");
    env.HF_HUB_OFFLINE = "1";
    env.TRANSFORMERS_OFFLINE = "1";
  }

  return env;
}

export class VoiceEngineManager {
  private child: ChildProcess | null = null;
  private secret: string | null = null;
  private port: number | null = null;
  private status: VoiceEngineStatus = "stopped";
  private detail: string | null = null;
  private modelLoadMs: number | null = null;
  private warmMs: number | null = null;
  private spawnToHealthMs: number | null = null;
  private spawnToReadyMs: number | null = null;
  private spawnStartedAt: number | null = null;
  private starting: Promise<VoiceEngineState> | null = null;

  getState(): VoiceEngineState {
    return {
      status: this.status,
      port: this.port,
      secret: this.secret,
      detail: this.detail,
      pid: this.child?.pid ?? null,
      modelLoadMs: this.modelLoadMs,
      warmMs: this.warmMs,
      spawnToHealthMs: this.spawnToHealthMs,
      spawnToReadyMs: this.spawnToReadyMs,
    };
  }

  baseUrl(): string | null {
    if (!this.port) return null;
    return `http://127.0.0.1:${this.port}`;
  }

  async ensureStarted(): Promise<VoiceEngineState> {
    if (this.status === "ready" && this.port && this.secret) {
      const healthy = await this.ping();
      if (healthy) return this.getState();
    }
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  async restart(): Promise<VoiceEngineState> {
    await this.stop();
    return this.ensureStarted();
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.port = null;
    this.status = "stopped";
    this.detail = null;
    this.spawnStartedAt = null;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      child.once("exit", done);
      try {
        child.kill();
      } catch {
        resolve();
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        resolve();
      }, 2000);
    });
    appendVoiceLog("stopped", { channel: "VOICE_LOCAL" });
  }

  private markModelReady(port: number, warmMs?: number) {
    this.port = port;
    this.status = "ready";
    this.detail = null;
    if (typeof warmMs === "number" && Number.isFinite(warmMs)) {
      this.warmMs = warmMs;
    }
    if (this.spawnStartedAt != null) {
      this.spawnToReadyMs = Date.now() - this.spawnStartedAt;
    }
    appendVoiceLog("ready", {
      channel: "VOICE_LOCAL",
      port: this.port,
      warm_ms: this.warmMs,
      spawn_to_ready_ms: this.spawnToReadyMs,
      spawn_to_health_ms: this.spawnToHealthMs,
      model_load_ms: this.modelLoadMs,
    });
  }

  private async start(): Promise<VoiceEngineState> {
    const launch = resolveVoiceEngineLaunch();
    if (!launch) {
      this.status = "not_installed";
      this.detail =
        "Voice engine not installed — packaged runtime or apps/voice-engine/.venv required";
      appendVoiceLog("not_installed", {
        channel: "VOICE_LOCAL",
        detail: this.detail,
      });
      return this.getState();
    }

    this.status = "starting";
    this.secret = crypto.randomBytes(24).toString("hex");
    this.port = null;
    this.detail = null;
    this.modelLoadMs = null;
    this.warmMs = null;
    this.spawnToHealthMs = null;
    this.spawnToReadyMs = null;
    this.spawnStartedAt = Date.now();

    appendVoiceLog("starting", {
      channel: "VOICE_LOCAL",
      bundled: launch.bundled,
      root: launch.root,
    });

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve(this.getState());
      };

      // argv: known python + known server.py only — never user/model argv.
      const child = spawn(launch.python, [launch.serverPy], {
        cwd: launch.root,
        env: buildEngineEnv(launch, this.secret!),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      this.child = child;

      const onLine = (line: string) => {
        const listening = line.match(LISTENING_RE);
        if (listening) {
          this.port = Number(listening[1]);
          this.status = "loading_model";
          if (this.spawnStartedAt != null) {
            this.spawnToHealthMs = Date.now() - this.spawnStartedAt;
          }
          appendVoiceLog("listening", {
            channel: "VOICE_LOCAL",
            port: this.port,
            spawn_to_health_ms: this.spawnToHealthMs,
            state: "LOADING_MODEL",
          });
        }

        const modelReady = line.match(MODEL_READY_RE);
        if (modelReady) {
          const warm =
            modelReady[2] != null ? Number(modelReady[2]) : undefined;
          this.markModelReady(Number(modelReady[1]), warm);
          finish();
          return;
        }

        const legacy = line.match(LEGACY_READY_RE);
        if (legacy) {
          this.markModelReady(Number(legacy[1]));
          finish();
          return;
        }

        if (line.includes("VOICE_LOCAL") && line.includes("model_load")) {
          try {
            const jsonStart = line.indexOf("{");
            if (jsonStart >= 0) {
              const obj = JSON.parse(line.slice(jsonStart)) as {
                latency_ms?: number;
                stage?: string;
              };
              if (
                obj.stage === "model_load" &&
                typeof obj.latency_ms === "number"
              ) {
                this.modelLoadMs = obj.latency_ms;
              }
            }
          } catch {
            /* ignore */
          }
        }

        if (line.includes("VOICE_LOCAL") && line.includes('"state":"error"')) {
          this.status = "error";
          this.detail = "Voice model failed to load";
          finish();
        }
      };

      let stdoutBuf = "";
      child.stdout.on("data", (buf: Buffer) => {
        stdoutBuf += buf.toString("utf8");
        const parts = stdoutBuf.split(/\r?\n/);
        stdoutBuf = parts.pop() ?? "";
        for (const p of parts) onLine(p);
      });

      let stderrBuf = "";
      child.stderr.on("data", (buf: Buffer) => {
        stderrBuf += buf.toString("utf8");
        if (stderrBuf.length > 2000) stderrBuf = stderrBuf.slice(-2000);
      });

      child.on("exit", (code) => {
        if (this.child === child) {
          this.child = null;
          this.port = null;
          if (this.status !== "not_installed") {
            this.status = "error";
            this.detail = `Voice engine exited (${code ?? "?"})`;
          }
          appendVoiceLog("exit", {
            channel: "VOICE_LOCAL",
            code: code ?? null,
            detail: this.detail,
          });
        }
        finish();
      });

      setTimeout(() => {
        if (
          this.status === "starting" ||
          this.status === "loading_model"
        ) {
          this.status = "error";
          this.detail =
            stderrBuf.trim().slice(0, 240) || "Voice engine start timeout";
          try {
            child.kill();
          } catch {
            /* ignore */
          }
          finish();
        }
      }, 120_000);
    });
  }

  async ping(): Promise<boolean> {
    const url = this.baseUrl();
    if (!url || !this.secret) return false;
    try {
      const res = await fetch(`${url}/health`, {
        headers: { Authorization: `Bearer ${this.secret}` },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return false;
      const json = (await res.json()) as {
        ok?: boolean;
        ready?: boolean;
        state?: string;
      };
      // Model must be READY — listening alone is not enough.
      return (
        json.ok === true &&
        (json.ready === true || json.state === "ready")
      );
    } catch {
      return false;
    }
  }
}

let shared: VoiceEngineManager | null = null;

export function getVoiceEngineManager(): VoiceEngineManager {
  if (!shared) shared = new VoiceEngineManager();
  return shared;
}
