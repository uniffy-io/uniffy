import { $node, $inputRule, $view } from '@milkdown/kit/utils';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { Node } from '@milkdown/kit/prose/model';
import { EditorView } from '@milkdown/kit/prose/view';
import type { NodeView } from '@milkdown/kit/prose/view';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import React from 'react';
import { MentionChip } from './MentionChip';
import { urnToPath } from '@/utils/urn';

// Event bus for triggering mention search UI
export type MentionTriggerEvent = {
  query: string;
  from: number;
  to: number;
  view: EditorView;
};

let mentionEventCallback: ((event: MentionTriggerEvent | null) => void) | null = null;

export function onMentionTrigger(callback: (event: MentionTriggerEvent | null) => void) {
  mentionEventCallback = callback;
}

export function triggerMentionSearch(event: MentionTriggerEvent | null) {
  console.log('[Mention] triggerMentionSearch called with event:', event);
  console.log('[Mention] Callback exists?', !!mentionEventCallback);
  if (mentionEventCallback) {
    console.log('[Mention] Calling callback...');
    mentionEventCallback(event);
  } else {
    console.error('[Mention] No callback registered!');
  }
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
    match: ({ type }: any) => type === 'mention',
    runner: (state: any, node: any, type: any) => {
      state.addNode(type, {
        urn: node.urn || '',
        label: node.label || '',
      });
    },
  },
  toMarkdown: {
    match: (node: Node) => node.type.name === 'mention',
    runner: (state: any, node: Node) => {
      const attrs = node.attrs as any;
      // Export as [@label](urn) format for markdown
      state.addNode('text', undefined, `[@${attrs.label}](${attrs.urn})`);
    },
  },
}));

// 2. Input rule to detect "@" and trigger search
// Store the view reference when the plugin is created
let editorViewRef: EditorView | null = null;

export const mentionInputRule = $inputRule((ctx) => {
  console.log('[Mention] Creating input rule with context:', ctx);

  // Create a custom InputRule that captures the view
  // Match @ followed by any alphanumeric characters, hyphens, or underscores (no spaces in capture group)
  const rule = new InputRule(/@([a-zA-Z0-9-_]*)$/, (state, match, start, end) => {
    const query = match[1] || '';

    console.log('[Mention] Input rule TRIGGERED! Query:', query, { start, end, match });
    console.log('[Mention] Full match:', match);

    // Get view from global reference
    const view = editorViewRef || (window as any).__milkdownEditorView;
    console.log('[Mention] View available?', !!view);

    if (view) {
      console.log('[Mention] Triggering mention search...');
      triggerMentionSearch({
        query,
        from: start,
        to: end,
        view,
      });
    } else {
      console.error('[Mention] No editor view available!');
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

  constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    // Create wrapper element
    this.dom = document.createElement('span');
    this.dom.className = 'mention-wrapper';

    // Mount React component
    this.root = createRoot(this.dom);
    this.render();
  }

  render(selected = false) {
    const { urn, label } = this.node.attrs as any;

    this.root.render(
      React.createElement(MentionChip, {
        urn,
        label,
        selected,
        onClick: () => {
          // Navigate to the URN path
          const path = urnToPath(urn);
          if (path !== '#') {
            window.location.hash = path;
          }
        },
      })
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
    this.root.unmount();
  }

  stopEvent() {
    return true;
  }
}

export const mentionView = $view(mentionNode, () => (node: Node, view: EditorView, getPos: () => number | undefined) =>
  new MentionNodeView(node, view, getPos)
);

// Export all plugins as a single array
// Note: View is captured in CrepeEditor.tsx after editor creation
export const mentionPlugins = [mentionNode, mentionInputRule, mentionView];
