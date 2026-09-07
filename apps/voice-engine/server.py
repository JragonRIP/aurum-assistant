"""
Aurum Voice Engine — local Kokoro-82M TTS on loopback only.

Security:
- Bind 127.0.0.1 only
- Require per-session Bearer secret
- Max text length / body size
- No filesystem paths, shell, or dynamic code from requests
"""

from __future__ import annotations

import io
import json
import os
import struct
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

HOST = "127.0.0.1"
MAX_TEXT_CHARS = 2000
MAX_BODY_BYTES = 32_000
DEFAULT_SPEED = 1.0
MIN_SPEED = 0.7
MAX_SPEED = 1.3
SAMPLE_RATE = 24_000

# British male voices first (Aurum character), then other English.
BRITISH_MALE = [
    {"id": "bm_george", "label": "George (British male)", "lang": "b", "gender": "male"},
    {"id": "bm_lewis", "label": "Lewis (British male)", "lang": "b", "gender": "male"},
    {"id": "bm_daniel", "label": "Daniel (British male)", "lang": "b", "gender": "male"},
    {"id": "bm_fable", "label": "Fable (British male)", "lang": "b", "gender": "male"},
]
BRITISH_FEMALE = [
    {"id": "bf_emma", "label": "Emma (British female)", "lang": "b", "gender": "female"},
    {"id": "bf_isabella", "label": "Isabella (British female)", "lang": "b", "gender": "female"},
    {"id": "bf_alice", "label": "Alice (British female)", "lang": "b", "gender": "female"},
    {"id": "bf_lily", "label": "Lily (British female)", "lang": "b", "gender": "female"},
]
AMERICAN = [
    {"id": "am_adam", "label": "Adam (American male)", "lang": "a", "gender": "male"},
    {"id": "am_michael", "label": "Michael (American male)", "lang": "a", "gender": "male"},
    {"id": "af_heart", "label": "Heart (American female)", "lang": "a", "gender": "female"},
    {"id": "af_bella", "label": "Bella (American female)", "lang": "a", "gender": "female"},
]

VOICES = BRITISH_MALE + BRITISH_FEMALE + AMERICAN
VOICE_BY_ID = {v["id"]: v for v in VOICES}
DEFAULT_VOICE = "bm_george"

_auth_secret = os.environ.get("AURUM_VOICE_ENGINE_SECRET", "").strip()
_port = int(os.environ.get("AURUM_VOICE_ENGINE_PORT", "0") or "0")

_lock = threading.RLock()
_pipelines: dict[str, Any] = {}
_model_load_ms: float | None = None
_warm_ms: float | None = None
_engine_state = "starting"  # starting | loading_model | ready | error
_ready = False
_last_error: str | None = None
_synth_count = 0


def bootstrap_phonemizer() -> None:
    """Prefer bundled espeak-ng from espeakng-loader (no system MSI required)."""
    try:
        import espeakng_loader

        espeakng_loader.make_library_available()
        lib = espeakng_loader.get_library_path()
        data = espeakng_loader.get_data_path()
        if lib:
            os.environ.setdefault("PHONEMIZER_ESPEAK_LIBRARY", lib)
            # Some misaki/espeak paths resolve the DLL via PATH.
            lib_dir = os.path.dirname(lib)
            os.environ["PATH"] = lib_dir + os.pathsep + os.environ.get("PATH", "")
        if data:
            os.environ.setdefault("ESPEAK_DATA_PATH", data)
    except Exception as exc:  # noqa: BLE001
        print(
            f"VOICE_LOCAL {json.dumps({'provider':'kokoro','stage':'espeak_bootstrap','error':str(exc)[:160]}, separators=(',',':'))}",
            flush=True,
        )


bootstrap_phonemizer()


def log(stage: str, **fields: Any) -> None:
    payload = {"provider": "kokoro", "stage": stage, **fields}
    print(f"VOICE_LOCAL {json.dumps(payload, separators=(',', ':'))}", flush=True)


def set_engine_state(state: str, **fields: Any) -> None:
    global _engine_state
    _engine_state = state
    log("engine_state", state=state, **fields)


def pcm16_to_wav(pcm: bytes, sample_rate: int = SAMPLE_RATE) -> bytes:
    data_size = len(pcm) - (len(pcm) % 2)
    pcm = pcm[:data_size]
    buf = io.BytesIO()
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + data_size))
    buf.write(b"WAVE")
    buf.write(b"fmt ")
    buf.write(struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16))
    buf.write(b"data")
    buf.write(struct.pack("<I", data_size))
    buf.write(pcm)
    return buf.getvalue()


