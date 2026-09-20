"""
routes/competitions.py

Changes vs previous version:
  - Competition.dataset_config is now saved from data.task_config on create/update/draft.
  - New GET /competitions/{id}/dataset-config endpoint merges organizer config with
    per-task defaults and serves it to DataCollection widgets.
  - Audio prompt tasks (AUDIO_SYNTHESIS, SPEECH_EMOTION) automatically seed the
    competition_prompts table from task_config["prompts"] on create/update.

schemas.py NOTE: add to CompetitionCreateIn:
    task_config: Optional[dict] = None
    tracks_enabled: Optional[bool] = False
    phases_enabled: Optional[bool] = False
    data_collection_enabled: Optional[bool] = False

Independent platform capabilities, so any competition (whatever its task type)
can turn on exactly what it needs, without a fixed competition "template":
  - Tracks: split participants into fair comparison groups, each with a
    minimum team count. Config: task_config["tracks"], validated by
    validate_tracks_config() when tracks_enabled=True.
  - Phases: an ordered, named timeline replacing the flat start/end date +
    milestones. Config: task_config["phases"], validated by
    validate_phases_config() when phases_enabled=True.
  - Data Collection: participants source, record, or adapt their own raw data
    (instead of an organizer-provided dataset), under format limits, allowed
    sources, an annotation protocol (annotators per instance + adjudication),
    and a mandatory data usage license. Config: task_config["data_collection"]
    and task_config["license"], validated by validate_data_collection_config()
    when data_collection_enabled=True. This is independent of task type: it
    applies the same way whether the competition annotates one label or many.
  - Evaluation scoring mode (task_config["evaluation_scoring"]) is always
    present; "standard" ranks on the primary metric alone, while
    "data_quality_plus_model" combines a per-team data-quality score with each
    team's own model score — validated by validate_evaluation_scoring()
    whenever that mode is selected, independent of the flags above.
  - MULTI_TASK_ANNOTATION lets an organizer define any number of simultaneous
    label sets on the same instance (e.g. Sentiment + Sarcasm + Hate Speech),
    each with its own annotation type (single-label, multi-label, or
    span/entity tagging) — so the same builder covers classification-style and
    NER-style annotation.
  - All of the above rides inside the existing dataset_config JSON column —
    no schema migration needed.
"""

import json
from datetime import datetime, date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_, text, func

from models import (
    Competition,
    CompetitionOrganizer,
    CompetitionParticipant,
    CompetitionJoinRequest,
    CompetitionPrompt,
    CompetitionDataset,
    Submission,
)
from schemas import CompetitionCreateIn, CompetitionActionOut
from .utils import get_db, get_current_user, get_icon_for_task

router = APIRouter(tags=["competitions"])

# ── Per-task fallback defaults ─────────────────────────────────────────────────
# Used when the organizer hasn't configured a field yet, or for older competitions
# that predate the task-config feature.
TASK_CONFIG_DEFAULTS: dict[str, dict] = {
    "TEXT_CLASSIFICATION": {
        "labels": ["Finance", "Technology", "Healthcare", "Politics",
                   "Sports", "Entertainment", "Science", "Other"],
        "description": "",
    },
    "NER": {
        "entity_types": ["PER", "ORG", "LOC", "MISC", "DATE", "MONEY", "PRODUCT"],
        "description": "",
    },
    "SENTIMENT_ANALYSIS": {
        "sentiment_labels": ["positive", "negative", "neutral", "mixed"],
        "aspect_categories": ["product", "service", "price", "delivery", "support"],
        "description": "",
    },
    "TRANSLATION": {
        "source_lang": "EN",
        "target_lang": "AR",
        "glossary": [],
        "description": "",
    },
    "QUESTION_ANSWERING": {
        "qa_type": "extractive",
        "description": "",
    },
    "SUMMARIZATION": {
        "target_ratio": 0.1,
        "max_ratio": 0.15,
        "min_summary_words": 20,
        "description": "",
    },
    "AUDIO_SYNTHESIS": {
        "description": "",
    },
    "AUDIO_TRANSCRIPTION": {
        "speakers": 1,
        "with_timestamps": False,
        "description": "",
    },
    "SPEECH_EMOTION": {
        "emotion_labels": ["neutral", "happy", "sad", "angry",
                           "surprised", "fearful", "disgusted", "contempt"],
        "description": "",
    },
    "AUDIO_EVENT_DETECTION": {
        "event_types": ["speech", "music", "noise", "silence",
                        "applause", "laughter", "alarm", "animal"],
        "description": "",
    },
    "MULTI_TASK_ANNOTATION": {
        # Several simultaneous label sets on the same instance, each with its
        # own annotation type: "single_label", "multi_label", or "span" (entity
        # tagging, e.g. NER). How the underlying data is sourced/annotated is
        # controlled by the separate, task-independent Data Collection flag,
        # whose "inputs" list supports more than one named input of the same
        # or different modality (e.g. Question + Context, both text).
        "tasks": [
            {"id": 1, "name": "Sentiment", "type": "single_label", "labels": ["Positive", "Negative", "Neutral"]},
            {"id": 2, "name": "Sarcasm", "type": "single_label", "labels": ["Yes", "No"]},
            {"id": 3, "name": "Hate Speech", "type": "single_label", "labels": ["Hateful", "Not Hateful"]},
        ],
    },
    "CUSTOM": {
        # A blank slate: the organizer defines every input (via Data
        # Collection) and every annotation task from scratch, plus free-form
        # notes for anything the structured fields don't cover.
        "tasks": [],
        "custom_notes": "",
    },
}

PROMPT_TASKS = {"AUDIO_SYNTHESIS", "SPEECH_EMOTION"}


def parse_date(value):
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except Exception:
        return None


def compute_competition_status(competition: Competition):
    if competition.is_draft:
        return "DRAFT"

    today = date.today()
    start = parse_date(competition.start_date)
    end = parse_date(competition.end_date)

    if start and today < start:
        return "UPCOMING"
    if start and end and start <= today <= end:
        return "OPEN"
    if end and today > end:
        return "CLOSED"

    return "OPEN"


def task_category(competition: Competition):
    return (competition.task_type or "GENERAL").upper()


