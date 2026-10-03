/**
 * Shared helpers for the Dataset Hub (list page + dataset detail page).
 */

export const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiGet(path) {
  const res = await fetch(`${API}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    let msg = `Server returned ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") msg = body.detail;
    } catch {
      /* keep default message */
    }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function downloadExport(competitionId, format) {
  const res = await fetch(
    `${API}/datasets/hub/${competitionId}/export?format=${format}`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new Error("Export failed");

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const cd = res.headers.get("content-disposition") || "";
  const match = cd.match(/filename="?([^"]+)"?/);

  a.href = url;
  a.download = match ? match[1] : `dataset.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatNumber(n) {
  if (n == null) return "—";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

export function formatDuration(sec) {
  if (sec == null || Number.isNaN(Number(sec))) return "—";
  const s = Number(sec);
  if (s <= 0) return "0s";
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = Math.round(s % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${r}s`;
}

export function formatClock(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const r = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${r}`;
}

export function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function timeAgo(iso) {
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

// ── Task / asset display metadata ────────────────────────────────────────────

export const TASK_LABELS = {
  TRANSCRIPTION: "Transcription",
  CLASSIFICATION: "Classification",
  SPAN_ANNOTATION: "Span annotation",
  TRANSLATION: "Translation",
  SUMMARIZATION: "Summarization",
  QUESTION_ANSWERING: "Question answering",
  FREE_TEXT: "Free-text annotation",
};

export function taskLabel(type, fallback) {
  return (
    TASK_LABELS[type] ||
    fallback ||
    String(type || "")
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}

// Stable colour per label so the same label looks the same everywhere.
const LABEL_COLORS = [
  { bg: "#eef2ff", text: "#4338ca", solid: "#6366f1" },
  { bg: "#fff0f6", text: "#be185d", solid: "#ec4899" },
  { bg: "#e6fcf5", text: "#047857", solid: "#10b981" },
  { bg: "#fff7ed", text: "#c2410c", solid: "#f97316" },
  { bg: "#ecfeff", text: "#0e7490", solid: "#06b6d4" },
  { bg: "#f5f3ff", text: "#6d28d9", solid: "#8b5cf6" },
  { bg: "#fefce8", text: "#a16207", solid: "#eab308" },
  { bg: "#fef2f2", text: "#b91c1c", solid: "#ef4444" },
];

export function labelColor(label) {
  let h = 0;
  for (const ch of String(label)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LABEL_COLORS[h % LABEL_COLORS.length];
}