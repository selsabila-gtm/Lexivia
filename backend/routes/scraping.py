"""
routes/scraping.py

Changes in this version
────────────────────────
1. FREE AI ALTERNATIVE  — Groq (llama-3.1-8b-instant, free tier) is used as
   a fallback when ANTHROPIC_API_KEY is not set.  Set GROQ_API_KEY in .env to
   enable it.  Install: pip install groq

2. TASK-AWARE VIDEO SCRAPER  — the annotation call in process_segment was left
   as a hard-coded dummy ("failed").  Restored to the real _annotate() call.

3. AUDIO PLAYBACK FIX  — the /scrape/audio-file proxy now forwards the browser's
   Range header and returns a proper 206 Partial Content response so <audio>
   elements can seek and Chrome/Safari can start playing immediately.

4. CONFIG FROM DB  — competition.dataset_config (JSON) is merged on top of the
   hard-coded DATASET_DEFAULTS so custom labels / entity types / languages stored
   in the DB override the defaults without losing any key the organiser didn't set.

5. YOUTUBE COMMENTS  — the /scrape/text endpoint detects YouTube / youtu.be URLs
   when content_type="comments" and routes to _get_yt_comments() which uses
   yt-dlp's writecomments feature instead of BeautifulSoup (YouTube renders
   comments client-side so httpx alone cannot extract them).

7. EVEN TIMESTAMP SAMPLING  — segments are no longer truncated to the first
   `max_segments` in chronological order (which meant long videos only ever
   produced clips from the first few seconds). `_evenly_sample()` now spreads
   the selected segments across the full video duration.

6. YOUTUBE CDN TIMEOUT FIX  — the /scrape/video endpoint now handles the
   "Connection to rr*.googlevideo.com timed out" error gracefully:
     a) yt-dlp options hardened: geo_bypass, nocheckcertificate, browser UA
        headers, fragment_retries=10, higher socket_timeout, extractor_args
        to reduce bot-detection throttling.
     b) Two-phase download: audio task first attempts a full download; if
        the CDN connection times out, a subtitle-only retry is attempted
        automatically and text segments are returned with audio_url=None
        instead of crashing with 422.
     c) Clear error distinction: "no subtitles found" vs "network/CDN error"
        vs "video unavailable" each surface a different user-readable message.

Two public endpoints (unchanged interface):
  POST /scrape/video   — yt-dlp subtitles + optional audio clips
  POST /scrape/text    — httpx + BeautifulSoup (or yt-dlp for YT comments)
  GET  /scrape/audio-file — proxies Supabase audio with Range support
"""

import asyncio
import json
import os
import re
import tempfile
import uuid
from datetime import datetime
from typing import Optional

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

import anthropic

from models import Competition
from supabase_client import supabase
from .utils import get_db, get_current_user

router = APIRouter(tags=["scraping"])

# ── Clients ───────────────────────────────────────────────────────────────────
_anthropic_client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))

AUDIO_TASK_TYPES = {
    "AUDIO_SYNTHESIS",
    "AUDIO_TRANSCRIPTION",
    "SPEECH_EMOTION",
    "AUDIO_EVENT_DETECTION",
}

# ── Hard-coded config defaults (merged with DB values at runtime) ─────────────
DATASET_DEFAULTS: dict[str, dict] = {
    "TEXT_CLASSIFICATION": {
        "labels": ["Finance","Technology","Healthcare","Politics","Sports","Entertainment","Science","Other"],
    },
    "NER": {
        "entity_types": ["PER","ORG","LOC","MISC","DATE","MONEY","PRODUCT"],
    },
    "SENTIMENT_ANALYSIS": {
        "sentiment_labels": ["positive","negative","neutral","mixed"],
    },
    "TRANSLATION": {
        "source_lang": "EN",
        "target_lang": "AR",
    },
    "QUESTION_ANSWERING": {
        "qa_type": "extractive",
    },
    "SUMMARIZATION": {
        "target_ratio": 0.10,
    },
    "SPEECH_EMOTION": {
        "emotion_labels": ["neutral","happy","sad","angry","surprised","fearful","disgusted","contempt"],
    },
    "AUDIO_EVENT_DETECTION": {
        "event_types": ["speech","music","noise","silence","applause","laughter","alarm"],
    },
}

def _merge_config(task_type: str, db_config: dict) -> dict:
    """Return hard-coded defaults for task_type, overridden by anything in db_config."""
    merged = dict(DATASET_DEFAULTS.get(task_type, {}))
    merged.update(db_config)
    return merged


# ─────────────────────────────────────────────────────────────────────────────
# Request models
# ─────────────────────────────────────────────────────────────────────────────

class VideoScrapeRequest(BaseModel):
    url: str
    competition_id: str
    max_segments: int = 15
    clip_duration_seconds: float = 10.0   # target length of each audio clip; user-adjustable


