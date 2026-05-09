import { describe, it, expect } from 'vitest';
import {
    TAG_PALETTE_SLUGS,
    getPaletteEntry,
    isTagPaletteSlug,
    tagColorClasses,
} from '@/features/tags/utils/colors';

describe('tagColorClasses', () => {
    it('returns the workspace accent when color is null', () => {
        const palette = tagColorClasses('whatever', null);
        expect(palette.bg).toContain('bg-primary');
        expect(palette.text).toContain('text-primary');
    });

    it('returns the workspace accent when color is empty', () => {
        const palette = tagColorClasses('any-slug', '');
        expect(palette.bg).toContain('bg-primary');
    });

    it('honours the explicit color override when present', () => {
        const explicit = tagColorClasses('whatever', 'blue');
        expect(explicit.bg).toContain('blue');
    });

    it('falls back to accent on an unknown color slug', () => {
        const palette = tagColorClasses('whatever', 'mauve');
        expect(palette.bg).toContain('bg-primary');
    });

    it('handles every palette slug', () => {
        for (const slug of TAG_PALETTE_SLUGS) {
            const entry = getPaletteEntry(slug);
            expect(entry.bg).toContain(slug);
            expect(entry.swatch).toContain(slug);
        }
    });

    it('isTagPaletteSlug recognises only known slugs', () => {
        expect(isTagPaletteSlug('blue')).toBe(true);
        expect(isTagPaletteSlug('mauve')).toBe(false);
    });
});
