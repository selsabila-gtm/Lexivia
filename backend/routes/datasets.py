"""
routes/datasets.py

Changes in this version:
  - Added GET /competitions/{id}/prompts/next  — returns the least-used prompt
    for *any* task type, used by DataCollection to rotate organizer-supplied
    source texts / utterance prompts across all widgets.
  - Removed the AUDIO_SYNTHESIS / SPEECH_EMOTION restriction from
    POST /competitions/{id}/prompts/batch so organizers can seed source texts
    for NER, Translation, Summarization, QA, Sentiment, and Text Classification
    competitions as well.
  - All other behaviour is unchanged.
"""
import json
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session
from supabase_client import supabase

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func
import csv
import io

from models import Competition, DataSample, UserProfile, CompetitionParticipant, CompetitionDataset, CompetitionPrompt, CompetitionOrganizer
from .utils import get_db, get_current_user, get_icon_for_task

router = APIRouter(tags=["datasets"])
STORAGE_BUCKET = "competition-datasets"

# ─────────────────────────────────────────────────────────────────────────────
# Base dataset configs — only task types that have a matching widget
# ─────────────────────────────────────────────────────────────────────────────

DATASET_CONFIGS: dict[str, dict] = {

    # ── Text annotation tasks ──────────────────────────────────────────────

    "TEXT_CLASSIFICATION": {
        "task_type": "TEXT_CLASSIFICATION",
        "label": "Text Classification",
        "icon": "▤",
        "description": "Participants label raw text samples with one or more categories from the competition's taxonomy.",
        "participant_instructions": "Write or paste a text sample, then assign the appropriate label(s) from the chip selector. Multi-label assignments are supported.",
        "labels": ["Finance", "Technology", "Healthcare", "Politics", "Sports", "Entertainment", "Science", "Other"],
        "allow_multilabel": True,
        "formats": [
            {"name": "JSONL (preferred)", "extension": ".jsonl",
             "example": '{"text_content": "Fed raises rates by 50bp", "annotation": {"labels": ["Finance"]}}',
             "notes": "labels must be a JSON array."},
            {"name": "CSV", "extension": ".csv", "columns": ["text_content", "label"],
             "notes": "Use the primary label in the 'label' column."},
        ],
        "hidden_dataset_instructions": "Upload JSONL or CSV with ground-truth labels. Required: text_content, label.",
        "allowed_extensions": [".jsonl", ".csv", ".txt"],
        "max_file_size_mb": 500,
    },

    "NER": {
        "task_type": "NER",
        "label": "Named Entity Recognition",
        "icon": "▦",
        "description": "Participants identify and tag named entities (persons, organisations, locations, etc.) within text passages.",
        "participant_instructions": "Paste text into the editor, select entity spans with your mouse, and assign the entity type. Multiple non-overlapping spans per document are supported.",
        "entity_types": ["PER", "ORG", "LOC", "MISC", "DATE", "MONEY", "PRODUCT"],
        "formats": [
            {"name": "CoNLL-2003 style JSONL", "extension": ".jsonl",
             "example": '{"text_content": "Apple is based in Cupertino.", "annotation": {"entities": [{"start": 0, "end": 5, "text": "Apple", "label": "ORG"}]}}',
             "notes": "entities is an array of {start, end, text, label} objects."},
        ],
        "hidden_dataset_instructions": "Upload JSONL with ground-truth entity spans. Required: text_content, entities array.",
        "allowed_extensions": [".jsonl", ".csv", ".txt"],
        "max_file_size_mb": 500,
    },

    "SENTIMENT_ANALYSIS": {
        "task_type": "SENTIMENT_ANALYSIS",
        "label": "Sentiment Analysis",
        "icon": "◕",
        "description": "Participants annotate text with overall sentiment polarity and optional aspect-level sentiments.",
        "participant_instructions": "Enter the text, select the overall sentiment, set your confidence level, and optionally tag individual aspect sentiments.",
        "sentiment_labels": ["positive", "negative", "neutral", "mixed"],
        "aspect_categories": ["product", "service", "price", "delivery", "support", "quality", "design"],
        "formats": [
            {"name": "JSONL (preferred)", "extension": ".jsonl",
             "example": '{"text_content": "Great battery life but poor camera.", "annotation": {"sentiment": "mixed", "confidence": 0.9}}'},
            {"name": "CSV", "extension": ".csv", "columns": ["text_content", "sentiment", "confidence"]},
        ],
        "hidden_dataset_instructions": "Upload JSONL with ground-truth sentiment labels. Required: text_content, sentiment.",
        "allowed_extensions": [".jsonl", ".csv", ".txt"],
        "max_file_size_mb": 500,
    },

    "TRANSLATION": {
        "task_type": "TRANSLATION",
        "label": "Translation",
        "icon": "⇄",
        "description": "Participants provide human translations of source sentences into target languages.",
        "participant_instructions": "Enter the source text on the left and your translation on the right. Language pair is fixed by the competition.",
        "source_lang": "EN",
        "target_lang": "FR",
        "glossary": [],
        "formats": [
            {"name": "JSONL (preferred)", "extension": ".jsonl",
             "example": '{"source": "Hello world", "target": "Bonjour le monde", "source_lang": "en", "target_lang": "fr"}'},
            {"name": "TMX", "extension": ".tmx", "notes": "Translation Memory eXchange format."},
            {"name": "CSV", "extension": ".csv", "columns": ["source", "target", "source_lang", "target_lang"]},
        ],
        "hidden_dataset_instructions": "Upload JSONL/CSV with reference translations. Required: source, reference_translation, source_lang, target_lang.",
        "allowed_extensions": [".jsonl", ".csv", ".tmx", ".txt"],
        "max_file_size_mb": 500,
    },

    "QUESTION_ANSWERING": {
        "task_type": "QUESTION_ANSWERING",
        "label": "Question Answering",
        "icon": "◈",
        "description": "Participants answer questions grounded in a provided context passage.",
        "participant_instructions": "Paste the context, write the question, then provide the answer. For extractive QA, copy the exact span from the context.",
        "qa_type": "extractive",
        "formats": [
            {"name": "SQuAD-style JSONL", "extension": ".jsonl",
             "example": '{"context": "Paris is the capital of France.", "question": "What is the capital of France?", "answer": "Paris", "start_index": 0}'},
            {"name": "CSV", "extension": ".csv", "columns": ["context", "question", "answer"]},
        ],
        "hidden_dataset_instructions": "Upload SQuAD-style JSONL. Required: context, question, answer.",
        "allowed_extensions": [".jsonl", ".csv", ".txt"],
        "max_file_size_mb": 500,
    },

    "SUMMARIZATION": {
        "task_type": "SUMMARIZATION",
        "label": "Summarization",
        "icon": "▤",
        "description": "Participants write concise summaries of provided documents.",
        "participant_instructions": "Paste the source document, then write a summary in the Summary field. Target ~10% of the source length.",
        "target_ratio": 0.10,
        "max_ratio": 0.15,
        "min_summary_words": 20,
        "formats": [
            {"name": "JSONL (preferred)", "extension": ".jsonl",
             "example": '{"document": "Long article text...", "summary": "Concise summary."}'},
            {"name": "CSV", "extension": ".csv", "columns": ["document", "summary"]},
        ],
        "hidden_dataset_instructions": "Upload JSONL/CSV with reference summaries. Required: document, summary.",
        "allowed_extensions": [".jsonl", ".csv", ".txt"],
        "max_file_size_mb": 500,
    },

    # ── Audio annotation tasks ─────────────────────────────────────────────

    "AUDIO_SYNTHESIS": {
        "task_type": "AUDIO_SYNTHESIS",
        "label": "Audio Synthesis",
        "icon": "◉",
        "description": "Participants record high-quality speech audio for given prompts, used to train or evaluate TTS / voice-cloning models.",
        "participant_instructions": "Read the displayed prompt aloud in a quiet environment, then click Commit. Each recording is automatically linked to the shown prompt.",
        "formats": [
            {"name": "WAV", "extension": ".wav", "notes": "16-bit PCM, mono or stereo, ≥ 22050 Hz."},
        ],
        "hidden_dataset_instructions": "Upload a ZIP archive containing reference audio files. One subfolder per prompt_id.",
        "allowed_extensions": [".zip", ".wav"],
        "max_file_size_mb": 2048,
    },

    "AUDIO_TRANSCRIPTION": {
        "task_type": "AUDIO_TRANSCRIPTION",
        "label": "Audio Transcription",
        "icon": "◉",
        "description": "Participants transcribe speech audio files verbatim, producing text aligned with the audio.",
        "participant_instructions": "Record live or upload an audio file, then type the verbatim transcript.",
        "speakers": 1,
        "with_timestamps": False,
        "formats": [
            {"name": "JSONL (preferred)", "extension": ".jsonl",
             "example": '{"audio_file": "audio_001.wav", "transcript": "Hello, welcome to the show.", "speaker_count": 1}'},
            {"name": "CSV", "extension": ".csv", "columns": ["audio_file", "transcript"]},
        ],
        "hidden_dataset_instructions": "Upload a ZIP with reference transcripts (one .txt per audio file) or a JSONL manifest.",
        "allowed_extensions": [".zip", ".wav", ".mp3", ".jsonl", ".csv"],
        "max_file_size_mb": 2048,
    },

    "SPEECH_EMOTION": {
        "task_type": "SPEECH_EMOTION",
        "label": "Speech Emotion",
        "icon": "◕",
        "description": "Participants record utterances with specified emotional expression and annotate the expressed emotion along arousal/valence dimensions.",
        "participant_instructions": "Read the utterance with the target emotion. After recording, select the emotion you expressed and adjust the intensity, arousal, and valence sliders.",
        "emotion_labels": ["neutral", "happy", "sad", "angry", "surprised", "fearful", "disgusted", "contempt"],
        "formats": [
            {"name": "JSONL (preferred)", "extension": ".jsonl",
             "example": '{"audio_file": "emo_001.wav", "annotation": {"emotion": "happy", "intensity": 0.8, "arousal": 0.75, "valence": 0.9}}'},
        ],
        "hidden_dataset_instructions": "Upload a ZIP with reference WAV files and a JSONL manifest containing ground-truth emotion labels.",
        "allowed_extensions": [".zip", ".wav", ".mp3", ".jsonl"],
        "max_file_size_mb": 2048,
    },

    "AUDIO_EVENT_DETECTION": {
        "task_type": "AUDIO_EVENT_DETECTION",
        "label": "Audio Event Detection",
        "icon": "▣",
        "description": "Participants annotate temporal boundaries of sound events in audio recordings.",
        "participant_instructions": "Upload or record audio, play it back, and use Mark Start / Mark End to tag each sound event. Assign the event type from the panel.",
        "event_types": ["speech", "music", "noise", "silence", "applause", "laughter", "alarm", "animal"],
        "formats": [
            {"name": "JAMS / JSONL", "extension": ".jsonl",
             "example": '{"audio_file": "clip_001.wav", "annotation": {"events": [{"start_time": 0.0, "end_time": 2.5, "label": "speech"}]}}'},
        ],
        "hidden_dataset_instructions": "Upload a ZIP with audio files and a JSONL manifest with ground-truth event timelines.",
        "allowed_extensions": [".zip", ".wav", ".mp3", ".jsonl", ".csv"],
        "max_file_size_mb": 4096,
    },
}

