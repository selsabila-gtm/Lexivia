from pydantic import BaseModel, EmailStr
from typing import List, Optional, Dict, Any


class UserCreate(BaseModel):
    full_name: str
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class CompetitionOut(BaseModel):
    id: str
    title: str
    description: str

    is_draft: bool | None = False
    task_type: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    prize_pool: int | None = None

    primary_metric: str | None = None
    secondary_metric: str | None = None

    max_teams: int | None = None
    min_members: int | None = None
    max_members: int | None = None
    merge_deadline: str | None = None
    required_skills: str | None = None
    max_submissions_per_day: int | None = None
    allow_external_data: bool | None = True
    allow_pretrained_models: bool | None = True
    require_code_sharing: bool | None = False
    additional_rules: str | None = None

    complexity_level: int | None = None
    milestones_json: str | None = None
    validation_date: str | None = None
    freeze_date: str | None = None

    join_method: str | None = "auto"

    class Config:
        from_attributes = True


class CompetitionCreateIn(BaseModel):
    competition_name: str
    task_type: str
    description: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    prize_pool: Optional[int] = None

    primary_metric: Optional[str] = None
    secondary_metric: Optional[str] = None

    max_teams: Optional[int] = None
    min_members: Optional[int] = None
    max_members: Optional[int] = None
    merge_deadline: Optional[str] = None
    required_skills: List[str] = []
    max_submissions_per_day: Optional[int] = None
    allow_external_data: bool = True
    allow_pretrained_models: bool = True
    require_code_sharing: bool = False
    additional_rules: Optional[str] = None

    complexity_level: Optional[int] = None
    milestones: List[Dict[str, Any]] = []
    validation_date: Optional[str] = None
    freeze_date: Optional[str] = None
    task_config: Optional[dict] = None
    join_method: str = "auto"  # "auto" | "manual"

    # Independent platform capabilities — a competition can turn on any
    # combination. Their configuration (tracks list, phases list, data
    # collection rules + license, evaluation weighting) lives inside
    # task_config, validated server-side in competitions.py when the
    # matching flag is set.
    tracks_enabled: Optional[bool] = False
    phases_enabled: Optional[bool] = False
    data_collection_enabled: Optional[bool] = False


class CompetitionActionOut(BaseModel):
    message: str
    competition_id: str


class CompetitionJoinRequestOut(BaseModel):
    id: str
    competition_id: str
    user_id: str
    team_id: Optional[str] = None
    message: Optional[str] = None
    status: str
    created_at: Optional[str] = None
    username: Optional[str] = None

    class Config:
        from_attributes = True


class DataSampleIn(BaseModel):
    competition_id: str
    text_content: Optional[str] = None
    annotation: Optional[dict] = None


class DataSampleOut(BaseModel):
    id: str
    competition_id: str
    status: str
    submitted_at: Optional[str]

    class Config:
        from_attributes = True