import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import "./CompetitionSidebar.css";

const API = "http://127.0.0.1:8000";

function getToken() {
  return (
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt")
  );
}

function CIcon({ children }) {
  return (
    <span className="csidebar-icon" aria-hidden="true">
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </span>
  );
}

const NAV_ITEMS = [
  {
    key: "data-collection",
    label: "Data Collection",
    path: "data-collection",
    icon: (
      <CIcon>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
        <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
      </CIcon>
    ),
  },
  {
    key: "dataset-hub",
    label: "Validation",
    path: "dataset-hub",
    icon: (
      <CIcon>
        <path d="M20 6L9 17l-5-5" />
        <path d="M21 12a9 9 0 1 1-3.4-7" />
      </CIcon>
    ),
  },
  {
    key: "experiments",
    label: "Workspace",
    path: "experiments",
    icon: (
      <CIcon>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 10h18" />
        <path d="M9 10v10" />
      </CIcon>
    ),
  },
  {
    key: "experiment-registry",
    label: "Experiments",
    path: "experiment-registry",
    icon: (
      <CIcon>
        <path d="M9 3v6l-5 9a2 2 0 0 0 1.75 3h12.5A2 2 0 0 0 20 18l-5-9V3" />
        <path d="M8 3h8" />
        <path d="M7 15h10" />
      </CIcon>
    ),
  },
  {
    key: "leaderboard",
    label: "Leaderboard",
    path: "leaderboard",
    icon: (
      <CIcon>
        <path d="M4 20V10" />
        <path d="M10 20V4" />
        <path d="M16 20v-7" />
        <path d="M22 20H2" />
      </CIcon>
    ),
  },
  {
    key: "documentation",
    label: "Documentation",
    path: "documentation",
    icon: (
      <CIcon>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8" />
        <path d="M8 17h6" />
      </CIcon>
    ),
  },
];

function CompetitionSidebar({ competitionId: propCompetitionId, competitionTitle }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { competitionId: paramCompetitionId, id: paramId } = useParams();

  const competitionId = propCompetitionId || paramCompetitionId || paramId;
  const [loadedTitle, setLoadedTitle] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadCompetitionTitle() {
      if (!competitionId || competitionTitle) return;

      try {
        const token = getToken();

        const res = await fetch(`${API}/competitions/${competitionId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!res.ok) return;

        const data = await res.json();

        if (!cancelled) {
          setLoadedTitle(data?.title || "");
        }
      } catch (err) {
        console.warn("Could not load competition title:", err);
      }
    }

    loadCompetitionTitle();

    return () => {
      cancelled = true;
    };
  }, [competitionId, competitionTitle]);

  const titleToShow = competitionTitle || loadedTitle || "Competition";

  const activeKey = useMemo(() => {
    const parts = location.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];

    if (last === competitionId) return "overview";

    return last || "data-collection";
  }, [location.pathname, competitionId]);

  const goToCompetitionPage = (path) => {
    if (!competitionId) return;
    navigate(`/competitions/${competitionId}/${path}`);
  };

  return (
    <aside className="csidebar">
      <button
        type="button"
        className="csidebar-back"
        onClick={() => navigate("/competitions")}
      >
        ← BACK TO COMPETITIONS
      </button>

      <div className="csidebar-identity">
        <span className="csidebar-brand" title={titleToShow}>
          {titleToShow}
        </span>
      </div>

      <nav className="csidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`csidebar-item ${activeKey === item.key ? "active" : ""}`}
            onClick={() => goToCompetitionPage(item.path)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="csidebar-bottom">
        <button
          type="button"
          className="csidebar-util"
          onClick={() => navigate("/profile/settings")}
        >
          <CIcon>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.05.05a2 2 0 1 1-2.83 2.83l-.05-.05a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V22a2 2 0 0 1-4 0v-.08a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.87.34l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 0 1 0-4h.04A1.7 1.7 0 0 0 4.6 8.4a1.7 1.7 0 0 0-.34-1.87l-.05-.05a2 2 0 1 1 2.83-2.83l.05.05A1.7 1.7 0 0 0 8.96 4.04 1.7 1.7 0 0 0 10 2.48V2a2 2 0 0 1 4 0v.48a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05A1.7 1.7 0 0 0 19.4 8.4a1.7 1.7 0 0 0 1.56 1.56H21a2 2 0 0 1 0 4h-.04A1.7 1.7 0 0 0 19.4 15z" />
          </CIcon>
          Settings
        </button>

        <button
          type="button"
          className="csidebar-util"
          onClick={() => goToCompetitionPage("support")}
        >
          <CIcon>
            <circle cx="12" cy="12" r="10" />
            <path d="M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2.5-3 4" />
            <path d="M12 17h.01" />
          </CIcon>
          Support
        </button>
      </div>
    </aside>
  );
}

export default CompetitionSidebar;