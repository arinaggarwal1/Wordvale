/**
 * ModelInfoPanel.tsx
 * Right sidebar panel showing model details, system info, and processing stats.
 */

import {
    Cpu,
    HardDrive,
    Monitor,
    Timer,
    Zap,
    Globe,
    Languages,
    Clock,
    Activity,
    MemoryStick,
} from "lucide-react";
import type { WhisperModel, SystemInfo, ProgressUpdate } from "../types/models";

interface ModelInfoPanelProps {
    model: WhisperModel | null;
    systemInfo: SystemInfo | null;
    progress: ProgressUpdate | null;
    isTranscribing: boolean;
    elapsedTime: number;
}

/* ─── Stat row ─── */
function StatRow({
    icon,
    label,
    value,
    accent,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    accent?: boolean;
}) {
    return (
        <div className="flex items-center justify-between py-1.5">
            <div className="flex items-center gap-2 text-surface-400">
                {icon}
                <span className="text-xs">{label}</span>
            </div>
            <span className={`text-xs font-medium ${accent ? "text-accent-400" : "text-surface-200"}`}>
                {value}
            </span>
        </div>
    );
}

/* ─── Badge ─── */
function Badge({ children, variant }: { children: React.ReactNode; variant: "success" | "warning" | "neutral" }) {
    const colors = {
        success: "bg-success-500/10 text-success-400 border-success-500/20",
        warning: "bg-warning-500/10 text-warning-400 border-warning-500/20",
        neutral: "bg-surface-800 text-surface-400 border-surface-700/50",
    };
    return (
        <span className={`status-badge border ${colors[variant]}`}>
            {children}
        </span>
    );
}

function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function ModelInfoPanel({
    model,
    systemInfo,
    progress,
    isTranscribing,
    elapsedTime,
}: ModelInfoPanelProps) {
    return (
        <div className="space-y-4">
            {/* ─── Model Info Card ─── */}
            <div className="card p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-400 mb-3 flex items-center gap-2">
                    <Cpu className="w-3.5 h-3.5" />
                    Model Info
                </h3>

                {model ? (
                    <div className="space-y-0.5 animate-fade-in">
                        <div className="mb-3">
                            <p className="text-base font-semibold text-surface-100">{model.display_name}</p>
                            <p className="text-xs text-surface-500 mt-0.5">{model.recommended_use_case}</p>
                        </div>

                        <StatRow
                            icon={<Activity className="w-3.5 h-3.5" />}
                            label="Parameters"
                            value={model.parameter_count}
                        />
                        <StatRow
                            icon={<MemoryStick className="w-3.5 h-3.5" />}
                            label="VRAM Required"
                            value={`~${model.estimated_vram_gb} GB`}
                        />
                        <StatRow
                            icon={<Zap className="w-3.5 h-3.5" />}
                            label="Relative Speed"
                            value={`${model.relative_speed}x`}
                            accent
                        />

                        <div className="flex gap-1.5 mt-3 flex-wrap">
                            {model.multilingual_support && (
                                <Badge variant="success">
                                    <Globe className="w-3 h-3" />
                                    Multilingual
                                </Badge>
                            )}
                            {model.translation_support && (
                                <Badge variant="success">
                                    <Languages className="w-3 h-3" />
                                    Translation
                                </Badge>
                            )}
                            {!model.multilingual_support && (
                                <Badge variant="neutral">English Only</Badge>
                            )}
                        </div>
                    </div>
                ) : (
                    <p className="text-xs text-surface-500 italic">Select a model to view details</p>
                )}
            </div>

            {/* ─── System Info Card ─── */}
            <div className="card p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-400 mb-3 flex items-center gap-2">
                    <Monitor className="w-3.5 h-3.5" />
                    System
                </h3>

                {systemInfo ? (
                    <div className="space-y-0.5 animate-fade-in">
                        <StatRow
                            icon={<Cpu className="w-3.5 h-3.5" />}
                            label="CPU Cores"
                            value={`${systemInfo.cpu_count}`}
                        />
                        <StatRow
                            icon={<HardDrive className="w-3.5 h-3.5" />}
                            label="RAM"
                            value={`${systemInfo.ram_available_gb} / ${systemInfo.ram_total_gb} GB`}
                        />
                        <StatRow
                            icon={<Zap className="w-3.5 h-3.5" />}
                            label="GPU"
                            value={systemInfo.gpu_available ? (systemInfo.gpu_name || "Available") : "Not available"}
                            accent={systemInfo.gpu_available}
                        />
                        {systemInfo.gpu_available && systemInfo.gpu_vram_total_gb > 0 && (
                            <StatRow
                                icon={<MemoryStick className="w-3.5 h-3.5" />}
                                label="VRAM"
                                value={`${systemInfo.gpu_vram_free_gb || 0} / ${systemInfo.gpu_vram_total_gb} GB`}
                            />
                        )}
                        <StatRow
                            icon={<Monitor className="w-3.5 h-3.5" />}
                            label="Device"
                            value={systemInfo.device.toUpperCase()}
                            accent
                        />
                        <StatRow
                            icon={<HardDrive className="w-3.5 h-3.5" />}
                            label="FFmpeg"
                            value={systemInfo.ffmpeg_available ? "Available" : "Missing"}
                            accent={systemInfo.ffmpeg_available}
                        />
                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="skeleton h-4 rounded w-full" />
                        <div className="skeleton h-4 rounded w-3/4" />
                        <div className="skeleton h-4 rounded w-5/6" />
                    </div>
                )}
            </div>

            {/* ─── Processing Stats ─── */}
            {isTranscribing && (
                <div className="card p-4 animate-slide-up">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-400 mb-3 flex items-center gap-2">
                        <Timer className="w-3.5 h-3.5" />
                        Processing
                    </h3>

                    <div className="space-y-3">
                        {/* Progress bar */}
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-xs text-surface-400">
                                    {progress?.message || progress?.stage || "Processing..."}
                                </span>
                                <span className="text-xs font-mono text-accent-400">
                                    {progress?.percent || 0}%
                                </span>
                            </div>
                            <div className="h-2 rounded-full bg-surface-800 overflow-hidden">
                                <div
                                    className="h-full rounded-full progress-bar transition-all duration-500"
                                    style={{ width: `${progress?.percent || 0}%` }}
                                />
                            </div>
                        </div>

                        <StatRow
                            icon={<Clock className="w-3.5 h-3.5" />}
                            label="Elapsed"
                            value={formatTime(elapsedTime)}
                            accent
                        />

                        {progress?.total_segments && (
                            <StatRow
                                icon={<Activity className="w-3.5 h-3.5" />}
                                label="Segments"
                                value={`${(progress.segment_index || 0) + 1} / ${progress.total_segments}`}
                            />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
