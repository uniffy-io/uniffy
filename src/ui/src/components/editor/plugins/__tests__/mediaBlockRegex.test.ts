import { describe, it, expect } from 'vitest';

// Import the regexes directly -- they are the core logic under test.
// The remark/milkdown plugin wrappers are hard to unit-test in isolation,
// but the regex matching is what breaks with special filenames.
import { AUDIO_REGEX } from '../audio/index';
import { VIDEO_REGEX } from '../video/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchAudio(input: string) {
    const m = AUDIO_REGEX.exec(input);
    if (!m) return null;
    return { src: m[1], title: m[2] ?? '' };
}

function matchVideo(input: string) {
    const m = VIDEO_REGEX.exec(input);
    if (!m) return null;
    return { src: m[1], title: m[2] ?? '' };
}

const SAMPLE_URL = '/media-stream/019c55b1-5789-75a1-836c-2c7c48177b0b/019c55b5-0d69-7220-a489-ca74c6b29dcb';

// ---------------------------------------------------------------------------
// AUDIO_REGEX
// ---------------------------------------------------------------------------

describe('AUDIO_REGEX', () => {
    it('matches audio block without title', () => {
        const r = matchAudio(`[[[audio|${SAMPLE_URL}]]]`);
        expect(r).not.toBeNull();
        expect(r!.src).toBe(SAMPLE_URL);
        expect(r!.title).toBe('');
    });

    it('matches audio block with simple title', () => {
        const r = matchAudio(`[[[audio|${SAMPLE_URL}|song.mp3]]]`);
        expect(r).not.toBeNull();
        expect(r!.title).toBe('song.mp3');
    });

    it('matches audio block with spaces in title', () => {
        const r = matchAudio(`[[[audio|${SAMPLE_URL}|my great song.mp3]]]`);
        expect(r!.title).toBe('my great song.mp3');
    });

    it('matches audio block with Cyrillic title', () => {
        const r = matchAudio(`[[[audio|${SAMPLE_URL}|\u041F\u0435\u0441\u043D\u044F.mp3]]]`);
        expect(r).not.toBeNull();
        expect(r!.title).toBe('\u041F\u0435\u0441\u043D\u044F.mp3');
    });

    it('matches audio block with brackets in title (the bug)', () => {
        const title = '\u0412\u0435\u0440\u0441\u0438\u0438 \u0437\u0430 \u0443\u0431\u0438\u0439\u0441\u0442\u0432\u0430\u0442\u0430 \u0432 \u0441\u043B\u0443\u0447\u0430\u044F \uFF02\u041F\u0435\u0442\u0440\u043E\u0445\u0430\u043D\uFF02 [wwQDYSVAwXs].mp3';
        const r = matchAudio(`[[[audio|${SAMPLE_URL}|${title}]]]`);
        expect(r).not.toBeNull();
        expect(r!.src).toBe(SAMPLE_URL);
        expect(r!.title).toBe(title);
    });

    it('matches title with single ] character', () => {
        const r = matchAudio(`[[[audio|${SAMPLE_URL}|track [remix].mp3]]]`);
        expect(r).not.toBeNull();
        expect(r!.title).toBe('track [remix].mp3');
    });

    it('matches title with multiple bracket pairs', () => {
        const r = matchAudio(`[[[audio|${SAMPLE_URL}|[a] and [b].mp3]]]`);
        expect(r).not.toBeNull();
        expect(r!.title).toBe('[a] and [b].mp3');
    });

    it('matches title with fullwidth brackets (sanitized output)', () => {
        const r = matchAudio(`[[[audio|${SAMPLE_URL}|track \uFF3Bremix\uFF3D.mp3]]]`);
        expect(r).not.toBeNull();
        expect(r!.title).toBe('track \uFF3Bremix\uFF3D.mp3');
    });

    it('does not match non-audio blocks', () => {
        expect(matchAudio(`[[[video|${SAMPLE_URL}]]]`)).toBeNull();
        expect(matchAudio(`[[[mention|${SAMPLE_URL}]]]`)).toBeNull();
    });

    it('does not match partial patterns', () => {
        expect(matchAudio(`[[[audio|${SAMPLE_URL}`)).toBeNull();
        expect(matchAudio(`audio|${SAMPLE_URL}]]]`)).toBeNull();
    });

    it('does not match with extra text before', () => {
        expect(matchAudio(`text [[[audio|${SAMPLE_URL}]]]`)).toBeNull();
    });

    it('does not match with extra text after', () => {
        expect(matchAudio(`[[[audio|${SAMPLE_URL}]]] text`)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// VIDEO_REGEX
// ---------------------------------------------------------------------------

describe('VIDEO_REGEX', () => {
    it('matches video block without title', () => {
        const r = matchVideo(`[[[video|${SAMPLE_URL}]]]`);
        expect(r).not.toBeNull();
        expect(r!.src).toBe(SAMPLE_URL);
        expect(r!.title).toBe('');
    });

    it('matches video block with simple title', () => {
        const r = matchVideo(`[[[video|${SAMPLE_URL}|clip.mp4]]]`);
        expect(r!.title).toBe('clip.mp4');
    });

    it('matches video block with brackets in title', () => {
        const r = matchVideo(`[[[video|${SAMPLE_URL}|lecture [part 1].mp4]]]`);
        expect(r).not.toBeNull();
        expect(r!.title).toBe('lecture [part 1].mp4');
    });

    it('matches video block with Cyrillic and brackets', () => {
        const title = '\u0412\u0438\u0434\u0435\u043E [HD].mp4';
        const r = matchVideo(`[[[video|${SAMPLE_URL}|${title}]]]`);
        expect(r).not.toBeNull();
        expect(r!.title).toBe(title);
    });

    it('does not match audio blocks', () => {
        expect(matchVideo(`[[[audio|${SAMPLE_URL}]]]`)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Stringify sanitization (bracket replacement)
// ---------------------------------------------------------------------------

describe('title bracket sanitization', () => {
    // Mirrors the logic in the stringify handlers of audio/video plugins
    function sanitizeTitle(title: string): string {
        return title.replace(/\[/g, '\uFF3B').replace(/\]/g, '\uFF3D');
    }

    it('replaces ASCII brackets with fullwidth equivalents', () => {
        const result = sanitizeTitle('[remix]');
        expect(result).toBe('\uFF3Bremix\uFF3D');
    });

    it('leaves titles without brackets unchanged', () => {
        expect(sanitizeTitle('song.mp3')).toBe('song.mp3');
    });

    it('handles multiple bracket pairs', () => {
        const result = sanitizeTitle('[a] and [b]');
        expect(result).toBe('\uFF3Ba\uFF3D and \uFF3Bb\uFF3D');
    });

    it('sanitized output is parseable by AUDIO_REGEX', () => {
        const original = 'track [remix].mp3';
        const sanitized = sanitizeTitle(original);
        const markdown = `[[[audio|${SAMPLE_URL}|${sanitized}]]]`;
        const r = matchAudio(markdown);
        expect(r).not.toBeNull();
        expect(r!.title).toBe(sanitized);
    });

    it('original brackets are also parseable by AUDIO_REGEX (backwards compat)', () => {
        const title = 'track [remix].mp3';
        const markdown = `[[[audio|${SAMPLE_URL}|${title}]]]`;
        const r = matchAudio(markdown);
        expect(r).not.toBeNull();
        expect(r!.title).toBe(title);
    });
});
