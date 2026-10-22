import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { openDB } from "idb";
import {
  installBrowser,
  signInDevice,
  storeRawRow,
  storedRowKeys,
  switchAccount,
} from "@/features/realtime/persistence/__tests__/browser";
import {
  attachEncryptedPersistence,
  discoverStoredPendingDocs,
  listStoredPendingOrganizations,
  purgeCleanSnapshots,
  readRecoveredDrafts,
  REMOTE_ORIGIN,
  ROW_FORMAT_VERSION,
} from "@/features/realtime/persistence/encryptedYjsPersistence";
import { DOC_GENERATION_KEY, DOC_META_FIELD } from "@/features/realtime/docGeneration";
import {
  clearPendingDocsFor,
  listPendingDocs,
  recordPendingDoc,
  type PendingDoc,
} from "@/features/realtime/pendingDocs";
import { hasUnsyncedEdits, listPendingOrganizations } from "@/features/realtime/unsyncedEdits";
import {
  encryptBytesForStorage,
  teardownStorageEncryption,
} from "@/shared/crypto/storageEncryption";

const GENERATION = "G";

beforeAll(() => installBrowser());

beforeEach(async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await signInDevice("alice");
  clearPendingDocsFor("alice");
  clearPendingDocsFor("bob");
});

afterEach(() => {
  switchAccount("alice", "org-1");
  vi.restoreAllMocks();
});

afterAll(() => teardownStorageEncryption());

function scopeFor(contentId: string, organizationId = "org-1", userId = "alice"): PendingDoc {
  return { contentType: "TASK", contentId, organizationId, userId, discardOnClean: false };
}

let server: Uint8Array | null = null;

/** The server's copy of every document here: its generation and nothing typed yet. */
function serverState(): Uint8Array {
  if (server) return server;
  const doc = new Y.Doc();
  doc.getMap(DOC_META_FIELD).set(DOC_GENERATION_KEY, GENERATION);
  server = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return server;
}

/** A session of one organization's tab, synced with the server. */
async function openIn(contentId: string, organizationId: string, options = { hydrate: true }) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, serverState(), REMOTE_ORIGIN);
  const persistence = attachEncryptedPersistence({
    contentType: "TASK",
    contentId,
    ydoc: doc,
    scope: scopeFor(contentId, organizationId),
  });
  if (options.hydrate) await persistence.hydrate({ serverGeneration: GENERATION });
  return {
    doc,
    persistence,
    text: () => doc.getText("markdown").toString(),
    type: (text: string) => doc.transact(() => doc.getText("markdown").insert(0, text), "session"),
    close: async (flags?: { checkpointed: boolean }) => {
      await persistence.destroy(flags);
      doc.destroy();
    },
  };
}

/** Typed and closed before any checkpoint, so the rows hold the only copy of the edit. */
async function closeWithEdit(contentId: string, text: string, organizationId = "org-1") {
  const session = await openIn(contentId, organizationId);
  session.type(text);
  await session.close();
}

/** Typed and closed with a checkpoint covering it: the rows are a cache of the server's copy. */
async function closeCheckpointed(contentId: string, organizationId = "org-1") {
  const session = await openIn(contentId, organizationId);
  session.type("saved");
  await session.close({ checkpointed: true });
}

/** What local recovery replays into a fresh session of the organization. */
async function replayedIn(contentId: string, organizationId: string): Promise<string> {
  const session = await openIn(contentId, organizationId);
  const text = session.text();
  await session.close();
  return text;
}

async function rawRows(contentId: string): Promise<{ key: string[]; value: unknown }[]> {
  const db = await openDB("uniffy-realtime-yjs", 4);
  const range = IDBKeyRange.bound(["TASK", contentId], ["TASK", contentId, []]);
  const [keys, values] = await Promise.all([
    db.getAllKeys("updates", range),
    db.getAll("updates", range),
  ]);
  db.close();
  return keys.map((key, index) => ({ key: key as string[], value: values[index] }));
}

