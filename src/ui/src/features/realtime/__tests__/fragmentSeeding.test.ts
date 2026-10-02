import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Schema } from "@milkdown/prose/model";
import {
  observeFragmentSeedDuplicates,
  seedProsemirrorFragment,
  SEEDED_BY_KEY,
  waitForFragmentSeed,
} from "@/features/realtime/fragmentSeeding";
import { getProsemirrorFragment, MARKDOWN_MIRROR_FIELD } from "@/features/realtime/markdown";

const schema = new Schema({
  nodes: { doc: { content: "block+" }, paragraph: { group: "block", content: "text*" }, text: {} },
});
const node = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("seed text")])]);

describe("fragment seed arbitration", () => {
  it.each([true, false])("heals concurrent seeds regardless of merge order: %s", (lowerFirst) => {
    const lower = new Y.Doc();
    const higher = new Y.Doc();
    lower.clientID = 10;
    higher.clientID = 20;
    const stopLower = observeFragmentSeedDuplicates(lower);
    const stopHigher = observeFragmentSeedDuplicates(higher);
    seedProsemirrorFragment(lower, node);
    seedProsemirrorFragment(higher, node);
    const lowerUpdate = Y.encodeStateAsUpdate(lower);
    const higherUpdate = Y.encodeStateAsUpdate(higher);
    if (lowerFirst) {
      Y.applyUpdate(higher, lowerUpdate);
      Y.applyUpdate(lower, higherUpdate);
    } else {
      Y.applyUpdate(lower, higherUpdate);
      Y.applyUpdate(higher, lowerUpdate);
    }
    Y.applyUpdate(lower, Y.encodeStateAsUpdate(higher));
    Y.applyUpdate(higher, Y.encodeStateAsUpdate(lower));
    for (const doc of [lower, higher]) {
      expect(getProsemirrorFragment(doc).length).toBe(1);
      expect(getProsemirrorFragment(doc).toString()).toBe("<paragraph>seed text</paragraph>");
      expect(doc.getMap(MARKDOWN_MIRROR_FIELD).get(SEEDED_BY_KEY)).toBe(10);
    }
    stopLower();
    stopHigher();
    lower.destroy();
    higher.destroy();
  });

  it("deletes only its seed blocks and preserves later local and peer blocks", () => {
    const lower = new Y.Doc();
    const higher = new Y.Doc();
    lower.clientID = 10;
    higher.clientID = 20;
    const stop = observeFragmentSeedDuplicates(higher);
    seedProsemirrorFragment(lower, node);
    seedProsemirrorFragment(higher, node);
    higher.getXmlFragment("prosemirror").insert(1, [new Y.XmlText("later local block")]);
    Y.applyUpdate(higher, Y.encodeStateAsUpdate(lower));
    expect(higher.getXmlFragment("prosemirror").toString()).toContain("later local block");
    expect(
      higher
        .getXmlFragment("prosemirror")
        .toString()
        .match(/seed text/g),
    ).toHaveLength(1);
    stop();
    lower.destroy();
    higher.destroy();
  });

  it("seeds blocks and marker in one transaction", () => {
    const doc = new Y.Doc();
    const transactions: Y.Transaction[] = [];
    doc.on("afterTransaction", (transaction: Y.Transaction) => {
      if (transaction.changed.size > 0) transactions.push(transaction);
    });
    seedProsemirrorFragment(doc, node);
    expect(transactions).toHaveLength(1);
    expect(doc.getMap(MARKDOWN_MIRROR_FIELD).get(SEEDED_BY_KEY)).toBe(doc.clientID);
    doc.destroy();
  });

  it.each([true, false])("preserves edits inside a duplicate seed block: %s", (lowerFirst) => {
    const lower = new Y.Doc();
    const higher = new Y.Doc();
    lower.clientID = 10;
    higher.clientID = 20;
    const stop = observeFragmentSeedDuplicates(higher);
    seedProsemirrorFragment(lower, node);
    seedProsemirrorFragment(higher, node);
    const paragraph = getProsemirrorFragment(higher).get(0) as Y.XmlElement;
    (paragraph.get(0) as Y.XmlText).insert(9, " later typing");
    if (!lowerFirst) Y.applyUpdate(lower, Y.encodeStateAsUpdate(higher));
    Y.applyUpdate(higher, Y.encodeStateAsUpdate(lower));
    Y.applyUpdate(lower, Y.encodeStateAsUpdate(higher));
    expect(getProsemirrorFragment(lower).toString()).toContain("later typing");
    expect(getProsemirrorFragment(higher).toString()).toContain("later typing");
    stop();
    lower.destroy();
    higher.destroy();
  });

  it("wakes on transferred server role and removes its subscriptions", async () => {
    const doc = new Y.Doc();
    let listener: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const role = {
      isFragmentSeeder: false,
      subscribeFragmentSeeder: (callback: () => void) => {
        listener = callback;
        return unsubscribe;
      },
    };
    const waiting = waitForFragmentSeed(getProsemirrorFragment(doc), role);
    role.isFragmentSeeder = true;
    listener?.();
    await waiting;
    expect(unsubscribe).toHaveBeenCalledOnce();
    doc.destroy();
  });

  it("waits for peer content and releases subscriptions on cancellation", async () => {
    const doc = new Y.Doc();
    const role = { isFragmentSeeder: false, subscribeFragmentSeeder: () => () => {} };
    const waiting = waitForFragmentSeed(getProsemirrorFragment(doc), role);
    seedProsemirrorFragment(doc, node);
    await waiting;
    const empty = new Y.Doc();
    const controller = new AbortController();
    const unsubscribe = vi.fn();
    const cancelled = waitForFragmentSeed(
      getProsemirrorFragment(empty),
      {
        ...role,
        subscribeFragmentSeeder: () => unsubscribe,
      },
      controller.signal,
    );
    controller.abort();
    await cancelled;
    expect(unsubscribe).toHaveBeenCalledOnce();
    doc.destroy();
    empty.destroy();
  });
});
