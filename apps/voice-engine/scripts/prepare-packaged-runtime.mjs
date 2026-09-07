/**
 * Prepare a redistributable Aurum Voice Engine tree for electron-builder.
 *
 * Architecture (reliability + unchanged Kokoro quality):
 *   Windows embeddable CPython 3.12 + site-packages from the verified .venv
 *   + server.py
 *   + pre-seeded Hugging Face hub cache for hexgrad/Kokoro-82M
 *   + espeak-ng via espeakng-loader (no system MSI)
 *
 * Output: apps/desktop/resources/voice-engine/
 *
 * Usage:
 *   node apps/voice-engine/scripts/prepare-packaged-runtime.mjs
 *   node apps/voice-engine/scripts/prepare-packaged-runtime.mjs --skip-model-warm
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(engineRoot, "..", "..");
const destRoot = path.join(
  repoRoot,
  "apps",
  "desktop",
  "resources",
  "voice-engine",
);
const skipWarm = process.argv.includes("--skip-model-warm");

const PYTHON_EMBED_VERSION = "3.12.10";
const PYTHON_EMBED_URL = `https://www.python.org/ftp/python/${PYTHON_EMBED_VERSION}/python-${PYTHON_EMBED_VERSION}-embed-amd64.zip`;

function fail(msg) {
  console.error(`[voice-pack] ${msg}`);
  process.exit(1);
}

function pythonInVenv() {
  const win = path.join(engineRoot, ".venv", "Scripts", "python.exe");
  const nix = path.join(engineRoot, ".venv", "bin", "python");
  if (fs.existsSync(win)) return win;
  if (fs.existsSync(nix)) return nix;
  return null;
}

function ensureVenv() {
  let py = pythonInVenv();
  if (py) return py;
  console.log("[voice-pack] Creating .venv…");
  const created = spawnSync("py", ["-3.12", "-m", "venv", ".venv"], {
    cwd: engineRoot,
    encoding: "utf8",
    shell: true,
  });
  if (created.status !== 0) {
    const created2 = spawnSync("python", ["-m", "venv", ".venv"], {
      cwd: engineRoot,
      encoding: "utf8",
      shell: true,
    });
    if (created2.status !== 0) {
      fail(
        `venv create failed:\n${created.stderr || ""}\n${created2.stderr || ""}`,
      );
    }
  }
  py = pythonInVenv();
  if (!py) fail("venv python missing after create");
  console.log("[voice-pack] pip install -r requirements.txt…");
  const pip = spawnSync(
    py,
    ["-m", "pip", "install", "--upgrade", "pip", "wheel", "setuptools"],
    { cwd: engineRoot, encoding: "utf8" },
  );
  if (pip.status !== 0) fail(`pip upgrade failed:\n${pip.stderr}`);
  const req = spawnSync(py, ["-m", "pip", "install", "-r", "requirements.txt"], {
    cwd: engineRoot,
    encoding: "utf8",
  });
  if (req.status !== 0) fail(`pip install failed:\n${req.stderr}`);
  return py;
}

function copyFiltered(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (p) => {
      const base = path.basename(p);
      if (base === "__pycache__" || base.endsWith(".pyc")) return false;
      if (base === "tests" || base === "test") return false;
      if (base === ".git") return false;
      return true;
    },
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    https
      .get(url, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          file.close();
          try {
            fs.unlinkSync(dest);
          } catch {
            /* ignore */
          }
          download(res.headers.location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        pipeline(res, file).then(resolve, reject);
      })
      .on("error", reject);
  });
}

function unzip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const ps = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
    ],
    { encoding: "utf8" },
  );
  if (ps.status !== 0) {
    fail(`unzip failed:\n${ps.stderr || ps.stdout}`);
  }
}

