import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import "../styles/CreateCompetition.css";
import DatasetSection from "./DatasetSection";
import { supabase } from "../config/supabase";

/** Always returns a fresh, valid access token from Supabase session */
async function getFreshToken() {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data?.session?.access_token) return null;
    return data.session.access_token;
}

// The wizard is dynamic: Tracks, Phases, and Data Collection are independent
// capabilities an organizer can turn on separately, each adding its own step.
// Milestones has been removed as a concept — Phases (an ordered, named,
// organizer-defined timeline) is the only timeline mechanism now. A
// competition that doesn't enable Phases simply uses its start/end dates,
// with no fabricated timeline shown anywhere.
function getSteps(form) {
    const s = [
        { key: "basic", label: "Basic Info" },
        { key: "assets", label: "Sample Assets" },
        { key: "tasks", label: "Tasks" },
    ];
    if (form.participantSourcedData) {
        s.push({ key: "dataCollection", label: "Data Collection" });
    }
    if (form.tracksEnabled) {
        s.push({ key: "tracks", label: "Tracks" });
    }
    if (form.phasesEnabled) {
        s.push({ key: "phases", label: "Phases" });
    }
    if (form.participantSourcedData) {
        s.push({ key: "license", label: "License" });
    }
    s.push({ key: "evaluation", label: "Evaluation" });
    s.push({ key: "rules", label: "Rules" });
    s.push({ key: "complexity", label: "Complexity" });
    // When Data Collection is enabled, participants source their own raw data —
    // there's no organizer-provided dataset to demand, since the data collected
    // from participants is what gets used for training and evaluation instead.
    if (!form.participantSourcedData) {
        s.push({ key: "datasets", label: "Datasets" });
    }
    return s;
}

// Source types a team can pull participant-sourced data from (generic, not audio-specific)
const SOURCE_TYPE_OPTIONS = [
    { value: "public_platform", label: "Public platform (YouTube, etc.)" },
    { value: "self_recorded", label: "Recorded / written by the participant" },
    { value: "existing_dataset", label: "Existing dataset the team adapts" },
];

const primaryMetrics = [
    "Accuracy",
    "F1 Score",
    "BLEU",
    "ROUGE-L",
    "WER",
    "Exact Match",
];

const complexityLevels = [
    {
        title: "Level 1: Basic Text Classification",
        description: "Simple categorization tasks",
    },
    {
        title: "Level 2: Intermediate NER",
        description: "Named entity recognition with moderate complexity",
    },
    {
        title: "Level 3: Advanced Semantic Mapping",
        description: "Requires transformer architecture with attention mechanisms",
    },
    {
        title: "Level 4: Expert Multi-Task Learning",
        description: "Complex multi-objective optimization",
    },
];

const PREDEFINED_SKILLS = [
    "Natural Language Processing",
    "Computer Vision",
    "PyTorch",
    "TensorFlow",
    "Transformer Architecture",
    "Vector Databases",
    "Python",
    "CUDA",
    "Rust",
    "Go",
    "Docker",
    "Kubernetes",
    "FastAPI",
    "React",
    "Named Entity Recognition",
    "Automatic Speech Recognition",
    "Text Classification",
    "Data Annotation",
    "MLOps",
    "Fine-tuning",
    "Prompt Engineering",
];

// ── Generic assets + tasks ───────────────────────────────────────────────────
// A competition has no "type". It is defined by:
//   1. Sample Assets — the units of data one sample is made of (Text, Audio...),
//      each with its own constraints.
//   2. Tasks — generic operations (Transcription, Classification, NER...) that
//      each target an ASSET, the whole SAMPLE, or the TASK_OUTPUT of another
//      task, and may depend on earlier tasks (cycles are not allowed).
// The list of asset types, task types and each one's option schema comes from
// GET /competition-schema, so new ones need no change here.


function defaultsFromFields(fields = []) {
    const out = {};
    fields.forEach((f) => {
        if (f.default !== undefined) out[f.key] = Array.isArray(f.default) ? [...f.default] : f.default;
    });
    return out;
}

function nextKey(prefix, existing) {
    let n = 1;
    while (existing.includes(`${prefix}_${n}`)) n += 1;
    return `${prefix}_${n}`;
}

