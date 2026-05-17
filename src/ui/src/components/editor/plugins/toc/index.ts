/**
 * Table of Contents Block Plugin for Milkdown/Crepe Editor
 *
 * Adds a block-level `tocBlock` node that renders a live, clickable outline
 * of every heading in the document. Persists as Markdown literal:
 *
 *   [[[toc|min=1|max=3|numbered=false|style=flat]]]
 *
 * Live updates are driven by a companion ProseMirror plugin
 * (`tocOutlinePlugin`) which traverses top-level heading nodes after every
 * doc-changing transaction and broadcasts entries to the NodeView.
 *
 * Plugin components:
 * - tocBlockNode: Block-level atomic node schema (attrs: min/max/numbered/style)
 * - tocBlockRemarkPlugin: Parses [[[toc|...]]] from markdown
 * - tocBlockView: React NodeView rendering TocBlockView
 * - tocOutlinePlugin: Outline derivation + broadcast
 *
 * Registration order: this plugin must be registered BEFORE the mention
 * remark plugin so that [[[toc|...]]] patterns are consumed before the
 * general mention regex picks them up.
 */

import { $node, $view, $remark } from '@milkdown/kit/utils';
import { Node } from '@milkdown/kit/prose/model';
import { EditorView } from '@milkdown/kit/prose/view';
import type { NodeView } from '@milkdown/kit/prose/view';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import React from 'react';
import { Provider } from 'react-redux';
import { visit, SKIP } from 'unist-util-visit';
import type { Parent, Node as UnistNode } from 'unist';
import { getStoreRef } from '@/app/storeRef';
import { TocBlockView } from '@/components/editor/plugins/toc/TocBlockView';
import { tocOutlinePlugin } from '@/components/editor/plugins/toc/tocOutlinePlugin';
import {
    TOC_DEFAULTS,
    clampLevel,
    parseBullets,
    type TocAttrs,
    type TocBullets,
} from '@/components/editor/plugins/toc/tocTypes';

const TOC_REGEX = /^\[\[\[toc(?:\|([^\]]*))?\]\]\]$/;

function parseTocParams(raw: string | undefined): TocAttrs {
    const out: TocAttrs = { ...TOC_DEFAULTS };
    if (!raw) return out;
    for (const part of raw.split('|')) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        const key = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();
        switch (key) {
            case 'min':
                out.min = clampLevel(Number(value), TOC_DEFAULTS.min);
                break;
            case 'max':
                out.max = clampLevel(Number(value), TOC_DEFAULTS.max);
                break;
            case 'style':
                out.style = value === 'nested' ? 'nested' : 'flat';
                break;
            case 'bullets':
                out.bullets = parseBullets(value, TOC_DEFAULTS.bullets);
                break;
        }
    }
    if (out.min > out.max) {
        const swap = out.min;
        out.min = out.max;
        out.max = swap;
    }
    return out;
}

function stringifyTocParams(attrs: TocAttrs): string {
    return `min=${attrs.min}|max=${attrs.max}|style=${attrs.style}|bullets=${attrs.bullets}`;
}

interface TocBlockAstNode extends UnistNode {
    type: 'tocBlock';
    min: number;
    max: number;
    style: 'flat' | 'nested';
    bullets: TocBullets;
}

export const tocBlockNode = $node('toc_block', () => ({
    group: 'block',
    atom: true,
    attrs: {
        min: { default: TOC_DEFAULTS.min },
        max: { default: TOC_DEFAULTS.max },
        style: { default: TOC_DEFAULTS.style },
        bullets: { default: TOC_DEFAULTS.bullets },
    },
    parseDOM: [
        {
            tag: 'div[data-type="toc-block"]',
            getAttrs: (dom: HTMLElement) => ({
                min: clampLevel(Number(dom.getAttribute('data-min')), TOC_DEFAULTS.min),
                max: clampLevel(Number(dom.getAttribute('data-max')), TOC_DEFAULTS.max),
                style: dom.getAttribute('data-style') === 'nested' ? 'nested' : 'flat',
                bullets: parseBullets(dom.getAttribute('data-bullets') ?? '', TOC_DEFAULTS.bullets),
            }),
        },
    ],
    toDOM: (node: Node) => {
        const attrs = node.attrs as TocAttrs;
        return [
            'div',
            {
                'data-type': 'toc-block',
                'data-min': String(attrs.min),
                'data-max': String(attrs.max),
                'data-style': attrs.style,
                'data-bullets': attrs.bullets,
                class: 'toc-block-wrapper',
            },
            0,
        ];
    },
    parseMarkdown: {
        match: ({ type }: { type: string }) => type === 'tocBlock',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        runner: (state: any, node: any, type: any) => {
            const attrs: TocAttrs = {
                min: clampLevel(Number(node.min), TOC_DEFAULTS.min),
                max: clampLevel(Number(node.max), TOC_DEFAULTS.max),
                style: node.style === 'nested' ? 'nested' : 'flat',
                bullets: parseBullets(String(node.bullets ?? ''), TOC_DEFAULTS.bullets),
            };
            if (attrs.min > attrs.max) {
                const swap = attrs.min;
                attrs.min = attrs.max;
                attrs.max = swap;
            }
            state.addNode(type, attrs);
        },
    },
    toMarkdown: {
        match: (node: Node) => node.type.name === 'toc_block',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        runner: (state: any, node: Node) => {
            const attrs = node.attrs as TocAttrs;
            state.addNode('tocBlock', undefined, undefined, attrs);
        },
    },
}));

