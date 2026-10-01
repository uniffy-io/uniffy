import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  attachEncryptedPersistence,
  MARKDOWN_MIRROR_ORIGIN,
} from "@/features/realtime/persistence/encryptedYjsPersistence";

const storage = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  encryptGate: Promise.resolve(),
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
  openDB: async () => {
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
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("IDBKeyRange", { bound: (lower: unknown) => ({ lower }) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("replays offline fragment and flushed markdown after disposal", async () => {
    const doc = new Y.Doc();
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
});