function isBlankValue(v) {
    return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function listFromValue(v) {
    const lines = Array.isArray(v) ? v : String(v || "").split("\n");
    return lines.map((s) => String(s).trim()).filter(Boolean);
}

// Direct dependencies of a task: its explicit "depends on" list plus, when it
// targets another task's output, that task.
function taskDeps(task) {
    const deps = [...(task.dependsOn || [])];
    if (task.targetType === "TASK_OUTPUT" && task.targetRef) deps.push(task.targetRef);
    return deps;
}

// true if task `fromKey` depends (directly or transitively) on `onKey`
function dependsTransitively(tasks, fromKey, onKey, seen = new Set()) {
    if (seen.has(fromKey)) return false;
    seen.add(fromKey);
    const t = tasks.find((x) => x.key === fromKey);
    if (!t) return false;
    return taskDeps(t).some((d) => d === onKey || dependsTransitively(tasks, d, onKey, seen));
}

function findTaskCycle(tasks) {
    const state = {};
    const stack = [];
    const visit = (key) => {
        state[key] = 1;
        stack.push(key);
        const t = tasks.find((x) => x.key === key);
        for (const d of t ? taskDeps(t) : []) {
            if (!tasks.some((x) => x.key === d)) continue;
            if (state[d] === 1) return [...stack.slice(stack.indexOf(d)), d];
            if (!state[d]) {
                const found = visit(d);
                if (found) return found;
            }
        }
        stack.pop();
        state[key] = 2;
        return null;
    };
    for (const t of tasks) {
        if (!state[t.key]) {
            const found = visit(t.key);
            if (found) return found;
        }
    }
    return null;
}

// A field with show_if only applies while another field has a given value
// (e.g. min/max labels only matter when "Allow multiple labels" is on).
function isFieldVisible(f, fields, values) {
    if (!f.show_if) return true;
    return Object.entries(f.show_if).every(([k, want]) => {
        const cur = values?.[k] ?? fields.find((x) => x.key === k)?.default;
        return Boolean(cur) === Boolean(want) && (typeof want !== "boolean" ? cur === want : true);
    });
}

// Validates a config object against a registry field list (mirrors the server).
function validateFieldValues(fields, values, errKey, errors, who) {
    fields.forEach((f) => {
        if (!isFieldVisible(f, fields, values)) return;
        const v = values?.[f.key];
        const name = `${who}: ${f.label}`;
        if (f.type === "string_list") {
            const n = listFromValue(v).length;
            const min = f.min_items ?? (f.required ? 1 : 0);
            if ((f.required || n > 0) && n < min)
                errors[`${errKey}-${f.key}`] = `${name} needs at least ${min} ${min === 1 ? "entry" : "entries"}.`;
            return;
        }
        if (f.type === "multi_select") {
            if (f.required && !(v || []).length) errors[`${errKey}-${f.key}`] = `${name}: select at least one.`;
            return;
        }
        if (isBlankValue(v)) {
            if (f.required) errors[`${errKey}-${f.key}`] = `${name} is required.`;
            return;
        }
        if (f.type === "integer" || f.type === "number") {
            const num = Number(v);
            if (Number.isNaN(num)) errors[`${errKey}-${f.key}`] = `${name} must be a number.`;
            else if (f.min !== undefined && num < f.min) errors[`${errKey}-${f.key}`] = `${name} must be at least ${f.min}.`;
            else if (f.max !== undefined && num > f.max) errors[`${errKey}-${f.key}`] = `${name} must be at most ${f.max}.`;
        }
    });
}

// Strip blanks and coerce so the payload is clean (server validates again).
function serializeFieldValues(fields, values) {
    const out = {};
    fields.forEach((f) => {
        if (!isFieldVisible(f, fields, values)) return;
        const v = values?.[f.key];
        if (isBlankValue(v)) return;
        if (f.type === "string_list") out[f.key] = listFromValue(v);
        else if (f.type === "integer") out[f.key] = parseInt(v, 10);
        else if (f.type === "number") out[f.key] = Number(v);
        else out[f.key] = v;
    });
    return out;
}

const initialForm = {
    competitionName: "",
    description: "",
    startDate: "",
    endDate: "",
    prizePool: "",

    primaryMetric: "",
    secondaryMetric: "",

    maxTeams: "",
    minMembers: "",
    maxMembers: "",
    mergeDeadline: "",
    requiredSkills: [],
    maxSubmissionsPerDay: "",
    allowExternalData: true,
    allowPretrainedModels: true,
    requireCodeSharing: false,
    additionalRules: "",

    complexityLevel: 0,

    // Join method: "auto" = automatic acceptance; "manual" = organizer approval required
    joinMethod: "auto",

    // What a sample is made of, and what is done on it (see helpers above).
    // assets: [{ id, key, name, type, required, constraints }]
    // tasks:  [{ id, key, name, type, targetType, targetRef, dependsOn, config, instructions }]
    assets: [],
    tasks: [],
    legacyTaskType: "",
    // Optional source prompts shown to contributors (one per line)
    prompts: "",

    // ── Independent platform capabilities ───────────────────────────────────────
    // Each of these can be turned on by itself; a competition can use any
    // combination (or none) of them, whatever the task type.

    // Tracks: split participants into fair comparison groups (region,
    // language, category...), each with a minimum team count to be viable.
    tracksEnabled: false,
    tracks: [],

    // Phases: an ordered, named timeline replacing the single start/end date
    // pair — for competitions with more than one stage (e.g. data collection
    // → break → training).
    phasesEnabled: false,
    phases: [
        { id: 1, name: "Data Collection & Annotation", durationDays: 14, description: "" },
        { id: 2, name: "Model Training & Leaderboard", durationDays: 10, description: "" },
    ],

    // Data Collection: participants source, record, or adapt their own raw
    // data instead of using an organizer-provided dataset. A contributed
    // instance is a sample, so its inputs are the Sample Assets; this governs
    // allowed sources and the annotation protocol.
    participantSourcedData: false,
    dataCollection: {
        allowedSourceTypes: ["public_platform", "self_recorded"],
        requireProvenance: true,
        annotatorsPerInstance: 2,
        adjudicationEnabled: true,
    },

    // Mandatory data usage license — required whenever contributed data may be
    // published or reused beyond the contributing team. Only asked for when
    // Data Collection is enabled.
    license: {
        version: "v1.0",
        text: "",
    },

    // Evaluation scoring mode: "standard" (one submission score) or
    // "data_quality_plus_model" (a per-team data-quality score, from a
    // baseline trained on that team's data alone, combined with each team's
    // own model score).
    evaluationMode: "standard",
    dataQualityWeight: 50,
    modelWeight: 50,
    perTeamBaselineEnabled: false,
    publicTestFraction: 20,
    winnersPerTrack: 1,

    validationDate: "",
    freezeDate: "",
};

function safeArrayJson(value) {
    try {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function mapCompetitionToForm(c) {
    let taskConfig = {};
    try {
        if (c.dataset_config) {
            const raw = typeof c.dataset_config === "string" ? JSON.parse(c.dataset_config) : c.dataset_config;
            taskConfig = raw || {};
        }
    } catch {
        taskConfig = {};
    }

    // Tracks / Phases / Data Collection / License / Evaluation each ride as
    // their own flat keys inside dataset_config — independent of each other.
    const tracksCfg = taskConfig.tracks_enabled ? (taskConfig.tracks || []) : [];
    const phasesCfg = taskConfig.phases_enabled ? (taskConfig.phases || []) : null;
    const dataCollectionCfg = taskConfig.data_collection || {};
    const licenseCfg = taskConfig.license || {};
    const evalCfg = taskConfig.evaluation_scoring || {};

    return {
        competitionName: c.title || "",
        // Only set for competitions created before assets + tasks existed.
        legacyTaskType: c.task_type || "",
        description: c.description || "",
        startDate: c.start_date || "",
        endDate: c.end_date || "",
        prizePool: c.prize_pool ?? "",

        primaryMetric: c.primary_metric || "",
        secondaryMetric: c.secondary_metric || "",

        maxTeams: c.max_teams ?? "",
        minMembers: c.min_members ?? "",
        maxMembers: c.max_members ?? "",
        mergeDeadline: c.merge_deadline || "",
        requiredSkills: safeArrayJson(c.required_skills),
        maxSubmissionsPerDay: c.max_submissions_per_day ?? "",
        allowExternalData: c.allow_external_data ?? true,
        allowPretrainedModels: c.allow_pretrained_models ?? true,
        requireCodeSharing: c.require_code_sharing ?? false,
        additionalRules: c.additional_rules || "",

        complexityLevel: c.complexity_level ?? 0,

        joinMethod: c.join_method || "auto",

        assets: (c.assets || []).map((a) => ({
            id: a.id || a.key,
            key: a.key,
            name: a.name || "",
            type: a.type,
            required: a.required !== false,
            constraints: a.constraints || {},
        })),
        tasks: (c.tasks || []).map((t) => ({
            id: t.id || t.key,
            key: t.key,
            name: t.name || "",
            type: t.type,
            targetType: t.target?.type || "",
            targetRef: t.target?.ref || "",
            dependsOn: t.depends_on || [],
            config: t.config || {},
            instructions: t.instructions || "",
        })),
        prompts: "",

        tracksEnabled: !!taskConfig.tracks_enabled,
        tracks: tracksCfg,

        phasesEnabled: !!taskConfig.phases_enabled,
        phases: phasesCfg && phasesCfg.length ? phasesCfg : initialForm.phases,

        participantSourcedData: !!taskConfig.data_collection_enabled,
        // The instance inputs are NOT stored on the form: a contributed
        // instance is a sample, so its inputs are always the sample assets.
        dataCollection: {
            allowedSourceTypes: dataCollectionCfg.allowed_source_types || initialForm.dataCollection.allowedSourceTypes,
            requireProvenance: dataCollectionCfg.require_public_source_provenance ?? true,
            annotatorsPerInstance: dataCollectionCfg.annotators_per_instance ?? 2,
            adjudicationEnabled: dataCollectionCfg.adjudication_enabled ?? true,
        },
        license: {
            version: licenseCfg.version || initialForm.license.version,
            text: licenseCfg.text || "",
        },

        evaluationMode: evalCfg.mode || "standard",
        dataQualityWeight: evalCfg.data_quality_weight ?? 50,
        modelWeight: evalCfg.model_weight ?? 50,
        perTeamBaselineEnabled: !!evalCfg.per_team_baseline_enabled,
        publicTestFraction: evalCfg.public_test_fraction ?? 20,
        winnersPerTrack: evalCfg.winners_per_track ?? 1,

        validationDate: c.validation_date || "",
        freezeDate: c.freeze_date || "",
    };
}

function CreateCompetition({ editMode = false }) {
    const navigate = useNavigate();
    const location = useLocation();
    const { competitionId } = useParams();

    const isEditMode = editMode || Boolean(competitionId);

    const [currentStep, setCurrentStep] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const [loadingEditData, setLoadingEditData] = useState(isEditMode);
    const [form, setForm] = useState(initialForm);
    const [errors, setErrors] = useState({});
    const [skillsOpen, setSkillsOpen] = useState(false);

    const [savedCompetitionId, setSavedCompetitionId] = useState(
        isEditMode ? competitionId : null
    );
    const [savingDraft, setSavingDraft] = useState(false);
    const [draftError, setDraftError] = useState(null);

    const wizardSteps = getSteps(form);

    // If toggling a capability removes/adds steps, keep the current
    // step in range instead of pointing past the end of the array.
    useEffect(() => {
        if (currentStep > wizardSteps.length - 1) {
            setCurrentStep(wizardSteps.length - 1);
        }
    }, [wizardSteps.length]); // eslint-disable-line react-hooks/exhaustive-deps

    const progressPercent = ((currentStep + 1) / wizardSteps.length) * 100;

    useEffect(() => {
        if (!isEditMode) return;

        const competitionFromState = location.state?.competition;

        // The list view's payload has no assets/tasks — fetch the full record then.
        if (competitionFromState && Array.isArray(competitionFromState.assets)) {
            setForm(mapCompetitionToForm(competitionFromState));
            setLoadingEditData(false);
            return;
        }

        async function loadCompetitionForEdit() {
            try {
                const token = await getFreshToken();

                if (!token) {
                    navigate("/login");
                    return;
                }

                const res = await fetch(
                    `http://127.0.0.1:8000/competitions/${competitionId}`,
                    { headers: { Authorization: `Bearer ${token}` } }
                );

                const data = await res.json();

                if (!res.ok) {
                    throw new Error(data.detail || "Could not load competition");
                }

                setForm(mapCompetitionToForm(data));
            } catch (error) {
                console.error(error);
                alert(error.message);
                navigate("/competitions");
            } finally {
                setLoadingEditData(false);
            }
        }

        loadCompetitionForEdit();
    }, [isEditMode, location.state, competitionId, navigate]);

    // Auto-save draft when reaching the Datasets step (its index shifts depending
    // on which capability steps are currently present).
    useEffect(() => {
        if (wizardSteps[currentStep]?.key !== "datasets") return;
        if (isEditMode) return;
        if (savedCompetitionId) return;

        async function saveDraftAuto() {
            const token = await getFreshToken();
            if (!token) return;

            setSavingDraft(true);
            setDraftError(null);

            try {
                const r = await fetch("http://127.0.0.1:8000/competitions/draft", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify(buildPayload()),
                });
                const data = await r.json();
                if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
                const id = data.id || data.competition_id;
                if (id) {
                    setSavedCompetitionId(id);
                } else {
                    setDraftError("Draft saved but no ID returned.");
                    console.error("Draft response missing id:", data);
                }
            } catch (err) {
                console.error("Draft save failed:", err);
                setDraftError(err.message || "Failed to save draft.");
            } finally {
                setSavingDraft(false);
            }
        }

        saveDraftAuto();
    }, [currentStep]); // eslint-disable-line react-hooks/exhaustive-deps

    const clearFieldError = (field) => {
        setErrors((prev) => {
            const copy = { ...prev };
            delete copy[field];
            return copy;
        });
    };

    const updateField = (field, value) => {
        setForm((prev) => {
            const next = { ...prev, [field]: value };
            return next;
        });
        clearFieldError(field);
    };

    // ── Registry: asset types, task types and their option schemas ────────────
    const [registry, setRegistry] = useState(null);
    const [registryError, setRegistryError] = useState("");
    const seededAssets = useRef(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const token = await getFreshToken();
                if (!token) return;
                const res = await fetch("http://127.0.0.1:8000/competition-schema", {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || "Could not load asset and task types");
                if (!cancelled) setRegistry(data);
            } catch (e) {
                if (!cancelled) setRegistryError(e.message || "Could not load asset and task types");
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // New competitions start with one Text asset so the step is never empty.
    useEffect(() => {
        if (!registry || isEditMode || seededAssets.current) return;
        seededAssets.current = true;
        setForm((prev) => {
            if (prev.assets.length) return prev;
            const spec = registry.asset_types.find((a) => a.value === "TEXT") || registry.asset_types[0];
            if (!spec) return prev;
            return { ...prev, assets: [{
                id: "text_1", key: "text_1", name: spec.label, type: spec.value,
                required: true, constraints: defaultsFromFields(spec.fields),
            }] };
        });
    }, [registry, isEditMode]);

    const assetSpec = (type) => registry?.asset_types.find((a) => a.value === type);
    const taskSpec = (type) => registry?.task_types.find((t) => t.value === type);

    // Everything a task of this type may legally target, given the current
    // assets and the other tasks. Invalid choices (wrong kind of data, or ones
    // that would create a circular dependency) are simply not offered.
    const targetOptionsFor = (task, taskType = task.type, tasks = form.tasks, assets = form.assets) => {
        const spec = taskSpec(taskType);
        if (!spec) return [];
        const accepts = spec.accepts;
        const opts = [];
        assets.forEach((a) => {
            const kind = assetSpec(a.type)?.kind;
            if (accepts.includes(kind)) opts.push({ value: `ASSET:${a.key}`, label: `Asset · ${a.name || a.key}` });
        });
        if (accepts.includes("sample")) opts.push({ value: "SAMPLE:", label: "Whole sample" });
        tasks.forEach((o) => {
            if (o.key === task.key) return;
            const produces = taskSpec(o.type)?.produces;
            if (accepts.includes(produces) && !dependsTransitively(tasks, o.key, task.key))
                opts.push({ value: `TASK_OUTPUT:${o.key}`, label: `Output of · ${o.name || o.key}` });
        });
        return opts;
    };

    const uniqueName = (base, names) => {
        let name = base, n = 2;
        while (names.some((x) => (x || "").trim().toLowerCase() === name.toLowerCase())) name = `${base} ${n++}`;
        return name;
    };

    // ── Asset handlers ────────────────────────────────────────────────────────
    const addAsset = (type) => {
        const spec = assetSpec(type);
        if (!spec) return;
        setForm((prev) => {
            const key = nextKey(type.toLowerCase(), prev.assets.map((a) => a.key));
            return { ...prev, assets: [...prev.assets, {
                id: key, key, name: uniqueName(spec.label, prev.assets.map((a) => a.name)),
                type, required: true, constraints: defaultsFromFields(spec.fields),
            }] };
        });
        clearFieldError("assets");
    };

    const updateAsset = (id, patch) => {
        setForm((prev) => ({ ...prev, assets: prev.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
        clearFieldError(`asset-${id}`);
    };

    const changeAssetType = (id, type) => {
        const spec = assetSpec(type);
        updateAsset(id, { type, constraints: defaultsFromFields(spec?.fields) });
    };

    const updateAssetConstraint = (id, key, value) => {
        setForm((prev) => ({
            ...prev,
            assets: prev.assets.map((a) => (a.id === id ? { ...a, constraints: { ...a.constraints, [key]: value } } : a)),
        }));
        clearFieldError(`assetField-${id}-${key}`);
    };

    const removeAsset = (id) => {
        setForm((prev) => {
            const gone = prev.assets.find((a) => a.id === id);
            return {
                ...prev,
                assets: prev.assets.filter((a) => a.id !== id),
                // tasks that targeted this asset lose their target and must be re-pointed
                tasks: prev.tasks.map((t) =>
                    t.targetType === "ASSET" && t.targetRef === gone?.key ? { ...t, targetType: "", targetRef: "" } : t
                ),
            };
        });
    };

    // ── Task handlers ─────────────────────────────────────────────────────────
    // The type is picked inside each task card; a new task starts as the first type.
    const addTask = (type = registry?.task_types[0]?.value) => {
        const spec = taskSpec(type);
        if (!spec) return;
        setForm((prev) => {
            const key = nextKey(type.toLowerCase(), prev.tasks.map((t) => t.key));
            const draft = { key, type };
            const first = targetOptionsFor(draft, type, prev.tasks, prev.assets)[0];
            const [targetType, targetRef] = first ? first.value.split(":") : ["", ""];
            return { ...prev, tasks: [...prev.tasks, {
                id: key, key, name: uniqueName(spec.label, prev.tasks.map((t) => t.name)),
                type, targetType, targetRef, dependsOn: [],
                config: defaultsFromFields(spec.fields), instructions: "",
            }] };
        });
        clearFieldError("tasks");
    };

    const updateTask = (id, patch) => {
        setForm((prev) => ({ ...prev, tasks: prev.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
        clearFieldError(`task-${id}`);
        clearFieldError(`taskTarget-${id}`);
    };

    const changeTaskType = (id, type) => {
        const spec = taskSpec(type);
        setForm((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) => {
                if (t.id !== id) return t;
                const stillValid = targetOptionsFor(t, type, prev.tasks, prev.assets)
                    .some((o) => o.value === `${t.targetType}:${t.targetRef || ""}`);
                return {
                    ...t, type, config: defaultsFromFields(spec?.fields),
                    ...(stillValid ? {} : { targetType: "", targetRef: "" }),
                };
            }),
        }));
    };

    const setTaskTarget = (id, value) => {
        const [targetType, targetRef] = value ? value.split(":") : ["", ""];
        updateTask(id, { targetType, targetRef: targetRef || "" });
    };

    const toggleTaskDependency = (id, depKey) => {
        setForm((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) => {
                if (t.id !== id) return t;
                const has = t.dependsOn.includes(depKey);
                return { ...t, dependsOn: has ? t.dependsOn.filter((d) => d !== depKey) : [...t.dependsOn, depKey] };
            }),
        }));
    };

    const updateTaskConfigField = (id, key, value) => {
        setForm((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) => (t.id === id ? { ...t, config: { ...t.config, [key]: value } } : t)),
        }));
        clearFieldError(`taskField-${id}-${key}`);
    };

    const removeTask = (id) => {
        setForm((prev) => {
            const gone = prev.tasks.find((t) => t.id === id);
            return {
                ...prev,
                tasks: prev.tasks
                    .filter((t) => t.id !== id)
                    .map((t) => ({
                        ...t,
                        dependsOn: t.dependsOn.filter((d) => d !== gone?.key),
                        ...(t.targetType === "TASK_OUTPUT" && t.targetRef === gone?.key
                            ? { targetType: "", targetRef: "" } : {}),
                    })),
            };
        });
    };

    const updateDataCollection = (field, value) => {
        setForm((prev) => ({
            ...prev,
            dataCollection: { ...prev.dataCollection, [field]: value },
        }));
    };

    const toggleSourceType = (value) => {
        const sources = form.dataCollection.allowedSourceTypes || [];
        updateDataCollection(
            "allowedSourceTypes",
            sources.includes(value) ? sources.filter((s) => s !== value) : [...sources, value]
        );
    };

    // ── Tracks (fair comparison groups, e.g. regional dialect tracks) ──────────
    const addTrack = () => {
        setForm((prev) => ({
            ...prev,
            tracks: [...prev.tracks, { id: Date.now(), name: "", minTeams: 5 }],
        }));
    };

    const updateTrack = (id, field, value) => {
        setForm((prev) => ({
            ...prev,
            tracks: prev.tracks.map((t) => (t.id === id ? { ...t, [field]: value } : t)),
        }));
    };

    const removeTrack = (id) => {
        setForm((prev) => ({ ...prev, tracks: prev.tracks.filter((t) => t.id !== id) }));
    };

    // ── Phases (ordered competition stages) ─────────────────────────────────────
    const addPhase = () => {
        setForm((prev) => ({
            ...prev,
            phases: [...prev.phases, { id: Date.now(), name: "", durationDays: 7, description: "" }],
        }));
    };

    const updatePhase = (id, field, value) => {
        setForm((prev) => ({
            ...prev,
            phases: prev.phases.map((p) => (p.id === id ? { ...p, [field]: value } : p)),
        }));
    };

    const removePhase = (id) => {
        setForm((prev) => ({ ...prev, phases: prev.phases.filter((p) => p.id !== id) }));
    };

    const movePhase = (id, direction) => {
        setForm((prev) => {
            const index = prev.phases.findIndex((p) => p.id === id);
            const swapWith = index + direction;
            if (index < 0 || swapWith < 0 || swapWith >= prev.phases.length) return prev;
            const phases = [...prev.phases];
            [phases[index], phases[swapWith]] = [phases[swapWith], phases[index]];
            return { ...prev, phases };
        });
    };

    const updateLicense = (field, value) => {
        setForm((prev) => ({ ...prev, license: { ...prev.license, [field]: value } }));
    };

    const toggleSkill = (skill) => {
        setForm((prev) => {
            const exists = prev.requiredSkills.includes(skill);
            return {
                ...prev,
                requiredSkills: exists
                    ? prev.requiredSkills.filter((item) => item !== skill)
                    : [...prev.requiredSkills, skill],
            };
        });
    };

    const validateStep = (step = currentStep) => {
        const nextErrors = {};
        const key = wizardSteps[step]?.key;

        if (key === "basic") {
            if (!form.competitionName.trim())
                nextErrors.competitionName = "Competition name is required.";
            if (!form.description.trim())
                nextErrors.description = "Description is required.";
            if (form.startDate && form.endDate && new Date(form.endDate) < new Date(form.startDate))
                nextErrors.endDate = "End date must be after start date.";
            if (form.prizePool !== "" && Number(form.prizePool) < 0)
                nextErrors.prizePool = "Prize pool cannot be negative.";
        }

        // Sample Assets — at least one; unique names; constraints valid per type.
        if (key === "assets") {
            if (!registry) {
                nextErrors.assets = registryError || "Asset types are still loading — try again in a moment.";
            } else {
                if (!form.assets.length) nextErrors.assets = "Add at least one asset to the sample.";
                const seen = new Set();
                form.assets.forEach((a) => {
                    const name = (a.name || "").trim();
                    if (!name) nextErrors[`asset-${a.id}`] = "Every asset needs a name.";
                    else if (seen.has(name.toLowerCase())) nextErrors[`asset-${a.id}`] = `Another asset is already called "${name}".`;
                    seen.add(name.toLowerCase());
                    validateFieldValues(assetSpec(a.type)?.fields || [], a.constraints, `assetField-${a.id}`, nextErrors, name || "Asset");
                    const c = a.constraints || {};
                    if (c.min_words !== undefined && c.max_words !== undefined && c.min_words !== "" && c.max_words !== "" && Number(c.min_words) > Number(c.max_words))
                        nextErrors[`assetField-${a.id}-min_words`] = "Minimum words cannot exceed maximum words.";
                    if (c.min_duration_seconds !== undefined && c.max_duration_seconds !== undefined && c.min_duration_seconds !== "" && c.max_duration_seconds !== "" && Number(c.min_duration_seconds) > Number(c.max_duration_seconds))
                        nextErrors[`assetField-${a.id}-min_duration_seconds`] = "Minimum duration cannot exceed maximum duration.";
                });
            }
        }

        // Tasks — each has a valid target, valid config, and no circular dependency.
        if (key === "tasks") {
            if (!registry) {
                nextErrors.tasks = registryError || "Task types are still loading — try again in a moment.";
            } else {
                if (!form.tasks.length) nextErrors.tasks = "Add at least one task.";
                const seen = new Set();
                form.tasks.forEach((t) => {
                    const name = (t.name || "").trim();
                    if (!name) nextErrors[`task-${t.id}`] = "Every task needs a name.";
                    else if (seen.has(name.toLowerCase())) nextErrors[`task-${t.id}`] = `Another task is already called "${name}".`;
                    seen.add(name.toLowerCase());

                    const valid = targetOptionsFor(t).some((o) => o.value === `${t.targetType}:${t.targetRef || ""}`);
                    if (!t.targetType) nextErrors[`taskTarget-${t.id}`] = "Choose what this task applies to.";
                    else if (!valid) nextErrors[`taskTarget-${t.id}`] = "This target no longer exists or is not compatible with this task type.";

                    validateFieldValues(taskSpec(t.type)?.fields || [], t.config, `taskField-${t.id}`, nextErrors, name || "Task");
                    const c = t.config || {};
                    if (c.multi_label && c.min_labels !== undefined && c.max_labels !== undefined && c.min_labels !== "" && c.max_labels !== "" && Number(c.min_labels) > Number(c.max_labels))
                        nextErrors[`taskField-${t.id}-min_labels`] = "Minimum labels cannot exceed maximum labels.";
                    if (c.min_words !== undefined && c.max_words !== undefined && c.min_words !== "" && c.max_words !== "" && Number(c.min_words) > Number(c.max_words))
                        nextErrors[`taskField-${t.id}-min_words`] = "Minimum words cannot exceed maximum words.";
                });
                const cycle = findTaskCycle(form.tasks);
                if (cycle) {
                    const nameOf = (k) => form.tasks.find((t) => t.key === k)?.name || k;
                    nextErrors.tasks = `Circular task dependency: ${cycle.map(nameOf).join(" → ")}`;
                }
            }
        }

        // Data Collection — a contributed instance is a sample, so its inputs
        // are the Sample Assets (nothing to validate for them here).
        if (key === "dataCollection") {
            const dc = form.dataCollection;
            if (!Array.isArray(dc.allowedSourceTypes) || !dc.allowedSourceTypes.length)
                nextErrors.allowedSourceTypes = "Select at least one allowed data source.";
            if (!dc.annotatorsPerInstance || Number(dc.annotatorsPerInstance) < 1)
                nextErrors.annotatorsPerInstance = "At least one annotator per instance is required.";
        }

        if (key === "tracks") {
            if (!form.tracks.length)
                nextErrors.tracks = "Add at least one track, or turn off Tracks in Basic Info.";
            form.tracks.forEach((t) => {
                if (!t.name.trim())
                    nextErrors[`trackName-${t.id}`] = "Track name is required.";
                if (!t.minTeams || Number(t.minTeams) < 1)
                    nextErrors[`trackMin-${t.id}`] = "Minimum teams must be at least 1.";
            });
        }

        if (key === "phases") {
            if (form.phases.length < 1)
                nextErrors.phases = "Add at least one phase.";
            form.phases.forEach((p) => {
                if (!p.name.trim())
                    nextErrors[`phaseName-${p.id}`] = "Phase name is required.";
                if (!p.durationDays || Number(p.durationDays) <= 0)
                    nextErrors[`phaseDuration-${p.id}`] = "Duration must be greater than 0 days.";
            });
        }

        if (key === "license") {
            if (!form.license.version.trim())
                nextErrors.licenseVersion = "License version is required.";
            if (!form.license.text.trim())
                nextErrors.licenseText = "License text is required so participants can accept it before contributing data.";
        }

        if (key === "evaluation") {
            if (!form.primaryMetric)
                nextErrors.primaryMetric = "Primary metric is required.";
            if (form.participantSourcedData && form.evaluationMode === "data_quality_plus_model") {
                const total = Number(form.dataQualityWeight) + Number(form.modelWeight);
                if (total !== 100)
                    nextErrors.weightSplit = `Data quality + model weights must add up to 100 (currently ${total}).`;
                if (form.publicTestFraction !== "" && (Number(form.publicTestFraction) < 0 || Number(form.publicTestFraction) > 100))
                    nextErrors.publicTestFraction = "Held-out test fraction must be between 0 and 100.";
                if (!form.winnersPerTrack || Number(form.winnersPerTrack) < 1)
                    nextErrors.winnersPerTrack = form.tracksEnabled
                        ? "At least 1 winner per track is required."
                        : "At least 1 winner is required.";
            }
        }

        if (key === "rules") {
            if (form.maxTeams !== "" && Number(form.maxTeams) < 0)
                nextErrors.maxTeams = "Maximum teams cannot be negative.";
            if (form.minMembers !== "" && Number(form.minMembers) <= 0)
                nextErrors.minMembers = "Minimum members must be greater than 0.";
            if (form.maxMembers !== "" && Number(form.maxMembers) <= 0)
                nextErrors.maxMembers = "Maximum members must be greater than 0.";
            if (form.minMembers !== "" && form.maxMembers !== "" && Number(form.minMembers) > Number(form.maxMembers))
                nextErrors.maxMembers = "Max members must be greater than min members.";
            if (form.maxSubmissionsPerDay !== "" && Number(form.maxSubmissionsPerDay) <= 0)
                nextErrors.maxSubmissionsPerDay = "Max submissions per day must be greater than 0.";
            if (form.mergeDeadline && form.startDate && new Date(form.mergeDeadline) < new Date(form.startDate))
                nextErrors.mergeDeadline = "Merge deadline cannot be before start date.";
            if (form.mergeDeadline && form.endDate && new Date(form.mergeDeadline) > new Date(form.endDate))
                nextErrors.mergeDeadline = "Merge deadline cannot be after end date.";
        }

        if (key === "evaluation" && !form.phasesEnabled) {
            if (form.validationDate && form.startDate && new Date(form.validationDate) < new Date(form.startDate))
                nextErrors.validationDate = "Validation date cannot be before start date.";
            if (form.validationDate && form.endDate && new Date(form.validationDate) > new Date(form.endDate))
                nextErrors.validationDate = "Validation date cannot be after competition end date.";
            if (form.freezeDate && form.startDate && new Date(form.freezeDate) < new Date(form.startDate))
                nextErrors.freezeDate = "Freeze date cannot be before start date.";
            if (form.freezeDate && form.validationDate && new Date(form.freezeDate) < new Date(form.validationDate))
                nextErrors.freezeDate = "Freeze date cannot be before validation date.";
            if (form.freezeDate && form.endDate && new Date(form.freezeDate) > new Date(form.endDate))
                nextErrors.freezeDate = "Freeze date cannot be after competition end date.";
        }

        setErrors(nextErrors);
        return Object.keys(nextErrors).length === 0;
    };

    const buildPayload = () => {
        const taskConfig = {};
        const promptLines = listFromValue(form.prompts);
        if (promptLines.length) taskConfig.prompts = promptLines;

        // Each capability rides as its own flat key inside task_config (which
        // is stored as the competition's dataset_config JSON) — independent of
        // each other. (Assets and tasks are sent separately, below.)
        if (form.tracksEnabled) {
            taskConfig.tracks_enabled = true;
            taskConfig.tracks = form.tracks.map((t) => ({
                id: t.id, name: t.name.trim(), minTeams: Number(t.minTeams) || 1,
            }));
        }

        if (form.phasesEnabled) {
            taskConfig.phases_enabled = true;
            taskConfig.phases = form.phases.map((p, i) => ({
                id: p.id,
                order: i + 1,
                name: p.name.trim(),
                durationDays: Number(p.durationDays) || 1,
                description: p.description || "",
            }));
        }

        if (form.participantSourcedData) {
            taskConfig.data_collection_enabled = true;
            taskConfig.data_collection = {
                allowed_source_types: form.dataCollection.allowedSourceTypes,
                require_public_source_provenance: !!form.dataCollection.requireProvenance,
                annotators_per_instance: Number(form.dataCollection.annotatorsPerInstance) || 1,
                adjudication_enabled: !!form.dataCollection.adjudicationEnabled,
            };
            taskConfig.license = {
                version: form.license.version.trim(),
                text: form.license.text,
            };
        }

        // Evaluation scoring mode always rides along; "standard" is a no-op.
        taskConfig.evaluation_scoring = {
            mode: form.evaluationMode,
            data_quality_weight: form.evaluationMode === "data_quality_plus_model" ? Number(form.dataQualityWeight) : null,
            model_weight: form.evaluationMode === "data_quality_plus_model" ? Number(form.modelWeight) : null,
            per_team_baseline_enabled: form.evaluationMode === "data_quality_plus_model" ? !!form.perTeamBaselineEnabled : false,
            public_test_fraction: form.evaluationMode === "data_quality_plus_model" ? Number(form.publicTestFraction) : null,
            winners_per_track: form.evaluationMode === "data_quality_plus_model" ? Number(form.winnersPerTrack) : null,
        };

        return {
            competition_name: form.competitionName,
            // No competition type: a competition is its assets + tasks.
            assets: form.assets.map((a) => ({
                key: a.key,
                name: a.name.trim(),
                type: a.type,
                required: a.required,
                constraints: serializeFieldValues(assetSpec(a.type)?.fields || [], a.constraints),
            })),
            tasks: form.tasks.map((t) => ({
                key: t.key,
                name: t.name.trim(),
                type: t.type,
                target: { type: t.targetType, ref: t.targetType === "SAMPLE" ? null : (t.targetRef || null) },
                config: serializeFieldValues(taskSpec(t.type)?.fields || [], t.config),
                depends_on: t.dependsOn,
                instructions: t.instructions.trim() || null,
            })),
            description: form.description,
            start_date: form.startDate || null,
            end_date: form.endDate || null,
            prize_pool: form.prizePool === "" ? null : Number(form.prizePool),

            primary_metric: form.primaryMetric || null,
            secondary_metric: form.secondaryMetric || null,

            max_teams: form.maxTeams === "" ? null : Number(form.maxTeams),
            min_members: form.minMembers === "" ? null : Number(form.minMembers),
            max_members: form.maxMembers === "" ? null : Number(form.maxMembers),
            merge_deadline: form.mergeDeadline || null,
            required_skills: form.requiredSkills,
            max_submissions_per_day: form.maxSubmissionsPerDay === "" ? null : Number(form.maxSubmissionsPerDay),
            allow_external_data: form.allowExternalData,
            allow_pretrained_models: form.allowPretrainedModels,
            require_code_sharing: form.requireCodeSharing,
            additional_rules: form.additionalRules || null,

            complexity_level: form.complexityLevel,

            // Phases, when enabled, drives the timeline. Otherwise these two
            // plain cutoff dates (set in the Evaluation step) are the only
            // extra timeline info the competition carries.
            validation_date: form.phasesEnabled ? null : (form.validationDate || null),
            freeze_date: form.phasesEnabled ? null : (form.freezeDate || null),

            // Whichever independent
            // capabilities (tracks / phases / data collection) are turned on.
            task_config: taskConfig,
            join_method: form.joinMethod || "auto",
            tracks_enabled: form.tracksEnabled,
            phases_enabled: form.phasesEnabled,
            data_collection_enabled: form.participantSourcedData,
        };
    };

    const saveDraft = async () => {
        if (isEditMode) return;

        try {
            setSubmitting(true);
            const token = await getFreshToken();
            if (!token) { alert("You must login first."); navigate("/login"); return; }

            const res = await fetch("http://127.0.0.1:8000/competitions/draft", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(buildPayload()),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data, null, 2));

            const id = data.id || data.competition_id;
            if (id) setSavedCompetitionId(id);

            alert("Draft saved successfully");
        } catch (error) {
            console.error(error);
            alert(error.message);
        } finally {
            setSubmitting(false);
        }
    };

    const submitCompetition = async () => {
        for (let step = 0; step < wizardSteps.length; step++) {
            if (!validateStep(step)) {
                setCurrentStep(step);
                return;
            }
        }

        try {
            setSubmitting(true);
            const token = await getFreshToken();
            if (!token) { alert("You must login first."); navigate("/login"); return; }

            const url = isEditMode
                ? `http://127.0.0.1:8000/competitions/${competitionId}/update`
                : savedCompetitionId
                    ? `http://127.0.0.1:8000/competitions/${savedCompetitionId}/update`
                    : "http://127.0.0.1:8000/competitions/create";

            const method = isEditMode || savedCompetitionId ? "PUT" : "POST";

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(buildPayload()),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data, null, 2));

            alert(isEditMode ? "Competition updated successfully" : "Competition created successfully");

            if (isEditMode) {
                navigate(`/competitions/${competitionId}/organizer`, { state: { refreshed: true } });
            } else {
                navigate("/competitions", { state: { refreshAll: true } });
            }
        } catch (error) {
            console.error(error);
            alert(error.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleCancel = () => {
        if (isEditMode) navigate(`/competitions/${competitionId}/organizer`);
        else navigate("/competitions");
    };

    const handleNext = () => {
        if (!validateStep(currentStep)) return;
        if (currentStep < wizardSteps.length - 1) setCurrentStep((prev) => prev + 1);
    };

    const handlePrevious = () => {
        if (currentStep > 0) setCurrentStep((prev) => prev - 1);
    };

    const ErrorMessage = ({ name }) => {
        if (!errors[name]) return null;
        return <span className="field-error">{errors[name]}</span>;
    };

    // ── Render helpers ─────────────────────────────────────────────────────────

    const renderBasicInfo = () => (
        <div className="create-card">
            <div className="create-section">
                <label>Competition Name <span className="required-star">*</span></label>
                <input
                    className={errors.competitionName ? "input-error" : ""}
                    type="text"
                    placeholder="e.g., Semantic Drift v4.2"
                    value={form.competitionName}
                    onChange={(e) => updateField("competitionName", e.target.value)}
                />
                <ErrorMessage name="competitionName" />
            </div>

            <div className="create-section">
                <label>Description <span className="required-star">*</span></label>
                <textarea
                    className={errors.description ? "input-error" : ""}
                    rows="3"
                    placeholder="Describe the competition goal, task, and expected output..."
                    value={form.description}
                    onChange={(e) => updateField("description", e.target.value)}
                />
                <ErrorMessage name="description" />
            </div>

            <div className="create-two-col">
                <div className="create-section">
                    <label>Start Date</label>
                    <input
                        className={errors.startDate ? "input-error" : ""}
                        type="date"
                        value={form.startDate}
                        onChange={(e) => updateField("startDate", e.target.value)}
                    />
                    <ErrorMessage name="startDate" />
                </div>

                <div className="create-section">
                    <label>End Date</label>
                    <input
                        className={errors.endDate ? "input-error" : ""}
                        type="date"
                        value={form.endDate}
                        onChange={(e) => updateField("endDate", e.target.value)}
                    />
                    <ErrorMessage name="endDate" />
                </div>
            </div>

            <div className="create-section">
                <label>Prize Pool (USD)</label>
                <input
                    className={errors.prizePool ? "input-error" : ""}
                    type="number"
                    placeholder="e.g., 12500"
                    value={form.prizePool}
                    onChange={(e) => updateField("prizePool", e.target.value)}
                />
                <small>Optional. Leave empty if there is no prize.</small>
                <ErrorMessage name="prizePool" />
            </div>

            <div className="section-header-row">
                <div>
                    <h4 style={{ margin: 0 }}>Platform Capabilities</h4>
                    <p className="create-card-subtitle" style={{ margin: 0 }}>
                        Turn on whichever of these this competition needs. Each is independent —
                        use any combination.
                    </p>
                </div>
            </div>

            <div className="toggle-row">
                <div>
                    <strong>Tracks</strong>
                    <p>
                        Split participants into separate comparison groups (region, language,
                        category...), each with its own minimum team count to be viable.
                    </p>
                </div>
                <label className="switch">
                    <input
                        type="checkbox"
                        checked={form.tracksEnabled}
                        onChange={(e) => updateField("tracksEnabled", e.target.checked)}
                    />
                    <span className="slider"></span>
                </label>
            </div>

            <div className="toggle-row">
                <div>
                    <strong>Phases</strong>
                    <p>
                        Replace the single start/end date with an ordered, named timeline
                        (e.g. Data Collection → Training → Leaderboard).
                    </p>
                </div>
                <label className="switch">
                    <input
                        type="checkbox"
                        checked={form.phasesEnabled}
                        onChange={(e) => updateField("phasesEnabled", e.target.checked)}
                    />
                    <span className="slider"></span>
                </label>
            </div>

            <div className="toggle-row">
                <div>
                    <strong>Data Collection</strong>
                    <p>
                        Participants source, record, or adapt their own raw data instead of
                        using a dataset you provide. Adds format limits, allowed sources, the
                        annotation protocol, and a mandatory data usage license. You won't need
                        to upload a dataset — the data collected from participants is what gets
                        used for training and evaluation.
                    </p>
                </div>
                <label className="switch">
                    <input
                        type="checkbox"
                        checked={form.participantSourcedData}
                        onChange={(e) => updateField("participantSourcedData", e.target.checked)}
                    />
                    <span className="slider"></span>
                </label>
            </div>
        </div>
    );

    // ── Generic option form, driven by the registry's field specs ──────────────
    const renderFields = (fields, values, onChange, errKey) => (
        <div className="create-two-col">
            {fields.filter((f) => isFieldVisible(f, fields, values)).map((f) => {
                const v = values?.[f.key];
                const errName = `${errKey}-${f.key}`;
                const wide = f.type === "string_list" || f.type === "multi_select" || f.type === "text";
                const label = <label>{f.label}{f.required && <span className="required-star"> *</span>}</label>;
                let control;
                if (f.type === "boolean") {
                    control = (
                        <label className="switch">
                            <input type="checkbox" checked={!!v} onChange={(e) => onChange(f.key, e.target.checked)} />
                            <span className="slider"></span>
                        </label>
                    );
                } else if (f.type === "select") {
                    control = (
                        <select value={v ?? ""} onChange={(e) => onChange(f.key, e.target.value)}>
                            {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                    );
                } else if (f.type === "multi_select") {
                    const cur = Array.isArray(v) ? v : [];
                    control = (
                        <div className="tc-radio-group">
                            {f.options.map((o) => {
                                const on = cur.includes(o);
                                return (
                                    <label key={o} className={`tc-radio-option ${on ? "selected" : ""}`}>
                                        <input type="checkbox" checked={on}
                                            onChange={() => onChange(f.key, on ? cur.filter((x) => x !== o) : [...cur, o])} />
                                        <div><strong>{o}</strong></div>
                                    </label>
                                );
                            })}
                        </div>
                    );
                } else if (f.type === "string_list" || f.type === "text") {
                    control = (
                        <textarea
                            rows={4}
                            className={errors[errName] ? "input-error" : ""}
                            placeholder={f.help || ""}
                            value={Array.isArray(v) ? v.join("\n") : (v ?? "")}
                            onChange={(e) => onChange(f.key, e.target.value)}
                        />
                    );
                } else if (f.type === "integer" || f.type === "number") {
                    control = (
                        <input type="number" className={errors[errName] ? "input-error" : ""}
                            min={f.min} max={f.max} step={f.type === "integer" ? 1 : "any"}
                            placeholder={f.placeholder || ""} value={v ?? ""}
                            onChange={(e) => onChange(f.key, e.target.value)} />
                    );
                } else {
                    control = (
                        <input type="text" className={errors[errName] ? "input-error" : ""}
                            placeholder={f.placeholder || ""} value={v ?? ""}
                            onChange={(e) => onChange(f.key, e.target.value)} />
                    );
                }
                return (
                    <div key={f.key} className="create-section" style={wide ? { gridColumn: "1 / -1" } : undefined}>
                        {label}
                        {control}
                        {f.help && f.type !== "string_list" && f.type !== "text" && (
                            <p className="create-card-subtitle" style={{ margin: "4px 0 0" }}>{f.help}</p>
                        )}
                        <ErrorMessage name={errName} />
                    </div>
                );
            })}
        </div>
    );

    const monoBox = {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13,
        whiteSpace: "pre", padding: "10px 14px", borderRadius: 8,
        background: "rgba(127,127,127,0.10)", overflowX: "auto", margin: "0 0 16px",
    };

    // ── Sample Assets step ────────────────────────────────────────────────────
    const renderAssets = () => {
        if (!registry) {
            return (
                <div className="create-card">
                    <p className="create-card-subtitle">{registryError || "Loading asset types…"}</p>
                    <ErrorMessage name="assets" />
                </div>
            );
        }
        const tree = form.assets.length
            ? "Sample\n" + form.assets.map((a, i) => `${i === form.assets.length - 1 ? "└──" : "├──"} ${a.name || "(unnamed)"}  [${a.type}]`).join("\n")
            : "Sample\n(no assets yet)";

        return (
            <div className="create-card">
                <div className="section-header-row">
                    <div>
                        <h3 className="create-card-title" style={{ margin: 0 }}>Sample Assets</h3>
                        <p className="create-card-subtitle" style={{ margin: 0 }}>
                            Define what one sample is made of. A sample has one or more assets — add any
                            number and combination (e.g. two audio clips and a text). Each asset has its own constraints.
                        </p>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {registry.asset_types.map((t) => (
                            <button key={t.value} type="button" className="soft-action-btn" onClick={() => addAsset(t.value)}>
                                + {t.label}
                            </button>
                        ))}
                    </div>
                </div>

                {form.legacyTaskType && (
                    <p className="create-card-subtitle" style={{ marginTop: 12 }}>
                        This competition was created with the old "{form.legacyTaskType}" type, which no longer
                        exists. Define its assets and tasks here to move it to the new model.
                    </p>
                )}

                <ErrorMessage name="assets" />
                <pre style={monoBox}>{tree}</pre>

                {form.assets.map((asset, idx) => {
                    const spec = assetSpec(asset.type);
                    return (
                        <div key={asset.id} className="inner-panel">
                            <div className="create-two-col">
                                <div className="create-section">
                                    <label>Asset {idx + 1} name <span className="required-star">*</span></label>
                                    <input type="text" className={errors[`asset-${asset.id}`] ? "input-error" : ""}
                                        placeholder="e.g., Recording" value={asset.name}
                                        onChange={(e) => updateAsset(asset.id, { name: e.target.value })} />
                                    <ErrorMessage name={`asset-${asset.id}`} />
                                </div>
                                <div className="create-section">
                                    <label>Type</label>
                                    <select value={asset.type} onChange={(e) => changeAssetType(asset.id, e.target.value)}>
                                        {registry.asset_types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                                    </select>
                                </div>
                            </div>

                            {spec && renderFields(spec.fields, asset.constraints,
                                (k, v) => updateAssetConstraint(asset.id, k, v), `assetField-${asset.id}`)}

                            <div className="toggle-row">
                                <div>
                                    <strong>Required</strong>
                                    <p>Every sample must include this asset.</p>
                                </div>
                                <label className="switch">
                                    <input type="checkbox" checked={asset.required}
                                        onChange={(e) => updateAsset(asset.id, { required: e.target.checked })} />
                                    <span className="slider"></span>
                                </label>
                            </div>

                            {form.assets.length > 1 && (
                                <div className="create-section" style={{ justifyContent: "flex-end" }}>
                                    <button type="button" className="remove-btn" onClick={() => removeAsset(asset.id)}>
                                        Remove asset
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}

                <div className="create-section">
                    <label>Source prompts (optional)</label>
                    <textarea rows={4} placeholder="One per line — sentences or texts shown to contributors"
                        value={form.prompts} onChange={(e) => updateField("prompts", e.target.value)} />
                </div>
            </div>
        );
    };

    // ── Tasks step ────────────────────────────────────────────────────────────
    const renderTasks = () => {
        if (!registry) {
            return (
                <div className="create-card">
                    <p className="create-card-subtitle">{registryError || "Loading task types…"}</p>
                    <ErrorMessage name="tasks" />
                </div>
            );
        }
        const labelOf = (t) => {
            if (t.targetType === "ASSET") return form.assets.find((a) => a.key === t.targetRef)?.name || "?";
            if (t.targetType === "TASK_OUTPUT") return `output of ${form.tasks.find((x) => x.key === t.targetRef)?.name || "?"}`;
            if (t.targetType === "SAMPLE") return "whole sample";
            return "?";
        };
        const flow = form.tasks.length
            ? form.tasks.map((t) => `${t.name || t.key}  ←  ${labelOf(t)}`).join("\n")
            : "(no tasks yet)";

        return (
            <div className="create-card">
                <div className="section-header-row">
                    <div>
                        <h3 className="create-card-title" style={{ margin: 0 }}>Tasks</h3>
                        <p className="create-card-subtitle" style={{ margin: 0 }}>
                            Define what contributors do on a sample. Each task targets one asset, the whole
                            sample, or the output of another task (e.g. Transcription → NER).
                        </p>
                    </div>
                    <button type="button" className="soft-action-btn" onClick={() => addTask()}>
                        + Add Task
                    </button>
                </div>

                <ErrorMessage name="tasks" />
                <pre style={monoBox}>{flow}</pre>

                {form.tasks.map((task, idx) => {
                    const spec = taskSpec(task.type);
                    const options = targetOptionsFor(task);
                    const depCandidates = form.tasks.filter(
                        (o) => o.key !== task.key && !dependsTransitively(form.tasks, o.key, task.key)
                    );
                    const implicit = task.targetType === "TASK_OUTPUT" ? task.targetRef : null;
                    return (
                        <div key={task.id} className="inner-panel">
                            <div className="create-two-col">
                                <div className="create-section">
                                    <label>Task {idx + 1} name <span className="required-star">*</span></label>
                                    <input type="text" className={errors[`task-${task.id}`] ? "input-error" : ""}
                                        value={task.name} onChange={(e) => updateTask(task.id, { name: e.target.value })} />
                                    <ErrorMessage name={`task-${task.id}`} />
                                </div>
                                <div className="create-section">
                                    <label>Task type</label>
                                    <select value={task.type} onChange={(e) => changeTaskType(task.id, e.target.value)}>
                                        {registry.task_types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div className="create-section">
                                <label>Applies to <span className="required-star">*</span></label>
                                <select className={errors[`taskTarget-${task.id}`] ? "input-error" : ""}
                                    value={`${task.targetType}:${task.targetRef || ""}`}
                                    onChange={(e) => setTaskTarget(task.id, e.target.value === ":" ? "" : e.target.value)}>
                                    <option value=":">Select target…</option>
                                    {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                                <p className="create-card-subtitle" style={{ margin: "4px 0 0" }}>
                                    {spec?.description} Accepts: {spec?.accepts.map((a) => (a === "sample" ? "whole sample" : a)).join(", ")}.
                                </p>
                                <ErrorMessage name={`taskTarget-${task.id}`} />
                            </div>

                            {depCandidates.length > 0 && (
                                <div className="create-section">
                                    <label>Must wait for (optional)</label>
                                    <div className="tc-radio-group">
                                        {depCandidates.map((o) => {
                                            const forced = implicit === o.key;
                                            const on = forced || task.dependsOn.includes(o.key);
                                            return (
                                                <label key={o.key} className={`tc-radio-option ${on ? "selected" : ""}`}
                                                    title={forced ? "Already required because this task uses its output" : ""}>
                                                    <input type="checkbox" checked={on} disabled={forced}
                                                        onChange={() => toggleTaskDependency(task.id, o.key)} />
                                                    <div><strong>{o.name || o.key}</strong></div>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {spec && renderFields(spec.fields, task.config,
                                (k, v) => updateTaskConfigField(task.id, k, v), `taskField-${task.id}`)}

                            <div className="create-section">
                                <label>Instructions for contributors (optional)</label>
                                <textarea rows={2} value={task.instructions}
                                    onChange={(e) => updateTask(task.id, { instructions: e.target.value })} />
                            </div>

                            <div className="create-section" style={{ justifyContent: "flex-end" }}>
                                <button type="button" className="remove-btn" onClick={() => removeTask(task.id)}>
                                    Remove task
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    // Read-only: the inputs of a contributed instance ARE the sample assets.
    const renderInstanceInputsSummary = () => (
        <div className="create-section">
            <h4 style={{ margin: 0 }}>Instance Inputs</h4>
            <p className="create-card-subtitle" style={{ margin: "4px 0 8px" }}>
                A contributed instance is a sample, so it carries exactly the Sample Assets you defined. Edit them in the Sample Assets step.
            </p>
            <pre style={monoBox}>
                {form.assets.length
                    ? form.assets.map((a) => {
                        const c = a.constraints || {};
                        const lim = a.type === "AUDIO" ? `max ${c.max_duration_seconds ?? "?"}s` : `max ${c.max_words ?? "?"} words`;
                        return `${a.name || "(unnamed)"}  ·  ${a.type}  ·  ${lim}`;
                    }).join("\n")
                    : "(no assets defined)"}
            </pre>
        </div>
    );

    // ── Data Collection step ────────────────────────────────────────────────────
    // Turn this on whenever contributors source, record, or adapt their own raw
    // data instead of using an organizer-provided dataset.
    const renderDataCollection = () => {
        const dc = form.dataCollection;

        return (
            <div className="create-card">
                <h3 className="create-card-title">Data Collection</h3>
                <p className="create-card-subtitle">
                    Contributors source, record, or adapt their own data — these rules keep
                    every submitted instance comparable and, if you plan to publish the
                    resulting dataset, legally sound.
                </p>

                {renderInstanceInputsSummary()}

                <div className="create-section">
                    <label>Allowed Data Sources <span className="required-star">*</span></label>
                    <div className="tc-radio-group">
                        {SOURCE_TYPE_OPTIONS.map((opt) => {
                            const selected = (dc.allowedSourceTypes || []).includes(opt.value);
                            return (
                                <label key={opt.value} className={`tc-radio-option ${selected ? "selected" : ""}`}>
                                    <input type="checkbox" checked={selected} onChange={() => toggleSourceType(opt.value)} />
                                    <div><strong>{opt.label}</strong></div>
                                </label>
                            );
                        })}
                    </div>
                    <ErrorMessage name="allowedSourceTypes" />
                </div>

                <div className="toggle-row">
                    <div>
                        <strong>Require Public Source Provenance</strong>
                        <p>Contributors must record a source link/timestamp for anything not self-recorded, so origin can be verified or removed on request.</p>
                    </div>
                    <label className="switch">
                        <input
                            type="checkbox"
                            checked={!!dc.requireProvenance}
                            onChange={(e) => updateDataCollection("requireProvenance", e.target.checked)}
                        />
                        <span className="slider"></span>
                    </label>
                </div>

                <div className="inner-panel">
                    <h4>Annotation Protocol</h4>
                    <div className="create-two-col">
                        <div className="create-section">
                            <label>Annotators per Instance <span className="required-star">*</span></label>
                            <input
                                className={errors.annotatorsPerInstance ? "input-error" : ""}
                                type="number" min="1" max="5"
                                value={dc.annotatorsPerInstance ?? 2}
                                onChange={(e) => updateDataCollection("annotatorsPerInstance", parseInt(e.target.value, 10) || 1)}
                            />
                            <small>Members of the same team who must independently label each instance.</small>
                            <ErrorMessage name="annotatorsPerInstance" />
                        </div>
                        <div className="create-section" style={{ justifyContent: "center" }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                                <span className="switch">
                                    <input
                                        type="checkbox"
                                        checked={!!dc.adjudicationEnabled}
                                        onChange={(e) => updateDataCollection("adjudicationEnabled", e.target.checked)}
                                    />
                                    <span className="slider" />
                                </span>
                                <div>
                                    <strong>Adjudication on Disagreement</strong>
                                    <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
                                        A third same-team annotator resolves label disagreements.
                                    </p>
                                </div>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // ── Tracks step (independent — split participants into comparison groups) ──
    const renderTracks = () => (
        <div className="create-card">
            <div className="section-header-row">
                <div>
                    <h3 className="create-card-title">Tracks</h3>
                    <p className="create-card-subtitle">
                        Split teams into fair comparison groups (region, language, category...).
                        A track that doesn't reach its minimum team count by the registration
                        deadline should be dropped from the competition rather than merged.
                    </p>
                </div>
                <button type="button" className="soft-action-btn" onClick={addTrack}>
                    + Add Track
                </button>
            </div>

            <ErrorMessage name="tracks" />

            {form.tracks.length === 0 && (
                <div className="tc-empty">
                    <p>No tracks yet. Add at least one — e.g. "Algiers", "Oran", "Constantine".</p>
                </div>
            )}

            {form.tracks.map((track, idx) => (
                <div key={track.id} className="inner-panel">
                    <div className="create-two-col">
                        <div className="create-section">
                            <label>Track {idx + 1} Name <span className="required-star">*</span></label>
                            <input
                                className={errors[`trackName-${track.id}`] ? "input-error" : ""}
                                type="text"
                                placeholder="e.g., Central / Algiers"
                                value={track.name}
                                onChange={(e) => updateTrack(track.id, "name", e.target.value)}
                            />
                            <ErrorMessage name={`trackName-${track.id}`} />
                        </div>
                        <div className="create-section">
                            <label>Minimum Teams <span className="required-star">*</span></label>
                            <input
                                className={errors[`trackMin-${track.id}`] ? "input-error" : ""}
                                type="number" min="1"
                                value={track.minTeams}
                                onChange={(e) => updateTrack(track.id, "minTeams", parseInt(e.target.value, 10) || 1)}
                            />
                            <small>Track is dropped from the competition if it doesn't reach this many teams.</small>
                            <ErrorMessage name={`trackMin-${track.id}`} />
                        </div>
                    </div>
                    <button type="button" className="remove-btn" onClick={() => removeTrack(track.id)}>
                        Remove Track
                    </button>
                </div>
            ))}
        </div>
    );

    // ── Phases step (replaces fixed Milestones when this capability is on) ─────
    const renderPhases = () => (
        <div className="create-card">
            <div className="section-header-row">
                <div>
                    <h3 className="create-card-title">Competition Phases</h3>
                    <p className="create-card-subtitle">
                        Define the ordered stages participants move through (e.g. Data Collection
                        → organizer break → Model Training). The platform drives what each page
                        shows from this phase state, rather than hard-coded dates.
                    </p>
                </div>
                <button type="button" className="soft-action-btn" onClick={addPhase}>
                    + Add Phase
                </button>
            </div>

            <ErrorMessage name="phases" />

            {form.phases.map((phase, idx) => (
                <div key={phase.id} className="inner-panel">
                    <div className="create-two-col">
                        <div className="create-section">
                            <label>Phase {idx + 1} Name <span className="required-star">*</span></label>
                            <input
                                className={errors[`phaseName-${phase.id}`] ? "input-error" : ""}
                                type="text"
                                placeholder="e.g., Data Collection & Annotation"
                                value={phase.name}
                                onChange={(e) => updatePhase(phase.id, "name", e.target.value)}
                            />
                            <ErrorMessage name={`phaseName-${phase.id}`} />
                        </div>
                        <div className="create-section">
                            <label>Duration (days) <span className="required-star">*</span></label>
                            <input
                                className={errors[`phaseDuration-${phase.id}`] ? "input-error" : ""}
                                type="number" min="1"
                                value={phase.durationDays}
                                onChange={(e) => updatePhase(phase.id, "durationDays", parseInt(e.target.value, 10) || 1)}
                            />
                            <ErrorMessage name={`phaseDuration-${phase.id}`} />
                        </div>
                    </div>
                    <div className="create-section">
                        <label>Description</label>
                        <textarea
                            rows={2}
                            placeholder="What happens during this phase, and what freezes at the end of it?"
                            value={phase.description}
                            onChange={(e) => updatePhase(phase.id, "description", e.target.value)}
                        />
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" className="soft-action-btn" disabled={idx === 0} onClick={() => movePhase(phase.id, -1)}>↑ Move Up</button>
                        <button type="button" className="soft-action-btn" disabled={idx === form.phases.length - 1} onClick={() => movePhase(phase.id, 1)}>↓ Move Down</button>
                        <button type="button" className="remove-btn" onClick={() => removePhase(phase.id)}>Remove Phase</button>
                    </div>
                </div>
            ))}
        </div>
    );

    // ── License step (mandatory data-usage license when Data Collection is on) ─
    const renderLicense = () => (
        <div className="create-card">
            <h3 className="create-card-title">Data Usage License</h3>
            <p className="create-card-subtitle">
                Since contributed data may be published as part of a benchmark, every
                participant must accept this license, by version, before contributing.
                Store the version they accepted — don't just store a boolean — since you
                may need to update the license later.
            </p>

            <div className="create-section">
                <label>License Version <span className="required-star">*</span></label>
                <input
                    className={errors.licenseVersion ? "input-error" : ""}
                    type="text"
                    placeholder="e.g., v1.0"
                    value={form.license.version}
                    onChange={(e) => updateLicense("version", e.target.value)}
                />
                <ErrorMessage name="licenseVersion" />
            </div>

            <div className="create-section">
                <label>License Text <span className="required-star">*</span></label>
                <textarea
                    rows={10}
                    className={errors.licenseText ? "input-error" : ""}
                    placeholder="Describe what happens to contributed data: does it become part of a public benchmark? Do contributors retain any rights? Can they still download their own annotated data?"
                    value={form.license.text}
                    onChange={(e) => updateLicense("text", e.target.value)}
                />
                <ErrorMessage name="licenseText" />
            </div>

            <div className="toggle-row">
                <div>
                    <strong>Acceptance is Mandatory</strong>
                    <p>Participants cannot contribute data until they accept this license version. This is always required whenever Data Collection is on.</p>
                </div>
                <label className="switch">
                    <input type="checkbox" checked readOnly disabled />
                    <span className="slider"></span>
                </label>
            </div>
        </div>
    );

    const renderEvaluation = () => (
        <div className="create-card">
            <h3 className="create-card-title">Evaluation Metrics</h3>
            <p className="create-card-subtitle">
                Define how submissions will be evaluated and ranked.
            </p>

            <div className="create-section">
                <label>Primary Metric <span className="required-star">*</span></label>
                <select
                    className={errors.primaryMetric ? "input-error" : ""}
                    value={form.primaryMetric}
                    onChange={(e) => updateField("primaryMetric", e.target.value)}
                >
                    <option value="">Select primary metric</option>
                    {primaryMetrics.map((metric) => (
                        <option key={metric} value={metric}>{metric}</option>
                    ))}
                </select>
                <small>Main metric used for leaderboard ranking.</small>
                <ErrorMessage name="primaryMetric" />
            </div>

            <div className="create-section">
                <label>Secondary Metric</label>
                <select
                    value={form.secondaryMetric}
                    onChange={(e) => updateField("secondaryMetric", e.target.value)}
                >
                    <option value="">Select secondary metric</option>
                    {primaryMetrics.map((metric) => (
                        <option key={metric} value={metric}>{metric}</option>
                    ))}
                </select>
                <small>Optional tie-breaker metric.</small>
            </div>

            <div className="metric-preview">
                <div>
                    <h4>Metric Preview</h4>
                    <p>Primary: {form.primaryMetric || "Not selected"}</p>
                    <p>Secondary: {form.secondaryMetric || "Not selected"}</p>
                </div>
                <span className="metric-badge">Primary</span>
            </div>

            {form.participantSourcedData && (
                <div className="inner-panel">
                    <h4>Leaderboard Scoring</h4>
                    <p style={{ margin: "0 0 14px", color: "#6b7280", fontSize: 13 }}>
                        Standard scoring ranks submissions on the metric above alone. Combined
                        scoring also rewards the quality of the data each team contributed —
                        useful whenever teams source their own dataset.
                    </p>

                    <div className="tc-radio-group">
                        <label className={`tc-radio-option ${form.evaluationMode === "standard" ? "selected" : ""}`}>
                            <input type="radio" name="evaluationMode" checked={form.evaluationMode === "standard"}
                                onChange={() => updateField("evaluationMode", "standard")} />
                            <div>
                                <strong>Standard</strong>
                                <span>Rank purely on submission performance against the primary metric.</span>
                            </div>
                        </label>
                        <label className={`tc-radio-option ${form.evaluationMode === "data_quality_plus_model" ? "selected" : ""}`}>
                            <input type="radio" name="evaluationMode" checked={form.evaluationMode === "data_quality_plus_model"}
                                onChange={() => updateField("evaluationMode", "data_quality_plus_model")} />
                            <div>
                                <strong>Data Quality + Model Score (combined)</strong>
                                <span>A baseline model trained on each team's data alone scores that data's quality; combine with their own model's score.</span>
                            </div>
                        </label>
                    </div>

                    {form.evaluationMode === "data_quality_plus_model" && (
                        <>
                            <div className="create-two-col">
                                <div className="create-section">
                                    <label>Data Quality Weight (%) <span className="required-star">*</span></label>
                                    <input
                                        type="number" min="0" max="100"
                                        value={form.dataQualityWeight}
                                        onChange={(e) => {
                                            const v = parseInt(e.target.value, 10) || 0;
                                            updateField("dataQualityWeight", v);
                                            updateField("modelWeight", 100 - v);
                                        }}
                                    />
                                </div>
                                <div className="create-section">
                                    <label>Model Score Weight (%) <span className="required-star">*</span></label>
                                    <input
                                        type="number" min="0" max="100"
                                        value={form.modelWeight}
                                        onChange={(e) => {
                                            const v = parseInt(e.target.value, 10) || 0;
                                            updateField("modelWeight", v);
                                            updateField("dataQualityWeight", 100 - v);
                                        }}
                                    />
                                </div>
                            </div>
                            <ErrorMessage name="weightSplit" />

                            <div className="toggle-row">
                                <div>
                                    <strong>Run Per-Team Data-Quality Baseline</strong>
                                    <p>Train a baseline model on each team's data alone to produce the data quality score.</p>
                                </div>
                                <label className="switch">
                                    <input type="checkbox" checked={form.perTeamBaselineEnabled}
                                        onChange={(e) => updateField("perTeamBaselineEnabled", e.target.checked)} />
                                    <span className="slider"></span>
                                </label>
                            </div>

                            <div className="create-two-col">
                                <div className="create-section">
                                    <label>Held-Out Test Fraction (%)</label>
                                    <input
                                        className={errors.publicTestFraction ? "input-error" : ""}
                                        type="number" min="0" max="100"
                                        value={form.publicTestFraction}
                                        onChange={(e) => updateField("publicTestFraction", parseInt(e.target.value, 10) || 0)}
                                    />
                                    <small>
                                        {form.tracksEnabled
                                            ? "Share of each track's data held out for blind evaluation. Not disclosed to participants."
                                            : "Share of the dataset held out for blind evaluation. Not disclosed to participants."}
                                    </small>
                                    <ErrorMessage name="publicTestFraction" />
                                </div>
                                <div className="create-section">
                                    <label>{form.tracksEnabled ? "Winners per Track" : "Number of Winners"} <span className="required-star">*</span></label>
                                    <input
                                        className={errors.winnersPerTrack ? "input-error" : ""}
                                        type="number" min="1"
                                        value={form.winnersPerTrack}
                                        onChange={(e) => updateField("winnersPerTrack", parseInt(e.target.value, 10) || 1)}
                                    />
                                    <ErrorMessage name="winnersPerTrack" />
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {!form.phasesEnabled && (
                <div className="inner-panel">
                    <h4>Timeline Cutoffs (optional)</h4>
                    <p className="create-card-subtitle">
                        This competition isn't using the Phases timeline, so these are the
                        only extra dates shown on the details page besides start/end.
                    </p>
                    <div className="create-two-col">
                        <div className="create-section">
                            <label>Model Validation Cutoff</label>
                            <input
                                className={errors.validationDate ? "input-error" : ""}
                                type="date"
                                value={form.validationDate}
                                onChange={(e) => updateField("validationDate", e.target.value)}
                            />
                            <ErrorMessage name="validationDate" />
                        </div>
                        <div className="create-section">
                            <label>Final Leaderboard Freeze</label>
                            <input
                                className={errors.freezeDate ? "input-error" : ""}
                                type="date"
                                value={form.freezeDate}
                                onChange={(e) => updateField("freezeDate", e.target.value)}
                            />
                            <ErrorMessage name="freezeDate" />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    const renderRules = () => (
        <div className="create-card">
            <h3 className="create-card-title">Competition Rules &amp; Requirements</h3>
            <p className="create-card-subtitle">
                Optional settings for team limits, skills, and submission rules.
            </p>

            <div className="inner-panel">
                <h4>Team Configuration</h4>

                <div className="create-three-col">
                    <div className="create-section">
                        <label>Maximum Number of Teams</label>
                        <input
                            className={errors.maxTeams ? "input-error" : ""}
                            type="number"
                            placeholder="e.g., 100"
                            value={form.maxTeams}
                            onChange={(e) => updateField("maxTeams", e.target.value)}
                        />
                        <small>Leave empty or set 0 for unlimited teams.</small>
                        <ErrorMessage name="maxTeams" />
                    </div>

                    <div className="create-section">
                        <label>Min Team Members</label>
                        <input
                            className={errors.minMembers ? "input-error" : ""}
                            type="number"
                            placeholder="e.g., 1"
                            value={form.minMembers}
                            onChange={(e) => updateField("minMembers", e.target.value)}
                        />
                        <ErrorMessage name="minMembers" />
                    </div>

                    <div className="create-section">
                        <label>Max Team Members</label>
                        <input
                            className={errors.maxMembers ? "input-error" : ""}
                            type="number"
                            placeholder="e.g., 5"
                            value={form.maxMembers}
                            onChange={(e) => updateField("maxMembers", e.target.value)}
                        />
                        <ErrorMessage name="maxMembers" />
                    </div>
                </div>

                <div className="create-section">
                    <label>Team Merger Deadline</label>
                    <input
                        className={errors.mergeDeadline ? "input-error" : ""}
                        type="date"
                        value={form.mergeDeadline}
                        onChange={(e) => updateField("mergeDeadline", e.target.value)}
                    />
                    <small>Optional. Must be between start and end date.</small>
                    <ErrorMessage name="mergeDeadline" />
                </div>
            </div>

            <div className="create-section">
                <label>Required Skills</label>
                <small>Optional. Pick skills from the predefined list.</small>

                <div className="skills-select">
                    <button
                        type="button"
                        className="skills-select-btn"
                        onClick={() => setSkillsOpen((prev) => !prev)}
                    >
                        {form.requiredSkills.length === 0
                            ? "Select required skills"
                            : `${form.requiredSkills.length} skill(s) selected`}
                        <span>⌄</span>
                    </button>

                    {skillsOpen && (
                        <div className="skills-dropdown">
                            {PREDEFINED_SKILLS.map((skill) => {
                                const selected = form.requiredSkills.includes(skill);
                                return (
                                    <button
                                        key={skill}
                                        type="button"
                                        className={selected ? "skill-option selected" : "skill-option"}
                                        onClick={() => toggleSkill(skill)}
                                    >
                                        <span>{skill}</span>
                                        {selected && <strong>✓</strong>}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {form.requiredSkills.length > 0 && (
                    <div className="selected-skills">
                        {form.requiredSkills.map((skill) => (
                            <button
                                key={skill}
                                type="button"
                                onClick={() => toggleSkill(skill)}
                            >
                                {skill} ×
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div className="inner-panel">
                <h4>Submission Rules</h4>

                <div className="create-section">
                    <label>Maximum Submissions Per Day</label>
                    <input
                        className={errors.maxSubmissionsPerDay ? "input-error" : ""}
                        type="number"
                        placeholder="e.g., 5"
                        value={form.maxSubmissionsPerDay}
                        onChange={(e) => updateField("maxSubmissionsPerDay", e.target.value)}
                    />
                    <small>Optional. Leave empty for no daily limit.</small>
                    <ErrorMessage name="maxSubmissionsPerDay" />
                </div>

                <div className="toggle-row">
                    <div>
                        <strong>Allow External Data</strong>
                        <p>Can participants use datasets not provided by organizers?</p>
                    </div>
                    <label className="switch">
                        <input type="checkbox" checked={form.allowExternalData}
                            onChange={(e) => updateField("allowExternalData", e.target.checked)} />
                        <span className="slider"></span>
                    </label>
                </div>

                <div className="toggle-row">
                    <div>
                        <strong>Allow Pre-trained Models</strong>
                        <p>Can participants use pre-trained models such as BERT or GPT?</p>
                    </div>
                    <label className="switch">
                        <input type="checkbox" checked={form.allowPretrainedModels}
                            onChange={(e) => updateField("allowPretrainedModels", e.target.checked)} />
                        <span className="slider"></span>
                    </label>
                </div>

                <div className="toggle-row">
                    <div>
                        <strong>Require Code Sharing</strong>
                        <p>Must winners share their code and solution?</p>
                    </div>
                    <label className="switch">
                        <input type="checkbox" checked={form.requireCodeSharing}
                            onChange={(e) => updateField("requireCodeSharing", e.target.checked)} />
                        <span className="slider"></span>
                    </label>
                </div>
            </div>

            <div className="inner-panel">
                <h4>Join Method</h4>
                <p style={{ margin: "0 0 14px", color: "#6b7280", fontSize: 13 }}>
                    How will participants or teams be accepted into this competition?
                </p>

                <div className="complexity-list">
                    <button
                        type="button"
                        className={form.joinMethod === "auto" ? "complexity-option active" : "complexity-option"}
                        onClick={() => updateField("joinMethod", "auto")}
                    >
                        <strong>Automatic Acceptance</strong>
                        <span>
                            Participants or teams that satisfy all requirements (team size, skills) are
                            accepted instantly — no organizer action needed.
                        </span>
                    </button>

                    <button
                        type="button"
                        className={form.joinMethod === "manual" ? "complexity-option active" : "complexity-option"}
                        onClick={() => updateField("joinMethod", "manual")}
                    >
                        <strong>Manual Approval</strong>
                        <span>
                            Every join request is held in a queue. You review and approve or reject
                            each participant / team from the Organizer Dashboard.
                        </span>
                    </button>
                </div>

                {form.joinMethod === "manual" && (
                    <div style={{
                        marginTop: 12, padding: "10px 14px", borderRadius: 8,
                        background: "#fffbeb", border: "1px solid #fcd34d",
                        fontSize: 12, color: "#92400e",
                    }}>
                        ⚠️ With manual approval you must actively review join requests from the
                        Organizer Dashboard → Join Requests tab.
                    </div>
                )}
            </div>

            <div className="create-section">
                <label>Additional Rules &amp; Guidelines</label>
                <textarea
                    rows="3"
                    placeholder="Specify extra rules, ethics requirements, prize distribution terms..."
                    value={form.additionalRules}
                    onChange={(e) => updateField("additionalRules", e.target.value)}
                />
            </div>
        </div>
    );

    const renderComplexity = () => (
        <div className="create-card">
            <h3 className="create-card-title">Challenge Complexity</h3>
            <p className="create-card-subtitle">Choose the difficulty level of this competition.</p>

            <div className="create-section">
                <label>Complexity Level</label>
                <div className="complexity-list">
                    {complexityLevels.map((level, index) => (
                        <button
                            key={level.title}
                            type="button"
                            className={form.complexityLevel === index ? "complexity-option active" : "complexity-option"}
                            onClick={() => updateField("complexityLevel", index)}
                        >
                            <strong>{level.title}</strong>
                            <span>{level.description}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );

    const renderDatasets = () => {
        if (savingDraft) {
            return (
                <div className="create-card" style={{ textAlign: "center", padding: "48px 24px" }}>
                    <p style={{ color: "#6b7280", fontSize: 14 }}>
                        ⏳ Saving draft to enable dataset upload…
                    </p>
                </div>
            );
        }

        if (draftError) {
            return (
                <div className="create-card" style={{ textAlign: "center", padding: "48px 24px" }}>
                    <p style={{ color: "#ef4444", fontSize: 14, marginBottom: 12 }}>
                        ⚠️ Could not save draft: {draftError}
                    </p>
                    <button
                        type="button"
                        className="footer-primary-btn"
                        onClick={() => {
                            setDraftError(null);
                            setSavedCompetitionId(null);
                        }}
                    >
                        Retry
                    </button>
                </div>
            );
        }

        return (
            <DatasetSection competitionId={savedCompetitionId} />
        );
    };

    const renderCurrentStep = () => {
        switch (wizardSteps[currentStep]?.key) {
            case "basic": return renderBasicInfo();
            case "assets": return renderAssets();
            case "tasks": return renderTasks();
            case "dataCollection": return renderDataCollection();
            case "tracks": return renderTracks();
            case "phases": return renderPhases();
            case "license": return renderLicense();
            case "evaluation": return renderEvaluation();
            case "rules": return renderRules();
            case "complexity": return renderComplexity();
            case "datasets": return renderDatasets();
            default: return null;
        }
    };

    if (loadingEditData) {
        return (
            <div className="create-page">
                <Sidebar />
                <div className="create-main">
                    <div className="create-content">
                        <div className="create-card">
                            <h3>Loading competition data...</h3>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="create-page">
            <Sidebar />

            <div className="create-main">
                <div className="create-topbar">
                    <h1>{isEditMode ? "Edit Competition" : "Create New Competition"}</h1>
                    <div className="topbar-actions">
                        <button type="button" className="topbar-text-btn" onClick={handleCancel}>
                            Cancel
                        </button>
                    </div>
                </div>

                <div className="create-content">
                    <div className="wizard-head">
                        <div className="wizard-title-row">
                            <h2>{isEditMode ? "Update Competition" : "Create Competition"}</h2>
                            <span>Step {currentStep + 1} of {wizardSteps.length}</span>
                        </div>

                        <div className="wizard-progress">
                            <div className="wizard-progress-fill" style={{ width: `${progressPercent}%` }} />
                        </div>

                        <div className="wizard-tabs">
                            {wizardSteps.map((step, index) => (
                                <button
                                    key={step.key}
                                    type="button"
                                    className={currentStep === index ? "wizard-tab active" : "wizard-tab"}
                                    onClick={() => {
                                        if (index <= currentStep) { setCurrentStep(index); return; }
                                        if (validateStep(currentStep)) setCurrentStep(index);
                                    }}
                                >
                                    {step.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {renderCurrentStep()}

                    <div className="wizard-footer">
                        <button
                            type="button"
                            className="footer-secondary-btn"
                            onClick={handlePrevious}
                            disabled={currentStep === 0 || submitting}
                        >
                            Previous
                        </button>

                        {currentStep < wizardSteps.length - 1 ? (
                            <button
                                type="button"
                                className="footer-primary-btn"
                                onClick={handleNext}
                                disabled={submitting}
                            >
                                Next Step
                            </button>
                        ) : (
                            <button
                                type="button"
                                className="footer-success-btn"
                                onClick={submitCompetition}
                                disabled={submitting}
                            >
                                {submitting
                                    ? isEditMode ? "Updating..." : "Creating..."
                                    : isEditMode ? "Update Competition" : "Create Competition"}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default CreateCompetition;