export const tocBlockRemarkPlugin = $remark('tocBlockRemarkPlugin', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return function tocPlugin(this: any) {
        const toMarkdownExtension = {
            handlers: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tocBlock: (node: any) => `[[[toc|${stringifyTocParams(node as TocAttrs)}]]]`,
            },
        };

        const existing = (this.data('toMarkdownExtensions') as unknown[] | undefined) || [];
        this.data('toMarkdownExtensions', [...existing, toMarkdownExtension]);

        return (tree: Parent) => {
            visit(tree, 'paragraph', (node: UnistNode, index: number | undefined, parent: Parent | undefined) => {
                if (!parent || index === undefined) return;

                const paraNode = node as Parent;
                if (paraNode.children.length === 0) return;

                const textValue = paraNode.children
                    .map((c) => {
                        if (c.type === 'text') return (c as { type: 'text'; value: string }).value;
                        if (c.type === 'linkReference') {
                            const lr = c as Parent & { label?: string };
                            const inner = lr.children
                                ?.map((lc) => (lc.type === 'text' ? (lc as { type: 'text'; value: string }).value : ''))
                                .join('') ?? '';
                            return `[${inner}]`;
                        }
                        return '';
                    })
                    .join('')
                    .trim();

                const match = TOC_REGEX.exec(textValue);
                if (!match) return;

                const attrs = parseTocParams(match[1]);
                const tocNode: TocBlockAstNode = {
                    type: 'tocBlock',
                    min: attrs.min,
                    max: attrs.max,
                    style: attrs.style,
                    bullets: attrs.bullets,
                };

                parent.children.splice(index, 1, tocNode as unknown as UnistNode);
                return [SKIP, index + 1];
            });
        };
    };
});

class TocBlockNodeView implements NodeView {
    dom: HTMLElement;
    node: Node;
    view: EditorView;
    getPos: () => number | undefined;
    root: Root;
    destroyed: boolean;
    selected: boolean;

    constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
        this.node = node;
        this.view = view;
        this.getPos = getPos;
        this.destroyed = false;
        this.selected = false;

        this.dom = document.createElement('div');
        this.dom.className = 'toc-block-wrapper';
        this.dom.contentEditable = 'false';

        this.root = createRoot(this.dom);
        this.render();
    }

    render() {
        if (this.destroyed) return;
        const element = React.createElement(TocBlockView, {
            view: this.view,
            getPos: this.getPos,
            attrs: this.node.attrs as TocAttrs,
            selected: this.selected,
            editable: this.view.editable,
        });
        const store = getStoreRef();
        this.root.render(
            store ? React.createElement(Provider, { store, children: element }) : element
        );
    }

    update(node: Node) {
        if (node.type !== this.node.type) return false;
        this.node = node;
        this.render();
        return true;
    }

    selectNode() {
        this.selected = true;
        this.dom.classList.add('ProseMirror-selectednode');
        this.render();
    }

    deselectNode() {
        this.selected = false;
        this.dom.classList.remove('ProseMirror-selectednode');
        this.render();
    }

    destroy() {
        this.destroyed = true;
        this.root.unmount();
    }

    stopEvent() {
        return true;
    }

    ignoreMutation() {
        return true;
    }
}

export const tocBlockView = $view(tocBlockNode, () => (node: Node, view: EditorView, getPos: () => number | undefined) =>
    new TocBlockNodeView(node, view, getPos)
);

export const tocPlugins = [
    ...tocBlockRemarkPlugin,
    tocBlockNode,
    tocBlockView,
    tocOutlinePlugin,
];

export { TOC_REGEX, parseTocParams, stringifyTocParams };
export type { TocAttrs } from '@/components/editor/plugins/toc/tocTypes';
