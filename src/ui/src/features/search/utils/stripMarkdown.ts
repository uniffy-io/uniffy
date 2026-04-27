/**
 * Strip markdown and HTML from text for clean display in search results.
 *
 * Optimized for short snippets (< 500 chars). Uses simple regex replacements
 * instead of full parsing for performance at scale.
 */

/**
 * Strip markdown formatting from text.
 *
 * Handles:
 * - Headers (#, ##, ###)
 * - Bold/italic (**text**, *text*, __text__, _text_)
 * - Links [text](url) -> text
 * - Images ![alt](url) -> alt
 * - Code blocks and inline code
 * - HTML tags (<br>, <p>, etc.)
 * - Blockquotes (>)
 * - List markers (-, *, 1.)
 * - Horizontal rules (---, ***)
 * - URN mention syntax [[[label|urn]]] -> label
 */
export function stripMarkdown(text: string): string {
    if (!text) return '';

    return text
        // URN mentions with escaped brackets \[\[\[label|urn\]\]\] -> label
        .replace(/\\?\[\\?\[\\?\[([^|\]]+)\|[^\]]+\\?\]\\?\]\\?\]/g, '$1')
        // URN mentions [[[label|urn]]] -> label (unescaped)
        .replace(/\[\[\[([^|]+)\|[^\]]+\]\]\]/g, '$1')
        // Images ![alt](url) -> alt
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        // Links [text](url) -> text
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        // HTML tags
        .replace(/<[^>]+>/g, ' ')
        // Code blocks (``` ... ```)
        .replace(/```[\s\S]*?```/g, ' ')
        // Inline code
        .replace(/`([^`]+)`/g, '$1')
        // Headers (# ## ### etc)
        .replace(/^#{1,6}\s+/gm, '')
        // Bold/italic (order matters: ** before *)
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        // Strikethrough
        .replace(/~~([^~]+)~~/g, '$1')
        // Blockquotes
        .replace(/^>\s+/gm, '')
        // Unordered list markers
        .replace(/^[\s]*[-*+]\s+/gm, '')
        // Ordered list markers
        .replace(/^[\s]*\d+\.\s+/gm, '')
        // Table separator rows (|:---|:---|)
        .replace(/^\|?[\s:]*[-]{2,}[\s:]*(\|[\s:]*[-]{2,}[\s:]*)*\|?\s*$/gm, '')
        // Table cell pipes (| cell | cell |) -> cell cell
        .replace(/\|/g, ' ')
        // Horizontal rules
        .replace(/^[-*_]{3,}\s*$/gm, '')
        // Multiple spaces/newlines -> single space
        .replace(/\s+/g, ' ')
        // Trim
        .trim();
}

/**
 * Strip markdown and truncate to max length with ellipsis.
 */
export function stripMarkdownAndTruncate(text: string, maxLength: number = 150): string {
    const stripped = stripMarkdown(text);
    if (stripped.length <= maxLength) return stripped;
    return stripped.slice(0, maxLength).trim() + '...';
}
