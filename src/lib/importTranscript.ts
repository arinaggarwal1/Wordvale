import type { TranscriptionResult, TranscriptionSegment } from "../types/models";

function timeSeconds(value: string): number {
    const match = /^(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(value.trim());
    if (!match || Number(match[2]) >= 60 || Number(match[3]) >= 60) throw new Error("Invalid subtitle timestamp.");
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4]}`);
}

export function importTranscript(filename: string, content: string): TranscriptionResult {
    const extension = filename.split(".").pop()?.toLowerCase();
    const base: TranscriptionResult = { status: "completed", file: filename, file_path: "", text: "", srt: "", segments: [], language: "", duration_seconds: 0 };
    if (extension === "txt") return { ...base, text: content };
    if (extension === "json") {
        const parsed: unknown = JSON.parse(content);
        if (!parsed || typeof parsed !== "object" || typeof (parsed as { text?: unknown }).text !== "string") throw new Error("This JSON file is not a Wordvale transcript.");
        const data = parsed as Partial<TranscriptionResult>;
        if (data.segments && (!Array.isArray(data.segments) || data.segments.some((s) => typeof s.text !== "string" || !Number.isFinite(s.start) || !Number.isFinite(s.end)))) throw new Error("The transcript has invalid segment data.");
        return { ...base, ...data, status: "completed", file: typeof data.file === "string" ? data.file : filename, file_path: "", segments: data.segments || [], srt: typeof data.srt === "string" ? data.srt : "", duration_seconds: Number.isFinite(data.duration_seconds) ? data.duration_seconds! : 0 };
    }
    if (extension === "srt") {
        const segments: TranscriptionSegment[] = content.replace(/\r\n?/g, "\n").trim().split(/\n\s*\n/).map((block, index) => {
            const lines = block.split("\n");
            const timeIndex = lines.findIndex((line) => line.includes("-->"));
            if (timeIndex < 0) throw new Error(`Subtitle ${index + 1} has no timestamp.`);
            const match = /^\s*(\d+:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d+:\d{2}:\d{2}[,.]\d{1,3})/.exec(lines[timeIndex]);
            if (!match) throw new Error(`Subtitle ${index + 1} has an invalid timestamp.`);
            const start = timeSeconds(match[1]); const end = timeSeconds(match[2]);
            if (end <= start) throw new Error(`Subtitle ${index + 1} has an invalid duration.`);
            return { id: index, start, end, text: lines.slice(timeIndex + 1).join("\n").trim() };
        });
        return { ...base, text: segments.map((s) => s.text).join("\n\n"), srt: content, segments };
    }
    throw new Error("Choose a TXT, SRT, or Wordvale JSON transcript.");
}
