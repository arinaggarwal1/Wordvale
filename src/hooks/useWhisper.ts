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
    BackendResponse,
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
    models: WhisperModel[];
    queue: QueueItem[];
    activeResult: TranscriptionResult | null;
    progress: ProgressUpdate | null;
    error: string | null;

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
    const [models, setModels] = useState<WhisperModel[]>([]);
    const [queue, setQueue] = useState<QueueItem[]>([]);
    const [activeResult, setActiveResult] = useState<TranscriptionResult | null>(null);
    const [progress, setProgress] = useState<ProgressUpdate | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Backend process reference — holds a write function and kill function
    const backendProcess = useRef<{
        write: (data: string) => void;
        kill: () => void;
    } | null>(null);

    // Pending requests awaiting responses
    const pendingRequests = useRef<
        Map<string, { resolve: (data: Record<string, unknown>) => void; reject: (err: Error) => void }>
    >(new Map());

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
                } else {
                    // Mock mode for development without Tauri
                    setTimeout(() => {
                        handleMockCommand(id, command, params, resolve);
                    }, 500);
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
        []
    );

    // Start the backend process
    useEffect(() => {
        async function startBackend() {
            if (IS_TAURI) {
                try {
                    const { Command } = await import("@tauri-apps/api/shell");

                    let cmd;
                    if (import.meta.env.PROD) {
                        // Production Bundle: Use the standalone sidecar binary
                        console.log("[Backend] Production mode: Launching sidecar binary");
                        cmd = Command.sidecar("binaries/whisper-backend");
                    } else {
                        // Development: Use the shell script to run python from source
                        // This allows for hot-reloading backend changes without rebuilding the binary
                        console.log("[Backend] Dev mode: Launching via shell script");
                        cmd = new Command("bash", ["../backend/launch_backend.sh"]);
                    }

                    cmd.stdout.on("data", (line: string) => {
                        const trimmed = line.trim();
                        if (!trimmed) return;
                        console.log("[Backend stdout]:", trimmed);

                        try {
                            const response = JSON.parse(trimmed) as BackendResponse;
                            handleBackendMessage(response);
                        } catch {
                            // Already logged above
                        }
                    });

                    cmd.stderr.on("data", (line: string) => {
                        console.error("[Backend stderr]:", line);
                    });


                    cmd.on("error", (err: Error) => {
                        console.error("[Backend error]", err);
                        setError("Backend process error: " + err.message);
                    });

                    cmd.on("close", (data: { code: number }) => {
                        console.log("[Backend closed] code:", data.code);
                        setIsBackendReady(false);
                        backendProcess.current = null;
                    });

                    const child = await cmd.spawn();
                    console.log("[Backend] Python process spawned, PID:", child.pid);

                    backendProcess.current = {
                        write: (data: string) => {
                            child.write(data).catch((err: Error) => {
                                console.error("[Backend write error]", err);
                            });
                        },
                        kill: () => {
                            child.kill().catch((err: Error) => {
                                console.error("[Backend kill error]", err);
                            });
                        },
                    };
                } catch (err) {
                    console.error("Failed to start backend:", err);
                    setError(
                        `Failed to start Python backend: ${(err instanceof Error ? err.message : String(err))}. ` +
                        `Make sure Python 3 is installed and 'openai-whisper' is available.`
                    );
                    // Fall back to mock mode
                    initMockBackend();
                }
            } else {
                // Dev mode — use mock backend
                console.log("[Backend] Running in browser dev mode with mock backend");
                initMockBackend();
            }
        }

        function initMockBackend() {
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
    }, [handleBackendMessage]);

    // Load models list on backend ready
    useEffect(() => {
        if (isBackendReady) {
            loadModelList();
            getSystemInfo();
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
        try {
            const result = await sendCommand("transcribe_file", {
                file_path: filePath,
                language: language === "auto" ? null : language,
                task,
                threads: settings.threads,
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
        try {
            await sendCommand("cancel_transcription");
        } catch {
            // Ignore cancel errors
        }
        setIsTranscribing(false);
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

    async function processQueue(
        settings: AdvancedSettings,
        language: string,
        task: string
    ) {
        const pending = queue.filter((item) => item.status === "pending");
        for (const item of pending) {
            updateQueueItem(item.id, { status: "processing", progress: 0 });
            try {
                const result = await transcribeFile(item.filePath, settings, language, task);
                updateQueueItem(item.id, {
                    status: "completed",
                    progress: 100,
                    result,
                });
            } catch (err) {
                updateQueueItem(item.id, {
                    status: "failed",
                    error: (err as Error).message,
                });
            }
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
        processQueue,
        clearError,
        getSystemInfo,
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
            });
            break;
        case "load_model":
            resolve({ status: "loaded", model: _params.model, device: "cpu" });
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
