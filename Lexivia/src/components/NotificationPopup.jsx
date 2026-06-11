import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { BellDot } from "lucide-react";
const API = "http://127.0.0.1:8000";

function authHeaders() {
  const token = localStorage.getItem("token");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

// ── Notification type config ──────────────────────────────────────────────────

const TYPE_CONFIG = {
  team_invitation: { icon: "👥", color: "#2d5cf6", bg: "#eef2ff", label: "Team Invite" },
  team_join_request: { icon: "🙋", color: "#0c8599", bg: "#e3fafc", label: "Join Request" },
  team_invitation_accepted: { icon: "✅", color: "#1a7a44", bg: "#e6f9ef", label: "Invite Accepted" },
  team_invitation_declined: { icon: "❌", color: "#c33", bg: "#fff0f0", label: "Invite Declined" },
  team_join_accepted: { icon: "🎉", color: "#1a7a44", bg: "#e6f9ef", label: "Request Accepted" },
  team_join_declined: { icon: "😔", color: "#c33", bg: "#fff0f0", label: "Request Declined" },
  team_member_removed: { icon: "🚪", color: "#b85200", bg: "#fff4e6", label: "Removed" },
  competition_invitation: { icon: "🏆", color: "#6324c4", bg: "#f3edff", label: "Competition" },
  competition_joined: { icon: "📥", color: "#2d5cf6", bg: "#eef2ff", label: "New Participant" },
  competition_join_request: {
    icon: "📥",
    color: "#2d5cf6",
    bg: "#eef2ff",
    label: "Competition Join Request",
  },
  competition_submission: { icon: "📤", color: "#0c8599", bg: "#e3fafc", label: "Submission" },
  data_sample_flagged: { icon: "🚩", color: "#b85200", bg: "#fff4e6", label: "Flagged" },
  data_sample_validated: { icon: "✔️", color: "#1a7a44", bg: "#e6f9ef", label: "Validated" },
  general: { icon: "📣", color: "#555", bg: "#f7f8fb", label: "Info" },
};

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
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}


// ── Single notification row ───────────────────────────────────────────────────