def competition_display_dict(competition: Competition) -> dict:
    real_status = compute_competition_status(competition)

    if real_status == "UPCOMING":
        footer = "UPCOMING"
    elif real_status == "OPEN":
        footer = "ACTIVE"
    elif real_status == "CLOSED":
        footer = "ENDED"
    else:
        footer = real_status

    base = {c.name: getattr(competition, c.name) for c in competition.__table__.columns}

    # `dataset_config` is the column name, but since the CreateCompetition
    # wizard was extended it actually stores the full organizer-defined task
    # config: tracks, phases, data_collection rules, license, and evaluation
    # scoring. Parse it once here so every consumer (details page, teams
    # panel, etc.) gets a real dict under `task_config` instead of having to
    # re-parse (or silently ignore, as the details page used to) a raw JSON
    # string.
    try:
        task_config = json.loads(competition.dataset_config or "{}")
        if not isinstance(task_config, dict):
            task_config = {}
    except (TypeError, ValueError):
        task_config = {}

    base.update(
        {
            "category": task_category(competition),
            "status": real_status,
            "stat1_label": "REWARD",
            "stat1_value": f"${competition.prize_pool:,}" if competition.prize_pool is not None else "TBD",
            "stat2_label": "DEADLINE",
            "stat2_value": competition.end_date or "TBD",
            "footer": footer,
            "muted": False,
            "datasets_json": "[]",
            "join_method": competition.join_method or "auto",
            "task_config": task_config,
            "tracks_enabled": bool(task_config.get("tracks_enabled")),
            "phases_enabled": bool(task_config.get("phases_enabled")),
            "data_collection_enabled": bool(task_config.get("data_collection")) and "data_collection" in task_config,
        }
    )

    return base


def delete_competition_related_rows(db: Session, competition_id: str):
    db.execute(text("DELETE FROM competition_datasets WHERE competition_id = :cid"), {"cid": competition_id})
    db.execute(text("DELETE FROM competition_participants WHERE competition_id = :cid"), {"cid": competition_id})
    db.execute(text("DELETE FROM competition_organizers WHERE competition_id = :cid"), {"cid": competition_id})
    db.execute(text("DELETE FROM recent_competitions WHERE competition_id = :cid"), {"cid": competition_id})
    db.execute(text("DELETE FROM competition_prompts WHERE competition_id = :cid"), {"cid": competition_id})
    db.execute(text("DELETE FROM dataset_versions WHERE competition_id = :cid"), {"cid": competition_id})


def validate_competition_payload(data: CompetitionCreateIn):
    if not data.competition_name or not data.competition_name.strip():
        raise HTTPException(status_code=400, detail="Competition name is required")
    if not data.task_type or not data.task_type.strip():
        raise HTTPException(status_code=400, detail="Task type is required")
    if not data.description or not data.description.strip():
        raise HTTPException(status_code=400, detail="Description is required")

    start = parse_date(data.start_date)
    end = parse_date(data.end_date)

    if data.start_date and not start:
        raise HTTPException(status_code=400, detail="Invalid start date format")
    if data.end_date and not end:
        raise HTTPException(status_code=400, detail="Invalid end date format")
    if start and end and end < start:
        raise HTTPException(status_code=400, detail="End date must be after start date")

    if not data.primary_metric:
        raise HTTPException(status_code=400, detail="Primary metric is required")

    if data.prize_pool is not None and data.prize_pool < 0:
        raise HTTPException(status_code=400, detail="Prize pool cannot be negative")
    if data.max_teams is not None and data.max_teams < 0:
        raise HTTPException(status_code=400, detail="Max teams cannot be negative")
    if data.min_members is not None and data.min_members <= 0:
        raise HTTPException(status_code=400, detail="Min team members must be greater than 0")
    if data.max_members is not None and data.max_members <= 0:
        raise HTTPException(status_code=400, detail="Max team members must be greater than 0")
    if data.min_members is not None and data.max_members is not None and data.min_members > data.max_members:
        raise HTTPException(status_code=400, detail="Min team members cannot exceed max team members")
    if data.max_submissions_per_day is not None and data.max_submissions_per_day <= 0:
        raise HTTPException(status_code=400, detail="Max submissions per day must be greater than 0")

    merge_deadline = parse_date(data.merge_deadline)
    validation_date = parse_date(data.validation_date)
    freeze_date = parse_date(data.freeze_date)

    if data.merge_deadline and not merge_deadline:
        raise HTTPException(status_code=400, detail="Invalid merge deadline format")
    if data.validation_date and not validation_date:
        raise HTTPException(status_code=400, detail="Invalid validation date format")
    if data.freeze_date and not freeze_date:
        raise HTTPException(status_code=400, detail="Invalid freeze date format")

    for label, value in [
        ("Merge deadline", merge_deadline),
        ("Validation date", validation_date),
        ("Freeze date", freeze_date),
    ]:
        if value and start and value < start:
            raise HTTPException(status_code=400, detail=f"{label} cannot be before start date")
        if value and end and value > end:
            raise HTTPException(status_code=400, detail=f"{label} cannot be after end date")

    if validation_date and freeze_date and freeze_date < validation_date:
        raise HTTPException(status_code=400, detail="Freeze date cannot be before validation date")

    task_config = getattr(data, "task_config", None) or {}

    if getattr(data, "tracks_enabled", False):
        validate_tracks_config(task_config.get("tracks") or [])

    if getattr(data, "phases_enabled", False):
        validate_phases_config(task_config.get("phases") or [])

    if getattr(data, "data_collection_enabled", False):
        validate_data_collection_config(
            task_config.get("data_collection") or {},
            task_config.get("license") or {},
        )

    # Independent of the flags above: whenever combined evaluation scoring is
    # selected, its weights must be valid, whether or not tracks are enabled.
    validate_evaluation_scoring(task_config.get("evaluation_scoring") or {})


def validate_tracks_config(tracks: list):
    """
    Split participants into fair comparison groups, each viable only once it
    reaches its own minimum team count. Runs whenever tracks_enabled=True so a
    direct API call can't skip the checks the CreateCompetition wizard enforces.
    """
    if not tracks:
        raise HTTPException(status_code=400, detail="At least one track is required when Tracks is enabled")
    for t in tracks:
        if not (t.get("name") or "").strip():
            raise HTTPException(status_code=400, detail="Every track needs a name")
        if not t.get("minTeams") or int(t["minTeams"]) < 1:
            raise HTTPException(status_code=400, detail=f"Track '{t.get('name')}' needs a minimum team count of at least 1")


def validate_phases_config(phases: list):
    """
    An ordered, named timeline replacing the flat start/end date + milestones.
    Runs whenever phases_enabled=True.
    """
    if not phases:
        raise HTTPException(status_code=400, detail="At least one phase is required when Phases is enabled")
    for p in phases:
        if not (p.get("name") or "").strip():
            raise HTTPException(status_code=400, detail="Every phase needs a name")
        if not p.get("durationDays") or int(p["durationDays"]) <= 0:
            raise HTTPException(status_code=400, detail=f"Phase '{p.get('name')}' needs a duration greater than 0 days")


