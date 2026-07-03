import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import "./Dashboard.css";
import { supabase } from "../config/supabase";
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
} from "lucide-react";


function statusClass(status) {
    const s = String(status || "").toLowerCase();

    if (s === "open") return "open";
    if (s === "closed") return "closed";
    if (s === "ended") return "ended";
    if (s === "upcoming") return "upcoming";
    if (s === "in progress") return "in-progress";
    if (s === "submitted") return "submitted";
    if (s === "draft") return "draft";

    return "";
}

function normalizeStats(data) {
    return {
        organized_competitions: Number(data?.organized_competitions ?? 0),
        joined_competitions: Number(data?.joined_competitions ?? 0),
        teams_joined: Number(data?.teams_joined ?? 0),
    };
}

function normalizeRecentItem(item, index) {
    return {
        id: item?.id || `${item?.competition_id || "competition"}-${index}`,
        competition_id: item?.competition_id || null,
        title: item?.title || "Untitled Competition",
        type: item?.type || item?.task_type || "GENERAL",
        status: item?.status || "OPEN",
        score: item?.score || "--",
        sync: item?.sync || "Recently",
        icon: item?.icon || "🏆",
    };
}

function taskKey(type) {
    return String(type || "GENERAL")
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
}

function taskClass(type) {
    return taskKey(type).toLowerCase().replace(/_/g, "-");
}

const TASK_ICONS = {
    SENTIMENT_ANALYSIS: BarChart3,
    SUMMARIZATION: FileText,
    TRANSLATION: Languages,
    AUDIO_EVENT_DETECTION: Headphones,
    TEXT_CLASSIFICATION: Tags,
    IMAGE_CLASSIFICATION: Image,
    DATASET: Database,
    QUESTION_ANSWERING: MessageSquare,
    GENERAL: Trophy,
};

function TaskIcon({ type }) {
    const Icon = TASK_ICONS[taskKey(type)] || Trophy;
    return <Icon size={20} strokeWidth={2.3} />;
}

