"""
routes/dataset_hub.py — the global Dataset Hub, built on the generic sample structure

    Competition ─ DataComponent[] (asset slots)   ─┐
                ─ CompetitionTask[] (annotation)   ├─ Sample ─ SampleAsset[] + Annotation[]
                                                  ─┘

A dataset is published here only once its competition has CLOSED (end date passed).
Open / upcoming / draft competitions never appear, and asking for one directly is refused.

  GET /datasets/hub                              closed competitions that collected samples (cards)
  GET /datasets/hub/{id}                         one dataset: structure + statistics
  GET /datasets/hub/{id}/samples                 paginated samples with assets (audio URLs) + annotations
  GET /datasets/hub/{id}/export?format=jsonl|csv full export in the sample structure

Only COMPLETE annotation rows are shown/counted. Annotators are anonymous ("Annotator A…").
This file replaces the old /datasets/hub, /datasets/hub/{id}/export and
/datasets/hub/{id}/stats routes that used to live in routes/datasets.py.
"""

import csv
import io
import json
from collections import Counter, defaultdict
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import exists, func, literal_column
from sqlalchemy.orm import Session

from models import Annotation, Competition, Sample, SampleAsset, UserProfile
from supabase_client import supabase
from services.annotation_service import COMPLETE_ROW
from services.sample_service import count_words
from services.structure_service import load_structure
from services.task_registry import ASSET_TYPES, TASK_TYPES
from .utils import get_current_user, get_db

router = APIRouter(tags=["dataset-hub"])

AUDIO_BUCKET = "audio-samples"


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _parse_date(value):
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _is_closed(comp: Competition) -> bool:
    """Same rule as compute_competition_status() in competitions.py: CLOSED = end date passed."""
    end = _parse_date(comp.end_date)
    return (not comp.is_draft) and end is not None and date.today() > end


def _closed_competition_or_error(db: Session, competition_id: str) -> Competition:
    comp = db.query(Competition).filter(Competition.id == competition_id).first()
    if not comp:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if not _is_closed(comp):
        raise HTTPException(status_code=403, detail="This dataset is published when its competition closes.")
    return comp


def _audio_url(path: str):
    try:
        res = supabase.storage.from_(AUDIO_BUCKET).create_signed_url(path, 3600)
    except Exception:
        return None
    if isinstance(res, dict):
        return res.get("signedURL") or res.get("signedUrl") or res.get("signed_url")
    return getattr(res, "signed_url", None) or getattr(res, "signedURL", None)


def _kind(asset_type: str) -> str:
    return ASSET_TYPES.get(asset_type, {}).get("kind", (asset_type or "").lower())


def _structure_payload(structure: dict):
    assets = [{
        "key": a["key"], "name": a["name"], "type": a["type"], "kind": _kind(a["type"]),
        "required": a["required"], "constraints": a["constraints"], "position": a["position"],
    } for a in structure["assets"]]
    tasks = []
    for t in structure["tasks"]:
        spec = TASK_TYPES.get(t["type"], {})
        tasks.append({
            "key": t["key"], "name": t["name"], "type": t["type"],
            "label": spec.get("label", t["type"]), "answer": spec.get("answer", "text"),
            "config": t["config"], "target": t["target"],
            "instructions": t["instructions"], "position": t["position"],
        })
    return assets, tasks


def _short(text: str, n: int = 200) -> str:
    text = (text or "").strip()
    return text if len(text) <= n else text[:n].rstrip() + "…"


