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
} from "lucide-react";
import type { TranscriptionResult, ProgressUpdate } from "../types/models";

interface TranscriptionPanelProps {
    result: TranscriptionResult | null;
    progress: ProgressUpdate | null;
    isTranscribing: boolean;
}

type Tab = "transcript" | "json" | "timestamps";

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
    progress,
    isTranscribing,
}: TranscriptionPanelProps) {
    const [activeTab, setActiveTab] = useState<Tab>("transcript");
    const [copied, setCopied] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

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
                text = result.text;
                break;
            case "json":
                text = JSON.stringify(result.segments, null, 2);
                break;
            case "timestamps":
                text = result.srt;
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
    ];

    const hasContent = result || isTranscribing;

    return (
        <div className="card flex flex-col h-full">
            {/* ─── Tab bar ─── */}
            <div className="flex items-center justify-between border-b border-surface-800/50 px-4">
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
                        <p className="text-sm text-surface-400 mb-1">No transcription yet</p>
                        <p className="text-xs text-surface-500">
                            Select an audio file and click Start to begin
                        </p>
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
                        {activeTab === "transcript" && (
                            <div className="prose prose-invert max-w-none">
                                <p className="text-sm leading-relaxed text-surface-200 whitespace-pre-wrap font-sans">
                                    {result.text}
                                </p>
                                {result.language && (
                                    <div className="mt-4 pt-3 border-t border-surface-800/50">
                                        <span className="text-xs text-surface-500">
                                            Detected language: <span className="text-surface-300">{result.language}</span>
                                            {" · "}
                                            Processed in <span className="text-accent-400">{result.duration_seconds}s</span>
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === "json" && (
                            <pre className="text-xs font-mono text-surface-300 whitespace-pre-wrap leading-relaxed">
                                {JSON.stringify(result.segments, null, 2)}
                            </pre>
                        )}

                        {activeTab === "timestamps" && (
                            <div className="space-y-1">
                                {result.segments.map((seg, i) => (
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
                        )}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
