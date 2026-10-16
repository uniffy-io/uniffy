import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { ySyncPluginKey } from "y-prosemirror";
import { Clock, Container, Ctx } from "@milkdown/ctx";
import {
  Editor,
  config,
  init,
  parser,
  parserCtx,
  schema,
  schemaCtx,
  serializer,
  serializerCtx,
} from "@milkdown/core";
import {
  bulletListSchema,
  codeBlockSchema,
  docSchema,
  hardbreakSchema,
  headingIdGenerator,
  headingSchema,
  hrSchema,
  listItemSchema,
  orderedListSchema,
  paragraphSchema,
  strongSchema,
  textSchema,
} from "@milkdown/kit/preset/commonmark";
import type { Node } from "@milkdown/prose/model";
import { configureMarkdown, markdownPlugins } from "@/components/editor/plugins/markdown";
import {
  fragmentToProsemirrorNode,
  getMarkdownYText,
  getProsemirrorFragment,
  MARKDOWN_MIRROR_ORIGIN,
  normalizeSerializedMarkdown,
  replaceMarkdownYText,
  replaceProsemirrorFragment,
} from "@/features/realtime/markdown";
import { MarkdownReconciler } from "@/features/realtime/markdownReconciliation";
import {
  HYDRATION_ORIGIN,
  REMOTE_ORIGIN,
} from "@/features/realtime/persistence/encryptedYjsPersistence";

// Multiplexer batch window, a fast typist's key interval and the relay delay through one replica.
const BATCH_MS = 50;
const KEY_MS = 25;
const RELAY_MS = 10;

const ctx = new Ctx(new Container(), new Clock());
const disposers: (() => void | Promise<void>)[] = [];
const docs: Y.Doc[] = [];

beforeAll(async () => {
  // Milkdown's readiness timers use browser events even when only parsing Markdown.
  const target = new EventTarget();
  vi.stubGlobal("addEventListener", target.addEventListener.bind(target));
  vi.stubGlobal("removeEventListener", target.removeEventListener.bind(target));
  vi.stubGlobal("dispatchEvent", target.dispatchEvent.bind(target));
  const plugins = [
    init(Editor.make()),
    schema,
    parser,
    serializer,
    config((configCtx) => configureMarkdown(configCtx, false)),
    headingIdGenerator,
    ...[
      strongSchema,
      docSchema,
      textSchema,
      paragraphSchema,
      orderedListSchema,
      bulletListSchema,
      listItemSchema,
      hardbreakSchema,
      headingSchema,
      codeBlockSchema,
      hrSchema,
    ].flat(),
    ...markdownPlugins,
  ];
  const handlers = plugins.map((plugin) => plugin(ctx));
  const results = await Promise.all(handlers.map((handler) => handler()));
  for (const result of results) if (result) disposers.push(result);
});
afterAll(async () => {
  for (const dispose of disposers.reverse()) await dispose();
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.useRealTimers();
  docs.splice(0).forEach((doc) => doc.destroy());
});

const parse = (markdown: string) => ctx.get(parserCtx)(markdown);
const serialize = (node: Node) => normalizeSerializedMarkdown(ctx.get(serializerCtx)(node));
const read = (doc: Y.Doc) =>
  fragmentToProsemirrorNode(getProsemirrorFragment(doc), ctx.get(schemaCtx));
const rich = (doc: Y.Doc) => serialize(read(doc));
const text = (doc: Y.Doc) => getMarkdownYText(doc).toString();

function createDoc(clientID: number, source?: Y.Doc, initial = ""): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  docs.push(doc);
  if (source) Y.applyUpdate(doc, Y.encodeStateAsUpdate(source), REMOTE_ORIGIN);
  else {
    replaceMarkdownYText(doc, initial, MARKDOWN_MIRROR_ORIGIN);
    replaceProsemirrorFragment(doc, parse(initial)!, HYDRATION_ORIGIN);
  }
  return doc;
}

