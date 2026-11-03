/**
 * AdvancedSettingsPanel.tsx
 * Collapsible panel with transcription configuration.
 * Includes temperature, beam size, best_of, and toggle switches.
 */

import { useState } from "react";
import {
    Settings,
    ChevronDown,
    Sliders,
    Clock,
    Save,
} from "lucide-react";
import type { AdvancedSettings } from "../types/models";

interface AdvancedSettingsPanelProps {
    settings: AdvancedSettings;
    onSettingsChange: (settings: AdvancedSettings) => void;
}

/* ─── Toggle switch ─── */
function Toggle({
    checked,
    onChange,
    disabled,
    label,
}: {
    checked: boolean;
    onChange: (val: boolean) => void;
    disabled?: boolean;
    label: string;
}) {
    return (
        <button
            onClick={() => !disabled && onChange(!checked)}
            type="button"
            role="switch"
            aria-label={label}
            aria-checked={checked}
            disabled={disabled}
            className={`
        relative w-9 h-5 rounded-full transition-all duration-200 shrink-0
        ${checked ? "bg-accent-500" : "bg-surface-700"}
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
      `}
        >
            <div
                className={`
          absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200
          ${checked ? "translate-x-[18px]" : "translate-x-0.5"}
        `}
            />
        </button>
    );
}

/* ─── Slider with value ─── */
function SliderRow({
    label,
    icon,
    value,
    min,
    max,
    step,
    onChange,
    displayValue,
}: {
    label: string;
    icon: React.ReactNode;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (val: number) => void;
    displayValue?: string;
}) {
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-surface-300">
                    {icon}
                    {label}
                </div>
                <span className="text-xs font-mono text-accent-400">
                    {displayValue || value}
                </span>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                aria-label={label}
                aria-describedby={label === "Threads" ? "threads-help" : undefined}
                className="range-control w-full"
            />
        </div>
    );
}

/* ─── Toggle row ─── */
function ToggleRow({
    label,
    description,
    icon,
    checked,
    onChange,
}: {
    label: string;
    description?: string;
    icon: React.ReactNode;
    checked: boolean;
    onChange: (val: boolean) => void;
}) {
    return (
        <div className="flex items-start justify-between py-2">
            <div className="flex items-start gap-2 flex-1 min-w-0">
                <div className="mt-0.5 text-surface-400">{icon}</div>
                <div>
                    <p className="text-xs font-medium text-surface-200">{label}</p>
                    {description && (
                        <p className="text-[11px] text-surface-500 mt-0.5">{description}</p>
                    )}
                </div>
            </div>
            <Toggle checked={checked} onChange={onChange} label={label} />
        </div>
    );
}

export default function AdvancedSettingsPanel({
    settings,
    onSettingsChange,
}: AdvancedSettingsPanelProps) {
    const [isOpen, setIsOpen] = useState(false);

    const update = (partial: Partial<AdvancedSettings>) => {
        onSettingsChange({ ...settings, ...partial });
    };

    return (
        <div className="mt-4">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="select-trigger"
                aria-expanded={isOpen}
            >
                <span className="flex items-center gap-2">
                    <Settings className="w-4 h-4 text-surface-400" />
                    Advanced Settings
                </span>
                <ChevronDown
                    className={`w-4 h-4 text-surface-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""
                        }`}
                />
            </button>

            {isOpen && (
                <div className="mt-3 px-1 space-y-4 animate-slide-down">
                    {/* Sliders */}
                    <SliderRow
                        label="Threads"
                        icon={<Sliders className="w-3.5 h-3.5" />}
                        value={settings.threads}
                        min={1}
                        max={16}
                        step={1}
                        onChange={(v) => update({ threads: v })}
                    />

                    <p id="threads-help" className="text-[11px] leading-relaxed text-surface-500">
                        Controls CPU threads used by Whisper. More threads can speed things up, but may slow other apps or make your Mac warmer. Changes apply to the next run.
                    </p>

                    {/* Divider */}
                    <div className="border-t border-surface-800/50" />

                    {/* Toggles */}
                    <ToggleRow
                        label="Word Timestamps"
                        description="Include word-level timing data"
                        icon={<Clock className="w-3.5 h-3.5" />}
                        checked={settings.wordTimestamps}
                        onChange={(v) => update({ wordTimestamps: v })}
                    />

                    <ToggleRow
                        label="Auto Save Output"
                        description="Choose a folder at the start of each batch; saves text files"
                        icon={<Save className="w-3.5 h-3.5" />}
                        checked={settings.autoSaveOutput}
                        onChange={(v) => update({ autoSaveOutput: v })}
                    />
                </div>
            )}
        </div>
    );
}
