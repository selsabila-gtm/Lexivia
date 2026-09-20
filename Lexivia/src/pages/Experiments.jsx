import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../config/supabase.js";
import CompetitionSidebar from "../components/CompetitionSidebar";
import "../styles/Experiments.css";
import CompetitionTopbar from "../components/CompetitionTopbar";

const API = "http://127.0.0.1:8000";

async function getFreshToken() {
    const {
        data: { session },
        error,
    } = await supabase.auth.getSession();

    if (error) {
        console.warn("Supabase session error:", error);
    }

    if (session?.access_token) {
        localStorage.setItem("token", session.access_token);
        localStorage.setItem("user", JSON.stringify(session.user));
        return session.access_token;
    }

    return (
        localStorage.getItem("token") ||
        localStorage.getItem("access_token") ||
        localStorage.getItem("jwt")
    );
}


function clearAuthAndGoLogin() {
    localStorage.removeItem("token");
    localStorage.removeItem("access_token");
    localStorage.removeItem("jwt");
    localStorage.removeItem("user");

    window.location.href = "/login";
}

async function fetchWithFreshAuth(url, options = {}) {
    let token = await getFreshToken();

    let res = await fetch(url, {
        ...options,
        headers: {
            ...(options.headers || {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });

    if (res.status !== 401) {
        return res;
    }

    const { data, error } = await supabase.auth.refreshSession();

    if (!error && data.session?.access_token) {
        token = data.session.access_token;

        localStorage.setItem("token", token);
        localStorage.setItem("user", JSON.stringify(data.session.user));

        res = await fetch(url, {
            ...options,
            headers: {
                ...(options.headers || {}),
                Authorization: `Bearer ${token}`,
            },
        });
    }

    if (res.status === 401) {
        clearAuthAndGoLogin();
        throw new Error("Session expired. Please login again.");
    }

    return res;
}

const RESOURCE_TIERS = {
    "CPU Basic": {
        cpuLabel: "2 cores",
        ramLabel: "4 GB",
        gpuLabel: "No GPU",
        diskLabel: "10 GB",
        cpuPct: 40,
        ramPct: 45,
        gpuPct: 0,
    },
    "GPU Basic": {
        cpuLabel: "4 cores",
        ramLabel: "16 GB",
        gpuLabel: "1 shared GPU",
        diskLabel: "40 GB",
        cpuPct: 55,
        ramPct: 65,
        gpuPct: 35,
    },
    "GPU Pro": {
        cpuLabel: "8 cores",
        ramLabel: "32 GB",
        gpuLabel: "1 dedicated GPU",
        diskLabel: "80 GB",
        cpuPct: 70,
        ramPct: 75,
        gpuPct: 80,
    },
};

const DEFAULT_CODE = `# ── Lexivia Model Workspace ───────────────────────────────────────
# Click "Load Dataset" to create:
#   /home/jovyan/work/data/train.csv
#   /home/jovyan/work/data/test.csv
#
# Train your model here, then save it as model.pkl.
# Evaluation/submission will happen later on another page.

import pandas as pd
import pickle
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

train_df = pd.read_csv('/home/jovyan/work/data/train.csv')
test_df = pd.read_csv('/home/jovyan/work/data/test.csv')

print('Train:', train_df.shape)
print('Test:', test_df.shape)
print(train_df.head())

model = Pipeline([
    ('tfidf', TfidfVectorizer()),
    ('clf', LogisticRegression(max_iter=1000))
])

model.fit(train_df['text_content'], train_df['label'])

with open('model.pkl', 'wb') as f:
    pickle.dump(model, f)

print('Model saved to model.pkl')
`;

function ResBar({ label, value, pct }) {
    const color = pct > 75 ? "#f59e0b" : "#22c55e";

    return (
        <div className="ws-resbar">
            <span className="ws-resbar-label">{label}</span>
            <div className="ws-resbar-track">
                <div
                    className="ws-resbar-fill"
                    style={{ width: `${pct}%`, background: color }}
                />
            </div>
            <span className="ws-resbar-val">{value}</span>
        </div>
    );
}

function SaveModal({ saving, onClose, onSave }) {
    const [form, setForm] = useState({
        name: "",
        notes: "",
        model_filename: "model.pkl",
        learning_rate: "0.0001",
        batch_size: "16",
        epochs: "5",
    });

    const update = (key) => (e) =>
        setForm((prev) => ({ ...prev, [key]: e.target.value }));

    return (
        <div className="ws-modal-overlay" onClick={onClose}>
            <div className="ws-modal" onClick={(e) => e.stopPropagation()}>
                <div className="ws-modal-header">
                    <span>Save Model</span>
                    <button className="ws-modal-close" onClick={onClose}>
                        ×
                    </button>
                </div>

                <div className="ws-modal-body">
                    <label className="ws-modal-label">Model Name *</label>
                    <input
                        className="ws-modal-input"
                        value={form.name}
                        onChange={update("name")}
                        placeholder="bert-classifier-v1"
                    />

                    <label className="ws-modal-label">Model File</label>
                    <input
                        className="ws-modal-input"
                        value={form.model_filename}
                        onChange={update("model_filename")}
                        placeholder="model.pkl"
                    />

                    <label className="ws-modal-label">Notes</label>
                    <textarea
                        className="ws-modal-input ws-modal-textarea"
                        value={form.notes}
                        onChange={update("notes")}
                        placeholder="Training notes..."
                    />

                    <div className="ws-modal-row3">
                        <div>
                            <label className="ws-modal-label">LR</label>
                            <input
                                className="ws-modal-input"
                                value={form.learning_rate}
                                onChange={update("learning_rate")}
                            />
                        </div>

                        <div>
                            <label className="ws-modal-label">Batch</label>
                            <input
                                className="ws-modal-input"
                                value={form.batch_size}
                                onChange={update("batch_size")}
                            />
                        </div>

                        <div>
                            <label className="ws-modal-label">Epochs</label>
                            <input
                                className="ws-modal-input"
                                value={form.epochs}
                                onChange={update("epochs")}
                            />
                        </div>
                    </div>

                    <button
                        className="ws-modal-save"
                        disabled={saving || !form.name.trim()}
                        onClick={() => onSave(form)}
                    >
                        {saving ? "Saving..." : "Save Model"}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function Experiments() {
    const { competitionId } = useParams();

    const [competition, setCompetition] = useState(null);
    const [workspace, setWorkspace] = useState(null);
    const [experiments, setExperiments] = useState([]);
    const [files, setFiles] = useState([]);
    const [activeFile, setActiveFile] = useState("");
    const [openTabs, setOpenTabs] = useState([]);
    const [fileContent, setFileContent] = useState(DEFAULT_CODE);

    const [resourceTier, setResourceTier] = useState("GPU Basic");
    const [loading, setLoading] = useState(true);
    const [launching, setLaunching] = useState(false);
    const [savingFile, setSavingFile] = useState(false);
    const [running, setRunning] = useState(false);
    const [runOutput, setRunOutput] = useState("");
    const [kernelStatus, setKernelStatus] = useState("IDLE");
    const [showSaveModal, setShowSaveModal] = useState(false);

    const [savingRun, setSavingRun] = useState(false);
    const [toast, setToast] = useState("");
    const [pageError, setPageError] = useState("");
    const [stdinByFile, setStdinByFile] = useState({});
    const [uptime, setUptime] = useState(0);

    const [loadingDataset, setLoadingDataset] = useState(false);
    const [datasetInfo, setDatasetInfo] = useState(null);

    const activeStdin = stdinByFile[activeFile] || "";
    const fileInputRef = useRef(null);
    const uptimeRef = useRef(null);

    const isRunning = workspace?.status === "running";

    const tier = useMemo(
        () => RESOURCE_TIERS[resourceTier] || RESOURCE_TIERS["GPU Basic"],
        [resourceTier]
    );

    const showToast = (msg) => {
        setToast(msg);
        setTimeout(() => setToast(""), 2800);
    };

    const safeJson = async (res) => {
        const text = await res.text();
        try {
            return text ? JSON.parse(text) : {};
        } catch {
            return { detail: text };
        }
    };

    const request = async (url, options = {}) => {
        const res = await fetchWithFreshAuth(url, options);

        const data = await safeJson(res);

        if (!res.ok) {
            console.error("API ERROR:", data);
            throw new Error(
                typeof data.detail === "string"
                    ? data.detail
                    : JSON.stringify(data.detail || data)
            );
        }

        return data;
    };

    const fmtUptime = (seconds) => {
        const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
        const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
        const s = String(seconds % 60).padStart(2, "0");
        return `${h}:${m}:${s}`;
    };

    const displayCpu = workspace?.cpu_limit || tier.cpuLabel;
    const displayRam = workspace?.ram_limit || tier.ramLabel;
    const displayGpu = workspace?.gpu_limit || tier.gpuLabel;
    const displayDisk = workspace?.storage_limit || tier.diskLabel;

    const gitHash = workspace?.container_id
        ? workspace.container_id.replace("ctr-", "").slice(0, 7)
        : "local";

    const loadFile = useCallback(
        async (filename) => {
            if (!filename) return;

            setActiveFile(filename);
            setOpenTabs((prev) =>
                prev.includes(filename) ? prev : [...prev, filename]
            );

            try {
                const data = await request(
                    `${API}/competitions/${competitionId}/workspace/file?filename=${encodeURIComponent(
                        filename
                    )}`
                );
                setFileContent(data.content ?? "");
            } catch (err) {
                setRunOutput(String(err.message || err));
            }
        },
        [competitionId]
    );

    const loadPage = useCallback(async () => {
        setLoading(true);
        setPageError("");

        try {
            const [compData, wsData, expData, filesData] = await Promise.all([
                request(`${API}/competitions/${competitionId}`),
                request(`${API}/competitions/${competitionId}/workspace`),
                request(`${API}/competitions/${competitionId}/experiments`),
                request(`${API}/competitions/${competitionId}/workspace/files`),
            ]);

            const loadedFiles = filesData.files || [];

            setCompetition(compData);
            setWorkspace(wsData);
            setResourceTier(wsData.resource_tier || "GPU Basic");
            setExperiments(Array.isArray(expData) ? expData : []);
            setFiles(loadedFiles);

            const firstFile =
                loadedFiles.find((f) => f === "main_modeling.py") ||
                loadedFiles.find((f) => f.endsWith(".py")) ||
                loadedFiles[0] ||
                "";

            if (firstFile) {
                setActiveFile(firstFile);
                setOpenTabs([firstFile]);
                setTimeout(() => loadFile(firstFile), 0);
            }

            setKernelStatus(wsData.status === "running" ? "RUNNING" : "IDLE");
        } catch (err) {
            setPageError(String(err.message || err));
        } finally {
            setLoading(false);
        }
    }, [competitionId, loadFile]);

    useEffect(() => {
        loadPage();
    }, [loadPage]);

    useEffect(() => {
        clearInterval(uptimeRef.current);

        if (isRunning) {
            uptimeRef.current = setInterval(() => setUptime((x) => x + 1), 1000);
        } else {
            setUptime(0);
        }

        return () => clearInterval(uptimeRef.current);
    }, [isRunning]);

    const saveCurrentFile = async () => {
        if (!activeFile) return;
        setSavingFile(true);

        try {
            await request(`${API}/competitions/${competitionId}/workspace/file`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filename: activeFile, content: fileContent }),
            });
            showToast("File saved");
        } catch (err) {
            setRunOutput(String(err.message || err));
        } finally {
            setSavingFile(false);
        }
    };

    const downloadCurrentFile = async () => {
        if (!activeFile) return;

        try {
            await saveCurrentFile();

            const res = await fetchWithFreshAuth(
                `${API}/competitions/${competitionId}/workspace/download?filename=${encodeURIComponent(
                    activeFile
                )}`
            );

            if (!res.ok) throw new Error("Download failed");

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = activeFile;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);

            showToast("File downloaded");
        } catch (err) {
            setRunOutput(String(err.message || err));
        }
    };

    const createNewFile = async () => {
        const filename = prompt("File name:", "train_model.py");
        if (!filename) return;

        try {
            await request(`${API}/competitions/${competitionId}/workspace/file`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    filename,
                    content: filename.endsWith(".txt") ? "" : "# New model file\n",
                }),
            });

            await loadPage();
            await loadFile(filename);
            showToast("File created");
        } catch (err) {
            setRunOutput(String(err.message || err));
        }
    };

    const uploadWorkspaceFile = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetchWithFreshAuth(
                `${API}/competitions/${competitionId}/workspace/upload`,
                {
                    method: "POST",
                    body: formData,
                }
            );

            const data = await safeJson(res);

            if (!res.ok) throw new Error(data.detail || "Could not upload file");

            await loadPage();
            await loadFile(data.filename);

            showToast("File uploaded");
        } catch (err) {
            setRunOutput(String(err.message || err));
        } finally {
            e.target.value = "";
        }
    };

    const closeTab = (filename, e) => {
        e.stopPropagation();

        const nextTabs = openTabs.filter((tab) => tab !== filename);
        setOpenTabs(nextTabs);

        if (activeFile === filename) {
            const next = nextTabs[nextTabs.length - 1] || "";
            setActiveFile(next);

            if (next) loadFile(next);
            else setFileContent("");
        }
    };

    const launchWorkspace = async () => {
        setLaunching(true);

        try {
            const data = await request(
                `${API}/competitions/${competitionId}/workspace/launch`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ resource_tier: resourceTier }),
                }
            );

            setWorkspace(data.workspace);
            setKernelStatus("RUNNING");
            showToast("Workspace launched");

            const notebookUrl = data.notebook_url || data.workspace?.notebook_url;

            if (notebookUrl?.startsWith("http")) {
                window.open(notebookUrl, "_blank", "noopener,noreferrer");
            }
        } catch (err) {
            setPageError(String(err.message || err));
        } finally {
            setLaunching(false);
        }
    };

    const stopWorkspace = async () => {
        try {
            const data = await request(
                `${API}/competitions/${competitionId}/workspace/stop`,
                { method: "POST" }
            );

            setWorkspace(data.workspace);
            setKernelStatus("IDLE");
            showToast("Workspace stopped");
        } catch (err) {
            setPageError(String(err.message || err));
        }
    };

    const openJupyter = async () => {
        if (workspace?.notebook_url?.startsWith("http")) {
            window.open(workspace.notebook_url, "_blank", "noopener,noreferrer");
            return;
        }

        try {
            const data = await request(
                `${API}/competitions/${competitionId}/workspace/jupyter`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ resource_tier: resourceTier }),
                }
            );

            const url = data.notebook_url || data.workspace?.notebook_url;
            if (url) window.open(url, "_blank", "noopener,noreferrer");
        } catch (err) {
            setPageError(String(err.message || err));
        }
    };

    const loadDatasetIntoWorkspace = async () => {
        setLoadingDataset(true);
        setRunOutput("Loading dataset from Dataset Hub into workspace...");

        try {
            const data = await request(
                `${API}/competitions/${competitionId}/workspace/load-dataset`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ format: "both" }),
                }
            );

            setDatasetInfo({
                sample_count: data.sample_count,
                train_count: data.train_count,
                test_count: data.test_count,
                version_tag: data.version_tag || null,
                files_written: data.files_written || [],
            });

            setRunOutput(
                `✓ ${data.message}\n\n` +
                `Files written:\n${(data.files_written || [])
                    .map((f) => `  • ${f}`)
                    .join("\n")}\n\n` +
                `Container paths:\n${(data.container_paths || [])
                    .map((f) => `  ${f}`)
                    .join("\n")}\n\n` +
                `Usage:\n${data.usage_hint || ""}`
            );

            await loadPage();

            showToast(
                `✓ Dataset loaded: ${data.sample_count ??
                ((data.train_count || 0) + (data.test_count || 0))
                } samples`
            );
        } catch (err) {
            const msg = String(err.message || err);
            setRunOutput(`⚠ Dataset load failed:\n${msg}`);
            showToast(`⚠ ${msg}`);
        } finally {
            setLoadingDataset(false);
        }
    };

    const runCurrentFile = async () => {
        if (!activeFile) return;

        await saveCurrentFile();

        setRunning(true);
        setKernelStatus("BUSY");
        setRunOutput("Running...");

        try {
            const stdin = activeStdin
                ? activeStdin.endsWith("\n")
                    ? activeStdin
                    : `${activeStdin}\n`
                : "";

            const data = await request(
                `${API}/competitions/${competitionId}/workspace/run`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        filename: activeFile,
                        content: fileContent,
                        stdin,
                    }),
                }
            );

            setRunOutput(
                `${data.stdout || ""}` +
                `${data.stderr ? `\nERROR:\n${data.stderr}` : ""}` +
                `${data.exit_code !== undefined ? `\n\nExit code: ${data.exit_code}` : ""}`
            );
        } catch (err) {
            console.error(err);

            if (err instanceof TypeError) {
                setRunOutput(
                    "Network error while contacting backend.\n\n" +
                    "Possible causes:\n" +
                    "- FastAPI server stopped\n" +
                    "- Docker container crashed\n" +
                    "- Workspace kernel not running\n" +
                    "- Backend timed out\n"
                );
            } else {
                setRunOutput(String(err.message || err));
            }
        } finally {
            setRunning(false);
            setKernelStatus(isRunning ? "RUNNING" : "IDLE");
        }
    };

    const saveExperiment = async (form) => {
        if (!activeFile) {
            setRunOutput("⚠ No active file selected.")
            return
        }

        setSavingRun(true)
        setShowSaveModal(false)

        try {
            setRunOutput("Preparing model save...\n\n1. Saving current file...")
            await saveCurrentFile()

            setRunOutput((prev) => `${prev}\n2. Running training code to create ${form.model_filename}...`)

            const stdin = activeStdin
                ? activeStdin.endsWith("\n")
                    ? activeStdin
                    : `${activeStdin}\n`
                : ""

            const runData = await request(
                `${API}/competitions/${competitionId}/workspace/run`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        filename: activeFile,
                        content: fileContent,
                        stdin,
                    }),
                }
            )

            const output =
                `${runData.stdout || ""}` +
                `${runData.stderr ? `\nERROR:\n${runData.stderr}` : ""}` +
                `${runData.exit_code !== undefined ? `\n\nExit code: ${runData.exit_code}` : ""}`

            setRunOutput(output)

            if (runData.exit_code !== 0) {
                throw new Error(
                    "Training code failed. Fix the error above before saving the model."
                )
            }

            setRunOutput((prev) => `${prev}\n\n3. Saving model record to database...`)

            const data = await request(
                `${API}/competitions/${competitionId}/experiments`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: form.name,
                        notes: form.notes,

                        dataset_version: datasetInfo?.version_tag || null,
                        dataset_files: datasetInfo?.files_written || [],

                        hyperparameters: {
                            learning_rate: form.learning_rate,
                            batch_size: form.batch_size,
                            epochs: form.epochs,
                        },

                        resource_tier: resourceTier,
                        active_file: activeFile,

                        model_filename: form.model_filename || "model.pkl",
                        artifact_path: form.model_filename || "model.pkl",
                    }),
                }
            )

            setExperiments((prev) => [data, ...prev])

            setRunOutput((prev) =>
                `${prev}\n\n✓ Model saved successfully.\nArtifact: ${data.artifact_path || "model.pkl"}\nMetric: ${data.metric_name || "not evaluated"} ${data.metric_value || ""}`
            )

            showToast("Model saved")
            await loadPage()
        } catch (err) {
            const msg = String(err.message || err)
            setRunOutput((prev) => `${prev}\n\n⚠ Save model failed:\n${msg}`)
            showToast("Save model failed")
        } finally {
            setSavingRun(false)
        }
    }

    const pushChanges = async () => {
        await saveCurrentFile();

        const message = prompt("Commit message:", "Update model workspace files");
        if (!message) return;

        try {
            await request(`${API}/competitions/${competitionId}/workspace/push`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message }),
            });

            showToast("Changes pushed");
        } catch (err) {
            setRunOutput(String(err.message || err));
        }
    };

    if (loading) {
        return (
            <div className="ws-boot">
                <div className="ws-boot-spinner" />
                <span>Initializing workspace...</span>
            </div>
        );
    }

    if (pageError) {
        return (
            <div className="ws-boot">
                <span style={{ color: "#f85149" }}>{pageError}</span>
                <button className="ws-btn ws-btn--launch" onClick={loadPage}>
                    Retry
                </button>
            </div>
        );
    }

    return (
        <div className="ws-shell">
            <CompetitionSidebar
                competitionId={competitionId}
                competitionTitle={competition?.title}
                taskType={competition?.task_type}
            />

            <div className="ws-ide">
                <CompetitionTopbar
                    competitionId={competitionId}
                    competitionTitle={competition?.title || "Competition"}
                    status={workspace?.status === "running" ? "LAB ACTIVE" : "LAB IDLE"}
                />

                <div className="ws-chrome">
                    <div className="ws-chrome-logo">
                        <div className="ws-logo-icon">⬡</div>
                        <div>
                            <div className="ws-logo-name">
                                {competition?.title || "Workspace"}
                            </div>
                            <div className="ws-logo-sub">
                                {resourceTier.toUpperCase()} ·{" "}
                                {workspace?.docker_image || "lexivia/notebook-gpu:latest"}
                            </div>
                        </div>
                    </div>

                    <div className="ws-chrome-res">
                        <ResBar label="CPU" value={displayCpu} pct={tier.cpuPct} />
                        <ResBar label="RAM" value={displayRam} pct={tier.ramPct} />

                        {resourceTier !== "CPU Basic" && (
                            <ResBar label="GPU" value={displayGpu} pct={tier.gpuPct} />
                        )}

                        <ResBar label="DISK" value={displayDisk} pct={35} />
                    </div>

                    <div className="ws-chrome-right">
                        <div className="ws-tier-wrap">
                            <span className="ws-tier-label">Resource Tier</span>
                            <select
                                className="ws-tier-select"
                                value={resourceTier}
                                disabled={isRunning}
                                onChange={(e) => setResourceTier(e.target.value)}
                            >
                                <option>CPU Basic</option>
                                <option>GPU Basic</option>
                                <option>GPU Pro</option>
                            </select>
                        </div>

                        <button className="ws-btn ws-btn--launch" onClick={openJupyter}>
                            Open Jupyter
                        </button>

                        {isRunning ? (
                            <button className="ws-btn ws-btn--stop" onClick={stopWorkspace}>
                                ■ Stop Kernel
                            </button>
                        ) : (
                            <button
                                className="ws-btn ws-btn--launch"
                                disabled={launching}
                                onClick={launchWorkspace}
                            >
                                {launching ? "Starting..." : "▶ Launch Kernel"}
                            </button>
                        )}
                    </div>
                </div>

                <div className="ws-tabbar">
                    {openTabs.map((tab) => (
                        <button
                            key={tab}
                            className={`ws-tab ${activeFile === tab ? "ws-tab--active" : ""
                                }`}
                            onClick={() => loadFile(tab)}
                        >
                            <span
                                className={`ws-tab-dot ${tab.endsWith(".py")
                                    ? "ws-tab-dot--py"
                                    : tab.endsWith(".txt")
                                        ? "ws-tab-dot--txt"
                                        : "ws-tab-dot--nb"
                                    }`}
                            />
                            {tab}
                            <span className="ws-tab-x" onClick={(e) => closeTab(tab, e)}>
                                ×
                            </span>
                        </button>
                    ))}
                </div>

                <div className="ws-body">
                    <aside className="ws-explorer">
                        <div className="ws-pane-title">
                            EXPLORER
                            <div className="ws-pane-actions">
                                <button className="ws-icon-btn" onClick={createNewFile}>
                                    +
                                </button>
                                <button className="ws-icon-btn" onClick={loadPage}>
                                    ↻
                                </button>
                            </div>
                        </div>

                        <div className="ws-tree">
                            <div className="ws-tree-folder">
                                <span className="ws-arrow">▸</span>
                                <span>data</span>
                                {datasetInfo && (
                                    <span
                                        className="ws-ro-badge"
                                        title={`${datasetInfo.sample_count || 0} samples`}
                                    >
                                        {datasetInfo.sample_count || 0}
                                    </span>
                                )}
                            </div>

                            <div className="ws-tree-folder">
                                <span className="ws-arrow">▸</span>
                                <span>saved_models</span>
                            </div>

                            <div className="ws-tree-folder ws-tree-folder--open">
                                <span className="ws-arrow">▾</span>
                                <span>workspace</span>
                            </div>

                            {files.map((file) => (
                                <button
                                    key={file}
                                    className={`ws-tree-file ${activeFile === file ? "ws-tree-file--active" : ""
                                        }`}
                                    onClick={() => loadFile(file)}
                                >
                                    <span
                                        className={`ws-file-dot ${file.endsWith(".py")
                                            ? "ws-file-dot--py"
                                            : file.endsWith(".txt")
                                                ? "ws-file-dot--txt"
                                                : "ws-file-dot--nb"
                                            }`}
                                    />
                                    {file}
                                </button>
                            ))}
                        </div>

                        <div className="ws-pane-title ws-pane-title--mt">
                            SAVED MODELS
                            <span className="ws-run-count">{experiments.length}</span>
                        </div>

                        <div className="ws-runs-list">
                            {experiments.length === 0 ? (
                                <p className="ws-runs-empty">No models saved yet</p>
                            ) : (
                                experiments.map((run) => (
                                    <div key={run.id} className="ws-run-item">
                                        <div className="ws-run-name">{run.name}</div>
                                        <div className="ws-run-score">
                                            {run.artifact_path || "model.pkl"}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </aside>

                    <main className="ws-notebook">
                        <div className="ws-nb-toolbar">
                            <button
                                className="ws-nb-btn"
                                disabled={!isRunning || running}
                                onClick={runCurrentFile}
                            >
                                ▶ Run Active File
                            </button>

                            <button
                                className="ws-nb-btn"
                                disabled={!isRunning || running}
                                onClick={runCurrentFile}
                            >
                                ▶ Run
                            </button>

                            <button className="ws-nb-btn" onClick={createNewFile}>
                                + File
                            </button>

                            <button
                                className="ws-nb-btn"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                ↑ Upload
                            </button>

                            <button className="ws-nb-btn" onClick={downloadCurrentFile}>
                                ↓ Download
                            </button>

                            <input
                                ref={fileInputRef}
                                type="file"
                                style={{ display: "none" }}
                                accept=".py,.txt,.ipynb,.csv,.json,.md,.pkl"
                                onChange={uploadWorkspaceFile}
                            />

                            <button
                                className="ws-nb-btn"
                                onClick={() => {
                                    setRunOutput("");
                                    setStdinByFile((prev) => ({
                                        ...prev,
                                        [activeFile]: "",
                                    }));
                                }}
                            >
                                ⊘ Clear
                            </button>

                            <button
                                className="ws-nb-btn"
                                disabled={savingFile}
                                onClick={saveCurrentFile}
                            >
                                {savingFile ? "Saving..." : "Save File"}
                            </button>

                            <button
                                className="ws-nb-btn ws-nb-btn--dataset"
                                disabled={loadingDataset}
                                onClick={loadDatasetIntoWorkspace}
                                title="Export validated samples from Dataset Hub into train/test files"
                            >
                                {loadingDataset
                                    ? "Loading..."
                                    : datasetInfo
                                        ? `⟳ Reload Dataset (${datasetInfo.sample_count || 0})`
                                        : "⬇ Load Dataset"}
                            </button>

                            <button
                                className="ws-nb-btn ws-nb-btn--save"
                                disabled={!isRunning || running || savingRun}
                                onClick={() => setShowSaveModal(true)}
                            >
                                {savingRun ? "Saving Model..." : "↑ Save Model"}
                            </button>
                        </div>

                        <div className="ws-nb-scroll">
                            <div className="ws-code-editor">
                                <div className="ws-code-editor-head">
                                    <span>{activeFile || "No file selected"}</span>

                                    <div style={{ display: "flex", gap: 8 }}>
                                        <button onClick={saveCurrentFile}>Save</button>
                                        <button
                                            onClick={runCurrentFile}
                                            disabled={!isRunning || running}
                                        >
                                            {running ? "Running..." : "Run"}
                                        </button>
                                    </div>
                                </div>

                                <textarea
                                    className="ws-code-textarea ws-code-textarea--main"
                                    value={fileContent}
                                    onChange={(e) => setFileContent(e.target.value)}
                                    spellCheck="false"
                                />
                            </div>

                            <div className="ws-code-editor ws-small-block">
                                <div className="ws-code-editor-head">
                                    <span>Input for input()</span>
                                </div>

                                <textarea
                                    className="ws-code-textarea ws-code-textarea--stdin"
                                    value={activeStdin}
                                    onChange={(e) =>
                                        setStdinByFile((prev) => ({
                                            ...prev,
                                            [activeFile]: e.target.value,
                                        }))
                                    }
                                    placeholder={"Example:\nAla"}
                                    spellCheck="false"
                                />
                            </div>

                            <div className="ws-code-editor ws-small-block">
                                <div className="ws-code-editor-head">
                                    <span>Output</span>
                                    <button
                                        onClick={() => {
                                            setRunOutput("");
                                            setStdinByFile((prev) => ({
                                                ...prev,
                                                [activeFile]: "",
                                            }));
                                        }}
                                    >
                                        Clear
                                    </button>
                                </div>

                                <pre className="ws-code-output">
                                    {runOutput || "Run output will appear here."}
                                </pre>
                            </div>
                        </div>

                        <div className="ws-statusbar">
                            <span
                                className={`ws-status-led ${isRunning
                                    ? "ws-status-led--on"
                                    : "ws-status-led--off"
                                    }`}
                            />

                            <span>STATUS: {kernelStatus}</span>
                            <div className="ws-statusbar-sep" />
                            <span>KERNEL: Python 3.10</span>
                            <div className="ws-statusbar-sep" />
                            <span>UPTIME: {fmtUptime(uptime)}</span>
                            <div className="ws-statusbar-sep" />

                            {datasetInfo && (
                                <>
                                    <span style={{ color: "#22c55e" }}>
                                        DATASET:{" "}
                                        {datasetInfo.train_count !== undefined
                                            ? `${datasetInfo.train_count} train / ${datasetInfo.test_count} test`
                                            : `${datasetInfo.sample_count || 0} samples loaded`}
                                    </span>
                                    <div className="ws-statusbar-sep" />
                                </>
                            )}

                            <span>SAVE: Manual</span>
                        </div>
                    </main>

                    <aside className="ws-envpanel">
                        <div className="ws-pane-title">
                            ENVIRONMENT INFO
                            <button className="ws-icon-btn" onClick={loadPage}>
                                ↻
                            </button>
                        </div>

                        <div className="ws-env-list">
                            {[
                                ["python", "3.10"],
                                ["torch", "2.1.0"],
                                ["transformers", "4.35.2"],
                                ["pandas", "2.x"],
                                ["numpy", "1.26"],
                                ["scikit-learn", "1.3"],
                            ].map(([pkg, ver]) => (
                                <div key={pkg} className="ws-env-row">
                                    <code className="ws-env-pkg">{pkg}</code>
                                    <span className="ws-env-ver">{ver}</span>
                                    <button
                                        className="ws-env-edit"
                                        onClick={() => loadFile("requirements.txt")}
                                    >
                                        Edit
                                    </button>
                                </div>
                            ))}
                        </div>

                        <div className="ws-pane-title ws-pane-title--mt">
                            CONTAINER
                        </div>

                        <div className="ws-container-info">
                            {[
                                ["Docker Image", workspace?.docker_image || "not launched"],
                                ["Container ID", workspace?.container_id || "not launched"],
                                ["Jupyter URL", workspace?.notebook_url || "not ready"],
                                ["CPU", displayCpu],
                                ["RAM", displayRam],
                                ["GPU", displayGpu],
                                ["Storage", displayDisk],
                            ].map(([label, value]) => (
                                <div key={label} className="ws-ci-row">
                                    <span>{label}</span>
                                    <code>{value}</code>
                                </div>
                            ))}
                        </div>

                        <div className="ws-pane-title ws-pane-title--mt">
                            GIT COMMIT HISTORY
                        </div>

                        <div className="ws-git-list">
                            <div className="ws-git-row">
                                <span className="ws-git-dot ws-git-dot--active" />

                                <div className="ws-git-info">
                                    <p className="ws-git-msg">Workspace updated</p>
                                    <p className="ws-git-sub">hash: {gitHash}</p>
                                </div>

                                <span className="ws-git-time">now</span>
                            </div>

                            <div className="ws-git-row">
                                <span className="ws-git-dot" />

                                <div className="ws-git-info">
                                    <p className="ws-git-msg">Initial setup</p>
                                    <p className="ws-git-sub">Project initialized</p>
                                </div>

                                <span className="ws-git-time">1h</span>
                            </div>
                        </div>

                        <button
                            className="ws-push-btn"
                            disabled={savingFile}
                            onClick={pushChanges}
                        >
                            {savingFile ? "Pushing..." : "↑ Push Changes"}
                        </button>
                    </aside>
                </div>
            </div>

            {showSaveModal && (
                <SaveModal
                    saving={savingRun}
                    onClose={() => setShowSaveModal(false)}
                    onSave={saveExperiment}
                />
            )}

            {toast && <div className="ws-toast">{toast}</div>}
        </div>
    );
}