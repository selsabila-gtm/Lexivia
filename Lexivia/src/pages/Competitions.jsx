import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import "./Competitions.css";
import {
  BarChart3,
  FileText,
  Languages,
  Headphones,
  Tags,
  Image,
  Database,
  MessageSquare,
  Trophy,
  Mic,
  Volume2,
  Smile,
} from "lucide-react";

const PAGE_SIZE = 10;

// Task filter options — value must match what's stored in competitions.task_type
const TASK_FILTER_OPTIONS = [
  { value: "ALL TASKS", label: "ALL TASKS" },
  { value: "TEXT_CLASSIFICATION", label: "TEXT CLASSIFICATION" },
  { value: "NER", label: "NER" },
  { value: "SENTIMENT_ANALYSIS", label: "SENTIMENT ANALYSIS" },
  { value: "TRANSLATION", label: "TRANSLATION" },
  { value: "QUESTION_ANSWERING", label: "QUESTION ANSWERING" },
  { value: "SUMMARIZATION", label: "SUMMARIZATION" },
  { value: "AUDIO_SYNTHESIS", label: "AUDIO SYNTHESIS" },
  { value: "AUDIO_TRANSCRIPTION", label: "AUDIO TRANSCRIPTION" },
  { value: "SPEECH_EMOTION", label: "SPEECH EMOTION" },
  { value: "AUDIO_EVENT_DETECTION", label: "AUDIO EVENT DETECTION" },
];

// Human-readable label for the category chip shown on cards
const TASK_DISPLAY_LABELS = {
  TEXT_CLASSIFICATION: "Text Classification",
  NER: "Named Entity Recognition",
  SENTIMENT_ANALYSIS: "Sentiment Analysis",
  TRANSLATION: "Translation",
  QUESTION_ANSWERING: "Question Answering",
  SUMMARIZATION: "Summarization",
  AUDIO_SYNTHESIS: "Audio Synthesis",
  AUDIO_TRANSCRIPTION: "Audio Transcription",
  SPEECH_EMOTION: "Speech Emotion",
  AUDIO_EVENT_DETECTION: "Audio Event Detection",
};

function normalizeTaskIconKey(type) {
  return String(type || "GENERAL")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

const TASK_ICONS = {
  TEXT_CLASSIFICATION: Tags,
  NER: Tags,
  SENTIMENT_ANALYSIS: BarChart3,
  TRANSLATION: Languages,
  QUESTION_ANSWERING: MessageSquare,
  SUMMARIZATION: FileText,
  AUDIO_SYNTHESIS: Volume2,
  AUDIO_TRANSCRIPTION: Mic,
  SPEECH_EMOTION: Smile,
  AUDIO_EVENT_DETECTION: Headphones,
  IMAGE_CLASSIFICATION: Image,
  DATASET: Database,
  GENERAL: Trophy,
};

function taskTone(type) {
  const key = normalizeTaskIconKey(type);
  const tones = {
    TEXT_CLASSIFICATION: { bg: "#eef3ff", color: "#3b5bdb" },
    NER: { bg: "#fff0f6", color: "#c2255c" },
    SENTIMENT_ANALYSIS: { bg: "#fff9db", color: "#e67700" },
    TRANSLATION: { bg: "#e6fcf5", color: "#0ca678" },
    QUESTION_ANSWERING: { bg: "#f3f0ff", color: "#7048e8" },
    SUMMARIZATION: { bg: "#e8f5e9", color: "#2e7d32" },
    AUDIO_SYNTHESIS: { bg: "#e3f2fd", color: "#1565c0" },
    AUDIO_TRANSCRIPTION: { bg: "#fce4ec", color: "#ad1457" },
    SPEECH_EMOTION: { bg: "#fff3e0", color: "#e65100" },
    AUDIO_EVENT_DETECTION: { bg: "#f1f8e9", color: "#33691e" },
    IMAGE_CLASSIFICATION: { bg: "#eef2ff", color: "#4f46e5" },
  };
  return tones[key] || { bg: "#f1f3f5", color: "#495057" };
}

function CompetitionTaskIcon({ type }) {
  const Icon = TASK_ICONS[normalizeTaskIconKey(type)] || Trophy;
  const tone = taskTone(type);

  return (
    <span
      className="competition-task-icon"
      style={{ background: tone.bg, color: tone.color }}
      aria-hidden="true"
    >
      <Icon size={18} strokeWidth={2.35} />
    </span>
  );
}

function normalizeStatus(status) {
  return String(status || "").trim().toUpperCase();
}

function normalizeRole(role) {
  const clean = String(role || "none").trim().toLowerCase();

  if (clean === "organizer") return "organizer";
  if (clean === "participant") return "participant";

  return "none";
}

function getCardAction(item, navigate) {
  const status = normalizeStatus(item.status);
  const role = normalizeRole(item.user_role);

  // Only OPEN competitions should allow View / Contribute / Join actions.
  // CLOSED, ENDED, UPCOMING, DRAFT, or unknown statuses should only show details.
  if (status !== "OPEN") {
    return {
      label: "See Details →",
      className: "go-btn go-btn--closed-view",
      onClick: () => navigate(`/competitions/${item.id}`),
    };
  }

  if (role === "organizer") {
    return {
      label: "View →",
      className: "go-btn go-btn--organizer",
      onClick: () => navigate(`/competitions/${item.id}/organizer`),
    };
  }

  if (role === "participant") {
    return {
      label: "Contribute →",
      className: "go-btn go-btn--participant",
      onClick: () => navigate(`/competitions/${item.id}/data-collection`),
    };
  }

  return {
    label: "Join →",
    className: "go-btn go-btn--join",
    onClick: () => navigate(`/competitions/${item.id}`),
  };
}

function RoleChip({ role }) {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === "none") return null;

  const styles = {
    organizer: {
      background: "#fff0e6",
      color: "#b85200",
    },
    participant: {
      background: "#e8f5e9",
      color: "#2e7d32",
    },
  };

  const labels = {
    organizer: "ORGANIZING",
    participant: "PARTICIPATING",
  };

  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 20,
        letterSpacing: "0.04em",
        ...styles[normalizedRole],
      }}
    >
      {labels[normalizedRole]}
    </span>
  );
}