/** A row as this device stored it before rows were bound: bare ciphertext of header and bytes. */
async function unboundRow(header: object, update: Uint8Array): Promise<ArrayBuffer> {
  const encoded = new TextEncoder().encode(JSON.stringify(header));
  const row = new Uint8Array(4 + encoded.length + update.length);
  new DataView(row.buffer).setUint32(0, encoded.length);
  row.set(encoded, 4);
  row.set(update, 4 + encoded.length);
  return encryptBytesForStorage(row);
}

/** An update typing `text` on top of the server's copy. */
function typedUpdate(text: string): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, serverState());
  const before = Y.encodeStateVector(doc);
  doc.getText("markdown").insert(0, text);
  const update = Y.encodeStateAsUpdate(doc, before);
  doc.destroy();
  return update;
}

describe("rows bound to their organization", () => {
  it("replays a document's rows only into a session of the organization that wrote them", async () => {
    await closeWithEdit("shared", "typed in org-1");
    const stored = await storedRowKeys("TASK", "shared");

    expect(await replayedIn("shared", "org-2")).toBe("");
    expect(await storedRowKeys("TASK", "shared")).toEqual(stored);
    expect(await replayedIn("shared", "org-1")).toBe("typed in org-1");
  });

  it("stores every row bound, so a copy relabelled to another organization or document fails to authenticate", async () => {
    await closeWithEdit("bound", "typed");
    const rows = await rawRows("bound");
    expect(rows.length).toBeGreaterThan(0);
    for (const { value } of rows)
      expect(value).toMatchObject({ version: ROW_FORMAT_VERSION, organizationId: "org-1" });

    for (const { key, value } of rows) {
      await storeRawRow(["TASK", "copied", ...key.slice(2)], value);
      await storeRawRow(key, { ...(value as object), organizationId: "org-2" });
    }
    expect(await discoverStoredPendingDocs("alice")).toBe(false);
    expect(await listStoredPendingOrganizations("alice")).toEqual([]);
    expect(await replayedIn("bound", "org-2")).toBe("");
    expect(await replayedIn("copied", "org-1")).toBe("");
  });

  it("reads rows stored before binding without additional data and rewrites them bound on compaction", async () => {
    const scope = scopeFor("unbound");
    await storeRawRow(
      ["TASK", "unbound", GENERATION, "old-tab:0000000001"],
      await unboundRow({ kind: "snapshot", dirty: true, scope }, typedUpdate("snapshot ")),
    );
    await storeRawRow(
      ["TASK", "unbound", GENERATION, "pending:old-tab:1"],
      await unboundRow(
        { kind: "pending", scope, updateId: "old-tab:1", editedAt: 1, receipt: null },
        typedUpdate("pending "),
      ),
    );
    expect(await discoverStoredPendingDocs("alice")).toBe(true);
    expect(await listStoredPendingOrganizations("alice")).toEqual(["org-1"]);

    const text = await replayedIn("unbound", "org-1");
    expect(text).toContain("snapshot ");
    expect(text).toContain("pending ");
    const rows = await rawRows("unbound");
    expect(rows.map(({ key }) => key[3])).toContain("pending:old-tab:1");
    expect(rows.map(({ key }) => key[3])).not.toContain("old-tab:0000000001");
    for (const { value } of rows)
      expect(value).toMatchObject({ version: ROW_FORMAT_VERSION, organizationId: "org-1" });
    expect(await replayedIn("unbound", "org-1")).toBe(text);
  });

  it("leaves a row stored before binding in another organization untouched", async () => {
    await storeRawRow(
      ["TASK", "foreign", GENERATION, "pending:old-tab:1"],
      await unboundRow(
        {
          kind: "pending",
          scope: scopeFor("foreign", "org-2"),
          updateId: "old-tab:1",
          editedAt: 1,
          receipt: null,
        },
        typedUpdate("typed in org-2 "),
      ),
    );
    const stored = await rawRows("foreign");

    expect(await replayedIn("foreign", "org-1")).toBe("");
    expect(await rawRows("foreign")).toEqual(stored);
    expect(await listStoredPendingOrganizations("alice")).toEqual(["org-2"]);
    expect(await replayedIn("foreign", "org-2")).toBe("typed in org-2 ");
  });
});

