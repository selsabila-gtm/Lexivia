"""
services/sample_service.py

Validation of a submitted sample against the competition's DataComponent[].

    DataComponent = what asset is expected (type + constraints)
    SampleAsset   = the actual asset collected for one sample

Pure functions (no DB, no HTTP) so they are easy to test. Nothing here knows
about task types or annotation: creating a sample only collects assets.
"""

import io
import os
import wave
from typing import Optional

from .task_registry import ASSET_TYPES

MAX_ASSET_BYTES = 50 * 1024 * 1024          # per file
MAX_TEXT_CHARS = 200_000

MIME_BY_EXT = {
    "wav": "audio/wav", "mp3": "audio/mpeg", "flac": "audio/flac",
    "ogg": "audio/ogg", "m4a": "audio/mp4",
}


def count_words(text: str) -> int:
    return len((text or "").split())


def file_ext(filename: Optional[str]) -> str:
    return os.path.splitext(filename or "")[1].lower().lstrip(".")


def wav_duration(data: bytes) -> Optional[float]:
    """Exact duration of a WAV file, or None if it can't be parsed."""
    try:
        with wave.open(io.BytesIO(data), "rb") as w:
            rate = w.getframerate()
            return w.getnframes() / float(rate) if rate else None
    except (wave.Error, EOFError):
        return None


def _num(v):
    return None if v is None else float(v)


def check_assets(components: list, texts: dict, files: dict) -> dict:
    """
    components: DataComponent rows (need .key .name .type .required .constraints)
    texts:      {component_key: str}
    files:      {component_key: {"filename": str, "duration": float | None}}
    Returns {component_key: message}; the key "_form" is for form-level errors.
    An empty dict means the sample is valid.
    """
    errors: dict[str, str] = {}
    known = {c.key for c in components}

    for k in list(texts) + list(files):
        if k not in known:
            errors["_form"] = f"Unexpected asset '{k}' — it is not part of this competition's sample."

    for c in components:
        spec = ASSET_TYPES.get(c.type)
        cons = c.constraints or {}
        label = c.name or c.key

        if not spec:
            errors[c.key] = f"{label}: unsupported asset type '{c.type}'."
            continue

        kind = spec["kind"]
        if kind == "text":
            text = (texts.get(c.key) or "").strip()
            if not text:
                if c.required:
                    errors[c.key] = f"{label} is required."
                continue
            if len(text) > MAX_TEXT_CHARS:
                errors[c.key] = f"{label} is too long."
                continue
            words = count_words(text)
            lo, hi = cons.get("min_words"), cons.get("max_words")
            if hi is not None and words > hi:
                errors[c.key] = f"{label} has {words} words; the maximum is {hi}."
            elif lo is not None and words < lo:
                errors[c.key] = f"{label} has {words} words; the minimum is {lo}."

        elif kind == "audio":
            f = files.get(c.key)
            if not f:
                if c.required:
                    errors[c.key] = f"{label} is required."
                continue
            ext = file_ext(f.get("filename"))
            allowed = [a.lower() for a in (cons.get("allowed_formats") or [])]
            if allowed and ext not in allowed:
                errors[c.key] = f"{label}: .{ext or '?'} is not allowed (allowed: {', '.join(allowed)})."
                continue
            dur = f.get("duration")
            if not dur or dur <= 0:
                errors[c.key] = f"{label}: could not read the duration of this audio."
                continue
            lo, hi = _num(cons.get("min_duration_seconds")), _num(cons.get("max_duration_seconds"))
            if hi is not None and dur > hi + 0.05:
                errors[c.key] = f"{label} is {dur:.1f}s; the maximum is {hi:g}s."
            elif lo is not None and dur < lo - 0.05:
                errors[c.key] = f"{label} is {dur:.1f}s; the minimum is {lo:g}s."

        else:
            errors[c.key] = f"{label}: unsupported asset kind '{kind}'."

    return errors