# Public list consumed by the frontend task-type selector
SUPPORTED_TASK_TYPES = list(DATASET_CONFIGS.keys())


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/task-types")
def list_task_types():
    """Returns all supported task types with their display label and icon."""
    return [
        {
            "value": cfg["task_type"],
            "label": cfg["label"],
            "icon": cfg["icon"],
            "description": cfg["description"],
        }
        for cfg in DATASET_CONFIGS.values()
    ]


@router.get("/competitions/{competition_id}/dataset-config")
def get_dataset_config(competition_id: str, db: Session = Depends(get_db)):
    """
    Returns the merged config for the competition's task type.
    Starts from the static base config, then deep-merges the organizer's
    custom task_config_json on top — so labels, entity types, prompts, etc.
    all reflect what the organizer set up, not just defaults.
    """
    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    task_type = (competition.task_type or "").upper().strip()
    base_config = DATASET_CONFIGS.get(task_type)
    if not base_config:
        raise HTTPException(
            status_code=400,
            detail=(
                f"No widget config for task_type='{task_type}'. "
                f"Supported: {SUPPORTED_TASK_TYPES}"
            ),
        )

    # Merge organizer overrides on top of base defaults
    merged = dict(base_config)
    if competition.task_config_json:
        try:
            organizer_config = json.loads(competition.task_config_json)
            merged.update({k: v for k, v in organizer_config.items() if v is not None})
        except (json.JSONDecodeError, TypeError):
            pass  # fall back to base config

    # Expose how many prompts are available (useful for all task types)
    prompt_count = (
        db.query(CompetitionPrompt)
        .filter(CompetitionPrompt.competition_id == competition_id)
        .count()
    )
    merged["prompt_count"] = prompt_count

    return merged


