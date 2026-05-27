// Markdown literal: `[[[tag|name]]]`. Typed `#name<space>` is auto-converted via the input rule.

import { $node, $inputRule, $view, $remark } from '@milkdown/kit/utils';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { Node } from '@milkdown/kit/prose/model';
import { EditorView } from '@milkdown/kit/prose/view';
import type { NodeView } from '@milkdown/kit/prose/view';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import React from 'react';
import { TagChip } from '@/components/editor/plugins/tag/TagChip';
import { navigateTo, openInNewTab } from '@/shared/utils/navigation';
import { visit, SKIP } from 'unist-util-visit';
import type { Parent, Node as UnistNode } from 'unist';

export const tagNode = $node('tag', () => ({
  group: 'inline',
  inline: true,
  atom: true,
  attrs: {
    name: { default: '' },
  },
  parseDOM: [
    {
      tag: 'span[data-type="tag"]',
      getAttrs: (dom: HTMLElement) => ({
        name: dom.getAttribute('data-tag-name') || '',
      }),
    },
  ],
  toDOM: (node: Node) => [
    'span',
    {
      'data-type': 'tag',
      'data-tag-name': node.attrs.name,
      class: 'tag-chip',
    },
    `#${node.attrs.name}`,
  ],
  parseMarkdown: {
    match: ({ type }: { type: string }) => type === 'tag',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runner: (state: any, node: any, type: any) => {
      state.addNode(type, {
        name: node.name || '',
      });
    },
  },
  toMarkdown: {
    match: (node: Node) => node.type.name === 'tag',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runner: (state: any, node: Node) => {
      const attrs = node.attrs as { name: string };
      // Export as custom 'tag' MDAST node — handler added via tagRemarkPlugin stringify
      state.addNode('tag', undefined, undefined, {
        name: attrs.name,
      });
    },
  },
}));

// Persisted canonical form.
const TAG_BRACKET_REGEX = /\[\[\[tag\|([^\]]+)\]\]\]/g;

// Shorthand: `#name` preceded by start-of-string or whitespace; name starts with a letter.
const TAG_HASH_REGEX = /#([a-zA-Z][a-zA-Z0-9_-]*)/g;

interface TagAstNode extends UnistNode {
  type: 'tag';
  name: string;
}

function splitTextByTagPattern(
  value: string,
  regex: RegExp,
  captureGroupIndex: number,
  validateMatch?: (match: RegExpExecArray, value: string) => boolean,
): (UnistNode | TagAstNode)[] | null {
  regex.lastIndex = 0;
  if (!regex.test(value)) return null;
  regex.lastIndex = 0;

  const newNodes: (UnistNode | TagAstNode)[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(value)) !== null) {
    if (validateMatch && !validateMatch(match, value)) continue;

    if (match.index > lastIndex) {
      newNodes.push({
        type: 'text',
        value: value.slice(lastIndex, match.index),
      } as UnistNode);
    }

    newNodes.push({
      type: 'tag',
      name: match[captureGroupIndex],
    } as TagAstNode);

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < value.length) {
    newNodes.push({
      type: 'text',
      value: value.slice(lastIndex),
    } as UnistNode);
  }

  return newNodes.length > 0 && newNodes.some((n) => n.type === 'tag') ? newNodes : null;
}

// Register BEFORE the mention remark plugin so `[[[tag|...]]]` is consumed before the general mention regex.
export const tagRemarkPlugin = $remark('tagRemarkPlugin', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function tagPlugin(this: any) {
    const toMarkdownExtension = {
      handlers: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tag: (node: any) => `[[[tag|${node.name}]]]`,
      },
    };

    const existing = (this.data('toMarkdownExtensions') as unknown[] | undefined) || [];
    this.data('toMarkdownExtensions', [...existing, toMarkdownExtension]);

    return (tree: Parent) => {
      // Canonical `[[[tag|...]]]` first; shorthand `#name` second.
      visit(tree, 'text', (node: UnistNode, index: number | undefined, parent: Parent | undefined) => {
        if (!parent || index === undefined) return;
        const value = (node as { type: 'text'; value: string }).value;

        const newNodes = splitTextByTagPattern(value, TAG_BRACKET_REGEX, 1);
        if (newNodes) {
          parent.children.splice(index, 1, ...newNodes);
          return [SKIP, index + newNodes.length];
        }
      });

      visit(tree, 'text', (node: UnistNode, index: number | undefined, parent: Parent | undefined) => {
        if (!parent || index === undefined) return;
        const value = (node as { type: 'text'; value: string }).value;

        const newNodes = splitTextByTagPattern(value, TAG_HASH_REGEX, 1, (match, val) => {
          // Anchor to start-of-string or whitespace so we don't match mid-word `foo#bar` or URL fragments.
          if (match.index > 0) {
            const prevChar = val[match.index - 1];
            if (prevChar !== ' ' && prevChar !== '\t' && prevChar !== '\n') return false;
          }
          return true;
        });

        if (newNodes) {
          parent.children.splice(index, 1, ...newNodes);
          return [SKIP, index + newNodes.length];
        }
      });
    };
  };
});

// `(^|\s)#name<space>` — anchor prevents mid-word matches, leading letter prevents `#123`.
export const tagInputRule = $inputRule(() => {
  const regex = /(^|\s)#([a-zA-Z][a-zA-Z0-9_-]*) $/;

  return new InputRule(regex, (state, match, start, end) => {
    const tagName = match[2];
    const { schema } = state;
    const tagType = schema.nodes.tag;

    if (!tagType) return null;

    // Calculate start of #tag (skip leading whitespace if present)
    const hashStart = start + match[1].length;

    // Create tag node
    const tagNodeInstance = tagType.create({ name: tagName });

    // Replace #tagname<space> with tag node + space
    const tr = state.tr.replaceWith(hashStart, end, [
      tagNodeInstance,
      schema.text(' '),
    ]);

    return tr;
  });
});

class TagNodeView implements NodeView {
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
    this.dom.className = 'tag-wrapper';
    this.dom.style.cursor = 'pointer';
    this.dom.style.display = 'inline-block';
    this.dom.contentEditable = 'false';

    // Handle click navigation — use mousedown to catch before ProseMirror selection
    this.dom.addEventListener('mousedown', (e: MouseEvent) => {
      // Only handle left clicks
      if (e.button !== 0) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const { name } = this.node.attrs as { name: string };
      const path = `/tags/${encodeURIComponent(name)}`;

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

  render(selected = false) {
    if (this.destroyed) return;

    const { name } = this.node.attrs as { name: string };
    this.root.render(
      React.createElement(TagChip, { name, selected })
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

export const tagView = $view(tagNode, () => (node: Node, view: EditorView, getPos: () => number | undefined) =>
  new TagNodeView(node, view, getPos)
);

// Remark plugin must come first so `[[[tag|...]]]` is parsed before the general mention regex. $remark returns a tuple, hence the spread.
export const tagPlugins = [...tagRemarkPlugin, tagNode, tagInputRule, tagView];

export { TagChip } from '@/components/editor/plugins/tag/TagChip';