def validate_data_collection_config(data_collection: dict, license_cfg: dict):
    """
    Participants source, record, or adapt their own raw data instead of using
    an organizer-provided dataset. Runs whenever data_collection_enabled=True,
    independent of task type or which/how many labels are being annotated.

    An instance can carry more than one input (e.g. Question Answering needs
    a "Question" and a "Context Passage", both text), so this validates a
    list of named inputs rather than a single modality.
    """
    inputs = data_collection.get("inputs") or []
    if not inputs:
        raise HTTPException(status_code=400, detail="Define at least one input for Data Collection")
    for inp in inputs:
        if not (inp.get("name") or "").strip():
            raise HTTPException(status_code=400, detail="Every input needs a name")
        if inp.get("modality") not in ("text", "audio"):
            raise HTTPException(status_code=400, detail=f"Input '{inp.get('name')}' needs a modality of 'text' or 'audio'")
        if not inp.get("max_length") or float(inp["max_length"]) <= 0:
            raise HTTPException(status_code=400, detail=f"Input '{inp.get('name')}' needs a positive maximum length")

    if not data_collection.get("allowed_source_types"):
        raise HTTPException(status_code=400, detail="Select at least one allowed data source")
    if not data_collection.get("annotators_per_instance") or int(data_collection["annotators_per_instance"]) < 1:
        raise HTTPException(status_code=400, detail="At least one annotator per instance is required")

    if not (license_cfg.get("version") or "").strip():
        raise HTTPException(status_code=400, detail="A license version is required before contributors can accept it")
    if not (license_cfg.get("text") or "").strip():
        raise HTTPException(status_code=400, detail="License text is required when Data Collection is enabled")


def validate_evaluation_scoring(evaluation: dict):
    """
    "standard" ranks on the primary metric alone and needs no extra checks;
    "data_quality_plus_model" combines a per-team data-quality score with each
    team's own model score, so its weights must be valid regardless of which
    other capabilities (tracks, phases, data collection) are turned on.
    """
    if evaluation.get("mode") != "data_quality_plus_model":
        return

    dq = evaluation.get("data_quality_weight")
    mw = evaluation.get("model_weight")
    if dq is None or mw is None or abs((float(dq) + float(mw)) - 100) > 0.01:
        raise HTTPException(status_code=400, detail="Data quality weight + model weight must add up to 100")
    fraction = evaluation.get("public_test_fraction")
    if fraction is not None and not (0 <= float(fraction) <= 100):
        raise HTTPException(status_code=400, detail="Held-out test fraction must be between 0 and 100")
    if not evaluation.get("winners_per_track") or int(evaluation["winners_per_track"]) < 1:
        raise HTTPException(status_code=400, detail="At least 1 winner is required")


def _clean_list_values(cfg: dict) -> dict:
    """
    Strip empty/whitespace-only strings from any list values in a task config
    dict. This prevents blank label buttons when the organizer leaves trailing
    newlines in the textarea form fields.
    """
    cleaned = {}
    for k, v in cfg.items():
        if isinstance(v, list):
            cleaned[k] = [item for item in v if isinstance(item, str) and item.strip()]
        else:
            cleaned[k] = v
    return cleaned


def _merge_task_config(task_type: str, organizer_config: dict) -> dict:
    """Merge organizer overrides on top of per-task defaults."""
    defaults = dict(TASK_CONFIG_DEFAULTS.get(task_type or "", {}))
    defaults.update(_clean_list_values(organizer_config or {}))
    return defaults


def build_competition_record(data: CompetitionCreateIn, is_draft: bool) -> Competition:
    task_config = getattr(data, "task_config", None) or {}
    merged = _merge_task_config(data.task_type, task_config)
    # Strip the "prompts" key from dataset_config — prompts live in competition_prompts table
    config_to_store = _clean_list_values({k: v for k, v in merged.items() if k != "prompts"})

    return Competition(
        title=data.competition_name,
        description=data.description,
        is_draft=is_draft,
        task_type=data.task_type,
        start_date=data.start_date,
        end_date=data.end_date,
        prize_pool=data.prize_pool,
        primary_metric=data.primary_metric,
        secondary_metric=data.secondary_metric,
        max_teams=data.max_teams,
        min_members=data.min_members,
        max_members=data.max_members,
        merge_deadline=data.merge_deadline,
        required_skills=json.dumps(data.required_skills or []),
        max_submissions_per_day=data.max_submissions_per_day,
        allow_external_data=data.allow_external_data,
        allow_pretrained_models=data.allow_pretrained_models,
        require_code_sharing=data.require_code_sharing,
        additional_rules=data.additional_rules,
        complexity_level=data.complexity_level,
        milestones_json=json.dumps(data.milestones or []),
        validation_date=data.validation_date,
        freeze_date=data.freeze_date,
        dataset_config=json.dumps(config_to_store),
        join_method=getattr(data, "join_method", "auto") or "auto",
    )


def _seed_prompts(db: Session, competition_id: str, task_type: str, task_config: dict):
    """
    If task_type requires prompts (AUDIO_SYNTHESIS, SPEECH_EMOTION) and the
    organizer supplied them, wipe existing prompts and re-seed from the config.
    """
    if task_type not in PROMPT_TASKS:
        return
    raw_prompts = task_config.get("prompts") or []
    if not raw_prompts:
        return

    db.execute(
        text("DELETE FROM competition_prompts WHERE competition_id = :cid"),
        {"cid": competition_id},
    )
    for content in raw_prompts:
        content = content.strip()
        if content:
            db.add(CompetitionPrompt(
                competition_id=competition_id,
                content=content,
                used_count=0,
                created_at=datetime.utcnow().isoformat(),
            ))


def apply_competition_filters(query, db, search, category, tab, current_user):
    if search:
        term = f"%{search}%"
        query = query.filter(
            or_(
                Competition.title.ilike(term),
                Competition.description.ilike(term),
                Competition.task_type.ilike(term),
            )
        )

    if category and category.upper() != "ALL TASKS":
        query = query.filter(Competition.task_type.ilike(category))

    if tab == "participating":
        ids = db.query(CompetitionParticipant.competition_id).filter(
            CompetitionParticipant.user_id == current_user.id
        )
        query = query.filter(Competition.id.in_(ids))
    elif tab == "organizing":
        ids = db.query(CompetitionOrganizer.competition_id).filter(
            CompetitionOrganizer.user_id == current_user.id
        )
        query = query.filter(Competition.id.in_(ids))

    return query


def get_user_role(db: Session, competition_id: str, user_id: str):
    is_organizer = (
        db.query(CompetitionOrganizer)
        .filter(CompetitionOrganizer.competition_id == competition_id, CompetitionOrganizer.user_id == user_id)
        .first()
        is not None
    )
    if is_organizer:
        return "organizer"

    is_participant = (
        db.query(CompetitionParticipant)
        .filter(CompetitionParticipant.competition_id == competition_id, CompetitionParticipant.user_id == user_id)
        .first()
        is not None
    )
    if is_participant:
        return "participant"

    return "none"

