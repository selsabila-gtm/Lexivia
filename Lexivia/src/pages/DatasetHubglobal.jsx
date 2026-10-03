/**
 * Global Datasets Hub — /datasets
 *
 * Lists the datasets of CLOSED competitions only (the backend enforces this).
 * A dataset is described by its sample structure: asset slots (text / audio)
 * and annotation tasks. Clicking a card opens /datasets/:competitionId.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";

import {
  Database,
  FileText,
  Headphones,
  Layers3,
  RefreshCcw,
  Tags,
  ArrowRight,
  Lock,
} from "lucide-react";

import {
  apiGet,
  formatNumber,
  formatDuration,
  formatDate,
  timeAgo,
  taskLabel,
} from "./datasetHubShared";

// ── Small pieces ─────────────────────────────────────────────────────────────

function Chip({ children, Icon, bg = "#f1f5f9", color = "#475569" }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "3px 9px",
        borderRadius: "6px",
        fontSize: "11px",
        fontWeight: 700,
        background: bg,
        color,
        whiteSpace: "nowrap",
      }}
    >
      {Icon && <Icon size={11} strokeWidth={2.5} />}
      {children}
    </span>
  );
}

function DatasetCard({ dataset, navigate }) {
  const hasAudio = dataset.assets.some((a) => a.kind === "audio");
  const HeaderIcon = hasAudio ? Headphones : FileText;

  const annotatedPct =
    dataset.total_samples > 0
      ? Math.round((dataset.annotated_samples / dataset.total_samples) * 100)
      : 0;

  const shownTasks = dataset.tasks.slice(0, 3);
  const extraTasks = dataset.tasks.length - shownTasks.length;

  const open = () => navigate(`/datasets/${dataset.id}`);

  const stats = [
    { label: "Samples", value: formatNumber(dataset.total_samples) },
    { label: "Contributors", value: formatNumber(dataset.contributors) },
    { label: "Annotations", value: formatNumber(dataset.annotations) },
    hasAudio
      ? { label: "Audio", value: formatDuration(dataset.audio_seconds) }
      : { label: "Annotated", value: `${annotatedPct}%` },
  ];

  return (
    <div
      className="ds-card"
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
        <div className="ds-card-icon">
          <HeaderIcon size={18} strokeWidth={2.3} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 className="ds-card-title">{dataset.title}</h3>
          <p className="ds-card-desc">
            {dataset.description || "No description provided."}
          </p>
        </div>
      </div>

      {/* Sample structure */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {dataset.assets.map((a) => (
          <Chip
            key={a.key}
            Icon={a.kind === "audio" ? Headphones : FileText}
            bg={a.kind === "audio" ? "#e3f2fd" : "#eef3ff"}
            color={a.kind === "audio" ? "#1565c0" : "#3b5bdb"}
          >
            {a.name}
          </Chip>
        ))}
        {shownTasks.map((t) => (
          <Chip key={t.key} Icon={Tags} bg="#f3f0ff" color="#6d28d9">
            {taskLabel(t.type, t.label)}
          </Chip>
        ))}
        {extraTasks > 0 && <Chip>+{extraTasks} more</Chip>}
      </div>

      {/* Source */}
      <div
        className="ds-card-source"
        onClick={(e) => {
          e.stopPropagation();
          navigate(`/competitions/${dataset.source_competition_id}`);
        }}
      >
        Source: {dataset.source_competition_title}
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
        {stats.map(({ label, value }) => (
          <div key={label} className="ds-stat">
            <div className="ds-stat-value">{value}</div>
            <div className="ds-stat-label">{label}</div>
          </div>
        ))}
      </div>

      {/* Annotation progress */}
      <div>
        <div className="ds-progress-head">
          <span>Samples with annotations</span>
          <span>{annotatedPct}%</span>
        </div>
        <div className="ds-progress">
          <div style={{ width: `${annotatedPct}%` }} />
        </div>
      </div>

      <div className="ds-card-footer">
        <span>
          Closed {formatDate(dataset.ended_at)} · Updated {timeAgo(dataset.last_updated)}
        </span>
        <span className="ds-card-open">
          View dataset <ArrowRight size={13} strokeWidth={2.5} />
        </span>
      </div>
    </div>
  );
}

