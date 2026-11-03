/**
 * hooks/useWhisper.ts
 * Core IPC hook — spawns Python backend process, sends JSON commands via stdin,
 * receives streaming JSON responses from stdout, and manages application state.
 *
 * In Tauri mode, uses @tauri-apps/api/shell Command to spawn `python3 backend/whisper_server.py`.
 * In dev/browser mode, falls back to a mock backend for UI development.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
    AdvancedSettings,
    BackendDebugEntry,
    BackendResponse,
    ModelStorageInfo,
    ModelDownload,
    ProgressUpdate,
    QueueItem,
    QueueItemStatus,
    SystemInfo,
    TranscriptionResult,
    WhisperModel,
} from "../types/models";

// Check if running inside Tauri
const IS_TAURI =
    typeof window !== "undefined" && "__TAURI__" in window;

interface UseWhisperReturn {
    // State
    isBackendReady: boolean;
    isModelLoading: boolean;
    isTranscribing: boolean;
    isStopping: boolean;
    currentModel: string | null;
    systemInfo: SystemInfo | null;
    modelStorage: ModelStorageInfo | null;
    modelDownload: ModelDownload | null;
    modelDownloadError: { model: string; message: string } | null;
    models: WhisperModel[];
    queue: QueueItem[];
    activeResult: TranscriptionResult | null;
    progress: ProgressUpdate | null;
    error: string | null;
    backendLogs: BackendDebugEntry[];
    isUsingMockBackend: boolean;

    // Actions
    loadModel: (modelName: string) => Promise<boolean>;
    downloadModel: (modelName: string) => Promise<void>;
    cancelModelDownload: () => Promise<void>;
    transcribeFile: (
        filePath: string,
        settings: AdvancedSettings,
        language: string,
        task: string
    ) => Promise<TranscriptionResult>;
    cancelTranscription: () => Promise<void>;
    addToQueue: (files: { path: string; size: number; libraryId?: string; fileName?: string }[]) => void;
    removeFromQueue: (id: string) => void;
    reorderQueue: (fromIndex: number, toIndex: number) => void;
    retryQueueItem: (id: string) => void;
    markSaved: (id: string, view: "original" | "english") => void;
    linkQueueToLibrary: (id: string, libraryId: string, result?: TranscriptionResult) => void;
    processQueue: (settings: AdvancedSettings, language: string, task: string, outputDir?: string, onlyId?: string) => Promise<string | undefined>;
    updateCommand: (command: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    clearError: () => void;
    getSystemInfo: () => Promise<void>;
    getModelStorage: () => Promise<void>;
    deleteModel: (modelName: string) => Promise<void>;
    deleteAllModels: () => Promise<void>;
    setActiveResult: (result: TranscriptionResult | null) => void;
}

let requestId = 0;
const LAST_MODEL_KEY = "wordvale.lastModel";
function nextId(): string {
    return `req_${++requestId}_${Date.now()}`;
}

export function useWhisper(): UseWhisperReturn {
    const [isBackendReady, setIsBackendReady] = useState(false);
    const [isModelLoading, setIsModelLoading] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [isStopping, setIsStopping] = useState(false);
    const [currentModel, setCurrentModel] = useState<string | null>(null);
    const restoredModel = useRef(false);
    const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
    const [modelStorage, setModelStorage] = useState<ModelStorageInfo | null>(null);
    const [modelDownload, setModelDownload] = useState<ModelDownload | null>(null);
    const [modelDownloadError, setModelDownloadError] = useState<{ model: string; message: string } | null>(null);
    const modelOperation = useRef(false);
    const [models, setModels] = useState<WhisperModel[]>([]);
    const [queue, setQueue] = useState<QueueItem[]>([]);
    const [activeResult, setActiveResult] = useState<TranscriptionResult | null>(null);
    const [progress, setProgress] = useState<ProgressUpdate | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [backendLogs, setBackendLogs] = useState<BackendDebugEntry[]>([]);
    const [isUsingMockBackend, setIsUsingMockBackend] = useState(false);

    // Backend process reference — holds a write function and kill function
    const backendProcess = useRef<{
        write: (data: string) => Promise<void>;
        kill: () => void;
    } | null>(null);

    // Pending requests awaiting responses
    const pendingRequests = useRef<
        Map<string, { resolve: (data: Record<string, unknown>) => void; reject: (err: Error) => void }>
    >(new Map());
    const allowMockBackend = useRef(false);
    const queueRef = useRef<QueueItem[]>([]);
    const isProcessingQueueRef = useRef(false);
    const isCancellingQueueRef = useRef(false);

    const pushBackendLog = useCallback((level: BackendDebugEntry["level"], message: string) => {
        const entry: BackendDebugEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
        };

        setBackendLogs((prev) => [...prev.slice(-199), entry]);

        if (level === "error") {
            console.error("[Backend Debug]", message);
        } else if (level === "warn") {
            console.warn("[Backend Debug]", message);
        } else {
            console.log("[Backend Debug]", message);
        }
    }, []);

    useEffect(() => {
        queueRef.current = queue;
    }, [queue]);

    // Handle incoming JSON messages from backend stdout
    const handleBackendMessage = useCallback((response: BackendResponse) => {
        console.log("[Backend →]", response);

        if (response.type === "ready") {
            setIsBackendReady(true);
            return;
        }

        if (response.type === "model_download") {
            setModelDownload((previous) => ({ ...response.data as unknown as ModelDownload, cancelling: previous?.cancelling }));
            return;
        }
        if (response.type === "progress") {
            setProgress(response.data as unknown as ProgressUpdate);
            return;
        }

        if (response.type === "error") {
            setError(response.data.error as string);
            return;
        }

        if (response.type === "response" && response.id) {
            const pending = pendingRequests.current.get(response.id);
            if (pending) {
                pendingRequests.current.delete(response.id);
                if (response.data.status === "error") {
                    pending.reject(new Error(response.data.error as string));
                } else {
                    pending.resolve(response.data);
                }
            }
        }
    }, []);

    // Send a JSON command to the backend
    const sendCommand = useCallback(
        (command: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
            return new Promise((resolve, reject) => {
                const id = nextId();
                const msg = JSON.stringify({ id, command, params });

                console.log("[→ Backend]", command, params);

                pendingRequests.current.set(id, { resolve, reject });

                if (backendProcess.current) {
                    backendProcess.current.write(msg + "\n").catch((err: Error) => {
                        const pending = pendingRequests.current.get(id);
                        if (pending) {
                            pendingRequests.current.delete(id);
                            pending.reject(new Error(`Could not send to the backend: ${err.message}`));
                        }
                    });
                } else if (allowMockBackend.current) {
                    pushBackendLog("warn", `Backend unavailable, returning mock response for "${command}".`);
                    setTimeout(() => {
                        handleMockCommand(id, command, params, (data) => {
                            pendingRequests.current.delete(id);
                            resolve(data);
                        });
                    }, 500);
                } else {
                    pendingRequests.current.delete(id);
                    reject(new Error("Backend is not running. Open Backend Debug for startup details."));
                }

                // Timeout after 2 hours (long audio files can take significant time:
                // ffmpeg conversion + whisper.cpp transcription for 70+ min files)
                setTimeout(() => {
                    if (pendingRequests.current.has(id)) {
                        pendingRequests.current.delete(id);
                        reject(new Error("Command timed out"));
                    }
                }, 7_200_000);
            });
        },
        [pushBackendLog]
    );

    // Start the backend process. Each effect owns its own child, including when
    // React StrictMode or hot reload tears down an in-flight startup.
    useEffect(() => {
        let disposed = false;
        let readyReceived = false;
        let closed = false;
        let ownedProcess: typeof backendProcess.current = null;

        function markReady() {
            if (disposed || closed || !readyReceived || !ownedProcess || backendProcess.current !== ownedProcess) return;
            setIsBackendReady(true);
            setError((previous) => previous === "Backend is not running. Open Backend Debug for startup details." ? null : previous);
        }

        async function startBackend() {
            if (IS_TAURI) {
                try {
                    const { Command } = await import("@tauri-apps/api/shell");
                    if (disposed) return;
                    pushBackendLog("info", `Starting backend in ${import.meta.env.PROD ? "production" : "development"} mode.`);
                    const cmd = import.meta.env.PROD
                        ? Command.sidecar("binaries/whisper-backend")
                        : new Command("bash", ["../backend/launch_backend.sh"]);
                    pushBackendLog("info", import.meta.env.PROD ? "Launching backend sidecar." : "Launching development backend.");

                    cmd.stdout.on("data", (line: string) => {
                        if (disposed || closed) return;
                        const trimmed = line.trim();
                        if (!trimmed) return;
                        pushBackendLog("info", `[stdout] ${trimmed}`);
                        try {
                            const response = JSON.parse(trimmed) as BackendResponse;
                            if (response.type === "ready") {
                                readyReceived = true;
                                markReady();
                            } else {
                                handleBackendMessage(response);
                            }
                        } catch {
                            // Non-JSON output is retained in the debug log.
                        }
                    });
                    cmd.stderr.on("data", (line: string) => {
                        if (!disposed && line.trim()) pushBackendLog("warn", `[stderr] ${line.trim()}`);
                    });
                    cmd.on("error", (err: Error) => {
                        if (disposed) return;
                        pushBackendLog("error", `Backend process error: ${err.message}`);
                        setError("Backend process error: " + err.message);
                    });
                    cmd.on("close", (data: { code: number }) => {
                        closed = true;
                        if (disposed || !ownedProcess || backendProcess.current !== ownedProcess) return;
                        pushBackendLog("warn", `Backend process closed with code ${data.code}.`);
                        setIsBackendReady(false);
                        backendProcess.current = null;
                        for (const pending of pendingRequests.current.values()) pending.reject(new Error("The backend stopped. Restart the app and try again."));
                        pendingRequests.current.clear();
                        setError("The backend stopped. Restart the app and try again.");
                    });

                    const child = await cmd.spawn();
                    if (disposed || closed) {
                        await child.kill().catch(() => {});
                        if (closed && !disposed) throw new Error("Backend exited during startup.");
                        return;
                    }
                    ownedProcess = {
                        write: (data: string) => child.write(data),
                        kill: () => { void child.kill().catch((err: Error) => pushBackendLog("error", `Backend kill error: ${err.message}`)); },
                    };
                    backendProcess.current = ownedProcess;
                    allowMockBackend.current = false;
                    setIsUsingMockBackend(false);
                    pushBackendLog("info", `Backend spawned successfully with PID ${child.pid}.`);
                    markReady();
                } catch (err) {
                    if (disposed) return;
                    const message = err instanceof Error ? err.message : String(err);
                    pushBackendLog("error", `Failed to start backend: ${message}`);
                    setError(`Failed to start backend: ${message}`);
                    setIsBackendReady(false);
                }
            } else if (!disposed) {
                allowMockBackend.current = true;
                setIsUsingMockBackend(true);
                setIsBackendReady(true);
                setSystemInfo({
                    gpu_available: false, gpu_name: null, gpu_vram_total_gb: 0,
                    device: "cpu", force_cpu: false, current_model: null, model_loaded: false,
                    cpu_count: 8, ram_total_gb: 16, ram_available_gb: 8,
                });
            }
        }

        void startBackend();
        return () => {
            disposed = true;
            if (ownedProcess && backendProcess.current === ownedProcess) backendProcess.current = null;
            ownedProcess?.kill();
            allowMockBackend.current = false;
        };
    }, [handleBackendMessage, pushBackendLog]);

    // Load models list on backend ready
    useEffect(() => {
        if (isBackendReady) {
            loadModelList();
            getSystemInfo();
            getModelStorage();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isBackendReady]);

    useEffect(() => {
        if (restoredModel.current || !isBackendReady || !modelStorage || models.length === 0) return;
        restoredModel.current = true;
        let saved: string | null = null;
        try { saved = localStorage.getItem(LAST_MODEL_KEY) ?? localStorage.getItem("whisper" + "desk.lastModel"); } catch { /* Storage can be unavailable. */ }
        if (saved && modelStorage.downloaded_models.some((model) => model.name === saved)) {
            void loadModel(saved);
        } else if (saved) {
            try { localStorage.removeItem(LAST_MODEL_KEY); localStorage.removeItem("whisper" + "desk.lastModel"); } catch { /* Ignore unavailable storage. */ }
        }
    }, [isBackendReady, modelStorage, models]);

    // ─── Actions ───

    async function loadModelList() {
        try {
            const result = await sendCommand("get_all_models");
            if (result.models) {
                setModels(result.models as WhisperModel[]);
            }
        } catch {
            // Use built-in fallback models
            setModels(getDefaultModels());
        }
    }

    async function getSystemInfo() {
        try {
            const result = await sendCommand("get_system_info");
            setSystemInfo(result as unknown as SystemInfo);
        } catch {
            // Keep existing mock info
        }
    }

    async function getModelStorage() {
        try {
            const result = await sendCommand("get_model_storage");
            setModelStorage(result as unknown as ModelStorageInfo);
        } catch (err) {
            setError((err as Error).message);
        }
    }

    async function runModelOperation(modelName: string, activate: boolean): Promise<boolean> {
        if (modelOperation.current) return false;
        modelOperation.current = true;
        setIsModelLoading(true);
        setModelDownloadError(null);
        setError(null);
        try {
            const result = await sendCommand(activate ? "load_model" : "download_model", { model: modelName });
            if (result.status === "cancelled") return false;
            if (activate) {
                setCurrentModel(modelName);
                try { localStorage.setItem(LAST_MODEL_KEY, modelName); } catch { /* Model still loads for this session. */ }
                setSystemInfo((prev) => prev ? { ...prev, current_model: modelName, model_loaded: true } : prev);
            }
            await getModelStorage();
            return true;
        } catch (err) {
            const message = (err as Error).message;
            setModelDownloadError({ model: modelName, message });
            setError(message);
            return false;
        } finally {
            modelOperation.current = false;
            setModelDownload(null);
            setIsModelLoading(false);
        }
    }

    async function loadModel(modelName: string) {
        return runModelOperation(modelName, true);
    }

    async function downloadModel(modelName: string) {
        await runModelOperation(modelName, false);
    }

    async function cancelModelDownload() {
        setModelDownload((previous) => previous ? { ...previous, cancelling: true } : previous);
        try { await sendCommand("cancel_model_download"); }
        catch (err) { setError(`Could not cancel download: ${(err as Error).message}`); }
    }

    async function transcribeFile(
        filePath: string,
        settings: AdvancedSettings,
        language: string,
        task: string
    ) {
        setProgress(null);
        setError(null);
        setActiveResult(null);
        try {
            const result = await sendCommand("transcribe_file", {
                file_path: filePath,
                language: language === "auto" ? null : language,
                task,
                threads: settings.threads,
                word_timestamps: settings.wordTimestamps,
            });
            if (result.status === "cancelled") throw new Error("Transcription cancelled");
            const transcriptionResult = {
                ...result,
                requested_language: language,
                run_settings: { threads: settings.threads, wordTimestamps: settings.wordTimestamps, autoSaveOutput: settings.autoSaveOutput },
            } as unknown as TranscriptionResult;
            setActiveResult(transcriptionResult);
            return transcriptionResult;
        } catch (err) {
            if (!isCancellingQueueRef.current) setError((err as Error).message);
            throw err;
        } finally {
            setProgress(null);
        }
    }

    async function cancelTranscription() {
        if (isCancellingQueueRef.current) return;
        isCancellingQueueRef.current = true;
        setIsStopping(true);
        try {
            await sendCommand("cancel_transcription");
        } catch (err) {
            setError(`Could not stop transcription: ${(err as Error).message}`);
        }
    }

    async function deleteModel(modelName: string) {
        setError(null);
        try {
            const result = await sendCommand("delete_model", { model: modelName });
            if (result.status === "error") {
                throw new Error(result.error as string);
            }
            if (currentModel === modelName) {
                setCurrentModel(null);
                try { localStorage.removeItem(LAST_MODEL_KEY); localStorage.removeItem("whisper" + "desk.lastModel"); } catch { /* Ignore unavailable storage. */ }
                setSystemInfo((prev) =>
                    prev ? { ...prev, current_model: null, model_loaded: false } : prev
                );
            }
            await Promise.all([getSystemInfo(), getModelStorage()]);
        } catch (err) {
            setError((err as Error).message);
            throw err;
        }
    }

    async function deleteAllModels() {
        setError(null);
        try {
            const result = await sendCommand("delete_all_models");
            if (result.status === "error") {
                throw new Error(result.error as string);
            }
            if (result.status === "partial") {
                await Promise.all([getSystemInfo(), getModelStorage()]);
                const deleted = result.deleted_models as string[];
                if (currentModel && deleted.includes(currentModel)) {
                    setCurrentModel(null);
                    try { localStorage.removeItem(LAST_MODEL_KEY); localStorage.removeItem("whisper" + "desk.lastModel"); } catch { /* Ignore unavailable storage. */ }
                }
                throw new Error("Some models could not be removed. Refresh the list and try again.");
            }
            setCurrentModel(null);
            try { localStorage.removeItem(LAST_MODEL_KEY); localStorage.removeItem("whisper" + "desk.lastModel"); } catch { /* Ignore unavailable storage. */ }
            setSystemInfo((prev) =>
                prev ? { ...prev, current_model: null, model_loaded: false } : prev
            );
            await Promise.all([getSystemInfo(), getModelStorage()]);
        } catch (err) {
            setError((err as Error).message);
            throw err;
        }
    }

    function addToQueue(files: { path: string; size: number; libraryId?: string; fileName?: string }[]) {
        const newItems: QueueItem[] = files.map((file) => {
            const fileName = file.fileName || file.path.split("/").pop() || file.path;
            const format = fileName.split(".").pop() || "unknown";
            const fileSizeMb = parseFloat((file.size / (1024 * 1024)).toFixed(2));

            return {
                id: `queue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                filePath: file.path,
                fileName,
                fileSizeMb,
                format,
                status: "pending" as QueueItemStatus,
                progress: 0,
                addedAt: Date.now(),
                libraryId: file.libraryId,
            };
        });
        setQueue((prev) => [...prev, ...newItems]);
    }

    function removeFromQueue(id: string) {
        setQueue((prev) => prev.filter((item) => item.id !== id));
    }

    function retryQueueItem(id: string) {
        setQueue((prev) => prev.map((item) => item.id === id && item.status === "failed" ? { ...item, status: "pending", progress: 0, error: undefined } : item));
    }

    function markSaved(id: string, view: "original" | "english") {
        setQueue((prev) => prev.map((item) => {
            if (item.id !== id) return item;
            const savedViews = Array.from(new Set([...(item.savedViews || []), view]));
            const allSaved = savedViews.includes("original") && (!item.result?.english || savedViews.includes("english"));
            return { ...item, savedViews, saveError: allSaved ? undefined : item.saveError };
        }));
    }

    function linkQueueToLibrary(id: string, libraryId: string, result?: TranscriptionResult) {
        setQueue((prev) => prev.map((item) => item.id === id ? {
            ...item,
            libraryId,
            savedViews: result && item.result === result ? (result.original && result.english ? ["original", "english"] : ["original"]) : item.savedViews,
        } : item));
    }

    function reorderQueue(fromIndex: number, toIndex: number) {
        setQueue((prev) => {
            const items = [...prev];
            const [moved] = items.splice(fromIndex, 1);
            items.splice(toIndex, 0, moved);
            return items;
        });
    }

    function updateQueueItem(id: string, updates: Partial<QueueItem>) {
        setQueue((prev) =>
            prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
        );
    }

    async function processQueue(
        settings: AdvancedSettings,
        language: string,
        task: string,
        outputDir?: string,
        onlyId?: string
    ) {
        if (isProcessingQueueRef.current) return;

        isProcessingQueueRef.current = true;
        setIsTranscribing(true);
        isCancellingQueueRef.current = false;
        setError(null);
        let lastCompletedId: string | undefined;

        try {
            while (!isCancellingQueueRef.current) {
                const nextItem = onlyId
                    ? queueRef.current.find((item) => item.id === onlyId && item.status !== "processing")
                    : queueRef.current.find((item) => item.status === "pending");
                if (!nextItem) break;

                updateQueueItem(nextItem.id, {
                    status: "processing",
                    progress: 0,
                    error: undefined,
                });

                try {
                    const transcribed = await transcribeFile(nextItem.filePath, settings, language, task);
                    const result = nextItem.libraryId ? { ...transcribed, file: nextItem.fileName } : transcribed;
                    let savedViews: ("original" | "english")[] = [];
                    let saveError: string | undefined;
                    if (nextItem.libraryId) {
                        try {
                            await sendCommand("library_set_transcript", { id: nextItem.libraryId, transcript: result });
                            savedViews = result.original && result.english ? ["original", "english"] : ["original"];
                            window.dispatchEvent(new Event("wordvale-library-changed"));
                        } catch (err) {
                            saveError = `Library update failed: ${String(err)}. Save this transcript manually.`;
                            setError(saveError);
                        }
                    }
                    if (outputDir) {
                        try {
                            savedViews = Array.from(new Set([...savedViews, ...await autoSaveResult(outputDir, result)]));
                        } catch (err) {
                            saveError = `Auto-save failed: ${String(err)}. Save the transcript manually.`;
                            setError(saveError);
                        }
                    }
                    updateQueueItem(nextItem.id, {
                        status: "completed",
                        progress: 100,
                        result,
                        savedViews,
                        saveError,
                        error: undefined,
                    });
                    lastCompletedId = nextItem.id;
                } catch (err) {
                    if (isCancellingQueueRef.current) {
                        updateQueueItem(nextItem.id, {
                            status: onlyId ? nextItem.status : "pending",
                            progress: onlyId ? nextItem.progress : 0,
                            error: onlyId ? nextItem.error : undefined,
                        });
                        break;
                    }

                    updateQueueItem(nextItem.id, {
                        status: "failed",
                        progress: 0,
                        error: (err as Error).message,
                    });
                }
                if (onlyId) break;
            }
        } finally {
            isProcessingQueueRef.current = false;
            setIsTranscribing(false);
            isCancellingQueueRef.current = false;
            setIsStopping(false);
        }
        return lastCompletedId;
    }

    function clearError() {
        setError(null);
    }

    return {
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
        transcribeFile,
        cancelTranscription,
        addToQueue,
        removeFromQueue,
        reorderQueue,
        retryQueueItem,
        markSaved,
        linkQueueToLibrary,
        processQueue,
        updateCommand: sendCommand,
        clearError,
        getSystemInfo,
        getModelStorage,
        deleteModel,
        deleteAllModels,
        setActiveResult,
    };
}

async function autoSaveResult(directory: string, result: TranscriptionResult): Promise<("original" | "english")[]> {
    const { invoke } = await import("@tauri-apps/api/tauri");
    const base = result.file.replace(/\.[^.]+$/, "") || "transcript";
    const translated = Boolean(result.original && result.english);
    const variants: { view: "original" | "english"; filename: string; text: string }[] = translated
        ? [
            { view: "original", filename: `${base}_original.txt`, text: result.original!.text },
            { view: "english", filename: `${base}_english.txt`, text: result.english!.text },
        ]
        : [{ view: "original", filename: `${base}.txt`, text: result.text }];
    const saved: ("original" | "english")[] = [];
    for (const variant of variants) {
        await invoke("save_transcript_copy", { directory, filename: variant.filename, content: variant.text });
        saved.push(variant.view);
    }
    return saved;
}

// ─── Mock command handler for dev mode ───

function handleMockCommand(
    _id: string,
    command: string,
    _params: Record<string, unknown>,
    resolve: (data: Record<string, unknown>) => void
) {
    switch (command) {
        case "get_all_models":
            resolve({ models: getDefaultModels(), names: getDefaultModels().map((m) => m.name) });
            break;
        case "get_system_info":
            resolve({
                gpu_available: false,
                gpu_name: null,
                gpu_vram_total_gb: 0,
                device: "cpu",
                force_cpu: false,
                current_model: null,
                model_loaded: false,
                cpu_count: 8,
                ram_total_gb: 16,
                ram_available_gb: 8,
                ffmpeg_available: true,
                ffmpeg_path: "/mock/ffmpeg",
                downloaded_models: [],
                downloaded_models_info: [],
                models_dir: "/mock/models",
            });
            break;
        case "get_model_storage":
            resolve({
                models_dir: "/mock/models",
                downloaded_models: [],
                downloaded_count: 0,
                total_size_bytes: 0,
                total_size_mb: 0,
                active_model: null,
            });
            break;
        case "download_model":
            resolve({ status: "downloaded", model: _params.model });
            break;
        case "cancel_model_download":
            resolve({ status: "cancelling" });
            break;
        case "load_model":
            resolve({ status: "loaded", model: _params.model, device: "cpu" });
            break;
        case "delete_model":
            resolve({ status: "deleted", model: _params.model });
            break;
        case "delete_all_models":
            resolve({ status: "deleted_all", deleted_models: [], errors: [] });
            break;
        case "transcribe_file":
            resolve({
                status: "completed",
                text: "This is a mock transcription result. In production, run via 'npm run tauri dev' with the Python backend to get real Whisper transcription.",
                srt: "1\n00:00:00,000 --> 00:00:05,000\nThis is a mock transcription result.\n\n2\n00:00:05,000 --> 00:00:10,000\nRun via Tauri with the Python backend for real transcription.\n",
                ass: "[Script Info]\nScriptType: v4.00+\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,48,&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000,0,0,1,2,0,2,10,10,40,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,{\\k100}This {\\k100}is {\\k100}a {\\k100}mock {\\k100}transcription {\\k100}result.\n",
                segments: [
                    { id: 0, start: 0, end: 5, text: "This is a mock transcription result.", speaker: "[Speaker]" },
                    { id: 1, start: 5, end: 10, text: "Run via Tauri with the Python backend for real transcription.", speaker: "[Speaker]" },
                ],
                language: "en",
                duration_seconds: 1.2,
                audio_duration_seconds: 10,
                model_used: "mock",
                file: "sample.mp3",
                file_path: "/path/to/sample.mp3",
            });
            break;
        case "cancel_transcription":
            resolve({ status: "cancelled" });
            break;
        default:
            resolve({ status: "ok" });
    }
}

// ─── Default model list (fallback without backend) ───

function getDefaultModels(): WhisperModel[] {
    return [
        { name: "tiny", display_name: "Tiny", parameter_count: "39M", parameter_count_raw: 39000000, estimated_vram_gb: 0.3, relative_speed: 32, multilingual_support: true, english_only_variant: "tiny.en", translation_support: true, recommended_use_case: "Quick drafts and testing", accuracy_tier: "low" },
        { name: "tiny.en", display_name: "Tiny (English)", parameter_count: "39M", parameter_count_raw: 39000000, estimated_vram_gb: 0.3, relative_speed: 32, multilingual_support: false, english_only_variant: null, translation_support: false, recommended_use_case: "Fastest English-only", accuracy_tier: "low" },
        { name: "base", display_name: "Base", parameter_count: "74M", parameter_count_raw: 74000000, estimated_vram_gb: 0.4, relative_speed: 24, multilingual_support: true, english_only_variant: "base.en", translation_support: true, recommended_use_case: "Good balance for quick transcriptions", accuracy_tier: "low-medium" },
        { name: "base.en", display_name: "Base (English)", parameter_count: "74M", parameter_count_raw: 74000000, estimated_vram_gb: 0.4, relative_speed: 24, multilingual_support: false, english_only_variant: null, translation_support: false, recommended_use_case: "Reliable English-only", accuracy_tier: "low-medium" },
        { name: "small", display_name: "Small", parameter_count: "244M", parameter_count_raw: 244000000, estimated_vram_gb: 0.9, relative_speed: 16, multilingual_support: true, english_only_variant: "small.en", translation_support: true, recommended_use_case: "Good accuracy for most languages", accuracy_tier: "medium" },
        { name: "small.en", display_name: "Small (English)", parameter_count: "244M", parameter_count_raw: 244000000, estimated_vram_gb: 0.9, relative_speed: 16, multilingual_support: false, english_only_variant: null, translation_support: false, recommended_use_case: "Strong English-only accuracy", accuracy_tier: "medium" },
        { name: "medium", display_name: "Medium", parameter_count: "769M", parameter_count_raw: 769000000, estimated_vram_gb: 2.1, relative_speed: 8, multilingual_support: true, english_only_variant: "medium.en", translation_support: true, recommended_use_case: "High accuracy for most languages", accuracy_tier: "high" },
        { name: "medium.en", display_name: "Medium (English)", parameter_count: "769M", parameter_count_raw: 769000000, estimated_vram_gb: 2.1, relative_speed: 8, multilingual_support: false, english_only_variant: null, translation_support: false, recommended_use_case: "Professional-grade English", accuracy_tier: "high" },
        { name: "large-v3", display_name: "Large v3", parameter_count: "1550M", parameter_count_raw: 1550000000, estimated_vram_gb: 3.9, relative_speed: 4, multilingual_support: true, english_only_variant: null, translation_support: true, recommended_use_case: "Maximum accuracy across all languages", accuracy_tier: "very-high" },
        { name: "large-v3-turbo", display_name: "Large v3 Turbo", parameter_count: "809M", parameter_count_raw: 809000000, estimated_vram_gb: 2.0, relative_speed: 16, multilingual_support: true, english_only_variant: null, translation_support: false, recommended_use_case: "Fast with near-large accuracy. Recommended.", accuracy_tier: "high" },
    ];
}
