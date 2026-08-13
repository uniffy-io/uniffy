/** Regex-based markdown stripper optimized for short search snippets. */
export function stripMarkdown(text: string): string {
    if (!text) return '';

    return text
        .replace(/\\?\[\\?\[\\?\[([^[\]|]+)\|[^\]]+\\?\]\\?\]\\?\]/g, '$1')
        .replace(/\[\[\[([^[\]|]+)\|[^\]]+\]\]\]/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        // Order matters: ** before *
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/~~([^~]+)~~/g, '$1')
        .replace(/^>\s+/gm, '')
        .replace(/^[\s]*[-*+]\s+/gm, '')
        .replace(/^[\s]*\d+\.\s+/gm, '')
        .replace(/^\|?[\s:]*[-]{2,}[\s:]*(\|[\s:]*[-]{2,}[\s:]*)*\|?\s*$/gm, '')
        .replace(/\|/g, ' ')
        .replace(/^[-*_]{3,}\s*$/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function stripMarkdownAndTruncate(text: string, maxLength: number = 150): string {
    const stripped = stripMarkdown(text);
    if (stripped.length <= maxLength) return stripped;
    return stripped.slice(0, maxLength).trim() + '...';
}
