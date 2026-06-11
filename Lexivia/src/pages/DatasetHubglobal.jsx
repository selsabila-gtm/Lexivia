/**
 * Global Datasets Hub — /datasets
 *
 * Shows one card per competition that has participant-contributed data samples.
 * Each card shows: title, description, source competition, task type, sample
 * counts, contributors, and export buttons (JSONL / CSV).
 *
 * Replace the current SimplePage placeholder in App.jsx:
 *   <Route path="/datasets" element={<DatasetHubGlobal />} />
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatNumber(n) {
  if (n == null) return "—";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

function timeAgo(iso) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d ago`;
  const hrs = Math.floor(diff / 3600000);
  if (hrs > 0) return `${hrs}h ago`;
  const mins = Math.floor(diff / 60000);
  if (mins > 0) return `${mins}m ago`;
  return "Just now";
}

const TASK_COLORS = {
  TEXT_CLASSIFICATION:   { bg: "#eef3ff", text: "#3b5bdb" },
  NER:                   { bg: "#fff0f6", text: "#c2255c" },
  SENTIMENT_ANALYSIS:    { bg: "#fff9db", text: "#e67700" },
  TRANSLATION:           { bg: "#e6fcf5", text: "#0ca678" },
  QUESTION_ANSWERING:    { bg: "#f3f0ff", text: "#7048e8" },
  SUMMARIZATION:         { bg: "#e8f5e9", text: "#2e7d32" },
  AUDIO_SYNTHESIS:       { bg: "#e3f2fd", text: "#1565c0" },
  AUDIO_TRANSCRIPTION:   { bg: "#fce4ec", text: "#ad1457" },
  SPEECH_EMOTION:        { bg: "#fff3e0", text: "#e65100" },
  AUDIO_EVENT_DETECTION: { bg: "#f1f8e9", text: "#33691e" },
};

function taskColor(type) {
  return TASK_COLORS[type] || { bg: "#f1f3f5", text: "#495057" };
}

function taskLabel(type) {
  return (type || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Export button ─────────────────────────────────────────────────────────────

function ExportButton({ competitionId, format, statusFilter, label, icon }) {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ format, status_filter: statusFilter });
      const res = await fetch(
        `${API}/datasets/hub/${competitionId}/export?${params}`,
        { headers: authHeaders() }
      );
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // pull filename from Content-Disposition header if available
      const cd = res.headers.get("content-disposition") || "";
      const match = cd.match(/filename="?([^"]+)"?/);
      a.download = match ? match[1] : `dataset.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Export failed: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={loading}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "6px 12px",
        fontSize: "12px",
        fontWeight: 600,
        borderRadius: "7px",
        border: "1px solid #e2e8f0",
        background: loading ? "#f8fafc" : "#fff",
        color: loading ? "#94a3b8" : "#374151",
        cursor: loading ? "not-allowed" : "pointer",
        transition: "all 0.15s",
      }}
      onMouseEnter={e => { if (!loading) e.currentTarget.style.background = "#f8fafc"; }}
      onMouseLeave={e => { if (!loading) e.currentTarget.style.background = "#fff"; }}
    >
      {loading ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{ animation: "spin 1s linear infinite" }}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      )}
      {loading ? "Exporting…" : label}
    </button>
  );
}

// ── Dataset card ──────────────────────────────────────────────────────────────

function DatasetCard({ dataset, navigate }) {
  const colors = taskColor(dataset.task_type);

  const qualityPct = dataset.avg_quality != null
    ? Math.round(dataset.avg_quality * 100)
    : null;

  const validatedPct = dataset.total_samples > 0
    ? Math.round((dataset.validated_samples / dataset.total_samples) * 100)
    : 0;

  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e9ecef",
      borderRadius: "14px",
      padding: "22px 24px",
      display: "flex",
      flexDirection: "column",
      gap: "14px",
      transition: "box-shadow 0.18s, border-color 0.18s",
      cursor: "default",
    }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = "0 4px 24px rgba(15,23,42,0.07)";
        e.currentTarget.style.borderColor = "#c5cee0";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = "none";
        e.currentTarget.style.borderColor = "#e9ecef";
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
        <div style={{
          width: "40px", height: "40px", borderRadius: "10px",
          background: colors.bg,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "18px", flexShrink: 0,
        }}>
          {dataset.icon}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <h3 style={{
              margin: 0, fontSize: "15px", fontWeight: 700,
              color: "#101827", lineHeight: 1.3,
            }}>
              {dataset.title}
            </h3>
            <span style={{
              padding: "2px 8px", borderRadius: "5px", fontSize: "11px",
              fontWeight: 700, letterSpacing: "0.3px",
              background: colors.bg, color: colors.text,
            }}>
              {taskLabel(dataset.task_type)}
            </span>
          </div>

          <p style={{
            margin: "5px 0 0", fontSize: "13px", color: "#64748b",
            lineHeight: 1.5, display: "-webkit-box",
            WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>
            {dataset.description || "No description provided."}
          </p>
        </div>
      </div>

      {/* Source */}
      <div style={{
        display: "inline-flex", alignItems: "center", gap: "6px",
        fontSize: "12px", color: "#6366f1", fontWeight: 600,
        cursor: "pointer",
      }}
        onClick={() => navigate(`/competitions/${dataset.source_competition_id}`)}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 8 16 12 12 16" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
        Source: {dataset.source_competition_title}
      </div>

      {/* Stats row */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
        gap: "10px",
      }}>
        {[
          { label: "Samples", value: formatNumber(dataset.total_samples) },
          { label: "Validated", value: formatNumber(dataset.validated_samples) },
          { label: "Contributors", value: formatNumber(dataset.contributors) },
          { label: "Avg Quality", value: qualityPct != null ? `${qualityPct}%` : "—" },
        ].map(({ label, value }) => (
          <div key={label} style={{
            background: "#f8fafc", borderRadius: "8px",
            padding: "10px 12px", textAlign: "center",
          }}>
            <div style={{ fontSize: "17px", fontWeight: 800, color: "#101827" }}>{value}</div>
            <div style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 600, marginTop: "2px" }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Validation progress bar */}
      <div>
        <div style={{
          display: "flex", justifyContent: "space-between",
          fontSize: "11px", color: "#94a3b8", fontWeight: 600, marginBottom: "5px",
        }}>
          <span>Validated</span>
          <span>{validatedPct}%</span>
        </div>
        <div style={{ background: "#f1f5f9", borderRadius: "4px", height: "5px", overflow: "hidden" }}>
          <div style={{
            width: `${validatedPct}%`, height: "100%",
            background: "linear-gradient(90deg, #4ade80, #16a34a)",
            borderRadius: "4px", transition: "width 0.5s ease",
          }} />
        </div>
      </div>

      {/* Footer: last updated + export buttons */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        paddingTop: "4px", flexWrap: "wrap", gap: "8px",
      }}>
        <span style={{ fontSize: "11px", color: "#94a3b8" }}>
          Updated {timeAgo(dataset.last_updated)}
        </span>

        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <ExportButton
            competitionId={dataset.source_competition_id}
            format="jsonl"
            statusFilter="all"
            label="JSONL"
          />
          <ExportButton
            competitionId={dataset.source_competition_id}
            format="csv"
            statusFilter="all"
            label="CSV"
          />
          <ExportButton
            competitionId={dataset.source_competition_id}
            format="jsonl"
            statusFilter="validated"
            label="Validated only"
          />
        </div>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ navigate }) {
  return (
    <div style={{
      textAlign: "center", padding: "80px 24px",
      color: "#94a3b8",
    }}>
      <div style={{ fontSize: "48px", marginBottom: "16px" }}>▤</div>
      <h3 style={{ fontSize: "18px", fontWeight: 700, color: "#374151", margin: "0 0 8px" }}>
        No datasets yet
      </h3>
      <p style={{ fontSize: "14px", margin: "0 0 24px" }}>
        Datasets are built from participant contributions in competitions. Join a competition to start contributing.
      </p>
      <button
        onClick={() => navigate("/competitions")}
        style={{
          padding: "10px 20px", borderRadius: "8px", border: "none",
          background: "#4f46e5", color: "#fff", fontWeight: 700,
          fontSize: "14px", cursor: "pointer",
        }}
      >
        Browse Competitions
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DatasetHubGlobal() {
  const navigate = useNavigate();
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/datasets/hub`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setDatasets(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Derive filter options from loaded data
  const taskTypes = [...new Set(datasets.map(d => d.task_type))].sort();

  const filtered = datasets.filter(d => {
    const matchSearch = !search ||
      d.title.toLowerCase().includes(search.toLowerCase()) ||
      d.source_competition_title.toLowerCase().includes(search.toLowerCase()) ||
      (d.description || "").toLowerCase().includes(search.toLowerCase());
    const matchType = filterType === "all" || d.task_type === filterType;
    return matchSearch && matchType;
  });

  const totalSamples = datasets.reduce((s, d) => s + (d.total_samples || 0), 0);
  const totalValidated = datasets.reduce((s, d) => s + (d.validated_samples || 0), 0);
  const totalContributors = datasets.reduce((s, d) => s + (d.contributors || 0), 0);

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .ds-card-enter { animation: fadeIn 0.25s ease both; }
      `}</style>

      <div style={{ display: "flex", minHeight: "100vh", background: "#f7f8fc" }}>
        <Sidebar />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Topbar title="Datasets" subtitle="Community-built datasets from competition contributions" />

          <main style={{ padding: "28px 32px", maxWidth: "1280px" }}>

            {/* Summary stats */}
            {!loading && !error && datasets.length > 0 && (
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
                gap: "14px", marginBottom: "28px",
              }}>
                {[
                  { label: "Total Datasets", value: datasets.length, icon: "▤" },
                  { label: "Total Samples", value: formatNumber(totalSamples), icon: "◈" },
                  { label: "Total Contributors", value: formatNumber(totalContributors), icon: "◉" },
                ].map(({ label, value, icon }) => (
                  <div key={label} style={{
                    background: "#fff", border: "1px solid #e9ecef",
                    borderRadius: "12px", padding: "18px 22px",
                    display: "flex", alignItems: "center", gap: "14px",
                  }}>
                    <div style={{
                      width: "38px", height: "38px", borderRadius: "9px",
                      background: "#eef3ff", display: "flex",
                      alignItems: "center", justifyContent: "center",
                      fontSize: "18px", color: "#4f46e5",
                    }}>{icon}</div>
                    <div>
                      <div style={{ fontSize: "22px", fontWeight: 800, color: "#101827" }}>{value}</div>
                      <div style={{ fontSize: "12px", color: "#94a3b8", fontWeight: 600 }}>{label}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Search + filter bar */}
            <div style={{
              display: "flex", gap: "10px", marginBottom: "22px", flexWrap: "wrap",
            }}>
              <div style={{ position: "relative", flex: "1", minWidth: "200px" }}>
                <svg style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }}
                  width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search datasets…"
                  style={{
                    width: "100%", padding: "9px 12px 9px 36px",
                    border: "1px solid #e2e8f0", borderRadius: "9px",
                    fontSize: "13px", outline: "none", background: "#fff",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
                style={{
                  padding: "9px 14px", border: "1px solid #e2e8f0",
                  borderRadius: "9px", fontSize: "13px", background: "#fff",
                  color: "#374151", outline: "none", cursor: "pointer",
                }}
              >
                <option value="all">All task types</option>
                {taskTypes.map(t => (
                  <option key={t} value={t}>{taskLabel(t)}</option>
                ))}
              </select>

              <button
                onClick={load}
                style={{
                  padding: "9px 14px", border: "1px solid #e2e8f0",
                  borderRadius: "9px", fontSize: "13px", background: "#fff",
                  color: "#374151", cursor: "pointer", display: "flex",
                  alignItems: "center", gap: "6px",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  style={loading ? { animation: "spin 1s linear infinite" } : {}}>
                  <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                Refresh
              </button>
            </div>

            {/* Content */}
            {loading && (
              <div style={{ textAlign: "center", padding: "80px 24px", color: "#94a3b8" }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2"
                  style={{ animation: "spin 1s linear infinite", marginBottom: "12px" }}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                <div style={{ fontSize: "14px" }}>Loading datasets…</div>
              </div>
            )}

            {error && !loading && (
              <div style={{
                background: "#fef2f2", border: "1px solid #fecaca",
                borderRadius: "10px", padding: "16px 20px",
                color: "#dc2626", fontSize: "14px",
              }}>
                Failed to load datasets: {error}
                <button onClick={load} style={{
                  marginLeft: "12px", background: "none", border: "none",
                  color: "#dc2626", cursor: "pointer", fontWeight: 700, fontSize: "13px",
                }}>Retry</button>
              </div>
            )}

            {!loading && !error && datasets.length === 0 && (
              <EmptyState navigate={navigate} />
            )}

            {!loading && !error && datasets.length > 0 && filtered.length === 0 && (
              <div style={{ textAlign: "center", padding: "60px 24px", color: "#94a3b8", fontSize: "14px" }}>
                No datasets match your search.
                <button onClick={() => { setSearch(""); setFilterType("all"); }}
                  style={{ marginLeft: "8px", background: "none", border: "none", color: "#4f46e5", cursor: "pointer", fontWeight: 700 }}>
                  Clear filters
                </button>
              </div>
            )}

            {!loading && !error && filtered.length > 0 && (
              <>
                <div style={{
                  fontSize: "12px", color: "#94a3b8", fontWeight: 600,
                  marginBottom: "14px",
                }}>
                  {filtered.length} dataset{filtered.length !== 1 ? "s" : ""}
                  {filterType !== "all" || search ? ` (filtered from ${datasets.length})` : ""}
                </div>

                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))",
                  gap: "16px",
                }}>
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
