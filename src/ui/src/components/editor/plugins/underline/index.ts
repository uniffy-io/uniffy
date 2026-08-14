import { $mark, $remark } from "@milkdown/kit/utils";
import { commandsCtx, editorViewCtx } from "@milkdown/core";
import { $command } from "@milkdown/kit/utils";
import { visit, SKIP } from "unist-util-visit";
import type { Parent } from "unist";
import type { Ctx } from "@milkdown/kit/ctx";
import type { EditorView } from "@milkdown/prose/view";

export const underlineMark = $mark("underline", () => ({
  parseDOM: [
    { tag: "u" },
    {
      style: "text-decoration",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getAttrs: (value: any) =>
        typeof value === "string" && value.includes("underline") ? {} : false,
    },
  ],
  toDOM: () => ["u", { class: "text-underline" }, 0],
  parseMarkdown: {
    match: (node) => node.type === "underline",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runner: (state: any, node: any, type: any) => {
      state.openMark(type);
      state.next(node.children);
      state.closeMark(type);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "underline",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runner: (state: any, mark: any) => {
      state.withMark(mark, "underline");
    },
  },
}));

export const toggleUnderlineCommand = $command("ToggleUnderline", (ctx) => () => {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    const markType = state.schema.marks.underline;
    if (!markType) return false;
    if (empty) {
      const stored = markType.isInSet(state.storedMarks ?? state.selection.$from.marks());
      const tr = state.tr;
      if (stored) tr.removeStoredMark(markType);
      else tr.addStoredMark(markType.create());
      dispatch?.(tr);
      return true;
    }
    const has = state.doc.rangeHasMark(from, to, markType);
    const tr = state.tr;
    if (has) tr.removeMark(from, to, markType);
    else tr.addMark(from, to, markType.create());
    dispatch?.(tr);
    void ctx;
    return true;
  };
});

export const underlineRemarkPlugin = $remark("underlineRemarkPlugin", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function remarkUnderline(this: any) {
    const toMarkdownExtension = {
      handlers: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        underline: (node: any, _parent: any, state: any, info: any) => {
          const content = state.containerPhrasing(node, { before: info.before, after: info.after });
          return `<u>${content}</u>`;
        },
      },
    };
    const existing = (this.data("toMarkdownExtensions") as unknown[] | undefined) || [];
    this.data("toMarkdownExtensions", [...existing, toMarkdownExtension]);

    return (tree: Parent) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      visit(tree, (node: any, index: number | undefined, parent: any) => {
        if (!parent || index === undefined) return;
        if (node.type !== "html") return;

        const value = node.value as string;
        if (!/^<u\b[^>]*>/i.test(value)) return;

        const children = parent.children as Array<{ type: string; value?: string }>;
        let closeIndex = -1;
        let depth = 1;
        for (let i = index + 1; i < children.length; i++) {
          const c = children[i];
          if (c.type !== "html") continue;
          if (typeof c.value === "string" && /^<u\b/i.test(c.value)) depth++;
          else if (c.value === "</u>") {
            depth--;
            if (depth === 0) {
              closeIndex = i;
              break;
            }
          }
        }
        if (closeIndex === -1) return;

        const inner = children.slice(index + 1, closeIndex);
        const replacement = {
          type: "underline",
          children: inner.length > 0 ? inner : [{ type: "text", value: "" }],
        };
        parent.children.splice(index, closeIndex - index + 1, replacement);
        return [SKIP, index] as [typeof SKIP, number];
      });
    };
  };
});

export function isUnderlineActive(ctx: Ctx): boolean {
  const view = ctx.get(editorViewCtx) as EditorView | null;
  if (!view) return false;
  const markType = view.state.schema.marks.underline;
  if (!markType) return false;
  const { from, to, empty, $from } = view.state.selection;
  if (empty) return markType.isInSet(view.state.storedMarks ?? $from.marks()) != null;
  return view.state.doc.rangeHasMark(from, to, markType);
}

export function toggleUnderline(ctx: Ctx) {
  ctx.get(commandsCtx).call(toggleUnderlineCommand.key);
}

export const underlinePlugins = [...underlineRemarkPlugin, underlineMark, toggleUnderlineCommand];
