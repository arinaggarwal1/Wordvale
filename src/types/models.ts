/**
 * types/models.ts
 * Core TypeScript type definitions for Wordvale.
 */

/* ─── Whisper Model ─── */

export interface WhisperModel {
    name: string;
    display_name: string;
    parameter_count: string;
    parameter_count_raw: number;
    estimated_vram_gb: number;
    relative_speed: number;
    multilingual_support: boolean;
    english_only_variant: string | null;
    translation_support: boolean;
    recommended_use_case: string;
    accuracy_tier: string;
}

/* ─── System Info ─── */

export interface SystemInfo {
    gpu_available: boolean;
    gpu_name: string | null;
    gpu_vram_total_gb: number;
    gpu_vram_used_gb?: number;
    gpu_vram_free_gb?: number;
    device: string;
    force_cpu: boolean;
    current_model: string | null;
    model_loaded: boolean;
    cpu_count: number;
    ram_total_gb: number;
    ram_available_gb: number;
}

/* ─── Transcription ─── */

export type QueueItemStatus = "pending" | "processing" | "completed" | "failed";

export interface QueueItem {
    id: string;
    filePath: string;
    fileName: string;
    fileSizeMb: number;
    durationSeconds?: number;
    format: string;
    status: QueueItemStatus;
    progress: number;
    result?: TranscriptionResult;
    error?: string;
    addedAt: number;
}

export interface TranscriptionSegment {
    id: number;
    start: number;
    end: number;
    text: string;
    speaker?: string;
    words?: WordTimestamp[];
}

export interface WordTimestamp {
    word: string;
    start: number;
    end: number;
    probability: number;
}

export interface TranscriptionResult {
    status: string;
    text: string;
    srt: string;
    segments: TranscriptionSegment[];
    language: string;
    duration_seconds: number;
    file: string;
    file_path: string;
}

/* ─── Advanced Settings ─── */

export interface AdvancedSettings {
    threads: number;
    wordTimestamps: boolean;
    forceCpu: boolean;
    verboseLogging: boolean;
    autoDetectLanguage: boolean;
    autoSaveOutput: boolean;
}

export const DEFAULT_SETTINGS: AdvancedSettings = {
    threads: 4,
    wordTimestamps: false,
    forceCpu: false,
    verboseLogging: false,
    autoDetectLanguage: true,
    autoSaveOutput: false,
};

/* ─── Backend IPC Messages ─── */

export interface BackendCommand {
    id?: string;
    command: string;
    params?: Record<string, unknown>;
}

export interface BackendResponse {
    type: "response" | "progress" | "error" | "ready";
    id?: string;
    data: Record<string, unknown>;
}

export interface ProgressUpdate {
    type: "progress" | "partial_result";
    stage: string;
    percent: number;
    message?: string;
    file?: string;
    segment_index?: number;
    total_segments?: number;
    segment?: TranscriptionSegment;
}

/* ─── Export Options ─── */

export type ExportFormat = "txt" | "srt" | "json";

export interface ExportOptions {
    format: ExportFormat;
    includeTimestamps: boolean;
    includeSpeakerPlaceholders: boolean;
}

/* ─── Languages ─── */

export interface Language {
    code: string;
    name: string;
}

