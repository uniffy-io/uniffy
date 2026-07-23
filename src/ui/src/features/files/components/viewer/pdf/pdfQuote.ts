import { buildUrn, UrnType } from '@/shared/utils/urn';

/**
 * Blockquote plus an attribution line ending in a live file mention. Pastes into
 * notes and chat as a mention chip since both render `[[[label|urn]]]` markdown.
 */
export function buildQuoteMarkdown(
    text: string,
    filename: string,
    fileId: string,
    page: number
): string {
    const quoted = text
        .split('\n')
        .map((line) => `> ${line.trimEnd()}`.trimEnd())
        .join('\n');
    const mention = `[[[${filename}|${buildUrn(UrnType.FILE, fileId)}]]]`;
    return `${quoted}\n>\n> ${mention}, p. ${page}`;
}
