import { useState } from "react";
import { ChevronDown, FolderOpen, HardDrive, RefreshCw, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/tauri";
import type { ModelStorageInfo } from "../types/models";

interface ModelManagerPanelProps {
    modelStorage: ModelStorageInfo | null;
    currentModel: string | null;
    isTranscribing: boolean;
    onRefresh: () => Promise<void>;
    onDeleteModel: (modelName: string) => Promise<void>;
    onDeleteAllModels: () => Promise<void>;
}

function formatStorage(sizeMb: number): string {
    if (sizeMb >= 1024) {
        return `${(sizeMb / 1024).toFixed(2)} GB`;
    }
    return `${sizeMb.toFixed(0)} MB`;
}

export default function ModelManagerPanel({
    modelStorage,
    currentModel,
    isTranscribing,
    onRefresh,
    onDeleteModel,
    onDeleteAllModels,
}: ModelManagerPanelProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [busyModel, setBusyModel] = useState<string | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isDeletingAll, setIsDeletingAll] = useState(false);
    const [isOpeningFolder, setIsOpeningFolder] = useState(false);

    async function handleRefresh() {
        if (isRefreshing) return;
        setIsRefreshing(true);
        try {
            await onRefresh();
        } finally {
            setIsRefreshing(false);
        }
    }

    async function handleDeleteModel(modelName: string) {
        if (busyModel || isDeletingAll || isTranscribing) return;
        const confirmed = window.confirm(`Delete the downloaded "${modelName}" model from disk?`);
        if (!confirmed) return;

        setBusyModel(modelName);
        try {
            await onDeleteModel(modelName);
        } finally {
            setBusyModel(null);
        }
    }

    async function handleDeleteAll() {
        if (isDeletingAll || busyModel || isTranscribing) return;
        const confirmed = window.confirm("Delete all downloaded models from disk?");
        if (!confirmed) return;

        setIsDeletingAll(true);
        try {
            await onDeleteAllModels();
        } finally {
            setIsDeletingAll(false);
        }
    }

    async function handleOpenFolder() {
        if (!modelStorage?.models_dir || isOpeningFolder) return;
        setIsOpeningFolder(true);
        try {
            await invoke("open_in_finder", { path: modelStorage.models_dir });
        } finally {
            setIsOpeningFolder(false);
        }
    }

    const downloadedCount = modelStorage?.downloaded_count ?? 0;
    const totalSize = formatStorage(modelStorage?.total_size_mb ?? 0);

    return (
        <div className="card p-4 mt-4">
            <button
                onClick={() => setIsOpen((prev) => !prev)}
                className="w-full flex items-start justify-between gap-3 text-left"
            >
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <HardDrive className="w-4 h-4 text-surface-400 shrink-0" />
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-400">
                            Model Manager
                        </h3>
                    </div>
                    <p className="mt-2 text-sm text-surface-200">
                        {downloadedCount} downloaded {downloadedCount === 1 ? "model" : "models"}
                    </p>
                    <p className="mt-0.5 text-xs text-surface-500">
                        {totalSize} stored outside the app so updates stay small.
                    </p>
                </div>

                <ChevronDown
                    className={`w-4 h-4 text-surface-400 transition-transform duration-200 shrink-0 mt-0.5 ${isOpen ? "rotate-180" : ""}`}
                />
            </button>

            {isOpen && (
                <div className="mt-4 space-y-4 animate-slide-down">
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={handleRefresh}
                            className="btn-ghost text-xs justify-center"
                            disabled={isRefreshing}
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                            Refresh
                        </button>

                        <button
                            onClick={handleOpenFolder}
                            className="btn-ghost text-xs justify-center"
                            disabled={!modelStorage?.models_dir || isOpeningFolder}
                        >
                            <FolderOpen className="w-3.5 h-3.5" />
                            {isOpeningFolder ? "Opening..." : "Open Folder"}
                        </button>
                    </div>

                    {!modelStorage || modelStorage.downloaded_models.length === 0 ? (
                        <div className="rounded-xl border border-surface-800/60 bg-surface-900/30 px-4 py-4">
                            <p className="text-sm text-surface-300">No models downloaded yet.</p>
                            <p className="mt-1 text-xs text-surface-500">
                                Models download the first time you load them, then stay available between app updates.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {modelStorage.downloaded_models.map((model) => {
                                const isBusy = busyModel === model.name;
                                const isActive = currentModel === model.name;

                                return (
                                    <div
                                        key={model.name}
                                        className="rounded-xl border border-surface-800/60 bg-surface-900/35 px-3.5 py-3"
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <p
                                                        className="text-sm font-medium text-surface-100 truncate"
                                                        title={model.display_name}
                                                    >
                                                        {model.display_name}
                                                    </p>
                                                    {isActive && (
                                                        <span className="rounded-full border border-accent-500/30 bg-accent-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent-300">
                                                            Active
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="mt-1 text-xs text-surface-500">
                                                    {formatStorage(model.size_mb)}
                                                </p>
                                                <p className="mt-1 text-[11px] text-surface-500 break-words">
                                                    {model.recommended_use_case}
                                                </p>
                                            </div>

                                            <button
                                                onClick={() => handleDeleteModel(model.name)}
                                                disabled={isBusy || isDeletingAll || isTranscribing}
                                                className="shrink-0 rounded-lg px-2.5 py-2 text-surface-400 hover:text-danger-300 hover:bg-danger-500/10 transition-colors disabled:opacity-40"
                                                title={`Delete ${model.display_name}`}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>

                                        {isBusy && (
                                            <p className="mt-2 text-[11px] text-surface-500">Deleting…</p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {modelStorage && modelStorage.downloaded_models.length > 0 && (
                        <button
                            onClick={handleDeleteAll}
                            disabled={isDeletingAll || busyModel !== null || isTranscribing}
                            className="w-full flex items-center justify-center gap-2 rounded-xl border border-danger-500/30 bg-danger-500/10 py-3 text-sm font-medium text-danger-200 hover:bg-danger-500/15 disabled:opacity-50"
                        >
                            <Trash2 className="w-4 h-4" />
                            {isDeletingAll ? "Deleting Models..." : "Delete All Models"}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
