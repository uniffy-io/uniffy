/** Pure text-match helpers for in-document PDF search. */

export function normalize(value: string): string {
    return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Non-overlapping match count against whitespace-collapsed, case-folded page text. */
export function findMatchesInText(pageText: string, query: string): number {
    const haystack = normalize(pageText);
    const needle = normalize(query);
    if (!needle) return 0;
    let count = 0;
    let index = haystack.indexOf(needle);
    while (index !== -1) {
        count += 1;
        index = haystack.indexOf(needle, index + needle.length);
    }
    return count;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Wraps case-insensitive matches in `<mark>`; react-pdf injects the result as HTML,
 * so everything else is escaped. Matches spanning two pdf.js text items are counted
 * (page text is joined for counting) but not visually highlighted.
 */
export function highlightTextItem(str: string, query: string): string {
    const needle = query.trim().toLowerCase();
    if (!needle) return escapeHtml(str);
    const lower = str.toLowerCase();
    let out = '';
    let index = 0;
    while (index < str.length) {
        const found = lower.indexOf(needle, index);
        if (found === -1) {
            out += escapeHtml(str.slice(index));
            break;
        }
        out += escapeHtml(str.slice(index, found));
        out += `<mark class="viewer-pdf-hit">${escapeHtml(str.slice(found, found + needle.length))}</mark>`;
        index = found + needle.length;
    }
    return out;
}
