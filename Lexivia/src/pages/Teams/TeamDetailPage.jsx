import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import './TeamDetailPage.css';

const API = 'http://127.0.0.1:8000';
const API_ORIGIN = API.replace(/\/$/, '');

function authHeaders() {
  const token = localStorage.getItem('token');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

function authUploadHeaders() {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
}

const ROLE_STYLES = {
  leader: { bg: '#fef0e6', fg: '#b85200' },
  admin:  { bg: '#e8edfb', fg: '#2547c0' },
  member: { bg: '#f2f3f5', fg: '#555' },
};

const AVATAR_COLORS = ['#3b5bdb', '#7048e8', '#0c8599', '#2f9e44', '#e8590c', '#c2255c'];

function RoleBadge({ role }) {
  const s = ROLE_STYLES[role] || ROLE_STYLES.member;
  return (
    <span className="role-badge" style={{ background: s.bg, color: s.fg }}>
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </span>
  );
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Unknown';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs  = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (mins < 60)  return `${mins}m ago`;
  if (hrs < 24)   return `${hrs}h ago`;
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

function initials(name) {
  if (!name) return '??';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function SkeletonBlock({ w = '100%', h = 14, mb = 10, radius = 6 }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: radius,
      background: '#eaeaea', marginBottom: mb,
      animation: 'pulse 1.4s ease-in-out infinite',
    }} />
  );
}

function resolveTeamLogo(team) {
  const logo = team?.logo_url || team?.logoUrl || team?.picture_url || team?.avatar_url;

  if (!logo) return null;
  if (logo.startsWith('http') || logo.startsWith('data:') || logo.startsWith('blob:')) {
    return logo;
  }

  return `${API_ORIGIN}${logo.startsWith('/') ? logo : `/${logo}`}`;
}

function avatarHue(team) {
  const raw = `${team?.id || ''}-${team?.name || 'team'}`;
  let hash = 0;

  for (let i = 0; i < raw.length; i++) {
    hash = raw.charCodeAt(i) + ((hash << 5) - hash);
  }

  return Math.abs(hash) % 360;
}

function DefaultTeamLogo({ team }) {
  return (
    <div className="team-detail-logo-gradient" style={{ '--avatar-hue': avatarHue(team) }}>
      <span>{initials(team?.name)}</span>
    </div>
  );
}

function TeamLogoUploader({ team, canEdit, uploading, removing, error, onUpload, onRemove }) {
  const [imageFailed, setImageFailed] = useState(false);
  const logoSrc = resolveTeamLogo(team);
  const hasCustomLogo = Boolean(team?.logo_url || team?.logoUrl || team?.picture_url || team?.avatar_url);
  const showImage = logoSrc && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [logoSrc]);

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onUpload(file);
  }

  return (
    <div className="team-logo-editor">
      <div className="team-detail-logo">
        {showImage ? (
          <img
            src={logoSrc}
            alt={`${team?.name || 'Team'} logo`}
            className="team-detail-logo-img"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="team-detail-logo-default">
            <DefaultTeamLogo team={team} />
          </div>
        )}
      </div>

      {canEdit && (
        <div className="logo-action-stack">
          <label className={`logo-upload-btn${uploading || removing ? ' disabled' : ''}`}>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFileChange}
              disabled={uploading || removing}
            />
            {uploading ? 'Uploading…' : hasCustomLogo ? 'Change picture' : 'Add picture'}
          </label>

          {hasCustomLogo && (
            <button
              type="button"
              className="logo-remove-btn"
              onClick={onRemove}
              disabled={uploading || removing}
            >
              {removing ? 'Removing…' : 'Remove picture'}
            </button>
          )}
        </div>
      )}

      {error && <div className="logo-upload-error">{error}</div>}
    </div>
  );
}


// ── Remove member button ───────────────────────────────────────────────────────

