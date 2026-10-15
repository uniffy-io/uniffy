import { expect, it, vi } from "vitest";
import * as Y from "yjs";
import { hydrateOfflineDraft, offlineReplayBase } from "@features/notes/realtime/draftRecovery";
import { createTextBinding } from "@features/notes/realtime/textBinding";
import type { MobileRecoveredDraft } from "@shared/realtime/draftStorage";

function draft(text: string, base = "base"): MobileRecoveredDraft {
  return { id: text, generation: "unmerged:offline", text, base, update: "" };
}

it("reopens newest compatible offline text and merges it once", async () => {
  let local = "base";
  const callbacks = {
    getLoadedCanonical: () => "base",
    getLocalCanonical: () => local,
    applyRemote: (text: string) => {
      local = text;
    },
  };
  expect(hydrateOfflineDraft([draft("base older"), draft("base offline")], callbacks)?.text).toBe(
    "base offline",
  );
  expect(local).toBe("base offline");
  const doc = new Y.Doc();
  doc.getText("markdown").insert(0, "base");
  const binding = createTextBinding({
    ydoc: doc,
    origin: "local",
    whenSynced: Promise.resolve(),
    callbacks,
    onLive: vi.fn(),
  });
  await Promise.resolve();
  binding.applyNow();
  expect(local).toBe("base offline");
  expect(doc.getText("markdown").toString()).toBe(local);
  binding.dispose();
  doc.destroy();
});

it.each([
  { local: "typing", base: "base", composing: false },
  { local: "base", base: "different", composing: false },
  { local: "base", base: "base", composing: true },
])(
  "keeps conflicting or in-flight input for explicit recovery: %j",
  ({ local, base, composing }) => {
    const applyRemote = vi.fn();
    expect(
      hydrateOfflineDraft([draft("offline", base)], {
        getLoadedCanonical: () => "base",
        getLocalCanonical: () => local,
        applyRemote,
        isComposing: () => composing,
      }),
    ).toBeNull();
    expect(applyRemote).not.toHaveBeenCalled();
  },
);

it("restores deliberate empty text", () => {
  const applyRemote = vi.fn();
  hydrateOfflineDraft([draft("")], {
    getLoadedCanonical: () => "base",
    getLocalCanonical: () => "base",
    applyRemote,
  });
  expect(applyRemote).toHaveBeenCalledWith("", expect.any(Function));
});

it("does not replay a recovered text edit over a changed server base", () => {
  expect(offlineReplayBase(draft("base offline"), "peer base")).toBeNull();
  expect(offlineReplayBase(draft("base offline"), "base")).toBe("base");
});

it("uses already accepted text as the base so only subsequent edits replay", () => {
  expect(offlineReplayBase(draft("base offline"), "base offline")).toBe("base offline");
});
