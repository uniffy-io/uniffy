import { describe, it, expect } from 'vitest';
import { buildContentDisposition, parseRangeRequest, MAX_INITIAL_CHUNK_SIZE } from '../mediaStreamUtils';

// buildContentDisposition

describe('buildContentDisposition', () => {
    it('returns simple header for ASCII-only filename', () => {
        expect(buildContentDisposition('song.mp3'))
            .toBe('inline; filename="song.mp3"');
    });

    it('returns simple header for filename with spaces', () => {
        expect(buildContentDisposition('my great song.mp3'))
            .toBe('inline; filename="my great song.mp3"');
    });

    it('replaces quotes and backslashes in ASCII fallback', () => {
        const result = buildContentDisposition('file"name\\.mp3');
        expect(result).toContain('filename="file_name_.mp3"');
    });

    it('adds RFC 5987 filename* for Cyrillic names', () => {
        const result = buildContentDisposition('\u041F\u0435\u0441\u043D\u044F.mp3');
        expect(result).toContain('filename="_____.mp3"');
        expect(result).toContain("filename*=UTF-8''");
        expect(result).toContain('%D0%9F%D0%B5%D1%81%D0%BD%D1%8F');
    });

    it('adds RFC 5987 filename* for CJK names', () => {
        const result = buildContentDisposition('\u97F3\u697D.mp3');
        expect(result).toContain('filename="__.mp3"');
        expect(result).toContain("filename*=UTF-8''");
    });

    it('handles mixed ASCII and non-ASCII', () => {
        const result = buildContentDisposition('podcast - \u041F\u0435\u0442\u0440\u043E\u0445\u0430\u043D.mp3');
        expect(result).toContain('filename="podcast - ________.mp3"');
        expect(result).toContain("filename*=UTF-8''");
    });

    it('percent-encodes single quotes in RFC 5987 value', () => {
        const result = buildContentDisposition("it\u2019s \u043C\u0443\u0437\u044B\u043A\u0430.mp3");
        expect(result).toContain("filename*=UTF-8''");
        // The curly apostrophe is non-ASCII so it gets encoded
        expect(result).not.toContain("'s");
    });

    it('handles empty filename', () => {
        const result = buildContentDisposition('');
        expect(result).toBe('inline; filename=""');
    });

    it('handles the actual failing filename from the bug report', () => {
        const filename = '\u0412\u0435\u0440\u0441\u0438\u0438 \u0437\u0430 \u0443\u0431\u0438\u0439\u0441\u0442\u0432\u0430\u0442\u0430 \u0432 \u0441\u043B\u0443\u0447\u0430\u044F \uFF02\u041F\u0435\u0442\u0440\u043E\u0445\u0430\u043D\uFF02 [wwQDYSVAwXs].mp3';
        const result = buildContentDisposition(filename);
        // Must not throw (the original bug)
        expect(result).toContain('filename=');
        expect(result).toContain("filename*=UTF-8''");
        // ASCII fallback must not contain non-ASCII
        const asciiMatch = result.match(/filename="([^"]+)"/);
        expect(asciiMatch).not.toBeNull();
        expect(/^[\x20-\x7E]*$/.test(asciiMatch![1])).toBe(true);
    });
});

// parseRangeRequest

describe('parseRangeRequest', () => {
    describe('without Range header', () => {
        it('returns full range when no Range header and not full-file', () => {
            const result = parseRangeRequest(null, false);
            expect(result.startByte).toBe(0);
            expect(result.endByte).toBeUndefined();
            expect(result.hasRangeHeader).toBe(false);
        });

        it('returns full range when no Range header and full-file', () => {
            const result = parseRangeRequest(null, true);
            expect(result.startByte).toBe(0);
            expect(result.endByte).toBeUndefined();
            expect(result.hasRangeHeader).toBe(false);
        });

        it('does NOT cap to 2MB when no Range header (audio initial load)', () => {
            const result = parseRangeRequest(null, false);
            // endByte must be undefined (no cap) - not MAX_INITIAL_CHUNK_SIZE - 1
            expect(result.endByte).toBeUndefined();
        });
    });

    describe('with Range header', () => {
        it('parses bytes=0- range', () => {
            const result = parseRangeRequest('bytes=0-', false);
            expect(result.startByte).toBe(0);
            expect(result.hasRangeHeader).toBe(true);
        });

        it('parses bytes=100-200 range', () => {
            const result = parseRangeRequest('bytes=100-200', false);
            expect(result.startByte).toBe(100);
            expect(result.endByte).toBe(200);
            expect(result.hasRangeHeader).toBe(true);
        });

        it('caps open-ended range to 2MB for non-full-file requests', () => {
            const result = parseRangeRequest('bytes=0-', false);
            expect(result.endByte).toBe(MAX_INITIAL_CHUNK_SIZE - 1);
        });

        it('caps large range to 2MB for non-full-file requests', () => {
            const result = parseRangeRequest('bytes=0-99999999', false);
            expect(result.endByte).toBe(MAX_INITIAL_CHUNK_SIZE - 1);
        });

        it('does not cap small explicit range', () => {
            const result = parseRangeRequest('bytes=0-1000', false);
            expect(result.endByte).toBe(1000);
        });

        it('does not cap when requestFullFile is true', () => {
            const result = parseRangeRequest('bytes=0-', true);
            expect(result.endByte).toBeUndefined();
        });

        it('handles mid-file range with cap', () => {
            const result = parseRangeRequest('bytes=5000000-', false);
            expect(result.startByte).toBe(5000000);
            expect(result.endByte).toBe(5000000 + MAX_INITIAL_CHUNK_SIZE - 1);
        });
    });
});
