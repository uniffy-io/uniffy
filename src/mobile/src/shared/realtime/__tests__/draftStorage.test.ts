import { nativeStorage } from "@shared/realtime/__tests__/storageHarness";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { toBase64 } from "lib0/buffer";
import {
  discardDraft,
  discardGeneration,
  listDraftKeys,
  readRetainedUpdates,
  readStoredDrafts,
  recordCoverage,
  restoreDraft,
  saveDraft,
  saveTextDraft,
} from "@shared/realtime/draftStorage";
import type { UpdateCoverageEvent } from "@shared/realtime/multiplexer";

import { clearEncryptedDrafts } from "@shared/realtime/encryptedDraftStore";
const storage = nativeStorage.secure;
beforeEach(async () => {
  for (const user of ["test", "alice", "bob"]) await clearEncryptedDrafts(user);
  storage.clear();
  nativeStorage.failInsert = false;
  nativeStorage.failDelete = false;
});

function draft(generation: string, text: string): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap("doc_meta").set("generation", generation);
  doc.getText("markdown").insert(0, text);
  return doc;
}

it("restores offline changes with causal base and chunks intact", async () => {
  const server = draft("same", "base");
  const local = new Y.Doc();
  Y.applyUpdate(local, Y.encodeStateAsUpdate(server));
  local.getText("markdown").insert(4, " long edit".repeat(400));
  await saveDraft("realtime.test.org.NOTE.chunks", local);
  const reopened = new Y.Doc();
  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(server));
  expect(await restoreDraft("realtime.test.org.NOTE.chunks", reopened, "recovery")).toEqual([]);
  expect(reopened.getText("markdown").toString()).toBe(local.getText("markdown").toString());
  server.destroy();
  local.destroy();
  reopened.destroy();
});

it("retains replaced generations for recovery without merging into current text", async () => {
  const old = draft("old", "offline work");
  await saveDraft("realtime.test.org.NOTE.versions", old);
  const current = draft("current", "replacement");
  const recovered = await restoreDraft("realtime.test.org.NOTE.versions", current, "recovery");
  expect(recovered.map((item) => item.text)).toEqual(["offline work"]);
  expect(current.getText("markdown").toString()).toBe("replacement");
  await saveDraft("realtime.test.org.NOTE.versions", current);
  expect(await readStoredDrafts("realtime.test.org.NOTE.versions")).toHaveLength(2);
  old.destroy();
  current.destroy();
});

it("preserves offline edits when an unhydrated session closes over the same generation", async () => {
  const server = draft("shared", "base");
  const offline = new Y.Doc();
  Y.applyUpdate(offline, Y.encodeStateAsUpdate(server));
  offline.getText("markdown").insert(4, " offline");
  await saveDraft("realtime.test.org.NOTE.early-close", offline);
  await saveDraft("realtime.test.org.NOTE.early-close", server);
  const reopened = new Y.Doc();
  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(server));
  const restoring = restoreDraft("realtime.test.org.NOTE.early-close", reopened, "recovery");
  const closing = saveDraft("realtime.test.org.NOTE.early-close", server);
  await Promise.all([restoring, closing]);
  expect(reopened.getText("markdown").toString()).toBe("base offline");
  expect(await readStoredDrafts("realtime.test.org.NOTE.early-close")).toHaveLength(1);
  server.destroy();
  offline.destroy();
  reopened.destroy();
});

it("continues after a damaged draft record", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const old = draft("damaged", "lost chunk");
  await saveDraft("realtime.test.org.NOTE.damage", old);
  const current = draft("current", "recoverable");
  await saveDraft("realtime.test.org.NOTE.damage", current);
  const db = nativeStorage.databases.get("realtime-test.db")!;
  db.prepare("UPDATE drafts SET ciphertext = ? WHERE generation = ?").run(
    new Uint8Array([0]),
    "damaged",
  );
  const reopened = new Y.Doc();
  const recovered = await restoreDraft("realtime.test.org.NOTE.damage", reopened, "recovery");
  expect(recovered.map((item) => item.text)).toEqual(["recoverable"]);
  old.destroy();
  current.destroy();
  reopened.destroy();
  vi.restoreAllMocks();
});

it("does not save a document before its server generation arrives", async () => {
  const empty = new Y.Doc();
  await saveDraft("realtime.test.org.NOTE.empty", empty);
  expect(storage.has("realtime.test.org.NOTE.empty")).toBe(false);
  empty.destroy();
});

it("loads text drafts offline, including an intentional deletion", async () => {
  await saveTextDraft("realtime.test.org.NOTE.offline", "", "original", "edit");
  const drafts = await readStoredDrafts("realtime.test.org.NOTE.offline");
  expect(drafts).toMatchObject([{ generation: "unmerged:edit", base: "original", text: "" }]);
});

