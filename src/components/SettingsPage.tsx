import { useEffect, useState } from "react";
import { ArrowLeft, Download, ExternalLink, RefreshCw, RotateCw } from "lucide-react";
import { open } from "@tauri-apps/api/shell";
import { invoke } from "@tauri-apps/api/tauri";
import { exit } from "@tauri-apps/api/process";
import { version } from "../../package.json";
import type { BackendDebugEntry } from "../types/models";
import BackendDebugPanel from "./BackendDebugPanel";
import { applyTheme, getTheme, themes, type ThemeId } from "../themes";

interface UpdateStatus {
    status: "idle" | "checking" | "current" | "available" | "downloading" | "ready" | "installing" | "unavailable" | "error";
    current_version: string | null;
    latest_version: string | null;
    message: string;
    progress: number;
    can_install: boolean;
}
interface Props {
    onBack: () => void;
    logs: BackendDebugEntry[];
    isBackendReady: boolean;
    isUsingMockBackend: boolean;
    error: string | null;
    updateBlocked: boolean;
    updateCommand: (command: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export default function SettingsPage({ onBack, updateCommand, updateBlocked, ...props }: Props) {
    const [update, setUpdate] = useState<UpdateStatus>({ status: "idle", current_version: version, latest_version: null, message: "", progress: 0, can_install: false });
    const [busy, setBusy] = useState(false);
    const [theme, setTheme] = useState<ThemeId>(getTheme);
    const [connectionError, setConnectionError] = useState("");
    const isDesktop = "__TAURI__" in window && !props.isUsingMockBackend;

    useEffect(() => {
        if (!isDesktop || !props.isBackendReady) return;
        let cancelled = false;
        async function refresh() {
            try {
                const response = await updateCommand("update_status");
                if (!cancelled && response.update) { setUpdate(response.update as unknown as UpdateStatus); setConnectionError(""); }
            } catch {
                if (!cancelled) setConnectionError("Could not reach the update service. Trying again…");
            }
        }
        void refresh();
        const timer = window.setInterval(refresh, 1500);
        return () => { cancelled = true; window.clearInterval(timer); };
    }, [isDesktop, props.isBackendReady, updateCommand]);

    async function perform(command: string, params?: Record<string, unknown>) {
        setBusy(true); setConnectionError("");
        try {
            const response = await updateCommand(command, params);
            if (response.update) setUpdate(response.update as unknown as UpdateStatus);
            return true;
        } catch (error) {
            setConnectionError(error instanceof Error ? error.message : String(error));
            return false;
        } finally { setBusy(false); }
    }
    async function check() {
        setUpdate((previous) => ({ ...previous, status: "checking", message: "Checking GitHub…" }));
        await perform("update_check", { current_version: version });
    }
    async function install() {
        if (updateBlocked) return;
        try {
            const appPid = await invoke<number>("app_process_id");
            if (await perform("update_install", { app_pid: appPid })) await exit(0);
        } catch (error) { setConnectionError(`Could not restart: ${String(error)}`); }
    }
    const working = busy || ["checking", "downloading", "installing"].includes(update.status);
    return <main className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-surface-950 p-6 lg:p-8">
        <div className="mx-auto max-w-6xl">
            <button onClick={onBack} className="page-back"><ArrowLeft className="h-4 w-4" /> Back to transcription</button>
        <div className="w-full">
            <h2 className="text-3xl font-bold text-surface-100">Settings</h2>
            <p className="mt-2 text-sm leading-relaxed text-surface-400">Choose how Wordvale looks, manage updates, and troubleshoot the backend.</p>
            <section className="appearance-section settings-section" aria-labelledby="appearance-title">
                <div className="appearance-heading"><div><h3 id="appearance-title">Appearance</h3><p>Choose a theme for your workspace.</p></div><span>Saved on this Mac</span></div>
                <div className="theme-grid" role="radiogroup" aria-label="Appearance theme">
                    {themes.map((item) => <label key={item.id} className={`theme-option${theme === item.id ? " is-selected" : ""}`}>
                        <input className="sr-only" type="radio" name="appearance-theme" value={item.id} checked={theme === item.id} onChange={() => { setTheme(item.id); applyTheme(item.id); }} />
                        <span className="theme-preview" style={{ background: item.colors[0], borderColor: item.colors[1] }}><span style={{ background: item.colors[1] }} /><span style={{ background: item.colors[2] }} /></span>
                        <span className="theme-option-copy"><strong>{item.name}</strong><span>{item.description}</span></span><span className="theme-radio" aria-hidden="true" />
                    </label>)}
                </div>
            </section>
            <section className="card p-5 settings-section">
                <h3 className="text-base font-semibold text-surface-100">Updates</h3>
                <p className="text-xs text-surface-400 mt-2">Current version: {version}{update.latest_version && update.latest_version !== version ? ` · Latest: ${update.latest_version}` : ""}</p>
                <p className="text-xs text-surface-400 mt-1">Updates are verified before installation. The app will restart to finish.</p>
                {!isDesktop && <p className="text-xs text-surface-400 mt-2">Open the desktop app to check for updates.</p>}
                {isDesktop && update.status === "available" && !update.can_install && <p className="text-xs text-warning-400 mt-2">Automatic installation is available in the installed Apple silicon app in a writable location. Use the release page to update this build.</p>}
                <div className="flex flex-wrap items-center gap-3 mt-4">
                    <button className="btn-primary text-xs" onClick={check} disabled={!isDesktop || !props.isBackendReady || working || update.status === "ready"}>
                        <RefreshCw className={`w-4 h-4 ${update.status === "checking" ? "animate-spin" : ""}`} />{update.status === "checking" ? "Checking…" : "Check for updates"}
                    </button>
                    {update.status === "available" && update.can_install && <button className="btn-ghost text-xs" onClick={() => void perform("update_download")} disabled={working}><Download className="w-4 h-4" /> Download update</button>}
                    {update.status === "ready" && <button className="btn-primary text-xs" onClick={install} disabled={working || updateBlocked}><RotateCw className="w-4 h-4" /> Install and restart</button>}
                    {(update.status === "available" || update.status === "unavailable" || update.status === "error") && <button className="btn-ghost text-xs" onClick={() => void open("https://github.com/arinaggarwal1/Wordvale/releases/latest")}><ExternalLink className="w-4 h-4" /> Open release</button>}
                </div>
                {update.status === "ready" && updateBlocked && <p className="text-xs text-warning-400 mt-3">Finish active work and save all transcripts before installing.</p>}
                {update.status === "downloading" && <div className="mt-4"><div className="h-1.5 rounded-full bg-surface-800 overflow-hidden"><div className="h-full bg-accent-400 transition-all" style={{ width: `${Math.max(0, Math.min(100, update.progress))}%` }} /></div><p className="text-xs text-surface-400 mt-1">{update.progress}%</p></div>}
                <p role="status" className="text-xs text-surface-300 mt-3">{connectionError || update.message}</p>
            </section>
            <div className="settings-section"><BackendDebugPanel {...props} /></div>
        </div>
        </div>
    </main>;
}
