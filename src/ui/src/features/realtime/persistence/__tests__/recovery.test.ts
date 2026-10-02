import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  attachEncryptedPersistence,
  MARKDOWN_MIRROR_ORIGIN,
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
}));
vi.mock("@/shared/crypto/storageEncryption", () => ({
  registerEncryptedDatabase: vi.fn(),
  isStorageEncryptionReady: () => true,
  encryptForStorage: async (value: unknown) => {
    await storage.encryptGate;
    return value;
  },
  decryptFromStorage: async (value: unknown) => value,
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
    const matching = (range: { lower: string[] }) =>
      [...storage.rows.keys()]
        .map((key) => JSON.parse(key) as string[])
        .filter((key) => key[0] === range.lower[0] && key[1] === range.lower[1]);
    const put = async (_name: string, value: unknown, key: unknown) =>
      storage.rows.set(JSON.stringify(key), value);
    return {
      put,
      transaction: () => ({
        done: Promise.resolve(),
        objectStore: () => ({
          getAllKeys: async (range: { lower: string[] }) => matching(range),
          getAll: async (range: { lower: string[] }) =>
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
    persistenceRecoveryStats.generationMismatchRows = 0;
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("IDBKeyRange", { bound: (lower: unknown) => ({ lower }) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
    stale.getMap(DOC_META_FIELD).set(DOC_GENERATION_KEY, "old");
    stale.getMap("markdown_mirror").set("active", true);
    stale.getXmlFragment("prosemirror").insert(0, [new Y.XmlText("old blocks")]);
    const cached = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "task",
      ydoc: stale,
    });
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
      doc.getMap(DOC_META_FIELD).set(DOC_GENERATION_KEY, generation);
      doc.getText("markdown").insert(0, generation);
      await attachEncryptedPersistence({
        contentType: "TASK",
        contentId: "epochs",
        ydoc: doc,
      }).destroy();
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
});
