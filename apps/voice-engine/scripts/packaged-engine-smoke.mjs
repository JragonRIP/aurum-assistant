/**
 * Smoke the packaged voice engine tree (resources/voice-engine).
 * Records spawn→listening, spawn→READY, and warm synth latency.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..", "desktop", "resources", "voice-engine");
const python = path.join(root, "runtime", "python.exe");
const serverPy = path.join(root, "server.py");
const models = path.join(root, "models");
const hub = path.join(models, "hub");

if (!fs.existsSync(python) || !fs.existsSync(serverPy)) {
  console.error("Packaged voice engine missing — run prepare-packaged-runtime.mjs");
  process.exit(1);
}

const secret = crypto.randomBytes(24).toString("hex");
const espeakDll = path.join(
  root,
  "runtime",
  "Lib",
  "site-packages",
  "espeakng_loader",
  "espeak-ng.dll",
);

const started = Date.now();
let listeningMs = null;
let readyMs = null;

const child = spawn(python, [serverPy], {
  cwd: root,
  env: {
    ...process.env,
    AURUM_VOICE_ENGINE_SECRET: secret,
    AURUM_VOICE_ENGINE_PORT: "0",
    PYTHONUNBUFFERED: "1",
    HF_HOME: models,
    HUGGINGFACE_HUB_CACHE: hub,
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    PHONEMIZER_ESPEAK_LIBRARY: fs.existsSync(espeakDll) ? espeakDll : "",
    ESPEAK_DATA_PATH: fs.existsSync(espeakDll)
      ? path.join(path.dirname(espeakDll), "espeak-ng-data")
      : "",
    PATH: `${path.dirname(espeakDll)};${process.env.PATH || ""}`,
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let stdout = "";
child.stdout.on("data", (buf) => {
  const s = buf.toString("utf8");
  stdout += s;
  process.stdout.write(s);
  const listen = s.match(/AURUM_VOICE_ENGINE_LISTENING\s+port=(\d+)/);
  if (listen && listeningMs == null) {
    listeningMs = Date.now() - started;
    console.log(`\n[smoke] spawn→listening ${listeningMs}ms port=${listen[1]}`);
  }
  const ready = s.match(/AURUM_VOICE_ENGINE_MODEL_READY\s+port=(\d+)/);
  if (ready) {
    readyMs = Date.now() - started;
    console.log(`[smoke] spawn→READY ${readyMs}ms`);
    void synth(Number(ready[1]));
  }
});
child.stderr.on("data", (buf) => process.stderr.write(buf));

async function synth(port) {
  const t0 = Date.now();
  const res = await fetch(`http://127.0.0.1:${port}/synthesize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: "Aurum local voice is ready.",
      voice: "bm_george",
    }),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const synthMs = Date.now() - t0;
  const ok = res.ok && buf.slice(0, 4).toString("ascii") === "RIFF";
  console.log(
    `[smoke] warm synth ${synthMs}ms bytes=${buf.length} wav=${ok} status=${res.status}`,
  );
  child.kill();
  if (!ok || readyMs == null) process.exit(1);
  fs.writeFileSync(
    path.join(root, "packaged-smoke.json"),
    JSON.stringify(
      {
        spawnToListeningMs: listeningMs,
        spawnToReadyMs: readyMs,
        warmSynthMs: synthMs,
        wavBytes: buf.length,
        at: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(0);
}

setTimeout(() => {
  console.error("[smoke] timeout waiting for READY");
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  process.exit(1);
}, 180_000);
