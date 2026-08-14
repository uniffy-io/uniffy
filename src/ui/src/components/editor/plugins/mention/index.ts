import { $node, $inputRule, $view, $remark } from "@milkdown/kit/utils";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import { Node } from "@milkdown/kit/prose/model";
import { EditorView } from "@milkdown/kit/prose/view";
import type { NodeView } from "@milkdown/kit/prose/view";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import React from "react";
import { Provider } from "react-redux";
import { MentionChip, MentionDisplayBridge } from "@/components/mention";
import { sanitizeMentionLabel } from "@/shared/utils/mentionUtils";
import { getStoreRef } from "@/app/storeRef";
import type { AppDispatch } from "@/app/store";
import { parseUrn, urnToPath, UrnType } from "@/shared/utils/urn";
import { openRoomViewer } from "@/features/rooms/store/roomsThunks";
import { navigateTo, openInNewTab } from "@/shared/utils/navigation";
import { getResolvedUrl } from "@/components/editor/plugins/mention/useUrnPreview";
import { getMentionUrl } from "@/components/mention/mentionStateEmitter";
import { getActiveEditorView } from "@/components/editor/editorRegistry";
import { visit, SKIP } from "unist-util-visit";
import type { Parent, Node as UnistNode } from "unist";

export type MentionTriggerEvent = {
  query: string;
  from: number;
  to: number;
  view: EditorView;
};

// Set rather than single callback so multiple editor instances can subscribe.
const mentionEventCallbacks = new Set<(event: MentionTriggerEvent | null) => void>();

export function onMentionTrigger(
  callback: (event: MentionTriggerEvent | null) => void,
): () => void {
  mentionEventCallbacks.add(callback);
  return () => {
    mentionEventCallbacks.delete(callback);
  };
}

export function triggerMentionSearch(event: MentionTriggerEvent | null) {
  mentionEventCallbacks.forEach((callback) => callback(event));
}

/** Inserts `@` and dispatches a synthetic trigger so toolbar buttons can open the search popup without the input-rule path. */
export function triggerMentionAtCursor(view: EditorView) {
  const { state } = view;
  const start = state.selection.from;
  const tr = state.tr.insertText("@", start);
  view.dispatch(tr);
  view.focus();
  triggerMentionSearch({ query: "", from: start, to: start + 1, view });
}

export const mentionNode = $node("mention", () => ({
  group: "inline",
  inline: true,
  atom: true,
  attrs: {
    urn: { default: "" },
    label: { default: "" },
  },
  parseDOM: [
    {
      tag: 'span[data-type="mention"]',
      getAttrs: (dom: HTMLElement) => ({
        urn: dom.getAttribute("data-urn") || "",
        label: dom.getAttribute("data-label") || "",
      }),
    },
  ],
  toDOM: (node: Node) => [
    "span",
    {
      "data-type": "mention",
      "data-urn": node.attrs.urn,
      "data-label": node.attrs.label,
      class: "mention-chip",
    },
    `@${node.attrs.label}`,
  ],
  parseMarkdown: {
    match: ({ type }: { type: string }) => type === "mention",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runner: (state: any, node: any, type: any) => {
      state.addNode(type, {
        urn: node.urn || "",
        label: node.label || "",
      });
    },
  },
  toMarkdown: {
    match: (node: Node) => node.type.name === "mention",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runner: (state: any, node: Node) => {
      const attrs = node.attrs as { label: string; urn: string };
      // Custom 'mention' MDAST node avoids the bracket-escaping that mdast-util-to-markdown applies to text.
      state.addNode("mention", undefined, undefined, {
        label: attrs.label,
        urn: attrs.urn,
      });
    },
  },
}));

const MENTION_REGEX = /\[\[\[([^[\]|]+)\|([^\]]+)\]\]\]/g;

interface MentionNode extends UnistNode {
  type: "mention";
  label: string;
  urn: string;
}

