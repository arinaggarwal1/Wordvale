/**
 * QueuePanel.tsx
 * File queue panel showing per-file status, reorder, and remove controls.
 */

import {
    Clock,
    Check,
    AlertCircle,
    Loader2,
    GripVertical,
    Trash2,
    ChevronUp,
    ChevronDown,
    List,
} from "lucide-react";
import type { QueueItem, QueueItemStatus } from "../types/models";
import { estimateTime, formatDuration } from "../constants";

interface QueuePanelProps {
    queue: QueueItem[];
    onRemove: (id: string) => void;
    onReorder: (fromIndex: number, toIndex: number) => void;
    currentModel: string | null;
    onSelect: (id: string | null) => void;
    selectedId: string | null;
}

const statusConfig: Record<
    QueueItemStatus,
    { icon: React.ReactNode; color: string; label: string }
> = {
    pending: {
        icon: <Clock className="w-3.5 h-3.5" />,
        color: "text-surface-400",
        label: "Pending",
    },
    processing: {
        icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
        color: "text-accent-400",
        label: "Processing",
    },
    completed: {
        icon: <Check className="w-3.5 h-3.5" />,
        color: "text-success-400",
        label: "Completed",
    },
    failed: {
        icon: <AlertCircle className="w-3.5 h-3.5" />,
        color: "text-danger-400",
        label: "Failed",
    },
};

export default function QueuePanel({
    queue,
    onRemove,
    onReorder,
    currentModel,
    onSelect,
    selectedId,
}: QueuePanelProps) {
    if (queue.length === 0) return null;

    const completedCount = queue.filter((q) => q.status === "completed").length;
    const totalCount = queue.length;

    return (
        <div className="card overflow-hidden animate-slide-up">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-surface-800/50">
                <div className="flex items-center gap-2">
                    <List className="w-4 h-4 text-surface-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-400">
                        Queue
                    </h3>
                    <span className="text-[10px] font-mono text-surface-500 bg-surface-800 rounded-full px-2 py-0.5">
                        {completedCount}/{totalCount}
                    </span>
                </div>
            </div>

            {/* Queue items */}
            <div className="max-h-48 overflow-y-auto">
                {queue.map((item, index) => {
                    const status = statusConfig[item.status];
                    const isSelected = selectedId === item.id;

                    return (
                        <div
                            key={item.id}
                            onClick={() => onSelect(item.id)}
                            className={`
                                flex items-center gap-3 px-4 py-2.5 border-b border-surface-800/30
                                transition-colors cursor-pointer
                                ${isSelected
                                    ? "bg-primary-500/10 border-primary-500/30"
                                    : "hover:bg-surface-800/30 border-transparent"}
                                ${item.status === "processing" && !isSelected ? "bg-accent-500/5" : ""}
                            `}
                        >
                            {/* Drag handle */}
                            <div
                                className="text-surface-600 cursor-grab hover:text-surface-400 p-1"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <GripVertical className="w-3.5 h-3.5" />
                            </div>

                            {/* Status icon */}
                            <div className={status.color}>{status.icon}</div>

                            {/* File info */}
                            <div className="flex-1 min-w-0">
                                <p className={`text-xs font-medium truncate ${isSelected ? "text-primary-200" : "text-surface-200"}`}>
                                    {item.fileName}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[10px] text-surface-500">{item.fileSizeMb} MB</span>
                                    <span className="text-[10px] text-surface-500">•</span>
                                    <span className="text-[10px] text-surface-500">
                                        Est: ~{formatDuration(estimateTime(item.fileSizeMb, currentModel))}
                                    </span>
                                    <span className={`text-[10px] font-medium ${status.color}`}>
                                        {status.label}
                                    </span>
                                </div>

                                {/* Progress bar */}
                                {item.status === "processing" && (
                                    <div className="mt-1.5 h-1 rounded-full bg-surface-800 overflow-hidden">
                                        <div
                                            className="h-full rounded-full progress-bar transition-all duration-300"
                                            style={{ width: `${item.progress}%` }}
                                        />
                                    </div>
                                )}

                                {/* Error message */}
                                {item.status === "failed" && item.error && (
                                    <p className="text-[10px] text-danger-400 mt-0.5 truncate">{item.error}</p>
                                )}
                            </div>

                            {/* Controls */}
                            <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                                {item.status === "pending" && (
                                    <>
                                        <button
                                            onClick={() => index > 0 && onReorder(index, index - 1)}
                                            disabled={index === 0}
                                            className="p-1 rounded text-surface-500 hover:text-surface-300 disabled:opacity-30"
                                            title="Move up"
                                        >
                                            <ChevronUp className="w-3 h-3" />
                                        </button>
                                        <button
                                            onClick={() =>
                                                index < queue.length - 1 && onReorder(index, index + 1)
                                            }
                                            disabled={index === queue.length - 1}
                                            className="p-1 rounded text-surface-500 hover:text-surface-300 disabled:opacity-30"
                                            title="Move down"
                                        >
                                            <ChevronDown className="w-3 h-3" />
                                        </button>
                                    </>
                                )}
                                <button
                                    onClick={() => onRemove(item.id)}
                                    className="p-1 rounded text-surface-500 hover:text-danger-400 transition-colors"
                                    title="Remove"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
