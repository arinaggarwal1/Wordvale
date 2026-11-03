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
    ArrowRight,
    HardDrive,
    LibraryBig,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/tauri";
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

export default function App() {
    const [showSettings, setShowSettings] = useState(false);
    const [showModels, setShowModels] = useState(false);
    const [showLibrary, setShowLibrary] = useState(false);
    const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
    const [libraryLoading, setLibraryLoading] = useState(false);
    const [libraryError, setLibraryError] = useState<string | null>(null);
    const [librarySaveIds, setLibrarySaveIds] = useState<string[] | null>(null);
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
        markSaved,
        linkQueueToLibrary,
        clearError,
        updateCommand,
        getModelStorage,
        deleteModel,
        deleteAllModels,
    } = useWhisper();

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

            await processQueue(
                settings,
                selectedLanguage,
                selectedTask,
                outputDir,
                onlyId
            );
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
    const queuedEstimateSeconds = queue
        .filter((item) => item.status === "pending" || item.status === "processing")
        .reduce((total, item) => total + estimateTime(item.fileSizeMb, currentModel), 0);

    const hasCompletedResults = queue.some((item) => item.result);

    // Determine which result to display:
    // while transcribing, follow the live result unless the user explicitly selects another item.
    // after transcription, require an explicit selection so the panel does not imply a file is active.
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

    return (
        <div className="h-screen flex flex-col bg-surface-950">
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
                        <button onClick={() => { setShowModels(false); setShowLibrary(false); setShowSettings(true); }} className="btn-ghost w-full justify-center mb-3" aria-pressed={showSettings}>
                            <Settings className="w-4 h-4" /> Settings
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
                                onClick={() => void handleStart()}
                                disabled={pendingCount === 0 || isModelLoading || isStarting || !modelStorage || Boolean(currentModel?.endsWith(".en") && selectedLanguage !== "en") || Boolean(selectedTask === "translate" && selectedModelInfo?.translation_support === false)}
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

                {showLibrary ? (
                    <LibraryPage items={libraryItems} loading={libraryLoading} error={libraryError} onBack={() => setShowLibrary(false)} command={updateCommand} onRefresh={refreshLibrary} onQueue={async (item) => { if (!item.audio_path || !item.audio_available) throw new Error("Relink the recording before adding it to the queue."); const metadata = await invoke<{ size: number }>("get_file_metadata", { path: item.audio_path }); addToQueue([{ path: item.audio_path, size: metadata.size, libraryId: item.id, fileName: item.audio_name || item.name }]); }} />
                ) : showModels ? (
                    <ModelsPage models={models} storage={modelStorage} currentModel={currentModel} isTranscribing={isTranscribing} isModelLoading={isModelLoading} download={modelDownload} downloadError={modelDownloadError} onBack={() => setShowModels(false)} onRefresh={getModelStorage} onDownload={downloadModel} onCancelDownload={cancelModelDownload} onUse={loadModel} onRemove={deleteModel} onRemoveAll={deleteAllModels} />
                ) : showSettings ? (
                    <SettingsPage onBack={() => setShowSettings(false)} logs={backendLogs} isBackendReady={isBackendReady} isUsingMockBackend={isUsingMockBackend} error={error} updateCommand={updateCommand} updateBlocked={isTranscribing || isModelLoading || hasUnsaved(queue)} />
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
                        onRun={handleRunFile}
                        onListen={setListeningId}
                        onBatchExport={() => setShowBatchExport(true)}
                        onSaveLibrary={(id) => setLibrarySaveIds([id])}
                        onBatchSaveLibrary={() => setLibrarySaveIds(queue.filter((item) => item.status === "completed").map((item) => item.id))}
                        canRun={isBackendReady && !isTranscribing && !isModelLoading && !isStarting && Boolean(modelStorage) && !(currentModel?.endsWith(".en") && selectedLanguage !== "en") && !(selectedTask === "translate" && selectedModelInfo?.translation_support === false)}
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

                    <button onClick={() => { setShowSettings(false); setShowModels(true); }} className="card group mt-4 flex w-full items-center gap-3 p-4 text-left transition-colors hover:border-accent-500/40 hover:bg-surface-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-400">
                        <HardDrive className="h-4 w-4 shrink-0 text-accent-400" />
                        <span className="min-w-0 flex-1">
                            <span className="block text-xs font-semibold uppercase tracking-wider text-surface-300">Manage models</span>
                            <span className="mt-1 block text-xs text-surface-500">{modelStorage?.downloaded_count ?? "—"} downloaded</span>
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-surface-500 transition-colors group-hover:text-accent-400" aria-hidden="true" />
                    </button>

                    <button onClick={() => { setShowSettings(false); setShowModels(false); setShowLibrary(true); }} className="card group mt-4 flex w-full items-center gap-3 p-4 text-left transition-colors hover:border-accent-500/40 hover:bg-surface-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-400">
                        <LibraryBig className="h-4 w-4 shrink-0 text-accent-400" /><span className="min-w-0 flex-1"><span className="block text-xs font-semibold uppercase tracking-wider text-surface-300">Library</span><span className="mt-1 block text-xs text-surface-500">Saved recordings and transcripts</span></span><ArrowRight className="h-4 w-4 shrink-0 text-surface-500 group-hover:text-accent-400" aria-hidden="true" />
                    </button>

                    <div className="mt-4">
                        <ExportPanel result={displayedResult} selectedTranscriptView={selectedTranscriptView} showTranscriptViewSelector={displayedResultHasTranslation} onSaved={(view) => { if (selectedQueueItem?.result === displayedResult) markSaved(selectedQueueItem.id, view); }} />
                    </div>

                </aside>
                </>)}
            </div>

            <SaveLibraryDialog open={librarySaveIds !== null} onClose={() => setLibrarySaveIds(null)} items={queue.filter((item) => librarySaveIds?.includes(item.id))} command={updateCommand} onSaved={(queueItem, item, includedTranscript) => { linkQueueToLibrary(queueItem.id, item.id, includedTranscript ? queueItem.result : undefined); void refreshLibrary(); }} />
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
