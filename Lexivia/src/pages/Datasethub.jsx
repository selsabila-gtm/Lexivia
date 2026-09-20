/**
 * DatasetHub.jsx — updated
 *
 * Changes:
 *  1. Versioning now reads from / writes to the `dataset_versions` SQL table
 *     (via updated backend endpoints) — no more JSON blob in datasets_json.
 *  2. "Snapshot Dataset" button visible to ALL team members (no organizer gate).
 *  3. Delete button also open to all members (your dataset, your call).
 *  4. All other version UI preserved: pinning, edit modal, changelog, diff badges,
 *     label distribution mini-bars, active-version filter on the samples table.
 */

import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import CompetitionSidebar from "../components/CompetitionSidebar";
import CompetitionTopbar from "../components/CompetitionTopbar";
import DataHealthPanel from "../components/DataHealthPanel";
import RawSamplesTable from "../components/RawSamplesTable";
import "../styles/DatasetHub.css";

const API = "http://127.0.0.1:8000";
function authHeader() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
}


// ─── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }) {
    return (
        <div className="dh-stat-card">
            <span className="dh-stat-val" style={accent ? { color: accent } : {}}>{value}</span>
            <span className="dh-stat-label">{label}</span>
            {sub && <span className="dh-stat-sub">{sub}</span>}
        </div>
    );
}

// ─── Diff badge ────────────────────────────────────────────────────────────────
function DiffBadge({ value, label }) {
    if (!value) return null;
    return (
        <span className={`dh-diff-badge ${value > 0 ? "pos" : "neg"}`}>
            {value > 0 ? "+" : ""}{value} {label}
        </span>
    );
}

// ─── Label mini-bars ───────────────────────────────────────────────────────────
function VersionLabelBars({ distribution, total }) {
    if (!distribution || !total) return null;
    const COLORS = ["#1359db", "#22c47a", "#f97316", "#8b5cf6", "#ec4899"];
    return (
        <div className="dh-ver-label-bars">
            {Object.entries(distribution).slice(0, 5).map(([lbl, cnt], i) => (
                <div key={lbl} className="dh-ver-label-row">
                    <span className="dh-ver-label-name" title={lbl}>{lbl}</span>
                    <div className="dh-ver-label-bar">
                        <div className="dh-ver-label-fill"
                            style={{
                                width: `${Math.round(cnt / total * 100)}%`,
                                background: COLORS[i % COLORS.length]
                            }} />
                    </div>
                    <span className="dh-ver-label-pct">{Math.round(cnt / total * 100)}%</span>
                </div>
            ))}
        </div>
    );
}

