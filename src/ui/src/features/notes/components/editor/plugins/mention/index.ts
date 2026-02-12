import { $node, $inputRule, $view, $remark } from '@milkdown/kit/utils';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { Node } from '@milkdown/kit/prose/model';
import { EditorView } from '@milkdown/kit/prose/view';
import type { NodeView } from '@milkdown/kit/prose/view';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import React from 'react';
import { Provider } from 'react-redux';
import { MentionChip } from '@/features/notes/components/editor/plugins/mention/MentionChip';
import { getStoreRef } from '@/app/storeRef';
import { urnToPath } from '@/shared/utils/urn';
import { navigateTo, openInNewTab } from '@/shared/utils/navigation';
import { visit, SKIP } from 'unist-util-visit';
import type { Parent, Node as UnistNode } from 'unist';

// Event bus for triggering mention search UI
export type MentionTriggerEvent = {
  query: string;
  from: number;
  to: number;
  view: EditorView;
};

// Use a Set of callbacks to support multiple editor instances
const mentionEventCallbacks = new Set<(event: MentionTriggerEvent | null) => void>();

/**
 * Register a callback for mention trigger events.
 * Returns an unsubscribe function.
 */
export function onMentionTrigger(callback: (event: MentionTriggerEvent | null) => void): () => void {
  mentionEventCallbacks.add(callback);
  return () => {
    mentionEventCallbacks.delete(callback);
  };
}

export function triggerMentionSearch(event: MentionTriggerEvent | null) {
  mentionEventCallbacks.forEach((callback) => callback(event));
}

// 1. Define the mention node schema (inline element)
export const mentionNode = $node('mention', () => ({
  group: 'inline',
  inline: true,
  atom: true,
  attrs: {
    urn: { default: '' },
    label: { default: '' },
  },
  parseDOM: [
    {
      tag: 'span[data-type="mention"]',
      getAttrs: (dom: HTMLElement) => ({
        urn: dom.getAttribute('data-urn') || '',
        label: dom.getAttribute('data-label') || '',
      }),
    },
  ],
  toDOM: (node: Node) => [
    'span',
    {
      'data-type': 'mention',
      'data-urn': node.attrs.urn,
      'data-label': node.attrs.label,
      class: 'mention-chip',
    },
    `@${node.attrs.label}`,
  ],
  parseMarkdown: {
    match: ({ type }: { type: string }) => type === 'mention',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runner: (state: any, node: any, type: any) => {
      state.addNode(type, {
        urn: node.urn || '',
        label: node.label || '',
      });
    },
  },
  toMarkdown: {
    match: (node: Node) => node.type.name === 'mention',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runner: (state: any, node: Node) => {
      const attrs = node.attrs as { label: string; urn: string };
      // Export as custom 'mention' MDAST node - handler added via remarkStringifyMention
      // This avoids mdast-util-to-markdown escaping the brackets in text nodes
      state.addNode('mention', undefined, undefined, {
        label: attrs.label,
        urn: attrs.urn,
      });
    },
  },
}));

// Regex to match [[[label|urn]]] format
const MENTION_REGEX = /\[\[\[([^|]+)\|([^\]]+)\]\]\]/g;

// Custom mention node type for the AST
interface MentionNode extends UnistNode {
  type: 'mention';
  label: string;
  urn: string;
}

// Remark plugin to parse [[[label|urn]]] into mention AST nodes
export const mentionRemarkPlugin = $remark('mentionRemarkPlugin', () => {
  // Return a unified plugin that handles both parsing and stringifying
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function mentionPlugin(this: any) {
    // Add handler for stringifying mention nodes back to markdown
    // This handler outputs raw [[[label|urn]]] without escaping
    const toMarkdownExtension = {
      handlers: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mention: (node: any) => `[[[${node.label}|${node.urn}]]]`,
      },
    };

    // Add to existing toMarkdownExtensions or create new array
    const existing = (this.data('toMarkdownExtensions') as unknown[] | undefined) || [];
    this.data('toMarkdownExtensions', [...existing, toMarkdownExtension]);

    // Return the tree transformer for parsing
    return (tree: Parent) => {
      visit(tree, 'text', (node: UnistNode, index: number | undefined, parent: Parent | undefined) => {
        if (!parent || index === undefined) return;

        const textNode = node as { type: 'text'; value: string };
        const value = textNode.value;

        // Check if this text contains any mention patterns
        if (!MENTION_REGEX.test(value)) return;

        // Reset regex lastIndex since we use 'g' flag
        MENTION_REGEX.lastIndex = 0;

        // Split the text into parts, replacing mentions with mention nodes
        const newNodes: (UnistNode | MentionNode)[] = [];
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = MENTION_REGEX.exec(value)) !== null) {
          // Skip tag patterns — handled by tag remark plugin
          if (match[1] === 'tag') continue;
          // Skip video patterns — handled by video remark plugin
          if (match[1] === 'video') continue;
          // Skip audio patterns — handled by audio remark plugin
          if (match[1] === 'audio') continue;

          // Add text before the match
          if (match.index > lastIndex) {
            newNodes.push({
              type: 'text',
              value: value.slice(lastIndex, match.index),
            } as UnistNode);
          }

          // Add the mention node
          newNodes.push({
            type: 'mention',
            label: match[1],
            urn: match[2],
          } as MentionNode);

          lastIndex = match.index + match[0].length;
        }

        // Add any remaining text after the last match
        if (lastIndex < value.length) {
          newNodes.push({
            type: 'text',
            value: value.slice(lastIndex),
          } as UnistNode);
        }

        // Replace the original node with the new nodes
        if (newNodes.length > 0) {
          parent.children.splice(index, 1, ...newNodes);
          return [SKIP, index + newNodes.length];
        }
      });
    };
  };
});