def _parse_skills(raw) -> list:
    """Return list of skill strings from JSON text/list."""
    if not raw:
        return []

    if isinstance(raw, list):
        return [str(s).strip() for s in raw if str(s).strip()]

    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(s).strip() for s in parsed if str(s).strip()]
        return []
    except Exception:
        return []


def _get_user_skills(db: Session, user_id: str) -> list[str]:
    row = db.execute(
        text("SELECT skills FROM user_profiles WHERE user_id = :uid"),
        {"uid": str(user_id)},
    ).first()

    if not row or not row[0]:
        return []

    value = row[0]

    if isinstance(value, list):
        return [str(s).strip() for s in value if str(s).strip()]

    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            return [str(s).strip() for s in parsed if str(s).strip()]
    except Exception:
        pass

    return []


def _format_user_names(db: Session, user_ids: list[str]) -> str:
    from models import UserProfile

    if not user_ids:
        return ""

    profiles = (
        db.query(UserProfile)
        .filter(UserProfile.user_id.in_([str(uid) for uid in user_ids]))
        .all()
    )

    by_id = {str(p.user_id): p for p in profiles}

    labels = []

    for uid in user_ids:
        p = by_id.get(str(uid))
        if p:
            labels.append(p.full_name or p.email or str(uid))
        else:
            labels.append(str(uid))

    return ", ".join(labels)


def _raise_if_team_has_organizer(
    db: Session,
    competition_id: str,
    member_rows,
):
    member_ids = [str(m.user_id) for m in member_rows]

    organizer_rows = (
        db.query(CompetitionOrganizer)
        .filter(
            CompetitionOrganizer.competition_id == competition_id,
            CompetitionOrganizer.user_id.in_(member_ids),
        )
        .all()
    )

    organizer_ids = [str(row.user_id) for row in organizer_rows]

    if organizer_ids:
        names = _format_user_names(db, organizer_ids)

        raise HTTPException(
            status_code=400,
            detail=(
                "This team cannot join because one or more team members are organizers "
                f"of this competition: {names}. Remove them from the team or choose another team."
            ),
        )


def _raise_if_team_members_already_joined(
    db: Session,
    competition_id: str,
    team_id: str,
    member_rows,
):
    member_ids = [str(m.user_id) for m in member_rows]

    existing_rows = (
        db.query(CompetitionParticipant)
        .filter(
            CompetitionParticipant.competition_id == competition_id,
            CompetitionParticipant.user_id.in_(member_ids),
        )
        .all()
    )

    if not existing_rows:
        return

    existing_ids = [str(row.user_id) for row in existing_rows]
    names = _format_user_names(db, existing_ids)

    raise HTTPException(
        status_code=400,
        detail=(
            "This team cannot join because one or more team members have already joined "
            f"this competition: {names}."
        ),
    )


def _do_join_competition(db: Session, competition: Competition, user_id: str, team_id=None, track_id=None):
    participant = CompetitionParticipant(
        competition_id=competition.id,
        user_id=user_id,
        team_id=team_id,
        status="joined",
        joined_at=datetime.utcnow().isoformat(),
    )
    db.add(participant)

    if track_id:
        db.flush()
        _set_participant_track_id(db, participant.id, track_id)

    return participant


# ─────────────────────────────────────────────────────────────────────────────
# Track assignment helpers
#
# Tracks (e.g. regional dialect tracks) live inside task_config, not as their
# own table — but WHICH track a team registered for has to be recorded
# somewhere so organizers can count teams per track and remove tracks that
# never reach their minimum. That requires a `track_id` column on
# competition_participants (see migrations/2026_add_track_support.sql).
#
# These helpers check for that column once per process and no-op instead of
# raising if the migration hasn't been applied yet, so track selection is
# additive and never breaks a plain join.
# ─────────────────────────────────────────────────────────────────────────────

_track_column_cache = {"exists": None}


def _participants_have_track_column(db: Session) -> bool:
    if _track_column_cache["exists"] is None:
        try:
            row = db.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'competition_participants' AND column_name = 'track_id'"
                )
            ).first()
            _track_column_cache["exists"] = row is not None
        except Exception:
            _track_column_cache["exists"] = False
    return _track_column_cache["exists"]


def _set_participant_track_id(db: Session, participant_id, track_id):
    if not _participants_have_track_column(db):
        return
    db.execute(
        text("UPDATE competition_participants SET track_id = :tid WHERE id = :pid"),
        {"tid": str(track_id), "pid": participant_id},
    )


def _get_track_team_counts(db: Session, competition_id: str) -> dict:
    """Returns {track_id: distinct_team_count} for a competition. Counts
    individual (non-team) participants too, keyed the same way, so tracks
    work whether or not the competition requires teams."""
    if not _participants_have_track_column(db):
        return {}
    rows = db.execute(
        text(
            "SELECT track_id, COUNT(DISTINCT COALESCE(team_id, user_id)) AS cnt "
            "FROM competition_participants "
            "WHERE competition_id = :cid AND track_id IS NOT NULL "
            "GROUP BY track_id"
        ),
        {"cid": competition_id},
    ).all()
    return {str(r.track_id): int(r.cnt) for r in rows}


def _validate_track_selection(task_config: dict, track_id):
    """Raises if track_id doesn't refer to a real, still-active track."""
    if not track_id:
        return
    tracks = (task_config or {}).get("tracks") or []
    match = next((t for t in tracks if str(t.get("id")) == str(track_id)), None)
    if not match:
        raise HTTPException(status_code=400, detail="Selected track does not exist for this competition")
    if match.get("active") is False:
        raise HTTPException(
            status_code=400,
            detail=f"Track '{match.get('name')}' did not reach its minimum team count and is no longer accepting teams",
        )


