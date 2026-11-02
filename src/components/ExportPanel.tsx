/**
 * ExportPanel.tsx
 * Export controls for saving transcription output as TXT, SRT, or JSON.
 * Uses native Tauri save dialog for better user experience.
 */

import { useEffect, useState } from "react";
import {
    Download,
    FileText,
    Subtitles,
    Braces,
    Clock,
    Check,
} from "lucide-react";
import { save } from "@tauri-apps/api/dialog";
import { writeTextFile } from "@tauri-apps/api/fs";
import type {
    TranscriptionResult,
    ExportFormat,
    TranscriptVariantData,
    TranscriptView,
} from "../types/models";

interface ExportPanelProps {
    result: TranscriptionResult | null;
    selectedTranscriptView: TranscriptView;
    showTranscriptViewSelector: boolean;
    onSaved: (view: TranscriptView) => void;
}

const formats: {
    id: ExportFormat;
    label: string;
    icon: React.ReactNode;
    ext: string;
    timestamps?: boolean;
    requiresWordTimestamps?: boolean;
}[] = [
    { id: "txt", label: "Text", icon: <FileText className="w-4 h-4" />, ext: ".txt", timestamps: false },
    { id: "txt", label: "Timed text", icon: <Clock className="w-4 h-4" />, ext: ".txt", timestamps: true },
    { id: "srt", label: "SRT", icon: <Subtitles className="w-4 h-4" />, ext: ".srt" },
    { id: "json", label: "JSON", icon: <Braces className="w-4 h-4" />, ext: ".json" },
    { id: "ass", label: "ASS", icon: <Subtitles className="w-4 h-4" />, ext: ".ass", requiresWordTimestamps: true },
];

