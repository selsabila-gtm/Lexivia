import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import "../styles/SearchResults.css";

function SearchResults() {
    const location = useLocation();
    const navigate = useNavigate();

    const q = new URLSearchParams(location.search).get("q") || "";
    const cleanQuery = q.trim();

    const previousPage = location.state?.from || "/dashboard";

    const [competitions, setCompetitions] = useState([]);
    const [teams, setTeams] = useState([]);
    const [datasets, setDatasets] = useState([]);
    const [loading, setLoading] = useState(false);

    const handleClear = () => {
        navigate(previousPage);
    };

    useEffect(() => {
        if (!cleanQuery) {
            setCompetitions([]);
            setTeams([]);
            setDatasets([]);
            setLoading(false);
            return;
        }

        setLoading(true);

        Promise.all([
            fetch(
                `http://127.0.0.1:8000/competitions?search=${encodeURIComponent(cleanQuery)}`,
                {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem("token")}`,
                    },
                }
            )
                .then((res) => res.json())
                .catch(() => []),

            fetch(
                `http://127.0.0.1:8000/teams?search=${encodeURIComponent(cleanQuery)}`,
                {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem("token")}`,
                    },
                }
            )
                .then((res) => res.json())
                .catch(() => ({ teams: [] })),

            Promise.resolve([]),
        ])
            .then(([competitionsData, teamsData, datasetsData]) => {
                const competitionsArray = Array.isArray(competitionsData) ? competitionsData : [];
                const teamsArray = Array.isArray(teamsData?.teams) ? teamsData.teams : [];

                setCompetitions(
                    competitionsArray.filter((comp) =>
                        comp.title?.toLowerCase().includes(cleanQuery.toLowerCase())
                    )
                );

                setTeams(
                    teamsArray.filter((team) =>
                        team.name?.toLowerCase().includes(cleanQuery.toLowerCase())
                    )
                );

                setDatasets(Array.isArray(datasetsData) ? datasetsData : []);
            })
            .catch((err) => {
                console.error("Global search error:", err);
            })
            .finally(() => setLoading(false));
    }, [cleanQuery]);

    return (
        <div className="competitions-shell">
            <Sidebar />

            <div className="competitions-main">
                <Topbar
                    title={cleanQuery ? `Search results for "${cleanQuery}"` : "Search"}
                    subtitle="Results across competitions, datasets, teams, and platform content."
                />

                <div className="search-body">

                    {/* CLEAR BUTTON */}
                    <div className="search-clear-wrapper">
                        <button className="search-clear-btn" onClick={handleClear}>
                            ✕
                        </button>
                    </div>

                    {!cleanQuery ? (
                        <div className="empty-search">
                            Start typing to search competitions, teams, and datasets.
                        </div>
                    ) : loading ? (
                        <p>Searching...</p>
                    ) : (
                        <>
                            <section className="search-section">
                                <h2>Competitions</h2>

                                {competitions.length === 0 ? (
                                    <div className="empty-search">No competitions found.</div>
                                ) : (
                                    <div className="search-grid">
                                        {competitions.map((item) => (
                                            <div
                                                key={item.id}
                                                className="search-card"
                                                onClick={() => navigate(`/competitions/${item.id}`)}
                                            >
                                                <div>
                                                    <h3>{item.title}</h3>
                                                    <p>{item.description}</p>
                                                </div>

                                                <button
                                                    className="search-open-btn"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        navigate(`/competitions/${item.id}`);
                                                    }}
                                                >
                                                    →
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>

                            <section className="search-section">
                                <h2>Teams</h2>

                                {teams.length === 0 ? (
                                    <div className="empty-search">No teams found.</div>
                                ) : (
                                    <div className="search-grid">
                                        {teams.map((team) => (
                                            <div
                                                key={team.id}
                                                className="search-card"
                                                onClick={() => navigate(`/teams/${team.id}`)}
                                            >
                                                <div>
                                                    <h3>{team.name}</h3>
                                                    <p>{team.description || "No description"}</p>
                                                </div>

                                                <button
                                                    className="search-open-btn"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        navigate(`/teams/${team.id}`);
                                                    }}
                                                >
                                                    →
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>

                            <section className="search-section">
                                <h2>Datasets</h2>

                                {datasets.length === 0 ? (
                                    <div className="empty-search">No datasets found.</div>
                                ) : (
                                    <div className="search-grid">
                                        {datasets.map((dataset) => (
                                            <div
                                                key={dataset.id}
                                                className="search-card"
                                                onClick={() => navigate(`/datasets/${dataset.id}`)}
                                            >
                                                <div>
                                                    <h3>{dataset.name}</h3>
                                                    <p>{dataset.description || "No description"}</p>
                                                </div>

                                                <button
                                                    className="search-open-btn"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        navigate(`/datasets/${dataset.id}`);
                                                    }}
                                                >
                                                    →
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default SearchResults;