export const SUPPORTED_LANGUAGES: Language[] = [
    { code: "auto", name: "Auto Detect" },
    { code: "en", name: "English" },
    { code: "zh", name: "Chinese" },
    { code: "de", name: "German" },
    { code: "es", name: "Spanish" },
    { code: "ru", name: "Russian" },
    { code: "ko", name: "Korean" },
    { code: "fr", name: "French" },
    { code: "ja", name: "Japanese" },
    { code: "pt", name: "Portuguese" },
    { code: "tr", name: "Turkish" },
    { code: "pl", name: "Polish" },
    { code: "ca", name: "Catalan" },
    { code: "nl", name: "Dutch" },
    { code: "ar", name: "Arabic" },
    { code: "sv", name: "Swedish" },
    { code: "it", name: "Italian" },
    { code: "id", name: "Indonesian" },
    { code: "hi", name: "Hindi" },
    { code: "fi", name: "Finnish" },
    { code: "vi", name: "Vietnamese" },
    { code: "he", name: "Hebrew" },
    { code: "uk", name: "Ukrainian" },
    { code: "el", name: "Greek" },
    { code: "ms", name: "Malay" },
    { code: "cs", name: "Czech" },
    { code: "ro", name: "Romanian" },
    { code: "da", name: "Danish" },
    { code: "hu", name: "Hungarian" },
    { code: "ta", name: "Tamil" },
    { code: "no", name: "Norwegian" },
    { code: "th", name: "Thai" },
    { code: "ur", name: "Urdu" },
    { code: "hr", name: "Croatian" },
    { code: "bg", name: "Bulgarian" },
    { code: "lt", name: "Lithuanian" },
    { code: "la", name: "Latin" },
    { code: "mi", name: "Maori" },
    { code: "ml", name: "Malayalam" },
    { code: "cy", name: "Welsh" },
    { code: "sk", name: "Slovak" },
    { code: "te", name: "Telugu" },
    { code: "fa", name: "Persian" },
    { code: "lv", name: "Latvian" },
    { code: "bn", name: "Bengali" },
    { code: "sr", name: "Serbian" },
    { code: "az", name: "Azerbaijani" },
    { code: "sl", name: "Slovenian" },
    { code: "kn", name: "Kannada" },
    { code: "et", name: "Estonian" },
    { code: "mk", name: "Macedonian" },
    { code: "br", name: "Breton" },
    { code: "eu", name: "Basque" },
    { code: "is", name: "Icelandic" },
    { code: "hy", name: "Armenian" },
    { code: "ne", name: "Nepali" },
    { code: "mn", name: "Mongolian" },
    { code: "bs", name: "Bosnian" },
    { code: "kk", name: "Kazakh" },
    { code: "sq", name: "Albanian" },
    { code: "sw", name: "Swahili" },
    { code: "gl", name: "Galician" },
    { code: "mr", name: "Marathi" },
    { code: "pa", name: "Punjabi" },
    { code: "si", name: "Sinhala" },
    { code: "km", name: "Khmer" },
    { code: "sn", name: "Shona" },
    { code: "yo", name: "Yoruba" },
    { code: "so", name: "Somali" },
    { code: "af", name: "Afrikaans" },
    { code: "oc", name: "Occitan" },
    { code: "ka", name: "Georgian" },
    { code: "be", name: "Belarusian" },
    { code: "tg", name: "Tajik" },
    { code: "sd", name: "Sindhi" },
    { code: "gu", name: "Gujarati" },
    { code: "am", name: "Amharic" },
    { code: "yi", name: "Yiddish" },
    { code: "lo", name: "Lao" },
    { code: "uz", name: "Uzbek" },
    { code: "fo", name: "Faroese" },
    { code: "ht", name: "Haitian Creole" },
    { code: "ps", name: "Pashto" },
    { code: "tk", name: "Turkmen" },
    { code: "nn", name: "Nynorsk" },
    { code: "mt", name: "Maltese" },
    { code: "sa", name: "Sanskrit" },
    { code: "lb", name: "Luxembourgish" },
    { code: "my", name: "Myanmar" },
    { code: "bo", name: "Tibetan" },
    { code: "tl", name: "Tagalog" },
    { code: "mg", name: "Malagasy" },
    { code: "as", name: "Assamese" },
    { code: "tt", name: "Tatar" },
    { code: "haw", name: "Hawaiian" },
    { code: "ln", name: "Lingala" },
    { code: "ha", name: "Hausa" },
    { code: "ba", name: "Bashkir" },
    { code: "jw", name: "Javanese" },
    { code: "su", name: "Sundanese" },
];
