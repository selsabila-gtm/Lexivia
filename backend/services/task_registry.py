"""
services/task_registry.py

Registry of generic ASSET types and TASK types, plus validation of the
competition "structure" (assets + tasks). There are no competition types:
a competition is just

    Competition
      ├── DataComponent[]      (asset definitions: type + constraints)
      ├── CompetitionTask[]    (task type + target + JSON config)
      └── Sample[] → SampleAsset[] + Annotation[]

Adding a new task type or asset type is ONE entry in the dicts below: no
migration, no new competition type. The frontend fetches this registry from
GET /competition-schema and renders the config form generically from `fields`.

Field spec keys:
    key, label, type   integer | number | string | text | boolean | select |
                       multi_select | string_list
    required, default, min, max, options, min_items, help, placeholder,
    show_if   {"other_field": value} — only shown/validated/stored when that
              other field of the same config has that value

Target model
    ASSET        -> ref = key of a DataComponent
    SAMPLE       -> whole sample (ref = None)
    TASK_OUTPUT  -> ref = key of another task (implicit dependency)

Every task type also declares the `answer` shape an annotator gives
("labels" | "spans" | "text" | "qa"), which drives the annotation form, value
validation and how agreement between annotators is measured.

Every task type declares what it `accepts` as input ("text", "audio",
"sample") and what it `produces` ("text", "label", "labels", "spans"). A task
targeting TASK_OUTPUT is only valid if the producer's output kind is accepted.
"""

import re
from typing import Any, Optional

KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
TARGET_TYPES = ("ASSET", "SAMPLE", "TASK_OUTPUT")


class StructureError(ValueError):
    """Raised for any invalid asset / task definition. Message is user-facing."""


def _f(key: str, label: str, type_: str, **kw) -> dict:
    return {"key": key, "label": label, "type": type_, **kw}


# ─────────────────────────────────────────────────────────────────────────────
# Asset types
# ─────────────────────────────────────────────────────────────────────────────

def _check_min_max(lo: str, hi: str, label: str):
    def check(cfg: dict) -> Optional[str]:
        if cfg.get(lo) is not None and cfg.get(hi) is not None and cfg[lo] > cfg[hi]:
            return f"{label}: minimum cannot exceed maximum"
        return None
    return check


