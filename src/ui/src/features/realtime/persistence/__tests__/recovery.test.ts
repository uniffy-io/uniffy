import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { openDB } from "idb";
import {
  installBrowser,
  signInDevice,
  storeRawRow,
  switchAccount,
} from "@/features/realtime/persistence/__tests__/browser";
import {
  attachEncryptedPersistence,
  discardRecoveredDraft,
  discoverStoredPendingDocs,
  getDeviceRecoveryState,
  HYDRATION_ORIGIN,
  MARKDOWN_MIRROR_ORIGIN,
  readRecoveredDrafts,
  REMOTE_ORIGIN,
} from "@/features/realtime/persistence/encryptedYjsPersistence";
import {
  DOC_GENERATION_KEY,
  DOC_META_FIELD,
  docGeneration,
} from "@/features/realtime/docGeneration";
import {
  clearPendingDocsFor,
  listPendingDocs,
  type PendingDoc,
} from "@/features/realtime/pendingDocs";
import { encryptForStorage, teardownStorageEncryption } from "@/shared/crypto/storageEncryption";

const DB_NAME = "uniffy-realtime-yjs";

beforeAll(() => installBrowser());

// One server document per generation and text, so every reopen sees the same server state.
const servers = new Map<string, Y.Doc>();

beforeEach(async () => {
  servers.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await signInDevice("alice");
  clearPendingDocsFor("alice");
  clearPendingDocsFor("bob");
});

afterEach(() => vi.restoreAllMocks());

afterAll(() => teardownStorageEncryption());

function scopeFor(contentId: string, overrides: Partial<PendingDoc> = {}): PendingDoc {
  return {
    contentType: "TASK",
    contentId,
    organizationId: "org-1",
    userId: "alice",
    discardOnClean: false,
    ...overrides,
  };
}

function serverDoc(generation: string, text: string): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap(DOC_META_FIELD).set(DOC_GENERATION_KEY, generation);
  doc.getText("markdown").insert(0, text);
  return doc;
}

async function openUnder(generation: string, text: string, contentId = "task") {
  const key = `${generation}:${text}`;
  const server = servers.get(key) ?? serverDoc(generation, text);
  servers.set(key, server);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(server), REMOTE_ORIGIN);
  const persistence = attachEncryptedPersistence({ contentType: "TASK", contentId, ydoc: doc });
  await persistence.hydrate({ serverGeneration: generation });
  return { doc, persistence };
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function storedKeys(): Promise<string[][]> {
  const db = await openDB(DB_NAME, 4);
  const keys = (await db.getAllKeys("updates")) as string[][];
  db.close();
  return keys;
}

