// Persisted as HTML `<mark data-color="...">` tags inside the markdown text.

import { $mark, $remark } from '@milkdown/kit/utils';
import { visit, SKIP } from 'unist-util-visit';
import type { Parent, Node as UnistNode } from 'unist';

export interface HighlightColor {
  name: string;
  value: string;
  bg: string;
}

export const HIGHLIGHT_COLORS: HighlightColor[] = [
  { name: 'Red', value: '#f87171', bg: 'rgba(248,113,113,0.35)' },
  { name: 'Blue', value: '#60a5fa', bg: 'rgba(96,165,250,0.35)' },
  { name: 'Green', value: '#4ade80', bg: 'rgba(74,222,128,0.35)' },
  { name: 'Purple', value: '#c084fc', bg: 'rgba(192,132,252,0.35)' },
  { name: 'Orange', value: '#fb923c', bg: 'rgba(251,146,60,0.35)' },
  { name: 'Pink', value: '#f472b6', bg: 'rgba(244,114,182,0.35)' },
];

export function colorToBg(color: string): string {
  const found = HIGHLIGHT_COLORS.find((c) => c.value === color);
  return found ? found.bg : 'rgba(248,113,113,0.35)';
}

export const highlightMark = $mark('highlight', () => ({
  attrs: {
    color: { default: '#f87171' },
  },
  parseDOM: [
    {
      tag: 'mark[data-color]',
      getAttrs: (dom: HTMLElement) => ({
        color: dom.getAttribute('data-color') || '#f87171',
      }),
    },
    {
      tag: 'mark',
      getAttrs: (dom: HTMLElement) => {
        const color = dom.getAttribute('data-color') || '#f87171';
        return { color };
      },
    },
  ],
  toDOM: (mark) => [
    'mark',
    {
      'data-color': mark.attrs.color,
      style: `background-color: ${colorToBg(mark.attrs.color)}`,
      class: 'text-highlight',
    },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'highlight',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runner: (state: any, node: any, type: any) => {
      state.openMark(type, { color: node.color || '#f87171' });
      state.next(node.children);
      state.closeMark(type);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'highlight',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runner: (state: any, mark: any) => {
      state.withMark(mark, 'highlight', undefined, {
        color: mark.attrs.color,
      });
    },
  },
}));

export const highlightRemarkPlugin = $remark('highlightRemarkPlugin', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function remarkHighlight(this: any) {
    const toMarkdownExtension = {
      handlers: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        highlight: (node: any, _parent: any, state: any, info: any) => {
          const content = state.containerPhrasing(node, {
            before: info.before,
            after: info.after,
          });
          const color = (node.color as string) || '#f87171';
          const bg = colorToBg(color);
          return `<mark data-color="${color}" style="background-color: ${bg}">${content}</mark>`;
        },
      },
    };

    const existing =
      (this.data('toMarkdownExtensions') as unknown[] | undefined) || [];
    this.data('toMarkdownExtensions', [...existing, toMarkdownExtension]);

    return (tree: Parent) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      visit(tree, (node: any, index: number | undefined, parent: any) => {
        if (!parent || index === undefined) return;
        if (node.type !== 'html') return;

        const value = node.value as string;
        const openMatch = value.match(/^<mark\b([^>]*)>/);
        if (!openMatch) return;

        const colorMatch = openMatch[1].match(/data-color="([^"]+)"/);
        const color = colorMatch ? colorMatch[1] : '#f87171';

        // Walk forward through siblings to find the matching `</mark>`, honoring nesting.
        const children = parent.children as UnistNode[];
        let closeIndex = -1;
        let nestingLevel = 1;

        for (let i = index + 1; i < children.length; i++) {
          const child = children[i] as { type: string; value?: string };
          if (child.type === 'html') {
            if (
              typeof child.value === 'string' &&
              child.value.match(/^<mark\b/)
            ) {
              nestingLevel++;
            } else if (child.value === '</mark>') {
              nestingLevel--;
              if (nestingLevel === 0) {
                closeIndex = i;
                break;
              }
            }
          }
        }

        if (closeIndex === -1) return;

        const innerChildren = children.slice(index + 1, closeIndex);

        const highlightNode = {
          type: 'highlight',
          color,
          children:
            innerChildren.length > 0
              ? innerChildren
              : [{ type: 'text', value: '' }],
        };

        parent.children.splice(index, closeIndex - index + 1, highlightNode);

        return [SKIP, index] as [typeof SKIP, number];
      });
    };
  };
});

// Remark plugin must come first so markdown parsing/serialization wraps the mark. $remark returns a tuple, hence the spread.
export const highlightPlugins = [...highlightRemarkPlugin, highlightMark];
