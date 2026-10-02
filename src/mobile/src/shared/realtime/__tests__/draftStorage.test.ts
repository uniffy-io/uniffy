import { beforeEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { restoreDraft, saveDraft } from "@shared/realtime/draftStorage";

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (key: string) => storage.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => storage.set(key, value),
  deleteItemAsync: async (key: string) => storage.delete(key),
}));
beforeEach(() => storage.clear());

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
  await saveDraft("chunks", local);
  const reopened = new Y.Doc();
  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(server));
  expect(await restoreDraft("chunks", reopened, "recovery")).toEqual([]);
  expect(reopened.getText("markdown").toString()).toBe(local.getText("markdown").toString());
  server.destroy();
  local.destroy();
  reopened.destroy();
});

it("retains replaced generations for recovery without merging into current text", async () => {
  const old = draft("old", "offline work");
  await saveDraft("versions", old);
  const current = draft("current", "replacement");
  const recovered = await restoreDraft("versions", current, "recovery");
  expect(recovered.map((item) => item.text)).toEqual(["offline work"]);
  expect(current.getText("markdown").toString()).toBe("replacement");
  await saveDraft("versions", current);
  expect(JSON.parse(storage.get("versions")!)).toHaveLength(2);
  old.destroy();
  current.destroy();
});

it("preserves offline edits when an unhydrated session closes over the same generation", async () => {
  const server = draft("shared", "base");
  const offline = new Y.Doc();
  Y.applyUpdate(offline, Y.encodeStateAsUpdate(server));
  offline.getText("markdown").insert(4, " offline");
  await saveDraft("early-close", offline);
  await saveDraft("early-close", server);
  const reopened = new Y.Doc();
  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(server));
  const restoring = restoreDraft("early-close", reopened, "recovery");
  const closing = saveDraft("early-close", server);
  await Promise.all([restoring, closing]);
  expect(reopened.getText("markdown").toString()).toBe("base offline");
  expect(JSON.parse(storage.get("early-close")!)).toHaveLength(1);
  server.destroy();
  offline.destroy();
  reopened.destroy();
});

it("continues after a damaged draft record", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const old = draft("damaged", "lost chunk");
  await saveDraft("damage", old);
  const current = draft("current", "recoverable");
  await saveDraft("damage", current);
  const records = JSON.parse(storage.get("damage")!);
  storage.delete(`damage.${records[0].id}.0`);
  const reopened = new Y.Doc();
  const recovered = await restoreDraft("damage", reopened, "recovery");
  expect(recovered.map((item) => item.text)).toEqual(["recoverable"]);
  old.destroy();
  current.destroy();
  reopened.destroy();
  vi.restoreAllMocks();
});