function Dashboard() {
    const [userName, setUserName] = useState("User");
    const [userId, setUserId] = useState(null);
    const [token, setToken] = useState(localStorage.getItem("token") || "");
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        organized_competitions: 0,
        joined_competitions: 0,
        teams_joined: 0,
    });
    const [recentCompetitions, setRecentCompetitions] = useState([]);

    const navigate = useNavigate();

    useEffect(() => {
        async function loadUser() {
            try {
                const { data, error } = await supabase.auth.getSession();

                if (error || !data?.session?.user) {
                    navigate("/login");
                    return;
                }

                const session = data.session;
                const user = session.user;
                const realUserId = user.id;

                localStorage.setItem("token", session.access_token);
                localStorage.setItem("user", JSON.stringify(user));

                setToken(session.access_token);
                setUserId(realUserId);

                let name =
                    user.user_metadata?.full_name ||
                    user.email?.split("@")[0] ||
                    "User";

                try {
                    const profileRes = await fetch("http://127.0.0.1:8000/profile/me", {
                        headers: { Authorization: `Bearer ${session.access_token}` },
                    });

                    if (profileRes.ok) {
                        const profile = await profileRes.json();
                        name =
                            profile.full_name ||
                            profile.name ||
                            profile.username ||
                            name;
                    }
                } catch (err) {
                    console.error("Profile name fetch failed:", err);
                }

                setUserName(name);

                fetch("http://127.0.0.1:8000/sync-user", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({
                        user_id: realUserId,
                        full_name: name,
                        email: user.email,
                    }),
                }).catch(console.error);
            } finally {
                setLoading(false);
            }
        }

        loadUser();
    }, [navigate]);

    const fetchStats = useCallback(async () => {
        if (!userId || !token) return;

        try {
            const res = await fetch(`http://127.0.0.1:8000/dashboard/stats/${userId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (res.status === 401) {
                navigate("/login");
                return;
            }

            const data = await res.json();

            if (!res.ok) {
                console.error("Stats fetch failed:", data);
                setStats({
                    organized_competitions: 0,
                    joined_competitions: 0,
                    teams_joined: 0,
                });
                return;
            }

            setStats(normalizeStats(data));
        } catch (err) {
            console.error("Stats fetch error:", err);
            setStats({
                organized_competitions: 0,
                joined_competitions: 0,
                teams_joined: 0,
            });
        }
    }, [userId, token, navigate]);

    const fetchRecent = useCallback(async () => {
        if (!userId || !token) return;

        try {
            const res = await fetch(`http://127.0.0.1:8000/dashboard/recent/${userId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (res.status === 401) {
                navigate("/login");
                return;
            }

            const data = await res.json();

            if (!res.ok) {
                console.error("Recent competitions fetch failed:", data);
                setRecentCompetitions([]);
                return;
            }

            const safeData = Array.isArray(data) ? data : [];
            setRecentCompetitions(safeData.map(normalizeRecentItem));
        } catch (err) {
            console.error("Recent competitions fetch error:", err);
            setRecentCompetitions([]);
        }
    }, [userId, token, navigate]);

    useEffect(() => {
        if (!userId || !token) return;

        fetchStats();
        fetchRecent();
    }, [userId, token, fetchStats, fetchRecent]);

    if (loading) {
        return (
            <div className="dashboard-shell">
                <Sidebar />
                <div className="dashboard-main">
                    <Topbar
                        title="Loading dashboard..."
                        subtitle="Please wait while your workspace loads."
                        showBrowseButton={false}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="dashboard-shell">
            <Sidebar />

            <div className="dashboard-main">
                <Topbar
                    title={`Welcome Home, ${userName}`}
                    subtitle="Overview of your activity and performance across the laboratory."
                    showBrowseButton={true}
                />

                <div className="dashboard-body">
                    <div className="dashboard-left full-width">
                        <div className="stats-row">
                            <div className="stat-card">
                                <div className="stat-card-top">
                                    <span className="stat-icon">🏆</span>
                                    <span className="today-badge">Organized</span>
                                </div>
                                <h3>{String(stats.organized_competitions || 0).padStart(2, "0")}</h3>
                                <p>ORGANIZED COMPETITIONS</p>
                            </div>

                            <div className="stat-card">
                                <div className="stat-card-top">
                                    <span className="stat-icon">🤝</span>
                                </div>
                                <h3>{String(stats.joined_competitions || 0).padStart(2, "0")}</h3>
                                <p>JOINED COMPETITIONS</p>
                            </div>

                            <div className="stat-card">
                                <div className="stat-card-top">
                                    <span className="stat-icon">👥</span>
                                </div>
                                <h3>{String(stats.teams_joined || 0).padStart(2, "0")}</h3>
                                <p>TEAMS JOINED</p>
                            </div>
                        </div>

                        <div className="recent-card">
                            <div className="section-head">
                                <h2>Recent Competitions</h2>

                                <div className="small-actions">
                                    <button type="button" onClick={() => navigate("/competitions")}>
                                        ↗
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            fetchStats();
                                            fetchRecent();
                                        }}
                                    >
                                        ⟳
                                    </button>
                                </div>
                            </div>

                            <div className="recent-head">
                                <span>COMPETITION / TASK</span>
                                <span>STATUS</span>
                                <span>SCORE</span>
                                <span>LAST SYNC</span>
                            </div>

                            <div className="recent-list">
                                {recentCompetitions.length === 0 ? (
                                    <p style={{ padding: "10px" }}>No recent competitions</p>
                                ) : (
                                    recentCompetitions.map((item) => (
                                        <div
                                            className="recent-row"
                                            key={item.id}
                                            onClick={() => {
                                                if (item.competition_id) {
                                                    navigate(`/competitions/${item.competition_id}`);
                                                } else {
                                                    navigate("/competitions");
                                                }
                                            }}
                                            style={{ cursor: "pointer" }}
                                        >
                                            <div className="recent-main">
                                                <div className={`recent-icon ${taskClass(item.type)}`}>
    <TaskIcon type={item.type} />
</div>
                                                <div>
                                                    <h3>{item.title}</h3>
                                                    <p>{item.type}</p>
                                                </div>
                                            </div>

                                            <div>
                                                <span className={`status-pill ${statusClass(item.status)}`}>
                                                    {item.status}
                                                </span>
                                            </div>

                                            <div className="recent-score">{item.score}</div>
                                            <div className="recent-sync">{item.sync}</div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Dashboard;
