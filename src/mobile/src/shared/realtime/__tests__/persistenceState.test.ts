import { expect, it } from "vitest";
import {
  persistenceState,
  SAVE_DELAYED_AFTER_MS,
  SYNCING_SETTLE_MS,
  type PersistenceInput,
  type PersistenceState,
} from "@shared/realtime/persistenceState";

const EDITED_AT = 1_000_000;
const clean = { transportPending: false, checkpointPending: false, oldestUncheckpointedAt: null };
const local = {
  transportPending: true,
  checkpointPending: true,
  oldestUncheckpointedAt: EDITED_AT,
};
const accepted = { ...local, transportPending: false };

function state(overrides: Partial<PersistenceInput>): PersistenceState {
  return persistenceState({
    status: "connected",
    doc: clean,
    synced: true,
    readOnly: false,
    storageFailed: false,
    transportSettledAt: null,
    now: EDITED_AT,
    ...overrides,
  });
}

it("reaches Saved only when no own edit awaits a checkpoint", () => {
  expect(state({ doc: local })).toBe("syncing");
  expect(state({ doc: accepted })).toBe("synced");
  expect(state({ doc: clean })).toBe("saved");
});

it("holds Syncing for a moment after the last receipt so typing does not flicker", () => {
  const settled = { transportSettledAt: EDITED_AT, doc: accepted };
  expect(state({ ...settled, now: EDITED_AT + SYNCING_SETTLE_MS - 1 })).toBe("syncing");
  expect(state({ ...settled, now: EDITED_AT + SYNCING_SETTLE_MS })).toBe("synced");
});

it("reads Saving delayed once the oldest uncheckpointed edit is thirty seconds old", () => {
  expect(state({ doc: accepted, now: EDITED_AT + SAVE_DELAYED_AFTER_MS - 1 })).toBe("synced");
  expect(state({ doc: accepted, now: EDITED_AT + SAVE_DELAYED_AFTER_MS })).toBe("delayed");
  expect(state({ doc: local, now: EDITED_AT + SAVE_DELAYED_AFTER_MS })).toBe("delayed");
});

it("never claims Saved before the first sync or while connecting", () => {
  expect(state({ synced: false })).toBe("connecting");
  expect(state({ status: "connecting" })).toBe("connecting");
  expect(state({ status: "idle", synced: false })).toBe("connecting");
  expect(state({ status: "connecting", doc: local })).toBe("syncing");
});

const delayed = { doc: accepted, now: EDITED_AT + SAVE_DELAYED_AFTER_MS };

it.each<[string, Partial<PersistenceInput>, PersistenceState]>([
  ["access loss over everything", { status: "access_lost", storageFailed: true }, "access_lost"],
  ["ended session over storage", { status: "token_revoked", storageFailed: true }, "session_ended"],
  ["edit denial over storage", { status: "permission_lost", storageFailed: true }, "view_only"],
  ["oversized edit over storage", { status: "update_rejected", storageFailed: true }, "too_large"],
  ["storage failure over offline", { status: "offline", storageFailed: true }, "storage_failed"],
  ["offline over delay", { status: "offline" }, "offline"],
  ["dropped socket over delay", { status: "disconnected" }, "offline"],
  ["offline over requested view-only", { status: "offline", readOnly: true }, "offline"],
  ["requested view-only over delay", { readOnly: true }, "view_only"],
])("ranks %s", (_case, overrides, expected) => {
  expect(state({ ...delayed, ...overrides })).toBe(expected);
});

it("drops a device storage failure once every edit is checkpointed", () => {
  expect(state({ storageFailed: true, doc: accepted })).toBe("storage_failed");
  expect(state({ storageFailed: true, synced: false })).toBe("storage_failed");
  expect(state({ storageFailed: true, doc: clean })).toBe("saved");
});
