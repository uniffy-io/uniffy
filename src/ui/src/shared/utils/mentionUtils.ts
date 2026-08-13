// Mention format: [[[label|urn:uniffy:content:TYPE:uuid]]]

export interface ParsedMention {
    label: string;
    urn: string;
}

const LABEL_UNSAFE = /[[\]|\\]+/g;

/** Strip the characters that would let a label escape its slot.
 *  The stored label is display fallback only (chips render the resolved live
 *  title), so the strip is invisible to users while making it impossible for
 *  an attacker-controlled title to mint mentions its author never wrote.
 *  Every `[[[label|urn]]]` writer routes labels through here. */
export function sanitizeMentionLabel(label: string): string {
    const cleaned = (label ?? '').replace(LABEL_UNSAFE, ' ').replace(/\s+/g, ' ').trim();
    return cleaned || 'mention';
}

/** Returns mentions deduplicated by URN. */
export function extractMentionsFromMarkdown(markdown: string): ParsedMention[] {
    const mentionRegex = /\[\[\[([^[\]|]+)\|([^\]]+)\]\]\]/g;
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
