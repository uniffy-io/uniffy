/**
 * Centralized utilities for parsing Uniffy markdown mentions.
 *
 * Mention format: [[[label|urn:uniffy:content:TYPE:uuid]]]
 */

export interface ParsedMention {
    label: string;
    urn: string;
}

/**
 * Extract all [[[label|urn]]] mentions from markdown content.
 * Returns deduplicated results by URN.
 */
export function extractMentionsFromMarkdown(markdown: string): ParsedMention[] {
    const mentionRegex = /\[\[\[([^|]+)\|([^\]]+)\]\]\]/g;
    const mentions: ParsedMention[] = [];
    let match;

    while ((match = mentionRegex.exec(markdown)) !== null) {
        mentions.push({ label: match[1], urn: match[2] });
    }

    // Deduplicate by URN
    return mentions.filter(
        (mention, index, self) => self.findIndex((m) => m.urn === mention.urn) === index
    );
}

/**
 * Build a short fallback label from a URN when the display label is missing.
 * Returns "type:abcd1234" using the content type and truncated ID.
 */
export function extractFallbackLabel(urn: string): string {
    const parts = urn.split(':');
    const type = parts[3]?.toLowerCase() || 'item';
    const id = parts[4]?.slice(0, 8) || '';
    return `${type}:${id}`;
}