// 2. Input rule to detect "@" and trigger search
// Store the view reference when the plugin is created
const editorViewRef: EditorView | null = null;

export const mentionInputRule = $inputRule(() => {
  // Create a custom InputRule that captures the view
  // Match @ followed by any alphanumeric characters, hyphens, or underscores (no spaces in capture group)
  const rule = new InputRule(/@([a-zA-Z0-9-_]*)$/, (_state, match, start, end) => {
    const query = match[1] || '';

    // Get view from global reference
    const view = editorViewRef || (window as Window & { __milkdownEditorView?: EditorView }).__milkdownEditorView;

    if (view) {
      triggerMentionSearch({
        query,
        from: start,
        to: end,
        view,
      });
    }

    // Don't modify the document yet - let the popup handle insertion
    return null;
  });

  return rule;
});

// 3. View for rendering mention chips using React
class MentionNodeView implements NodeView {
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

    // Create wrapper element
    this.dom = document.createElement('span');
    this.dom.className = 'mention-wrapper';
    this.dom.style.cursor = 'pointer';
    this.dom.style.display = 'inline-block';
    this.dom.contentEditable = 'false';

    // Handle click navigation - use mousedown to catch before ProseMirror selection
    this.dom.addEventListener('mousedown', (e: MouseEvent) => {
      // Only handle left clicks
      if (e.button !== 0) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const { urn } = this.node.attrs as { urn: string };
      const path = urnToPath(urn);

      if (path === '#') return;

      // Cmd/Ctrl + Click opens in new tab
      if (e.metaKey || e.ctrlKey) {
        openInNewTab(path);
      } else {
        navigateTo(path);
      }
    }, true); // Use capture phase to intercept before ProseMirror

    // Mount React component
    this.root = createRoot(this.dom);
    this.render();
  }

  /**
   * Replace this mention node with an inline media block (image, video, or audio).
   * Called from the MentionChip when the user clicks "Embed" in the hover preview.
   */
  handleReplaceWithMedia = (mediaType: 'image' | 'video' | 'audio', url: string, title: string) => {
    const pos = this.getPos();
    if (pos === undefined) return;

    const { state } = this.view;
    const { schema } = state;

    let mediaNode: Node | null = null;

    if (mediaType === 'image') {
      const imageType = schema.nodes['image-block'] ?? schema.nodes.image;
      mediaNode = imageType?.createAndFill?.({ src: url, alt: title }) ?? null;
    } else if (mediaType === 'video') {
      const videoType = schema.nodes.video_block;
      mediaNode = videoType?.create({ src: url, title }) ?? null;
    } else if (mediaType === 'audio') {
      const audioType = schema.nodes.audio_block;
      mediaNode = audioType?.create({ src: url, title }) ?? null;
    }

    if (!mediaNode) return;

    // Delete the inline mention node first
    const tr = state.tr.delete(pos, pos + this.node.nodeSize);

    // Resolve position to find the parent paragraph
    const mappedPos = tr.mapping.map(pos);
    const $pos = tr.doc.resolve(mappedPos);

    if ($pos.depth >= 1) {
      const parentNode = $pos.node(1);
      const parentStart = $pos.before(1);
      const parentEnd = $pos.after(1);

      if (parentNode.textContent.trim() === '') {
        // Paragraph is empty after removing mention -- replace with media block
        tr.replaceWith(parentStart, parentEnd, mediaNode);
      } else {
        // Paragraph has other content -- insert media block after it
        tr.insert(parentEnd, mediaNode);
      }
    }

    this.view.dispatch(tr);
  };

  render(selected = false) {
    // Don't render if already destroyed
    if (this.destroyed) return;

    const { urn, label } = this.node.attrs as { urn: string; label: string };

    // Wrap with Redux Provider since this React root is outside the main app tree
    const mentionElement = React.createElement(MentionChip, {
      urn,
      label,
      selected,
      onReplaceWithMedia: this.handleReplaceWithMedia,
    });

    // Get store from storeRef - should always be available at render time
    const store = getStoreRef();
    if (store) {
      this.root.render(
        React.createElement(Provider, { store, children: mentionElement })
      );
    } else {
      // Store not yet initialized - render without provider
      // This should rarely happen in practice
      console.warn('Store not initialized when rendering MentionChip');
      this.root.render(mentionElement);
    }
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
    // Return true to stop ProseMirror from handling the event
    // This allows our click handler to work
    return true;
  }
}

export const mentionView = $view(mentionNode, () => (node: Node, view: EditorView, getPos: () => number | undefined) =>
  new MentionNodeView(node, view, getPos)
);

// Export all plugins as a single array
// Note: View is captured in CrepeEditor.tsx after editor creation
// The remark plugin must come first to parse [[[label|urn]]] before other processing
// $remark returns a tuple [$Ctx, MilkdownPlugin] so we spread it
export const mentionPlugins = [...mentionRemarkPlugin, mentionNode, mentionInputRule, mentionView];

// Re-export components and hooks for use in other features
export { MentionChip, MentionChipBasic, MentionChipCompact } from '@/features/notes/components/editor/plugins/mention/MentionChip';
export { MentionPreview } from '@/features/notes/components/editor/plugins/mention/MentionPreview';
export { MentionSearch } from '@/features/notes/components/editor/plugins/mention/MentionSearch';
export { useUrnPreview, clearPreviewCache, invalidatePreviewCache, invalidateNotePreviewCache } from '@/features/notes/components/editor/plugins/mention/useUrnPreview';
export type { UrnPreviewData } from '@/features/notes/components/editor/plugins/mention/useUrnPreview';
