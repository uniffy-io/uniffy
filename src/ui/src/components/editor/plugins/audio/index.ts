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
import { AudioBlock } from '@/components/editor/plugins/audio/AudioBlock';
import { AudioRecordingBar } from '@/components/editor/plugins/audio/AudioRecordingBar';
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

// -- Audio Recording Node (transient, never persisted) --

export const audioRecordingNode = $node('audio_recording', () => ({
    group: 'block',
    atom: true,
    attrs: {
        recordingId: { default: '' },
    },
    parseDOM: [],
    toDOM: () => ['div', { 'data-type': 'audio-recording' }, 0],
    parseMarkdown: {
        match: () => false,
        runner: () => {/* never parsed from markdown */},
    },
    toMarkdown: {
        match: (node: Node) => node.type.name === 'audio_recording',
        runner: () => {/* transient node, never serialized */},
    },
}));

/** Pick the best supported MIME type for audio recording. */
function getRecordingMimeType(): string {
    const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
    ];
    for (const mime of candidates) {
        if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return '';
}

/** Map MIME type to a sensible file extension. */
function getRecordingExtension(mimeType: string): string {
    if (mimeType.includes('webm')) return 'webm';
    if (mimeType.includes('mp4')) return 'mp4';
    if (mimeType.includes('ogg')) return 'ogg';
    return 'webm';
}

/**
 * Audio upload handler type. Set via setAudioRecordingUploadHandler()
 * before inserting an audio_recording node.
 */
type AudioUploadHandler = (file: File) => Promise<string>;
let _audioUploadHandler: AudioUploadHandler | null = null;

/**
 * Register the audio upload handler for recording nodes.
 * Called by CrepeEditor when setting up the slash menu.
 */
export function setAudioRecordingUploadHandler(handler: AudioUploadHandler | null) {
    _audioUploadHandler = handler;
}

class AudioRecordingNodeView implements NodeView {
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

        this.dom = document.createElement('div');
        this.dom.className = 'audio-block-wrapper';
        this.dom.contentEditable = 'false';

        this.root = createRoot(this.dom);
        this.render();
    }

    render() {
        if (this.destroyed) return;

        const recordingId = this.node.attrs.recordingId as string;
        const view = this.view;
        const getPos = this.getPos;

        const handleComplete = (blob: Blob) => {
            const pos = getPos();
            if (pos === undefined) return;

            const mimeType = getRecordingMimeType() || 'audio/webm';
            const ext = getRecordingExtension(mimeType);
            const filename = `recording-${Date.now()}.${ext}`;
            const file = new File([blob], filename, { type: mimeType });

            // Replace recording node with an audio_block placeholder
            const placeholderId = `uploading:${recordingId}`;
            const { schema } = view.state;
            const audioType = schema.nodes.audio_block;
            if (!audioType) return;

            const placeholderNode = audioType.create({ src: placeholderId, title: filename });
            const tr = view.state.tr.replaceWith(pos, pos + this.node.nodeSize, placeholderNode);
            view.dispatch(tr);

            // Upload using the registered handler
            if (_audioUploadHandler) {
                _audioUploadHandler(file).then((url) => {
                    // Replace placeholder with final URL
                    const { state } = view;
                    let found: number | null = null;
                    state.doc.descendants((n, p) => {
                        if (found !== null) return false;
                        if (n.type.name === 'audio_block' && n.attrs.src === placeholderId) {
                            found = p;
                            return false;
                        }
                    });
                    if (found !== null) {
                        const updateTr = view.state.tr.setNodeMarkup(found, null, { src: url, title: filename });
                        view.dispatch(updateTr);
                    }
                }).catch((err) => {
                    console.error('[AudioRecording] Upload failed:', err);
                    // Remove the placeholder on failure
                    const { state } = view;
                    const toRemove: { pos: number; size: number }[] = [];
                    state.doc.descendants((n, p) => {
                        if (toRemove.length > 0) return false;
                        if (n.type.name === 'audio_block' && n.attrs.src === placeholderId) {
                            toRemove.push({ pos: p, size: n.nodeSize });
                            return false;
                        }
                    });
                    if (toRemove.length > 0) {
                        const { pos: rPos, size } = toRemove[0];
                        const removeTr = view.state.tr.delete(rPos, rPos + size);
                        view.dispatch(removeTr);
                    }
                });
            }
        };

        const handleCancel = () => {
            const pos = getPos();
            if (pos === undefined) return;
            const tr = view.state.tr.delete(pos, pos + this.node.nodeSize);
            view.dispatch(tr);
        };

        this.root.render(
            React.createElement(AudioRecordingBar, {
                onComplete: handleComplete,
                onCancel: handleCancel,
            })
        );
    }

    update(node: Node) {
        if (node.type !== this.node.type) return false;
        this.node = node;
        return true;
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

export const audioRecordingView = $view(audioRecordingNode, () => (node: Node, view: EditorView, getPos: () => number | undefined) =>
    new AudioRecordingNodeView(node, view, getPos)
);

// -- Export --

// The remark plugin must come first to parse [[[audio|url]]] before other processing
// $remark returns a tuple [$Ctx, MilkdownPlugin] so we spread it
export const audioPlugins = [
    ...audioBlockRemarkPlugin,
    audioBlockNode,
    audioBlockView,
    audioRecordingNode,
    audioRecordingView,
];

// Re-export component
export { AudioBlock } from '@/components/editor/plugins/audio/AudioBlock';

// Exported for unit testing
export { AUDIO_REGEX };
