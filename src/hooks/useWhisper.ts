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
    currentModel: string | null;
    systemInfo: SystemInfo | null;
    modelStorage: ModelStorageInfo | null;
    models: WhisperModel[];
    queue: QueueItem[];
    activeResult: TranscriptionResult | null;
    progress: ProgressUpdate | null;
    error: string | null;
    backendLogs: BackendDebugEntry[];
    isUsingMockBackend: boolean;

    // Actions
    loadModel: (modelName: string, forceCpu?: boolean) => Promise<void>;
    transcribeFile: (
        filePath: string,
        settings: AdvancedSettings,
        language: string,
        task: string
    ) => Promise<TranscriptionResult>;
    cancelTranscription: () => Promise<void>;
    addToQueue: (files: { path: string; size: number }[]) => void;
    removeFromQueue: (id: string) => void;
    reorderQueue: (fromIndex: number, toIndex: number) => void;
    processQueue: (settings: AdvancedSettings, language: string, task: string) => Promise<void>;
    clearError: () => void;
    getSystemInfo: () => Promise<void>;
    getModelStorage: () => Promise<void>;
    deleteModel: (modelName: string) => Promise<void>;
    deleteAllModels: () => Promise<void>;
    setActiveResult: (result: TranscriptionResult | null) => void;
}

let requestId = 0;
function nextId(): string {
    return `req_${++requestId}_${Date.now()}`;
}

