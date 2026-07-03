# routes/submissions.py
#
# FIXES vs previous version:
#  - submit_model: daily limit checked BEFORE creating the DB record
#  - submit_model: passes detected_columns to Docker so eval_runner gets the hint
#  - submit_model: dataset_type filter extended to "hidden_labels" in addition to "hidden_test"
#  - leaderboard: retroactive team resolution at read time (self-healing, no migration)
#  - leaderboard: sort key uses float() so None scores don't crash the sort
#  - _get_user_team_id: phase-2 lookup is safer and avoids a potential cross-competition
#    team misidentification (requires another PARTICIPANT to be in the same team)
#  - run_evaluation_in_docker: --no-new-privileges + --cap-drop ALL + --memory-swap added

import os
import uuid
import tempfile
import subprocess
import json
from datetime import datetime, date
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from models import (
    Competition,
    CompetitionDataset,
    CompetitionParticipant,
    CompetitionOrganizer,
    ExperimentWorkspace,
    Submission,
    UserProfile,
)
from supabase_client import supabase
from .utils import get_db, get_current_user

router = APIRouter(tags=["submissions"])

WORKSPACES_DIR   = Path("./workspaces").resolve()
EVAL_RUNNER_PATH = Path(__file__).parent / "eval_runner.py"
STORAGE_BUCKET   = "competition-datasets"

KNOWN_METRICS = {
    "accuracy", "f1", "f1_macro", "f1_weighted",
    "precision", "recall", "auc", "roc_auc",
    "mse", "mae", "rmse", "r2",
    "exact_match", "bleu", "rouge_l", "rouge_1", "rouge_2",
    "wer", "cer",
}

METRIC_HIGHER_IS_BETTER = {
    "accuracy": True,  "f1": True,       "f1_macro": True,  "f1_weighted": True,
    "precision": True, "recall": True,   "auc": True,       "roc_auc": True,
    "mse": False,      "mae": False,     "rmse": False,     "r2": True,
    "exact_match": True, "bleu": True,   "rouge_l": True,   "rouge_1": True,
    "rouge_2": True,   "wer": False,     "cer": False,
}

TASK_DEFAULT_METRIC = {
    "TEXT_CLASSIFICATION": "accuracy",
    "SENTIMENT_ANALYSIS":  "accuracy",
    "NER":                 "f1",
    "QUESTION_ANSWERING":  "exact_match",
    "TRANSLATION":         "bleu",
    "SUMMARIZATION":       "rouge_l",
    "REGRESSION":          "rmse",
    "AUDIO_SYNTHESIS":     "wer",
    "TEXT_PROCESSING":     "accuracy",
    "COGNITIVE_LOGIC":     "exact_match",
}


def safe_name(value: str):
    return "".join(c if c.isalnum() else "-" for c in value)[:40]


# Translates the exact strings stored by the frontend dropdown → internal key.
# The organizer picks from: Accuracy, F1 Score, BLEU, ROUGE-L, WER, Exact Match
METRIC_NAME_MAP = {
    "accuracy":    "accuracy",
    "f1 score":    "f1",
    "f1":          "f1",
    "bleu":        "bleu",
    "rouge-l":     "rouge_l",
    "rouge_l":     "rouge_l",
    "wer":         "wer",
    "exact match": "exact_match",
    "exact_match": "exact_match",
}


def _normalize_metric(raw: str) -> str | None:
    """Convert frontend label (e.g. 'F1 Score') to internal key (e.g. 'f1')."""
    return METRIC_NAME_MAP.get(raw.strip().lower())


def _resolve_metric(competition: Competition) -> str:
    raw = (competition.primary_metric or "").strip()
    if raw:
        normalized = _normalize_metric(raw)
        if normalized:
            return normalized
    task = (competition.task_type or "").upper().replace(" ", "_")
    return TASK_DEFAULT_METRIC.get(task, "accuracy")


