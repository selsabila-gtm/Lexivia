"""
services/annotation_service.py

Rules of the annotation workflow, with no DB or HTTP in here (so they can be
tested directly):

  * how many annotators a sample needs  → organizer's setting, read from the
                                          competition config (never hard-coded)
  * validating one annotator's answers  → driven by the task type's `answer` shape
  * agreement between annotators        → per task, by answer shape
  * sample status                       → derived from the annotations, never stored
  * which tasks an annotator must fill, and which sample to hand out next

Vocabulary
  R               required annotators per sample (organizer's value)
  contributors(T) distinct annotators with a COMPLETE answer for task T
  task status     INCOMPLETE  fewer than R contributors
                  CONFLICT    ≥ R contributors but a tie → exactly ONE extra annotator is needed
                  SATISFIED   ≥ R contributors and a clear result
  sample status   NOT_STARTED | PARTIAL | COMPLETED | CONFLICT | CONFLICT_RESOLUTION

The extra conflict-resolution annotator is *additional*: R itself never changes.
"""

import json
from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Optional

from .sample_service import count_words
from .task_registry import TASK_TYPES

LEASE_MINUTES = 30                       # how long a handed-out sample is reserved

# annotator-level statuses (SampleAssignment.status)
ASSIGNED, PARTIAL, COMPLETED, SKIPPED = "ASSIGNED", "PARTIAL", "COMPLETED", "SKIPPED"
SUBMITTED = (PARTIAL, COMPLETED)
# annotation row statuses
COMPLETE_ROW, PARTIAL_ROW = "COMPLETE", "PARTIAL"
# sample statuses
NOT_STARTED, S_PARTIAL, S_COMPLETED, CONFLICT, CONFLICT_RESOLUTION = (
    "NOT_STARTED", "PARTIAL", "COMPLETED", "CONFLICT", "CONFLICT_RESOLUTION",
)
REGULAR, RESOLUTION = "REGULAR", "CONFLICT_RESOLUTION"


# ─────────────────────────────────────────────────────────────────────────────
# Organizer settings
# ─────────────────────────────────────────────────────────────────────────────