describe("realtime local recovery", () => {
  it("records an edit for discovery before any checkpoint and stops counting it once checkpointed", async () => {
    const doc = new Y.Doc();
    doc.getMap("doc_meta").set("generation", "g");
    let checkpointed = true;
    const persistence = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "crash",
      ydoc: doc,
      scope: scopeFor("crash"),
      isCheckpointed: () => checkpointed,
    });
    doc.getText("markdown").insert(0, "first offline edit");
    checkpointed = false;
    await persistence.flush();
    expect(await discoverStoredPendingDocs("alice")).toBe(true);
    expect(await discoverStoredPendingDocs("bob")).toBe(false);
    checkpointed = true;
    await persistence.markCheckpointed();
    expect(await discoverStoredPendingDocs("alice")).toBe(false);
    await persistence.destroy({ checkpointed: true });
    doc.destroy();
  });

  it("keeps an uncheckpointed close dirty after the transport detached", async () => {
    const doc = new Y.Doc();
    const persistence = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "detach",
      ydoc: doc,
      isCheckpointed: () => true,
    });
    doc.getText("markdown").insert(0, "pending");
    await persistence.destroy();
    expect(await discoverStoredPendingDocs("alice")).toBe(true);
    doc.destroy();
  });

  it("replays matching generation updates after server hydration", async () => {
    const server = serverDoc("same", "baseline");
    const local = new Y.Doc();
    Y.applyUpdate(local, Y.encodeStateAsUpdate(server), REMOTE_ORIGIN);
    const cached = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "task",
      ydoc: local,
    });
    await cached.hydrate({ serverGeneration: docGeneration(local) });
    local.getText("markdown").insert(8, " offline edit");
    await cached.destroy();

    const reopened = new Y.Doc();
    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(server), REMOTE_ORIGIN);
    const recovery = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "task",
      ydoc: reopened,
    });
    await recovery.hydrate({ serverGeneration: docGeneration(reopened) });
    expect(reopened.getText("markdown").toString()).toBe("baseline offline edit");
    await recovery.destroy({ discard: true });
    local.destroy();
    reopened.destroy();
    server.destroy();
  });

  it("retains a mismatched cache without merging its metadata or fragment", async () => {
    const stale = new Y.Doc();
    stale.clientID = 4294967294;
    const cached = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "task",
      ydoc: stale,
    });
    stale.getMap(DOC_META_FIELD).set(DOC_GENERATION_KEY, "old");
    stale.getMap("markdown_mirror").set("active", true);
    stale.getXmlFragment("prosemirror").insert(0, [new Y.XmlText("old blocks")]);
    await cached.destroy();

    const server = serverDoc("new", "new column");
    server.clientID = 1;
    const reopened = new Y.Doc();
    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(server), REMOTE_ORIGIN);
    const recovery = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "task",
      ydoc: reopened,
    });
    await recovery.hydrate({ serverGeneration: docGeneration(reopened) });
    expect(docGeneration(reopened)).toBe("new");
    expect(reopened.getText("markdown").toString()).toBe("new column");
    expect(reopened.getXmlFragment("prosemirror").length).toBe(0);
    expect(reopened.getMap("markdown_mirror").get("active")).toBeUndefined();
    expect((await readRecoveredDrafts(reopened)).map((draft) => draft.generation)).toEqual(["old"]);
    await recovery.destroy({ discard: true });
    stale.destroy();
    reopened.destroy();
    server.destroy();
  });

  it("replays an offline fragment and flushed markdown after disposal", async () => {
    const doc = new Y.Doc();
    doc.getMap(DOC_META_FIELD).set(DOC_GENERATION_KEY, "offline-generation");
    const persistence = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "task",
      ydoc: doc,
    });
    await persistence.hydrate();
    const fragment = doc.getXmlFragment("prosemirror");
    const paragraph = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    paragraph.insert(0, [text]);
    fragment.insert(0, [paragraph]);
    text.insert(0, "offline edits");
    doc.transact(() => doc.getText("markdown").insert(0, "offline edits"), MARKDOWN_MIRROR_ORIGIN);
    await persistence.destroy();
    doc.destroy();

    const reopened = new Y.Doc();
    const recovery = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "task",
      ydoc: reopened,
    });
    await recovery.hydrate();
    expect(docGeneration(reopened)).toBe("offline-generation");
    expect(reopened.getText("markdown").toString()).toBe("offline edits");
    expect(reopened.getXmlFragment("prosemirror").toString()).toContain("offline edits");
    await recovery.destroy();
    reopened.destroy();
  });

  it("discards the local cache on a clean close instead of compacting it", async () => {
    const doc = new Y.Doc();
    const persistence = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "task",
      ydoc: doc,
    });
    await persistence.hydrate();
    doc.getText("markdown").insert(0, "synced edits");
    await persistence.destroy({ discard: true });
    doc.destroy();

    const reopened = new Y.Doc();
    const recovery = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "task",
      ydoc: reopened,
    });
    await recovery.hydrate();
    expect(reopened.getText("markdown").toString()).toBe("");
    await recovery.destroy();
    reopened.destroy();
  });

  it("hydrates a fast reopen only after the previous session's final write lands", async () => {
    const first = new Y.Doc();
    const persistence = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "task",
      ydoc: first,
    });
    first.getText("markdown").insert(0, "last characters");
    const closed = persistence.destroy();
    expect(persistence.destroy()).toBe(closed);
    const second = new Y.Doc();
    const reopened = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "task",
      ydoc: second,
    });
    await reopened.hydrate();
    expect(second.getText("markdown").toString()).toBe("last characters");
    await Promise.all([closed, reopened.destroy()]);
    first.destroy();
    second.destroy();
  });

  it("keeps another tab's unseen rows through a clean close", async () => {
    const first = new Y.Doc();
    first.getMap(DOC_META_FIELD).set(DOC_GENERATION_KEY, "same");
    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    const left = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "tabs",
      ydoc: first,
    });
    const right = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "tabs",
      ydoc: second,
    });
    await left.hydrate({ serverGeneration: "same" });
    await right.hydrate({ serverGeneration: "same" });
    second.getText("markdown").insert(0, "unseen offline work");
    await right.destroy();
    await left.destroy({ discard: true });
    const reopened = new Y.Doc();
    const recovery = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "tabs",
      ydoc: reopened,
    });
    await recovery.hydrate({ serverGeneration: "same" });
    expect(reopened.getText("markdown").toString()).toBe("unseen offline work");
    await recovery.destroy();
    first.destroy();
    second.destroy();
    reopened.destroy();
  });

  it("does not combine different generations during offline replay", async () => {
    for (const generation of ["first", "second"]) {
      const doc = new Y.Doc();
      const persistence = attachEncryptedPersistence({
        contentType: "TASK",
        contentId: "epochs",
        ydoc: doc,
      });
      doc.getMap(DOC_META_FIELD).set(DOC_GENERATION_KEY, generation);
      doc.getText("markdown").insert(0, generation);
      await persistence.destroy();
      doc.destroy();
    }
    const doc = new Y.Doc();
    const persistence = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "epochs",
      ydoc: doc,
    });
    await persistence.hydrate();
    expect(doc.getText("markdown").toString()).toBe("");
    await persistence.destroy({ discard: true });
    doc.getMap(DOC_META_FIELD).set(DOC_GENERATION_KEY, "third");
    const drafts = await readRecoveredDrafts(doc);
    expect(drafts.map((draft) => draft.text).sort()).toEqual(["first", "second"]);
    doc.destroy();
  });

  it("writes no row for a session closed before its first sync", async () => {
    const doc = new Y.Doc();
    const persistence = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "task",
      ydoc: doc,
    });
    await persistence.destroy();
    doc.destroy();
    expect(await discoverStoredPendingDocs("alice")).toBe(false);

    const { doc: next, persistence: reopened } = await openUnder("G", "server text");
    expect(await readRecoveredDrafts(next)).toEqual([]);
    await reopened.destroy({ discard: true });
    next.destroy();
  });

  it("leaves no draft behind a new device key", async () => {
    const { doc, persistence } = await openUnder("G", "baseline");
    doc.getText("markdown").insert(8, " offline work");
    await persistence.destroy();
    doc.destroy();
    expect(await discoverStoredPendingDocs("alice")).toBe(true);

    await signInDevice("alice");
    const { doc: later, persistence: reopened } = await openUnder("H", "replacement");
    expect(await readRecoveredDrafts(later)).toEqual([]);
    await reopened.destroy({ discard: true });
    later.destroy();
  });

  it("offers no draft for a session that only seeded, normalized and mirrored", async () => {
    const { doc, persistence } = await openUnder("G", "server text");
    const fragment = doc.getXmlFragment("prosemirror");
    doc.transact(() => {
      const paragraph = new Y.XmlElement("paragraph");
      const text = new Y.XmlText();
      paragraph.insert(0, [text]);
      fragment.insert(0, [paragraph]);
      text.insert(0, "server text");
    }, HYDRATION_ORIGIN);
    // ySyncPlugin writeback of a trailing empty paragraph carries a persisted origin.
    doc.transact(() => fragment.insert(fragment.length, [new Y.XmlElement("paragraph")]), "ysync");
    doc.transact(() => doc.getMap("markdown_mirror").set("active", true), MARKDOWN_MIRROR_ORIGIN);
    expect(persistence.isDirty()).toBe(false);
    await persistence.destroy();
    doc.destroy();

    const { doc: later, persistence: reopened } = await openUnder("H", "replacement");
    expect(await readRecoveredDrafts(later)).toEqual([]);
    await reopened.destroy({ discard: true });
    later.destroy();
  });

  it("offers a typed session as a draft and discards it on request", async () => {
    const { doc, persistence } = await openUnder("G", "server text");
    doc.transact(() => doc.getText("markdown").insert(11, " typed by me"), "session-id");
    expect(persistence.isDirty()).toBe(true);
    await persistence.destroy();
    doc.destroy();

    const { doc: later, persistence: reopened } = await openUnder("H", "replacement");
    const drafts = await readRecoveredDrafts(later);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ generation: "G", text: "server text typed by me" });

    await discardRecoveredDraft(later, "G");
    expect(await readRecoveredDrafts(later)).toEqual([]);
    expect((await storedKeys()).some((key) => key[2] === "G")).toBe(false);
    await reopened.destroy({ discard: true });
    later.destroy();
  });

  it("hides recovery until the current generation is known", async () => {
    const { doc, persistence } = await openUnder("G", "server text");
    doc.getText("markdown").insert(11, " local");
    await persistence.destroy();
    const pending = new Y.Doc();
    const reopened = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "task",
      ydoc: pending,
    });
    expect(await readRecoveredDrafts(pending)).toEqual([]);
    pending.getMap(DOC_META_FIELD).set(DOC_GENERATION_KEY, "H");
    expect((await readRecoveredDrafts(pending)).map((draft) => draft.text)).toEqual([
      "server text local",
    ]);
    await reopened.destroy({ discard: true });
    pending.destroy();
    doc.destroy();
  });

  it("never lists a draft whose text is empty", async () => {
    const { doc, persistence } = await openUnder("G", "server text");
    doc.transact(() => doc.getText("markdown").delete(0, 11), "session-id");
    expect(persistence.isDirty()).toBe(true);
    await persistence.destroy();
    doc.destroy();

    const { doc: later, persistence: reopened } = await openUnder("H", "replacement");
    expect(await readRecoveredDrafts(later)).toEqual([]);
    await reopened.destroy({ discard: true });
    later.destroy();
  });

  it("keeps a checkpointed close as a cache, never as a draft", async () => {
    const { doc, persistence } = await openUnder("G", "server text");
    doc.transact(() => doc.getText("markdown").insert(11, " synced later"), "session-id");
    await persistence.destroy({ checkpointed: true });
    doc.destroy();
    expect(await discoverStoredPendingDocs("alice")).toBe(false);

    const { doc: cached, persistence: same } = await openUnder("G", "server text");
    expect(cached.getText("markdown").toString()).toBe("server text synced later");
    await same.destroy({ checkpointed: true });
    cached.destroy();

    const { doc: later, persistence: reopened } = await openUnder("H", "replacement");
    expect(await readRecoveredDrafts(later)).toEqual([]);
    await reopened.destroy({ discard: true });
    later.destroy();
  });

  it("does not recreate an explicitly discarded recovery copy on close", async () => {
    const { doc, persistence } = await openUnder("discard-rejected", "server text");
    doc.getText("markdown").insert(11, " oversized draft");
    await persistence.quarantine();
    const [draft] = await readRecoveredDrafts(doc);
    expect(draft.text).toContain("oversized draft");
    await discardRecoveredDraft(doc, draft.generation);
    await persistence.destroy();
    expect(await readRecoveredDrafts(doc)).toEqual([]);
    expect((await storedKeys()).some((key) => key[2] === draft.generation)).toBe(false);
    doc.destroy();
  });

  it("isolates a rejected seed branch without losing edits or replaying it into the current generation", async () => {
    const doc = new Y.Doc();
    doc.getMap(DOC_META_FIELD).set(DOC_GENERATION_KEY, "server");
    const persistence = attachEncryptedPersistence({
      contentType: "NOTE",
      contentId: "rejected-seed",
      ydoc: doc,
    });
    doc.getText("markdown").insert(0, "typing attached to rejected seed");
    expect(await persistence.quarantine()).toBe(true);
    await persistence.destroy();
    const fresh = new Y.Doc();
    const next = attachEncryptedPersistence({
      contentType: "NOTE",
      contentId: "rejected-seed",
      ydoc: fresh,
    });
    await next.hydrate();
    expect(fresh.getText("markdown").toString()).toBe("");
    fresh.getMap(DOC_META_FIELD).set(DOC_GENERATION_KEY, "server");
    fresh.getText("markdown").insert(0, "accepted peer document");
    await next.hydrate({ serverGeneration: "server" });
    expect(fresh.getText("markdown").toString()).toBe("accepted peer document");
    const drafts = await readRecoveredDrafts(fresh);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].text).toBe("typing attached to rejected seed");
    await discardRecoveredDraft(fresh, drafts[0].generation);
    expect(await readRecoveredDrafts(fresh)).toEqual([]);
    await next.destroy();
    doc.destroy();
    fresh.destroy();
  });

  it("never shows one account's in-memory recovery copy to another account", async () => {
    const doc = new Y.Doc();
    doc.getMap(DOC_META_FIELD).set(DOC_GENERATION_KEY, "server");
    const persistence = attachEncryptedPersistence({
      contentType: "NOTE",
      contentId: "rejected-copy",
      ydoc: doc,
    });
    doc.getText("markdown").insert(0, "alice's rejected typing");
    await persistence.quarantine();
    await persistence.destroy();

    await signInDevice("bob");
    const other = new Y.Doc();
    other.getMap(DOC_META_FIELD).set(DOC_GENERATION_KEY, "server");
    const otherPersistence = attachEncryptedPersistence({
      contentType: "NOTE",
      contentId: "rejected-copy",
      ydoc: other,
    });
    expect(await readRecoveredDrafts(other)).toEqual([]);
    await otherPersistence.destroy();
    other.destroy();
    doc.destroy();
  });
});

