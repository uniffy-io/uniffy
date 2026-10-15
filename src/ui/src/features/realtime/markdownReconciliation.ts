import { diffChars } from "diff";
import type { Node } from "@milkdown/prose/model";
import type * as Y from "yjs";
import {
  getMarkdownYText,
  getProsemirrorFragment,
  MARKDOWN_MIRROR_FIELD,
  MARKDOWN_MIRROR_ORIGIN,
  MIRROR_ACTIVE_KEY,
  replaceMarkdownYText,
  replaceProsemirrorFragment,
} from "@/features/realtime/markdown";
import { diffStrings } from "@/features/realtime/textDiff";
import { HYDRATION_ORIGIN } from "@/features/realtime/persistence/encryptedYjsPersistence";

interface TextEdit {
  start: number;
  end: number;
  insert: string;
}

function edits(base: string, next: string): TextEdit[] {
  const changes = diffChars(base, next, { maxEditLength: 512 });
  if (!changes) {
    // Bound diff work for unrelated large documents without dropping either writer's insertions.
    const change = diffStrings(base, next);
    return change
      ? [{ start: change.index, end: change.index + change.deleteCount, insert: change.insert }]
      : [];
  }
  const result: TextEdit[] = [];
  let offset = 0;
  for (const change of changes) {
    if (change.added) {
      const previous = result.at(-1);
      if (previous && previous.end === offset) previous.insert += change.value;
      else result.push({ start: offset, end: offset, insert: change.value });
    } else {
      if (change.removed)
        result.push({ start: offset, end: offset + change.value.length, insert: "" });
      offset += change.value.length;
    }
  }
  return result;
}

export function mergeMarkdownEdits(base: string, rich: string, incoming: string): string {
  if (rich === incoming || rich === base) return incoming;
  if (incoming === base) return rich;
  const all = [...edits(base, rich), ...edits(base, incoming)].sort((a, b) => a.start - b.start);
  let offset = 0;
  const output: string[] = [];
  const seen = new Set<string>();
  for (const edit of all) {
    const key = JSON.stringify(edit);
    if (seen.has(key)) continue;
    seen.add(key);
    if (edit.start > offset) output.push(base.slice(offset, edit.start));
    output.push(edit.insert);
    offset = Math.max(offset, edit.end);
  }
  output.push(base.slice(offset));
  return output.join("");
}

interface MarkdownCodec {
  parse: (markdown: string) => Node | null;
  serialize: (node: Node) => string;
  read: () => Node;
}

export class MarkdownReconciler {
  private observed: string;
  private pendingBase: string | null = null;

  constructor(
    private readonly doc: Y.Doc,
    private readonly codec: MarkdownCodec,
  ) {
    this.observed = getMarkdownYText(doc).toString();
  }

  bindLocalMirror(ready: () => boolean): () => void {
    const fragment = getProsemirrorFragment(this.doc);
    let mirroring = false;
    const observe = (_events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => {
      if (
        mirroring ||
        !ready() ||
        !transaction.local ||
        transaction.origin === HYDRATION_ORIGIN ||
        transaction.origin === MARKDOWN_MIRROR_ORIGIN
      )
        return;
      mirroring = true;
      try {
        this.flush();
      } finally {
        mirroring = false;
      }
    };
    fragment.observeDeep(observe);
    return () => fragment.unobserveDeep(observe);
  }

  observe(internal: boolean, ready: boolean): void {
    if (!ready || internal) this.pendingBase = null;
    else if (this.pendingBase === null) this.pendingBase = this.observed;
    this.observed = getMarkdownYText(this.doc).toString();
  }

  reconcile(): boolean {
    if (this.pendingBase === null) return true;
    const incoming = getMarkdownYText(this.doc).toString();
    const baseNode = this.codec.parse(this.pendingBase);
    const incomingNode = this.codec.parse(incoming);
    if (!baseNode || !incomingNode) return false;
    const rich = this.codec.serialize(this.codec.read());
    const projectedIncoming = this.codec.serialize(incomingNode);
    const merged = mergeMarkdownEdits(this.codec.serialize(baseNode), rich, projectedIncoming);
    const node = merged === projectedIncoming ? incomingNode : this.codec.parse(merged);
    if (!node) return false;
    this.pendingBase = null;
    this.doc.transact(() => {
      replaceProsemirrorFragment(this.doc, node, HYDRATION_ORIGIN);
      if (merged !== projectedIncoming) {
        replaceMarkdownYText(this.doc, merged, MARKDOWN_MIRROR_ORIGIN);
      }
      this.doc.getMap(MARKDOWN_MIRROR_FIELD).set(MIRROR_ACTIVE_KEY, true);
    }, HYDRATION_ORIGIN);
    return true;
  }

  pendingMarkdown(): string | null {
    if (!this.reconcile()) return null;
    const rich = this.codec.serialize(this.codec.read());
    const incoming = this.codec.parse(getMarkdownYText(this.doc).toString());
    // Merely opening rich mode must not rewrite a peer's source formatting.
    if (incoming && this.codec.serialize(incoming) === rich) return null;
    return rich;
  }

  flush(): void {
    const markdown = this.pendingMarkdown();
    if (markdown !== null) replaceMarkdownYText(this.doc, markdown, MARKDOWN_MIRROR_ORIGIN);
  }
}
