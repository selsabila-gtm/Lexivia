import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import NotificationPopup from "./NotificationPopup";   // ← new
import {
    User,
    Settings,
    Search,
    X,
    BellDot 
} from "lucide-react";
function Topbar({ title = "", subtitle = "", showBrowseButton = false }) {
    const navigate = useNavigate();
    const location = useLocation();

    const currentQuery = new URLSearchParams(location.search).get("q") || "";
    const [search, setSearch] = useState(currentQuery);

    useEffect(() => {
        setSearch(currentQuery);
    }, [currentQuery]);

    function handleSearch(e) {
        e.preventDefault();
        const q = search.trim();
        if (!q) return;
        navigate(`/search?q=${encodeURIComponent(q)}`);
    }

    function handleClear() {
        setSearch("");
        navigate("/search");
    }

    return (
        <>
            <div style={topbarWrapper}>
                <div style={topbarInner}>

                    {/* SEARCH */}
                    <form onSubmit={handleSearch} style={searchWrapper}>
                        <input
                            value={search}
                            onChange={(e) => {
                                const value = e.target.value;
                                setSearch(value);
                                if (location.pathname === "/search") {
                                    if (value.trim()) {
                                        navigate(`/search?q=${encodeURIComponent(value)}`);
                                    } else {
                                        navigate("/search");
                                    }
                                }
                            }}
                            placeholder="Search competitions, datasets, teams..."
                            style={searchInput}
                        />
                        <button
                            type="button"
                            onClick={handleClear}
                            style={clearBtn}
                        >
                            ✕
                        </button>
                    </form>

                    {/* NOTIFICATION BELL — now uses the popup component */}
                    <NotificationPopup />

                   

                    <button onClick={() => navigate("/profile")} style={iconBtn}>
                        <User size={18} strokeWidth={2} />
                    </button>
                </div>
            </div>

            {(title || subtitle || showBrowseButton) && (
                <div style={headerWrapper}>
                    <div>
                        <h1 style={titleStyle}>{title}</h1>
                        <p style={subtitleStyle}>{subtitle}</p>
                    </div>

                    {showBrowseButton && (
                        <button
                            onClick={() => navigate("/competitions")}
                            style={browseBtn}
                        >
                            Browse Competitions
                        </button>
                    )}
                </div>
            )}
        </>
    );
}

/* ---------------- STYLES ---------------- */

const topbarWrapper = {
    position: "sticky",
    top: 0,
    zIndex: 1000,
    background: "#ffffff",
    padding: "18px 22px 0",
    boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
};

const topbarInner = {
    height: "56px",
    borderBottom: "1px solid #ececf3",
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "16px",
};

const searchWrapper = {
    position: "relative",
};

const searchInput = {
    width: "360px",
    height: "38px",
    border: "1px solid #e6e9f2",
    background: "#f7f8fc",
    borderRadius: "20px",
    padding: "0 40px 0 16px",
    fontSize: "13px",
    outline: "none",
    color: "#475069",
};

const clearBtn = {
    position: "absolute",
    right: "8px",
    top: "50%",
    transform: "translateY(-50%)",
    width: "26px",
    height: "26px",
    borderRadius: "50%",
    border: "none",
    background: "#eef2ff",
    color: "#6f778d",
    fontSize: "14px",
    cursor: "pointer",
    transition: "all 0.2s ease",
};

const iconBtn = {
    width: "34px",
    height: "34px",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: "18px",
    color: "#6f778d",
};

const headerWrapper = {
    padding: "24px 30px 0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
};

const titleStyle = {
    margin: 0,
    fontSize: "34px",
    color: "#19233c",
    fontWeight: 800,
};

const subtitleStyle = {
    margin: "8px 0 0",
    color: "#677086",
    fontSize: "14px",
};

const browseBtn = {
    height: "50px",
    minWidth: "190px",
    border: "none",
    borderRadius: "14px",
    background: "#0d57d8",
    color: "#ffffff",
    fontWeight: 700,
    cursor: "pointer",
};
const profileBtn = {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    border: "1px solid #e8ebf3",
    background: "#ffffff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    color: "#334155",
    transition: "all 0.2s ease",
};
export default Topbar;