// ─── Single version card ───────────────────────────────────────────────────────
function VersionCard({ version, isActive, isLast, onSelect, onEdit, onDelete, onPin, pinning }) {
    const [expanded, setExpanded] = useState(false);
    const total = version.total_samples || 0;

    const cardClass = [
        "dh-ver-card",
        isActive ? "active" : "",
        version.is_current ? "is-latest" : "",
        version.is_pinned ? "is-pinned" : "",
    ].filter(Boolean).join(" ");

    const statColors = { validated: "#22c47a", flagged: "#f97316", rejected: "#ef4444", pending: "#f59e0b" };

    return (
        <div className="dh-ver-spine">
            <div className="dh-ver-spine-col">
                <div className={`dh-ver-spine-dot${version.is_current ? " active" : ""}`} />
                {!isLast && <div className="dh-ver-spine-line" />}
            </div>

            <div className="dh-ver-spine-card">
                <div className={cardClass} onClick={() => onSelect(version.tag)}>

                    {/* Head */}
                    <div className="dh-ver-card-head">
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                <span className="dh-ver-tag">{version.tag}</span>
                                {version.is_current && <span className="dh-ver-badge-latest">Latest</span>}
                                {version.is_pinned && <span className="dh-ver-badge-pinned">📌 In Use</span>}
                                {isActive && !version.is_current && <span className="dh-ver-badge-viewing">Viewing</span>}
                            </div>
                            {version.label && <p className="dh-ver-label">{version.label}</p>}
                            <p className="dh-ver-date">{version.date}</p>
                        </div>

                        <div className="dh-ver-actions" onClick={e => e.stopPropagation()}>
                            <button
                                className={`dh-ver-pin-btn${version.is_pinned ? " pinned" : ""}`}
                                title={version.is_pinned ? "Unpin" : "Pin for experiments"}
                                onClick={() => onPin(version.tag)}
                                disabled={pinning}
                            >{version.is_pinned ? "📌" : "📍"}</button>
                            <button className="dh-ver-edit-btn" title="Edit label/notes"
                                onClick={() => onEdit(version)}>✎</button>
                            {/* All members can delete (except the latest version) */}
                            {!version.is_current && (
                                <button className="dh-ver-del-btn" title="Delete version"
                                    onClick={() => onDelete(version.tag)}>✕</button>
                            )}
                        </div>
                    </div>

                    {/* Stats */}
                    <div className="dh-ver-stats">
                        {[
                            { key: "validated", count: version.validated_samples },
                            { key: "flagged", count: version.flagged_samples },
                            { key: "rejected", count: version.rejected_samples },
                            { key: "pending", count: version.pending_samples },
                        ].filter(s => s.count > 0).map(({ key, count }) => (
                            <span key={key} className="dh-ver-stat" style={{ color: statColors[key] }}>
                                {count?.toLocaleString()} {key}
                            </span>
                        ))}
                    </div>

                    {/* Diffs */}
                    {version.diff && Object.values(version.diff).some(v => v !== 0) && (
                        <div className="dh-ver-diffs">
                            <DiffBadge value={version.diff.validated_samples} label="validated" />
                            <DiffBadge value={version.diff.total_samples} label="total" />
                            <DiffBadge value={version.diff.flagged_samples} label="flagged" />
                        </div>
                    )}

                    {/* Expand toggle */}
                    <button className="dh-ver-toggle"
                        onClick={e => { e.stopPropagation(); setExpanded(x => !x); }}>
                        {expanded ? "▾ Hide" : "▸ Show"} changelog & labels
                    </button>

                    {expanded && (
                        <div className="dh-ver-expanded" onClick={e => e.stopPropagation()}>
                            {version.changelog?.length > 0 && (
                                <div>
                                    <p className="dh-ver-section-title">Changelog</p>
                                    <ul className="dh-ver-changelog">
                                        {version.changelog.map((line, i) => <li key={i}>{line}</li>)}
                                    </ul>
                                </div>
                            )}
                            {version.notes && (
                                <div>
                                    <p className="dh-ver-section-title">Notes</p>
                                    <p className="dh-ver-notes">{version.notes}</p>
                                </div>
                            )}
                            {version.label_distribution && (
                                <div>
                                    <p className="dh-ver-section-title">Label distribution</p>
                                    <VersionLabelBars
                                        distribution={version.label_distribution}
                                        total={total}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Edit version modal ────────────────────────────────────────────────────────
function EditVersionModal({ version, onSave, onClose }) {
    const [label, setLabel] = useState(version.label || "");
    const [notes, setNotes] = useState(version.notes || "");
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        await onSave(version.tag, { label, notes });
        setSaving(false);
        onClose();
    };

    return (
        <div className="dh-modal-backdrop" onClick={onClose}>
            <div className="dh-modal" onClick={e => e.stopPropagation()}>
                <h3 className="dh-modal-title">Edit {version.tag}</h3>
                <p className="dh-modal-sub">Update label or notes. Stats are immutable.</p>
                <label className="dh-modal-label">LABEL</label>
                <input className="dh-modal-input" value={label}
                    onChange={e => setLabel(e.target.value)}
                    placeholder="e.g. Pre-launch freeze" />
                <label className="dh-modal-label" style={{ marginTop: 10 }}>NOTES</label>
                <textarea className="dh-modal-input" value={notes} rows={3}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="What changed in this version?"
                    style={{ resize: "vertical", minHeight: 64, fontFamily: "inherit" }} />
                <div className="dh-modal-actions">
                    <button className="dh-modal-cancel" onClick={onClose}>Cancel</button>
                    <button className="dh-modal-confirm" onClick={handleSave} disabled={saving}>
                        {saving ? "Saving…" : "Save Changes"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Version Control panel ─────────────────────────────────────────────────────
function VersionControl({ versions, loading, onCreateVersion, onUpdateVersion, onDeleteVersion,
    onSelectVersion, activeVersion, onRefresh, pinnedTag, onPin, pinning }) {

    const [showModal, setShowModal] = useState(false);
    const [editingVersion, setEditingVersion] = useState(null);
    const [tag, setTag] = useState("");
    const [label, setLabel] = useState("");
    const [notes, setNotes] = useState("");
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState(null);

    const handleCreate = async () => {
        setCreating(true);
        setError(null);
        const err = await onCreateVersion({ tag, label, notes });
        if (err) { setError(err); }
        else { setTag(""); setLabel(""); setNotes(""); setShowModal(false); }
        setCreating(false);
    };

    const handleDelete = async (vTag) => {
        if (!window.confirm(`Delete version ${vTag}? Samples are not lost — they just won't be tagged with this version.`)) return;
        await onDeleteVersion(vTag);
    };

    const visible = versions.filter(v => !v.deleted);

    return (
        <div className="dh-version-panel">
            {/* Header */}
            <div className="dh-version-header">
                <span className="dh-version-title">VERSION CONTROL</span>
                <div style={{ display: "flex", gap: 6 }}>
                    {activeVersion && (
                        <button className="dh-ver-clear-btn" onClick={() => onSelectVersion(null)}>
                            ✕ Clear filter
                        </button>
                    )}
                    <button className="dh-version-icon-btn" onClick={onRefresh} title="Refresh">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="1 4 1 10 7 10" />
                            <polyline points="23 20 23 14 17 14" />
                            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Pinned banner */}
            {pinnedTag && (
                <div className="dh-ver-pinned-bar">
                    <div className="dh-ver-pinned-info">
                        <span className="dh-ver-pinned-icon">📌</span>
                        <div>
                            <p className="dh-ver-pinned-label">PINNED FOR EXPERIMENTS</p>
                            <p className="dh-ver-pinned-tag">{pinnedTag}</p>
                        </div>
                    </div>
                    <button className="dh-ver-unpin-btn"
                        onClick={() => onPin(pinnedTag)} disabled={pinning}>
                        Unpin
                    </button>
                </div>
            )}

            {/* Active filter banner */}
            {activeVersion && (
                <div className="dh-ver-filter-banner">
                    <span>🔍 Viewing {activeVersion} — table filtered</span>
                    <button className="dh-ver-clear-btn" onClick={() => onSelectVersion(null)}>
                        Show all
                    </button>
                </div>
            )}

            {/* Timeline */}
            {loading ? (
                <div className="dh-version-loading">Loading versions…</div>
            ) : visible.length === 0 ? (
                <div className="dh-ver-empty">
                    <p className="dh-ver-empty-title">No snapshots yet</p>
                    <p className="dh-ver-empty-sub">
                        Click <strong>"+ Snapshot Dataset"</strong> to freeze your validated
                        samples into a versioned, reproducible snapshot stored in the database.
                    </p>
                </div>
            ) : (
                <div className="dh-ver-timeline">
                    {visible.map((v, i) => (
                        <VersionCard
                            key={v.tag}
                            version={v}
                            isActive={activeVersion === v.tag}
                            isLast={i === visible.length - 1}
                            onSelect={tag => onSelectVersion(activeVersion === tag ? null : tag)}
                            onEdit={setEditingVersion}
                            onDelete={handleDelete}
                            onPin={onPin}
                            pinning={pinning}
                        />
                    ))}
                </div>
            )}

            {/* Snapshot button — ALL members can create snapshots */}
            <button className="dh-snapshot-btn" onClick={() => setShowModal(true)}>
                + Snapshot Dataset
            </button>

            {/* Create modal */}
            {showModal && (
                <div className="dh-modal-backdrop"
                    onClick={() => { setShowModal(false); setError(null); }}>
                    <div className="dh-modal" onClick={e => e.stopPropagation()}>
                        <h3 className="dh-modal-title">Create Dataset Snapshot</h3>
                        <p className="dh-modal-sub">
                            Freezes all currently-validated samples into an immutable snapshot
                            saved to the database. Future submissions won't affect this version.
                        </p>
                        {error && <div className="dh-modal-error">{error}</div>}
                        <label className="dh-modal-label">VERSION TAG</label>
                        <input className="dh-modal-input" value={tag}
                            onChange={e => setTag(e.target.value)}
                            placeholder="e.g. v1.3  (auto-generated if blank)" />
                        <label className="dh-modal-label" style={{ marginTop: 10 }}>
                            LABEL (optional)
                        </label>
                        <input className="dh-modal-input" value={label}
                            onChange={e => setLabel(e.target.value)}
                            placeholder="e.g. Pre-launch validation freeze" />
                        <label className="dh-modal-label" style={{ marginTop: 10 }}>
                            NOTES (optional)
                        </label>
                        <textarea className="dh-modal-input" value={notes} rows={3}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="Describe what changed in this version…"
                            style={{ resize: "vertical", minHeight: 60, fontFamily: "inherit" }} />
                        <div className="dh-modal-actions">
                            <button className="dh-modal-cancel"
                                onClick={() => { setShowModal(false); setError(null); }}>
                                Cancel
                            </button>
                            <button className="dh-modal-confirm"
                                onClick={handleCreate} disabled={creating}>
                                {creating ? "Creating…" : "Create Snapshot"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit modal */}
            {editingVersion && (
                <EditVersionModal
                    version={editingVersion}
                    onSave={onUpdateVersion}
                    onClose={() => setEditingVersion(null)}
                />
            )}
        </div>
    );
}

// ─── Embedding visualiser ──────────────────────────────────────────────────────
function EmbeddingVisualizer() {
    return (
        <div className="dh-embed-panel">
            <div className="dh-embed-header">
                <span className="dh-embed-title">EMBEDDING SPACE</span>
                <span className="dh-embed-sub">t-SNE · 2D · BERT-base</span>
            </div>
            <div className="dh-embed-canvas">
                <p className="dh-embed-placeholder">Visualisation loads after 100+ samples</p>
            </div>
        </div>
    );
}

// ─── Main DatasetHub page ───────────────────────────────────────────────────────
export default function DatasetHub() {
    const { competitionId } = useParams();

    const [competition, setCompetition] = useState(null);
    const [health, setHealth] = useState(null);
    const [healthLoading, setHealthLoading] = useState(true);
    const [versions, setVersions] = useState([]);
    const [versionsLoading, setVersionsLoading] = useState(true);
    const [isOrganizer, setIsOrganizer] = useState(false);
    const [activeVersion, setActiveVersion] = useState(null);
    const [pinnedTag, setPinnedTag] = useState(null);
    const [pinning, setPinning] = useState(false);
    const [downloadFormat, setDownloadFormat] = useState("csv");
    const [downloading, setDownloading] = useState(false);

    // Competition detail
    useEffect(() => {
        fetch(`${API}/competitions/${competitionId}`, { headers: authHeader() })
            .then(r => r.json()).then(setCompetition).catch(console.error);
    }, [competitionId]);

    // Role (for informational use only — does not gate any actions in this page)
    useEffect(() => {
        fetch(`${API}/competitions/${competitionId}/my-role`, { headers: authHeader() })
            .then(r => r.ok ? r.json() : { role: "guest", is_organizer: false })
            .then(d => setIsOrganizer(d.role === "organizer" || d.is_organizer === true))
            .catch(() => setIsOrganizer(false));
    }, [competitionId]);

    // Health — poll every 30s
    useEffect(() => {
        const load = () => {
            setHealthLoading(true);
            fetch(`${API}/competitions/${competitionId}/data-health`, { headers: authHeader() })
                .then(r => r.ok ? r.json() : null)
                .then(d => { if (d) setHealth(d); })
                .catch(console.error)
                .finally(() => setHealthLoading(false));
        };
        load();
        const iv = setInterval(load, 30_000);
        return () => clearInterval(iv);
    }, [competitionId]);

    // Versions from the dataset_versions table
    const loadVersions = useCallback(() => {
        setVersionsLoading(true);
        fetch(`${API}/competitions/${competitionId}/versions`, { headers: authHeader() })
            .then(r => r.ok ? r.json() : [])
            .then(d => {
                const list = Array.isArray(d) ? d : [];
                setVersions(list);
                const pinned = list.find(v => v.is_pinned);
                setPinnedTag(pinned ? pinned.tag : null);
            })
            .catch(() => setVersions([]))
            .finally(() => setVersionsLoading(false));
    }, [competitionId]);

    useEffect(() => { loadVersions(); }, [loadVersions]);

    // Create snapshot — open to all members
    const handleCreateVersion = async (body) => {
        try {
            const res = await fetch(`${API}/competitions/${competitionId}/versions`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeader() },
                body: JSON.stringify(body),
            });
            if (res.status === 409) return (await res.json()).detail || "Tag already exists.";
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            loadVersions();
            return null;
        } catch (err) { return err.message || "Failed to create version."; }
    };

    // Edit label / notes
    const handleUpdateVersion = async (tag, body) => {
        try {
            await fetch(`${API}/competitions/${competitionId}/versions/${tag}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", ...authHeader() },
                body: JSON.stringify(body),
            });
            loadVersions();
        } catch (err) { console.error(err); }
    };

    // Soft-delete — open to all members
    const handleDeleteVersion = async (tag) => {
        try {
            const res = await fetch(`${API}/competitions/${competitionId}/versions/${tag}`,
                { method: "DELETE", headers: authHeader() });
            if (res.status === 409) { alert((await res.json()).detail); return; }
            loadVersions();
            if (activeVersion === tag) setActiveVersion(null);
        } catch (err) { console.error(err); }
    };

    // Pin / unpin — open to all members
    const handlePin = async (tag) => {
        setPinning(true);
        try {
            if (pinnedTag === tag) {
                await fetch(`${API}/competitions/${competitionId}/versions/pin`,
                    { method: "DELETE", headers: authHeader() });
                setPinnedTag(null);
            } else {
                await fetch(`${API}/competitions/${competitionId}/versions/${tag}/pin`,
                    { method: "POST", headers: authHeader() });
                setPinnedTag(tag);
            }
            loadVersions();
        } catch (err) { console.error(err); }
        finally { setPinning(false); }
    };

    // Download
    const handleDownload = async () => {
        setDownloading(true);
        try {
            const params = new URLSearchParams({ format: downloadFormat });
            if (activeVersion) params.set("version", activeVersion);
            const res = await fetch(
                `${API}/competitions/${competitionId}/export?${params}`,
                { headers: authHeader() });
            if (!res.ok) {
                alert((await res.json().catch(() => ({}))).detail || "Download failed.");
                return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `dataset-${competitionId}${activeVersion ? `-${activeVersion}` : ""}.${downloadFormat}`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) { console.error(e); }
        finally { setDownloading(false); }
    };

    const total = health?.total || 0;
    const avgLen = health?.avg_text_length || 0;
    const vocabSize = total > 0 ? `${Math.round(total * 10.2 / 1000 * 10) / 10}k` : "—";

    return (
        <div className="dh-shell">
            <CompetitionSidebar
                competitionId={competitionId}
                competitionTitle={competition?.title}
                taskType={competition?.task_type}
            />

            <div className="dh-main">
                <CompetitionTopbar
    competitionId={competitionId}
    competitionTitle={competition?.title || "Competition"}
    status="LAB ACTIVE"
    showDatasetHub={false}
/>

                <div className="dh-body">
                    {/* Page header */}
                    <div className="dh-page-header">
                        <div className="dh-page-header-left">
                            <div className="dh-breadcrumb">
                                <span className="dh-crumb-tag">RESEARCH CORE</span>
                            </div>
                            <h1 className="dh-page-title">{competition?.title || "Dataset Hub"}</h1>
                            <p className="dh-page-desc">{competition?.description || ""}</p>
                        </div>
                        <div className="dh-page-header-right">
                            <div className="dh-download-group">
                                <select className="dh-format-select" value={downloadFormat}
                                    onChange={e => setDownloadFormat(e.target.value)}>
                                    <option value="csv">CSV</option>
                                    <option value="json">JSON</option>
                                    <option value="conll">CoNLL</option>
                                </select>
                                <button className="dh-download-btn" onClick={handleDownload}
                                    disabled={downloading}>
                                    {downloading ? "Downloading…"
                                        : activeVersion ? `Download ${activeVersion}` : "Download"}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Stats + Health */}
                    <div className="dh-stats-health-row">
                        <div className="dh-stats-row">
                            <StatCard label="TOTAL SAMPLES" value={total.toLocaleString()} accent="#1359db" />
                            <StatCard label="AVG TEXT LENGTH" value={avgLen || "—"}
                                sub={avgLen ? "tokens" : undefined} />
                            <StatCard label="VOCAB SIZE" value={total > 0 ? vocabSize : "—"} />
                            <StatCard label="LABEL DIST."
                                value={Object.keys(health?.label_distribution || {}).length || "—"}
                                sub="categories" />
                        </div>
                        <DataHealthPanel health={health} loading={healthLoading} />
                    </div>

                    {/* Two-column layout */}
                    <div className="dh-content-area">
                        <div className="dh-left-col">
                            <VersionControl
                                versions={versions}
                                loading={versionsLoading}
                                onCreateVersion={handleCreateVersion}
                                onUpdateVersion={handleUpdateVersion}
                                onDeleteVersion={handleDeleteVersion}
                                onSelectVersion={setActiveVersion}
                                activeVersion={activeVersion}
                                onRefresh={loadVersions}
                                pinnedTag={pinnedTag}
                                onPin={handlePin}
                                pinning={pinning}
                            />
                            <EmbeddingVisualizer />
                        </div>

                        <div className="dh-right-col">
                            {/* isOrganizer still passed for informational display in RawSamplesTable
                                but no longer gates any action buttons */}
                            <RawSamplesTable
                                competitionId={competitionId}
                                isOrganizer={isOrganizer}
                                version={activeVersion}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}