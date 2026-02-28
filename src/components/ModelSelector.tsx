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
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import type { WhisperModel } from "../types/models";
import { SUPPORTED_LANGUAGES } from "../types/models";

interface ModelSelectorProps {
    models: WhisperModel[];
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
    options: { value: string; label: string; sublabel?: string }[];
    onChange: (value: string) => void;
    disabled?: boolean;
}

function Dropdown({ label, icon, value, displayValue, options, onChange, disabled }: DropdownProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, []);

    return (
        <div ref={ref} className="relative">
            <label className="label">{label}</label>
            <button
                onClick={() => !disabled && setOpen(!open)}
                disabled={disabled}
                className="select-trigger"
            >
                <span className="flex items-center gap-2 truncate">
                    {icon}
                    <span className="truncate">{displayValue}</span>
                </span>
                <ChevronDown className={`w-4 h-4 text-surface-400 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>

            {open && (
                <div className="absolute z-50 mt-1 w-full rounded-xl border border-surface-700/50 bg-surface-850 shadow-xl max-h-64 overflow-y-auto animate-fade-in">
                    {options.map((opt) => (
                        <button
                            key={opt.value}
                            onClick={() => {
                                onChange(opt.value);
                                setOpen(false);
                            }}
                            className={`
                w-full text-left px-3 py-2.5 text-sm transition-colors
                ${opt.value === value
                                    ? "bg-accent-500/10 text-accent-300"
                                    : "text-surface-200 hover:bg-surface-800/60"
                                }
              `}
                        >
                            <span className="block truncate">{opt.label}</span>
                            {opt.sublabel && (
                                <span className="block text-xs text-surface-500 mt-0.5">{opt.sublabel}</span>
                            )}
                        </button>
                    ))}
                </div>
            )}
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
    currentModel,
    isLoading,
    selectedLanguage,
    selectedTask,
    onModelSelect,
    onLanguageChange,
    onTaskChange,
}: ModelSelectorProps) {
    const selectedModel = models.find((m) => m.name === currentModel);

    const modelOptions = models.map((m) => ({
        value: m.name,
        label: `${m.display_name}`,
        sublabel: `${m.parameter_count} · ~${m.estimated_vram_gb} GB VRAM · ${m.relative_speed}x speed`,
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
                        : selectedModel?.display_name || "Select model"
                }
                options={modelOptions}
                onChange={onModelSelect}
                disabled={isLoading}
            />

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
