import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import "./OrganizerDashboard.css";

const API = "http://127.0.0.1:8000";

function safeJson(value, fallback = []) {
    try {
        if (!value) return fallback;
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : fallback;
    } catch {
        return fallback;
    }
}

function money(value) {
    if (value === null || value === undefined || value === "") return "TBD";
    return `$${Number(value).toLocaleString()}`;
}

function getToken() {
    return (
        localStorage.getItem("token") ||
        localStorage.getItem("access_token") ||
        localStorage.getItem("jwt")
    );
}

function authHeader() {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function fmtScore(value) {
    if (value === null || value === undefined) return "—";
    const n = Number(value);
    if (Number.isNaN(n)) return "—";
    return n.toFixed(4);
}

function fmtDate(value) {
    if (!value) return "—";
    try {
        return new Date(value).toLocaleDateString();
    } catch {
        return value;
    }
}

function TopPerformersPanel({ competitionId }) {
    const navigate = useNavigate();

    const [leaderboard, setLeaderboard] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const fetchLeaderboard = useCallback(
        async (silent = false) => {
            if (!silent) setLoading(true);
            setError("");

            try {
                const res = await fetch(`${API}/competitions/${competitionId}/leaderboard-rich`, {
                    headers: authHeader(),
                });

                if (res.status === 401) {
                    setError("Session expired. Please log in again.");
                    return;
                }

                const data = await res.json();

                if (!res.ok) {
                    throw new Error(data.detail || "Could not load leaderboard.");
                }

                setLeaderboard(data);
            } catch (err) {
                setError(err.message || "Could not load leaderboard.");
            } finally {
                if (!silent) setLoading(false);
            }
        },
        [competitionId]
    );

    useEffect(() => {
        fetchLeaderboard();

        const interval = setInterval(() => {
            fetchLeaderboard(true);
        }, 30000);

        return () => clearInterval(interval);
    }, [fetchLeaderboard]);

    const entries = leaderboard?.entries ?? [];
    const topEntries = entries.slice(0, 3);
    const primaryMetric = leaderboard?.primary_metric || "Score";

    return (
        <div className="panel top-performers-panel">
            <div className="section-row">
                <h2>Top Performers</h2>
                <span>{entries.length} ranked</span>
            </div>

            {loading ? (
                <div className="empty-state">
                    <strong>Loading leaderboard...</strong>
                    <p>Fetching latest validated submissions.</p>
                </div>
            ) : error ? (
                <div className="empty-state">
                    <strong>Could not load leaderboard</strong>
                    <p>{error}</p>
                </div>
            ) : topEntries.length === 0 ? (
                <div className="empty-state">
                    <strong>No leaderboard yet</strong>
                    <p>Top teams will appear after model submissions are validated.</p>
                </div>
            ) : (
                <div className="top-performers-list">
                    {topEntries.map((entry, index) => {
                        const rank = entry.rank ?? index + 1;
                        const name = entry.team_name || entry.user_name || "Unknown participant";

                        return (
                            <div className="top-performer-card" key={entry.submission_id || rank}>
                                <div className="top-performer-left">
                                    <span className={`top-rank top-rank-${rank}`}>#{rank}</span>

                                    <div>
                                        <strong>{name}</strong>
                                        <p>
                                            {entry.team_name
                                                ? `Submitted by ${entry.user_name || "Unknown"}`
                                                : "Solo participant"}
                                        </p>
                                    </div>
                                </div>

                                <div className="top-performer-score">
                                    <strong>{fmtScore(entry.score)}</strong>
                                    <span>{primaryMetric}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {entries.length > 0 && (
                <div className="leaderboard-mini-footer">
                    <span>Best score: {fmtScore(entries[0]?.score)}</span>
                    <span>Updated automatically</span>
                </div>
            )}

            <button
                className="full-btn"
                type="button"
                onClick={() => navigate(`/competitions/${competitionId}/leaderboard`)}
            >
                View Full Leaderboard
            </button>
        </div>
    );
}

function OrganizerDashboard() {
    const { competitionId } = useParams();
    const navigate = useNavigate();

    const [competition, setCompetition] = useState(null);
    const [monitoring, setMonitoring] = useState(null);
    const [loading, setLoading] = useState(true);

    const [datasets, setDatasets] = useState([]);
    const [datasetsLoading, setDatasetsLoading] = useState(false);

    const [joinRequests, setJoinRequests] = useState([]);
    const [requestsLoading, setRequestsLoading] = useState(false);

    const token = getToken();

    const fetchDatasets = useCallback(async () => {
        if (!token) return;

        setDatasetsLoading(true);

        try {
            const res = await fetch(`${API}/competitions/${competitionId}/datasets`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!res.ok) {
                throw new Error("Could not load datasets");
            }

            const data = await res.json();
            setDatasets(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error(error);
            setDatasets([]);
        } finally {
            setDatasetsLoading(false);
        }
    }, [competitionId, token]);

    const fetchJoinRequests = useCallback(async () => {
        if (!token) return;

        setRequestsLoading(true);

        try {
            const res = await fetch(`${API}/competitions/${competitionId}/join-requests`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (res.ok) {
                const data = await res.json();
                setJoinRequests(Array.isArray(data) ? data : []);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setRequestsLoading(false);
        }
    }, [competitionId, token]);

    const handleJoinRequestAction = async (requestId, action) => {
        try {
            const res = await fetch(
                `${API}/competitions/${competitionId}/join-requests/${requestId}/${action}`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            if (!res.ok) {
                const e = await res.json();
                throw new Error(e.detail || "Action failed");
            }

            setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
        } catch (error) {
            alert(error.message);
        }
    };

    async function handleDeleteCompetition() {
        const confirmDelete = window.confirm("Are you sure you want to delete this competition?");

        if (!confirmDelete) return;

        try {
            const res = await fetch(`${API}/competitions/${competitionId}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.detail || "Delete failed");
            }

            alert("Competition deleted successfully.");
            navigate("/competitions?tab=organizing");
        } catch (error) {
            console.error(error);
            alert(error.message || "Could not delete competition.");
        }
    }

    useEffect(() => {
        if (!token) {
            navigate("/login");
            return;
        }

        async function loadDashboard() {
            try {
                const [competitionRes, monitoringRes] = await Promise.all([
                    fetch(`${API}/competitions/${competitionId}`, {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    }),
                    fetch(`${API}/competitions/${competitionId}/monitoring`, {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    }),
                ]);

                if (!competitionRes.ok) {
                    throw new Error("Competition not found");
                }

                const competitionData = await competitionRes.json();
                const monitoringData = await monitoringRes.json();

                if (monitoringData.is_organizer !== true) {
                    alert("Only the organizer can access this dashboard.");
                    navigate(`/competitions/${competitionId}`);
                    return;
                }

                setCompetition(competitionData);
                setMonitoring(monitoringData);

                fetchDatasets();
                fetchJoinRequests();
            } catch (error) {
                console.error(error);
                alert("Could not load organizer dashboard.");
                navigate("/competitions");
            } finally {
                setLoading(false);
            }
        }

        loadDashboard();
    }, [competitionId, navigate, token, fetchDatasets, fetchJoinRequests]);

    useEffect(() => {
        if (!token) return;

        const interval = setInterval(() => {
            fetch(`${API}/competitions/${competitionId}/monitoring`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            })
                .then((res) => res.json())
                .then(setMonitoring)
                .catch(() => {});
        }, 5000);

        return () => clearInterval(interval);
    }, [competitionId, token]);

    const milestones = useMemo(() => {
        const extra = safeJson(competition?.milestones_json, []);

        return [
            { title: "Submission Open", date: competition?.start_date },
            { title: "Model Validation", date: competition?.validation_date },
            { title: "Final Leaderboard", date: competition?.freeze_date },
            { title: "Competition End", date: competition?.end_date },
            ...extra,
        ];
    }, [competition]);

    if (loading) {
        return (
            <div className="organizer-layout">
                <Sidebar />

                <main className="organizer-main">
                    <p className="organizer-loading">Loading organizer dashboard...</p>
                </main>
            </div>
        );
    }

    if (!competition || !monitoring) return null;

    return (
        <div className="organizer-layout">
            <Sidebar />

            <main className="organizer-main">
                <div className="organizer-topbar">
                    <input
                        className="organizer-search"
                        placeholder="Search competitions, datasets, teams..."
                    />

                    <div className="organizer-icons">
                        <span>🔔</span>
                        <span>☰</span>
                        <span>👤</span>
                    </div>
                </div>

                <section className="organizer-header">
                    <div>
                        <button
                            className="back-btn"
                            type="button"
                            onClick={() => navigate("/competitions?tab=organizing")}
                        >
                            ← Back to Competitions
                        </button>

                        <div className="organizer-title-row">
                            <h1>{competition.title}</h1>
                            <span className="badge badge-open">{competition.status}</span>
                            <span className="badge badge-organizing">ORGANIZING</span>
                        </div>

                        <p>Manage your competition, review submissions, and track progress.</p>
                    </div>

                    <div className="organizer-actions">
                        <button
                            type="button"
                            onClick={() =>
                                navigate(`/edit-competition/${competitionId}`, {
                                    state: {
                                        competition,
                                    },
                                })
                            }
                        >
                            Edit Competition
                        </button>

                        <button type="button" className="danger" onClick={handleDeleteCompetition}>
                            Delete
                        </button>
                    </div>
                </section>

                <section className="stat-grid">
                    <div className="stat-card">
                        <span>Total Participants</span>
                        <strong>{monitoring.participants_count ?? 0}</strong>
                        <p>↗ live from joined users</p>
                    </div>

                    <div className="stat-card">
                        <span>Active Teams</span>
                        <strong>{monitoring.teams_count ?? 0}</strong>
                        <p>Max teams: {monitoring.max_teams || "Unlimited"}</p>
                    </div>

                    <div className="stat-card">
                        <span>Total Submissions</span>
                        <strong>{monitoring.submissions_count ?? 0}</strong>
                        <p>{monitoring.leaderboard_status}</p>
                    </div>

                    <div className="stat-card">
                        <span>Prize Pool</span>
                        <strong>{money(competition.prize_pool)}</strong>
                        <p>Ends {competition.end_date || "Not set"}</p>
                    </div>
                </section>

                <section className="organizer-content-grid">
                    <div className="panel large-panel">
                        <h2>Competition Overview</h2>
                        <p className="overview-text">{competition.description}</p>

                        <div className="overview-grid">
                            <div>
                                <h4>Evaluation Metrics</h4>
                                <p>Primary: {competition.primary_metric || "Not selected"}</p>
                                <p>Secondary: {competition.secondary_metric || "Not selected"}</p>
                            </div>

                            <div>
                                <h4>Key Milestones</h4>

                                {milestones.map((item, index) => (
                                    <p key={index}>
                                        ✓ {item.title} - {item.date || "Not set"}
                                    </p>
                                ))}
                            </div>
                        </div>

                        <div className="blue-note">
                            <strong>Submission Activity</strong>
                            <p>
                                {monitoring.submissions_count === 0
                                    ? "No model submissions yet. Waiting for participants to start submitting."
                                    : `${monitoring.submissions_count} submissions received.`}
                            </p>
                        </div>
                    </div>

                    <TopPerformersPanel competitionId={competitionId} />
                </section>

                <section className="panel">
                    <div className="section-row">
                        <h2>Data Collection</h2>
                        <span>{monitoring.data_collection_status}</span>
                    </div>

                    {datasetsLoading ? (
                        <div className="empty-state">
                            <strong>Loading datasets...</strong>
                            <p>Fetching files attached to this competition.</p>
                        </div>
                    ) : datasets.length === 0 ? (
                        <div className="empty-state">
                            <strong>No datasets configured</strong>
                            <p>Add datasets from the competition dataset hub.</p>
                        </div>
                    ) : (
                        <div className="dataset-grid">
                            {datasets.map((dataset) => (
                                <div className="dataset-card" key={dataset.id}>
                                    <strong>{dataset.original_filename || "Dataset file"}</strong>
                                    <p>{dataset.description || dataset.dataset_type || "Unknown type"}</p>
                                    <span>{dataset.dataset_type || "Private"}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                <section className="panel">
                    <div className="section-row">
                        <h2>Recent Submissions</h2>
                        <button type="button">Export All</button>
                    </div>

                    <table className="submission-table">
                        <thead>
                            <tr>
                                <th>Team</th>
                                <th>Score</th>
                                <th>Time</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>

                        <tbody>
                            <tr>
                                <td colSpan="5" className="table-empty">
                                    No submissions yet.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </section>

                {competition.join_method === "manual" && (
                    <section id="join-requests" className="panel">
                        <div className="section-row">
                            <h2>Join Requests</h2>
                            <span>{joinRequests.length} pending</span>
                        </div>

                        {requestsLoading ? (
                            <p style={{ color: "#aaa", fontSize: 13 }}>Loading requests…</p>
                        ) : joinRequests.length === 0 ? (
                            <div className="empty-state">
                                <strong>No pending requests</strong>
                                <p>All join requests have been reviewed, or none have been submitted yet.</p>
                            </div>
                        ) : (
                            <table className="submission-table">
                                <thead>
                                    <tr>
                                        <th>Applicant / Team</th>
                                        <th>Members</th>
                                        <th>Message</th>
                                        <th>Submitted</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>

                                <tbody>
                                    {joinRequests.map((req) => {
                                        const members = req.team?.members?.length
                                            ? req.team.members
                                            : [
                                                {
                                                    user_id: req.user_id,
                                                    username: req.username,
                                                    email: req.email,
                                                    role: "solo",
                                                    skills: req.skills || [],
                                                },
                                            ];

                                        return (
                                            <tr key={req.id}>
                                                <td style={{ fontWeight: 600 }}>
                                                    <div>{req.team?.name || req.username || req.user_id}</div>

                                                    <span
                                                        style={{
                                                            fontSize: 10,
                                                            fontWeight: 700,
                                                            padding: "2px 8px",
                                                            borderRadius: 20,
                                                            letterSpacing: "0.04em",
                                                            background: req.team_id ? "#e8f5e9" : "#e8edfb",
                                                            color: req.team_id ? "#2e7d32" : "#2547c0",
                                                        }}
                                                    >
                                                        {req.team_id ? "TEAM" : "SOLO"}
                                                    </span>
                                                </td>

                                                <td>
                                                    {members.map((member) => (
                                                        <div key={member.user_id} style={{ marginBottom: 6 }}>
                                                            <strong>{member.username || member.user_id}</strong>
                                                            <div style={{ color: "#888", fontSize: 12 }}>
                                                                {member.email || "No email"} · {member.role || "member"}
                                                            </div>
                                                            {member.skills?.length > 0 && (
                                                                <div style={{ color: "#2d5cf6", fontSize: 11 }}>
                                                                    {member.skills.join(", ")}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </td>

                                                <td style={{ color: "#666" }}>
                                                    {req.message || "No message"}
                                                </td>

                                                <td>{fmtDate(req.created_at)}</td>

                                                <td>
                                                    <div style={{ display: "flex", gap: 8 }}>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleJoinRequestAction(req.id, "approve")}
                                                        >
                                                            Approve
                                                        </button>

                                                        <button
                                                            type="button"
                                                            className="danger"
                                                            onClick={() => handleJoinRequestAction(req.id, "reject")}
                                                        >
                                                            Reject
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </section>
                )}
            </main>
        </div>
    );
}

export default OrganizerDashboard;