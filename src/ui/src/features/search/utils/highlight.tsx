import type { ReactNode } from 'react';

// Mirrors HIGHLIGHT_PRE_TAG / HIGHLIGHT_POST_TAG in core/search/meilisearch.py.
const HIGHLIGHT_PRE = '\uE000';
const HIGHLIGHT_POST = '\uE001';

export function hasHighlight(text: string | undefined): text is string {
    return !!text && text.includes(HIGHLIGHT_PRE);
}

export function stripHighlightMarkers(text: string): string {
    return text.replaceAll(HIGHLIGHT_PRE, '').replaceAll(HIGHLIGHT_POST, '');
}

export function renderHighlightedText(text: string): ReactNode {
    if (!text.includes(HIGHLIGHT_PRE)) {
        return text;
    }
    const segments = text.split(HIGHLIGHT_PRE);
    const nodes: ReactNode[] = [segments[0]];
    for (let i = 1; i < segments.length; i++) {
        const end = segments[i].indexOf(HIGHLIGHT_POST);
        if (end === -1) {
            nodes.push(segments[i]);
            continue;
        }
        nodes.push(
            <mark key={i} className="rounded-[3px] bg-primary/25 px-px text-inherit">
                {segments[i].slice(0, end)}
            </mark>,
            segments[i].slice(end + 1),
        );
    }
    return nodes;
}