function RemoveMemberBtn({ teamId, userId, username, onRemoved }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading]       = useState(false);

  async function handleRemove() {
    setLoading(true);
    const res = await fetch(`${API}/teams/${teamId}/members/${userId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    setLoading(false);
    setConfirming(false);
    if (res.status === 401) { navigate('/login'); return; }
    if (res.ok) {
      onRemoved();
    } else {
      const data = await res.json().catch(() => ({}));
      alert('Failed to remove member: ' + (data.detail || 'Unknown error'));
    }
  }

  if (confirming) {
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          onClick={handleRemove}
          disabled={loading}
          style={{ padding: '4px 10px', fontSize: 11.5, fontWeight: 600, background: '#c33', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
        >
          {loading ? '…' : 'Confirm'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          style={{ padding: '4px 10px', fontSize: 11.5, fontWeight: 600, background: '#f0f1f4', color: '#555', border: 'none', borderRadius: 6, cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      className="action-dots"
      title={`Remove ${username}`}
      onClick={() => setConfirming(true)}
      style={{ fontSize: 13, color: '#e55' }}
    >
      Remove
    </button>
  );
}

// ── Join Request panel (non-members only) ──────────────────────────────────────

function JoinRequestPanel({ teamId }) {
  const navigate = useNavigate();
  const [message, setMessage]   = useState('');
  const [sending, setSending]   = useState(false);
  const [result, setResult]     = useState(null); // { type, text }
  const [requested, setRequested] = useState(false);

  async function handleRequest() {
    setSending(true);
    setResult(null);
    try {
      const res = await fetch(`${API}/teams/${teamId}/request-join`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ message: message.trim() }),
      });
      if (res.status === 401) { navigate('/login'); return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ type: 'error', text: data.detail || 'Failed to send request.' });
      } else {
        setResult({ type: 'success', text: data.message || 'Request sent!' });
        setRequested(true);
        setMessage('');
      }
    } catch (err) {
      setResult({ type: 'error', text: err.message || 'Failed to send request.' });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="invite-panel">
      <h3 className="panel-title">Request to Join</h3>
      <p className="panel-desc">
        Send a join request to the team leaders. They'll be notified and can accept or decline.
      </p>

      {!requested && (
        <>
          <div className="form-field">
            <label className="field-label">MESSAGE (OPTIONAL)</label>
            <textarea
              id="join-request-msg"
              className="field-input"
              placeholder="Introduce yourself or explain why you'd like to join…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              style={{ resize: 'vertical', minHeight: 72, fontSize: 13 }}
            />
          </div>
        </>
      )}

      {result && (
        <div style={{
          padding: '9px 12px', borderRadius: 7, fontSize: 12.5, marginBottom: 10,
          background: result.type === 'success' ? '#e6f9ef' : '#fff0f0',
          color: result.type === 'success' ? '#1a7a44' : '#c33',
          border: `1px solid ${result.type === 'success' ? '#b2e4c8' : '#fcc'}`,
        }}>
          {result.text}
        </div>
      )}

      {!requested && (
        <button
          className="send-invite-btn"
          onClick={handleRequest}
          disabled={sending}
        >
          {sending ? 'Sending…' : 'Send Join Request'}
        </button>
      )}
    </div>
  );
}

// ── Invite panel (leader / admin only) ────────────────────────────────────────

function InvitePanel({ teamId, onInvited }) {
  const navigate = useNavigate();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole]   = useState('member');
  const [inviting, setInviting]       = useState(false);
  const [inviteMsg, setInviteMsg]     = useState(null);

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteMsg(null);
    try {
      const res = await fetch(`${API}/teams/${teamId}/invite`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      if (res.status === 401) { navigate('/login'); return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteMsg({ type: 'error', text: data.detail || 'Failed to send invitation.' });
      } else {
        setInviteMsg({ type: 'success', text: data.message || 'Invitation sent!' });
        setInviteEmail('');
        setInviteRole('member');
        onInvited?.();
      }
    } catch (err) {
      setInviteMsg({ type: 'error', text: err.message || 'Failed to send invitation.' });
    } finally {
      setInviting(false);
    }
  }

  return (
    <div className="invite-panel">
      <h3 className="panel-title">Invite New Member</h3>
      <p className="panel-desc">Add a registered user to this team by their email address.</p>

      <div className="form-field">
        <label className="field-label">EMAIL ADDRESS</label>
        <input
          id="invite-email"
          type="email"
          className="field-input"
          placeholder="colleague@lab04.ai"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
        />
      </div>

      <div className="form-field">
        <label className="field-label">TEAM ROLE</label>
        <div className="select-wrap">
          <select className="field-select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="leader">Leader</option>
          </select>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="select-arrow">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="#888" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {inviteMsg && (
        <div style={{
          padding: '9px 12px', borderRadius: 7, fontSize: 12.5, marginBottom: 10,
          background: inviteMsg.type === 'success' ? '#e6f9ef' : '#fff0f0',
          color: inviteMsg.type === 'success' ? '#1a7a44' : '#c33',
          border: `1px solid ${inviteMsg.type === 'success' ? '#b2e4c8' : '#fcc'}`,
        }}>
          {inviteMsg.text}
        </div>
      )}

      <button
        className="send-invite-btn"
        onClick={handleInvite}
        disabled={inviting || !inviteEmail.trim()}
      >
        {inviting ? 'Sending…' : 'Send Invitation'}
      </button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TeamDetailPage() {
  const { teamId } = useParams();
  const navigate   = useNavigate();

  const currentUser = (() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; }
  })();
  const currentUserId = currentUser.id ?? null;

  const [team, setTeam]                       = useState(null);
  const [members, setMembers]                 = useState([]);
  const [currentUserRole, setCurrentUserRole] = useState(null); // null = not a member
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState(null);

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [saving, setSaving]     = useState(false);

  // Delete mode
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting]                   = useState(false);

  const [activeTab, setActiveTab] = useState('members');
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoRemoving, setLogoRemoving] = useState(false);
  const [logoError, setLogoError] = useState(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchTeamData = useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/teams/${teamId}`, { headers: authHeaders() });
      if (res.status === 401) { navigate('/login'); return; }
      if (res.status === 404) { setError('Team not found.'); return; }
      if (!res.ok) throw new Error('Failed to load team');

      const data = await res.json();
      setTeam(data);
      setEditName(data.name);
      setEditDesc(data.description || '');
      setMembers(data.members ?? []);
      setCurrentUserRole(data.current_user_role ?? null); // null if not a member
    } catch (err) {
      console.error(err);
      setError('Could not load team data.');
    } finally {
      setLoading(false);
    }
  }, [teamId, navigate]);

  useEffect(() => { fetchTeamData(); }, [fetchTeamData]);

  // ── Save edit ──────────────────────────────────────────────────────────────

  async function handleSaveEdit() {
    if (!editName.trim()) return;
    setSaving(true);
    const res = await fetch(`${API}/teams/${teamId}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ name: editName.trim(), description: editDesc.trim() }),
    });
    setSaving(false);
    if (res.status === 401) { navigate('/login'); return; }
    if (res.ok) {
      setTeam(prev => ({ ...prev, name: editName.trim(), description: editDesc.trim() }));
      setEditMode(false);
    } else {
      const data = await res.json().catch(() => ({}));
      alert('Failed to save: ' + (data.detail || 'Unknown error'));
    }
  }


  async function handleLogoUpload(file) {
    if (!file) return;

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setLogoError('Only JPG, PNG, and WEBP images are allowed.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setLogoError('Logo image must be smaller than 2MB.');
      return;
    }

    setLogoUploading(true);
    setLogoError(null);

    try {
      const formData = new FormData();
      formData.append('logo', file);

      const res = await fetch(`${API}/teams/${teamId}/logo`, {
        method: 'POST',
        headers: authUploadHeaders(),
        body: formData,
      });

      if (res.status === 401) { navigate('/login'); return; }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setLogoError(data.detail || 'Failed to upload logo.');
        return;
      }

      setTeam(prev => ({ ...prev, logo_url: data.logo_url }));
    } catch (err) {
      setLogoError(err.message || 'Failed to upload logo.');
    } finally {
      setLogoUploading(false);
    }
  }



  async function handleLogoRemove() {
    setLogoRemoving(true);
    setLogoError(null);

    try {
      const res = await fetch(`${API}/teams/${teamId}/logo`, {
        method: 'DELETE',
        headers: authHeaders(),
      });

      if (res.status === 401) { navigate('/login'); return; }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setLogoError(data.detail || 'Failed to remove logo.');
        return;
      }

      setTeam(prev => ({ ...prev, logo_url: null }));
    } catch (err) {
      setLogoError(err.message || 'Failed to remove logo.');
    } finally {
      setLogoRemoving(false);
    }
  }

  // ── Delete team ────────────────────────────────────────────────────────────

  async function handleDeleteTeam() {
    setDeleting(true);
    try {
      const res = await fetch(`${API}/teams/${teamId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.status === 401) { navigate('/login'); return; }
      if (res.ok) {
        navigate('/teams');
      } else {
        const data = await res.json().catch(() => ({}));
        alert('Failed to delete team: ' + (data.detail || 'Unknown error'));
        setShowDeleteConfirm(false);
      }
    } catch (err) {
      alert('Failed to delete team: ' + err.message);
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const isLeader    = currentUserRole === 'leader';
  const isAdmin     = currentUserRole === 'admin';
  const canInvite   = isLeader || isAdmin;   // leaders AND admins can invite
  const isMember    = currentUserRole !== null; // any role = is a member
  const isOutsider  = !isMember;              // not in the team at all

  // ── Loading skeleton ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="detail-root">
        <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
        <header className="detail-topbar">
          <div className="detail-topbar-left">
            <Link to="/teams" className="back-link">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back to Teams
            </Link>
          </div>
        </header>
        <div className="detail-body">
          <SkeletonBlock w="180px" h={12} mb={16} />
          <SkeletonBlock w="320px" h={36} mb={12} radius={8} />
          <SkeletonBlock w="480px" h={14} mb={32} />
          <div className="stats-row">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="stat-card">
                <SkeletonBlock w="80px" h={10} mb={10} />
                <SkeletonBlock w="60px" h={28} mb={6} />
                <SkeletonBlock w="100px" h={10} mb={0} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !team) {
    return (
      <div className="detail-root">
        <header className="detail-topbar">
          <div className="detail-topbar-left">
            <Link to="/teams" className="back-link">← Back to Teams</Link>
          </div>
        </header>
        <div className="detail-body" style={{ textAlign: 'center', paddingTop: 80 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <div style={{ fontSize: 16, color: '#c33', fontWeight: 600 }}>{error || 'Team not found.'}</div>
          <Link to="/teams" style={{ display: 'inline-block', marginTop: 20, color: '#2d5cf6', fontWeight: 600 }}>
            ← Return to Teams
          </Link>
        </div>
      </div>
    );
  }

  const createdMonth = new Date(team.created_at).toLocaleString('en-US', { month: 'short', year: 'numeric' });

  return (
    <div className="detail-root">
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>

      <header className="detail-topbar">
        <div className="detail-topbar-left">
          <Link to="/teams" className="back-link">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to Teams
          </Link>
        </div>
        <nav className="detail-topnav">
          <a href="#" className="topnav-link">DOCS</a>
          <a href="#" className="topnav-link">API</a>
          <a href="#" className="topnav-link">SUPPORT</a>
        </nav>
        <div className="detail-topbar-right">
          <div className="user-avatar-sm">
            {currentUser?.user_metadata?.full_name
              ? initials(currentUser.user_metadata.full_name)
              : 'ME'}
          </div>
        </div>
      </header>

      <div className="detail-body">
        {/* ── Team header ── */}
        <div className="team-header-section">
          <TeamLogoUploader
            team={team}
            canEdit={isLeader}
            uploading={logoUploading}
            removing={logoRemoving}
            error={logoError}
            onUpload={handleLogoUpload}
            onRemove={handleLogoRemove}
          />

          <div className="team-header-left">
            <div className="team-tags">
              <span className="tag-chip">ID-{String(team.id).padStart(4, '0')}</span>
              <span className="tag-sep">•</span>
              <span className="tag-date">Created {createdMonth}</span>
              {isLeader && (
                <>
                  <span className="tag-sep">•</span>
                  <span className="tag-chip" style={{ background: '#fff0e6', color: '#b85200' }}>LEADER</span>
                </>
              )}
              {isAdmin && (
                <>
                  <span className="tag-sep">•</span>
                  <span className="tag-chip" style={{ background: '#e8edfb', color: '#2547c0' }}>ADMIN</span>
                </>
              )}
            </div>

            {editMode ? (
              <>
                <input
                  className="field-input"
                  style={{ fontSize: 24, fontWeight: 800, marginBottom: 10, letterSpacing: '-0.03em' }}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Team name"
                />
                <textarea
                  className="field-input"
                  style={{ resize: 'vertical', minHeight: 72, fontSize: 14, lineHeight: 1.6 }}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="Team description"
                />
              </>
            ) : (
              <>
                <h1 className="detail-title">{team.name}</h1>
                <p className="detail-desc">{team.description || 'No description provided.'}</p>
              </>
            )}
          </div>

          <div className="team-header-actions">
            {isLeader && (
              editMode ? (
                <>
                  <button className="btn-outline" onClick={() => { setEditMode(false); setEditName(team.name); setEditDesc(team.description || ''); }}>
                    Cancel
                  </button>
                  <button className="btn-primary" onClick={handleSaveEdit} disabled={saving}>
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                </>
              ) : (
                <>
                  <button className="btn-outline" onClick={() => setEditMode(true)}>Edit Team</button>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    style={{
                      padding: '9px 20px',
                      border: '1.5px solid #fcc',
                      background: '#fff0f0',
                      borderRadius: 9,
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: '#c33',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      transition: 'background 0.15s, border-color 0.15s',
                    }}
                    onMouseOver={e => { e.currentTarget.style.background = '#ffe4e4'; e.currentTarget.style.borderColor = '#e55'; }}
                    onMouseOut={e => { e.currentTarget.style.background = '#fff0f0'; e.currentTarget.style.borderColor = '#fcc'; }}
                  >
                    Delete Team
                  </button>
                </>
              )
            )}

            {/* Not a member → Request to Join */}
            {!editMode && isOutsider && (
              <button className="btn-primary" onClick={() => document.getElementById('join-request-msg')?.focus()}>
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <path d="M6.5 1v11M1 6.5h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                Request to Join
              </button>
            )}

            {/* Leader or admin → Invite Member */}
            {!editMode && canInvite && (
              <button className="btn-primary" onClick={() => document.getElementById('invite-email')?.focus()}>
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <path d="M6.5 1v11M1 6.5h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                Invite Member
              </button>
            )}

            {/* Regular member (not leader/admin) → no CTA */}
          </div>
        </div>

        {/* ── Stats ── */}
        <div className="stats-row">
          <div className="stat-card">
            <span className="stat-label">TOTAL MEMBERS</span>
            <div className="stat-value-row">
              <span className="stat-value">{members.length}</span>
            </div>
            <span className="stat-sub">Active team size</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">LEADERS</span>
            <span className="stat-value">{members.filter(m => m.role === 'leader').length}</span>
            <span className="stat-sub">Team leads</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">ADMINS</span>
            <span className="stat-value">{members.filter(m => m.role === 'admin').length}</span>
            <span className="stat-sub">Moderators</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">YOUR ROLE</span>
            <span className="stat-value stat-role-value">
              {currentUserRole
                ? currentUserRole.charAt(0).toUpperCase() + currentUserRole.slice(1)
                : '—'}
            </span>
            <span className="stat-sub">
              {currentUserRole ? 'Member of this team' : 'Not a member'}
            </span>
          </div>
        </div>

        {/* ── Main grid ── */}
        <div className="detail-grid">
          <div className="detail-col-main">
            <div className="detail-tabs">
              {['members', 'activity', 'settings'].map(t => (
                <button
                  key={t}
                  className={`detail-tab${activeTab === t ? ' active' : ''}`}
                  onClick={() => setActiveTab(t)}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {activeTab === 'members' && (
              <div className="members-table-wrap">
                {members.length === 0 ? (
                  <div className="empty-tab">No members in this team yet.</div>
                ) : (
                  <>
                    <table className="members-table">
                      <thead>
                        <tr>
                          <th>MEMBER NAME</th>
                          <th>ROLE</th>
                          <th>JOINED</th>
                          {isLeader && <th>ACTION</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {members.map((m, idx) => (
                          <tr key={m.userId ?? idx}>
                            <td>
                              <div className="member-cell">
                                <div
                                  className="member-av"
                                  style={{ background: AVATAR_COLORS[idx % AVATAR_COLORS.length] }}
                                >
                                  {initials(m.username)}
                                </div>
                                <div>
                                  <div className="member-n">
                                    {m.username}
                                    {m.userId === currentUserId && (
                                      <span style={{ fontSize: 10, fontWeight: 700, background: '#eef2fe', color: '#2547c0', borderRadius: 4, padding: '1px 6px', marginLeft: 6 }}>
                                        YOU
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td><RoleBadge role={m.role} /></td>
                            <td>
                              <div className="activity-cell">
                                <div className="activity-time">{timeAgo(m.joinedAt)}</div>
                              </div>
                            </td>
                            {isLeader && (
                              <td>
                                {m.userId !== currentUserId && (
                                  <RemoveMemberBtn
                                    teamId={teamId}
                                    userId={m.userId}
                                    username={m.username}
                                    onRemoved={fetchTeamData}
                                  />
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ padding: '12px 18px', borderTop: '1px solid #eaeaea', fontSize: 12, color: '#aaa' }}>
                      {members.length} member{members.length !== 1 ? 's' : ''} total
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab !== 'members' && (
              <div className="empty-tab">
                <p>No {activeTab} content to display yet.</p>
              </div>
            )}
          </div>

          {/* ── Right side panel ── */}
          <div className="detail-col-side">
            {/*
              canInvite (leader or admin)  → show invite form
              isOutsider (not a member)    → show join request form
              regular member               → show nothing (or team composition only)
            */}
            {canInvite && (
              <InvitePanel teamId={teamId} onInvited={fetchTeamData} />
            )}

            {isOutsider && (
              <JoinRequestPanel teamId={teamId} />
            )}

            {/* Team composition */}
            <div className="activity-panel">
              <h4 className="activity-title">TEAM COMPOSITION</h4>
              <div className="activity-list">
                {[
                  { label: 'Leaders', role: 'leader', color: '#b85200' },
                  { label: 'Admins',  role: 'admin',  color: '#2d5cf6' },
                  { label: 'Members', role: 'member', color: '#2bb5a0' },
                ].map(({ label, role, color }) => {
                  const count = members.filter(m => m.role === role).length;
                  return (
                    <div key={role} className="activity-item">
                      <div className="activity-dot" style={{ background: color }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div className="activity-text">{label}</div>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#333' }}>{count}</span>
                        </div>
                        <div style={{ marginTop: 4, height: 4, borderRadius: 4, background: '#f0f1f4', overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', borderRadius: 4, background: color,
                            width: members.length ? `${(count / members.length) * 100}%` : '0%',
                            transition: 'width 0.4s ease',
                          }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Delete confirmation modal ── */}
      {showDeleteConfirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: '32px 28px',
            width: 400, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          }}>
            <div style={{ fontSize: 36, marginBottom: 12, textAlign: 'center' }}>⚠️</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1a1c20', margin: '0 0 10px', textAlign: 'center' }}>
              Delete "{team.name}"?
            </h2>
            <p style={{ fontSize: 13.5, color: '#666', lineHeight: 1.6, margin: '0 0 24px', textAlign: 'center' }}>
              This will permanently remove the team and all its members. This action <strong>cannot be undone</strong>.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                style={{
                  flex: 1, padding: '10px', border: '1.5px solid #d4d8e4',
                  background: '#fff', borderRadius: 9, fontSize: 14,
                  fontWeight: 600, color: '#444', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteTeam}
                disabled={deleting}
                style={{
                  flex: 1, padding: '10px', border: 'none',
                  background: '#c33', borderRadius: 9, fontSize: 14,
                  fontWeight: 600, color: '#fff', cursor: deleting ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', opacity: deleting ? 0.7 : 1,
                  transition: 'background 0.15s',
                }}
              >
                {deleting ? 'Deleting…' : 'Yes, Delete Team'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}