it("discards one exact record without deleting a later edit in its lineage", async () => {
  await saveTextDraft("realtime.test.org.NOTE.discard", "first", "base", "edit");
  const [first] = await readStoredDrafts("realtime.test.org.NOTE.discard");
  await saveTextDraft("realtime.test.org.NOTE.discard", "second", "base", "edit");
  await discardDraft("realtime.test.org.NOTE.discard", first.id);
  const [second] = await readStoredDrafts("realtime.test.org.NOTE.discard");
  expect(second.text).toBe("second");
  await discardDraft("realtime.test.org.NOTE.discard", second.id);
  expect(await readStoredDrafts("realtime.test.org.NOTE.discard")).toEqual([]);
  expect(await readStoredDrafts("realtime.test.org.NOTE.discard")).toEqual([]);
});

it("leaves recovery bytes intact when session closes during storage read", async () => {
  const local = draft("same", "offline work");
  await saveDraft("realtime.test.org.NOTE.closed", local);
  const current = draft("same", "server");
  await restoreDraft("realtime.test.org.NOTE.closed", current, "recovery", () => false);
  expect(current.getText("markdown").toString()).toBe("server");
  expect((await readStoredDrafts("realtime.test.org.NOTE.closed"))[0].text).toBe("offline work");
  local.destroy();
  current.destroy();
});

it("keeps a corrupt manifest and allows subsequent drafts to save", async () => {
  storage.set("realtime.test.org.NOTE.corrupt-draft", "broken-json");
  await saveTextDraft("realtime.test.org.NOTE.corrupt-draft", "new typing", "base", "current");
  expect((await readStoredDrafts("realtime.test.org.NOTE.corrupt-draft"))[0].text).toBe(
    "new typing",
  );
  expect(
    [...storage.entries()].some(
      ([key, value]) =>
        key.startsWith("realtime.test.org.NOTE.corrupt-draft.corrupt.") && value === "broken-json",
    ),
  ).toBe(true);
});

it("coalesces queued typing without losing either writer's causal updates", async () => {
  const doc = new Y.Doc();
  doc.getMap("doc_meta").set("generation", "g");
  const pending = [];
  for (let i = 0; i < 100; i++) {
    doc.getText("markdown").insert(i, "a");
    pending.push(saveDraft("realtime.test.org.NOTE.burst", doc));
  }
  await Promise.all(pending);
  expect((await readStoredDrafts("realtime.test.org.NOTE.burst"))[0].text).toBe("a".repeat(100));
  expect(new Set(pending).size).toBe(1);
  doc.destroy();
});

it("indexes pending documents and deletes user-scoped chunks on sign-out", async () => {
  const { listDraftKeys, clearUserDrafts, resumeDraftStorage, discardGeneration } =
    await import("@shared/realtime/draftStorage");
  resumeDraftStorage("alice");
  const key = "realtime.alice.org.NOTE.note";
  const doc = draft("g", "pending");
  await saveDraft(key, doc);
  expect(await listDraftKeys("alice")).toEqual([key]);
  await discardGeneration(key, "g");
  expect(await readStoredDrafts(key)).toEqual([]);
  await saveDraft(key, doc);
  await clearUserDrafts("alice");
  expect([...storage.keys()].filter((value) => value.startsWith("realtime."))).toEqual([]);
  await saveDraft(key, doc);
  expect(await readStoredDrafts(key)).toEqual([]);
  resumeDraftStorage("alice");
  doc.destroy();
});

it("migrates readable chunks only after replacement commits", async () => {
  const key = "realtime.test.org.NOTE.migration";
  const doc = draft("g", "offline work");
  storage.set(
    key,
    JSON.stringify([
      { id: "readable", generation: "g", chunks: 1 },
      { id: "damaged", generation: "g", chunks: 1 },
      { id: "other", generation: "other", chunks: 1 },
    ]),
  );
  storage.set(`${key}.readable.0`, toBase64(Y.encodeStateAsUpdate(doc)));
  storage.set(`${key}.other.0`, toBase64(Y.encodeStateAsUpdate(draft("other", "older work"))));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  nativeStorage.failInsert = true;
  await expect(saveDraft(key, doc)).rejects.toThrow("Disk failure");
  expect(storage.has(`${key}.readable.0`)).toBe(true);
  nativeStorage.failInsert = false;
  await saveDraft(key, doc);
  expect(storage.has(`${key}.readable.0`)).toBe(false);
  expect(JSON.parse(storage.get(key)!)).toHaveLength(2);
  expect((await readStoredDrafts(key)).map((record) => record.text)).toEqual([
    "older work",
    "offline work",
  ]);
  vi.restoreAllMocks();
  doc.destroy();
});

