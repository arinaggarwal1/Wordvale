import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { open as openDialog } from "@tauri-apps/api/dialog";
import { invoke } from "@tauri-apps/api/tauri";
import { Download, FileText, FolderOpen, X } from "lucide-react";
import { exportFormats, formatTranscript } from "../lib/transcriptExport";
import type { ExportKind } from "../lib/transcriptExport";
import type { QueueItem, TranscriptView, TranscriptionResult } from "../types/models";

interface Props {
    open: boolean;
    onClose: () => void;
    items: QueueItem[];
    onSaved: (id: string, view: TranscriptView, result: TranscriptionResult) => void;
}

export default function BatchExportDialog({ open, onClose, items, onSaved }: Props) {
    const [selected, setSelected] = useState<string[]>([]);
    const [format, setFormat] = useState<ExportKind>("text");
    const [includeTranslations, setIncludeTranslations] = useState(true);
    const [busy, setBusy] = useState(false);
    const [summary, setSummary] = useState("");
    const [errors, setErrors] = useState<string[]>([]);
    const writtenViews = useRef(new Set<string>());
    const completed = items.filter((item) => item.status === "completed" && item.result);
    useEffect(() => {
        if (open) { setSelected(items.filter((item) => item.status === "completed" && item.result).map((item) => item.id)); setSummary(""); setErrors([]); writtenViews.current.clear(); }
        // Capture the completed items when the dialog opens; avoid resetting selections as the queue changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    async function save() {
        if (busy) return;
        const selectedItems = completed.filter((item) => selected.includes(item.id));
        if (!selectedItems.length) return;
        setBusy(true); setSummary(""); setErrors([]);
        try {
            const directory = await openDialog({ directory: true, title: "Choose a folder for exported transcripts" });
            if (typeof directory !== "string") return;
            let count = 0;
            const failures: string[] = [];
            const completedIds: string[] = [];
            for (const item of selectedItems) {
                const result = item.result!;
                const views: TranscriptView[] = includeTranslations && result.original && result.english ? ["original", "english"] : ["original"];
                let complete = true;
                for (const view of views) {
                    const key = `${format}:${item.id}:${view}`;
                    if (writtenViews.current.has(key)) continue;
                    try {
                        const { filename, content } = formatTranscript(result, view, format);
                        await invoke("save_transcript_copy", { directory, filename, content });
                        onSaved(item.id, view, result);
                        writtenViews.current.add(key);
                        count++;
                    } catch (error) {
                        complete = false;
                        failures.push(`${item.fileName}${views.length > 1 ? ` (${view})` : ""}: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
                if (complete) completedIds.push(item.id);
            }
            setSelected((current) => current.filter((id) => !completedIds.includes(id)));
            setSummary(`${count} ${count === 1 ? "file" : "files"} exported${failures.length ? "; some could not be exported." : "."}`);
            setErrors(failures);
        } catch (error) {
            setErrors([`Could not choose an export folder: ${String(error)}`]);
        } finally { setBusy(false); }
    }

    return <Dialog.Root open={open} onOpenChange={(value) => { if (!value && !busy) onClose(); }}>
        <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-[71] flex max-h-[min(700px,calc(100vh-32px))] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-surface-700/70 bg-surface-900 p-6 shadow-2xl focus:outline-none">
                <div className="flex items-start justify-between gap-4"><div><Dialog.Title className="text-base font-semibold text-surface-100">Export transcripts</Dialog.Title><Dialog.Description className="mt-1 text-xs leading-relaxed text-surface-400">Choose completed files and a format, then select a destination folder.</Dialog.Description></div><Dialog.Close asChild><button disabled={busy} aria-label="Close batch export" className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-800 hover:text-surface-100 disabled:opacity-40"><X className="h-4 w-4" /></button></Dialog.Close></div>
                <div className="mt-5 min-h-0 overflow-y-auto pr-1">
                    <div className="flex items-center justify-between"><h3 className="text-xs font-semibold uppercase tracking-wider text-surface-400">Completed files <span className="normal-case tracking-normal text-surface-500">· {selected.filter((id) => completed.some((item) => item.id === id)).length} selected</span></h3><button type="button" disabled={busy} onClick={() => setSelected(selected.length === completed.length ? [] : completed.map((item) => item.id))} className="text-xs text-accent-300 hover:text-accent-200 disabled:opacity-40">{selected.length === completed.length ? "Deselect all" : "Select all"}</button></div>
                    <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-surface-800 bg-surface-950/30 p-2">{completed.map((item) => <label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-xs text-surface-200 hover:bg-surface-800/60"><input type="checkbox" checked={selected.includes(item.id)} disabled={busy} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} className="accent-accent-500" /><FileText className="h-4 w-4 shrink-0 text-surface-500" /><span className="min-w-0 truncate" title={item.fileName}>{item.fileName}</span></label>)}</div>
                    <fieldset className="mt-5" disabled={busy}><legend className="text-xs font-semibold uppercase tracking-wider text-surface-400">Format</legend><div className="mt-2 flex flex-wrap gap-2">{exportFormats.map((entry) => <button type="button" key={entry.id} onClick={() => setFormat(entry.id)} aria-pressed={format === entry.id} className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${format === entry.id ? "border-accent-500/50 bg-accent-500/15 text-accent-300" : "border-surface-700/50 bg-surface-800/40 text-surface-400 hover:text-surface-100"}`}>{entry.label}</button>)}</div>{format === "ass" && <p className="mt-2 text-xs text-surface-400">ASS requires reliable word timestamps; unavailable files will be reported.</p>}</fieldset>
                    {completed.some((item) => item.result?.original && item.result?.english) && <label className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-surface-300"><input type="checkbox" className="mt-0.5 accent-accent-500" checked={includeTranslations} disabled={busy} onChange={(event) => setIncludeTranslations(event.target.checked)} /><span>Include English translations where available<br /><span className="text-surface-500">Originals and translations are saved as separate files.</span></span></label>}
                    <p className="mt-4 flex items-center gap-2 text-xs text-surface-500"><FolderOpen className="h-4 w-4 shrink-0" /> Existing files are kept; duplicates get a numbered name.</p>
                    {summary && <p role="status" className="mt-3 text-xs text-surface-200">{summary}</p>}
                    {errors.length > 0 && <div role="alert" className="mt-2 max-h-28 overflow-y-auto text-xs leading-relaxed text-danger-400">{errors.map((error, index) => <p key={index}>{error}</p>)}</div>}
                </div>
                <div className="mt-5 flex justify-end gap-2 border-t border-surface-800/60 pt-4"><Dialog.Close asChild><button disabled={busy} className="btn-ghost text-xs">{summary && !errors.length ? "Done" : "Cancel"}</button></Dialog.Close><button onClick={() => void save()} disabled={busy || !completed.some((item) => selected.includes(item.id))} className="btn-primary text-xs"><Download className="h-4 w-4" />{busy ? "Exporting…" : "Choose folder and export"}</button></div>
            </Dialog.Content>
        </Dialog.Portal>
    </Dialog.Root>;
}
