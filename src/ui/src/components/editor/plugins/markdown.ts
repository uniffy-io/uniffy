import { remarkStringifyOptionsCtx } from "@milkdown/core";
import type { Ctx } from "@milkdown/ctx";
import {
  orderedListSchema,
  orderedListAttr,
  bulletListSchema,
  hardbreakSchema,
  paragraphSchema,
} from "@milkdown/kit/preset/commonmark";
import { imageBlockSchema } from "@milkdown/kit/component/image-block";
import { $node, $remark } from "@milkdown/kit/utils";
import type { Parent, Node as UnistNode } from "unist";
import { visit } from "unist-util-visit";

declare module "mdast" {
  interface RootContentMap {
    frontmatter: { type: "frontmatter"; value: string };
  }
}

const IMAGE_RATIO = /^<!--uniffy:image-ratio=(\d+(?:\.\d+)?)-->$/;

export function configureMarkdown(configCtx: Ctx, images = true): void {
  configCtx.update(remarkStringifyOptionsCtx, (options) => ({
    ...options,
    bullet: "-" as const,
    listItemIndent: "one" as const,
    rule: "-" as const,
  }));
  configCtx.update(orderedListSchema.key, (original) => (ctx) => ({
    ...original(ctx),
    toDOM: (node) => [
      "ol",
      {
        ...ctx.get(orderedListAttr.key)(node),
        start: node.attrs.order,
        "data-spread": node.attrs.spread,
      },
      0,
    ],
    parseMarkdown: {
      match: ({ type, ordered }) => type === "list" && !!ordered,
      runner: (state, node, type) => {
        state
          .openNode(type, { order: node.start ?? 1, spread: String(node.spread ?? false) })
          .next(node.children)
          .closeNode();
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === "ordered_list",
      runner: (state, node) => {
        state
          .openNode("list", undefined, {
            ordered: true,
            start: node.attrs.order,
            spread: node.attrs.spread === "true",
          })
          .next(node.content)
          .closeNode();
      },
    },
  }));
  configCtx.update(paragraphSchema.key, (original) => (ctx) => ({
    ...original(ctx),
    toMarkdown: {
      match: (node) => node.type.name === "paragraph",
      runner: (state, node) => {
        state.openNode("paragraph").next(node.content).closeNode();
      },
    },
  }));
  configCtx.update(hardbreakSchema.key, (original) => (ctx) => ({
    ...original(ctx),
    toMarkdown: {
      match: (node) => node.type.name === "hardbreak",
      runner: (state, node) => {
        // Markdown's backslash break cannot represent a break at the end of a paragraph.
        state.addNode(
          node.attrs.isInline ? "text" : "html",
          undefined,
          node.attrs.isInline ? "\n" : "<br />",
        );
      },
    },
  }));
  configCtx.update(bulletListSchema.key, (original) => (ctx) => ({
    ...original(ctx),
    toMarkdown: {
      match: (node) => node.type.name === "bullet_list",
      runner: (state, node) => {
        state
          .openNode("list", undefined, { ordered: false, spread: node.attrs.spread === "true" })
          .next(node.content)
          .closeNode();
      },
    },
  }));
  if (!images) return;
  configCtx.update(imageBlockSchema.key, (original) => (ctx) => ({
    ...original(ctx),
    attrs: { ...original(ctx).attrs, alt: { default: "", validate: "string" } },
    parseDOM: [
      {
        tag: 'img[data-type="image-block"]',
        getAttrs: (dom) => ({
          src: dom.getAttribute("src") ?? "",
          alt: dom.getAttribute("alt") ?? "",
          caption: dom.getAttribute("caption") ?? "",
          ratio: Number(dom.getAttribute("ratio") ?? 1),
        }),
      },
    ],
    parseMarkdown: {
      match: ({ type }) => type === "image-block",
      runner: (state, node, type) => {
        // Numeric alt values can carry sizes from existing documents. Preserve the alt as well.
        const ratio = Number(node.ratio ?? node.alt);
        state.addNode(type, {
          src: node.url,
          alt: node.alt ?? "",
          caption: node.title ?? "",
          ratio: Number.isFinite(ratio) && ratio > 0 ? ratio : 1,
        });
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === "image-block",
      runner: (state, node) => {
        state.openNode("paragraph");
        state.addNode("image", undefined, undefined, {
          url: node.attrs.src,
          alt: node.attrs.alt,
          title: node.attrs.caption || null,
        });
        const ratio = Number(node.attrs.ratio);
        if (Number.isFinite(ratio) && ratio > 0 && ratio !== 1) {
          state.addNode("html", undefined, `<!--uniffy:image-ratio=${ratio}-->`);
        }
        state.closeNode();
      },
    },
  }));
}

const markdownDocument = $node("doc", () => ({
  content: "block+",
  parseMarkdown: {
    match: ({ type }) => type === "root",
    runner: (state, node, type) => {
      state.injectRoot(node, type);
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "doc",
    runner: (state, node) => {
      state.openNode("root");
      let end = node.childCount;
      while (
        end > 0 &&
        node.child(end - 1).type.name === "paragraph" &&
        node.child(end - 1).content.size === 0
      )
        end -= 1;
      if (end === 0) state.addNode("paragraph", []);
      for (let index = 0; index < end; index += 1) state.next(node.child(index));
    },
  },
}));

export const frontmatterNode = $node("frontmatter", () => ({
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  parseDOM: [{ tag: "pre[data-frontmatter]", preserveWhitespace: "full" }],
  toDOM: () => ["pre", { "data-frontmatter": "true" }, ["code", 0]],
  parseMarkdown: {
    match: ({ type }) => type === "frontmatter",
    runner: (state, node, type) => {
      state.openNode(type).addText(String(node.value)).closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "frontmatter",
    runner: (state, node) => {
      state.addNode("frontmatter", undefined, node.textContent);
    },
  },
}));

export const preserveMarkdown = $remark(
  "preserveMarkdown",
  () =>
    function () {
      const extensions = this.data("toMarkdownExtensions");
      this.data("toMarkdownExtensions", [
        ...(extensions ?? []),
        {
          handlers: { frontmatter: (node: { value?: unknown }) => String(node.value) },
        },
      ]);
      return (tree: Parent, file: { value: unknown }) => {
        const source = String(file.value);
        const frontmatter = /^(---|\+\+\+)\r?\n[\s\S]*?\r?\n\1(?:\r?\n|$)/.exec(source)?.[0];
        if (frontmatter) {
          tree.children = tree.children.filter(
            (node) => (node.position?.start.offset ?? 0) >= frontmatter.length,
          );
          tree.children.unshift({
            type: "frontmatter",
            value: frontmatter.replace(/\r?\n$/, ""),
          } as UnistNode);
        }
        visit(tree, (node: UnistNode, index: number | undefined, parent: Parent | undefined) => {
          if (!parent || index === undefined) return;
          const value = (node as { value?: string }).value;
          if (node.type === "html" && /^<br\s*\/?>$/i.test(value ?? "")) {
            parent.children[index] =
              parent.type === "paragraph"
                ? { type: "break" }
                : ({ type: "paragraph", children: [{ type: "break" }] } as Parent);
          }
          if (node.type !== "paragraph") return;
          const paragraph = node as Parent;
          if (paragraph.children.length === 2 && paragraph.children[0].type === "image") {
            const metadata = paragraph.children[1] as UnistNode & { value?: string };
            const ratio =
              metadata.type === "html" ? IMAGE_RATIO.exec(metadata.value ?? "")?.[1] : undefined;
            if (ratio)
              parent.children[index] = {
                ...paragraph.children[0],
                type: "image-block",
                ratio,
              } as UnistNode;
          }
          const offset = node.position?.start.offset;
          if (parent.type !== "root" || offset === undefined) return;
          const indent = source.slice(source.lastIndexOf("\n", offset - 1) + 1, offset);
          if (/^ {1,3}$/.test(indent)) {
            paragraph.children.unshift({ type: "text", value: indent } as UnistNode);
          }
        });
      };
    },
);

export const markdownPlugins = [markdownDocument, frontmatterNode, ...preserveMarkdown];
