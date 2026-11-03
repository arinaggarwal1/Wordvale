import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/tauri";
import { AudioLines, Check, ChevronDown, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";
import * as Select from "@radix-ui/react-select";
import type { QueueItem, TranscriptView } from "../types/models";
import { transcriptVariant } from "../lib/transcriptExport";
import { currentSegmentIndex, hasUsableSegmentTiming } from "../lib/segmentPlayback";

function clock(value: number) {
    if (!Number.isFinite(value)) return "0:00";
    const seconds = Math.max(0, Math.floor(value));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = String(seconds % 60).padStart(2, "0");
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

const controlClass = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-400 disabled:cursor-not-allowed disabled:opacity-40";

export default function AudioPlayer({ item, embedded = false, view, onViewChange }: { item: QueueItem; embedded?: boolean; view?: TranscriptView; onViewChange?: (view: TranscriptView) => void }) {
    const audio = useRef<HTMLAudioElement>(null);
    const [source, setSource] = useState("");
    const [playing, setPlaying] = useState(false);
    const [position, setPosition] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [error, setError] = useState("");
    const [localTranscriptView, setLocalTranscriptView] = useState<TranscriptView>("original");
    const transcriptView = view ?? localTranscriptView;
    const setTranscriptView = (next: TranscriptView) => { setLocalTranscriptView(next); onViewChange?.(next); };
    const activeSegmentRef = useRef<HTMLButtonElement>(null);
    const segmentListRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let cancelled = false;
        setSource(""); setPosition(0); setDuration(0); setPlaying(false); setError("");
        if (!("__TAURI__" in window)) {
            setError("Playback is available in the desktop app.");
            return;
        }
        invoke<string>("allow_audio_playback", { path: item.filePath })
            .then((path) => { if (!cancelled) setSource(convertFileSrc(path)); })
            .catch(() => { if (!cancelled) setError("Could not open this recording. Check that the file still exists."); });
        return () => { cancelled = true; };
    }, [item.filePath]);

    async function toggle() {
        if (!audio.current) return;
        if (audio.current.paused) {
            try { await audio.current.play(); } catch { setError("This recording could not be played. Its format may not be supported by macOS."); }
        } else audio.current.pause();
    }
    function skip(seconds: number) {
        if (audio.current && Number.isFinite(audio.current.duration)) {
            audio.current.currentTime = Math.max(0, Math.min(audio.current.duration, audio.current.currentTime + seconds));
        }
    }
    const ready = !!source && !error;
    const seekable = ready && Number.isFinite(duration) && duration > 0;
    const progress = seekable ? Math.min(100, position / duration * 100) : 0;
    const result = item.result;
    const translated = Boolean(result?.original && result?.english);
    const segments = result ? transcriptVariant(result, transcriptView).segments : [];
    const currentSegment = currentSegmentIndex(segments, position);

    useEffect(() => {
        const row = activeSegmentRef.current;
        const list = segmentListRef.current;
        if (!playing || !row || !list) return;
        const rowRect = row.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        if (rowRect.top < listRect.top || rowRect.bottom > listRect.bottom) {
            list.scrollTop += rowRect.top - listRect.top - list.clientHeight / 3;
        }
    }, [currentSegment, playing, transcriptView]);

    return <section aria-label="Recording player" className={embedded ? "" : "mt-6"}>
        <audio ref={audio} src={source || undefined} preload="metadata"
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
            onDurationChange={(event) => setDuration(event.currentTarget.duration)}
            onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
            onError={() => { if (source) setError("This recording could not be played. Its format may not be supported by macOS."); }} />
        {!embedded && <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-500/10 text-accent-400"><AudioLines className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1"><p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">Recording</p><p className="mt-0.5 truncate text-sm font-medium text-surface-200" title={item.fileName}>{item.fileName}</p></div>
            <span className="shrink-0 text-xs tabular-nums text-surface-500">{clock(duration)}</span>
        </div>}
        <div className={`${embedded ? "mt-0" : "mt-6"} flex items-center gap-3`}>
            <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-surface-400">{clock(position)}</span>
            <input aria-label="Seek recording" type="range" min="0" max={seekable ? duration : 0} step="0.1" value={seekable ? Math.min(position, duration) : 0} disabled={!seekable} onChange={(event) => { if (audio.current) { audio.current.currentTime = Number(event.target.value); setPosition(audio.current.currentTime); } }} style={{ background: `linear-gradient(to right, #60a5fa ${progress}%, #334155 ${progress}%)` }} className="range-control min-w-0 flex-1" />
            <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-surface-500">{clock(duration)}</span>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-surface-800/60 pt-5">
            <button type="button" onClick={() => void toggle()} disabled={!ready} aria-label={playing ? "Pause recording" : "Play recording"} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-accent-500 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-accent-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400 disabled:cursor-not-allowed disabled:opacity-40">{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{playing ? "Pause" : "Play"}</button>
            <button type="button" onClick={() => skip(-10)} disabled={!seekable} aria-label="Go back 10 seconds" title="Back 10 seconds" className={controlClass}><RotateCcw className="h-4 w-4" /></button>
            <button type="button" onClick={() => skip(10)} disabled={!seekable} aria-label="Go forward 10 seconds" title="Forward 10 seconds" className={controlClass}><RotateCw className="h-4 w-4" /></button>
            <Select.Root value={String(speed)} onValueChange={(value) => { const rate = Number(value); setSpeed(rate); if (audio.current) audio.current.playbackRate = rate; }}>
                <Select.Trigger aria-label="Playback speed" className="ml-1 inline-flex h-9 min-w-[66px] items-center justify-between gap-2 rounded-lg border border-surface-700/60 bg-surface-800/60 px-2.5 text-xs font-medium text-surface-300 transition-colors hover:border-surface-600 hover:text-surface-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-400">
                    <Select.Value /><Select.Icon><ChevronDown className="h-3.5 w-3.5 text-surface-500" /></Select.Icon>
                </Select.Trigger>
                <Select.Portal><Select.Content position="popper" side="top" sideOffset={6} className="z-[80] min-w-[88px] overflow-hidden rounded-lg border border-surface-700/70 bg-surface-900 p-1 shadow-xl">
                    <Select.Viewport>{[0.75, 1, 1.25, 1.5, 2].map((rate) => <Select.Item key={rate} value={String(rate)} className="relative flex cursor-pointer select-none items-center rounded-md py-1.5 pl-7 pr-3 text-xs text-surface-300 outline-none data-[highlighted]:bg-surface-800 data-[highlighted]:text-surface-100"><Select.ItemIndicator className="absolute left-2 text-accent-400"><Check className="h-3.5 w-3.5" /></Select.ItemIndicator><Select.ItemText>{rate}×</Select.ItemText></Select.Item>)}</Select.Viewport>
                </Select.Content></Select.Portal>
            </Select.Root>
            <div className="ml-auto flex items-center gap-1"><button type="button" onClick={() => { if (audio.current) { if (audio.current.volume === 0) { audio.current.volume = 0.5; setVolume(0.5); audio.current.muted = false; } else { audio.current.muted = !audio.current.muted; } setMuted(audio.current.muted); } }} aria-label={muted || volume === 0 ? "Unmute recording" : "Mute recording"} title={muted ? "Unmute" : "Mute"} className={controlClass}>{muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}</button><input aria-label="Volume" type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} onChange={(event) => { const value = Number(event.target.value); setVolume(value); setMuted(false); if (audio.current) { audio.current.volume = value; audio.current.muted = false; } }} className="range-control w-16" /></div>
        </div>
        {error && <p role="alert" className="mt-3 text-xs leading-relaxed text-warning-400">{error}</p>}
        {result && <div className="mt-5 border-t border-surface-800/60 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h3 className="text-xs font-semibold uppercase tracking-wider text-surface-400">Transcript</h3><p className="mt-1 text-xs text-surface-500">Select a segment to jump to that part of the recording.</p></div>
                {translated && <div className="flex rounded-lg bg-surface-950/70 p-1" aria-label="Transcript language">{(["original", "english"] as TranscriptView[]).map((view) => <button key={view} type="button" aria-pressed={view === transcriptView} onClick={() => setTranscriptView(view)} className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${view === transcriptView ? "bg-surface-700 text-surface-100" : "text-surface-400 hover:text-surface-200"}`}>{view === "original" ? "Original" : "English"}</button>)}</div>}
            </div>
            {segments.length ? <div ref={segmentListRef} className="mt-3 max-h-[min(280px,35vh)] overflow-y-auto rounded-xl border border-surface-800/70 bg-surface-950/30 p-1.5" aria-label="Transcript segments">
                {segments.map((segment, index) => {
                    const validTiming = hasUsableSegmentTiming(segment);
                    const active = index === currentSegment;
                    return <button key={`${segment.id}-${index}`} ref={active ? activeSegmentRef : undefined} type="button" disabled={!seekable || !validTiming} aria-current={active ? "true" : undefined} onClick={() => { if (audio.current && validTiming) { audio.current.currentTime = Math.min(segment.start, audio.current.duration); setPosition(audio.current.currentTime); } }} className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-400 disabled:cursor-not-allowed disabled:opacity-60 ${active ? "bg-accent-500/15 text-surface-100" : "text-surface-300 hover:bg-surface-800/60"}`}>
                        <span className={`shrink-0 pt-0.5 font-mono text-[11px] tabular-nums ${active ? "text-accent-300" : "text-surface-500"}`}>{validTiming ? clock(segment.start) : "—:—"}</span><span className="min-w-0 text-xs leading-relaxed">{segment.text.trim()}</span>
                    </button>;
                })}
            </div> : <div className="mt-3 max-h-[min(280px,35vh)] overflow-y-auto whitespace-pre-wrap rounded-xl border border-surface-800/70 bg-surface-950/30 p-4 text-sm leading-relaxed text-surface-200">{transcriptVariant(result, transcriptView).text || "This transcript is empty."}<p className="mt-4 text-xs text-surface-500">Segment timestamps aren’t available for this transcript.</p></div>}
        </div>}
    </section>;
}