class TextScrapeRequest(BaseModel):
    url: str
    competition_id: str
    content_type: str = "article"   # "article" | "comments" | "captions"
    max_items: int = 20


# ─────────────────────────────────────────────────────────────────────────────
# Claude annotation prompt builder  (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

def _build_annotation_prompt(text: str, task_type: str, config: dict) -> str:
    base = (
        "You are a professional data annotation assistant. "
        "Respond ONLY with a valid JSON object — no markdown, no explanation. "
        "If you cannot produce a confident annotation, return {\"status\": \"failed\"}.\n\n"
    )
    text_block = f'TEXT TO ANNOTATE:\n"""\n{text[:1200]}\n"""\n\n'

    if task_type == "TEXT_CLASSIFICATION":
        labels = config.get("labels", ["Finance","Technology","Healthcare","Politics","Sports","Entertainment","Science","Other"])
        return (
            base + text_block +
            f"Classify the text. Available labels: {labels}. "
            "Return: {\"label\": \"<primary label>\", \"labels\": [\"<all matching labels>\"], "
            "\"confidence\": <0.0-1.0>}"
        )
    if task_type == "SENTIMENT_ANALYSIS":
        return (
            base + text_block +
            "Detect the overall sentiment. "
            "Return: {\"sentiment\": \"positive|negative|neutral|mixed\", "
            "\"label\": \"<same as sentiment>\", \"confidence\": <0.0-1.0>}"
        )
    if task_type == "NER":
        entity_types = config.get("entity_types", ["PER","ORG","LOC","MISC","DATE","MONEY","PRODUCT"])
        return (
            base + text_block +
            f"Extract named entities. Allowed types: {entity_types}. "
            "For each entity include char start/end offsets. "
            "Return: {\"entities\": [{\"text\": \"...\", \"label\": \"...\", "
            "\"start\": <int>, \"end\": <int>}]}"
        )
    if task_type == "SUMMARIZATION":
        ratio = config.get("target_ratio", 0.1)
        return (
            base + text_block +
            f"Write a concise summary of roughly {int(ratio*100)}% of the original length. "
            "Return: {\"summary\": \"...\"}"
        )
    if task_type == "TRANSLATION":
        src = config.get("source_lang", "EN")
        tgt = config.get("target_lang", "AR")
        return (
            base + text_block +
            f"Translate from {src} to {tgt}. "
            "Return: {\"translation\": \"...\", \"source_lang\": \"" + src + "\", "
            "\"target_lang\": \"" + tgt + "\"}"
        )
    if task_type == "QUESTION_ANSWERING":
        qa_type = config.get("qa_type", "extractive")
        return (
            base + text_block +
            f"Generate one high-quality question-answer pair ({qa_type}). "
            "Return: {\"question\": \"...\", \"answer\": \"...\", \"qa_type\": \"" + qa_type + "\"}"
        )
    if task_type in ("AUDIO_SYNTHESIS", "AUDIO_TRANSCRIPTION"):
        return (
            base + text_block +
            "This is a subtitle/caption from a video. Return the clean verbatim transcript. "
            "Return: {\"transcript\": \"...\", \"word_count\": <int>}"
        )
    if task_type == "SPEECH_EMOTION":
        emotion_labels = config.get("emotion_labels",
            ["neutral","happy","sad","angry","surprised","fearful","disgusted","contempt"])
        return (
            base + text_block +
            f"Infer the emotional tone from this speech transcript. "
            f"Choose from: {emotion_labels}. "
            "Return: {\"emotion\": \"...\", \"intensity\": <0.0-1.0>, "
            "\"arousal\": <0.0-1.0>, \"valence\": <0.0-1.0>}"
        )
    if task_type == "AUDIO_EVENT_DETECTION":
        event_types = config.get("event_types",
            ["speech","music","noise","silence","applause","laughter","alarm"])
        return (
            base + text_block +
            f"Identify sound events in this transcript/description. Types: {event_types}. "
            "Return: {\"events\": [{\"label\": \"...\", \"start_time\": <float>, \"end_time\": <float>}]}"
        )
    # Fallback
    return (
        base + text_block +
        "Annotate this text as JSON with any relevant keys for the task. "
        "Return: {\"label\": \"...\", \"confidence\": <0.0-1.0>}"
    )


# ─────────────────────────────────────────────────────────────────────────────
# FIX 1 — Free AI alternative: Groq (llama-3.1-8b-instant, free tier)
# ─────────────────────────────────────────────────────────────────────────────

