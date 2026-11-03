import type { TranscriptionSegment } from "../types/models";

export function hasUsableSegmentTiming(segment: TranscriptionSegment): boolean {
    return Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.start >= 0 && segment.end > segment.start;
}

export function currentSegmentIndex(segments: TranscriptionSegment[], position: number): number {
    if (!Number.isFinite(position) || position < 0) return -1;
    return segments.findIndex((segment) => hasUsableSegmentTiming(segment) && position >= segment.start && position < segment.end);
}
