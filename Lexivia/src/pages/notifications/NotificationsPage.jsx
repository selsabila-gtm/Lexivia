import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../../components/Sidebar";
import Topbar from "../../components/Topbar";
import "./NotificationsPage.css";

const API = "http://127.0.0.1:8000";
function authHeaders() {
  const token = localStorage.getItem("token");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

// ── Shared type config (mirrors popup) ────────────────────────────────────────

const TYPE_CONFIG = {
  team_invitation: { icon: "👥", color: "#2d5cf6", bg: "#eef2ff", label: "Team Invite" },
  team_join_request: { icon: "🙋", color: "#0c8599", bg: "#e3fafc", label: "Join Request" },
  team_invitation_accepted: { icon: "✅", color: "#1a7a44", bg: "#e6f9ef", label: "Invite Accepted" },
  team_invitation_declined: { icon: "❌", color: "#c33", bg: "#fff0f0", label: "Invite Declined" },
  team_join_accepted: { icon: "🎉", color: "#1a7a44", bg: "#e6f9ef", label: "Request Accepted" },
  team_join_declined: { icon: "😔", color: "#c33", bg: "#fff0f0", label: "Request Declined" },
  team_member_removed: { icon: "🚪", color: "#b85200", bg: "#fff4e6", label: "Removed from Team" },
  competition_invitation: { icon: "🏆", color: "#6324c4", bg: "#f3edff", label: "Competition Invite" },
  competition_joined: { icon: "📥", color: "#2d5cf6", bg: "#eef2ff", label: "New Participant" },
  competition_submission: { icon: "📤", color: "#0c8599", bg: "#e3fafc", label: "Submission" },
  data_sample_flagged: { icon: "🚩", color: "#b85200", bg: "#fff4e6", label: "Sample Flagged" },
  data_sample_validated: { icon: "✔️", color: "#1a7a44", bg: "#e6f9ef", label: "Sample Validated" },
  general: { icon: "📣", color: "#555", bg: "#f7f8fb", label: "Info" },
  competition_join_request: { icon: "📥", color: "#2d5cf6", bg: "#eef2ff", label: "Competition Join Request" },
};

const ALL_TYPES = [
  "all",
  "team_invitation",
  "team_join_request",
  "team_invitation_accepted",
  "team_invitation_declined",
  "team_join_accepted",
  "team_join_declined",
  "team_member_removed",
  "competition_invitation",
  "competition_joined",
  "competition_submission",
  "data_sample_flagged",
  "data_sample_validated",
  "general",
  "competition_join_request",
];

function typeConfig(type) {
  return TYPE_CONFIG[type] || TYPE_CONFIG.general;
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Full notification card ────────────────────────────────────────────────────

function NotifCard({ notif, onRead, onDelete, onAction, selected, onSelect }) {
  const cfg = typeConfig(notif.type);
  const [actioning, setActioning] = useState(null); // "accept" | "decline" | null
  const navigate = useNavigate();

  const hasInviteAction = notif.type === "team_invitation" && !notif.action_taken;
  const hasJoinAction = notif.type === "team_join_request" && !notif.action_taken;

  async function doAction(endpoint, label) {
    setActioning(label);
    try {
      const res = await fetch(`${API}/notifications/${notif.id}/${endpoint}`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        onAction(notif.id, data.notification);
      }
    } finally {
      setActioning(null);
    }
  }

  function handleNavigate() {
    if (!notif.is_read) onRead(notif.id, true);

    if (notif.type === "competition_join_request" && notif.competition_id) {
      navigate(`/competitions/${notif.competition_id}/organizer#join-requests`);
      return;
    }

    if (notif.team_id) {
      navigate(`/teams/${notif.team_id}`);
      return;
    }

    if (notif.competition_id) {
      navigate(`/competitions/${notif.competition_id}`);
    }
  }

  return (
    <div className={`notif-card${notif.is_read ? " notif-read" : " notif-unread"}${selected ? " notif-selected" : ""}`}>
      {/* Select checkbox */}
      <label className="notif-checkbox" onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(notif.id)}
        />
      </label>

      {/* Unread indicator */}
      <div className="notif-unread-dot" style={{ opacity: notif.is_read ? 0 : 1 }} />

      {/* Icon */}
      <div className="notif-icon" style={{ background: cfg.bg }}>
        <span role="img">{cfg.icon}</span>
      </div>

      {/* Main content */}
      <div className="notif-body" onClick={handleNavigate}>
        <div className="notif-meta-row">
          <span className="notif-type-badge" style={{ color: cfg.color, background: cfg.bg }}>
            {cfg.label}
          </span>
          {notif.actor_name && (
            <span className="notif-actor">by {notif.actor_name}</span>
          )}
          <span className="notif-time">{timeAgo(notif.created_at)}</span>
        </div>

        <h4 className="notif-title">{notif.title}</h4>
        <p className="notif-message">{notif.message}</p>

        {/* Context chips */}
        <div className="notif-context-chips">
          {notif.team_name && (
            <span className="context-chip chip-team">👥 {notif.team_name}</span>
          )}
          {notif.competition_name && (
            <span className="context-chip chip-comp">🏆 {notif.competition_name}</span>
          )}
        </div>

        {/* Action buttons */}
        {(hasInviteAction || hasJoinAction) && (
          <div className="notif-actions">
            <button
              className="action-btn action-accept"
              onClick={e => {
                e.stopPropagation();
                doAction(
                  hasInviteAction ? "accept-invitation" : "accept-join-request",
                  "accept"
                );
              }}
              disabled={!!actioning}
            >
              {actioning === "accept" ? "Accepting…" : "✓ Accept"}
            </button>
            <button
              className="action-btn action-decline"
              onClick={e => {
                e.stopPropagation();
                doAction(
                  hasInviteAction ? "decline-invitation" : "decline-join-request",
                  "decline"
                );
              }}
              disabled={!!actioning}
            >
              {actioning === "decline" ? "Declining…" : "✕ Decline"}
            </button>
          </div>
        )}

        {/* Completed action */}
        {notif.action_taken && (
          <span
            className="action-taken-badge"
            style={{
              color: notif.action_taken === "accepted" ? "#1a7a44" : "#c33",
              background: notif.action_taken === "accepted" ? "#e6f9ef" : "#fff0f0",
              borderColor: notif.action_taken === "accepted" ? "#b2e4c8" : "#fcc",
            }}
          >
            {notif.action_taken === "accepted" ? "✓ Accepted" : "✕ Declined"}
          </span>
        )}
      </div>

      {/* Row controls */}
      <div className="notif-controls">
        <button
          className="ctrl-btn"
          title={notif.is_read ? "Mark as unread" : "Mark as read"}
          onClick={e => { e.stopPropagation(); onRead(notif.id, !notif.is_read); }}
        >
          {notif.is_read ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="#ccc" strokeWidth="1.5" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" fill="#2d5cf6" />
              <path d="M4 7l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <button
          className="ctrl-btn ctrl-delete"
          title="Delete notification"
          onClick={e => { e.stopPropagation(); onDelete(notif.id); }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 3.5h10M5.5 3.5V2.5h3v1M4 3.5l.6 7.5h5l.6-7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState({ filtered }) {
  return (
    <div className="notif-empty">
      <div className="notif-empty-icon">
        {filtered ? "🔍" : "🔔"}
      </div>
      <h3>{filtered ? "No matching notifications" : "You're all caught up!"}</h3>
      <p>
        {filtered
          ? "Try a different filter or check back later."
          : "Notifications for team invites, competition updates, and more will appear here."}
      </p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 15;

export default function NotificationsPage() {
  const navigate = useNavigate();

  const [notifs, setNotifs] = useState([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [filter, setFilter] = useState("all");       // type filter
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selected, setSelected] = useState(new Set());   // selected IDs

  // ── Fetch ────────────────────────────────────────────────────────────────

  const fetchNotifs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(PAGE_SIZE),
        unread_only: String(unreadOnly),
      });
      if (filter !== "all") params.append("type_filter", filter);

      const res = await fetch(`${API}/notifications?${params}`, {
        headers: authHeaders(),
      });
      if (res.status === 401) { navigate("/login"); return; }
      if (!res.ok) return;
      const data = await res.json();
      setNotifs(data.items || []);
      setTotal(data.total || 0);
      setUnreadCount(data.unread_count || 0);
    } finally {
      setLoading(false);
    }
  }, [page, filter, unreadOnly, navigate]);

  //useEffect(() => { fetchNotifs(); }, [fetchNotifs]);

  // Reset page when filter changes
  useEffect(() => { setPage(1); setSelected(new Set()); }, [filter, unreadOnly]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleRead(id, isRead) {
    await fetch(`${API}/notifications/${id}/read`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ is_read: isRead }),
    });
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, is_read: isRead } : n));
    setUnreadCount(prev => isRead ? Math.max(0, prev - 1) : prev + 1);
  }

  async function handleDelete(id) {
    await fetch(`${API}/notifications/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    const removed = notifs.find(n => n.id === id);
    setNotifs(prev => prev.filter(n => n.id !== id));
    setTotal(prev => prev - 1);
    if (removed && !removed.is_read) setUnreadCount(prev => Math.max(0, prev - 1));
    setSelected(prev => { const s = new Set(prev); s.delete(id); return s; });
  }

  async function handleMarkAllRead() {
    await fetch(`${API}/notifications/mark-all-read`, {
      method: "PATCH",
      headers: authHeaders(),
    });
    setNotifs(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  }

  async function handleBulkDelete() {
    const ids = [...selected];
    await fetch(`${API}/notifications`, {
      method: "DELETE",
      headers: authHeaders(),
      body: JSON.stringify({ ids }),
    });
    const removedUnread = notifs.filter(n => ids.includes(n.id) && !n.is_read).length;
    setNotifs(prev => prev.filter(n => !ids.includes(n.id)));
    setTotal(prev => prev - ids.length);
    setUnreadCount(prev => Math.max(0, prev - removedUnread));
    setSelected(new Set());
  }

  async function handleClearAll() {
    if (!window.confirm("Delete all notifications? This cannot be undone.")) return;
    await fetch(`${API}/notifications`, {
      method: "DELETE",
      headers: authHeaders(),
      body: JSON.stringify({ all: true }),
    });
    setNotifs([]);
    setTotal(0);
    setUnreadCount(0);
    setSelected(new Set());
  }

  function handleAction(id, updated) {
    if (updated) {
      setNotifs(prev => prev.map(n => n.id === id ? updated : n));
    }
  }

  function handleSelect(id) {
    setSelected(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  function handleSelectAll() {
    if (selected.size === notifs.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(notifs.map(n => n.id)));
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isFiltered = filter !== "all" || unreadOnly;

  return (
    <div className="notif-layout">
      <Sidebar />
      <div className="notif-main">
        <Topbar
          title="Notifications"
          subtitle="Stay up to date with your teams, competitions, and data activity."
        />

        <div className="notif-page-body">

          {/* ── Top bar ─────────────────────────────────────────────────── */}
          <div className="notif-page-header">
            <div className="notif-page-title-row">
              <div>
                <h1 className="notif-page-title">Notifications</h1>
                <p className="notif-page-sub">
                  {unreadCount > 0
                    ? <><strong>{unreadCount}</strong> unread · {total} total</>
                    : <>{total} notification{total !== 1 ? "s" : ""}</>}
                </p>
              </div>

              <div className="notif-header-actions">
                {unreadCount > 0 && (
                  <button className="hdr-btn hdr-btn-secondary" onClick={handleMarkAllRead}>
                    ✓ Mark all read
                  </button>
                )}
                {total > 0 && (
                  <button className="hdr-btn hdr-btn-danger" onClick={handleClearAll}>
                    🗑 Clear all
                  </button>
                )}
              </div>
            </div>

            {/* ── Filters ── */}
            <div className="notif-filters">
              <div className="notif-filter-tabs">
                <button
                  className={`filter-tab${filter === "all" ? " active" : ""}`}
                  onClick={() => setFilter("all")}
                >
                  All
                </button>
                {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
                  <button
                    key={key}
                    className={`filter-tab${filter === key ? " active" : ""}`}
                    onClick={() => setFilter(key)}
                  >
                    {cfg.icon} {cfg.label}
                  </button>
                ))}
              </div>

              <label className="unread-toggle">
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={e => setUnreadOnly(e.target.checked)}
                />
                Unread only
              </label>
            </div>
          </div>

          {/* ── Bulk action bar ─────────────────────────────────────────── */}
          {selected.size > 0 && (
            <div className="bulk-bar">
              <span className="bulk-count">{selected.size} selected</span>
              <button className="bulk-btn" onClick={() => {
                [...selected].forEach(id => handleRead(id, true));
                setSelected(new Set());
              }}>
                Mark read
              </button>
              <button className="bulk-btn bulk-btn-danger" onClick={handleBulkDelete}>
                Delete selected
              </button>
              <button className="bulk-btn" onClick={() => setSelected(new Set())}>
                Cancel
              </button>
            </div>
          )}

          {/* ── Notification list ────────────────────────────────────────── */}
          <div className="notif-list-wrap">
            {/* Select-all row */}
            {notifs.length > 0 && (
              <div className="notif-select-all-row">
                <label>
                  <input
                    type="checkbox"
                    checked={selected.size === notifs.length && notifs.length > 0}
                    onChange={handleSelectAll}
                  />
                  <span>Select all on this page</span>
                </label>
              </div>
            )}

            {loading ? (
              <div className="notif-skeleton-list">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="notif-skeleton" style={{ animationDelay: `${i * 0.08}s` }} />
                ))}
              </div>
            ) : notifs.length === 0 ? (
              <EmptyState filtered={isFiltered} />
            ) : (
              <div className="notif-cards">
                {notifs.map(n => (
                  <NotifCard
                    key={n.id}
                    notif={n}
                    onRead={handleRead}
                    onDelete={handleDelete}
                    onAction={handleAction}
                    selected={selected.has(n.id)}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Pagination ─────────────────────────────────────────────── */}
          {!loading && total > PAGE_SIZE && (
            <div className="notif-pagination">
              <span className="pagination-info">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
              </span>
              <div className="pagination-controls">
                <button
                  className="pag-btn"
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  ‹ Prev
                </button>
                <span className="pag-current">Page {page} of {totalPages}</span>
                <button
                  className="pag-btn"
                  disabled={page === totalPages}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next ›
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
