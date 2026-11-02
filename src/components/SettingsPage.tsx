import { useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { open } from "@tauri-apps/api/shell";
import { version } from "../../package.json";
import type { BackendDebugEntry } from "../types/models";
import BackendDebugPanel from "./BackendDebugPanel";

interface Release {
    tag_name: string;
    draft: boolean;
    assets: { name: string }[];
}

type Version = { numbers: number[]; pre: string[] };
function parseVersion(value: string): Version | null {
    const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
    return match ? { numbers: match.slice(1, 4).map(Number), pre: match[4]?.split(".") ?? [] } : null;
}
function compareVersions(a: Version, b: Version): number {
    for (let i = 0; i < 3; i++) if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] - b.numbers[i];
    if (!a.pre.length || !b.pre.length) return Number(!a.pre.length) - Number(!b.pre.length);
    for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
        if (a.pre[i] === undefined) return -1;
        if (b.pre[i] === undefined) return 1;
        if (a.pre[i] === b.pre[i]) continue;
        const an = /^\d+$/.test(a.pre[i]), bn = /^\d+$/.test(b.pre[i]);
        if (an && bn) return Number(a.pre[i]) - Number(b.pre[i]);
        if (an !== bn) return an ? -1 : 1;
        return a.pre[i] < b.pre[i] ? -1 : 1;
    }
    return 0;
}

export default function SettingsPage(props: { logs: BackendDebugEntry[]; isBackendReady: boolean; isUsingMockBackend: boolean; error: string | null }) {
    const [status, setStatus] = useState<"idle" | "checking" | "current" | "available" | "error">("idle");
    const [available, setAvailable] = useState<string | null>(null);
    const [message, setMessage] = useState("");

    async function checkUpdates() {
        setStatus("checking");
        try {
            const response = await fetch("https://api.github.com/repos/arinaggarwal1/Wordvale/releases?per_page=100", { headers: { Accept: "application/vnd.github+json" } });
            if (!response.ok) throw new Error(`GitHub returned ${response.status}. Please try again later.`);
            const releases: Release[] = await response.json();
            const current = parseVersion(version);
            if (!current || !Array.isArray(releases)) throw new Error("Could not read release information.");
            const newer = releases.filter((release) => {
                const parsed = parseVersion(release.tag_name);
                return !release.draft && parsed && compareVersions(parsed, current) > 0 && release.assets.some((asset) => asset.name === "Wordvale-macOS-arm64.dmg");
            }).sort((a, b) => compareVersions(parseVersion(b.tag_name)!, parseVersion(a.tag_name)!))[0];
            setAvailable(newer?.tag_name ?? null);
            setStatus(newer ? "available" : "current");
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "Could not check GitHub releases.");
            setStatus("error");
        }
    }

    async function openRelease() {
        if (!available) return;
        const url = `https://github.com/arinaggarwal1/Wordvale/releases/tag/${encodeURIComponent(available)}`;
        const isTauri: boolean = "__TAURI__" in window;
        if (isTauri) await open(url);
        else window.open(url, "_blank", "noopener,noreferrer");
    }

    return <main className="flex-1 min-w-0 overflow-y-auto p-8">
        <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-surface-100">Settings</h2>
            <p className="text-sm text-surface-400 mt-1">Manage updates and troubleshoot the backend.</p>
            <section className="card p-5 mt-6">
                <h3 className="text-sm font-semibold text-surface-100">Updates</h3>
                <p className="text-xs text-surface-400 mt-2">Current version: {version}</p>
                <p className="text-xs text-surface-400 mt-1">Updates are installed manually using the macOS Apple silicon DMG.</p>
                <div className="flex flex-wrap items-center gap-3 mt-4">
                    <button className="btn-primary text-xs" onClick={checkUpdates} disabled={status === "checking"}>
                        <RefreshCw className={`w-4 h-4 ${status === "checking" ? "animate-spin" : ""}`} />
                        {status === "checking" ? "Checking..." : "Check for updates"}
                    </button>
                    {status === "available" && <button className="btn-ghost text-xs" onClick={openRelease}><ExternalLink className="w-4 h-4" /> Open release</button>}
                </div>
                <p role="status" className="text-xs text-surface-300 mt-3">
                    {status === "current" && "You're up to date."}
                    {status === "available" && `Version ${available} is available on GitHub.`}
                    {status === "error" && message}
                </p>
            </section>
            <BackendDebugPanel {...props} />
        </div>
    </main>;
}
