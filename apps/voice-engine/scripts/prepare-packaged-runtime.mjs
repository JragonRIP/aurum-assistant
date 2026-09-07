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
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function step(msg) {
  console.log(`[voice-pack] ${msg}`);
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::notice::${msg}`);
  }
}

function fail(msg) {
  const text = `[voice-pack] ${msg}`;
  console.error(text);
  if (process.env.GITHUB_ACTIONS) {
    const oneLine = String(msg).replace(/\r?\n/g, " · ").slice(0, 3500);
    console.error(`::error::${oneLine}`);
    try {
      if (process.env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(
          process.env.GITHUB_STEP_SUMMARY,
          `\n### Voice engine pack failed\n\n\`\`\`\n${String(msg).slice(0, 8000)}\n\`\`\`\n`,
        );
      }
    } catch {
      /* ignore */
    }
  }
  process.exit(1);
}

function pythonInVenv() {
  const win = path.join(engineRoot, ".venv", "Scripts", "python.exe");
  const nix = path.join(engineRoot, ".venv", "bin", "python");
  if (fs.existsSync(win)) return win;
  if (fs.existsSync(nix)) return nix;
  return null;
}

function spawnPython(py, args, extra = {}) {
  const inherit = extra.inherit === true;
  const opts = { ...extra };
  delete opts.inherit;
  return spawnSync(py, args, {
    encoding: inherit ? undefined : "utf8",
    stdio: inherit ? "inherit" : "pipe",
    maxBuffer: 32 * 1024 * 1024,
    ...opts,
  });
}

function failSpawn(label, result) {
  fail(
    `${label} failed (exit ${result.status}):\n${result.stdout || ""}\n${result.stderr || ""}`,
  );
}

const ESPEAK_BOOTSTRAP = `
import os
try:
    import espeakng_loader
    espeakng_loader.make_library_available()
    lib = espeakng_loader.get_library_path()
    data = espeakng_loader.get_data_path()
    if lib:
        os.environ["PHONEMIZER_ESPEAK_LIBRARY"] = lib
        os.environ["PATH"] = os.path.dirname(lib) + os.pathsep + os.environ.get("PATH", "")
    if data:
        os.environ["ESPEAK_DATA_PATH"] = data
except Exception as exc:
    print("ESPEAK_BOOTSTRAP_WARN", exc)
`.trim();

function ensureVenv() {
  let py = pythonInVenv();
  if (py) return py;
  console.log("[voice-pack] Creating .venv…");
  // CI (setup-python) exposes `python`; local Windows often has `py`.
  const created = spawnSync("python", ["-m", "venv", ".venv"], {
    cwd: engineRoot,
    encoding: "utf8",
    shell: true,
  });
  if (created.status !== 0) {
    const created2 = spawnSync("py", ["-3.12", "-m", "venv", ".venv"], {
      cwd: engineRoot,
      encoding: "utf8",
      shell: true,
    });
    if (created2.status !== 0) {
      fail(
        `venv create failed:\n${created.stderr || created.stdout || ""}\n${created2.stderr || created2.stdout || ""}`,
      );
    }
  }
  py = pythonInVenv();
  if (!py) fail("venv python missing after create");
  console.log("[voice-pack] pip install -r requirements.txt…");
  const pip = spawnPython(
    py,
    ["-m", "pip", "install", "--upgrade", "pip", "wheel", "setuptools"],
    { cwd: engineRoot, inherit: true },
  );
  if (pip.status !== 0) fail(`pip upgrade failed (exit ${pip.status})`);
  const req = spawnPython(
    py,
    ["-m", "pip", "install", "-r", "requirements.txt"],
    { cwd: engineRoot, inherit: true },
  );
  if (req.status !== 0) fail(`pip install failed (exit ${req.status})`);
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
  console.log(`[voice-pack] Downloading ${url}…`);
  const curl = spawnSync(
    "curl.exe",
    ["-L", "--fail", "--retry", "3", "-A", "AurumVoicePack/0.3.5", "-o", dest, url],
    { encoding: "utf8", stdio: "inherit" },
  );
  if (curl.status !== 0 || !fs.existsSync(dest) || fs.statSync(dest).size < 1000) {
    fail(`download failed for ${url} (exit ${curl.status})`);
  }
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
${ESPEAK_BOOTSTRAP}
import os
os.environ["HF_HOME"] = ${JSON.stringify(models)}
os.environ["HUGGINGFACE_HUB_CACHE"] = ${JSON.stringify(hub)}
from kokoro import KPipeline
p = KPipeline(lang_code="b")
list(p("Ready.", voice="bm_george"))
print("WARM_OK")
`.trim();
  const warm = spawnPython(py, ["-c", code], {
    cwd: engineRoot,
    env: {
      ...process.env,
      HF_HOME: models,
      HUGGINGFACE_HUB_CACHE: hub,
    },
    timeout: 600_000,
  });
  if (warm.status !== 0 || !String(warm.stdout || "").includes("WARM_OK")) {
    failSpawn("model warm", warm);
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
  const check = spawnPython(
    pythonExe,
    [
      "-c",
      `${ESPEAK_BOOTSTRAP}\nimport kokoro, espeakng_loader, torch, soundfile, numpy\nprint("IMPORT_OK")`,
    ],
    { cwd: outRoot },
  );
  if (check.status !== 0 || !String(check.stdout || "").includes("IMPORT_OK")) {
    failSpawn("bundled import check", check);
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
  step("ensure venv");
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

  step("install embeddable CPython + site-packages");
  const bundledPy = await installEmbeddableRuntime(outRoot);
  step("verify bundled imports");
  verifyBundledPython(bundledPy, outRoot);

  step("seed Kokoro model assets");
  seedModels(venvPy, outRoot);

  step("offline bundled synth smoke");
  const models = path.join(outRoot, "models");
  const hub = path.join(models, "hub");
  const smoke = spawnPython(
    bundledPy,
    [
      "-c",
      `
${ESPEAK_BOOTSTRAP}
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
    failSpawn("offline bundled smoke", smoke);
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
