import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useParams,
} from "react-router-dom";

import Dashboard from "./pages/Dashboard";
import Competitions from "./pages/Competitions";
import CreateCompetition from "./pages/CreateCompetition";
import CompetitionDetails from "./pages/CompetitionDetails";
import TeamsPage from "./pages/teams/TeamsPage";
import TeamDetailPage from "./pages/teams/TeamDetailPage";
import DataCollection from "./pages/DataCollection";
import DatasetHub from "./pages/Datasethub";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import CompetitionSidebar from "./components/CompetitionSidebar";
import SearchResults from "./pages/SearchResults";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import NotificationsPage from "./pages/notifications/NotificationsPage";

import ProfilePage from "./pages/profile/ProfilePage";
import UpdateProfilePage from "./pages/profile/updateprofile";
import SettingsPage from "./pages/profile/settings";
import OrganizerDashboard from "./pages/OrganizerDashboard";
import AuthCallback from "./pages/AuthCallback";
import Experiments from "./pages/Experiments";
import ExperimentRegistry from "./pages/ExperimentRegistry";
import Leaderboard from "./pages/leaderboard";
import SetPassword from "./pages/SetPassword";
import CompetitionTopbar from "./components/CompetitionTopbar";
// In App.jsx, change:
import DatasetHubGlobal from "./pages/DatasetHubGlobal";

// And the route:


import "./index.css";

function SimplePage({ title, subtitle }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f7f8fc" }}>
      <Sidebar />
      <div style={{ flex: 1 }}>
        <Topbar title={title} subtitle={subtitle} />
        <div style={{ padding: "24px 22px" }}>
          <div
            style={{
              background: "#eef3ff",
              borderRadius: "18px",
              padding: "24px",
              color: "#19233c",
              fontWeight: 700,
            }}
          >
            {title} page is working.
          </div>
        </div>
      </div>
    </div>
  );
}

function CompetitionSimplePage({ title, description }) {
  const { competitionId } = useParams();

  return (
    <div className="competition-layout">
      <CompetitionSidebar competitionId={competitionId} />

      <div className="competition-page">
        <CompetitionTopbar
          competitionId={competitionId}
          competitionTitle="Competition"
          status="LAB ACTIVE"
        />

        <main style={{ padding: "38px 44px" }}>
          <div
            style={{
              maxWidth: "900px",
              background: "#fff",
              border: "1px solid #e5e7ef",
              borderRadius: "18px",
              padding: "28px",
              boxShadow: "0 4px 30px rgba(15, 23, 42, 0.04)",
            }}
          >
            <p
              style={{
                fontSize: "11px",
                letterSpacing: "1.4px",
                textTransform: "uppercase",
                color: "#718096",
                fontWeight: 700,
                margin: "0 0 8px",
              }}
            >
              Competition Workspace
            </p>

            <h1
              style={{
                fontSize: "28px",
                color: "#101827",
                margin: "0 0 10px",
              }}
            >
              {title}
            </h1>

            <p
              style={{
                fontSize: "14px",
                color: "#667085",
                margin: 0,
                lineHeight: 1.6,
              }}
            >
              {description}
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
function isLoggedIn() {
  const token = localStorage.getItem("token");
  const user = localStorage.getItem("user");

  return !!token && !!user;
}

function ProtectedRoute() {
  return isLoggedIn() ? <Outlet /> : <Navigate to="/login" replace />;
}

function PublicOnlyRoute() {
  return isLoggedIn() ? <Navigate to="/dashboard" replace /> : <Outlet />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public landing */}
        <Route path="/" element={<Landing />} />

        {/* Auth pages */}
        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
        </Route>

        {/* Public auth callback */}
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/set-password" element={<SetPassword />} />

        {/* Protected pages */}
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<Dashboard />} />

          {/* Global pages */}
          <Route path="/competitions" element={<Competitions />} />
          <Route path="/create-competition" element={<CreateCompetition />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/:teamId" element={<TeamDetailPage />} />

          
          <Route path="/datasets" element={<DatasetHubGlobal />} />

          <Route
            path="/resources"
            element={
              <SimplePage
                title="Resources"
                subtitle="Learning resources and help"
              />
            }
          />

          <Route path="/notifications" element={<NotificationsPage />} />

          {/* Competition pages */}
          <Route
            path="/competitions/:competitionId"
            element={<CompetitionDetails />}
          />

          <Route
            path="/competitions/:competitionId/data-collection"
            element={<DataCollection />}
          />

          <Route
            path="/competitions/:competitionId/dataset-hub"
            element={<DatasetHub />}
          />

          <Route
            path="/competitions/:competitionId/experiments"
            element={<Experiments />}
          />

          <Route
            path="/competitions/:competitionId/experiment-registry"
            element={<ExperimentRegistry />}
          />

          <Route
            path="/competitions/:competitionId/leaderboard"
            element={<Leaderboard />}
          />

          <Route
            path="/competitions/:competitionId/organizer"
            element={<OrganizerDashboard />}
          />

          <Route
            path="/competitions/:competitionId/documentation"
            element={
              <CompetitionSimplePage
                title="Documentation"
                description="Competition documentation, rules, dataset notes, and instructions will appear here."
              />
            }
          />

          <Route
            path="/competitions/:competitionId/settings"
            element={
              <CompetitionSimplePage
                title="Settings"
                description="Competition-specific settings will appear here."
              />
            }
          />

          <Route
            path="/competitions/:competitionId/support"
            element={
              <CompetitionSimplePage
                title="Support"
                description="Competition support resources, issue reporting, and help content will appear here."
              />
            }
          />

          <Route
            path="/edit-competition/:competitionId"
            element={<CreateCompetition editMode={true} />}
          />

          {/* Profile */}
          <Route path="/profile/settings" element={<SettingsPage />} />
          <Route path="/profile/update" element={<UpdateProfilePage />} />
          <Route path="/profile/:userId" element={<ProfilePage />} />
          <Route path="/profile" element={<ProfilePage />} />

          <Route path="/search" element={<SearchResults />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;