async def _annotate_with_claude(text: str, task_type: str, config: dict) -> dict:
    """Call Anthropic Claude Sonnet for annotation."""
    if not text or not text.strip():
        return {"annotation": None, "confidence": 0.0, "status": "skipped"}
    prompt = _build_annotation_prompt(text, task_type, config)
    try:
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: _anthropic_client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=512,
                messages=[{"role": "user", "content": prompt}],
            )
        )
        raw = response.content[0].text.strip()
        raw = re.sub(r"^```json\s*", "", raw, flags=re.MULTILINE)
        raw = re.sub(r"```$", "", raw, flags=re.MULTILINE).strip()
        annotation = json.loads(raw)
        if annotation.get("status") == "failed":
            return {"annotation": None, "confidence": 0.0, "status": "failed"}
        confidence = float(annotation.pop("confidence", 0.82))
        return {"annotation": annotation, "confidence": confidence, "status": "success"}
    except (json.JSONDecodeError, KeyError, IndexError):
        return {"annotation": None, "confidence": 0.0, "status": "failed"}
    except anthropic.APIError:
        return {"annotation": None, "confidence": 0.0, "status": "failed"}


async def _annotate_with_groq(text: str, task_type: str, config: dict) -> dict:
    """
    Free-tier fallback: Groq API with llama-3.1-8b-instant.
    Requires: pip install groq
    Set GROQ_API_KEY in your .env.
    Free tier: 14,400 requests/day, 30 req/min  — plenty for testing.
    """
    if not text or not text.strip():
        return {"annotation": None, "confidence": 0.0, "status": "skipped"}

    groq_key = os.environ.get("GROQ_API_KEY", "")
    if not groq_key:
        return {"annotation": None, "confidence": 0.0, "status": "failed"}

    try:
        from groq import AsyncGroq
    except ImportError:
        return {"annotation": None, "confidence": 0.0, "status": "failed"}

    prompt = _build_annotation_prompt(text, task_type, config)
    try:
        client = AsyncGroq(api_key=groq_key)
        response = await client.chat.completions.create(
            model="llama-3.1-8b-instant",   # fastest free model
            max_tokens=512,
            temperature=0.1,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.choices[0].message.content.strip()
        raw = re.sub(r"^```json\s*", "", raw, flags=re.MULTILINE)
        raw = re.sub(r"```$", "", raw, flags=re.MULTILINE).strip()
        annotation = json.loads(raw)
        if annotation.get("status") == "failed":
            return {"annotation": None, "confidence": 0.0, "status": "failed"}
        confidence = float(annotation.pop("confidence", 0.75))
        return {"annotation": annotation, "confidence": confidence, "status": "success"}
    except Exception:
        return {"annotation": None, "confidence": 0.0, "status": "failed"}


async def _annotate(text: str, task_type: str, config: dict) -> dict:
    """
    Route annotation to Claude (if ANTHROPIC_API_KEY set) or Groq (if GROQ_API_KEY set).
    Claude is tried first; Groq is the free testing fallback.
    """
    if os.environ.get("ANTHROPIC_API_KEY"):
        return await _annotate_with_claude(text, task_type, config)
    if os.environ.get("GROQ_API_KEY"):
        return await _annotate_with_groq(text, task_type, config)
    return {"annotation": None, "confidence": 0.0, "status": "failed"}


# ─────────────────────────────────────────────────────────────────────────────
# Subtitle / VTT / SRT parsing  (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

def _parse_vtt(vtt_text: str) -> list[dict]:
    segments = []
    lines = vtt_text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        m = re.match(
            r"(\d+):(\d+):(\d+)[\.,](\d+)\s+-->\s+(\d+):(\d+):(\d+)[\.,](\d+)",
            line
        )
        if m:
            def to_s(h, mn, s, ms): return int(h)*3600 + int(mn)*60 + int(s) + int(ms)/1000
            start = to_s(*m.group(1,2,3,4))
            end   = to_s(*m.group(5,6,7,8))
            i += 1
            text_lines = []
            while i < len(lines) and lines[i].strip():
                cleaned = re.sub(r"<[^>]+>", "", lines[i]).strip()
                if cleaned:
                    text_lines.append(cleaned)
                i += 1
            text = " ".join(text_lines)
            if text:
                segments.append({"start": start, "end": end, "text": text})
        else:
            i += 1
    return segments


def _parse_srt(srt_text: str) -> list[dict]:
    segments = []
    blocks = re.split(r"\n\s*\n", srt_text.strip())
    for block in blocks:
        lines = [l.strip() for l in block.splitlines() if l.strip()]
        if len(lines) < 2:
            continue
        m = re.match(
            r"(\d+):(\d+):(\d+)[,.](\d+)\s+-->\s+(\d+):(\d+):(\d+)[,.](\d+)",
            lines[1] if lines[0].isdigit() else lines[0]
        )
        if not m:
            continue
        def to_s(h,mn,s,ms): return int(h)*3600 + int(mn)*60 + int(s) + int(ms)/1000
        start = to_s(*m.group(1,2,3,4))
        end   = to_s(*m.group(5,6,7,8))
        text_start = 2 if lines[0].isdigit() else 1
        text = " ".join(re.sub(r"<[^>]+>","",l) for l in lines[text_start:])
        if text:
            segments.append({"start": start, "end": end, "text": text})
    return segments


# ─────────────────────────────────────────────────────────────────────────────
# FIX 8 — Clips were too short. Each audio clip was extracted from a single
# subtitle cue (often 2-4s). This merges consecutive cues into windows of
# ~clip_duration_seconds (user-adjustable via the request), concatenating
# their text in order so the saved transcript matches exactly what's audible
# in that window — nothing more, nothing less.
# ─────────────────────────────────────────────────────────────────────────────

def _merge_segments_by_duration(segments: list[dict], target_duration: float) -> list[dict]:
    if not segments:
        return []
    target_duration = max(1.0, target_duration)

    merged: list[dict] = []
    cur_start = segments[0]["start"]
    cur_texts: list[str] = []
    cur_end = segments[0]["start"]

    for seg in segments:
        # If adding this cue would blow past target_duration and we already
        # have something, close out the current window first.
        if cur_texts and (seg["end"] - cur_start) > target_duration:
            merged.append({"start": cur_start, "end": cur_end, "text": " ".join(cur_texts)})
            cur_start = seg["start"]
            cur_texts = []

        cur_texts.append(seg["text"])
        cur_end = seg["end"]

    if cur_texts:
        merged.append({"start": cur_start, "end": cur_end, "text": " ".join(cur_texts)})

    return merged


# ─────────────────────────────────────────────────────────────────────────────
# FIX 7 — Sample segments across the whole video instead of just the start.
# Previously `segments[: req.max_segments]` always kept the first N segments
# in chronological order, so long videos only ever yielded clips from the
# first few seconds/minutes. This spreads the picks evenly across the full
# list so source_label timestamps vary across the whole video's duration.
# ─────────────────────────────────────────────────────────────────────────────

def _evenly_sample(segments: list[dict], n: int) -> list[dict]:
    if n <= 0 or not segments:
        return []
    if len(segments) <= n:
        return segments
    step = len(segments) / n
    return [segments[int(i * step)] for i in range(n)]


# ─────────────────────────────────────────────────────────────────────────────
# Audio extraction helpers  (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

def _extract_audio_segment(source_path: str, start: float, end: float,
                            out_path: str) -> bool:
    try:
        import subprocess
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", str(start), "-to", str(end),
            "-i", source_path,
            "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
            out_path
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=60)
        return result.returncode == 0
    except Exception:
        return False