ASSET_TYPES: dict[str, dict] = {
    "TEXT": {
        "label": "Text",
        "kind": "text",
        "description": "A piece of written text.",
        "fields": [
            _f("max_words", "Maximum words", "integer", required=True, default=50, min=1),
            _f("min_words", "Minimum words", "integer", min=0),
            _f("language", "Language / locale", "string", placeholder="e.g. ar-DZ"),
        ],
        "check": _check_min_max("min_words", "max_words", "Text words"),
    },
    "AUDIO": {
        "label": "Audio",
        "kind": "audio",
        "description": "A recorded audio clip.",
        "fields": [
            _f("max_duration_seconds", "Maximum duration (seconds)", "number", required=True, default=10, min=0.5),
            _f("min_duration_seconds", "Minimum duration (seconds)", "number", min=0),
            _f("allowed_formats", "Allowed formats", "multi_select", required=True,
               options=["wav", "mp3", "flac", "ogg", "m4a"], default=["wav"]),
            _f("language", "Spoken language / locale", "string", placeholder="e.g. ar-DZ"),
        ],
        "check": _check_min_max("min_duration_seconds", "max_duration_seconds", "Audio duration"),
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# Task types
# ─────────────────────────────────────────────────────────────────────────────

def _labels_field(label="Labels", min_items=2):
    return _f("labels", label, "string_list", required=True, min_items=min_items,
              help="One per line.")


def _check_label_range(cfg: dict) -> Optional[str]:
    if not cfg.get("multi_label"):
        return None
    lo, hi = cfg.get("min_labels"), cfg.get("max_labels")
    if lo is not None and hi is not None and lo > hi:
        return "minimum labels cannot exceed maximum labels"
    if hi is not None and hi > len(cfg.get("labels", [])):
        return "maximum labels cannot exceed the number of labels"
    if lo is not None and lo > len(cfg.get("labels", [])):
        return "minimum labels cannot exceed the number of labels"
    return None


TASK_TYPES: dict[str, dict] = {
    "TRANSCRIPTION": {
        "label": "Transcription",
        "description": "Write down what is said in an audio clip.",
        "answer": "text",
        "accepts": ["audio"], "produces": "text",
        "fields": [
            _f("max_words", "Maximum words", "integer", min=1),
            _f("language", "Language / locale", "string", placeholder="e.g. ar-DZ"),
            _f("speakers", "Number of speakers", "integer", min=1, default=1),
            _f("with_timestamps", "Require timestamps", "boolean", default=False),
        ],
    },
    "CLASSIFICATION": {
        "label": "Classification",
        "description": "Pick one label, or several, for the target.",
        "answer": "labels",
        "accepts": ["text", "audio", "sample"], "produces": "label",
        "fields": [
            _labels_field(),
            _f("multi_label", "Allow multiple labels", "boolean", default=False),
            _f("min_labels", "Minimum labels per item", "integer", min=0, default=1,
               show_if={"multi_label": True}),
            _f("max_labels", "Maximum labels per item", "integer", min=1,
               show_if={"multi_label": True}),
        ],
        "check": _check_label_range,
    },
    "SPAN_ANNOTATION": {
        "label": "Span annotation",
        "description": "Mark labelled spans: character ranges in text (e.g. entities) "
                       "or time ranges in audio (e.g. speakers, events).",
        "answer": "spans",
        "accepts": ["text", "audio"], "produces": "spans",
        "fields": [
            _f("span_labels", "Span labels", "string_list", required=True, min_items=1,
               help="One per line, e.g. PER, ORG, LOC for text or speaker, music, noise for audio."),
            _f("allow_overlap", "Allow overlapping spans", "boolean", default=False),
        ],
    },
    "TRANSLATION": {
        "label": "Translation",
        "description": "Translate text into another language.",
        "answer": "text",
        "accepts": ["text"], "produces": "text",
        "fields": [
            _f("source_language", "Source language", "string", required=True, placeholder="e.g. en"),
            _f("target_language", "Target language", "string", required=True, placeholder="e.g. ar-DZ"),
            _f("max_words", "Maximum words", "integer", min=1),
        ],
    },
    "SUMMARIZATION": {
        "label": "Summarization",
        "description": "Write a short summary of the target.",
        "answer": "text",
        "accepts": ["text", "sample"], "produces": "text",
        "fields": [
            _f("min_words", "Minimum words", "integer", min=0),
            _f("max_words", "Maximum words", "integer", min=1),
        ],
        "check": _check_min_max("min_words", "max_words", "Summary words"),
    },
    "QUESTION_ANSWERING": {
        "label": "Question answering",
        "description": "Answer a question about the target.",
        "answer": "qa",
        "accepts": ["text", "sample"], "produces": "text",
        "fields": [
            _f("qa_type", "Answer type", "select", required=True, default="extractive",
               options=["extractive", "abstractive"]),
            _f("max_words", "Maximum answer words", "integer", min=1),
        ],
    },
    "FREE_TEXT": {
        "label": "Free-text annotation",
        "description": "Write any free-form text about the target.",
        "answer": "text",
        "accepts": ["text", "audio", "sample"], "produces": "text",
        "fields": [
            _f("max_words", "Maximum words", "integer", min=1),
            _f("language", "Language / locale", "string"),
        ],
    },
}


# Task types that existed before overlapping ones were merged. Applied on load
# and on validation so competitions saved earlier keep working.
def normalize_task(t: dict) -> dict:
    t = dict(t)
    cfg = dict(t.get("config") or {})
    typ = t.get("type")
    if typ in ("MULTI_LABEL_CLASSIFICATION", "AUDIO_CLASSIFICATION"):
        if typ == "MULTI_LABEL_CLASSIFICATION":
            cfg["multi_label"] = True
        t["type"] = "CLASSIFICATION"
    elif typ == "NER":
        if "entity_types" in cfg and "span_labels" not in cfg:
            cfg["span_labels"] = cfg.pop("entity_types")
        t["type"] = "SPAN_ANNOTATION"
    t["config"] = cfg
    return t


# ─────────────────────────────────────────────────────────────────────────────
# Public payload for the frontend
# ─────────────────────────────────────────────────────────────────────────────

def registry_payload() -> dict:
    return {
        "asset_types": [
            {"value": k, "label": v["label"], "kind": v["kind"],
             "description": v["description"], "fields": v["fields"]}
            for k, v in ASSET_TYPES.items()
        ],
        "task_types": [
            {"value": k, "label": v["label"], "description": v["description"],
             "accepts": v["accepts"], "produces": v["produces"],
             "answer": v["answer"], "fields": v["fields"]}
            for k, v in TASK_TYPES.items()
        ],
        "target_types": list(TARGET_TYPES),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Config validation (driven by the field specs above)
# ─────────────────────────────────────────────────────────────────────────────

def _is_blank(v: Any) -> bool:
    return v is None or (isinstance(v, (str, list)) and len(v) == 0)


def _default_of(fields: list[dict], key: str):
    return next((f.get("default") for f in fields if f["key"] == key), None)


def clean_config(fields: list[dict], raw: Any, where: str) -> dict:
    """Validate + coerce `raw` against `fields`; unknown keys are dropped."""
    raw = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {}

    for f in fields:
        k, t, label = f["key"], f["type"], f["label"]
        cond = f.get("show_if")
        if cond and any(out.get(ck, _default_of(fields, ck)) != cv for ck, cv in cond.items()):
            continue  # hidden by another field's value: not required, not stored
        v = raw.get(k)
        if isinstance(v, str) and t != "string_list":
            v = v.strip()
        if _is_blank(v):
            v = f.get("default")
        if _is_blank(v):
            if f.get("required"):
                raise StructureError(f"{where}: '{label}' is required")
            continue

        try:
            if t == "integer":
                if isinstance(v, bool) or (isinstance(v, float) and not v.is_integer()):
                    raise ValueError
                v = int(v)
            elif t == "number":
                if isinstance(v, bool):
                    raise ValueError
                v = float(v)
            elif t == "boolean":
                if isinstance(v, str):
                    v = v.lower() in ("true", "1", "yes")
                v = bool(v)
            elif t in ("string", "text"):
                v = str(v).strip()
            elif t == "select":
                v = str(v)
                if v not in f["options"]:
                    raise StructureError(f"{where}: '{label}' must be one of {', '.join(f['options'])}")
            elif t == "multi_select":
                items = list(dict.fromkeys(str(i) for i in (v if isinstance(v, list) else [v])))
                bad = [i for i in items if i not in f["options"]]
                if bad:
                    raise StructureError(f"{where}: '{label}' has unsupported value(s): {', '.join(bad)}")
                if f.get("required") and not items:
                    raise StructureError(f"{where}: select at least one for '{label}'")
                v = items
            elif t == "string_list":
                items = v if isinstance(v, list) else str(v).splitlines()
                v = list(dict.fromkeys(str(i).strip() for i in items if str(i).strip()))
                if len(v) < int(f.get("min_items", 1 if f.get("required") else 0)):
                    raise StructureError(
                        f"{where}: '{label}' needs at least {f.get('min_items', 1)} entr"
                        f"{'y' if f.get('min_items', 1) == 1 else 'ies'}"
                    )
            else:
                raise StructureError(f"{where}: unknown field type '{t}' for '{label}'")
        except (TypeError, ValueError) as exc:
            if isinstance(exc, StructureError):
                raise
            raise StructureError(f"{where}: '{label}' has an invalid value")

        if t in ("integer", "number"):
            if "min" in f and v < f["min"]:
                raise StructureError(f"{where}: '{label}' must be at least {f['min']}")
            if "max" in f and v > f["max"]:
                raise StructureError(f"{where}: '{label}' must be at most {f['max']}")
        out[k] = v

    return out


# ─────────────────────────────────────────────────────────────────────────────
# Structure validation: assets, tasks, targets, dependency graph
# ─────────────────────────────────────────────────────────────────────────────

def _valid_key(key: Any, what: str) -> str:
    key = (key or "").strip() if isinstance(key, str) else ""
    if not KEY_RE.match(key):
        raise StructureError(
            f"Invalid {what} key '{key}': use lowercase letters, digits and underscores, starting with a letter"
        )
    return key


def _find_cycle(deps: dict[str, list[str]]) -> Optional[list[str]]:
    WHITE, GREY, BLACK = 0, 1, 2
    color = {k: WHITE for k in deps}
    stack: list[str] = []

    def visit(n: str) -> Optional[list[str]]:
        color[n] = GREY
        stack.append(n)
        for d in deps[n]:
            if color[d] == GREY:
                return stack[stack.index(d):] + [d]
            if color[d] == WHITE:
                found = visit(d)
                if found:
                    return found
        stack.pop()
        color[n] = BLACK
        return None

    for n in deps:
        if color[n] == WHITE:
            found = visit(n)
            if found:
                return found
    return None


def validate_structure(assets: list[dict], tasks: list[dict]) -> tuple[list[dict], list[dict]]:
    """
    Returns (clean_assets, clean_tasks). Tasks come back in dependency order
    (a task always appears after everything it depends on) with `position` set.
    Raises StructureError on the first problem found.
    """
    if not assets:
        raise StructureError("Define at least one sample asset")
    if not tasks:
        raise StructureError("Define at least one task")

    # ── assets ──────────────────────────────────────────────────────────────
    clean_assets, akind, anames = [], {}, {}
    for i, a in enumerate(assets):
        key = _valid_key(a.get("key"), "asset")
        if key in akind:
            raise StructureError(f"Duplicate asset key '{key}'")
        name = (a.get("name") or "").strip()
        if not name:
            raise StructureError(f"Asset {i + 1} needs a name")
        if name.lower() in anames:
            raise StructureError(f"Two assets are named '{name}'; asset names must be unique")
        spec = ASSET_TYPES.get(a.get("type"))
        if not spec:
            raise StructureError(f"Asset '{name}' has unknown type '{a.get('type')}'")
        cfg = clean_config(spec["fields"], a.get("constraints"), f"Asset '{name}'")
        if spec.get("check"):
            err = spec["check"](cfg)
            if err:
                raise StructureError(f"Asset '{name}': {err}")
        akind[key] = spec["kind"]
        anames[name.lower()] = key
        clean_assets.append({"key": key, "name": name, "type": a["type"],
                             "required": bool(a.get("required", True)),
                             "constraints": cfg, "position": i})

    # ── tasks: identity + config ────────────────────────────────────────────
    tasks = [normalize_task(t) for t in tasks]
    tspec: dict[str, dict] = {}
    for i, t in enumerate(tasks):
        key = _valid_key(t.get("key"), "task")
        if key in tspec:
            raise StructureError(f"Duplicate task key '{key}'")
        name = (t.get("name") or "").strip()
        if not name:
            raise StructureError(f"Task {i + 1} needs a name")
        spec = TASK_TYPES.get(t.get("type"))
        if not spec:
            raise StructureError(f"Task '{name}' has unknown task type '{t.get('type')}'")
        cfg = clean_config(spec["fields"], t.get("config"), f"Task '{name}'")
        if spec.get("check"):
            err = spec["check"](cfg)
            if err:
                raise StructureError(f"Task '{name}': {err}")
        tspec[key] = {"index": i, "name": name, "type": t["type"], "spec": spec,
                      "config": cfg, "raw": t}

    # ── tasks: targets + compatibility + dependencies ───────────────────────
    deps: dict[str, list[str]] = {}
    clean_targets: dict[str, dict] = {}
    for key, info in tspec.items():
        name, spec, raw = info["name"], info["spec"], info["raw"]
        target = raw.get("target") or {}
        ttype = target.get("type")
        ref = (target.get("ref") or None)
        if ttype not in TARGET_TYPES:
            raise StructureError(f"Task '{name}' needs a target (asset, whole sample, or another task's output)")

        if ttype == "ASSET":
            if ref not in akind:
                raise StructureError(f"Task '{name}' targets an asset that does not exist")
            kind = akind[ref]
        elif ttype == "SAMPLE":
            ref, kind = None, "sample"
        else:  # TASK_OUTPUT
            if ref not in tspec:
                raise StructureError(f"Task '{name}' targets the output of a task that does not exist")
            if ref == key:
                raise StructureError(f"Task '{name}' cannot target its own output")
            kind = tspec[ref]["spec"]["produces"]

        if kind not in spec["accepts"]:
            what = {"text": "text", "audio": "audio", "sample": "a whole sample"}.get(kind, f"'{kind}' output")
            raise StructureError(
                f"Task '{name}' ({spec['label']}) cannot be applied to {what}; "
                f"it accepts: {', '.join(spec['accepts'])}"
            )
        clean_targets[key] = {"type": ttype, "ref": ref}

        explicit = []
        for d in raw.get("depends_on") or []:
            if d not in tspec:
                raise StructureError(f"Task '{name}' depends on a task that does not exist")
            if d == key:
                raise StructureError(f"Task '{name}' cannot depend on itself")
            explicit.append(d)
        implicit = [ref] if ttype == "TASK_OUTPUT" else []
        deps[key] = list(dict.fromkeys(explicit + implicit))
        info["explicit_deps"] = list(dict.fromkeys(explicit))

    cycle = _find_cycle(deps)
    if cycle:
        raise StructureError(
            "Circular task dependency: " + " → ".join(tspec[k]["name"] for k in cycle)
        )

    # ── stable topological order ────────────────────────────────────────────
    remaining = sorted(tspec, key=lambda k: tspec[k]["index"])
    placed: list[str] = []
    while remaining:
        nxt = next(k for k in remaining if all(d in placed for d in deps[k]))
        placed.append(nxt)
        remaining.remove(nxt)

    clean_tasks = []
    for pos, key in enumerate(placed):
        info = tspec[key]
        clean_tasks.append({
            "key": key, "name": info["name"], "type": info["type"],
            "target": clean_targets[key], "config": info["config"],
            "depends_on": info["explicit_deps"],
            "instructions": (info["raw"].get("instructions") or "").strip() or None,
            "position": pos,
        })
    return clean_assets, clean_tasks