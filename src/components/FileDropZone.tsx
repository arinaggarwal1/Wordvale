/**
 * FileDropZone.tsx
 * Drag-and-drop file upload zone with click-to-browse support.
 * In Tauri, uses the native file dialog and file-drop events
 * to get absolute file paths for the Python backend.
 */

import { useCallback, useEffect, useState } from "react";
import {
    Upload,
    Plus,
    ListOrdered,
    CheckCircle2,
    AlertCircle,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/tauri";

const IS_TAURI =
    typeof window !== "undefined" && "__TAURI__" in window;

interface FileDropZoneProps {
    onFilesSelected: (files: { path: string; size: number }[]) => void;
    isTranscribing: boolean;
    queueCount: number;
    pendingCount: number;
    completedCount: number;
    failedCount: number;
    queuedEstimate: string | null;
}

const ACCEPTED_EXTENSIONS = [
    "mp3", "wav", "flac", "ogg", "aac", "m4a",
    "wma", "opus", "webm", "mp4", "mkv", "avi",
    "mov", "wmv",
];

export default function FileDropZone({
    onFilesSelected,
    isTranscribing,
    queueCount,
    pendingCount,
    completedCount,
    failedCount,
    queuedEstimate,
}: FileDropZoneProps) {
    const [isDragOver, setIsDragOver] = useState(false);

    const processPaths = useCallback(async (paths: string[]) => {
        const validPaths = paths.filter((p) => {
            const ext = p.split(".").pop()?.toLowerCase() || "";
            return ACCEPTED_EXTENSIONS.includes(ext);
        });

        if (validPaths.length === 0) return;

        const filesWithMetadata = await Promise.all(validPaths.map(async (path) => {
            try {
                // Use custom backend command to get accurate size
                const meta = await invoke<{ size: number; is_file: boolean }>("get_file_metadata", { path });
                return { path, size: meta.size };
            } catch (e) {
                console.error(`Failed to get metadata for ${path}:`, e);
                return { path, size: 0 };
            }
        }));

        onFilesSelected(filesWithMetadata);
    }, [onFilesSelected]);

    // Listen for Tauri's native file drop events (provides absolute paths)
    useEffect(() => {
        if (!IS_TAURI) return;

        let unlisten: (() => void) | null = null;

        (async () => {
            try {
                const { listen } = await import("@tauri-apps/api/event");

                const unlistenHover = await listen<string[]>("tauri://file-drop-hover", () => {
                    setIsDragOver(true);
                });

                const unlistenCancelled = await listen("tauri://file-drop-cancelled", () => {
                    setIsDragOver(false);
                });

                const unlistenDrop = await listen<string[]>("tauri://file-drop", (event) => {
                    setIsDragOver(false);
                    if (isTranscribing) return;
                    processPaths(event.payload);
                });

                unlisten = () => {
                    unlistenHover();
                    unlistenCancelled();
                    unlistenDrop();
                };
            } catch (err) {
                console.error("Failed to listen for file drops:", err);
            }
        })();

        return () => {
            unlisten?.();
        };
    }, [isTranscribing, onFilesSelected]);

    // Open native file dialog (Tauri)
    const handleBrowseClick = useCallback(async () => {
        if (isTranscribing) return;

        if (IS_TAURI) {
            try {
                const { open } = await import("@tauri-apps/api/dialog");
                const result = await open({
                    multiple: true,
                    title: "Select Audio or Video Files",
                    filters: [
                        {
                            name: "Audio/Video",
                            extensions: ACCEPTED_EXTENSIONS,
                        },
                    ],
                });

                if (result) {
                    const paths = Array.isArray(result) ? result : [result];
                    if (paths.length > 0) {
                        processPaths(paths);
                    }
                }
            } catch (err) {
                console.error("Failed to open file dialog:", err);
            }
        } else {
            // Browser fallback — create a temporary file input
            const input = document.createElement("input");
            input.type = "file";
            input.multiple = true;
            input.accept = "audio/*,video/*,.mp3,.wav,.flac,.ogg,.m4a,.aac,.opus,.webm,.mp4,.mkv,.avi,.mov";
            input.onchange = () => {
                const files = Array.from(input.files || []);
                // Web files have size property directly
                const filesWithSize = files.map((f) => ({
                    path: f.name, // Web doesn't expose full path
                    size: f.size
                }));
                if (filesWithSize.length > 0) {
                    onFilesSelected(filesWithSize);
                }
            };
            input.click();
        }
    }, [isTranscribing, processPaths, onFilesSelected]);

    const hasFiles = queueCount > 0;

    return (
        <div className="animate-fade-in">
            {/* Drop zone */}
            <div
                onClick={handleBrowseClick}
                className={`
          relative rounded-xl border-2 border-dashed transition-all duration-300 cursor-pointer
          ${isDragOver
                        ? "border-accent-400 bg-accent-500/10 drop-zone-active"
                        : hasFiles
                            ? "border-surface-700/50 bg-surface-900/40 hover:border-surface-600"
                            : "border-surface-700/30 bg-surface-900/30 hover:border-accent-500/30 hover:bg-surface-900/50"
                    }
          ${isTranscribing ? "opacity-50 cursor-not-allowed" : ""}
        `}
            >
                {hasFiles ? (
                    /* ─── Queue summary ─── */
                    <div className="p-3.5 sm:p-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <span className="text-xs font-medium uppercase tracking-wider text-surface-400">
                                    Queue Ready
                                </span>
                                <p className="mt-1 text-sm font-semibold text-surface-100">
                                    {queueCount} {queueCount === 1 ? "file" : "files"} in this batch
                                </p>
                                <p className="mt-0.5 text-[11px] text-surface-500">
                                    Add more here, then manage the batch below.
                                </p>
                            </div>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleBrowseClick();
                                }}
                                className="btn-ghost text-xs gap-1 self-start"
                                disabled={isTranscribing}
                            >
                                <Plus className="w-3.5 h-3.5" />
                                Add More
                            </button>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                            <div className="rounded-full border border-surface-800/60 bg-surface-900/50 px-3 py-2">
                                <div className="flex items-center gap-2 text-surface-400">
                                    <ListOrdered className="w-4 h-4" />
                                    <span className="text-[11px] uppercase tracking-wider">Up Next</span>
                                </div>
                                <p className="mt-1 text-sm font-semibold text-surface-100">
                                    {pendingCount}
                                    <span className="ml-2 text-[11px] font-normal text-surface-500">
                                        {queuedEstimate ? `Est. ${queuedEstimate}` : "Ready"}
                                    </span>
                                </p>
                            </div>

                            <div className="rounded-full border border-surface-800/60 bg-surface-900/50 px-3 py-2">
                                <div className="flex items-center gap-2 text-surface-400">
                                    <CheckCircle2 className="w-4 h-4" />
                                    <span className="text-[11px] uppercase tracking-wider">Completed</span>
                                </div>
                                <p className="mt-1 text-sm font-semibold text-surface-100">{completedCount}</p>
                            </div>

                            <div className="rounded-full border border-surface-800/60 bg-surface-900/50 px-3 py-2">
                                <div className="flex items-center gap-2 text-surface-400">
                                    <AlertCircle className="w-4 h-4" />
                                    <span className="text-[11px] uppercase tracking-wider">Needs Attention</span>
                                </div>
                                <p className="mt-1 text-sm font-semibold text-surface-100">{failedCount}</p>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* ─── Empty state ─── */
                    <div className="flex flex-col items-center justify-center py-12 px-6">
                        <div
                            className={`
                w-16 h-16 rounded-2xl flex items-center justify-center mb-4 transition-all duration-300
                ${isDragOver ? "bg-accent-500/20 scale-110" : "bg-surface-800/60"}
              `}
                        >
                            <Upload
                                className={`w-7 h-7 transition-colors duration-300 ${isDragOver ? "text-accent-400" : "text-surface-400"
                                    }`}
                            />
                        </div>
                        <p className="text-sm font-medium text-surface-200 mb-1">
                            {isDragOver ? "Drop your files here" : "Drop audio or video files here"}
                        </p>
                        <p className="text-xs text-surface-500 text-center">
                            or click to browse · MP3, WAV, FLAC, M4A, OGG, MP4 and more
                        </p>
                        <div className="flex items-center gap-1.5 mt-4">
                            <kbd className="px-1.5 py-0.5 rounded bg-surface-800 text-[10px] text-surface-400 font-mono border border-surface-700/50">
                                ⌘
                            </kbd>
                            <kbd className="px-1.5 py-0.5 rounded bg-surface-800 text-[10px] text-surface-400 font-mono border border-surface-700/50">
                                O
                            </kbd>
                            <span className="text-[10px] text-surface-500 ml-0.5">
                                to open file
                            </span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
