export interface ThinkingBlockView {
    blockId: string;
    content: string;
    elapsedMs: number;
    done: boolean;
}

export function formatThinkingDuration(elapsedMs: number): string {
    const totalSeconds = Math.max(1, Math.round(elapsedMs / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function persistedThinkingBlocks(raw: unknown): ThinkingBlockView[] {
    // Chat metadata crosses the wire as a string-valued map, so the
    // persisted blocks arrive JSON-encoded there.
    if (typeof raw === 'string') {
        try {
            raw = JSON.parse(raw);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((b) => typeof b?.content === 'string' && b.content)
        .map((b, idx) => ({
            blockId: typeof b.block_id === 'string' ? b.block_id : `persisted-${idx}`,
            content: b.content as string,
            elapsedMs: typeof b.elapsed_ms === 'number' ? b.elapsed_ms : 0,
            done: true,
        }));
}