it("rolls back replacement if retiring previous encrypted record fails", async () => {
  const key = "realtime.test.org.NOTE.rollback";
  await saveTextDraft(key, "first", "base", "typing");
  nativeStorage.failDelete = true;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await expect(saveTextDraft(key, "second", "base", "typing")).rejects.toThrow("Disk failure");
  nativeStorage.failDelete = false;
  expect((await readStoredDrafts(key)).map((record) => record.text)).toEqual(["first"]);
  vi.restoreAllMocks();
});

it("authenticates ciphertext scope and retains damaged unmerged drafts", async () => {
  const first = "realtime.test.org.NOTE.first";
  const second = "realtime.test.org.NOTE.second";
  await saveTextDraft(first, "private text", "base", "typing");
  const db = nativeStorage.databases.get("realtime-test.db")!;
  const row = db.prepare("SELECT * FROM drafts").get()!;
  expect(Buffer.from(row.ciphertext as Uint8Array).includes(Buffer.from("private text"))).toBe(
    false,
  );
  db.prepare("UPDATE drafts SET document = ?").run(second);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(await readStoredDrafts(second)).toEqual([]);
  await saveTextDraft(second, "new text", "base", "typing");
  expect(db.prepare("SELECT id FROM drafts").all()).toHaveLength(2);
  expect((await readStoredDrafts(second)).map((record) => record.text)).toEqual(["new text"]);
  vi.restoreAllMocks();
});

it("keeps native call counts constant as snapshots grow", async () => {
  const counts = [];
  for (const size of [8192, 131072, 460800]) {
    const key = `realtime.test.org.NOTE.size-${size}`;
    const doc = draft("g", "x".repeat(size));
    await saveDraft(key, doc);
    doc.getText("markdown").insert(size, "!");
    const before = { ...nativeStorage.calls };
    await saveDraft(key, doc);
    counts.push(
      Object.fromEntries(
        Object.entries(nativeStorage.calls).map(([kind, count]) => [
          kind,
          count - before[kind as keyof typeof before],
        ]),
      ),
    );
    expect((await readStoredDrafts(key))[0].text.length).toBe(size + 1);
    doc.destroy();
  }
  expect(counts).toEqual(
    Array(3).fill({ get: 1, set: 0, delete: 0, sql: 3, encrypt: 1, decrypt: 1 }),
  );
});

it("serializes concurrent document writes and waits for them on sign-out", async () => {
  const { clearUserDrafts, resumeDraftStorage, listDraftKeys } =
    await import("@shared/realtime/draftStorage");
  resumeDraftStorage("bob");
  const before = nativeStorage.calls.set;
  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      saveTextDraft(`realtime.bob.org.NOTE.${index}`, `text ${index}`, "base", "typing"),
    ),
  );
  expect(nativeStorage.calls.set - before).toBe(1);
  expect(await listDraftKeys("bob")).toHaveLength(8);
  const saving = saveTextDraft("realtime.bob.org.NOTE.pending", "last edit", "base", "typing");
  await clearUserDrafts("bob");
  await saving;
  expect(nativeStorage.databases.has("realtime-bob.db")).toBe(false);
  expect(storage.has("realtime.key.bob")).toBe(false);
  resumeDraftStorage("bob");
});

it("reloads encryption key after restart and preserves records when key is missing", async () => {
  const key = "realtime.test.org.NOTE.restart";
  await saveTextDraft(key, "survives restart", "base", "typing");
  vi.resetModules();
  const restarted = await import("@shared/realtime/encryptedDraftStore");
  const [record] = await restarted.encryptedDraftRecords(key);
  const doc = new Y.Doc();
  const { fromBase64 } = await import("lib0/buffer");
  Y.applyUpdate(doc, fromBase64(await restarted.decryptDraft(key, record)));
  expect(doc.getText("markdown").toString()).toBe("survives restart");
  storage.delete("realtime.key.test");
  vi.resetModules();
  const locked = await import("@shared/realtime/encryptedDraftStore");
  await expect(locked.decryptDraft(key, record)).rejects.toThrow("key unavailable");
  expect(await locked.encryptedDraftRecords(key)).toHaveLength(1);
  expect(storage.has("realtime.key.test")).toBe(false);
  await locked.clearEncryptedDrafts("test");
  doc.destroy();
});

