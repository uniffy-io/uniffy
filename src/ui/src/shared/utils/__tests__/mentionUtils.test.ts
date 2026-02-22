import { describe, it, expect } from 'vitest';
import { extractMentionsFromMarkdown, extractFallbackLabel } from '@/shared/utils/mentionUtils';

describe('extractMentionsFromMarkdown', () => {
    it('returns empty array for text without mentions', () => {
        expect(extractMentionsFromMarkdown('Hello world')).toEqual([]);
    });

    it('extracts a single mention', () => {
        const md = 'Check [[[My Note|urn:uniffy:content:NOTE:abc123]]] for details.';
        const result = extractMentionsFromMarkdown(md);
        expect(result).toEqual([
            { label: 'My Note', urn: 'urn:uniffy:content:NOTE:abc123' },
        ]);
    });

    it('extracts multiple mentions', () => {
        const md = '[[[Note A|urn:uniffy:content:NOTE:aaa]]] and [[[Note B|urn:uniffy:content:NOTE:bbb]]]';
        const result = extractMentionsFromMarkdown(md);
        expect(result).toHaveLength(2);
        expect(result[0].label).toBe('Note A');
        expect(result[1].label).toBe('Note B');
    });

    it('deduplicates by URN', () => {
        const md = '[[[A|urn:uniffy:content:NOTE:same]]] and [[[B|urn:uniffy:content:NOTE:same]]]';
        const result = extractMentionsFromMarkdown(md);
        expect(result).toHaveLength(1);
        expect(result[0].label).toBe('A');
    });

    it('handles empty string', () => {
        expect(extractMentionsFromMarkdown('')).toEqual([]);
    });

    it('handles mentions with special characters in label', () => {
        const md = '[[[John Doe (Admin)|urn:uniffy:content:USER:u1]]]';
        const result = extractMentionsFromMarkdown(md);
        expect(result[0].label).toBe('John Doe (Admin)');
    });
});

describe('extractFallbackLabel', () => {
    it('extracts type and truncated ID from URN', () => {
        expect(extractFallbackLabel('urn:uniffy:content:NOTE:abcdef12-3456-7890')).toBe('note:abcdef12');
    });

    it('handles short URN gracefully', () => {
        expect(extractFallbackLabel('urn:uniffy')).toBe('item:');
    });

    it('lowercases the type', () => {
        expect(extractFallbackLabel('urn:uniffy:content:CALENDAR_EVENT:abc')).toBe('calendar_event:abc');
    });
});
