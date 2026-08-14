import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import type { EditorView } from "@milkdown/prose/view";
import type { Node } from "@milkdown/prose/model";

export interface CommentAnchor {
  commentId: string;
  from: number;
  to: number;
  text: string;
  isResolved: boolean;
}

export const commentDecorationsKey = new PluginKey<DecorationSet>("commentDecorations");

interface CommentDecorationsMeta {
  anchors: CommentAnchor[];
  activeCommentId: string | null;
}

/** Module-level click handler, set once when the editor mounts. */
let _onCommentClick: ((commentId: string) => void) | undefined;

export function setCommentClickHandler(handler: (commentId: string) => void) {
  _onCommentClick = handler;
}

/** Push anchors and activeId into the plugin via a meta transaction; ProseMirror reconciles decorations from there. */
export function updateCommentDecorations(
  view: EditorView,
  anchors: CommentAnchor[],
  activeCommentId: string | null,
) {
  if (view.isDestroyed) return;
  const tr = view.state.tr.setMeta(commentDecorationsKey, { anchors, activeCommentId });
  view.dispatch(tr);
}

/** Inline decorations highlighting commented selections; mention chips render in comment bodies separately. */
export const commentDecorationsPlugin = $prose(() => {
  let currentAnchors: CommentAnchor[] = [];
  let currentActiveId: string | null = null;

  return new Plugin({
    key: commentDecorationsKey,
    state: {
      init(_, state) {
        return buildDecorations(state.doc, currentAnchors, currentActiveId);
      },
      apply(tr, oldDecorations, _oldState, newState) {
        const meta = tr.getMeta(commentDecorationsKey) as CommentDecorationsMeta | undefined;
        if (meta) {
          currentAnchors = meta.anchors;
          currentActiveId = meta.activeCommentId;
          return buildDecorations(newState.doc, currentAnchors, currentActiveId);
        }
        if (tr.docChanged) {
          return buildDecorations(newState.doc, currentAnchors, currentActiveId);
        }
        return oldDecorations;
      },
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
      handleClick(_view, _pos, event) {
        const target = event.target as HTMLElement;
        const highlight = target.closest?.("[data-comment-id]") as HTMLElement | null;
        if (highlight && _onCommentClick) {
          const commentId = highlight.getAttribute("data-comment-id");
          if (commentId) {
            _onCommentClick(commentId);
            return true;
          }
        }
        return false;
      },
    },
  });
});

function buildDecorations(
  doc: Node,
  anchors: CommentAnchor[],
  activeCommentId: string | null,
): DecorationSet {
  const decorations: Decoration[] = [];
  const docSize = doc.nodeSize - 2;

  for (const anchor of anchors) {
    if (anchor.isResolved) continue;

    let { from, to } = anchor;

    if (from < 0 || to < 0 || from >= docSize || to >= docSize || from >= to) {
      const found = findTextInDoc(doc, anchor.text);
      if (found) {
        from = found.from;
        to = found.to;
      } else {
        continue;
      }
    }

    const currentText = safeTextBetween(doc, from, to);
    if (currentText !== anchor.text && anchor.text) {
      const found = findTextInDoc(doc, anchor.text);
      if (found) {
        from = found.from;
        to = found.to;
      } else {
        continue;
      }
    }

    const isActive = anchor.commentId === activeCommentId;
    const className = isActive ? "comment-highlight active" : "comment-highlight";

    decorations.push(
      Decoration.inline(from, to, {
        class: className,
        "data-comment-id": anchor.commentId,
      }),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return DecorationSet.create(doc as any, decorations);
}

function safeTextBetween(doc: Node, from: number, to: number): string {
  try {
    const docSize = doc.nodeSize - 2;
    if (from < 0 || to < 0 || from > docSize || to > docSize) return "";
    return doc.textBetween(from, to);
  } catch {
    return "";
  }
}

function findTextInDoc(doc: Node, text: string): { from: number; to: number } | null {
  if (!text) return null;

  let found: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.isText && node.text) {
      const idx = node.text.indexOf(text);
      if (idx !== -1) {
        found = { from: pos + idx, to: pos + idx + text.length };
        return false;
      }
    }
  });

  return found;
}