function NotifRow({ notif, onRead, onDelete, onAction, onNavigate }) {
  const cfg = typeConfig(notif.type);
  const [actioning, setActioning] = useState(false);

  const hasInviteAction =
    notif.type === "team_invitation" && !notif.action_taken;

  const hasJoinAction =
    notif.type === "team_join_request" && !notif.action_taken;

  async function doAction(endpoint) {
    setActioning(true);
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
      setActioning(false);
    }
  }
  function handleNavigate() {
    onNavigate(notif);
  }

  return (
    <div
      onClick={handleNavigate}

      style={{
        display: "flex",
        gap: 12,
        padding: "13px 16px",
        background: notif.is_read ? "transparent" : "#f7f9ff",
        borderBottom: "1px solid #f0f1f4",
        transition: "background 0.15s",
        cursor: "default",
        position: "relative",
      }}
      onMouseEnter={e => e.currentTarget.style.background = "#f5f7fe"}
      onMouseLeave={e => e.currentTarget.style.background = notif.is_read ? "transparent" : "#f7f9ff"}
    >
      {/* Unread dot */}
      {!notif.is_read && (
        <div
          style={{
            position: "absolute", top: 16, left: 5,
            width: 6, height: 6, borderRadius: "50%", background: "#2d5cf6",
          }} />
      )}

      {/* Icon */}
      <div
        style={{
          width: 36, height: 36, borderRadius: 10,
          background: cfg.bg, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 17,
        }}>
        {cfg.icon}
      </div>

      {/* Content */}
      <div
        style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
            color: cfg.color, background: cfg.bg,
            padding: "1px 6px", borderRadius: 4,
          }}>
            {cfg.label}
          </span>
          <span style={{ fontSize: 11, color: "#bbb", marginLeft: "auto" }}>
            {timeAgo(notif.created_at)}
          </span>
        </div>

        <p style={{
          margin: "0 0 6px", fontSize: 12.5, color: "#333",
          lineHeight: 1.45, fontWeight: notif.is_read ? 400 : 600,
        }}>
          {notif.title}
        </p>
        <p style={{
          margin: 0, fontSize: 11.5, color: "#777",
          lineHeight: 1.4, overflow: "hidden",
          display: "-webkit-box", WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
        }}>
          {notif.message}
        </p>

        {/* Action buttons */}
        {(hasInviteAction || hasJoinAction) && (
          <div
            style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button
              onClick={e => { e.stopPropagation(); doAction(hasInviteAction ? "accept-invitation" : "accept-join-request"); }}
              disabled={actioning}
              style={{
                padding: "4px 12px", fontSize: 11.5, fontWeight: 600,
                background: "#2d5cf6", color: "#fff",
                border: "none", borderRadius: 6, cursor: "pointer",
                opacity: actioning ? 0.6 : 1,
              }}
            >
              Accept
            </button>
            <button
              onClick={e => { e.stopPropagation(); doAction(hasInviteAction ? "decline-invitation" : "decline-join-request"); }}
              disabled={actioning}
              style={{
                padding: "4px 12px", fontSize: 11.5, fontWeight: 600,
                background: "#f0f1f4", color: "#555",
                border: "none", borderRadius: 6, cursor: "pointer",
                opacity: actioning ? 0.6 : 1,
              }}
            >
              Decline
            </button>
          </div>
        )}

        {/* Completed action badge */}
        {notif.action_taken && (
          <span style={{
            display: "inline-block", marginTop: 6,
            fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em",
            color: notif.action_taken === "accepted" ? "#1a7a44" : "#c33",
            background: notif.action_taken === "accepted" ? "#e6f9ef" : "#fff0f0",
            padding: "2px 8px", borderRadius: 4,
          }}>
            {notif.action_taken.toUpperCase()}
          </span>
        )}
      </div>

      {/* Row controls */}
      <div
        style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
        <button
          title={notif.is_read ? "Mark unread" : "Mark read"}
          onClick={e => { e.stopPropagation(); onRead(notif.id, !notif.is_read); }}
          style={{
            width: 22, height: 22, border: "none", background: "transparent",
            cursor: "pointer", borderRadius: 4, display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: 12,
            color: notif.is_read ? "#ccc" : "#2d5cf6",
          }}
        >
          {notif.is_read ? "○" : "●"}
        </button>
        <button
          title="Delete"
          onClick={e => { e.stopPropagation(); onDelete(notif.id); }}
          style={{
            width: 22, height: 22, border: "none", background: "transparent",
            cursor: "pointer", borderRadius: 4, display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: 14,
            color: "#ddd",
          }}
          onMouseEnter={e => e.currentTarget.style.color = "#c33"}
          onMouseLeave={e => e.currentTarget.style.color = "#ddd"}
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ── Main popup component ──────────────────────────────────────────────────────