# ─────────────────────────────────────────────────────────────────────────────
# Dataset-config endpoint  ← used by DataCollection.jsx to populate widgets
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}/dataset-config")
def get_dataset_config(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Returns the merged task configuration for the competition.
    Organizer-supplied values override per-task defaults.
    Also injects prompt_count for audio tasks.
    """
    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    task_type = (competition.task_type or "").upper()

    # Load organizer config stored on the competition
    try:
        stored = json.loads(competition.dataset_config or "{}")
    except (json.JSONDecodeError, TypeError):
        stored = {}

    # Merge with defaults (organizer config wins for any key it provides)
    merged = _merge_task_config(task_type, stored)

    # For audio prompt tasks: expose how many prompts are available
    if task_type in PROMPT_TASKS:
        prompt_count = (
            db.query(CompetitionPrompt)
            .filter(CompetitionPrompt.competition_id == competition_id)
            .count()
        )
        merged["prompt_count"] = prompt_count

    return merged


# ─────────────────────────────────────────────────────────────────────────────
# Competition count
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/count")
def get_competitions_count(
    search: str | None = None,
    category: str | None = None,
    status: str | None = None,
    tab: str = "all",
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    query = db.query(Competition).filter(Competition.is_draft == False)
    query = apply_competition_filters(query, db, search, category, tab, current_user)

    competitions = query.all()

    if status:
        wanted = status.upper()
        return {"count": sum(1 for comp in competitions if compute_competition_status(comp) == wanted)}

    return {"count": len(competitions)}


# ─────────────────────────────────────────────────────────────────────────────
# Draft
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/competitions/draft", response_model=CompetitionActionOut)
def save_competition_draft(
    data: CompetitionCreateIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    competition = build_competition_record(data, is_draft=True)

    db.add(competition)
    db.flush()

    db.add(
        CompetitionOrganizer(
            competition_id=competition.id,
            user_id=current_user.id,
            role="owner",
            created_at=datetime.utcnow().isoformat(),
        )
    )

    task_config = getattr(data, "task_config", None) or {}
    _seed_prompts(db, competition.id, data.task_type or "", task_config)

    db.commit()
    db.refresh(competition)

    return {"message": "Competition draft saved successfully", "competition_id": competition.id}


# ─────────────────────────────────────────────────────────────────────────────
# Create
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/competitions/create", response_model=CompetitionActionOut)
def create_competition(
    data: CompetitionCreateIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    validate_competition_payload(data)

    competition = build_competition_record(data, is_draft=False)
    db.add(competition)
    db.flush()

    db.add(
        CompetitionOrganizer(
            competition_id=competition.id,
            user_id=current_user.id,
            role="owner",
            created_at=datetime.utcnow().isoformat(),
        )
    )

    task_config = getattr(data, "task_config", None) or {}
    _seed_prompts(db, competition.id, data.task_type or "", task_config)

    db.commit()
    db.refresh(competition)

    return {"message": "Competition created successfully", "competition_id": competition.id}


# ─────────────────────────────────────────────────────────────────────────────
# List / search
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions")
def get_competitions(
    limit: int = 20,
    offset: int = 0,
    search: str | None = None,
    category: str | None = None,
    status: str | None = None,
    tab: str = "all",
    sort: str = "newest",
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    query = db.query(Competition).filter(Competition.is_draft == False)
    query = apply_competition_filters(query, db, search, category, tab, current_user)

    competitions = query.all()

    def valid_date_value(value):
        return parse_date(value) is not None

    if sort == "unknown_dates":
        competitions = [c for c in competitions if not valid_date_value(c.start_date) or not valid_date_value(c.end_date)]
    elif sort == "oldest":
        competitions = [c for c in competitions if valid_date_value(c.start_date)]
        competitions.sort(key=lambda c: parse_date(c.start_date))
    else:
        competitions = [c for c in competitions if valid_date_value(c.start_date)]
        competitions.sort(key=lambda c: parse_date(c.start_date), reverse=True)

    if status:
        wanted = status.upper()
        competitions = [comp for comp in competitions if compute_competition_status(comp) == wanted]

    competitions = competitions[offset: offset + limit]

    if not competitions:
        return []

    comp_ids = [c.id for c in competitions]

    organized_ids = {
        row.competition_id
        for row in db.query(CompetitionOrganizer)
        .filter(CompetitionOrganizer.competition_id.in_(comp_ids), CompetitionOrganizer.user_id == current_user.id)
        .all()
    }

    participated_ids = {
        row.competition_id
        for row in db.query(CompetitionParticipant)
        .filter(CompetitionParticipant.competition_id.in_(comp_ids), CompetitionParticipant.user_id == current_user.id)
        .all()
    }

    result = []
    for comp in competitions:
        d = competition_display_dict(comp)

        if comp.id in organized_ids:
            d["user_role"] = "organizer"
        elif comp.id in participated_ids:
            d["user_role"] = "participant"
        else:
            d["user_role"] = "none"

        result.append(d)

    return result


# ─────────────────────────────────────────────────────────────────────────────
# Is-joined
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}/is-joined")
def is_joined_competition(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    role = get_user_role(db, competition_id, current_user.id)
    return {"joined": role == "participant", "user_role": role}


# ─────────────────────────────────────────────────────────────────────────────
# Join
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/competitions/{competition_id}/join")
def join_competition(
    competition_id: str,
    body: dict = {},
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from models import UserProfile

    competition = (
        db.query(Competition)
        .filter(Competition.id == competition_id, Competition.is_draft == False)
        .first()
    )
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    real_status = compute_competition_status(competition)
    if real_status != "OPEN":
        raise HTTPException(status_code=400, detail=f"Competition is {real_status.lower()} and cannot be joined")
    
    if competition.min_members and competition.min_members > 1:
        raise HTTPException(
            status_code=400,
            detail="This competition requires a team. Please join with a team instead of joining solo.",
        )

    current_role = get_user_role(db, competition_id, current_user.id)
    if current_role == "organizer":
        raise HTTPException(status_code=400, detail="Organizer cannot join as participant")
    if current_role == "participant":
        raise HTTPException(status_code=400, detail="Already joined this competition")

    existing_req = (
        db.query(CompetitionJoinRequest)
        .filter(
            CompetitionJoinRequest.competition_id == competition_id,
            CompetitionJoinRequest.user_id == current_user.id,
            CompetitionJoinRequest.status == "pending",
        )
        .first()
    )
    if existing_req:
        raise HTTPException(status_code=400, detail="You already have a pending join request for this competition")

    required_skills = _parse_skills(competition.required_skills)
    if required_skills:
        user_skills = _get_user_skills(db, current_user.id)
        missing = set(required_skills) - set(user_skills)
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"You are missing required skill(s): {', '.join(sorted(missing))}",
            )

    track_id = str(body.get("track_id") or "").strip() or None
    if track_id:
        d = competition_display_dict(competition)
        if not d.get("tracks_enabled"):
            raise HTTPException(status_code=400, detail="This competition does not use tracks")
        _validate_track_selection(d.get("task_config"), track_id)

    join_method = competition.join_method or "auto"

    if join_method == "manual":
        message = (body.get("message") or "").strip() or None
        now = datetime.utcnow().isoformat()

        req = CompetitionJoinRequest(
            competition_id=competition_id,
            user_id=str(current_user.id),
            team_id=None,
            message=message,
            status="pending",
            created_at=now,
            updated_at=now,
        )
        db.add(req)

        from .notifications import create_notification

        organizers = db.query(CompetitionOrganizer).filter(
            CompetitionOrganizer.competition_id == competition_id
        ).all()

        profile = db.query(UserProfile).filter(UserProfile.user_id == str(current_user.id)).first()
        actor_name = profile.full_name if profile else "A user"

        for org in organizers:
            create_notification(
                db,
                user_id=org.user_id,
                type="competition_join_request",
                title="New Competition Join Request",
                message=f"{actor_name} requested to join \"{competition.title}\".",
                actor_id=str(current_user.id),
                actor_name=actor_name,
                competition_id=competition.id,
                competition_name=competition.title,
            )

        db.commit()
        return {"message": "Join request submitted. Waiting for organizer approval.", "status": "pending"}

    _do_join_competition(db, competition, str(current_user.id), team_id=None, track_id=track_id)
    db.commit()
    return {"message": "Joined competition successfully", "status": "joined"}


@router.post("/competitions/{competition_id}/join-team")
def join_competition_as_team(
    competition_id: str,
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Team join. Only the team LEADER may call this.
    Validates:
      - caller is team leader
      - team size matches competition requirements
      - team collectively covers required skills
      - no team member is an organizer of this competition
      - no team member already joined this competition
    """
    from models import UserProfile
    from models_teams import Team, TeamMember

    competition = (
        db.query(Competition)
        .filter(Competition.id == competition_id, Competition.is_draft == False)
        .first()
    )

    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    real_status = compute_competition_status(competition)

    if real_status != "OPEN":
        raise HTTPException(
            status_code=400,
            detail=f"Competition is {real_status.lower()} and cannot be joined",
        )

    team_id = str(body.get("team_id") or "").strip()

    if not team_id:
        raise HTTPException(status_code=400, detail="team_id is required")

    try:
        team_id_int = int(team_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid team_id")

    team = db.query(Team).filter(Team.id == team_id_int).first()

    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    leader_row = (
        db.query(TeamMember)
        .filter(
            TeamMember.team_id == team_id_int,
            TeamMember.user_id == str(current_user.id),
            TeamMember.role == "leader",
        )
        .first()
    )

    if not leader_row:
        raise HTTPException(
            status_code=403,
            detail="Only the team leader can submit a join request",
        )

    already_team = (
        db.query(CompetitionParticipant)
        .filter(
            CompetitionParticipant.competition_id == competition_id,
            CompetitionParticipant.team_id == team_id,
        )
        .first()
    )

    if already_team:
        raise HTTPException(
            status_code=400,
            detail="This team has already joined the competition",
        )

    existing_req = (
        db.query(CompetitionJoinRequest)
        .filter(
            CompetitionJoinRequest.competition_id == competition_id,
            CompetitionJoinRequest.team_id == team_id,
            CompetitionJoinRequest.status == "pending",
        )
        .first()
    )

    if existing_req:
        raise HTTPException(
            status_code=400,
            detail="This team already has a pending join request",
        )

    member_rows = (
        db.query(TeamMember)
        .filter(TeamMember.team_id == team_id_int)
        .all()
    )

    if not member_rows:
        raise HTTPException(status_code=400, detail="Team has no members")

    # IMPORTANT FIX:
    # Do this BEFORE inserting into competition_participants.
    _raise_if_team_has_organizer(db, competition_id, member_rows)
    _raise_if_team_members_already_joined(db, competition_id, team_id, member_rows)

    team_size = len(member_rows)

    min_m = competition.min_members
    max_m = competition.max_members

    if min_m and team_size < min_m:
        raise HTTPException(
            status_code=400,
            detail=f"Team has {team_size} member(s) but the competition requires at least {min_m}",
        )

    if max_m and team_size > max_m:
        raise HTTPException(
            status_code=400,
            detail=f"Team has {team_size} member(s) but the competition allows at most {max_m}",
        )

    required_skills = _parse_skills(competition.required_skills)

    if required_skills:
        member_user_ids = [str(m.user_id) for m in member_rows]

        profiles = (
            db.query(UserProfile)
            .filter(UserProfile.user_id.in_(member_user_ids))
            .all()
        )

        team_skills = set()

        for p in profiles:
            team_skills.update(_get_user_skills(db, p.user_id))

        missing = set(required_skills) - team_skills

        if missing:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Team is missing required skill(s): {', '.join(sorted(missing))}. "
                    "Distribute them across members or recruit someone with those skills."
                ),
            )

    track_id = str(body.get("track_id") or "").strip() or None
    if track_id:
        d = competition_display_dict(competition)
        if not d.get("tracks_enabled"):
            raise HTTPException(status_code=400, detail="This competition does not use tracks")
        _validate_track_selection(d.get("task_config"), track_id)

    join_method = competition.join_method or "auto"
    message = (body.get("message") or "").strip() or None

    if join_method == "manual":
        now = datetime.utcnow().isoformat()

        req = CompetitionJoinRequest(
            competition_id=competition_id,
            user_id=str(current_user.id),
            team_id=team_id,
            message=message,
            status="pending",
            created_at=now,
            updated_at=now,
        )

        db.add(req)

        from .notifications import create_notification

        organizers = (
            db.query(CompetitionOrganizer)
            .filter(CompetitionOrganizer.competition_id == competition_id)
            .all()
        )

        for org in organizers:
            create_notification(
                db,
                user_id=org.user_id,
                type="competition_join_request",
                title="New Team Join Request",
                message=f'Team "{team.name}" requested to join "{competition.title}".',
                actor_id=str(current_user.id),
                team_id=team.id,
                team_name=team.name,
                competition_id=competition.id,
                competition_name=competition.title,
            )

        db.commit()

        return {
            "message": "Join request submitted. Waiting for organizer approval.",
            "status": "pending",
        }

    for m in member_rows:
        _do_join_competition(
            db,
            competition,
            str(m.user_id),
            team_id=team_id,
            track_id=track_id,
        )

    db.commit()

    return {
        "message": f"Team '{team.name}' joined competition successfully",
        "status": "joined",
    }