async function installEmbeddableRuntime(outRoot) {
  const cacheDir = path.join(engineRoot, ".pack-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const zipName = `python-${PYTHON_EMBED_VERSION}-embed-amd64.zip`;
  const zipPath = path.join(cacheDir, zipName);
  if (!fs.existsSync(zipPath)) {
    console.log(`[voice-pack] Downloading ${PYTHON_EMBED_URL}…`);
    await download(PYTHON_EMBED_URL, zipPath);
  }

  const runtime = path.join(outRoot, "runtime");
  fs.mkdirSync(runtime, { recursive: true });
  console.log("[voice-pack] Extracting embeddable CPython…");
  unzip(zipPath, runtime);

  const pth = fs
    .readdirSync(runtime)
    .find((f) => f.endsWith("._pth") && f.startsWith("python"));
  if (!pth) fail("embeddable ._pth missing");
  fs.writeFileSync(
    path.join(runtime, pth),
    ["python312.zip", ".", "Lib/site-packages", "import site"].join("\n") +
      "\n",
  );

  const sitePackages = path.join(runtime, "Lib", "site-packages");
  const venvSite = path.join(engineRoot, ".venv", "Lib", "site-packages");
  if (!fs.existsSync(venvSite)) fail("venv site-packages missing");
  console.log("[voice-pack] Copying site-packages into embeddable runtime…");
  copyFiltered(venvSite, sitePackages);

  const pythonExe = path.join(runtime, "python.exe");
  if (!fs.existsSync(pythonExe)) fail("embeddable python.exe missing");
  return pythonExe;
}

function seedModels(py, outRoot) {
  const models = path.join(outRoot, "models");
  const hub = path.join(models, "hub");
  fs.mkdirSync(hub, { recursive: true });

  const userHub = path.join(os.homedir(), ".cache", "huggingface", "hub");
  const cached = path.join(userHub, "models--hexgrad--Kokoro-82M");
  if (fs.existsSync(cached)) {
    console.log("[voice-pack] Copying cached Kokoro-82M hub snapshot…");
    copyFiltered(cached, path.join(hub, "models--hexgrad--Kokoro-82M"));
  }

  if (skipWarm) {
    if (!fs.existsSync(path.join(hub, "models--hexgrad--Kokoro-82M"))) {
      fail("No Kokoro cache and --skip-model-warm set");
    }
    return;
  }

  console.log("[voice-pack] Warming Kokoro to ensure model assets…");
  const code = `
import os
os.environ["HF_HOME"] = ${JSON.stringify(models)}
os.environ["HUGGINGFACE_HUB_CACHE"] = ${JSON.stringify(hub)}
from kokoro import KPipeline
p = KPipeline(lang_code="b")
list(p("Ready.", voice="bm_george"))
print("WARM_OK")
`.trim();
  const warm = spawnSync(py, ["-c", code], {
    cwd: engineRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HF_HOME: models,
      HUGGINGFACE_HUB_CACHE: hub,
    },
    timeout: 600_000,
  });
  if (warm.status !== 0 || !String(warm.stdout || "").includes("WARM_OK")) {
    fail(`model warm failed:\n${warm.stdout}\n${warm.stderr}`);
  }
}

function writeNotices(outRoot) {
  const notices = path.join(engineRoot, "THIRD_PARTY_NOTICES.txt");
  if (fs.existsSync(notices)) {
    fs.copyFileSync(notices, path.join(outRoot, "THIRD_PARTY_NOTICES.txt"));
  }
}

function dirBytes(root) {
  let total = 0;
  const walk = (p) => {
    for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, ent.name);
      if (ent.isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    }
  };
  walk(root);
  return total;
}

function verifyBundledPython(pythonExe, outRoot) {
  console.log("[voice-pack] Verifying bundled python imports…");
  const check = spawnSync(
    pythonExe,
    [
      "-c",
      "import kokoro, espeakng_loader, torch, soundfile, numpy; espeakng_loader.make_library_available(); print('IMPORT_OK')",
    ],
    { encoding: "utf8", cwd: outRoot },
  );
  if (check.status !== 0 || !String(check.stdout || "").includes("IMPORT_OK")) {
    fail(`bundled import check failed:\n${check.stdout}\n${check.stderr}`);
  }
}