def _upload_audio_to_storage(local_path: str, competition_id: str) -> Optional[str]:
    try:
        segment_id = str(uuid.uuid4())
        storage_path = f"scraped/{competition_id}/{segment_id}.wav"
        with open(local_path, "rb") as f:
            audio_bytes = f.read()
        supabase.storage.from_("audio-samples").upload(
            storage_path, audio_bytes, {"content-type": "audio/wav"}
        )
        return storage_path
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Video scraping endpoint
# FIX 2: Restored real _annotate() call (was hard-coded dummy)
# ─────────────────────────────────────────────────────────────────────────────

def _build_ydl_opts(
    tmpdir: str,
    is_audio_task: bool,
    skip_download: bool = False,
) -> dict:
    """
    Return a hardened yt-dlp options dict.

    FIX 6a: geo_bypass, nocheckcertificate, browser User-Agent, and
    fragment_retries are added to maximise connectivity against YouTube's
    CDN throttling / bot-detection that causes the
    'googlevideo.com timed out' error seen in production.
    """
    sub_path   = os.path.join(tmpdir, "video.%(ext)s")
    audio_path = os.path.join(tmpdir, "audio.%(ext)s")

    opts: dict = {
        # Subtitles
        "writesubtitles":    True,
        "writeautomaticsub": True,
        "subtitleslangs":    ["en", "en-US"],
        "subtitlesformat":   "vtt/srt/best",

        # Download behaviour
        "skip_download": skip_download or (not is_audio_task),
        "format":        "bestaudio[ext=m4a]/bestaudio/best" if (is_audio_task and not skip_download)
                         else "bestvideo[height<=144]+bestaudio/bestvideo[height<=144]/best",
        "outtmpl":       audio_path if (is_audio_task and not skip_download) else sub_path,

        # Post-processing: convert to WAV for audio tasks
        "postprocessors": ([{
            "key":              "FFmpegExtractAudio",
            "preferredcodec":   "wav",
            "preferredquality": "0",
        }] if (is_audio_task and not skip_download) else []),

        # ── FIX 6a: network hardening ──────────────────────────────────────
        "socket_timeout":    120,          # was 20 (default) — CDN can be slow
        "retries":           10,           # retry individual HTTP requests
        "fragment_retries":  10,           # retry individual DASH/HLS fragments
        "extractor_retries": 5,
        "geo_bypass":        True,         # bypass regional blocks
        "nocheckcertificate": True,        # skip SSL verify (proxy-friendly)
        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/125.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
        },
        # Reduce chance of triggering YouTube's bot throttle
        "extractor_args": {
            "youtube": {
                "player_client": ["web", "android"],
                "skip": ["dash", "hls"],   # prefer direct HTTP segments
            }
        },
        # ──────────────────────────────────────────────────────────────────
        "quiet":       True,
        "no_warnings": True,
    }
    return opts