# ─────────────────────────────────────────────────────────────────────────────
# Join-request management (organizer only)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}/join-requests")
def list_join_requests(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from models import UserProfile
    from models_teams import Team, TeamMember

    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    if get_user_role(db, competition_id, current_user.id) != "organizer":
        raise HTTPException(status_code=403, detail="Only the organizer can view join requests")

    requests = (
        db.query(CompetitionJoinRequest)
        .filter(
            CompetitionJoinRequest.competition_id == competition_id,
            CompetitionJoinRequest.status == "pending",
        )
        .order_by(CompetitionJoinRequest.created_at.asc())
        .all()
    )

    result = []

    for req in requests:
        profile = db.query(UserProfile).filter(UserProfile.user_id == req.user_id).first()

        team_info = None

        if req.team_id:
            team = db.query(Team).filter(Team.id == int(req.team_id)).first()
            members = db.query(TeamMember).filter(TeamMember.team_id == int(req.team_id)).all()

            team_members = []

            for m in members:
                p = db.query(UserProfile).filter(UserProfile.user_id == str(m.user_id)).first()

                team_members.append({
                    "user_id": str(m.user_id),
                    "username": p.full_name if p else str(m.user_id),
                    "email": p.email if p else None,
                    "role": m.role,
                    "skills": _get_user_skills(db, m.user_id),
                })

            team_info = {
                "id": req.team_id,
                "name": team.name if team else f"Team #{req.team_id}",
                "members": team_members,
                "member_count": len(team_members),
            }

        result.append({
            "id": req.id,
            "competition_id": req.competition_id,
            "user_id": req.user_id,
            "username": profile.full_name if profile else req.user_id,
            "email": profile.email if profile else None,
            "skills": _get_user_skills(db, req.user_id),
            "team_id": req.team_id,
            "team": team_info,
            "message": req.message,
            "status": req.status,
            "created_at": req.created_at,
        })

    return result

@router.post("/competitions/{competition_id}/join-requests/{request_id}/approve")
def approve_join_request(
    competition_id: str,
    request_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Organizer approves a pending join request."""
    from models_teams import TeamMember

    if get_user_role(db, competition_id, current_user.id) != "organizer":
        raise HTTPException(
            status_code=403,
            detail="Only the organizer can approve join requests",
        )

    req = (
        db.query(CompetitionJoinRequest)
        .filter(
            CompetitionJoinRequest.id == request_id,
            CompetitionJoinRequest.competition_id == competition_id,
            CompetitionJoinRequest.status == "pending",
        )
        .first()
    )

    if not req:
        raise HTTPException(status_code=404, detail="Join request not found")

    competition = (
        db.query(Competition)
        .filter(Competition.id == competition_id)
        .first()
    )

    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    if req.team_id:
        member_rows = (
            db.query(TeamMember)
            .filter(TeamMember.team_id == int(req.team_id))
            .all()
        )

        if not member_rows:
            raise HTTPException(status_code=400, detail="Team has no members")

        # IMPORTANT FIX:
        # Prevent DB trigger crash before commit.
        _raise_if_team_has_organizer(db, competition_id, member_rows)
        _raise_if_team_members_already_joined(db, competition_id, req.team_id, member_rows)

        for m in member_rows:
            _do_join_competition(
                db,
                competition,
                str(m.user_id),
                team_id=req.team_id,
            )
    else:
        current_role = get_user_role(db, competition_id, req.user_id)

        if current_role == "organizer":
            raise HTTPException(
                status_code=400,
                detail="Organizer cannot also be participant",
            )

        if current_role == "participant":
            raise HTTPException(
                status_code=400,
                detail="User has already joined this competition",
            )

        _do_join_competition(
            db,
            competition,
            req.user_id,
            team_id=None,
        )

    req.status = "approved"
    req.updated_at = datetime.utcnow().isoformat()

    db.commit()

    return {"message": "Join request approved"}

@router.post("/competitions/{competition_id}/join-requests/{request_id}/reject")
def reject_join_request(
    competition_id: str,
    request_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Organizer rejects a pending join request."""
    if get_user_role(db, competition_id, current_user.id) != "organizer":
        raise HTTPException(status_code=403, detail="Only the organizer can reject join requests")

    req = db.query(CompetitionJoinRequest).filter(
        CompetitionJoinRequest.id == request_id,
        CompetitionJoinRequest.competition_id == competition_id,
        CompetitionJoinRequest.status == "pending",
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Join request not found")

    req.status = "rejected"
    req.updated_at = datetime.utcnow().isoformat()
    db.commit()
    return {"message": "Join request rejected"}


# ─────────────────────────────────────────────────────────────────────────────
# Joined teams (organizer only) — distinct from list_join_requests, which only
# shows *pending* requests. This shows who has actually joined.
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}/teams")
def list_joined_teams(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from models import UserProfile
    from models_teams import Team, TeamMember

    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    if get_user_role(db, competition_id, current_user.id) != "organizer":
        raise HTTPException(status_code=403, detail="Only the organizer can view joined teams")

    participants = (
        db.query(CompetitionParticipant)
        .filter(CompetitionParticipant.competition_id == competition_id)
        .order_by(CompetitionParticipant.joined_at.asc())
        .all()
    )

    track_by_participant_id = {}
    if _participants_have_track_column(db):
        rows = db.execute(
            text(
                "SELECT id, track_id FROM competition_participants "
                "WHERE competition_id = :cid"
            ),
            {"cid": competition_id},
        ).all()
        track_by_participant_id = {r.id: r.track_id for r in rows}

    task_config = competition_display_dict(competition).get("task_config") or {}
    track_name_by_id = {str(t.get("id")): t.get("name") for t in (task_config.get("tracks") or [])}

    teams_by_key = {}
    solo_entries = []

    for p in participants:
        profile = db.query(UserProfile).filter(UserProfile.user_id == p.user_id).first()
        member = {
            "user_id": p.user_id,
            "username": profile.full_name if profile else p.user_id,
            "email": profile.email if profile else None,
        }
        track_id = track_by_participant_id.get(p.id)
        track_name = track_name_by_id.get(str(track_id)) if track_id else None

        if p.team_id:
            key = str(p.team_id)
            if key not in teams_by_key:
                team = db.query(Team).filter(Team.id == int(p.team_id)).first()
                teams_by_key[key] = {
                    "team_id": p.team_id,
                    "team_name": team.name if team else f"Team #{p.team_id}",
                    "members": [],
                    "joined_at": p.joined_at,
                    "status": p.status,
                    "track_id": track_id,
                    "track_name": track_name,
                }
            teams_by_key[key]["members"].append(member)
        else:
            solo_entries.append({
                "team_id": None,
                "team_name": None,
                "members": [member],
                "joined_at": p.joined_at,
                "status": p.status,
                "track_id": track_id,
                "track_name": track_name,
            })

    teams = list(teams_by_key.values()) + solo_entries

    return {
        "competition_id": competition_id,
        "total_teams": len(teams_by_key),
        "total_solo_participants": len(solo_entries),
        "teams": teams,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Tracks (organizer + participant visible)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}/tracks")
def get_tracks(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    d = competition_display_dict(competition)
    task_config = d.get("task_config") or {}
    tracks = task_config.get("tracks") or []
    counts = _get_track_team_counts(db, competition_id)

    result = []
    for t in tracks:
        tid = str(t.get("id"))
        result.append({
            "id": t.get("id"),
            "name": t.get("name"),
            "min_teams": t.get("minTeams"),
            "team_count": counts.get(tid, 0),
            "active": t.get("active", True),
        })

    return {"tracks_enabled": d.get("tracks_enabled"), "tracks": result}


@router.post("/competitions/{competition_id}/tracks/finalize")
def finalize_tracks(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Organizer action (AMDC Section 5/10): once registration closes, any track
    that hasn't reached its minimum team count is deactivated — it is removed
    from the competition rather than merged with another track. Teams already
    registered to a deactivated track keep their `joined` status but the
    track itself stops accepting new registrations (enforced by
    _validate_track_selection on future join calls).
    """
    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    if get_user_role(db, competition_id, current_user.id) != "organizer":
        raise HTTPException(status_code=403, detail="Only the organizer can finalize tracks")

    d = competition_display_dict(competition)
    task_config = d.get("task_config") or {}
    tracks = task_config.get("tracks") or []
    if not tracks:
        raise HTTPException(status_code=400, detail="This competition has no tracks configured")

    counts = _get_track_team_counts(db, competition_id)

    updated_tracks = []
    for t in tracks:
        tid = str(t.get("id"))
        count = counts.get(tid, 0)
        min_teams = int(t.get("minTeams") or 1)
        t = dict(t)
        t["active"] = count >= min_teams
        t["team_count"] = count
        updated_tracks.append(t)

    task_config["tracks"] = updated_tracks
    # `prompts` never lives in this JSON blob (see build_competition_record),
    # so it's safe to write the whole dict straight back.
    competition.dataset_config = json.dumps(task_config)
    db.commit()

    return {"tracks": updated_tracks}


# ─────────────────────────────────────────────────────────────────────────────
# Monitoring
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}/monitoring")
def get_competition_monitoring(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    competition = (
        db.query(Competition)
        .filter(Competition.id == competition_id, Competition.is_draft == False)
        .first()
    )

    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    role = get_user_role(db, competition_id, current_user.id)

    participants_count = (
        db.query(CompetitionParticipant)
        .filter(CompetitionParticipant.competition_id == competition_id)
        .count()
    )

    team_count = (
        db.query(func.count(func.distinct(CompetitionParticipant.team_id)))
        .filter(
            CompetitionParticipant.competition_id == competition_id,
            CompetitionParticipant.team_id.isnot(None),
        )
        .scalar()
        or 0
    )

    datasets_count = (
        db.query(CompetitionDataset)
        .filter(CompetitionDataset.competition_id == competition_id)
        .count()
    )

    submissions_count = (
        db.query(Submission)
        .filter(Submission.competition_id == competition_id)
        .count()
    )

    done_submissions = (
        db.query(Submission)
        .filter(
            Submission.competition_id == competition_id,
            Submission.status == "done",
            Submission.score.isnot(None),
        )
        .all()
    )

    if done_submissions:
        best_submission = max(done_submissions, key=lambda s: float(s.score or 0))
        best_score = round(float(best_submission.score), 4)
        leaderboard_status = "Leaderboard active"
    else:
        best_score = "Pending"
        leaderboard_status = "Waiting for submissions"

    return {
        "is_organizer": role == "organizer",
        "user_role": role,
        "competition_status": compute_competition_status(competition),
        "participants_count": participants_count,
        "teams_count": team_count if team_count > 0 else participants_count,
        "max_teams": competition.max_teams,
        "datasets_count": datasets_count,
        "data_collection_status": "Configured" if datasets_count else "Not configured",
        "submissions_count": submissions_count,
        "best_score": best_score,
        "primary_metric": competition.primary_metric or "Not selected",
        "leaderboard_status": leaderboard_status,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Get single competition
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}")
def get_competition_details(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    competition = (
        db.query(Competition)
        .filter(Competition.id == competition_id, Competition.is_draft == False)
        .first()
    )

    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    d = competition_display_dict(competition)
    role = get_user_role(db, competition_id, current_user.id)
    d["user_role"] = role
    d["is_organizer"] = role == "organizer"
    d["is_participant"] = role == "participant"
    d["datasets_count"] = db.query(CompetitionDataset).filter(CompetitionDataset.competition_id == competition_id).count()

    # Expose whether this user has a pending manual join request
    pending_req = (
        db.query(CompetitionJoinRequest)
        .filter(
            CompetitionJoinRequest.competition_id == competition_id,
            CompetitionJoinRequest.user_id == current_user.id,
            CompetitionJoinRequest.status == "pending",
        )
        .first()
    )
    d["has_pending_request"] = pending_req is not None

    return d


# ─────────────────────────────────────────────────────────────────────────────
# Update
# ─────────────────────────────────────────────────────────────────────────────

@router.put("/competitions/{competition_id}/update")
def update_competition(
    competition_id: str,
    data: CompetitionCreateIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    validate_competition_payload(data)

    competition = db.query(Competition).filter(Competition.id == competition_id).first()

    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    is_organizer = (
        db.query(CompetitionOrganizer)
        .filter(CompetitionOrganizer.competition_id == competition_id, CompetitionOrganizer.user_id == current_user.id)
        .first()
    )

    if not is_organizer:
        raise HTTPException(status_code=403, detail="Not allowed")

    competition.title = data.competition_name
    competition.task_type = data.task_type
    competition.description = data.description
    competition.start_date = data.start_date
    competition.end_date = data.end_date
    competition.prize_pool = data.prize_pool
    competition.primary_metric = data.primary_metric
    competition.secondary_metric = data.secondary_metric

    competition.max_teams = data.max_teams
    competition.min_members = data.min_members
    competition.max_members = data.max_members
    competition.merge_deadline = data.merge_deadline

    competition.required_skills = json.dumps(data.required_skills or [])
    competition.max_submissions_per_day = data.max_submissions_per_day
    competition.allow_external_data = data.allow_external_data
    competition.allow_pretrained_models = data.allow_pretrained_models
    competition.require_code_sharing = data.require_code_sharing
    competition.additional_rules = data.additional_rules

    competition.complexity_level = data.complexity_level
    competition.milestones_json = json.dumps(data.milestones or [])

    competition.validation_date = data.validation_date
    competition.freeze_date = data.freeze_date
    competition.is_draft = False
    competition.join_method = getattr(data, "join_method", "auto") or "auto"

    # Save updated task config
    task_config = getattr(data, "task_config", None) or {}
    merged = _merge_task_config(data.task_type, task_config)
    config_to_store = _clean_list_values({k: v for k, v in merged.items() if k != "prompts"})
    competition.dataset_config = json.dumps(config_to_store)

    # Re-seed prompts if applicable
    _seed_prompts(db, competition_id, data.task_type or "", task_config)

    db.commit()

    return {"message": "Competition updated successfully"}


# ─────────────────────────────────────────────────────────────────────────────
# Delete
# ─────────────────────────────────────────────────────────────────────────────

@router.delete("/competitions/{competition_id}")
def delete_competition(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    competition = db.query(Competition).filter(Competition.id == competition_id).first()

    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    is_organizer = (
        db.query(CompetitionOrganizer)
        .filter(CompetitionOrganizer.competition_id == competition_id, CompetitionOrganizer.user_id == current_user.id)
        .first()
    )

    if not is_organizer:
        raise HTTPException(status_code=403, detail="Not allowed")

    delete_competition_related_rows(db, competition_id)
    db.flush()

    db.delete(competition)
    db.commit()

    return {"message": "Competition deleted successfully"}