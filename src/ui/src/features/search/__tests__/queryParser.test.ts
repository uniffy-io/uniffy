import { describe, expect, it } from 'vitest';
import { SearchResultType } from '@uniffy/proto/search/v1/search_pb';
import {
    hasActiveFilters,
    parseSearchQuery,
    removeMyFilterFromQuery,
    removeTypeFilterFromQuery,
} from '@/features/search/utils/queryParser';

describe('parseSearchQuery', () => {
    it.each([
        ['note: --docker', [SearchResultType.NOTE], '--docker'],
        ['note:--docker', [SearchResultType.NOTE], '--docker'],
        ['note: docker compose', [SearchResultType.NOTE], 'docker compose'],
        ['notes: meeting', [SearchResultType.NOTE], 'meeting'],
        ['file: report.pdf', [SearchResultType.FILE], 'report.pdf'],
        ['folder: invoices', [SearchResultType.FOLDER], 'invoices'],
        ['agentfolder: research', [SearchResultType.AGENT_FOLDER], 'research'],
        ['agent-folders: research', [SearchResultType.AGENT_FOLDER], 'research'],
        ['message: deploy failed', [SearchResultType.CHAT_MESSAGE], 'deploy failed'],
        ['msg: deploy', [SearchResultType.CHAT_MESSAGE], 'deploy'],
        ['agent-chats: onboarding', [SearchResultType.AGENT_CHAT], 'onboarding'],
        ['agentchat: onboarding', [SearchResultType.AGENT_CHAT], 'onboarding'],
        ['task: fix login', [SearchResultType.TASK], 'fix login'],
        ['project: alpha', [SearchResultType.PROJECT], 'alpha'],
        ['note: !@#$%^&*()', [SearchResultType.NOTE], '!@#$%^&*()'],
        ['NOTE: Docker', [SearchResultType.NOTE], 'Docker'],
        ['note: file: shared plan', [SearchResultType.NOTE, SearchResultType.FILE], 'shared plan'],
    ])('type keyword keeps following text: %s', (query, types, text) => {
        const parsed = parseSearchQuery(query);
        expect(parsed.filters.types).toEqual(types);
        expect(parsed.text).toBe(text);
    });

    it('deduplicates repeated type keywords', () => {
        const parsed = parseSearchQuery('note: notes: docker');
        expect(parsed.filters.types).toEqual([SearchResultType.NOTE]);
        expect(parsed.text).toBe('docker');
    });

    it.each([
        ['my: drafts', 'drafts'],
        ['my:', ''],
    ])('my: is a bare prefix: %s', (query, text) => {
        const parsed = parseSearchQuery(query);
        expect(parsed.filters.myContentOnly).toBe(true);
        expect(parsed.text).toBe(text);
    });

    it('tag: consumes its value', () => {
        const parsed = parseSearchQuery('tag:work note: meeting');
        expect(parsed.filters.tags).toEqual(['work']);
        expect(parsed.filters.types).toEqual([SearchResultType.NOTE]);
        expect(parsed.text).toBe('meeting');
    });

    it('tag: consumes a quoted value', () => {
        const parsed = parseSearchQuery('tag:"project alpha" report');
        expect(parsed.filters.tags).toEqual(['project alpha']);
        expect(parsed.text).toBe('report');
        expect(parsed.filters.exactPhrases).toEqual([]);
    });

    it('dangling tag: is stripped without adding a filter', () => {
        const parsed = parseSearchQuery('docker tag:');
        expect(parsed.filters.tags).toEqual([]);
        expect(parsed.text).toBe('docker');
    });

    it('owner: consumes its value', () => {
        const parsed = parseSearchQuery('owner:jane report');
        expect(parsed.filters.owner).toBe('jane');
        expect(parsed.text).toBe('report');
    });

    it('type: maps its value through the keyword map', () => {
        const parsed = parseSearchQuery('type:note docker');
        expect(parsed.filters.types).toEqual([SearchResultType.NOTE]);
        expect(parsed.text).toBe('docker');
    });

    it('type: with an unknown value adds no filter', () => {
        const parsed = parseSearchQuery('type:bogus docker');
        expect(parsed.filters.types).toEqual([]);
        expect(parsed.text).toBe('docker');
    });

    it('keeps a quoted phrase after a type keyword', () => {
        const parsed = parseSearchQuery('note: "kubernetes deploy"');
        expect(parsed.filters.types).toEqual([SearchResultType.NOTE]);
        expect(parsed.text).toBe('"kubernetes deploy"');
        expect(parsed.filters.exactPhrases).toEqual(['kubernetes deploy']);
    });

    it('keywords inside a quoted phrase stay literal', () => {
        const parsed = parseSearchQuery('"note: literal my: text"');
        expect(parsed.filters.types).toEqual([]);
        expect(parsed.filters.myContentOnly).toBe(false);
        expect(parsed.text).toBe('"note: literal my: text"');
        expect(parsed.filters.exactPhrases).toEqual(['note: literal my: text']);
    });

    it('passes plain text through untouched', () => {
        const parsed = parseSearchQuery('docker compose setup');
        expect(parsed.text).toBe('docker compose setup');
        expect(parsed.filters.types).toEqual([]);
        expect(hasActiveFilters(parsed.filters)).toBe(false);
    });

    it('does not treat a word containing a keyword as a filter', () => {
        const parsed = parseSearchQuery('keynote: agenda');
        expect(parsed.filters.types).toEqual([]);
        expect(parsed.text).toBe('keynote: agenda');
    });

    it('combines filters, phrases, and free text', () => {
        const parsed = parseSearchQuery('note: tag:prod my: "exact term" docker');
        expect(parsed.filters.types).toEqual([SearchResultType.NOTE]);
        expect(parsed.filters.tags).toEqual(['prod']);
        expect(parsed.filters.myContentOnly).toBe(true);
        expect(parsed.text).toBe('"exact term" docker');
        expect(parsed.filters.exactPhrases).toEqual(['exact term']);
    });
});

describe('filter chip removal', () => {
    it('removes only the bare keyword token, keeping the search text', () => {
        expect(removeTypeFilterFromQuery('note: docker', SearchResultType.NOTE)).toBe('docker');
    });

    it('removes keyword aliases of the same type', () => {
        expect(
            removeTypeFilterFromQuery('msg: deploy', SearchResultType.CHAT_MESSAGE)
        ).toBe('deploy');
    });

    it('removes the type:value form', () => {
        expect(removeTypeFilterFromQuery('type:note docker', SearchResultType.NOTE)).toBe('docker');
    });

    it('removes my: while keeping the text', () => {
        expect(removeMyFilterFromQuery('my: drafts')).toBe('drafts');
    });
});
