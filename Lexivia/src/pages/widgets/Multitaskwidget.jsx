/**
 * MultiTaskWidget.jsx
 *
 * The generic contribution widget for task_type MULTI_TASK_ANNOTATION and
 * CUSTOM — the two types CreateCompetition.jsx already lets an organizer
 * configure with an arbitrary combination of:
 *   - config.tasks[]                — one or more label sets to annotate
 *                                      per instance (e.g. Sentiment, Sarcasm,
 *                                      Hate Speech), each independent
 *   - config.data_collection.inputs[] — one or more inputs, each with its
 *                                      own modality ("text" | "audio") and
 *                                      its own max_length
 *
 * Previously WIDGET_MAP had no entry for these two task types, so they
 * silently fell back to TextClassificationWidget — a single text box with a
 * single label set, regardless of what the organizer actually configured.
 * This widget instead renders one control per input and one label-picker
 * per task, so "any combination" from the wizard is actually usable here.
 *
 * Submission behaviour:
 *   - If any input is audio, the sample is submitted through the audio path
 *     (`onSubmit({ audio_blob, audio_duration, annotation })`). Any text
 *     input's value is folded into `annotation.transcript` — data.py now
 *     also copies that into the row's text_content column, so an
 *     audio+text instance (AMDC's format: audio <10s + matching
 *     transcript <20 words) lives in one coherent row.
 *   - If every input is text, the sample is submitted through the text path
 *     (`onSubmit({ text_content, annotation })`), using the first text
 *     input's value as text_content and folding every input's value into
 *     `annotation` under its own name so multi-input text tasks (e.g.
 *     Question Answering-style "Question" + "Context") aren't lossy.
 *
 * All per-task label choices, the selected track (if the competition uses
 * Tracks), and provenance fields (source link/timestamp, required when the
 * organizer's Data Collection rules allow public-source contributions) are
 * merged into the same `annotation` object, since data_samples.annotation
 * is a flexible jsonb column.
 */

import { useEffect, useMemo, useRef, useState } from "react";

