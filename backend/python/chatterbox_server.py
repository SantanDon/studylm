"""Local expressive narration bridge for StudyPod.

Run in a dedicated Python 3.11 environment. StudyPod calls the OpenAI-shaped
POST /v1/audio/speech endpoint and receives WAV bytes. The bridge never accepts
arbitrary reference-audio paths unless explicitly enabled and constrained to a
configured reference directory.
"""

from __future__ import annotations

import hmac
import io
import logging
import os
import threading
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Literal

import torch
import torchaudio
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from chatterbox.tts import ChatterboxTTS

app = FastAPI(title="StudyPod Chatterbox Bridge", version="1.1.0")
logger = logging.getLogger("studypod.chatterbox")

_MODEL: ChatterboxTTS | None = None
_MODEL_LOCK = threading.Lock()
_MODEL_STATE_LOCK = threading.Lock()
_MODEL_STATE: dict[str, object] = {
    'status': 'idle',
    'startedAt': None,
    'completedAt': None,
    'error': None,
}
_SYNTHESIS_SEMAPHORE = threading.BoundedSemaphore(
    max(1, int(os.getenv("CHATTERBOX_MAX_CONCURRENT", "1")))
)
_DEVICE = os.getenv("CHATTERBOX_DEVICE", "auto").strip().lower()
_SERVER_REFERENCE_AUDIO = os.getenv("CHATTERBOX_REFERENCE_AUDIO", "").strip()
_REFERENCE_DIR_RAW = os.getenv("CHATTERBOX_REFERENCE_DIR", "").strip()
_REFERENCE_DIR = Path(_REFERENCE_DIR_RAW).expanduser().resolve() if _REFERENCE_DIR_RAW else None
_ALLOW_REQUEST_REFERENCE = os.getenv("CHATTERBOX_ALLOW_REQUEST_REFERENCE_PATH", "0") == "1"
_MAX_TEXT_CHARS = max(100, int(os.getenv("CHATTERBOX_MAX_TEXT_CHARS", "1400")))
_API_TOKEN = os.getenv("CHATTERBOX_API_TOKEN", "").strip()


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=_MAX_TEXT_CHARS)
    voice: Literal["chatterbox_default", "chatterbox_reference"] = "chatterbox_default"
    speed: float = Field(default=1.0, ge=0.75, le=1.25)
    exaggeration: float = Field(default=0.55, ge=0.0, le=1.5)
    cfg_weight: float = Field(default=0.4, ge=0.0, le=1.0)
    use_reference_voice: bool = False
    reference_audio_path: str | None = None
    output_format: Literal["wav"] = "wav"


def package_version(package: str) -> str:
    try:
        return version(package)
    except PackageNotFoundError:
        return "unknown"


def require_token(authorization: str | None = Header(default=None)) -> None:
    if not _API_TOKEN:
        return
    expected = f"Bearer {_API_TOKEN}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Invalid Chatterbox bridge token")


def resolve_device() -> str:
    if _DEVICE != "auto":
        return _DEVICE
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def set_model_state(**updates: object) -> None:
    with _MODEL_STATE_LOCK:
        _MODEL_STATE.update(updates)


def model_state() -> dict[str, object]:
    with _MODEL_STATE_LOCK:
        return dict(_MODEL_STATE)


def get_model() -> ChatterboxTTS:
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    with _MODEL_LOCK:
        if _MODEL is None:
            set_model_state(status='loading', startedAt=utc_now(), completedAt=None, error=None)
            try:
                _MODEL = ChatterboxTTS.from_pretrained(device=resolve_device())
                set_model_state(status='ready', completedAt=utc_now(), error=None)
            except Exception as error:
                set_model_state(status='failed', completedAt=utc_now(), error=type(error).__name__)
                logger.exception("Chatterbox model warm-up failed")
                raise
    return _MODEL


def warm_model_in_background() -> None:
    try:
        get_model()
    except Exception:
        return


def ensure_reference_is_allowed(reference: Path) -> Path:
    resolved = reference.expanduser().resolve()
    if _REFERENCE_DIR is not None:
        try:
            resolved.relative_to(_REFERENCE_DIR)
        except ValueError as error:
            raise HTTPException(
                status_code=400,
                detail="Reference audio must be inside CHATTERBOX_REFERENCE_DIR",
            ) from error
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Reference audio does not exist")
    if resolved.suffix.lower() not in {".wav", ".mp3", ".flac", ".m4a"}:
        raise HTTPException(status_code=400, detail="Reference audio must be WAV, MP3, FLAC, or M4A")
    return resolved


