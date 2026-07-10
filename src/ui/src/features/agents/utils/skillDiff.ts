import { diffLines, diffWords, type Change } from 'diff';

export type DiffMode = 'line' | 'word';

export interface DiffStat {
    added: number;
    removed: number;
}

function countLines(value: string): number {
    if (!value) return 0;
    const normalized = value.endsWith('\n') ? value.slice(0, -1) : value;
    return normalized.split('\n').length;
}

export function diffLineParts(oldText: string, newText: string): Change[] {
    return diffLines(oldText ?? '', newText ?? '');
}

export function diffWordParts(oldText: string, newText: string): Change[] {
    return diffWords(oldText ?? '', newText ?? '');
}

// A trailing newline keeps the final line from merging with the preceding
// change, so the +N/-M counts reflect whole-line edits.
function withTrailingNewline(text: string): string {
    if (!text) return '';
    return text.endsWith('\n') ? text : `${text}\n`;
}

// Added/removed line counts for a compact "+N -M" summary in the timeline.
export function diffStat(oldText: string, newText: string): DiffStat {
    let added = 0;
    let removed = 0;
    const parts = diffLines(withTrailingNewline(oldText ?? ''), withTrailingNewline(newText ?? ''));
    for (const part of parts) {
        if (part.added) added += countLines(part.value);
        else if (part.removed) removed += countLines(part.value);
    }
    return { added, removed };
}
