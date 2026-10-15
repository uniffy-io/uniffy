import * as Y from "yjs";
import { fromBase64 } from "lib0/buffer";
import { parserCtx, schemaCtx, serializerCtx, editorViewCtx } from "@milkdown/core";
import type { Ctx } from "@milkdown/ctx";
import { Slice } from "@milkdown/prose/model";
import {
  fragmentToProsemirrorNode,
  normalizeSerializedMarkdown,
} from "@/features/realtime/markdown";
import {
  MARKDOWN_TEXT_FIELD,
  PROSEMIRROR_FRAGMENT_FIELD,
  MARKDOWN_MIRROR_FIELD,
  MIRROR_ACTIVE_KEY,
} from "@/features/realtime/docContent";

export function recoveredMarkdown(update: string, ctx: Ctx): string {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, fromBase64(update));
    const text = doc.getText(MARKDOWN_TEXT_FIELD).toString();
    const fragment = doc.getXmlFragment(PROSEMIRROR_FRAGMENT_FIELD);
    const active = doc.getMap(MARKDOWN_MIRROR_FIELD).get(MIRROR_ACTIVE_KEY);
    if (active === false || !fragment.length || (active !== true && text)) return text;
    return normalizeSerializedMarkdown(
      ctx.get(serializerCtx)(fragmentToProsemirrorNode(fragment, ctx.get(schemaCtx))),
    );
  } finally {
    doc.destroy();
  }
}

export function applyRecoveredMarkdown(ctx: Ctx, markdown: string, replace: boolean): void {
  const view = ctx.get(editorViewCtx);
  if (view.isDestroyed || !view.editable) throw new Error("Editor is not editable");
  const doc = ctx.get(parserCtx)(markdown);
  if (!doc) throw new Error("Draft could not be parsed");
  const transaction = replace
    ? view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content)
    : view.state.tr.replaceSelection(new Slice(doc.content, 0, 0));
  view.dispatch(transaction.scrollIntoView());
  view.focus();
}
