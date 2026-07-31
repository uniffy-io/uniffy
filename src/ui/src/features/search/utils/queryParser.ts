/**
 * Parses keyword filters out of a search query.
 *
 * Type keywords (`note:`, `file:`, `message:`, ...) and `my:` are bare
 * prefixes: they only toggle a filter and the text after them stays in the
 * free-text query. Only `tag:` / `owner:` / `type:` consume a value
 * (`tag:work`, `tag:"project alpha"`). Standalone quoted phrases are left
 * in the residual text so Meilisearch enforces the exact match.
 * Mirrors the backend parser in domains/search/parser.py - keep in sync.
 */

import { SearchResultType } from '@uniffy/proto/search/v1/search_pb';

export interface ParsedQuery {
    text: string;
    filters: SearchFilters;
    rawQuery: string;
}

export interface SearchFilters {
    types: SearchResultType[];
    tags: string[];
    projects: string[];
    myContentOnly: boolean;
    owner: string | null;
    exactPhrases: string[];
}

/** Filter keyword to SearchResultType. Update when adding a new content type. */
const TYPE_KEYWORD_MAP: Record<string, SearchResultType> = {
    'note': SearchResultType.NOTE,
    'notes': SearchResultType.NOTE,
    'file': SearchResultType.FILE,
    'files': SearchResultType.FILE,
    'folder': SearchResultType.FOLDER,
    'folders': SearchResultType.FOLDER,
    'agentfolder': SearchResultType.AGENT_FOLDER,
    'agentfolders': SearchResultType.AGENT_FOLDER,
    'agent-folder': SearchResultType.AGENT_FOLDER,
    'agent-folders': SearchResultType.AGENT_FOLDER,
    'user': SearchResultType.USER,
    'users': SearchResultType.USER,
    'calendar': SearchResultType.CALENDAR_EVENT,
    'event': SearchResultType.CALENDAR_EVENT,
    'events': SearchResultType.CALENDAR_EVENT,
    'chat': SearchResultType.CHAT,
    'chats': SearchResultType.CHAT,
    'agentchat': SearchResultType.AGENT_CHAT,
    'agentchats': SearchResultType.AGENT_CHAT,
    'agent-chat': SearchResultType.AGENT_CHAT,
    'agent-chats': SearchResultType.AGENT_CHAT,
    'chatmessage': SearchResultType.CHAT_MESSAGE,
    'message': SearchResultType.CHAT_MESSAGE,
    'msg': SearchResultType.CHAT_MESSAGE,
    'project': SearchResultType.PROJECT,
    'projects': SearchResultType.PROJECT,
    'task': SearchResultType.TASK,
    'tasks': SearchResultType.TASK,
    'agent': SearchResultType.AGENT,
    'agents': SearchResultType.AGENT,
    'room': SearchResultType.ROOM,
    'rooms': SearchResultType.ROOM,
    // tag entity itself, not "content tagged with X" - use tag: for the latter
    'tagentity': SearchResultType.TAG,
    'tagentities': SearchResultType.TAG,
};

/** Longest-first so `agent-chats:` wins over `agent:`. */
const BARE_PREFIXES = [...Object.keys(TYPE_KEYWORD_MAP), 'my']
    .sort((a, b) => b.length - a.length);

/** Bare prefixes consume only the `keyword:` token itself. */
const BARE_FILTER_PATTERN = new RegExp(`\\b(${BARE_PREFIXES.join('|')}):`, 'gi');

/**
 * Value keywords consume `keyword:value` or `keyword:"quoted value"`; a
 * dangling `keyword:` with no value is stripped without adding a filter.
 */
const VALUE_FILTER_PATTERN = /\b(tag|owner|type):\s*(?:"([^"]+)"|([^\s"]+))?/gi;

/**
 * Standalone quoted phrases (quote not glued to a `keyword:`); protected
 * from filter extraction so `"note: literal"` stays literal search text.
 */
const QUOTED_SEGMENT_SPLIT = /((?<!:)"[^"]*")/;

/** Standalone quoted phrases; negative lookbehind skips filter values like `tag:"value"`. */
const PHRASE_PATTERN = /(?<![a-z]:)"([^"]+)"/gi;

export function parseSearchQuery(query: string): ParsedQuery {
    const filters: SearchFilters = {
        types: [],
        tags: [],
        projects: [],
        myContentOnly: false,
        owner: null,
        exactPhrases: [],
    };

    if (!query || !query.trim()) {
        return { text: '', filters, rawQuery: query };
    }

    const addTypeFilter = (keyword: string) => {
        const resultType = TYPE_KEYWORD_MAP[keyword];
        if (resultType !== undefined && !filters.types.includes(resultType)) {
            filters.types.push(resultType);
        }
    };

    const pieces = query.split(QUOTED_SEGMENT_SPLIT);
    for (let i = 0; i < pieces.length; i++) {
        if (i % 2 === 1) continue;

        let piece = pieces[i].replace(
            VALUE_FILTER_PATTERN,
            (_match, keyword: string, quotedValue?: string, unquotedValue?: string) => {
                const value = (quotedValue || unquotedValue || '').trim();
                if (!value) return ' ';
                const kw = keyword.toLowerCase();
                if (kw === 'tag') {
                    if (!filters.tags.includes(value)) filters.tags.push(value);
                } else if (kw === 'owner') {
                    filters.owner = value;
                } else if (kw === 'type') {
                    addTypeFilter(value.toLowerCase());
                }
                return ' ';
            },
        );

        piece = piece.replace(BARE_FILTER_PATTERN, (_match, keyword: string) => {
            const kw = keyword.toLowerCase();
            if (kw === 'my') {
                filters.myContentOnly = true;
            } else {
                addTypeFilter(kw);
            }
            return ' ';
        });

        pieces[i] = piece;
    }

    const remainingText = pieces.join('').replace(/\s+/g, ' ').trim();

    // Quotes stay in remainingText so Meilisearch enforces the phrase match.
    PHRASE_PATTERN.lastIndex = 0;
    let phraseMatch: RegExpExecArray | null;
    while ((phraseMatch = PHRASE_PATTERN.exec(remainingText)) !== null) {
        const phrase = phraseMatch[1].trim();
        if (phrase && !filters.exactPhrases.includes(phrase)) {
            filters.exactPhrases.push(phrase);
        }
    }

    return {
        text: remainingText,
        filters,
        rawQuery: query,
    };
}

