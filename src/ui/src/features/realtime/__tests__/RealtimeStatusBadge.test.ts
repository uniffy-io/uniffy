import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RealtimeStatusBadge } from "@/features/realtime/components/RealtimeStatusBadge";
import type { SaveState } from "@/features/realtime/hooks/useDocSaveState";
import type { DeviceStorage } from "@/features/realtime/persistence/encryptedYjsPersistence";
import type { RealtimeStatus } from "@/features/realtime/protocol";

const SAVE_STATES: SaveState[] = ["syncing", "synced", "delayed", "saved"];
const SAVE_LABELS: Record<SaveState, string> = {
  syncing: "Syncing",
  synced: "Synced",
  delayed: "Saving delayed",
  saved: "Saved",
};
const EXCEPTIONAL: [RealtimeStatus, string][] = [
  ["connecting", "Connecting"],
  ["disconnected", "Offline"],
  ["offline", "Offline"],
  ["update_rejected", "Edit too large to sync"],
  ["permission_lost", "View-only - edit access removed"],
  ["access_lost", "Access lost"],
  ["token_revoked", "Session ended - reload"],
];

function render(
  status: RealtimeStatus,
  save: SaveState | null = null,
  storage: DeviceStorage = "available",
): string {
  return renderToStaticMarkup(createElement(RealtimeStatusBadge, { status, save, storage }));
}

describe("persistence chip", () => {
  it.each(SAVE_STATES)("labels %s quietly without infrastructure terms", (save) => {
    const html = render("connected", save);
    expect(html).toContain(`>${SAVE_LABELS[save]}<`);
    expect(html).toContain('role="status"');
    expect(html).not.toContain("animate-pulse");
    expect(html).not.toMatch(/valkey|epoch|sequence|checkpoint|stream|receipt/i);
  });

  it("explains Synced as shared but not yet saved", () => {
    expect(render("connected", "synced")).toContain(
      'title="Shared with collaborators, saving shortly."',
    );
  });

  it.each(EXCEPTIONAL)("lets %s take precedence over every save state", (status, label) => {
    for (const save of SAVE_STATES) {
      const html = render(status, save);
      expect(html).toContain(`>${label}<`);
      expect(html).not.toContain(`>${SAVE_LABELS[save]}<`);
    }
  });

  it("stays hidden on a healthy connection with no save state to report", () => {
    expect(render("connected")).toBe("");
    expect(render("idle")).toBe("");
  });

  it("says edits stay on this device while offline or delayed with a stored copy", () => {
    expect(render("offline")).toContain("Edits stay on this device");
    expect(render("connected", "delayed")).toContain("Your edits stay on this device");
  });

  it.each<DeviceStorage>(["unavailable", "failed"])(
    "never promises a device copy when device storage is %s",
    (storage) => {
      expect(render("offline", null, storage)).toContain("This device cannot store them");
      expect(render("offline", null, storage)).not.toContain("stay on this device");
    },
  );

  it("says the device cannot store edits while saving is delayed without storage", () => {
    expect(render("connected", "delayed", "unavailable")).toContain(
      "This device cannot store your edits",
    );
  });

  it("shows a failed device copy ahead of the connection and every unsaved state", () => {
    for (const status of ["connected", "connecting", "offline", "disconnected"] as const) {
      for (const save of ["syncing", "synced", "delayed"] as const) {
        const html = render(status, save, "failed");
        expect(html).toContain(">Not saved on device<");
        expect(html).not.toContain(`>${SAVE_LABELS[save]}<`);
      }
    }
    expect(render("connected", "saved", "failed")).toContain(">Saved<");
    expect(render("connected", null, "failed")).toBe("");
    expect(render("access_lost", "synced", "failed")).toContain(">Access lost<");
  });
});
