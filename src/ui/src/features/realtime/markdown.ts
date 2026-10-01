import * as Y from "yjs";
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import { diffStrings } from "@/features/realtime/textDiff";
import { editorViewCtx, serializerCtx } from "@milkdown/core";
import type { Ctx } from "@milkdown/ctx";
import type { Node } from "@milkdown/prose/model";
import { MARKDOWN_MIRROR_ORIGIN } from "@/features/realtime/persistence/encryptedYjsPersistence";

export const MARKDOWN_TEXT_FIELD = "markdown";
export const PROSEMIRROR_FRAGMENT_FIELD = "prosemirror";
export const MARKDOWN_MIRROR_FIELD = "markdown_mirror";
export const MIRROR_ACTIVE_KEY = "active";

// Origin for the editor's Y.Text("markdown") mirror. Lives in the persistence
// module because IDB writes filter on it; editor code imports it from here.
export { MARKDOWN_MIRROR_ORIGIN } from "@/features/realtime/persistence/encryptedYjsPersistence";

export function getMarkdownYText(ydoc: Y.Doc): Y.Text {
  return ydoc.get(MARKDOWN_TEXT_FIELD, Y.Text);
}

export function getProsemirrorFragment(ydoc: Y.Doc): Y.XmlFragment {
  return ydoc.get(PROSEMIRROR_FRAGMENT_FIELD, Y.XmlFragment);
}

/**
 * True when the fragment holds user-visible content. ySyncPlugin writes one
 * empty paragraph into an empty fragment on bind, so a bare length check
 * mistakes that placeholder for real content.
 */
export function fragmentHasRealContent(fragment: Y.XmlFragment): boolean {
  return fragment.toArray().some(xmlNodeHasContent);
}

function xmlNodeHasContent(node: Y.XmlElement | Y.XmlText | Y.XmlHook): boolean {
  if (node instanceof Y.XmlText) return node.length > 0;
  if (node instanceof Y.XmlElement) {
    if (node.nodeName !== "paragraph") return true;
    return node.toArray().some(xmlNodeHasContent);
  }
  return true;
}

/** Resolves true once the fragment holds real content, false when the timeout elapses first. */
export function waitForFragmentContent(
  fragment: Y.XmlFragment,
  timeoutMs: number,
): Promise<boolean> {
  if (fragmentHasRealContent(fragment)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      fragment.unobserveDeep(observer);
      if (timer) clearTimeout(timer);
    };
    const observer = () => {
      if (!fragmentHasRealContent(fragment)) return;
      cleanup();
      resolve(true);
    };
    fragment.observeDeep(observer);
    timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
  });
}

/** Minimal-delta write keeps the Yjs update proportional to the edit, not the doc. */
export function replaceMarkdownYText(ydoc: Y.Doc, next: string, origin: unknown): void {
  const ytext = getMarkdownYText(ydoc);
  const delta = diffStrings(ytext.toString(), next);
  if (!delta) return;
  ydoc.transact(() => {
    if (delta.deleteCount > 0) ytext.delete(delta.index, delta.deleteCount);
    if (delta.insert.length > 0) ytext.insert(delta.index, delta.insert);
    ydoc.getMap(MARKDOWN_MIRROR_FIELD).set(MIRROR_ACTIVE_KEY, origin === MARKDOWN_MIRROR_ORIGIN);
  }, origin);
}

export function isMarkdownMirrorLeader(awareness: {
  clientID: number;
  getStates: () => Map<number, { markdownEditor?: string }>;
}): boolean {
  for (const [clientId, state] of awareness.getStates()) {
    if (state.markdownEditor && clientId < awareness.clientID) return false;
  }
  return true;
}

/**
 * Rebuilds the fragment from a ProseMirror node in one transaction so
 * ySyncPlugin peers see a single replace instead of a delete then a grow.
 */
export function replaceProsemirrorFragment(ydoc: Y.Doc, node: Node, origin: unknown): void {
  const fragment = getProsemirrorFragment(ydoc);
  ydoc.transact(() => {
    if (fragment.length > 0) fragment.delete(0, fragment.length);
    prosemirrorToYXmlFragment(node, fragment);
  }, origin);
}

export function serializeEditorMarkdown(ctx: Ctx): string {
  const view = ctx.get(editorViewCtx);
  const serializer = ctx.get(serializerCtx);
  return normalizeSerializedMarkdown(serializer(view.state.doc as Node));
}

export function normalizeSerializedMarkdown(markdown: string): string {
  // Milkdown appends one document terminator. Preserve content whitespace.
  return markdown.endsWith("\n") ? markdown.slice(0, -1) : markdown;
}

/** Cold-start hydration when PG has content but no snapshot blob. */
export function seedFragmentFromProsemirror(fragment: Y.XmlFragment, doc: Node): void {
  prosemirrorToYXmlFragment(doc, fragment);
}

export function fragmentToProsemirrorNode(
  fragment: Y.XmlFragment,
  schema: Parameters<typeof yXmlFragmentToProseMirrorRootNode>[1],
): Node {
  return yXmlFragmentToProseMirrorRootNode(fragment, schema) as Node;
}