function publishStaging(staging) {
  fs.mkdirSync(path.dirname(destRoot), { recursive: true });
  if (fs.existsSync(destRoot)) {
    const stale = `${destRoot}.stale-${Date.now()}`;
    try {
      fs.renameSync(destRoot, stale);
      setTimeout(() => {
        try {
          fs.rmSync(stale, { recursive: true, force: true });
        } catch {
          /* OneDrive may keep stale until reboot; harmless */
        }
      }, 0).unref?.();
    } catch {
      console.warn(
        "[voice-pack] dest locked; copying over existing tree instead of replace",
      );
      copyFiltered(staging, destRoot);
      try {
        fs.rmSync(staging, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      return;
    }
  }
  try {
    fs.renameSync(staging, destRoot);
  } catch {
    copyFiltered(staging, destRoot);
    try {
      fs.rmSync(staging, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  if (
    process.argv.includes("--skip-if-present") &&
    fs.existsSync(path.join(destRoot, "engine.json")) &&
    fs.existsSync(path.join(destRoot, "runtime", "python.exe")) &&
    fs.existsSync(path.join(destRoot, "server.py")) &&
    fs.existsSync(
      path.join(destRoot, "models", "hub", "models--hexgrad--Kokoro-82M"),
    )
  ) {
    const size = dirBytes(destRoot);
    console.log(
      `[voice-pack] Already present → ${destRoot} (${(size / (1024 * 1024)).toFixed(0)} MiB)`,
    );
    return;
  }

  console.log("[voice-pack] Preparing packaged voice engine…");
  const venvPy = ensureVenv();
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aurum-voice-engine-"));

  fs.copyFileSync(
    path.join(engineRoot, "server.py"),
    path.join(outRoot, "server.py"),
  );
  fs.copyFileSync(
    path.join(engineRoot, "requirements.txt"),
    path.join(outRoot, "requirements.txt"),
  );
  writeNotices(outRoot);

  const bundledPy = await installEmbeddableRuntime(outRoot);
  verifyBundledPython(bundledPy, outRoot);

  seedModels(venvPy, outRoot);

  console.log("[voice-pack] Offline bundled synth smoke…");
  const models = path.join(outRoot, "models");
  const hub = path.join(models, "hub");
  const smoke = spawnSync(
    bundledPy,
    [
      "-c",
      `
import os
os.environ["HF_HOME"] = ${JSON.stringify(models)}
os.environ["HUGGINGFACE_HUB_CACHE"] = ${JSON.stringify(hub)}
os.environ["HF_HUB_OFFLINE"] = "1"
from kokoro import KPipeline
p = KPipeline(lang_code="b")
list(p("Aurum offline.", voice="bm_george"))
print("OFFLINE_OK")
`.trim(),
    ],
    {
      encoding: "utf8",
      cwd: outRoot,
      env: {
        ...process.env,
        HF_HOME: models,
        HUGGINGFACE_HUB_CACHE: hub,
        HF_HUB_OFFLINE: "1",
      },
      timeout: 300_000,
    },
  );
  if (smoke.status !== 0 || !String(smoke.stdout || "").includes("OFFLINE_OK")) {
    fail(`offline bundled smoke failed:\n${smoke.stdout}\n${smoke.stderr}`);
  }

  const marker = {
    name: "aurum-voice-engine",
    bundled: true,
    kokoro: "0.9.4",
    pythonEmbed: PYTHON_EMBED_VERSION,
    defaultVoice: "bm_george",
    architecture: "windows-embeddable-cpython-plus-site-packages",
    preparedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(outRoot, "engine.json"),
    JSON.stringify(marker, null, 2) + "\n",
  );

  publishStaging(outRoot);

  const size = dirBytes(destRoot);
  console.log(
    `[voice-pack] Done → ${destRoot} (${(size / (1024 * 1024)).toFixed(0)} MiB)`,
  );
}

main().catch((err) => {
  fail(String(err?.stack || err));
});
