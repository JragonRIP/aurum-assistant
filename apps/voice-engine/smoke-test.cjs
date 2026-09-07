/**
 * Dev smoke: start (or use) local voice engine, synthesize 5 phrases, write WAVs, play via ffplay/powershell.
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const ROOT = path.join(__dirname);
const PY = path.join(ROOT, ".venv", "Scripts", "python.exe");
const SECRET = "devsmoke42";
const PORT = 8766;
const phrases = [
  "Good morning. Aurum is ready.",
  "You have three things on your schedule today.",
  "Your meeting moved to four-thirty.",
  "Spotify is open. What would you like to hear?",
  "Everything is running normally.",
];

function postSynthesize(text) {
  const body = JSON.stringify({ text, voice: "bm_george", speed: 1.0 });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path: "/synthesize",
        method: "POST",
        headers: {
          Authorization: `Bearer ${SECRET}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({ status: res.statusCode, buf: Buffer.concat(chunks) });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(180_000);
    req.write(body);
    req.end();
  });
}

function waitReady(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("start timeout")), timeoutMs);
    const onData = (d) => {
      buf += d.toString("utf8");
      process.stdout.write(d);
      if (buf.includes("AURUM_VOICE_ENGINE_READY")) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`engine exit ${code}`));
    });
  });
}

async function main() {
  if (!fs.existsSync(PY)) throw new Error("venv python missing");
  const env = {
    ...process.env,
    PATH: `C:\\Program Files\\eSpeak NG;${process.env.PATH || ""}`,
    AURUM_VOICE_ENGINE_SECRET: SECRET,
    AURUM_VOICE_ENGINE_PORT: String(PORT),
    PYTHONUNBUFFERED: "1",
  };
  const child = spawn(PY, ["server.py"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const t0 = Date.now();
  await waitReady(child, 180_000);
  console.log(JSON.stringify({ stage: "ready", startup_ms: Date.now() - t0 }));

  // Give warm model load a moment if still loading
  await new Promise((r) => setTimeout(r, 2000));

  const results = [];
  for (let i = 0; i < phrases.length; i++) {
    const started = Date.now();
    const { status, buf } = await postSynthesize(phrases[i]);
    const latency = Date.now() - started;
    const out = path.join(ROOT, `smoke-${i + 1}.wav`);
    fs.writeFileSync(out, buf);
    results.push({
      i: i + 1,
      status,
      latency_ms: latency,
      bytes: buf.length,
      riff: buf.slice(0, 4).toString("ascii") === "RIFF",
      path: out,
    });
    console.log(JSON.stringify({ stage: "phrase", ...results[i] }));
  }

  // Play each WAV with Windows default association (non-blocking enough for smoke)
  for (const r of results) {
    if (r.riff) {
      spawn("cmd", ["/c", "start", "", "/min", r.path], {
        windowsHide: true,
        shell: false,
      });
      await new Promise((res) => setTimeout(res, 2800));
    }
  }

  child.kill();
  console.log(JSON.stringify({ stage: "summary", results }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