export const mentionRemarkPlugin = $remark("mentionRemarkPlugin", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function mentionPlugin(this: any) {
    // Custom stringifier emits raw `[[[label|urn]]]` without the bracket-escaping that the default text path would apply.
    const toMarkdownExtension = {
      handlers: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mention: (node: any) => `[[[${sanitizeMentionLabel(node.label)}|${node.urn}]]]`,
      },
    };

    const existing = (this.data("toMarkdownExtensions") as unknown[] | undefined) || [];
    this.data("toMarkdownExtensions", [...existing, toMarkdownExtension]);

    return (tree: Parent) => {
      visit(
        tree,
        "text",
        (node: UnistNode, index: number | undefined, parent: Parent | undefined) => {
          if (!parent || index === undefined) return;

          const textNode = node as { type: "text"; value: string };
          const value = textNode.value;

          if (!MENTION_REGEX.test(value)) return;

          MENTION_REGEX.lastIndex = 0;

          const newNodes: (UnistNode | MentionNode)[] = [];
          let lastIndex = 0;
          let match: RegExpExecArray | null;

          while ((match = MENTION_REGEX.exec(value)) !== null) {
            // Reserved labels handled by their own remark plugins.
            if (match[1] === "tag") continue;
            if (match[1] === "video") continue;
            if (match[1] === "audio") continue;
            if (match[1] === "toc") continue;

            if (match.index > lastIndex) {
              newNodes.push({
                type: "text",
                value: value.slice(lastIndex, match.index),
              } as UnistNode);
            }

            newNodes.push({
              type: "mention",
              label: match[1],
              urn: match[2],
            } as MentionNode);

            lastIndex = match.index + match[0].length;
          }

          if (lastIndex < value.length) {
            newNodes.push({
              type: "text",
              value: value.slice(lastIndex),
            } as UnistNode);
          }

          if (newNodes.length > 0) {
            parent.children.splice(index, 1, ...newNodes);
            return [SKIP, index + newNodes.length];
          }
        },
      );
    };
  };
});

export const mentionInputRule = $inputRule(() => {
  const rule = new InputRule(/@([a-zA-Z0-9-_]*)$/, (_state, match, start, end) => {
    const query = match[1] || "";

    const view = getActiveEditorView();

    if (view) {
      triggerMentionSearch({
        query,
        from: start,
        to: end,
        view,
      });
    }

    // Defer the actual insertion to the popup so the user's selection can still be cancelled.
    return null;
  });

  return rule;
});

class MentionNodeView implements NodeView {
  dom: HTMLElement;
  node: Node;
  view: EditorView;
  getPos: () => number | undefined;
  root: Root;
  destroyed: boolean;
  selected = false;

  constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.destroyed = false;

    this.dom = document.createElement("span");
    this.dom.className = "mention-wrapper";
    this.dom.style.cursor = "pointer";
    this.dom.contentEditable = "false";

    // Capture-phase mousedown intercepts before ProseMirror's own selection handling.
    this.dom.addEventListener(
      "mousedown",
      (e: MouseEvent) => {
        if (e.button !== 0) return;

        // Let interactive descendants (expand/collapse buttons) handle their own events.
        const target = e.target as HTMLElement;
        if (target.closest("button")) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const { urn } = this.node.attrs as { urn: string };

        // ROOM opens in place: the writer stays in the document instead of losing it to a route.
        const parsed = parseUrn(urn);
        if (parsed.type === UrnType.ROOM && parsed.id && !e.metaKey && !e.ctrlKey) {
          const dispatch = getStoreRef()?.dispatch as AppDispatch | undefined;
          dispatch?.(openRoomViewer({ roomId: parsed.id }));
          return;
        }

        // Index-resolved URL handles nested routes (e.g. tasks under projects); urnToPath is the fallback.
        const path = getMentionUrl(urn) || getResolvedUrl(urn) || urnToPath(urn);

        if (path === "#") return;

        if (e.metaKey || e.ctrlKey) {
          openInNewTab(path);
        } else {
          navigateTo(path);
        }
      },
      true,
    );

