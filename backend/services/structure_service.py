"""
services/structure_service.py

Persists the validated assets + tasks of a competition into data_components /
competition_tasks, and loads them back in the API shape the wizard uses.

Sync is an UPSERT by `key`, not delete-and-recreate, so ids stay stable and
existing samples / annotations keep pointing at the right rows. Once a
competition has collected data, you cannot remove an asset or task that holds
data, nor change its type.
"""

import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models import (
    Annotation, CompetitionTask, DataComponent, SampleAsset,
)
from .task_registry import StructureError, normalize_task, validate_structure


def validate_or_400(assets: list, tasks: list):
    try:
        return validate_structure(assets or [], tasks or [])
    except StructureError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def sync_structure(db: Session, competition_id: str, clean_assets: list[dict], clean_tasks: list[dict]):
    comps = {c.key: c for c in db.query(DataComponent).filter(DataComponent.competition_id == competition_id)}
    tasks = {t.key: t for t in db.query(CompetitionTask).filter(CompetitionTask.competition_id == competition_id)}

    new_asset_keys = {a["key"] for a in clean_assets}
    new_task_keys = {t["key"] for t in clean_tasks}

    # ── guard: never orphan collected data ──────────────────────────────────
    for key, c in comps.items():
        has_data = db.query(SampleAsset.id).filter(SampleAsset.component_id == c.id).first() is not None
        if not has_data:
            continue
        if key not in new_asset_keys:
            raise HTTPException(400, f"Asset '{c.name}' already has collected data and cannot be removed")
        new = next(a for a in clean_assets if a["key"] == key)
        if new["type"] != c.type:
            raise HTTPException(400, f"Asset '{c.name}' already has collected data; its type cannot change")
    for key, t in tasks.items():
        has_data = db.query(Annotation.id).filter(Annotation.task_id == t.id).first() is not None
        if not has_data:
            continue
        if key not in new_task_keys:
            raise HTTPException(400, f"Task '{t.name}' already has annotations and cannot be removed")
        new = next(x for x in clean_tasks if x["key"] == key)
        if new["type"] != t.type:
            raise HTTPException(400, f"Task '{t.name}' already has annotations; its type cannot change")

    # ── assets ──────────────────────────────────────────────────────────────
    # Ids are assigned up front so tasks can reference them in the same pass.
    for a in clean_assets:
        row = comps.get(a["key"])
        if row is None:
            row = DataComponent(id=str(uuid.uuid4()), competition_id=competition_id, key=a["key"])
        row.name, row.type, row.required = a["name"], a["type"], a["required"]
        row.constraints, row.position = a["constraints"], a["position"]
        db.add(row)
        comps[a["key"]] = row
    db.flush()

    # ── tasks ───────────────────────────────────────────────────────────────
    # clean_tasks is in dependency order, so a task that targets another task's
    # output always comes after it. Each row is written COMPLETE (type + target
    # together) and flushed before the next, because the DB enforces
    # ck_task_target_shape on every INSERT/UPDATE.
    for t in clean_tasks:
        row = tasks.get(t["key"])
        if row is None:
            row = CompetitionTask(id=str(uuid.uuid4()), competition_id=competition_id, key=t["key"])
        row.name, row.type, row.config = t["name"], t["type"], t["config"]
        row.depends_on, row.instructions, row.position = t["depends_on"], t["instructions"], t["position"]

        tgt = t["target"]
        row.target_type = tgt["type"]
        row.target_component_id = comps[tgt["ref"]].id if tgt["type"] == "ASSET" else None
        row.target_task_id = tasks[tgt["ref"]].id if tgt["type"] == "TASK_OUTPUT" else None

        db.add(row)
        db.flush()
        tasks[t["key"]] = row

    # ── removals (safe now: nothing references them) ────────────────────────
    for key, row in list(tasks.items()):
        if key not in new_task_keys:
            db.delete(row)
    db.flush()
    for key, row in list(comps.items()):
        if key not in new_asset_keys:
            db.delete(row)
    db.flush()


def load_structure(db: Session, competition_id: str) -> dict:
    """Assets + tasks in the same shape the wizard submits (targets by key)."""
    comps = (db.query(DataComponent).filter(DataComponent.competition_id == competition_id)
             .order_by(DataComponent.position).all())
    tasks = (db.query(CompetitionTask).filter(CompetitionTask.competition_id == competition_id)
             .order_by(CompetitionTask.position).all())
    comp_key = {c.id: c.key for c in comps}
    task_key = {t.id: t.key for t in tasks}

    def target(t):
        if t.target_type == "ASSET":
            return {"type": "ASSET", "ref": comp_key.get(t.target_component_id)}
        if t.target_type == "TASK_OUTPUT":
            return {"type": "TASK_OUTPUT", "ref": task_key.get(t.target_task_id)}
        return {"type": "SAMPLE", "ref": None}

    return {
        "assets": [{"id": c.id, "key": c.key, "name": c.name, "type": c.type,
                    "required": bool(c.required), "constraints": c.constraints or {},
                    "position": c.position} for c in comps],
        "tasks": [normalize_task({"id": t.id, "key": t.key, "name": t.name, "type": t.type,
                                  "target": target(t), "config": t.config or {},
                                  "depends_on": t.depends_on or [], "instructions": t.instructions,
                                  "position": t.position}) for t in tasks],
    }