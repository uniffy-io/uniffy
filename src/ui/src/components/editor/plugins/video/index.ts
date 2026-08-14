// Markdown literal: `[[[video|url]]]` or `[[[video|url|title]]]`. Service worker handles range-based seek.

import { $node, $view, $remark } from "@milkdown/kit/utils";
import { Node } from "@milkdown/kit/prose/model";
import { EditorView } from "@milkdown/kit/prose/view";
import type { NodeView } from "@milkdown/kit/prose/view";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import React from "react";
import { VideoBlock } from "@/components/editor/plugins/video/VideoBlock";
import { visit, SKIP } from "unist-util-visit";
import type { Parent, Node as UnistNode } from "unist";

export const videoBlockNode = $node("video_block", () => ({
  group: "block",
  atom: true,
  attrs: {
    src: { default: "" },
    title: { default: "" },
  },
  parseDOM: [
    {
      tag: 'div[data-type="video-block"]',
      getAttrs: (dom: HTMLElement) => ({
        src: dom.getAttribute("data-src") || "",
        title: dom.getAttribute("data-title") || "",
      }),
    },
  ],
  toDOM: (node: Node) => [
    "div",
    {
      "data-type": "video-block",
      "data-src": node.attrs.src,
      "data-title": node.attrs.title || "",
      class: "video-block-wrapper",
    },
    0,
  ],
  parseMarkdown: {
    match: ({ type }: { type: string }) => type === "videoBlock",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runner: (state: any, node: any, type: any) => {
      state.addNode(type, {
        src: node.src || "",
        title: node.title || "",
      });
    },
  },
  toMarkdown: {
    match: (node: Node) => node.type.name === "video_block",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runner: (state: any, node: Node) => {
      const attrs = node.attrs as { src: string; title: string };
      // Upload placeholders are transient — don't serialize them.
      if (attrs.src.startsWith("uploading:")) return;
      state.addNode("videoBlock", undefined, undefined, {
        src: attrs.src,
        title: attrs.title || "",
      });
    },
  },
}));

// Title capture is non-greedy so `]` characters in filenames (e.g. `[wwQDYSVAwXs].mp3`) are tolerated; `]]]` anchors the match.
const VIDEO_REGEX = /^\[\[\[video\|([^\]|]+)(?:\|(.*?))?\]\]\]$/;

interface VideoBlockAstNode extends UnistNode {
  type: "videoBlock";
  src: string;
  title?: string;
}

// Register BEFORE the mention remark plugin so `[[[video|...]]]` is consumed before the general mention regex.
export const videoBlockRemarkPlugin = $remark("videoBlockRemarkPlugin", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function videoPlugin(this: any) {
    const toMarkdownExtension = {
      handlers: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        videoBlock: (node: any) => {
          if (node.title) {
            // Sanitize brackets so they don't break the `]]]` delimiter.
            const safeTitle = node.title.replace(/\[/g, "\uFF3B").replace(/\]/g, "\uFF3D");
            return `[[[video|${node.src}|${safeTitle}]]]`;
          }
          return `[[[video|${node.src}]]]`;
        },
      },
    };

    const existing = (this.data("toMarkdownExtensions") as unknown[] | undefined) || [];
    this.data("toMarkdownExtensions", [...existing, toMarkdownExtension]);

    return (tree: Parent) => {
      visit(
        tree,
        "paragraph",
        (node: UnistNode, index: number | undefined, parent: Parent | undefined) => {
          if (!parent || index === undefined) return;

          const paraNode = node as Parent;
          if (paraNode.children.length === 0) return;

          // Bracket characters in the title (`[foo]`) make remark emit a `linkReference` child, so reassemble the original text.
          const textValue = paraNode.children
            .map((c) => {
              if (c.type === "text") return (c as { type: "text"; value: string }).value;
              if (c.type === "linkReference") {
                const lr = c as Parent & { label?: string };
                const inner =
                  lr.children
                    ?.map((lc) =>
                      lc.type === "text" ? (lc as { type: "text"; value: string }).value : "",
                    )
                    .join("") ?? "";
                return `[${inner}]`;
              }
              return "";
            })
            .join("")
            .trim();

          const match = VIDEO_REGEX.exec(textValue);
          if (!match) return;

          const videoNode: VideoBlockAstNode = {
            type: "videoBlock",
            src: match[1],
            title: match[2] || "",
          };

          parent.children.splice(index, 1, videoNode as unknown as UnistNode);
          return [SKIP, index + 1];
        },
      );
    };
  };
});

class VideoBlockNodeView implements NodeView {
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

    this.dom = document.createElement("div");
    this.dom.className = "video-block-wrapper";
    this.dom.contentEditable = "false";

    this.root = createRoot(this.dom);
    this.render();
  }

  render(selected = false) {
    if (this.destroyed) return;

    const { src, title } = this.node.attrs as { src: string; title: string };
    this.root.render(React.createElement(VideoBlock, { src, title, selected }));
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode() {
    this.dom.classList.add("ProseMirror-selectednode");
    this.render(true);
  }

  deselectNode() {
    this.dom.classList.remove("ProseMirror-selectednode");
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

export const videoBlockView = $view(
  videoBlockNode,
  () => (node: Node, view: EditorView, getPos: () => number | undefined) =>
    new VideoBlockNodeView(node, view, getPos),
);

// Remark plugin must come first so `[[[video|url]]]` is parsed before the general mention regex. $remark returns a tuple, hence the spread.
export const videoPlugins = [...videoBlockRemarkPlugin, videoBlockNode, videoBlockView];

export { VideoBlock } from "@/components/editor/plugins/video/VideoBlock";

export { VIDEO_REGEX };
