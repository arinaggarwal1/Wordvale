/**
 * ExportPanel.tsx
 * Export controls for saving transcription output as TXT, SRT, or JSON.
 * Uses native Tauri save dialog for better user experience.
 */

import { useState } from "react";
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
import type { TranscriptionResult, ExportFormat } from "../types/models";

interface ExportPanelProps {
    result: TranscriptionResult | null;
}

const formats: { id: ExportFormat; label: string; icon: React.ReactNode; ext: string; timestamps?: boolean }[] = [
    { id: "txt", label: "Text Only", icon: <FileText className="w-4 h-4" />, ext: ".txt", timestamps: false },
    { id: "txt", label: "With Time", icon: <Clock className="w-4 h-4" />, ext: ".txt", timestamps: true },
    { id: "srt", label: "SRT", icon: <Subtitles className="w-4 h-4" />, ext: ".srt" },
    { id: "json", label: "JSON", icon: <Braces className="w-4 h-4" />, ext: ".json" },
];

export default function ExportPanel({ result }: ExportPanelProps) {
    const [selectedIdx, setSelectedIdx] = useState(0);
    const [isSaving, setIsSaving] = useState(false);
    const [exported, setExported] = useState(false);

    if (!result) return null;

    const handleExport = async () => {
        if (isSaving) return;
        setIsSaving(true);

        try {
            const fmt = formats[selectedIdx];
            let content = "";
            let filename = result.file.replace(/\.[^.]+$/, "");

            // Prepare content
            switch (fmt.id) {
                case "txt": {
                    if (fmt.timestamps) {
                        content = result.segments
                            .map((seg) => {
                                const ts = `[${formatTS(seg.start)} - ${formatTS(seg.end)}]`;
                                return `${ts} ${seg.text.trim()}`;
                            })
                            .join("\n\n");
                    } else {
                        content = result.text;
                    }
                    break;
                }
                case "srt":
                    content = result.srt;
                    break;
                case "json":
                    content = JSON.stringify(
                        {
                            file: result.file,
                            language: result.language,
                            duration_seconds: result.duration_seconds,
                            segments: result.segments,
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
                setExported(true);
                setTimeout(() => setExported(false), 2500);
            }
        } catch (err) {
            console.error("Failed to save file:", err);
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

            {/* Format Selection Grid */}
            <div className="grid grid-cols-2 gap-2 mb-4">
                {formats.map((fmt, i) => (
                    <button
                        key={i}
                        onClick={() => setSelectedIdx(i)}
                        className={`
                            flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all
                            ${selectedIdx === i
                                ? "bg-accent-500/20 text-accent-300 border border-accent-500/30"
                                : "bg-surface-800/50 text-surface-400 hover:bg-surface-800 hover:text-surface-200 border border-transparent"}
                        `}
                    >
                        {fmt.icon}
                        <span>{fmt.label}</span>
                    </button>
                ))}
            </div>

            {/* Main Save Button */}
            <button
                onClick={handleExport}
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