describe("retained updates", () => {
  const key = "realtime.test.org.NOTE.retained";
  const event = (
    updateId: string,
    coverage: "local" | "accepted" | "checkpointed",
    update: Uint8Array = new Uint8Array(),
  ): UpdateCoverageEvent => ({ updateId, coverage, editedAt: Number(updateId.at(-1)), update });

  function deletion(): Uint8Array {
    const doc = draft("g", "remove me");
    const before = Y.encodeStateVector(doc);
    doc.getText("markdown").delete(0, 9);
    const update = Y.encodeStateAsUpdate(doc, before);
    doc.destroy();
    return update;
  }

  it("keeps raw bytes across a restart until a checkpoint retires them", async () => {
    const insert = Y.encodeStateAsUpdate(draft("g", "typed"));
    const removal = deletion();
    await recordCoverage(key, "g", [event("u1", "local", insert), event("u2", "local", removal)]);
    await recordCoverage(key, "g", [event("u1", "accepted")]);
    await recordCoverage(key, "other", [event("u3", "local", insert)]);
    vi.resetModules();
    const restarted = await import("@shared/realtime/draftStorage");
    expect(await restarted.readRetainedUpdates(key, "g")).toEqual([
      { updateId: "u1", update: insert, editedAt: 1 },
      { updateId: "u2", update: removal, editedAt: 2 },
    ]);
    await restarted.recordCoverage(key, "g", [event("u1", "checkpointed")]);
    expect(await restarted.readRetainedUpdates(key, "g")).toEqual([
      { updateId: "u2", update: removal, editedAt: 2 },
    ]);
  });

  it("survives draft compaction and a clean close until its own checkpoint", async () => {
    const doc = draft("g", "base");
    await saveDraft(key, doc);
    await recordCoverage(key, "g", [event("u1", "local", deletion())]);
    doc.getText("markdown").insert(4, " more");
    await saveDraft(key, doc);
    await discardGeneration(key, "g");
    expect((await readStoredDrafts(key)).map((stored) => stored.text)).toEqual(["base more"]);
    expect((await readRetainedUpdates(key, "g")).map((update) => update.updateId)).toEqual(["u1"]);
    await recordCoverage(key, "g", [event("u1", "checkpointed")]);
    await discardGeneration(key, "g");
    expect(await readStoredDrafts(key)).toEqual([]);
    expect(await listDraftKeys("test")).toEqual([]);
    doc.destroy();
  });

  it("rolls back an interrupted batch and stores it with the next one", async () => {
    const ids = async () => (await readRetainedUpdates(key, "g")).map((update) => update.updateId);
    await recordCoverage(key, "g", [event("u0", "local", deletion())]);
    nativeStorage.failInsert = true;
    const failed = recordCoverage(key, "g", [
      event("u0", "checkpointed"),
      event("u1", "local", deletion()),
    ]);
    await expect(failed).rejects.toThrow("Disk failure");
    nativeStorage.failInsert = false;
    expect(await ids()).toEqual(["u0"]);
    await recordCoverage(key, "g", [event("u2", "local", deletion())]);
    expect(await ids()).toEqual(["u1", "u2"]);
  });

  it("binds each update to its document and keeps unreadable rows", async () => {
    await recordCoverage(key, "g", [event("u1", "local", deletion())]);
    const db = nativeStorage.databases.get("realtime-test.db")!;
    db.prepare("UPDATE updates SET document = ?").run("realtime.test.org.NOTE.elsewhere");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await readRetainedUpdates("realtime.test.org.NOTE.elsewhere", "g")).toEqual([]);
    expect(db.prepare("SELECT update_id FROM updates").all()).toHaveLength(1);
    expect(await readRetainedUpdates(key, "g")).toEqual([]);
    vi.restoreAllMocks();
  });

  it("offers a generation only retained updates hold as a recoverable draft", async () => {
    await recordCoverage(key, "old", [
      event("u1", "local", Y.encodeStateAsUpdate(draft("old", "stranded"))),
    ]);
    const [stranded] = await readStoredDrafts(key);
    expect(stranded).toMatchObject({ generation: "old", text: "stranded" });
    await discardDraft(key, stranded.id);
    expect(await readRetainedUpdates(key, "old")).toEqual([]);
    expect(await listDraftKeys("test")).toEqual([]);
  });

  it("drops a discarded generation's retained updates with its last draft", async () => {
    const old = draft("old", "replaced");
    await saveDraft(key, old);
    await recordCoverage(key, "old", [event("u1", "local", deletion())]);
    const [stored] = await readStoredDrafts(key);
    await discardDraft(key, stored.id);
    expect(await readRetainedUpdates(key, "old")).toEqual([]);
    old.destroy();
  });
});
