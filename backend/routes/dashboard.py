from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from models import (
    Competition,
    CompetitionOrganizer,
    CompetitionParticipant,
)
from models_teams import TeamMember
from .utils import get_db, get_icon_for_task

router = APIRouter(tags=["dashboard"])


def parse_date(value):
    """
    Safely parse a date value from the DB.

    Supports:
    - None
    - date
    - datetime
    - "YYYY-MM-DD"
    - ISO datetime strings
    """
    if not value:
        return None

    try:
        if isinstance(value, date) and not isinstance(value, datetime):
            return value

        if isinstance(value, datetime):
            return value.date()

        if isinstance(value, str):
            value = value.strip()

            # Normal date format: "2026-07-03"
            try:
                return datetime.strptime(value, "%Y-%m-%d").date()
            except Exception:
                pass

            # ISO datetime format: "2026-07-03T20:00:00"
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
            except Exception:
                pass

        return None
    except Exception:
        return None


def to_naive_datetime(value):
    """
    Convert DB datetime/string values into timezone-naive datetime.
    This keeps your old behavior but makes it safer.
    """
    if not value:
        return None

    try:
        if isinstance(value, datetime):
            return value.replace(tzinfo=None)

        if isinstance(value, date):
            return datetime.combine(value, datetime.min.time())

        if isinstance(value, str):
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return dt.replace(tzinfo=None)

        return None
    except Exception:
        return None


def compute_status(comp: Competition):
    # IMPORTANT:
    # competitions.status was deleted from the DB, so never use comp.status here.
    if comp.is_draft:
        return "DRAFT"

    today = date.today()
    start = parse_date(comp.start_date)
    end = parse_date(comp.end_date)

    if start and today < start:
        return "UPCOMING"

    if start and end and start <= today <= end:
        return "OPEN"

    if end and today > end:
        return "CLOSED"

    return "OPEN"


def competition_type(comp: Competition):
    # IMPORTANT:
    # competitions.category was deleted from the DB, so use task_type only.
    return (comp.task_type or "GENERAL").upper()


def time_ago(value):
    """
    Human-friendly relative time.

    Examples:
    - Just now
    - 5 minutes ago
    - 3 hours ago
    - 22 days ago
    - 2 months ago
    - 1 year ago
    """
    if not value:
        return "Recently"

    try:
        dt = to_naive_datetime(value)

        if not dt:
            return "Recently"

        now = datetime.utcnow()
        diff = now - dt

        # If the date is accidentally in the future, avoid negative values.
        if diff.total_seconds() < 0:
            return "Just now"

        days = diff.days

        if days >= 365:
            years = max(1, round(days / 365))
            return f"{years} year{'s' if years > 1 else ''} ago"

        if days >= 30:
            months = max(1, round(days / 30))
            return f"{months} month{'s' if months > 1 else ''} ago"

        if days > 0:
            return f"{days} day{'s' if days > 1 else ''} ago"

        hours = diff.seconds // 3600
        if hours > 0:
            return f"{hours} hour{'s' if hours > 1 else ''} ago"

        minutes = diff.seconds // 60
        if minutes > 0:
            return f"{minutes} minute{'s' if minutes > 1 else ''} ago"

        return "Just now"
    except Exception:
        return "Recently"


@router.get("/dashboard/stats/{user_id}")
def get_dashboard_stats(user_id: str, db: Session = Depends(get_db)):
    organized_competitions = (
        db.query(CompetitionOrganizer.competition_id)
        .join(Competition, CompetitionOrganizer.competition_id == Competition.id)
        .filter(
            CompetitionOrganizer.user_id == user_id,
            Competition.is_draft == False,
        )
        .distinct()
        .count()
    )

    joined_competitions = (
        db.query(CompetitionParticipant.competition_id)
        .join(Competition, CompetitionParticipant.competition_id == Competition.id)
        .filter(
            CompetitionParticipant.user_id == user_id,
            Competition.is_draft == False,
        )
        .distinct()
        .count()
    )

    teams_joined = (
        db.query(TeamMember.team_id)
        .filter(TeamMember.user_id == user_id)
        .distinct()
        .count()
    )

    return {
        "user_id": user_id,
        "organized_competitions": organized_competitions,
        "joined_competitions": joined_competitions,
        "teams_joined": teams_joined,
    }


@router.get("/dashboard/recent/{user_id}")
def get_recent_competitions(user_id: str, db: Session = Depends(get_db)):
    organized = (
        db.query(Competition, CompetitionOrganizer.created_at)
        .join(CompetitionOrganizer, CompetitionOrganizer.competition_id == Competition.id)
        .filter(
            CompetitionOrganizer.user_id == user_id,
            Competition.is_draft == False,
        )
        .all()
    )

    joined = (
        db.query(Competition, CompetitionParticipant.joined_at)
        .join(CompetitionParticipant, CompetitionParticipant.competition_id == Competition.id)
        .filter(
            CompetitionParticipant.user_id == user_id,
            Competition.is_draft == False,
        )
        .all()
    )

    rows = []

    for comp, action_time in organized:
        parsed_action_time = to_naive_datetime(action_time)

        rows.append({
            "id": f"organized-{comp.id}",
            "competition_id": comp.id,
            "title": comp.title,
            "type": competition_type(comp),
            "status": compute_status(comp),
            "score": "--",
            "sync": time_ago(action_time),
            "icon": get_icon_for_task(comp.task_type),
            "role": "ORGANIZER",
            "action_time": parsed_action_time.isoformat() if parsed_action_time else str(action_time or ""),
        })

    for comp, action_time in joined:
        parsed_action_time = to_naive_datetime(action_time)

        rows.append({
            "id": f"joined-{comp.id}",
            "competition_id": comp.id,
            "title": comp.title,
            "type": competition_type(comp),
            "status": compute_status(comp),
            "score": "--",
            "sync": time_ago(action_time),
            "icon": get_icon_for_task(comp.task_type),
            "role": "PARTICIPANT",
            "action_time": parsed_action_time.isoformat() if parsed_action_time else str(action_time or ""),
        })

    rows.sort(key=lambda x: x["action_time"], reverse=True)

    return rows[:10]