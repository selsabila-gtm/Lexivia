import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import NotificationPopup from "./NotificationPopup";

function getUserInitial() {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    const name =
      user.username ||
      user.name ||
      user.email ||
      user.user_metadata?.full_name ||
      "U";

    return String(name).trim().slice(0, 1).toUpperCase();
  } catch {
    return "U";
  }
}

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
      <header style={topbarWrapper}>
        <div style={topbarLeft} />

        <div style={topbarRight}>
          <form onSubmit={handleSearch} style={searchWrapper}>
            <button type="submit" style={searchIconBtn} title="Search">
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
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            </button>

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

            {search && (
              <button
                type="button"
                onClick={handleClear}
                style={clearBtn}
                title="Clear search"
              >
                ×
              </button>
            )}
          </form>

          <NotificationPopup />

          <button
            type="button"
            onClick={() => navigate("/profile")}
            style={profileBtn}
            title="Profile"
          >
            {getUserInitial()}
          </button>
        </div>
      </header>

      {(title || subtitle || showBrowseButton) && (
        <section style={headerWrapper}>
          <div>
            {title && <h1 style={titleStyle}>{title}</h1>}
            {subtitle && <p style={subtitleStyle}>{subtitle}</p>}
          </div>

          {showBrowseButton && (
            <button
              onClick={() => navigate("/competitions")}
              style={browseBtn}
            >
              Browse Competitions
            </button>
          )}
        </section>
      )}
    </>
  );
}

/* ---------------- STYLES ---------------- */

const topbarWrapper = {
  height: "58px",
  background: "#ffffff",
  borderBottom: "1px solid #e8ebf3",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "22px",
  padding: "0 28px",
  position: "sticky",
  top: 0,
  zIndex: 60,
  boxSizing: "border-box",
};

const topbarLeft = {
  flex: 1,
  minWidth: 0,
};

const topbarRight = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: "12px",
  minWidth: 0,
};

const searchWrapper = {
  width: "360px",
  height: "40px",
  border: "1px solid #e3e7f0",
  background: "#f7f8fc",
  borderRadius: "12px",
  display: "flex",
  alignItems: "center",
  overflow: "hidden",
  position: "relative",
};

const searchIconBtn = {
  width: "40px",
  height: "40px",
  border: "none",
  background: "transparent",
  color: "#64748b",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  flexShrink: 0,
};

const searchInput = {
  flex: 1,
  height: "100%",
  border: "none",
  outline: "none",
  background: "transparent",
  color: "#334155",
  fontSize: "13px",
  minWidth: 0,
  padding: "0 36px 0 0",
  fontFamily: "inherit",
};

const clearBtn = {
  position: "absolute",
  right: "7px",
  top: "50%",
  transform: "translateY(-50%)",
  width: "26px",
  height: "26px",
  borderRadius: "50%",
  border: "none",
  background: "#eef2ff",
  color: "#6f778d",
  fontSize: "17px",
  lineHeight: "1",
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
};

const profileBtn = {
  width: "38px",
  height: "38px",
  border: "none",
  borderRadius: "12px",
  background: "#0d57d8",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 900,
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
  boxShadow: "0 8px 20px rgba(13, 87, 216, 0.16)",
};

const headerWrapper = {
  padding: "26px 30px 0",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
};

const titleStyle = {
  margin: 0,
  fontSize: "34px",
  lineHeight: "1.1",
  color: "#19233c",
  fontWeight: 800,
  letterSpacing: "-0.04em",
};

const subtitleStyle = {
  margin: "9px 0 0",
  color: "#677086",
  fontSize: "14px",
  lineHeight: "1.5",
};

const browseBtn = {
  height: "46px",
  minWidth: "180px",
  border: "none",
  borderRadius: "12px",
  background: "#0d57d8",
  color: "#ffffff",
  fontWeight: 800,
  cursor: "pointer",
  boxShadow: "0 8px 20px rgba(13, 87, 216, 0.16)",
};

export default Topbar;