export function hasActiveFilters(filters: SearchFilters): boolean {
    return (
        filters.types.length > 0 ||
        filters.tags.length > 0 ||
        filters.projects.length > 0 ||
        filters.myContentOnly ||
        filters.owner !== null ||
        filters.exactPhrases.length > 0
    );
}

export function getTypeFilterLabel(type: SearchResultType): string {
    switch (type) {
        case SearchResultType.NOTE:
            return 'Notes';
        case SearchResultType.FILE:
            return 'Files';
        case SearchResultType.FOLDER:
            return 'Folders';
        case SearchResultType.AGENT_FOLDER:
            return 'Agent Chat Folders';
        case SearchResultType.USER:
            return 'Users';
        case SearchResultType.CALENDAR_EVENT:
            return 'Events';
        case SearchResultType.CHAT:
            return 'Chats';
        case SearchResultType.AGENT_CHAT:
            return 'Agent Chats';
        case SearchResultType.CHAT_MESSAGE:
            return 'Messages';
        case SearchResultType.PROJECT:
            return 'Projects';
        case SearchResultType.TASK:
            return 'Tasks';
        case SearchResultType.AGENT:
            return 'Agents';
        case SearchResultType.ROOM:
            return 'Rooms';
        case SearchResultType.TAG:
            return 'Tags';
        default:
            return 'Unknown';
    }
}

export function getTypeFilterKeyword(type: SearchResultType): string {
    switch (type) {
        case SearchResultType.NOTE:
            return 'note';
        case SearchResultType.FILE:
            return 'file';
        case SearchResultType.FOLDER:
            return 'folder';
        case SearchResultType.AGENT_FOLDER:
            return 'agentfolder';
        case SearchResultType.USER:
            return 'user';
        case SearchResultType.CALENDAR_EVENT:
            return 'calendar';
        case SearchResultType.CHAT:
            return 'chat';
        case SearchResultType.AGENT_CHAT:
            return 'agentchat';
        case SearchResultType.CHAT_MESSAGE:
            return 'message';
        case SearchResultType.PROJECT:
            return 'project';
        case SearchResultType.TASK:
            return 'task';
        case SearchResultType.AGENT:
            return 'agent';
        case SearchResultType.ROOM:
            return 'room';
        case SearchResultType.TAG:
            return 'tagentity';
        default:
            return '';
    }
}

export function removeTypeFilterFromQuery(query: string, type: SearchResultType): string {
    const aliases = Object.keys(TYPE_KEYWORD_MAP)
        .filter((k) => TYPE_KEYWORD_MAP[k] === type)
        .sort((a, b) => b.length - a.length);
    if (aliases.length === 0) return query;

    // Both the bare `note:` form and the `type:note` form.
    const alternation = aliases.join('|');
    const pattern = new RegExp(
        `\\b(?:type:\\s*(?:${alternation})\\b|(?:${alternation}):)\\s*`,
        'gi'
    );
    return query.replace(pattern, ' ').replace(/\s+/g, ' ').trim();
}

export function removeTagFilterFromQuery(query: string, tag: string): string {
    const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\btag:\\s*(?:"${escapedTag}"|${escapedTag})\\s*`, 'gi');
    return query.replace(pattern, '').replace(/\s+/g, ' ').trim();
}

export function removeProjectFilterFromQuery(query: string, project: string): string {
    const escapedProject = project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\bproject:\\s*(?:"${escapedProject}"|${escapedProject})\\s*`, 'gi');
    return query.replace(pattern, '').replace(/\s+/g, ' ').trim();
}

export function removeMyFilterFromQuery(query: string): string {
    return query.replace(/\bmy:\s*/gi, ' ').replace(/\s+/g, ' ').trim();
}

export function removePhraseFromQuery(query: string, phrase: string): string {
    const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`"${escapedPhrase}"\\s*`, 'gi');
    return query.replace(pattern, '').replace(/\s+/g, ' ').trim();
}

export const FILTER_HINTS = [
    { prefix: '"..."', description: 'Exact phrase match', example: '"docker --platform"' },
    { prefix: 'note:', description: 'Search notes', example: 'note: meeting' },
    { prefix: 'file:', description: 'Search files', example: 'file: report' },
    { prefix: 'folder:', description: 'Search folders', example: 'folder: invoices' },
    { prefix: 'user:', description: 'Search users', example: 'user: john' },
    { prefix: 'calendar:', description: 'Search events', example: 'calendar: standup' },
    { prefix: 'message:', description: 'Search chat messages', example: 'message: deploy' },
    { prefix: 'tag:', description: 'Filter by tag', example: 'tag:work' },
    { prefix: 'my:', description: 'My content only', example: 'my: drafts' },
] as const;
