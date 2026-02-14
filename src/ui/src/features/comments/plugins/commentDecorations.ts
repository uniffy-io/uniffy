import { Plugin, PluginKey } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import type { Node } from '@milkdown/prose/model';

export interface CommentAnchor {
    commentId: string;
    from: number;
    to: number;
    text: string;
    isResolved: boolean;
}

const commentDecorationsKey = new PluginKey('commentDecorations');

/**
 * Create a ProseMirror plugin that highlights commented text selections.
 *
 * Takes a list of comment anchors and creates inline decorations for each.
 * Supports position validation and text fallback when positions drift.
 */
export function createCommentDecorationsPlugin(
    anchors: CommentAnchor[],
    activeCommentId: string | null,
    onCommentClick?: (commentId: string) => void,
) {
    return new Plugin({
        key: commentDecorationsKey,
        state: {
            init(_, state) {
                return buildDecorations(state.doc, anchors, activeCommentId);
            },
            apply(tr, oldDecorations, _oldState, newState) {
                if (tr.docChanged) {
                    return buildDecorations(newState.doc, anchors, activeCommentId);
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
                const highlight = target.closest?.('[data-comment-id]') as HTMLElement | null;
                if (highlight && onCommentClick) {
                    const commentId = highlight.getAttribute('data-comment-id');
                    if (commentId) {
                        onCommentClick(commentId);
                        return true;
                    }
                }
                return false;
            },
        },
    });
}

function buildDecorations(
    doc: Node,
    anchors: CommentAnchor[],
    activeCommentId: string | null,
): DecorationSet {
    const decorations: Decoration[] = [];
    const docSize = doc.nodeSize - 2; // Account for doc wrapper

    for (const anchor of anchors) {
        if (anchor.isResolved) continue;

        let { from, to } = anchor;

        // Validate positions are within document bounds
        if (from < 0 || to < 0 || from >= docSize || to >= docSize || from >= to) {
            // Try text fallback: search the document for the anchor text
            const found = findTextInDoc(doc, anchor.text);
            if (found) {
                from = found.from;
                to = found.to;
            } else {
                continue; // Skip this anchor
            }
        }

        // Verify text matches (positions may have shifted)
        const currentText = safeTextBetween(doc, from, to);
        if (currentText !== anchor.text && anchor.text) {
            // Text at position doesn't match, try text fallback
            const found = findTextInDoc(doc, anchor.text);
            if (found) {
                from = found.from;
                to = found.to;
            } else {
                continue;
            }
        }

        const isActive = anchor.commentId === activeCommentId;
        const className = isActive ? 'comment-highlight active' : 'comment-highlight';

        decorations.push(
            Decoration.inline(from, to, {
                class: className,
                'data-comment-id': anchor.commentId,
            })
        );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return DecorationSet.create(doc as any, decorations);
}

function safeTextBetween(
    doc: Node,
    from: number,
    to: number,
): string {
    try {
        const docSize = doc.nodeSize - 2;
        if (from < 0 || to < 0 || from > docSize || to > docSize) return '';
        return doc.textBetween(from, to);
    } catch {
        return '';
    }
}

function findTextInDoc(
    doc: Node,
    text: string,
): { from: number; to: number } | null {
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