def _is_cdn_timeout(err: Exception) -> bool:
    """Return True when the error is a googlevideo.com / CDN connectivity failure."""
    msg = str(err).lower()
    return any(kw in msg for kw in (
        "timed out", "timeout", "connect timeout",
        "googlevideo", "connection refused", "network", "ssl",
    ))


def _collect_subtitles(tmpdir: str) -> list[dict]:
    """Walk tmpdir and parse the first .vtt or .srt found."""
    for root, _, files in os.walk(tmpdir):
        for fname in files:
            fpath = os.path.join(root, fname)
            if fname.endswith(".vtt"):
                with open(fpath, encoding="utf-8", errors="ignore") as fh:
                    return _parse_vtt(fh.read())
            if fname.endswith(".srt"):
                with open(fpath, encoding="utf-8", errors="ignore") as fh:
                    return _parse_srt(fh.read())
    return []


def _collect_audio_file(tmpdir: str) -> Optional[str]:
    """Return path to the first .wav found under tmpdir, or None."""
    for root, _, files in os.walk(tmpdir):
        for fname in files:
            if fname.endswith(".wav"):
                return os.path.join(root, fname)
    return None


@router.post("/scrape/video")
async def scrape_video(
    req: VideoScrapeRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    comp = db.query(Competition).filter(Competition.id == req.competition_id).first()
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")

    # Clamp user-adjustable clip length to a sane range (3s – 60s)
    req.clip_duration_seconds = max(3.0, min(60.0, req.clip_duration_seconds))

    task_type = comp.task_type or "TEXT_CLASSIFICATION"

    # FIX 4: merge DB config with hard-coded defaults
    try:
        db_config = json.loads(comp.dataset_config or "{}")
    except json.JSONDecodeError:
        db_config = {}
    config = _merge_config(task_type, db_config)

    is_audio_task = task_type in AUDIO_TASK_TYPES

    try:
        import yt_dlp
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="yt-dlp is not installed. Run: pip install yt-dlp",
        )

    with tempfile.TemporaryDirectory() as tmpdir:
        # ── Phase 1: attempt full download (audio + subtitles) ────────────
        audio_download_failed = False
        downloaded_audio: Optional[str] = None
        info: Optional[dict] = None

        opts = _build_ydl_opts(tmpdir, is_audio_task, skip_download=False)
        with yt_dlp.YoutubeDL(opts) as ydl:
            try:
                info = ydl.extract_info(req.url, download=True)
            except yt_dlp.utils.DownloadError as exc:
                # ── FIX 6b: two-phase fallback ────────────────────────────
                if is_audio_task and _is_cdn_timeout(exc):
                    # CDN timed out — retry subtitle-only so we can at least
                    # return text segments instead of a blank 422.
                    audio_download_failed = True
                    fallback_opts = _build_ydl_opts(tmpdir, is_audio_task, skip_download=True)
                    with yt_dlp.YoutubeDL(fallback_opts) as ydl2:
                        try:
                            info = ydl2.extract_info(req.url, download=False)
                        except yt_dlp.utils.DownloadError as exc2:
                            # ── FIX 6c: distinct error messages ──────────
                            err_msg = str(exc2).lower()
                            if "private" in err_msg or "unavailable" in err_msg:
                                raise HTTPException(
                                    status_code=422,
                                    detail="This video is private or unavailable.",
                                )
                            if "age" in err_msg or "sign in" in err_msg:
                                raise HTTPException(
                                    status_code=422,
                                    detail=(
                                        "This video requires sign-in or age verification. "
                                        "Try a different video."
                                    ),
                                )
                            raise HTTPException(
                                status_code=422,
                                detail=(
                                    "Could not reach YouTube's servers — the network connection "
                                    "from this backend is being blocked or throttled. "
                                    "Try again in a moment, or paste the video's subtitle/transcript "
                                    "text directly."
                                ),
                            )
                else:
                    # Non-audio task or non-timeout error — surface clearly
                    err_msg = str(exc).lower()
                    if "private" in err_msg or "unavailable" in err_msg:
                        raise HTTPException(
                            status_code=422,
                            detail="This video is private or unavailable.",
                        )
                    if "age" in err_msg or "sign in" in err_msg:
                        raise HTTPException(
                            status_code=422,
                            detail=(
                                "This video requires sign-in or age verification. "
                                "Try a different video."
                            ),
                        )
                    raise HTTPException(status_code=422, detail=f"yt-dlp: {exc}")

        video_title = (info or {}).get("title", "Untitled video")

        # ── Collect subtitles ─────────────────────────────────────────────
        segments: list[dict] = _collect_subtitles(tmpdir)

        if segments:
            # Merge short subtitle cues into ~clip_duration_seconds windows
            # so audio clips aren't just a single 2-4s cue, and the saved
            # transcript text matches exactly what's audible in each window.
            segments = _merge_segments_by_duration(segments, req.clip_duration_seconds)
        else:
            description = (info or {}).get("description", "") or ""
            chunks = [
                s.strip() for s in re.split(r"[\n.!?]+", description) if len(s.strip()) > 20
            ]
            for i, chunk in enumerate(chunks[: req.max_segments]):
                segments.append({
                    "start": i * req.clip_duration_seconds,
                    "end":   (i + 1) * req.clip_duration_seconds,
                    "text":  chunk,
                })

        if not segments:
            if audio_download_failed:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "YouTube's CDN timed out and this video has no subtitles/captions, "
                        "so no content could be extracted. Try a video that has auto-captions enabled."
                    ),
                )
            raise HTTPException(
                status_code=422,
                detail=(
                    "No subtitles, captions, or description found for this video. "
                    "Enable auto-captions on the video or try a different URL."
                ),
            )

        segments = _evenly_sample(segments, req.max_segments)

        # ── Collect downloaded audio (Phase 1 only) ───────────────────────
        if is_audio_task and not audio_download_failed:
            downloaded_audio = _collect_audio_file(tmpdir)

        # ── Build result items ────────────────────────────────────────────
        async def process_segment(seg: dict) -> dict:
            item_id = str(uuid.uuid4())
            audio_url = None
            audio_duration = seg["end"] - seg["start"]

            if is_audio_task and downloaded_audio:
                seg_wav = os.path.join(tmpdir, f"{item_id}.wav")
                ok = _extract_audio_segment(
                    downloaded_audio, seg["start"], seg["end"], seg_wav
                )
                if ok:
                    audio_url = _upload_audio_to_storage(seg_wav, req.competition_id)

            # FIX 2: real _annotate() call (not a dummy)
            ann_result = await _annotate(seg["text"], task_type, config)

            # If CDN timed out, mark items so the UI can show a banner
            item_type = "audio" if (is_audio_task and not audio_download_failed) else "text"

            return {
                "id":                    item_id,
                "type":                  item_type,
                "text_content":          seg["text"],
                "audio_url":             audio_url,
                "audio_duration":        round(audio_duration, 2),
                "source_label":          f"{video_title} [{seg['start']:.1f}s – {seg['end']:.1f}s]",
                "annotation_suggestion": ann_result["annotation"],
                "ai_confidence":         ann_result["confidence"],
                "ai_status":             ann_result["status"],
                # Extra field — UI can surface "audio unavailable" badge
                "audio_unavailable":     audio_download_failed,
            }

        items = await asyncio.gather(*[process_segment(s) for s in segments])

    return {
        "items": list(items),
        "source": video_title,
        # Lets the frontend show a non-blocking warning when audio fell back
        "audio_fallback": audio_download_failed,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Text / webpage content extractors
# ─────────────────────────────────────────────────────────────────────────────

def _extract_article_paragraphs(soup: BeautifulSoup, min_len: int = 80) -> list[str]:
    for tag in ["article", "main", "[role='main']"]:
        el = soup.find(tag) or soup.select_one(tag)
        if el:
            paras = [p.get_text(" ", strip=True) for p in el.find_all("p")]
            paras = [p for p in paras if len(p) >= min_len]
            if paras:
                return paras
    paras = [p.get_text(" ", strip=True) for p in soup.find_all("p")]
    return [p for p in paras if len(p) >= min_len]


def _extract_comments(soup: BeautifulSoup) -> list[str]:
    """
    Heuristic comment extraction.
    Works on: Reddit (old.reddit.com), Hacker News, Disqus pages, generic sites.
    Does NOT work on YouTube (comments are JS-rendered — use _get_yt_comments instead).
    """
    candidates = []
    # Reddit-style
    for sel in [".Comment", ".comment", "[data-testid='comment']",
                ".thing.comment", "#siteTable .comment"]:
        for el in soup.select(sel)[:60]:
            text = el.get_text(" ", strip=True)
            if len(text) > 30:
                candidates.append(text)

    # Hacker News / generic blog
    if not candidates:
        for el in soup.select(".commtext, .comment-body, .comment-content"):
            text = el.get_text(" ", strip=True)
            if len(text) > 30:
                candidates.append(text)

    if not candidates:
        for el in soup.find_all(attrs={"class": re.compile(r"comment", re.I)}):
            if el.name in ("div", "li", "section", "article"):
                text = el.get_text(" ", strip=True)
                if 30 < len(text) < 2000:
                    candidates.append(text)

    seen, unique = set(), []
    for c in candidates:
        key = c[:120]
        if key not in seen:
            seen.add(key)
            unique.append(c)
    return unique


def _extract_captions(soup: BeautifulSoup) -> list[str]:
    texts = []
    for sel in [
        "[class*='transcript']", "[class*='caption']",
        "[class*='subtitle']",   "[aria-label*='transcript']",
        ".ytd-transcript-segment-renderer",
    ]:
        for el in soup.select(sel):
            t = el.get_text(" ", strip=True)
            if len(t) > 10:
                texts.append(t)
    return texts


# ─────────────────────────────────────────────────────────────────────────────
# FIX 5 — YouTube comments via yt-dlp (JS-rendered, BeautifulSoup can't see them)
# ─────────────────────────────────────────────────────────────────────────────

def _is_youtube_url(url: str) -> bool:
    return bool(re.search(r"(youtube\.com/watch|youtu\.be/)", url))


def _get_yt_comments(url: str, max_comments: int = 30) -> list[str]:
    """
    Extract YouTube comments using yt-dlp's built-in comment fetcher.
    yt-dlp uses the InnerTube API internally — no JS rendering needed.

    Note: yt-dlp fetches comments in pages of ~20; requesting many comments
    can be slow.  Keep max_comments ≤ 50 for acceptable response times.
    """
    try:
        import yt_dlp
    except ImportError:
        return []

    ydl_opts = {
        "writecomments":  True,
        "getcomments":    max_comments,
        "skip_download":  True,
        "quiet":          True,
        "no_warnings":    True,
        # Avoid age-gate / sign-in issues
        "extractor_args": {"youtube": {"comment_sort": ["top"]}},
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
        except Exception:
            return []

    comments = []
    for c in (info.get("comments") or [])[:max_comments]:
        text = (c.get("text") or "").strip()
        if len(text) > 20:
            comments.append(text)
    return comments


# ─────────────────────────────────────────────────────────────────────────────
# Text scraping endpoint
# FIX 4: config merged from DB; FIX 5: YouTube comment routing
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/scrape/text")
async def scrape_text(
    req: TextScrapeRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    comp = db.query(Competition).filter(Competition.id == req.competition_id).first()
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")

    task_type = comp.task_type or "TEXT_CLASSIFICATION"

    # FIX 4: merge DB config with defaults
    try:
        db_config = json.loads(comp.dataset_config or "{}")
    except json.JSONDecodeError:
        db_config = {}
    config = _merge_config(task_type, db_config)

    # ── FIX 5: Route YouTube comment requests to yt-dlp ──────────────────────
    if req.content_type == "comments" and _is_youtube_url(req.url):
        raw_texts = _get_yt_comments(req.url, req.max_items)
        if not raw_texts:
            raise HTTPException(
                status_code=422,
                detail=(
                    "Could not fetch YouTube comments. The video may have comments disabled, "
                    "be age-restricted, or be private. Try a different video."
                )
            )
        page_title = "YouTube comments"

        async def process_chunk_yt(text: str, idx: int) -> dict:
            ann_result = await _annotate(text, task_type, config)
            return {
                "id":                    str(uuid.uuid4()),
                "type":                  "text",
                "text_content":          text,
                "audio_url":             None,
                "audio_duration":        None,
                "source_label":          f"YouTube comment {idx + 1}",
                "annotation_suggestion": ann_result["annotation"],
                "ai_confidence":         ann_result["confidence"],
                "ai_status":             ann_result["status"],
            }

        items = await asyncio.gather(*[process_chunk_yt(t, i) for i, t in enumerate(raw_texts)])
        return {"items": list(items), "source": page_title}

    # ── Regular httpx + BeautifulSoup scrape ─────────────────────────────────
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (compatible; DataCollectionBot/1.0; "
            "+https://github.com/your-org/your-repo)"
        ),
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    try:
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=20.0, headers=headers
        ) as client:
            resp = await client.get(req.url)
            resp.raise_for_status()
    except httpx.TimeoutException:
        raise HTTPException(status_code=422, detail="Request timed out — check the URL.")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=422,
            detail=f"HTTP {e.response.status_code} when fetching URL.")
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Fetch error: {e}")

    soup = BeautifulSoup(resp.text, "html.parser")
    page_title = soup.title.string.strip() if soup.title else req.url

    if req.content_type == "comments":
        raw_texts = _extract_comments(soup)
    elif req.content_type == "captions":
        raw_texts = _extract_captions(soup)
        if not raw_texts:
            raw_texts = _extract_article_paragraphs(soup)
    else:
        raw_texts = _extract_article_paragraphs(soup)

    if not raw_texts:
        raise HTTPException(
            status_code=422,
            detail=(
                "No extractable content found. The page may require JavaScript "
                "rendering or login. Try a different URL or content type."
            )
        )

    raw_texts = raw_texts[:req.max_items]

    async def process_chunk(text: str, idx: int) -> dict:
        ann_result = await _annotate(text, task_type, config)
        return {
            "id":                    str(uuid.uuid4()),
            "type":                  "text",
            "text_content":          text,
            "audio_url":             None,
            "audio_duration":        None,
            "source_label":          f"{page_title} — item {idx + 1}",
            "annotation_suggestion": ann_result["annotation"],
            "ai_confidence":         ann_result["confidence"],
            "ai_status":             ann_result["status"],
        }

    items = await asyncio.gather(*[process_chunk(t, i) for i, t in enumerate(raw_texts)])
    return {"items": list(items), "source": page_title}


# ─────────────────────────────────────────────────────────────────────────────
# FIX 3 — Audio file proxy with Range request support
# Without Range support, Chrome/Safari refuse to play or seek audio.
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/scrape/audio-file")
async def serve_audio_file(
    request: Request,                         # ← needed to read Range header
    path: str = Query(..., description="Supabase storage path"),
    current_user=Depends(get_current_user),
):
    """
    Stream a Supabase-stored WAV file to the browser with full Range support.
    This lets <audio> elements seek and Chrome/Safari start playback immediately.
    """
    try:
        signed = supabase.storage.from_("audio-samples").create_signed_url(path, 300)
        audio_url = signed.get("signedURL") or signed.get("signedUrl")
        if not audio_url:
            raise HTTPException(status_code=404, detail="Could not generate signed URL.")

        # Forward the browser's Range header so Supabase can respond with 206
        upstream_headers: dict[str, str] = {}
        range_header = request.headers.get("range")
        if range_header:
            upstream_headers["Range"] = range_header

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(audio_url, headers=upstream_headers)
            resp.raise_for_status()

        # Build response headers — include everything needed for audio seeking
        response_headers = {
            "Accept-Ranges":  "bytes",
            "Content-Type":   "audio/wav",
            "Content-Disposition": "inline",
        }
        if "Content-Length" in resp.headers:
            response_headers["Content-Length"] = resp.headers["Content-Length"]
        if "Content-Range" in resp.headers:
            response_headers["Content-Range"] = resp.headers["Content-Range"]

        status_code = 206 if range_header and resp.status_code in (206, 200) else 200

        return StreamingResponse(
            resp.aiter_bytes(),
            status_code=status_code,
            media_type="audio/wav",
            headers=response_headers,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Audio proxy error: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# What this scraper can and cannot extract  (for reference / UI tooltips)
# ─────────────────────────────────────────────────────────────────────────────
#
# ✅ WORKS WELL
#   Video/Audio (yt-dlp):
#     YouTube, Vimeo, Twitter/X, TikTok, Dailymotion, Twitch VODs,
#     Facebook video, Instagram Reels — any URL yt-dlp supports.
#     Subtitles (VTT/SRT) and optional audio extraction.
#
#   YouTube comments — via yt-dlp InnerTube API (this file, FIX 5).
#     Paste a youtube.com/watch?v=… URL with content_type="comments".
#
#   Article text — works on most news sites, Wikipedia, blogs, Medium,
#     Substack, dev.to, and any page with <article> or <main> tags.
#     Examples: bbc.com, reuters.com, theguardian.com, arstechnica.com.
#
#   Static comments — old.reddit.com (NOT new reddit), Hacker News
#     (news.ycombinator.com), Disqus-powered sites (many tech blogs).
#
# ⚠️  PARTIAL / INCONSISTENT
#   New reddit (reddit.com) — JS-rendered, only a subset of comments visible.
#     Use old.reddit.com instead.
#   Paywalled articles — only the teaser paragraph(s) are visible.
#   Twitter/X threads — JS-rendered; no comments, only the linked tweet text.
#
# ❌ DOES NOT WORK (JS-rendered, auth required, or actively blocked)
#   Facebook posts/comments, Instagram comments, LinkedIn, TikTok comments,
#   Quora, Glassdoor, Yelp reviews (rate-limited + JS).
#   Any site requiring login.
#
# ─────────────────────────────────────────────────────────────────────────────
# Add to requirements.txt:
#   yt-dlp>=2024.1.1
#   httpx>=0.27
#   beautifulsoup4>=4.12
#   lxml>=5.0
#   anthropic>=0.28
#   groq>=0.9          ← free AI alternative
#   pydub>=0.25
#   ffmpeg-python>=0.2
#
# ffmpeg binary must be on PATH (apt install ffmpeg / brew install ffmpeg).
# ─────────────────────────────────────────────────────────────────────────────