import { useMemo, useState } from "react";
import { AlertTriangle, Bug, Check, ChevronDown, Clipboard } from "lucide-react";
import type { BackendDebugEntry } from "../types/models";

interface BackendDebugPanelProps {
    logs: BackendDebugEntry[];
    isBackendReady: boolean;
    isUsingMockBackend: boolean;
    error: string | null;
}

export default function BackendDebugPanel({
    logs,
    isBackendReady,
    isUsingMockBackend,
    error,
}: BackendDebugPanelProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    const renderedLogs = useMemo(() => {
        if (logs.length === 0) return "No backend log entries yet.";

        return logs
            .map((entry) => `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.message}`)
            .join("\n");
    }, [logs]);

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(renderedLogs);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Ignore clipboard failures and keep the panel open.
        }
    }

    return (
        <div className="card p-4 mt-4">
            <button
                onClick={() => setIsOpen((prev) => !prev)}
                className="w-full flex items-center justify-between"
            >
                <div className="flex items-center gap-2">
                    <Bug className="w-4 h-4 text-surface-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-400">
                        Backend Debug
                    </h3>
                </div>
                <ChevronDown
                    className={`w-4 h-4 text-surface-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
            </button>

            <div className="mt-3 space-y-1 text-xs text-surface-400">
                <p>Status: <span className={isBackendReady ? "text-success-400" : "text-warning-400"}>{isBackendReady ? "Ready" : "Not Ready"}</span></p>
                <p>Mode: <span className={isUsingMockBackend ? "text-warning-400" : "text-surface-200"}>{isUsingMockBackend ? "Mock backend" : "Real backend"}</span></p>
                {error && (
                    <p className="flex items-start gap-1.5 text-danger-400">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>{error}</span>
                    </p>
                )}
            </div>

            {isOpen && (
                <div className="mt-4 space-y-3 animate-slide-down">
                    <button onClick={handleCopy} className="btn-ghost text-xs">
                        {copied ? <Check className="w-3.5 h-3.5 text-success-400" /> : <Clipboard className="w-3.5 h-3.5" />}
                        {copied ? "Copied Logs" : "Copy Logs"}
                    </button>
                    <pre className="max-h-64 overflow-y-auto rounded-lg bg-surface-950 p-3 text-[11px] leading-relaxed text-surface-300 whitespace-pre-wrap break-words">
                        {renderedLogs}
                    </pre>
                </div>
            )}
        </div>
    );
}
