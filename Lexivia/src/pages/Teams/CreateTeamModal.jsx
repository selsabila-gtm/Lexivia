import { useEffect, useMemo, useState } from 'react';

const API = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

function authJsonHeaders() {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

function authUploadHeaders() {
  const token = localStorage.getItem('token');
  return {
    Authorization: `Bearer ${token}`,
  };
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

function avatarHue(text) {
  const raw = text?.trim() || 'team';
  let hash = 0;

  for (let i = 0; i < raw.length; i++) {
    hash = raw.charCodeAt(i) + ((hash << 5) - hash);
  }

  return Math.abs(hash) % 360;
}

function DefaultPicturePreview({ name }) {
  return (
    <div className="create-logo-gradient" style={{ '--avatar-hue': avatarHue(name) }}>
      <span>{getInitials(name)}</span>
    </div>
  );
}

export default function CreateTeamModal({ isOpen, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const previewUrl = useMemo(() => {
    if (!logoFile) return null;
    return URL.createObjectURL(logoFile);
  }, [logoFile]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!isOpen) {
      setName('');
      setDescription('');
      setLogoFile(null);
      setError('');
      setSaving(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  function validateLogo(file) {
    if (!file) return true;

    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setError('Only JPG, PNG, and WEBP images are allowed.');
      return false;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError('Team picture must be smaller than 2MB.');
      return false;
    }

    return true;
  }

  function handlePickLogo(event) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;
    if (!validateLogo(file)) return;

    setError('');
    setLogoFile(file);
  }

  async function uploadLogo(teamId, file) {
    const formData = new FormData();
    formData.append('logo', file);

    const res = await fetch(`${API}/teams/${teamId}/logo`, {
      method: 'POST',
      headers: authUploadHeaders(),
      body: formData,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.detail || 'Team was created, but the picture upload failed.');
    }

    return data;
  }

  async function handleCreate() {
    const cleanName = name.trim();
    const cleanDescription = description.trim();

    if (!cleanName) {
      setError('Team name is required.');
      return;
    }

    if (logoFile && !validateLogo(logoFile)) return;

    setSaving(true);
    setError('');

    try {
      const res = await fetch(`${API}/teams`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          name: cleanName,
          description: cleanDescription,
        }),
      });

      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to create team.');
      }

      if (logoFile) {
        await uploadLogo(data.id, logoFile);
      }

      onCreated?.();
    } catch (err) {
      setError(err.message || 'Failed to create team.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="create-team-overlay" onMouseDown={onClose}>
      <div className="create-team-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="create-team-header">
          <div>
            <h2>Create Team</h2>
            <p>You can add a picture now, or keep the default and change it later.</p>
          </div>
          <button className="create-team-close" onClick={onClose} type="button" aria-label="Close">
            ×
          </button>
        </div>

        <div className="create-logo-row">
          <div className="create-logo-preview">
            {previewUrl ? (
              <img src={previewUrl} alt="Team preview" />
            ) : (
              <DefaultPicturePreview name={name} />
            )}
          </div>

          <div className="create-logo-actions">
            <div className="create-logo-title">Team picture</div>
            <div className="create-logo-subtitle">Optional. Used on team cards and the detail page.</div>
            <div className="create-logo-buttons">
              <label className="create-logo-upload">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handlePickLogo}
                />
                {logoFile ? 'Change picture' : 'Add picture'}
              </label>

              {logoFile && (
                <button className="create-logo-remove" type="button" onClick={() => setLogoFile(null)}>
                  Remove
                </button>
              )}
            </div>
            <span className="create-logo-help">PNG, JPG, or WEBP. Max 2MB.</span>
          </div>
        </div>

        <div className="create-field">
          <label>TEAM NAME</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter team name"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
          />
        </div>

        <div className="create-field">
          <label>DESCRIPTION</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe your team..."
          />
        </div>

        {error && <div className="create-error">{error}</div>}

        <div className="create-actions">
          <button className="create-cancel" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="create-submit" type="button" onClick={handleCreate} disabled={saving || !name.trim()}>
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
