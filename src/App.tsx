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
    Loader2,
    AlertTriangle,
    X,
    Settings,
    ArrowLeft,
    HardDrive,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/tauri";
import * as Dialog from "@radix-ui/react-dialog";
import { useWhisper } from "./hooks/useWhisper";
import { DEFAULT_SETTINGS } from "./types/models";
import type { AdvancedSettings, TranscriptView } from "./types/models";
import { estimateTime, formatDuration } from "./constants";

import FileDropZone from "./components/FileDropZone";
import ModelSelector from "./components/ModelSelector";
import ModelInfoPanel from "./components/ModelInfoPanel";
import TranscriptionPanel from "./components/TranscriptionPanel";
import AdvancedSettingsPanel from "./components/AdvancedSettingsPanel";
import QueuePanel from "./components/QueuePanel";
import ExportPanel from "./components/ExportPanel";
import ModelsPage from "./components/ModelsPage";

import SettingsPage from "./components/SettingsPage";

export default function App() {
    const [showSettings, setShowSettings] = useState(false);
    const [showModels, setShowModels] = useState(false);
    const [pendingModelDownload, setPendingModelDownload] = useState<string | null>(null);

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
        retryQueueItem,
        markSaved,
        clearError,
        getModelStorage,
        deleteModel,
        deleteAllModels,
    } = useWhisper();

    const [settings, setSettings] = useState<AdvancedSettings>(DEFAULT_SETTINGS);
    const [selectedLanguage, setSelectedLanguage] = useState("auto");
    const [selectedTask, setSelectedTask] = useState("transcribe");
    const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
    const [selectedTranscriptView, setSelectedTranscriptView] = useState<TranscriptView>("original");
    const [elapsedTime, setElapsedTime] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const [pendingRemoval, setPendingRemoval] = useState<{ id: string; fileName: string } | null>(null);
    const queueForClose = useRef(queue);
    queueForClose.current = queue;
    const hasUnsaved = (items: typeof queue) => items.some((item) => item.result &&
        (!(item.savedViews || []).includes("original") ||
         (item.result.english && !(item.savedViews || []).includes("english"))));

    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (hasUnsaved(queueForClose.current)) { event.preventDefault(); event.returnValue = ""; }
        };
        window.addEventListener("beforeunload", beforeUnload);
        let unlisten: (() => void) | undefined;
        let disposed = false;
        if ("__TAURI__" in window) {
            import("@tauri-apps/api/window").then(({ appWindow }) => appWindow.onCloseRequested((event) => {
                if (hasUnsaved(queueForClose.current) && !window.confirm("You have unsaved transcripts. Close Wordvale and discard them?")) event.preventDefault();
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
    }, [queue, currentModel, isTranscribing, settings, selectedLanguage, selectedTask]);

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
    const handleStart = useCallback(async () => {
        if (isTranscribing || isModelLoading || !modelStorage || queue.length === 0 || (currentModel?.endsWith(".en") && selectedLanguage !== "en") || (selectedTask === "translate" && currentModel && models.find((m) => m.name === currentModel)?.translation_support === false)) return;
        if (!queue.some((item) => item.status === "pending")) return;

        if (!currentModel && modelStorage && !modelStorage.downloaded_models.some((model) => model.name === "base")) {
            setPendingModelDownload("base");
            return;
        }

        let outputDir: string | undefined;
        if (settings.autoSaveOutput) {
            const isTauri: boolean = "__TAURI__" in window;
            if (!isTauri) { window.alert("Auto Save requires the desktop app."); return; }
            const { open } = await import("@tauri-apps/api/dialog");
            const chosen = await open({ directory: true, title: "Choose a folder for automatically saved transcripts" });
            if (typeof chosen !== "string") return;
            outputDir = chosen;
        }

        // Reset selection to follow progress
        setSelectedQueueId(null);

        // Load model if not loaded
        if (!currentModel) {
            if (!await loadModel("base")) return;
        }

        await processQueue(
            settings,
            selectedLanguage,
            selectedTask,
            outputDir
        );
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
    ]);

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
    const queuedEstimateSeconds = queue
        .filter((item) => item.status === "pending" || item.status === "processing")
        .reduce((total, item) => total + estimateTime(item.fileSizeMb, currentModel), 0);

    const hasCompletedResults = queue.some((item) => item.result);

    // Determine which result to display:
    // while transcribing, follow the live result unless the user explicitly selects another item.
    // after transcription, require an explicit selection so the panel does not imply a file is active.
    const selectedQueueItem = selectedQueueId ? queue.find((q) => q.id === selectedQueueId) : null;
    const displayedResult = selectedQueueItem ? selectedQueueItem.result ?? null : (isTranscribing ? activeResult : null);
    const displayedResultHasTranslation = Boolean(displayedResult?.original && displayedResult?.english);

    useEffect(() => {
        if (displayedResult?.original && displayedResult?.english) {
            setSelectedTranscriptView("english");
        } else {
            setSelectedTranscriptView("original");
        }
    }, [displayedResult]);

    return (
        <div className="h-screen flex flex-col bg-surface-950">
            {/* ─── Title bar (draggable in Tauri) ─── */}
            <div
                className="h-8 flex items-center justify-center bg-surface-950/80 border-b border-surface-800/30 select-none"
                data-tauri-drag-region
            >
                <span className="text-[11px] text-surface-500 font-medium">Wordvale</span>
            </div>

            {/* ─── Main layout ─── */}
            <div className="flex-1 flex min-h-0">
                {/* ═══════════════ LEFT SIDEBAR ═══════════════ */}
                <aside className="w-72 border-r border-surface-800/30 bg-surface-900/40 flex flex-col">
                    {/* Logo */}
                    <div className="px-5 pt-5 pb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent-500 to-purple-500 flex items-center justify-center shadow-lg">
                                <AudioWaveform className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h1 className="text-base font-bold text-surface-100 leading-tight">Wordvale</h1>
                                <p className="text-[10px] text-surface-500 font-medium">Offline Transcription</p>
                            </div>
                        </div>
                    </div>

                    {/* Backend status */}
                    <div className="px-5 mb-4">
                        <div className={`flex items-center gap-2 text-xs ${isBackendReady ? "text-success-400" : "text-warning-400"}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${isBackendReady ? "bg-success-400" : "bg-warning-400 animate-pulse"}`} />
                            {isBackendReady ? "Backend Ready" : "Connecting..."}
                        </div>
                    </div>

                    {/* Model / Language / Task selectors */}
                    <div className="px-5 flex-1 overflow-y-auto">
                        <ModelSelector
                            models={models}
                            currentModel={currentModel}
                            isLoading={isModelLoading || isTranscribing || !modelStorage}
                            selectedLanguage={selectedLanguage}
                            selectedTask={selectedTask}
                            onModelSelect={handleModelSelect}
                            onLanguageChange={setSelectedLanguage}
                            onTaskChange={setSelectedTask}
                        />

                        {/* Advanced Settings */}
                        <AdvancedSettingsPanel
                            settings={settings}
                            onSettingsChange={setSettings}
                        />
                    </div>

                    {/* Start / Stop button */}
                    <div className="p-5 border-t border-surface-800/30">
                        <button onClick={() => { setShowModels(false); setShowSettings((value) => showModels ? true : !value); }} className="btn-ghost w-full justify-start mb-3" aria-pressed={showSettings}>
                            {showSettings ? <ArrowLeft className="w-4 h-4" /> : <Settings className="w-4 h-4" />}
                            {showSettings ? "Back to transcription" : "Settings"}
                        </button>
                        {isTranscribing ? (
                            <button
                                onClick={cancelTranscription}
                                disabled={isStopping}
                                className="w-full flex items-center justify-center gap-2 rounded-xl bg-danger-500/10 border border-danger-500/30
                           text-danger-400 py-3 text-sm font-semibold transition-all hover:bg-danger-500/20 active:scale-[0.98]"
                            >
                                <Square className="w-4 h-4" />
                                {isStopping ? "Stopping..." : "Stop"}
                            </button>
                        ) : (
                            <button
                                onClick={handleStart}
                                disabled={pendingCount === 0 || isModelLoading || !modelStorage || Boolean(currentModel?.endsWith(".en") && selectedLanguage !== "en") || Boolean(selectedTask === "translate" && selectedModelInfo?.translation_support === false)}
                                className="btn-primary w-full py-3 text-sm font-semibold rounded-xl"
                            >
                                {isModelLoading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Loading Model...
                                    </>
                                ) : (
                                    <>
                                        <Play className="w-4 h-4" />
                                        {pendingCount <= 1 ? "Start Queue" : `Process ${pendingCount} Files`}
                                    </>
                                )}
                            </button>
                        )}

                        {/* Keyboard shortcut hint */}
                        <div className="flex items-center justify-center gap-1.5 mt-2">
                            <kbd className="px-1.5 py-0.5 rounded bg-surface-800 text-[10px] text-surface-500 font-mono border border-surface-700/50">⌘</kbd>
                            <kbd className="px-1.5 py-0.5 rounded bg-surface-800 text-[10px] text-surface-500 font-mono border border-surface-700/50">↵</kbd>
                        </div>
                    </div>
                </aside>

                {showModels ? (
                    <ModelsPage models={models} storage={modelStorage} currentModel={currentModel} isTranscribing={isTranscribing} isModelLoading={isModelLoading} download={modelDownload} downloadError={modelDownloadError} onBack={() => setShowModels(false)} onRefresh={getModelStorage} onDownload={downloadModel} onCancelDownload={cancelModelDownload} onUse={loadModel} onRemove={deleteModel} onRemoveAll={deleteAllModels} />
                ) : showSettings ? (
                    <SettingsPage logs={backendLogs} isBackendReady={isBackendReady} isUsingMockBackend={isUsingMockBackend} error={error} />
                ) : (<>
                {/* ═══════════════ MAIN CONTENT ═══════════════ */}
                <main className="flex-1 flex flex-col min-w-0 min-h-0 p-5 gap-4 overflow-y-auto">
                    {/* File drop zone */}
                    <FileDropZone
                        onFilesSelected={addToQueue}
                        isTranscribing={isTranscribing}
                        queueCount={queue.length}
                        pendingCount={pendingCount}
                        completedCount={completedCount}
                        failedCount={failedCount}
                        queuedEstimate={queue.length > 0 ? formatDuration(queuedEstimateSeconds) : null}
                    />

                    {/* Queue */}
                    <QueuePanel
                        queue={queue}
                        onRemove={handleRemoveFromQueue}
                        onRetry={retryQueueItem}
                        onReorder={reorderQueue}
                        currentModel={currentModel}
                        onSelect={setSelectedQueueId}
                        selectedId={selectedQueueId ?? currentProcessingItem?.id ?? null}
                        isTranscribing={isTranscribing}
                    />

                    {/* Transcription output */}
                    <div className="flex-1 min-h-[360px] shrink-0">
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
                    </div>
                </main>

                {/* ═══════════════ RIGHT PANEL ═══════════════ */}
                <aside className="w-72 border-l border-surface-800/30 bg-surface-900/20 p-4 overflow-y-auto">
                    <ModelInfoPanel
                        model={selectedModelInfo}
                        systemInfo={systemInfo}
                        progress={progress}
                        isTranscribing={isTranscribing}
                        elapsedTime={elapsedTime}
                    />

                    <div className="mt-4">
                        <ExportPanel
                            result={displayedResult}
                            selectedTranscriptView={selectedTranscriptView}
                            showTranscriptViewSelector={displayedResultHasTranslation}
                            onSaved={(view) => { if (selectedQueueItem?.result === displayedResult) markSaved(selectedQueueItem.id, view); }}
                        />
                    </div>

                    <button onClick={() => { setShowSettings(false); setShowModels(true); }} className="card mt-4 flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:border-accent-500/40 hover:bg-surface-800/60">
                        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-surface-300"><HardDrive className="h-4 w-4 text-accent-400" /> Manage models</span>
                        <span className="text-xs text-surface-500">{modelStorage?.downloaded_count ?? "—"} downloaded →</span>
                    </button>

                </aside>
                </>)}
            </div>

            <Dialog.Root open={pendingModelDownload !== null} onOpenChange={(open) => { if (!open) setPendingModelDownload(null); }}>
                <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[70] bg-black/65 backdrop-blur-sm" /><Dialog.Content className="fixed left-1/2 top-1/2 z-[71] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-surface-700/70 bg-surface-900 p-6 shadow-2xl focus:outline-none"><Dialog.Title className="text-base font-semibold text-surface-100">Download model?</Dialog.Title><Dialog.Description className="mt-3 text-sm leading-relaxed text-surface-400">{models.find((m) => m.name === pendingModelDownload)?.display_name || pendingModelDownload} isn’t downloaded yet. Download it before using it for transcription. You can see download progress in Manage models.</Dialog.Description><div className="mt-6 flex justify-end gap-3"><Dialog.Close asChild><button className="btn-ghost text-sm">Cancel</button></Dialog.Close><button className="btn-primary text-sm" onClick={() => { if (pendingModelDownload) void loadModel(pendingModelDownload); setPendingModelDownload(null); setShowModels(true); setShowSettings(false); }}>Download and use</button></div></Dialog.Content></Dialog.Portal>
            </Dialog.Root>

            <Dialog.Root open={pendingRemoval !== null} onOpenChange={(open) => { if (!open) setPendingRemoval(null); }}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/65 backdrop-blur-sm" />
                    <Dialog.Content
                        className="fixed left-1/2 top-1/2 z-[71] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-surface-700/70 bg-surface-900 p-6 shadow-2xl focus:outline-none"
                        onOpenAutoFocus={(event) => {
                            event.preventDefault();
                            document.getElementById("keep-transcript")?.focus();
                        }}
                    >
                        <div className="flex items-start gap-4">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-warning-500/20 bg-warning-500/10 text-warning-400">
                                <AlertTriangle className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                                <Dialog.Title className="text-base font-semibold text-surface-100">Remove unsaved transcript?</Dialog.Title>
                                <Dialog.Description className="mt-2 text-sm leading-relaxed text-surface-400">
                                    <span className="break-words font-medium text-surface-200">{pendingRemoval?.fileName}</span> has unsaved transcript work. Removing it from the queue will discard that work. Your original audio or video file will stay on your computer.
                                </Dialog.Description>
                            </div>
                        </div>
                        <div className="mt-6 flex justify-end gap-3">
                            <Dialog.Close asChild>
                                <button id="keep-transcript" className="btn-ghost px-4 py-2 text-sm">Keep transcript</button>
                            </Dialog.Close>
                            <button onClick={confirmRemoveFromQueue} className="rounded-lg bg-danger-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-danger-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-400">
                                Remove from queue
                            </button>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

            {/* ─── Error toast ─── */}
            {error && (
                <div className="fixed bottom-6 right-6 z-50 animate-slide-up">
                    <div className="flex items-start gap-3 rounded-xl border border-danger-500/30 bg-surface-900/95 backdrop-blur-md p-4 shadow-xl max-w-sm">
                        <AlertTriangle className="w-5 h-5 text-danger-400 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-surface-100 mb-0.5">Error</p>
                            <p className="text-xs text-surface-400 break-words">{error}</p>
                        </div>
                        <button onClick={clearError} className="text-surface-500 hover:text-surface-200 transition-colors">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}


        </div>
    );
}