export function useWhisper(): UseWhisperReturn {
    const [isBackendReady, setIsBackendReady] = useState(false);
    const [isModelLoading, setIsModelLoading] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [currentModel, setCurrentModel] = useState<string | null>(null);
    const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
    const [modelStorage, setModelStorage] = useState<ModelStorageInfo | null>(null);
    const [models, setModels] = useState<WhisperModel[]>([]);
    const [queue, setQueue] = useState<QueueItem[]>([]);
    const [activeResult, setActiveResult] = useState<TranscriptionResult | null>(null);
    const [progress, setProgress] = useState<ProgressUpdate | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [backendLogs, setBackendLogs] = useState<BackendDebugEntry[]>([]);
    const [isUsingMockBackend, setIsUsingMockBackend] = useState(false);

    // Backend process reference — holds a write function and kill function
    const backendProcess = useRef<{
        write: (data: string) => void;
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
                    backendProcess.current.write(msg + "\n");
                } else if (allowMockBackend.current) {
                    pushBackendLog("warn", `Backend unavailable, returning mock response for "${command}".`);
                    setTimeout(() => {
                        handleMockCommand(id, command, params, resolve);
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

    // Start the backend process
    useEffect(() => {
        async function startBackend() {
            if (IS_TAURI) {
                try {
                    const { Command } = await import("@tauri-apps/api/shell");
                    pushBackendLog(
                        "info",
                        `Starting backend in ${import.meta.env.PROD ? "production" : "development"} mode.`
                    );

                    let cmd;
                    if (import.meta.env.PROD) {
                        // Production Bundle: Use the standalone sidecar binary
                        pushBackendLog("info", 'Launching Tauri sidecar "binaries/whisper-backend".');
                        cmd = Command.sidecar("binaries/whisper-backend");
                    } else {
                        // Development: Use the shell script to run python from source
                        // This allows for hot-reloading backend changes without rebuilding the binary
                        pushBackendLog("info", 'Launching development backend via "bash ../backend/launch_backend.sh".');
                        cmd = new Command("bash", ["../backend/launch_backend.sh"]);
                    }

                    cmd.stdout.on("data", (line: string) => {
                        const trimmed = line.trim();
                        if (!trimmed) return;
                        pushBackendLog("info", `[stdout] ${trimmed}`);

                        try {
                            const response = JSON.parse(trimmed) as BackendResponse;
                            handleBackendMessage(response);
                        } catch {
                            // Already logged above
                        }
                    });

                    cmd.stderr.on("data", (line: string) => {
                        const trimmed = line.trim();
                        if (trimmed) {
                            pushBackendLog("warn", `[stderr] ${trimmed}`);
                        }
                    });


                    cmd.on("error", (err: Error) => {
                        pushBackendLog("error", `Backend process error: ${err.message}`);
                        setError("Backend process error: " + err.message);
                    });

                    cmd.on("close", (data: { code: number }) => {
                        pushBackendLog("warn", `Backend process closed with code ${data.code}.`);
                        setIsBackendReady(false);
                        backendProcess.current = null;
                    });

                    const child = await cmd.spawn();
                    allowMockBackend.current = false;
                    setIsUsingMockBackend(false);
                    pushBackendLog("info", `Backend spawned successfully with PID ${child.pid}.`);

                    backendProcess.current = {
                        write: (data: string) => {
                            child.write(data).catch((err: Error) => {
                                pushBackendLog("error", `Backend write error: ${err.message}`);
                            });
                        },
                        kill: () => {
                            child.kill().catch((err: Error) => {
                                pushBackendLog("error", `Backend kill error: ${err.message}`);
                            });
                        },
                    };
                } catch (err) {
                    const errMsg = err instanceof Error
                        ? err.message
                        : (typeof err === 'object' && err !== null && 'message' in err)
                            ? String((err as { message: unknown }).message)
                            : (typeof err === 'string')
                                ? err
                                : JSON.stringify(err) ?? 'Unknown error';
                    pushBackendLog("error", `Failed to start backend: ${errMsg}`);
                    setError(`Failed to start backend: ${errMsg}`);
                    setIsBackendReady(false);
                    backendProcess.current = null;
                }
            } else {
                // Dev mode — use mock backend
                pushBackendLog("warn", "Running outside Tauri. Falling back to mock backend.");
                initMockBackend();
            }
        }

        function initMockBackend() {
            allowMockBackend.current = true;
            setIsUsingMockBackend(true);
            setIsBackendReady(true);
            setSystemInfo({
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
            });
        }

        startBackend();

        return () => {
            backendProcess.current?.kill();
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

    async function loadModel(modelName: string, forceCpu = false) {
        setIsModelLoading(true);
        setError(null);
        try {
            const result = await sendCommand("load_model", {
                model: modelName,
                force_cpu: forceCpu,
            });
            setCurrentModel(modelName);
            if (result.device) {
                setSystemInfo((prev) =>
                    prev ? { ...prev, current_model: modelName, model_loaded: true } : prev
                );
            }
            await getModelStorage();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsModelLoading(false);
        }
    }

    async function transcribeFile(
        filePath: string,
        settings: AdvancedSettings,
        language: string,
        task: string
    ) {
        setIsTranscribing(true);
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
            const transcriptionResult = result as unknown as TranscriptionResult;
            setActiveResult(transcriptionResult);
            return transcriptionResult;
        } catch (err) {
            setError((err as Error).message);
            throw err;
        } finally {
            setIsTranscribing(false);
            setProgress(null);
        }
    }

    async function cancelTranscription() {
        isCancellingQueueRef.current = true;
        try {
            await sendCommand("cancel_transcription");
        } catch {
            // Ignore cancel errors
        }
        setIsTranscribing(false);
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
            setCurrentModel(null);
            setSystemInfo((prev) =>
                prev ? { ...prev, current_model: null, model_loaded: false } : prev
            );
            await Promise.all([getSystemInfo(), getModelStorage()]);
        } catch (err) {
            setError((err as Error).message);
            throw err;
        }
    }

    function addToQueue(files: { path: string; size: number }[]) {
        const newItems: QueueItem[] = files.map((file) => {
            const fileName = file.path.split("/").pop() || file.path;
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
            };
        });
        setQueue((prev) => [...prev, ...newItems]);
    }

    function removeFromQueue(id: string) {
        setQueue((prev) => prev.filter((item) => item.id !== id));
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

    useEffect(() => {
        if (!isTranscribing || !progress) return;

        setQueue((prev) => {
            const processingIndex = prev.findIndex((item) => item.status === "processing");
            if (processingIndex === -1) return prev;

            const processingItem = prev[processingIndex];
            const nextProgress = Math.max(
                processingItem.progress,
                Math.min(progress.percent ?? 0, 100)
            );

            if (nextProgress === processingItem.progress) return prev;

            const updated = [...prev];
            updated[processingIndex] = {
                ...processingItem,
                progress: nextProgress,
            };
            return updated;
        });
    }, [isTranscribing, progress]);

    async function processQueue(
        settings: AdvancedSettings,
        language: string,
        task: string
    ) {
        if (isProcessingQueueRef.current) return;

        isProcessingQueueRef.current = true;
        isCancellingQueueRef.current = false;
        setError(null);

        try {
            while (!isCancellingQueueRef.current) {
                const nextItem = queueRef.current.find((item) => item.status === "pending");
                if (!nextItem) break;

                updateQueueItem(nextItem.id, {
                    status: "processing",
                    progress: 0,
                    error: undefined,
                });

                try {
                    const result = await transcribeFile(nextItem.filePath, settings, language, task);
                    updateQueueItem(nextItem.id, {
                        status: "completed",
                        progress: 100,
                        result,
                        error: undefined,
                    });
                } catch (err) {
                    if (isCancellingQueueRef.current) {
                        updateQueueItem(nextItem.id, {
                            status: "pending",
                            progress: 0,
                            error: undefined,
                        });
                        break;
                    }

                    updateQueueItem(nextItem.id, {
                        status: "failed",
                        progress: 0,
                        error: (err as Error).message,
                    });
                }
            }
        } finally {
            isProcessingQueueRef.current = false;
            isCancellingQueueRef.current = false;
        }
    }

    function clearError() {
        setError(null);
    }

    return {
        isBackendReady,
        isModelLoading,
        isTranscribing,
        currentModel,
        systemInfo,
        modelStorage,
        models,
        queue,
        activeResult,
        progress,
        error,
        backendLogs,
        isUsingMockBackend,
        loadModel,
        transcribeFile,
        cancelTranscription,
        addToQueue,
        removeFromQueue,
        reorderQueue,
        processQueue,
        clearError,
        getSystemInfo,
        getModelStorage,
        deleteModel,
        deleteAllModels,
        setActiveResult,
    };
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
                segments: [
                    { id: 0, start: 0, end: 5, text: "This is a mock transcription result.", speaker: "[Speaker]" },
                    { id: 1, start: 5, end: 10, text: "Run via Tauri with the Python backend for real transcription.", speaker: "[Speaker]" },
                ],
                language: "en",
                duration_seconds: 1.2,
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
        { name: "large-v3-turbo", display_name: "Large v3 Turbo", parameter_count: "809M", parameter_count_raw: 809000000, estimated_vram_gb: 2.0, relative_speed: 16, multilingual_support: true, english_only_variant: null, translation_support: true, recommended_use_case: "Fast with near-large accuracy. Recommended.", accuracy_tier: "high" },
    ];
}
