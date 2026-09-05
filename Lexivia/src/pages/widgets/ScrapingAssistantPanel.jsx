/**
 * widgets/ScrapingAssistantPanel.jsx
 *
 * Changes in this version
 * ───────────────────────
 * 1. TASK-AWARE TABS   — Audio tasks (AUDIO_*) only show the "Video / Audio"
 *    source tab.  Text tasks show both tabs but the webpage tab is the default.
 *    The user is warned (not blocked) if they pick the "wrong" mode.
 *
 * 2. CONFIG FROM DB    — ManualAnnotationForm and AnnotationPreview now receive
 *    the real `config` prop (competition's dataset_config merged with defaults)
 *    instead of the previous hard-coded `config={{}}`.
 *
 * 3. SCRAPING EXAMPLES — The info card for each source type now lists example
 *    URLs the user can try (and what won't work).
 *
 * 4. YOUTUBE COMMENTS  — The "Comments" content type now shows a note that
 *    YouTube URLs are handled automatically via yt-dlp on the backend.
 */

import { useRef, useState, useEffect } from "react";

const API = "http://127.0.0.1:8000";
function authHeader() {
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// ─── Authenticated audio preview ───────────────────────────────────────────────
// A plain <audio src="..."> can't send an Authorization header, but
// /scrape/audio-file requires one — so the browser's native request always
// 422s. Instead we fetch the file ourselves (with the header) and hand the
// <audio> element an in-memory blob URL.
function AudioPreview({ src }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [failed, setFailed]   = useState(false);

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;

    setBlobUrl(null);
    setFailed(false);

    fetch(src, { headers: authHeader() })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then(blob => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (failed) {
    return (
      <div style={{ fontSize: 11, color: "#b91c1c", marginBottom: 8 }}>
        Couldn't load audio.
      </div>
    );
  }
  if (!blobUrl) {
    return (
      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>
        Loading audio…
      </div>
    );
  }
  return (
    <audio src={blobUrl} controls style={{ width: "100%", marginBottom: 8, height: 32 }} />
  );
}

// ─── Task type helpers ────────────────────────────────────────────────────────

const AUDIO_TASK_TYPES = new Set([
  "AUDIO_SYNTHESIS", "AUDIO_TRANSCRIPTION", "SPEECH_EMOTION", "AUDIO_EVENT_DETECTION",
]);

// ─── Small UI primitives ──────────────────────────────────────────────────────

function PhaseStep({ n, label, active, done }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: done || active ? 1 : 0.35 }}>
      <div style={{
        width: 26, height: 26, borderRadius: "50%", display: "flex",
        alignItems: "center", justifyContent: "center", fontWeight: 700,
        fontSize: 11, flexShrink: 0,
        background: done ? "#dcfce7" : active ? "#dbeafe" : "#f3f4f6",
        border: done ? "1.5px solid #86efac" : active ? "1.5px solid #3b82f6" : "1.5px solid #e8edf8",
        color: done ? "#15803d" : active ? "#1d4ed8" : "#9ca3af",
      }}>
        {done ? "✓" : n}
      </div>
      <span style={{ fontSize: 12, fontWeight: active ? 700 : 400, color: active ? "#1359db" : "#6f778c" }}>
        {label}
      </span>
    </div>
  );
}

function ConfidencePill({ confidence, status }) {
  if (status === "failed")   return <span style={pill("#fee2e2","#b91c1c")}>AI Failed</span>;
  if (status === "skipped")  return <span style={pill("#f3f4f6","#6b7280")}>Skipped</span>;
  const pct = Math.round((confidence ?? 0) * 100);
  const color = pct >= 80 ? "#15803d" : pct >= 55 ? "#92400e" : "#b91c1c";
  const bg    = pct >= 80 ? "#dcfce7"  : pct >= 55 ? "#fef3c7"  : "#fee2e2";
  return <span style={pill(bg, color)}>AI {pct}%</span>;
}
function pill(bg, color) {
  return { fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
    background: bg, color, border: `1px solid ${color}33` };
}

function ReviewStatusBadge({ status }) {
  const map = {
    pending:  ["#f3f4f6", "#6b7280", "Pending"],
    approved: ["#dcfce7", "#15803d", "✓ Approved"],
    rejected: ["#fee2e2", "#b91c1c", "✕ Rejected"],
    edited:   ["#eff6ff", "#1d4ed8", "✎ Edited"],
  };
  const [bg, color, label] = map[status] || map.pending;
  return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px",
    borderRadius: 20, background: bg, color, border: `1px solid ${color}33` }}>{label}</span>;
}

