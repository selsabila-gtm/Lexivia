from sqlalchemy import JSON, Column, String, Integer, Boolean, Text, ForeignKey, Float, Numeric, UniqueConstraint
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

    # Structure of a sample + what is done on it. Competition.task_type is
    # legacy: new competitions leave it NULL (there are no competition types).
    data_components = relationship(
        "DataComponent", cascade="all, delete-orphan",
        order_by="DataComponent.position", foreign_keys="DataComponent.competition_id",
    )
    tasks = relationship(
        "CompetitionTask", cascade="all, delete-orphan",
        order_by="CompetitionTask.position", foreign_keys="CompetitionTask.competition_id",
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


# ─────────────────────────────────────────────────────────────────────────────
# Generic assets + tasks (replaces predefined competition types)
#
#   Competition
#     ├── DataComponent[]     defines an asset slot: type + constraints
#     ├── CompetitionTask[]   what to do, what it targets, JSON config
#     └── Sample[]
#           ├── SampleAsset[] the actual asset for one DataComponent
#           └── Annotation[]  the output of one task for the sample
# ─────────────────────────────────────────────────────────────────────────────

class DataComponent(Base):
    __tablename__ = "data_components"
    __table_args__ = (UniqueConstraint("competition_id", "key", name="uq_data_component_key"),)

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    competition_id = Column(String, ForeignKey("competitions.id", ondelete="CASCADE"), nullable=False, index=True)
    key = Column(String, nullable=False)          # stable slug, e.g. "audio_1"
    name = Column(String, nullable=False)         # display name
    type = Column(String, nullable=False)         # TEXT | AUDIO | ... (see services/task_registry.py)
    required = Column(Boolean, default=True)
    constraints = Column(JSON, default=dict)      # max_words, max_duration_seconds, allowed_formats...
    position = Column(Integer, default=0)


class CompetitionTask(Base):
    __tablename__ = "competition_tasks"
    __table_args__ = (UniqueConstraint("competition_id", "key", name="uq_competition_task_key"),)

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    competition_id = Column(String, ForeignKey("competitions.id", ondelete="CASCADE"), nullable=False, index=True)
    key = Column(String, nullable=False)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)         # TRANSCRIPTION | CLASSIFICATION | NER | ...

    # ASSET -> target_component_id, SAMPLE -> neither, TASK_OUTPUT -> target_task_id
    target_type = Column(String, nullable=False)  # ASSET | SAMPLE | TASK_OUTPUT
    target_component_id = Column(String, ForeignKey("data_components.id"), nullable=True)
    target_task_id = Column(String, ForeignKey("competition_tasks.id"), nullable=True)

    config = Column(JSON, default=dict)           # per-task-type options (labels, max_words...)
    depends_on = Column(JSON, default=list)       # explicit extra dependencies (task keys)
    instructions = Column(Text, nullable=True)
    position = Column(Integer, default=0)         # topological order


class Sample(Base):
    __tablename__ = "samples"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    competition_id = Column(String, ForeignKey("competitions.id", ondelete="CASCADE"), nullable=False, index=True)
    contributor_id = Column(String, ForeignKey("user_profiles.user_id"), nullable=True, index=True)
    status = Column(String, default="pending")
    version_tag = Column(String, nullable=True, index=True)
    meta_data = Column(JSON, default=dict)
    submitted_at = Column(String, default=lambda: datetime.utcnow().isoformat())

    assets = relationship("SampleAsset", cascade="all, delete-orphan", back_populates="sample")
    annotations = relationship("Annotation", cascade="all, delete-orphan", back_populates="sample")


class SampleAsset(Base):
    __tablename__ = "sample_assets"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    sample_id = Column(String, ForeignKey("samples.id", ondelete="CASCADE"), nullable=False, index=True)
    component_id = Column(String, ForeignKey("data_components.id"), nullable=False, index=True)
    text_content = Column(Text, nullable=True)         # TEXT assets
    storage_path = Column(String, nullable=True)       # file-backed assets (AUDIO...)
    duration_seconds = Column(Float, nullable=True)
    meta_data = Column(JSON, default=dict)             # format, source, provenance...

    sample = relationship("Sample", back_populates="assets")


class Annotation(Base):
    __tablename__ = "annotations"
    __table_args__ = (UniqueConstraint("sample_id", "task_id", "annotator_id", name="uq_annotation_once"),)

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    sample_id = Column(String, ForeignKey("samples.id", ondelete="CASCADE"), nullable=False, index=True)
    task_id = Column(String, ForeignKey("competition_tasks.id"), nullable=False, index=True)
    annotator_id = Column(String, ForeignKey("user_profiles.user_id"), nullable=True)
    value = Column(JSON, nullable=True)                # shape depends on the task type's `produces`
    status = Column(String, default="submitted")
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())

    sample = relationship("Sample", back_populates="annotations")