# ─────────────────────────────────────────────────────────────────────────────
# GET /datasets/hub — cards for closed competitions
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/datasets/hub")
def list_hub_datasets(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    closed = [c for c in db.query(Competition).filter(Competition.end_date.isnot(None)).all() if _is_closed(c)]
    ids = [c.id for c in closed]
    if not ids:
        return []

    sample_rows = {
        cid: (total, contributors, last)
        for cid, total, contributors, last in db.query(
            Sample.competition_id,
            func.count(Sample.id),
            func.count(func.distinct(Sample.contributor_id)),
            func.max(Sample.submitted_at),
        ).filter(Sample.competition_id.in_(ids)).group_by(Sample.competition_id)
    }

    ann_rows = {
        cid: (annotated, total, annotators)
        for cid, annotated, total, annotators in db.query(
            Sample.competition_id,
            func.count(func.distinct(Annotation.sample_id)),
            func.count(Annotation.id),
            func.count(func.distinct(Annotation.annotator_id)),
        ).join(Annotation, Annotation.sample_id == Sample.id)
        .filter(Sample.competition_id.in_(ids), Annotation.status == COMPLETE_ROW)
        .group_by(Sample.competition_id)
    }

    audio_rows = {
        cid: float(seconds or 0)
        for cid, seconds in db.query(
            Sample.competition_id, func.coalesce(func.sum(SampleAsset.duration_seconds), 0),
        ).join(SampleAsset, SampleAsset.sample_id == Sample.id)
        .filter(Sample.competition_id.in_(ids))
        .group_by(Sample.competition_id)
    }

    result = []
    for comp in closed:
        total, contributors, last = sample_rows.get(comp.id, (0, 0, None))
        if not total:
            continue                                    # nothing was collected → no dataset
        annotated, annotations, annotators = ann_rows.get(comp.id, (0, 0, 0))
        assets, tasks = _structure_payload(load_structure(db, comp.id))
        result.append({
            "id": comp.id,
            "title": f"{comp.title} Dataset",
            "description": _short(comp.description),
            "source_competition_id": comp.id,
            "source_competition_title": comp.title,
            "ended_at": comp.end_date,
            "total_samples": total,
            "contributors": contributors,
            "annotated_samples": annotated,
            "annotations": annotations,
            "annotators": annotators,
            "audio_seconds": audio_rows.get(comp.id, 0.0),
            "last_updated": last,
            "assets": [{k: a[k] for k in ("key", "name", "type", "kind")} for a in assets],
            "tasks": [{k: t[k] for k in ("key", "name", "type", "label")} for t in tasks],
        })

    result.sort(key=lambda d: d["ended_at"] or "", reverse=True)     # most recently closed first
    return result


# ─────────────────────────────────────────────────────────────────────────────
# GET /datasets/hub/{id} — one dataset: structure + statistics
# ─────────────────────────────────────────────────────────────────────────────

def _stats(db: Session, competition_id: str, structure: dict) -> dict:
    asset_by_id = {a["id"]: a for a in structure["assets"]}
    task_by_id = {t["id"]: t for t in structure["tasks"]}
    answer_by_key = {t["key"]: TASK_TYPES.get(t["type"], {}).get("answer", "text") for t in structure["tasks"]}

    total, contributors, first, last = db.query(
        func.count(Sample.id), func.count(func.distinct(Sample.contributor_id)),
        func.min(Sample.submitted_at), func.max(Sample.submitted_at),
    ).filter(Sample.competition_id == competition_id).one()

    # ── assets ──────────────────────────────────────────────────────────────
    acc = {a["key"]: {"count": 0, "words": 0, "max_words": 0, "seconds": 0.0, "max_seconds": 0.0}
           for a in structure["assets"]}
    q = (db.query(SampleAsset.component_id, SampleAsset.text_content, SampleAsset.duration_seconds)
         .join(Sample, Sample.id == SampleAsset.sample_id)
         .filter(Sample.competition_id == competition_id))
    for component_id, text, duration in q.yield_per(1000):
        comp = asset_by_id.get(component_id)
        if not comp:
            continue
        s = acc[comp["key"]]
        s["count"] += 1
        if text:
            w = count_words(text)
            s["words"] += w
            s["max_words"] = max(s["max_words"], w)
        if duration:
            s["seconds"] += float(duration)
            s["max_seconds"] = max(s["max_seconds"], float(duration))

    assets = []
    for a in structure["assets"]:
        s, kind = acc[a["key"]], _kind(a["type"])
        row = {"key": a["key"], "name": a["name"], "type": a["type"], "kind": kind, "count": s["count"]}
        if kind == "text":
            row.update(avg_words=round(s["words"] / s["count"], 1) if s["count"] else None,
                       max_words=s["max_words"], total_words=s["words"])
        elif kind == "audio":
            row.update(total_seconds=round(s["seconds"], 1),
                       avg_seconds=round(s["seconds"] / s["count"], 2) if s["count"] else None,
                       max_seconds=round(s["max_seconds"], 2))
        assets.append(row)

    # ── annotations (COMPLETE rows only) ────────────────────────────────────
    tacc = {t["key"]: {"annotations": 0, "samples": set(), "annotators": set(),
                       "dist": Counter(), "spans": 0, "words": 0} for t in structure["tasks"]}
    annotated, annotators = set(), set()
    q = (db.query(Annotation.task_id, Annotation.sample_id, Annotation.annotator_id, Annotation.value)
         .join(Sample, Sample.id == Annotation.sample_id)
         .filter(Sample.competition_id == competition_id, Annotation.status == COMPLETE_ROW))
    for task_id, sample_id, annotator_id, value in q.yield_per(1000):
        task = task_by_id.get(task_id)
        if not task:
            continue
        s, shape, v = tacc[task["key"]], answer_by_key[task["key"]], (value or {})
        s["annotations"] += 1
        s["samples"].add(sample_id)
        s["annotators"].add(annotator_id)
        annotated.add(sample_id)
        annotators.add(annotator_id)
        if shape == "labels":
            s["dist"].update(v.get("labels", []))
        elif shape == "spans":
            spans = v.get("spans", [])
            s["spans"] += len(spans)
            s["dist"].update(sp.get("label") for sp in spans if sp.get("label"))
        elif shape == "text":
            s["words"] += count_words(v.get("text", ""))
        elif shape == "qa":
            s["words"] += count_words(v.get("answer", ""))

    tasks = []
    for t in structure["tasks"]:
        s, shape = tacc[t["key"]], answer_by_key[t["key"]]
        spec = TASK_TYPES.get(t["type"], {})
        tasks.append({
            "key": t["key"], "name": t["name"], "type": t["type"], "label": spec.get("label", t["type"]),
            "answer": shape, "annotations": s["annotations"], "samples": len(s["samples"]),
            "annotators": len(s["annotators"]),
            "distribution": [{"label": k, "count": n} for k, n in s["dist"].most_common(12)],
            "total_spans": s["spans"] if shape == "spans" else None,
            "avg_words": round(s["words"] / s["annotations"], 1) if shape in ("text", "qa") and s["annotations"] else None,
        })

    # ── contributions per day + top contributors ────────────────────────────
    day = func.substr(Sample.submitted_at, 1, 10)
    per_day = [{"date": d, "count": n} for d, n in
               db.query(day, func.count(Sample.id)).filter(Sample.competition_id == competition_id,
                                                           Sample.submitted_at.isnot(None))
               .group_by(literal_column("1")).order_by(literal_column("1")).all()]   # positional: avoids re-binding substr() params

    top = (db.query(Sample.contributor_id, func.count(Sample.id))
           .filter(Sample.competition_id == competition_id)
           .group_by(Sample.contributor_id).order_by(func.count(Sample.id).desc()).limit(5).all())
    names = {p.user_id: p.full_name for p in
             db.query(UserProfile).filter(UserProfile.user_id.in_([u for u, _ in top if u] or [""]))}
    top_contributors = [{"name": names.get(u) or "Anonymous", "count": n} for u, n in top]

    return {
        "total_samples": total, "contributors": contributors,
        "annotated_samples": len(annotated), "annotators": len(annotators),
        "annotations": sum(t["annotations"] for t in tasks),
        "audio_seconds": round(sum(a.get("total_seconds", 0) or 0 for a in assets), 1),
        "first_submitted": first, "last_submitted": last,
        "assets": assets, "tasks": tasks,
        "samples_per_day": per_day, "top_contributors": top_contributors,
    }


@router.get("/datasets/hub/{competition_id}")
def dataset_detail(competition_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    comp = _closed_competition_or_error(db, competition_id)
    structure = load_structure(db, comp.id)
    assets, tasks = _structure_payload(structure)
    return {
        "id": comp.id,
        "title": f"{comp.title} Dataset",
        "description": comp.description or "",
        "source_competition_id": comp.id,
        "source_competition_title": comp.title,
        "start_date": comp.start_date,
        "ended_at": comp.end_date,
        "assets": assets,
        "tasks": tasks,
        "stats": _stats(db, comp.id, structure),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Samples (shared by the browser and the export)
# ─────────────────────────────────────────────────────────────────────────────

def _build_items(db: Session, structure: dict, samples: list, first_number: int = 1, for_api: bool = True) -> list:
    """
    One dict per sample:
      assets       [{key, name, type, kind, text, duration, audio_url | audio_path}]  (slot order)
      annotations  {task_key: [{annotator: "Annotator A", value: {...}}]}
    """
    if not samples:
        return []
    ids = [s.id for s in samples]
    comp_by_id = {a["id"]: a for a in structure["assets"]}
    task_by_id = {t["id"]: t for t in structure["tasks"]}

    assets_by_sample = defaultdict(list)
    for sa in db.query(SampleAsset).filter(SampleAsset.sample_id.in_(ids)):
        c = comp_by_id.get(sa.component_id)
        if not c:
            continue
        item = {
            "key": c["key"], "name": c["name"], "type": c["type"], "kind": _kind(c["type"]),
            "language": (c["constraints"] or {}).get("language"), "position": c["position"],
            "text": sa.text_content, "duration": sa.duration_seconds,
        }
        if sa.storage_path:
            if for_api:
                item["audio_url"] = _audio_url(sa.storage_path)
            else:
                item["audio_path"] = sa.storage_path
        assets_by_sample[sa.sample_id].append(item)

    rows_by_sample = defaultdict(list)
    for r in (db.query(Annotation)
              .filter(Annotation.sample_id.in_(ids), Annotation.status == COMPLETE_ROW)
              .order_by(Annotation.created_at, Annotation.annotator_id)):
        rows_by_sample[r.sample_id].append(r)

    out = []
    for i, s in enumerate(samples):
        letters: dict = {}
        by_task = defaultdict(list)
        for r in rows_by_sample[s.id]:
            task = task_by_id.get(r.task_id)
            if not task:
                continue
            if r.annotator_id not in letters:
                letters[r.annotator_id] = chr(ord("A") + len(letters) % 26)
            by_task[task["key"]].append({"annotator": f"Annotator {letters[r.annotator_id]}", "value": r.value})
        out.append({
            "id": s.id, "number": first_number + i, "submitted_at": s.submitted_at,
            "assets": sorted(assets_by_sample[s.id], key=lambda a: a["position"]),
            "annotations": dict(by_task),
        })
    return out


@router.get("/datasets/hub/{competition_id}/samples")
def dataset_samples(
    competition_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    annotated: str = Query("all", regex="^(all|yes|no)$"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    comp = _closed_competition_or_error(db, competition_id)
    structure = load_structure(db, comp.id)

    q = db.query(Sample).filter(Sample.competition_id == comp.id)
    has_annotation = exists().where(Annotation.sample_id == Sample.id, Annotation.status == COMPLETE_ROW)
    if annotated == "yes":
        q = q.filter(has_annotation)
    elif annotated == "no":
        q = q.filter(~has_annotation)

    total = q.count()
    offset = (page - 1) * page_size
    rows = q.order_by(Sample.submitted_at, Sample.id).offset(offset).limit(page_size).all()

    return {
        "page": page, "page_size": page_size, "total": total,
        "pages": max(1, -(-total // page_size)),
        "items": _build_items(db, structure, rows, first_number=offset + 1),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Export — sample structure (assets + annotations), JSONL or CSV
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/datasets/hub/{competition_id}/export")
def export_dataset(
    competition_id: str,
    format: str = Query("jsonl", regex="^(jsonl|csv)$"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    comp = _closed_competition_or_error(db, competition_id)
    structure = load_structure(db, comp.id)

    # Everything is read before streaming starts, so the DB session is never used mid-response.
    records, offset, batch = [], 0, 200
    while True:
        samples = (db.query(Sample).filter(Sample.competition_id == comp.id)
                   .order_by(Sample.submitted_at, Sample.id).offset(offset).limit(batch).all())
        if not samples:
            break
        records.extend(_build_items(db, structure, samples, first_number=offset + 1, for_api=False))
        offset += batch

    safe_title = comp.title.replace(" ", "_").replace("/", "-")[:40]
    stamp = datetime.utcnow().strftime("%Y%m%d")

    if format == "jsonl":
        def generate():
            for r in records:
                yield json.dumps({
                    "id": r["id"],
                    "competition_id": comp.id,
                    "submitted_at": r["submitted_at"],
                    "assets": {a["key"]: {k: a.get(k) for k in ("type", "text", "audio_path", "duration") if a.get(k) is not None}
                               for a in r["assets"]},
                    "annotations": r["annotations"],
                }, ensure_ascii=False) + "\n"
        return StreamingResponse(
            generate(), media_type="application/x-ndjson",
            headers={"Content-Disposition": f'attachment; filename="{safe_title}_{stamp}.jsonl"'},
        )

    asset_cols = []
    for a in structure["assets"]:
        asset_cols.append(a["key"])
        if _kind(a["type"]) == "audio":
            asset_cols.append(f"{a['key']}_duration_seconds")
    task_keys = [t["key"] for t in structure["tasks"]]

    def generate_csv():
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["sample_id", "submitted_at", *asset_cols, *task_keys])
        yield buf.getvalue()
        for r in records:
            by_key = {a["key"]: a for a in r["assets"]}
            row = [r["id"], r["submitted_at"] or ""]
            for a in structure["assets"]:
                x = by_key.get(a["key"]) or {}
                row.append(x.get("text") or x.get("audio_path") or "")
                if _kind(a["type"]) == "audio":
                    row.append(x.get("duration") if x.get("duration") is not None else "")
            for k in task_keys:
                entries = r["annotations"].get(k, [])
                row.append(json.dumps([e["value"] for e in entries], ensure_ascii=False) if entries else "")
            buf.seek(0)
            buf.truncate(0)
            w.writerow(row)
            yield buf.getvalue()

    return StreamingResponse(
        generate_csv(), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}_{stamp}.csv"'},
    )