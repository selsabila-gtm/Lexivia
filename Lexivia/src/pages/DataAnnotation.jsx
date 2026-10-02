/**
 * DataAnnotation.jsx — Data Annotation workspace
 *
 *   Enter page → automatically receive a sample → fill the annotation form
 *   → Submit & Next → automatically receive the next sample
 *
 * What is on screen is driven entirely by the server's assignment:
 *   - sample.assets  = the already-collected SampleAsset[] (read-only context)
 *   - tasks          = the CompetitionTask[] this annotator must fill on this sample
 *   - mode           = REGULAR | CONFLICT_RESOLUTION (extra annotator added to break a tie)
 *
 * Nothing here chooses the number of annotators, the task types or the labels: the
 * organizer's "annotators per sample" is applied by the server, and every field is
 * generated from the task's type and config. Partial submissions are always allowed.
 *
 * Each annotator's answers are stored separately by the server; this page can never
 * create or change the original sample data.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import CompetitionSidebar from "../components/CompetitionSidebar";
import CompetitionTopbar from "../components/CompetitionTopbar";
import "../styles/DataCollection.css";
import "../styles/DataAnnotation.css";

const API = "http://127.0.0.1:8000";
function authHeader() {
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const STATUS_LABEL = {
  NOT_STARTED: "Not started",
  PARTIAL: "Partial",
  COMPLETED: "Completed",
  CONFLICT: "Conflict",
  CONFLICT_RESOLUTION: "Conflict resolution",
};

const PALETTE = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316", "#84cc16"];
const colorFor = (labels, label) => PALETTE[Math.max(0, labels.indexOf(label)) % PALETTE.length];

const countWords = (s) => (s || "").trim().split(/\s+/).filter(Boolean).length;

/** Has the annotator filled this task's field (completely)? Mirrors the server. */
function isAnswered(task, v) {
  if (!v) return false;
  switch (task.answer) {
    case "labels": return (v.labels || []).length > 0;
    case "spans": return (v.spans || []).length > 0 || !!v.none;
    case "qa": return !!(v.question || "").trim() && !!(v.answer || "").trim();
    default: return !!(v.text || "").trim();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-only collected data
// ─────────────────────────────────────────────────────────────────────────────

function CollectedAsset({ asset }) {
  return (
    <div className="da-asset">
      <p className="dc-field-label">{asset.name.toUpperCase()} · {asset.type}</p>
      {asset.kind === "audio" ? (
        asset.audio_url
          ? <audio controls src={asset.audio_url} style={{ width: "100%" }} />
          : <p className="da-muted">Audio unavailable.</p>
      ) : (
        <div className="da-asset-text">{asset.text}</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Answer fields — one per answer shape, configured by the task's config
// ─────────────────────────────────────────────────────────────────────────────

function LabelsField({ task, value, onChange }) {
  const cfg = task.config || {};
  const selected = value?.labels || [];
  const multi = !!cfg.multi_label;
  const toggle = (l) => {
    if (!multi) return onChange({ labels: selected[0] === l ? [] : [l] });
    onChange({ labels: selected.includes(l) ? selected.filter((x) => x !== l) : [...selected, l] });
  };
  const hint = multi
    ? [cfg.min_labels != null && `at least ${cfg.min_labels}`, cfg.max_labels != null && `at most ${cfg.max_labels}`]
        .filter(Boolean).join(", ")
    : "choose one";
  return (
    <>
      <div className="dc-label-row">
        {(cfg.labels || []).map((l) => (
          <button key={l} type="button" className={`dc-label-tag ${selected.includes(l) ? "active" : ""}`} onClick={() => toggle(l)}>
            {l}
          </button>
        ))}
      </div>
      {hint && <p className="da-muted" style={{ marginTop: 6 }}>{hint}</p>}
    </>
  );
}

function TextField({ task, value, onChange }) {
  const cfg = task.config || {};
  const text = value?.text || "";
  const words = countWords(text);
  const over = cfg.max_words != null && words > cfg.max_words;
  return (
    <>
      <textarea
        className="dc-textarea" rows={4} value={text}
        placeholder={cfg.language ? `Write here (${cfg.language})…` : "Write here…"}
        onChange={(e) => onChange({ text: e.target.value })}
      />
      <div className="dc-textarea-footer">
        <span className={over ? "dc-over-limit" : ""}>
          {words}{cfg.max_words != null ? ` / ${cfg.max_words}` : ""} words
          {cfg.min_words != null ? ` · min ${cfg.min_words}` : ""}
        </span>
      </div>
    </>
  );
}

function QaField({ task, value, onChange }) {
  const cfg = task.config || {};
  const v = value || {};
  const set = (k, x) => onChange({ ...v, [k]: x });
  return (
    <div className="cognitive-row">
      <div className="cognitive-field">
        <label className="dc-field-label">QUESTION</label>
        <input className="dc-input" type="text" value={v.question || ""} onChange={(e) => set("question", e.target.value)} />
      </div>
      <div className="cognitive-field">
        <label className="dc-field-label">ANSWER{cfg.max_words != null ? ` · max ${cfg.max_words} words` : ""}</label>
        <input className="dc-input" type="text" value={v.answer || ""} onChange={(e) => set("answer", e.target.value)} />
      </div>
    </div>
  );
}

function SpansField({ task, value, onChange, targetAsset, targetText }) {
  const cfg = task.config || {};
  const labels = cfg.span_labels || [];
  const spans = value?.spans || [];
  const none = !!value?.none;
  const [active, setActive] = useState(labels[0]);
  const [note, setNote] = useState("");
  const [markStart, setMarkStart] = useState(null);
  const textRef = useRef(null);
  const audioRef = useRef(null);
  const isAudio = targetAsset?.kind === "audio";
  const [k1, k2] = isAudio ? ["start_time", "end_time"] : ["start", "end"];

  const commit = (next) => { setNote(""); onChange({ spans: next, none: false }); };
  const overlaps = (a, b) => spans.some((s) => !(b <= s[k2] || a >= s[k1]));

  const addTextSpan = () => {
    const sel = window.getSelection();
    const box = textRef.current;
    if (!sel || sel.isCollapsed || !box) return;
    const range = sel.getRangeAt(0);
    if (!box.contains(range.commonAncestorContainer)) return;
    const pre = range.cloneRange();
    pre.selectNodeContents(box);
    pre.setEnd(range.startContainer, range.startOffset);
    const raw = range.toString();
    const start = pre.toString().length + (raw.length - raw.trimStart().length);
    const end = start + raw.trim().length;
    if (end <= start) return;
    if (!cfg.allow_overlap && overlaps(start, end)) { setNote("Spans cannot overlap."); return; }
    commit([...spans, { start, end, label: active, text: targetText.slice(start, end) }]);
    sel.removeAllRanges();
  };

  const addAudioSpan = () => {
    const t = audioRef.current?.currentTime ?? 0;
    if (markStart == null) return setMarkStart(t);
    if (t <= markStart) { setNote("The end must be after the start."); return; }
    const a = +markStart.toFixed(2), b = +t.toFixed(2);
    setMarkStart(null);
    if (!cfg.allow_overlap && overlaps(a, b)) { setNote("Spans cannot overlap."); return; }
    commit([...spans, { start_time: a, end_time: b, label: active }]);
  };

  const remove = (i) => onChange({ spans: spans.filter((_, j) => j !== i), none: false });

  // Text with highlighted spans. The label badge is CSS-only, so the element's
  // text content stays identical to the source text and character offsets are exact.
  const renderText = () => {
    const parts = [];
    let cursor = 0;
    [...spans].sort((a, b) => a.start - b.start).forEach((s, i) => {
      const from = Math.max(cursor, s.start);
      if (from > cursor) parts.push(<span key={`p${i}`}>{targetText.slice(cursor, from)}</span>);
      if (s.end > from)
        parts.push(
          <mark key={`m${i}`} className="da-mark" data-label={s.label}
            style={{ background: `${colorFor(labels, s.label)}26`, borderBottomColor: colorFor(labels, s.label) }}>
            {targetText.slice(from, s.end)}
          </mark>
        );
      cursor = Math.max(cursor, s.end);
    });
    if (cursor < targetText.length) parts.push(<span key="tail">{targetText.slice(cursor)}</span>);
    return parts;
  };

  if (!targetAsset && targetText == null) return <p className="da-muted">Nothing to annotate yet.</p>;

  return (
    <>
      <div className="dc-label-row" style={{ marginBottom: 10 }}>
        {labels.map((l) => (
          <button key={l} type="button" className="dc-label-tag"
            style={active === l ? { background: `${colorFor(labels, l)}26`, border: `1.5px solid ${colorFor(labels, l)}` } : {}}
            onClick={() => setActive(l)}>
            {l}
          </button>
        ))}
      </div>

      {isAudio ? (
        <>
          {targetAsset.audio_url && <audio ref={audioRef} controls src={targetAsset.audio_url} style={{ width: "100%", marginBottom: 8 }} />}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <button type="button" className="dc-label-tag active" onClick={addAudioSpan}>
              {markStart == null ? "▶ Mark start" : `■ Mark end (started @ ${markStart.toFixed(1)}s)`}
            </button>
            {markStart != null && <button type="button" className="dc-label-tag" onClick={() => setMarkStart(null)}>Cancel</button>}
          </div>
          <div className="da-timeline">
            {spans.map((s, i) => (
              <div key={i} className="da-timeline-span" title={`${s.label} ${s.start_time}s–${s.end_time}s`}
                style={{
                  left: `${(s.start_time / Math.max(targetAsset.duration || 1, 0.1)) * 100}%`,
                  width: `${Math.max(1, ((s.end_time - s.start_time) / Math.max(targetAsset.duration || 1, 0.1)) * 100)}%`,
                  background: `${colorFor(labels, s.label)}66`, borderColor: colorFor(labels, s.label),
                }} />
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="da-muted" style={{ marginBottom: 6 }}>Highlight a passage with the mouse to label it as “{active}”.</p>
          <div ref={textRef} className="da-asset-text da-selectable" onMouseUp={addTextSpan}>{renderText()}</div>
        </>
      )}

      {note && <p className="dc-over-limit" style={{ marginTop: 6 }}>{note}</p>}

      {spans.length > 0 && (
        <div className="dc-label-row" style={{ marginTop: 10, flexWrap: "wrap" }}>
          {spans.map((s, i) => (
            <span key={i} className="da-chip" style={{ borderColor: colorFor(labels, s.label) }}>
              <b>{s.label}</b>{" "}
              {isAudio ? `${s.start_time}s → ${s.end_time}s` : `“${s.text}”`}
              <button type="button" onClick={() => remove(i)} aria-label="Remove span">×</button>
            </span>
          ))}
        </div>
      )}

      <label className="dc-license-check" style={{ marginTop: 10 }}>
        <input type="checkbox" checked={none} disabled={spans.length > 0}
          onChange={(e) => onChange({ spans: [], none: e.target.checked })} />
        Nothing to mark here
      </label>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// One task
// ─────────────────────────────────────────────────────────────────────────────

function TaskCard({ task, assets, tasks, values, error, onChange }) {
  const { target } = task;
  const targetAsset = target.type === "ASSET" ? assets.find((a) => a.key === target.ref) : null;
  const producer = target.type === "TASK_OUTPUT" ? tasks.find((t) => t.key === target.ref) : null;
  const producerText = producer ? values[producer.key]?.text || "" : null;

  // A task that works on another task's output waits until that output exists.
  const blocked = producer && !producerText.trim();

  const targetLabel = target.type === "SAMPLE" ? "the whole sample"
    : producer ? `the output of “${producer.name}”`
    : targetAsset ? targetAsset.name : "";

  let field;
  if (blocked) field = <p className="da-muted">Complete “{producer.name}” first.</p>;
  else if (task.answer === "labels") field = <LabelsField task={task} value={values[task.key]} onChange={onChange} />;
  else if (task.answer === "spans")
    field = (
      <SpansField task={task} value={values[task.key]} onChange={onChange}
        targetAsset={targetAsset}
        targetText={producer ? producerText : targetAsset?.text ?? null} />
    );
  else if (task.answer === "qa") field = <QaField task={task} value={values[task.key]} onChange={onChange} />;
  else field = <TextField task={task} value={values[task.key]} onChange={onChange} />;

  return (
    <div className={`da-task ${task.conflict ? "da-task-conflict" : ""}`}>
      <div className="da-task-head">
        <span className="da-task-name">{task.name}</span>
        {task.conflict && <span className="da-badge da-badge-conflict">Conflict</span>}
        {isAnswered(task, values[task.key]) && <span className="da-badge da-badge-done">✓</span>}
      </div>
      <p className="da-muted" style={{ margin: "0 0 10px" }}>
        {task.type.replace(/_/g, " ").toLowerCase()} · applies to {targetLabel}
      </p>
      {task.instructions && <p className="da-instructions">{task.instructions}</p>}
      {field}
      {error && <p className="dc-over-limit" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Statistics
// ─────────────────────────────────────────────────────────────────────────────

function StatsBar({ totals }) {
  const items = [
    ["Total samples", totals.total],
    ["Completed", totals.completed, "ok"],
    ["Partial", totals.partial, "warn"],
    ["Not started", totals.not_started],
    ["Conflicts", totals.conflicts, "bad"],
    ["To resolve", totals.conflicts_to_resolve, "bad"],
    ["Resolved", totals.resolved_conflicts, "ok"],
  ];
  return (
    <div className="da-stats">
      {items.map(([label, n, tone]) => (
        <div key={label} className={`da-stat ${tone ? `da-stat-${tone}` : ""}`}>
          <span className="da-stat-num">{(n ?? 0).toLocaleString()}</span>
          <span className="da-stat-lbl">{label}</span>
        </div>
      ))}
    </div>
  );
}

function SidePanel({ stats }) {
  const me = stats?.me;
  const total = stats?.totals?.total || 0;
  const pct = total ? Math.min(100, Math.round(((me?.annotated || 0) / total) * 100)) : 0;
  return (
    <div className="dc-right-panel">
      {me && (
        <div className="dc-panel-card">
          <div className="dc-panel-header"><span className="dc-panel-label">Your progress</span></div>
          <div className="dc-quota-row">
            <span className="dc-quota-text">Annotated</span>
            <span className="dc-quota-nums">{me.annotated} / {total}</span>
          </div>
          <div className="dc-progress-bar"><div className="dc-progress-fill" style={{ width: `${pct}%` }} /></div>
          <div className="da-mini-grid">
            <span>Completed <b>{me.completed}</b></span>
            <span>Partial <b>{me.partial}</b></span>
            <span>Conflicts handled <b>{me.conflicts_handled}</b></span>
            <span>Conflicts resolved <b>{me.conflicts_resolved}</b></span>
            <span>Left for you <b>{me.remaining_for_me}</b></span>
          </div>
        </div>
      )}

      {(stats?.annotators || []).length > 0 && (
        <div className="dc-panel-card">
          <p className="dc-panel-section-title">ANNOTATORS</p>
          {stats.annotators.map((a) => (
            <div key={a.id} className="da-annotator">
              <div className="dc-avatar">{a.initials}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="dc-member-name">{a.name}</span>
                <span className="da-annotator-sub">
                  {a.annotated} annotated · {a.completed} completed · {a.partial} partial
                </span>
                <span className="da-annotator-sub">
                  conflicts: {a.conflicts_handled} handled · {a.conflicts_resolved} resolved
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Toast({ message, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3200); return () => clearTimeout(t); }, [onDone]);
  return <div className="dc-toast">{message}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function DataAnnotation() {
  const params = useParams();
  const competitionId = params.id ?? params.competitionId;
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [assignment, setAssignment] = useState(null);   // server payload, or {state: ...}
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [values, setValues] = useState({});             // { [task.key]: answer }
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  const loadStats = useCallback(() => {
    fetch(`${API}/competitions/${competitionId}/annotation/stats`, { headers: authHeader() })
      .then((r) => (r.ok ? r.json() : null)).then((s) => s && setStats(s)).catch(() => {});
  }, [competitionId]);

  const loadNext = useCallback(async () => {
    setLoading(true);
    setValues({});
    setErrors({});
    try {
      const res = await fetch(`${API}/competitions/${competitionId}/annotation/next`, { headers: authHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setAssignment({ state: "error", message: typeof data.detail === "string" ? data.detail : "Could not load a sample." });
      else setAssignment(data);
    } catch {
      setAssignment({ state: "error", message: "Could not reach the server." });
    } finally {
      setLoading(false);
    }
  }, [competitionId]);

  useEffect(() => {
    if (!competitionId) return;
    fetch(`${API}/competitions/${competitionId}`, { headers: authHeader() })
      .then((r) => (r.ok ? r.json() : null)).then((c) => c && setTitle(c.title)).catch(() => {});
    loadNext();
    loadStats();
    const iv = setInterval(loadStats, 15_000);
    return () => clearInterval(iv);
  }, [competitionId, loadNext, loadStats]);

  const tasks = useMemo(() => assignment?.tasks || [], [assignment]);
  const assets = useMemo(() => assignment?.sample?.assets || [], [assignment]);
  const answered = tasks.filter((t) => isAnswered(t, values[t.key])).length;

  const setValue = (key, v) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((prev) => { if (!prev[key]) return prev; const n = { ...prev }; delete n[key]; return n; });
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/competitions/${competitionId}/annotation/${assignment.assignment_id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ values }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.detail?.errors) { setErrors(data.detail.errors); setToast("⚠ Fix the highlighted answers, or clear them to submit."); return; }
        if (res.status === 409) { setToast("This sample was already submitted."); await loadNext(); return; }
        throw new Error(typeof data.detail === "string" ? data.detail : "Submission failed");
      }
      setToast(
        data.status === "SKIPPED" ? "Nothing was filled in — the sample was released."
          : data.status === "PARTIAL" ? `Saved as partial — ${data.missing_fields.length} field(s) left empty.`
          : "✓ Annotation saved"
      );
      loadStats();
      await loadNext();
    } catch (e) {
      setToast(`⚠ ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // ── main column ────────────────────────────────────────────────────────────
  const renderMain = () => {
    if (loading && !assignment) return <div className="dc-widget dc-placeholder">Finding a sample for you…</div>;
    const s = assignment?.state;

    if (s === "assigned") {
      const resolving = assignment.mode === "CONFLICT_RESOLUTION";
      return (
        <div className="dc-widget">
          <div className="dc-widget-header">
            <div className="dc-doc-badge">
              <span className="dc-doc-icon">✎</span>
              <span>SAMPLE #{assignment.sample.number}</span>
            </div>
            <span className={`da-status da-status-${resolving ? "CONFLICT_RESOLUTION" : assignment.sample.status}`}>
              {resolving ? STATUS_LABEL.CONFLICT_RESOLUTION : STATUS_LABEL[assignment.sample.status]}
            </span>
          </div>

          {resolving && (
            <div className="da-conflict">
              <p className="da-conflict-title">⚠ Conflict Resolution</p>
              <p>This sample has conflicting annotations.</p>
              {assignment.conflicts.map((c) => (
                <div key={c.task_key} className="da-conflict-task">
                  <p className="da-conflict-task-name">Previous results — {c.task_name}</p>
                  {c.results.map((r, i) => (
                    <p key={i} className="da-conflict-row">
                      {r.summary} — {r.annotator}{r.name ? ` (${r.name})` : ""}
                    </p>
                  ))}
                </div>
              ))}
              <p>Your annotation is required to help resolve this conflict.</p>
            </div>
          )}

          <p className="da-section">COLLECTED DATA</p>
          {assets.map((a) => <CollectedAsset key={a.key} asset={a} />)}

          <p className="da-section">ANNOTATION</p>
          {assignment.tasks_already_covered > 0 && (
            <p className="da-muted" style={{ marginBottom: 10 }}>
              {assignment.tasks_already_covered} other task{assignment.tasks_already_covered === 1 ? " is" : "s are"} already covered by other annotators.
            </p>
          )}
          {tasks.map((t) => (
            <TaskCard key={t.key} task={t} tasks={tasks} assets={assets} values={values}
              error={errors[t.key]} onChange={(v) => setValue(t.key, v)} />
          ))}
          {errors._form && <p className="dc-over-limit">{errors._form}</p>}

          <div className="dc-widget-actions da-actions">
            <span className="da-muted">
              {answered} of {tasks.length} field{tasks.length === 1 ? "" : "s"} completed
              {answered < tasks.length && " — you can still submit; it will be saved as partial."}
            </span>
            <button type="button" className="dc-commit-btn" disabled={submitting} onClick={submit}>
              {submitting ? "Submitting…" : "Submit & Next"}
            </button>
          </div>
        </div>
      );
    }

    const messages = {
      empty: ["You're all caught up", "There are no samples available for you right now. Samples may be waiting on other annotators, or already reserved."],
      not_configured: ["Annotation isn't set up yet", assignment?.message],
      no_tasks: ["No annotation tasks", assignment?.message],
      error: ["Something went wrong", assignment?.message],
    }[s] || ["Nothing to show", ""];
    return (
      <div className="dc-widget dc-placeholder da-empty">
        <p className="da-empty-title">{messages[0]}</p>
        <p>{messages[1]}</p>
        {(s === "empty" || s === "error") && (
          <button type="button" className="dc-label-tag active" onClick={loadNext}>Check again</button>
        )}
      </div>
    );
  };

  return (
    <div className="dc-shell">
      <CompetitionSidebar competitionId={competitionId} competitionTitle={title} />

      <div className="dc-main">
        <CompetitionTopbar competitionId={competitionId} competitionTitle={title || "Competition"} status="LAB ACTIVE" showDatasetHub={false} />

        <div className="dc-body">
          <div className="dc-header">
            <div>
              <h1 className="dc-title">Data Annotation</h1>
              <p className="dc-subtitle">
                Annotate the sample below. Your answers are stored separately from other annotators'.
                {assignment?.required_annotators ? ` Each sample is annotated by ${assignment.required_annotators} different team members.` : ""}
              </p>
            </div>
            <div className="dc-header-right">
              <button className="dc-dataset-hub-btn" onClick={() => navigate(`/competitions/${competitionId}/dataset-hub`)}>
                Dataset Hub
              </button>
            </div>
          </div>

          {stats?.configured && <StatsBar totals={stats.totals} />}

          <div className="dc-content">
            <div className="dc-left">{renderMain()}</div>
            <SidePanel stats={stats?.configured ? stats : null} />
          </div>
        </div>
      </div>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}