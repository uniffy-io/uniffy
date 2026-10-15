import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  attachEncryptedPersistence,
  discoverStoredPendingDocs,
  discardRecoveredDraft,
  HYDRATION_ORIGIN,
  MARKDOWN_MIRROR_ORIGIN,
  readRecoveredDrafts,
  REMOTE_ORIGIN,
  persistenceRecoveryStats,
} from "@/features/realtime/persistence/encryptedYjsPersistence";
import {
  DOC_GENERATION_KEY,
  DOC_META_FIELD,
  docGeneration,
} from "@/features/realtime/docGeneration";

const storage = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  encryptGate: Promise.resolve(),
  version: 2,
  // Blobs remember the DEK that wrote them; any other DEK fails like AES-GCM would.
  currentKey: "dek-1",
  userId: "alice",
}));
vi.mock("@/app/storeRef", () => ({
  getStoreRef: () => ({ getState: () => ({ auth: { user: { id: storage.userId } } }) }),
}));
vi.mock("@/shared/crypto/storageEncryption", () => ({
  registerEncryptedDatabase: vi.fn(),
  isStorageEncryptionReady: () => true,
  encryptForStorage: async (value: unknown) => {
    await storage.encryptGate;
    return { key: storage.currentKey, payload: value };
  },
  decryptFromStorage: async (blob: { key?: string; payload?: unknown }) => {
    if (!blob || blob.key !== storage.currentKey) throw new Error("decrypt failed");
    return blob.payload;
  },
  ENCRYPTION_REKEY_EVENT: "rekey",
  ENCRYPTION_TEARDOWN_EVENT: "teardown",
}));
vi.mock("idb", () => ({
  openDB: async (_dbName: string, version: number, options: { upgrade: (db: unknown) => void }) => {
    if (storage.version < version) {
      options.upgrade({
        objectStoreNames: ["updates"],
        deleteObjectStore: () => storage.rows.clear(),
        createObjectStore: () => {},
      });
      storage.version = version;
    }
    const matching = (range?: { lower: string[] }) =>
      [...storage.rows.keys()]
        .map((key) => JSON.parse(key) as string[])
        .filter((key) => !range || (key[0] === range.lower[0] && key[1] === range.lower[1]));
    const put = async (_name: string, value: unknown, key: unknown) =>
      storage.rows.set(JSON.stringify(key), value);
    return {
      put,
      transaction: () => ({
        done: Promise.resolve(),
        objectStore: () => ({
          getAllKeys: async (range?: { lower: string[] }) => matching(range),
          getAll: async (range?: { lower: string[] }) =>
            matching(range).map((key) => storage.rows.get(JSON.stringify(key))),
          delete: async (key: unknown) => storage.rows.delete(JSON.stringify(key)),
          put: (value: unknown, key: unknown) => put("updates", value, key),
        }),
      }),
    };
  },
}));

