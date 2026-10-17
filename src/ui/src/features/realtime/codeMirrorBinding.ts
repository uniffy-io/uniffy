import { Annotation, Transaction, type ChangeSpec, type TransactionSpec } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";
import * as Y from "yjs";
import { MARKDOWN_MIRROR_FIELD, MIRROR_ACTIVE_KEY } from "@/features/realtime/markdown";

export const remoteMarkdownChange = Annotation.define<boolean>();

export function bindCodeMirrorMarkdown(
  view: { dispatch(spec: TransactionSpec): void },
  text: Y.Text,
  sessionId: string,
) {
  const observe = (event: Y.YTextEvent) => {
    if (event.transaction.origin === sessionId) return;
    let position = 0;
    const changes: ChangeSpec[] = [];
    for (const delta of event.delta) {
      if (delta.retain) position += delta.retain;
      if (delta.delete) {
        changes.push({ from: position, to: position + delta.delete });
        position += delta.delete;
      }
      if (typeof delta.insert === "string") changes.push({ from: position, insert: delta.insert });
    }
    view.dispatch({
      changes,
      annotations: [remoteMarkdownChange.of(true), Transaction.addToHistory.of(false)],
    });
  };
  text.observe(observe);
  return () => text.unobserve(observe);
}

export function applyCodeMirrorMarkdown(
  update: Pick<ViewUpdate, "transactions">,
  text: Y.Text,
  sessionId: string,
) {
  const doc = text.doc;
  if (!doc) return;
  for (const transaction of update.transactions) {
    if (!transaction.docChanged || transaction.annotation(remoteMarkdownChange)) continue;
    const changes: { from: number; to: number; insert: string }[] = [];
    transaction.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      changes.push({ from, to, insert: inserted.toString() });
    });
    doc.transact(() => {
      doc.getMap(MARKDOWN_MIRROR_FIELD).set(MIRROR_ACTIVE_KEY, false);
      for (const change of changes.reverse()) {
        if (change.to > change.from) text.delete(change.from, change.to - change.from);
        if (change.insert) text.insert(change.from, change.insert);
      }
    }, sessionId);
  }
}
