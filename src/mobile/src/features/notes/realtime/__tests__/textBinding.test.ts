import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  getMarkdownYText,
  MARKDOWN_MIRROR_FIELD,
  MIRROR_ACTIVE_KEY,
  replaceMarkdownYText,
} from "@features/notes/realtime/markdown";
import {
  APPLY_COALESCE_MS,
  COMPOSITION_RECHECK_MS,
  createTextBinding,
  selectPushBase,
  TYPING_IDLE_MS,
  type TextBinding,
} from "@features/notes/realtime/textBinding";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

interface Harness {
  ydoc: Y.Doc;
  binding: TextBinding;
  /** What the screen would show: rebuilt by applyRemote, advanced by typing. */
  local: string;
  applied: string[];
  maps: ((index: number) => number)[];
  composing: boolean;
  live: boolean;
  doc: () => string;
  /** A native keystroke reaching JS: the text the input now holds. */
  type: (text: string) => void;
  settle: () => void;
}

async function bind(
  initial: string,
  options: { local?: string; loaded?: string | null } = {},
): Promise<Harness> {
  const ydoc = new Y.Doc();
  getMarkdownYText(ydoc).insert(0, initial);
  const harness = {
    ydoc,
    local: options.local ?? initial,
    applied: [] as string[],
    maps: [] as ((index: number) => number)[],
    composing: false,
    live: false,
  } as Harness;
  harness.binding = createTextBinding({
    ydoc,
    origin: "session",
    whenSynced: Promise.resolve(),
    callbacks: {
      getLocalCanonical: () => harness.local,
      getLoadedCanonical: () => options.loaded ?? null,
      applyRemote: (canonical, mapIndex) => {
        harness.local = canonical;
        harness.applied.push(canonical);
        harness.maps.push(mapIndex);
      },
      isComposing: () => harness.composing,
    },
    onLive: () => {
      harness.live = true;
    },
  });
  harness.doc = () => getMarkdownYText(ydoc).toString();
  harness.type = (text) => {
    harness.local = text;
    harness.binding.schedule(text);
    harness.binding.flush();
  };
  harness.settle = () => vi.advanceTimersByTime(APPLY_COALESCE_MS + TYPING_IDLE_MS);
  await Promise.resolve();
  expect(harness.live).toBe(true);
  return harness;
}

function peer(ydoc: Y.Doc, edit: (text: Y.Text) => void): void {
  ydoc.transact(() => edit(getMarkdownYText(ydoc)), "peer");
}

it("rebases typing after detach against the input base from the live session", async () => {
  const first = await bind("live base");
  first.type("live base edited");
  const loaded = first.binding.getInputBase();
  first.binding.dispose();
  const second = await bind("peer live base edited", {
    loaded,
    local: "live base edited while reconnecting",
  });
  expect(second.doc()).toBe("peer live base edited while reconnecting");
  second.binding.dispose();
  first.ydoc.destroy();
  second.ydoc.destroy();
});

it("keeps a peer insert when a keystroke typed before the rebuild arrives after it", async () => {
  const h = await bind("hello world");
  peer(h.ydoc, (t) => t.insert(0, "ZZ"));
  h.binding.applyNow();
  expect(h.applied).toEqual(["ZZhello world"]);
  // The native buffer still held the pre-rebuild text when the key landed.
  h.type("hello world!");
  expect(h.doc()).toBe("ZZhello world!");
  h.settle();
  expect(h.local).toBe("ZZhello world!");
});

it("keeps the pre-rebuild base across a push that changes nothing", async () => {
  const h = await bind("hello world");
  peer(h.ydoc, (t) => t.insert(0, "ZZ"));
  h.binding.applyNow();
  h.binding.schedule("ZZhello world");
  h.binding.flush();
  h.type("hello world!");
  expect(h.doc()).toBe("ZZhello world!");
});

it("treats a text equal to the pre-rebuild base as a delete of the peer insert", async () => {
  const h = await bind("hello");
  peer(h.ydoc, (t) => t.insert(5, "Z"));
  h.binding.applyNow();
  expect(h.local).toBe("helloZ");
  h.type("hello");
  expect(h.doc()).toBe("hello");
});

it("lands a keystroke between two non-adjacent peer edits", async () => {
  const h = await bind("AAAA\nBBBB\nCCCC");
  peer(h.ydoc, (t) => {
    t.insert(0, "x");
    t.insert(t.length, "y");
  });
  h.type("AAAA\nBBzBB\nCCCC");
  expect(h.doc()).toBe("xAAAA\nBBzBB\nCCCCy");
  h.settle();
  expect(h.local).toBe("xAAAA\nBBzBB\nCCCCy");
});

