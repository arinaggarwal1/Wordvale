import { useCallback, useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc, invoke } from "@tauri-apps/api/tauri";
import { Mic, MonitorSpeaker, Circle, Square, Pause, Play, VolumeX, Volume2, ArrowRight, LibraryBig, X, AudioLines, MoreHorizontal, Plus, FolderOpen, Pencil, Trash2, SlidersHorizontal } from "lucide-react";
import type { LibraryItem } from "../types/models";
import RecordingPreview from "./RecordingPreview";
import "./recorder.css";

export type RecordingDraft = { path: string; name: string; libraryId?: string };
type Props = {
  draftInUse: (folder: string) => boolean;
  onDeleteDraft: (folder: string) => Promise<void>;
  onSave: (draft: RecordingDraft) => Promise<LibraryItem>;
  onTranscribe: (draft: RecordingDraft, startImmediately: boolean) => Promise<void>;
  transcriptionSummary: string;
  transcribeUnavailable: string | null;
  onLibrary: () => void;
  onRecordingChange: (active: boolean) => void;
  visible?: boolean;
};
type RecordingDraftSummary = { folder: string; name: string; created_at: number; interrupted: boolean };
type LevelEvent = { source: "mic" | "system"; level: number };
type Permissions = { mic: "granted" | "denied" | "prompt"; system: boolean };
const logoPath = "M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2";

// Cubic segments preserve the same rounded turns and vertical loops as the logo.
const logoCurves = [
  [3.105,13,4,12.105,4,11], [4,9.7,4,8.3,4,7],
  [4,5.895,4.895,5,6,5], [7.105,5,8,5.895,8,7],
  [8,11.3,8,15.7,8,20], [8,21.105,8.895,22,10,22],
  [11.105,22,12,21.105,12,20], [12,14.7,12,9.3,12,4],
  [12,2.895,12.895,2,14,2], [15.105,2,16,2.895,16,4],
  [16,8.3,16,12.7,16,17], [16,18.105,16.895,19,18,19],
  [19.105,19,20,18.105,20,17], [20,15.7,20,14.3,20,13],
  [20,11.895,20.895,11,22,11],
];