function StatusChip({ status }) {
  const normalizedStatus = normalizeStatus(status);

  const statusClassMap = {
    OPEN: "open",
    CLOSED: "closed",
    ENDED: "closed",
    UPCOMING: "upcoming",
    DRAFT: "draft",
  };

  return (
    <span className={`competition-status ${statusClassMap[normalizedStatus] || "closed"}`}>
      {normalizedStatus || "UNKNOWN"}
    </span>
  );
}

function Competitions() {
  const navigate = useNavigate();
  const location = useLocation();

  const urlParams = new URLSearchParams(location.search);
  const urlSearch = urlParams.get("search") || "";

  const [sortOrder, setSortOrder] = useState(
    localStorage.getItem("competitions_sortOrder") || "newest"
  );

  const [competitions, setCompetitions] = useState([]);
  const [search, setSearch] = useState(urlSearch);
  const [searchInput, setSearchInput] = useState(urlSearch);

  const [category, setCategory] = useState(
    localStorage.getItem("competitions_category") || "ALL TASKS"
  );

  const [tab, setTab] = useState("all");
  const [offset, setOffset] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const [viewMode, setViewMode] = useState(
    localStorage.getItem("competitions_viewMode") || "grid"
  );

  const token = localStorage.getItem("token");

  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token]
  );

  useEffect(() => {
    if (!token) navigate("/login");
  }, [token, navigate]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const q = params.get("search") || "";

    setSearch(q);
    setSearchInput(q);
    setOffset(0);
  }, [location.search]);

  useEffect(() => {
    if (location.state?.refreshAll) {
      setCategory("ALL TASKS");
      setTab("all");
      setSearch("");
      setSearchInput("");
      setViewMode("grid");
      setOffset(0);
      setSortOrder("newest");

      localStorage.setItem("competitions_category", "ALL TASKS");
      localStorage.setItem("competitions_sortOrder", "newest");
      localStorage.setItem("competitions_viewMode", "grid");

      navigate(location.pathname, {
        replace: true,
        state: {},
      });
    }
  }, [location, navigate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const cleanSearch = searchInput.trim();

      setOffset(0);
      setSearch(cleanSearch);

      navigate(
        cleanSearch
          ? `/competitions?search=${encodeURIComponent(cleanSearch)}`
          : "/competitions",
        { replace: true }
      );
    }, 350);

    return () => clearTimeout(timer);
  }, [searchInput, navigate]);

  useEffect(() => {
    if (!token) return;

    const controller = new AbortController();

    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
      tab,
      sort: sortOrder,
    });

    if (search) params.append("search", search);

    // Pass the raw task_type value, e.g. "TEXT_CLASSIFICATION".
    // Backend matches it directly.
    if (category !== "ALL TASKS") {
      params.append("category", category);
    }

    setLoading(true);

    fetch(`http://127.0.0.1:8000/competitions?${params.toString()}`, {
      headers: authHeaders,
      signal: controller.signal,
    })
      .then((res) => {
        if (res.status === 401) {
          navigate("/login");
          return null;
        }

        if (!res.ok) {
          throw new Error("Failed to fetch competitions");
        }

        return res.json();
      })
      .then((data) => {
        if (!data) return;

        const safeData = Array.isArray(data) ? data : [];

        if (offset === 0) {
          setCompetitions(safeData);
          return;
        }

        setCompetitions((prev) => {
          const merged = [...prev, ...safeData];

          return merged.filter(
            (item, i, self) => i === self.findIndex((x) => x.id === item.id)
          );
        });
      })
      .catch((err) => {
        if (err.name === "AbortError") return;

        console.error("Competitions fetch error:", err);

        if (offset === 0) {
          setCompetitions([]);
        }
      })
      .finally(() => {
        setLoading(false);
      });

    return () => controller.abort();
  }, [token, authHeaders, search, category, tab, offset, sortOrder, navigate]);

  useEffect(() => {
    if (!token) return;

    const controller = new AbortController();

    const params = new URLSearchParams({
      tab,
    });

    if (search) params.append("search", search);
    if (category !== "ALL TASKS") params.append("category", category);

    fetch(`http://127.0.0.1:8000/competitions/count?${params.toString()}`, {
      headers: authHeaders,
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch competitions count");
        return res.json();
      })
      .then((data) => {
        if (data) {
          setTotalCount(Number(data.count || 0));
        }
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setTotalCount(0);
      });

    return () => controller.abort();
  }, [token, authHeaders, search, category, tab]);

  const handleCategoryChange = (val) => {
    setOffset(0);
    setCategory(val);
    localStorage.setItem("competitions_category", val);
  };

  const handleSortChange = (value) => {
    setOffset(0);
    setSortOrder(value);
    localStorage.setItem("competitions_sortOrder", value);
  };

  const handleTabChange = (sel) => {
    setOffset(0);
    setTab(sel);
  };

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    localStorage.setItem("competitions_viewMode", mode);
  };

  const handleLoadMore = () => {
    if (!loading && competitions.length < totalCount) {
      setOffset((p) => p + PAGE_SIZE);
    }
  };

  const clearSearch = () => {
    setSearchInput("");
  };

  const canLoadMore = competitions.length < totalCount;

  return (
    <div className="competitions-shell">
      <Sidebar />

      <div className="competitions-main">
        <Topbar
          title="Active Competitions"
          subtitle="Push the boundaries of Natural Language Processing. Deploy your models, compete for global rankings, and optimize precision metrics across diverse data domains."
          showBrowseButton={false}
        />

        <div className="competitions-body">
          <div className="view-switch-row">
            <div className="sort-control">
              <span>Sort by</span>

              <select
                value={sortOrder}
                onChange={(e) => handleSortChange(e.target.value)}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="unknown_dates">Unknown dates only</option>
              </select>
            </div>

            <div className="grid-list-switch">
              <button
                type="button"
                className={viewMode === "grid" ? "active" : ""}
                onClick={() => handleViewModeChange("grid")}
              >
                Grid View
              </button>

              <button
                type="button"
                className={viewMode === "list" ? "active" : ""}
                onClick={() => handleViewModeChange("list")}
              >
                List View
              </button>
            </div>
          </div>

          <div className="competitions-toolbar">
            <div className="task-filters">
              <span className="filter-title">FILTER BY TASK</span>

              {TASK_FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={category === opt.value ? "active" : ""}
                  onClick={() => handleCategoryChange(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="view-tabs">
              {["all", "participating", "organizing"].map((t) => (
                <button
                  key={t}
                  type="button"
                  className={tab === t ? "active" : ""}
                  onClick={() => handleTabChange(t)}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="competitions-search-row">
            <input
              type="text"
              className="competitions-search-input"
              placeholder="Search competitions..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />

            {searchInput && (
              <button
                type="button"
                className="competitions-search-clear"
                onClick={clearSearch}
              >
                Clear
              </button>
            )}
          </div>

          {loading && offset === 0 ? (
            <div className="competitions-empty-state">Loading competitions...</div>
          ) : (
            <div className={viewMode === "grid" ? "competition-grid" : "competition-list"}>
              {competitions.length === 0 ? (
                <div className="competitions-empty-state">No competitions found.</div>
              ) : (
                competitions.map((item) => {
                  const action = getCardAction(item, navigate);

                  // Use human-readable label from the map, fall back to raw task_type.
                  const categoryLabel =
                    TASK_DISPLAY_LABELS[item.category] || item.category || "General";

                  return (
                    <div
                      key={item.id}
                      className={item.muted ? "competition-card muted" : "competition-card"}
                    >
                      <div className="competition-top">
                        <div className="competition-category-wrap">
                          <CompetitionTaskIcon type={item.category} />
                          <span className="competition-category">{categoryLabel}</span>
                        </div>

                        <div className="competition-chip-row">
                          <RoleChip role={item.user_role} />
                          <StatusChip status={item.status} />
                        </div>
                      </div>

                      <h3>{item.title}</h3>

                      <p>{item.description}</p>

                      <div className="competition-stats">
                        <div>
                          <span>{item.stat1_label}</span>
                          <strong>{item.stat1_value}</strong>
                        </div>

                        <div>
                          <span>{item.stat2_label}</span>
                          <strong>{item.stat2_value}</strong>
                        </div>
                      </div>

                      <div className="competition-footer">
                        <span>{item.footer}</span>

                        <button
                          type="button"
                          className={action.className}
                          onClick={action.onClick}
                        >
                          {action.label}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          <div className="load-more-box">
            <p>
              VIEWING {competitions.length} OF {totalCount} COMPETITIONS
            </p>

            <button
              type="button"
              onClick={handleLoadMore}
              disabled={!canLoadMore || loading}
            >
              {loading && offset > 0
                ? "Loading..."
                : canLoadMore
                  ? "Load More Entries"
                  : "No More Entries"}
            </button>
          </div>
        </div>

        <button
          type="button"
          className="floating-plus"
          onClick={() => navigate("/create-competition")}
        >
          +
        </button>
      </div>
    </div>
  );
}

export default Competitions;