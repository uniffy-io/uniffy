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
    // Only the leader projects external text; a second projection of the same text duplicates it.
    private readonly leader: () => boolean,
  ) {
    this.observed = getMarkdownYText(doc).toString();
  }

  bindLocalMirror(ready: () => boolean): () => void {
    const fragment = getProsemirrorFragment(this.doc);
    const text = getMarkdownYText(this.doc);
    let mirroring = false;
    // A non-leader's rich content before its own edit while external text awaits projection.
    const before = new WeakMap<Y.Transaction, string>();
    const capture = (transaction: Y.Transaction) => {
      if (
        mirroring ||
        !transaction.local ||
        this.pendingBase === null ||
        transaction.origin === HYDRATION_ORIGIN ||
        transaction.origin === MARKDOWN_MIRROR_ORIGIN ||
        !ready() ||
        this.leader()
      )
        return;
      before.set(transaction, this.codec.serialize(this.codec.read()));
    };
    const observe = (_events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => {
      if (mirroring || !ready()) return;
      if (!transaction.local) {
        // A peer's projection of the pending text change catches this fragment up.
        if (this.pendingBase !== null && this.fragmentMatches(text.toString()))
          this.pendingBase = null;
        return;
      }
      if (transaction.origin === HYDRATION_ORIGIN || transaction.origin === MARKDOWN_MIRROR_ORIGIN)
        return;
      const base = before.get(transaction);
      mirroring = true;
      try {
        // Mirror only this edit onto the text, which still holds the change the leader projects.
        if (base !== undefined) {
          const rich = this.codec.serialize(this.codec.read());
          replaceMarkdownYText(
            this.doc,
            mergeMarkdownEdits(base, rich, text.toString()),
            MARKDOWN_MIRROR_ORIGIN,
          );
        } else this.flush();
      } finally {
        mirroring = false;
      }
    };
    this.doc.on("beforeTransaction", capture);
    fragment.observeDeep(observe);
    return () => {
      this.doc.off("beforeTransaction", capture);
      fragment.unobserveDeep(observe);
    };
  }

  observe(internal: boolean, ready: boolean): void {
    const text = getMarkdownYText(this.doc).toString();
    // A rich writer's frame carries its fragment change and its mirror together. Merging that
    // text again counts its keystrokes twice wherever serializer and parser disagree, as they
    // do on a trailing space. A mirror write keeps the base while the fragment still lags.
    if (!ready || this.fragmentMatches(text)) this.pendingBase = null;
    else if (!internal && this.pendingBase === null) this.pendingBase = this.observed;
    this.observed = text;
  }

  private fragmentMatches(text: string): boolean {
    const rich = this.codec.serialize(this.codec.read());
    if (rich === text) return true;
    const node = this.codec.parse(text);
    return node !== null && this.codec.serialize(node) === rich;
  }

  // Serialized and parsed again, as the block reads once it round-trips through Markdown.
  private render(doc: Node, block: Node): string {
    const markdown = this.codec.serialize(doc.type.create(doc.attrs, block));
    const node = this.codec.parse(markdown);
    return node ? this.codec.serialize(node) : markdown;
  }

  // Parsing drops what Markdown cannot hold, such as the trailing space a peer is typing past.
  // Blocks that read the same keep the fragment's version, so the projection leaves them alone.
  private keepEquivalentBlocks(parsed: Node): Node {
    const current = this.codec.read();
    if (current.childCount !== parsed.childCount) return parsed;
    const blocks: Node[] = [];
    parsed.forEach((block, _offset, index) => {
      const existing = current.child(index);
      blocks.push(
        existing.eq(block) || this.render(current, existing) === this.render(parsed, block)
          ? existing
          : block,
      );
    });
    return parsed.type.create(parsed.attrs, blocks);
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
    const parsed = merged === projectedIncoming ? incomingNode : this.codec.parse(merged);
    if (!parsed) return false;
    const node = this.keepEquivalentBlocks(parsed);
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
    // A non-leader's text already holds its own edits, and the fragment lags until the leader
    // projects the external change.
    if (this.pendingBase !== null && !this.leader()) return null;
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
