import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../../components/Sidebar';
import Topbar from '../../components/Topbar';
import './TeamsPage.css';
import CreateTeamModal from './CreateTeamModal';
import { authFetch } from '../../utils/authFetch';

const PAGE_SIZE = 6;
const API_ORIGIN = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

function deriveStatus(team) {
  if (team.is_my_team) return { label: 'ACTIVE', color: 'active' };

  const createdAt = team.created_at ? new Date(team.created_at).getTime() : Date.now();
  const age = Date.now() - createdAt;
  const days = age / (1000 * 60 * 60 * 24);

  if (days < 30) return { label: 'RISING', color: 'rising' };

  const count = team.member_count ?? 0;
  if (count > 20) return { label: 'ELITE', color: 'elite' };
  if (count > 10) return { label: 'PREMIUM', color: 'premium' };

  return { label: 'ACTIVE', color: 'active' };
}

function resolveTeamLogo(team) {
  const logo = team?.logo_url || team?.logoUrl || team?.picture_url || team?.avatar_url;

  if (!logo) return null;
  if (logo.startsWith('http') || logo.startsWith('data:') || logo.startsWith('blob:')) {
    return logo;
  }

  return `${API_ORIGIN}${logo.startsWith('/') ? logo : `/${logo}`}`;
}

function getInitials(name) {
  if (!name?.trim()) return 'TM';
  return name
    .trim()
    .split(/\s+/)
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
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
    <div className="team-avatar-gradient" style={{ '--avatar-hue': avatarHue(team) }}>
      <span>{getInitials(team?.name)}</span>
    </div>
  );
}

function TeamAvatar({ team }) {
  const [imageFailed, setImageFailed] = useState(false);
  const logoSrc = resolveTeamLogo(team);
  const showImage = logoSrc && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [logoSrc]);

  return (
    <div className="team-avatar" aria-label={`${team?.name || 'Team'} logo`}>
      {showImage ? (
        <img
          src={logoSrc}
          alt={`${team?.name || 'Team'} logo`}
          className="team-avatar-img"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <DefaultTeamLogo team={team} />
      )}
    </div>
  );
}

function MemberAvatars({ count }) {
  const visible = Math.min(count, 3);
  const extra = count - visible;
  const colors = ['#4a6cf7', '#6d4fc7', '#2bb5a0'];

  return (
    <div className="member-avatars">
      {Array.from({ length: visible }).map((_, i) => (
        <div key={i} className="avatar" style={{ background: colors[i], zIndex: visible - i }}>
          {String.fromCharCode(65 + i)}
        </div>
      ))}
      {extra > 0 && <div className="avatar avatar-extra">+{extra}</div>}
    </div>
  );
}

function TeamCard({ team, onClick }) {
  const memberCount = team.member_count ?? 0;
  const { label, color } = deriveStatus(team);

  return (
    <div className="team-card" onClick={onClick}>
      <div className="team-card-header">
        <TeamAvatar team={team} />
        <span className={`status-badge status-${color}`}>{label}</span>
      </div>

      <h3 className="team-name">{team.name}</h3>
      <p className="team-desc">{team.description || 'No description provided.'}</p>

      <div className="team-meta">
        <div className="meta-box">
          <span className="meta-label">MEMBERS</span>
          <span className="meta-value">{memberCount} Total</span>
        </div>
        <div className="meta-box">
          <span className="meta-label">CREATED</span>
          <span className="meta-value">
            {team.created_at
              ? new Date(team.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
              : 'Unknown'}
          </span>
        </div>
      </div>

      <div className="team-footer">
        <MemberAvatars count={memberCount} />
        <button
          className="view-team-btn"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          View Team
        </button>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="team-card" style={{ pointerEvents: 'none' }}>
      {[120, 80, 60, 90].map((w, i) => (
        <div
          key={i}
          style={{
            height: i === 0 ? 44 : 14,
            width: i === 0 ? 44 : `${w}%`,
            background: '#eaeaea',
            borderRadius: 8,
            marginBottom: 12,
            animation: 'pulse 1.4s ease-in-out infinite',
          }}
        />
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );
}

export default function TeamsPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchTeams = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        tab: activeTab,
      });

      if (searchQuery.trim()) params.append('search', searchQuery.trim());

      const data = await authFetch(`/teams?${params}`);
      setTeams(data.teams ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      console.error(err);
      setError('Failed to load teams. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, searchQuery, page]);

  useEffect(() => {
    const debounce = setTimeout(fetchTeams, searchQuery ? 350 : 0);
    return () => clearTimeout(debounce);
  }, [fetchTeams, searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const visiblePages = () => {
    const pages = [];

    if (totalPages <= 5) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('...');
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
        pages.push(i);
      }
      if (page < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }

    return pages;
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <Topbar
          title="Teams"
          subtitle="Connect with elite NLP research collectives and collaborate on high-density language modeling competitions."
          showBrowseButton={false}
        />

        <div className="page-body">
          <div className="page-title-row">
            <button className="create-btn" onClick={() => setShowCreateModal(true)}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Create Team
            </button>
          </div>

          <div className="tabs">
            {['all', 'mine'].map((t) => (
              <button
                key={t}
                className={`tab${activeTab === t ? ' active' : ''}`}
                onClick={() => setActiveTab(t)}
              >
                {t === 'all' ? 'All Teams' : 'My Teams'}
              </button>
            ))}
          </div>

          {error && (
            <div className="teams-error">
              {error}
            </div>
          )}

          <div className="teams-grid">
            {loading ? (
              Array.from({ length: PAGE_SIZE }).map((_, i) => <SkeletonCard key={i} />)
            ) : teams.length === 0 ? (
              <div className="teams-empty-state">
                <div className="teams-empty-icon">⌕</div>
                <div className="teams-empty-title">
                  {activeTab === 'mine' ? "You haven't joined any teams yet." : 'No teams found.'}
                </div>
              </div>
            ) : (
              teams.map((team) => (
                <TeamCard
                  key={team.id}
                  team={team}
                  onClick={() => navigate(`/teams/${team.id}`)}
                />
              ))
            )}
          </div>

          {!loading && total > 0 && (
            <div className="pagination">
              <span className="pagination-info">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total} Teams
              </span>
              <div className="pagination-controls">
                <button className="page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
                {visiblePages().map((p, i) =>
                  p === '...' ? (
                    <span key={`ellipsis-${i}`} className="page-ellipsis">...</span>
                  ) : (
                    <button
                      key={p}
                      className={`page-btn${p === page ? ' active' : ''}`}
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </button>
                  )
                )}
                <button className="page-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>›</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <CreateTeamModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => {
          setShowCreateModal(false);
          fetchTeams();
        }}
      />
    </div>
  );
}
