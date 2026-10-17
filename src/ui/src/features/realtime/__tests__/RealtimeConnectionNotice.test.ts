import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RealtimeConnectionNotice } from "@/features/realtime/components/RealtimeConnectionNotice";
import type { RealtimeStatus } from "@/features/realtime/protocol";

function render(status: RealtimeStatus, waiting = true): string {
  return renderToStaticMarkup(createElement(RealtimeConnectionNotice, { waiting, status }));
}

describe("connection notice", () => {
  it("explains Access lost without promising a draft to recover", () => {
    const html = render("access_lost");
    expect(html).toContain("Access lost. This item was deleted or is no longer shared with you.");
    expect(html).not.toMatch(/draft|recover|unsaved/i);
  });

  it("keeps the rejected copy generic, since a conflict and an oversized edit read the same", () => {
    for (const waiting of [true, false]) {
      const html = render("update_rejected", waiting);
      expect(html).toContain("This edit could not be synced.");
      expect(html).not.toMatch(/is too large/i);
    }
  });

  it("says nothing once the editor is live and nothing was rejected", () => {
    expect(render("access_lost", false)).toBe("");
    expect(render("connected", false)).toBe("");
  });
});