def resolve_reference_audio(request: SpeechRequest) -> str | None:
    wants_reference = request.use_reference_voice or request.voice == "chatterbox_reference"
    if not wants_reference:
        return None

    raw_path = _SERVER_REFERENCE_AUDIO
    if not raw_path and _ALLOW_REQUEST_REFERENCE:
        if _REFERENCE_DIR is None:
            raise HTTPException(
                status_code=503,
                detail="Request reference audio requires CHATTERBOX_REFERENCE_DIR",
            )
        raw_path = (request.reference_audio_path or "").strip()
    if not raw_path:
        raise HTTPException(
            status_code=400,
            detail="Reference voice was selected but CHATTERBOX_REFERENCE_AUDIO is not configured",
        )
    return str(ensure_reference_is_allowed(Path(raw_path)))


def synthesize(request: SpeechRequest) -> bytes:
    reference_audio = resolve_reference_audio(request)
    with _SYNTHESIS_SEMAPHORE:
        model = get_model()
        kwargs: dict[str, object] = {
            "exaggeration": request.exaggeration,
            "cfg_weight": request.cfg_weight,
        }
        if reference_audio:
            kwargs["audio_prompt_path"] = reference_audio

        waveform = model.generate(request.text.strip(), **kwargs)
        if waveform.ndim == 1:
            waveform = waveform.unsqueeze(0)
        waveform = waveform.detach().cpu()

        output = io.BytesIO()
        torchaudio.save(output, waveform, model.sr, format="wav")
        return output.getvalue()


@app.get("/health")
def health(_: None = Depends(require_token)) -> dict:
    return {
        "status": "ok",
        "provider": "chatterbox",
        "bridgeVersion": app.version,
        "chatterboxVersion": package_version("chatterbox-tts"),
        "torchVersion": package_version("torch"),
        "modelLoaded": _MODEL is not None,
        "model": model_state(),
        "device": resolve_device(),
        "referenceVoiceConfigured": bool(_SERVER_REFERENCE_AUDIO),
        "requestReferencePathsAllowed": bool(_ALLOW_REQUEST_REFERENCE and _REFERENCE_DIR),
        "referenceDirectoryConfigured": _REFERENCE_DIR is not None,
        "requestReferenceConfigurationValid": not _ALLOW_REQUEST_REFERENCE or _REFERENCE_DIR is not None,
        "maxTextChars": _MAX_TEXT_CHARS,
        "maxConcurrent": max(1, int(os.getenv("CHATTERBOX_MAX_CONCURRENT", "1"))),
        "authenticationRequired": bool(_API_TOKEN),
        "speedAppliedByBridge": False,
    }


@app.post("/warmup", status_code=202)
def warmup(_: None = Depends(require_token)) -> dict:
    state = model_state()
    if _MODEL is not None:
        return {"status": "ready", "model": state}
    if state.get("status") != "loading":
        set_model_state(status='loading', startedAt=utc_now(), completedAt=None, error=None)
        threading.Thread(target=warm_model_in_background, name='chatterbox-warmup', daemon=True).start()
    return {"status": "loading", "model": model_state()}


@app.get("/voices")
def voices(_: None = Depends(require_token)) -> dict:
    available = [
        {
            "id": "chatterbox_default",
            "name": "Expressive narrator",
            "referenceRequired": False,
        }
    ]
    if _SERVER_REFERENCE_AUDIO:
        available.append(
            {
                "id": "chatterbox_reference",
                "name": "Reference voice",
                "referenceRequired": True,
            }
        )
    return {"voices": available}


@app.post("/v1/audio/speech")
async def create_speech(
    request: SpeechRequest,
    _: None = Depends(require_token),
) -> Response:
    try:
        audio = await run_in_threadpool(synthesize, request)
        uses_reference = request.use_reference_voice or request.voice == "chatterbox_reference"
        return Response(
            content=audio,
            media_type="audio/wav",
            headers={
                "X-StudyPod-TTS-Provider": "chatterbox",
                "X-StudyPod-Reference-Voice": "configured" if uses_reference else "default",
                "X-StudyPod-Speed-Applied": "false",
            },
        )
    except HTTPException:
        raise
    except Exception as error:  # pragma: no cover - hardware/runtime dependent
        raise HTTPException(status_code=500, detail="Chatterbox synthesis failed") from error


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.getenv("CHATTERBOX_HOST", "127.0.0.1"),
        port=int(os.getenv("CHATTERBOX_PORT", "4123")),
        log_level=os.getenv("CHATTERBOX_LOG_LEVEL", "info"),
    )
