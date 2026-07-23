/** localStorage map of last-read PDF pages, pruned to the newest entries. */

const STORAGE_KEY = 'uniffy.pdfReadingPositions';
const MAX_ENTRIES = 200;

interface StoredPosition {
    page: number;
    at: number;
}

type PositionMap = Record<string, StoredPosition>;

function readAll(): PositionMap {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) return {};
        return parsed as PositionMap;
    } catch {
        // Private-mode Safari throws on storage access; treat as empty.
        return {};
    }
}

function writeAll(positions: PositionMap): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
    } catch {
        // Quota or private-mode failure loses only the reading position.
    }
}

export function getReadingPosition(fileId: string): number | null {
    const entry = readAll()[fileId];
    if (!entry || typeof entry.page !== 'number' || entry.page < 2) return null;
    return entry.page;
}

export function setReadingPosition(fileId: string, page: number, now: number = Date.now()): void {
    const positions = readAll();

    if (page <= 1) {
        if (!(fileId in positions)) return;
        delete positions[fileId];
        writeAll(positions);
        return;
    }

    positions[fileId] = { page, at: now };

    const keys = Object.keys(positions);
    if (keys.length > MAX_ENTRIES) {
        keys.sort((a, b) => (positions[b]?.at ?? 0) - (positions[a]?.at ?? 0));
        for (const key of keys.slice(MAX_ENTRIES)) {
            delete positions[key];
        }
    }

    writeAll(positions);
}