function FlowingMark({ energy, active }: { energy: number; active: boolean }) {
  const path = useRef<SVGPathElement>(null);
  const level = useRef(0);
  level.current = energy;
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, smoothed = 0, phase = 0, previous = 0;
    const reset = () => path.current?.setAttribute("d", logoPath);
    const animate = (time: number) => {
      const dt = previous ? Math.min((time - previous) / 1000, .05) : 1 / 60;
      previous = time;
      smoothed += (level.current - smoothed) * (1 - Math.exp(-dt / (level.current > smoothed ? .075 : .24)));
      phase += dt * (1.6 + smoothed * 2.2);
      const amount = .06 + smoothed;
      const point = (x: number, y: number) => {
        const bend = Math.sin(phase + y * .22 + x * .16) * amount * 1.25;
        const rise = (y - 12) * smoothed * .12 + Math.sin(phase - x * .36) * amount * 1.1;
        return `${(x + bend).toFixed(3)} ${(y + rise).toFixed(3)}`;
      };
      path.current?.setAttribute("d", `M${point(2,13)} ` + logoCurves.map(c => `C${point(c[0],c[1])} ${point(c[2],c[3])} ${point(c[4],c[5])}`).join(" "));
      frame = requestAnimationFrame(animate);
    };
    const sync = () => {
      cancelAnimationFrame(frame); previous = 0;
      if (active && !reduced.matches && !document.hidden) frame = requestAnimationFrame(animate);
      else reset();
    };
    sync();
    reduced.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => { cancelAnimationFrame(frame); reduced.removeEventListener("change", sync); document.removeEventListener("visibilitychange", sync); };
  }, [active]);
  return <svg className="recorder-wave" viewBox="-2 -3 28 30" fill="none" aria-hidden="true"><path ref={path} d={logoPath} stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function RecorderPage({ draftInUse, onDeleteDraft, onSave, onTranscribe, transcriptionSummary, transcribeUnavailable, onLibrary, onRecordingChange, visible = true }: Props) {
  const [name, setName] = useState(() => `Meeting · ${new Date().toLocaleDateString()}`);
  const [mic, setMic] = useState(true), [system, setSystem] = useState(false);
  const systemVerified = useRef(false);
  const permissionCheckRunning = useRef(false);
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [micMuted, setMicMuted] = useState(false), [systemMuted, setSystemMuted] = useState(false);
  const [recording, setRecording] = useState(false), [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const elapsed = useRef(0), segmentStart = useRef(0);
  const [seconds, setSeconds] = useState(0), [item, setItem] = useState<LibraryItem | null>(null);
  const [levels, setLevels] = useState({ mic: 0, system: 0 });
  const [error, setError] = useState("");
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [recoverable, setRecoverable] = useState<RecordingDraftSummary[]>([]);
  const [actionMenu, setActionMenu] = useState<string | null>(null);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [renamingDraft, setRenamingDraft] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [deletingDraft, setDeletingDraft] = useState<string | null>(null);
  const [openingDraft, setOpeningDraft] = useState<string | null>(null);
  const [handedOff, setHandedOff] = useState(false);
  const [previewSource, setPreviewSource] = useState("");
  const preview = useRef<HTMLAudioElement>(null);
  const transcribeButton = useRef<HTMLButtonElement>(null);
  const draftsButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (savedPath && visible) transcribeButton.current?.focus(); }, [savedPath, visible]);
  useEffect(() => {
    let cancelled = false;
    setPreviewSource("");
    if (savedPath && "__TAURI__" in window) void invoke<string>("allow_audio_playback", { path: savedPath })
      .then(path => { if (!cancelled) setPreviewSource(convertFileSrc(path)); })
      .catch(() => { if (!cancelled) setError("Could not preview this recording. You can still transcribe it."); });
    return () => { cancelled = true; };
  }, [savedPath]);
  useEffect(() => { if (!visible) preview.current?.pause(); }, [visible]);

  const refreshPermissions = useCallback(async () => {
    if (!("__TAURI__" in window) || permissionCheckRunning.current) return;
    permissionCheckRunning.current = true;
    try {
      const next = await invoke<Permissions>("recording_permissions");
      // A successful ScreenCaptureKit check is stronger evidence than preflight.
      if (systemVerified.current) next.system = true;
      setPermissions(next);
      if (next.mic === "denied") setMic(false);
      if (!next.system) setSystem(false);
    } catch { /* Recording can still be attempted if the check is unavailable. */ }
    finally { permissionCheckRunning.current = false; }
  }, []);
  useEffect(() => {
    if (recording) return;
    void refreshPermissions();
    const onFocus = () => { void refreshPermissions(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [recording, visible, refreshPermissions]);

  useEffect(() => {
    if (visible && !recording && "__TAURI__" in window) void invoke<RecordingDraftSummary[]>("recording_recoverable").then(setRecoverable).catch(() => {});
  }, [visible, recording]);
  useEffect(() => {
    if (!recording || paused || saving) return;
    const timer = window.setInterval(() => setSeconds(Math.floor((elapsed.current + performance.now() - segmentStart.current) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [recording, paused, saving]);
  useEffect(() => {
    if (!recording) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<LevelEvent>("recording-level", event => {
      const { source, level } = event.payload;
      if ((source !== "mic" && source !== "system") || !Number.isFinite(level)) return;
      setLevels(previous => ({ ...previous, [source]: Math.max(0, Math.min(1, level)) }));
    }).then(dispose => { if (cancelled) dispose(); else unlisten = dispose; }).catch(() => {});
    return () => { cancelled = true; unlisten?.(); };
  }, [recording]);

  async function saveToLibrary() {
    if (!savedPath || item || busy) return;
    setBusy(true); setError("");
    try {
      const saved = await onSave({ path: savedPath, name: name.trim() || "Meeting" });
      setItem(saved);
      setRecoverable(list => list.filter(draft => !savedPath.startsWith(`${draft.folder}/`)));
      await invoke("recording_ack", { path: savedPath }).catch(() => {});
    } catch (failure) { setError(`Could not save to Library. Your recording is still here. ${String(failure)}`); }
    finally { setBusy(false); }
  }
  async function continueToTranscript(startImmediately: boolean) {
    if (!savedPath || busy) return;
    preview.current?.pause();
    setBusy(true); setError("");
    try {
      await onTranscribe({ path: savedPath, name: name.trim() || "Meeting", libraryId: item?.id }, startImmediately);
      setHandedOff(true);
    } catch (failure) { setError(`Could not open transcription. ${String(failure)}`); }
    finally { setBusy(false); }
  }
  function newRecording() {
    preview.current?.pause();
    setItem(null); setSavedPath(null); setHandedOff(false); setSeconds(0); setError("");
    setName(`Meeting · ${new Date().toLocaleDateString()}`);
    void invoke<RecordingDraftSummary[]>("recording_recoverable").then(setRecoverable).catch(() => {});
  }
  async function openDraft(draft: RecordingDraftSummary) {
    setBusy(true); setOpeningDraft(draft.folder); setError("");
    try {
      const path = await invoke<string>("recording_recover", { folder: draft.folder });
      setItem(null); setName(draft.name); setSeconds(0);
      setSavedPath(path);
      setHandedOff(false);
      setDraftsOpen(false);
      setRecoverable(list => list.map(candidate => candidate.folder === draft.folder ? { ...candidate, interrupted: false } : candidate));
    } catch (failure) { setError(`Could not ${draft.interrupted ? "restore the audio" : "open this recording"}. Your draft has been kept. ${String(failure)}`); }
    finally { setBusy(false); setOpeningDraft(null); }
  }
  async function renameDraft(draft: RecordingDraftSummary) {
    if (!draftName.trim() || busy) return;
    setBusy(true); setError("");
    try {
      await invoke("recording_rename_draft", { folder: draft.folder, name: draftName.trim() });
      setRecoverable(list => list.map(entry => entry.folder === draft.folder ? { ...entry, name: draftName.trim() } : entry));
      if (savedPath?.startsWith(`${draft.folder}/`)) setName(draftName.trim());
      setRenamingDraft(null);
    } catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  }
  async function deleteDraft(draft: RecordingDraftSummary) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await onDeleteDraft(draft.folder);
      setRecoverable(list => list.filter(entry => entry.folder !== draft.folder));
      if (savedPath?.startsWith(`${draft.folder}/`)) newRecording();
      setDeletingDraft(null);
    } catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  }
  function showDrafts() { setError(""); setRenamingDraft(null); setDeletingDraft(null); setDraftsOpen(true); }
  function reveal(folder: string) { void invoke("open_in_finder", { path: folder }).catch(failure => setError(String(failure))); }
  async function start() {
    setBusy(true); setError("");
    try {
      await invoke("recording_start", { mic, system, name: name.trim() || "Meeting" });
      setSeconds(0); setItem(null); setSavedPath(null); setHandedOff(false);
      elapsed.current = 0; segmentStart.current = performance.now(); setPaused(false);
      setMicMuted(false); setSystemMuted(false); setLevels({ mic: 0, system: 0 });
      setRecording(true); onRecordingChange(true);
    } catch (failure) { systemVerified.current = false; setError(String(failure)); void refreshPermissions(); }
    finally { setBusy(false); }
  }
  async function stop() {
    if (!paused) setSeconds(Math.floor((elapsed.current + performance.now() - segmentStart.current) / 1000));
    setBusy(true); setSaving(true); setError("");
    let path: string;
    try { path = await invoke<string>("recording_stop"); }
    catch (failure) {
      setRecording(false); onRecordingChange(false); setLevels({ mic: 0, system: 0 });
      setError(`Could not finish the recording. Open Draft recordings and choose Restore audio to try again. ${String(failure)}`);
      void invoke<RecordingDraftSummary[]>("recording_recoverable").then(setRecoverable).catch(() => {});
      setBusy(false); setSaving(false); return;
    }
    setRecording(false); onRecordingChange(false); setLevels({ mic: 0, system: 0 }); setSavedPath(path);
    setHandedOff(false); setBusy(false); setSaving(false);
  }
  async function mute(source: "mic" | "system") {
    const value = source === "mic" ? !micMuted : !systemMuted;
    try {
      await invoke("recording_mute", { source, muted: value });
      if (source === "mic") setMicMuted(value); else setSystemMuted(value);
      if (value) setLevels(previous => ({ ...previous, [source]: 0 }));
    } catch (failure) { setError(String(failure)); }
  }
  async function togglePause() {
    const next = !paused;
    setBusy(true); setError("");
    try {
      await invoke("recording_pause", { paused: next });
      const now = performance.now();
      if (next) { elapsed.current += now - segmentStart.current; setSeconds(Math.floor(elapsed.current / 1000)); }
      else segmentStart.current = now;
      setPaused(next); setLevels({ mic: 0, system: 0 });
    } catch (failure) { setError(`Could not ${next ? "pause" : "resume"} recording: ${String(failure)}`); }
    finally { setBusy(false); }
  }
  async function requestSystem() {
    setBusy(true); setError("");
    try {
      const granted = await invoke<boolean>("recording_request_system");
      systemVerified.current = granted;
      setPermissions(previous => ({ mic: previous?.mic ?? "prompt", system: granted }));
      setSystem(granted);
      if (!granted) {
        setError("Computer audio access is still unavailable for this build. If System Settings shows two Wordvale entries, enable the one for the build you are running (the plain executable for a development build). Quit and reopen Wordvale after changing access.");
        openPermissionSettings("system");
      }
    } catch (failure) { setError(`Could not request computer audio access: ${String(failure)}`); }
    finally { setBusy(false); }
  }
  function openPermissionSettings(source: "mic" | "system") {
    void invoke("recording_open_settings", { source }).catch(failure => setError(String(failure)));
  }

  const micUnavailable = !recording && permissions?.mic === "denied";
  const systemUnavailable = !recording && permissions !== null && !permissions.system;
  const micHelp = "Microphone permission is denied. Enable Wordvale in System Settings → Privacy & Security → Microphone.";
  const systemHelp = "Select this card to check and allow computer audio access. If macOS lists two Wordvale entries, the development executable and installed app have separate permissions. Enable the build you are using in System Settings → Privacy & Security → Screen & System Audio Recording, then quit and reopen it.";

  const energy = recording && !paused ? Math.max(mic && !micMuted ? levels.mic : 0, system && !systemMuted ? levels.system * 0.85 : 0) : 0;
  const time = `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  const availableDrafts = recoverable;

  return <main className="recorder-page">
    <header className="recorder-header"><div><h2>Record</h2><p>Capture a meeting and bring it straight into Wordvale.</p></div>{recording ? <span className={`recorder-live${paused ? " is-paused" : ""}`}><span /> {paused ? "Paused" : "Recording"}</span> : availableDrafts.length > 0 && <button ref={draftsButton} className="recorder-header-drafts" disabled={busy} onClick={showDrafts} aria-label={`Draft recordings, ${availableDrafts.length}`}><AudioLines size={16}/>Drafts<span>{availableDrafts.length}</span></button>}</header>
    <div className="recorder-content"><section className={`recorder-stage${savedPath ? " is-reviewing" : ""}`}>
      <div className={`recorder-orb${recording ? " is-recording" : ""}`} aria-hidden="true">
        <FlowingMark energy={energy} active={recording && !paused && visible} />
      </div>
      <div className="recorder-time" aria-live="off">{time}</div>
      <p className="recorder-state" role="status">{saving ? "Finishing recording…" : recording ? paused ? "Paused · nothing is being recorded" : "Recording in progress" : savedPath ? "Ready to transcribe" : "Ready when you are"}</p>
      {!savedPath && !saving && <><label className="recorder-name">Meeting name<input value={name} onChange={event => setName(event.target.value)} disabled={recording} /></label>
      <div className="recorder-sources">
        <div className={`recorder-source-wrap${micUnavailable ? " permission-unavailable" : ""}`}><button type="button" className="recorder-source" aria-label={micUnavailable ? "Microphone permission denied. Open settings" : "Microphone"} aria-pressed={micUnavailable ? undefined : mic && !(recording && micMuted)} aria-describedby={micUnavailable ? "recorder-mic-help" : undefined} disabled={busy || (recording && !mic)} onClick={() => micUnavailable ? openPermissionSettings("mic") : recording ? void mute("mic") : setMic(!mic)}><Mic size={20}/><span className="recorder-source-copy"><strong>Microphone</strong><span>{micUnavailable ? "Permission denied · Fix" : recording && !mic ? "Not included" : recording && micMuted ? "Muted" : mic ? "On" : "Off"}</span></span>{mic && !(recording && micMuted) ? <Volume2 className="recorder-source-status" size={17}/> : <VolumeX className="recorder-source-status" size={17}/>}</button>{micUnavailable && <span id="recorder-mic-help" className="recorder-permission-tooltip" role="tooltip">{micHelp}</span>}</div>
        <div className={`recorder-source-wrap${systemUnavailable ? " permission-unavailable" : ""}`}><button type="button" className="recorder-source" aria-label={systemUnavailable ? "Computer audio permission needed. Allow access" : "Computer audio"} aria-pressed={systemUnavailable ? undefined : system && !(recording && systemMuted)} aria-describedby={systemUnavailable ? "recorder-system-help" : undefined} disabled={busy || (recording && !system)} onClick={() => systemUnavailable ? void requestSystem() : recording ? void mute("system") : setSystem(!system)}><MonitorSpeaker size={20}/><span className="recorder-source-copy"><strong>Computer audio</strong><span>{systemUnavailable ? "Permission needed · Fix" : recording && !system ? "Not included" : recording && systemMuted ? "Muted" : system ? "On" : "Off"}</span></span>{system && !(recording && systemMuted) ? <Volume2 className="recorder-source-status" size={17}/> : <VolumeX className="recorder-source-status" size={17}/>}</button>{systemUnavailable && <span id="recorder-system-help" className="recorder-permission-tooltip" role="tooltip">{systemHelp}</span>}</div>
      </div>
      </>}
      {error && !draftsOpen && <p className="recorder-error" role="alert">{error}</p>}
      
      {!item && !saving && !savedPath && <div className="recorder-actions">{recording ? <div className="recorder-active-actions"><button className="recorder-control recorder-pause" disabled={busy} onClick={() => void togglePause()}><span className="recorder-control-disc">{paused ? <Play size={23} fill="currentColor"/> : <Pause size={23} fill="currentColor"/>}</span><span>{paused ? "Resume" : "Pause"}</span></button><button className="recorder-control recorder-stop" disabled={busy} onClick={() => void stop()}><span className="recorder-control-disc"><Square size={20} fill="currentColor"/></span><span>Stop recording</span></button></div> : <button className="recorder-control recorder-start" disabled={busy || (!mic && !system)} onClick={() => void start()}><span className="recorder-control-disc"><Circle size={25} fill="currentColor"/></span><span>{busy ? "Starting…" : "Start recording"}</span></button>}</div>}
      {savedPath && !recording && <div className="recorder-review">
        <label className="recorder-name"><span className="sr-only">Recording name</span><input value={name} onChange={event => setName(event.target.value)} disabled={busy || !!item || handedOff} /></label>
        {previewSource && <RecordingPreview audioRef={preview} source={previewSource} onDuration={duration => setSeconds(Math.floor(duration))} />}
        <div className="recorder-review-primary"><button ref={transcribeButton} className="btn-primary" disabled={busy || (!handedOff && !!transcribeUnavailable)} onClick={() => void continueToTranscript(!handedOff)}>{busy ? "Working…" : handedOff ? "Open transcription" : "Transcribe"}<ArrowRight size={16}/></button><p>{!handedOff && transcribeUnavailable || transcriptionSummary}</p></div>
        <div className="recorder-review-toolbar">
          {item ? <button disabled={busy} onClick={onLibrary}><LibraryBig size={15}/>Saved in Library</button> : <button disabled={busy} onClick={() => void saveToLibrary()}><LibraryBig size={15}/>Save to Library</button>}
          <div className="recorder-toolbar-end"><button disabled={busy} onClick={newRecording}><Plus size={15}/>New recording</button>
            <DropdownMenu.Root open={actionMenu === "current"} onOpenChange={open => setActionMenu(open ? "current" : null)}><DropdownMenu.Trigger asChild><button className="recorder-more" aria-label="More recording actions" disabled={busy}><MoreHorizontal size={19}/></button></DropdownMenu.Trigger>
              <DropdownMenu.Portal><DropdownMenu.Content className="recorder-menu" side="top" align="end" sideOffset={6}>
                <DropdownMenu.Item className="recorder-menu-item" onSelect={() => void continueToTranscript(false)}><SlidersHorizontal size={15}/>Adjust transcription settings</DropdownMenu.Item>
                <DropdownMenu.Item className="recorder-menu-item" onSelect={() => reveal(savedPath.substring(0, savedPath.lastIndexOf("/")))}><FolderOpen size={15}/>Show in Finder</DropdownMenu.Item>
              </DropdownMenu.Content></DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      </div>}


    </section></div>
    <Dialog.Root open={draftsOpen} onOpenChange={open => { if (!busy) setDraftsOpen(open); }}>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[70] bg-black/50" />
        <Dialog.Content onCloseAutoFocus={event => { event.preventDefault(); if (savedPath) transcribeButton.current?.focus(); else draftsButton.current?.focus(); }} onEscapeKeyDown={event => { if (actionMenu) { event.preventDefault(); setActionMenu(null); } }} className="recorder-drafts-dialog fixed left-1/2 top-1/2 z-[71] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-surface-700/70 bg-surface-900 p-6 shadow-2xl focus:outline-none">
          <div className="flex items-center justify-between gap-3"><Dialog.Title className="text-lg font-semibold text-surface-100">Draft recordings</Dialog.Title><Dialog.Close asChild><button className="btn-ghost p-2" disabled={busy} aria-label="Close drafts"><X size={17}/></button></Dialog.Close></div>
          <Dialog.Description className="mt-2 text-xs leading-relaxed text-surface-400">Audio kept for later, without adding it to Library. Open a draft to listen or transcribe.</Dialog.Description>
          <div className="recorder-drafts-list">{availableDrafts.length ? availableDrafts.map(draft => <div key={draft.folder} className="recorder-draft-entry">
            <div className="recorder-draft-row"><AudioLines size={20} aria-hidden="true" />
              <div className="recorder-draft-copy">{renamingDraft === draft.folder ? <form className="recorder-draft-rename" onSubmit={event => { event.preventDefault(); void renameDraft(draft); }}><input className="input-field" aria-label="Draft name" value={draftName} maxLength={200} onChange={event => setDraftName(event.target.value)} disabled={busy} autoFocus/><div><button type="submit" disabled={busy || !draftName.trim()}>Save</button><button type="button" disabled={busy} onClick={() => setRenamingDraft(null)}>Cancel</button></div></form> : <><strong>{draft.name}</strong><span>{draft.created_at ? new Date(draft.created_at).toLocaleString(undefined, {month:"short", day:"numeric", hour:"numeric", minute:"2-digit"}) : "Previous session"}</span>{draft.interrupted && <p>Interrupted · restore audio to continue</p>}</>}</div>
              {renamingDraft !== draft.folder && <><button className="recorder-draft-open" disabled={busy} onClick={() => void openDraft(draft)}>{openingDraft === draft.folder ? "Opening…" : draft.interrupted ? "Restore audio" : "Open"}<ArrowRight size={14}/></button>
              <DropdownMenu.Root open={actionMenu === draft.folder} onOpenChange={open => setActionMenu(open ? draft.folder : null)}><DropdownMenu.Trigger asChild><button className="recorder-more" disabled={busy} aria-label={`Actions for ${draft.name}`}><MoreHorizontal size={18}/></button></DropdownMenu.Trigger>
                <DropdownMenu.Portal><DropdownMenu.Content className="recorder-menu" align="end" sideOffset={4}>
                  <DropdownMenu.Item className="recorder-menu-item" disabled={draftInUse(draft.folder)} onSelect={() => { setRenamingDraft(draft.folder); setDraftName(draft.name); setDeletingDraft(null); }}><Pencil size={15}/>Rename</DropdownMenu.Item>
                  <DropdownMenu.Item className="recorder-menu-item" onSelect={() => reveal(draft.folder)}><FolderOpen size={15}/>Show in Finder</DropdownMenu.Item>
                  <DropdownMenu.Separator className="recorder-menu-separator"/>
                  <DropdownMenu.Item className="recorder-menu-item is-danger" disabled={draftInUse(draft.folder)} onSelect={() => { setDeletingDraft(draft.folder); setRenamingDraft(null); }}><Trash2 size={15}/>Delete draft</DropdownMenu.Item>
                  {draftInUse(draft.folder) && <div className="recorder-menu-note">Used by the queue or Library</div>}
                </DropdownMenu.Content></DropdownMenu.Portal>
              </DropdownMenu.Root></>}
            </div>
            {deletingDraft === draft.folder && <div className="recorder-draft-delete" role="group" aria-label={`Confirm deleting ${draft.name}`}><p>Delete “{draft.name}” and its audio? This cannot be undone.</p><div><button disabled={busy} onClick={() => setDeletingDraft(null)}>Keep draft</button><button className="is-danger" disabled={busy} onClick={() => void deleteDraft(draft)}>{busy ? "Deleting…" : "Delete draft"}</button></div></div>}
          </div>) : <p className="recorder-drafts-empty" role="status">No draft recordings.</p>}</div>
          {error && <p className="recorder-error" role="alert">{error}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </main>;
}
