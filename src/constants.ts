export const MODEL_RELATIVE_SPEEDS: Record<string, number> = {
    "tiny.en": 35,
    "tiny": 35,
    "base.en": 24,
    "base": 24,
    "small.en": 16,
    "small": 16,
    "medium.en": 8,
    "medium": 8,
    "large-v1": 5,
    "large-v2": 4.5,
    "large-v3": 4.5,
    "large": 4.5,
};

// Base calculation reference: 35.1MB file took 196.6s at 16x speed
// 196.6 / 35.1 = 5.6 seconds per MB at 16x speed.
// Base rate (at 1x speed) = 5.6 * 16 = 89.6 seconds per MB.
const BASE_SECONDS_PER_MB = 89.6;

export function estimateTime(sizeMb: number, modelName: string | null): number {
    if (!sizeMb || !modelName) return 0;

    // Default to base speed if model not found
    const speed = MODEL_RELATIVE_SPEEDS[modelName] || 24;

    // Calculate estimated seconds
    return sizeMb * (BASE_SECONDS_PER_MB / speed);
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
