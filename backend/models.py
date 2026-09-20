from sqlalchemy import JSON, Column, String, Integer, Boolean, Text, ForeignKey, Float, Numeric
from sqlalchemy.orm import relationship
from database import Base
from datetime import datetime
import uuid


class UserProfile(Base):
    __tablename__ = "user_profiles"

    user_id = Column(String, primary_key=True)
    full_name = Column(String)
    email = Column(String, nullable=True)


class Competition(Base):
    __tablename__ = "competitions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String, nullable=False)
    description = Column(String, nullable=False)

    is_draft = Column(Boolean, default=False)
    task_type = Column(String, nullable=True)
    start_date = Column(String, nullable=True)
    end_date = Column(String, nullable=True)
    prize_pool = Column(Integer, nullable=True)

    primary_metric = Column(String, nullable=True)
    secondary_metric = Column(String, nullable=True)

    max_teams = Column(Integer, nullable=True)
    min_members = Column(Integer, nullable=True)
    max_members = Column(Integer, nullable=True)
    merge_deadline = Column(String, nullable=True)
    required_skills = Column(Text, nullable=True)
    max_submissions_per_day = Column(Integer, nullable=True)
    allow_external_data = Column(Boolean, default=True)
    allow_pretrained_models = Column(Boolean, default=True)
    require_code_sharing = Column(Boolean, default=False)
    additional_rules = Column(Text, nullable=True)

    complexity_level = Column(Integer, nullable=True)
    milestones_json = Column(Text, nullable=True)
    validation_date = Column(String, nullable=True)
    freeze_date = Column(String, nullable=True)

    dataset_config = Column(Text, nullable=True, default="{}")

    # "auto" = automatic acceptance (after validation); "manual" = organizer approves each request
    join_method = Column(String, nullable=False, default="auto")

    datasets = relationship(
        "CompetitionDataset",
        back_populates="competition",
        cascade="all, delete-orphan",
    )


class CompetitionOrganizer(Base):
    __tablename__ = "competition_organizers"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    competition_id = Column(String, nullable=False)
    user_id = Column(String, nullable=False)
    role = Column(String, default="owner")
    created_at = Column(String, nullable=True)


class CompetitionParticipant(Base):
    __tablename__ = "competition_participants"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    competition_id = Column(String, nullable=False)
    user_id = Column(String, nullable=False)
    team_id = Column(String, nullable=True)
    status = Column(String, default="joined")
    joined_at = Column(String, nullable=True)


class CompetitionJoinRequest(Base):
    """Pending join requests when competition.join_method == 'manual'."""
    __tablename__ = "competition_join_requests"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    competition_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=False, index=True)
    team_id = Column(String, nullable=True)
    message = Column(Text, nullable=True)
    status = Column(String, default="pending")
    created_at = Column(String, nullable=True)
    updated_at = Column(String, nullable=True)


class CompetitionPrompt(Base):
    __tablename__ = "competition_prompts"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    competition_id = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    difficulty = Column(String, nullable=True)
    domain = Column(String, nullable=True)
    used_count = Column(Integer, default=0)
    created_at = Column(String, nullable=True)




class DataSample(Base):
    __tablename__ = "data_samples"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    competition_id = Column(String, nullable=False, index=True)
    contributor_id = Column(String, nullable=False, index=True)

    status = Column(String, default="pending")

    text_content = Column(Text, nullable=True)

    audio_url = Column(String, nullable=True)
    audio_duration = Column(Float, nullable=True)  # DB column is `double precision`, not text

    flags = Column(JSON, default=list)
    meta_data = Column(JSON, default=dict)

    submitted_at = Column(String, nullable=True)
    version_tag = Column(String, nullable=True, index=True)

    score_breakdown = Column(JSON, default=list)
    approval_count = Column(Integer, default=0)
    approvals_json = Column(JSON, default=list)
    task_type = Column(String, nullable=True)

    annotation = Column(JSON, nullable=True)

    quality_score = Column(Float, nullable=True)  # DB column is `double precision`, not text










class CompetitionDataset(Base):
    __tablename__ = "competition_datasets"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    competition_id = Column(String, ForeignKey("competitions.id"), nullable=False)
    uploaded_by = Column(String, ForeignKey("user_profiles.user_id"), nullable=False)
    dataset_type = Column(String, default="hidden_test")
    original_filename = Column(String, nullable=False)
    storage_path = Column(String, nullable=False)
    file_size_bytes = Column(Integer, default=0)
    description = Column(Text, default="")
    uploaded_at = Column(String, default=lambda: datetime.utcnow().isoformat())

    competition = relationship("Competition", back_populates="datasets")
    uploader = relationship("UserProfile", foreign_keys=[uploaded_by])


class ExperimentWorkspace(Base):
    __tablename__ = "experiment_workspaces"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    competition_id = Column(String, ForeignKey("competitions.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("user_profiles.user_id"), nullable=False, index=True)

    name = Column(String, nullable=False, default="Notebook Workspace")
    status = Column(String, default="stopped")
    container_id = Column(String, nullable=True)
    docker_image = Column(String, default="lexivia/notebook-gpu:latest")
    resource_tier = Column(String, default="GPU Basic")

    cpu_limit = Column(String, default="2 cores")
    ram_limit = Column(String, default="8 GB")
    gpu_limit = Column(String, default="1 shared GPU")
    storage_limit = Column(String, default="20 GB")

    notebook_url = Column(String, nullable=True)
    last_started_at = Column(String, nullable=True)
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())


class ExperimentRun(Base):
    __tablename__ = "experiment_runs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    workspace_id = Column(String, ForeignKey("experiment_workspaces.id"), nullable=False, index=True)
    competition_id = Column(String, ForeignKey("competitions.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("user_profiles.user_id"), nullable=False, index=True)

    name = Column(String, nullable=False)
    notes = Column(Text, default="")

    # Saved automatically when Save Model evaluates model.pkl on test.csv.
    # Can be NULL before evaluation or if saving without scoring.
    metric_name = Column(String, nullable=True)
    metric_value = Column(String, nullable=True)

    # Stores dataset version, dataset files, hyperparameters, resource tier,
    # active file, and model filename as JSON text.
    parameters_json = Column(Text, default="{}")

    # Usually model.pkl
    artifact_path = Column(String, nullable=True)

    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())

class Submission(Base):
    __tablename__ = "submissions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    competition_id = Column(String, ForeignKey("competitions.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("user_profiles.user_id"), nullable=False, index=True)

    # Team the submitter belongs to (nullable for solo participants)
    team_id = Column(String, nullable=True)

    # The .pkl (or other) filename evaluated against the hidden test set
    model_filename = Column(String, nullable=True)

    file_name = Column(String, nullable=True)
    file_path = Column(String, nullable=True)
    storage_path = Column(String, nullable=True)

    score = Column(Numeric, nullable=True)  # DB column is `numeric`, not text — sort/compare safely
    metric_name = Column(String, nullable=True)
    metric_value = Column(String, nullable=True)

    # Human-readable error when status == "failed"
    error_message = Column(Text, nullable=True)

    status = Column(String, default="pending")
    submitted_at = Column(String, default=lambda: datetime.utcnow().isoformat())
    evaluated_at = Column(String, nullable=True)
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())