it("keeps a keystroke in place across a web-style span rewrite", async () => {
  const h = await bind("* item one\n\nsome text here\n\n* item two");
  replaceMarkdownYText(h.ydoc, "- item one\n\nsome text here\n\n- item two\n", Symbol("mirror"));
  h.type("* item one\n\nsome teXt here\n\n* item two");
  expect(h.doc()).toBe("- item one\n\nsome teXt here\n\n- item two\n");
  h.settle();
  expect(h.local).toBe(h.doc());
  const map = h.maps[0];
  expect(map(20)).toBe(20);
});

it("maps the caret through a multi-region rewrite", async () => {
  const h = await bind("a_b and c*d");
  replaceMarkdownYText(h.ydoc, "a\\_b and c\\*d", "peer");
  h.binding.applyNow();
  expect(h.applied).toEqual(["a\\_b and c\\*d"]);
  const map = h.maps[0];
  expect(map(0)).toBe(0);
  expect(map(4)).toBe(5);
  expect(map(9)).toBe(10);
  expect(map(11)).toBe(13);
});

it("keeps local and peer runs intact while both type before any rebuild", async () => {
  const h = await bind("AAAA BBBB");
  h.type("AAAAa BBBB");
  peer(h.ydoc, (t) => t.insert(t.length, "p"));
  h.type("AAAAab BBBB");
  peer(h.ydoc, (t) => t.insert(0, "q"));
  h.type("AAAAabc BBBB");
  expect(h.doc()).toBe("qAAAAabc BBBBp");
  h.settle();
  expect(h.local).toBe("qAAAAabc BBBBp");
  expect(h.maps[0](7)).toBe(8);
});

it("defers a rebuild while composing and lands it once composition ends", async () => {
  const h = await bind("hello");
  h.composing = true;
  peer(h.ydoc, (t) => t.insert(0, "Z"));
  vi.advanceTimersByTime(5000);
  expect(h.applied).toEqual([]);
  h.composing = false;
  vi.advanceTimersByTime(COMPOSITION_RECHECK_MS);
  expect(h.applied).toEqual(["Zhello"]);
});

it("applies on blur even while composing", async () => {
  const h = await bind("hello");
  h.composing = true;
  peer(h.ydoc, (t) => t.insert(0, "Z"));
  h.binding.applyNow();
  expect(h.applied).toEqual(["Zhello"]);
});

it("flushes a pending keystroke before applying a peer rebuild", async () => {
  const h = await bind("hello");
  h.local = "hello!";
  h.binding.schedule("hello!");
  peer(h.ydoc, (t) => t.insert(0, "Z"));
  h.binding.applyNow();
  expect(h.doc()).toBe("Zhello!");
  expect(h.applied).toEqual(["Zhello!"]);
});

it("clears the markdown mirror flag in the local transaction", async () => {
  const h = await bind("abc");
  h.ydoc.transact(() => h.ydoc.getMap(MARKDOWN_MIRROR_FIELD).set(MIRROR_ACTIVE_KEY, true), "web");
  h.type("abcd");
  expect(h.ydoc.getMap(MARKDOWN_MIRROR_FIELD).get(MIRROR_ACTIVE_KEY)).toBe(false);
  expect(h.doc()).toBe("abcd");
});

it("rebases pre-sync keystrokes from the loaded text onto the server text", async () => {
  const h = await bind("base text with peer", {
    local: "base text!",
    loaded: "base text",
  });
  expect(h.doc()).toBe("base text! with peer");
  h.settle();
  expect(h.local).toBe("base text! with peer");
});

it("shifts a local insert past a peer insert before it", async () => {
  const h = await bind("abc");
  peer(h.ydoc, (t) => t.insert(0, "ZZ"));
  h.type("abcd");
  expect(h.doc()).toBe("ZZabcd");
});

it("lands a local insert after a peer delete that spans it", async () => {
  const h = await bind("hello world");
  peer(h.ydoc, (t) => t.delete(3, 5));
  h.type("hello Xworld");
  expect(h.doc()).toBe("helXrld");
});

it("selects the base whose diff explains the input best", () => {
  const primary = { text: "ZZhello world", pending: [] };
  const stale = { text: "hello world", pending: [{ insert: "ZZ" }] };
  expect(selectPushBase("hello world!", primary, stale)?.base).toBe(stale);
  expect(selectPushBase("ZZhello world!", primary, stale)?.base).toBe(primary);
  expect(selectPushBase("ZZhello world", primary, stale)).toBeNull();
  expect(selectPushBase("hello world", primary, stale)?.base).toBe(primary);
  const tie = { text: "helloZ", pending: [] };
  expect(selectPushBase("helloY", tie, { text: "hello", pending: [] })?.base.text).toBe("hello");
  expect(selectPushBase("hellZ", tie, { text: "hello", pending: [] })?.base).toBe(tie);
});