@router.patch("/competitions/{competition_id}/task-config")
def update_task_config(
    competition_id: str,
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Lets organizers update the task-specific config (labels, entity types,
    language pair, etc.) for an existing competition.

    Only the organizer may call this. Merges the supplied fields with the
    existing task_config_json; pass null to reset a field to its default.

    Example body for TEXT_CLASSIFICATION:
        {"labels": ["Finance", "Sports", "Custom Category"]}

    Example body for TRANSLATION:
        {"source_lang": "EN", "target_lang": "AR", "glossary": [{"src": "hello", "tgt": "مرحبا"}]}
    """
    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    is_organizer = (
        db.query(CompetitionOrganizer)
        .filter(
            CompetitionOrganizer.competition_id == competition_id,
            CompetitionOrganizer.user_id == current_user.id,
        )
        .first()
    )
    if not is_organizer:
        raise HTTPException(status_code=403, detail="Only the organizer can update task config")

    task_type = (competition.task_type or "").upper().strip()
    if task_type not in DATASET_CONFIGS:
        raise HTTPException(status_code=400, detail=f"Unsupported task_type: {task_type}")

    # Merge with existing config
    current = {}
    if competition.task_config_json:
        try:
            current = json.loads(competition.task_config_json)
        except (json.JSONDecodeError, TypeError):
            current = {}

    current.update(body)
    competition.task_config_json = json.dumps(current)
    db.commit()

    return {"message": "Task config updated", "task_config": current}


# ─────────────────────────────────────────────────────────────────────────────
# Prompts  (all task types — audio AND text)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}/prompts/next")
def get_next_prompt(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Returns the least-used prompt for a competition, regardless of task type.

    Audio tasks  → utterance / TTS prompt the contributor reads aloud.
    Text tasks   → organizer-supplied source text the contributor annotates
                   (classification sentence, NER passage, translation source,
                    QA context, document to summarise, etc.)

    Returns null (HTTP 200 with body `null`) when the competition has no
    prompts configured — widgets handle this gracefully by falling back to
    free-form entry.
    """
    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    prompt = (
        db.query(CompetitionPrompt)
        .filter(CompetitionPrompt.competition_id == competition_id)
        .order_by(
            CompetitionPrompt.used_count.asc(),
            CompetitionPrompt.created_at.asc(),
        )
        .first()
    )

    if not prompt:
        return None  # No prompts configured — widget falls back to free entry

    # Increment usage counter so prompts rotate fairly
    prompt.used_count = (prompt.used_count or 0) + 1
    db.commit()

    return {
        "id": str(prompt.id),
        "content": prompt.content,
        "difficulty": getattr(prompt, "difficulty", None),
        "domain": getattr(prompt, "domain", None),
        "target_emotion": getattr(prompt, "target_emotion", None),
    }


@router.post("/competitions/{competition_id}/prompts/batch")
def create_prompts_batch(
    competition_id: str,
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Bulk-creates prompts / source texts for any competition task type.

    Audio tasks  (AUDIO_SYNTHESIS, SPEECH_EMOTION):
        prompts are utterances the contributor reads aloud.

    Text tasks   (TEXT_CLASSIFICATION, NER, SENTIMENT_ANALYSIS, TRANSLATION,
                  QUESTION_ANSWERING, SUMMARIZATION):
        prompts are organizer-supplied source texts shown to contributors
        as a suggested/required starting point for annotation.

    Body:
        {
          "prompts":    ["Sentence one.", "Sentence two."],  // required
          "difficulty": "medium",   // optional, applied to all
          "domain":     "general",  // optional, applied to all
          "replace":    false       // true = wipe existing prompts first
        }

    Only the organizer may call this.
    """
    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    is_organizer = (
        db.query(CompetitionOrganizer)
        .filter(
            CompetitionOrganizer.competition_id == competition_id,
            CompetitionOrganizer.user_id == current_user.id,
        )
        .first()
    )
    if not is_organizer:
        raise HTTPException(status_code=403, detail="Only the organizer can add prompts")

    task_type = (competition.task_type or "").upper().strip()
    if task_type not in DATASET_CONFIGS:
        raise HTTPException(status_code=400, detail=f"Unsupported task_type: {task_type}")

    prompts_text: list[str] = body.get("prompts", [])
    difficulty: str | None = body.get("difficulty")
    domain: str | None = body.get("domain")
    replace: bool = body.get("replace", False)

    if not prompts_text:
        raise HTTPException(status_code=400, detail="prompts list is required and must not be empty")

    if replace:
        db.query(CompetitionPrompt).filter(
            CompetitionPrompt.competition_id == competition_id
        ).delete()

    new_prompts = [
        CompetitionPrompt(
            competition_id=competition_id,
            content=text.strip(),
            difficulty=difficulty,
            domain=domain,
            used_count=0,
            created_at=datetime.utcnow(),
        )
        for text in prompts_text
        if text.strip()
    ]

    db.add_all(new_prompts)
    db.commit()

    return {
        "created": len(new_prompts),
        "total_prompts": db.query(CompetitionPrompt)
        .filter(CompetitionPrompt.competition_id == competition_id)
        .count(),
    }


@router.get("/competitions/{competition_id}/prompts")
def list_prompts(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Returns all prompts for a competition (organizer view)."""
    prompts = (
        db.query(CompetitionPrompt)
        .filter(CompetitionPrompt.competition_id == competition_id)
        .order_by(CompetitionPrompt.created_at.asc())
        .all()
    )
    return [
        {
            "id": str(p.id),
            "content": p.content,
            "difficulty": p.difficulty,
            "domain": p.domain,
            "used_count": p.used_count,
        }
        for p in prompts
    ]


@router.delete("/competitions/{competition_id}/prompts/{prompt_id}")
def delete_prompt(
    competition_id: str,
    prompt_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Deletes a single prompt (organizer only)."""
    is_organizer = (
        db.query(CompetitionOrganizer)
        .filter(
            CompetitionOrganizer.competition_id == competition_id,
            CompetitionOrganizer.user_id == current_user.id,
        )
        .first()
    )
    if not is_organizer:
        raise HTTPException(status_code=403, detail="Only the organizer can delete prompts")

    prompt = (
        db.query(CompetitionPrompt)
        .filter(
            CompetitionPrompt.id == prompt_id,
            CompetitionPrompt.competition_id == competition_id,
        )
        .first()
    )
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")

    db.delete(prompt)
    db.commit()
    return {"deleted": prompt_id}


# ─────────────────────────────────────────────────────────────────────────────
# Hidden dataset upload / list / delete (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/competitions/{competition_id}/datasets")
async def upload_hidden_dataset(
    competition_id: str,
    file: UploadFile = File(...),
    dataset_type: str = Form("hidden_test"),
    description: str = Form(""),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    file_bytes = await file.read()
    file_size_mb = len(file_bytes) / (1024 * 1024)
    task_type = (competition.task_type or "").upper().strip()
    max_mb = DATASET_CONFIGS.get(task_type, {}).get("max_file_size_mb", 500)
    if file_size_mb > max_mb:
        raise HTTPException(
            status_code=413,
            detail=f"File is {file_size_mb:.1f} MB. Limit for {task_type} is {max_mb} MB.",
        )

    dataset_id = str(uuid.uuid4())
    ext = file.filename.rsplit(".", 1)[-1] if "." in (file.filename or "") else "bin"
    storage_path = f"{competition_id}/{dataset_type}/{dataset_id}.{ext}"

    try:
        supabase.storage.from_(STORAGE_BUCKET).upload(
            storage_path, file_bytes,
            {"content-type": file.content_type or "application/octet-stream"},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Storage upload failed: {exc}")

    record = CompetitionDataset(
        id=dataset_id,
        competition_id=competition_id,
        uploaded_by=current_user.id,
        dataset_type=dataset_type,
        original_filename=file.filename,
        storage_path=storage_path,
        file_size_bytes=len(file_bytes),
        description=description,
        uploaded_at=datetime.utcnow().isoformat(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {
        "id": record.id,
        "competition_id": competition_id,
        "dataset_type": dataset_type,
        "original_filename": file.filename,
        "storage_path": storage_path,
        "file_size_bytes": len(file_bytes),
        "uploaded_at": record.uploaded_at,
    }


@router.get("/competitions/{competition_id}/datasets")
def list_datasets(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    records = (
        db.query(CompetitionDataset)
        .filter(CompetitionDataset.competition_id == competition_id)
        .order_by(CompetitionDataset.uploaded_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "dataset_type": r.dataset_type,
            "original_filename": r.original_filename,
            "storage_path": r.storage_path,
            "file_size_bytes": r.file_size_bytes,
            "description": r.description,
            "uploaded_at": r.uploaded_at,
        }
        for r in records
    ]


@router.delete("/competitions/{competition_id}/datasets/{dataset_id}")
def delete_dataset(
    competition_id: str,
    dataset_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    record = db.query(CompetitionDataset).filter(
        CompetitionDataset.id == dataset_id,
        CompetitionDataset.competition_id == competition_id,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Dataset not found")
    try:
        supabase.storage.from_(STORAGE_BUCKET).remove([record.storage_path])
    except Exception:
        pass
    db.delete(record)
    db.commit()
    return {"deleted": dataset_id}

@router.get("/datasets/hub")
def list_hub_datasets(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Returns one dataset card per competition that has contributed data_samples.
    Aggregates participant counts, sample counts, and quality scores.
    """

    # Competitions that have at least one sample
    rows = (
        db.query(
            Competition,
            func.count(DataSample.id).label("total_samples"),
            func.count(DataSample.id).filter(DataSample.status == "validated").label("validated_samples"),
            func.count(DataSample.id).filter(DataSample.status == "flagged").label("flagged_samples"),
            func.avg(DataSample.quality_score).label("avg_quality"),
            func.count(func.distinct(DataSample.contributor_id)).label("contributors"),
        )
        .join(DataSample, DataSample.competition_id == Competition.id)
        .filter(Competition.is_draft == False)
        .group_by(Competition.id)
        .order_by(func.count(DataSample.id).desc())
        .all()
    )

    result = []
    for comp, total, validated, flagged, avg_q, contributors in rows:
        task_type = (comp.task_type or "TEXT_CLASSIFICATION").upper()

        # Derive a human-readable title for the dataset
        dataset_title = f"{comp.title} Dataset"

        # Description: use the competition description, trimmed
        description = (comp.description or "")[:200].rstrip()
        if len(comp.description or "") > 200:
            description += "…"

        # Compute latest activity
        latest = (
            db.query(func.max(DataSample.submitted_at))
            .filter(DataSample.competition_id == comp.id)
            .scalar()
        )

        result.append({
            "id": comp.id,
            "title": dataset_title,
            "description": description,
            "source_competition_id": comp.id,
            "source_competition_title": comp.title,
            "task_type": task_type,
            "icon": get_icon_for_task(task_type),
            "total_samples": total,
            "validated_samples": validated,
            "flagged_samples": flagged,
            "pending_samples": total - validated - flagged,
            "contributors": contributors,
            "avg_quality": round(float(avg_q), 3) if avg_q else None,
            "last_updated": str(latest) if latest else None,
            # Export format hint
            "formats": ["jsonl", "csv"],
        })

    return result


@router.get("/datasets/hub/{competition_id}/export")
def export_dataset(
    competition_id: str,
    format: str = Query("jsonl", regex="^(jsonl|csv)$"),
    status_filter: str = Query("all", regex="^(all|validated|flagged|pending)$"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Streams all data_samples for a competition as JSONL or CSV.
    Defaults to all statuses; pass ?status_filter=validated to get only clean data.
    """
    comp = db.query(Competition).filter(Competition.id == competition_id).first()
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")

    query = db.query(DataSample, UserProfile).outerjoin(
        UserProfile, UserProfile.user_id == DataSample.contributor_id
    ).filter(DataSample.competition_id == competition_id)

    if status_filter != "all":
        query = query.filter(DataSample.status == status_filter)

    rows = query.order_by(DataSample.submitted_at.asc()).all()

    safe_title = comp.title.replace(" ", "_").replace("/", "-")[:40]
    timestamp = datetime.utcnow().strftime("%Y%m%d")

    if format == "jsonl":
        def generate_jsonl():
            for sample, profile in rows:
                record = {
                    "id": str(sample.id),
                    "competition_id": competition_id,
                    "competition_title": comp.title,
                    "contributor": (profile.full_name if profile else None) or "Anonymous",
                    "text_content": sample.text_content,
                    "annotation": sample.annotation,
                    "status": sample.status,
                    "quality_score": sample.quality_score,
                    "task_type": sample.task_type,
                    "submitted_at": str(sample.submitted_at),
                }
                yield json.dumps(record, ensure_ascii=False) + "\n"

        filename = f"{safe_title}_{timestamp}.jsonl"
        return StreamingResponse(
            generate_jsonl(),
            media_type="application/x-ndjson",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    else:  # CSV
        def generate_csv():
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow([
                "id", "competition_id", "competition_title", "contributor",
                "text_content", "annotation", "status", "quality_score",
                "task_type", "submitted_at",
            ])
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)

            for sample, profile in rows:
                writer.writerow([
                    str(sample.id),
                    competition_id,
                    comp.title,
                    (profile.full_name if profile else None) or "Anonymous",
                    sample.text_content or "",
                    json.dumps(sample.annotation) if sample.annotation else "{}",
                    sample.status or "",
                    sample.quality_score or "",
                    sample.task_type or "",
                    str(sample.submitted_at or ""),
                ])
                yield output.getvalue()
                output.seek(0)
                output.truncate(0)

        filename = f"{safe_title}_{timestamp}.csv"
        return StreamingResponse(
            generate_csv(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )


@router.get("/datasets/hub/{competition_id}/stats")
def dataset_hub_stats(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Detailed stats for a single dataset card (label distribution, top contributors)."""
    comp = db.query(Competition).filter(Competition.id == competition_id).first()
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")

    # Top contributors
    top = (
        db.query(DataSample.contributor_id, func.count(DataSample.id).label("cnt"))
        .filter(DataSample.competition_id == competition_id)
        .group_by(DataSample.contributor_id)
        .order_by(func.count(DataSample.id).desc())
        .limit(5)
        .all()
    )
    top_contributors = []
    for uid, cnt in top:
        profile = db.query(UserProfile).filter(UserProfile.user_id == uid).first()
        name = (profile.full_name if profile else None) or "Anonymous"
        top_contributors.append({"name": name, "count": cnt})

    # Status distribution
    status_rows = (
        db.query(DataSample.status, func.count(DataSample.id))
        .filter(DataSample.competition_id == competition_id)
        .group_by(DataSample.status)
        .all()
    )
    status_dist = {s: c for s, c in status_rows}

    return {
        "competition_id": competition_id,
        "top_contributors": top_contributors,
        "status_distribution": status_dist,
    }
