/**
 * TranscriptionPanel.tsx
 * Main transcription output area with tabs for plain text, JSON, and word timestamps.
 * Includes streaming text display with copy-to-clipboard.
 */

import { useState, useRef, useEffect } from "react";
import {
    Copy,
    Check,
    FileText,
    Braces,
    Clock,
    Loader2,
    Info,
} from "lucide-react";
import type {
    TranscriptionResult,
    ProgressUpdate,
    TranscriptVariantData,
    TranscriptView,
} from "../types/models";
import { SUPPORTED_LANGUAGES } from "../types/models";

interface TranscriptionPanelProps {
    result: TranscriptionResult | null;
    selectedFile?: string;
    selectedStatus?: "pending" | "processing" | "completed" | "failed";
    progress: ProgressUpdate | null;
    isTranscribing: boolean;
    emptyStateMode?: "idle" | "select";
    selectedTranscriptView: TranscriptView;
    onTranscriptViewChange: (view: TranscriptView) => void;
}

type Tab = "transcript" | "json" | "timestamps" | "info";

function formatTimestamp(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}

export default function TranscriptionPanel({
    result,
    selectedFile,
    selectedStatus,
    progress,
    isTranscribing,
    emptyStateMode = "idle",
    selectedTranscriptView,
    onTranscriptViewChange,
}: TranscriptionPanelProps) {
    const [activeTab, setActiveTab] = useState<Tab>("transcript");
    const [copied, setCopied] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const hasTranslation = Boolean(result?.original && result?.english);
    const selectedTranscript: TranscriptVariantData | null = result
        ? hasTranslation
            ? selectedTranscriptView === "english"
                ? result.english || result.original || null
                : result.original || result.english || null
            : {
                text: result.text,
                srt: result.srt,
                segments: result.segments,
                language: result.language,
            }
        : null;
    const wordTimestamps = selectedTranscript
        ? selectedTranscript.segments.flatMap((segment) =>
            (segment.words || []).map((word) => ({
                ...word,
                segmentId: segment.id,
            }))
        )
        : [];

    const languageLabel = (code?: string) => code
        ? SUPPORTED_LANGUAGES.find((language) => language.code === code)?.name || code
        : "Unavailable";
    const infoRows = result ? [
        { label: "Model", value: result.model_used || "Unavailable" },
        { label: "Audio length", value: result.audio_duration_seconds != null ? formatTimestamp(result.audio_duration_seconds) : "Unavailable" },
        { label: "Processing time", value: `${result.duration_seconds.toFixed(2)} seconds` },
        { label: "Task", value: result.task === "translate" ? "Translate to English" : result.task === "transcribe" ? "Transcribe" : "Unavailable" },
        { label: "Language setting", value: languageLabel(result.requested_language) },
        { label: "Result language", value: languageLabel(result.original?.language || result.language) },
        { label: "Threads", value: result.run_settings ? String(result.run_settings.threads) : "Unavailable" },
        { label: "Word timestamps", value: result.run_settings ? (result.run_settings.wordTimestamps ? "On" : "Off") : "Unavailable" },
        { label: "Auto save", value: result.run_settings ? (result.run_settings.autoSaveOutput ? "On" : "Off") : "Unavailable" },
    ] : [];

    // Auto-scroll during transcription
    useEffect(() => {
        if (isTranscribing && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [progress, isTranscribing]);

    const handleCopy = async () => {
        if (!result) return;
        let text = "";
        switch (activeTab) {
            case "transcript":
                text = selectedTranscript?.text || "";
                break;
            case "json":
                text = JSON.stringify(selectedTranscript?.segments || [], null, 2);
                break;
            case "info":
                text = infoRows.map((row) => `${row.label}: ${row.value}`).join("\n");
                break;
            case "timestamps":
                text = wordTimestamps.length > 0
                    ? wordTimestamps
                        .map((word) => word.timing_unreliable ? `[Timing unavailable] ${word.word}` : `[${formatTimestamp(word.start)} -> ${formatTimestamp(word.end)}] ${word.word}`)
                        .join("\n")
                    : selectedTranscript?.srt || "";
                break;
        }
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Fallback
        }
    };

    const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
        { id: "transcript", label: "Transcript", icon: <FileText className="w-3.5 h-3.5" /> },
        { id: "json", label: "JSON", icon: <Braces className="w-3.5 h-3.5" /> },
        { id: "timestamps", label: "Timestamps", icon: <Clock className="w-3.5 h-3.5" /> },
        { id: "info", label: "Info", icon: <Info className="w-3.5 h-3.5" /> },
    ];

    const hasContent = result || isTranscribing;

    return (
        <div className="card flex flex-col h-full">
            {/* ─── Tab bar ─── */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-800/50 px-4 py-2">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`
                    flex items-center gap-1.5 px-4 py-3 text-xs font-medium transition-all border-b-2
                    ${activeTab === tab.id
                                        ? "text-accent-400 border-accent-400"
                                        : "text-surface-400 border-transparent hover:text-surface-200"
                                    }
                  `}
                            >
                                {tab.icon}
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {hasTranslation && activeTab !== "info" && (
                        <div className="flex items-center rounded-lg border border-surface-800/70 bg-surface-900/70 p-1">
                            <button
                                onClick={() => onTranscriptViewChange("original")}
                                className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                                    selectedTranscriptView === "original"
                                        ? "bg-accent-500/20 text-accent-300"
                                        : "text-surface-400 hover:text-surface-200"
                                }`}
                            >
                                Original
                            </button>
                            <button
                                onClick={() => onTranscriptViewChange("english")}
                                className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                                    selectedTranscriptView === "english"
                                        ? "bg-accent-500/20 text-accent-300"
                                        : "text-surface-400 hover:text-surface-200"
                                }`}
                            >
                                English
                            </button>
                        </div>
                    )}
                </div>

                {result && (
                    <button onClick={handleCopy} className="btn-ghost text-xs">
                        {copied ? (
                            <Check className="w-3.5 h-3.5 text-success-400" />
                        ) : (
                            <Copy className="w-3.5 h-3.5" />
                        )}
                        {copied ? "Copied" : "Copy"}
                    </button>
                )}
            </div>

            {/* ─── Content ─── */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4"
            >
                {!hasContent ? (
                    /* Empty state */
                    <div className="flex flex-col items-center justify-center h-full text-center">
                        <div className="w-14 h-14 rounded-2xl bg-surface-800/60 flex items-center justify-center mb-4">
                            <FileText className="w-6 h-6 text-surface-500" />
                        </div>
                        {selectedFile && selectedStatus && selectedStatus !== "processing" ? (
                            <>
                                <p className="text-sm text-surface-400 mb-1">{selectedFile}</p>
                                <p className="text-xs text-surface-500">{selectedStatus === "failed" ? "This file failed. Retry it from the queue." : "This file has not been transcribed yet."}</p>
                            </>
                        ) : emptyStateMode === "select" ? (
                            <>
                                <p className="text-sm text-surface-400 mb-1">Select a transcript</p>
                                <p className="text-xs text-surface-500">
                                    Choose a completed file from the queue to view its transcript.
                                </p>
                            </>
                        ) : (
                            <>
                                <p className="text-sm text-surface-400 mb-1">No transcription yet</p>
                                <p className="text-xs text-surface-500">
                                    Select an audio file and click Start to begin
                                </p>
                            </>
                        )}
                    </div>
                ) : isTranscribing && !result ? (
                    /* Loading state */
                    <div className="flex flex-col items-center justify-center h-full">
                        <Loader2 className="w-8 h-8 text-accent-400 animate-spin mb-4" />
                        <p className="text-sm text-surface-300">{progress?.message || "Processing..."}</p>
                        {progress?.file && (
                            <p className="text-xs text-surface-500 mt-1">{progress.file}</p>
                        )}
                    </div>
                ) : result ? (
                    /* Result content */
                    <div className="animate-fade-in">
                        <p className="text-xs text-surface-500 mb-3 break-words">{selectedFile || result.file}</p>
                        {activeTab === "transcript" && (
                            <div className="prose prose-invert max-w-none">
                                <p className="text-sm leading-relaxed text-surface-200 whitespace-pre-wrap font-sans">
                                    {selectedTranscript?.text}
                                </p>
                                {selectedTranscript?.language && (
                                    <div className="mt-4 pt-3 border-t border-surface-800/50">
                                        <span className="text-xs text-surface-500">
                                            {selectedTranscriptView === "english" && hasTranslation ? "Translated from" : result.requested_language && result.requested_language !== "auto" ? "Selected language" : "Detected language"}:{" "}
                                            <span className="text-surface-300">{selectedTranscript.language}</span>
                                            {" · "}
                                            Processed in <span className="text-accent-400">{result.duration_seconds}s</span>
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === "json" && (
                            <pre className="text-xs font-mono text-surface-300 whitespace-pre-wrap leading-relaxed">
                                {JSON.stringify(selectedTranscript?.segments || [], null, 2)}
                            </pre>
                        )}

                        {activeTab === "info" && (
                            <div className="max-w-3xl">
                                <h3 className="text-sm font-semibold text-surface-100">Transcription details</h3>
                                <p className="mt-1 text-xs leading-relaxed text-surface-500">Settings captured for this run. Processing time includes audio conversion and transcription{result.task === "translate" ? " and translation" : ""}.</p>
                                <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    {infoRows.map((row) => (
                                        <div key={row.label} className="rounded-xl border border-surface-800/70 bg-surface-900/50 px-4 py-3">
                                            <dt className="text-[10px] font-medium uppercase tracking-wider text-surface-500">{row.label}</dt>
                                            <dd className="mt-1.5 break-words text-sm font-medium text-surface-200">{row.value}</dd>
                                        </div>
                                    ))}
                                </dl>
                            </div>
                        )}

                        {activeTab === "timestamps" && (
                            wordTimestamps.length > 0 ? (
                                <div className="space-y-1">
                                    <div className="mb-2 px-3 text-[11px] uppercase tracking-wider text-surface-500">
                                        Word-level timestamps · approximate
                                    </div>
                                    {wordTimestamps.some((word) => word.timing_unreliable) && <p className="px-3 pb-2 text-xs text-warning-400">Some words have no usable timing. Their timestamps are shown as unavailable.</p>}
                                    {wordTimestamps.map((word, i) => (
                                        <div
                                            key={`${word.segmentId}-${i}-${word.start}`}
                                            className="flex gap-3 py-2 px-3 rounded-lg hover:bg-surface-800/40 transition-colors group"
                                        >
                                            <span className="text-[11px] font-mono text-accent-400/70 whitespace-nowrap pt-0.5 shrink-0">
                                                {word.timing_unreliable ? "Timing unavailable" : `${formatTimestamp(word.start)} → ${formatTimestamp(word.end)}`}
                                            </span>
                                            <span className="text-sm text-surface-200 leading-relaxed">
                                                {word.word}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    {(selectedTranscript?.segments || []).map((seg, i) => (
                                        <div
                                            key={i}
                                            className="flex gap-3 py-2 px-3 rounded-lg hover:bg-surface-800/40 transition-colors group"
                                        >
                                            <span className="text-[11px] font-mono text-accent-400/70 whitespace-nowrap pt-0.5 shrink-0">
                                                {formatTimestamp(seg.start)} → {formatTimestamp(seg.end)}
                                            </span>
                                            <span className="text-sm text-surface-200 leading-relaxed">
                                                {seg.text.trim()}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )
                        )}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
