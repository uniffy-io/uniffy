import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { RealtimeSessionStatus } from "@/features/realtime/components/RealtimeSessionStatus";
import { RealtimeStatusBadge } from "@/features/realtime/components/RealtimeStatusBadge";
import { RecoveredDraftsTrigger } from "@/features/realtime/components/RecoveredDrafts";
import type { SaveState } from "@/features/realtime/hooks/useDocSaveState";
import type { RealtimeStatus } from "@/features/realtime/protocol";

// Every label a chip can carry, from the shortest to the longest.
const CHIPS: [RealtimeStatus, SaveState | null, string][] = [
  ["connected", "saved", "Saved"],
  ["connected", "synced", "Synced"],
  ["connected", "syncing", "Syncing"],
  ["connected", "delayed", "Saving delayed"],
  ["connected", "unavailable", "Saving unavailable"],
  ["connecting", null, "Connecting"],
  ["offline", null, "Offline"],
  ["update_rejected", null, "Edit not synced"],
  ["permission_lost", null, "View-only - edit access removed"],
  ["access_lost", null, "Access lost"],
  ["token_revoked", null, "Session ended - reload"],
  ["upgrade_required", null, "Reload to keep saving"],
];

const store = configureStore({
  reducer: {
    auth: () => ({ user: { id: "alice", fullName: "Alice Johnson", hasAvatar: false } }),
  },
});

/** Class list of the element whose text is exactly `text`. */
function classesOf(html: string, text: string): string[] {
  const match = new RegExp(`class="([^"]*)"[^>]*>${text}<`).exec(html);
  if (!match) throw new Error(`no element reads ${text} in ${html}`);
  return match[1].split(" ");
}

/** Attributes of the chip, the element carrying `role="status"`. */
function chip(html: string): { classes: string[]; title: string } {
  const tag = /<span([^>]*role="status"[^>]*)>/.exec(html)?.[1];
  if (!tag) throw new Error(`no chip in ${html}`);
  return {
    classes: (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(" "),
    title: /title="([^"]*)"/.exec(tag)?.[1] ?? "",
  };
}

function badge(status: RealtimeStatus, save: SaveState | null, compact: boolean): string {
  return renderToStaticMarkup(
    createElement(RealtimeStatusBadge, { status, save, storage: "available", compact }),
  );
}

describe("persistence chip on narrow screens", () => {
  it.each(CHIPS)(
    "shows only the dot for %s %s below the small breakpoint in a crowded bar, never wrapping",
    (status, save, label) => {
      const html = badge(status, save, true);
      expect(classesOf(html, label)).toContain("max-sm:sr-only");
      expect(chip(html).classes).toEqual(expect.arrayContaining(["whitespace-nowrap", "shrink-0"]));
      expect(chip(html).title.startsWith(label)).toBe(true);
    },
  );

  it.each(CHIPS)(
    "keeps the %s %s label from the small breakpoint up and outside crowded bars",
    (status, save, label) => {
      const compact = classesOf(badge(status, save, true), label);
      expect(compact.filter((name) => name.includes("sr-only") || name.includes("hidden"))).toEqual(
        ["max-sm:sr-only"],
      );
      const full = classesOf(badge(status, save, false), label);
      expect(full.some((name) => name.includes("sr-only") || name.includes("hidden"))).toBe(false);
    },
  );
});

describe("editor header and toolbar status slot", () => {
  function sessionStatus(status: RealtimeStatus): string {
    return renderToStaticMarkup(
      createElement(Provider, {
        store,
        children: createElement(RealtimeSessionStatus, {
          status,
          awareness: new Awareness(new Y.Doc()),
          docName: "NOTE:narrow",
        }),
      }),
    );
  }

  it.each<[RealtimeStatus, string]>([
    ["connecting", "Connecting"],
    ["access_lost", "Access lost"],
    ["permission_lost", "View-only - edit access removed"],
  ])("keeps %s to the dot on phone widths beside the presence stack", (status, label) => {
    const html = sessionStatus(status);
    expect(html).toContain('aria-label="1 active editor"');
    expect(classesOf(html, label)).toContain("max-sm:sr-only");
    expect(chip(html).title.startsWith(label)).toBe(true);
  });

  it("shows only the recovered drafts icon on phone widths, keeping its label for screen readers", () => {
    const html = renderToStaticMarkup(createElement(RecoveredDraftsTrigger, { onOpen: () => {} }));
    expect(classesOf(html, "Recovered draft")).toEqual(["max-sm:sr-only"]);
    expect(html).toContain('title="Recovered draft"');
    expect(html).toMatch(/<button[^>]*class="[^"]*whitespace-nowrap/);
    expect(html).toContain("<svg");
  });
});
