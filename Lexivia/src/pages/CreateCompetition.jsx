import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import "./CreateCompetition.css";
import DatasetSection from "./DatasetSection";
import { supabase } from "../config/supabase";

/** Always returns a fresh, valid access token from Supabase session */
async function getFreshToken() {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data?.session?.access_token) return null;
    return data.session.access_token;
}

// The wizard is dynamic: competitions that use collaborative, participant-sourced
// data collection (the AMDC pattern) get extra steps for Tracks, Phases and the
// data license, and their timeline is driven by Phases instead of Milestones.
function getSteps(form) {
    const s = [
        { key: "basic", label: "Basic Info" },
        { key: "taskConfig", label: "Task Config" },
    ];
    if (form.collaborativeSourcing) {
        s.push({ key: "tracks", label: "Tracks" });
        s.push({ key: "phases", label: "Phases" });
        s.push({ key: "license", label: "License" });
    }
    s.push({ key: "evaluation", label: "Evaluation" });
    s.push({ key: "rules", label: "Rules" });
    s.push({ key: "complexity", label: "Complexity" });
    s.push({ key: "datasets", label: "Datasets" });
    if (!form.collaborativeSourcing) {
        s.push({ key: "milestones", label: "Milestones" });
    }
    return s;
}

// Task types now use exact DB values so they round-trip through the API correctly.
const taskTypes = [
    { value: "TEXT_CLASSIFICATION", label: "Text Classification" },
    { value: "NER", label: "Named Entity Recognition" },
    { value: "SENTIMENT_ANALYSIS", label: "Sentiment Analysis" },
    { value: "TRANSLATION", label: "Translation" },
    { value: "QUESTION_ANSWERING", label: "Question Answering" },
    { value: "SUMMARIZATION", label: "Summarization" },
    { value: "AUDIO_SYNTHESIS", label: "Audio Synthesis" },
    { value: "AUDIO_TRANSCRIPTION", label: "Audio Transcription" },
    { value: "SPEECH_EMOTION", label: "Speech Emotion" },
    { value: "AUDIO_EVENT_DETECTION", label: "Audio Event Detection" },
    { value: "MULTI_TASK_ANNOTATION", label: "Multi-Task / Multimodal Annotation" },
];

// Source types a team can pull participant-sourced data from (generic, not audio-specific)
const SOURCE_TYPE_OPTIONS = [
    { value: "public_platform", label: "Public platform (YouTube, etc.)" },
    { value: "self_recorded", label: "Recorded / written by the participant" },
    { value: "existing_dataset", label: "Existing dataset the team adapts" },
];

