import { describe, it, expect } from 'vitest';
import { buildRecordingFilename } from '../utils/buildRecordingFilename';

describe('buildRecordingFilename', () => {
    it('formats date and time padded to seconds', () => {
        const date = new Date('2026-05-09T13:42:05');
        expect(buildRecordingFilename('mp4', date)).toBe(
            'Screen Recording 2026-05-09 13.42.05.mp4',
        );
    });

    it('zero-pads single-digit components', () => {
        const date = new Date(2026, 0, 3, 4, 5, 6);
        expect(buildRecordingFilename('webm', date)).toBe(
            'Screen Recording 2026-01-03 04.05.06.webm',
        );
    });

    it('respects the supplied extension', () => {
        const date = new Date(2026, 0, 1, 0, 0, 0);
        expect(buildRecordingFilename('mp4', date)).toMatch(/\.mp4$/);
        expect(buildRecordingFilename('webm', date)).toMatch(/\.webm$/);
    });
});
