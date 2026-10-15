import { nativeStorage } from "@shared/realtime/__tests__/storageHarness";
import { clearEncryptedDrafts } from "@shared/realtime/encryptedDraftStore";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { realtimeMultiplexer } from "@shared/realtime/multiplexer";
import { runMobileDrain, stopMobileDrains, abortMobileDrain } from "@shared/realtime/drain";
import { saveDraft, readStoredDrafts, resumeDraftStorage } from "@shared/realtime/draftStorage";

type Attachment = Parameters<typeof realtimeMultiplexer.attach>[0];
const state = vi.hoisted(() => ({
  attachment: null as Attachment | null,
  destroy: vi.fn(),
  pending: true,
  attached: false,
}));
vi.mock("@shared/realtime/multiplexer", () => ({
  realtimeMultiplexer: {
    isAttached: () => state.attached,
    isOutboundPending: () => state.pending,
    attach: (args: Attachment) => {
      state.attachment = args;
      return { destroy: state.destroy };
    },
  },
}));
const key = "realtime.user.org.NOTE.note";
beforeEach(async () => {
  await clearEncryptedDrafts("user");
  nativeStorage.secure.clear();
  state.attachment = null;
  state.pending = true;
  state.attached = false;
  state.destroy.mockClear();
  resumeDraftStorage("user");
});
afterEach(() => stopMobileDrains());

it("drains a closed draft and prunes it only after acknowledgment", async () => {
  const server = new Y.Doc();
  server.getMap("doc_meta").set("generation", "G");
  server.getText("markdown").insert(0, "base");
  const local = new Y.Doc();
  Y.applyUpdate(local, Y.encodeStateAsUpdate(server));
  local.getText("markdown").insert(4, " offline");
  await saveDraft(key, local);
  await runMobileDrain("user", "org", () => true);
  const attachment = state.attachment!;
  Y.applyUpdate(attachment.ydoc, Y.encodeStateAsUpdate(server));
  attachment.onSync?.();
  await vi.waitFor(() =>
    expect(attachment.ydoc.getText("markdown").toString()).toBe("base offline"),
  );
  expect(await readStoredDrafts(key)).toHaveLength(1);
  state.pending = false;
  attachment.onPending?.(false);
  await vi.waitFor(() => expect(state.destroy).toHaveBeenCalledOnce());
  expect(await readStoredDrafts(key)).toHaveLength(0);
  server.destroy();
  local.destroy();
});

it.each(["denial", "handoff"])("retains draft during %s", async (reason) => {
  const doc = new Y.Doc();
  doc.getMap("doc_meta").set("generation", "G");
  doc.getText("markdown").insert(0, "offline");
  await saveDraft(key, doc);
  await runMobileDrain("user", "org", () => true);
  if (reason === "denial") state.attachment!.onWriteDenied?.("edit denied");
  else abortMobileDrain("NOTE:note");
  expect(state.destroy).toHaveBeenCalledOnce();
  expect(await readStoredDrafts(key)).toHaveLength(1);
  doc.destroy();
});