describe("rows without coverage identity", () => {
  it("never replays, offers or drains them, dirty or clean, in any generation", async () => {
    const stale = serverDoc("G", "typed without coverage");
    const update = toBase64(Y.encodeStateAsUpdate(stale));
    const scope = scopeFor("task");
    await storeRawRow(
      ["TASK", "task", "G", "old-tab:0000000001"],
      await encryptForStorage({ update, dirty: true, scope }),
    );
    await storeRawRow(
      ["TASK", "task", "G", "old-tab:0000000002"],
      await encryptForStorage({ update, dirty: false, scope }),
    );
    await storeRawRow(["TASK", "task", "F", "old-tab:0000000001"], await encryptForStorage(update));
    await storeRawRow(["TASK", "task", "old-tab:0000000001"], await encryptForStorage(update));

    const { doc, persistence } = await openUnder("G", "server text");
    expect(doc.getText("markdown").toString()).toBe("server text");
    expect(await readRecoveredDrafts(doc)).toEqual([]);
    expect(await discoverStoredPendingDocs("alice")).toBe(false);
    expect(listPendingDocs()).toEqual([]);
    await persistence.destroy({ discard: true, checkpointed: true });
    doc.destroy();
    stale.destroy();
  });
});

describe("device storage boundaries", () => {
  it("rolls back an interrupted write so the previous device copy survives", async () => {
    const { doc, persistence } = await openUnder("G", "server text", "interrupted");
    doc.transact(() => doc.getText("markdown").insert(11, " kept"), "session-id");
    await persistence.flush();
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    doc.transact(() => doc.getText("markdown").insert(16, " lost"), "session-id");
    await persistence.flush();
    expect(getDeviceRecoveryState("TASK:interrupted")).toEqual({
      storage: "failed",
      unpersisted: true,
    });
    put.mockRestore();

    const { doc: reopened, persistence: recovery } = await openUnder(
      "G",
      "server text",
      "interrupted",
    );
    expect(reopened.getText("markdown").toString()).toBe("server text kept");
    await recovery.destroy();
    await persistence.destroy();
    reopened.destroy();
    doc.destroy();
  });

  it("records each organization's pending docs under that organization and ignores other users", async () => {
    const owners: [string, string, string][] = [
      ["alice", "org-1", "first-org"],
      ["alice", "org-2", "second-org"],
      ["bob", "org-1", "bobs"],
    ];
    for (const [userId, organizationId, contentId] of owners) {
      switchAccount(userId, organizationId);
      const doc = serverDoc("G", "server text");
      const persistence = attachEncryptedPersistence({
        contentType: "TASK",
        contentId,
        ydoc: doc,
        scope: scopeFor(contentId, { userId, organizationId }),
      });
      doc.transact(() => doc.getText("markdown").insert(0, "draft "), "session-id");
      await persistence.destroy();
      doc.destroy();
    }
    switchAccount("alice", "org-1");
    clearPendingDocsFor("alice");
    clearPendingDocsFor("bob");

    expect(await discoverStoredPendingDocs("alice")).toBe(true);
    expect(
      listPendingDocs()
        .map((entry) => [entry.contentId, entry.organizationId, entry.userId])
        .sort(),
    ).toEqual([
      ["first-org", "org-1", "alice"],
      ["second-org", "org-2", "alice"],
    ]);
  });
});