    this.root = createRoot(this.dom);
    this.render();
  }

  handleReplaceWithMedia = (mediaType: "image" | "video" | "audio", url: string, title: string) => {
    const pos = this.getPos();
    if (pos === undefined) return;

    const { state } = this.view;
    const { schema } = state;

    let mediaNode: Node | null = null;

    if (mediaType === "image") {
      const imageType = schema.nodes["image-block"] ?? schema.nodes.image;
      mediaNode = imageType?.createAndFill?.({ src: url, alt: title }) ?? null;
    } else if (mediaType === "video") {
      const videoType = schema.nodes.video_block;
      mediaNode = videoType?.create({ src: url, title }) ?? null;
    } else if (mediaType === "audio") {
      const audioType = schema.nodes.audio_block;
      mediaNode = audioType?.create({ src: url, title }) ?? null;
    }

    if (!mediaNode) return;

    const tr = state.tr.delete(pos, pos + this.node.nodeSize);

    const mappedPos = tr.mapping.map(pos);
    const $pos = tr.doc.resolve(mappedPos);

    if ($pos.depth >= 1) {
      const parentNode = $pos.node(1);
      const parentStart = $pos.before(1);
      const parentEnd = $pos.after(1);

      if (parentNode.textContent.trim() === "") {
        tr.replaceWith(parentStart, parentEnd, mediaNode);
      } else {
        tr.insert(parentEnd, mediaNode);
      }
    }

    this.view.dispatch(tr);
  };

  render() {
    if (this.destroyed) return;

    const { urn, label } = this.node.attrs as { urn: string; label: string };

    // This React root lives outside the main app tree, so it needs its own Provider; MentionDisplayBridge supplies the display setting.
    const mentionElement = React.createElement(MentionChip, {
      urn,
      label,
      selected: this.selected,
      onReplaceWithMedia: this.handleReplaceWithMedia,
    });

    const store = getStoreRef();
    if (store) {
      this.root.render(
        React.createElement(Provider, {
          store,
          children: React.createElement(MentionDisplayBridge, null, mentionElement),
        }),
      );
    } else {
      console.warn("Store not initialized when rendering MentionChip");
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
    this.dom.classList.add("ProseMirror-selectednode");
    this.selected = true;
    this.render();
  }

  deselectNode() {
    this.dom.classList.remove("ProseMirror-selectednode");
    this.selected = false;
    this.render();
  }

  destroy() {
    this.destroyed = true;
    this.root.unmount();
  }

  stopEvent(event: Event) {
    // Swallow mouse events so our capture-phase click handler runs, but let keys through for arrow-key navigation.
    return event instanceof MouseEvent;
  }
}

export const mentionView = $view(
  mentionNode,
  () => (node: Node, view: EditorView, getPos: () => number | undefined) =>
    new MentionNodeView(node, view, getPos),
);

// The remark plugin runs first so `[[[label|urn]]]` is parsed before other processing. $remark returns a tuple, hence the spread.
export const mentionPlugins = [...mentionRemarkPlugin, mentionNode, mentionInputRule, mentionView];

export { MentionChip, MentionChipBasic, MentionChipCompact } from "@/components/mention";
export { MentionPreview } from "@/components/mention";
export { MentionSearch } from "@/components/editor/plugins/mention/MentionSearch";
export {
  useUrnPreview,
  clearPreviewCache,
  invalidatePreviewCache,
  invalidateNotePreviewCache,
} from "@/components/editor/plugins/mention/useUrnPreview";
export type { UrnPreviewData } from "@/components/editor/plugins/mention/useUrnPreview";
export type { MentionLiveState, TaskStatus, FileProcessingStatus } from "@/components/mention";