const API = "http://127.0.0.1:8000";
function authHeader() {
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function wordCount(str) {
  return (str || "").trim().split(/\s+/).filter(Boolean).length;
}

// ── Simple browser audio recorder, capped at maxSeconds ───────────────────
function useAudioRecorder(maxSeconds) {
  const [recording, setRecording] = useState(false);
  const [blob, setBlob] = useState(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef(null);

  const start = async () => {
    setError(null);
    setBlob(null);
    setDuration(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const finalBlob = new Blob(chunksRef.current, { type: "audio/webm" });
        setBlob(finalBlob);
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorderRef.current = mr;
      startedAtRef.current = Date.now();
      mr.start();
      setRecording(true);

      timerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startedAtRef.current) / 1000;
        setDuration(elapsed);
        if (maxSeconds && elapsed >= maxSeconds) {
          stop();
        }
      }, 150);
    } catch (err) {
      setError("Microphone access denied or unavailable.");
    }
  };

  const stop = () => {
    clearInterval(timerRef.current);
    setRecording(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  const reset = () => {
    setBlob(null);
    setDuration(0);
  };

  useEffect(() => () => clearInterval(timerRef.current), []);

  return { recording, blob, duration, error, start, stop, reset };
}

function AudioInputField({ input, onChange }) {
  const rec = useAudioRecorder(input.max_length);

  useEffect(() => {
    onChange({ blob: rec.blob, duration: rec.duration });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.blob]);

  const overLimit = input.max_length && rec.duration > input.max_length;

  return (
    <div className="dc-field">
      <label className="dc-field-label">
        {input.name?.toUpperCase()} · AUDIO · max {input.max_length}s
      </label>

      <div className="dc-audio-recorder">
        {!rec.recording && !rec.blob && (
          <button type="button" className="dc-record-btn" onClick={rec.start}>
            ● Start recording
          </button>
        )}

        {rec.recording && (
          <button type="button" className="dc-record-btn recording" onClick={rec.stop}>
            ■ Stop ({rec.duration.toFixed(1)}s)
          </button>
        )}

        {rec.blob && !rec.recording && (
          <div className="dc-audio-preview">
            <audio controls src={URL.createObjectURL(rec.blob)} />
            <span className={overLimit ? "dc-over-limit" : ""}>
              {rec.duration.toFixed(1)}s / {input.max_length}s
            </span>
            <button type="button" className="dc-remove-btn" onClick={rec.reset}>
              Re-record
            </button>
          </div>
        )}

        {rec.error && <p className="dc-over-limit">{rec.error}</p>}
      </div>
    </div>
  );
}

function TextInputField({ input, value, onChange }) {
  const words = wordCount(value);
  const overLimit = input.max_length && words > input.max_length;

  return (
    <div className="dc-field">
      <label className="dc-field-label">
        {input.name?.toUpperCase()} · TEXT · max {input.max_length} words
      </label>
      <textarea
        className="dc-textarea"
        rows={3}
        value={value || ""}
        placeholder={`Enter ${input.name || "text"}...`}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="dc-textarea-footer">
        <span className={overLimit ? "dc-over-limit" : ""}>
          {words} / {input.max_length} words
        </span>
      </div>
    </div>
  );
}

function TaskLabelPicker({ task, value, onChange }) {
  return (
    <div className="dc-field">
      <label className="dc-field-label">{task.name?.toUpperCase()}</label>
      <div className="dc-label-row">
        {(task.labels || []).map((label) => (
          <button
            key={label}
            type="button"
            className={`dc-label-tag ${value === label ? "active" : ""}`}
            onClick={() => onChange(label)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MultiTaskWidget({ competition, config, onSubmit, submitting }) {
  const inputs = useMemo(() => config?.data_collection?.inputs || [], [config]);
  const tasks = useMemo(() => config?.tasks || [], [config]);
  const dataCollectionCfg = config?.data_collection || {};
  const licenseCfg = config?.license || {};

  const [textValues, setTextValues] = useState({});
  const [audioValues, setAudioValues] = useState({});
  const [labels, setLabels] = useState({});
  const [sourceUrl, setSourceUrl] = useState("");
  const [licenseAccepted, setLicenseAccepted] = useState(false);
  const [trackId, setTrackId] = useState("");
  const [tracks, setTracks] = useState([]);

  useEffect(() => {
    if (!competition?.tracks_enabled || !competition?.id) return;
    fetch(`${API}/competitions/${competition.id}/tracks`, { headers: authHeader() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setTracks(d?.tracks?.filter((t) => t.active !== false) || []))
      .catch(() => setTracks([]));
  }, [competition?.tracks_enabled, competition?.id]);

  const textInputs = inputs.filter((i) => i.modality === "text");
  const audioInputs = inputs.filter((i) => i.modality === "audio");
  const requiresProvenance = (dataCollectionCfg.allowed_source_types || []).includes("public_video");

  const overAnyLimit = useMemo(() => {
    const textOver = textInputs.some(
      (i) => i.max_length && wordCount(textValues[i.name]) > i.max_length
    );
    const audioOver = audioInputs.some(
      (i) => i.max_length && (audioValues[i.name]?.duration || 0) > i.max_length
    );
    return textOver || audioOver;
  }, [textInputs, audioInputs, textValues, audioValues]);

  const missingRequired =
    inputs.length === 0 ||
    textInputs.some((i) => !((textValues[i.name] || "").trim())) ||
    audioInputs.some((i) => !audioValues[i.name]?.blob) ||
    tasks.some((t) => !labels[t.name]) ||
    (dataCollectionCfg.inputs?.length > 0 && !licenseAccepted && licenseCfg.text) ||
    (competition?.tracks_enabled && !trackId) ||
    (requiresProvenance && !sourceUrl.trim());

  const handleSubmit = () => {
    const annotation = { ...labels };
    if (trackId) annotation.track_id = trackId;
    if (sourceUrl.trim()) annotation.source_url = sourceUrl.trim();
    if (licenseCfg.version) annotation.license_version = licenseCfg.version;

    textInputs.forEach((i) => {
      annotation[i.name] = textValues[i.name] || "";
    });

    if (audioInputs.length > 0) {
      // AMDC-style: one audio input + a matching transcript. If there's a
      // text input too, its value becomes the transcript so data.py can
      // store it on both text_content and inside the annotation jsonb.
      const primaryAudio = audioValues[audioInputs[0].name];
      const transcript = textInputs.length > 0 ? textValues[textInputs[0].name] : "";
      onSubmit({
        audio_blob: primaryAudio?.blob,
        audio_duration: primaryAudio?.duration || 0,
        annotation: { ...annotation, transcript },
      });
    } else {
      onSubmit({
        text_content: textInputs.length > 0 ? textValues[textInputs[0].name] : "",
        annotation,
      });
    }
  };

  return (
    <div className="dc-widget">
      <div className="dc-widget-header">
        <div className="dc-doc-badge">
          <span className="dc-doc-icon">◈</span>
          {competition?.title || "Multi-Task Annotation"}
        </div>
      </div>

      {inputs.length === 0 && (
        <p className="dc-over-limit">
          This competition hasn't configured any inputs for Data Collection yet.
        </p>
      )}

      {textInputs.map((input) => (
        <TextInputField
          key={input.name}
          input={input}
          value={textValues[input.name]}
          onChange={(v) => setTextValues((prev) => ({ ...prev, [input.name]: v }))}
        />
      ))}

      {audioInputs.map((input) => (
        <AudioInputField
          key={input.name}
          input={input}
          onChange={(v) => setAudioValues((prev) => ({ ...prev, [input.name]: v }))}
        />
      ))}

      {tasks.map((task) => (
        <TaskLabelPicker
          key={task.id || task.name}
          task={task}
          value={labels[task.name]}
          onChange={(v) => setLabels((prev) => ({ ...prev, [task.name]: v }))}
        />
      ))}

      {competition?.tracks_enabled && (
        <div className="dc-field">
          <label className="dc-field-label">TRACK</label>
          <select className="dc-input" value={trackId} onChange={(e) => setTrackId(e.target.value)}>
            <option value="">Select a track…</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      )}

      {requiresProvenance && (
        <div className="dc-field">
          <label className="dc-field-label">SOURCE LINK (required for public-source content)</label>
          <input
            className="dc-input"
            type="text"
            placeholder="https://... (with timestamp if applicable)"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
          />
        </div>
      )}

      {licenseCfg.text && (
        <label className="dc-license-check">
          <input
            type="checkbox"
            checked={licenseAccepted}
            onChange={(e) => setLicenseAccepted(e.target.checked)}
          />
          I accept the data usage license ({licenseCfg.version}) for this competition.
        </label>
      )}

      <div className="dc-widget-actions">
        <button
          type="button"
          className="dc-commit-btn"
          disabled={submitting || missingRequired || overAnyLimit}
          onClick={handleSubmit}
        >
          {submitting ? "Submitting…" : "Commit Sample"}
        </button>
      </div>
    </div>
  );
}

export default MultiTaskWidget;