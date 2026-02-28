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
} from "lucide-react";
import { invoke } from "@tauri-apps/api/tauri";
import { useWhisper } from "./hooks/useWhisper";
import { DEFAULT_SETTINGS } from "./types/models";
import type { AdvancedSettings } from "./types/models";
import { estimateTime, formatDuration } from "./constants";

import FileDropZone from "./components/FileDropZone";
import ModelSelector from "./components/ModelSelector";
import ModelInfoPanel from "./components/ModelInfoPanel";
import TranscriptionPanel from "./components/TranscriptionPanel";
import AdvancedSettingsPanel from "./components/AdvancedSettingsPanel";
import QueuePanel from "./components/QueuePanel";
import ExportPanel from "./components/ExportPanel";

export default function App() {
    const {
        isBackendReady,
        isModelLoading,
        isTranscribing,
        currentModel,
        systemInfo,
        models,
        queue,
        activeResult,
        progress,
        error,
        loadModel,
        transcribeFile,
        cancelTranscription,
        addToQueue,
        removeFromQueue,
        reorderQueue,
        clearError,
    } = useWhisper();

    const [settings, setSettings] = useState<AdvancedSettings>(DEFAULT_SETTINGS);
    const [selectedLanguage, setSelectedLanguage] = useState("auto");
    const [selectedTask, setSelectedTask] = useState("transcribe");
    const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
    const [elapsedTime, setElapsedTime] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
                    title: "Select Audio Files",
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
        if (isTranscribing || queue.length === 0) return;

        // Reset selection to follow progress
        setSelectedQueueId(null);

        // Load model if not loaded
        if (!currentModel) {
            await loadModel("base.en", settings.forceCpu);
        }

        // Process the first pending file
        const pending = queue.find((q) => q.status === "pending");
        if (pending) {
            await transcribeFile(
                pending.filePath,
                settings,
                settings.autoDetectLanguage ? "auto" : selectedLanguage,
                selectedTask
            );
        }
    }, [
        isTranscribing,
        queue,
        currentModel,
        loadModel,
        settings,
        transcribeFile,
        selectedLanguage,
        selectedTask,
    ]);

    const handleModelSelect = useCallback(
        (modelName: string) => {
            loadModel(modelName, settings.forceCpu);
        },
        [loadModel, settings.forceCpu]
    );

    const selectedModelInfo = models.find((m) => m.name === currentModel) || null;

    // Determine which result to display (selected item's result OR active streaming result)
    const selectedQueueItem = selectedQueueId ? queue.find((q) => q.id === selectedQueueId) : null;
    const displayedResult = selectedQueueItem?.result || activeResult;

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
                            isLoading={isModelLoading}
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
                        {isTranscribing ? (
                            <button
                                onClick={cancelTranscription}
                                className="w-full flex items-center justify-center gap-2 rounded-xl bg-danger-500/10 border border-danger-500/30
                           text-danger-400 py-3 text-sm font-semibold transition-all hover:bg-danger-500/20 active:scale-[0.98]"
                            >
                                <Square className="w-4 h-4" />
                                Stop
                            </button>
                        ) : (
                            <button
                                onClick={handleStart}
                                disabled={queue.length === 0 || isModelLoading}
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
                                        Start Transcription
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

                {/* ═══════════════ MAIN CONTENT ═══════════════ */}
                <main className="flex-1 flex flex-col min-w-0 p-5 gap-4 overflow-y-auto">
                    {/* File drop zone */}
                    <FileDropZone
                        onFilesSelected={addToQueue}
                        isTranscribing={isTranscribing}
                        selectedFiles={queue.map((q) => ({
                            fileName: q.fileName,
                            fileSizeMb: q.fileSizeMb,
                            estimate: formatDuration(estimateTime(q.fileSizeMb, currentModel)),
                        }))}
                    />

                    {/* Queue */}
                    <QueuePanel
                        queue={queue}
                        onRemove={removeFromQueue}
                        onReorder={reorderQueue}
                        currentModel={currentModel}
                        onSelect={setSelectedQueueId}
                        selectedId={selectedQueueId}
                    />

                    {/* Transcription output */}
                    <div className="flex-1 min-h-[300px]">
                        <TranscriptionPanel
                            result={displayedResult}
                            progress={progress}
                            isTranscribing={isTranscribing}
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
                        <ExportPanel result={displayedResult} />
                    </div>
                </aside>
            </div>

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