export default function NotificationPopup() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pollingId, setPollingId] = useState(null);
  const popupRef = useRef(null);

  // ── Fetch latest (popup preview: 8 items) ──────────────────────────────────

  const fetchNotifs = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const res = await fetch(`${API}/notifications?page=1&page_size=8`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json();
      setNotifs(data.items || []);
      setUnread(data.unread_count || 0);
    } catch (_) { }
  }, []);

  // ── Poll every 30 s for unread badge ─────────────────────────────────────

  useEffect(() => {
    fetchNotifs();
    const id = setInterval(fetchNotifs, 30000);
    return () => clearInterval(id);
  }, [fetchNotifs]);

  // ── Close on outside click ────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    function handle(e) {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  // ── Load when opened ──────────────────────────────────────────────────────

  function handleToggle() {
    if (!open) {
      setLoading(true);
      fetchNotifs().finally(() => setLoading(false));
    }
    setOpen(v => !v);
  }

  // ── Mark read / unread ────────────────────────────────────────────────────

  async function handleRead(id, isRead) {
    await fetch(`${API}/notifications/${id}/read`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ is_read: isRead }),
    });
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, is_read: isRead } : n));
    setUnread(prev => isRead ? Math.max(0, prev - 1) : prev + 1);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete(id) {
    await fetch(`${API}/notifications/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    const removed = notifs.find(n => n.id === id);
    setNotifs(prev => prev.filter(n => n.id !== id));
    if (removed && !removed.is_read) setUnread(prev => Math.max(0, prev - 1));
  }

  // ── Mark all read ────────────────────────────────────────────────────────

  async function handleMarkAllRead() {
    await fetch(`${API}/notifications/mark-all-read`, {
      method: "PATCH",
      headers: authHeaders(),
    });
    setNotifs(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnread(0);
  }

  // ── After action (accept/decline) ────────────────────────────────────────

  function handleAction(id, updated) {
    if (updated) {
      setNotifs(prev => prev.map(n => n.id === id ? updated : n));
    }
  }
  function handleNavigate(notif) {
    if (!notif.is_read) {
      handleRead(notif.id, true);
    }

    setOpen(false);

    if (
      notif.type === "competition_join_request" &&
      notif.competition_id
    ) {
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
    <div
      ref={popupRef} style={{ position: "relative" }}>
      {/* Bell button */}
      <button
        onClick={handleToggle}
        style={{
          width: 34, height: 34, border: "none",
          background: open ? "#eef2ff" : "transparent",
          borderRadius: 8, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, color: "#6f778d", position: "relative",
          transition: "background 0.15s",
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = "#f0f1f4"; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = "transparent"; }}
      >
        <BellDot size={18} strokeWidth={2} />
        {unread > 0 && (
          <span style={{
            position: "absolute", top: 4, right: 4,
            minWidth: 16, height: 16, borderRadius: 8,
            background: "#e53e3e", color: "#fff",
            fontSize: 9, fontWeight: 800,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "0 3px", border: "2px solid #fff",
            lineHeight: 1,
          }}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 10px)", right: 0,
            width: 380, maxHeight: 520,
            background: "#fff",
            border: "1px solid #e8e9ec",
            borderRadius: 14,
            boxShadow: "0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)",
            zIndex: 2000,
            display: "flex", flexDirection: "column",
            overflow: "hidden",
            animation: "popupIn 0.18s ease",
          }}>
          <style>{`
            @keyframes popupIn {
              from { opacity: 0; transform: translateY(-6px) scale(0.98); }
              to   { opacity: 1; transform: translateY(0)    scale(1); }
            }
          `}</style>

          {/* Header */}
          <div
            style={{
              padding: "14px 16px 12px",
              borderBottom: "1px solid #f0f1f4",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              flexShrink: 0,
            }}>
            <div
              style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#1a1c20" }}>
                Notifications
              </span>
              {unread > 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 700, background: "#2d5cf6",
                  color: "#fff", padding: "1px 7px", borderRadius: 10,
                }}>
                  {unread} new
                </span>
              )}
            </div>
            {unread > 0 && (
              <button
                onClick={handleMarkAllRead}
                style={{
                  fontSize: 11.5, fontWeight: 600, color: "#2d5cf6",
                  background: "none", border: "none", cursor: "pointer",
                  padding: "3px 6px", borderRadius: 5,
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div
            style={{ overflowY: "auto", flex: 1 }}>
            {loading ? (
              <div
                style={{ padding: "32px 16px", textAlign: "center", color: "#bbb", fontSize: 13 }}>
                Loading…
              </div>
            ) : notifs.length === 0 ? (
              <div
                style={{ padding: "40px 16px", textAlign: "center" }}>
                <div
                  style={{ fontSize: 32, marginBottom: 8 }}>🔔</div>
                <div
                  style={{ fontSize: 13, color: "#bbb", fontWeight: 500 }}>
                  You're all caught up!
                </div>
              </div>
            ) : (
              notifs.map(n => (
                <NotifRow
                  key={n.id}
                  notif={n}
                  onRead={handleRead}
                  onDelete={handleDelete}
                  onAction={handleAction}
                  onNavigate={handleNavigate}
                />
              ))
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              borderTop: "1px solid #f0f1f4",
              padding: "11px 16px",
              flexShrink: 0,
            }}>
            <button
              onClick={() => { setOpen(false); navigate("/notifications"); }}
              style={{
                width: "100%", padding: "8px",
                background: "#f5f7fe",
                border: "1px solid #e0e6ff",
                borderRadius: 8,
                fontSize: 12.5, fontWeight: 600, color: "#2d5cf6",
                cursor: "pointer", transition: "background 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "#eef2ff"}
              onMouseLeave={e => e.currentTarget.style.background = "#f5f7fe"}
            >
              See all notifications →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
