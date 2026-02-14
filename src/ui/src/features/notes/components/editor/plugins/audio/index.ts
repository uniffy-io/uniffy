/**
 * Audio Block Plugin for Milkdown/Crepe Editor
 *
 * Adds block-level audio support with:
 * - Markdown persistence as [[[audio|url]]] or [[[audio|url|title]]]
 * - Audio player rendering via AudioBlock component (WaveSurfer.js)
 * - Service worker streaming for authenticated playback
 *
 * Plugin components:
 * - audioBlockNode: Block-level atomic node schema
 * - audioBlockRemarkPlugin: Parses [[[audio|url]]] and [[[audio|url|title]]] from markdown
 * - audioBlockView: React NodeView rendering AudioBlock
 */

import { $node, $view, $remark } from '@milkdown/kit/utils';
import { Node } from '@milkdown/kit/prose/model';
import { EditorView } from '@milkdown/kit/prose/view';
import type { NodeView } from '@milkdown/kit/prose/view';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import React from 'react';
import { AudioBlock } from '@/features/notes/components/editor/plugins/audio/AudioBlock';
import { visit, SKIP } from 'unist-util-visit';
import type { Parent, Node as UnistNode } from 'unist';

// -- Node Schema --

export const audioBlockNode = $node('audio_block', () => ({
    group: 'block',
    atom: true,
    attrs: {
        src: { default: '' },
        title: { default: '' },
    },
    parseDOM: [
        {
            tag: 'div[data-type="audio-block"]',
            getAttrs: (dom: HTMLElement) => ({
                src: dom.getAttribute('data-src') || '',
                title: dom.getAttribute('data-title') || '',
            }),
        },
    ],
    toDOM: (node: Node) => [
        'div',
        {
            'data-type': 'audio-block',
            'data-src': node.attrs.src,
            'data-title': node.attrs.title || '',
            class: 'audio-block-wrapper',
        },
        0,
    ],
    parseMarkdown: {
        match: ({ type }: { type: string }) => type === 'audioBlock',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        runner: (state: any, node: any, type: any) => {
            state.addNode(type, {
                src: node.src || '',
                title: node.title || '',
            });
        },
    },
    toMarkdown: {
        match: (node: Node) => node.type.name === 'audio_block',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        runner: (state: any, node: Node) => {
            const attrs = node.attrs as { src: string; title: string };
            // Skip serializing upload placeholders -- they are transient
            if (attrs.src.startsWith('uploading:')) return;
            state.addNode('audioBlock', undefined, undefined, {
                src: attrs.src,
                title: attrs.title || '',
            });
        },
    },
}));

// -- Remark Plugin --

// Regex to match [[[audio|url]]] or [[[audio|url|title]]] format.
// The title capture uses .*? (non-greedy) so that ] characters inside filenames
// (e.g. "[wwQDYSVAwXs].mp3") are tolerated -- the ]]] at the end anchors the match.
const AUDIO_REGEX = /^\[\[\[audio\|([^\]|]+)(?:\|(.*?))?\]\]\]$/;

// Custom audio block node type for the AST
interface AudioBlockAstNode extends UnistNode {
    type: 'audioBlock';
    src: string;
    title?: string;
}

/**
 * Remark plugin to parse audio blocks from markdown.
 *
 * Handles the formats: [[[audio|url]]] and [[[audio|url|title]]]
 * A paragraph containing only such a pattern is converted to an audioBlock node.
 *
 * Stringify handler converts audioBlock nodes back to [[[audio|url|title]]] or [[[audio|url]]].
 *
 * IMPORTANT: This plugin must be registered BEFORE the mention remark plugin
 * so that [[[audio|X]]] patterns are consumed before the general mention regex.
 */
export const audioBlockRemarkPlugin = $remark('audioBlockRemarkPlugin', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return function audioPlugin(this: any) {
        // Add handler for stringifying audio block nodes back to markdown
        const toMarkdownExtension = {
            handlers: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                audioBlock: (node: any) => {
                    if (node.title) {
                        // Sanitize brackets in title to prevent breaking the ]]] delimiter
                        const safeTitle = node.title.replace(/\[/g, '\uFF3B').replace(/\]/g, '\uFF3D');
                        return `[[[audio|${node.src}|${safeTitle}]]]`;
                    }
                    return `[[[audio|${node.src}]]]`;
                },
            },
        };

        const existing = (this.data('toMarkdownExtensions') as unknown[] | undefined) || [];
        this.data('toMarkdownExtensions', [...existing, toMarkdownExtension]);

        // Return the tree transformer for parsing
        return (tree: Parent) => {
            visit(tree, 'paragraph', (node: UnistNode, index: number | undefined, parent: Parent | undefined) => {
                if (!parent || index === undefined) return;

                const paraNode = node as Parent;
                if (paraNode.children.length === 0) return;

                // Concatenate all inline text content. Remark may split the
                // paragraph into multiple children when the title contains
                // bracket characters (e.g. "[foo]" parsed as a linkReference).
                const textValue = paraNode.children
                    .map((c) => {
                        if (c.type === 'text') return (c as { type: 'text'; value: string }).value;
                        // linkReference nodes generated from bare [brackets]
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

                const match = AUDIO_REGEX.exec(textValue);
                if (!match) return;

                // Replace the paragraph with an audioBlock node
                const audioNode: AudioBlockAstNode = {
                    type: 'audioBlock',
                    src: match[1],
                    title: match[2] || '',
                };

                parent.children.splice(index, 1, audioNode as unknown as UnistNode);
                return [SKIP, index + 1];
            });
        };
    };
});

// -- Node View --

class AudioBlockNodeView implements NodeView {
    dom: HTMLElement;
    node: Node;
    view: EditorView;
    getPos: () => number | undefined;
    root: Root;
    destroyed: boolean;

    constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
        this.node = node;
        this.view = view;
        this.getPos = getPos;
        this.destroyed = false;

        // Create wrapper element (block-level)
        this.dom = document.createElement('div');
        this.dom.className = 'audio-block-wrapper';
        this.dom.contentEditable = 'false';

        // Mount React component
        this.root = createRoot(this.dom);
        this.render();
    }

    render(selected = false) {
        if (this.destroyed) return;

        const { src, title } = this.node.attrs as { src: string; title: string };
        this.root.render(
            React.createElement(AudioBlock, { src, title, selected })
        );
    }

    update(node: Node) {
        if (node.type !== this.node.type) return false;
        this.node = node;
        this.render();
        return true;
    }

    selectNode() {
        this.dom.classList.add('ProseMirror-selectednode');
        this.render(true);
    }

    deselectNode() {
        this.dom.classList.remove('ProseMirror-selectednode');
        this.render(false);
    }

    destroy() {
        this.destroyed = true;
        this.root.unmount();
    }

    stopEvent() {
        return true;
    }
}

export const audioBlockView = $view(audioBlockNode, () => (node: Node, view: EditorView, getPos: () => number | undefined) =>
    new AudioBlockNodeView(node, view, getPos)
);

// -- Export --

// The remark plugin must come first to parse [[[audio|url]]] before other processing
// $remark returns a tuple [$Ctx, MilkdownPlugin] so we spread it
export const audioPlugins = [...audioBlockRemarkPlugin, audioBlockNode, audioBlockView];

// Re-export component
export { AudioBlock } from '@/features/notes/components/editor/plugins/audio/AudioBlock';

// Exported for unit testing
export { AUDIO_REGEX };
