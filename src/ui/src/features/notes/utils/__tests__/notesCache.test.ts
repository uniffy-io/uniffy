import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { SerializedNote } from "@/features/notes/store/notesThunks";
import { getCachedNotes, setCachedNotes } from "@/features/notes/utils/notesCache";
import type { OrganizedNotes } from "@/features/notes/utils/notesTreeUtils";
import {
  initStorageEncryption,
  teardownStorageEncryption,
} from "@/shared/crypto/storageEncryption";

const tree = { personal: [], shared: [], organization: [], trash: [] } as unknown as OrganizedNotes;
const notes = [{ id: "note", title: "Org one note" }] as SerializedNote[];

beforeAll(async () => {
  vi.stubGlobal("window", new EventTarget());
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  await initStorageEncryption(new Uint8Array(32).fill(5), "alice");
});

afterAll(() => {
  teardownStorageEncryption();
  vi.unstubAllGlobals();
});

it("reads an entry back only for the account and organization it was written for", async () => {
  await setCachedNotes("org-1", "alice", notes, tree, 1);
  expect((await getCachedNotes("org-1", "alice"))?.notes).toEqual(notes);
  expect(await getCachedNotes("org-1", "bob")).toBeNull();

  // The same ciphertext filed under another organization does not authenticate there.
  const db = await openDB("uniffy-notes-cache", 2);
  await db.put("notes-data", await db.get("notes-data", "org-1"), "org-2");
  db.close();
  expect(await getCachedNotes("org-2", "alice")).toBeNull();
  expect((await getCachedNotes("org-1", "alice"))?.notes).toEqual(notes);
});
