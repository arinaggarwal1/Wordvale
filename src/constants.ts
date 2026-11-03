// Existing file-size heuristic, retained as a rough estimate when no device-specific benchmark is available.
export const MODEL_RELATIVE_SPEEDS: Record<string, number> = {
    "tiny.en": 35, tiny: 35, "base.en": 24, base: 24, "small.en": 16, small: 16,
    "medium.en": 8, medium: 8, "large-v1": 5, "large-v2": 4.5, "large-v3": 4.5, large: 4.5,
};
export function estimateTime(sizeMb: number, modelName: string | null): number {
    if (!sizeMb || !modelName) return 0;
    return sizeMb * (89.6 / (MODEL_RELATIVE_SPEEDS[modelName] || 24));
}

export function formatDuration(seconds: number): string {
    if (!seconds) return "--";

    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);

    if (minutes > 60) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `~${hours}h ${mins}m`;
    }

    if (minutes > 0) {
        return `~${minutes}m ${secs}s`;
    }

    return `~${secs}s`;
}