function EmptyState({ navigate }) {
  return (
    <div style={{ textAlign: "center", padding: "80px 24px", color: "#94a3b8" }}>
      <div
        style={{
          width: 56,
          height: 56,
          margin: "0 auto 16px",
          borderRadius: 14,
          background: "#eef3ff",
          color: "#4f46e5",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Lock size={24} strokeWidth={2.2} />
      </div>

      <h3 style={{ fontSize: 18, fontWeight: 700, color: "#374151", margin: "0 0 8px" }}>
        No datasets published yet
      </h3>

      <p style={{ fontSize: 14, margin: "0 auto 24px", maxWidth: 420 }}>
        A competition's dataset appears here once the competition closes. Datasets of
        competitions that are still running stay private.
      </p>

      <button
        onClick={() => navigate("/competitions")}
        style={{
          padding: "10px 20px",
          borderRadius: 8,
          border: "none",
          background: "#4f46e5",
          color: "#fff",
          fontWeight: 700,
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        Browse Competitions
      </button>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function DatasetHubGlobal() {
  const navigate = useNavigate();

  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [filterTask, setFilterTask] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet("/datasets/hub");
      setDatasets(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const taskOptions = useMemo(() => {
    const map = new Map();
    datasets.forEach((d) =>
      d.tasks.forEach((t) => map.set(t.type, taskLabel(t.type, t.label)))
    );
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [datasets]);

  const filtered = datasets.filter((d) => {
    const q = search.trim().toLowerCase();
    const matchSearch =
      !q ||
      String(d.title || "").toLowerCase().includes(q) ||
      String(d.source_competition_title || "").toLowerCase().includes(q) ||
      String(d.description || "").toLowerCase().includes(q);
    const matchTask =
      filterTask === "all" || d.tasks.some((t) => t.type === filterTask);
    return matchSearch && matchTask;
  });

  const totalSamples = datasets.reduce((s, d) => s + Number(d.total_samples || 0), 0);
  const totalAnnotations = datasets.reduce((s, d) => s + Number(d.annotations || 0), 0);

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .ds-card-enter { animation: fadeIn 0.25s ease both; }

        .ds-card {
          background: #fff; border: 1px solid #e9ecef; border-radius: 14px;
          padding: 22px 24px; display: flex; flex-direction: column; gap: 14px;
          cursor: pointer; transition: box-shadow .18s, border-color .18s, transform .18s;
          outline: none;
        }
        .ds-card:hover, .ds-card:focus-visible {
          box-shadow: 0 6px 28px rgba(15,23,42,.08); border-color: #a5b4fc; transform: translateY(-1px);
        }
        .ds-card-icon {
          width: 40px; height: 40px; border-radius: 10px; background: #eef3ff; color: #4f46e5;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .ds-card-title { margin: 0; font-size: 15px; font-weight: 700; color: #101827; line-height: 1.3; }
        .ds-card-desc {
          margin: 5px 0 0; font-size: 13px; color: #64748b; line-height: 1.5;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
        }
        .ds-card-source { font-size: 12px; color: #6366f1; font-weight: 600; width: fit-content; }
        .ds-card-source:hover { text-decoration: underline; }
        .ds-stat { background: #f8fafc; border-radius: 8px; padding: 10px 12px; text-align: center; }
        .ds-stat-value { font-size: 17px; font-weight: 800; color: #101827; }
        .ds-stat-label { font-size: 11px; color: #94a3b8; font-weight: 600; margin-top: 2px; }
        .ds-progress-head {
          display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8;
          font-weight: 600; margin-bottom: 5px;
        }
        .ds-progress { background: #f1f5f9; border-radius: 4px; height: 5px; overflow: hidden; }
        .ds-progress > div { height: 100%; background: linear-gradient(90deg, #818cf8, #4f46e5); border-radius: 4px; transition: width .5s ease; }
        .ds-card-footer {
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
          padding-top: 4px; font-size: 11px; color: #94a3b8; flex-wrap: wrap;
        }
        .ds-card-open { display: inline-flex; align-items: center; gap: 5px; color: #4f46e5; font-weight: 700; font-size: 12px; }
      `}</style>

      <div style={{ display: "flex", minHeight: "100vh", background: "#f7f8fc" }}>
        <Sidebar />

        <div style={{ flex: 1, minWidth: 0 }}>
          <Topbar
            title="Datasets"
            subtitle="Datasets collected and annotated in closed competitions"
          />

          <main style={{ padding: "28px 32px", maxWidth: "1280px" }}>
            {/* Summary */}
            {!loading && !error && datasets.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "14px",
                  marginBottom: "28px",
                }}
              >
                {[
                  { label: "Published Datasets", value: datasets.length, Icon: Layers3 },
                  { label: "Total Samples", value: formatNumber(totalSamples), Icon: Database },
                  { label: "Total Annotations", value: formatNumber(totalAnnotations), Icon: Tags },
                ].map(({ label, value, Icon }) => (
                  <div
                    key={label}
                    style={{
                      background: "#fff",
                      border: "1px solid #e9ecef",
                      borderRadius: 12,
                      padding: "18px 22px",
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                    }}
                  >
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 9,
                        background: "#eef3ff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#4f46e5",
                      }}
                    >
                      <Icon size={18} strokeWidth={2.3} />
                    </div>
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: "#101827" }}>{value}</div>
                      <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>{label}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Search + filter */}
            <div style={{ display: "flex", gap: 10, marginBottom: 22, flexWrap: "wrap" }}>
              <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
                <svg
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#94a3b8",
                  }}
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search datasets…"
                  style={{
                    width: "100%",
                    padding: "9px 12px 9px 36px",
                    border: "1px solid #e2e8f0",
                    borderRadius: 9,
                    fontSize: 13,
                    outline: "none",
                    background: "#fff",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <select
                value={filterTask}
                onChange={(e) => setFilterTask(e.target.value)}
                style={{
                  padding: "9px 14px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 9,
                  fontSize: 13,
                  background: "#fff",
                  color: "#374151",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="all">All annotation tasks</option>
                {taskOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>

              <button
                onClick={load}
                style={{
                  padding: "9px 14px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 9,
                  fontSize: 13,
                  background: "#fff",
                  color: "#374151",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <RefreshCcw
                  size={13}
                  strokeWidth={2.5}
                  style={loading ? { animation: "spin 1s linear infinite" } : {}}
                />
                Refresh
              </button>
            </div>

            {loading && (
              <div style={{ textAlign: "center", padding: "80px 24px", color: "#94a3b8" }}>
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#4f46e5"
                  strokeWidth="2"
                  style={{ animation: "spin 1s linear infinite", marginBottom: 12 }}
                >
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                <div style={{ fontSize: 14 }}>Loading datasets…</div>
              </div>
            )}

            {error && !loading && (
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 10,
                  padding: "16px 20px",
                  color: "#dc2626",
                  fontSize: 14,
                }}
              >
                Failed to load datasets: {error}
                <button
                  onClick={load}
                  style={{
                    marginLeft: 12,
                    background: "none",
                    border: "none",
                    color: "#dc2626",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  Retry
                </button>
              </div>
            )}

            {!loading && !error && datasets.length === 0 && <EmptyState navigate={navigate} />}

            {!loading && !error && datasets.length > 0 && filtered.length === 0 && (
              <div style={{ textAlign: "center", padding: "60px 24px", color: "#94a3b8", fontSize: 14 }}>
                No datasets match your search.
                <button
                  onClick={() => {
                    setSearch("");
                    setFilterTask("all");
                  }}
                  style={{
                    marginLeft: 8,
                    background: "none",
                    border: "none",
                    color: "#4f46e5",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  Clear filters
                </button>
              </div>
            )}

            {!loading && !error && filtered.length > 0 && (
              <>
                <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600, marginBottom: 14 }}>
                  {filtered.length} dataset{filtered.length !== 1 ? "s" : ""}
                  {filterTask !== "all" || search ? ` (filtered from ${datasets.length})` : ""}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))",
                    gap: 16,
                  }}
                >
                  {filtered.map((d, i) => (
                    <div key={d.id} className="ds-card-enter" style={{ animationDelay: `${i * 40}ms` }}>
                      <DatasetCard dataset={d} navigate={navigate} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </>
  );
}