describe("recovered drafts and the unsynced count", () => {
  it("counts no account's work in a scope-less row stored before binding, yet offers it as a draft", async () => {
    await storeRawRow(
      ["TASK", "orphan", "recovery:old", "old-tab:0000000001"],
      await unboundRow({ kind: "snapshot", dirty: true }, typedUpdate("orphaned draft")),
    );
    expect(await discoverStoredPendingDocs("alice")).toBe(false);
    expect(await discoverStoredPendingDocs("bob")).toBe(false);
    expect(await listStoredPendingOrganizations("alice")).toEqual([]);

    const session = await openIn("orphan", "org-1");
    expect((await readRecoveredDrafts(session.doc)).map(({ text }) => text)).toEqual([
      "orphaned draft",
    ]);
    await session.close();
  });

  it("attributes a quarantined draft to its user and organization only", async () => {
    const session = await openIn("quarantined", "org-2");
    session.type("refused edit");
    expect(await session.persistence.quarantine()).toBe(true);
    await session.close();
    clearPendingDocsFor("alice");

    expect(await discoverStoredPendingDocs("alice")).toBe(true);
    expect(listPendingDocs()).toEqual([]);
    expect(await discoverStoredPendingDocs("bob")).toBe(false);
    expect(await listStoredPendingOrganizations("alice")).toEqual(["org-2"]);
    for (const { key, value } of await rawRows("quarantined")) {
      expect(key[2]).toMatch(/^recovery:/);
      expect(value).toMatchObject({ organizationId: "org-2" });
    }
  });

  it("names every organization holding the user's unsynced edits and filters the live check by organization", async () => {
    await closeWithEdit("stored", "typed", "org-1");
    clearPendingDocsFor("alice");
    recordPendingDoc(scopeFor("waiting", "org-3"));

    expect((await listPendingOrganizations("alice")).sort()).toEqual(["org-1", "org-3"]);
    expect(await listPendingOrganizations("bob")).toEqual([]);
    expect(hasUnsyncedEdits("alice")).toBe(true);
    expect(hasUnsyncedEdits("alice", "org-3")).toBe(true);
    expect(hasUnsyncedEdits("alice", "org-1")).toBe(false);
    expect(hasUnsyncedEdits("bob")).toBe(false);
  });
});

describe("a lost organization", () => {
  it("purges only clean snapshots of documents holding no work, in that organization", async () => {
    await closeCheckpointed("clean");
    // A clean copy beside a dirty one of the same document: offline replay builds on both.
    await closeCheckpointed("working");
    const typing = await openIn("working", "org-1", { hydrate: false });
    typing.type("unsaved ");
    await typing.close();
    await closeCheckpointed("elsewhere", "org-2");
    const drafting = await openIn("draft", "org-1");
    drafting.type("refused");
    await drafting.persistence.quarantine();
    await drafting.close();
    const working = await storedRowKeys("TASK", "working");
    const elsewhere = await storedRowKeys("TASK", "elsewhere");
    const draft = await storedRowKeys("TASK", "draft");
    expect(working).toHaveLength(2);

    expect(await purgeCleanSnapshots("alice", "org-1")).toBe(1);
    expect(await storedRowKeys("TASK", "clean")).toEqual([]);
    expect(await storedRowKeys("TASK", "working")).toEqual(working);
    expect(await storedRowKeys("TASK", "elsewhere")).toEqual(elsewhere);
    expect(await storedRowKeys("TASK", "draft")).toEqual(draft);
    expect(await discoverStoredPendingDocs("alice")).toBe(true);
    // Another account's view of the device purges nothing of this one.
    expect(await purgeCleanSnapshots("bob", "org-2")).toBe(0);
    expect(await storedRowKeys("TASK", "elsewhere")).toEqual(elsewhere);
  });

  it("closes a still-open session of the lost organization without leaving a cache, until the organization is opened again", async () => {
    await closeCheckpointed("open");
    const session = await openIn("open", "org-1");
    session.type("saved later");
    await purgeCleanSnapshots("alice", "org-1");
    await session.close({ checkpointed: true });
    expect(await storedRowKeys("TASK", "open")).toEqual([]);

    await closeCheckpointed("open");
    expect(await storedRowKeys("TASK", "open")).toHaveLength(1);
  });
});
