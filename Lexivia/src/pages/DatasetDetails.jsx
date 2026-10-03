/**
 * Dataset detail — /datasets/:competitionId
 *
 * One dataset = the samples collected in a CLOSED competition. Shows
 *   - statistics (samples, contributors, annotation coverage, audio hours, per-task distributions)
 *   - the sample structure (asset slots + annotation tasks)
 *   - a paginated sample browser: every asset of a sample (text, playable audio)
 *     together with its annotations, rendered according to each task's answer shape
 *     (labels, text/audio spans, text, question/answer).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";

import {
  ArrowLeft,
  Database,
  Download,
  FileText,
  Headphones,
  Tags,
  UsersRound,
  CheckCircle2,
  Clock,
  ChevronLeft,
  ChevronRight,
  Lock,
} from "lucide-react";

import {
  apiGet,
  downloadExport,
  formatNumber,
  formatDuration,
  formatClock,
  formatDate,
  taskLabel,
  labelColor,
} from "./datasetHubShared";

// ── Styles ───────────────────────────────────────────────────────────────────

const CSS = `
  @keyframes dsd-spin { to { transform: rotate(360deg); } }
  .dsd-page { padding: 28px 32px 56px; max-width: 1180px; display: flex; flex-direction: column; gap: 26px; }
  .dsd-back { display: inline-flex; align-items: center; gap: 6px; background: none; border: none; color: #64748b;
    font-size: 13px; font-weight: 600; cursor: pointer; padding: 0; width: fit-content; }
  .dsd-back:hover { color: #4f46e5; }

  .dsd-head { background: #fff; border: 1px solid #e9ecef; border-radius: 14px; padding: 24px 26px;
    display: flex; gap: 20px; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; }
  .dsd-title { margin: 0; font-size: 22px; font-weight: 800; color: #101827; }
  .dsd-sub { margin: 8px 0 0; font-size: 14px; color: #64748b; line-height: 1.6; max-width: 720px; white-space: pre-line; }
  .dsd-meta { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 12px; font-size: 12px; color: #64748b; font-weight: 600; }
  .dsd-link { color: #6366f1; cursor: pointer; }
  .dsd-link:hover { text-decoration: underline; }
  .dsd-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 6px;
    background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 700; }
  .dsd-actions { display: flex; gap: 8px; }
  .dsd-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; font-size: 12px; font-weight: 700;
    border-radius: 8px; border: 1px solid #e2e8f0; background: #fff; color: #374151; cursor: pointer; }
  .dsd-btn:hover:not(:disabled) { background: #f8fafc; border-color: #c5cee0; }
  .dsd-btn:disabled { color: #94a3b8; cursor: not-allowed; }

  .dsd-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; }
  .dsd-stat { background: #fff; border: 1px solid #e9ecef; border-radius: 12px; padding: 16px 18px; display: flex; gap: 12px; align-items: center; }
  .dsd-stat-icon { width: 36px; height: 36px; border-radius: 9px; background: #eef3ff; color: #4f46e5;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .dsd-stat-value { font-size: 20px; font-weight: 800; color: #101827; line-height: 1.1; }
  .dsd-stat-label { font-size: 11px; color: #94a3b8; font-weight: 600; margin-top: 3px; }

  .dsd-section { display: flex; flex-direction: column; gap: 12px; }
  .dsd-h2 { margin: 0; font-size: 16px; font-weight: 800; color: #101827; }
  .dsd-h2 small { font-size: 12px; font-weight: 600; color: #94a3b8; margin-left: 8px; }
  .dsd-grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 14px; }
  .dsd-card { background: #fff; border: 1px solid #e9ecef; border-radius: 12px; padding: 18px 20px; }
  .dsd-card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 12px; }
  .dsd-card-title { font-size: 14px; font-weight: 700; color: #101827; }
  .dsd-card-note { font-size: 12px; color: #94a3b8; margin-top: 2px; }
  .dsd-kv { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .dsd-kv > div { background: #f8fafc; border-radius: 8px; padding: 9px 11px; }
  .dsd-kv b { display: block; font-size: 15px; color: #101827; }
  .dsd-kv span { font-size: 11px; color: #94a3b8; font-weight: 600; }
  .dsd-muted { color: #94a3b8; font-size: 13px; }

  .dsd-dist { display: flex; flex-direction: column; gap: 7px; }
  .dsd-dist-row { display: grid; grid-template-columns: minmax(70px, 130px) 1fr 42px; gap: 10px; align-items: center; font-size: 12px; }
  .dsd-dist-label { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dsd-dist-track { height: 8px; background: #f1f5f9; border-radius: 4px; overflow: hidden; }
  .dsd-dist-track > div { height: 100%; border-radius: 4px; }
  .dsd-dist-count { text-align: right; color: #64748b; font-weight: 700; }

  .dsd-spark { display: flex; align-items: flex-end; gap: 3px; height: 70px; }
  .dsd-spark > div { flex: 1; min-width: 3px; background: #818cf8; border-radius: 2px 2px 0 0; }
  .dsd-spark > div:hover { background: #4f46e5; }

  .dsd-struct { display: flex; flex-direction: column; gap: 8px; }
  .dsd-struct-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: #f8fafc; border-radius: 9px; font-size: 13px; }
  .dsd-struct-row b { color: #101827; }
  .dsd-struct-row small { color: #94a3b8; margin-left: auto; text-align: right; }

  .dsd-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
  .dsd-select { padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; background: #fff; color: #374151; cursor: pointer; outline: none; }
  .dsd-pager { display: flex; align-items: center; gap: 10px; justify-content: center; font-size: 12px; color: #64748b; font-weight: 600; }

  .dsd-sample { background: #fff; border: 1px solid #e9ecef; border-radius: 14px; overflow: hidden; }
  .dsd-sample-head { display: flex; align-items: center; gap: 10px; padding: 12px 20px; background: #f8fafc; border-bottom: 1px solid #e9ecef; flex-wrap: wrap; }
  .dsd-sample-num { font-weight: 800; color: #101827; font-size: 14px; }
  .dsd-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #94a3b8; }
  .dsd-sample-body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  @media (max-width: 900px) { .dsd-sample-body { grid-template-columns: 1fr; } .dsd-col + .dsd-col { border-left: none !important; border-top: 1px solid #e9ecef; } }
  .dsd-col { padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .dsd-col + .dsd-col { border-left: 1px solid #e9ecef; }
  .dsd-col-title { font-size: 11px; letter-spacing: .6px; text-transform: uppercase; color: #94a3b8; font-weight: 800; }

  .dsd-asset-name { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 700; color: #475569; margin-bottom: 6px; }
  .dsd-asset-name small { color: #94a3b8; font-weight: 600; margin-left: auto; }
  .dsd-text { margin: 0; font-size: 14px; line-height: 1.75; color: #1f2937; white-space: pre-wrap; word-break: break-word;
    background: #fafbff; border: 1px solid #eef0f8; border-radius: 9px; padding: 12px 14px; }
  .dsd-text mark { padding: 1px 3px; border-radius: 4px; }
  .dsd-text mark em { font-style: normal; font-size: 9px; font-weight: 800; margin-left: 4px; text-transform: uppercase; letter-spacing: .4px; }

  .dsd-audio { background: #fafbff; border: 1px solid #eef0f8; border-radius: 9px; padding: 12px 14px; }
  .dsd-audio audio { width: 100%; height: 38px; }
  .dsd-lanes { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; position: relative; }
  .dsd-lane-label { font-size: 10px; font-weight: 700; color: #94a3b8; margin-bottom: 3px; }
  .dsd-lane-track { position: relative; height: 20px; background: #eef0f8; border-radius: 5px; overflow: hidden; }
  .dsd-seg { position: absolute; top: 0; bottom: 0; border: none; padding: 0 4px; font-size: 10px; font-weight: 800; cursor: pointer;
    overflow: hidden; white-space: nowrap; text-overflow: ellipsis; opacity: .92; }
  .dsd-seg:hover { opacity: 1; filter: brightness(.95); }
  .dsd-playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: #101827; pointer-events: none; opacity: .65; }

  .dsd-ann { border: 1px solid #eef0f8; border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
  .dsd-ann-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .dsd-ann-name { font-size: 13px; font-weight: 800; color: #101827; }
  .dsd-ann-type { font-size: 10px; font-weight: 800; letter-spacing: .4px; color: #6d28d9; background: #f3f0ff; padding: 2px 7px; border-radius: 5px; }
  .dsd-ann-target { font-size: 11px; color: #94a3b8; margin-left: auto; }
  .dsd-entry { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px dashed #e9ecef; }
  .dsd-entry:first-of-type { border-top: none; padding-top: 0; }
  .dsd-entry-who { font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: .5px; }
  .dsd-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .dsd-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
  .dsd-chip small { font-weight: 600; opacity: .75; }
  .dsd-answer { margin: 0; font-size: 13.5px; line-height: 1.65; color: #1f2937; white-space: pre-wrap; word-break: break-word; }
  .dsd-qa b { color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; }
  .dsd-empty-ann { font-size: 13px; color: #94a3b8; padding: 14px; background: #f8fafc; border-radius: 9px; text-align: center; }

  .dsd-error { background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 16px 20px; color: #dc2626; font-size: 14px; }
  .dsd-loading { text-align: center; padding: 80px 24px; color: #94a3b8; font-size: 14px; }
`;

// ── Pieces ───────────────────────────────────────────────────────────────────

function Spinner({ size = 28 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#4f46e5"
      strokeWidth="2"
      style={{ animation: "dsd-spin 1s linear infinite" }}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function StatCard({ Icon, value, label }) {
  return (
    <div className="dsd-stat">
      <div className="dsd-stat-icon">
        <Icon size={17} strokeWidth={2.3} />
      </div>
      <div>
        <div className="dsd-stat-value">{value}</div>
        <div className="dsd-stat-label">{label}</div>
      </div>
    </div>
  );
}

function DistBars({ items }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="dsd-dist">
      {items.map((it) => {
        const c = labelColor(it.label);
        return (
          <div className="dsd-dist-row" key={it.label}>
            <span className="dsd-dist-label" style={{ color: c.text }} title={it.label}>
              {it.label}
            </span>
            <div className="dsd-dist-track">
              <div style={{ width: `${(it.count / max) * 100}%`, background: c.solid }} />
            </div>
            <span className="dsd-dist-count">{formatNumber(it.count)}</span>
          </div>
        );
      })}
    </div>
  );
}

function constraintText(a) {
  const c = a.constraints || {};
  const parts = [];
  if (a.kind === "text") {
    if (c.min_words) parts.push(`min ${c.min_words} words`);
    if (c.max_words) parts.push(`max ${c.max_words} words`);
  } else if (a.kind === "audio") {
    if (c.min_duration_seconds) parts.push(`min ${c.min_duration_seconds}s`);
    if (c.max_duration_seconds) parts.push(`max ${c.max_duration_seconds}s`);
    if (c.allowed_formats?.length) parts.push(c.allowed_formats.join("/").toUpperCase());
  }
  if (c.language) parts.push(c.language);
  return parts.join(" · ");
}

function targetLabel(task, assetsByKey, tasksByKey) {
  const t = task.target || {};
  if (t.type === "ASSET") return `on ${assetsByKey[t.ref]?.name || t.ref}`;
  if (t.type === "TASK_OUTPUT") return `on the output of ${tasksByKey[t.ref]?.name || t.ref}`;
  return "on the whole sample";
}

// ── Audio with annotation timeline ───────────────────────────────────────────

function AudioAsset({ asset, lanes }) {
  const ref = useRef(null);
  const [time, setTime] = useState(0);
  const [metaDur, setMetaDur] = useState(0);
  const [failed, setFailed] = useState(false);

  if (!asset.audio_url || failed) {
    return <div className="dsd-empty-ann">Audio file unavailable.</div>;
  }

  const total = asset.duration || metaDur || 0;

  const seek = (t) => {
    if (!ref.current) return;
    ref.current.currentTime = t;
    ref.current.play().catch(() => {});
  };

  return (
    <div className="dsd-audio">
      <audio
        ref={ref}
        controls
        preload="none"
        src={asset.audio_url}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setMetaDur(e.currentTarget.duration || 0)}
        onError={() => setFailed(true)}
      />

      {lanes?.length > 0 && total > 0 && (
        <div className="dsd-lanes">
          {lanes.map((lane, li) => (
            <div key={li}>
              <div className="dsd-lane-label">{lane.label}</div>
              <div className="dsd-lane-track">
                {lane.spans.map((s, i) => {
                  const c = labelColor(s.label);
                  const left = Math.min(100, (s.start_time / total) * 100);
                  const width = Math.max(1.2, ((s.end_time - s.start_time) / total) * 100);
                  return (
                    <button
                      key={i}
                      className="dsd-seg"
                      title={`${s.label} · ${formatClock(s.start_time)}–${formatClock(s.end_time)}`}
                      style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, background: c.solid, color: "#fff" }}
                      onClick={() => seek(s.start_time)}
                    >
                      {s.label}
                    </button>
                  );
                })}
                <div className="dsd-playhead" style={{ left: `${Math.min(100, (time / total) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Text with highlighted spans ──────────────────────────────────────────────

function HighlightedText({ text, spans }) {
  const sorted = [...spans]
    .filter((s) => typeof s.start === "number" && typeof s.end === "number")
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const parts = [];
  let cursor = 0;
  sorted.forEach((s, i) => {
    const start = Math.max(s.start, cursor);
    const end = Math.min(s.end, text.length);
    if (end <= start) return;
    if (start > cursor) parts.push(<span key={`t${i}`}>{text.slice(cursor, start)}</span>);
    const c = labelColor(s.label);
    parts.push(
      <mark key={`m${i}`} style={{ background: c.bg, color: c.text, boxShadow: `inset 0 -2px 0 ${c.solid}` }}>
        {text.slice(start, end)}
        <em>{s.label}</em>
      </mark>
    );
    cursor = end;
  });
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);

  return (
    <p dir="auto" className="dsd-text">
      {parts}
    </p>
  );
}

// ── Annotations ──────────────────────────────────────────────────────────────

function AnswerView({ task, value, targetText }) {
  const v = value || {};

  if (task.answer === "labels") {
    return (
      <div className="dsd-chips">
        {(v.labels || []).map((l) => {
          const c = labelColor(l);
          return (
            <span key={l} className="dsd-chip" style={{ background: c.bg, color: c.text }}>
              {l}
            </span>
          );
        })}
      </div>
    );
  }

  if (task.answer === "spans") {
    const spans = v.spans || [];
    if (v.none || spans.length === 0) return <div className="dsd-muted">No spans marked.</div>;

    if (spans[0].start_time !== undefined) {
      // audio spans: also drawn on the player's timeline
      return (
        <div className="dsd-chips">
          {spans.map((s, i) => {
            const c = labelColor(s.label);
            return (
              <span key={i} className="dsd-chip" style={{ background: c.bg, color: c.text }}>
                {s.label} <small>{formatClock(s.start_time)}–{formatClock(s.end_time)}</small>
              </span>
            );
          })}
        </div>
      );
    }

    if (targetText) return <HighlightedText text={targetText} spans={spans} />;

    return (
      <div className="dsd-chips">
        {spans.map((s, i) => {
          const c = labelColor(s.label);
          return (
            <span key={i} className="dsd-chip" style={{ background: c.bg, color: c.text }}>
              {s.label} {s.text && <small>“{s.text}”</small>}
            </span>
          );
        })}
      </div>
    );
  }

  if (task.answer === "qa") {
    return (
      <div className="dsd-qa" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div>
          <b>Question</b>
          <p dir="auto" className="dsd-answer">{v.question}</p>
        </div>
        <div>
          <b>Answer</b>
          <p dir="auto" className="dsd-answer">{v.answer}</p>
        </div>
      </div>
    );
  }

  return (
    <p dir="auto" className="dsd-answer">
      {v.text}
    </p>
  );
}

function AnnotationBlock({ task, entries, sample, assetsByKey, tasksByKey }) {
  const targetAsset = task.target?.type === "ASSET" ? sample.assets.find((a) => a.key === task.target.ref) : null;
  const targetText = targetAsset?.kind === "text" ? targetAsset.text : null;

  return (
    <div className="dsd-ann">
      <div className="dsd-ann-head">
        <span className="dsd-ann-name">{task.name}</span>
        <span className="dsd-ann-type">{taskLabel(task.type, task.label).toUpperCase()}</span>
        <span className="dsd-ann-target">{targetLabel(task, assetsByKey, tasksByKey)}</span>
      </div>

      {entries.map((e, i) => (
        <div className="dsd-entry" key={i}>
          {entries.length > 1 && <div className="dsd-entry-who">{e.annotator}</div>}
          <AnswerView task={task} value={e.value} targetText={targetText} />
        </div>
      ))}
    </div>
  );
}

// ── One sample ───────────────────────────────────────────────────────────────

function SampleCard({ sample, tasks, assetsByKey, tasksByKey }) {
  // audio-span annotations are drawn on the matching player
  const lanes = {};
  tasks.forEach((t) => {
    if (t.answer !== "spans" || t.target?.type !== "ASSET") return;
    const asset = sample.assets.find((a) => a.key === t.target.ref);
    if (!asset || asset.kind !== "audio") return;
    (sample.annotations[t.key] || []).forEach((e) => {
      const spans = (e.value?.spans || []).filter((s) => s.start_time !== undefined);
      if (!spans.length) return;
      (lanes[asset.key] = lanes[asset.key] || []).push({ label: `${t.name} · ${e.annotator}`, spans });
    });
  });

  const annotatedTasks = tasks.filter((t) => (sample.annotations[t.key] || []).length > 0);

  return (
    <div className="dsd-sample">
      <div className="dsd-sample-head">
        <span className="dsd-sample-num">Sample #{sample.number}</span>
        <span className="dsd-mono">{sample.id.slice(0, 8)}</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>
          {annotatedTasks.length > 0
            ? `${annotatedTasks.length}/${tasks.length} tasks annotated`
            : "Not annotated"}
        </span>
      </div>

      <div className="dsd-sample-body">
        <div className="dsd-col">
          <div className="dsd-col-title">Data</div>
          {sample.assets.length === 0 && <div className="dsd-muted">No assets stored for this sample.</div>}
          {sample.assets.map((a) => (
            <div key={a.key}>
              <div className="dsd-asset-name">
                {a.kind === "audio" ? <Headphones size={13} /> : <FileText size={13} />}
                {a.name}
                <small>
                  {a.kind === "audio"
                    ? formatDuration(a.duration)
                    : `${(a.text || "").trim().split(/\s+/).filter(Boolean).length} words`}
                  {a.language ? ` · ${a.language}` : ""}
                </small>
              </div>
              {a.kind === "audio" ? (
                <AudioAsset asset={a} lanes={lanes[a.key]} />
              ) : (
                <p dir="auto" className="dsd-text">{a.text}</p>
              )}
            </div>
          ))}
        </div>

        <div className="dsd-col">
          <div className="dsd-col-title">Annotations</div>
          {tasks.length === 0 && <div className="dsd-muted">This dataset has no annotation tasks.</div>}
          {tasks.length > 0 && annotatedTasks.length === 0 && (
            <div className="dsd-empty-ann">No annotations were submitted for this sample.</div>
          )}
          {annotatedTasks.map((t) => (
            <AnnotationBlock
              key={t.key}
              task={t}
              entries={sample.annotations[t.key]}
              sample={sample}
              assetsByKey={assetsByKey}
              tasksByKey={tasksByKey}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Statistics ───────────────────────────────────────────────────────────────

function Statistics({ detail }) {
  const { stats } = detail;
  const days = stats.samples_per_day.slice(-60);
  const maxDay = Math.max(1, ...days.map((d) => d.count));
  const coverage = stats.total_samples ? Math.round((stats.annotated_samples / stats.total_samples) * 100) : 0;
  const hasAudio = stats.assets.some((a) => a.kind === "audio");

  return (
    <>
      <div className="dsd-stats">
        <StatCard Icon={Database} value={formatNumber(stats.total_samples)} label="Samples" />
        <StatCard Icon={UsersRound} value={formatNumber(stats.contributors)} label="Contributors" />
        <StatCard Icon={CheckCircle2} value={`${coverage}%`} label={`Annotated (${formatNumber(stats.annotated_samples)})`} />
        <StatCard Icon={Tags} value={formatNumber(stats.annotations)} label={`Annotations · ${stats.annotators} annotators`} />
        {hasAudio && <StatCard Icon={Clock} value={formatDuration(stats.audio_seconds)} label="Total audio" />}
      </div>

      {/* Structure */}
      <div className="dsd-section">
        <h2 className="dsd-h2">Sample structure</h2>
        <div className="dsd-grid2">
          <div className="dsd-card">
            <div className="dsd-card-title" style={{ marginBottom: 10 }}>Assets in each sample</div>
            <div className="dsd-struct">
              {detail.assets.map((a) => (
                <div className="dsd-struct-row" key={a.key}>
                  {a.kind === "audio" ? <Headphones size={15} color="#1565c0" /> : <FileText size={15} color="#3b5bdb" />}
                  <b>{a.name}</b>
                  <small>{constraintText(a) || a.type}</small>
                </div>
              ))}
              {detail.assets.length === 0 && <span className="dsd-muted">No assets defined.</span>}
            </div>
          </div>

          <div className="dsd-card">
            <div className="dsd-card-title" style={{ marginBottom: 10 }}>Annotation tasks</div>
            <div className="dsd-struct">
              {detail.tasks.map((t) => (
                <div className="dsd-struct-row" key={t.key}>
                  <Tags size={15} color="#6d28d9" />
                  <b>{t.name}</b>
                  <small>
                    {taskLabel(t.type, t.label)}
                    <br />
                    {targetLabel(t, Object.fromEntries(detail.assets.map((a) => [a.key, a])), Object.fromEntries(detail.tasks.map((x) => [x.key, x])))}
                  </small>
                </div>
              ))}
              {detail.tasks.length === 0 && <span className="dsd-muted">No annotation tasks defined.</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Data statistics */}
      <div className="dsd-section">
        <h2 className="dsd-h2">Data statistics</h2>
        <div className="dsd-grid2">
          {stats.assets.map((a) => (
            <div className="dsd-card" key={a.key}>
              <div className="dsd-card-head">
                <div>
                  <div className="dsd-card-title">{a.name}</div>
                  <div className="dsd-card-note">{a.kind === "audio" ? "Audio clips" : "Text"}</div>
                </div>
              </div>
              {a.kind === "audio" ? (
                <div className="dsd-kv">
                  <div><b>{formatNumber(a.count)}</b><span>Clips</span></div>
                  <div><b>{formatDuration(a.total_seconds)}</b><span>Total</span></div>
                  <div><b>{formatDuration(a.avg_seconds)}</b><span>Average</span></div>
                </div>
              ) : (
                <div className="dsd-kv">
                  <div><b>{formatNumber(a.count)}</b><span>Texts</span></div>
                  <div><b>{a.avg_words ?? "—"}</b><span>Avg words</span></div>
                  <div><b>{formatNumber(a.max_words)}</b><span>Longest (words)</span></div>
                </div>
              )}
            </div>
          ))}

          {days.length > 1 && (
            <div className="dsd-card">
              <div className="dsd-card-head">
                <div>
                  <div className="dsd-card-title">Contributions over time</div>
                  <div className="dsd-card-note">
                    {formatDate(stats.first_submitted)} → {formatDate(stats.last_submitted)}
                  </div>
                </div>
              </div>
              <div className="dsd-spark">
                {days.map((d) => (
                  <div key={d.date} title={`${d.date}: ${d.count}`} style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: 2 }} />
                ))}
              </div>
            </div>
          )}

          {stats.top_contributors.length > 0 && (
            <div className="dsd-card">
              <div className="dsd-card-title" style={{ marginBottom: 12 }}>Top contributors</div>
              <DistBars items={stats.top_contributors.map((c) => ({ label: c.name, count: c.count }))} />
            </div>
          )}
        </div>
      </div>

      {/* Annotation statistics */}
      {stats.tasks.length > 0 && (
        <div className="dsd-section">
          <h2 className="dsd-h2">Annotation statistics</h2>
          <div className="dsd-grid2">
            {stats.tasks.map((t) => (
              <div className="dsd-card" key={t.key}>
                <div className="dsd-card-head">
                  <div>
                    <div className="dsd-card-title">{t.name}</div>
                    <div className="dsd-card-note">{taskLabel(t.type, t.label)}</div>
                  </div>
                </div>

                <div className="dsd-kv" style={{ marginBottom: t.distribution.length || t.avg_words != null ? 14 : 0 }}>
                  <div><b>{formatNumber(t.annotations)}</b><span>Annotations</span></div>
                  <div><b>{formatNumber(t.samples)}</b><span>Samples</span></div>
                  {t.total_spans != null ? (
                    <div><b>{formatNumber(t.total_spans)}</b><span>Spans</span></div>
                  ) : t.avg_words != null ? (
                    <div><b>{t.avg_words}</b><span>Avg words</span></div>
                  ) : (
                    <div><b>{formatNumber(t.annotators)}</b><span>Annotators</span></div>
                  )}
                </div>

                {t.distribution.length > 0 && <DistBars items={t.distribution} />}
                {t.annotations === 0 && <div className="dsd-muted">No annotations yet.</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ── Sample browser ───────────────────────────────────────────────────────────

function SampleBrowser({ detail }) {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("all");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const topRef = useRef(null);
  const firstRender = useRef(true);

  const assetsByKey = Object.fromEntries(detail.assets.map((a) => [a.key, a]));
  const tasksByKey = Object.fromEntries(detail.tasks.map((t) => [t.key, t]));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiGet(`/datasets/hub/${detail.id}/samples?page=${page}&page_size=8&annotated=${filter}`)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [detail.id, page, filter]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [page, filter]);

  return (
    <div className="dsd-section" ref={topRef} style={{ scrollMarginTop: 70 }}>
      <div className="dsd-toolbar">
        <h2 className="dsd-h2">
          Samples
          {data && <small>{formatNumber(data.total)} {filter === "all" ? "total" : "matching"}</small>}
        </h2>
        <select
          className="dsd-select"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">All samples</option>
          <option value="yes">Annotated only</option>
          <option value="no">Not annotated</option>
        </select>
      </div>

      {error && <div className="dsd-error">Failed to load samples: {error}</div>}

      {loading && !data && (
        <div className="dsd-loading"><Spinner /></div>
      )}

      {data && data.items.length === 0 && !loading && (
        <div className="dsd-card dsd-muted" style={{ textAlign: "center" }}>No samples match this filter.</div>
      )}

      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, opacity: loading ? 0.55 : 1, transition: "opacity .15s" }}>
          {data.items.map((s) => (
            <SampleCard key={s.id} sample={s} tasks={detail.tasks} assetsByKey={assetsByKey} tasksByKey={tasksByKey} />
          ))}
        </div>
      )}

      {data && data.pages > 1 && (
        <div className="dsd-pager">
          <button className="dsd-btn" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft size={14} /> Previous
          </button>
          <span>Page {data.page} of {data.pages}</span>
          <button className="dsd-btn" disabled={page >= data.pages || loading} onClick={() => setPage((p) => p + 1)}>
            Next <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DatasetDetail() {
  const { competitionId } = useParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await apiGet(`/datasets/hub/${competitionId}`));
    } catch (e) {
      setError({ message: e.message, status: e.status });
    } finally {
      setLoading(false);
    }
  }, [competitionId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleExport(format) {
    setExporting(format);
    try {
      await downloadExport(competitionId, format);
    } catch (e) {
      alert("Export failed: " + e.message);
    } finally {
      setExporting(null);
    }
  }

  return (
    <>
      <style>{CSS}</style>

      <div style={{ display: "flex", minHeight: "100vh", background: "#f7f8fc" }}>
        <Sidebar />

        <div style={{ flex: 1, minWidth: 0 }}>
          <Topbar title="Datasets" subtitle={detail ? detail.title : "Dataset details"} />

          <main className="dsd-page">
            <button className="dsd-back" onClick={() => navigate("/datasets")}>
              <ArrowLeft size={14} strokeWidth={2.5} /> All datasets
            </button>

            {loading && <div className="dsd-loading"><Spinner /><div style={{ marginTop: 12 }}>Loading dataset…</div></div>}

            {error && !loading && (
              <div className="dsd-error">
                {error.status === 403 && <Lock size={14} style={{ marginRight: 8, verticalAlign: "-2px" }} />}
                {error.message}
              </div>
            )}

            {detail && !loading && (
              <>
                <div className="dsd-head">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h1 className="dsd-title">{detail.title}</h1>
                    <p className="dsd-sub">{detail.description || "No description provided."}</p>
                    <div className="dsd-meta">
                      <span className="dsd-badge"><Lock size={11} /> Competition closed {formatDate(detail.ended_at)}</span>
                      <span>
                        Source:{" "}
                        <span className="dsd-link" onClick={() => navigate(`/competitions/${detail.source_competition_id}`)}>
                          {detail.source_competition_title}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="dsd-actions">
                    <button className="dsd-btn" disabled={!!exporting} onClick={() => handleExport("jsonl")}>
                      <Download size={13} strokeWidth={2.5} /> {exporting === "jsonl" ? "Exporting…" : "JSONL"}
                    </button>
                    <button className="dsd-btn" disabled={!!exporting} onClick={() => handleExport("csv")}>
                      <Download size={13} strokeWidth={2.5} /> {exporting === "csv" ? "Exporting…" : "CSV"}
                    </button>
                  </div>
                </div>

                <Statistics detail={detail} />
                <SampleBrowser detail={detail} />
              </>
            )}
          </main>
        </div>
      </div>
    </>
  );
}