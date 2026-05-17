/**
 * ProseMirror plugin that maintains the per-view heading outline. On every
 * transaction with `docChanged` it walks top-level children of the document
 * looking for `heading` nodes, computes the slug + occurrence suffix, and
 * publishes the entries to `tocOutlineSubject`.
 *
 * Top-level-only filter: headings inside tables, code blocks, blockquotes,
 * or any other container are intentionally excluded -- only ToC entries for
 * structural document headings make sense.
 */

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import type { Node } from '@milkdown/prose/model';
import { headingToSlug, indexedSlug } from '@/components/editor/utils/headingScroll';
import { setOutline, type HeadingEntry } from '@/components/editor/plugins/toc/tocOutlineSubject';

function computeOutline(doc: Node): HeadingEntry[] {
    const entries: HeadingEntry[] = [];
    const slugCounts = new Map<string, number>();

    doc.forEach((child) => {
        if (child.type.name !== 'heading') return;
        const level = (child.attrs as { level?: number }).level ?? 1;
        const text = child.textContent.trim();
        if (!text) return;
        const base = headingToSlug(text);
        if (!base) return;
        const n = slugCounts.get(base) ?? 0;
        slugCounts.set(base, n + 1);
        entries.push({ level, text, slug: indexedSlug(base, n) });
    });

    return entries;
}

export const tocOutlineKey = new PluginKey('tocOutline');

export const tocOutlinePlugin = $prose(() => new Plugin({
    key: tocOutlineKey,
    view: (view) => {
        setOutline(view, computeOutline(view.state.doc));
        return {
            update: (v, prevState) => {
                if (prevState.doc === v.state.doc) return;
                setOutline(v, computeOutline(v.state.doc));
            },
        };
    },
}));