const MODALITY_OPTIONS = [
    { value: "text", label: "Text" },
    { value: "audio", label: "Audio" },
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

// ── Default task configs ───────────────────────────────────────────────────
function getDefaultTaskConfig(taskType) {
    switch (taskType) {
        case "TEXT_CLASSIFICATION":
            return { labels: ["Finance", "Technology", "Healthcare", "Politics", "Sports", "Entertainment", "Science", "Other"] };
        case "NER":
            return { entity_types: ["PER", "ORG", "LOC", "MISC", "DATE", "MONEY"] };
        case "SENTIMENT_ANALYSIS":
            return {
                sentiment_labels: ["positive", "negative", "neutral", "mixed"],
                aspect_categories: ["product", "service", "price", "delivery", "support"],
            };
        case "TRANSLATION":
            return { source_lang: "EN", target_lang: "AR", glossary_raw: "" };
        case "QUESTION_ANSWERING":
            return { qa_type: "extractive" };
        case "SUMMARIZATION":
            return { target_ratio: 0.1, max_ratio: 0.15, min_summary_words: 20 };
        case "AUDIO_SYNTHESIS":
            return { prompts: [] };
        case "AUDIO_TRANSCRIPTION":
            return { speakers: 1, with_timestamps: false };
        case "SPEECH_EMOTION":
            return {
                emotion_labels: ["neutral", "happy", "sad", "angry", "surprised", "fearful", "disgusted"],
                prompts: [],
            };
        case "AUDIO_EVENT_DETECTION":
            return { event_types: ["speech", "music", "noise", "silence", "applause", "laughter", "alarm"] };
        case "MULTI_TASK_ANNOTATION":
            // Generic "AMDC-style" config: several simultaneous label sets, over one or
            // more modalities, sourced and annotated by participants themselves.
            return {
                modalities: ["text", "audio"],
                tasks: [
                    { id: 1, name: "Sentiment", labels: ["Positive", "Negative", "Neutral"] },
                    { id: 2, name: "Sarcasm", labels: ["Yes", "No"] },
                    { id: 3, name: "Hate Speech", labels: ["Hateful", "Not Hateful"] },
                ],
                max_audio_seconds: 10,
                max_transcript_words: 20,
                allowed_source_types: ["public_platform", "self_recorded"],
                require_public_source_provenance: true,
                annotators_per_instance: 2,
                adjudication_enabled: true,
            };
        default:
            return {};
    }
}

const initialForm = {
    competitionName: "",
    taskType: "",
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

    // Task-specific annotation config set by organizer
    taskConfig: {},

    // ── Collaborative / participant-sourced data competitions (e.g. AMDC) ──────
    // When true, participants source + annotate their own data as teams, split
    // into tracks, across explicit phases, under a mandatory data license, and
    // are scored on a data-quality + model-quality combined leaderboard.
    collaborativeSourcing: false,

    // Tracks let you split teams into fair comparison groups (region, language,
    // category...) each with a minimum team count to be viable.
    tracks: [],

    // Ordered phases replace the single start/end date pair for competitions
    // that need more than one stage (e.g. data collection → break → training).
    phases: [
        { id: 1, name: "Data Collection & Annotation", durationDays: 14, description: "" },
        { id: 2, name: "Model Training & Leaderboard", durationDays: 10, description: "" },
    ],

    // Mandatory data usage license — required whenever contributed data may be
    // published or reused beyond the contributing team.
    license: {
        required: false,
        version: "v1.0",
        text: "",
    },

    // Evaluation scoring mode: "standard" (one submission score) or
    // "data_quality_plus_model" (per-team TOTO-style data quality score
    // combined with each team's own model score).
    evaluationMode: "standard",
    dataQualityWeight: 50,
    modelWeight: 50,
    totoEnabled: false,
    publicTestFraction: 20,
    winnersPerTrack: 1,

    datasets: [],
    milestones: [],
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
    // Re-inflate glossary_raw for the TRANSLATION form UI
    if (c.task_type === "TRANSLATION" && Array.isArray(taskConfig.glossary)) {
        taskConfig.glossary_raw = taskConfig.glossary.map((g) => `${g.src} → ${g.tgt}`).join("\n");
        delete taskConfig.glossary;
    }
    // Re-inflate prompts array for audio tasks
    if (!taskConfig.prompts) taskConfig.prompts = [];

    // Collaborative-sourcing sub-config lives alongside taskConfig in dataset_config.
    const collab = taskConfig.collaborative || {};
    delete taskConfig.collaborative;

    return {
        competitionName: c.title || "",
        taskType: c.task_type || c.category || "",
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

        taskConfig: Object.keys(taskConfig).length
            ? taskConfig
            : getDefaultTaskConfig(c.task_type || ""),

        collaborativeSourcing: !!collab.enabled,
        tracks: Array.isArray(collab.tracks) ? collab.tracks : [],
        phases: Array.isArray(collab.phases) && collab.phases.length
            ? collab.phases
            : initialForm.phases,
        license: collab.license || initialForm.license,
        evaluationMode: collab.evaluation?.mode || "standard",
        dataQualityWeight: collab.evaluation?.data_quality_weight ?? 50,
        modelWeight: collab.evaluation?.model_weight ?? 50,
        totoEnabled: !!collab.evaluation?.toto_enabled,
        publicTestFraction: collab.evaluation?.public_test_fraction ?? 20,
        winnersPerTrack: collab.evaluation?.winners_per_track ?? 1,

        datasets: [],
        milestones: safeArrayJson(c.milestones_json),
        validationDate: c.validation_date || "",
        freezeDate: c.freeze_date || "",
    };
}

// ── Serialize taskConfig for API payload ──────────────────────────────────────
function serializeTaskConfig(taskType, taskConfig) {
    if (!taskConfig) return {};
    const cfg = { ...taskConfig };

    // Strip empty strings from every array field so blank textarea lines are never persisted
    Object.keys(cfg).forEach((k) => {
        if (Array.isArray(cfg[k])) {
            cfg[k] = cfg[k].filter((v) => typeof v === "string" ? v.trim() : v != null);
        }
    });

    // Convert glossary_raw ("EN term → AR term" lines) to [{src, tgt}] array
    if (taskType === "TRANSLATION" && typeof cfg.glossary_raw === "string") {
        cfg.glossary = cfg.glossary_raw
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => {
                const [src, tgt] = l.split("→").map((s) => s.trim());
                return { src: src || l, tgt: tgt || "" };
            });
        delete cfg.glossary_raw;
    }

    // Convert prompts from string (textarea) to array if needed
    if (typeof cfg.prompts === "string") {
        cfg.prompts = cfg.prompts.split("\n").map((s) => s.trim()).filter(Boolean);
    }

    return cfg;
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

    // If toggling "collaborative sourcing" removes/adds steps, keep the current
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

        if (competitionFromState) {
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
    // on whether the collaborative-sourcing steps are present).
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
            // When task type changes, reset taskConfig to the new task's defaults
            if (field === "taskType") {
                next.taskConfig = getDefaultTaskConfig(value);
            }
            return next;
        });
        clearFieldError(field);
    };

    const updateTaskConfig = (key, value) => {
        setForm((prev) => ({
            ...prev,
            taskConfig: { ...prev.taskConfig, [key]: value },
        }));
    };

    // ── Multi-task / multimodal annotation config helpers ──────────────────────
    const addAnnotationTask = () => {
        const tasks = Array.isArray(form.taskConfig.tasks) ? form.taskConfig.tasks : [];
        updateTaskConfig("tasks", [
            ...tasks,
            { id: Date.now(), name: "", labels: ["Label A", "Label B"] },
        ]);
    };

    const updateAnnotationTask = (id, field, value) => {
        const tasks = Array.isArray(form.taskConfig.tasks) ? form.taskConfig.tasks : [];
        updateTaskConfig("tasks", tasks.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
    };

    const removeAnnotationTask = (id) => {
        const tasks = Array.isArray(form.taskConfig.tasks) ? form.taskConfig.tasks : [];
        updateTaskConfig("tasks", tasks.filter((t) => t.id !== id));
    };

    const toggleModality = (value) => {
        const modalities = Array.isArray(form.taskConfig.modalities) ? form.taskConfig.modalities : [];
        updateTaskConfig(
            "modalities",
            modalities.includes(value) ? modalities.filter((m) => m !== value) : [...modalities, value]
        );
    };

    const toggleSourceType = (value) => {
        const sources = Array.isArray(form.taskConfig.allowed_source_types) ? form.taskConfig.allowed_source_types : [];
        updateTaskConfig(
            "allowed_source_types",
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

    const addDataset = () => {
        setForm((prev) => ({
            ...prev,
            datasets: [...prev.datasets, { id: Date.now(), name: "", type: "", visibility: "Private" }],
        }));
    };

    const updateDataset = (id, field, value) => {
        setForm((prev) => ({
            ...prev,
            datasets: prev.datasets.map((item) =>
                item.id === id ? { ...item, [field]: value } : item
            ),
        }));
        clearFieldError(`datasetName-${id}`);
        clearFieldError(`datasetType-${id}`);
    };

    const removeDataset = (id) => {
        setForm((prev) => ({
            ...prev,
            datasets: prev.datasets.filter((item) => item.id !== id),
        }));
    };

    const addMilestone = () => {
        setForm((prev) => ({
            ...prev,
            milestones: [...prev.milestones, { id: Date.now(), title: "", date: "" }],
        }));
    };

    const updateMilestone = (id, field, value) => {
        setForm((prev) => ({
            ...prev,
            milestones: prev.milestones.map((item) =>
                item.id === id ? { ...item, [field]: value } : item
            ),
        }));
    };

    const removeMilestone = (id) => {
        setForm((prev) => ({
            ...prev,
            milestones: prev.milestones.filter((item) => item.id !== id),
        }));
    };

    const validateStep = (step = currentStep) => {
        const nextErrors = {};
        const key = wizardSteps[step]?.key;

        if (key === "basic") {
            if (!form.competitionName.trim())
                nextErrors.competitionName = "Competition name is required.";
            if (!form.taskType)
                nextErrors.taskType = "Task type is required.";
            if (!form.description.trim())
                nextErrors.description = "Description is required.";
            if (form.startDate && form.endDate && new Date(form.endDate) < new Date(form.startDate))
                nextErrors.endDate = "End date must be after start date.";
            if (form.prizePool !== "" && Number(form.prizePool) < 0)
                nextErrors.prizePool = "Prize pool cannot be negative.";
        }

        // Task Config — validate audio tasks have at least one prompt, and that
        // multi-task/multimodal competitions have a usable configuration.
        if (key === "taskConfig") {
            const audioPromptTasks = ["AUDIO_SYNTHESIS", "SPEECH_EMOTION"];
            if (audioPromptTasks.includes(form.taskType)) {
                const prompts = Array.isArray(form.taskConfig.prompts)
                    ? form.taskConfig.prompts
                    : (form.taskConfig.prompts || "").split("\n").filter(Boolean);
                if (!prompts.length)
                    nextErrors.prompts = "At least one prompt sentence is required for this task type.";
            }

            if (form.taskType === "MULTI_TASK_ANNOTATION") {
                const tasks = Array.isArray(form.taskConfig.tasks) ? form.taskConfig.tasks : [];
                if (!tasks.length)
                    nextErrors.tasks = "Define at least one annotation task.";
                tasks.forEach((t) => {
                    if (!t.name || !t.name.trim())
                        nextErrors[`task-${t.id}`] = "Every task needs a name.";
                    const labels = Array.isArray(t.labels) ? t.labels.filter((l) => l && l.trim()) : [];
                    if (labels.length < 2)
                        nextErrors[`taskLabels-${t.id}`] = "Every task needs at least two labels.";
                });
                if (!Array.isArray(form.taskConfig.modalities) || !form.taskConfig.modalities.length)
                    nextErrors.modalities = "Select at least one modality (text and/or audio).";
                if (form.taskConfig.modalities?.includes("audio") &&
                    (!form.taskConfig.max_audio_seconds || Number(form.taskConfig.max_audio_seconds) <= 0))
                    nextErrors.maxAudioSeconds = "Set a positive maximum audio length.";
                if (form.taskConfig.modalities?.includes("text") &&
                    (!form.taskConfig.max_transcript_words || Number(form.taskConfig.max_transcript_words) <= 0))
                    nextErrors.maxTranscriptWords = "Set a positive maximum word count.";
                if (!Array.isArray(form.taskConfig.allowed_source_types) || !form.taskConfig.allowed_source_types.length)
                    nextErrors.allowedSourceTypes = "Select at least one allowed data source.";
                if (!form.taskConfig.annotators_per_instance || Number(form.taskConfig.annotators_per_instance) < 1)
                    nextErrors.annotatorsPerInstance = "At least one annotator per instance is required.";
            }
        }

        if (key === "tracks") {
            if (!form.tracks.length)
                nextErrors.tracks = "Add at least one track, or turn off collaborative sourcing in Basic Info.";
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
            if (form.collaborativeSourcing && form.evaluationMode === "data_quality_plus_model") {
                const total = Number(form.dataQualityWeight) + Number(form.modelWeight);
                if (total !== 100)
                    nextErrors.weightSplit = `Data quality + model weights must add up to 100 (currently ${total}).`;
                if (form.publicTestFraction !== "" && (Number(form.publicTestFraction) < 0 || Number(form.publicTestFraction) > 100))
                    nextErrors.publicTestFraction = "Held-out test fraction must be between 0 and 100.";
                if (!form.winnersPerTrack || Number(form.winnersPerTrack) < 1)
                    nextErrors.winnersPerTrack = "At least 1 winner per track is required.";
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

        if (key === "datasets") {
            form.datasets.forEach((dataset, index) => {
                if (!dataset.name.trim())
                    nextErrors[`datasetName-${dataset.id}`] = `Dataset ${index + 1} name is required.`;
                if (!dataset.type.trim())
                    nextErrors[`datasetType-${dataset.id}`] = `Dataset ${index + 1} type is required.`;
            });
        }

        if (key === "milestones") {
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
        const taskConfig = serializeTaskConfig(form.taskType, form.taskConfig);

        // Collaborative-sourcing sub-config nests inside task_config so the
        // backend can keep treating dataset_config as one flexible JSON blob —
        // consistent with how per-task annotation config already works.
        if (form.collaborativeSourcing) {
            taskConfig.collaborative = {
                enabled: true,
                tracks: form.tracks.map((t) => ({ id: t.id, name: t.name.trim(), minTeams: Number(t.minTeams) || 1 })),
                phases: form.phases.map((p, i) => ({
                    id: p.id,
                    order: i + 1,
                    name: p.name.trim(),
                    durationDays: Number(p.durationDays) || 1,
                    description: p.description || "",
                })),
                license: {
                    required: true,
                    version: form.license.version.trim(),
                    text: form.license.text,
                },
                evaluation: {
                    mode: form.evaluationMode,
                    data_quality_weight: form.evaluationMode === "data_quality_plus_model" ? Number(form.dataQualityWeight) : null,
                    model_weight: form.evaluationMode === "data_quality_plus_model" ? Number(form.modelWeight) : null,
                    toto_enabled: form.evaluationMode === "data_quality_plus_model" ? !!form.totoEnabled : false,
                    public_test_fraction: form.evaluationMode === "data_quality_plus_model" ? Number(form.publicTestFraction) : null,
                    winners_per_track: form.evaluationMode === "data_quality_plus_model" ? Number(form.winnersPerTrack) : null,
                },
            };
        }

        return {
            competition_name: form.competitionName,
            task_type: form.taskType,
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

            // Collaborative competitions drive their timeline from Phases instead
            // of the fixed milestone set, so milestones are left empty for them.
            milestones: form.collaborativeSourcing ? [] : form.milestones,
            validation_date: form.collaborativeSourcing ? null : (form.validationDate || null),
            freeze_date: form.collaborativeSourcing ? null : (form.freezeDate || null),

            // Task-specific annotation config for this competition's widgets,
            // plus (when enabled) the nested collaborative-sourcing config.
            task_config: taskConfig,
            join_method: form.joinMethod || "auto",
            collaborative_sourcing: form.collaborativeSourcing,
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
                <label>Task Type <span className="required-star">*</span></label>
                <select
                    className={errors.taskType ? "input-error" : ""}
                    value={form.taskType}
                    onChange={(e) => updateField("taskType", e.target.value)}
                >
                    <option value="">Select task type</option>
                    {taskTypes.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                </select>
                <ErrorMessage name="taskType" />
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

            <div className="toggle-row">
                <div>
                    <strong>Collaborative, Participant-Sourced Data</strong>
                    <p>
                        Turn this on for competitions like AMDC, where teams source, transcribe and
                        annotate their own data (split into tracks, across phases, under a data
                        license), and are ranked on data quality + model quality combined. Leave it
                        off for a standard "bring your own model, we provide the data" competition.
                    </p>
                </div>
                <label className="switch">
                    <input
                        type="checkbox"
                        checked={form.collaborativeSourcing}
                        onChange={(e) => updateField("collaborativeSourcing", e.target.checked)}
                    />
                    <span className="slider"></span>
                </label>
            </div>
        </div>
    );

    // ── Task Config step ───────────────────────────────────────────────────────
    const renderTaskConfig = () => {
        const taskType = form.taskType;
        const cfg = form.taskConfig;

        // Converts an array → newline-separated string for textarea
        const asText = (key, defaultLines = []) => {
            const val = cfg[key];
            if (Array.isArray(val)) return val.join("\n");
            if (typeof val === "string") return val;
            return defaultLines.join("\n");
        };

        // Saves newline-separated textarea back as array, dropping blank lines
        const onTextareaLines = (key) => (e) =>
            updateTaskConfig(key, e.target.value.split("\n").map((s) => s.trimEnd()).filter(Boolean));

        if (!taskType) {
            return (
                <div className="create-card">
                    <div className="tc-empty">
                        <span className="tc-empty-icon">↑</span>
                        <p>Select a Task Type in Step 1 to configure annotation settings.</p>
                    </div>
                </div>
            );
        }

        return (
            <div className="create-card">
                <h3 className="create-card-title">Task Configuration</h3>
                <p className="create-card-subtitle">
                    These settings are shown to contributors in the Data Collection widget.
                    Defaults are pre-filled — edit them to match your dataset's scope.
                </p>

                {/* ── TEXT_CLASSIFICATION ──────────────────────────── */}
                {taskType === "TEXT_CLASSIFICATION" && (
                    <>
                        <div className="create-section">
                            <label>Classification Labels <span className="required-star">*</span></label>
                            <textarea
                                rows={6}
                                placeholder={"Finance\nTechnology\nHealthcare\n..."}
                                value={asText("labels", ["Finance", "Technology", "Healthcare"])}
                                onChange={onTextareaLines("labels")}
                            />
                            <small>One label per line. Contributors will choose from these labels when annotating text.</small>
                        </div>
                        <div className="create-section">
                            <label>Instructions for contributors</label>
                            <textarea
                                rows={2}
                                placeholder="Optional guidance shown to contributors in the widget..."
                                value={cfg.description || ""}
                                onChange={(e) => updateTaskConfig("description", e.target.value)}
                            />
                        </div>
                    </>
                )}

                {/* ── NER ──────────────────────────────────────────── */}
                {taskType === "NER" && (
                    <>
                        <div className="create-section">
                            <label>Entity Types <span className="required-star">*</span></label>
                            <textarea
                                rows={5}
                                placeholder={"PER\nORG\nLOC\nDATE\n..."}
                                value={asText("entity_types", ["PER", "ORG", "LOC", "MISC"])}
                                onChange={onTextareaLines("entity_types")}
                            />
                            <small>One entity type per line. Use short uppercase codes (e.g. PER, ORG, LOC).</small>
                        </div>
                        <div className="create-section">
                            <label>Instructions for contributors</label>
                            <textarea
                                rows={2}
                                placeholder="e.g., Only tag proper nouns; do not tag common nouns..."
                                value={cfg.description || ""}
                                onChange={(e) => updateTaskConfig("description", e.target.value)}
                            />
                        </div>
                    </>
                )}

                {/* ── SENTIMENT_ANALYSIS ───────────────────────────── */}
                {taskType === "SENTIMENT_ANALYSIS" && (
                    <>
                        <div className="create-section">
                            <label>Sentiment Labels <span className="required-star">*</span></label>
                            <textarea
                                rows={4}
                                placeholder={"positive\nnegative\nneutral\nmixed"}
                                value={asText("sentiment_labels", ["positive", "negative", "neutral", "mixed"])}
                                onChange={onTextareaLines("sentiment_labels")}
                            />
                            <small>One label per line. These appear as clickable sentiment buttons.</small>
                        </div>
                        <div className="create-section">
                            <label>Aspect Categories</label>
                            <textarea
                                rows={4}
                                placeholder={"product\nservice\nprice\ndelivery"}
                                value={asText("aspect_categories", ["product", "service", "price", "delivery"])}
                                onChange={onTextareaLines("aspect_categories")}
                            />
                            <small>Optional. One aspect per line for fine-grained annotation. Leave blank to disable aspect annotation.</small>
                        </div>
                    </>
                )}

                {/* ── TRANSLATION ──────────────────────────────────── */}
                {taskType === "TRANSLATION" && (
                    <>
                        <div className="create-two-col">
                            <div className="create-section">
                                <label>Source Language <span className="required-star">*</span></label>
                                <input
                                    type="text"
                                    placeholder="EN"
                                    maxLength={10}
                                    value={cfg.source_lang || "EN"}
                                    onChange={(e) => updateTaskConfig("source_lang", e.target.value.toUpperCase())}
                                />
                                <small>ISO 639-1 code (e.g. EN, FR, ZH)</small>
                            </div>
                            <div className="create-section">
                                <label>Target Language <span className="required-star">*</span></label>
                                <input
                                    type="text"
                                    placeholder="AR"
                                    maxLength={10}
                                    value={cfg.target_lang || "AR"}
                                    onChange={(e) => updateTaskConfig("target_lang", e.target.value.toUpperCase())}
                                />
                                <small>ISO 639-1 code (e.g. AR, DE, JA)</small>
                            </div>
                        </div>
                        <div className="create-section">
                            <label>Glossary Terms</label>
                            <textarea
                                rows={5}
                                placeholder={"machine learning → تعلم الآلة\nneural network → شبكة عصبية"}
                                value={cfg.glossary_raw || ""}
                                onChange={(e) => updateTaskConfig("glossary_raw", e.target.value)}
                            />
                            <small>Optional. One entry per line in format: <code>source term → target term</code>. Shown as hints to contributors.</small>
                        </div>
                    </>
                )}

                {/* ── QUESTION_ANSWERING ───────────────────────────── */}
                {taskType === "QUESTION_ANSWERING" && (
                    <>
                        <div className="create-section">
                            <label>QA Mode <span className="required-star">*</span></label>
                            <div className="tc-radio-group">
                                {[
                                    { value: "extractive", label: "Extractive", desc: "Answers must be exact spans copied from the context passage." },
                                    { value: "generative", label: "Generative", desc: "Contributors write answers freely in their own words." },
                                ].map((opt) => (
                                    <label key={opt.value} className={`tc-radio-option ${cfg.qa_type === opt.value ? "selected" : ""}`}>
                                        <input
                                            type="radio"
                                            name="qa_type"
                                            value={opt.value}
                                            checked={cfg.qa_type === opt.value}
                                            onChange={() => updateTaskConfig("qa_type", opt.value)}
                                        />
                                        <div>
                                            <strong>{opt.label}</strong>
                                            <span>{opt.desc}</span>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div className="create-section">
                            <label>Instructions for contributors</label>
                            <textarea
                                rows={2}
                                placeholder="e.g., Write questions that can only be answered from the passage provided..."
                                value={cfg.description || ""}
                                onChange={(e) => updateTaskConfig("description", e.target.value)}
                            />
                        </div>
                    </>
                )}

                {/* ── SUMMARIZATION ────────────────────────────────── */}
                {taskType === "SUMMARIZATION" && (
                    <>
                        <div className="create-three-col">
                            <div className="create-section">
                                <label>Target Compression Ratio</label>
                                <input
                                    type="number"
                                    step="0.01" min="0.01" max="1"
                                    placeholder="0.10"
                                    value={cfg.target_ratio ?? 0.1}
                                    onChange={(e) => updateTaskConfig("target_ratio", parseFloat(e.target.value) || 0.1)}
                                />
                                <small>Target summary length as fraction of source (0.10 = 10%)</small>
                            </div>
                            <div className="create-section">
                                <label>Maximum Ratio</label>
                                <input
                                    type="number"
                                    step="0.01" min="0.01" max="1"
                                    placeholder="0.15"
                                    value={cfg.max_ratio ?? 0.15}
                                    onChange={(e) => updateTaskConfig("max_ratio", parseFloat(e.target.value) || 0.15)}
                                />
                                <small>Hard cap — summaries above this ratio are flagged.</small>
                            </div>
                            <div className="create-section">
                                <label>Minimum Words</label>
                                <input
                                    type="number"
                                    min="1"
                                    placeholder="20"
                                    value={cfg.min_summary_words ?? 20}
                                    onChange={(e) => updateTaskConfig("min_summary_words", parseInt(e.target.value, 10) || 20)}
                                />
                                <small>Floor for summary word count regardless of ratio.</small>
                            </div>
                        </div>
                        <div className="create-section">
                            <label>Instructions for contributors</label>
                            <textarea
                                rows={2}
                                placeholder="e.g., Preserve factual accuracy; do not introduce information not in the source..."
                                value={cfg.description || ""}
                                onChange={(e) => updateTaskConfig("description", e.target.value)}
                            />
                        </div>
                    </>
                )}

                {/* ── AUDIO_SYNTHESIS ─────────────────────────────── */}
                {taskType === "AUDIO_SYNTHESIS" && (
                    <>
                        <div className="create-section">
                            <label>
                                Reading Prompts <span className="required-star">*</span>
                                <span style={{ fontWeight: 400, color: "#6f778c", marginLeft: 8 }}>
                                    — contributors read these aloud
                                </span>
                            </label>
                            <textarea
                                rows={10}
                                className={errors.prompts ? "input-error" : ""}
                                placeholder={"The geometric precision of the algorithm allows for instantaneous detection of phonetic anomalies.\nShe sold seashells by the seashore on a warm summer afternoon.\nThe quick brown fox jumps over the lazy dog near the old mill."}
                                value={Array.isArray(cfg.prompts) ? cfg.prompts.join("\n") : (cfg.prompts || "")}
                                onChange={(e) => updateTaskConfig("prompts", e.target.value.split("\n").map((s) => s.trimEnd()))}
                            />
                            <small>
                                One sentence per line. Each submission uses the next prompt in rotation.
                                {Array.isArray(cfg.prompts) ? ` — ${cfg.prompts.filter(Boolean).length} prompt(s) defined` : ""}
                            </small>
                            <ErrorMessage name="prompts" />
                        </div>
                        <div className="create-section">
                            <label>Instructions for contributors</label>
                            <textarea
                                rows={2}
                                placeholder="e.g., Read clearly at a natural pace; avoid background noise..."
                                value={cfg.description || ""}
                                onChange={(e) => updateTaskConfig("description", e.target.value)}
                            />
                        </div>
                    </>
                )}

                {/* ── AUDIO_TRANSCRIPTION ─────────────────────────── */}
                {taskType === "AUDIO_TRANSCRIPTION" && (
                    <>
                        <div className="create-two-col">
                            <div className="create-section">
                                <label>Number of Speakers</label>
                                <input
                                    type="number" min="1" max="20"
                                    value={cfg.speakers ?? 1}
                                    onChange={(e) => updateTaskConfig("speakers", parseInt(e.target.value, 10) || 1)}
                                />
                                <small>How many distinct speakers appear in the audio.</small>
                            </div>
                            <div className="create-section" style={{ justifyContent: "flex-end" }}>
                                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                                    <span className="switch">
                                        <input
                                            type="checkbox"
                                            checked={!!cfg.with_timestamps}
                                            onChange={(e) => updateTaskConfig("with_timestamps", e.target.checked)}
                                        />
                                        <span className="slider" />
                                    </span>
                                    <div>
                                        <strong>Require Timestamps</strong>
                                        <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
                                            Contributors mark times in [MM:SS] format
                                        </p>
                                    </div>
                                </label>
                            </div>
                        </div>
                        <div className="create-section">
                            <label>Instructions for contributors</label>
                            <textarea
                                rows={2}
                                placeholder="e.g., Include all filler words (uh, um); mark unclear speech with [inaudible]..."
                                value={cfg.description || ""}
                                onChange={(e) => updateTaskConfig("description", e.target.value)}
                            />
                        </div>
                    </>
                )}

                {/* ── SPEECH_EMOTION ──────────────────────────────── */}
                {taskType === "SPEECH_EMOTION" && (
                    <>
                        <div className="create-section">
                            <label>Emotion Labels <span className="required-star">*</span></label>
                            <textarea
                                rows={5}
                                placeholder={"neutral\nhappy\nsad\nangry\nsurprised"}
                                value={asText("emotion_labels", ["neutral", "happy", "sad", "angry", "surprised", "fearful"])}
                                onChange={onTextareaLines("emotion_labels")}
                            />
                            <small>One emotion per line. Contributors assign one of these after recording.</small>
                        </div>
                        <div className="create-section">
                            <label>
                                Utterance Prompts <span className="required-star">*</span>
                                <span style={{ fontWeight: 400, color: "#6f778c", marginLeft: 8 }}>
                                    — contributors read these with the target emotion
                                </span>
                            </label>
                            <textarea
                                rows={8}
                                className={errors.prompts ? "input-error" : ""}
                                placeholder={"I can't believe this actually worked out the way I hoped.\nEverything seems to be falling apart today.\nWe finally got the results — they exceeded all expectations."}
                                value={Array.isArray(cfg.prompts) ? cfg.prompts.join("\n") : (cfg.prompts || "")}
                                onChange={(e) => updateTaskConfig("prompts", e.target.value.split("\n").map((s) => s.trimEnd()))}
                            />
                            <small>
                                One utterance per line. Should be emotionally ambiguous sentences that
                                can be delivered in different emotional tones.
                                {Array.isArray(cfg.prompts) ? ` — ${cfg.prompts.filter(Boolean).length} prompt(s) defined` : ""}
                            </small>
                            <ErrorMessage name="prompts" />
                        </div>
                    </>
                )}

                {/* ── AUDIO_EVENT_DETECTION ───────────────────────── */}
                {taskType === "AUDIO_EVENT_DETECTION" && (
                    <>
                        <div className="create-section">
                            <label>Event Types <span className="required-star">*</span></label>
                            <textarea
                                rows={6}
                                placeholder={"speech\nmusic\nnoise\nsilence\napplause\nalarm"}
                                value={asText("event_types", ["speech", "music", "noise", "silence", "applause", "alarm"])}
                                onChange={onTextareaLines("event_types")}
                            />
                            <small>One event type per line. Contributors mark segments of audio with these labels.</small>
                        </div>
                        <div className="create-section">
                            <label>Instructions for contributors</label>
                            <textarea
                                rows={2}
                                placeholder="e.g., Mark overlapping events separately; minimum segment length is 0.5s..."
                                value={cfg.description || ""}
                                onChange={(e) => updateTaskConfig("description", e.target.value)}
                            />
                        </div>
                    </>
                )}

                {/* ── MULTI_TASK_ANNOTATION (generic AMDC-style config) ───── */}
                {taskType === "MULTI_TASK_ANNOTATION" && (
                    <>
                        <div className="create-section">
                            <label>Modalities <span className="required-star">*</span></label>
                            <small>What kind of input does each instance carry?</small>
                            <div className="tc-radio-group">
                                {MODALITY_OPTIONS.map((opt) => {
                                    const selected = (cfg.modalities || []).includes(opt.value);
                                    return (
                                        <label key={opt.value} className={`tc-radio-option ${selected ? "selected" : ""}`}>
                                            <input type="checkbox" checked={selected} onChange={() => toggleModality(opt.value)} />
                                            <div><strong>{opt.label}</strong></div>
                                        </label>
                                    );
                                })}
                            </div>
                            <ErrorMessage name="modalities" />
                        </div>

                        <div className="section-header-row">
                            <div>
                                <h4 style={{ margin: 0 }}>Annotation Tasks</h4>
                                <p className="create-card-subtitle" style={{ margin: 0 }}>
                                    Each task gets its own label set (e.g. Sentiment, Sarcasm, Hate Speech)
                                    and is annotated independently on every instance.
                                </p>
                            </div>
                            <button type="button" className="soft-action-btn" onClick={addAnnotationTask}>
                                + Add Task
                            </button>
                        </div>
                        <ErrorMessage name="tasks" />

                        {(cfg.tasks || []).map((task, idx) => (
                            <div key={task.id} className="inner-panel">
                                <div className="create-two-col">
                                    <div className="create-section">
                                        <label>Task {idx + 1} Name <span className="required-star">*</span></label>
                                        <input
                                            className={errors[`task-${task.id}`] ? "input-error" : ""}
                                            type="text"
                                            placeholder="e.g., Sentiment"
                                            value={task.name}
                                            onChange={(e) => updateAnnotationTask(task.id, "name", e.target.value)}
                                        />
                                        <ErrorMessage name={`task-${task.id}`} />
                                    </div>
                                    <div className="create-section" style={{ justifyContent: "flex-end" }}>
                                        <button type="button" className="remove-btn" onClick={() => removeAnnotationTask(task.id)}>
                                            Remove Task
                                        </button>
                                    </div>
                                </div>
                                <div className="create-section">
                                    <label>Labels <span className="required-star">*</span></label>
                                    <textarea
                                        rows={3}
                                        className={errors[`taskLabels-${task.id}`] ? "input-error" : ""}
                                        placeholder={"Positive\nNegative\nNeutral"}
                                        value={Array.isArray(task.labels) ? task.labels.join("\n") : ""}
                                        onChange={(e) => updateAnnotationTask(task.id, "labels", e.target.value.split("\n").map((s) => s.trimEnd()))}
                                    />
                                    <small>One label per line. At least two labels required.</small>
                                    <ErrorMessage name={`taskLabels-${task.id}`} />
                                </div>
                            </div>
                        ))}

                        <div className="inner-panel">
                            <h4>Data Sourcing Rules</h4>
                            <p style={{ margin: "0 0 14px", color: "#6b7280", fontSize: 13 }}>
                                Contributors source, record, or adapt their own data — these rules keep
                                every submitted instance comparable and legally publishable.
                            </p>

                            <div className="create-two-col">
                                {(cfg.modalities || []).includes("audio") && (
                                    <div className="create-section">
                                        <label>Max Audio Length (seconds) <span className="required-star">*</span></label>
                                        <input
                                            className={errors.maxAudioSeconds ? "input-error" : ""}
                                            type="number" min="1"
                                            value={cfg.max_audio_seconds ?? 10}
                                            onChange={(e) => updateTaskConfig("max_audio_seconds", parseFloat(e.target.value) || 0)}
                                        />
                                        <ErrorMessage name="maxAudioSeconds" />
                                    </div>
                                )}
                                {(cfg.modalities || []).includes("text") && (
                                    <div className="create-section">
                                        <label>Max Transcript/Text Length (words) <span className="required-star">*</span></label>
                                        <input
                                            className={errors.maxTranscriptWords ? "input-error" : ""}
                                            type="number" min="1"
                                            value={cfg.max_transcript_words ?? 20}
                                            onChange={(e) => updateTaskConfig("max_transcript_words", parseInt(e.target.value, 10) || 0)}
                                        />
                                        <ErrorMessage name="maxTranscriptWords" />
                                    </div>
                                )}
                            </div>

                            <div className="create-section">
                                <label>Allowed Data Sources <span className="required-star">*</span></label>
                                <div className="tc-radio-group">
                                    {SOURCE_TYPE_OPTIONS.map((opt) => {
                                        const selected = (cfg.allowed_source_types || []).includes(opt.value);
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
                                        checked={!!cfg.require_public_source_provenance}
                                        onChange={(e) => updateTaskConfig("require_public_source_provenance", e.target.checked)}
                                    />
                                    <span className="slider"></span>
                                </label>
                            </div>
                        </div>

                        <div className="inner-panel">
                            <h4>Annotation Protocol</h4>
                            <div className="create-two-col">
                                <div className="create-section">
                                    <label>Annotators per Instance <span className="required-star">*</span></label>
                                    <input
                                        className={errors.annotatorsPerInstance ? "input-error" : ""}
                                        type="number" min="1" max="5"
                                        value={cfg.annotators_per_instance ?? 2}
                                        onChange={(e) => updateTaskConfig("annotators_per_instance", parseInt(e.target.value, 10) || 1)}
                                    />
                                    <small>Members of the same team who must independently label each instance.</small>
                                    <ErrorMessage name="annotatorsPerInstance" />
                                </div>
                                <div className="create-section" style={{ justifyContent: "center" }}>
                                    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                                        <span className="switch">
                                            <input
                                                type="checkbox"
                                                checked={!!cfg.adjudication_enabled}
                                                onChange={(e) => updateTaskConfig("adjudication_enabled", e.target.checked)}
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
                    </>
                )}
            </div>
        );
    };

    // ── Tracks step (only for collaborative-sourcing competitions) ─────────────
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

    // ── Phases step (replaces fixed Milestones for collaborative competitions) ─
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

    // ── License step (mandatory data-usage license for collaborative sourcing) ─
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
                    <p>Participants cannot contribute data until they accept this license version. This is always required for collaborative-sourcing competitions.</p>
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

            {form.collaborativeSourcing && (
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
                                <span>Train-on-One-Team-Only (TOTO) baseline scores each team's data; combine with their model's own score.</span>
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
                                    <strong>Run TOTO Baselines</strong>
                                    <p>Train a baseline model on each team's data alone to produce the data quality score.</p>
                                </div>
                                <label className="switch">
                                    <input type="checkbox" checked={form.totoEnabled}
                                        onChange={(e) => updateField("totoEnabled", e.target.checked)} />
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
                                    <small>Share of each track's data held out for blind evaluation. Not disclosed to participants.</small>
                                    <ErrorMessage name="publicTestFraction" />
                                </div>
                                <div className="create-section">
                                    <label>Winners per Track <span className="required-star">*</span></label>
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
            <DatasetSection
                competitionId={savedCompetitionId}
                datasets={form.datasets}
                errors={errors}
                addDataset={addDataset}
                updateDataset={updateDataset}
                removeDataset={removeDataset}
            />
        );
    };

    const renderMilestones = () => (
        <div className="create-card">
            <div className="section-header-row">
                <div>
                    <h3 className="create-card-title">Key Milestones</h3>
                    <p className="create-card-subtitle">Optional. Add validation and leaderboard dates.</p>
                </div>
                <button type="button" className="soft-action-btn" onClick={addMilestone}>
                    + Add Milestone
                </button>
            </div>

            <div className="milestone-grid">
                <div className="milestone-box">
                    <strong>Submission Open</strong>
                    <span>{form.startDate ? form.startDate : "Set start date in Step 1"}</span>
                </div>

                <div className="milestone-box">
                    <strong>Model Validation Phase</strong>
                    <input
                        className={errors.validationDate ? "input-error" : ""}
                        type="date"
                        value={form.validationDate}
                        onChange={(e) => updateField("validationDate", e.target.value)}
                    />
                    <ErrorMessage name="validationDate" />
                </div>

                <div className="milestone-box">
                    <strong>Final Leaderboard Freeze</strong>
                    <input
                        className={errors.freezeDate ? "input-error" : ""}
                        type="date"
                        value={form.freezeDate}
                        onChange={(e) => updateField("freezeDate", e.target.value)}
                    />
                    <ErrorMessage name="freezeDate" />
                </div>

                <div className="milestone-box">
                    <strong>Competition End</strong>
                    <span>{form.endDate ? form.endDate : "Set end date in Step 1"}</span>
                </div>
            </div>

            {form.milestones.length > 0 && (
                <div className="extra-milestones">
                    {form.milestones.map((item) => (
                        <div key={item.id} className="extra-milestone-item">
                            <input
                                type="text"
                                value={item.title}
                                placeholder="Milestone title"
                                onChange={(e) => updateMilestone(item.id, "title", e.target.value)}
                            />
                            <input
                                type="date"
                                value={item.date}
                                onChange={(e) => updateMilestone(item.id, "date", e.target.value)}
                            />
                            <button type="button" className="remove-btn" onClick={() => removeMilestone(item.id)}>
                                Remove
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    const renderCurrentStep = () => {
        switch (wizardSteps[currentStep]?.key) {
            case "basic": return renderBasicInfo();
            case "taskConfig": return renderTaskConfig();
            case "tracks": return renderTracks();
            case "phases": return renderPhases();
            case "license": return renderLicense();
            case "evaluation": return renderEvaluation();
            case "rules": return renderRules();
            case "complexity": return renderComplexity();
            case "datasets": return renderDatasets();
            case "milestones": return renderMilestones();
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