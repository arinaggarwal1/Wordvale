import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, FolderOpen, HardDrive, Loader2, RefreshCw, Search, Trash2, X } from "lucide-react";
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
type Sort = "default" | "name" | "speed" | "accuracy" | "size" | "parameters";
const sortOptions: { value: Sort; label: string }[] = [
    { value: "default", label: "Default order" }, { value: "name", label: "Name" },
    { value: "speed", label: "Speed" }, { value: "accuracy", label: "Accuracy" },
    { value: "size", label: "Size" }, { value: "parameters", label: "Parameters" },
];
const fallbackSizes: Record<string, number> = { tiny: 75, "tiny.en": 75, base: 142, "base.en": 142, small: 466, "small.en": 466, medium: 1500, "medium.en": 1500, "large-v3": 2900, "large-v3-turbo": 1600 };
function size(mb: number) { return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`; }
function bytes(value: number) { return size(value / 1024 / 1024); }
function ModelScale({ label, level, description }: { label: string; level: number; description: string }) {
    return <div className="model-scale" aria-label={`${label}: ${description}, ${level} of 5 relative to the available models`}>
        <span className="model-scale-label">{label}</span>
        <span className="model-scale-bars" aria-hidden="true">{[1, 2, 3, 4, 5].map((step) => <span key={step} className={step <= level ? "filled" : ""} />)}</span>
        <span className="model-scale-value">{description}</span>
    </div>;
}

export default function ModelsPage({ models, storage, currentModel, isTranscribing, isModelLoading, download, downloadError, onBack, onRefresh, onDownload, onCancelDownload, onUse, onRemove, onRemoveAll }: Props) {
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<Filter>("All");
    const [sort, setSort] = useState<Sort>("default");
    const [sortDescending, setSortDescending] = useState(false);
    const [removal, setRemoval] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);
    const downloaded = new Map((storage?.downloaded_models || []).map((model) => [model.name, model]));
    const disabled = isTranscribing || isModelLoading || busy;
    const accuracyRank: Record<string, number> = { low: 1, "low-medium": 2, medium: 3, high: 4, "very-high": 5 };
    const filtered = models.filter((model) => model.display_name.toLowerCase().includes(query.trim().toLowerCase()) && (
        filter === "All" || (filter === "Downloaded" && downloaded.has(model.name)) ||
        (filter === "Multilingual" && model.multilingual_support) || (filter === "English only" && !model.multilingual_support)
    )).sort((a, b) => {
        let comparison = 0;
        switch (sort) {
            case "name": comparison = a.display_name.localeCompare(b.display_name); break;
            // Turbo's coarse registry values tie smaller models. OpenAI describes it as
            // a faster, near-large-v3 model; use that only as a tie-break, not a benchmark.
            // https://github.com/openai/whisper#available-models-and-languages
            case "speed": comparison = a.relative_speed - b.relative_speed || Number(a.name === "large-v3-turbo") - Number(b.name === "large-v3-turbo"); break;
            case "accuracy": comparison = (accuracyRank[a.accuracy_tier] ?? 0) - (accuracyRank[b.accuracy_tier] ?? 0) || Number(a.name === "large-v3-turbo") - Number(b.name === "large-v3-turbo"); break;
            case "size": comparison = (a.disk_size_mb ?? fallbackSizes[a.name] ?? Infinity) - (b.disk_size_mb ?? fallbackSizes[b.name] ?? Infinity); break;
            case "parameters": comparison = a.parameter_count_raw - b.parameter_count_raw; break;
        }
        return sortDescending ? -comparison : comparison;
    });
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
        <div className="mx-auto max-w-[960px]">
            <button onClick={onBack} className="page-back"><ArrowLeft className="h-4 w-4" /> Back to transcription</button>
            <header className="models-header">
                <div><h2>Models</h2><p>Choose the balance of speed, accuracy, and storage that fits your recording. Downloaded models work offline.</p></div>
                <div className="models-storage"><HardDrive className="h-4 w-4" aria-hidden="true" /><div><strong>{storage ? size(storage.total_size_mb) : "—"}</strong><span>{storage ? `${storage.downloaded_count} downloaded` : "Loading…"}</span></div></div>
            </header>
            <details className="models-guide"><summary>Which model should I choose? <ChevronDown size={16} aria-hidden="true" /></summary><div className="models-guide-content"><dl><div><dt>Tiny</dt><dd>Quick drafts and testing</dd></div><div><dt>Small</dt><dd>A multilingual starting point</dd></div><div><dt>Large v3 Turbo</dt><dd>Faster, higher-quality transcription</dd></div><div><dt>Large v3</dt><dd>More resources, stronger accuracy</dd></div></dl><p>Accuracy, language detection, and output script can vary by recording and model.</p></div></details>
            <div className="models-toolbar">
                <label className="models-search"><Search className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Search models</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models" /></label>
                <div className="models-filters" aria-label="Filter models">{(["All", "Downloaded", "Multilingual", "English only"] as Filter[]).map((option) => <button key={option} onClick={() => setFilter(option)} aria-pressed={filter === option} className={filter === option ? "active" : ""}>{option}</button>)}</div>
                <div className="models-sort"><span>Sort by</span><Select.Root value={sort} onValueChange={(value) => setSort(value as Sort)}><Select.Trigger className="models-sort-trigger" aria-label={`Sort by: ${sortOptions.find((option) => option.value === sort)?.label}`}><Select.Value /><Select.Icon><ChevronDown size={15} aria-hidden="true" /></Select.Icon></Select.Trigger><Select.Portal><Select.Content className="models-sort-content" position="popper" sideOffset={5} align="end"><Select.Viewport>{sortOptions.map((option) => <Select.Item key={option.value} value={option.value} className="models-sort-item"><Select.ItemText>{option.label}</Select.ItemText><Select.ItemIndicator><Check size={15} /></Select.ItemIndicator></Select.Item>)}</Select.Viewport></Select.Content></Select.Portal></Select.Root><button type="button" className="models-sort-direction" disabled={sort === "default"} onClick={() => setSortDescending((value) => !value)} aria-label={sortDescending ? "Sort descending; switch to ascending" : "Sort ascending; switch to descending"} title={sortDescending ? "Descending" : "Ascending"}>{sortDescending ? <ArrowDown size={16} /> : <ArrowUp size={16} />}</button></div>
            </div>
            {isTranscribing && <p className="mt-4 text-xs text-warning-400">Finish the current queue before changing or removing models.</p>}
            {localError && <p role="alert" className="mt-4 text-sm text-danger-400">{localError}</p>}
            {!storage && <p className="mt-4 text-xs text-surface-400">Checking downloaded models…</p>}
            <div className="models-list" aria-label="Available models">
                {filtered.map((model) => {
                    const installed = downloaded.get(model.name);
                    const active = model.name === currentModel;
                    const working = download?.model === model.name;
                    const percent = working && download.total ? Math.min(100, Math.round(download.downloaded / download.total * 100)) : null;
                    const speed = model.relative_speed >= 24 ? "Fast" : model.relative_speed >= 16 ? "Balanced" : "Slower";
                    const accuracy = model.accuracy_tier.includes("very-high") ? "Highest" : model.accuracy_tier.includes("high") ? "High" : model.accuracy_tier === "medium" ? "Balanced" : model.accuracy_tier === "low-medium" ? "Fair" : "Basic";
                    const speedLevel = model.relative_speed >= 32 ? 5 : model.relative_speed >= 24 ? 4 : model.relative_speed >= 16 ? 3 : model.relative_speed >= 8 ? 2 : 1;
                    const accuracyLevel = model.accuracy_tier === "very-high" ? 5 : model.accuracy_tier === "high" ? 4 : model.accuracy_tier === "medium" ? 3 : model.accuracy_tier === "low-medium" ? 2 : 1;
                    return <article key={model.name} className={`model-row${active ? " is-active" : ""}`}>
                        <div className="model-row-main">
                            <div className="model-identity"><div className="model-title"><h3>{model.display_name}</h3>{active ? <span className="model-status">Active</span> : installed ? <span className="model-status">Downloaded</span> : null}</div><p>{model.recommended_use_case}</p><div className="model-quick-facts"><span>{model.multilingual_support ? "Multilingual" : "English only"}</span></div></div>
                            <div className={`model-actions${working ? " is-working" : ""}`}>{working ? <button onClick={onCancelDownload} disabled={download.cancelling} className="btn-ghost text-xs"><X className="h-4 w-4" />{download.cancelling ? "Cancelling…" : "Cancel download"}</button> : installed ? <><button disabled={disabled} onClick={() => setRemoval(model.name)} className="btn-ghost text-xs disabled:opacity-40"><Trash2 className="h-4 w-4" /> Remove</button><button disabled={disabled || active} onClick={() => onUse(model.name)} className="btn-primary text-xs">{active ? <><Check className="h-4 w-4" /> Active</> : "Use model"}</button></> : <button disabled={disabled || !storage} onClick={() => onDownload(model.name)} className="btn-secondary model-download-action text-xs">{downloadError?.model === model.name ? "Retry download" : "Download"}</button>}</div>
                        </div>
                        <div className="model-specs">
                            <ModelScale label="Speed" level={speedLevel} description={speed} />
                            <ModelScale label="Accuracy" level={accuracyLevel} description={accuracy} />
                            <div className="model-spec"><span>Translation</span><strong>{model.translation_support ? "Supported" : "Not supported"}</strong></div>
                            <div className="model-spec"><span>Parameters</span><strong>{model.parameter_count}</strong></div>
                            <div className="model-spec"><span>Size</span><strong>{size(installed?.size_mb ?? model.disk_size_mb ?? fallbackSizes[model.name] ?? 0)}</strong></div>
                        </div>
                        {working && <div className="model-progress" role="status"><div><span>{download.cancelling ? "Cancelling…" : `Downloading · ${bytes(download.downloaded)}${download.total ? ` of ${bytes(download.total)}` : ""}`}</span><span>{percent !== null ? `${percent}%` : ""}</span></div><div className="model-progress-track"><div className={`model-progress-fill ${percent === null ? "w-1/3 animate-pulse" : ""}`} style={percent === null ? undefined : { width: `${percent}%` }} /></div></div>}
                        {downloadError?.model === model.name && <p role="alert" className="mt-3 text-xs text-danger-400 break-words">Download failed: {downloadError.message}</p>}
                    </article>;
                })}
            </div>
            {filtered.length === 0 && <p className="py-12 text-center text-sm text-surface-500">No models match your search and filter.</p>}
            <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-surface-800/70 pt-5"><button onClick={() => void onRefresh()} className="btn-ghost text-xs"><RefreshCw className="h-4 w-4" /> Refresh</button><button onClick={openFolder} disabled={!storage?.models_dir} className="btn-ghost text-xs"><FolderOpen className="h-4 w-4" /> Open models folder</button><button onClick={() => setRemoval("all")} disabled={disabled || !storage?.downloaded_count} className="btn-ghost ml-auto text-xs text-danger-400 disabled:opacity-40"><HardDrive className="h-4 w-4" /> Delete all downloaded models</button></div>
        </div>
        <Dialog.Root open={removal !== null} onOpenChange={(open) => { if (!open && !busy) setRemoval(null); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[70] bg-black/65 backdrop-blur-sm" /><Dialog.Content className="fixed left-1/2 top-1/2 z-[71] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-surface-700/70 bg-surface-900 p-6 shadow-2xl focus:outline-none"><Dialog.Title className="text-base font-semibold text-surface-100">{removal === "all" ? "Remove all downloaded models?" : `Remove ${removingModel?.display_name || "model"}?`}</Dialog.Title><Dialog.Description className="mt-3 text-sm leading-relaxed text-surface-400">{removal === "all" ? `This frees approximately ${size(storage?.total_size_mb || 0)} and clears the active model.` : `This frees approximately ${size(downloaded.get(removal || "")?.size_mb || 0)}${removal === currentModel ? " and clears the active model" : ""}.`} Your recordings and transcripts will not be deleted. You can download the model again later.</Dialog.Description><div className="mt-6 flex justify-end gap-3"><Dialog.Close asChild><button className="btn-ghost text-sm">Keep models</button></Dialog.Close><button onClick={remove} disabled={busy} className="rounded-lg bg-danger-500 px-4 py-2 text-sm font-semibold text-white hover:bg-danger-600 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove"}</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
    </main>;
}
