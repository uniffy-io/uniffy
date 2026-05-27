// Mention format: [[[label|urn:uniffy:content:TYPE:uuid]]]

export interface ParsedMention {
    label: string;
    urn: string;
}

/** Returns mentions deduplicated by URN. */
export function extractMentionsFromMarkdown(markdown: string): ParsedMention[] {
    const mentionRegex = /\[\[\[([^|]+)\|([^\]]+)\]\]\]/g;
    const mentions: ParsedMention[] = [];
    let match;

    while ((match = mentionRegex.exec(markdown)) !== null) {
        mentions.push({ label: match[1], urn: match[2] });
    }

    return mentions.filter(
        (mention, index, self) => self.findIndex((m) => m.urn === mention.urn) === index
    );
}

/** Short label like "note:abcd1234" for URNs missing a display label. */
export function extractFallbackLabel(urn: string): string {
    const parts = urn.split(':');
    const type = parts[3]?.toLowerCase() || 'item';
    const id = parts[4]?.slice(0, 8) || '';
    return `${type}:${id}`;
}