def float_audio_to_pcm16(audio) -> bytes:
    import numpy as np

    arr = np.asarray(audio, dtype=np.float32)
    arr = np.clip(arr, -1.0, 1.0)
    pcm = (arr * 32767.0).astype(np.int16)
    return pcm.tobytes()


def get_pipeline(lang: str):
    global _model_load_ms, _ready, _last_error
    with _lock:
        if lang in _pipelines:
            return _pipelines[lang]
        started = time.perf_counter()
        set_engine_state("loading_model", lang=lang)
        log("model_load_start", lang=lang)
        try:
            from kokoro import KPipeline

            pipeline = KPipeline(lang_code=lang)
            _pipelines[lang] = pipeline
            _model_load_ms = (time.perf_counter() - started) * 1000.0
            _last_error = None
            log("model_load", lang=lang, latency_ms=round(_model_load_ms, 1))
            return pipeline
        except Exception as exc:  # noqa: BLE001
            _last_error = str(exc)[:200]
            _ready = False
            set_engine_state("error", lang=lang, error=_last_error)
            log("model_load_error", lang=lang, error=_last_error)
            raise


def synthesize(text: str, voice: str, speed: float, *, warm: bool = False) -> bytes:
    global _synth_count
    voice_meta = VOICE_BY_ID.get(voice) or VOICE_BY_ID[DEFAULT_VOICE]
    lang = voice_meta["lang"]
    voice_id = voice_meta["id"]
    if not warm:
        log("synthesize_started", voice=voice_id, text_length=len(text))
    pipeline = get_pipeline(lang)
    started = time.perf_counter()
    chunks: list[Any] = []
    with _lock:
        generator = pipeline(text, voice=voice_id, speed=speed)
        for _gs, _ps, audio in generator:
            chunks.append(audio)
    if not chunks:
        raise RuntimeError("Kokoro returned no audio")
    import numpy as np

    audio = np.concatenate(chunks) if len(chunks) > 1 else chunks[0]
    pcm = float_audio_to_pcm16(audio)
    wav = pcm16_to_wav(pcm, SAMPLE_RATE)
    latency_ms = (time.perf_counter() - started) * 1000.0
    if not warm:
        _synth_count += 1
        log(
            "synthesize_complete",
            voice=voice_id,
            speed=speed,
            text_length=len(text),
            audio_bytes=len(wav),
            latency_ms=round(latency_ms, 1),
            warm=_synth_count > 1,
        )
    return wav


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        # Suppress default access logs; use VOICE_LOCAL only.
        return

    def _client_ok(self) -> bool:
        host = self.client_address[0]
        return host in ("127.0.0.1", "::1", "localhost")

    def _auth_ok(self) -> bool:
        if not _auth_secret:
            return False
        header = self.headers.get("Authorization", "")
        if header.startswith("Bearer "):
            return header[7:].strip() == _auth_secret
        return self.headers.get("X-Aurum-Voice-Secret", "").strip() == _auth_secret

    def _send(self, status: int, body: bytes, content_type: str, extra: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if extra:
            for k, v in extra.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, obj: dict[str, Any]) -> None:
        raw = json.dumps(obj).encode("utf-8")
        self._send(status, raw, "application/json; charset=utf-8")

    def _reject(self, status: int, code: str, error: str) -> None:
        self._json(status, {"ok": False, "code": code, "error": error})

    def do_GET(self) -> None:  # noqa: N802
        if not self._client_ok():
            self._reject(403, "forbidden", "Localhost only")
            return
        if not self._auth_ok():
            self._reject(401, "unauthorized", "Invalid voice engine secret")
            return
        path = urlparse(self.path).path
        if path == "/health":
            self._json(
                200,
                {
                    "ok": True,
                    "provider": "kokoro",
                    "model": "Kokoro-82M",
                    "state": _engine_state,
                    "ready": _ready and _engine_state == "ready",
                    "model_load_ms": _model_load_ms,
                    "warm_ms": _warm_ms,
                    "synth_count": _synth_count,
                    "default_voice": DEFAULT_VOICE,
                    "last_error": _last_error,
                    "sample_rate": SAMPLE_RATE,
                },
            )
            return
        if path == "/voices":
            # Allow voice list while loading so Settings can populate.
            self._json(
                200,
                {
                    "ok": True,
                    "voices": VOICES,
                    "default_voice": DEFAULT_VOICE,
                    "state": _engine_state,
                    "ready": _ready and _engine_state == "ready",
                },
            )
            return
        self._reject(404, "not_found", "Unknown path")

    def do_POST(self) -> None:  # noqa: N802
        if not self._client_ok():
            self._reject(403, "forbidden", "Localhost only")
            return
        if not self._auth_ok():
            self._reject(401, "unauthorized", "Invalid voice engine secret")
            return
        path = urlparse(self.path).path
        if path != "/synthesize":
            self._reject(404, "not_found", "Unknown path")
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0 or length > MAX_BODY_BYTES:
            self._reject(400, "invalid_body", "Invalid body size")
            return
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:  # noqa: BLE001
            self._reject(400, "invalid_json", "Invalid JSON")
            return
        if not isinstance(payload, dict):
            self._reject(400, "invalid_json", "Expected object")
            return
        text = payload.get("text")
        if not isinstance(text, str):
            self._reject(400, "invalid_text", "text required")
            return
        text = text.strip()
        if not text or len(text) > MAX_TEXT_CHARS:
            self._reject(400, "invalid_text", f"text must be 1–{MAX_TEXT_CHARS} chars")
            return
        # Reject path-like / command-like injection fields
        for banned in ("path", "file", "command", "shell", "cwd", "module"):
            if banned in payload:
                self._reject(400, "invalid_request", "Unsupported field")
                return
        voice = payload.get("voice") or DEFAULT_VOICE
        if not isinstance(voice, str) or voice not in VOICE_BY_ID:
            self._reject(400, "invalid_voice", "Unknown voice")
            return
        speed_raw = payload.get("speed", DEFAULT_SPEED)
        try:
            speed = float(speed_raw)
        except Exception:  # noqa: BLE001
            self._reject(400, "invalid_speed", "speed must be a number")
            return
        if speed < MIN_SPEED or speed > MAX_SPEED:
            self._reject(400, "invalid_speed", f"speed must be {MIN_SPEED}–{MAX_SPEED}")
            return
        if not _ready or _engine_state != "ready":
            self._reject(503, "model_loading", "Voice model is still loading")
            return
        try:
            wav = synthesize(text, voice, speed)
            self._send(
                200,
                wav,
                "audio/wav",
                {
                    "X-Aurum-Voice": voice,
                    "X-Aurum-Provider": "kokoro",
                    "X-Aurum-Sample-Rate": str(SAMPLE_RATE),
                },
            )
        except Exception as exc:  # noqa: BLE001
            err = str(exc)[:200]
            log("synthesize_error", error=err)
            self._reject(500, "tts_failed", "Synthesis failed")


