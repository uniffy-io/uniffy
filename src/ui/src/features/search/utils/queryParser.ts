/** Parses `keyword:value` filters into structured search filters. */

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
    'prompt': SearchResultType.PROMPT,
    'prompts': SearchResultType.PROMPT,
    'room': SearchResultType.ROOM,
    'rooms': SearchResultType.ROOM,
    // tag entity itself, not "content tagged with X" - use tag: for the latter
    'tagentity': SearchResultType.TAG,
    'tagentities': SearchResultType.TAG,
};

/** `type:tag` meta-prefix (filters results to a specific entity type). */
const TYPE_META_MAP: Record<string, SearchResultType> = {
    'tag': SearchResultType.TAG,
    'note': SearchResultType.NOTE,
    'file': SearchResultType.FILE,
    'user': SearchResultType.USER,
    'event': SearchResultType.CALENDAR_EVENT,
    'calendar': SearchResultType.CALENDAR_EVENT,
    'project': SearchResultType.PROJECT,
    'task': SearchResultType.TASK,
    'agent': SearchResultType.AGENT,
    'chat': SearchResultType.CHAT,
    'message': SearchResultType.CHAT_MESSAGE,
    'prompt': SearchResultType.PROMPT,
    'room': SearchResultType.ROOM,
};

/** Recognized filter prefixes - shorthands (`notes`, `tagentities`, `msg`) feed into TYPE_KEYWORD_MAP. */
const FILTER_PREFIXES = [
    'note', 'notes', 'file', 'files', 'user', 'users',
    'calendar', 'event', 'events', 'chat', 'chats',
    'agentchat', 'agentchats', 'agent-chat', 'agent-chats',
    'chatmessage', 'message', 'msg',
    'project', 'projects', 'task', 'tasks',
    'agent', 'agents',
    'prompt', 'prompts',
    'room', 'rooms',
    'tagentity', 'tagentities',
    'type',
    'tag',
    'my', 'owner',
];

const FILTER_PATTERN = new RegExp(
    `\\b(${FILTER_PREFIXES.join('|')}):\\s*(?:"([^"]+)"|([^\\s"]+))`,
    'gi'
);

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

    let remainingText = query;
    const extractedFilters: Array<{ match: string; keyword: string; value: string }> = [];

    let match: RegExpExecArray | null;
    FILTER_PATTERN.lastIndex = 0;

    while ((match = FILTER_PATTERN.exec(query)) !== null) {
        const [fullMatch, keyword, quotedValue, unquotedValue] = match;
        const value = (quotedValue || unquotedValue || '').trim();

        if (value) {
            extractedFilters.push({
                match: fullMatch,
                keyword: keyword.toLowerCase(),
                value,
            });
        }
    }

    for (const { match, keyword, value } of extractedFilters) {
        remainingText = remainingText.replace(match, ' ');

        if (keyword in TYPE_KEYWORD_MAP) {
            const resultType = TYPE_KEYWORD_MAP[keyword];
            if (!filters.types.includes(resultType)) {
                filters.types.push(resultType);
            }
            continue;
        }

        if (keyword === 'type') {
            const meta = TYPE_META_MAP[value.toLowerCase()];
            if (meta !== undefined && !filters.types.includes(meta)) {
                filters.types.push(meta);
            }
            continue;
        }

        if (keyword === 'tag') {
            if (!filters.tags.includes(value)) {
                filters.tags.push(value);
            }
            continue;
        }

        if (keyword === 'project') {
            if (!filters.projects.includes(value)) {
                filters.projects.push(value);
            }
            continue;
        }

        if (keyword === 'my') {
            filters.myContentOnly = true;
            continue;
        }

        if (keyword === 'owner') {
            filters.owner = value;
            continue;
        }
    }

    remainingText = remainingText
        .replace(/\s+/g, ' ')
        .trim();

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
        case SearchResultType.USER:
            return 'Users';
        case SearchResultType.CALENDAR_EVENT:
            return 'Events';
        case SearchResultType.CHAT:
            return 'Chats';
        case SearchResultType.PROJECT:
            return 'Projects';
        case SearchResultType.TASK:
            return 'Tasks';
        case SearchResultType.AGENT:
            return 'Agents';
        case SearchResultType.PROMPT:
            return 'Prompts';
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
        case SearchResultType.USER:
            return 'user';
        case SearchResultType.CALENDAR_EVENT:
            return 'calendar';
        case SearchResultType.CHAT:
            return 'chat';
        case SearchResultType.AGENT_CHAT:
            return 'agentchat';
        case SearchResultType.PROJECT:
            return 'project';
        case SearchResultType.TASK:
            return 'task';
        case SearchResultType.AGENT:
            return 'agent';
        case SearchResultType.PROMPT:
            return 'prompt';
        case SearchResultType.TAG:
            return 'tagentity';
        default:
            return '';
    }
}

export function removeTypeFilterFromQuery(query: string, type: SearchResultType): string {
    const keyword = getTypeFilterKeyword(type);
    if (!keyword) return query;

    const pattern = new RegExp(`\\b${keyword}s?:\\s*(?:"[^"]*"|[^\\s]*)\\s*`, 'gi');
    return query.replace(pattern, '').replace(/\s+/g, ' ').trim();
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
    const pattern = /\bmy:\s*(?:"[^"]*"|[^\s]*)\s*/gi;
    return query.replace(pattern, '').replace(/\s+/g, ' ').trim();
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
    { prefix: 'user:', description: 'Search users', example: 'user: john' },
    { prefix: 'calendar:', description: 'Search events', example: 'calendar: standup' },
    { prefix: 'tag:', description: 'Filter by tag', example: 'tag:work' },
    { prefix: 'my:', description: 'My content only', example: 'my: drafts' },
] as const;
