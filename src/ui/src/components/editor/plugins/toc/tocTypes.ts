export type TocBullets = 'none' | 'disc' | 'dash' | 'number';

export interface TocAttrs {
    /** Lowest heading level included (1-6, inclusive) */
    min: number;
    /** Highest heading level included (1-6, inclusive) */
    max: number;
    /** Flat = single indented list; nested = collapsible tree */
    style: 'flat' | 'nested';
    /** Marker rendered next to each entry */
    bullets: TocBullets;
}

export const TOC_DEFAULTS: TocAttrs = {
    min: 1,
    max: 4,
    style: 'flat',
    bullets: 'none',
};

export function parseBullets(value: string, fallback: TocBullets): TocBullets {
    return value === 'none' || value === 'disc' || value === 'dash' || value === 'number'
        ? value
        : fallback;
}

export function clampLevel(value: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    const n = Math.round(value);
    if (n < 1) return 1;
    if (n > 6) return 6;
    return n;
}