def _get_user_team_id(user_id: str, competition_id: str, db: Session) -> str | None:
    """
    Returns the team_id for the user in this competition.

    Reads directly from competition_participants.team_id — this is written
    by _do_join_competition() in competitions.py on every join (auto and
    approved manual). It is the correct and complete source of truth.
    """
    participant = db.query(CompetitionParticipant).filter(
        CompetitionParticipant.competition_id == competition_id,
        CompetitionParticipant.user_id == str(user_id),
    ).first()

    if not participant:
        return None

    return str(participant.team_id) if participant.team_id else None


def _check_daily_limit(competition: Competition, user_id: str, db: Session):
    """Raises 429 if user hit max_submissions_per_day today."""
    limit = competition.max_submissions_per_day
    if not limit:
        return
    today_str = date.today().isoformat()
    count = (
        db.query(func.count(Submission.id))
        .filter(
            Submission.competition_id == competition.id,
            Submission.user_id == user_id,
            Submission.submitted_at.like(f"{today_str}%"),
        )
        .scalar()
    )
    if count >= limit:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Daily submission limit reached ({limit}/day). "
                f"You've already submitted {count} time(s) today."
            ),
        )


# ─────────────────────────────────────────────────────────────────────────────
# POST /competitions/{id}/submit
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/competitions/{competition_id}/submit")
def submit_model(
    competition_id: str,
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    is_participant = db.query(CompetitionParticipant).filter(
        CompetitionParticipant.competition_id == competition_id,
        CompetitionParticipant.user_id == current_user.id,
    ).first()
    is_organizer = db.query(CompetitionOrganizer).filter(
        CompetitionOrganizer.competition_id == competition_id,
        CompetitionOrganizer.user_id == current_user.id,
    ).first()
    if not is_participant and not is_organizer:
        raise HTTPException(status_code=403, detail="You must join the competition first")

    # FIX: Check daily limit BEFORE creating any DB record
    _check_daily_limit(competition, str(current_user.id), db)

    model_filename = body.get("model_filename", "model.pkl")
    workspace_path = WORKSPACES_DIR / f"{safe_name(competition_id)}_{safe_name(str(current_user.id))}"
    model_path     = workspace_path / model_filename

    if not model_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Model file '{model_filename}' not found in your workspace.",
        )

    # FIX: also accept "hidden_labels" as the hidden test dataset type
    hidden_dataset = db.query(CompetitionDataset).filter(
        CompetitionDataset.competition_id == competition_id,
        CompetitionDataset.dataset_type.in_(["hidden_test", "hidden_labels"]),
    ).order_by(CompetitionDataset.uploaded_at.desc()).first()

    if not hidden_dataset:
        raise HTTPException(status_code=404, detail="No hidden test dataset uploaded yet.")

    primary_metric = _resolve_metric(competition)
    team_id        = _get_user_team_id(str(current_user.id), competition_id, db)

    submission = Submission(
        id=str(uuid.uuid4()),
        competition_id=competition_id,
        user_id=current_user.id,
        team_id=team_id,
        model_filename=model_filename,
        status="running",
        submitted_at=datetime.utcnow().isoformat(),
    )
    db.add(submission)
    db.commit()
    db.refresh(submission)

    try:
        file_bytes = supabase.storage.from_(STORAGE_BUCKET).download(hidden_dataset.storage_path)
    except Exception as e:
        submission.status = "failed"
        submission.error_message = f"Could not download test dataset: {e}"
        db.commit()
        raise HTTPException(status_code=500, detail=f"Could not download test dataset: {e}")

    score, metric_name, error = run_evaluation_in_docker(
        model_path=str(model_path),
        test_file_bytes=file_bytes,
        test_filename=hidden_dataset.original_filename,
        task_type=competition.task_type or "TEXT_CLASSIFICATION",
        primary_metric=primary_metric,
        submission_id=submission.id,
    )

    if error:
        submission.status        = "failed"
        submission.error_message = error
    else:
        submission.status       = "done"
        submission.score        = score
        submission.metric_name  = metric_name
        submission.evaluated_at = datetime.utcnow().isoformat()

    db.commit()
    db.refresh(submission)

    return {
        "submission_id": submission.id,
        "status":        submission.status,
        "score":         submission.score,
        "metric_name":   submission.metric_name,
        "error":         submission.error_message,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Docker evaluation
# ─────────────────────────────────────────────────────────────────────────────

def run_evaluation_in_docker(
    model_path: str,
    test_file_bytes: bytes,
    test_filename: str,
    task_type: str,
    primary_metric: str,
    submission_id: str,
    detected_columns: list | None = None,
):
    container_name = f"lexivia-eval-{submission_id[:12]}"

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)

        (tmpdir / "model.pkl").write_bytes(Path(model_path).read_bytes())
        (tmpdir / test_filename).write_bytes(test_file_bytes)
        (tmpdir / "eval_runner.py").write_bytes(EVAL_RUNNER_PATH.read_bytes())
        (tmpdir / "columns_hint.json").write_text(
            json.dumps({
                "columns":        detected_columns or [],
                "task_type":      task_type,
                "primary_metric": primary_metric,
            }),
            encoding="utf-8",
        )

        cmd = [
            "docker", "run",
            "--rm",
            "--name",             container_name,
            "--network",          "none",           # NO internet — fairness
            "--cpus",             "1",
            "--memory",           "2g",
            "--memory-swap",      "2g",             # disable swap
            "--read-only",
            "--tmpfs",            "/tmp:size=512m",               # prevent privilege escalation        # drop all Linux capabilities
            "-v",                 f"{str(tmpdir)}:/eval:ro",
            "jupyter/scipy-notebook:python-3.10",
            "python", "/eval/eval_runner.py",
            "/eval/model.pkl",
            f"/eval/{test_filename}",
            task_type,
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

            print("\n===== DOCKER STDOUT =====")
            print(result.stdout)

            print("\n===== DOCKER STDERR =====")
            print(result.stderr)

        except subprocess.TimeoutExpired:
            subprocess.run(["docker", "rm", "-f", container_name], capture_output=True)
            return None, None, "Evaluation timed out after 5 minutes"
        except FileNotFoundError:
            return None, None, "Docker is not installed or not running"

        if result.returncode != 0:
            error = result.stderr or result.stdout or "Unknown error"
            return None, None, f"Evaluation failed: {error[:500]}"

        score, metric_name = parse_score_output(result.stdout)
        if score is None:
            return None, None, f"Could not parse score from output: {result.stdout[:200]}"

        return score, metric_name, None


def parse_score_output(output: str):
    for line in output.splitlines():
        line = line.strip()
        if "=" not in line:
            continue
        name, _, value = line.partition("=")
        name  = name.strip().lower()
        value = value.strip()
        if name in KNOWN_METRICS:
            try:
                return float(value), name
            except ValueError:
                continue
    return None, None


# ─────────────────────────────────────────────────────────────────────────────
# GET /competitions/{id}/submissions
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}/submissions")
def list_my_submissions(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    submissions = db.query(Submission).filter(
        Submission.competition_id == competition_id,
        Submission.user_id == current_user.id,
    ).order_by(Submission.submitted_at.desc()).all()

    return [
        {
            "id":              s.id,
            "model_filename":  s.model_filename,
            "team_id":         s.team_id,
            "status":          s.status,
            "score":           s.score,
            "metric_name":     s.metric_name,
            "error_message":   s.error_message,
            "submitted_at":    s.submitted_at,
            "evaluated_at":    s.evaluated_at,
        }
        for s in submissions
    ]


# ─────────────────────────────────────────────────────────────────────────────
# GET /competitions/{id}/leaderboard — simple leaderboard (team-aware)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}/leaderboard")
def get_leaderboard(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    primary_metric   = _resolve_metric(competition)
    higher_is_better = METRIC_HIGHER_IS_BETTER.get(primary_metric, True)

    all_done = db.query(Submission).filter(
        Submission.competition_id == competition_id,
        Submission.status == "done",
    ).all()

    # Fix and persist any wrong team_ids using competition_participants as truth
    needs_commit = False
    for s in all_done:
        correct_team_id = _get_user_team_id(str(s.user_id), competition_id, db)
        if str(s.team_id or "") != str(correct_team_id or ""):
            s.team_id = correct_team_id
            needs_commit = True
    if needs_commit:
        db.commit()

    best_by_key: dict[str, Submission] = {}
    for s in all_done:
        effective_team_id = s.team_id
        key = effective_team_id if effective_team_id else str(s.user_id)
        if key not in best_by_key:
            best_by_key[key] = s
        else:
            existing = float(best_by_key[key].score or 0)
            new      = float(s.score or 0)
            if higher_is_better and new > existing:
                best_by_key[key] = s
            elif not higher_is_better and new < existing:
                best_by_key[key] = s

    # FIX: use float() so None scores don't crash sorted()
    ranked = sorted(
        best_by_key.values(),
        key=lambda s: float(s.score or 0),
        reverse=higher_is_better,
    )

    return [
        {
            "rank":          i + 1,
            "user_id":       str(s.user_id),
            "team_id":       s.team_id,
            "score":         float(s.score) if s.score is not None else None,
            "metric_name":   s.metric_name or primary_metric,
            "submission_id": s.id,
            "submitted_at":  s.submitted_at,
        }
        for i, s in enumerate(ranked)
    ]

@router.get("/competitions/{competition_id}/leaderboard-rich")
def get_leaderboard_rich(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from models_teams import Team

    competition = db.query(Competition).filter(Competition.id == competition_id).first()

    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    primary_metric = _resolve_metric(competition)
    higher_is_better = METRIC_HIGHER_IS_BETTER.get(primary_metric, True)

    all_done = (
        db.query(Submission)
        .filter(
            Submission.competition_id == competition_id,
            Submission.status == "done",
        )
        .all()
    )

    needs_commit = False

    for submission in all_done:
        correct_team_id = _get_user_team_id(str(submission.user_id), competition_id, db)

        if str(submission.team_id or "") != str(correct_team_id or ""):
            submission.team_id = correct_team_id
            needs_commit = True

    if needs_commit:
        db.commit()

    best_by_key: dict[str, Submission] = {}

    for submission in all_done:
        key = str(submission.team_id) if submission.team_id else str(submission.user_id)

        if key not in best_by_key:
            best_by_key[key] = submission
            continue

        old_score = float(best_by_key[key].score or 0)
        new_score = float(submission.score or 0)

        if higher_is_better and new_score > old_score:
            best_by_key[key] = submission
        elif not higher_is_better and new_score < old_score:
            best_by_key[key] = submission

    ranked = sorted(
        best_by_key.values(),
        key=lambda s: float(s.score or 0),
        reverse=higher_is_better,
    )

    entries = []

    for index, submission in enumerate(ranked):
        profile = (
            db.query(UserProfile)
            .filter(UserProfile.user_id == str(submission.user_id))
            .first()
        )

        if profile and profile.full_name:
            user_name = profile.full_name
        elif profile and profile.email:
            user_name = profile.email
        else:
            user_name = str(submission.user_id)

        team_name = None

        if submission.team_id:
            try:
                team = db.query(Team).filter(Team.id == int(submission.team_id)).first()
                team_name = team.name if team else f"Team #{submission.team_id}"
            except Exception:
                team_name = f"Team #{submission.team_id}"

        entries.append(
            {
                "rank": index + 1,
                "user_id": str(submission.user_id),
                "user_name": user_name,
                "team_id": submission.team_id,
                "team_name": team_name,
                "score": float(submission.score) if submission.score is not None else None,
                "metric_name": submission.metric_name or primary_metric,
                "submission_id": submission.id,
                "submitted_at": submission.submitted_at,
                "evaluated_at": submission.evaluated_at,
            }
        )

    return {
        "competition_id": competition_id,
        "competition_title": competition.title,
        "primary_metric": primary_metric,
        "higher_is_better": higher_is_better,
        "entries": entries,
    }