def read_settings(dataset_config: Any) -> dict:
    """
    {"required_annotators": int | None, "adjudication": bool}

    Both come from the Data Collection settings chosen at Competition Creation
    (data_collection.annotators_per_instance / .adjudication_enabled).
    required_annotators is None when the organizer never set it — callers must
    say so instead of guessing a number.
    """
    try:
        cfg = json.loads(dataset_config) if isinstance(dataset_config, str) else (dataset_config or {})
    except (TypeError, json.JSONDecodeError):
        cfg = {}
    dc = (cfg or {}).get("data_collection") or {}
    try:
        n = int(dc.get("annotators_per_instance"))
    except (TypeError, ValueError):
        n = None
    return {
        "required_annotators": n if n and n >= 1 else None,
        "adjudication": dc.get("adjudication_enabled", True) is not False,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Validating one annotator's answer for one task
# ─────────────────────────────────────────────────────────────────────────────

class ValueError_(Exception):
    """An answer that cannot be stored (message is user-facing)."""


def _num(v, what):
    try:
        if isinstance(v, bool):
            raise TypeError
        return float(v)
    except (TypeError, ValueError):
        raise ValueError_(f"{what} must be a number")


def normalize_value(task_type: str, config: dict, raw: Any, ctx: dict) -> tuple[Optional[dict], bool]:
    """
    Returns (clean_value | None, complete).
      None        → nothing was answered; store nothing (field stays incomplete)
      (value, False) → something was saved but the field is not finished
      (value, True)  → complete
    Raises ValueError_ for answers that are wrong (not merely missing).

    ctx: {"target_kind": "text"|"audio"|"sample", "target_text": str|None,
          "target_duration": float|None}
    """
    spec = TASK_TYPES[task_type]
    shape = spec["answer"]
    raw = raw if isinstance(raw, dict) else {}
    config = config or {}

    if shape == "labels":
        labels = raw.get("labels")
        labels = [str(x) for x in labels] if isinstance(labels, list) else []
        labels = list(dict.fromkeys(labels))
        if not labels:
            return None, False
        allowed = config.get("labels") or []
        bad = [x for x in labels if x not in allowed]
        if bad:
            raise ValueError_(f"Unknown label: {', '.join(bad)}")
        multi = bool(config.get("multi_label"))
        if not multi and len(labels) > 1:
            raise ValueError_("Select only one label")
        if multi:
            lo, hi = config.get("min_labels"), config.get("max_labels")
            if hi is not None and len(labels) > hi:
                raise ValueError_(f"Select at most {hi} labels")
            if lo is not None and len(labels) < lo:
                raise ValueError_(f"Select at least {lo} labels")
        return {"labels": labels}, True

    if shape == "spans":
        spans_in = raw.get("spans")
        spans_in = spans_in if isinstance(spans_in, list) else []
        if not spans_in:
            return ({"spans": [], "none": True}, True) if raw.get("none") else (None, False)
        allowed = config.get("span_labels") or []
        audio = ctx.get("target_kind") == "audio"
        out = []
        for s in spans_in:
            if not isinstance(s, dict) or str(s.get("label")) not in allowed:
                raise ValueError_("Every span needs one of the configured labels")
            label = str(s["label"])
            if audio:
                a, b = _num(s.get("start_time"), "Span start"), _num(s.get("end_time"), "Span end")
                dur = ctx.get("target_duration")
                if a < 0 or b <= a or (dur is not None and b > dur + 0.05):
                    raise ValueError_("A span is outside the audio or has no length")
                out.append({"start_time": round(a, 2), "end_time": round(b, 2), "label": label})
            else:
                a, b = int(_num(s.get("start"), "Span start")), int(_num(s.get("end"), "Span end"))
                text = ctx.get("target_text")
                if a < 0 or b <= a or (text is not None and b > len(text)):
                    raise ValueError_("A span is outside the text or has no length")
                item = {"start": a, "end": b, "label": label}
                if text is not None:
                    item["text"] = text[a:b]
                out.append(item)
        k1, k2 = ("start_time", "end_time") if audio else ("start", "end")
        out.sort(key=lambda x: (x[k1], x[k2]))
        if not config.get("allow_overlap"):
            for prev, cur in zip(out, out[1:]):
                if cur[k1] < prev[k2]:
                    raise ValueError_("Spans cannot overlap")
        return {"spans": out, "none": False}, True

    if shape == "text":
        text = str(raw.get("text") or "").strip()
        if not text:
            return None, False
        words, hi, lo = count_words(text), config.get("max_words"), config.get("min_words")
        if hi is not None and words > hi:
            raise ValueError_(f"{words} words; the maximum is {hi}")
        if lo is not None and words < lo:
            raise ValueError_(f"{words} words; the minimum is {lo}")
        return {"text": text}, True

    if shape == "qa":
        q, a = str(raw.get("question") or "").strip(), str(raw.get("answer") or "").strip()
        if not q and not a:
            return None, False
        hi = config.get("max_words")
        if hi is not None and count_words(a) > hi:
            raise ValueError_(f"The answer has {count_words(a)} words; the maximum is {hi}")
        return {"question": q, "answer": a}, bool(q and a)

    raise ValueError_(f"Unsupported answer type '{shape}'")


# ─────────────────────────────────────────────────────────────────────────────
# Agreement
# ─────────────────────────────────────────────────────────────────────────────

def agreement(task_type: str, config: dict) -> tuple[str, Any]:
    """
    (method, extract):
      "vote"  one choice each (single label)  — conflict = tie for first place
      "set"   a set each (multi-label, spans) — conflict = an item picked by
                                                exactly half of the annotators
      "none"  free text — answers are collected, there is nothing to tie on
    """
    shape = TASK_TYPES[task_type]["answer"]
    if shape == "labels":
        if (config or {}).get("multi_label"):
            return "set", lambda v: set(v["labels"])
        return "vote", lambda v: v["labels"][0]
    if shape == "spans":
        def items(v):
            out = set()
            for s in v.get("spans", []):
                if "start_time" in s:
                    out.add((round(s["start_time"], 1), round(s["end_time"], 1), s["label"]))
                else:
                    out.add((s["start"], s["end"], s["label"]))
            return out
        return "set", items
    return "none", None


def _is_tie(method: str, extract, values: list) -> bool:
    if method == "vote":
        top = Counter(extract(v) for v in values).most_common(2)
        return len(top) == 2 and top[0][1] == top[1][1]
    if method == "set":
        k = len(values)
        counts = Counter(i for v in values for i in extract(v))
        return any(2 * n == k for n in counts.values())
    return False


def task_state(task: dict, required: int, entries: list[dict]) -> dict:
    """
    entries: COMPLETE answers for this task, oldest first:
             [{"annotator_id", "value"}]
    """
    method, extract = agreement(task["type"], task.get("config") or {})
    values = [e["value"] for e in entries]
    k = len(values)
    # was there ever a tie once the required number had answered?
    ever_tied = any(_is_tie(method, extract, values[:j]) for j in range(max(required, 1), k + 1))
    if k < required:
        status, more = "INCOMPLETE", required - k
    elif _is_tie(method, extract, values):
        status, more = "CONFLICT", 1
    else:
        status, more = "SATISFIED", 0
    return {"status": status, "count": k, "needed_more": more, "ever_tied": ever_tied,
            "annotators": [e["annotator_id"] for e in entries]}


# ─────────────────────────────────────────────────────────────────────────────
# Sample state
# ─────────────────────────────────────────────────────────────────────────────

def _active(a: dict, now: datetime) -> bool:
    exp = a.get("expires_at")
    return a["status"] == ASSIGNED and (not exp or datetime.fromisoformat(exp) > now)


def evaluate_sample(tasks: list[dict], rows: list[dict], assignments: list[dict],
                    required: int, now: datetime) -> dict:
    """
    rows:        this sample's annotation rows
                 [{"task_key","annotator_id","value","status","created_at"}]
    assignments: this sample's SampleAssignment rows as dicts
    """
    by_task: dict[str, list] = {t["key"]: [] for t in tasks}
    for r in sorted(rows, key=lambda r: (r["created_at"] or "", r["annotator_id"])):
        if r["status"] == COMPLETE_ROW and r["task_key"] in by_task:
            by_task[r["task_key"]].append(r)

    states = {t["key"]: task_state(t, required, by_task[t["key"]]) for t in tasks}
    conflicted = [k for k, s in states.items() if s["status"] == "CONFLICT"]
    reservations = [a for a in assignments if _active(a, now)]
    resolver_active = any(a["role"] == RESOLUTION for a in reservations)
    touched = bool(rows) or any(a["status"] in SUBMITTED for a in assignments)

    if conflicted:
        status = CONFLICT_RESOLUTION if resolver_active else CONFLICT
    elif all(s["status"] == "SATISFIED" for s in states.values()):
        status = S_COMPLETED
    elif touched:
        status = S_PARTIAL
    else:
        status = NOT_STARTED

    return {
        "status": status,
        "tasks": states,
        "conflicted": conflicted,
        "ever_conflict": any(s["ever_tied"] for s in states.values()),
        "reservations": reservations,
    }


def open_tasks_for(tasks: list[dict], ev: dict, annotator_id: str, adjudication: bool) -> tuple[list[str], str]:
    """
    The tasks this annotator should fill on this sample, and the assignment role.
    Empty list = the sample has nothing for this annotator.

    A task is open when it still needs answers (fewer than R, or a tie that needs
    one more) and this annotator hasn't answered it. Tasks that feed an open
    task (its target / "must wait for") are pulled in too, so a dependent task
    always has the annotator's own output to work on.
    """
    by_key = {t["key"]: t for t in tasks}
    open_keys = set()
    for t in tasks:
        st = ev["tasks"][t["key"]]
        needs = st["status"] == "INCOMPLETE" or (st["status"] == "CONFLICT" and adjudication)
        if needs and annotator_id not in st["annotators"]:
            open_keys.add(t["key"])
    if not open_keys:
        return [], REGULAR

    role = RESOLUTION if any(ev["tasks"][k]["status"] == "CONFLICT" for k in open_keys) else REGULAR

    stack = list(open_keys)
    while stack:
        t = by_key[stack.pop()]
        deps = list(t.get("depends_on") or [])
        if t["target"]["type"] == "TASK_OUTPUT" and t["target"].get("ref"):
            deps.append(t["target"]["ref"])
        for d in deps:
            if d in by_key and d not in open_keys:
                open_keys.add(d)
                stack.append(d)

    ordered = [t["key"] for t in sorted(tasks, key=lambda t: t["position"]) if t["key"] in open_keys]
    return ordered, role


def capacity_left(tasks: list[dict], ev: dict, task_keys: list[str], annotator_id: str, now: datetime) -> bool:
    """
    False when other annotators already hold enough live reservations to cover
    everything this sample still needs — avoids handing the same sample to more
    people than required.
    """
    need = max((ev["tasks"][k]["needed_more"] for k in task_keys), default=0)
    others = sum(1 for a in ev["reservations"] if a["annotator_id"] != annotator_id)
    return others < need


def priority(ev: dict) -> int:
    """Lower is handed out first: resolve conflicts, then finish partial samples, then start new ones."""
    return {CONFLICT: 0, S_PARTIAL: 1, NOT_STARTED: 2}.get(ev["status"], 3)


def lease_expiry(now: datetime) -> str:
    return (now + timedelta(minutes=LEASE_MINUTES)).isoformat()