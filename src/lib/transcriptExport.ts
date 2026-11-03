import type { TranscriptVariantData, TranscriptView, TranscriptionResult } from "../types/models";

export type ExportKind = "text" | "timed" | "srt" | "json" | "ass";
export const exportFormats: { id: ExportKind; label: string; extension: string }[] = [
    { id: "text", label: "Text", extension: "txt" },
    { id: "timed", label: "Timed text", extension: "txt" },
    { id: "srt", label: "SRT", extension: "srt" },
    { id: "json", label: "JSON", extension: "json" },
    { id: "ass", label: "ASS", extension: "ass" },
];

export function transcriptVariant(result: TranscriptionResult, view: TranscriptView): TranscriptVariantData {
    if (result.original && result.english) return view === "english" ? result.english : result.original;
    return { text: result.text, srt: result.srt, ass: result.ass, segments: result.segments, language: result.language };
}

export function formatTranscript(result: TranscriptionResult, view: TranscriptView, format: ExportKind): { filename: string; content: string } {
    const transcript = transcriptVariant(result, view);
    const translated = Boolean(result.original && result.english);
    const base = result.file.replace(/\.[^.]+$/, "") || "transcript";
    const suffix = translated ? `_${view}` : "";
    const extension = exportFormats.find((entry) => entry.id === format)!.extension;
    let content: string;
    switch (format) {
        case "text": content = transcript.text; break;
        case "timed": content = transcript.segments.map((segment) => {
            const stamp = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
            return `[${stamp(segment.start)} - ${stamp(segment.end)}] ${segment.text.trim()}`;
        }).join("\n\n"); break;
        case "srt": content = transcript.srt; break;
        case "ass":
            if (!transcript.ass || !transcript.segments.some((segment) => segment.words?.length) || transcript.segments.some((segment) => segment.words?.some((word) => word.timing_unreliable))) throw new Error("ASS requires reliable word timestamps.");
            content = transcript.ass; break;
        case "json": content = JSON.stringify({ file: result.file, language: transcript.language, view: translated ? view : "original", task: result.task || "transcribe", text: transcript.text, srt: transcript.srt, ass: transcript.ass, duration_seconds: result.duration_seconds, segments: transcript.segments }, null, 2); break;
    }
    return { filename: `${base}${suffix}.${extension}`, content };
}