/** Relays each doc's local updates to its peers in multiplexer-sized batches and records the frames it sent. */
function connect(peers: Y.Doc[]): Map<Y.Doc, Uint8Array[]> {
  const sent = new Map<Y.Doc, Uint8Array[]>();
  for (const doc of peers) {
    const frames: Uint8Array[] = [];
    sent.set(doc, frames);
    let batch: Uint8Array[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE_ORIGIN) batch.push(update);
    });
    doc.on("afterAllTransactions", () => {
      if (!batch.length || timer) return;
      timer = setTimeout(() => {
        timer = null;
        const frame = Y.mergeUpdates(batch);
        batch = [];
        frames.push(frame);
        setTimeout(() => {
          for (const peer of peers) if (peer !== doc) Y.applyUpdate(peer, frame, REMOTE_ORIGIN);
        }, RELAY_MS);
      }, BATCH_MS);
    });
  }
  return sent;
}

/** Wires a reconciler the way the rich editor does: synchronous local mirror, leader-only projection and idle flush. */
function attachRichEditor(doc: Y.Doc, leader: boolean): void {
  const reconciler = new MarkdownReconciler(
    doc,
    { parse, serialize, read: () => read(doc) },
    () => leader,
  );
  let timer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let queued = false;
  const flush = () => {
    if (timer) clearTimeout(timer);
    if (maxTimer) clearTimeout(maxTimer);
    timer = maxTimer = null;
    if (leader) reconciler.flush();
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 250);
    maxTimer ??= setTimeout(flush, 2000);
  };
  getMarkdownYText(doc).observe((event) => {
    const internal =
      event.transaction.origin === MARKDOWN_MIRROR_ORIGIN ||
      event.transaction.origin === HYDRATION_ORIGIN;
    reconciler.observe(event.transaction, internal, true);
    if (!leader) return;
    if (internal) return schedule();
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      reconciler.reconcile();
    });
  });
  // The ProseMirror view re-renders, and reschedules the idle flush, on every fragment change.
  getProsemirrorFragment(doc).observeDeep(schedule);
  reconciler.bindLocalMirror(() => true);
}

/** One keystroke at the end of a paragraph, committed by y-prosemirror like a typed character. */
function typeRich(doc: Y.Doc, paragraph: number, character: string): void {
  const current = read(doc);
  const blocks: Node[] = [];
  current.forEach((block, _offset, index) => {
    blocks.push(
      index === paragraph
        ? block.type.create(null, block.type.schema.text(block.textContent + character))
        : block,
    );
  });
  replaceProsemirrorFragment(doc, current.type.create(null, blocks), ySyncPluginKey);
}

/** Enter at the end of the document: an empty paragraph, which Markdown does not hold yet. */
function appendRichParagraph(doc: Y.Doc): Y.XmlElement {
  const paragraph = new Y.XmlElement("paragraph");
  doc.transact(() => getProsemirrorFragment(doc).push([paragraph]), ySyncPluginKey);
  return paragraph;
}

/** One keystroke at the end of the writer's own paragraph, wherever peers' paragraphs put it. */
function typeInto(doc: Y.Doc, paragraph: Y.XmlElement, character: string): void {
  doc.transact(() => {
    let content = paragraph.get(0);
    if (!(content instanceof Y.XmlText)) {
      content = new Y.XmlText();
      paragraph.insert(0, [content]);
    }
    content.insert(content.length, character);
  }, ySyncPluginKey);
}

/** One keystroke at the end of a paragraph from a client that edits only Y.Text. */
function typeText(doc: Y.Doc, paragraph: number, character: string): void {
  const paragraphs = text(doc).split("\n\n");
  paragraphs[paragraph] += character;
  replaceMarkdownYText(doc, paragraphs.join("\n\n"), "mobile");
}

async function type(
  writer: (paragraph: number, character: string) => void,
  paragraph: number,
  sentence: string,
): Promise<void> {
  for (const character of sentence) {
    writer(paragraph, character);
    await vi.advanceTimersByTimeAsync(KEY_MS);
  }
}

/** Types several sentences at once, each writer offset within the keystroke interval. */
async function typeTogether(
  writers: [(paragraph: number, character: string) => void, number, string][],
): Promise<void> {
  const length = Math.max(...writers.map(([, , sentence]) => sentence.length));
  const step = KEY_MS / writers.length;
  for (let index = 0; index < length; index++) {
    for (const [writer, paragraph, sentence] of writers) {
      if (index < sentence.length) writer(paragraph, sentence[index]);
      await vi.advanceTimersByTimeAsync(step);
    }
  }
}

