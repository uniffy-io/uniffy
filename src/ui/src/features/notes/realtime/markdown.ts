import * as Y from 'yjs';
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { editorViewCtx, serializerCtx } from '@milkdown/core';
import type { Ctx } from '@milkdown/ctx';
import type { Node } from '@milkdown/prose/model';

export const MARKDOWN_TEXT_FIELD = 'markdown';
export const PROSEMIRROR_FRAGMENT_FIELD = 'prosemirror';

export function getMarkdownYText(ydoc: Y.Doc): Y.Text {
  return ydoc.get(MARKDOWN_TEXT_FIELD, Y.Text);
}

export function getProsemirrorFragment(ydoc: Y.Doc): Y.XmlFragment {
  return ydoc.get(PROSEMIRROR_FRAGMENT_FIELD, Y.XmlFragment);
}

/**
 * Replace the contents of `Y.Text(markdown)` with `next` under a single
 * transact tagged with `origin`. Delete-then-insert is fine here: the
 * snapshot mirror is never re-rendered as ProseMirror.
 */
export function replaceMarkdownYText(
  ydoc: Y.Doc,
  next: string,
  origin: unknown,
): void {
  const ytext = getMarkdownYText(ydoc);
  const current = ytext.toString();
  if (current === next) return;
  ydoc.transact(() => {
    if (ytext.length > 0) ytext.delete(0, ytext.length);
    if (next.length > 0) ytext.insert(0, next);
  }, origin);
}

/** Serialize the current editor doc to markdown via Milkdown's serializer. */
export function serializeEditorMarkdown(ctx: Ctx): string {
  const view = ctx.get(editorViewCtx);
  const serializer = ctx.get(serializerCtx);
  return serializer(view.state.doc as Node);
}

/**
 * Seed an empty `Y.XmlFragment` from a parsed ProseMirror node. Used on
 * cold-start hydration when the note has content in PG but no snapshot
 * blob; the server hydrates from snapshot bytes when one is present.
 */
export function seedFragmentFromProsemirror(
  fragment: Y.XmlFragment,
  doc: Node,
): void {
  prosemirrorToYXmlFragment(doc, fragment);
}

export function fragmentToProsemirrorNode(
  fragment: Y.XmlFragment,
  schema: Parameters<typeof yXmlFragmentToProseMirrorRootNode>[1],
): Node {
  return yXmlFragmentToProseMirrorRootNode(fragment, schema) as Node;
}
