/**
 * Search Query Parser
 *
 * Parses Google-style keyword search queries into structured filters.
 *
 * Supported syntax:
 * - Type filters: note:, file:, user:, calendar:, chat:
 * - Metadata filters: tag:, project:
 * - Ownership: my: (shorthand for current user's content)
 * - Quoted phrases: "exact phrase" preserved in text
 *
 * Examples:
 * - `note: "how to" tag:work` -> { text: "how to", filters: { types: [NOTE], tags: ["work"] } }
 * - `user: john` -> { text: "john", filters: { types: [USER] } }
 * - `my: drafts` -> { text: "drafts", filters: { myContentOnly: true } }
 */

import { SearchResultType } from '@uniffy/proto/search/v1/search_pb';

/**
 * Parsed search query with extracted filters.
 */
export interface ParsedQuery {
    /** Remaining free text after extracting filters (for fuzzy search) */
    text: string;
    /** Extracted filter values */
    filters: SearchFilters;
    /** Original raw query */
    rawQuery: string;
}

/**
 * Filter values extracted from the query.
 */
export interface SearchFilters {
    /** Content type filters (note, file, user, etc.) */
    types: SearchResultType[];
    /** Tag filters */
    tags: string[];
    /** Project filters */
    projects: string[];
    /** Only show current user's content */
    myContentOnly: boolean;
    /** Filter by owner username */
    owner: string | null;
    /** Exact match phrases detected in query (for UI display) */
    exactPhrases: string[];
}

/**
 * Mapping of type filter keywords to SearchResultType enum values.
 */
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
};

/**
 * All recognized filter prefixes.
 */
const FILTER_PREFIXES = [
    // Type filters
    'note', 'notes', 'file', 'files', 'user', 'users',
    'calendar', 'event', 'events', 'chat', 'chats',
    'chatmessage', 'message', 'msg',
    'project', 'projects', 'task', 'tasks',
    'agent', 'agents',
    'prompt', 'prompts',
    'room', 'rooms',
    // Metadata filters
    'tag',
    // Ownership filters
    'my', 'owner',
];

/**
 * Regex pattern to match filter syntax: `keyword:value` or `keyword:"quoted value"`
 * Captures: [full match, keyword, quoted value or null, unquoted value or null]
 */
const FILTER_PATTERN = new RegExp(
    `\\b(${FILTER_PREFIXES.join('|')}):\\s*(?:"([^"]+)"|([^\\s"]+))`,
    'gi'
);

/**
 * Pattern to match standalone quoted phrases (not preceded by filter keywords).
 * Uses negative lookbehind to avoid matching filter values like tag:"value".
 */
const PHRASE_PATTERN = /(?<![a-z]:)"([^"]+)"/gi;

/**
 * Parse a search query string into structured filters.
 *
 * @param query - Raw search query string
 * @returns Parsed query with text and filters
 */
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

    // Extract all filter matches
    let match: RegExpExecArray | null;
    FILTER_PATTERN.lastIndex = 0; // Reset regex state

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

    // Process extracted filters
    for (const { match, keyword, value } of extractedFilters) {
        // Remove the filter from remaining text
        remainingText = remainingText.replace(match, ' ');

        // Type filters
        if (keyword in TYPE_KEYWORD_MAP) {
            const resultType = TYPE_KEYWORD_MAP[keyword];
            if (!filters.types.includes(resultType)) {
                filters.types.push(resultType);
            }
            // If there's a value after the type filter, it becomes search text
            // The value is already part of remainingText if not consumed
            continue;
        }

        // Tag filter
        if (keyword === 'tag') {
            if (!filters.tags.includes(value)) {
                filters.tags.push(value);
            }
            continue;
        }

        // Project filter
        if (keyword === 'project') {
            if (!filters.projects.includes(value)) {
                filters.projects.push(value);
            }
            continue;
        }

        // My content filter
        if (keyword === 'my') {
            filters.myContentOnly = true;
            // Value after my: becomes search text, already in remainingText
            continue;
        }

        // Owner filter
        if (keyword === 'owner') {
            filters.owner = value;
            continue;
        }
    }

    // Clean up remaining text
    remainingText = remainingText
        .replace(/\s+/g, ' ')  // Collapse multiple spaces
        .trim();

    // Extract exact-match phrases for UI display (quotes stay in text for Meilisearch)
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

/**
 * Check if a query contains any active filters.
 */
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

/**
 * Get a human-readable label for a SearchResultType.
 */
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
        default:
            return 'Unknown';
    }
}

/**
 * Convert a SearchResultType back to its filter keyword.
 */
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
        case SearchResultType.PROJECT:
            return 'project';
        case SearchResultType.TASK:
            return 'task';
        case SearchResultType.AGENT:
            return 'agent';
        case SearchResultType.PROMPT:
            return 'prompt';
        default:
            return '';
    }
}

/**
 * Remove a specific type filter from the query string.
 */
export function removeTypeFilterFromQuery(query: string, type: SearchResultType): string {
    const keyword = getTypeFilterKeyword(type);
    if (!keyword) return query;

    // Remove the type filter pattern
    const pattern = new RegExp(`\\b${keyword}s?:\\s*(?:"[^"]*"|[^\\s]*)\\s*`, 'gi');
    return query.replace(pattern, '').replace(/\s+/g, ' ').trim();
}

/**
 * Remove a tag filter from the query string.
 */
export function removeTagFilterFromQuery(query: string, tag: string): string {
    // Handle both quoted and unquoted tag values
    const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\btag:\\s*(?:"${escapedTag}"|${escapedTag})\\s*`, 'gi');
    return query.replace(pattern, '').replace(/\s+/g, ' ').trim();
}

/**
 * Remove a project filter from the query string.
 */
export function removeProjectFilterFromQuery(query: string, project: string): string {
    const escapedProject = project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\bproject:\\s*(?:"${escapedProject}"|${escapedProject})\\s*`, 'gi');
    return query.replace(pattern, '').replace(/\s+/g, ' ').trim();
}

/**
 * Remove the my: filter from the query string.
 */
export function removeMyFilterFromQuery(query: string): string {
    const pattern = /\bmy:\s*(?:"[^"]*"|[^\s]*)\s*/gi;
    return query.replace(pattern, '').replace(/\s+/g, ' ').trim();
}

/**
 * Remove an exact-match phrase from the query string.
 */
export function removePhraseFromQuery(query: string, phrase: string): string {
    const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`"${escapedPhrase}"\\s*`, 'gi');
    return query.replace(pattern, '').replace(/\s+/g, ' ').trim();
}

/**
 * Available filter hints for UI display.
 */
export const FILTER_HINTS = [
    { prefix: '"..."', description: 'Exact phrase match', example: '"docker --platform"' },
    { prefix: 'note:', description: 'Search notes', example: 'note: meeting' },
    { prefix: 'file:', description: 'Search files', example: 'file: report' },
    { prefix: 'user:', description: 'Search users', example: 'user: john' },
    { prefix: 'calendar:', description: 'Search events', example: 'calendar: standup' },
    { prefix: 'tag:', description: 'Filter by tag', example: 'tag:work' },
    { prefix: 'my:', description: 'My content only', example: 'my: drafts' },
] as const;
