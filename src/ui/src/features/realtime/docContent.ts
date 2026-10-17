import * as Y from "yjs";

export const MARKDOWN_TEXT_FIELD = "markdown";
export const PROSEMIRROR_FRAGMENT_FIELD = "prosemirror";
export const MARKDOWN_MIRROR_FIELD = "markdown_mirror";
export const MIRROR_ACTIVE_KEY = "active";

/**
 * True when the fragment holds user-visible content. ySyncPlugin writes one
 * empty paragraph into an empty fragment on bind, so a bare length check
 * mistakes that placeholder for real content.
 */
export function fragmentHasRealContent(fragment: Y.XmlFragment): boolean {
  return fragment.toArray().some(xmlNodeHasContent);
}

export function xmlNodeHasContent(node: Y.XmlElement | Y.XmlText | Y.XmlHook): boolean {
  if (node instanceof Y.XmlText) return node.length > 0;
  if (node instanceof Y.XmlElement) {
    if (node.nodeName !== "paragraph") return true;
    return node.toArray().some(xmlNodeHasContent);
  }
  return true;
}

// Editor normalizations (a trailing empty paragraph, metadata maps) are not user
// edits; the projection ignores them so only content changes count as a draft.
const DERIVED_ROOTS = new Set(["doc_meta", MARKDOWN_MIRROR_FIELD]);
const PROJECTED_ROOTS = new Set([MARKDOWN_TEXT_FIELD, PROSEMIRROR_FRAGMENT_FIELD]);

export function contentProjection(ydoc: Y.Doc): string {
  const blocks = ydoc
    .get(PROSEMIRROR_FRAGMENT_FIELD, Y.XmlFragment)
    .toArray()
    .filter(xmlNodeHasContent)
    .map((node) => node.toString())
    .join("");
  return `${ydoc.get(MARKDOWN_TEXT_FIELD, Y.Text).toString()}\u0000${blocks}`;
}

function rootNameOf(
  ydoc: Y.Doc,
  type: Y.AbstractType<Y.YEvent<Y.AbstractType<unknown>>>,
): string | null {
  let root: Y.AbstractType<unknown> = type as Y.AbstractType<unknown>;
  while (root.parent) root = root.parent as Y.AbstractType<unknown>;
  for (const [name, shared] of ydoc.share) if (shared === root) return name;
  return null;
}

/** Shared roots outside the text projection that a transaction changed, metadata excluded (canvas maps, for example). */
export function changedUnprojectedRoots(ydoc: Y.Doc, transaction: Y.Transaction): boolean {
  for (const type of transaction.changedParentTypes.keys()) {
    const name = rootNameOf(ydoc, type);
    if (name === null || DERIVED_ROOTS.has(name) || PROJECTED_ROOTS.has(name)) continue;
    return true;
  }
  return false;
}
