import { NavLink, useLocation } from "react-router-dom";
import "./Sidebar.css";
import logo from "../assets/logo.png";

function Icon({ children }) {
  return (
    <span className="sidebar-icon" aria-hidden="true">
      <svg
        width="18"
        height="18"
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

function Sidebar() {
  const location = useLocation();

  const competitionsActive =
    location.pathname === "/competitions" ||
    location.pathname === "/create-competition" ||
    location.pathname.startsWith("/competitions/") ||
    location.pathname.startsWith("/edit-competition/");

  return (
    <aside className="sidebar">
      <div>
        <NavLink to="/dashboard" className="sidebar-brand">
          <img src={logo} alt="Lexivia logo" className="sidebar-logo" />
        </NavLink>

        <nav className="sidebar-nav">
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              isActive ? "sidebar-link active" : "sidebar-link"
            }
          >
            <Icon>
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
            </Icon>
            <span>Dashboard</span>
          </NavLink>

          <NavLink
            to="/competitions"
            className={competitionsActive ? "sidebar-link active" : "sidebar-link"}
          >
            <Icon>
              <path d="M8 21h8" />
              <path d="M12 17v4" />
              <path d="M7 4h10v4a5 5 0 0 1-10 0V4z" />
              <path d="M7 6H4a2 2 0 0 0 2 4h1" />
              <path d="M17 6h3a2 2 0 0 1-2 4h-1" />
            </Icon>
            <span>Competitions</span>
          </NavLink>

          <NavLink
            to="/teams"
            className={({ isActive }) =>
              isActive ? "sidebar-link active" : "sidebar-link"
            }
          >
            <Icon>
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </Icon>
            <span>Teams</span>
          </NavLink>

          <NavLink
            to="/datasets"
            className={({ isActive }) =>
              isActive ? "sidebar-link active" : "sidebar-link"
            }
          >
            <Icon>
              <ellipse cx="12" cy="5" rx="8" ry="3" />
              <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
              <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
            </Icon>
            <span>Datasets</span>
          </NavLink>
        </nav>
      </div>

      <div className="sidebar-bottom">
        <NavLink
          to="/resources"
          className={({ isActive }) =>
            isActive ? "sidebar-link active" : "sidebar-link"
          }
        >
          <Icon>
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" />
            <path d="M8 6h8" />
            <path d="M8 10h6" />
          </Icon>
          <span>Resources</span>
        </NavLink>

        <NavLink
          to="/profile/settings"
          className={({ isActive }) =>
            isActive ? "sidebar-link active" : "sidebar-link"
          }
        >
          <Icon>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.05.05a2 2 0 1 1-2.83 2.83l-.05-.05a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V22a2 2 0 0 1-4 0v-.08a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.87.34l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 0 1 0-4h.04A1.7 1.7 0 0 0 4.6 8.4a1.7 1.7 0 0 0-.34-1.87l-.05-.05a2 2 0 1 1 2.83-2.83l.05.05A1.7 1.7 0 0 0 8.96 4.04 1.7 1.7 0 0 0 10 2.48V2a2 2 0 0 1 4 0v.48a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05A1.7 1.7 0 0 0 19.4 8.4a1.7 1.7 0 0 0 1.56 1.56H21a2 2 0 0 1 0 4h-.04A1.7 1.7 0 0 0 19.4 15z" />
          </Icon>
          <span>Settings</span>
        </NavLink>
      </div>
    </aside>
  );
}

export default Sidebar;