const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("markdown mirror convergence across batched peers", () => {
  it("leaves a remote rich writer's batched typing untouched on the idle leader", async () => {
    vi.useFakeTimers();
    const alice = createDoc(1, undefined, "Bob reply W4F1.");
    const bob = createDoc(2, alice);
    attachRichEditor(alice, true);
    attachRichEditor(bob, false);
    const sent = connect([alice, bob]);

    await type(
      (paragraph, character) => typeRich(bob, paragraph, character),
      0,
      " Echo probe. Second probe by Bob.",
    );
    await vi.advanceTimersByTimeAsync(3000);

    const expected = "Bob reply W4F1. Echo probe. Second probe by Bob.";
    for (const doc of [alice, bob]) {
      expect(text(doc)).toBe(expected);
      expect(rich(doc)).toBe(expected);
    }
    expect(sent.get(alice)).toHaveLength(0);
  });

  it("projects an external text client's typing into the fragment exactly once", async () => {
    vi.useFakeTimers();
    const alice = createDoc(1, undefined, "First paragraph.\n\nSecond paragraph.");
    const bob = createDoc(2, alice);
    const phone = createDoc(3, alice);
    attachRichEditor(alice, true);
    attachRichEditor(bob, false);
    const sent = connect([alice, bob, phone]);

    await type((paragraph, character) => typeText(phone, paragraph, character), 0, " Phone edit.");
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent.get(bob)).toHaveLength(0);
    await type((paragraph, character) => typeRich(bob, paragraph, character), 1, " Bob after.");
    await vi.advanceTimersByTimeAsync(3000);

    const expected = "First paragraph. Phone edit.\n\nSecond paragraph. Bob after.";
    for (const doc of [alice, bob, phone]) {
      expect(text(doc)).toBe(expected);
      expect(rich(doc)).toBe(expected);
    }
  });

  it("converges two rich writers typing at once with each insertion present once", async () => {
    vi.useFakeTimers();
    const alice = createDoc(1, undefined, "Alice line.\n\nBob line.");
    const bob = createDoc(2, alice);
    attachRichEditor(alice, true);
    attachRichEditor(bob, false);
    connect([alice, bob]);

    await typeTogether([
      [(paragraph, character) => typeRich(alice, paragraph, character), 0, " Alice types a probe."],
      [(paragraph, character) => typeRich(bob, paragraph, character), 1, " Bob types a probe too."],
    ]);
    await vi.advanceTimersByTimeAsync(3000);

    const expected = "Alice line. Alice types a probe.\n\nBob line. Bob types a probe too.";
    for (const doc of [alice, bob]) {
      expect(text(doc)).toBe(expected);
      expect(rich(doc)).toBe(expected);
      expect(occurrences(text(doc), "Alice types a probe.")).toBe(1);
      expect(occurrences(text(doc), "Bob types a probe too.")).toBe(1);
    }
  });

  it.each([
    ["before", 0, 1],
    ["after", 1, 0],
  ])(
    "converges an external text client typing in the paragraph %s a non-leader rich writer at the same time",
    async (_, phoneParagraph, bobParagraph) => {
      vi.useFakeTimers();
      const initial = "First paragraph.\n\nSecond paragraph.";
      const alice = createDoc(1, undefined, initial);
      const bob = createDoc(2, alice);
      const phone = createDoc(3, alice);
      attachRichEditor(alice, true);
      attachRichEditor(bob, false);
      connect([alice, bob, phone]);

      await typeTogether([
        [
          (paragraph, character) => typeText(phone, paragraph, character),
          phoneParagraph,
          " Phone edit.",
        ],
        [
          (paragraph, character) => typeRich(bob, paragraph, character),
          bobParagraph,
          " Bob after.",
        ],
      ]);
      await vi.advanceTimersByTimeAsync(3000);

      const paragraphs = initial.split("\n\n");
      paragraphs[phoneParagraph] += " Phone edit.";
      paragraphs[bobParagraph] += " Bob after.";
      const expected = paragraphs.join("\n\n");
      for (const doc of [alice, bob, phone]) {
        expect(text(doc)).toBe(expected);
        expect(rich(doc)).toBe(expected);
      }
    },
  );

  it("converges the leader, a non-leader and an external text client typing in their own paragraphs at once", async () => {
    vi.useFakeTimers();
    const alice = createDoc(1, undefined, "One.\n\nTwo.\n\nThree.");
    const bob = createDoc(2, alice);
    const phone = createDoc(3, alice);
    attachRichEditor(alice, true);
    attachRichEditor(bob, false);
    connect([alice, bob, phone]);

    await typeTogether([
      [(paragraph, character) => typeRich(alice, paragraph, character), 0, " Alice adds."],
      [(paragraph, character) => typeText(phone, paragraph, character), 2, " Phone adds."],
      [(paragraph, character) => typeRich(bob, paragraph, character), 1, " Bob adds."],
    ]);
    await vi.advanceTimersByTimeAsync(3000);

    const expected = "One. Alice adds.\n\nTwo. Bob adds.\n\nThree. Phone adds.";
    for (const doc of [alice, bob, phone]) {
      expect(text(doc)).toBe(expected);
      expect(rich(doc)).toBe(expected);
    }
  });

  it.each([
    ["the leader", 1, 2],
    ["a non-leader", 2, 1],
  ])(
    "keeps each line whole when %s appends a paragraph while the other types at the end",
    async (_, aliceClient, bobClient) => {
      vi.useFakeTimers();
      const alice = createDoc(aliceClient, undefined, "Base line one.");
      const bob = createDoc(bobClient, alice);
      attachRichEditor(alice, aliceClient < bobClient);
      attachRichEditor(bob, bobClient < aliceClient);
      connect([alice, bob]);

      const bobLine = appendRichParagraph(bob);
      await type((_paragraph, character) => typeInto(bob, bobLine, character), 0, "Bob con");
      const aliceLine = appendRichParagraph(alice);
      await typeTogether([
        [
          (_paragraph, character) => typeInto(alice, aliceLine, character),
          0,
          "Alice concurrent line.",
        ],
        [(_paragraph, character) => typeInto(bob, bobLine, character), 0, "current line."],
      ]);
      await vi.advanceTimersByTimeAsync(3000);

      const expected = "Base line one.\n\nBob concurrent line.\n\nAlice concurrent line.";
      for (const doc of [alice, bob]) {
        expect(rich(doc)).toBe(expected);
        expect(text(doc)).toBe(expected);
      }
    },
  );

  it("keeps each line whole when both writers press Enter at the end at once and type", async () => {
    vi.useFakeTimers();
    const alice = createDoc(1, undefined, "Base line one.");
    const bob = createDoc(2, alice);
    attachRichEditor(alice, true);
    attachRichEditor(bob, false);
    connect([alice, bob]);

    const aliceLine = appendRichParagraph(alice);
    const bobLine = appendRichParagraph(bob);
    await typeTogether([
      [
        (_paragraph, character) => typeInto(alice, aliceLine, character),
        0,
        "Alice concurrent line.",
      ],
      [(_paragraph, character) => typeInto(bob, bobLine, character), 0, "Bob concurrent line."],
    ]);
    await vi.advanceTimersByTimeAsync(3000);

    // Concurrent paragraphs at one position order by client, so Alice's comes first everywhere.
    const expected = "Base line one.\n\nAlice concurrent line.\n\nBob concurrent line.";
    for (const doc of [alice, bob]) {
      expect(rich(doc)).toBe(expected);
      expect(text(doc)).toBe(expected);
    }
  });

  it("keeps each line whole when an idle leader watches one writer append past another's typing", async () => {
    vi.useFakeTimers();
    const leader = createDoc(1, undefined, "Base line one.");
    const bob = createDoc(2, leader);
    const carol = createDoc(3, leader);
    attachRichEditor(leader, true);
    attachRichEditor(bob, false);
    attachRichEditor(carol, false);
    connect([leader, bob, carol]);

    const carolLine = appendRichParagraph(carol);
    await type((_paragraph, character) => typeInto(carol, carolLine, character), 0, "Carol con");
    const bobLine = appendRichParagraph(bob);
    await typeTogether([
      [(_paragraph, character) => typeInto(bob, bobLine, character), 0, "Bob concurrent line."],
      [(_paragraph, character) => typeInto(carol, carolLine, character), 0, "current line."],
    ]);
    await vi.advanceTimersByTimeAsync(3000);

    const expected = "Base line one.\n\nCarol concurrent line.\n\nBob concurrent line.";
    for (const doc of [leader, bob, carol]) {
      expect(rich(doc)).toBe(expected);
      expect(text(doc)).toBe(expected);
    }
  });
});