// ─── Annotation diff viewer ───────────────────────────────────────────────────
function AnnotationPreview({ annotation, taskType }) {
  if (!annotation) return <span style={{ color: "#9ca3af", fontSize: 12 }}>—</span>;

  const rows = [];

  if (taskType === "TEXT_CLASSIFICATION" || taskType === "SENTIMENT_ANALYSIS") {
    if (annotation.label)      rows.push(["Label",      annotation.label]);
    if (annotation.sentiment)  rows.push(["Sentiment",  annotation.sentiment]);
    if (annotation.confidence) rows.push(["Confidence", `${Math.round(annotation.confidence * 100)}%`]);
  } else if (taskType === "NER") {
    rows.push(["Entities", (annotation.entities || []).map(e => `${e.text} [${e.label}]`).join(", ") || "—"]);
  } else if (taskType === "SUMMARIZATION") {
    rows.push(["Summary", annotation.summary || "—"]);
  } else if (taskType === "TRANSLATION") {
    rows.push(["Translation", annotation.translation || "—"]);
  } else if (taskType === "QUESTION_ANSWERING") {
    if (annotation.question) rows.push(["Q", annotation.question]);
    if (annotation.answer)   rows.push(["A", annotation.answer]);
  } else if (taskType === "AUDIO_SYNTHESIS" || taskType === "AUDIO_TRANSCRIPTION") {
    rows.push(["Transcript", annotation.transcript || "—"]);
  } else if (taskType === "SPEECH_EMOTION") {
    if (annotation.emotion)        rows.push(["Emotion",   annotation.emotion]);
    if (annotation.intensity != null) rows.push(["Intensity", `${Math.round(annotation.intensity * 100)}%`]);
  } else if (taskType === "AUDIO_EVENT_DETECTION") {
    rows.push(["Events", (annotation.events || []).map(e => e.label).join(", ") || "—"]);
  } else {
    for (const [k, v] of Object.entries(annotation)) {
      if (typeof v !== "object") rows.push([k, String(v)]);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {rows.map(([k, v], i) => (
        <div key={i} style={{ display: "flex", gap: 6, fontSize: 11 }}>
          <span style={{ fontWeight: 700, color: "#6f778c", flexShrink: 0, minWidth: 72,
            textTransform: "uppercase", letterSpacing: "0.04em", fontSize: 10 }}>{k}</span>
          <span style={{ color: "#1e293b", wordBreak: "break-word", lineHeight: 1.4 }}>
            {String(v).length > 140 ? String(v).slice(0, 140) + "…" : String(v)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Manual annotation form per task type ────────────────────────────────────
function ManualAnnotationForm({ item, taskType, config, value, onChange }) {
  // FIX 2: config now comes from the real competition prop (not hard-coded {})
  const labels       = config?.labels         || ["Finance","Technology","Healthcare","Politics","Sports","Other"];
  const entityTypes  = config?.entity_types   || ["PER","ORG","LOC","MISC","DATE"];
  const emotionLabels = config?.emotion_labels || ["neutral","happy","sad","angry","surprised","fearful"];
  const srcLang      = config?.source_lang    || "EN";
  const tgtLang      = config?.target_lang    || "AR";

  const set = (key, val) => onChange({ ...value, [key]: val });
  const toggle = (key, v) => {
    const arr = value[key] || [];
    set(key, arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
  };

  const inputStyle = {
    width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e8edf8",
    fontFamily: "inherit", fontSize: 13, color: "#1e293b", background: "#fff",
    outline: "none", boxSizing: "border-box",
  };
  const taStyle = { ...inputStyle, minHeight: 80, resize: "vertical" };

  if (taskType === "TEXT_CLASSIFICATION") return (
    <div>
      <p className="dc-field-label">SELECT LABELS</p>
      <div className="dc-label-row" style={{ flexWrap: "wrap" }}>
        {labels.map(l => (
          <button key={l} type="button"
            className={`dc-label-tag ${(value.labels||[]).includes(l) ? "active" : ""}`}
            onClick={() => toggle("labels", l)}>#{l}</button>
        ))}
      </div>
    </div>
  );

  if (taskType === "SENTIMENT_ANALYSIS") return (
    <div>
      <p className="dc-field-label">SENTIMENT</p>
      <div className="dc-label-row">
        {["positive","negative","neutral","mixed"].map(s => (
          <button key={s} type="button"
            className={`dc-label-tag ${value.sentiment === s ? "active" : ""}`}
            onClick={() => set("sentiment", s)}>{s.toUpperCase()}</button>
        ))}
      </div>
    </div>
  );

  if (taskType === "NER") return (
    <div>
      <p className="dc-field-label">ENTITIES (JSON array)</p>
      <textarea style={taStyle} placeholder='[{"text":"OpenAI","label":"ORG"}]'
        value={typeof value.entities === "string" ? value.entities : JSON.stringify(value.entities||[])}
        onChange={e => { try { set("entities", JSON.parse(e.target.value)); } catch { set("entities", e.target.value); } }} />
      <p style={{ fontSize: 10, color: "#9ca3af", marginTop: 4 }}>
        Types: {entityTypes.join(", ")}
      </p>
    </div>
  );

  if (taskType === "SUMMARIZATION") return (
    <div>
      <p className="dc-field-label">SUMMARY</p>
      <textarea style={taStyle} placeholder="Write a concise summary…"
        value={value.summary || ""}
        onChange={e => set("summary", e.target.value)} />
    </div>
  );

  if (taskType === "TRANSLATION") return (
    <div>
      <p className="dc-field-label">TRANSLATION ({srcLang} → {tgtLang})</p>
      <textarea style={taStyle} placeholder={`Enter ${tgtLang} translation…`}
        value={value.translation || ""}
        onChange={e => set("translation", e.target.value)} />
    </div>
  );

  if (taskType === "QUESTION_ANSWERING") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <p className="dc-field-label">QUESTION</p>
        <input style={inputStyle} placeholder="Write a question about the text…"
          value={value.question || ""} onChange={e => set("question", e.target.value)} />
      </div>
      <div>
        <p className="dc-field-label">ANSWER</p>
        <input style={inputStyle} placeholder="Answer…"
          value={value.answer || ""} onChange={e => set("answer", e.target.value)} />
      </div>
    </div>
  );

  if (taskType === "AUDIO_SYNTHESIS" || taskType === "AUDIO_TRANSCRIPTION") return (
    <div>
      <p className="dc-field-label">TRANSCRIPT</p>
      <textarea style={taStyle} placeholder="Type the verbatim transcript…"
        value={value.transcript || ""}
        onChange={e => set("transcript", e.target.value)} />
    </div>
  );

  if (taskType === "SPEECH_EMOTION") return (
    <div>
      <p className="dc-field-label">EXPRESSED EMOTION</p>
      <div className="dc-label-row" style={{ flexWrap: "wrap" }}>
        {emotionLabels.map(e => (
          <button key={e} type="button"
            className={`dc-label-tag ${value.emotion === e ? "active" : ""}`}
            onClick={() => set("emotion", e)}>{e.toUpperCase()}</button>
        ))}
      </div>
      {value.emotion && (
        <div style={{ marginTop: 10 }}>
          <p className="dc-field-label">INTENSITY: {value.intensity ?? 60}%</p>
          <input type="range" min={0} max={100} value={value.intensity ?? 60}
            onChange={e => set("intensity", Number(e.target.value))}
            style={{ width: "100%", accentColor: "#1359db" }} />
        </div>
      )}
    </div>
  );

  // Generic fallback
  return (
    <div>
      <p className="dc-field-label">ANNOTATION (JSON)</p>
      <textarea style={taStyle} placeholder='{"label": "…"}'
        value={typeof value === "string" ? value : JSON.stringify(value, null, 2)}
        onChange={e => { try { onChange(JSON.parse(e.target.value)); } catch { onChange(e.target.value); } }} />
    </div>
  );
}

// ─── Item review card ─────────────────────────────────────────────────────────
function ItemCard({ item, taskType, config, onApprove, onReject, onEdit, isEditing, editValue, onEditChange, onEditSave }) {
  const isAudio    = item.type === "audio";
  const needsManual = item.ai_status !== "success";

  return (
    <div style={{
      background: "#fff", border: `1.5px solid ${
        item.review_status === "approved" ? "#86efac" :
        item.review_status === "rejected" ? "#fca5a5" : "#e8edf8"
      }`,
      borderRadius: 12, padding: "14px 16px", marginBottom: 10,
      transition: "border-color 0.2s",
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", fontFamily: "monospace" }}>
            #{String(item.id).slice(0,8).toUpperCase()}
          </span>
          <span style={{ fontSize: 10, background: isAudio ? "#eff6ff" : "#f0fdf4",
            color: isAudio ? "#1d4ed8" : "#166534", border: `1px solid ${isAudio ? "#bfdbfe" : "#bbf7d0"}`,
            borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>
            {isAudio ? "◉ AUDIO" : "▤ TEXT"}
          </span>
          <ConfidencePill confidence={item.ai_confidence} status={item.ai_status} />
          <ReviewStatusBadge status={item.review_status} />
        </div>

        {item.review_status === "pending" && !needsManual && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button type="button" onClick={onEdit}
              style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1.5px solid #e8edf8",
                background: "#f7f8fc", color: "#6f778c", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
              ✎ Edit
            </button>
            <button type="button" onClick={onReject}
              style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1.5px solid #fca5a5",
                background: "#fee2e2", color: "#b91c1c", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
              ✕
            </button>
            <button type="button" onClick={onApprove}
              style={{ fontSize: 11, padding: "4px 12px", borderRadius: 6, border: "1.5px solid #86efac",
                background: "#dcfce7", color: "#15803d", cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>
              ✓ Approve
            </button>
          </div>
        )}

        {(item.review_status === "approved" || item.review_status === "rejected" || item.review_status === "edited") && (
          <button type="button" onClick={onReject}
            style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1.5px solid #e8edf8",
              background: "#f7f8fc", color: "#6f778c", cursor: "pointer", fontFamily: "inherit" }}>
            Undo
          </button>
        )}
      </div>

      {/* Content preview */}
      <div style={{ marginBottom: 10 }}>
        {isAudio && item.audio_url && (
          <AudioPreview src={`${API}/scrape/audio-file?path=${encodeURIComponent(item.audio_url)}`} />
        )}
        {item.text_content && (
          <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.6, padding: "8px 12px",
            background: "#f7f8fc", borderRadius: 8, border: "1px solid #e8edf8",
            maxHeight: 80, overflow: "auto" }}>
            {item.text_content.length > 300 ? item.text_content.slice(0, 300) + "…" : item.text_content}
          </div>
        )}
        {item.source_label && (
          <p style={{ fontSize: 10, color: "#9ca3af", marginTop: 4 }}>
            Source: {item.source_label}
          </p>
        )}
      </div>

      {/* AI annotation or manual form */}
      {needsManual ? (
        <div style={{ padding: "10px 12px", background: "#fff7ed",
          border: "1.5px dashed #fed7aa", borderRadius: 8 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#92400e", marginBottom: 8 }}>
            ⚠ AI could not annotate this item — annotate manually below
          </p>
          {/* FIX 2: pass real config, not hard-coded {} */}
          <ManualAnnotationForm item={item} taskType={taskType}
            value={editValue || {}} onChange={onEditChange} config={config || {}} />
          <button type="button" onClick={onEditSave}
            style={{ marginTop: 10, fontSize: 12, padding: "6px 16px", borderRadius: 8,
              border: "1.5px solid #86efac", background: "#dcfce7", color: "#15803d",
              cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>
            ✓ Save & Approve
          </button>
        </div>
      ) : isEditing ? (
        <div style={{ padding: "10px 12px", background: "#eff6ff",
          border: "1.5px solid #bfdbfe", borderRadius: 8 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#1e40af", marginBottom: 8 }}>
            Edit AI suggestion
          </p>
          {/* FIX 2: pass real config */}
          <ManualAnnotationForm item={item} taskType={taskType}
            value={editValue || item.annotation_suggestion || {}} onChange={onEditChange} config={config || {}} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="button" onClick={onEditSave}
              style={{ fontSize: 12, padding: "6px 16px", borderRadius: 8,
                border: "1.5px solid #86efac", background: "#dcfce7", color: "#15803d",
                cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>
              ✓ Save
            </button>
            <button type="button" onClick={onEdit}
              style={{ fontSize: 12, padding: "6px 12px", borderRadius: 8,
                border: "1.5px solid #e8edf8", background: "#f7f8fc", color: "#6f778c",
                cursor: "pointer", fontFamily: "inherit" }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ padding: "10px 12px", background: "#f7f8fc",
          border: "1px solid #e8edf8", borderRadius: 8 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af",
            letterSpacing: "0.06em", marginBottom: 6 }}>AI ANNOTATION</p>
          <AnnotationPreview annotation={item.annotation_suggestion} taskType={taskType} />
        </div>
      )}
    </div>
  );
}


// ─── Source-type info cards ───────────────────────────────────────────────────

function VideoInfoCard({ taskType, isAudioTask }) {
  return (
    <>
      <p style={{ fontWeight: 700, color: "#374151", marginBottom: 4 }}>
        ▶ Video extraction
      </p>
      <p style={{ marginBottom: 6 }}>
        Paste any YouTube, Vimeo, Twitter/X, or other yt-dlp-compatible URL.
        The backend extracts embedded subtitles/captions — each segment becomes
        one sample{isAudioTask ? " with its audio clip" : ""}.
      </p>
      <p style={{ fontWeight: 600, color: "#374151", marginBottom: 2, fontSize: 11 }}>
        ✅ Try these:
      </p>
      <ul style={{ margin: "0 0 6px 14px", padding: 0, fontSize: 11, color: "#374151" }}>
        <li>youtube.com/watch?v=… (subtitles + audio if audio task)</li>
        <li>vimeo.com/…</li>
        <li>twitter.com/…/status/… (tweet text only)</li>
        <li>tiktok.com/@…/video/… (captions)</li>
      </ul>
      <p style={{ fontWeight: 600, color: "#92400e", marginBottom: 2, fontSize: 11 }}>
        ⚠ Limitations:
      </p>
      <ul style={{ margin: "0 0 0 14px", padding: 0, fontSize: 11, color: "#92400e" }}>
        <li>Auto-captions only when manual subtitles unavailable</li>
        <li>Age-restricted or private videos will fail</li>
      </ul>
      {!isAudioTask && (
        <span style={{ display: "block", marginTop: 8, color: "#92400e",
          background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 6,
          padding: "4px 10px", fontSize: 11 }}>
          ⚠ This is a text task ({taskType.replace(/_/g," ")}). Only subtitle
          text is used — no audio is downloaded.
        </span>
      )}
    </>
  );
}

function WebpageInfoCard({ contentType }) {
  const examples = {
    article: {
      good: [
        "bbc.com/news/… (news article)",
        "en.wikipedia.org/wiki/… (Wikipedia)",
        "arstechnica.com/… (tech blog)",
        "medium.com/@…/… (Medium post)",
        "theguardian.com/… (newspaper)",
      ],
      bad: ["Paywalled articles (only teaser visible)", "JS-heavy SPAs without SSR"],
    },
    comments: {
      good: [
        "old.reddit.com/r/…/comments/… (Reddit — use old.reddit.com)",
        "news.ycombinator.com/item?id=… (Hacker News)",
        "youtube.com/watch?v=… (YouTube — handled via yt-dlp ✓)",
        "Any Disqus-powered blog",
      ],
      bad: [
        "reddit.com (new Reddit — use old.reddit.com instead)",
        "Facebook / Instagram / TikTok / Twitter comments (JS-rendered)",
        "Yelp / Glassdoor (rate-limited + JS)",
      ],
    },
    captions: {
      good: [
        "Any page with a visible static transcript (e.g. podcast show-notes)",
        "ted.com/talks/… (static transcript tab)",
        "rev.com transcripts",
      ],
      bad: [
        "YouTube transcript panel (JS-rendered — use Video tab instead)",
        "Pages where transcripts are loaded dynamically",
      ],
    },
  };
  const ex = examples[contentType] || examples.article;

  return (
    <>
      <p style={{ fontWeight: 700, color: "#374151", marginBottom: 4 }}>
        ⊞ Webpage scraping
      </p>
      <p style={{ marginBottom: 6 }}>
        Paste a URL and choose what to extract. The AI annotates each item
        using your competition's task type.
      </p>
      <p style={{ fontWeight: 600, color: "#374151", marginBottom: 2, fontSize: 11 }}>
        ✅ Works well:
      </p>
      <ul style={{ margin: "0 0 6px 14px", padding: 0, fontSize: 11, color: "#374151" }}>
        {ex.good.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
      <p style={{ fontWeight: 600, color: "#b91c1c", marginBottom: 2, fontSize: 11 }}>
        ❌ Won't work:
      </p>
      <ul style={{ margin: "0 0 0 14px", padding: 0, fontSize: 11, color: "#b91c1c" }}>
        {ex.bad.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
    </>
  );
}


// ─── Main component ───────────────────────────────────────────────────────────
export default function ScrapingAssistantPanel({ competition, config, onSubmit, submitting, competitionId }) {
  const taskType    = competition?.task_type || "TEXT_CLASSIFICATION";
  const isAudioTask = AUDIO_TASK_TYPES.has(taskType);

  // FIX 1: audio tasks only get the "video" tab; text tasks get both (webpage default)
  const availableSourceTypes = isAudioTask
    ? [{ id: "video",   icon: "▶", label: "Video / Audio" }]
    : [
        { id: "webpage", icon: "⊞", label: "Webpage / Comments" },
        { id: "video",   icon: "▶", label: "Video (subtitles)" },
      ];

  const [sourceType, setSourceType]   = useState(isAudioTask ? "video" : "webpage");
  const [url, setUrl]                 = useState("");
  const [contentType, setContentType] = useState("captions");
  const [maxItems, setMaxItems]       = useState(15);
  const [clipDuration, setClipDuration] = useState(10);

  const [phase,    setPhase]    = useState("idle");
  const [stepMsg,  setStepMsg]  = useState("");
  const [stepIdx,  setStepIdx]  = useState(0);

  const [items, setItems]           = useState([]);
  const [editingId, setEditingId]   = useState(null);
  const [editValues, setEditValues] = useState({});

  const [submitLog,   setSubmitLog]   = useState([]);
  const [submitting2, setSubmitting2] = useState(false);

  const urlRef = useRef(null);

  const approved   = items.filter(i => i.review_status === "approved" || i.review_status === "edited");
  const pending    = items.filter(i => i.review_status === "pending");
  const rejected   = items.filter(i => i.review_status === "rejected");
  const needManual = items.filter(i => i.ai_status !== "success" && i.review_status === "pending");
  const autoOk     = items.filter(i => i.ai_status === "success");

  const STEPS = ["Connecting to source", "Extracting content", "AI annotation", "Ready for review"];

  // ── Scrape ───────────────────────────────────────────────────
  const handleScrape = async () => {
    if (!url.trim()) return;
    setPhase("scraping");
    setItems([]);
    setSubmitLog([]);
    setEditingId(null);
    setEditValues({});

    try {
      const endpoint = sourceType === "video" ? "/scrape/video" : "/scrape/text";
      const body = sourceType === "video"
        ? { url: url.trim(), competition_id: competitionId, max_segments: maxItems, clip_duration_seconds: clipDuration }
        : { url: url.trim(), competition_id: competitionId, content_type: contentType, max_items: maxItems };

      let si = 0;
      const stepTimer = setInterval(() => {
        si = Math.min(si + 1, STEPS.length - 2);
        setStepIdx(si);
        setStepMsg(STEPS[si]);
      }, 1800);

      const res = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify(body),
      });

      clearInterval(stepTimer);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Scraping failed — check the URL and try again.");
      }

      const data = await res.json();
      setStepIdx(3);
      setStepMsg("Ready for review");

      const enriched = (data.items || []).map((item, idx) => ({
        ...item,
        id: item.id || `item-${idx}`,
        review_status: "pending",
      }));
      setItems(enriched);

      const evInit = {};
      enriched.forEach(item => {
        if (item.annotation_suggestion) evInit[item.id] = { ...item.annotation_suggestion };
        else evInit[item.id] = {};
      });
      setEditValues(evInit);

      setTimeout(() => setPhase("reviewing"), 400);
    } catch (err) {
      setPhase("idle");
      setStepMsg("");
      alert(`⚠ ${err.message}`);
    }
  };

  // ── Review actions ───────────────────────────────────────────
  const setStatus = (id, status) =>
    setItems(prev => prev.map(i => i.id === id ? { ...i, review_status: status } : i));

  const handleApprove = (id) => { setStatus(id, "approved"); setEditingId(null); };

  const handleReject = (id) => {
    setItems(prev => prev.map(i => {
      if (i.id !== id) return i;
      return { ...i, review_status: i.review_status === "rejected" ? "pending" : "rejected" };
    }));
  };

  const handleEditToggle = (id) => setEditingId(prev => prev === id ? null : id);

  const handleEditSave = (item) => {
    const draft = editValues[item.id] || {};
    setItems(prev => prev.map(i =>
      i.id === item.id
        ? { ...i, annotation_suggestion: draft, ai_status: "success", review_status: "edited" }
        : i
    ));
    setEditingId(null);
  };

  const approveAll = () =>
    setItems(prev => prev.map(i =>
      i.review_status === "pending" && i.ai_status === "success"
        ? { ...i, review_status: "approved" } : i
    ));

  // ── Submit approved items ────────────────────────────────────
  const handleSubmitApproved = async () => {
    if (!approved.length || submitting2) return;
    setSubmitting2(true);
    const log = [];

    for (const item of approved) {
      try {
        if (item.type === "audio" && item.audio_url) {
          const blobRes = await fetch(
            `${API}/scrape/audio-file?path=${encodeURIComponent(item.audio_url)}`,
            { headers: authHeader() }
          );
          const blob = await blobRes.blob();
          await onSubmit({
            audio_blob: blob,
            audio_duration: item.audio_duration || 0,
            annotation: item.annotation_suggestion || {},
          });
        } else {
          await onSubmit({
            text_content: item.text_content,
            annotation: item.annotation_suggestion || {},
          });
        }
        log.push({ id: item.id, status: "ok" });
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, review_status: "submitted" } : i));
      } catch (err) {
        log.push({ id: item.id, status: "error", message: err.message });
      }
    }

    setSubmitLog(log);
    setSubmitting2(false);

    const successCount = log.filter(l => l.status === "ok").length;
    const failCount    = log.filter(l => l.status === "error").length;
    if (successCount > 0 && failCount === 0) setPhase("done");
  };

  const reset = () => {
    setPhase("idle"); setItems([]); setUrl(""); setStepIdx(0); setStepMsg(""); setSubmitLog([]);
  };

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="dc-widget">
      {/* Header */}
      <div className="dc-widget-header">
        <div className="dc-doc-badge">
          <span className="dc-doc-icon">⊛</span>
          <span>SCRAPING ASSISTANT</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {phase !== "idle" && (
            <button type="button" className="dc-label-tag" onClick={reset}
              style={{ fontSize: 11 }}>← New Scrape</button>
          )}
          <span className="dc-lang-tag">{taskType.replace(/_/g," ")}</span>
        </div>
      </div>

      {/* ── PHASE: IDLE ─────────────────────────────────────── */}
      {phase === "idle" && (
        <>
          {/* FIX 1: Source type tabs — audio tasks only see "Video / Audio" */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {availableSourceTypes.map(s => (
              <button key={s.id} type="button"
                className={`dc-label-tag ${sourceType === s.id ? "active" : ""}`}
                onClick={() => setSourceType(s.id)}
                style={{ padding: "8px 16px", fontSize: 12 }}>
                {s.icon} {s.label}
              </button>
            ))}
          </div>

          {/* Info card — FIX 3: shows examples and limitations */}
          <div style={{ padding: "12px 14px", background: "#f7f8fc",
            border: "1px solid #e8edf8", borderRadius: 10, marginBottom: 16, fontSize: 12, color: "#6f778c" }}>
            {sourceType === "video"
              ? <VideoInfoCard taskType={taskType} isAudioTask={isAudioTask} />
              : <WebpageInfoCard contentType={contentType} />
            }
          </div>

          {/* URL input */}
          <label className="dc-field-label">SOURCE URL</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <input
              ref={urlRef}
              type="url"
              className="dc-input"
              style={{ flex: 1 }}
              placeholder={sourceType === "video"
                ? "https://www.youtube.com/watch?v=…"
                : "https://example.com/article-or-comments"}
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleScrape()}
            />
          </div>

          {/* Webpage content type selector */}
          {sourceType === "webpage" && (
            <>
              <label className="dc-field-label">CONTENT TO EXTRACT</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                {[
                  { id: "article",  label: "📰 Article Text" },
                  { id: "comments", label: "💬 Comments" },
                  { id: "captions", label: "📝 Subtitles / Captions" },
                ].map(c => (
                  <button key={c.id} type="button"
                    className={`dc-label-tag ${contentType === c.id ? "active" : ""}`}
                    onClick={() => setContentType(c.id)}
                    style={{ fontSize: 12 }}>
                    {c.label}
                  </button>
                ))}
              </div>
              {/* FIX 4: YouTube comment hint */}
              {contentType === "comments" && (
                <div style={{ padding: "8px 12px", background: "#eff6ff",
                  border: "1px solid #bfdbfe", borderRadius: 8, marginBottom: 12, fontSize: 11 }}>
                  💡 <strong>YouTube URL?</strong> Paste it here — the backend fetches comments
                  via yt-dlp automatically (no JS rendering needed).
                </div>
              )}
            </>
          )}

          {/* Max items */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
            <label className="dc-field-label" style={{ margin: 0, whiteSpace: "nowrap" }}>
              MAX ITEMS: {maxItems}
            </label>
            <input type="range" min={5} max={50} step={5} value={maxItems}
              onChange={e => setMaxItems(Number(e.target.value))}
              style={{ flex: 1, accentColor: "#1359db" }} />
          </div>

          {/* Clip duration — only relevant when pulling audio clips from video */}
          {sourceType === "video" && (
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
              <label className="dc-field-label" style={{ margin: 0, whiteSpace: "nowrap" }}>
                CLIP LENGTH: {clipDuration}s
              </label>
              <input type="range" min={3} max={60} step={1} value={clipDuration}
                onChange={e => setClipDuration(Number(e.target.value))}
                style={{ flex: 1, accentColor: "#1359db" }} />
            </div>
          )}

          {/* Start button */}
          <div className="dc-widget-actions">
            <button type="button" className="dc-commit-btn"
              disabled={!url.trim()}
              onClick={handleScrape}>
              ⊛ Start Scraping &amp; Auto-Annotate
            </button>
          </div>
        </>
      )}

      {/* ── PHASE: SCRAPING ─────────────────────────────────── */}
      {phase === "scraping" && (
        <div style={{ padding: "24px 0" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 28 }}>
            {STEPS.map((s, i) => (
              <PhaseStep key={s} n={i + 1} label={s}
                active={i === stepIdx} done={i < stepIdx} />
            ))}
          </div>
          <div style={{ textAlign: "center", color: "#6f778c", fontSize: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%",
              border: "3px solid #dbeafe", borderTopColor: "#1359db",
              animation: "spin 0.8s linear infinite",
              margin: "0 auto 12px",
            }} />
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            <p>{stepMsg || "Connecting…"}</p>
            <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
              AI annotation runs automatically — this may take a moment.
            </p>
          </div>
        </div>
      )}

      {/* ── PHASE: REVIEWING ────────────────────────────────── */}
      {phase === "reviewing" && (
        <>
          <div style={{
            display: "flex", gap: 10, flexWrap: "wrap",
            padding: "10px 14px", background: "#f7f8fc",
            border: "1px solid #e8edf8", borderRadius: 10, marginBottom: 16, alignItems: "center",
          }}>
            {[
              ["Total",    items.length,       "#374151", "#f3f4f6"],
              ["AI Done",  autoOk.length,       "#15803d", "#dcfce7"],
              ["Manual",   needManual.length,   "#92400e", "#fef3c7"],
              ["Approved", approved.length,     "#1d4ed8", "#dbeafe"],
              ["Rejected", rejected.length,     "#b91c1c", "#fee2e2"],
            ].map(([label, count, color, bg]) => (
              <div key={label} style={{
                padding: "4px 12px", borderRadius: 20, background: bg,
                border: `1px solid ${color}33`, textAlign: "center",
              }}>
                <span style={{ fontSize: 16, fontWeight: 800, color, display: "block" }}>{count}</span>
                <span style={{ fontSize: 9, fontWeight: 700, color, textTransform: "uppercase",
                  letterSpacing: "0.06em" }}>{label}</span>
              </div>
            ))}

            {autoOk.length > 1 && approved.length < autoOk.length && (
              <button type="button" onClick={approveAll}
                style={{ marginLeft: "auto", fontSize: 11, padding: "6px 14px", borderRadius: 8,
                  border: "1.5px solid #86efac", background: "#dcfce7", color: "#15803d",
                  cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>
                ✓ Approve All AI Items
              </button>
            )}
          </div>

          {needManual.length > 0 && (
            <div style={{ padding: "10px 14px", background: "#fff7ed",
              border: "1.5px dashed #fed7aa", borderRadius: 10, marginBottom: 12, fontSize: 12 }}>
              <span style={{ fontWeight: 700, color: "#92400e" }}>
                ⚠ {needManual.length} item{needManual.length > 1 ? "s" : ""} need manual annotation
              </span>
              <span style={{ color: "#9ca3af", marginLeft: 8 }}>
                — scroll down to find items marked in orange.
              </span>
            </div>
          )}

          <div style={{ maxHeight: 520, overflowY: "auto", paddingRight: 4 }}>
            {items.map(item => (
              <ItemCard
                key={item.id}
                item={item}
                taskType={taskType}
                config={config}          
                isEditing={editingId === item.id}
                editValue={editValues[item.id]}
                onEditChange={val => setEditValues(prev => ({ ...prev, [item.id]: val }))}
                onApprove={() => handleApprove(item.id)}
                onReject={() => handleReject(item.id)}
                onEdit={() => handleEditToggle(item.id)}
                onEditSave={() => handleEditSave(item)}
              />
            ))}
          </div>

          {submitLog.length > 0 && (
            <div style={{ marginTop: 12, padding: "10px 14px",
              background: "#f7f8fc", border: "1px solid #e8edf8", borderRadius: 10, fontSize: 11 }}>
              <p style={{ fontWeight: 700, color: "#374151", marginBottom: 6 }}>Submit log</p>
              {submitLog.map(l => (
                <div key={l.id} style={{ color: l.status === "ok" ? "#15803d" : "#b91c1c", marginBottom: 2 }}>
                  {l.status === "ok" ? "✓" : "✕"} {String(l.id).slice(0,8).toUpperCase()}
                  {l.message && ` — ${l.message}`}
                </div>
              ))}
            </div>
          )}

          <div className="dc-widget-actions" style={{ marginTop: 14 }}>
            <button type="button" className="dc-commit-btn"
              disabled={!approved.length || submitting2}
              onClick={handleSubmitApproved}>
              {submitting2
                ? "Submitting…"
                : `▶ Submit ${approved.length} Approved Sample${approved.length !== 1 ? "s" : ""}`}
            </button>
          </div>

          {pending.length === 0 && approved.length === 0 && rejected.length > 0 && (
            <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", marginTop: 8 }}>
              All items rejected — <button type="button"
                style={{ background: "none", border: "none", color: "#1359db", cursor: "pointer", fontSize: 11 }}
                onClick={reset}>start a new scrape</button>.
            </p>
          )}
        </>
      )}

      {/* ── PHASE: DONE ─────────────────────────────────────── */}
      {phase === "done" && (
        <div style={{ textAlign: "center", padding: "32px 0" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
          <p style={{ fontWeight: 700, color: "#15803d", fontSize: 16, marginBottom: 6 }}>
            All samples submitted successfully!
          </p>
          <p style={{ color: "#6f778c", fontSize: 13, marginBottom: 20 }}>
            {submitLog.filter(l => l.status === "ok").length} samples committed to the dataset.
          </p>
          <button type="button" className="dc-commit-btn" onClick={reset}
            style={{ display: "inline-block" }}>
            ⊛ Start New Scrape
          </button>
        </div>
      )}
    </div>
  );
}