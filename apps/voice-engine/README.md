# Aurum Voice Engine

Local Kokoro-82M TTS for Aurum Console.

## Dev setup (Windows)

1. Install Python 3.12+
2. From this directory:

```bat
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

`espeakng-loader` ships `espeak-ng.dll` + data — a system eSpeak MSI is optional for development.

3. Aurum Console launches `server.py` automatically with a session secret.

Do not expose this service beyond 127.0.0.1.

## Packaging (installer)

Aurum Console 0.3.5+ bundles a **Windows embeddable CPython** runtime plus Kokoro site-packages and a pre-seeded `hexgrad/Kokoro-82M` hub cache. End users do **not** install Python or eSpeak manually.

```bat
node apps/voice-engine/scripts/prepare-packaged-runtime.mjs
```

This writes `apps/desktop/resources/voice-engine/` (gitignored). `electron-builder` copies it to `resources/voice-engine` via `extraResources`.

Licenses / notices: see `THIRD_PARTY_NOTICES.txt`.
