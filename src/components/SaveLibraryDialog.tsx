import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { LibraryBig, X } from "lucide-react";
import type { LibraryItem, QueueItem } from "../types/models";

type Command = (command: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
export default function SaveLibraryDialog({ open, onClose, items, command, onSaved }: { open: boolean; onClose: () => void; items: QueueItem[]; command: Command; onSaved: (queueItem: QueueItem, item: LibraryItem, includedTranscript: boolean) => void }) {
    const [selected, setSelected] = useState<string[]>([]);
    const [name, setName] = useState("");
    const [audioMode, setAudioMode] = useState<"link" | "copy" | "none">("link");
    const [saveTranscript, setSaveTranscript] = useState(true);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [summary, setSummary] = useState("");
    useEffect(() => { if (open) { setSelected(items.filter((item) => !item.libraryId).map((item) => item.id)); setName(items.length === 1 ? items[0].fileName.replace(/\.[^.]+$/, "") : ""); setAudioMode("link"); setSaveTranscript(true); setErrors([]); setSummary(""); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
    async function save() {
        const targets = items.filter((item) => selected.includes(item.id));
        if (!targets.length || busy) return;
        setBusy(true); setErrors([]); setSummary("");
        const failures: string[] = []; const successes: string[] = [];
        for (const item of targets) {
            try {
                const response = await command("library_create", { name: items.length === 1 ? name.trim() : item.fileName.replace(/\.[^.]+$/, ""), audio_path: audioMode === "none" ? null : item.filePath, audio_mode: audioMode === "none" ? null : audioMode, transcript: saveTranscript ? item.result || null : null });
                const saved = response.item as unknown as LibraryItem;
                onSaved(item, saved, saveTranscript && !!item.result); successes.push(item.id);
            } catch (error) { failures.push(`${item.fileName}: ${error instanceof Error ? error.message : String(error)}`); }
        }
        setSelected((current) => current.filter((id) => !successes.includes(id)));
        setSummary(`${successes.length} ${successes.length === 1 ? "item" : "items"} saved to your library.`); setErrors(failures); setBusy(false);
    }
    const valid = selected.length > 0 && (items.length !== 1 || name.trim()) && (audioMode !== "none" || (saveTranscript && items.some((item) => selected.includes(item.id) && item.result)));
    return <Dialog.Root open={open} onOpenChange={(value) => { if (!value && !busy) onClose(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm" /><Dialog.Content className="fixed left-1/2 top-1/2 z-[71] max-h-[calc(100vh-32px)] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-surface-700/70 bg-surface-900 p-6 shadow-2xl focus:outline-none">
        <div className="flex justify-between gap-4"><div><Dialog.Title className="text-base font-semibold text-surface-100">Save to library</Dialog.Title><Dialog.Description className="mt-1 text-xs leading-relaxed text-surface-400">Keep recordings and transcripts together for later.</Dialog.Description></div><Dialog.Close asChild><button disabled={busy} aria-label="Close" className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-800"><X className="h-4 w-4" /></button></Dialog.Close></div>
        {items.length === 1 ? <label className="mt-5 block text-xs font-medium text-surface-300">Library name<input className="input-field mt-2" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></label> : <div className="mt-5"><p className="text-xs font-semibold uppercase tracking-wider text-surface-400">Select files</p><div className="mt-2 max-h-36 space-y-1 overflow-y-auto rounded-lg border border-surface-800 p-2">{items.map((item) => <label key={item.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-surface-300"><input type="checkbox" disabled={busy || !!item.libraryId} checked={selected.includes(item.id)} onChange={(e) => setSelected((old) => e.target.checked ? [...old, item.id] : old.filter((id) => id !== item.id))} className="accent-accent-500" /><span className="truncate">{item.fileName}</span>{item.libraryId && <span className="shrink-0 text-surface-500">Already in library</span>}</label>)}</div></div>}
        <fieldset className="mt-5 space-y-2" disabled={busy}><legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-surface-400">Recording</legend>{([['link', 'Link to original', 'Uses no extra storage. You can relink it if the file moves.'], ['copy', 'Copy into library', 'Keeps a separate copy and uses additional disk space.'], ['none', 'Do not save audio', 'Keep the transcript only.']] as const).map(([value, label, description]) => <label key={value} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${audioMode === value ? 'border-accent-500/40 bg-accent-500/10' : 'border-surface-800 bg-surface-950/30'}`}><input type="radio" name="audio-storage" value={value} checked={audioMode === value} onChange={() => setAudioMode(value)} className="mt-0.5 accent-accent-500" /><span className="text-xs font-medium text-surface-200">{label}<span className="mt-1 block font-normal leading-relaxed text-surface-500">{description}</span></span></label>)}</fieldset>
        <label className="mt-4 flex items-center gap-2 text-xs text-surface-300"><input type="checkbox" checked={saveTranscript} disabled={busy || !items.some((item) => !!item.result)} onChange={(event) => setSaveTranscript(event.target.checked)} className="accent-accent-500" /> Save available transcripts</label><p className="mt-2 text-xs text-surface-500">Your original recording stays where it is.</p>
        {summary && <p role="status" className="mt-3 text-xs text-surface-200">{summary}</p>}{errors.length > 0 && <div role="alert" className="mt-2 text-xs text-danger-400">{errors.map((error, i) => <p key={i}>{error}</p>)}</div>}
        <div className="mt-5 flex justify-end gap-2 border-t border-surface-800/60 pt-4"><Dialog.Close asChild><button disabled={busy} className="btn-ghost text-xs">{summary && !errors.length ? 'Done' : 'Cancel'}</button></Dialog.Close><button onClick={() => void save()} disabled={!valid || busy} className="btn-primary text-xs"><LibraryBig className="h-4 w-4" />{busy ? 'Saving…' : 'Save to library'}</button></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