def main() -> int:
    global _ready, _warm_ms, _last_error
    if not _auth_secret:
        print("AURUM_VOICE_ENGINE_SECRET is required", file=sys.stderr)
        return 2
    set_engine_state("starting")
    server = ThreadingHTTPServer((HOST, _port), Handler)
    bound_port = server.server_address[1]
    # Listening only — model not ready yet.
    print(f"AURUM_VOICE_ENGINE_LISTENING port={bound_port}", flush=True)
    log("listening", host=HOST, port=bound_port)

    def _warm() -> None:
        global _ready, _warm_ms, _last_error
        warm_started = time.perf_counter()
        try:
            set_engine_state("loading_model")
            # Load model + discard one short synth so first user turn is warm.
            synthesize("Ready.", DEFAULT_VOICE, DEFAULT_SPEED, warm=True)
            _warm_ms = (time.perf_counter() - warm_started) * 1000.0
            _ready = True
            set_engine_state(
                "ready",
                model_load_ms=_model_load_ms,
                warm_ms=round(_warm_ms, 1),
            )
            print(
                f"AURUM_VOICE_ENGINE_MODEL_READY port={bound_port} warm_ms={round(_warm_ms, 1)}",
                flush=True,
            )
            log("warm_complete", warm_ms=round(_warm_ms, 1))
        except Exception as exc:  # noqa: BLE001
            _last_error = str(exc)[:200]
            _ready = False
            set_engine_state("error", error=_last_error)
            traceback.print_exc()

    try:
        threading.Thread(target=_warm, name="kokoro-warm", daemon=True).start()
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        log("shutdown")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