export default function ExportPanel({
    result,
    selectedTranscriptView,
    showTranscriptViewSelector,
    onSaved,
}: ExportPanelProps) {
    const [selectedIdx, setSelectedIdx] = useState(0);
    const [isSaving, setIsSaving] = useState(false);
    const [exported, setExported] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const selectedTranscript: TranscriptVariantData | null = result
        ? showTranscriptViewSelector
            ? selectedTranscriptView === "english"
                ? result.english || result.original || {
                    text: result.text,
                    srt: result.srt,
                    ass: result.ass,
                    segments: result.segments,
                    language: result.language,
                }
                : result.original || result.english || {
                    text: result.text,
                    srt: result.srt,
                    ass: result.ass,
                    segments: result.segments,
                    language: result.language,
                }
            : {
                text: result.text,
                srt: result.srt,
                ass: result.ass,
                segments: result.segments,
                language: result.language,
            }
        : null;
    const hasUnreliableTiming = Boolean(selectedTranscript?.segments.some((segment) =>
        segment.words?.some((word) => word.timing_unreliable)
    ));
    const hasWordTimestamps = Boolean(
        selectedTranscript &&
        selectedTranscript.segments.some((segment) => (segment.words?.length ?? 0) > 0) &&
        selectedTranscript.ass
    );

    useEffect(() => {
        if (!result) return;
        const selectedFormat = formats[selectedIdx];
        if (selectedFormat?.requiresWordTimestamps && !hasWordTimestamps) {
            setSelectedIdx(0);
        }
    }, [result, selectedIdx, hasWordTimestamps]);

    if (!result || !selectedTranscript) return null;

    const handleExport = async () => {
        if (isSaving) return;
        setIsSaving(true);
        setSaveError(null);

        try {
            const fmt = formats[selectedIdx];
            if (fmt.requiresWordTimestamps && !hasWordTimestamps) {
                return;
            }
            let content = "";
            let filename = result.file.replace(/\.[^.]+$/, "");
            if (showTranscriptViewSelector) {
                filename += selectedTranscriptView === "english" ? "_english" : "_original";
            }

            // Prepare content
            switch (fmt.id) {
                case "txt": {
                    if (fmt.timestamps) {
                        content = selectedTranscript.segments
                            .map((seg) => {
                                const ts = `[${formatTS(seg.start)} - ${formatTS(seg.end)}]`;
                                return `${ts} ${seg.text.trim()}`;
                            })
                            .join("\n\n");
                    } else {
                        content = selectedTranscript.text;
                    }
                    break;
                }
                case "srt":
                    content = selectedTranscript.srt;
                    break;
                case "ass":
                    content = selectedTranscript.ass || "";
                    break;
                case "json":
                    content = JSON.stringify(
                        {
                            file: result.file,
                            language: selectedTranscript.language,
                            view: showTranscriptViewSelector ? selectedTranscriptView : "original",
                            task: result.task || "transcribe",
                            text: selectedTranscript.text,
                            srt: selectedTranscript.srt,
                            ass: selectedTranscript.ass,
                            duration_seconds: result.duration_seconds,
                            segments: selectedTranscript.segments,
                        },
                        null,
                        2
                    );
                    break;
            }

            // Open Save Dialog
            const path = await save({
                defaultPath: `${filename}${fmt.ext}`,
                filters: [{
                    name: fmt.label,
                    extensions: [fmt.ext.replace(".", "")]
                }]
            });

            if (path) {
                await writeTextFile(path, content);
                onSaved(showTranscriptViewSelector ? selectedTranscriptView : "original");
                setExported(true);
                setTimeout(() => setExported(false), 2500);
            }
        } catch (err) {
            setSaveError(`Could not save the transcript: ${String(err)}. Please try again.`);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="card p-4 animate-slide-up relative">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-400 mb-3 flex items-center gap-2">
                <Download className="w-3.5 h-3.5" />
                Export
            </h3>

            {showTranscriptViewSelector && (
                <p className="mb-4 text-[11px] uppercase tracking-wider text-surface-500">
                    Exporting {selectedTranscriptView === "english" ? "English translation" : "original transcript"}
                </p>
            )}

            {/* Format Selection Grid */}
            <div className="grid grid-cols-2 gap-2 mb-3" aria-label="Export format">
                {formats.map((fmt, i) => {
                    const disabled = Boolean(fmt.requiresWordTimestamps && !hasWordTimestamps);
                    const selected = selectedIdx === i;

                    return (
                        <button
                            key={i}
                            onClick={() => setSelectedIdx(i)}
                            disabled={disabled}
                            aria-pressed={selected}
                            className={`flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2.5 text-left text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400
                                ${fmt.id === "ass" ? "col-span-2" : ""}
                                ${selected ? "border-accent-500/30 bg-accent-500/20 text-accent-300" : "border-transparent bg-surface-800/50 text-surface-300 hover:bg-surface-800 hover:text-surface-100"}
                                ${disabled ? "cursor-not-allowed opacity-60 hover:bg-surface-800/50 hover:text-surface-300" : ""}`}
                            title={disabled ? "Karaoke ASS requires word timestamps with usable timing for every word." : fmt.label}
                        >
                            <span className="shrink-0">{fmt.icon}</span>
                            <span className="whitespace-nowrap">{fmt.label}</span>
                            {fmt.id === "ass" && <span className="ml-auto truncate text-[10px] font-normal text-surface-500">Karaoke subtitles</span>}
                        </button>
                    );
                })}
            </div>

            {saveError && <p role="alert" className="text-xs text-danger-400 mb-3 break-words">{saveError}</p>}

            {!hasWordTimestamps && <p className="mb-3 text-[11px] leading-relaxed text-surface-500">{hasUnreliableTiming ? "Karaoke ASS is unavailable because some words have no reliable timing." : "Enable word timestamps before transcribing to use karaoke ASS."}</p>}

            {/* Main Save Button */}
            <button
                onClick={handleExport}
                disabled={isSaving}
                className={`
                    w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium
                    transition-all duration-200
                    ${exported
                        ? "bg-success-500/20 text-success-300 border border-success-500/30"
                        : "bg-surface-100 text-surface-900 hover:bg-white active:scale-[0.98]"
                    }
                `}
            >
                {exported ? (
                    <>
                        <Check className="w-4 h-4" />
                        Saved Successfully!
                    </>
                ) : (
                    <>
                        <Download className="w-4 h-4" />
                        Save Transcript...
                    </>
                )}
            </button>
        </div>
    );
}

function formatTS(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
}
