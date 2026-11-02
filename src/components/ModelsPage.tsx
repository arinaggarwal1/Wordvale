import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, Check, Download, FolderOpen, HardDrive, Loader2, RefreshCw, Search, Trash2, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/tauri";
import type { ModelDownload, ModelStorageInfo, WhisperModel } from "../types/models";

interface Props {
    models: WhisperModel[];
    storage: ModelStorageInfo | null;
    currentModel: string | null;
    isTranscribing: boolean;
    isModelLoading: boolean;
    download: ModelDownload | null;
    downloadError: { model: string; message: string } | null;
    onBack: () => void;
    onRefresh: () => Promise<void>;
    onDownload: (name: string) => Promise<void>;
    onCancelDownload: () => Promise<void>;
    onUse: (name: string) => Promise<boolean>;
    onRemove: (name: string) => Promise<void>;
    onRemoveAll: () => Promise<void>;
}

type Filter = "All" | "Downloaded" | "Multilingual" | "English only";
const fallbackSizes: Record<string, number> = { tiny: 75, "tiny.en": 75, base: 142, "base.en": 142, small: 466, "small.en": 466, medium: 1500, "medium.en": 1500, "large-v3": 2900, "large-v3-turbo": 1600 };
function size(mb: number) { return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`; }
function bytes(value: number) { return size(value / 1024 / 1024); }

export default function ModelsPage({ models, storage, currentModel, isTranscribing, isModelLoading, download, downloadError, onBack, onRefresh, onDownload, onCancelDownload, onUse, onRemove, onRemoveAll }: Props) {
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<Filter>("All");
    const [removal, setRemoval] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);
    const downloaded = new Map((storage?.downloaded_models || []).map((model) => [model.name, model]));
    const disabled = isTranscribing || isModelLoading || busy;
    const filtered = models.filter((model) => model.display_name.toLowerCase().includes(query.trim().toLowerCase()) && (
        filter === "All" || (filter === "Downloaded" && downloaded.has(model.name)) ||
        (filter === "Multilingual" && model.multilingual_support) || (filter === "English only" && !model.multilingual_support)
    ));
    const removingModel = models.find((model) => model.name === removal);
    async function remove() {
        if (!removal || disabled) return;
        setBusy(true); setLocalError(null);
        try { if (removal === "all") await onRemoveAll(); else await onRemove(removal); setRemoval(null); }
        catch (error) { setLocalError(`Could not remove model: ${String(error)}`); setRemoval(null); }
        finally { setBusy(false); }
    }
    async function openFolder() {
        try { if (storage?.models_dir) await invoke("open_in_finder", { path: storage.models_dir }); }
        catch (error) { setLocalError(`Could not open models folder: ${String(error)}`); }
    }
    return <main className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-surface-950 p-6 lg:p-8">
        <div className="mx-auto max-w-6xl">
            <button onClick={onBack} className="btn-ghost text-xs mb-6"><ArrowLeft className="h-4 w-4" /> Back to transcription</button>
            <div className="flex flex-wrap items-end justify-between gap-5 border-b border-surface-800/70 pb-6">
                <div><p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-accent-400 mb-2">Your transcription toolkit</p><h2 className="text-3xl font-bold text-surface-100">Models</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-surface-400">Choose the balance of speed, accuracy, and storage that fits your recording. Downloaded models work offline.</p></div>
                <div className="rounded-xl border border-surface-700/50 bg-surface-900/70 px-5 py-3 min-w-[165px]"><p className="text-[10px] uppercase tracking-wider text-surface-500">Local storage</p><p className="mt-1 text-lg font-semibold text-surface-100">{storage ? size(storage.total_size_mb) : "—"}</p><p className="text-xs text-surface-400">{storage ? `${storage.downloaded_count} downloaded` : "Loading…"}</p></div>
            </div>
            <div className="mt-6 grid gap-3 md:grid-cols-4 rounded-xl border border-accent-500/15 bg-accent-500/5 p-4 text-xs leading-relaxed text-surface-400">
                <p><strong className="text-surface-200">Tiny</strong><br />Quick drafts and testing</p><p><strong className="text-surface-200">Small</strong><br />A multilingual starting point</p><p><strong className="text-surface-200">Large v3 Turbo</strong><br />Faster, higher-quality transcription</p><p><strong className="text-surface-200">Large v3</strong><br />More resources, stronger accuracy</p>
            </div>
            <div className="mt-4 grid items-center gap-3 xl:grid-cols-3">
                <label className="relative block w-full sm:w-64"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-500" /><span className="sr-only">Search models</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models" className="w-full rounded-lg border border-surface-700/60 bg-surface-900 px-9 py-2.5 text-sm text-surface-100 placeholder:text-surface-500 focus:border-accent-500 focus:outline-none" /></label>
                <p className="text-center text-xs leading-relaxed text-surface-500">Accuracy, language detection, and output script can vary by recording and model.</p>
                <div className="flex flex-wrap justify-center gap-1 rounded-lg bg-surface-900 p-1 xl:justify-self-end" aria-label="Filter models">{(["All", "Downloaded", "Multilingual", "English only"] as Filter[]).map((option) => <button key={option} onClick={() => setFilter(option)} aria-pressed={filter === option} className={`rounded-md px-3 py-2 text-xs transition-colors ${filter === option ? "bg-surface-700 text-surface-100" : "text-surface-400 hover:text-surface-100"}`}>{option}</button>)}</div>
            </div>
            {isTranscribing && <p className="mt-4 text-xs text-warning-400">Finish the current queue before changing or removing models.</p>}
            {localError && <p role="alert" className="mt-4 text-sm text-danger-400">{localError}</p>}
            {!storage && <p className="mt-4 text-xs text-surface-400">Checking downloaded models…</p>}
            <div className="mt-5 grid gap-3 md:grid-cols-2">
                {filtered.map((model) => {
                    const installed = downloaded.get(model.name);
                    const active = model.name === currentModel;
                    const working = download?.model === model.name;
                    const percent = working && download.total ? Math.min(100, Math.round(download.downloaded / download.total * 100)) : null;
                    return <article key={model.name} className={`flex flex-col rounded-xl border p-5 ${active ? "border-accent-500/40 bg-accent-500/5" : "border-surface-800/80 bg-surface-900/55"}`}>
                        <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-semibold text-surface-100">{model.display_name}</h3>{active && <span className="rounded-full bg-accent-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-300">Active</span>}{installed && !active && <span className="rounded-full bg-success-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success-400">Downloaded</span>}</div><p className="mt-1.5 text-xs leading-relaxed text-surface-400">{model.recommended_use_case}</p></div><span className="shrink-0 font-mono text-xs text-surface-400">{size(installed?.size_mb ?? model.disk_size_mb ?? fallbackSizes[model.name] ?? 0)}</span></div>
                        <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-surface-300"><span className="rounded-md bg-surface-800 px-2 py-1">{model.multilingual_support ? "Multilingual" : "English only"}</span><span className="rounded-md bg-surface-800 px-2 py-1">{model.translation_support ? "Translation supported" : "No translation"}</span><span className="rounded-md bg-surface-800 px-2 py-1">{model.parameter_count} parameters</span><span className="rounded-md bg-surface-800 px-2 py-1">Speed: {model.relative_speed >= 24 ? "Fast" : model.relative_speed >= 16 ? "Balanced" : "Slower"}</span><span className="rounded-md bg-surface-800 px-2 py-1">Accuracy: {model.accuracy_tier.includes("very-high") ? "Highest" : model.accuracy_tier.includes("high") ? "High" : model.accuracy_tier === "medium" ? "Balanced" : "Basic"}</span></div>
                        {working && <div className="mt-4" role="status"><div className="flex justify-between text-xs text-surface-400"><span>{download.cancelling ? "Cancelling…" : `Downloading · ${bytes(download.downloaded)}${download.total ? ` of ${bytes(download.total)}` : ""}`}</span><span>{percent !== null ? `${percent}%` : ""}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-700"><div className={`h-full rounded-full bg-accent-400 ${percent === null ? "w-1/3 animate-pulse" : ""}`} style={percent === null ? undefined : { width: `${percent}%` }} /></div></div>}
                        {downloadError?.model === model.name && <p role="alert" className="mt-3 text-xs text-danger-400 break-words">Download failed: {downloadError.message}</p>}
                        <div className="mt-auto flex items-center gap-2 pt-5">{working ? <button onClick={onCancelDownload} disabled={download.cancelling} className="btn-ghost text-xs"><X className="h-4 w-4" />{download.cancelling ? "Cancelling…" : "Cancel download"}</button> : installed ? <><button disabled={disabled || active} onClick={() => onUse(model.name)} className="btn-primary text-xs">{active ? <><Check className="h-4 w-4" /> Active</> : "Use model"}</button><button disabled={disabled} onClick={() => setRemoval(model.name)} className="btn-ghost text-xs text-surface-400 disabled:opacity-40"><Trash2 className="h-4 w-4" /> Remove</button></> : <button disabled={disabled || !storage} onClick={() => onDownload(model.name)} className="btn-primary text-xs"><Download className="h-4 w-4" />{downloadError?.model === model.name ? "Retry download" : "Download"}</button>}</div>
                    </article>;
                })}
            </div>
            {filtered.length === 0 && <p className="py-12 text-center text-sm text-surface-500">No models match your search and filter.</p>}
            <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-surface-800/70 pt-5"><button onClick={() => void onRefresh()} className="btn-ghost text-xs"><RefreshCw className="h-4 w-4" /> Refresh</button><button onClick={openFolder} disabled={!storage?.models_dir} className="btn-ghost text-xs"><FolderOpen className="h-4 w-4" /> Open models folder</button><button onClick={() => setRemoval("all")} disabled={disabled || !storage?.downloaded_count} className="btn-ghost ml-auto text-xs text-danger-400 disabled:opacity-40"><HardDrive className="h-4 w-4" /> Delete all downloaded models</button></div>
        </div>
        <Dialog.Root open={removal !== null} onOpenChange={(open) => { if (!open && !busy) setRemoval(null); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[70] bg-black/65 backdrop-blur-sm" /><Dialog.Content className="fixed left-1/2 top-1/2 z-[71] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-surface-700/70 bg-surface-900 p-6 shadow-2xl focus:outline-none"><Dialog.Title className="text-base font-semibold text-surface-100">{removal === "all" ? "Remove all downloaded models?" : `Remove ${removingModel?.display_name || "model"}?`}</Dialog.Title><Dialog.Description className="mt-3 text-sm leading-relaxed text-surface-400">{removal === "all" ? `This frees approximately ${size(storage?.total_size_mb || 0)} and clears the active model.` : `This frees approximately ${size(downloaded.get(removal || "")?.size_mb || 0)}${removal === currentModel ? " and clears the active model" : ""}.`} Your recordings and transcripts will not be deleted. You can download the model again later.</Dialog.Description><div className="mt-6 flex justify-end gap-3"><Dialog.Close asChild><button className="btn-ghost text-sm">Keep models</button></Dialog.Close><button onClick={remove} disabled={busy} className="rounded-lg bg-danger-500 px-4 py-2 text-sm font-semibold text-white hover:bg-danger-600 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove"}</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
    </main>;
}
