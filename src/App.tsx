/**
 * App.tsx
 * Root application component with three-column layout:
 *   Left Sidebar — branding, model selector, settings, start button
 *   Main Area — file drop zone, transcription output, queue
 *   Right Panel — model info, system info, export
 *
 * Registers keyboard shortcuts and wires up the useWhisper hook.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
    AudioWaveform,
    Play,
    Square,
    AlertTriangle,
    X,
    Settings,
    HardDrive,
    LibraryBig,
    FileText,
    PanelLeftClose,
    PanelLeftOpen,
    Coffee,
    Mic,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/tauri";
import { open } from "@tauri-apps/api/shell";
import * as Dialog from "@radix-ui/react-dialog";
import { useWhisper } from "./hooks/useWhisper";
import { DEFAULT_SETTINGS } from "./types/models";
import type { AdvancedSettings, LibraryItem, TranscriptView } from "./types/models";
import { estimateTime, formatDuration } from "./constants";

import FileDropZone from "./components/FileDropZone";
import ModelSelector from "./components/ModelSelector";
import ModelInfoPanel from "./components/ModelInfoPanel";
import TranscriptionPanel from "./components/TranscriptionPanel";
import AdvancedSettingsPanel from "./components/AdvancedSettingsPanel";
import QueuePanel from "./components/QueuePanel";
import ExportPanel from "./components/ExportPanel";
import ModelsPage from "./components/ModelsPage";
import AudioPlayer from "./components/AudioPlayer";
import BatchExportDialog from "./components/BatchExportDialog";
import LibraryPage from "./components/LibraryPage";
import SaveLibraryDialog from "./components/SaveLibraryDialog";

import SettingsPage from "./components/SettingsPage";
import RecorderPage from "./components/RecorderPage";
import { version } from "../package.json";

export default function App() {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [focusUpdates, setFocusUpdates] = useState(false);
    const [updateNotice, setUpdateNotice] = useState<string | null>(null);
    const [dismissedUpdate, setDismissedUpdate] = useState(() => localStorage.getItem("wordvale-dismissed-update"));
    const [showRecorder, setShowRecorder] = useState(false);
    const [queuedRecordingNotice, setQueuedRecordingNotice] = useState<string | null>(null);
    const [pendingRecordingStart, setPendingRecordingStart] = useState<string | null>(null);
    const [recordingActive, setRecordingActive] = useState(false);
    const [showModels, setShowModels] = useState(false);
    const [showLibrary, setShowLibrary] = useState(false);
    const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
    const [libraryLoading, setLibraryLoading] = useState(false);
    const [libraryError, setLibraryError] = useState<string | null>(null);
    const [librarySaveIds, setLibrarySaveIds] = useState<string[] | null>(null);
    const [pendingModelDownload, setPendingModelDownload] = useState<string | null>(null);
    const [startupComplete, setStartupComplete] = useState(false);
    const [startupSlow, setStartupSlow] = useState(false);

    const {
        isBackendReady,
        isModelLoading,
        isTranscribing,
        isStopping,
        currentModel,
        systemInfo,
        modelStorage,
        modelDownload,
        modelDownloadError,
        models,
        queue,
        activeResult,
        progress,
        error,
        backendLogs,
        isUsingMockBackend,
        loadModel,
        downloadModel,
        cancelModelDownload,
        processQueue,
        cancelTranscription,
        addToQueue,
        removeFromQueue,
        reorderQueue,
        markSaved,
        linkQueueToLibrary,
        clearError,
        updateCommand,
        getModelStorage,
        deleteModel,
        deleteAllModels,
    } = useWhisper();

    useEffect(() => {
        if (!isBackendReady || isUsingMockBackend || !("__TAURI__" in window)) return;
        let cancelled = false;
        const refresh = async () => {
            try {
                const response = await updateCommand("update_status");
                const update = response.update as { status?: string; latest_version?: string | null } | undefined;
                if (!cancelled && update) {
                    if (["available", "unavailable", "downloading", "ready", "error"].includes(update.status || "") && update.latest_version) setUpdateNotice(update.latest_version);
                    else if (update.status === "current") setUpdateNotice(null);
                }
            } catch { /* Keep the last known notice during temporary connection failures. */ }
        };
        const check = async () => {
            try { await updateCommand("update_check", { current_version: version }); await refresh(); } catch { /* The next check can retry. */ }
        };
        void check();
        const checkTimer = window.setInterval(check, 6 * 60 * 60 * 1000);
        const statusTimer = window.setInterval(refresh, 30000);
        return () => { cancelled = true; window.clearInterval(checkTimer); window.clearInterval(statusTimer); };
    }, [isBackendReady, isUsingMockBackend, updateCommand]);

    useEffect(() => {
        if (startupComplete || !isBackendReady || !modelStorage || isModelLoading) return;
        const timer = window.setTimeout(() => setStartupComplete(true), 400);
        return () => window.clearTimeout(timer);
    }, [startupComplete, isBackendReady, modelStorage, isModelLoading]);

    useEffect(() => {
        if (startupComplete) return;
        const timer = window.setTimeout(() => setStartupSlow(true), 20000);
        return () => window.clearTimeout(timer);
    }, [startupComplete]);

    const [settings, setSettings] = useState<AdvancedSettings>(DEFAULT_SETTINGS);
    const [selectedLanguage, setSelectedLanguage] = useState("auto");
    const [selectedTask, setSelectedTask] = useState("transcribe");
    const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
    const [listeningId, setListeningId] = useState<string | null>(null);
    const [showBatchExport, setShowBatchExport] = useState(false);
    const [selectedTranscriptView, setSelectedTranscriptView] = useState<TranscriptView>("original");
    const [elapsedTime, setElapsedTime] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const [pendingRedo, setPendingRedo] = useState<{ id: string; fileName: string } | null>(null);
    const [isStarting, setIsStarting] = useState(false);
    const startInProgress = useRef(false);
    const [pendingRemoval, setPendingRemoval] = useState<{ id: string; fileName: string } | null>(null);
    const recordingForClose = useRef(recordingActive);
    recordingForClose.current = recordingActive;
    const queueForClose = useRef(queue);
    queueForClose.current = queue;
    const hasUnsaved = (items: typeof queue) => items.some((item) => item.result &&
        (!(item.savedViews || []).includes("original") ||
         (item.result.english && !(item.savedViews || []).includes("english"))));

    const refreshLibrary = useCallback(async () => {
        if (!isBackendReady || isUsingMockBackend) return;
        setLibraryLoading(true); setLibraryError(null);
        try { const response = await updateCommand("library_list"); setLibraryItems(response.items as unknown as LibraryItem[]); }
        catch (error) { setLibraryError(error instanceof Error ? error.message : String(error)); }
        finally { setLibraryLoading(false); }
    }, [isBackendReady, isUsingMockBackend, updateCommand]);

    useEffect(() => {
        if (showLibrary) void refreshLibrary();
        const refresh = () => { void refreshLibrary(); };
        window.addEventListener("wordvale-library-changed", refresh);
        return () => window.removeEventListener("wordvale-library-changed", refresh);
    }, [showLibrary, refreshLibrary]);

    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (recordingForClose.current || hasUnsaved(queueForClose.current)) { event.preventDefault(); event.returnValue = ""; }
        };
        window.addEventListener("beforeunload", beforeUnload);
        let unlisten: (() => void) | undefined;
        let disposed = false;
        if ("__TAURI__" in window) {
            import("@tauri-apps/api/window").then(({ appWindow }) => appWindow.onCloseRequested((event) => {
                if (recordingForClose.current || (hasUnsaved(queueForClose.current) && !window.confirm("You have unsaved transcripts. Close Wordvale and discard them?"))) event.preventDefault();
            })).then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup; });
        }
        return () => { disposed = true; unlisten?.(); window.removeEventListener("beforeunload", beforeUnload); };
    }, []);

    const handleRemoveFromQueue = (id: string) => {
        const item = queueForClose.current.find((entry) => entry.id === id);
        if (!item || item.status === "processing") return;
        if (hasUnsaved([item])) {
            setPendingRemoval({ id: item.id, fileName: item.fileName });
            return;
        }
        removeFromQueue(id);
    };

    const confirmRemoveFromQueue = () => {
        if (!pendingRemoval) return;
        const item = queueForClose.current.find((entry) => entry.id === pendingRemoval.id);
        if (item && item.status !== "processing") removeFromQueue(item.id);
        setPendingRemoval(null);
    };

    // Elapsed time tracker
    useEffect(() => {
        if (isTranscribing) {
            setElapsedTime(0);
            timerRef.current = setInterval(() => {
                setElapsedTime((prev) => prev + 1);
            }, 1000);
        } else {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [isTranscribing]);

    useEffect(() => {
        if (!selectedQueueId) return;
        if (!queue.some((item) => item.id === selectedQueueId)) {
            setSelectedQueueId(null);
        }
    }, [queue, selectedQueueId]);

    // Keyboard shortcuts
    useEffect(() => {
        function handleEscape(event: KeyboardEvent) {
            if (event.key !== "Escape" || event.defaultPrevented || (!showSettings && !showModels && !showLibrary)) return;
            if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]')) return;
            setShowSettings(false);
            setShowModels(false);
            setShowLibrary(false);
        }
        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [showSettings, showModels, showLibrary]);

    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            const meta = e.metaKey || e.ctrlKey;

            if (meta && e.key === "o") {
                e.preventDefault();
                openFileDialog();
            }

            if (meta && e.key === "Enter") {
                e.preventDefault();
                handleStart();
            }

            if (meta && e.key === "s") {
                e.preventDefault();
                // Export handled by ExportPanel
            }
        }

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queue, currentModel, isTranscribing, settings, selectedLanguage, selectedTask, librarySaveIds]);

    // Open file dialog using Tauri's native dialog
    const openFileDialog = useCallback(async () => {
        const IS_TAURI = typeof window !== "undefined" && "__TAURI__" in window;
        if (IS_TAURI) {
            try {
                const { open } = await import("@tauri-apps/api/dialog");
                const result = await open({
                    multiple: true,
                    title: "Select Audio or Video Files",
                    filters: [{ name: "Audio/Video", extensions: ["mp3", "wav", "flac", "m4a", "ogg", "aac", "opus", "webm", "mp4", "mkv", "avi", "mov"] }],
                });
                if (result) {
                    const paths = Array.isArray(result) ? result : [result];
                    if (paths.length > 0) {
                        // Fetch metadata for size
                        const filesWithMeta = await Promise.all(paths.map(async (p) => {
                            try {
                                const meta = await invoke<{ size: number }>("get_file_metadata", { path: p });
                                return { path: p, size: meta.size };
                            } catch (e) {
                                console.error(`Failed to get metadata for ${p}`, e);
                                return { path: p, size: 0 };
                            }
                        }));
                        addToQueue(filesWithMeta);
                    }
                }
            } catch (err) {
                console.error("Failed to open file dialog:", err);
            }
        }
    }, [addToQueue]);

    // Start transcription
    const handleStart = useCallback(async (onlyId?: string) => {
        if (startInProgress.current || librarySaveIds !== null) return;
        if (isTranscribing || isModelLoading || !modelStorage || queue.length === 0 || (currentModel?.endsWith(".en") && selectedLanguage !== "en") || (selectedTask === "translate" && currentModel && models.find((m) => m.name === currentModel)?.translation_support === false)) return;
        if (onlyId ? !queue.some((item) => item.id === onlyId && item.status !== "processing") : !queue.some((item) => item.status === "pending")) return;

        if (!currentModel && modelStorage && !modelStorage.downloaded_models.some((model) => model.name === "base")) {
            setPendingModelDownload("base");
            return;
        }

        startInProgress.current = true;
        setIsStarting(true);
        try {
            let outputDir: string | undefined;
            if (settings.autoSaveOutput) {
                const isTauri: boolean = "__TAURI__" in window;
                if (!isTauri) { window.alert("Auto Save requires the desktop app."); return; }
                const { open } = await import("@tauri-apps/api/dialog");
                const chosen = await open({ directory: true, title: "Choose a folder for automatically saved transcripts" });
                if (typeof chosen !== "string") return;
                outputDir = chosen;
            }

            // Follow a single requested file, or the currently processing batch item.
            setSelectedQueueId(onlyId ?? null);

            // Load model if not loaded
            if (!currentModel) {
                if (!await loadModel("base")) return;
            }

            const completedId = await processQueue(
                settings,
                selectedLanguage,
                selectedTask,
                outputDir,
                onlyId
            );
            if (completedId) setSelectedQueueId((selected) => selected ?? completedId);
        } finally {
            startInProgress.current = false;
            setIsStarting(false);
        }
    }, [
        isTranscribing,
        isModelLoading,
        models,
        modelStorage,
        queue,
        currentModel,
        loadModel,
        processQueue,
        settings,
        selectedLanguage,
        selectedTask,
        librarySaveIds,
    ]);

    useEffect(() => {
        if (!pendingRecordingStart || !queue.some((item) => item.id === pendingRecordingStart)) return;
        const id = pendingRecordingStart;
        setPendingRecordingStart(null);
        void handleStart(id).catch((failure) => { console.error("Recording transcription failed", failure); });
    }, [pendingRecordingStart, queue, handleStart]);

    const handleRunFile = (id: string) => {
        const item = queueForClose.current.find((entry) => entry.id === id);
        if (!item || item.status === "processing") return;
        if (hasUnsaved([item])) {
            setPendingRedo({ id: item.id, fileName: item.fileName });
            return;
        }
        void handleStart(id);
    };

    const handleModelSelect = (modelName: string) => {
        if (isTranscribing || isModelLoading) return;
        if (modelStorage && !modelStorage.downloaded_models.some((model) => model.name === modelName)) {
            setPendingModelDownload(modelName);
            return;
        }
        void loadModel(modelName);
    };

    const selectedModelInfo = models.find((m) => m.name === currentModel) || null;
    const pendingCount = queue.filter((item) => item.status === "pending").length;
    const completedCount = queue.filter((item) => item.status === "completed").length;
    const failedCount = queue.filter((item) => item.status === "failed").length;
    const currentProcessingItem = queue.find((item) => item.status === "processing") || null;
    const queuedEstimateSeconds = queue.filter((item) => item.status === "pending" || item.status === "processing").reduce((total, item) => total + estimateTime(item.fileSizeMb, currentModel), 0);

    const hasCompletedResults = queue.some((item) => item.result);


    // Determine which result to display:
    // while transcribing, follow the live result unless the user explicitly selects another item.
    // after transcription, show the last successful result unless the user selected another item.
    const selectedQueueItem = selectedQueueId ? queue.find((q) => q.id === selectedQueueId) : null;
    const listeningItem = listeningId ? queue.find((item) => item.id === listeningId) : null;
    const displayedResult = selectedQueueItem ? selectedQueueItem.result ?? null : (isTranscribing ? activeResult : null);
    const displayedResultHasTranslation = Boolean(displayedResult?.original && displayedResult?.english);

    useEffect(() => {
        if (displayedResult?.original && displayedResult?.english) {
            setSelectedTranscriptView("english");
        } else {
            setSelectedTranscriptView("original");
        }
    }, [displayedResult]);

    if (!startupComplete) {
        const startupError = Boolean(error);
        return <main className="startup-screen" aria-busy={!startupError}>
            <div className="startup-content">
                <div className="startup-mark" aria-hidden="true"><AudioWaveform size={48} strokeWidth={1.6} /></div>
                <h1>Wordvale</h1>

                <div className="startup-status" role="status" aria-live="polite">
                    {!startupError && <span className="startup-indicator" aria-hidden="true" />}
                    <span>{startupError ? "Couldn’t finish starting" : isBackendReady ? (isModelLoading ? "Preparing your model…" : "Getting your workspace ready…") : "Starting your local transcription engine…"}</span>
                </div>
                {startupError && <p className="startup-error">{error}</p>}
                {(startupError || startupSlow) && <div className="startup-actions">
                    {startupError && <button className="btn-primary" onClick={() => window.location.reload()}>Try again</button>}
                    <button className="btn-ghost" onClick={() => setStartupComplete(true)}>Open Wordvale</button>
                </div>}
            </div>

        </main>;
    }

    return (
        <div className="h-screen flex flex-col bg-surface-950">
            <div className="app-shell flex-1 flex min-h-0">
                <aside className={`app-navigation${sidebarCollapsed ? " is-collapsed" : ""}`} aria-label="Main navigation">
                    <div className="app-brand"><span className="app-brand-icon"><AudioWaveform size={20} /></span><div className="app-brand-copy"><h1>Wordvale</h1></div><button type="button" className="sidebar-toggle" onClick={() => setSidebarCollapsed((value) => !value)} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!sidebarCollapsed} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>{sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button></div>
                    <nav className="app-nav-links">
                        <button aria-label="Transcribe" className={!showLibrary && !showModels && !showSettings && !showRecorder ? "active" : ""} aria-current={!showLibrary && !showModels && !showSettings && !showRecorder ? "page" : undefined} onClick={() => { setShowLibrary(false); setShowModels(false); setShowSettings(false); setShowRecorder(false); }}><FileText size={17} /><span>Transcribe</span></button>
                        <button aria-label="Record" className={showRecorder ? "active" : ""} aria-current={showRecorder ? "page" : undefined} onClick={() => { setShowRecorder(true); setShowLibrary(false); setShowModels(false); setShowSettings(false); }}><Mic size={17} /><span>Record</span>{recordingActive && <span aria-label="Recording" className="recorder-nav-dot" />}</button>
                        <button aria-label="Library" className={showLibrary ? "active" : ""} aria-current={showLibrary ? "page" : undefined} onClick={() => { setShowLibrary(true); setShowModels(false); setShowSettings(false); setShowRecorder(false); }}><LibraryBig size={17} /><span>Library</span></button>
                        <button aria-label="Models" className={showModels ? "active" : ""} aria-current={showModels ? "page" : undefined} onClick={() => { setShowModels(true); setShowLibrary(false); setShowSettings(false); setShowRecorder(false); }}><HardDrive size={17} /><span>Models</span></button>
                        <button aria-label="Settings" className={showSettings ? "active" : ""} aria-current={showSettings ? "page" : undefined} onClick={() => { setFocusUpdates(false); setShowSettings(true); setShowLibrary(false); setShowModels(false); setShowRecorder(false); }}><Settings size={17} /><span>Settings</span></button>
                    </nav>
                    {!sidebarCollapsed && !showLibrary && !showModels && !showSettings && !showRecorder && <section className="sidebar-settings" aria-labelledby="transcription-settings-title">
                        <div className="sidebar-settings-heading"><h2 id="transcription-settings-title">Transcription settings</h2><p>{selectedModelInfo?.display_name || "Base model"} · {selectedLanguage === "auto" ? "Automatic language" : selectedLanguage}</p></div>
                        <ModelSelector models={models} downloadedModels={modelStorage?.downloaded_models.map((model) => model.name) ?? []} currentModel={currentModel} isLoading={isModelLoading || isTranscribing || !modelStorage} selectedLanguage={selectedLanguage} selectedTask={selectedTask} onModelSelect={handleModelSelect} onLanguageChange={setSelectedLanguage} onTaskChange={setSelectedTask} />
                        <AdvancedSettingsPanel settings={settings} onSettingsChange={setSettings} />
                    </section>}
                    <div className="sidebar-actions">
                        {isTranscribing ? (
                            <button onClick={cancelTranscription} disabled={isStopping} className="btn-secondary sidebar-transcription-button" aria-label={isStopping ? "Stopping transcription" : "Stop transcription"}>
                                <Square size={16} /><span>{isStopping ? "Stopping…" : "Stop transcription"}</span>
                            </button>
                        ) : (
                            <button onClick={() => void handleStart()} disabled={pendingCount === 0 || isModelLoading || isStarting || !modelStorage || Boolean(currentModel?.endsWith(".en") && selectedLanguage !== "en") || Boolean(selectedTask === "translate" && selectedModelInfo?.translation_support === false)} className="btn-primary sidebar-transcription-button" aria-label={isModelLoading ? "Loading model" : pendingCount <= 1 ? "Start transcription" : `Transcribe ${pendingCount} files`}>
                                <Play size={16} /><span>{isModelLoading ? "Loading model…" : pendingCount <= 1 ? "Start transcription" : `Transcribe ${pendingCount} files`}</span>
                            </button>
                        )}
                    </div>
                </aside>
                <div className="recorder-host" style={{display:showRecorder ? "flex" : "none"}}><RecorderPage
                    visible={showRecorder}
                    draftInUse={folder => queue.some(entry => entry.filePath.startsWith(`${folder}/`)) || libraryItems.some(entry => entry.audio_path?.startsWith(`${folder}/`))}
                    onDeleteDraft={async folder => {
                        if (queueForClose.current.some(entry => entry.filePath.startsWith(`${folder}/`))) throw new Error("This recording is in your queue. Remove it from the queue before deleting its draft.");
                        const response = await updateCommand("library_list");
                        const entries = response.items as LibraryItem[];
                        if (entries.some(entry => entry.audio_path?.startsWith(`${folder}/`))) throw new Error("This recording is used by Library and cannot be deleted as a draft.");
                        if (queueForClose.current.some(entry => entry.filePath.startsWith(`${folder}/`))) throw new Error("This recording was added to the queue. Remove it from the queue before deleting its draft.");
                        await invoke("recording_delete_draft", { folder });
                    }}
                    transcriptionSummary={`${selectedModelInfo?.display_name || "Base model"} · ${selectedLanguage === "auto" ? "Automatic language" : selectedLanguage}`}
                    transcribeUnavailable={!isBackendReady ? "Connecting to the transcription engine…" : isTranscribing ? "A transcription is running. You can add this recording to the queue." : isModelLoading || isStarting ? "Preparing the model…" : !modelStorage ? "Loading available models…" : currentModel?.endsWith(".en") && selectedLanguage !== "en" ? "Choose English in transcription settings for this model." : selectedTask === "translate" && selectedModelInfo?.translation_support === false ? "Choose a model that supports translation in settings." : librarySaveIds !== null ? "Finish saving your transcript first." : null}
                    onRecordingChange={setRecordingActive}
                    onLibrary={() => { setShowRecorder(false); setShowLibrary(true); }}
                    onSave={async (draft) => {
                        const queued = queue.find((entry) => entry.filePath === draft.path);
                        if (queued?.libraryId) {
                            const existing = libraryItems.find((entry) => entry.id === queued.libraryId);
                            if (existing) return existing;
                        }
                        const response = await updateCommand("library_create", { name: draft.name, audio_path: draft.path, audio_mode: "link", transcript: queued?.result });
                        const saved = response.item as LibraryItem;
                        await refreshLibrary();
                        if (queued) {
                            const latest = queueForClose.current.find((entry) => entry.id === queued.id);
                            linkQueueToLibrary(queued.id, saved.id, queued.result);
                            if (latest?.result && latest.result !== queued.result) {
                                await updateCommand("library_set_transcript", { id: saved.id, transcript: latest.result });
                                linkQueueToLibrary(queued.id, saved.id, latest.result);
                            }
                        }
                        return saved;
                    }}
                    onTranscribe={async (draft, startImmediately) => {
                        const existing = queue.find((entry) => entry.filePath === draft.path);
                        let id = existing?.id;
                        if (!id) {
                            const metadata = await invoke<{size:number}>("get_file_metadata", {path:draft.path});
                            [id] = addToQueue([{path:draft.path,size:metadata.size,libraryId:draft.libraryId,fileName:draft.name}]);
                        }
                        setSelectedQueueId(id);
                        setQueuedRecordingNotice(startImmediately || existing?.status === "completed" ? null : draft.name);
                        setShowRecorder(false); setShowLibrary(false); setShowModels(false); setShowSettings(false);
                        if (startImmediately && (!existing || existing.status === "pending" || existing.status === "failed")) setPendingRecordingStart(id);
                    }}
                /></div>
                {showRecorder ? null : showLibrary ? (
                    <LibraryPage items={libraryItems} loading={libraryLoading} error={libraryError} onBack={() => setShowLibrary(false)} command={updateCommand} onRefresh={refreshLibrary} onQueue={async (item) => { if (!item.audio_path || !item.audio_available) throw new Error("Relink the recording before adding it to the queue."); const metadata = await invoke<{ size: number }>("get_file_metadata", { path: item.audio_path }); addToQueue([{ path: item.audio_path, size: metadata.size, libraryId: item.id, fileName: item.audio_name || item.name }]); }} />
                ) : showModels ? (
                    <ModelsPage models={models} storage={modelStorage} currentModel={currentModel} isTranscribing={isTranscribing} isModelLoading={isModelLoading} download={modelDownload} downloadError={modelDownloadError} onBack={() => setShowModels(false)} onRefresh={getModelStorage} onDownload={downloadModel} onCancelDownload={cancelModelDownload} onUse={loadModel} onRemove={deleteModel} onRemoveAll={deleteAllModels} />
                ) : showSettings ? (
                    <SettingsPage onBack={() => setShowSettings(false)} focusUpdates={focusUpdates} logs={backendLogs} isBackendReady={isBackendReady} isUsingMockBackend={isUsingMockBackend} error={error} updateCommand={updateCommand} updateBlocked={recordingActive || isTranscribing || isModelLoading || hasUnsaved(queue)} />
                ) : (<>
                <div className="transcription-layout flex-1 min-w-0 min-h-0">
                <main className="workspace flex-1 min-w-0 min-h-0 overflow-y-auto">
                    <header className="workspace-header"><div><h2>Transcribe</h2></div></header>
                    <div className="workspace-content">
                        {queuedRecordingNotice && <div className="recording-queued-notice" role="status"><div><strong>{queuedRecordingNotice} is in your queue</strong><span>Ready when you are. Adjust the settings or start transcription.</span></div><button aria-label="Dismiss recording message" onClick={() => setQueuedRecordingNotice(null)}><X size={16}/></button></div>}
                        {!queue.length && <div className="workspace-intro"><h3>Start with a recording</h3></div>}
                        <FileDropZone onFilesSelected={addToQueue} isTranscribing={isTranscribing} queueCount={queue.length} pendingCount={pendingCount} completedCount={completedCount} failedCount={failedCount} queuedEstimate={queue.length > 0 ? formatDuration(queuedEstimateSeconds) : null} />
                    <QueuePanel
                        queue={queue}
                        onRemove={handleRemoveFromQueue}
                        onRun={handleRunFile}
                        onListen={setListeningId}
                        onBatchExport={() => setShowBatchExport(true)}
                        onSaveLibrary={(id) => setLibrarySaveIds([id])}
                        onBatchSaveLibrary={() => setLibrarySaveIds(queue.filter((item) => item.status === "completed").map((item) => item.id))}
                        canRun={isBackendReady && !isTranscribing && !isModelLoading && !isStarting && Boolean(modelStorage) && !(currentModel?.endsWith(".en") && selectedLanguage !== "en") && !(selectedTask === "translate" && selectedModelInfo?.translation_support === false)}
                        onReorder={reorderQueue}
                        progress={progress}
                        currentModel={currentModel}
                        onSelect={setSelectedQueueId}
                        selectedId={selectedQueueId ?? currentProcessingItem?.id ?? null}
                        isTranscribing={isTranscribing}
                    />

                    {(queue.length > 0 || isTranscribing) && <div className="flex-1 min-h-[360px] shrink-0">
                        <TranscriptionPanel
                            result={displayedResult}
                            progress={progress}
                            isTranscribing={isTranscribing && (!selectedQueueItem || selectedQueueItem.status === "processing")}
                            selectedFile={selectedQueueItem?.fileName ?? (isTranscribing ? currentProcessingItem?.fileName : undefined)}
                            selectedStatus={selectedQueueItem?.status}
                            emptyStateMode={hasCompletedResults ? "select" : "idle"}
                            selectedTranscriptView={selectedTranscriptView}
                            onTranscriptViewChange={setSelectedTranscriptView}
                        />
                    </div>}

                    </div>
                </main>
                <aside className="transcription-sidebar" aria-label="Transcription details and export">
                    <ModelInfoPanel model={selectedModelInfo} systemInfo={systemInfo} progress={progress} isTranscribing={isTranscribing} elapsedTime={elapsedTime} />
                    <ExportPanel result={displayedResult} selectedTranscriptView={selectedTranscriptView} showTranscriptViewSelector={displayedResultHasTranslation} onSaved={(view) => { if (selectedQueueItem?.result === displayedResult) markSaved(selectedQueueItem.id, view); }} />
                    <div className="transcription-support"><p className="transcription-support-prompt">Enjoying Wordvale?</p><button type="button" className="support-button sidebar-transcription-button" onClick={() => void open("https://buymeacoffee.com/Arin11a")}><Coffee size={16} aria-hidden="true" /> Buy me a coffee</button></div>
                </aside>
                </div>
                </>)}
            </div>

            <SaveLibraryDialog open={librarySaveIds !== null} onClose={() => setLibrarySaveIds(null)} items={queue.filter((item) => librarySaveIds?.includes(item.id))} command={updateCommand} onSaved={(queueItem, item, includedTranscript) => { linkQueueToLibrary(queueItem.id, item.id, includedTranscript ? queueItem.result : undefined); void invoke("recording_ack", { path: queueItem.filePath }).catch(() => {}); void refreshLibrary(); }} />
            <BatchExportDialog open={showBatchExport} onClose={() => setShowBatchExport(false)} items={queue} onSaved={(id, view, result) => { if (queueForClose.current.find((item) => item.id === id)?.result === result) markSaved(id, view); }} />

            <Dialog.Root open={!!listeningItem} onOpenChange={(open) => { if (!open) setListeningId(null); }}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm" />
                    <Dialog.Content className="fixed left-1/2 top-1/2 z-[71] max-h-[calc(100vh-32px)] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-surface-700/70 bg-surface-900 p-6 shadow-2xl focus:outline-none">
                        <div className="flex items-center justify-between gap-4">
                            <Dialog.Title className="text-base font-semibold text-surface-100">Listen to recording</Dialog.Title>
                            <Dialog.Close asChild><button aria-label="Close player" className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-800 hover:text-surface-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-400"><X className="h-4 w-4" /></button></Dialog.Close>
                        </div>
                        <Dialog.Description className="sr-only">Play and navigate the selected recording.</Dialog.Description>
                        {listeningItem && <AudioPlayer key={listeningItem.id} item={listeningItem} />}
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

            <Dialog.Root open={pendingModelDownload !== null} onOpenChange={(open) => { if (!open) setPendingModelDownload(null); }}>
                <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[70] bg-black/65 backdrop-blur-sm" /><Dialog.Content className="fixed left-1/2 top-1/2 z-[71] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-surface-700/70 bg-surface-900 p-6 shadow-2xl focus:outline-none"><Dialog.Title className="text-base font-semibold text-surface-100">Download model?</Dialog.Title><Dialog.Description className="mt-3 text-sm leading-relaxed text-surface-400">{models.find((m) => m.name === pendingModelDownload)?.display_name || pendingModelDownload} isn’t downloaded yet. Download it before using it for transcription. You can see download progress in Manage models.</Dialog.Description><div className="mt-6 flex justify-end gap-3"><Dialog.Close asChild><button className="btn-ghost text-sm">Cancel</button></Dialog.Close><button className="btn-primary text-sm" onClick={() => { if (pendingModelDownload) void loadModel(pendingModelDownload); setPendingModelDownload(null); setShowModels(true); setShowSettings(false); }}>Download and use</button></div></Dialog.Content></Dialog.Portal>
            </Dialog.Root>

            <Dialog.Root open={pendingRedo !== null} onOpenChange={(open) => { if (!open) setPendingRedo(null); }}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/65 backdrop-blur-sm" />
                    <Dialog.Content className="fixed left-1/2 top-1/2 z-[71] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-surface-700/70 bg-surface-900 p-6 shadow-2xl focus:outline-none">
                        <Dialog.Title className="text-base font-semibold text-surface-100">Redo unsaved transcript?</Dialog.Title>
                        <Dialog.Description className="mt-3 text-sm leading-relaxed text-surface-400"><span className="break-words font-medium text-surface-200">{pendingRedo?.fileName}</span> has an unsaved transcript. A successful redo will replace it with the new result. You can save it first if you want to keep it.</Dialog.Description>
                        <div className="mt-6 flex justify-end gap-3"><Dialog.Close asChild><button className="btn-ghost px-4 py-2 text-sm">Keep transcript</button></Dialog.Close><button className="btn-primary text-sm" onClick={() => { const id = pendingRedo?.id; setPendingRedo(null); if (id) void handleStart(id); }}>Redo transcription</button></div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

            <Dialog.Root open={pendingRemoval !== null} onOpenChange={(open) => { if (!open) setPendingRemoval(null); }}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/65 backdrop-blur-sm" />
                    <Dialog.Content
                        className="fixed left-1/2 top-1/2 z-[71] flex h-[228px] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-surface-700/70 bg-surface-900 shadow-2xl focus:outline-none"
                        onOpenAutoFocus={(event) => {
                            event.preventDefault();
                            document.getElementById("keep-transcript")?.focus();
                        }}
                    >
                        <div className="flex min-h-0 flex-1 items-start gap-3.5 px-6 pt-5 pb-3">
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning-500/10 text-warning-400">
                                <AlertTriangle className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                                <Dialog.Title className="text-[15px] font-semibold leading-6 tracking-[-0.01em] text-surface-100">Discard unsaved transcript?</Dialog.Title>
                                <Dialog.Description className="mt-1.5 max-h-[100px] overflow-y-auto text-[13px] leading-[1.5] text-surface-300">
                                    The transcript for <span className="break-words font-medium text-surface-200">{pendingRemoval?.fileName}</span> hasn't been saved. Removing this file will discard its transcript.
                                    <span className="mt-2 block text-xs leading-5 text-surface-400">Your original file won't be affected.</span>
                                </Dialog.Description>
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-surface-700/30 bg-surface-950/20 px-6 py-3.5">
                            <Dialog.Close asChild>
                                <button id="keep-transcript" className="h-9 rounded-lg border border-surface-700/60 bg-surface-800/70 px-4 text-[13px] font-medium text-surface-200 transition-colors hover:bg-surface-700/70 hover:text-surface-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400">Cancel</button>
                            </Dialog.Close>
                            <button onClick={confirmRemoveFromQueue} className="h-9 rounded-lg border border-danger-500/40 bg-danger-600/90 px-4 text-[13px] font-medium text-white transition-colors hover:bg-danger-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-400">
                                Discard transcript
                            </button>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

            {/* ─── Error toast ─── */}
            {updateNotice && updateNotice !== dismissedUpdate && !showSettings && <aside className="update-notice" aria-label="Update available" role="status">
                <button className="update-notice-close" aria-label="Dismiss update notification" onClick={() => { localStorage.setItem("wordvale-dismissed-update", updateNotice); setDismissedUpdate(updateNotice); }}><X size={16} /></button>
                <strong>Update available</strong><p>Wordvale {updateNotice} is ready to explore.</p>
                <button className="btn-primary" onClick={() => { setFocusUpdates(true); setShowSettings(true); setShowLibrary(false); setShowModels(false); setShowRecorder(false); }}>View update</button>
            </aside>}
            {error && (
                <div role="alert" className="fixed bottom-6 right-6 z-50 animate-slide-up">
                    <div className="flex items-start gap-3 rounded-xl border border-danger-500/30 bg-surface-900/95 backdrop-blur-md p-4 shadow-xl max-w-sm">
                        <AlertTriangle className="w-5 h-5 text-danger-400 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-surface-100 mb-0.5">Something needs attention</p>
                            <p className="text-xs text-surface-300">Check the details below, then retry the action. Your queue remains available.</p>
                            <details className="mt-2 text-xs text-surface-400"><summary className="cursor-pointer">Show details</summary><p className="mt-1 break-words">{error}</p></details>
                        </div>
                        <button onClick={clearError} aria-label="Dismiss error" className="text-surface-400 hover:text-surface-200 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-400">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}


        </div>
    );
}