describe("realtime local recovery", () => {
  beforeEach(() => {
    storage.rows.clear();
    storage.encryptGate = Promise.resolve();
    storage.currentKey = "dek-1";
    storage.userId = "alice";
    persistenceRecoveryStats.generationMismatchRows = 0;
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("IDBKeyRange", { bound: (lower: unknown) => ({ lower }) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("discovers the first dirty edit without cleanup and clears only after ACK", async () => {
    const doc = new Y.Doc();
    doc.getMap("doc_meta").set("generation", "g");
    let acknowledged = true;
    const persistence = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "crash",
      ydoc: doc,
      scope: {
        contentType: "TASK",
        contentId: "crash",
        organizationId: "org",
        userId: "alice",
        discardOnClean: false,
      },
      isAcknowledged: () => acknowledged,
    });
    doc.getText("markdown").insert(0, "first offline edit");
    acknowledged = false;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await discoverStoredPendingDocs("alice")).toBe(true);
    expect(await discoverStoredPendingDocs("other")).toBe(false);
    acknowledged = true;
    await persistence.acknowledge();
    expect(await discoverStoredPendingDocs("alice")).toBe(false);
    await persistence.destroy({ acknowledged: true });
    doc.destroy();
  });

  it("does not mark an unacknowledged close clean after transport detach", async () => {
    const doc = new Y.Doc();
    const persistence = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "detach",
      ydoc: doc,
      isAcknowledged: () => true,
    });
    doc.getText("markdown").insert(0, "pending");
    await persistence.destroy();
    expect([...storage.rows.values()].some((blob: any) => blob.payload.dirty)).toBe(true);
    doc.destroy();
  });

  it("preserves rows without generation during schema upgrade", async () => {
    storage.rows.set(JSON.stringify(["TASK", "task", "legacy:1"]), "legacy-row");
    const doc = new Y.Doc();
    const persistence = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "task",
      ydoc: doc,
    });
    await persistence.hydrate({ serverGeneration: "current" });
    expect(storage.version).toBe(3);
    expect(storage.rows.size).toBe(1);
    await persistence.destroy({ discard: true });
    doc.destroy();
  });

  it("replays matching generation updates after server hydration", async () => {
    const server = new Y.Doc();
    server.getMap(DOC_META_FIELD).set(DOC_GENERATION_KEY, "same");
    server.getText("markdown").insert(0, "baseline");
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
    expect(persistenceRecoveryStats.generationMismatchRows).toBe(0);
    await recovery.destroy({ discard: true });
    local.destroy();
    reopened.destroy();
    server.destroy();
  });

  it("retains mismatched cache without merging its LWW metadata or fragment", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
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

    const server = new Y.Doc();
    server.clientID = 1;
    server.getMap(DOC_META_FIELD).set(DOC_GENERATION_KEY, "new");
    server.getText("markdown").insert(0, "new column");
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
    expect(storage.rows.size).toBe(1);
    expect(persistenceRecoveryStats.generationMismatchRows).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(
      "[realtime] retained recovery rows from another generation",
      {
        docKey: "TASK:task",
        rows: 1,
      },
    );
    await recovery.destroy({ discard: true });
    stale.destroy();
    reopened.destroy();
    server.destroy();
  });

  it("replays offline fragment and flushed markdown after disposal", async () => {
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

  it("clean close discards the local cache instead of compacting it", async () => {
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
    expect([...storage.rows.keys()].some((key) => key.includes('"task"'))).toBe(false);

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

  it("fast reopen waits for previous pending writes and final snapshot", async () => {
    let finishEncryption!: () => void;
    storage.encryptGate = new Promise<void>((resolve) => {
      finishEncryption = resolve;
    });
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
    let hydrated = false;
    const hydration = reopened.hydrate().then(() => {
      hydrated = true;
    });
    await Promise.resolve();
    expect(hydrated).toBe(false);
    finishEncryption();
    await Promise.all([closed, hydration]);
    expect(second.getText("markdown").toString()).toBe("last characters");
    await reopened.destroy();
    first.destroy();
    second.destroy();
  });
  it("clean close preserves unseen updates from another tab", async () => {
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
    expect(storage.rows.size).toBe(2);
    await persistence.destroy({ discard: true });
    expect(storage.rows.size).toBe(2);
    doc.destroy();
  });

  function serverDoc(generation: string, text: string): Y.Doc {
    const doc = new Y.Doc();
    doc.getMap(DOC_META_FIELD).set(DOC_GENERATION_KEY, generation);
    doc.getText("markdown").insert(0, text);
    return doc;
  }

  function rowKeys(): string[][] {
    return [...storage.rows.keys()].map((key) => JSON.parse(key) as string[]);
  }

  async function openUnder(generation: string, text: string) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(serverDoc(generation, text)), REMOTE_ORIGIN);
    const persistence = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "task",
      ydoc: doc,
    });
    await persistence.hydrate({ serverGeneration: generation });
    return { doc, persistence };
  }

  it("writes no row for a session closed before its first sync", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = new Y.Doc();
    const persistence = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "task",
      ydoc: doc,
    });
    await persistence.destroy();
    doc.destroy();
    expect(storage.rows.size).toBe(0);

    const { doc: next, persistence: reopened } = await openUnder("G", "server text");
    expect(await readRecoveredDrafts(next)).toEqual([]);
    await reopened.destroy({ discard: true });
    next.destroy();
  });

  it("offers no draft for rows written under a lost DEK", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { doc, persistence } = await openUnder("G", "baseline");
    doc.getText("markdown").insert(8, " offline work");
    await persistence.destroy();
    doc.destroy();
    expect(storage.rows.size).toBeGreaterThan(0);

    storage.currentKey = "dek-2";
    const { doc: later, persistence: reopened } = await openUnder("H", "replacement");
    expect(persistenceRecoveryStats.generationMismatchRows).toBeGreaterThan(0);
    expect(await readRecoveredDrafts(later)).toEqual([]);
    await reopened.destroy({ discard: true });
    later.destroy();
  });

  it("offers no draft for a session that only seeded, normalized and mirrored", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
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
    expect(storage.rows.size).toBeGreaterThan(0);

    const { doc: later, persistence: reopened } = await openUnder("H", "replacement");
    expect(await readRecoveredDrafts(later)).toEqual([]);
    await reopened.destroy({ discard: true });
    later.destroy();
  });

  it("offers a typed session as a draft and discards it on request", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
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
    expect(rowKeys().some((key) => key[2] === "G")).toBe(false);
    expect(await readRecoveredDrafts(later)).toEqual([]);
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
    vi.spyOn(console, "warn").mockImplementation(() => {});
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

  it("keeps an acknowledged close as a cache row, never as a draft", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { doc, persistence } = await openUnder("G", "server text");
    doc.transact(() => doc.getText("markdown").insert(11, " synced later"), "session-id");
    await persistence.destroy({ acknowledged: true });
    doc.destroy();
    expect(rowKeys().filter((key) => key[2] === "G")).toHaveLength(1);

    const { doc: later, persistence: reopened } = await openUnder("H", "replacement");
    expect(await readRecoveredDrafts(later)).toEqual([]);
    await reopened.destroy({ discard: true });
    later.destroy();
  });

  it("does not recreate an explicitly discarded active recovery copy on close", async () => {
    const { doc, persistence } = await openUnder("discard-rejected", "server text");
    doc.getText("markdown").insert(11, " oversized draft");
    await persistence.quarantine();
    const [draft] = await readRecoveredDrafts(doc);
    expect(draft.text).toContain("oversized draft");
    await discardRecoveredDraft(doc, draft.generation);
    await persistence.destroy();
    expect(rowKeys().some((key) => key[2] === draft.generation)).toBe(false);
    expect(await readRecoveredDrafts(doc)).toEqual([]);
    doc.destroy();
  });

  it("isolates a rejected seed branch without losing edits or replaying it into current generation", async () => {
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
    storage.userId = "bob";
    storage.currentKey = "bob-key";
    const other = new Y.Doc();
    other.getMap(DOC_META_FIELD).set(DOC_GENERATION_KEY, "server");
    const otherPersistence = attachEncryptedPersistence({
      contentType: "NOTE",
      contentId: "rejected-seed",
      ydoc: other,
    });
    expect(await readRecoveredDrafts(other)).toEqual([]);
    await otherPersistence.destroy();
    other.destroy();
    storage.userId = "alice";
    storage.currentKey = "dek-1";
    await discardRecoveredDraft(fresh, drafts[0].generation);
    expect(await readRecoveredDrafts(fresh)).toEqual([]);
    await next.destroy();
    doc.destroy();
    fresh.destroy();
  });
});
