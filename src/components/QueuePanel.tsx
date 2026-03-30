/**
 * QueuePanel.tsx
 * File queue panel showing per-file status, reorder, and remove controls.
 */

import {
    Clock,
    Check,
    AlertCircle,
    Loader2,
    Trash2,
    ChevronUp,
    ChevronDown,
    List,
    Sparkles,
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
    isTranscribing: boolean;
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
    isTranscribing,
}: QueuePanelProps) {
    if (queue.length === 0) return null;

    const completedCount = queue.filter((q) => q.status === "completed").length;
    const totalCount = queue.length;
    const processingItems = queue.filter((item) => item.status === "processing");
    const pendingItems = queue.filter((item) => item.status === "pending");
    const finishedItems = queue.filter(
        (item) => item.status === "completed" || item.status === "failed"
    );
    const pendingQueueIndexes = pendingItems.map((item) =>
        queue.findIndex((queuedItem) => queuedItem.id === item.id)
    );
    const remainingEstimate = queue
        .filter((item) => item.status === "pending" || item.status === "processing")
        .reduce((total, item) => total + estimateTime(item.fileSizeMb, currentModel), 0);
    const headerSummary = processingItems.length > 0
        ? `Processing ${processingItems[0].fileName}`
        : pendingItems.length > 0
            ? `${pendingItems.length} file${pendingItems.length === 1 ? "" : "s"} waiting to run`
            : "Queue complete";

    function renderQueueItem(item: QueueItem, indexInQueue: number, pendingPosition?: number) {
        const status = statusConfig[item.status];
        const isSelected = selectedId === item.id;
        const canMoveUp = item.status === "pending" && pendingPosition !== undefined && pendingPosition > 0;
        const canMoveDown =
            item.status === "pending" &&
            pendingPosition !== undefined &&
            pendingPosition < pendingItems.length - 1;
        const moveUpIndex =
            pendingPosition !== undefined && pendingPosition > 0
                ? pendingQueueIndexes[pendingPosition - 1]
                : null;
        const moveDownIndex =
            pendingPosition !== undefined && pendingPosition < pendingItems.length - 1
                ? pendingQueueIndexes[pendingPosition + 1]
                : null;
        const isProcessing = item.status === "processing";
        const disableRemove = isProcessing && isTranscribing;

        return (
            <div
                key={item.id}
                onClick={() => onSelect(isSelected ? null : item.id)}
                className={`
                    rounded-xl border px-4 py-3 transition-colors cursor-pointer
                    ${isSelected
                        ? "border-accent-500/40 bg-accent-500/10"
                        : isProcessing
                            ? "border-accent-500/20 bg-accent-500/5 hover:border-accent-500/30"
                            : "border-surface-800/60 bg-surface-900/35 hover:bg-surface-800/35"}
                `}
            >
                <div className="flex items-start gap-3">
                    <div className={`mt-0.5 ${status.color}`}>{status.icon}</div>

                    <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className={`text-sm font-medium truncate ${isSelected ? "text-accent-200" : "text-surface-100"}`}>
                                    {item.fileName}
                                </p>
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-surface-500">
                                    <span>{item.fileSizeMb} MB</span>
                                    <span>•</span>
                                    <span>Est. {formatDuration(estimateTime(item.fileSizeMb, currentModel))}</span>
                                    <span>•</span>
                                    <span className={status.color}>{status.label}</span>
                                    {pendingPosition !== undefined && (
                                        <>
                                            <span>•</span>
                                            <span>#{pendingPosition + 1} in line</span>
                                        </>
                                    )}
                                </div>
                            </div>

                            <div
                                className="flex items-center gap-1 shrink-0"
                                onClick={(e) => e.stopPropagation()}
                            >
                                {item.status === "pending" && (
                                    <>
                                        <button
                                            onClick={() => canMoveUp && moveUpIndex !== null && onReorder(indexInQueue, moveUpIndex)}
                                            disabled={!canMoveUp}
                                            className="p-1.5 rounded-lg text-surface-500 hover:text-surface-200 hover:bg-surface-800/70 disabled:opacity-30"
                                            title="Move up"
                                        >
                                            <ChevronUp className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            onClick={() => canMoveDown && moveDownIndex !== null && onReorder(indexInQueue, moveDownIndex)}
                                            disabled={!canMoveDown}
                                            className="p-1.5 rounded-lg text-surface-500 hover:text-surface-200 hover:bg-surface-800/70 disabled:opacity-30"
                                            title="Move down"
                                        >
                                            <ChevronDown className="w-3.5 h-3.5" />
                                        </button>
                                    </>
                                )}

                                <button
                                    onClick={() => onRemove(item.id)}
                                    disabled={disableRemove}
                                    className="p-1.5 rounded-lg text-surface-500 hover:text-danger-300 hover:bg-danger-500/10 transition-colors disabled:opacity-30"
                                    title={disableRemove ? "Cannot remove the file currently being processed" : "Remove"}
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>

                        {isProcessing && (
                            <div className="mt-2.5">
                                <div className="h-1.5 rounded-full bg-surface-800 overflow-hidden">
                                    <div
                                        className="h-full rounded-full progress-bar transition-all duration-300"
                                        style={{ width: `${item.progress}%` }}
                                    />
                                </div>
                            </div>
                        )}

                        {item.status === "failed" && item.error && (
                            <p className="mt-2 text-[11px] text-danger-400 break-words">{item.error}</p>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="card animate-slide-up flex shrink-0 flex-col">
            {/* Header */}
            <div className="border-b border-surface-800/50 px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <List className="w-4 h-4 text-surface-400" />
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-400">
                                Queue
                            </h3>
                            <span className="text-[10px] font-mono text-surface-500 bg-surface-800 rounded-full px-2 py-0.5">
                                {completedCount}/{totalCount}
                            </span>
                        </div>
                        <p className="mt-1.5 text-sm text-surface-300 truncate">
                            {headerSummary}
                        </p>
                    </div>

                    <div className="rounded-lg border border-surface-800/60 bg-surface-900/50 px-3 py-2 text-right shrink-0">
                        <p className="text-[10px] uppercase tracking-wider text-surface-500">Remaining</p>
                        <p className="mt-0.5 text-sm font-semibold text-surface-100">
                            {remainingEstimate > 0 ? formatDuration(remainingEstimate) : "0s"}
                        </p>
                    </div>
                </div>
            </div>

            {/* Queue items */}
            <div className="px-4 py-4 space-y-0">
                {processingItems.length > 0 && (
                    <section className="space-y-2 pb-4">
                        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-accent-300">
                            <Sparkles className="w-3.5 h-3.5" />
                            Now Processing
                        </div>
                        {processingItems.map((item) =>
                            renderQueueItem(item, queue.findIndex((queuedItem) => queuedItem.id === item.id))
                        )}
                    </section>
                )}

                {pendingItems.length > 0 && (
                    <section className="space-y-2 pb-4">
                        <div className="text-[11px] font-medium uppercase tracking-wider text-surface-500">
                            Up Next
                        </div>
                        {pendingItems.map((item, pendingIndex) =>
                            renderQueueItem(
                                item,
                                queue.findIndex((queuedItem) => queuedItem.id === item.id),
                                pendingIndex
                            )
                        )}
                    </section>
                )}

                {finishedItems.length > 0 && (
                    <section className="space-y-2">
                        <div className="text-[11px] font-medium uppercase tracking-wider text-surface-500">
                            Finished
                        </div>
                        {finishedItems.map((item) =>
                            renderQueueItem(item, queue.findIndex((queuedItem) => queuedItem.id === item.id))
                        )}
                    </section>
                )}
            </div>
        </div>
    );
}
