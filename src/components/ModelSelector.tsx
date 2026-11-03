/**
 * ModelSelector.tsx
 * Sidebar model/language/task selector with polished dropdown controls.
 */

import {
    Cpu,
    Globe,
    Languages,
    Loader2,
    ChevronDown,
    LockKeyhole,
} from "lucide-react";
import * as Select from "@radix-ui/react-select";
import type { WhisperModel } from "../types/models";
import { SUPPORTED_LANGUAGES } from "../types/models";

interface ModelSelectorProps {
    models: WhisperModel[];
    downloadedModels: string[];
    currentModel: string | null;
    isLoading: boolean;
    selectedLanguage: string;
    selectedTask: string;
    onModelSelect: (model: string) => void;
    onLanguageChange: (lang: string) => void;
    onTaskChange: (task: string) => void;
}

/* ─── Generic dropdown component ─── */

interface DropdownProps {
    label: string;
    icon: React.ReactNode;
    value: string;
    displayValue: string;
    options: { value: string; label: string; sublabel?: string; locked?: boolean }[];
    onChange: (value: string) => void;
    disabled?: boolean;
}

function Dropdown({ label, icon, value, displayValue, options, onChange, disabled }: DropdownProps) {
    return (
        <div>
            <label className="label">{label}</label>
            <Select.Root value={value || undefined} onValueChange={onChange} disabled={disabled}>
                <Select.Trigger aria-label={`${label}: ${displayValue}`} className="select-trigger">
                    <span className="flex min-w-0 items-center gap-2">{icon}<Select.Value placeholder={displayValue} /></span>
                    <Select.Icon><ChevronDown className="w-4 h-4 text-surface-400" /></Select.Icon>
                </Select.Trigger>
                <Select.Portal>
                    <Select.Content className="sidebar-select-content" position="popper" sideOffset={4} align="start" collisionPadding={8}>
                        <Select.Viewport>
                            {options.map((option) => <Select.Item key={option.value} value={option.value} textValue={`${option.label}${option.locked ? ", not downloaded" : ""}`} className="sidebar-select-item">
                                <div className="flex min-w-0 flex-1 items-center justify-between gap-3"><div className="min-w-0"><Select.ItemText>{option.label}</Select.ItemText>{option.sublabel && <span className="block text-xs text-surface-500 mt-0.5">{option.sublabel}</span>}</div>{option.locked && <span className="flex shrink-0 items-center gap-1 text-xs text-surface-500"><LockKeyhole size={13} />Get model</span>}</div>
                            </Select.Item>)}
                        </Select.Viewport>
                    </Select.Content>
                </Select.Portal>
            </Select.Root>
        </div>
    );
}

/* ─── Speed bar indicator ─── */

function SpeedBar({ speed }: { speed: number }) {
    const pct = (speed / 10) * 100;
    return (
        <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-surface-800 overflow-hidden">
                <div
                    className="h-full rounded-full bg-gradient-to-r from-accent-500 to-accent-400 transition-all duration-500"
                    style={{ width: `${pct}%` }}
                />
            </div>
            <span className="text-[10px] text-surface-500 font-mono w-5 text-right">{speed}x</span>
        </div>
    );
}

export default function ModelSelector({
    models,
    downloadedModels,
    currentModel,
    isLoading,
    selectedLanguage,
    selectedTask,
    onModelSelect,
    onLanguageChange,
    onTaskChange,
}: ModelSelectorProps) {
    const selectedModel = models.find((m) => m.name === currentModel);

    const modelOptions = models.filter((m) => downloadedModels.includes(m.name)).map((m) => ({
        value: m.name,
        label: `${m.display_name}`,
        sublabel: `${m.parameter_count} · ~${m.estimated_vram_gb} GB VRAM · ${m.relative_speed}x speed`,
    }));
    const unavailableOptions = models.filter((m) => !downloadedModels.includes(m.name)).map((m) => ({
        value: m.name,
        label: m.display_name,
        sublabel: `${m.parameter_count} · ${m.relative_speed}x speed`,
        locked: true,
    }));

    const languageOptions = SUPPORTED_LANGUAGES.map((l) => ({
        value: l.code,
        label: l.name,
    }));

    const taskOptions = [
        { value: "transcribe", label: "Transcribe" },
        { value: "translate", label: "Translate to English" },
    ];

    return (
        <div className="space-y-4">
            {/* Model Selector */}
            <Dropdown
                label="Model"
                icon={
                    isLoading ? (
                        <Loader2 className="w-4 h-4 text-accent-400 animate-spin" />
                    ) : (
                        <Cpu className="w-4 h-4 text-accent-400" />
                    )
                }
                value={currentModel || ""}
                displayValue={
                    isLoading
                        ? "Loading model..."
                        : selectedModel?.display_name || "Base (default)"
                }
                options={[...modelOptions, ...unavailableOptions]}
                onChange={onModelSelect}
                disabled={isLoading}
            />
            {!currentModel && !isLoading && <p className="text-xs leading-relaxed text-surface-400">Base turns speech into text locally. Its first download needs internet.</p>}

            {/* Speed indicator for selected model */}
            {selectedModel && (
                <div className="px-1 animate-fade-in">
                    <div className="flex items-center justify-between text-xs text-surface-400 mb-1">
                        <span>Speed</span>
                        <span className="text-surface-500">{selectedModel.relative_speed}x relative</span>
                    </div>
                    <SpeedBar speed={selectedModel.relative_speed} />
                </div>
            )}

            {/* Language Selector */}
            <Dropdown
                label="Language"
                icon={<Globe className="w-4 h-4 text-emerald-400" />}
                value={selectedLanguage}
                displayValue={
                    SUPPORTED_LANGUAGES.find((l) => l.code === selectedLanguage)?.name || "Auto Detect"
                }
                options={languageOptions}
                onChange={onLanguageChange}
            />

            {currentModel?.endsWith(".en") && selectedLanguage !== "en" && (
                <p className="text-xs text-warning-400" role="alert">
                    This model only supports English. Select English or choose a multilingual model for this language or auto-detection.
                </p>
            )}

            {selectedTask === "translate" && selectedModel && !selectedModel.translation_support && (
                <p className="text-xs text-warning-400" role="alert">This model does not support translation. Choose a multilingual model such as Small or Large v3.</p>
            )}

            {/* Task Selector */}
            <Dropdown
                label="Task"
                icon={<Languages className="w-4 h-4 text-purple-400" />}
                value={selectedTask}
                displayValue={taskOptions.find((t) => t.value === selectedTask)?.label || "Transcribe"}
                options={taskOptions}
                onChange={onTaskChange}
            />
        </div>
    );
}
